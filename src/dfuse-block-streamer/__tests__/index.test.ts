import { DfuseBlockStreamer } from ".."
import { Transaction } from "../.."

function getTransactionStub(blockNumber: number = 3, undo: boolean = false): Transaction {
  return {
    undo,
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
  let blockStreamerSpy: jest.SpyInstance

  beforeEach(() => {
    blockStreamer = new DfuseBlockStreamer({
      dfuseApiKey: "web_0123456789acdef",
      onlyIrreversible: false,
      lowBlockNum: 3
    })

    // Mock the stream method to prevent the apollo client from instantiating
    blockStreamerSpy = jest.spyOn(blockStreamer, "stream").mockImplementation(() => null)
  })

  afterEach(() => {
    blockStreamerSpy.mockRestore()
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

  test("should return a block with the property isEarliestBlock set to true for the first block", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(4))

    expect(stub.mock.calls[0][0].blockMeta.isEarliestBlock).toEqual(true)
  })

  test("should return a block with the property isEarliestBlock set to true for the first block, even if it is higher than lowBlockNum", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(5))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(6))

    expect(stub.mock.calls[0][0].blockMeta.isEarliestBlock).toEqual(true)
  })

  test("should return a block with the property isEarliestBlock set to true for the other blocks", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(4))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(5))

    expect(stub.mock.calls[1][0].blockMeta.isEarliestBlock).toEqual(false)
  })

  test("should return a block with isRollback: false is the received transactions have undo: false", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(4))

    expect(stub.mock.calls[0][0].blockMeta.isRollback).toEqual(false)
  })

  test("should return a block with isRollback: true is the received transactions have undo: true", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(3, true))
    ;(blockStreamer as any).onTransactionReceived(getTransactionStub(4))

    expect(stub.mock.calls[1][0].blockMeta.isRollback).toEqual(true)
  })
})
