// 'needs-you' and 'fyi' are for the user. 'self' is the assistant's own: a
// thing it means to come back to, which the user is not asked to act on.
export type ParkedKind = 'needs-you' | 'fyi' | 'self'

// 'note' is a line the mod itself adds to a thread; 'brief' is the handover the
// thread's subagent was started with, kept so the user can read it. A reply
// keeps the tool calls its subagent made on the way, each as the row drawn.
export type ParkedMessage = {
  role: 'you' | 'agent' | 'note' | 'brief'
  text: string
  at: number
  tools?: string[]
}

export type ParkedItem = {
  id: number
  kind: ParkedKind
  title: string
  body: string
  note?: string
  parkedBy: 'model' | 'user'
  // The session the item was parked in, and that session's project root.
  sessionId: string
  project?: string
  createdAt: number
  // The transcript row the item came up at, where there is one to go back to:
  // the agent's call that parked it, or the row the user's selection lay in.
  source?: string
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
  // The session whose agent is to be told: the one the item was parked in.
  answeredIn?: string
  isUnsent?: true
  // The side conversation held in the pane; the main agent never reads it.
  thread?: ParkedMessage[]
  // The subagent answering the thread, while this session still has it, and
  // whether it was started so that its replies can be shown as it writes them.
  agentId?: string
  isStreamed?: true
  // A briefing written after the subagent had already replied: it goes with
  // the user's next message to it.
  owed?: string
  // The briefing the main session wrote for this item's thread. It is written
  // once: a subagent that later takes the thread over starts with it.
  brief?: string
}

// A session that has parked items, as the pane names it: the name /resume
// lists it under, its project root, and where its transcript is kept.
export type ParkedSession = { name: string; project: string; transcript?: string; seenAt: number }

// Which items the pane lists: this session's, this project's, or all of them.
export type ParkedScope = 'session' | 'project' | 'all'

// A thread's reply while its subagent writes it: the tools it has called and
// the text so far. Before the subagent has written anything, `stage` says what
// is being waited on.
export type ParkedLive = { text: string; tools: string[]; stage?: string }

// One of an item's files shown in the item itself: which of its references,
// the file's full path, the line referred to (0 for the file as a whole), the
// lines read around it and the number of the first, or why it could not be read.
export type ParkedPeek = { at: number; path: string; line: number; start: number; source: string; error?: string }

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
      draft: string
      // What the composer holds as the user types, for the pane to show whole.
      typed: string
      // The item whose side thread takes the next prompt typed in Claude Code's
      // own prompt box; 0 while none does.
      armed: number
      answering: boolean
      items: ParkedItem[]
      sessions: Record<string, ParkedSession>
      scope: ParkedScope
      selected: number
      pending: number[]
      live: Record<string, ParkedLive>
      section: 'ticket' | 'thread'
      // Whether an item offers its side thread; `/parked chat` switches it.
      chat: boolean
      isBriefOpen: boolean
      // The assistant's own items it was last reminded of, and the prompts since.
      reminded: { ids: string; turns: number }
      peek: ParkedPeek | null
      // Whether the pane is showing the lens mod's screens in place of its own:
      // a file of an item, opened where the item was. Lens reads this.
      guest: boolean
      // Which of the open item's files (by place in its list) have been changed
      // since it was parked: what it says of them may no longer hold.
      changed: number[]
      // The last thing done in the pane that can be taken back: what it was,
      // and the items it touched as they were before.
      undo: { label: string; items: ParkedItem[] } | null
      // The session last told what was waiting for it, so a reload says nothing.
      greeted: string
      lab: boolean
    }
  }
}
