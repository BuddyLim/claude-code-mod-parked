import type { ParkedItem, ParkedKind, ParkedMessage } from '../types'

export type Backlog = { nextId: number; items: ParkedItem[] }

export const EMPTY: Backlog = { nextId: 1, items: [] }

export type NewItem = {
  kind: ParkedKind
  title: string
  body: string
  note?: string
  parkedBy: 'model' | 'user'
  sessionId: string
  now: number
}

export const isBacklog = (value: unknown): value is Backlog =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Backlog).nextId === 'number' &&
  Array.isArray((value as Backlog).items)

export const park = (backlog: Backlog, item: NewItem): Backlog => ({
  nextId: backlog.nextId + 1,
  items: [
    ...backlog.items,
    {
      id: backlog.nextId,
      kind: item.kind,
      title: item.title,
      body: item.body,
      ...(item.note ? { note: item.note } : {}),
      parkedBy: item.parkedBy,
      sessionId: item.sessionId,
      createdAt: item.now,
      status: 'open',
    },
  ],
})

// A string answer is the reason the change was refused.
export const resolve = (
  backlog: Backlog,
  id: number,
  resolution: string,
  resolvedBy: 'model' | 'user',
  now: number,
): Backlog | string => {
  const item = backlog.items.find(one => one.id === id)

  if (item === undefined) {
    return `No parked item #${id}.`
  }

  if (item.status === 'done') {
    return `Parked item #${id} is already done.`
  }

  return {
    ...backlog,
    items: backlog.items.map(one =>
      one.id === id
        ? { ...one, status: 'done', resolution, resolvedBy, resolvedAt: now }
        : one,
    ),
  }
}

export const reopen = (backlog: Backlog, id: number): Backlog | string => {
  const item = backlog.items.find(one => one.id === id)

  if (item === undefined) {
    return `No parked item #${id}.`
  }

  const { resolution: _r, resolvedBy: _b, resolvedAt: _a, ...rest } = item

  return {
    ...backlog,
    items: backlog.items.map(one =>
      one.id === id ? { ...rest, status: 'open' } : one,
    ),
  }
}

export const statusText = (items: readonly ParkedItem[]): string | undefined => {
  const open = items.filter(one => one.status === 'open')
  const needs = open.filter(one => one.kind === 'needs-you').length
  const fyi = open.length - needs
  const parts = [
    needs > 0 ? `${needs} need${needs === 1 ? 's' : ''} you` : '',
    fyi > 0 ? `${fyi} FYI` : '',
  ].filter(Boolean)

  return parts.length === 0 ? undefined : `📌 ${parts.join(' · ')}`
}

