import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ParkedItem } from '../types'
import { PAD } from './kit/layout'
import {
  EMPTY,
  ICON,
  ageOf,
  answer,
  answerOf,
  answersNote,
  sent,
  ticketParts,
  ticketLines,
  mergedRuns,
  placeOfRef,
  syncLedger,
  unsend,
  unsentOf,
  orderOf,
  briefRequest,
  describe,
  doneNote,
  handoff,
  investigationPrompt,
  isBacklog,
  park,
  reopen,
  resolve,
  say,
  sayOnce,
  statusText,
  threadLines,
  summaryRequest,
  titleOf,
  wrap,
} from './backlog'
import type { Backlog } from './backlog'

const PANE = 'parked'
const PARK = 'mcp__parked__park'
const RESOLVE = 'mcp__parked__resolve'
const LIST = 'mcp__parked__list_parked'

const items = atom({ plugin: 'parked', key: 'items' } as const, [])
// The id of the item the pane shows in full; 0 while it shows the list.
const selected = atom({ plugin: 'parked', key: 'selected' } as const, 0)
// The ids of the items whose side thread awaits its subagent's reply.
const pending = atom({ plugin: 'parked', key: 'pending' } as const, [])
// The detail view scrolls its two regions itself: rows the thread is scrolled
// up from its newest message, and rows the ticket is scrolled down from its top.
const back = atom({ plugin: 'parked', key: 'back' } as const, 0)
const top = atom({ plugin: 'parked', key: 'top' } as const, 0)
// Where the last drawing put the ticket, and how far each region can move.
// Whether the detail view is the keyboard view (a Client region) where the surface has one.
const lab = atom({ plugin: 'parked', key: 'lab' } as const, true)
let layout = { ticketStart: 0, ticketEnd: 0, maxTop: 0, maxBack: 0 }
// The last key pressed on one of the pane's own letter buttons, and how many
// have been: the keyboard region answers each new count as a key of its own.
const nudge = atom({ plugin: 'parked', key: 'nudge' } as const, { key: '', n: 0 })
// Whether the composer, the pane's own text field, has the focus ring.
const typing = atom({ plugin: 'parked', key: 'typing' } as const, false)
const typingAt = atom({ plugin: 'parked', key: 'typingAt' } as const, 0)
// What the keyboard region or a letter button has typed for the composer while
// the text field itself did not have the keyboard; the field is drawn with it.
const draft = atom({ plugin: 'parked', key: 'draft' } as const, '')
// Whether what the composer sends is the user's answer for the main agent,
// not a question for the side thread's subagent.
const answering = atom({ plugin: 'parked', key: 'answering' } as const, false)
// The place last asked to be shown: the lens mod, where loaded, opens it.
const jump = atom({ plugin: 'parked', key: 'jump' } as const, null)
// Which of an item's file references the next "go" opens, by item.
const goAt = new Map<number, number>()

// How long after the last answer the batch of them is sent, so several items
// answered in a row reach the main agent as one message.
const FLUSH_MS = 3000
// Whether the main loop is in a turn; a subagent's run raises no `turn.start`.
let isRunning = false
// The timer that sends the batch of answers, while one is waiting.
let flushTimer: { cancel: () => void } | undefined

// The thread's input is keyed by how many messages the user has sent, so each
// send draws a fresh, empty field.
const askKey = (item: ParkedItem) =>
  `ask-${item.id}-${(item.thread ?? []).filter(one => one.role === 'you').length}`

const GUIDE = `# Parked items

This session has a backlog of parked items the user reviews later in a pane, often after leaving the session unattended. Keep it current with the ${PARK}, ${RESOLVE} and ${LIST} tools.

Park an item with kind "needs-you" for: a decision you deferred to the user, a question you could not answer, a blocker, or a finding the user must act on.
Park an item with kind "fyi" for: a completed job worth knowing about, a notable finding, or an assumption you made on the user's behalf.
Park one item per distinct thing to address, not one per report. Give each a short title and a body that stands on its own: what is needed from the user and the relevant findings. Do not park routine progress.
When an item is a choice, give "options" (short labels, nine at most) and "default", the number of the one you would pick; the user sees that one listed first, as option 1. Set "blocking" to true only when no remaining work can go on without the answer; otherwise go ahead on your default and leave the item open for the user to accept or overturn. Name the places an item is about in "refs", each a path or path:line.
The user's answers arrive as a prompt that begins "My answers to parked items", and each answered item is already done: do not resolve it again. An answer that differs from your default replaces it, so revise what you built on the default.
When the user has addressed an item in conversation, call ${RESOLVE} with its id and a one-line record of the outcome.
Call ${LIST} when resuming work or when unsure what is open.`

// Who parked an item, and the ledger task or unit it belongs to ('' for none).
const parkerOf = (item: ParkedItem) =>
  item.origin !== undefined ? 'the ledger' : item.parkedBy === 'user' ? 'you' : 'the agent'
const tagOf = (item: ParkedItem) =>
  item.origin?.kind === 'review' ? item.origin.unit : (item.task ?? '')

const SUBAGENT_REFUSAL =
  'Only the main agent parks items. Report this finding to the orchestrator in your final answer instead.'

const keyOf = async ($: EngineInterface) => `backlog:${await $.session.cwd()}`

const load = async ($: EngineInterface): Promise<Backlog> => {
  const stored = await $.store.get(await keyOf($))

  return isBacklog(stored) ? stored : EMPTY
}

const show = async ($: EngineInterface, backlog: Backlog) => {
  await update($, items, () => backlog.items)
  $.ui.status(statusText(backlog.items))
}

// Reads the stored backlog, applies the change and writes it back; answers
// the reason when the change was refused or the store failed.
const changeNow = async (
  $: EngineInterface,
  apply: (backlog: Backlog) => Backlog | string,
): Promise<{ backlog: Backlog } | { error: string }> => {
  try {
    const after = apply(await load($))

    if (typeof after === 'string') {
      return { error: after }
    }

    await $.store.set(await keyOf($), after)
    await show($, after)

    return { backlog: after }
  } catch (error) {
    const reason = `Parked items could not be saved: ${error instanceof Error ? error.message : String(error)}`
    $.ui.toast(reason)

    return { error: reason }
  }
}

