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
  // The side conversation held in the pane; the main agent never reads it.
  thread?: ParkedMessage[]
  // The subagent answering the thread, while this session still has it.
  agentId?: string
}

declare module 'claude-code' {
  interface PluginState {
    parked: {
      nudge: { key: string; n: number }
      typing: boolean
      typingAt: number
      draft: string
      items: ParkedItem[]
      selected: number
      pending: number[]
      back: number
      top: number
      lab: boolean
    }
  }
}
