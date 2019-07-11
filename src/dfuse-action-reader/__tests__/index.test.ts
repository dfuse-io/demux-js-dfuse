import { DfuseActionReader } from ".."
import { DfuseBlockStreamer } from "../../dfuse-block-streamer"
import { Block } from "demux"

jest.mock("../../dfuse-block-streamer")

const MockedDfuseBlockStreamer = DfuseBlockStreamer as jest.Mock<DfuseBlockStreamer>

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

function sendBlock(
  actionReader: DfuseActionReader,
  block: Block,
  lastIrreversibleBlockNumber: number
) {
  // TODO this code is brittle - it will fail if addOnBlockListener is called multiple times in a single test
  const onBlockCallback = MockedDfuseBlockStreamer.prototype.addOnBlockListener.mock.calls[0][0]
  onBlockCallback.call(actionReader, {
    block,
    lastIrreversibleBlockNumber,
    undo: false
  })
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

      // Make sure the function doesnt return before sendBlock is called
      const promise = actionReader.getHeadBlockNumber().then((blockNum) => {
        returned = true
        return blockNum
      })

      expect(returned).toBe(false)

      sendBlock(actionReader, getBlockStub(5), 3)

      // Account for the small delay used in waitUntil()
      const headBlockNumber = await promise

      expect(headBlockNumber).toBe(5)
    })

    test("should return the latest block number when a higher block is received", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      sendBlock(actionReader, getBlockStub(5), 3)

      await actionReader.getHeadBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(5)
      })

      sendBlock(actionReader, getBlockStub(6), 3)

      await actionReader.getHeadBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(6)
      })
    })

    test("should not return the latest block number when a lower block is received", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      sendBlock(actionReader, getBlockStub(5), 3)

      await actionReader.getHeadBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(5)
      })

      sendBlock(actionReader, getBlockStub(4), 3)

      await actionReader.getHeadBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(5)
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

      // Make sure the function doesnt return before sendBlock is called
      const promise = actionReader.getLastIrreversibleBlockNumber().then((blockNum) => {
        returned = true
        return blockNum
      })

      expect(returned).toBe(false)

      sendBlock(actionReader, getBlockStub(5), 3)

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

      sendBlock(actionReader, getBlockStub(5), 3)

      await actionReader.getLastIrreversibleBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(3)
      })

      sendBlock(actionReader, getBlockStub(6), 4)

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

      sendBlock(actionReader, getBlockStub(5), 4)

      await actionReader.getLastIrreversibleBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(4)
      })

      sendBlock(actionReader, getBlockStub(4), 3)

      await actionReader.getLastIrreversibleBlockNumber().then((blockNum) => {
        expect(blockNum).toBe(4)
      })
    })
  })
})