// One change at a time. Two hooks recording the same reply would otherwise
// both read the backlog before either wrote it, and both would add it.
let changes: Promise<unknown> = Promise.resolve()

const change = (
  $: EngineInterface,
  apply: (backlog: Backlog) => Backlog | string,
): Promise<{ backlog: Backlog } | { error: string }> => {
  const run = changes.then(() => changeNow($, apply))
  changes = run.catch(() => undefined)

  return run
}

// The main session's briefing for an item's subagent: one tool-less question
// over the session's own transcript, which the main conversation never sees.
// Empty when the session has nothing to fork or the call fails.
const briefOf = async ($: EngineInterface, item: ParkedItem): Promise<string> => {
  try {
    const reply = await $.model.fork({ prompt: briefRequest(item) })

    return reply.isAnswered ? reply.text.trim() : ''
  } catch {
    return ''
  }
}

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean).length

// Sends the user's message to the item's subagent: the one already on the
// thread while this session still has it, else a fresh one given the thread.
const ask = async ($: EngineInterface, item: ParkedItem, text: string) => {
  const settle = () => update($, pending, list => list.filter(id => id !== item.id))
  const fail = async (reason: string) => {
    const at = await $.clock.now()
    await change($, backlog => say(backlog, item.id, { role: 'agent', text: reason, at }))
    await settle()
  }

  try {
    const at = await $.clock.now()
    const said = await change($, backlog => say(backlog, item.id, { role: 'you', text, at }))

    if ('error' in said) {
      return
    }

    await update($, pending, list => [...list.filter(id => id !== item.id), item.id])
    const next = said.backlog.items.find(one => one.id === item.id)

    if (next !== undefined) {
      void $.ui.focus({ requestId: PANE, key: askKey(next) }).catch(() => undefined)
    }

    if (item.agentId !== undefined) {
      const sent = await $.session.send({ to: { agentId: item.agentId }, text })

      if (sent.isDelivered) {
        return
      }
    }

    const brief = await briefOf($, item)
    const noted = await $.clock.now()
    await change($, backlog =>
      say(backlog, item.id, {
        role: 'note',
        text:
          brief !== ''
            ? `The subagent was briefed from the main session (${wordsOf(brief)} words).`
            : 'No briefing: the main session had no context to give. The subagent has the ticket only.',
        at: noted,
      }),
    )

    const spawned = await $.agent.spawn({
      prompt: investigationPrompt(item, text, brief),
      description: `Parked #${item.id}: ${item.title}`.slice(0, 60),
    })

    if (spawned.agentId === undefined) {
      await fail(`The subagent could not start: ${spawned.deny ?? 'no reason given'}`)

      return
    }

    const agentId = spawned.agentId
    await change($, backlog => ({
      ...backlog,
      items: backlog.items.map(one => (one.id === item.id ? { ...one, agentId } : one)),
    }))
  } catch (error) {
    await fail(`The subagent could not be reached: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// A subagent's report, read from its own transcript: it hands its report back
// through a tool call, so its turn can end with no visible answer.
const reportOf = async ($: EngineInterface, agentId: string): Promise<string> => {
  const rows = await $.session.messages({ agentId })

  if (!Array.isArray(rows)) {
    return ''
  }

  for (const row of [...rows].reverse()) {
    if (row.role !== 'assistant') {
      continue
    }

    const handback = row.toolUses.findLast(use => /handback/i.test(use.tool))
    // The report is the hand-back's longest text argument.
    const report = Object.values(handback?.input ?? {})
      .filter((value): value is string => typeof value === 'string')
      .sort((a, b) => b.length - a.length)[0]

    if (report !== undefined && report.trim() !== '') {
      return report.trim()
    }

    if (row.text.trim() !== '') {
      return row.text.trim()
    }
  }

  return ''
}

const goTo = async ($: EngineInterface, id: number) => {
  await update($, back, () => 0)
  await update($, draft, () => '')
  await update($, answering, () => false)
  await update($, top, () => 0)
  await update($, selected, () => id)
}

// Gives the pane's text field the focus ring, so what is typed lands in it,
// clicked or not.
const focusComposer = async ($: EngineInterface, item: ParkedItem) => {
  // The ring may still be resting on the text field from an earlier
  // visit, the region having taken the keys with a click since. Focusing
  // where the ring already is moves nothing, so it goes to the letter
  // row first: the move back is what hands the field the keyboard.
  await $.ui.focus({ requestId: PANE, key: 'key-k' }).catch(() => undefined)
  await $.ui.focus({ requestId: PANE, key: askKey(item) }).catch(() => undefined)
  // A new visit, whether or not the ring reported a move.
  await update($, typing, () => true)
  await update($, typingAt, count => count + 1)
}

// Tells the main agent every answer it has not had, as one message. While a
// turn runs the message goes into the prompt box, where the user's Enter
// delivers it into that turn; a prompt a plugin submits waits for the turn's end.
const flush = async ($: EngineInterface) => {
  // The answers given in this session are taken and marked sent in one change,
  // before they are delivered: a second flush that starts while this one waits
  // on the prompt finds none of them and so cannot send them again.
  const sessionId = await $.session.id()
  let list: ParkedItem[] = []
  await change($, backlog => {
    list = unsentOf(backlog.items, sessionId)

    return sent(backlog, list.map(one => one.id))
  })

  if (list.length === 0) {
    return
  }

  try {
    await deliver($, list)
  } catch (error) {
    // Not delivered: they are unsent again, for the next flush to take.
    await change($, backlog => unsend(backlog, list.map(one => one.id)))
    throw error
  }
}

const deliver = async ($: EngineInterface, list: readonly ParkedItem[]) => {
  const text = answersNote(list)
  const count = `${list.length} answer${list.length === 1 ? '' : 's'}`
  let isFilled = false

  if (isRunning) {
    const box = await $.prompt.read().then(
      read => read.text,
      () => '',
    )
    const lead = box === '' || box.endsWith('\n') ? '' : '\n'
    isFilled = await $.prompt.fill({ text: `${lead}${text}\n`, mode: 'append' }).then(
      filled => filled.isFilled,
      () => false,
    )
  }

  if (!isFilled) {
    await $.prompt.submit({ text })
  }

  $.ui.toast(
    isFilled
      ? `Parked: ${count} in the prompt box. Press Enter to send into the running turn.`
      : `Parked: ${count} sent to the main agent.`,
  )
}

// Sends the batch of answers once no new one has come for FLUSH_MS.
const queueFlush = ($: EngineInterface) => {
  flushTimer?.cancel()
  flushTimer = $.clock.after(FLUSH_MS, () => {
    flushTimer = undefined
    void flush($).catch(() => undefined)
  })
}

// Answers the open item for the user: an option by its number, or their words.
const respond = async ($: EngineInterface, item: ParkedItem, value: number | string) => {
  const made = answerOf(item, value)

  if (typeof made === 'string') {
    $.ui.toast(made)

    return
  }

  const order = orderOf(await read($, items))
  const when = await $.clock.now()
  const sessionId = await $.session.id()
  const changed = await change($, backlog => answer(backlog, item.id, value, when, sessionId))

  if ('error' in changed) {
    $.ui.toast(changed.error)

    return
  }

  if (made.isSilent) {
    $.ui.toast(`Parked #${item.id}: default accepted. The agent already went that way.`)
  } else {
    $.ui.toast(`Parked #${item.id}: answer queued for the main agent.`)
    queueFlush($)
  }

  // On to the next open item, or back to the list when none is left.
  const following = order.find(one => one.status === 'open' && one.id !== item.id)
  await goTo($, following?.id ?? 0)
}

// A side thread in a few lines, written by a small model. Empty when the call
// fails, and the hand-off then falls back to the start of the last reply.
const summaryOf = async ($: EngineInterface, item: ParkedItem): Promise<string> => {
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      prompt: summaryRequest(item),
      maxTokens: 400,
      timeoutMs: 30000,
    })

    return reply.isAnswered ? reply.text.trim() : ''
  } catch {
    return ''
  }
}

