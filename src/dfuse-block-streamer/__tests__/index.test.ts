import { DfuseBlockStreamer, DfuseBlockStreamerOptions } from ".."
import { Transaction } from "../../types"

type getTransactionParams = Partial<{
  blockNumber: number
  blockHash: string
  undo: boolean
}>

function getTransactionStub(params: getTransactionParams, isLiveMarker: boolean): Transaction {
  const { blockNumber, undo, blockHash } = Object.assign(
    {
      blockNumber: 3,
      undo: false,
      blockHash: `hash${params.blockNumber || 3}`
    },
    params
  )

  const trace = isLiveMarker
    ? null
    : {
        id: "sometraceid",
        matchingActions: [],
        block: {
          num: blockNumber,
          id: blockHash,
          previous: `hash${blockNumber - 1}`,
          timestamp: new Date()
        }
      }

  return {
    undo,
    irreversibleBlockNum: 5,
    cursor: "somecursorstring",
    trace
  }
}

function sendTransaction(
  blockStreamer: DfuseBlockStreamer,
  transactionParams: getTransactionParams,
  isLiveMarker: boolean = false
) {
  return (blockStreamer as any).onTransactionReceived(
    getTransactionStub(transactionParams, isLiveMarker)
  )
}

function getBlockStreamerMock(options?: Partial<DfuseBlockStreamerOptions>): DfuseBlockStreamer {
  const blockStreamer = new DfuseBlockStreamer(
    Object.assign(
      {
        dfuseApiKey: "web_0123456789acdef",
        onlyIrreversible: false,
        lowBlockNum: 3
      },
      options
    )
  )

  // Mock the stream method to prevent the apollo client from instantiating
  jest.spyOn(blockStreamer, "stream").mockImplementation(() => null)

  return blockStreamer
}

describe("DfuseBlockStreamer", () => {
  let blockStreamer: DfuseBlockStreamer

  beforeEach(() => {
    blockStreamer = getBlockStreamerMock()
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

  test("should return a block with the property isEarliestBlock set to true for the first block, even if the first transaction skipped blocks", () => {
    const stub = jest.fn()
    blockStreamer.addOnBlockListener(stub)
    sendTransaction(blockStreamer, {
      blockNumber: 4
    })

    sendTransaction(blockStreamer, {
      blockNumber: 5
    })

    sendTransaction(blockStreamer, {
      blockNumber: 6
    })

    expect(stub.mock.calls[0][0].blockMeta.isEarliestBlock).toEqual(true)
    expect(stub.mock.calls[1][0].blockMeta.isEarliestBlock).toEqual(false)
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

  describe("#isLiveMarkerReached()", () => {
    test("should return false when the marker has not been reached", () => {
      blockStreamer = getBlockStreamerMock({
        lowBlockNum: -3
      })

      const stub = jest.fn()
      blockStreamer.addOnBlockListener(stub)

      sendTransaction(blockStreamer, {
        blockNumber: 500
      })
      sendTransaction(blockStreamer, {
        blockNumber: 501
      })
      sendTransaction(blockStreamer, {
        blockNumber: 500
      })

      expect(blockStreamer.isLiveMarkerReached()).toEqual(false)
    })

    test("should return true when the marker has been reached", () => {
      blockStreamer = getBlockStreamerMock({
        lowBlockNum: -3
      })

      const stub = jest.fn()
      blockStreamer.addOnBlockListener(stub)

      sendTransaction(blockStreamer, {
        blockNumber: 500
      })
      sendTransaction(blockStreamer, {
        blockNumber: 501
      })
      sendTransaction(
        blockStreamer,
        {
          blockNumber: 500
        },
        true
      )

      expect(blockStreamer.isLiveMarkerReached()).toEqual(true)
    })
  })
})
