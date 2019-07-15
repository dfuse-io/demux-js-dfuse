import Logger, { createLogger, LogLevel } from "bunyan"
import { NextBlock } from "demux"
import { getApolloClient } from "./dfuse-api"
import ApolloClient from "apollo-client"
import { gql } from "apollo-boost"
import { Transaction } from "../types"

export type DfuseBlockStreamerOptions = {
  dfuseApiKey: string
  network?: string
  lowBlockNum?: number
  query?: string
  onlyIrreversible: boolean
  logLevel?: LogLevel
}

type OnBlockListener = (nextBlock: NextBlock) => void

/**
 * DfuseBlockStreamer connects to the dfuse.io GraphQL API which transmits
 * the transactions that match a query written in SQE (see http://docs.dfuse.io for more information).
 *
 * As it receives transactions, it will group them by block, and send the reconstructed blocks
 * to listeners via a PubSub pattern it implements.
 */
export class DfuseBlockStreamer {
  private log: Logger
  private dfuseApiKey: string
  private network: string
  private query: string
  private apolloClient?: ApolloClient<any>
  private listeners: OnBlockListener[] = []
  private activeCursor: string = ""
  private lowBlockNum: number
  private currentBlockNumber: number = -1
  private onlyIrreversible: boolean
  private currentBlock?: NextBlock
  private lastPublishedBlock?: NextBlock
  private transactionProcessing: Promise<void> = Promise.resolve()
  private liveMarkerReached: boolean = false

  constructor(options: DfuseBlockStreamerOptions) {
    const { logLevel, lowBlockNum, onlyIrreversible } = options

    this.log = createLogger({
      name: "demux-dfuse",
      level: (logLevel || "error") as LogLevel
    })
    this.lowBlockNum = typeof lowBlockNum !== "undefined" ? lowBlockNum : 1
    this.dfuseApiKey = options.dfuseApiKey
    this.network = options.network || "mainnet"
    this.query = options.query || "status:executed"
    this.onlyIrreversible = typeof onlyIrreversible !== "undefined" ? onlyIrreversible : false

    this.log.trace("DfuseBlockStreamer", {
      lowBlockNum: this.lowBlockNum,
      hasDfuseApiKey: !!options.dfuseApiKey,
      network: this.network,
      query: this.query,
      onlyIrreversible: this.onlyIrreversible
    })
  }

  protected getApolloClient() {
    this.log.trace("DfuseBlockStreamer.getApolloClient()")

    return getApolloClient({
      apiKey: this.dfuseApiKey,
      network: this.network
    })
  }

  /**
   * Starts streams from the dfuse graphql API, calling all
   * registered listeners every time a new block is completed
   */
  public stream() {
    this.log.trace("DfuseBlockStreamer.stream()")

    if (!this.apolloClient) {
      this.apolloClient = this.getApolloClient()
    }

    this.getObservableSubscription({
      apolloClient: this.apolloClient!
    }).subscribe({
      start: () => {
        this.log.trace("DfuseBlockStreamer GraphQL subscription started")
      },
      next: (value: any) => {
        /**
         * This promise queueing trick is important because onTransactionReceived
         * might take a while to resolve if it has to create a large number of dummy
         * blocks, to fill large gaps between blocks returned by dfuse.
         */
        this.transactionProcessing = this.transactionProcessing.then(async () => {
          await this.onTransactionReceived(value.data.searchTransactionsForward)
        })
      },
      error: (error: Error) => {
        // TODO should we be doing anything else?
        // this.log.error("DfuseBlockStreamer GraphQL subscription error", error.message)
      },
      complete: () => {
        // TODO: how to handle completion? Will we ever reach completion?
        this.log.error("DfuseBlockStreamer GraphQL subscription completed")
      }
    })
  }

  public isLiveMarkerReached(): boolean {
    return this.liveMarkerReached
  }

  private async onTransactionReceived(transaction: Transaction) {
    this.log.trace("DfuseBlockStreamer.onTransactionReceived()")

    const { cursor, undo, trace, irreversibleBlockNum } = transaction

    /*
     * If trace is null, it means that we received a liveMarker.
     */
    if (!trace) {
      this.liveMarkerReached = true
      return
    }

    const { matchingActions, block } = trace

    const isEarliestBlock = this.currentBlockNumber === -1
    const isNewBlock =
      block.num !== this.currentBlockNumber ||
      (this.currentBlock && this.currentBlock.blockMeta.isRollback !== undo)

    /*
     * When we see a transaction belonging to a different block than
     * the previous one, we notify the listeners to the completed block
     */
    if (!isEarliestBlock && isNewBlock) {
      this.currentBlock!.blockMeta.isEarliestBlock = typeof this.lastPublishedBlock === "undefined"
      this.notifyListeners(this.currentBlock!)
      this.lastPublishedBlock = this.currentBlock
    }

    /*
     * Create a new current block if necessary
     */
    if (isNewBlock) {
      this.currentBlockNumber = trace.block.num
      this.currentBlock = {
        block: {
          actions: [],
          blockInfo: {
            blockNumber: block.num,
            blockHash: block.id,
            previousBlockHash: block.previous,
            timestamp: block.timestamp
          }
        },
        blockMeta: {
          isRollback: undo,
          isNewBlock: true,
          isEarliestBlock: false
        },
        lastIrreversibleBlockNumber: irreversibleBlockNum
      }
    }

    /* Insert matching actions into the current block */
    matchingActions.forEach((action: any) => {
      const { id, account, name, authorization, data } = action

      this.currentBlock!.block.actions.push({
        type: `${account}::${name}`,
        payload: {
          transactionId: id,
          actionIndex: 0,
          account,
          name,
          authorization,
          data
        }
      })
    })

    this.activeCursor = cursor
  }

  /**
   * Creates and returns an Apollo observable query
   */
  private getObservableSubscription(params: { apolloClient: ApolloClient<any> }) {
    const { apolloClient } = params

    return apolloClient.subscribe({
      query: gql`
        subscription(
          $cursor: String!
          $lowBlockNum: Int64!
          $query: String!
          $onlyIrreversible: Boolean!
        ) {
          searchTransactionsForward(
            query: $query
            cursor: $cursor
            lowBlockNum: $lowBlockNum
            irreversibleOnly: $onlyIrreversible
            liveMarkerInterval: 1000
          ) {
            undo
            irreversibleBlockNum
            trace {
              id
              block {
                num
                id
                previous
                timestamp
              }
              matchingActions {
                account
                name
                data
                authorization {
                  actor
                  permission
                }
              }
            }
          }
        }
      `,
      variables: {
        cursor: this.activeCursor,
        query: this.query,
        onlyIrreversible: this.onlyIrreversible,
        lowBlockNum: this.lowBlockNum
      }
    })
  }

  public addOnBlockListener(callback: OnBlockListener): void {
    this.listeners.push(callback)
  }
  public removeOnBlockListener(callback: OnBlockListener): void {
    this.listeners = this.listeners.filter((listener) => listener !== callback)
  }
  private notifyListeners(nextBlock: NextBlock): void {
    this.listeners.forEach((listener) => listener(nextBlock))
  }
}