// What the composer sends: the user's answer for the main agent while they are
// answering, else a question for the side thread's subagent.
const send = async ($: EngineInterface, item: ParkedItem, text: string) => {
  if (await read($, answering)) {
    await respond($, item, text)
  } else {
    await ask($, item, text)
  }
}

// Runs one action on the open item.
const perform = async ($: EngineInterface, item: ParkedItem, act: string) => {
  const order = orderOf(await read($, items))
  const at = order.findIndex(one => one.id === item.id)

  if (act === 'prev' || act === 'next') {
    const to = order[at + (act === 'next' ? 1 : -1)]

    if (to !== undefined) {
      await goTo($, to.id)
    }
  } else if (act === 'done' && item.status === 'open') {
    const when = await $.clock.now()
    await change($, backlog => resolve(backlog, item.id, doneNote(item), 'user', when))
    // On to the next open item, or back to the list when none is left.
    const following = order.find(one => one.status === 'open' && one.id !== item.id)
    await goTo($, following?.id ?? 0)
  } else if (act === 'accept' && item.status === 'open' && item.preferred !== undefined) {
    await respond($, item, item.preferred)
  } else if (/^pick-[1-9]$/.test(act) && item.status === 'open') {
    await respond($, item, Number(act.slice(5)))
  } else if (act === 'go' && (item.refs ?? []).length > 0) {
    // Each press asks for the next of the item's places, round and round.
    const refs = item.refs ?? []
    const at = (goAt.get(item.id) ?? 0) % refs.length
    const place = placeOfRef(refs[at] ?? '')

    goAt.set(item.id, at + 1)
    await update($, jump, last => ({ ...place, n: (last?.n ?? 0) + 1 }))
    $.ui.toast(
      `Parked #${item.id}: ${refs[at]} asked of lens${refs.length > 1 ? ` (${at + 1} of ${refs.length})` : ''}`,
    )
  } else if (act === 'write' && item.status === 'open') {
    await focusComposer($, item)
    await update($, answering, () => true)
  } else if (act === 'reopen') {
    await change($, backlog => reopen(backlog, item.id))
  } else if (act === 'send' && (item.thread ?? []).some(one => one.role === 'agent')) {
    $.ui.toast(`Parked #${item.id}: summarising the thread for the main agent…`)
    await $.prompt.submit({ text: handoff(item, await summaryOf($, item)) })
    $.ui.toast(`Parked #${item.id}: findings sent to the main agent.`)
  } else if (act === 'back') {
    await goTo($, 0)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Answers a reload or a restart left unsent go out with the next batch.
    queueFlush($)

    await $.command.register({
      name: 'park',
      description: "Park a note, or the assistant's last reply: /park <note> · /park · /park + <note> for both",
    })
    await $.command.register({
      name: 'parked',
      description: 'Show parked items in a pane',
    })
    await $.tool.register({
      name: 'park',
      description:
        'Park an item for the user to review later. Use kind "needs-you" for decisions, unanswered questions, blockers and findings the user must act on; "fyi" for completed jobs, notable findings and assumptions made on their behalf.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['needs-you', 'fyi'] },
          title: { type: 'string', description: 'One line naming the item' },
          body: {
            type: 'string',
            description: 'What is needed from the user and the relevant findings; must stand on its own',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 9,
            description: 'For a choice: a short label per option, which the user picks by number',
          },
          default: {
            type: 'integer',
            description: 'The number of the option you would pick, 1 for the first',
          },
          blocking: {
            type: 'boolean',
            description:
              'True only when no remaining work can go on without the answer; otherwise proceed on your default',
          },
          refs: {
            type: 'array',
            items: { type: 'string' },
            description: 'The places the item is about, each a path or path:line',
          },
          task: {
            type: 'string',
            description: 'The id of the ledger task the item belongs to, when the ledger has a run',
          },
        },
        required: ['kind', 'title', 'body'],
      },
    })
    await $.tool.register({
      name: 'resolve',
      description: 'Mark a parked item done once the user has addressed it.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          resolution: { type: 'string', description: 'One line on how it was addressed' },
        },
        required: ['id', 'resolution'],
      },
    })
    await $.tool.register({
      name: 'list_parked',
      description: 'List the parked items of this project: open ones, and done ones if asked.',
      inputSchema: {
        type: 'object',
        properties: { includeDone: { type: 'boolean' } },
      },
    })

    try {
      await show($, await load($))
    } catch {
      $.ui.toast('Parked items could not be loaded.')
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [
        ...composed.sections,
        { id: 'parked:guide', text: GUIDE, scope: 'session' },
      ],
    }
  })

  on('tool.call', { tool: PARK }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { deny: SUBAGENT_REFUSAL }
    }

    const { kind, title, body } = e

    if (
      (kind !== 'needs-you' && kind !== 'fyi') ||
      typeof title !== 'string' ||
      typeof body !== 'string' ||
      title.trim() === ''
    ) {
      return { deny: 'park needs kind ("needs-you" or "fyi"), a title and a body.' }
    }

    const texts = (value: unknown) =>
      Array.isArray(value) && value.every(one => typeof one === 'string' && one.trim() !== '')
        ? value.map(one => String(one).trim())
        : undefined
    const options = e.options === undefined ? [] : texts(e.options)
    const refs = e.refs === undefined ? [] : texts(e.refs)
    const preferred = e.default

    if (options === undefined || options.length > 9 || refs === undefined) {
      return { deny: 'park takes options as at most nine short labels, and refs as paths or path:line.' }
    }

    if (
      preferred !== undefined &&
      (typeof preferred !== 'number' || !Number.isInteger(preferred) || preferred < 1 || preferred > options.length)
    ) {
      return { deny: `park takes default as the number of one of its ${options.length} options, 1 for the first.` }
    }

    const sessionId = await $.session.id()
    const now = await $.clock.now()
    const changed = await change($, backlog =>
      park(backlog, {
        kind,
        title: title.trim(),
        body,
        options,
        ...(typeof preferred === 'number' ? { preferred } : {}),
        isBlocking: e.blocking === true,
        ...(typeof e.task === 'string' && e.task.trim() !== '' ? { task: e.task.trim() } : {}),
        refs,
        parkedBy: 'model',
        sessionId,
        now,
      }),
    )

    if ('error' in changed) {
      return { deny: changed.error }
    }

    return { result: `Parked as #${changed.backlog.nextId - 1}.` }
  })

  on('tool.call', { tool: RESOLVE }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { deny: SUBAGENT_REFUSAL }
    }

    const { id, resolution } = e

    if (typeof id !== 'number' || typeof resolution !== 'string') {
      return { deny: 'resolve needs a numeric id and a resolution.' }
    }

    const now = await $.clock.now()
    const changed = await change($, backlog => resolve(backlog, id, resolution, 'model', now))

    return 'error' in changed ? { deny: changed.error } : { result: `Resolved #${id}.` }
  })

  on('tool.call', { tool: LIST }, async ($, e) => {
    const backlog = await load($)
    const list = backlog.items.filter(one => e.includeDone === true || one.status === 'open')

    return {
      result: list.length === 0 ? 'No parked items.' : list.map(describe).join('\n\n'),
    }
  })

  // The ledger mod, where it is loaded, changed its run: a failed gate and a
  // unit's open findings become items here, and close as the run moves on.
  on('state.set', { plugin: 'ledger', key: 'runs' }, async ($, e, next) => {
    const written = await next(e)
    // Every run under way counts, not only the one planned last.
    const seenRun = mergedRuns(e.value)
    const sessionId = await $.session.id()
    const now = await $.clock.now()
    const before = await load($)

    // Most changes of a run (a spawn, a token count) alter no item.
    if (syncLedger(before, seenRun, now, sessionId) !== before) {
      await change($, backlog => syncLedger(backlog, seenRun, now, sessionId))
    }

    return written
  })

  on('turn.start', async ($, e, next) => {
    isRunning = true

    return next(e)
  })

  // A thread's subagent finished a run: its answer is the thread's next message.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isRunning = false
    }

    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const item = (await load($)).items.find(one => one.agentId === agentId)

      if (item !== undefined) {
        const at = await $.clock.now()
        const found = e.answer.trim() !== '' ? e.answer.trim() : await reportOf($, agentId).catch(() => '')
        const text = found !== '' ? found : `(The subagent stopped without a report: ${e.reason}.)`
        await change($, backlog => sayOnce(backlog, item.id, { role: 'agent', text, at }))
        await update($, pending, list => list.filter(id => id !== item.id))
        $.ui.toast(`Parked #${item.id}: the subagent replied.`)
      }
    }

    return next(e)
  })

  // A thread's subagent also reports to the main conversation when it stops:
  // its hand-back message, then a task notification, each a prompt of its own.
  // The thread is private, so both are dropped before they start a turn.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind

    if (kind !== 'peer' && kind !== 'peer-send-message' && kind !== 'task-notification') {
      return next(e)
    }

    const item = (await load($)).items.find(
      one => one.agentId !== undefined && e.text.includes(one.agentId),
    )

    if (item === undefined) {
      return next(e)
    }

    // The hand-back carries the full report; keep it when the thread lacks it.
    const report = (e.text.split('The report follows:')[1] ?? '')
      .replace(/<\/agent-message>[\s\S]*$/, '')
      .replace(/^ {2}/gm, '')
      .trim()
    const probe = report.slice(0, 60)
    const isKept = (item.thread ?? []).some(one => one.role === 'agent' && one.text.includes(probe))

    if (kind !== 'task-notification' && report !== '' && !isKept) {
      const at = await $.clock.now()
      await change($, backlog => sayOnce(backlog, item.id, { role: 'agent', text: report, at }))
      await update($, pending, list => list.filter(id => id !== item.id))
    }

    return { drop: `Parked #${item.id}: the subagent's reply is in the pane.` }
  })

  on('command.run', { command: 'park' }, async ($, e) => {
    // `/park` parks the assistant's last reply. `/park <note>` parks the note
    // alone: what the user writes is often about something other than that
    // reply. `/park + <note>` parks the reply with the note on it.
    const typed = e.args.trim()
    const hasReply = typed === '' || typed.startsWith('+')
    const note = typed.replace(/^\+\s*/, '')
    const reply = hasReply
      ? (await $.session.messages()).findLast(one => one.role === 'assistant' && one.text.trim() !== '')
      : undefined

    if (hasReply && reply === undefined) {
      return { text: 'Nothing to park yet: the assistant has not replied.' }
    }

    const body = reply?.text ?? ''
    const sessionId = await $.session.id()
    const now = await $.clock.now()
    const changed = await change($, backlog =>
      park(backlog, {
        kind: 'needs-you',
        title: titleOf(note, body),
        body,
        note,
        parkedBy: 'user',
        sessionId,
        now,
      }),
    )

    return {
      text:
        'error' in changed
          ? changed.error
          : `Parked as #${changed.backlog.nextId - 1}. /parked shows the list.`,
    }
  })

  // What the keyboard region posts: a list row to open, an action on the open
  // item, or a message for its side thread.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || typeof e.data !== 'object' || e.data === null) {
      return next(e)
    }

    const data = e.data as {
      act?: unknown
      ask?: unknown
      open?: unknown
      focus?: unknown
      blur?: unknown
      draft?: unknown
    }
    const list = await read($, items)

    // The region took the keys back from the composer with a key or a click.
    if (data.blur === true) {
      await update($, typing, () => false)
      await update($, answering, () => false)

      return {}
    }

    // The composer level: the pane's text field takes the focus ring.
    if (data.focus === 'composer') {
      const id = await read($, selected)
      const target = list.find(one => one.id === id)

      if (target !== undefined) {
        await focusComposer($, target)
      }

      return {}
    }

    if (typeof data.open === 'number') {
      if (list.some(one => one.id === data.open)) {
        await goTo($, data.open)
      }

      return {}
    }

    const openId = await read($, selected)
    const item = list.find(one => one.id === openId)

    if (item === undefined) {
      return next(e)
    }

    if (typeof data.draft === 'string') {
      // The region typed for the composer: the field is drawn with its text.
      const text = data.draft
      await update($, draft, () => text)
    } else if (typeof data.ask === 'string' && data.ask.trim() !== '') {
      await update($, draft, () => '')
      await update($, back, () => 0)
      await send($, item, data.ask.trim())
    } else if (typeof data.act === 'string') {
      await perform($, item, data.act)
    }

    return {}
  })

  // The composer level follows the focus ring: on while the ring is on the
  // text field, off when Tab or a click moves the ring elsewhere.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    const isComposer = e.element?.startsWith('ask-') === true

    // Each time the ring lands on the composer is a visit, numbered so the
    // keyboard region can tell a new one from the one it last took the keys
    // back from.
    if (isComposer) {
      await update($, typing, () => true)
      await update($, typingAt, count => count + 1)
    } else if (await read($, typing)) {
      await update($, typing, () => false)
      await update($, answering, () => false)
    }

    return moved
  })

  on('command.run', { command: 'parked' }, async ($, e) => {
    if (e.args.trim() === 'lab') {
      const isOn = !(await read($, lab))
      await update($, lab, () => isOn)

      return { text: `Parked: the keyboard view is ${isOn ? 'on' : 'off'}.` }
    }

    await show($, await load($))
    // focus + closeOnEscape + holdToasts makes the pane a dialog: it owns the
    // arrows and Tab until Esc, so they stop reaching the agents view.
    await $.ui.open({
      id: PANE,
      title: 'Parked',
      focus: true,
      closeOnEscape: true,
      holdToasts: true,
    })

    return { text: 'Parked items pane opened.' }
  })

  // In the detail view the pane's tree fits its window, so the engine has
  // nothing to scroll: the wheel over the ticket moves the ticket, and the
  // wheel elsewhere or the scroll keys move the thread.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person') {
      return next(e)
    }

    // An arrow pressed while the pane, not its keyboard region, has the keys
    // arrives as a one-row scroll with no pointer: it is passed to the region
    // as the arrow it was.
    if (e.pointer === undefined && Math.abs(e.by) === 1 && (await read($, lab))) {
      const key = e.by < 0 ? 'up' : 'down'
      await update($, nudge, last => ({ key, n: last.n + 1 }))

      return {}
    }

    if ((await read($, selected)) === 0) {
      return next(e)
    }

    const row = e.pointer?.row
    const { ticketStart, ticketEnd, maxTop, maxBack } = layout

    if (row !== undefined && row >= ticketStart && row < ticketEnd) {
      await update($, top, at => Math.min(maxTop, Math.max(0, at + e.by)))
    } else {
      await update($, back, at => Math.min(maxBack, Math.max(0, at - e.by)))
    }

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // The thread needs a text field, which the mobile surface does not draw.
    if (e.surface === 'mobile') {
      return next(e)
    }

    const table = $.ui.resolve(e)
    const { Box, Button, Input, Text } = table
    // The keyboard view is drawn only where the surface has Client.
    const Client = (await read($, lab)) && 'Client' in table ? table.Client : undefined
    const waiting = await read($, pending)
    const list = await read($, items)
    const openId = await read($, selected)
    const now = await $.clock.now()
    // What is drawn is narrower than the pane by the padding at each side.
    const columns = Math.max(30, (e.props.bodyColumns ?? e.viewport?.columns ?? 60) - 2 * PAD)
    const rule = '─'.repeat(columns)

    const open = list.filter(one => one.status === 'open')
    // Those work is blocked on come first, as `orderOf` has them.
    const asked = open.filter(one => one.kind === 'needs-you')
    const needs = [
      ...asked.filter(one => one.isBlocking === true),
      ...asked.filter(one => one.isBlocking !== true),
    ]
    const toneOf = (one: ParkedItem) => (one.isBlocking === true ? 'error' : 'warning')
    const glyphOf = (one: ParkedItem) => (one.isBlocking === true ? ICON.blocking : ICON.needs)
    const isAnswering = await read($, answering)
    const fyi = open.filter(one => one.kind === 'fyi')
    const done = list.filter(one => one.status === 'done').slice(-10).reverse()
    // The order the list draws in, which Next and Prev walk.
    const order = orderOf(list)
    const item = order.find(one => one.id === openId)
    // A row of the pane's own buttons, one per letter. Claude Code presses one
    // when its letter is typed while the pane has the keyboard (ctrl+x tab),
    // with no click; the press is handed to the keyboard region as that key.
    const legend = (keys: readonly (readonly [string, string])[]) => (
      <Box columnGap={2}>
        {keys.map(([hot, means]) => (
          <Button
            key={`key-${hot}`}
            plain
            dimColor
            hotkey={hot}
            label={means}
            onPress={async () => {
              // While the composer is in use a letter is text for it, never a
              // shortcut: the press means the text field did not get the key.
              if (await read($, typing)) {
                await update($, draft, text => `${text}${hot}`)
              } else {
                await update($, nudge, last => ({ key: hot, n: last.n + 1 }))
              }
            }}
          />
        ))}
      </Box>
    )

    const go = async (id: number) => {
      await update($, back, () => 0)
      await update($, top, () => 0)
      await update($, selected, () => id)
    }

    if (item !== undefined) {
      const at = order.indexOf(item)
      const before = order[at - 1]
      const after = order[at + 1]
      const isOpen = item.status === 'open'
      const thread = item.thread ?? []
      const isWaiting = waiting.includes(item.id)
      const tone = !isOpen ? 'success' : item.kind === 'fyi' ? 'cyan' : toneOf(item)
      const label = !isOpen
        ? `${ICON.done} DONE`
        : item.kind === 'fyi'
          ? `${ICON.fyi} FYI`
          : item.isBlocking === true
            ? `${ICON.blocking} NEEDS ATTENTION · BLOCKING`
            : `${ICON.needs} NEEDS ATTENTION`
      const canAccept = isOpen && item.preferred !== undefined

      // Every row is counted so the tree fits the pane's window exactly: the
      // header, the ticket and the composer stay put, and only the two regions
      // move. Fixed rows: status, title, meta, buttons, rule; then rule and
      // thread heading; then the bordered composer (three rows) and the hint.
      const bodyRows = Math.max(16, e.props.scroll.bodyRows) - 1
      // The note is part of the ticket's own rows, not a row above them.
      const noteRows = 0
      const doneRows = item.resolution !== undefined ? 1 : 0
      // The action buttons wrap in a narrow pane; count the rows they take.
      const actions = [
        canAccept ? 'a: Accept' : '',
        isOpen ? 'd: Done' : 'r: Reopen',
        isOpen ? 'w: Answer' : '',
        (item.refs ?? []).length > 0 ? 'g: Open' : '',
        after !== undefined ? 'n: Next' : '',
        before !== undefined ? 'p: Prev' : '',
        thread.some(one => one.role === 'agent') ? 's: Send' : '',
        'b: Back',
      ].filter(Boolean)
      let buttonRows = 1
      let used = 0

      for (const action of actions) {
        // A button draws as `[ label ]`, with one column between neighbours.
        const width = action.length + 4

        if (used > 0 && used + 1 + width > columns) {
          buttonRows += 1
          used = width
        } else {
          used += (used > 0 ? 1 : 0) + width
        }
      }

      // The keyboard view has six rows beneath its region (actions, composer,
      // send, letter keys), one more than the classic view counts with one
      // button row.
      if (Client !== undefined) {
        buttonRows = 3
      }

      const room = Math.max(6, bodyRows - (4 + buttonRows + noteRows + doneRows + 2 + 4))
      const ticket = ticketLines(item, columns)
      const ticketRows = Math.min(ticket.length, Math.max(3, Math.floor(room * 0.4)))
      const threadRows = Math.max(3, room - ticketRows)
      const talk = threadLines(thread, columns)
      const maxTop = Math.max(0, ticket.length - ticketRows)
      const maxBack = Math.max(0, talk.length - threadRows)
      const topAt = Math.min(await read($, top), maxTop)
      const backAt = Math.min(await read($, back), maxBack)
      const end = talk.length - backAt
      const shown = talk.slice(Math.max(0, end - threadRows), end)
      const ticketStart = 4 + buttonRows + noteRows + doneRows
      layout = { ticketStart, ticketEnd: ticketStart + ticketRows, maxTop, maxBack }

      const more = (above: number, below: number) =>
        [above > 0 ? `↑${above}` : '', below > 0 ? `↓${below}` : ''].filter(Boolean).join(' ')

      // Where the surface has Client, the whole item is one region that owns
      // the keyboard once clicked: ↑ and ↓ move between the tickets, the
      // actions, the composer and Send, and ← and → act on the level in focus.
      // What it posts is answered by the `ui.message` hook.
      if (Client !== undefined) {
        const inner = 5 + noteRows + doneRows
        layout = { ticketStart: inner, ticketEnd: inner + ticketRows, maxTop, maxBack }
        const isTyping = await read($, typing)
        const typed = await read($, draft)

        return (
          <Box flexDirection="column" paddingX={PAD}>
            <Client
              key="detail"
              module="./detail.tsx"
              height={bodyRows - 5}
              props={{
                nudge: await read($, nudge),
                isTyping,
                typingAt: await read($, typingAt),
                draft: typed,
                view: 'detail',
                id: item.id,
                columns,
                label,
                tone,
                position: `${at + 1} of ${order.length}`,
                title: `#${item.id} ${item.title}`,
                meta: `parked by ${parkerOf(item)} · ${ageOf(item.createdAt, now)} ago${tagOf(item) === '' ? '' : ` · ${tagOf(item)}`}`,
                actions: [
                  ...(canAccept ? [{ act: 'accept', label: 'a: Accept', hot: 'a' }] : []),
                  isOpen ? { act: 'done', label: 'd: Done', hot: 'd' } : { act: 'reopen', label: 'r: Reopen', hot: 'r' },
                  ...(isOpen ? [{ act: 'write', label: 'w: Answer', hot: 'w' }] : []),
                  ...((item.refs ?? []).length > 0 ? [{ act: 'go', label: 'g: Open', hot: 'g' }] : []),
                  ...(after !== undefined ? [{ act: 'next', label: 'n: Next', hot: 'n' }] : []),
                  ...(before !== undefined ? [{ act: 'prev', label: 'p: Prev', hot: 'p' }] : []),
                  { act: 'back', label: 'b: Back', hot: 'b' },
                ],
                canSend: thread.some(one => one.role === 'agent'),
                // How many options a digit can pick; none once the item is done.
                options: isOpen ? (item.options?.length ?? 0) : 0,
                isAnswering,
                note: '',
                resolution: item.resolution ?? '',
                // The newest rows are kept when a text outgrows what props may carry.
                ticket: ticket
                  .slice(0, 400)
                  .map(row =>
                    row.isNote
                      ? [{ text: row.text, shade: true }]
                      : row.color !== undefined
                        ? [{ text: row.text, color: row.color }]
                        : ticketParts(row.text),
                  ),
                ticketRows,
                top: topAt,
                talk: talk.slice(-400),
                threadRows,
                back: backAt,
                heading: `Side thread${thread.length === 0 ? '' : ` (${thread.length})`}`,
                busy: isWaiting ? 'the subagent is working…' : '',
              }}
            />
            <Box
              borderStyle="round"
              borderColor={isAnswering ? 'warning' : isTyping ? 'cyan' : 'gray'}
              paddingX={1}
            >
              <Input
                key={askKey(item)}
                value={typed}
                label={isTyping ? '▸ ' : '  '}
                placeholder={
                  isAnswering
                    ? 'Your answer for the main agent · enter sends'
                    : isTyping
                      ? 'Type a question · enter on an empty line leaves'
                      : isWaiting
                        ? 'Add to your question…'
                        : 'Ask about this item…'
                }
                submitLabel="send"
                onSubmit={async (value: string) => {
                  if (value.trim() !== '') {
                    await update($, draft, () => '')
                    await update($, back, () => 0)
                    await send($, item, value.trim())
                  } else {
                    // Enter on an empty line leaves the composer: the ring
                    // moves to the letter row, where h j k l navigate again.
                    await $.ui.focus({ requestId: PANE, key: 'key-k' }).catch(() => undefined)
                  }
                }}
              />
            </Box>
            <Box>
              {thread.some(one => one.role === 'agent') ? (
                <Button
                  key="send"
                  plain
                  hotkey="s"
                  label="Send findings to main agent"
                  onPress={async () => {
                    // While the composer is in use, s is a letter for it.
                    if (await read($, typing)) {
                      await update($, draft, text => `${text}s`)
                    } else {
                      await perform($, item, 'send')
                    }
                  }}
                />
              ) : (
                <Text dimColor>Findings can be sent to the main agent once the subagent replies.</Text>
              )}
            </Box>
            {legend([
              ['h', '←'],
              ['j', '↓'],
              ['k', '↑'],
              ['l', '→'],
              ['o', 'enter'],
              ['i', 'type'],
            ])}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" paddingX={PAD}>
          <Box justifyContent="space-between">
            <Text color={tone} bold>
              {label}
            </Text>
            <Text dimColor>
              {at + 1} of {order.length}
            </Text>
          </Box>
          <Text bold wrap="truncate-end">
            #{item.id} {item.title}
          </Text>
          <Text dimColor wrap="truncate-end">
            parked by {parkerOf(item)} · {ageOf(item.createdAt, now)} ago
            {tagOf(item) === '' ? '' : ` · ${tagOf(item)}`}
          </Text>
          <Box columnGap={1} flexWrap="wrap">
            {canAccept && (
              <Button key="accept" label="a: Accept" hotkey="a" onPress={() => perform($, item, 'accept')} />
            )}
            {isOpen ? (
              <Button
                key="done"
                label="d: Done"
                hotkey="d"
                autoFocus
                onPress={async () => {
                  const when = await $.clock.now()
                  await change($, backlog => resolve(backlog, item.id, doneNote(item), 'user', when))
                  // On to the next open item, or back to the list when none is left.
                  const following = [...needs, ...fyi].find(one => one.id !== item.id)
                  await go(following?.id ?? 0)
                }}
              />
            ) : (
              <Button
                key="reopen"
                label="r: Reopen"
                hotkey="r"
                autoFocus
                onPress={async () => {
                  await change($, backlog => reopen(backlog, item.id))
                }}
              />
            )}
            {isOpen && (
              <Button key="write" label="w: Answer" hotkey="w" onPress={() => perform($, item, 'write')} />
            )}
            {(item.refs ?? []).length > 0 && (
              <Button key="go" label="g: Open" hotkey="g" onPress={() => perform($, item, 'go')} />
            )}
            {after !== undefined && <Button key="next" label="n: Next" hotkey="n" onPress={() => go(after.id)} />}
            {before !== undefined && <Button key="prev" label="p: Prev" hotkey="p" onPress={() => go(before.id)} />}
            {thread.some(one => one.role === 'agent') && (
              <Button
                key="send"
                label="s: Send"
                hotkey="s"
                onPress={async () => {
                  await $.prompt.submit({ text: handoff(item, await summaryOf($, item)) })
                  $.ui.toast(`Parked #${item.id}: findings sent to the main agent.`)
                }}
              />
            )}
            <Button key="back" label="b: Back" hotkey="b" onPress={() => go(0)} />
          </Box>
          <Box justifyContent="space-between">
            <Text dimColor>── Ticket</Text>
            <Text dimColor>{more(topAt, maxTop - topAt)}</Text>
          </Box>
          {item.resolution !== undefined && (
            <Text wrap="truncate-end">
              <Text color="success">Resolved by {item.resolvedBy === 'user' ? 'you' : 'the agent'}: </Text>
              {item.resolution}
            </Text>
          )}
          <Box flexDirection="column" height={ticketRows} overflow="hidden">
            {ticket.slice(topAt, topAt + ticketRows).map(({ text, isNote, color }) =>
              color !== undefined ? (
                <Text color={color}>{text}</Text>
              ) : isNote ? (
                <Text backgroundColor="userMessageBackground">
                  <Text dimColor>{text.slice(0, 2)}</Text>
                  {text.slice(2)}
                </Text>
              ) : (
                <Text wrap="truncate-end" bold={text.startsWith('#')}>
                  {text === ''
                    ? ' '
                    : ticketParts(text).map(part =>
                        part.color === undefined ? <Text>{part.text}</Text> : <Text color={part.color}>{part.text}</Text>,
                      )}
                </Text>
              ),
            )}
          </Box>
          <Text dimColor>{rule}</Text>
          <Box justifyContent="space-between">
            <Text bold>
              Side thread{thread.length === 0 ? '' : ` (${thread.length})`}
              {isWaiting ? ' · the subagent is investigating…' : ''}
            </Text>
            <Text dimColor>{more(Math.max(0, end - threadRows), backAt)}</Text>
          </Box>
          <Box flexDirection="column" height={threadRows} overflow="hidden">
            {talk.length === 0 && (
              <Text dimColor wrap="wrap">
                Ask a subagent to look into this. The main agent does not see this thread.
              </Text>
            )}
            {shown.map(line =>
              line.kind === 'you' ? (
                <Text backgroundColor="userMessageBackground">
                  <Text dimColor>{line.text.slice(0, 2)}</Text>
                  {line.text.slice(2)}
                </Text>
              ) : (
                <Text
                  wrap="truncate-end"
                  bold={line.text.startsWith('#')}
                  dimColor={line.kind === 'note'}
                >
                  {line.text === '' ? ' ' : line.text}
                </Text>
              ),
            )}
          </Box>
          <Box borderStyle="round" borderColor={isAnswering ? "warning" : isWaiting ? "gray" : "cyan"} paddingX={1}>
          <Input
            key={askKey(item)}
            label={isAnswering ? "Answer › " : isWaiting ? "… " : "Ask › "}
            placeholder={
              isAnswering
                ? 'Your answer for the main agent…'
                : isWaiting
                  ? 'Add to your question…'
                  : 'Ask about this item…'
            }
            submitLabel="send"
            onSubmit={async (value: string) => {
              if (value.trim() !== '') {
                await update($, back, () => 0)
                await send($, item, value.trim())
              }
            }}
          />
          </Box>
          <Text dimColor wrap="truncate-end">
            scroll moves the thread, or the ticket under the pointer · esc close
          </Text>
        </Box>
      )
    }

    // Digits 1-9 open the first nine rows; the rest are reached with ↑↓.
    const row = (one: ParkedItem, glyph: string, tone: string) => {
      const index = order.indexOf(one)
      const talk = (one.thread ?? []).length > 0 ? `${waiting.includes(one.id) ? '…' : `${ICON.thread} `}${(one.thread ?? []).length} · ` : ''
      const meta = `${tagOf(one) === '' ? '' : `${tagOf(one)} · `}${talk}${one.status === 'done' ? 'done' : ageOf(one.createdAt, now)}`
      const room = columns - meta.length - 12
      const title = one.title.length > room ? `${one.title.slice(0, Math.max(1, room - 1))}…` : one.title

      return (
        <Box justifyContent="space-between">
          <Box>
            <Text color={tone}>{glyph} </Text>
            <Button
              key={`item-${one.id}`}
              plain
              {...(index < 9 ? { hotkey: String(index + 1) } : {})}
              {...(index === 0 ? { autoFocus: true as const } : {})}
              dimColor={one.status === 'done'}
              label={title}
              onPress={() => go(one.id)}
            />
          </Box>
          <Text dimColor>{meta}</Text>
        </Box>
      )
    }

    const summary = [
      needs.length > 0 ? `${needs.length} need${needs.length === 1 ? 's' : ''} attention` : '',
      fyi.length > 0 ? `${fyi.length} FYI` : '',
      done.length > 0 ? `${done.length} done` : '',
    ]
      .filter(Boolean)
      .join(' · ')

    // Where the surface has Client, the list is drawn by the same region as an
    // item (same key and module), so the keyboard stays with the pane when it
    // moves between the two.
    if (Client !== undefined) {
      const entry = (one: ParkedItem, glyph: string, tone: string) => {
        const talk = (one.thread ?? []).length > 0 ? `${waiting.includes(one.id) ? '…' : `${ICON.thread} `}${(one.thread ?? []).length} · ` : ''
        const meta = `${tagOf(one) === '' ? '' : `${tagOf(one)} · `}${talk}${one.status === 'done' ? 'done' : ageOf(one.createdAt, now)}`
        const room = columns - meta.length - 9 - String(one.id).length
        const text = one.title.length > room ? `${one.title.slice(0, Math.max(1, room - 1))}…` : one.title

        return { kind: 'row', id: one.id, glyph, tone, text, meta, isDone: one.status === 'done' }
      }
      const head = (text: string, tone: string) => ({ kind: 'head', id: 0, glyph: '', tone, text, meta: '', isDone: false })
      const height = Math.max(16, e.props.scroll.bodyRows) - 2

      return (
        <Box flexDirection="column" paddingX={PAD}>
          <Client
            key="detail"
            module="./detail.tsx"
            height={height}
            props={{
              nudge: await read($, nudge),
              view: 'list',
              columns,
              rows: height,
              summary,
              entries: [
                ...(needs.length > 0 ? [head('NEEDS ATTENTION', 'warning')] : []),
                ...needs.map(one => entry(one, glyphOf(one), toneOf(one))),
                ...(fyi.length > 0 ? [head('FYI', 'cyan')] : []),
                ...fyi.map(one => entry(one, ICON.fyi, 'cyan')),
                ...(done.length > 0 ? [head('DONE', 'success')] : []),
                ...done.map(one => entry(one, ICON.done, 'success')),
              ],
            }}
          />
          {legend([
            ['j', '↓'],
            ['k', '↑'],
            ['o', 'open'],
          ])}
        </Box>
      )
    }

    if (list.length === 0) {
      return (
        <Box flexDirection="column" paddingX={PAD}>
          <Text bold>📌 Parked</Text>
          <Text dimColor>Nothing parked yet.</Text>
          <Text dimColor>/park [note] parks the last reply; the agent parks items as jobs report.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={PAD}>
        <Text bold>📌 Parked · {summary}</Text>
        <Text dimColor>{rule}</Text>
        {needs.length > 0 && (
          <Text color="warning" bold>
            NEEDS ATTENTION
          </Text>
        )}
        {needs.map(one => row(one, glyphOf(one), toneOf(one)))}
        {fyi.length > 0 && (
          <Box marginTop={needs.length > 0 ? 1 : 0}>
            <Text color="cyan" bold>
              FYI
            </Text>
          </Box>
        )}
        {fyi.map(one => row(one, ICON.fyi, 'cyan'))}
        {done.length > 0 && (
          <Box marginTop={open.length > 0 ? 1 : 0}>
            <Text color="success" bold>
              DONE
            </Text>
          </Box>
        )}
        {done.map(one => row(one, ICON.done, 'success'))}
        <Text dimColor>{rule}</Text>
        <Text dimColor>1-9 open · ↑↓ move · enter open · esc close</Text>
      </Box>
    )
  })
}
