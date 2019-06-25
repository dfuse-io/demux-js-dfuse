/*
 * To tie everything together, we must instantiate our Action Handler and Action Reader, and instantiate an Action
 * Watcher with both of those.
 */

import { BaseActionWatcher } from "demux"
import { DfuseActionReader } from "../src/"
import dotenv from "dotenv"

dotenv.config()

if (process.env.DFUSE_API_KEY == null) {
  console.log("Missing DFUSE_API_KEY environment variable")
  process.exit(1)
}

const ObjectActionHandler = require("./ObjectActionHandler")
const handlerVersion = require("./handlerVersions/v1")

/*
 * This ObjectActionHandler, which does not change the signature from its parent AbstractActionHandler, takes an array
 * of `HandlerVersion` objects
 */
const actionHandler = new ObjectActionHandler([handlerVersion])

/*
 * Since we're reading data from dfuse.io, we can use the DfuseActionReader
 * supplied by the demux-dfuse package. This utilizes the dfuse.io endpoint as a source of block data.
 *
 * The second argument defines at what block this should start at. For values less than 1, this switches to a "tail"
 * mode, where we start at an offset of the most recent blocks.
 */
const actionReader = new DfuseActionReader({
  startAtBlock: 65414000,
  onlyIrreversible: false,
  dfuseApiKey: process.env.DFUSE_API_KEY as string,
  network: "mainnet"
})

/* BaseActionWatcher
 * This ready-to-use base class helps coordinate the Action Reader and Action Handler, passing through block information
 * from the Reader to the Handler. The third argument is the polling loop interval in milliseconds. Since EOS has 0.5s
 * block times, we set this to half that for an average of 125ms latency.
 *
 * All that is left to run everything is to call `watch()`.
 */
const actionWatcher = new BaseActionWatcher(actionReader, actionHandler, 250)

actionWatcher.watch()

console.log("Watching...")
