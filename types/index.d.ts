export type ParkedKind = 'needs-you' | 'fyi'

// 'note' is a line the mod itself adds to a thread, such as a briefing's record.
export type ParkedMessage = { role: 'you' | 'agent' | 'note'; text: string; at: number }

export type ParkedItem = {
  id: number
  kind: ParkedKind
  title: string
  body: string
  note?: string
  parkedBy: 'model' | 'user'
  sessionId: string
  createdAt: number
  status: 'open' | 'done'
  resolution?: string
  resolvedBy?: 'model' | 'user'
  resolvedAt?: number
  // The choices a decision offers, and the one (counted from 1) the agent
  // would pick: it proceeds on that one unless the item is blocking.
  options?: string[]
  preferred?: number
  // Set when no remaining work can go on until the user answers.
  isBlocking?: true
  // The places the item is about, each a path or path:line.
  refs?: string[]
  // The ledger task the item belongs to, where the ledger mod has a run.
  task?: string
  // Set on an item parked from the ledger's run, not by the agent or the user:
  // a task's failed gate, or the open findings of a unit's review.
  origin?: { kind: 'gate'; task: string } | { kind: 'review'; unit: string }
  // What the user answered, and whether the main agent is still to be told.
  answer?: string
  // The session the user answered in: its agent is the one to tell.
  answeredIn?: string
  isUnsent?: true
  // The side conversation held in the pane; the main agent never reads it.
  thread?: ParkedMessage[]
  // The subagent answering the thread, while this session still has it.
  agentId?: string
}

// A place parked asks to be shown, which the lens mod opens where it is loaded:
// a path from the session's folder (or absolute), a line (0 for the file as a
// whole), and a count of the asks, so the same place asked twice is two asks.
export type ParkedJump = { path: string; line: number; n: number }

declare module 'claude-code' {
  interface PluginState {
    parked: {
      jump: ParkedJump | null
      nudge: { key: string; n: number }
      typing: boolean
      typingAt: number
      draft: string
      answering: boolean
      items: ParkedItem[]
      selected: number
      pending: number[]
      back: number
      top: number
      lab: boolean
    }
  }
}
