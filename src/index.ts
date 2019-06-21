import { AbstractActionReader, ActionReaderOptions, Block } from "demux"
import { createDfuseClient, DfuseClient } from "@dfuse/client"
import { IncomingMessage } from "http"
import fetch from "node-fetch"
import WebSocketClient from "ws"

type DfuseActionReaderOptions = ActionReaderOptions & {
  dfuseApiKey: string
  network?: string
}

export class DfuseActionReader extends AbstractActionReader {
  protected network: string
  protected dfuseApiKey: string
  protected dfuseClient?: DfuseClient

  constructor(options: DfuseActionReaderOptions) {
    super(options)
    this.dfuseApiKey = options.dfuseApiKey
    this.network = options.network || "mainnet"
  }

  protected async setup(): Promise<void> {
    if (this.initialized) {
      return
    }

    /*
     * todo: This forcibly configures the client to run on node.
     * What if the user wants to run on browser? Maybe allow to
     * pass in a dfuse client instance in the constructor?
     */
    this.dfuseClient = createDfuseClient({
      apiKey: this.dfuseApiKey,
      network: "mainnet",
      httpClientOptions: {
        fetch
      },
      streamClientOptions: {
        socketOptions: {
          webSocketFactory: async (url: string) => {
            const webSocket = new WebSocketClient(url, {
              handshakeTimeout: 30 * 1000, // 30s
              maxPayload: 200 * 1024 * 1000 * 1000 // 200Mb
            })

            const onUpgrade = (response: IncomingMessage) => {
              // console.log("Socket upgrade response status code.", response.statusCode)
              // You need to remove the listener at some point since this factory
              // is called at each re-connection with the remote endpoint!
              webSocket.removeListener("upgrade", onUpgrade)
            }

            webSocket.on("upgrade", onUpgrade)

            return webSocket
          }
        }
      }
    })
  }

  protected getDfuseClient(): DfuseClient {
    if (!this.dfuseClient) {
      const callerName = arguments.callee.caller.name
      throw new Error(
        `Attempted to call ${callerName} without an initialized dfuse client instance`
      )
    }

    return this.dfuseClient
  }

  public async getBlock(): Promise<Block> {
    console.log("getBlock")
    return {} as Block
  }

  public async getHeadBlockNumber(): Promise<number> {
    console.log("getHeadBlockNumber")
    this.getDfuseClient().streamHeadInfo(
      (message) => {
        console.log("on message", message)
      },
      {
        listen: false
      }
    )

    return 0
  }

  public async getLastIrreversibleBlockNumber(): Promise<number> {
    console.log("getLastIrreversibleBlockNumber")
    return 0
  }
}
