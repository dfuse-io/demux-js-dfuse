import { Block } from "demux"

function getBlockStub(blockNumber: number = 1): Block {
  return {
    actions: [],
    blockInfo: {
      blockNumber,
      blockHash: "acbdefg12346576",
      timestamp: new Date(),
      previousBlockHash: "xyz999"
    }
  }
}

describe("DfuseActionReader", () => {
  return
})
