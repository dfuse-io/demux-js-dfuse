import * as Logger from "bunyan"
import { IActionReader, ActionReaderOptions, Block, BlockInfo, NextBlock, ReaderInfo } from "demux"
import { DfuseBlockStreamer } from "../dfuse-block-streamer"
import { waitUntil, getBlockNumber } from "../util"

type DfuseActionReaderOptions = ActionReaderOptions & {
  dfuseApiKey: string
  network?: string
  query?: string
}

/**
 * Implements a demux-js ActionReader (see https://github.com/EOSIO/demux-js for more information).
 *
 * Demux-js makes the assumption that all blocks need to be read. This would be true if reading directly
 * from an eos node, but it is not the case when using dfuse. Based on the provided query, dfuse will
 * return only the transactions that match the query. This means that blocks that don't interest us will
 * be missing.
 *
 * Because demux-js needs to see every block one by one, when a block that didn't match the dfuse query is
 * required, we generate dummy blocks that contains no actions to get demux-js to move forward to the
 * next block in the chain.
 *
 * Since we only actually fetch the blocks that interest us, we can see great performance gains.
 *
 * demux-js also expects blocks to be fetched one by one, making one network request per block. With dfuse,
 * this is is not necessary, since we can stream only the blocks we want via the graphl api. To circumvent this
 * expectation, the streamed blocks will be put in a FIFO queue, where demux can find them.
 */
export class DfuseActionReader implements IActionReader {
  public startAtBlock: number
  public headBlockNumber: number = 0
  public currentBlockNumber: number
  protected activeCursor: string = ""
  protected blockQueue: NextBlock[] = []
  protected blockStreamer: DfuseBlockStreamer
  protected onlyIrreversible: boolean
  protected currentBlockData: Block = defaultBlock
  protected lastIrreversibleBlockNumber: number = 0
  protected initialized: boolean = false
  private nextBlockNeeded: number = 0
  private log: Logger

  constructor(options: DfuseActionReaderOptions) {
    const optionsWithDefaults = {
      startAtBlock: 1,
      onlyIrreversible: false,
      ...options
    }

    this.startAtBlock = optionsWithDefaults.startAtBlock
    this.currentBlockNumber = optionsWithDefaults.startAtBlock - 1
    this.onlyIrreversible = optionsWithDefaults.onlyIrreversible
    this.log = Logger.createLogger({ name: "demux-dfuse" })

    const { dfuseApiKey, network, query } = optionsWithDefaults

    // Patch for an issue where dfuse doesnt return blocks 1 and 2
    // if (this.startAtBlock > 0 && this.startAtBlock < 3) {
    //   this.startAtBlock = 3
    //   this.currentBlockNumber = 2
    // }

    this.blockStreamer = new DfuseBlockStreamer({
      dfuseApiKey,
      network,
      query,
      onlyIrreversible: this.onlyIrreversible,
      lowBlockNum: this.startAtBlock
    })

    this.onBlock = this.onBlock.bind(this)
    this.streamBlocks()
  }

  public async initialize(): Promise<void> {
    await waitUntil(() => this.blockQueue.length > 0)

    if (this.currentBlockNumber < 0) {
      this.currentBlockNumber = getBlockNumber(this.blockQueue[0]) - 1
    }

    this.nextBlockNeeded = getBlockNumber(this.blockQueue[0])

    this.initialized = true
  }

  private async streamBlocks(): Promise<void> {
    this.blockStreamer.addOnBlockListener(this.onBlock)
    this.blockStreamer.stream()
  }

  private onBlock(nextBlock: NextBlock) {
    this.log.trace(`Adding block #${getBlockNumber(nextBlock)} to the queue.`)

    if (this.blockQueue.length > 5 && this.blockStreamer.isStreaming) {
      // this.blockStreamer.pause()
    }

    /*
     * When we are seeing a new block, we need to update our head reference
     * Math.max is used in case an "undo" trx is returned, with a lower block
     * number than our head reference. If there was a fork, the head block
     * must be higher than the head block we have previously seen due to the
     * longest chain prevailing in case of a fork
     */
    this.headBlockNumber = Math.max(this.headBlockNumber, getBlockNumber(nextBlock))

    /*
     * Update the reference to the last irreversible block number,
     * making sure we are not receiving an outdated reference in the case of an undo
     ? is this possible?
     */
    this.lastIrreversibleBlockNumber = Math.max(
      this.lastIrreversibleBlockNumber,
      nextBlock.lastIrreversibleBlockNumber
    )

    this.blockQueue.push(nextBlock)
  }

