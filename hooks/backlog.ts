import type { ParkedItem, ParkedKind, ParkedMessage, ParkedScope, ParkedSession } from '../types'
import type { LedgerFindingSeen, LedgerRunSeen } from '../types/ledger'
import { ICON, refIcon } from './kit/icons'

// What of the ledger's run has already been turned into items: the tasks whose
// gate stood failed, and the findings a review item has carried. An item is
// made when one of these changes, so one the user closed is not made again.
export type LedgerSeen = { gates: string[]; findings: number[] }

// One backlog holds every session's items. `seen` is what the ledger's run has
// been through in the one session a call is about; `ledger` keeps it for each
// session, and `sessions` is what the pane names each session by.
export type Backlog = {
  nextId: number
  items: ParkedItem[]
  seen?: LedgerSeen
  ledger?: Record<string, LedgerSeen>
  sessions?: Record<string, ParkedSession>
}

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
  project?: string
  source?: string
  now: number
}

export const isBacklog = (value: unknown): value is Backlog =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Backlog).nextId === 'number' &&
  Array.isArray((value as Backlog).items)

// The glyphs and their colours are the kit's, shared with lens and ledger.
export { ICON }

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
      body: tidyBody(item.body),
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
      ...(item.project ? { project: item.project } : {}),
      createdAt: item.now,
      ...(item.source ? { source: item.source } : {}),
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
  const fyi = open.filter(one => one.kind === 'fyi').length
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

import { ageOf } from './kit/layout'

export { ageOf }

