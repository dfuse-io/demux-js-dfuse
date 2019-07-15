type Trace = {
  id: string
  matchingActions: {
    account: string
    name: string
    data: {}
    authorization: {
      actor: string
      permission: string
    }[]
  }[]
  block: {
    num: number
    id: string
    previous: string
    timestamp: Date
  }
}

export type Transaction = {
  undo: boolean
  irreversibleBlockNum: number
  cursor: string
  trace: Trace | null
}
