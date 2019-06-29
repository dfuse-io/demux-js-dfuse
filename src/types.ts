// TODO find whether this type already exists in client-js or somewhere else.
export type Transaction = {
  undo: boolean
  irreversibleBlockNum: number
  cursor: string
  trace: {
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
}