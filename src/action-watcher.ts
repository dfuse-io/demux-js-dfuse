// import {
//   createDfuseClient,
//   DfuseClient,
//   waitFor,
//   InboundMessage,
//   InboundMessageType,
//   HeadInfoData
// } from "@dfuse/client"
// import { BaseActionWatcher } from "demux"
// import { IncomingMessage } from "http"
// import ApolloClient from "apollo-client/ApolloClient"
// import { gql, InMemoryCache } from "apollo-boost"
// import fetch from "node-fetch"
// import WebSocketConnection from "ws"
// import { WebSocketLink } from "apollo-link-ws"
// import { SubscriptionClient } from "subscriptions-transport-ws"

// type DfuseActionReaderOptions = {
//   startAtBlock: number
//   dfuseApiKey: string
//   onlyIrreversible?: boolean
//   network?: string
// }

// export class DemuxDfuse extends BaseActionWatcher {
//          protected network: string
//          protected dfuseApiKey: string
//          protected startAtBlock: number
//          protected onlyIrreversible: boolean = false
//          protected dfuseClient: DfuseClient
//          protected apolloClient: ApolloClient<any>
//          protected headInfoInitialized: boolean = false
//          protected activeCursor: string = ""

//          constructor(actionReader, actionHandler, options: DfuseActionReaderOptions) {
//            super(actionReader, actionHandler, null)

//            this.dfuseApiKey = options.dfuseApiKey
//            this.network = options.network || "mainnet"
//            this.startAtBlock = options.startAtBlock

//            if (typeof options.onlyIrreversible !== "undefined") {
//              this.onlyIrreversible = options.onlyIrreversible
//            }

//            /*
//             * todo: This forcibly configures the client to run on node.
//             * What if the user wants to run on browser? Maybe allow to
//             * pass in a dfuse client instance in the constructor?
//             */
//            this.dfuseClient = createDfuseClient({
//              apiKey: this.dfuseApiKey,
//              network: this.network,
//              httpClientOptions: {
//                fetch
//              }
//            })

//            const subscriptionClient = new SubscriptionClient(
//              this.dfuseClient.endpoints.graphqlStreamUrl,
//              {
//                reconnect: true,
//                connectionCallback: (error?: any) => {
//                  if (error) {
//                    console.log("Unable to correctly initialize connection", error)
//                    process.exit(1)
//                  }
//                },
//                connectionParams: async () => {
//                  const { token } = await this.dfuseClient.getTokenInfo()

//                  return {
//                    Authorization: `Bearer ${token}`
//                  }
//                }
//              },
//              WebSocketConnection
//            )

//            subscriptionClient.onConnecting(() => {
//              console.log("Connecting")
//            })
//            subscriptionClient.onConnected(() => {
//              console.log("Connected")
//            })
//            subscriptionClient.onReconnecting(() => {
//              console.log("Reconnecting")
//            })
//            subscriptionClient.onReconnected(() => {
//              console.log("Reconnected")
//            })
//            subscriptionClient.onDisconnected(() => {
//              console.log("Disconnected")
//            })
//            subscriptionClient.onError((error) => {
//              console.log("Error", error)
//            })

//            this.apolloClient = new ApolloClient({
//              cache: new InMemoryCache(),
//              link: new WebSocketLink(subscriptionClient)
//            })
//          }

//          protected async checkForBlocks(isReplay: boolean = false) {
//            let headBlockNumber = 0

//            while (!headBlockNumber || this.actionReader.currentBlockNumber < headBlockNumber) {
//              if (this.shouldPause) {
//                this.processIntervals = []
//                return
//              }
//              const readStartTime = Date.now()
//              this.log.debug(`Processing block ${this.actionReader.currentBlockNumber + 1}...`)
//              const nextBlock = await this.actionReader.getNextBlock()
//              const readDuration = Date.now() - readStartTime
//              if (!nextBlock.blockMeta.isNewBlock) {
//                break
//              }

//              const handleStartTime = Date.now()
//              const nextBlockNumberNeeded = await this.actionHandler.handleBlock(nextBlock, isReplay)
//              const handleEndTime = Date.now()
//              const handleDuration = handleEndTime - handleStartTime
//              const processDuration = readDuration + handleDuration
//              const blockNumber = nextBlock.block.blockInfo.blockNumber
//              this.log.info(
//                `Processed block ${blockNumber} (${processDuration}ms; ${nextBlock.block.actions.length} actions)`
//              )
//              this.log.debug(
//                `Block ${blockNumber} read time: ${readDuration}ms; Handle time: ${handleDuration}ms`
//              )
//              this.addProcessInterval(readStartTime, handleEndTime)

//              if (nextBlockNumberNeeded) {
//                await this.actionReader.seekToBlock(nextBlockNumberNeeded)
//              }

//              headBlockNumber = this.actionReader.headBlockNumber
//          }
//        }
