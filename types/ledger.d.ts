// What parked reads of the ledger mod's run, where that mod is loaded: a copy
// of the few fields it uses, so parked needs no dependency and works alone.
// The ledger's own contract is the authority; keep these a subset of it.

export type LedgerTaskSeen = {
  id: string
  unit: string
  title: string
  status: 'todo' | 'running' | 'gate-failed' | 'done'
  note?: string
}

export type LedgerFindingSeen = {
  id: number
  path: string
  line?: number
  severity: 'error' | 'warning' | 'note'
  summary: string
  task?: string
  status: 'open' | 'fixed'
}

export type LedgerRunSeen = {
  goal: string
  // Set once the run is done; absent while it is under way.
  doneAt?: number
  tasks: LedgerTaskSeen[]
  findings: LedgerFindingSeen[]
}

declare module 'claude-code' {
  interface PluginState {
    ledger: {
      run: LedgerRunSeen | null
      // Every run the ledger keeps for the project.
      runs: LedgerRunSeen[]
    }
  }
}
