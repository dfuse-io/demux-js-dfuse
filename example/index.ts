/*
 * To tie everything together, we must instantiate our Action Handler and Action Reader, and instantiate an Action
 * Watcher with both of those.
 */

import { DfuseActionReader } from "../src"
import dotenv from "dotenv"
import { BaseActionWatcher } from "demux"

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
const dfuseActionReader = new DfuseActionReader({
  startAtBlock: 65582500, // default is 1, which means start at genesis block
  onlyIrreversible: false,
  dfuseApiKey: process.env.DFUSE_API_KEY as string,
  network: "mainnet"
})

const actionWatcher = new BaseActionWatcher(dfuseActionReader, actionHandler, 125)

actionWatcher.watch()

console.log("Watching...")
