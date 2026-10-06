import type { ParkedItem, ParkedKind, ParkedMessage } from '../types'
import type { LedgerFindingSeen, LedgerRunSeen } from '../types/ledger'
import { FILE_COLOR, FILE_ICONS, FOLDER_COLOR, ICON, STAR_COLOR, refIcon } from './kit/icons'

// What of the ledger's run has already been turned into items: the tasks whose
// gate stood failed, and the findings a review item has carried. An item is
// made when one of these changes, so one the user closed is not made again.
export type LedgerSeen = { gates: string[]; findings: number[] }

export type Backlog = { nextId: number; items: ParkedItem[]; seen?: LedgerSeen }

export const EMPTY: Backlog = { nextId: 1, items: [] }

export type NewItem = {
  kind: ParkedKind
  title: string
  body: string
  note?: string
  options?: string[]
  preferred?: number
  isBlocking?: boolean
  refs?: string[]
  task?: string
  origin?: ParkedItem['origin']
  parkedBy: 'model' | 'user'
  sessionId: string
  now: number
}

export const isBacklog = (value: unknown): value is Backlog =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Backlog).nextId === 'number' &&
  Array.isArray((value as Backlog).items)

// The glyphs and their colours are the kit's, shared with lens and ledger.
export { ICON }

// The colour each glyph that leads a ticket row is drawn in.
const LEAD_COLORS: Record<string, string> = {
  ...Object.fromEntries(FILE_ICONS.map(([, glyph, color]) => [glyph, color])),
  [ICON.file]: FILE_COLOR,
  [ICON.folderOpen]: FOLDER_COLOR,
  [ICON.options]: 'cyan',
}

export type TicketPart = { text: string; color?: string }

// One row of the ticket as the pieces it is drawn in: the glyph that leads it
// and the default's star take a colour, the rest is plain.
export const ticketParts = (row: string): TicketPart[] => {
  const lead = /^(\s*)(\S) (.*)$/u.exec(row)
  const color = lead === null ? undefined : LEAD_COLORS[lead[2] ?? '']
  const head: TicketPart[] =
    lead === null || color === undefined
      ? []
      : [...(lead[1] === '' ? [] : [{ text: lead[1] ?? '' }]), { text: `${lead[2]} `, color }]
  const rest = head.length === 0 ? row : (lead?.[3] ?? '')
  const mark = `${ICON.preferred} default`
  const at = rest.indexOf(mark)

  return [
    ...head,
    ...(at === -1
      ? [{ text: rest }]
      : [{ text: rest.slice(0, at) }, { text: mark, color: STAR_COLOR }, { text: rest.slice(at + mark.length) }]),
  ].filter(part => part.text !== '')
}

// The glyph of a ref's file type; a ref is a path, or path:line.
export const fileIcon = (ref: string): string => refIcon(ref).glyph

// The options with the preferred one first, so the default is always option 1.
const defaultFirst = (options: readonly string[], preferred: number | undefined): string[] =>
  preferred === undefined
    ? [...options]
    : [...options.slice(preferred - 1, preferred), ...options.slice(0, preferred - 1), ...options.slice(preferred)]

