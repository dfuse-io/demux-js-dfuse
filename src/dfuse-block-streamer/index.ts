import { Block } from "demux"
import { getApolloClient } from "../util"
import ApolloClient from "apollo-client/ApolloClient"
import { gql } from "apollo-boost"

export type DfuseBlockStreamerOptions = {
  dfuseApiKey: string
  network?: string
  lowBlockNum?: number
}

type OnBlockListener = (block: Block, lastIrreversibleBlockNumber: number) => void

export class DfuseBlockStreamer {
  protected apolloClient: ApolloClient<any>
  protected listeners: OnBlockListener[] = []
  protected activeCursor: string = ""
  protected lowBlockNum: number

  constructor(options: DfuseBlockStreamerOptions) {
    const { dfuseApiKey, network, lowBlockNum } = options

    this.lowBlockNum = typeof lowBlockNum !== "undefined" ? lowBlockNum : 1
    this.apolloClient = getApolloClient(dfuseApiKey, network || "mainnet")
  }

  /**
   * Starts streams from the dfuse graphql API, calling all
   * registered listeners every time a new block is completed
   */
  public stream() {
    let currentBlockNumber: number = -1
    let currentBlock: Block

    const subscription = this.getObservableSubscription({
      apolloClient: this.apolloClient,
      lowBlockNum: this.lowBlockNum
    })

    subscription.subscribe({
      // start: (subscription) => {
      //   // this.log.info("Started", subscription)
      // },
      next: (value) => {
        const message = value.data.searchTransactionsForward
        const { undo, trace, irreversibleBlockNum } = message
        const { matchingActions, block } = trace

        // todo figure out how to handle undos
        if (undo) {
          console.log("undo", undo)
        }

        const isFirstProcessed = currentBlockNumber === -1
        const isNewBlock = block.num !== currentBlockNumber

        /*
         * When we see a transaction belonging to a different block than
         * the previous one, we pushed the previous block into the queue
         */
        if (!isFirstProcessed && isNewBlock) {
          this.notifyListeners(currentBlock, irreversibleBlockNum)
        }

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

        // TODO: This isn't currently doing anything
        this.activeCursor = message.cursor
      }
      // error: (error) => {
      //   // TODO: how to handle subscription errors? Invalid queries?
      //   // this.log.error("Error", error)
      // },
      // complete: () => {
      //   // TODO: how to handle completion? Will we ever reach completion?
      //   // this.log.info("Completed")
      // }
    })
  }

  /**
   * Creates an apollo observable query and returns it
   */
  private getObservableSubscription(options: {
    apolloClient: ApolloClient<any>
    lowBlockNum: number
  }) {
    const { apolloClient, lowBlockNum } = options

    // TODO pass SQE query from the action reader
    return apolloClient.subscribe({
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
  private notifyListeners(block: Block, lastIrreversibleBlockNumber: number): void {
    this.listeners.forEach((listener) => listener(block, lastIrreversibleBlockNumber))
  }
}
