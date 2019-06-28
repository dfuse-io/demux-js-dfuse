import { AbstractActionReader, ActionReaderOptions, Block } from "demux"
import ApolloClient from "apollo-client/ApolloClient"
import { gql } from "apollo-boost"
import { getApolloClient, waitUntil } from "./util"

type DfuseActionReaderOptions = ActionReaderOptions & {
  dfuseApiKey: string
  network?: string
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
const block1: Block = {
  blockInfo: {
    blockNumber: 1,
    blockHash: "00000001405147477ab2f5f51cda427b638191c66d2c59aa392d5c2c98076cb0",
    previousBlockHash: "",
    timestamp: new Date("2018-06-08T08:08:08.000Z")
  },
  actions: []
}
const block2: Block = {
  blockInfo: {
    blockNumber: 2,
    blockHash: "0000000267f3e2284b482f3afc2e724be1d6cbc1804532ec62d4e7af47c30693",
    previousBlockHash: "00000001405147477ab2f5f51cda427b638191c66d2c59aa392d5c2c98076cb0",
    timestamp: new Date("2018-06-08T08:08:08.000Z")
  },
  actions: []
}

export class DfuseActionReader extends AbstractActionReader {
  protected network: string
  protected dfuseApiKey: string
  protected apolloClient: ApolloClient<any>
  protected headInfoInitialized: boolean = false
  protected activeCursor: string = ""
  protected blockQueue: Block[] = []

  constructor(options: DfuseActionReaderOptions) {
    super(options)
    this.dfuseApiKey = options.dfuseApiKey
    this.network = options.network || "mainnet"

    // Patch for an issue where dfuse doesnt return blocks 1 and 2
    if (this.startAtBlock > 0 && this.startAtBlock < 3) {
      this.startAtBlock = 3
      this.currentBlockNumber = 2
    }

    this.apolloClient = getApolloClient(this.dfuseApiKey, this.network)

    this.streamTransactions()
  }

  /**
   * Creates a GraphQL subscription, listening for the provided SQE query.
   * GraphQL returns transactions which are grouped together by block, and
   * then pushed into a queue.
   */
  private async streamTransactions() {
    let currentBlockNumber: number = -1
    let currentBlock: Block

    this.apolloClient
      .subscribe({
        query: gql`
          subscription($cursor: String!, $lowBlockNum: Int64) {
            searchTransactionsForward(
              query: "status:executed"
              cursor: $cursor
              lowBlockNum: $lowBlockNum
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
          lowBlockNum: this.currentBlockNumber
        }
      })
      .subscribe({
        start: (subscription) => {
          this.log.info("Started", subscription)
        },
        next: (value) => {
          const message = value.data.searchTransactionsForward
          const { undo, trace, irreversibleBlockNum } = message
          const { matchingActions, block } = trace

          // todo figure out how to handle this
          if (undo) {
            console.log("undo", undo)
          }

          const isFirstProcessed = currentBlockNumber === -1
          const isNewBlock = block.num !== currentBlockNumber

          /*
           * When we are seeing a new block, we need to update our head reference
           * Math.max is used in case an "undo" trx is returned, with a lower block
           * number than our head reference.
           */
          if (isNewBlock) {
            this.headBlockNumber = Math.max(this.headBlockNumber, currentBlockNumber)
          }

          /*
           * When we see a transaction belonging to a different block than
           * the previous one, we pushed the previous block into the queue
           */
          if (!isFirstProcessed && isNewBlock) {
            this.blockQueue.push(currentBlock)
          }

          /*
           * Update the reference to the last irreversible block number,
           * making sure we are not receiving an outdated reference in the case of an undo
           ? is this possible?
           */
          this.lastIrreversibleBlockNumber = Math.max(
            this.lastIrreversibleBlockNumber,
            irreversibleBlockNum
          )

          // Create a new block object
          if (isNewBlock) {
            currentBlockNumber = message.trace.block.num
            currentBlock = {
              actions: [],
              blockInfo: {
                blockNumber: block.num,
                blockHash: block.id,
                previousBlockHash: block.previous,
                timestamp: block.timestamp
              }
            }
          }

          // Insert matching actions into the right block
          matchingActions.forEach((action: any) => {
            currentBlock.actions.push({
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

          this.activeCursor = message.cursor
        },
        error: (error) => {
          // TODO: how to handle subscription errors? Invalid queries?
          this.log.error("Error", error)
        },
        complete: () => {
          // TODO: how to handle completion? Will we ever reach completion?
          this.log.info("Completed")
        }
      })
  }

  protected async setup(): Promise<void> {}

  public async getBlock(blockNumber: number): Promise<Block> {
    // Patch around the issues caused by Dfuse not returning anything for blocks 1 and 2
    if (blockNumber === 1) {
      return block1
    }
    if (blockNumber === 2) {
      return block2
    }

    // If the queue is empty, wait for apollo to return new results.
    await waitUntil(() => this.blockQueue.length > 0)

    const queuedBlock = this.blockQueue[0]
    const queuedBlockNumber = queuedBlock.blockInfo.blockNumber

    if (queuedBlockNumber > blockNumber) {
      // If the first block in the queue is higher than the block we are asking, return a generic block
      this.log.info(`Returning default block for num ${blockNumber}`)
      return defaultBlock
    } else if (queuedBlockNumber === blockNumber) {
      // If the first block in the queue is the one that was requested, return it and remove it from the queue
      this.blockQueue.shift()

      // Hack to make the block's previousHash property match the previous block,
      // if the previous block wasnt returned by dfuse and we had to return a default block
      // todo is there a better solution than this?
      if (this.currentBlockData.blockInfo.blockHash === "") {
        queuedBlock.blockInfo.previousBlockHash = ""
      }
      return queuedBlock
    } else {
      // todo clean this up. this should be handled more gracefully.
      const queuedBlockNumbers = this.blockQueue.map((x) => x.blockInfo.blockNumber)
      throw new Error(
        `Could not find block number ${blockNumber} in queue containing blocks ${queuedBlockNumbers}`
      )
    }
  }

  public async getHeadBlockNumber(): Promise<number> {
    await waitUntil(() => this.headBlockNumber !== 0)
    return this.headBlockNumber
  }

  public async getLastIrreversibleBlockNumber(): Promise<number> {
    await waitUntil(() => this.lastIrreversibleBlockNumber !== 0)
    return this.lastIrreversibleBlockNumber
  }

  // todo do we need to resolve forks, or is dfuse handling all of this for us?
  protected async resolveFork() {}
}
