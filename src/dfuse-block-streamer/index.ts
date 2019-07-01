import * as Logger from "bunyan"
import { NextBlock } from "demux"
import { getApolloClient } from "../util"
import ApolloClient from "apollo-client/ApolloClient"
import { gql } from "apollo-boost"
import { Transaction } from "../types"

export type DfuseBlockStreamerOptions = {
  dfuseApiKey: string
  network?: string
  lowBlockNum?: number
  query?: string
  onlyIrreversible: boolean
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
  protected log: Logger
  protected dfuseApiKey: string
  protected network: string
  protected query: string
  protected apolloClient?: ApolloClient<any>
  protected listeners: OnBlockListener[] = []
  protected activeCursor: string = ""
  protected lowBlockNum: number
  protected currentBlockNumber: number = -1
  protected currentBlock?: NextBlock
  protected onlyIrreversible: boolean

  constructor(options: DfuseBlockStreamerOptions) {
    const { lowBlockNum, onlyIrreversible } = options

    this.log = Logger.createLogger({ name: "demux-dfuse" })
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
      apolloClient: this.apolloClient!,
      lowBlockNum: this.lowBlockNum
    }).subscribe({
      start: () => {
        this.log.trace("DfuseBlockStreamer GraphQL subscription started")
      },
      next: (value) => {
        this.onTransactionReceived(value.data.searchTransactionsForward)
      },
      error: (error) => {
        // TODO should we be doing anything else?
        this.log.error("DfuseBlockStreamer GraphQL subscription error", error)
      },
      complete: () => {
        // TODO: how to handle completion? Will we ever reach completion?
        this.log.error("DfuseBlockStreamer GraphQL subscription completed")
      }
    })
  }

  private onTransactionReceived(transaction: Transaction) {
    const { undo, trace, irreversibleBlockNum } = transaction
    const { matchingActions, block } = trace

    const isEarliestBlock = this.currentBlockNumber === -1
    const isNewBlock = block.num !== this.currentBlockNumber

    /*
     * When we see a transaction belonging to a different block than
     * the previous one, we pushed the previous block into the queue
     */
    if (!isEarliestBlock && isNewBlock) {
      this.notifyListeners(this.currentBlock!)
    }

    // Create a new current block if necessary
    if (isNewBlock) {
      this.currentBlockNumber = transaction.trace.block.num
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
          isEarliestBlock
        },
        lastIrreversibleBlockNumber: irreversibleBlockNum
      }
    }

    // Insert matching actions into the current block
    matchingActions.forEach((action: any) => {
      this.currentBlock!.block.actions.push({
        type: `${action.account}::${action.name}`,
        payload: {
          transactionId: trace.id,
          actionIndex: 0,
          account: action.account,
          name: action.name,
          authorization: action.authorization,
          data: action.data
        }
      })
    })

    // TODO: This isn't currently doing anything
    this.activeCursor = transaction.cursor
  }

  /**
   * Creates and returns an Apollo observable query
   */
  private getObservableSubscription(options: {
    apolloClient: ApolloClient<any>
    lowBlockNum: number
  }) {
    const { apolloClient, lowBlockNum } = options

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
        lowBlockNum
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