  public async getBlock(requestedBlockNumber: number): Promise<Block> {
    return defaultBlock
  }

  public async seekToBlock(blockNumber: number): Promise<void> {
    this.nextBlockNeeded = blockNumber
  }

  public async getNextBlock(): Promise<NextBlock> {
    // If the queue is empty, wait for graphql to return new results.
    await waitUntil(() => {
      return this.blockQueue.length > 0
    })

    if (!this.initialized) {
      await this.initialize()
    }

    let nextBlock: NextBlock
    const queuedBlockNumber = getBlockNumber(this.blockQueue[0])

    // If the block we need is higher than the queued block, shift the queue
    while (this.blockQueue.length > 0 && this.nextBlockNeeded > queuedBlockNumber) {
      this.blockQueue.shift()
    }

    // If the queued block is the one we need, return it
    if (this.nextBlockNeeded === queuedBlockNumber) {
      // console.log(`getNextBlock: ${this.nextBlockNeeded} found at the start of the queue.`)
      nextBlock = this.blockQueue.shift() as NextBlock
      nextBlock.block.blockInfo.previousBlockHash = this.currentBlockData
        ? this.currentBlockData.blockInfo.blockHash
        : "dummy-block-hash"

      // todo handle rollbacks
      if (nextBlock.blockMeta.isRollback === false) {
        // Hack to make the block's previousHash property match the previous block,
        // if the previous block wasnt returned by dfuse and we had to return a generic block
        // todo is there a better solution than this?
        this.acceptBlock(nextBlock.block)
      } else {
        // console.log("FORK!!!")
        // await this.resolveFork()
      }
    } else if (this.nextBlockNeeded < queuedBlockNumber) {
      // If the next block we need is lower than the queued block, return a dummy block
      nextBlock = {
        block: this.getDefaultBlock({
          blockNumber: this.nextBlockNeeded,
          previousBlockHash: this.currentBlockData
            ? this.currentBlockData.blockInfo.blockHash
            : "dummy-block-hash"
        }),
        blockMeta: {
          isRollback: false,
          isEarliestBlock: false,
          isNewBlock: true
        },
        lastIrreversibleBlockNumber: this.lastIrreversibleBlockNumber
      }
      this.acceptBlock(nextBlock.block)
    }

    // In most cases, this.nextBlockNeeded will be set by the ActionWatch directly.
    // However, there are some cases (on the very first block received), where it doesn't.
    // This patches the problem by forcibly moving to the next block as a default.
    this.nextBlockNeeded++

    return nextBlock!
  }

  public async getHeadBlockNumber(): Promise<number> {
    await waitUntil(() => this.headBlockNumber !== 0)
    return this.headBlockNumber
  }

  public async getLastIrreversibleBlockNumber(): Promise<number> {
    await waitUntil(() => this.lastIrreversibleBlockNumber !== 0)
    return this.lastIrreversibleBlockNumber
  }

  protected getDefaultBlock(blockInfo: Partial<BlockInfo>): Block {
    return {
      blockInfo: Object.assign({}, defaultBlock.blockInfo, blockInfo),
      actions: []
    }
  }

  public get info(): ReaderInfo {
    return {
      currentBlockNumber: this.currentBlockNumber,
      startAtBlock: this.startAtBlock,
      headBlockNumber: this.headBlockNumber,
      onlyIrreversible: this.onlyIrreversible,
      lastIrreversibleBlockNumber: this.lastIrreversibleBlockNumber
    }
  }

  private acceptBlock(blockData: Block) {
    this.currentBlockData = blockData
    this.currentBlockNumber = this.currentBlockData.blockInfo.blockNumber
  }
}

const defaultBlock: Block = {
  blockInfo: {
    blockNumber: 0,
    blockHash: "",
    previousBlockHash: "",
    timestamp: new Date(0)
  },
  actions: []
}