export const park = (backlog: Backlog, item: NewItem): Backlog => ({
  ...backlog,
  nextId: backlog.nextId + 1,
  items: [
    ...backlog.items,
    {
      id: backlog.nextId,
      kind: item.kind,
      title: item.title,
      body: item.body,
      ...(item.note ? { note: item.note } : {}),
      ...(item.options !== undefined && item.options.length > 0
        ? { options: defaultFirst(item.options, item.preferred) }
        : {}),
      ...(item.preferred !== undefined ? { preferred: 1 } : {}),
      ...(item.isBlocking === true ? { isBlocking: true as const } : {}),
      ...(item.refs !== undefined && item.refs.length > 0 ? { refs: item.refs } : {}),
      ...(item.task ? { task: item.task } : {}),
      ...(item.origin !== undefined ? { origin: item.origin } : {}),
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

  const { resolution: _r, resolvedBy: _b, resolvedAt: _a, answer: _w, answeredIn: _s, isUnsent: _u, ...rest } = item

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
  const blocking = open.filter(one => one.kind === 'needs-you' && one.isBlocking === true).length
  const fyi = open.length - needs
  const parts = [
    needs > 0 ? `${needs} need${needs === 1 ? 's' : ''} attention${blocking > 0 ? ` (${blocking} blocking)` : ''}` : '',
    fyi > 0 ? `${fyi} FYI` : '',
  ].filter(Boolean)

  // The row is for what waits on the person: FYIs alone are not worth one,
  // and ride along only when something does need them.
  return needs === 0 ? undefined : `📌 ${parts.join(' · ')}`
}

export const titleOf = (note: string, reply: string): string => {
  const first =
    note.trim() ||
    (reply.split('\n').find(line => line.trim() !== '') ?? '').replace(/^[#>*\-\s]+/, '').trim()

  return first.length > 80 ? `${first.slice(0, 79)}…` : first
}

export { ageOf } from './kit/layout'

export const describe = (item: ParkedItem): string =>
  [
    `#${item.id} [${item.kind}] ${item.title}${item.status === 'done' ? ' (done)' : ''}`,
    item.note ? `Note: ${item.note}` : '',
    item.isBlocking === true && item.status === 'open' ? 'Blocking: work is waiting on the user.' : '',
    item.body,
    item.options !== undefined
      ? `Options: ${item.options.map((label, at) => `${at + 1}) ${label}`).join('  ')}${item.preferred !== undefined ? ` (default ${item.preferred})` : ''}`
      : '',
    item.refs !== undefined ? `Files: ${item.refs.join(', ')}` : '',
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
// need the user (those blocking work first), then open FYIs, then the ten most
// recently parked done items.
export const orderOf = (items: readonly ParkedItem[]): ParkedItem[] => {
  const open = items.filter(one => one.status === 'open')

  return [
    ...open.filter(one => one.kind === 'needs-you' && one.isBlocking === true),
    ...open.filter(one => one.kind === 'needs-you' && one.isBlocking !== true),
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

// What the ticket region shows: the choices first, so they are in view however
// long the body is, then the body, then the places it is about.
export const ticketText = (item: ParkedItem): string =>
  [
    item.options !== undefined
      ? [
          `${ICON.options} Options`,
          ...item.options.map(
            (label, at) =>
              `  ${at + 1}. ${label}${item.preferred === at + 1 ? `  ${ICON.preferred} default` : ''}`,
          ),
        ].join('\n')
      : '',
    item.body,
    item.refs !== undefined
      ? [`${ICON.folderOpen} Files`, ...item.refs.map(ref => `  ${fileIcon(ref)} ${ref}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

const optionText = (item: ParkedItem, at: number) => `option ${at}, ${item.options?.[at - 1] ?? ''}`

// `text` is the answer as the main agent reads it. A silent answer is not sent
// at all: the user took the default of an item the agent had gone ahead on.
export type ParkedAnswer = { text: string; isSilent: boolean }

// The user's answer to an item: an option by its number (a typed number names
// one too, where the item has options), or their own words. A string answer
// is the reason it was refused.
export const answerOf = (item: ParkedItem, reply: number | string): ParkedAnswer | string => {
  const typed = typeof reply === 'string' ? reply.trim() : ''
  const at =
    typeof reply === 'number'
      ? reply
      : item.options !== undefined && /^[1-9]$/.test(typed)
        ? Number(typed)
        : undefined

  if (at === undefined) {
    return typed === '' ? `Parked item #${item.id} needs an answer.` : { text: typed, isSilent: false }
  }

  if (!Number.isInteger(at) || at < 1 || at > (item.options?.length ?? 0)) {
    return `Parked item #${item.id} has no option ${at}.`
  }

  return { text: optionText(item, at), isSilent: item.isBlocking !== true && at === item.preferred }
}

// Marks an item done with the user's answer, to be sent to the main agent
// unless it is silent.
export const answer = (
  backlog: Backlog,
  id: number,
  reply: number | string,
  now: number,
  sessionId?: string,
): Backlog | string => {
  const item = backlog.items.find(one => one.id === id)

  if (item === undefined) {
    return `No parked item #${id}.`
  }

  if (item.status === 'done') {
    return `Parked item #${id} is already done.`
  }

  const made = answerOf(item, reply)

  if (typeof made === 'string') {
    return made
  }

  const line = made.text.replace(/\s+/g, ' ')
  const resolution = made.isSilent
    ? `You accepted the default: ${line}`
    : `You answered: ${line.length > 140 ? `${line.slice(0, 139)}…` : line}`

  return {
    ...backlog,
    items: backlog.items.map(one =>
      one.id === id
        ? {
            ...one,
            status: 'done',
            resolution,
            resolvedBy: 'user',
            resolvedAt: now,
            answer: made.text,
            ...(sessionId !== undefined ? { answeredIn: sessionId } : {}),
            ...(made.isSilent ? {} : { isUnsent: true as const }),
          }
        : one,
    ),
  }
}

// The answers the main agent has not been told yet. Given a session, only the
// ones answered in it: another session's agent has no use for them.
export const unsentOf = (items: readonly ParkedItem[], sessionId?: string): ParkedItem[] =>
  items.filter(
    one =>
      one.isUnsent === true &&
      one.answer !== undefined &&
      (sessionId === undefined || one.answeredIn === sessionId),
  )

// Puts answers back among the unsent, when sending them failed.
export const unsend = (backlog: Backlog, ids: readonly number[]): Backlog => ({
  ...backlog,
  items: backlog.items.map(one =>
    ids.includes(one.id) && one.answer !== undefined ? { ...one, isUnsent: true as const } : one,
  ),
})

export const sent = (backlog: Backlog, ids: readonly number[]): Backlog => ({
  ...backlog,
  items: backlog.items.map(one => {
    if (!ids.includes(one.id)) {
      return one
    }

    const { isUnsent: _u, ...rest } = one

    return rest
  }),
})

// The one message that carries the user's answers to the main agent. Where an
// answer departs from the default the agent went ahead on, it says so.
export const answersNote = (items: readonly ParkedItem[]): string =>
  [
    'My answers to parked items:',
    ...items.map(one => {
      const isOverride =
        one.isBlocking !== true &&
        one.preferred !== undefined &&
        one.answer !== optionText(one, one.preferred)

      return `- #${one.id} ${one.title}: ${one.answer ?? ''}${isOverride ? ` (not your default, ${optionText(one, one.preferred ?? 0)}: revise what was built on it)` : ''}`
    }),
  ].join('\n')

// The unit findings with no task of the run are reviewed under.
const NO_UNIT = 'Other changes'

const placeOf = (finding: LedgerFindingSeen) =>
  finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`

const many = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

// What a unit's review item says of its open findings.
const reviewOf = (unit: string, open: readonly LedgerFindingSeen[]) => {
  const errors = open.filter(one => one.severity === 'error').length

  return {
    kind: (errors > 0 ? 'needs-you' : 'fyi') as ParkedKind,
    title: `Review of ${unit}: ${many(open.length, 'finding')}${errors > 0 ? ` (${many(errors, 'error')})` : ''}`,
    body: open
      .map(one => `- ${one.severity} ${placeOf(one)} ${one.summary}${one.task ? ` (${one.task})` : ''}`)
      .join('\n'),
    refs: [...new Set(open.map(placeOf))],
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Brings the backlog in step with the ledger mod's run, where that mod is
// loaded: a task whose gate fails gets an FYI that closes when it leaves that
// state, and each unit with open findings gets one item listing them, which
// closes when all are fixed. Answers the same backlog when nothing changed.
export const syncLedger = (
  backlog: Backlog,
  run: LedgerRunSeen | null | undefined,
  now: number,
  sessionId: string,
): Backlog => {
  const seen = backlog.seen ?? { gates: [], findings: [] }
  const tasks = run?.tasks ?? []
  const findings = run?.findings ?? []
  let next: Backlog = backlog

  const close = (isOurs: (item: ParkedItem) => boolean, resolution: string) => {
    if (next.items.some(one => one.status === 'open' && isOurs(one))) {
      next = {
        ...next,
        items: next.items.map(one =>
          one.status === 'open' && isOurs(one)
            ? { ...one, status: 'done', resolution, resolvedBy: 'model', resolvedAt: now }
            : one,
        ),
      }
    }
  }

  // Gates: an item as a task's gate starts failing, closed as it stops.
  const failed = tasks.filter(one => one.status === 'gate-failed')

  for (const task of failed.filter(one => !seen.gates.includes(one.id))) {
    next = park(next, {
      kind: 'fyi',
      title: `Gate failed: ${task.id} ${task.title}`,
      body: `${task.note ?? 'The gate failed; no note was given.'}\n\nThe agent is expected to fix this and run the gate again. This item closes by itself when it does.`,
      task: task.id,
      origin: { kind: 'gate', task: task.id },
      parkedBy: 'model',
      sessionId,
      now,
    })
  }

  for (const id of seen.gates.filter(one => !failed.some(task => task.id === one))) {
    const status = tasks.find(one => one.id === id)?.status

    close(
      item => item.origin?.kind === 'gate' && item.origin.task === id,
      status === 'done'
        ? 'The gate passed.'
        : status === undefined
          ? 'The run was cleared or planned again.'
          : 'The task is being reworked.',
    )
  }

  // Reviews: one item per unit that has open findings.
  const unitOf = (finding: LedgerFindingSeen) =>
    tasks.find(one => one.id === finding.task)?.unit ?? NO_UNIT
  const open = findings.filter(one => one.status === 'open')
  const units = new Set([
    ...open.map(unitOf),
    ...next.items.flatMap(one =>
      one.status === 'open' && one.origin?.kind === 'review' ? [one.origin.unit] : [],
    ),
  ])

  for (const unit of units) {
    const mine = open.filter(one => unitOf(one) === unit)
    const item = next.items.find(
      one => one.status === 'open' && one.origin?.kind === 'review' && one.origin.unit === unit,
    )

    if (mine.length === 0) {
      close(
        one => one.origin?.kind === 'review' && one.origin.unit === unit,
        run ? 'Every finding is fixed.' : 'The run was cleared.',
      )
    } else if (item !== undefined) {
      const { refs, ...said } = reviewOf(unit, mine)
      const updated: ParkedItem = { ...item, ...said, refs }

      if (!same(updated, item)) {
        next = { ...next, items: next.items.map(one => (one.id === item.id ? updated : one)) }
      }
    } else if (mine.some(one => !seen.findings.includes(one.id))) {
      next = park(next, {
        ...reviewOf(unit, mine),
        origin: { kind: 'review', unit },
        parkedBy: 'model',
        sessionId,
        now,
      })
    }
  }

  const after: LedgerSeen = {
    gates: failed.map(one => one.id),
    findings: run ? [...new Set([...seen.findings, ...findings.map(one => one.id)])] : [],
  }

  return same(after, seen) && next === backlog ? backlog : { ...next, seen: after }
}

export type TicketLine = { text: string; isNote: boolean; color?: string }

// The ticket as rows a window can show a slice of. What the user parked is in
// labelled sections: "Your note", shaded under a ❯ as a prompt is, then
// "Assistant reply" under a dot, as the assistant's replies are drawn. What
// the agent parked is its own description and is drawn plain, with no label.
export const ticketLines = (item: ParkedItem, columns: number): TicketLine[] => {
  const note = (item.note ?? '').trim()
  const body = ticketText(item)
  const inner = Math.max(4, columns - 2)
  const isReply = item.parkedBy === 'user'
  const noteRows: TicketLine[] =
    note === ''
      ? []
      : [
          { text: 'Your note:', isNote: false, color: 'warning' },
          ...wrap(note, inner).map((text, at) => ({
            text: `${at === 0 ? '❯' : ' '} ${text}`.padEnd(columns),
            isNote: true,
          })),
        ]
  const bodyRows: TicketLine[] =
    body === ''
      ? []
      : isReply
        ? [
            { text: 'Assistant reply:', isNote: false, color: 'cyan' },
            ...wrap(body, inner).map((text, at) => ({ text: `${at === 0 ? '●' : ' '} ${text}`, isNote: false })),
          ]
        : wrap(body, columns).map(text => ({ text, isNote: false }))

  return [
    ...noteRows,
    ...(noteRows.length > 0 && bodyRows.length > 0 ? [{ text: '', isNote: false }] : []),
    ...bodyRows,
  ]
}

// Every run the ledger keeps, as the one view `syncLedger` reads: the tasks of
// the runs under way, and the findings of all. A task id names one task among
// the runs under way and a finding's number one finding, so nothing clashes.
// With no run at all there is nothing: undefined when the ledger is not there.
export const mergedRuns = (
  runs: readonly LedgerRunSeen[] | null | undefined,
): LedgerRunSeen | null | undefined =>
  runs === null || runs === undefined
    ? undefined
    : runs.length === 0
      ? null
      : {
          goal: '',
          tasks: runs.filter(one => one.doneAt === undefined).flatMap(one => one.tasks),
          findings: runs.flatMap(one => one.findings),
        }

// A file reference as a place to show: its path, and its line (0 when the
// reference names the file alone). A column after the line is left out.
export const placeOfRef = (ref: string): { path: string; line: number } => {
  const at = /^(.*?):(\d+)(?::\d+)?$/.exec(ref.trim())

  return at === null ? { path: ref.trim(), line: 0 } : { path: at[1] ?? '', line: Number(at[2]) }
}
