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
  onBlockCallback.call(actionReader, block, lastIrreversibleBlockNumber)
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
    new DfuseActionReader({
      startAtBlock: 0,
      onlyIrreversible: false,
      dfuseApiKey: apiKey
    })

    expect(MockedDfuseBlockStreamer).toHaveBeenCalledTimes(1)
    expect(MockedDfuseBlockStreamer.prototype.stream).toHaveBeenCalledTimes(1)
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

  describe("#getBlock", () => {
    test("should immediately respond with the expected block when asked for block num 1", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      const block = await actionReader.getBlock(1)

      expect(block).toEqual({
        blockInfo: {
          blockNumber: 1,
          blockHash: "00000001405147477ab2f5f51cda427b638191c66d2c59aa392d5c2c98076cb0",
          previousBlockHash: "",
          timestamp: new Date("2018-06-08T08:08:08.000Z")
        },
        actions: []
      })
    })

    test("should immediately respond with the expected block when asked for block num 2", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      const block = await actionReader.getBlock(2)

      expect(block).toEqual({
        blockInfo: {
          blockNumber: 2,
          blockHash: "0000000267f3e2284b482f3afc2e724be1d6cbc1804532ec62d4e7af47c30693",
          previousBlockHash: "00000001405147477ab2f5f51cda427b638191c66d2c59aa392d5c2c98076cb0",
          timestamp: new Date("2018-06-08T08:08:08.000Z")
        },
        actions: []
      })
    })

    test("should wait until a valid block is at the head of the queue before returning when the block number is higher than 2", async () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      let returned = false
      const getBlock = actionReader.getBlock(3)
      getBlock.then(() => {
        returned = true
      })

      // Validate that the promise isnt resolving yet
      expect(returned).toBe(false)

      sendBlock(actionReader, getBlockStub(3), 3)

      // await, to account for the small delay caused by waitUntil()
      const block = await getBlock

      // Validate that the promise has resolved with the right data
      expect(returned).toBe(true)
      expect(block).toMatchObject({
        blockInfo: {
          blockNumber: 3
        }
      })
    })

    test("calling getBlock when the requested block is at the head of the queue should immediately return that block", () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      sendBlock(actionReader, getBlockStub(3), 3)

      const block = actionReader.getBlock(3)

      expect(block).resolves.toMatchObject({
        blockInfo: {
          blockNumber: 3
        }
      })
    })

    test("calling getBlock when the first block in queue is higher than the requested block should return a generic block", () => {
      const actionReader = new DfuseActionReader({
        startAtBlock: 0,
        onlyIrreversible: false,
        dfuseApiKey: apiKey
      })

      sendBlock(actionReader, getBlockStub(5), 3)

      const block = actionReader.getBlock(3)

      expect(block).resolves.toMatchObject({
        blockInfo: {
          blockNumber: 3
        }
      })
    })
  })
})