export const titleOf = (note: string, reply: string): string => {
  const first =
    note.trim() ||
    (reply.split('\n').find(line => line.trim() !== '') ?? '').replace(/^[#>*\-\s]+/, '').trim()

  return first.length > 80 ? `${first.slice(0, 79)}…` : first
}

export const ageOf = (createdAt: number, now: number): string => {
  const minutes = Math.max(0, Math.round((now - createdAt) / 60000))

  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.round(minutes / 60)

  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

export const describe = (item: ParkedItem): string =>
  [
    `#${item.id} [${item.kind}] ${item.title}${item.status === 'done' ? ' (done)' : ''}`,
    item.note ? `Note: ${item.note}` : '',
    item.body,
    item.resolution ? `Resolution: ${item.resolution}` : '',
  ]
    .filter(Boolean)
    .join('\n')

// Adds a message to an item's side thread, and names the subagent answering it.
export const say = (
  backlog: Backlog,
  id: number,
  message: ParkedMessage,
  agentId?: string,
): Backlog | string => {
  if (!backlog.items.some(one => one.id === id)) {
    return `No parked item #${id}.`
  }

  return {
    ...backlog,
    items: backlog.items.map(one =>
      one.id === id
        ? {
            ...one,
            thread: [...(one.thread ?? []), message],
            ...(agentId !== undefined ? { agentId } : {}),
          }
        : one,
    ),
  }
}

const lastOf = (item: ParkedItem, role: ParkedMessage['role']) =>
  (item.thread ?? []).findLast(one => one.role === role)

// What a fresh subagent is told: the item, the thread so far and the new message.
export const investigationPrompt = (item: ParkedItem, text: string, brief = ''): string =>
  [
    'You are helping the user look into one parked item from a long orchestration session, in a side thread the main agent does not see.',
    'Investigate with your tools as far as the question needs, then answer the user directly and concisely. Do not change any files unless the user asks you to.',
    '',
    `Parked item #${item.id} [${item.kind}]: ${item.title}`,
    item.body,
    item.note ? `The user's note: ${item.note}` : '',
    ...(brief.trim() !== '' ? ['', 'Briefing from the main session, written for you from its full context:', brief.trim()] : []),
    ...((item.thread ?? []).some(one => one.role !== 'note')
      ? ['', 'Earlier in this thread:', ...(item.thread ?? []).filter(one => one.role !== 'note').map(one => `${one.role === 'you' ? 'User' : 'You'}: ${one.text}`)]
      : []),
    '',
    `The user's message: ${text}`,
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n')

// The one message "Send to agent" posts to the main conversation.
const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

// What a small model is asked, to turn a side thread into the few lines the
// main agent needs: the thread itself stays out of the main conversation.
export const summaryRequest = (item: ParkedItem): string =>
  [
    'Below is a parked item from a coding session and a side thread in which the user and a subagent looked into it.',
    'Summarise the thread for the main agent in at most 120 words: what was found, what the user decided or wants, and what the main agent should do next, if anything.',
    'Plain text, no preamble, no headings. State only what the thread supports. If it reached no conclusion, say so in one line.',
    '',
    `Parked item #${item.id} [${item.kind}]: ${item.title}`,
    cut(item.body, 4000),
    '',
    'Side thread:',
    // The newest part of a long thread is the part that holds its conclusion.
    (item.thread ?? [])
      .filter(one => one.role !== 'note')
      .map(one => `${one.role === 'you' ? 'User' : 'Subagent'}: ${one.text}`)
      .join('\n\n')
      .slice(-12000),
  ].join('\n')

// The one message "Send" posts to the main conversation: the thread's summary,
// or, when none could be made, the start of the subagent's last reply.
export const handoff = (item: ParkedItem, summary = ''): string => {
  const finding = lastOf(item, 'agent')
  const said = lastOf(item, 'you')

  return [
    `About parked item #${item.id}: ${item.title}`,
    '',
    ...(summary.trim() !== ''
      ? ['Summary of a side thread I held with a subagent on this:', summary.trim()]
      : [
          'I looked into this in a side thread with a subagent. The start of its latest findings:',
          cut(finding?.text ?? '(none yet)', 600),
          ...(said !== undefined ? ['', `My last message there: ${cut(said.text, 300)}`] : []),
        ]),
  ].join('\n')
}

export const doneNote = (item: ParkedItem): string => {
  const finding = lastOf(item, 'agent')

  if (finding === undefined) {
    return 'Marked done by you.'
  }

  const line = finding.text.replace(/\s+/g, ' ').trim()

  return `Marked done by you after a side thread. Last finding: ${line.length > 140 ? `${line.slice(0, 139)}…` : line}`
}

// Splits text into rows no wider than `width`, so a region of the pane can show
// a window of them; a wrapped list line keeps its indent.
export const wrap = (text: string, width: number): string[] =>
  text.split('\n').flatMap(line => {
    const clean = line.replace(/\*\*(.+?)\*\*/g, '$1').trimEnd()
    const indent = Math.min(clean.match(/^\s*(?:[-*]\s+|\d+\.\s+)?/)?.[0].length ?? 0, Math.max(0, width - 10))
    const rows: string[] = []
    let rest = clean

    while (rest.length > width) {
      const space = rest.lastIndexOf(' ', width)
      const cut = space > indent ? space : width
      rows.push(rest.slice(0, cut))
      rest = ' '.repeat(indent) + rest.slice(cut).trimStart()
    }

    return [...rows, rest]
  })

// What the main session is asked, in a fork of its own context, so a thread's
// subagent starts with the background an orchestrator would hand it.
export const briefRequest = (item: ParkedItem): string =>
  [
    'This is a request for a handover, not a continuation of your work. Do not act on it or call tools.',
    'A separate subagent is about to help the user look into the parked item below. It knows nothing about this session.',
    'Write the briefing you would give it: the goal of the work this item came from; what was done and found that bears on it; the files, commands and names it will need; decisions already made; and what is still unknown.',
    'Be specific and brief, in plain text with no preamble. If nothing in this session bears on the item, say so in one line.',
    '',
    `Parked item #${item.id} [${item.kind}]: ${item.title}`,
    item.body,
  ].join('\n')

// The order the pane lists items in, which Next and Prev walk: open items that
// need the user, then open FYIs, then the ten most recently parked done items.
export const orderOf = (items: readonly ParkedItem[]): ParkedItem[] => {
  const open = items.filter(one => one.status === 'open')

  return [
    ...open.filter(one => one.kind === 'needs-you'),
    ...open.filter(one => one.kind === 'fyi'),
    ...items.filter(one => one.status === 'done').slice(-10).reverse(),
  ]
}

// A thread as one Markdown text, for the formatted view.
export const threadText = (item: ParkedItem): string =>
  (item.thread ?? [])
    .map(one =>
      one.role === 'note' ? `*· ${one.text}*` : `**${one.role === 'you' ? 'You' : 'Subagent'}**\n\n${one.text}`,
    )
    .join('\n\n')

// A reply's text with spacing and Markdown marks removed, cut short: two
// routes deliver the same report with different escaping and indentation.
const gist = (text: string) => text.replace(/[\s\\*`_>#-]/g, '').slice(0, 80)

// Adds a subagent's reply unless the thread already holds it since the user's
// last message: its turn's end and its hand-back both carry the same report.
export const sayOnce = (backlog: Backlog, id: number, message: ParkedMessage): Backlog | string => {
  const thread = backlog.items.find(one => one.id === id)?.thread ?? []
  const since = thread.slice(thread.findLastIndex(one => one.role === 'you') + 1)

  return since.some(one => one.role === 'agent' && gist(one.text) === gist(message.text))
    ? backlog
    : say(backlog, id, message)
}

export type ParkedAction = { act: 'done' | 'reopen' | 'next' | 'prev' | 'back'; label: string; hot: string }

// The actions an item's row offers, in the order ← and → walk them.
export const actionsOf = (order: readonly ParkedItem[], item: ParkedItem): ParkedAction[] => {
  const at = order.findIndex(one => one.id === item.id)

  return [
    item.status === 'open'
      ? { act: 'done', label: 'Done', hot: 'd' }
      : { act: 'reopen', label: 'Reopen', hot: 'r' },
    ...(at < order.length - 1 ? [{ act: 'next', label: 'Next', hot: 'n' } as const] : []),
    ...(at > 0 ? [{ act: 'prev', label: 'Prev', hot: 'p' } as const] : []),
    { act: 'back', label: 'Back', hot: 'b' },
  ]
}

export type ThreadLine = { text: string; kind: 'you' | 'dot' | 'text' | 'note' }

// A thread as rows a window can show a slice of. The user's message is shaded
// rows under a ❯, as a prompt is; a reply opens with a dot and its later
// rows are indented under it; a note is one dim line. A blank row parts them.
export const threadLines = (thread: readonly ParkedMessage[], columns: number): ThreadLine[] =>
  thread.flatMap((one, index): ThreadLine[] => {
    const gap: ThreadLine[] = index > 0 ? [{ text: '', kind: 'text' }] : []

    if (one.role === 'you') {
      // As Claude Code draws a prompt: a ❯ on the first row, later rows
      // indented under it, each row padded so its shading runs the full width.
      return [
        ...gap,
        ...wrap(one.text, Math.max(4, columns - 2)).map(
          (text, at): ThreadLine => ({ text: `${at === 0 ? '❯' : ' '} ${text}`.padEnd(columns), kind: 'you' }),
        ),
      ]
    }

    if (one.role === 'note') {
      return [...gap, ...wrap(`· ${one.text}`, columns).map((text): ThreadLine => ({ text, kind: 'note' }))]
    }

    return [
      ...gap,
      ...wrap(one.text, Math.max(4, columns - 2)).map(
        (text, at): ThreadLine => ({ text: `${at === 0 ? '●' : ' '} ${text}`, kind: at === 0 ? 'dot' : 'text' }),
      ),
    ]
  })
