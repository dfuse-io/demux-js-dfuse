import { AbstractActionReader, ActionReaderOptions, Block } from "demux"
import {
  createDfuseClient,
  DfuseClient,
  waitFor,
  InboundMessage,
  InboundMessageType,
  HeadInfoData
} from "@dfuse/client"
import { IncomingMessage } from "http"
import ApolloClient from "apollo-client/ApolloClient"
import { gql, InMemoryCache } from "apollo-boost"
import fetch from "node-fetch"
import WebSocketConnection from "ws"
import { WebSocketLink } from "apollo-link-ws"
import { SubscriptionClient } from "subscriptions-transport-ws"

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

    /*
     * todo: This forcibly configures the client to run on node.
     * What if the user wants to run on browser? Maybe allow to
     * pass in a dfuse client instance in the constructor?
     */
    const dfuseClient = createDfuseClient({
      apiKey: this.dfuseApiKey,
      network: this.network,
      httpClientOptions: {
        fetch
      },
      streamClientOptions: {
        socketOptions: {
          webSocketFactory: async (url: string) => {
            const webSocket = new WebSocketConnection(url, {
              handshakeTimeout: 30 * 1000, // 30s
              maxPayload: 200 * 1024 * 1000 * 1000 // 200Mb
            })

            const onUpgrade = (response: IncomingMessage) => {
              webSocket.removeListener("upgrade", onUpgrade)
            }

            webSocket.on("upgrade", onUpgrade)

            return webSocket
          }
        }
      }
    })

    const subscriptionClient = new SubscriptionClient(
      dfuseClient.endpoints.graphqlStreamUrl,
      {
        reconnect: true,
        connectionCallback: (error?: any) => {
          if (error) {
            console.log("Unable to correctly initialize connection", error)
            process.exit(1)
          }
        },
        connectionParams: async () => {
          const { token } = await dfuseClient.getTokenInfo()

          return {
            Authorization: `Bearer ${token}`
          }
        }
      },
      WebSocketConnection
    )

    subscriptionClient.onConnecting(() => {
      console.log("Connecting")
    })
    subscriptionClient.onConnected(() => {
      console.log("Connected")
    })
    subscriptionClient.onReconnecting(() => {
      console.log("Reconnecting")
    })
    subscriptionClient.onReconnected(() => {
      console.log("Reconnected")
    })
    subscriptionClient.onDisconnected(() => {
      console.log("Disconnected")
    })
    subscriptionClient.onError((error) => {
      console.log("Error", error)
    })

    this.apolloClient = new ApolloClient({
      cache: new InMemoryCache(),
      link: new WebSocketLink(subscriptionClient)
    })

    // this.streamHeadInfo((params) => {
    //   this.headBlockNumber = params.head_block_num
    //   this.lastIrreversibleBlockNumber = params.last_irreversible_block_num
    // })

    this.streamTransactions()
  }

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
          console.log("Started", subscription)
        },
        next: (value) => {
          const message = value.data.searchTransactionsForward
          const { trace, irreversibleBlockNum } = message
          const { matchingActions, block } = trace

          const isFirstProcessed = currentBlockNumber === -1
          const isNewBlock = block.num !== currentBlockNumber

          if (isNewBlock) {
            this.headBlockNumber = Math.max(this.headBlockNumber, currentBlockNumber)
          }

          if (!isFirstProcessed && isNewBlock) {
            // console.log(`Finished processing block #${currentBlockNumber}, starting #${block.num}`)
            this.blockQueue.push(currentBlock)
          }

          this.lastIrreversibleBlockNumber = Math.max(
            this.lastIrreversibleBlockNumber,
            irreversibleBlockNum
          )

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
          console.log("Error", error)
        },
        complete: () => {
          console.log("Completed")
        }
      })
  }

  // protected async streamHeadInfo(onInfo: (headInfo: HeadInfoData) => void): Promise<void> {
  //   // todo Should the stream be closed, ever?
  //   await this.dfuseClient!.streamHeadInfo(async (message: InboundMessage) => {
  //     if (message.type === InboundMessageType.HEAD_INFO) {
  //       onInfo(message.data)
  //     }
  //   })

  //   return
  // }

  protected async setup(): Promise<void> {}

  public async getBlock(blockNumber: number): Promise<Block> {
    await waitUntil(() => this.blockQueue.length > 0)
    // console.log("getBlock", blockNumber, this.headBlockNumber, this.lastIrreversibleBlockNumber)
    // console.log("in queue", this.blockQueue.map((x) => x.blockInfo.blockNumber))
    const queuedBlock = this.blockQueue[0]
    const queuedBlockNumber = queuedBlock.blockInfo.blockNumber

    if (blockNumber === 1) {
      return block1
    }
    if (blockNumber === 2) {
      return block2
    }

    if (queuedBlockNumber > blockNumber) {
      console.log(`Returning default block for num ${blockNumber}`)
      return defaultBlock
    } else if (queuedBlockNumber === blockNumber) {
      this.blockQueue.shift()
      return queuedBlock
    } else {
      throw new Error(
        `Could not find block number ${blockNumber} in queue containing blocks ${this.blockQueue.map(
          (x) => x.blockInfo.blockNumber
        )}`
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

  // With dfuse, you don't need to resolve forks
  protected async resolveFork() {}
}

async function waitUntil(condition: () => boolean, timeout: number = 125) {
  while (condition() === false) {
    await waitFor(timeout)
  }
}
