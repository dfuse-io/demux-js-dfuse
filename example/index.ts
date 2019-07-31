/*
 * To tie everything together, we must instantiate our Action Handler and Action Reader, and instantiate an Action
 * Watcher with both of those.
 */

import dotenv from "dotenv"
import { BaseActionWatcher } from "demux"
import { DfuseActionReader } from "../src"
dotenv.config()

if (process.env.DFUSE_API_KEY == null) {
  console.log(
    "Missing DFUSE_API_KEY environment variable. Visit https://www.dfuse.io to create your API key."
  )
  process.exit(1)
}

/*
 * Using requires because there are no type definitions for
 * these js files copied over from the demux-js examples.
 * import statements will required types
 */
/* tslint:disable:no-var-requires */
const ObjectActionHandler = require("./ObjectActionHandler")
const handlerVersion = require("./handlerVersions/v1")
/* tslint:enable:no-var-requires */

/*
 * This ObjectActionHandler, which does not change the signature from its parent AbstractActionHandler, takes an array
 * of `HandlerVersion` objects
 */
const actionHandler = new ObjectActionHandler([handlerVersion], { validateBlockHashes: false })

/*
 * Since we're reading data from dfuse.io, we can use the DfuseActionReader
 * supplied by the demux-dfuse package. This utilizes the dfuse.io endpoint as a source of block data.
 *
 * The second argument defines at what block this should start at. For values less than 1, this switches to a "tail"
 * mode, where we start at an offset of the most recent blocks.
 */
const dfuseActionReader = new DfuseActionReader({
  startAtBlock: -1000,
  onlyIrreversible: false,
  dfuseApiKey: process.env.DFUSE_API_KEY as string,
  query: "account:eosknightsio",
  network: "mainnet"
})

const actionWatcher = new BaseActionWatcher(dfuseActionReader, actionHandler, {
  logLevel: "error"
})

actionWatcher.watch(true)

console.log("Watching...")
