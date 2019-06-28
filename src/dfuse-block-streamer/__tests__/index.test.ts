import { DfuseBlockStreamer, Transaction } from ".."
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

function getTransactionStub(blockNumber: number = 3): Transaction {
  return {
    undo: false,
    irreversibleBlockNum: 5,
    cursor: "somecursorstring",
    trace: {
      id: "sometraceid",
      matchingActions: [],
      block: {
        num: blockNumber,
        id: "someblockhash",
        previous: "someprevioushash",
        timestamp: new Date()
      }
    }
  }
}

describe("DfuseBlockStreamer", () => {
  let blockStreamer: DfuseBlockStreamer

  beforeEach(() => {
    blockStreamer = new DfuseBlockStreamer({ dfuseApiKey: "web_0123456789acdef" })

    // Mock the stream method to prevent the apollo client from instantiating
    jest.spyOn(blockStreamer, "stream").mockImplementation(() => null)
  })

  test("should not notify registered listeners until a new block is completely received", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)

    // Send transactions for block #3
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3))

    expect(stub).toHaveBeenCalledTimes(0)

    // Send transactions for block #4
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(4))

    expect(stub).toHaveBeenCalledTimes(1)
  })

  test("should not notify removed listeners", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    blockStreamer.removeOnBlockListener(stub)

    // Send a full block
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(4))

    expect(stub).toHaveBeenCalledTimes(0)
  })

  test("should allow multiple listeners to be registered and notified", () => {
    const stub1 = jest.fn()
    const stub2 = jest.fn()
    blockStreamer.addOnBlockListener(stub1)
    blockStreamer.addOnBlockListener(stub2)

    // Send a full block
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(4))

    expect(stub1).toHaveBeenCalledTimes(1)
    expect(stub2).toHaveBeenCalledTimes(1)
  })
})
