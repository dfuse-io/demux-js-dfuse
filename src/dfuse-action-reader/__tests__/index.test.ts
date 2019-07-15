import { DfuseActionReader } from ".."
import { DfuseBlockStreamer } from "../../dfuse-block-streamer"
import { BlockInfo, NextBlock, BlockMeta } from "demux"

jest.mock("../../dfuse-block-streamer")

const MockedDfuseBlockStreamer = DfuseBlockStreamer as jest.Mock<DfuseBlockStreamer>

function getNextBlockStub(
  params: {
    blockInfo?: Partial<BlockInfo>
    blockMeta?: Partial<BlockMeta>
    lastIrreversibleBlockNumber?: number
  } = {}
): NextBlock {
  const { blockInfo = {}, blockMeta = {}, lastIrreversibleBlockNumber = 0 } = params
  return {
    block: {
      actions: [],
      blockInfo: {
        blockNumber: 0,
        blockHash: "acbdefg12346576",
        timestamp: new Date(),
        previousBlockHash: "xyz999",
        ...blockInfo
      }
    },
    blockMeta: {
      isNewBlock: true,
      isRollback: false,
      isEarliestBlock: false,
      ...blockMeta
    },
    lastIrreversibleBlockNumber
  }
}

function sendNextBlock(actionReader: DfuseActionReader, nextBlock: NextBlock) {
  // TODO this code is brittle - it will fail if addOnBlockListener is called multiple times in a single test
  const onBlockCallback = MockedDfuseBlockStreamer.prototype.addOnBlockListener.mock.calls[0][0]

  onBlockCallback.call(actionReader, nextBlock)
}

describe("DfuseActionReader", () => {
  const apiKey = "web_0123456789acdef"

  beforeEach(() => {
    jest.resetAllMocks()
  })
  afterAll(() => {
    jest.restoreAllMocks()
  })

  test("should start streaming blocks as soon as it is instantiated", () => {
    /* tslint:disable-next-line:no-unused-expression */
    new DfuseActionReader({
      startAtBlock: 0,
      onlyIrreversible: false,
      dfuseApiKey: apiKey
    })

    expect(MockedDfuseBlockStreamer).toHaveBeenCalledTimes(1)
    expect(MockedDfuseBlockStreamer.prototype.stream).toHaveBeenCalledTimes(1)
  })

  test("should initialize a DfuseBlockStreamer with the right parameters", () => {
    const startAtBlock = 0
    const network = "junglenet"
    const query = "status:executed account:pornhashbaby"
    const onlyIrreversible = false

    /* tslint:disable-next-line:no-unused-expression */
    new DfuseActionReader({
      startAtBlock,
      network,
      onlyIrreversible,
      dfuseApiKey: apiKey,
      query
    })

    expect(MockedDfuseBlockStreamer).toHaveBeenCalledWith({
      dfuseApiKey: apiKey,
      network,
      query,
      onlyIrreversible,
      lowBlockNum: startAtBlock
    })
  })

  describe("#getHeadBlockNumber", () => {
    test("should wait until a first block has been returned before returning the block number", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      let returned = false

      // Make sure the function doesnt return before sendNextBlock is called
      const promise = actionReader.getHeadBlockNumber().then((blockNum) => {
        returned = true
        return blockNum
      })

      expect(returned).toBe(false)

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 5
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      // Account for the small delay used in waitUntil()
      const headBlockNumber = await promise

      expect(headBlockNumber).toBe(6)
    })

    test("should return the latest block number + 1 when a higher block is received", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 5
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      await actionReader.getHeadBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(6)
      })

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 6
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      await actionReader.getHeadBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(7)
      })
    })

    test("should not return the latest block number + 1 when a lower block is received", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 5
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      await actionReader.getHeadBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(6)
      })

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 4
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      await actionReader.getHeadBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(6)
      })
    })

    test("should return the latest block number when a the blockStreamer has reached the live marker", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 5
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      MockedDfuseBlockStreamer.prototype.isLiveMarkerReached.mockImplementationOnce(() => true)

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 6
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      await actionReader.getHeadBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(6)
      })
    })
  })

  describe("#getLastIrreversibleBlockNumber", () => {
    test("should wait until a first block has been returned before returning the block number", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      let returned = false

      // Make sure the function doesnt return before sendNextBlock is called
      const promise = actionReader.getLastIrreversibleBlockNumber().then((blockNum) => {
        returned = true
        return blockNum
      })

      expect(returned).toBe(false)

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 5
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      // Account for the small delay used in waitUntil()
      const headBlockNumber = await promise

      expect(headBlockNumber).toBe(3)
    })

    test("should return the latest block number when a higher block is received", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 5
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      await actionReader.getLastIrreversibleBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(3)
      })

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 6
          },
          lastIrreversibleBlockNumber: 4
        })
      )

      await actionReader.getLastIrreversibleBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(4)
      })
    })

    test("should not return the latest block number when a lower block is received", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 5
          },
          lastIrreversibleBlockNumber: 4
        })
      )

      await actionReader.getLastIrreversibleBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(4)
      })

      sendNextBlock(
        actionReader,
        getNextBlockStub({
          blockInfo: {
            blockNumber: 4
          },
          lastIrreversibleBlockNumber: 3
        })
      )

      await actionReader.getLastIrreversibleBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(4)
      })
    })
  })
})
