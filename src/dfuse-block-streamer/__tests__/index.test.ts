import { DfuseBlockStreamer } from ".."
import { Transaction } from "../.."
import { getPreviousBlockHash, getBlockHash } from "../../util"

type getTransactionParams = Partial<{
  blockNumber: number
  blockHash: string
  undo: boolean
}>

function getTransactionStub(params: getTransactionParams): Transaction {
  const { blockNumber, undo, blockHash } = Object.assign(
    {
      blockNumber: 3,
      undo: false,
      blockHash: `hash${params.blockNumber || 3}`
    },
    params
  )

  return {
    undo,
    irreversibleBlockNum: 5,
    cursor: "somecursorstring",
    trace: {
      id: "sometraceid",
      matchingActions: [],
      block: {
        num: blockNumber,
        id: blockHash,
        previous: `hash${blockNumber - 1}`,
        timestamp: new Date()
      }
    }
  }
}

function sendTransaction(
  blockStreamer: DfuseBlockStreamer,
  transactionParams: getTransactionParams
) {
  return (blockStreamer as any).onTransactionReceived(getTransactionStub(transactionParams))
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
    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    expect(stub).toHaveBeenCalledTimes(0)

    // Send transactions for block #4
    sendTransaction(blockStreamer, {
      blockNumber: 4
    })

    expect(stub).toHaveBeenCalledTimes(1)
  })

  test("should not notify removed listeners", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    blockStreamer.removeOnBlockListener(stub)

    // Send a full block
    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    sendTransaction(blockStreamer, {
      blockNumber: 4
    })

    expect(stub).toHaveBeenCalledTimes(0)
  })

  test("should allow multiple listeners to be registered and notified", () => {
    const stub1 = jest.fn()
    const stub2 = jest.fn()
    blockStreamer.addOnBlockListener(stub1)
    blockStreamer.addOnBlockListener(stub2)

    // Send a full block
    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    sendTransaction(blockStreamer, {
      blockNumber: 4
    })

    expect(stub1).toHaveBeenCalledTimes(1)
    expect(stub2).toHaveBeenCalledTimes(1)
  })

  test("should allow multiple listeners to be registered and notified", () => {
    const stub1 = jest.fn()
    const stub2 = jest.fn()
    blockStreamer.addOnBlockListener(stub1)
    blockStreamer.addOnBlockListener(stub2)

    // Send a full block
    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    sendTransaction(blockStreamer, {
      blockNumber: 4
    })

    expect(stub1).toHaveBeenCalledTimes(1)
    expect(stub2).toHaveBeenCalledTimes(1)
  })

  test("should return a block with the property isEarliestBlock set to true for the first block", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    sendTransaction(blockStreamer, {
      blockNumber: 4
    })

    expect(stub.mock.calls[0][0].blockMeta.isEarliestBlock).toEqual(true)
  })

  test("should return a block with the property isEarliestBlock set to true for the first block, even if it is higher than lowBlockNum", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    sendTransaction(blockStreamer, {
      blockNumber: 5
    })
    sendTransaction(blockStreamer, {
      blockNumber: 6
    })

    expect(stub.mock.calls[0][0].blockMeta.isEarliestBlock).toEqual(true)
  })

  test("should return a block with the property isEarliestBlock set to true for the other blocks", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    sendTransaction(blockStreamer, {
      blockNumber: 3
    })
    sendTransaction(blockStreamer, {
      blockNumber: 4
    })
    sendTransaction(blockStreamer, {
      blockNumber: 5
    })

    expect(stub.mock.calls[1][0].blockMeta.isEarliestBlock).toEqual(false)
  })

  test("should return a block with isRollback: false is the received transactions have undo: false", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    sendTransaction(blockStreamer, {
      blockNumber: 4
    })

    expect(stub.mock.calls[0][0].blockMeta.isRollback).toEqual(false)
  })

  test("should return a block with isRollback: true is the received transactions have undo: true", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    sendTransaction(blockStreamer, {
      blockNumber: 3,
      undo: true
    })
    sendTransaction(blockStreamer, {
      blockNumber: 4
    })

    expect(stub.mock.calls[1][0].blockMeta.isRollback).toEqual(true)
  })

  test("should notify subscribers without skipping a block, even if the returned transaction skip blocks", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    sendTransaction(blockStreamer, {
      blockNumber: 3
    })

    sendTransaction(blockStreamer, {
      blockNumber: 6
    })

    sendTransaction(blockStreamer, {
      blockNumber: 7
    })

    expect(stub.mock.calls.length).toEqual(4)
  })

  test("should keep the previousBlockHash property consistent when generating dummy blocks", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    sendTransaction(blockStreamer, {
      blockNumber: 3,
      blockHash: "blockhash3"
    })

    sendTransaction(blockStreamer, {
      blockNumber: 6,
      blockHash: "blockhash6"
    })

    sendTransaction(blockStreamer, {
      blockNumber: 7,
      blockHash: "blockhash7"
    })

    sendTransaction(blockStreamer, {
      blockNumber: 8,
      blockHash: "blockhash8"
    })

    const { calls } = stub.mock

    expect(getPreviousBlockHash(calls[1][0])).toEqual(getBlockHash(calls[0][0]))
    expect(getPreviousBlockHash(calls[2][0])).toEqual(getBlockHash(calls[1][0]))
    expect(getPreviousBlockHash(calls[3][0])).toEqual(getBlockHash(calls[2][0]))
  })
})