// `from` names the session an item of another session was parked in.
export const describe = (item: ParkedItem, from = ''): string =>
  [
    `#${item.id} [${item.kind}] ${item.title}${item.status === 'done' ? ' (done)' : ''}${from === '' ? '' : ` (parked in ${from})`}`,
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

// What the user and the subagent said in a thread: the mod's own notes and the
// handover it keeps there are not part of the conversation.
const spoken = (item: ParkedItem) =>
  (item.thread ?? []).filter(one => one.role === 'you' || one.role === 'agent')

const INVESTIGATE = [
  'You are helping the user look into one parked item from a long orchestration session, in a side thread the main agent does not see.',
  'Investigate with your tools as far as the question needs, then answer the user directly and concisely. Do not change any files unless the user asks you to.',
]

// What a fresh subagent is told: the item, the thread so far and the new message.
// The line a briefing sent on its own, after the subagent started, opens with.
export const BRIEFING = 'Briefing from the main session, written for you from its full context:'

// With `isBriefComing`, the briefing is still being written and follows as a
// message: the subagent starts at once on what it can check itself.
export const investigationPrompt = (item: ParkedItem, text: string, brief = '', isBriefComing = false): string =>
  [
    ...INVESTIGATE,
    ...(isBriefComing
      ? [
          'A briefing from the main session, written from its full context, will reach you as a message within about half a minute. Start now with what you can check yourself, and take the briefing into account when it arrives.',
        ]
      : []),
    '',
    `Parked item #${item.id} [${item.kind}]: ${item.title}`,
    item.body,
    item.note ? `The user's note: ${item.note}` : '',
    ...(brief.trim() !== '' ? ['', BRIEFING, brief.trim()] : []),
    ...(spoken(item).length > 0
      ? ['', 'Earlier in this thread:', ...spoken(item).map(one => `${one.role === 'you' ? 'User' : 'You'}: ${one.text}`)]
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
    spoken(item)
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
// need the user (those blocking work first), then open FYIs, then what the
// assistant parked for itself, then the ten most recently parked done items.
export const orderOf = (items: readonly ParkedItem[]): ParkedItem[] => {
  const open = items.filter(one => one.status === 'open')

  return [
    ...open.filter(one => one.kind === 'needs-you' && one.isBlocking === true),
    ...open.filter(one => one.kind === 'needs-you' && one.isBlocking !== true),
    ...open.filter(one => one.kind === 'fyi'),
    ...open.filter(one => one.kind === 'self'),
    ...items.filter(one => one.status === 'done').slice(-10).reverse(),
  ]
}

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

const optionText = (item: ParkedItem, at: number) => `option ${at}, ${item.options?.[at - 1] ?? ''}`

// `text` is the answer as the main agent reads it. A silent answer is not sent
// at all: the user took the default of an item the agent had gone ahead on.
// What a subagent answers when a briefing that reached it after its reply
// changes nothing.
const NO_CHANGE = /^\W*no change\W*$/i

// What a briefing sent after the subagent started asks of it, should it reach
// the subagent once its answer is already given: one answer, not two.
export const BRIEFING_LATE =
  'If you had already given your answer when this reached you: give the whole answer again only if this briefing changes it, and otherwise reply with just the words NO CHANGE.'

// Adds a subagent's reply to a thread. A second reply to the same message of
// the user's is the first one thought again (a briefing reached the subagent
// after it had answered): it takes the first one's place, or is dropped when
// the subagent says nothing changed. The same reply arriving twice is kept once.
export const sayReply = (backlog: Backlog, id: number, message: ParkedMessage): Backlog | string => {
  const thread = backlog.items.find(one => one.id === id)?.thread ?? []
  const from = thread.findLastIndex(one => one.role === 'you') + 1
  const earlier = thread.findLastIndex((one, at) => at >= from && one.role === 'agent')

  if (earlier === -1) {
    return sayOnce(backlog, id, message)
  }

  if (NO_CHANGE.test(message.text) || gist(thread[earlier]?.text ?? '') === gist(message.text)) {
    return backlog
  }

  return {
    ...backlog,
    items: backlog.items.map(one =>
      one.id === id
        ? {
            ...one,
            thread: (one.thread ?? []).map((said, at) =>
              at === earlier ? { ...message, tools: [...(said.tools ?? []), ...(message.tools ?? [])] } : said,
            ),
          }
        : one,
    ),
  }
}

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

// How many lines of a file an item shows above and below the one referred to.
const PEEK_BEFORE = 6
const PEEK_AFTER = 30

// The part of a file an item shows for a reference: the lines around the one
// referred to, or its first lines when the reference names the file alone,
// within what one Code element draws.
export const excerptOf = (text: string, line: number): { start: number; source: string } => {
  const lines = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').split('\n')
  const start = Math.max(1, Math.min(line - PEEK_BEFORE, lines.length))
  const taken: string[] = []
  let size = 0

  for (const one of lines.slice(start - 1, start - 1 + PEEK_BEFORE + PEEK_AFTER + 1)) {
    // A line longer than the pane is wide is cut: a minified file is one line.
    const cut = one.length > 400 ? `${one.slice(0, 399)}…` : one

    if (size + cut.length + 1 > 9000) {
      break
    }

    taken.push(cut)
    size += cut.length + 1
  }

  return { start, source: taken.join('\n') }
}

// A text with the user's home folder written `~`, as a shell prompt has it.
// Only a whole folder name counts: `/Users/kim` is not shortened in
// `/Users/kimberly`.
export const tildeOf = (text: string, home: string): string =>
  home === '' || home === '/'
    ? text
    : text.split(home).reduce((joined, part) => `${joined}${/^[\w.-]/.test(part) ? home : '~'}${part}`)

// A body as the Markdown the pane draws. A model sometimes sends the two
// characters `\n` where it meant a line break: a body with no line break at
// all that holds them is read that way.
export const tidyBody = (body: string): string => {
  const text = body.replace(/\r\n?/g, '\n')
  const isEscaped = !text.includes('\n') && text.includes('\\n')

  return (isEscaped ? text.replace(/\\n/g, '\n').replace(/\\t/g, '  ') : text).trim()
}

const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

// A table row's cells, without the bars at its ends.
const cellsOf = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim().replace(/\\\|/g, '|'))

// A cell as plain text, for a table drawn in fixed columns.
const plain = (cell: string) => cell.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1')

// Markdown with its tables made to fit a pane. The Markdown element lays a
// table out for a width of its own, not the pane's, so in a narrow pane every
// row wraps and the grid is lost. A table that fits `width` is drawn here in
// fixed columns inside a code fence, where spacing is kept; one that does not
// becomes a list, each row an entry and each further cell a line named by its
// column. Tables inside a code fence are left alone.
export const fitTables = (text: string, width: number): string => {
  const lines = text.split('\n')
  const out: string[] = []
  let isFenced = false

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? ''

    if (/^\s*(```|~~~)/.test(line)) {
      isFenced = !isFenced
    }

    const rule = lines[at + 1] ?? ''

    if (isFenced || !line.includes('|') || !rule.includes('-') || !TABLE_RULE.test(rule)) {
      out.push(line)

      continue
    }

    const head = cellsOf(line)
    const rows: string[][] = []
    let end = at + 2

    for (; end < lines.length && (lines[end] ?? '').includes('|') && (lines[end] ?? '').trim() !== ''; end += 1) {
      rows.push(cellsOf(lines[end] ?? ''))
    }

    const all = [head, ...rows].map(row => head.map((_, column) => plain(row[column] ?? '')))
    const widths = head.map((_, column) => Math.max(...all.map(row => (row[column] ?? '').length)))
    const fits = widths.reduce((sum, one) => sum + one, 0) + 3 * (head.length - 1) <= width

    if (fits) {
      const drawn = all.map(row => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' │ ').trimEnd())

      out.push('```', drawn[0] ?? '', widths.map(one => '─'.repeat(one)).join('─┼─'), ...drawn.slice(1), '```')
    } else {
      for (const row of rows) {
        out.push(`- **${row[0] ?? ''}**`)
        out.push(
          ...head.flatMap((name, column) =>
            column === 0 || (row[column] ?? '') === '' ? [] : [`  - ${name === '' ? '' : `${name}: `}${row[column]}`],
          ),
        )
      }
    }

    at = end - 1
  }

  return out.join('\n')
}

// The most one Markdown element draws is 10000 characters.
const MARKDOWN_MOST = 9000

// A text as the pieces Markdown elements draw, one each: cut at a blank line
// where there is one, else at a line's end, and free of the control characters
// an element refuses.
export const markdownOf = (text: string, most = MARKDOWN_MOST): string[] => {
  const chunks: string[] = []
  let rest = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')

  while (rest.length > most) {
    const blank = rest.lastIndexOf('\n\n', most)
    const line = rest.lastIndexOf('\n', most)
    const at = blank > most / 2 ? blank : line > most / 2 ? line : most

    chunks.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^\n+/, '')
  }

  return rest.trim() === '' ? chunks : [...chunks, rest]
}

// Where a session is and what it is asking about: its id and its project root.
export type Here = { sessionId: string; project: string }

// The items a scope lists: this session's, those of every session in this
// project, or all of them.
export const inScope = (items: readonly ParkedItem[], scope: ParkedScope, here: Here): ParkedItem[] =>
  items.filter(
    one =>
      scope === 'all' ||
      one.sessionId === here.sessionId ||
      (scope === 'project' && one.project !== undefined && one.project === here.project),
  )

const SCOPES: readonly ParkedScope[] = ['session', 'project', 'all']

export const nextScope = (scope: ParkedScope): ParkedScope =>
  SCOPES[(SCOPES.indexOf(scope) + 1) % SCOPES.length] ?? 'session'

// What the pane calls a session: the name /resume lists it under, or the start
// of its id while it has none.
export const sessionLabel = (
  sessions: Readonly<Record<string, ParkedSession>> | undefined,
  sessionId: string,
): string => {
  const name = sessions?.[sessionId]?.name ?? ''

  return name !== '' ? name : `session ${sessionId.slice(0, 8)}`
}

// Records what a session is called and where it runs. Answers the same backlog
// when it already says so.
export const knowSession = (
  backlog: Backlog,
  sessionId: string,
  seen: { name: string; project: string; transcript?: string },
  now: number,
): Backlog => {
  const known = backlog.sessions?.[sessionId]
  // A name once found is kept when a later look finds none.
  const name = seen.name !== '' ? seen.name : (known?.name ?? '')
  const transcript = seen.transcript ?? known?.transcript

  if (known !== undefined && known.name === name && known.project === seen.project && known.transcript === transcript) {
    return backlog
  }

  return {
    ...backlog,
    sessions: {
      ...backlog.sessions,
      [sessionId]: { name, project: seen.project, ...(transcript !== undefined ? { transcript } : {}), seenAt: now },
    },
  }
}

// What `grep -o -E` is given to find a transcript's title rows, and the name
// they give a session: the one the user set, else the one Claude Code made.
export const TITLE_ROWS = '"type":"(custom-title|agent-name|ai-title)","[A-Za-z]+":"([^"\\\\]|\\\\.)*"'

export const sessionNameOf = (found: string): string => {
  const names: Record<string, string> = {}

  for (const line of found.split('\n')) {
    try {
      const row: Record<string, unknown> = JSON.parse(`{${line}}`)
      const name = Object.entries(row).find(([key]) => key !== 'type')?.[1]

      if (typeof row.type === 'string' && typeof name === 'string' && name.trim() !== '') {
        names[row.type] = name.trim()
      }
    } catch {
      // Not a title row.
    }
  }

  return names['custom-title'] ?? names['agent-name'] ?? names['ai-title'] ?? ''
}

// The backlog before this one was kept per folder. Those are joined into one,
// oldest item first and numbered afresh, each item keeping its folder as its
// project and each session what the ledger had been through.
export const migrate = (old: readonly (readonly [project: string, backlog: Backlog])[]): Backlog => {
  const items = old
    .flatMap(([project, backlog]) => backlog.items.map(one => ({ ...one, project: one.project ?? project })))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((one, at) => {
      // A subagent belongs to the session that started it, long over.
      const { agentId: _a, ...rest } = one

      return { ...rest, id: at + 1 }
    })
  const ledger = Object.fromEntries(
    old.flatMap(([, backlog]) => {
      const seen = backlog.seen

      return seen === undefined ? [] : backlog.items.map(one => [one.sessionId, seen] as const)
    }),
  )

  return { nextId: items.length + 1, items, ...(Object.keys(ledger).length > 0 ? { ledger } : {}) }
}

// `syncLedger` for the one session whose ledger changed: its items alone are
// brought in step, and every other session's are left as they are.
export const syncSession = (
  backlog: Backlog,
  run: LedgerRunSeen | null | undefined,
  now: number,
  here: Here,
): Backlog => {
  const seen = backlog.ledger?.[here.sessionId]
  const mine: Backlog = {
    nextId: backlog.nextId,
    items: backlog.items.filter(one => one.sessionId === here.sessionId),
    ...(seen !== undefined ? { seen } : {}),
  }
  const after = syncLedger(mine, run, now, here.sessionId)

  if (after === mine) {
    return backlog
  }

  return {
    ...backlog,
    nextId: after.nextId,
    items: [
      ...backlog.items.filter(one => one.sessionId !== here.sessionId),
      ...after.items.map(one => (one.project === undefined && here.project !== '' ? { ...one, project: here.project } : one)),
    ].sort((a, b) => a.id - b.id),
    ...(after.seen !== undefined ? { ledger: { ...backlog.ledger, [here.sessionId]: after.seen } } : {}),
  }
}

// A reference as the file it names: a path that is not absolute is from the
// project the item was parked in, which need not be the folder the session is
// in now, and `~` is the user's home.
export const pathOfRef = (item: ParkedItem, ref: string, home: string): string => {
  const named = placeOfRef(ref).path
  const isFromProject = item.project !== undefined && !/^[/~]/.test(named)

  return (isFromProject ? `${item.project}/${named}` : named).replace(/^~(?=\/|$)/, home)
}

// Puts items back as they were before something was done to them, by id.
// Answers which of them had an answer the agent has already been told: taking
// the item back does not take that back.
export const restore = (
  backlog: Backlog,
  before: readonly ParkedItem[],
): { backlog: Backlog; told: number[] } => {
  const was = new Map(before.map(one => [one.id, one]))
  const told = backlog.items
    .filter(one => was.has(one.id) && one.answer !== undefined && one.isUnsent !== true && !/^You accepted the default/.test(one.resolution ?? ''))
    .map(one => one.id)

  return { backlog: { ...backlog, items: backlog.items.map(one => was.get(one.id) ?? one) }, told }
}

// The open items whose answer can be the agent's own pick: a choice with a
// default. Taking them all is one press after a run left unattended.
export const defaultsOf = (items: readonly ParkedItem[]): ParkedItem[] =>
  items.filter(one => one.status === 'open' && one.kind === 'needs-you' && one.preferred !== undefined)

// What a session is told as it opens with items of its own waiting: how many
// need the user, and how long the oldest has waited. Nothing when none does.
export const digestOf = (items: readonly ParkedItem[], now: number): string | undefined => {
  const needs = items.filter(one => one.status === 'open' && one.kind === 'needs-you')
  const blocking = needs.filter(one => one.isBlocking === true).length

  if (needs.length === 0) {
    return undefined
  }

  const oldest = Math.min(...needs.map(one => one.createdAt))

  return `Parked: ${needs.length} need${needs.length === 1 ? 's' : ''} your attention${blocking > 0 ? `, ${blocking} blocking` : ''}, the oldest for ${ageOf(oldest, now)}. /parked shows them.`
}

// What the agent is asked when the user hands it its own list to work through.
export const workPrompt = (own: readonly ParkedItem[]): string =>
  [
    `Go through the ${own.length === 1 ? 'item' : `${own.length} items`} you parked for yourself, now:`,
    ...own.map(one => `- #${one.id} ${one.title}`),
    'Read each in full with the list tool first. Do the ones you can and resolve each as it is done. For one you cannot do yet, say what it is waiting on and leave it open.',
  ].join('\n')

// What a tool call gave back, as the one line a thread shows under the call:
// its first line, and how many more there were. The result is a tool_result's
// content: text, or blocks of which the text ones count.
export const resultLine = (content: unknown): string => {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map(block => (typeof block === 'object' && block !== null && 'text' in block ? String(block.text) : ''))
            .join('\n')
        : ''
  const lines = text
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .split('\n')
    .filter(line => line.trim() !== '')
  const first = (lines[0] ?? '').trim()

  if (first === '') {
    return '(nothing)'
  }

  return `${first.length > 90 ? `${first.slice(0, 89)}…` : first}${lines.length > 1 ? ` (+${lines.length - 1} lines)` : ''}`
}

// What the assistant parked for itself in a session and has not done.
export const ownOpen = (items: readonly ParkedItem[], sessionId: string): ParkedItem[] =>
  items.filter(one => one.kind === 'self' && one.status === 'open' && one.sessionId === sessionId)

// How many prompts may pass before the assistant is reminded of them again.
const REMIND_EVERY = 6

// Whether a turn should open with a reminder: when the list is not the one
// last reminded of, or enough prompts have passed since.
export const isReminderDue = (
  own: readonly ParkedItem[],
  last: { ids: string; turns: number },
): boolean => own.length > 0 && (own.map(one => one.id).join(',') !== last.ids || last.turns >= REMIND_EVERY)

// The reminder itself, a note only the assistant reads.
export const reminderOf = (own: readonly ParkedItem[]): string =>
  [
    `You parked ${own.length === 1 ? 'this' : 'these'} for yourself and ${own.length === 1 ? 'it is' : 'they are'} still open:`,
    ...own.map(one => `- #${one.id} ${one.title}`),
    'This is a reminder, not a request from the user. Come back to them when the current work allows, resolve each one as it is done, and do not report the work finished while one is open without saying so.',
  ].join('\n')

// How many done items are kept; the pane lists the newest ten.
const DONE_KEPT = 200

// Drops the done items closed longest ago once there are more than are kept,
// so the store, which holds every session's, stays small.
export const pruned = (backlog: Backlog): Backlog => {
  const done = backlog.items.filter(one => one.status === 'done')

  if (done.length <= DONE_KEPT) {
    return backlog
  }

  const dropped = new Set(
    done
      .sort((a, b) => (a.resolvedAt ?? a.createdAt) - (b.resolvedAt ?? b.createdAt))
      .slice(0, done.length - DONE_KEPT)
      .map(one => one.id),
  )

  return { ...backlog, items: backlog.items.filter(one => !dropped.has(one.id)) }
}

// The handover a thread's subagent starts with, as the user reads it in the
// thread: its instructions, the briefing and their message. The ticket itself
// is in view above, so it is named and not repeated.
export const handoverOf = (item: ParkedItem, text: string, brief: string): string =>
  [
    ...INVESTIGATE,
    '',
    `**Ticket:** #${item.id} ${item.title}, with its full text${item.note ? ' and your note' : ''}.`,
    '',
    '**Briefing from the main session**, sent to the subagent as a follow-up once it was written:',
    '',
    brief.trim() !== ''
      ? brief.trim()
      : '_None: the main session had no context to give, so the subagent has the ticket only._',
    ...((item.thread ?? []).some(one => one.role === 'agent') ? ['', '**Earlier in this thread:** every message so far.'] : []),
    '',
    `**Your message:** ${text}`,
  ].join('\n')

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '', b: '', f: '' }

// The string values in a piece of JSON that may stop anywhere, each decoded;
// the last may be unfinished. A tool call's arguments arrive that way, and a
// subagent's report is one of them.
export const stringsIn = (json: string): string[] => {
  const found: string[] = []
  let at = 0

  while (at < json.length) {
    if (json[at] !== '"') {
      at += 1

      continue
    }

    let end = at + 1
    let text = ''

    for (; end < json.length && json[end] !== '"'; end += 1) {
      const mark = json[end + 1]

      if (json[end] !== '\\') {
        text += json[end]
      } else if (mark === undefined || (mark === 'u' && end + 6 > json.length)) {
        // An escape cut short: the text stops before it.
        end = json.length
      } else if (mark === 'u') {
        text += String.fromCharCode(Number.parseInt(json.slice(end + 2, end + 6), 16))
        end += 5
      } else {
        text += ESCAPES[mark] ?? mark
        end += 1
      }
    }

    // A value follows a colon; any other string is a key.
    if (json.slice(Math.max(0, at - 8), at).trimEnd().endsWith(':')) {
      found.push(text)
    }

    at = end + 1
  }

  return found
}

// A tool call as a thread's row names it, as the transcript does: the tool and
// the first of its arguments, `Read(src/queue.ts)`. The arguments may still be
// arriving. A plugin's or a server's tool goes by its own name.
export const callLabel = (name: string, json: string): string => {
  const first = (stringsIn(json)[0] ?? '').replace(/\s+/g, ' ').trim()
  const tool = name.replace(/^mcp__(.+?)__/, '$1: ')

  return first === '' ? tool : `${tool}(${first.length > 70 ? `${first.slice(0, 69)}…` : first})`
}

// The report in a hand-back call's arguments so far: its longest text.
export const reportIn = (json: string): string =>
  stringsIn(json).reduce((longest, one) => (one.length > longest.length ? one : longest), '')
