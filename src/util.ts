import { waitFor } from "@dfuse/client"
import { NextBlock } from "demux"

/*
 * Loop on a condition, resolving the returned promise once the condition is met
 */
export async function waitUntil(condition: () => boolean, timeout: number = 125) {
  while (condition() === false) {
    await waitFor(timeout)
  }
}

export function getPreviousBlockHash(nextBlock: NextBlock): string {
  return nextBlock.block.blockInfo.previousBlockHash
}

export function getBlockHash(nextBlock: NextBlock): string {
  return nextBlock.block.blockInfo.blockHash
}

export function getBlockNumber(nextBlock: NextBlock): number {
  return nextBlock.block.blockInfo.blockNumber
}
