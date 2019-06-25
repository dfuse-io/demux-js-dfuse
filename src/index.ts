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

type DfuseActionReaderOptions = ActionReaderOptions & {
  dfuseApiKey: string
  network?: string
}

export class DfuseActionReader extends AbstractActionReader {
  protected network: string
  protected dfuseApiKey: string
  protected dfuseClient?: DfuseClient
  protected apolloClient?: ApolloClient<any>
  protected headInfoInitialized: boolean = false

  constructor(options: DfuseActionReaderOptions) {
    super(options)
    this.dfuseApiKey = options.dfuseApiKey
    this.network = options.network || "mainnet"

    /*
     * todo: This forcibly configures the client to run on node.
     * What if the user wants to run on browser? Maybe allow to
     * pass in a dfuse client instance in the constructor?
     */
    this.dfuseClient = createDfuseClient({
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

    this.apolloClient = new ApolloClient({
      cache: new InMemoryCache(),
      link: new WebSocketLink({
        uri: this.dfuseClient.endpoints.graphqlStreamUrl,
        options: {
          reconnect: true,
          connectionParams: async () => {
            const apiToken = await this.dfuseClient!.getTokenInfo()

            return {
              Authorization: `Bearer ${apiToken.token}`
            }
          }
        },
        webSocketImpl: WebSocketConnection
      })
    })

    this.apolloClient
      .subscribe({
        query: gql`
          subscription {
            searchTransactionsForward(query: "status:executed") {
              trace {
                matchingActions {
                  receiver
                  account
                  name
                  json
                }
              }
            }
          }
        `
      })
      .subscribe({
        start: (subscription) => {
          console.log("Started", subscription)
        },
        next: (value) => {
          const trace = value.data.searchTransactionsForward.trace
          trace.matchingActions.forEach((action: any) => {
            console.log(`Action ${action.receiver}/${action.account}:${action.name}`)
          })
        },
        error: (error) => {
          console.log("Error", error)
        },
        complete: () => {
          console.log("Completed")
        }
      })

    this.streamHeadInfo((params) => {
      this.headBlockNumber = params.head_block_num
      this.lastIrreversibleBlockNumber = params.last_irreversible_block_num
    })
  }

  protected async streamHeadInfo(onInfo: (headInfo: HeadInfoData) => void): Promise<void> {
    // todo Should the stream be closed, ever?
    await this.dfuseClient!.streamHeadInfo(async (message: InboundMessage) => {
      if (message.type === InboundMessageType.HEAD_INFO) {
        onInfo(message.data)
      }
    })

    return
  }

  protected async setup(): Promise<void> {}

  public async getBlock(blockNumber: number): Promise<Block> {
    console.log("blockNumber", blockNumber)
    console.log("head", this.headBlockNumber)
    console.log("last", this.lastIrreversibleBlockNumber)
    console.log("-=====")

    // const block = result.data.searchTransactionsBackward.results[0].trace.block

    // return {
    //   actions: [
    //     /*{
    //     type: 'eosio.token::transfer',
    //     payload:
    //     {
    //       transactionId:
    //         'ce05d4536ee324f4aa8f76c28a1e1ed9de3055519fe2eef542963830d4b26f9b',
    //       actionIndex: 0,
    //       account: 'eosio.token',
    //       name: 'transfer',
    //       authorization: [{ actor: 'sunshine1212', permission: 'owner' }],
    //       data:
    //       {
    //         from: 'sunshine1212',
    //         to: 'eosmaxiodice',
    //         quantity: '0.1000 EOS',
    //         memo: '1-50-cpuemergency-'
    //       }
    //     }
    //   }*/
    //   ],
    //   blockInfo: {}
    // }

    return {} as Block
  }

  public async getHeadBlockNumber(): Promise<number> {
    await waitUntil(() => this.headBlockNumber > 0)

    return this.headBlockNumber
  }

  public async getLastIrreversibleBlockNumber(): Promise<number> {
    await waitUntil(() => this.headBlockNumber > 0)

    return this.lastIrreversibleBlockNumber
  }
}

async function waitUntil(condition: () => boolean, timeout: number = 125) {
  while (condition() === false) {
    await waitFor(timeout)
  }
}
