import { Block } from "demux"
import { getApolloClient } from "../util"
import ApolloClient from "apollo-client/ApolloClient"
import { gql } from "apollo-boost"

export type DfuseBlockStreamerOptions = {
  dfuseApiKey: string
  network?: string
  lowBlockNum?: number
}

export type Transaction = {
  undo: boolean
  irreversibleBlockNum: number
  cursor: string
  trace: {
    id: string
    matchingActions: {
      account: string
      name: string
      data: {}
      authorization: {
        actor: string
        permission: string
      }[]
    }[]
    block: {
      num: number
      id: string
      previous: string
      timestamp: Date
    }
  }
}

type OnBlockListener = (block: Block, lastIrreversibleBlockNumber: number) => void

export class DfuseBlockStreamer {
  protected dfuseApiKey: string
  protected network: string
  protected apolloClient?: ApolloClient<any>
  protected listeners: OnBlockListener[] = []
  protected activeCursor: string = ""
  protected lowBlockNum: number
  protected currentBlockNumber: number = -1
  protected currentBlock?: Block

  constructor(options: DfuseBlockStreamerOptions) {
    const { lowBlockNum } = options

    this.dfuseApiKey = options.dfuseApiKey
    this.network = options.network || "mainnet"
    this.lowBlockNum = typeof lowBlockNum !== "undefined" ? lowBlockNum : 1
  }

  private getApolloClient() {
    return getApolloClient(this.dfuseApiKey, this.network)
  }

  /**
   * Starts streams from the dfuse graphql API, calling all
   * registered listeners every time a new block is completed
   */
  public stream() {
    if (!this.apolloClient) {
      this.apolloClient = this.getApolloClient()
    }

    const subscription = this.getObservableSubscription({
      apolloClient: this.apolloClient!,
      lowBlockNum: this.lowBlockNum
    })

    subscription.subscribe({
      start: (subscription) => {
        console.log("Started", subscription)
      },
      next: (value) => {
        this.onTransactionReceived(value.data.searchTransactionsForward)
      },
      error: (error) => {
        // TODO: how to handle subscription errors? Invalid queries?
        console.log("Error", error)
      },
      complete: () => {
        // TODO: how to handle completion? Will we ever reach completion?
        console.log("Completed")
      }
    })
  }

  private onTransactionReceived(transaction: Transaction) {
    const { undo, trace, irreversibleBlockNum } = transaction
    const { matchingActions, block } = trace

    // todo figure out how to handle undos
    if (undo) {
      console.log("undo", undo)
    }

    const isFirstProcessed = this.currentBlockNumber === -1
    const isNewBlock = block.num !== this.currentBlockNumber

    /*
     * When we see a transaction belonging to a different block than
     * the previous one, we pushed the previous block into the queue
     */
    if (!isFirstProcessed && isNewBlock) {
      this.notifyListeners(this.currentBlock!, irreversibleBlockNum)
    }

    // Create a new block object
    if (isNewBlock) {
      this.currentBlockNumber = transaction.trace.block.num
      this.currentBlock = {
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
      this.currentBlock!.actions.push({
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
