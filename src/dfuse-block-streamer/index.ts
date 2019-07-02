import * as Logger from "bunyan"
import { Block, BlockInfo, BlockMeta, NextBlock } from "demux"
import { getApolloClient } from "./dfuse-api"
import ApolloClient from "apollo-client/ApolloClient"
import { gql } from "apollo-boost"
import { Transaction } from "../types"
import { getPreviousBlockHash, getBlockHash, getBlockNumber } from "../util"

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
  protected onlyIrreversible: boolean
  protected currentBlock?: NextBlock
  private lastPublishedBlock?: NextBlock

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
    const isNewBlock =
      block.num !== this.currentBlockNumber ||
      (this.currentBlock && this.currentBlock.blockMeta.isRollback !== undo)

    /*
     * When we see a transaction belonging to a different block than
     * the previous one, we notify the listeners to the completed block
     */
    if (!isEarliestBlock && isNewBlock) {
      // If we haven't published a block yet, we will use lowBlockNum as our reference
      const lastPublishedBlockNumber = this.lastPublishedBlock
        ? getBlockNumber(this.lastPublishedBlock)
        : this.lowBlockNum

      const lastIrreversibleBlockNumber = this.lastPublishedBlock
        ? this.lastPublishedBlock.lastIrreversibleBlockNumber
        : this.lowBlockNum

      // Generate dummy blocks for the ones not returned by dfuse
      const dummyBlocksNeeded = getInnerRange(
        lastPublishedBlockNumber,
        getBlockNumber(this.currentBlock!)
      )

      dummyBlocksNeeded.forEach((blockNumber, index) => {
        /*
         * If this is the last dummy block to be inserted before a real block, use the
         * real block's previousBlockHash as the dummy block's hash
         */
        const isLastDummyBlock = index === dummyBlocksNeeded.length - 1
        const previousBlockHash = this.lastPublishedBlock
          ? getBlockHash(this.lastPublishedBlock)
          : ""
        const blockHash =
          this.currentBlock && isLastDummyBlock ? getPreviousBlockHash(this.currentBlock) : ""

        const nextBlock = getDefaultNextBlock(
          {
            blockNumber,
            blockHash,
            previousBlockHash
          },
          {
            isEarliestBlock: typeof this.lastPublishedBlock === "undefined"
          },
          lastIrreversibleBlockNumber
        )

        this.notifyListeners(nextBlock)
        this.lastPublishedBlock = nextBlock
      })

      this.notifyListeners(this.currentBlock!)
      this.lastPublishedBlock = this.currentBlock
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

function getInnerRange(start: number, end: number): number[] {
  const range: number[] = []

  for (let i = start + 1; i < end; i++) {
    range.push(i)
  }

  return range
}
function getDefaultNextBlock(
  blockInfo: Partial<BlockInfo>,
  blockMeta: Partial<BlockMeta>,
  lastIrreversibleBlockNumber: number
): NextBlock {
  return {
    block: {
      blockInfo: Object.assign({}, defaultBlock.blockInfo, blockInfo),
      actions: []
    },
    blockMeta: Object.assign(
      {
        isRollback: false,
        isNewBlock: true,
        isEarliestBlock: false
      },
      blockMeta
    ),
    lastIrreversibleBlockNumber
  }
}

const defaultBlock: Block = {
  blockInfo: {
    blockNumber: 0,
    blockHash: "",
    previousBlockHash: "",
    timestamp: new Date(0)
  },
  actions: []
}
