import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { ParkedItem, ParkedLive, ParkedMessage } from '../types'
import { FOLDER_COLOR, STAR_COLOR, refIcon } from './kit/icons'
import { PAD, cut } from './kit/layout'
import {
  EMPTY,
  ICON,
  TITLE_ROWS,
  ageOf,
  answer,
  answerOf,
  answersNote,
  briefRequest,
  defaultsOf,
  describe,
  digestOf,
  doneNote,
  excerptOf,
  fitTables,
  BRIEFING,
  BRIEFING_LATE,
  callLabel,
  handoff,
  handoverOf,
  inScope,
  investigationPrompt,
  isReminderDue,
  ownOpen,
  reminderOf,
  isBacklog,
  knowSession,
  markdownOf,
  mergedRuns,
  migrate,
  nextScope,
  orderOf,
  park,
  pathOfRef,
  restore,
  placeOfRef,
  pruned,
  reopen,
  reportIn,
  resolve,
  resultLine,
  workPrompt,
  say,
  sayOnce,
  sayReply,
  sent,
  sessionLabel,
  sessionNameOf,
  statusText,
  summaryRequest,
  syncSession,
  tildeOf,
  titleOf,
  unsend,
  unsentOf,
} from './backlog'
import type { Backlog, Here } from './backlog'

const PANE = 'parked'
// The row every view of the pane leaves clear above it.
const TOP = 1
const PARK = 'mcp__parked__park'
const RESOLVE = 'mcp__parked__resolve'
const LIST = 'mcp__parked__list_parked'

// Every session's items, and what each session that parked some is called.
const items = atom({ plugin: 'parked', key: 'items' } as const, [])
const sessions = atom({ plugin: 'parked', key: 'sessions' } as const, {})
// Which of them the pane lists: this session's until the user asks for more.
const scope = atom({ plugin: 'parked', key: 'scope' } as const, 'session')
// The id of the item the pane shows in full; 0 while it shows the list.
const selected = atom({ plugin: 'parked', key: 'selected' } as const, 0)
// The ids of the items whose side thread awaits its subagent's reply.
const pending = atom({ plugin: 'parked', key: 'pending' } as const, [])
// What each of those subagents has written so far, by item id.
const live = atom({ plugin: 'parked', key: 'live' } as const, {})
// An item's view is two sections of which one is open at a time: the ticket,
// or the side thread with its composer. A closed thread draws no text field,
// so nothing takes the keys from the pane's own shortcuts.
const section = atom({ plugin: 'parked', key: 'section' } as const, 'ticket')
// Whether an item offers its side thread at all. Off for now: the section,
// its composer and its shortcuts are not drawn, and nothing reaches `ask`.
// `/parked chat` switches it. Threads already kept stay in the store.
const chat = atom({ plugin: 'parked', key: 'chat' } as const, false)
// Whether a thread's handover to its subagent is shown in full.
const isBriefOpen = atom({ plugin: 'parked', key: 'isBriefOpen' } as const, false)
// Whether the list is the keyboard view (a Client region) where the surface has one.
const lab = atom({ plugin: 'parked', key: 'lab' } as const, true)
// The last key pressed on one of the list's own letter buttons, and how many
// have been: the keyboard region answers each new count as a key of its own.
const nudge = atom({ plugin: 'parked', key: 'nudge' } as const, { key: '', n: 0 })
// Whether the composer, the pane's own text field, has the focus ring.
const typing = atom({ plugin: 'parked', key: 'typing' } as const, false)
// What a letter button has typed for the composer while the text field itself
// did not get the key; the field is drawn with it.
const draft = atom({ plugin: 'parked', key: 'draft' } as const, '')
// What the text field holds as the user types. The field is one line and
// cuts what does not fit, so a long message is shown whole above it.
const typedNow = atom({ plugin: 'parked', key: 'typed' } as const, '')
// The item whose side thread the next prompt typed in Claude Code's own prompt
// box goes to, instead of to the main agent; 0 while none does. The pane's
// text field is one line: the prompt box wraps, takes a paste and several
// lines, and keeps its history.
const armed = atom({ plugin: 'parked', key: 'armed' } as const, 0)
// Whether what the composer sends is the user's answer for the main agent,
// not a question for the side thread's subagent.
const answering = atom({ plugin: 'parked', key: 'answering' } as const, false)
// Whether the lens mod is drawing in this pane. A pane cannot hand the
// keyboard to another, so a file opened from an item is shown here: this pane
// draws one row, the way back, and lens draws its file view beneath it. Lens
// reads this value; it is true only where lens is loaded to draw.
const guest = atom({ plugin: 'parked', key: 'guest' } as const, false)
// What tells that lens is loaded: its own state, which only it writes.
const LENS_VIEW = { plugin: 'lens', key: 'view' } as const
// The file of an item shown in the item itself, so reading a reference needs
// no other pane; null while none is.
const peek = atom({ plugin: 'parked', key: 'peek' } as const, null)
// The place last asked to be shown: the lens mod, where loaded, opens it.
const jump = atom({ plugin: 'parked', key: 'jump' } as const, null)

// How long after the last answer the batch of them is sent, so several items
// answered in a row reach the main agent as one message.
const FLUSH_MS = 3000
// Whether the main loop is in a turn; a subagent's run raises no `turn.start`.
let isRunning = false
// The timer that sends the batch of answers, while one is waiting.
let flushTimer: { cancel: () => void } | undefined

// The user's home folder, which the pane writes `~`; read once.
let home: string | undefined

// The assistant's own items it was last reminded of, and the prompts since.
// Kept by the host, not the module: a reload of the mod must not start the
// count over, or every reload would bring the reminder again.
const reminded = atom({ plugin: 'parked', key: 'reminded' } as const, { ids: '', turns: 0 })
// The colour of what the assistant parked for itself.
const SELF_COLOR = '#b48ead'

// How often what the subagents have written is passed on to the pane.
const LIVE_MS = 120
// What each running subagent has written in the step it is on, by agent id.
// The module's own: a reload ends the streams it was reading.
const heard = new Map<string, ParkedLive>()
// The id of each of those calls, in the same order: a result names its call
// by id, and is drawn under it.
const heardIds = new Map<string, string[]>()
// Which of the open item's files have changed since it was parked.
const changed = atom({ plugin: 'parked', key: 'changed' } as const, [])
// The last thing done that can be taken back, with the items as they were.
const undo = atom({ plugin: 'parked', key: 'undo' } as const, null)
// The session last told what was waiting for it, so a reload says nothing.
const greeted = atom({ plugin: 'parked', key: 'greeted' } as const, '')
// The timer that passes it on, while a thread awaits a reply.
let liveTimer: { cancel: () => void } | undefined
let isTelling = false
// Whether an item's view keeps to the end of a reply as it grows: until the
// user scrolls up from the end, and again once they are back at it.
let isFollowing = true
// The item last shown in full, where the list's cursor waits on the way back.
let lastShown = 0
// A subagent hands its report back through a tool call of this name.
const HANDBACK = /handback/i
// How many of a run's tool calls are kept with its reply.
const CALLS_KEPT = 40

// What the side threads' plumbing last did, newest last, for `/parked trace`:
// a reply that does not show as it is written is traced from here.
const TRACE_KEPT = 120
const trace: string[] = []
const began = Date.now()
const traced = (line: string) => {
  trace.push(`${((Date.now() - began) / 1000).toFixed(1)}s ${line}`)
  trace.splice(0, Math.max(0, trace.length - TRACE_KEPT))
}

// The thread's input is keyed by how many messages the user has sent, so each
// send draws a fresh, empty field.
const askKey = (item: ParkedItem) =>
  `ask-${item.id}-${(item.thread ?? []).filter(one => one.role === 'you').length}`

const GUIDE = `# Parked items

This session has a backlog of parked items the user reviews later in a pane, often after leaving the session unattended. Keep it current with the ${PARK}, ${RESOLVE} and ${LIST} tools.

Park an item with kind "needs-you" for: a decision you deferred to the user, a question you could not answer, a blocker, or a finding the user must act on.
Park an item with kind "fyi" for: a completed job worth knowing about, a notable finding, or an assumption you made on the user's behalf.
Park an item with kind "self" for something you mean to come back to yourself, which the user need not act on: a follow-up you deferred, a check to run again later, cleanup you promised, a problem you noticed outside the task at hand. That list is your own. The user can read it but is not asked to do anything, so never use it for a question or a decision that is theirs. Park the item at the moment you defer the thing, not later from memory. Before you tell the user a piece of work is finished, call ${LIST} and either do each of your own open items or say plainly which is left open and why. You are reminded of them as the session goes on.
Park one item per distinct thing to address, not one per report. Give each a short title and a body that stands on its own: what is needed from the user and the relevant findings. Do not park routine progress.
Write the body as Markdown with real line breaks; the pane draws it as it draws a reply. Open with one or two sentences saying what is needed, leave a blank line, then give the findings. Put every bullet and every numbered step on a line of its own, never several run together in one paragraph, and leave a blank line between paragraphs. Put a diagram, a command, a file listing or any text whose spacing matters in a fenced code block, and findings that compare things in a table. Leave the options and the refs out of the body: they are drawn from their own fields.
When an item is a choice, give "options" (short labels, nine at most) and "default", the number of the one you would pick; the user sees that one listed first, as option 1. Set "blocking" to true only when no remaining work can go on without the answer; otherwise go ahead on your default and leave the item open for the user to accept or overturn. Name the places an item is about in "refs", each a path or path:line.
The user's answers arrive as a prompt that begins "My answers to parked items", and each answered item is already done: do not resolve it again. An answer that differs from your default replaces it, so revise what you built on the default.
When the user has addressed an item in conversation, or you have done one of your own, call ${RESOLVE} with its id and a one-line record of the outcome.
Call ${LIST} when resuming work or when unsure what is open. It lists this session's items; the user may also keep items from other sessions, which are theirs to bring up.`

// Who parked an item, and the ledger task or unit it belongs to ('' for none).
const parkerOf = (item: ParkedItem) =>
  item.origin !== undefined ? 'the ledger' : item.parkedBy === 'user' ? 'you' : 'the agent'
const tagOf = (item: ParkedItem) =>
  item.origin?.kind === 'review' ? item.origin.unit : (item.task ?? '')

const SUBAGENT_REFUSAL =
  'Only the main agent parks items. Report this finding to the orchestrator in your final answer instead.'

// One backlog for every session and folder. It was once kept per folder, under
// a key that moved with the session's working directory.
const KEY = 'backlog'
const OLD = 'backlog:'

const hereOf = async ($: EngineInterface): Promise<Here> => ({
  sessionId: await $.session.id(),
  project: await $.session
    .root()
    .catch(() => $.session.cwd())
    .catch(() => ''),
})

const load = async ($: EngineInterface): Promise<Backlog> => {
  const stored = await $.store.get(KEY)

  if (isBacklog(stored)) {
    return stored
  }

  // Nothing kept yet under the one key: what the folders kept is brought in,
  // and stays where it was.
  const keys = (await $.store.keys()).filter(key => key.startsWith(OLD))
  const old = await Promise.all(keys.map(async key => [key.slice(OLD.length), await $.store.get(key)] as const))
  const kept = old.filter((pair): pair is readonly [string, Backlog] => isBacklog(pair[1]))

  return kept.length === 0 ? EMPTY : migrate(kept)
}

const show = async ($: EngineInterface, backlog: Backlog) => {
  const here = await hereOf($)

  await update($, items, () => backlog.items)
  await update($, sessions, () => backlog.sessions ?? {})
  // The status row is for this session's own items.
  $.ui.status(statusText(inScope(backlog.items, 'session', here)))
}

// Reads the stored backlog, applies the change and writes it back; answers
// the reason when the change was refused or the store failed.
const changeNow = async (
  $: EngineInterface,
  apply: (backlog: Backlog) => Backlog | string,
): Promise<{ backlog: Backlog } | { error: string }> => {
  try {
    const applied = apply(await load($))

    if (typeof applied === 'string') {
      return { error: applied }
    }

    const after = pruned(applied)
    await $.store.set(KEY, after)
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

// The items the pane lists now, as the scope has them.
const listed = async ($: EngineInterface) =>
  inScope(await read($, items), await read($, scope), await hereOf($))

// Finds what /resume calls this session and keeps it with the backlog, so its
// items are named by it wherever they are listed. The name is read off the
// session's transcript, whose title rows the engine writes as the name changes.
const nameSession = async ($: EngineInterface) => {
  try {
    const here = await hereOf($)
    const backlog = await load($)

    // A session is kept track of once it has items.
    if (!backlog.items.some(one => one.sessionId === here.sessionId)) {
      return
    }

    let transcript = backlog.sessions?.[here.sessionId]?.transcript

    if (transcript === undefined) {
      const home = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
      const found = await $.process.run(
        ['find', `${home}/projects`, '-maxdepth', '2', '-name', `${here.sessionId}.jsonl`],
        { timeoutMs: 10000 },
      )
      transcript = found.stdout.split('\n').find(line => line.trim() !== '')?.trim()
    }

    const name =
      transcript === undefined
        ? ''
        : sessionNameOf((await $.process.run(['grep', '-o', '-E', TITLE_ROWS, transcript], { timeoutMs: 10000 })).stdout)
    const seen = { name, project: here.project, ...(transcript !== undefined ? { transcript } : {}) }
    const now = await $.clock.now()

    if (knowSession(backlog, here.sessionId, seen, now) !== backlog) {
      await change($, kept => knowSession(kept, here.sessionId, seen, now))
    }
  } catch {
    // No transcript to read, or no way to read it: the session goes by its id.
  }
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

// Keeps an item's view at the end of what is being written, as a transcript
// stays at the end of a reply, while the user has not scrolled away from it.
// One move at a time, and nothing waits on it: a move that is slow to land
// must not hold back the text it follows.
let isScrolling = false

const follow = ($: EngineInterface) => {
  if (isScrolling || !isFollowing) {
    return
  }

  isScrolling = true
  void (async () => {
    if ((await read($, section)) === 'thread' && (await read($, selected)) !== 0) {
      const moved = await $.ui.scroll({ to: 'end', in: PANE })

      if (moved.deny !== undefined) {
        traced(`scroll denied: ${moved.deny}`)
      }
    }
  })()
    .catch(error => traced(`scroll failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      isScrolling = false
    })
}

// Says what a thread is waiting on before its subagent has written anything.
const stage = ($: EngineInterface, item: ParkedItem, text: string) => {
  traced(`#${item.id} ${text}`)

  return update($, live, now => ({ ...now, [String(item.id)]: { text: '', tools: [], stage: text } }))
}

// Passes on to the pane what each waited-on subagent has written since the
// last time, and stops once no thread awaits a reply.
const tell = async ($: EngineInterface) => {
  const waiting = await read($, pending)

  if (waiting.length === 0) {
    liveTimer?.cancel()
    liveTimer = undefined
    heard.clear()
    heardIds.clear()
    await update($, live, () => ({}))

    return
  }

  const list = await read($, items)
  const before = await read($, live)
  const now: Record<string, ParkedLive> = {}

  for (const id of waiting) {
    const agentId = list.find(one => one.id === id)?.agentId
    // Until its subagent writes, a thread keeps the stage it was last given.
    const voice = (agentId === undefined ? undefined : heard.get(agentId)) ?? before[String(id)]

    if (voice !== undefined) {
      now[String(id)] = voice
    }
  }

  if (JSON.stringify(now) !== JSON.stringify(before)) {
    await update($, live, () => now)
    follow($)
  }
}

// Starts listening to the subagents' streams; `turn.step` reads them only
// while this runs, so the main loop's own steps pass straight through.
const listen = ($: EngineInterface) => {
  liveTimer ??= $.clock.every(LIVE_MS, () => {
    if (isTelling) {
      return
    }

    isTelling = true
    void tell($)
      .catch(error => traced(`tell failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        isTelling = false
      })
  })
}

// Writes the briefing for a subagent that has already started and sends it on
// as a message. Writing it is one question put to the main session's model
// and takes a while, which the subagent spends on what it can check itself.
// What it was handed is kept on the thread, for the user to read.
const briefLater = async ($: EngineInterface, item: ParkedItem, text: string, agentId: string) => {
  const brief = await briefOf($, item)
  const at = await $.clock.now()
  await change($, backlog => {
    const said = say(backlog, item.id, { role: 'brief', text: handoverOf(item, text, brief), at })

    return typeof said === 'string'
      ? said
      : { ...said, items: said.items.map(one => (one.id === item.id ? { ...one, brief } : one)) }
  })

  if (brief === '') {
    return
  }

  if ((await read($, pending)).includes(item.id)) {
    const sent = await $.session
      .send({ to: { agentId }, text: `${BRIEFING}\n${brief}\n\n${BRIEFING_LATE}` })
      .catch(() => ({ isDelivered: false }))

    if (sent.isDelivered) {
      traced(`#${item.id} briefing sent to agent ${agentId}`)

      return
    }
  }

  // The subagent had replied by then: waking it for a briefing alone would be
  // a second reply nobody asked for, so it goes with the user's next message.
  traced(`#${item.id} briefing kept for the next message`)
  await change($, backlog => ({
    ...backlog,
    items: backlog.items.map(one => (one.id === item.id ? { ...one, owed: brief } : one)),
  }))
}

// Sends the user's message to the item's subagent: the one already on the
// thread while this session still has it, else a fresh one given the thread.
//
// Called from the `ui.input` hook, never from the text field's own handler or
// a timer: the engine passes a subagent's steps to this mod's `turn.step` hook
// only when the subagent was started inside one of the mod's hooks, and its
// reply can be shown as it is written only then.
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

    isFollowing = true
    await update($, pending, list => [...list.filter(id => id !== item.id), item.id])
    listen($)
    follow($)

    // A subagent started any other way cannot be heard, and is replaced.
    if (item.agentId !== undefined && item.isStreamed === true) {
      await stage($, item, 'Passing your message to the side agent…')
      const owed = item.owed
      // The subagent may be gone, as after the session was closed and resumed:
      // a message that cannot reach it starts a fresh one below.
      const sent = await $.session
        .send({
          to: { agentId: item.agentId },
          text: owed === undefined ? text : `${BRIEFING}\n${owed}\n\nThe user's message: ${text}`,
        })
        .catch(() => ({ isDelivered: false }))

      if (sent.isDelivered) {
        traced(`#${item.id} delivered to agent ${item.agentId}`)

        if (owed !== undefined) {
          await change($, backlog => ({
            ...backlog,
            items: backlog.items.map(one => {
              const { owed: _o, ...rest } = one

              return one.id === item.id ? rest : one
            }),
          }))
        }

        return
      }
    }

    // The briefing is written once for an item. A subagent taking the thread
    // over later (the first one gone with its session) starts with that one.
    const kept = item.brief
    await stage($, item, 'Starting the side agent…')
    const spawned = await $.agent.spawn({
      prompt: kept === undefined ? investigationPrompt(item, text, '', true) : investigationPrompt(item, text, kept),
      description: `Parked #${item.id}: ${item.title}`.slice(0, 60),
    })

    if (spawned.agentId === undefined) {
      await fail(`The subagent could not start: ${spawned.deny ?? 'no reason given'}`)

      return
    }

    const agentId = spawned.agentId
    traced(`#${item.id} agent ${agentId} started`)
    await change($, backlog => ({
      ...backlog,
      items: backlog.items.map(one => {
        const { owed: _o, ...rest } = one

        return one.id === item.id ? { ...rest, agentId, isStreamed: true as const } : one
      }),
    }))

    if (kept !== undefined) {
      const noted = await $.clock.now()
      await change($, backlog =>
        say(backlog, item.id, {
          role: 'note',
          text: 'A fresh side agent took over this thread, with the same handover and the thread so far.',
          at: noted,
        }),
      )

      return
    }

    void briefLater($, item, text, agentId).catch(error =>
      traced(`#${item.id} briefing failed: ${error instanceof Error ? error.message : String(error)}`),
    )
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

    const handback = row.toolUses.findLast(use => HANDBACK.test(use.tool))
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
  isFollowing = true
  lastShown = id === 0 ? lastShown : id
  await update($, draft, () => '')
  await update($, typedNow, () => '')
  await update($, answering, () => false)
  await update($, section, () => 'ticket')
  await update($, isBriefOpen, () => false)
  await update($, peek, () => null)
  await update($, guest, () => false)
  await update($, changed, () => [])

  // A thread waits on the prompt box only while its item is the one shown.
  if ((await read($, armed)) !== id) {
    await disarm($)
  }

  await update($, selected, () => id)
  // Not waited on: the item is shown at once, and its files are marked as
  // each is looked at.
  void markChanged($, id).catch(() => undefined)
}

// Marks which of an item's files were changed after it was parked, by each
// file's time of last change: what the item says of such a file may be stale.
const markChanged = async ($: EngineInterface, id: number) => {
  const item = (await read($, items)).find(one => one.id === id)
  const refs = item?.refs ?? []

  if (item === undefined || refs.length === 0) {
    return
  }

  home ??= (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const at = home
  const stats = await Promise.all(
    refs.map(ref =>
      $.fs.stat(pathOfRef(item, ref, at)).then(
        stat => stat.mtimeMs,
        () => 0,
      ),
    ),
  )
  const late = stats.flatMap((time, index) => (time > item.createdAt ? [index] : []))

  // The pane may have moved on to another item meanwhile.
  if (late.length > 0 && (await read($, selected)) === id) {
    await update($, changed, () => late)
  }
}

// Keeps the items an action is about to change as they are now, so `u` can
// put them back.
const remember = async ($: EngineInterface, label: string, ids: readonly number[]) => {
  const before = (await read($, items)).filter(one => ids.includes(one.id))

  await update($, undo, () => ({ label, items: before }))
}

// Takes back the last thing done in the pane.
const takeBack = async ($: EngineInterface) => {
  const last = await read($, undo)

  if (last === null) {
    $.ui.toast('Parked: nothing to undo.')

    return
  }

  let told: number[] = []
  const changedBack = await change($, backlog => {
    const restored = restore(backlog, last.items)
    told = restored.told

    return restored.backlog
  })

  if ('error' in changedBack) {
    return
  }

  await update($, undo, () => null)
  $.ui.toast(
    told.length === 0
      ? `Parked: undid "${last.label}".`
      : `Parked: undid "${last.label}". The agent had already been told your answer to ${told.map(id => `#${id}`).join(', ')}: tell it if that no longer stands.`,
  )
}

// Sets whether Esc closes the pane, where it is open: while a thread waits on
// the prompt box, Esc must hand the keys to that box and leave the pane up.
const escCloses = async ($: EngineInterface, isClosing: boolean) => {
  const isUp = await $.ui.panes().then(
    panes => panes.some(pane => pane.id === PANE),
    () => false,
  )

  if (isUp) {
    await $.ui
      .open({ id: PANE, title: 'Parked', holdToasts: true, ...(isClosing ? { closeOnEscape: true as const } : {}) })
      .catch(() => undefined)
  }
}

// Makes an item's side thread the place the next typed prompt goes to.
const arm = async ($: EngineInterface, item: ParkedItem) => {
  await update($, section, () => 'thread')
  await update($, armed, () => item.id)
  await escCloses($, false)
}

const disarm = async ($: EngineInterface) => {
  if ((await read($, armed)) !== 0) {
    await update($, armed, () => 0)
    await escCloses($, true)
  }
}

// Gives the pane's text field the focus ring, so what is typed lands in it,
// clicked or not. The field may be about to be drawn (a section opening, an
// answer starting), so the ring is asked for now and again once it is there.
const focusComposer = ($: EngineInterface, item: ParkedItem) => {
  const focus = () => void $.ui.focus({ requestId: PANE, key: askKey(item) }).catch(() => undefined)

  focus()
  $.clock.after(80, focus)
  $.clock.after(300, focus)
}

// Tells the main agent every answer it has not had, as one message. While a
// turn runs the message goes into the prompt box, where the user's Enter
// delivers it into that turn; a prompt a plugin submits waits for the turn's end.
const flush = async ($: EngineInterface) => {
  // The answers meant for this session are taken and marked sent in one change,
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

// Takes the agent's own pick on every listed item that has one, in one go.
const acceptDefaults = async ($: EngineInterface) => {
  const list = defaultsOf(await listed($))
  const sessionId = await $.session.id()
  const when = await $.clock.now()
  let isOwed = false

  if (list.length > 0) {
    await remember($, `accept ${list.length} default${list.length === 1 ? '' : 's'}`, list.map(one => one.id))
  }

  for (const item of list) {
    const made = answerOf(item, item.preferred ?? 0)
    const changed = await change($, backlog => answer(backlog, item.id, item.preferred ?? 0, when, item.sessionId))

    // A blocking item's agent is waiting to hear, default or not.
    isOwed ||= !('error' in changed) && typeof made !== 'string' && !made.isSilent && item.sessionId === sessionId
  }

  if (isOwed) {
    queueFlush($)
  }

  $.ui.toast(
    list.length === 0
      ? 'Parked: no listed item has a default to accept.'
      : `Parked: accepted the default of ${list.length} item${list.length === 1 ? '' : 's'}.`,
  )
}

// Answers the open item for the user: an option by its number, or their words.
// The answer is for the agent of the session the item was parked in.
const respond = async ($: EngineInterface, item: ParkedItem, value: number | string, isStaying = false) => {
  const made = answerOf(item, value)

  if (typeof made === 'string') {
    $.ui.toast(made)

    return
  }

  await remember($, `answer #${item.id}`, [item.id])

  const order = orderOf(await listed($))
  const when = await $.clock.now()
  const isHere = item.sessionId === (await $.session.id())
  const changed = await change($, backlog => answer(backlog, item.id, value, when, item.sessionId))

  if ('error' in changed) {
    $.ui.toast(changed.error)

    return
  }

  if (made.isSilent) {
    $.ui.toast(`Parked #${item.id}: default accepted. The agent already went that way.`)
  } else if (isHere) {
    $.ui.toast(`Parked #${item.id}: answer queued for the main agent.`)
    queueFlush($)
  } else {
    const name = sessionLabel(changed.backlog.sessions, item.sessionId)
    $.ui.toast(`Parked #${item.id}: answer kept for "${cut(name, 40)}". Its agent is told when that session is next open.`)
  }

  // Answered from the band above the prompt, the pane stays where it is.
  if (isStaying) {
    return
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

// Runs one action on the open item.
const perform = async ($: EngineInterface, item: ParkedItem, act: string) => {
  const order = orderOf(await listed($))
  const at = order.findIndex(one => one.id === item.id)

  if (act === 'prev' || act === 'next') {
    const to = order[at + (act === 'next' ? 1 : -1)]

    if (to !== undefined) {
      await goTo($, to.id)
    }
  } else if (act === 'host-back') {
    await update($, guest, () => false)
  } else if (act === 'undo') {
    await takeBack($)
  } else if (act === 'done' && item.status === 'open') {
    await remember($, `done #${item.id}`, [item.id])
    const when = await $.clock.now()
    await change($, backlog => resolve(backlog, item.id, doneNote(item), 'user', when))
    // On to the next open item, or back to the list when none is left.
    const following = order.find(one => one.status === 'open' && one.id !== item.id)
    await goTo($, following?.id ?? 0)
  } else if (act === 'accept' && item.status === 'open' && item.preferred !== undefined) {
    await respond($, item, item.preferred)
  } else if (/^pick-[1-9]$/.test(act) && item.status === 'open') {
    await respond($, item, Number(act.slice(5)))
  } else if (/^go-\d+$/.test(act) && (item.refs ?? []).length > 0) {
    // A file pressed in the item's list is shown in this pane.
    const refs = item.refs ?? []
    const shown = await read($, peek)
    const at = Number(act.slice(3)) % refs.length
    const named = placeOfRef(refs[at] ?? '')
    home ??= (await $.env.get('HOME').catch(() => undefined)) ?? ''
    const path = pathOfRef(item, refs[at] ?? '', home)

    // Where lens is loaded, it opens in lens's own viewer, drawn here.
    // Without lens, its lines are shown in the item instead.
    const hasLens = await $.state.get(LENS_VIEW as never).then(
      got => (got as { value?: unknown }).value !== undefined,
      () => false,
    )

    if (hasLens) {
      // Said first: lens reads it as it takes the place, and leaves its own
      // pane shut when it is to draw here.
      await update($, guest, () => true)
      await update($, jump, last => ({ path, line: named.line, n: (last?.n ?? 0) + 1 }))

      return
    }

    // Pressed again, the file shown is put away.
    if (shown?.at === at) {
      await update($, peek, () => null)

      return
    }

    const text = await $.fs.read(path).then(
      read => (typeof read === 'string' ? read : undefined),
      () => undefined,
    )
    await update($, peek, () => ({
      at,
      path,
      line: named.line,
      ...(text === undefined
        ? { start: 1, source: '', error: 'This file could not be read.' }
        : excerptOf(text, named.line)),
    }))
  } else if (act === 'where' && item.source !== undefined) {
    // The conversation is scrolled to the row the item came up at. A row that
    // is not in this conversation (another session's, one compacted away) is
    // not found.
    const moved = await $.ui.scroll({ to: { requestId: item.source }, block: 'center' }).catch(() => ({ deny: 'no such row' }))

    $.ui.toast(
      moved.deny === undefined
        ? `Parked #${item.id}: the conversation is at where this came up.`
        : `Parked #${item.id}: where this came up is not in this conversation any more.`,
    )
  } else if (act === 'write' && item.status === 'open') {
    await update($, answering, () => true)
    focusComposer($, item)
  } else if ((act === 'thread' || act === 'arm' || act === 'type' || act === 'send') && !(await read($, chat))) {
    // The side thread is switched off: its shortcuts do nothing.
  } else if (act === 'thread') {
    // The two sections take turns: opening one closes the other.
    isFollowing = true
    await update($, section, now => (now === 'thread' ? 'ticket' : 'thread'))
    follow($)
  } else if (act === 'ticket') {
    await update($, section, () => 'ticket')
  } else if (act === 'arm') {
    if ((await read($, armed)) === item.id) {
      await disarm($)
    } else {
      await arm($, item)
    }
  } else if (act === 'type') {
    await update($, section, () => 'thread')
    focusComposer($, item)
  } else if (act === 'brief') {
    await update($, isBriefOpen, now => !now)
  } else if (act === 'reopen') {
    await remember($, `reopen #${item.id}`, [item.id])
    await change($, backlog => reopen(backlog, item.id))
  } else if (act === 'send' && (item.thread ?? []).some(one => one.role === 'agent')) {
    $.ui.toast(`Parked #${item.id}: summarising the thread for the main agent…`)
    await $.prompt.submit({ text: handoff(item, await summaryOf($, item)) })
    $.ui.toast(`Parked #${item.id}: findings sent to the main agent.`)
  } else if (act === 'back') {
    await goTo($, 0)
  }
}

// How many of a thread's messages are drawn: the newest, so a long thread
// stays a tree the pane can draw.
const THREAD_SHOWN = 12


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Answers a reload or a restart left unsent go out with the next batch, as
    // do those given to this session's items while it was closed.
    queueFlush($)

    await $.command.register({
      name: 'park',
      description: "Park a note, or the assistant's last reply: /park <note> · /park · /park + <note> for both",
    })
    await $.command.register({
      name: 'parked',
      description:
        'Show parked items in a pane: this session’s, or /parked project · /parked all. /parked work hands the assistant its own list',
    })
    await $.tool.register({
      name: 'park',
      description:
        'Park an item for the user to review later, or for yourself. Use kind "needs-you" for decisions, unanswered questions, blockers and findings the user must act on; "fyi" for completed jobs, notable findings and assumptions made on their behalf; "self" for something you mean to come back to yourself, which the user need not act on.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['needs-you', 'fyi', 'self'] },
          title: { type: 'string', description: 'One line naming the item' },
          body: {
            type: 'string',
            description:
              'What is needed from the user and the relevant findings; must stand on its own. Markdown with real line breaks: a short lead, a blank line, then the findings, each bullet on a line of its own; a fenced code block for a diagram, a command or anything whose spacing matters',
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
      description: 'Mark a parked item done once the user has addressed it, or you have done one of your own.',
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
      description:
        'List the parked items of this session: open ones, and done ones if asked. With scope "project" or "all", those of other sessions too.',
      inputSchema: {
        type: 'object',
        properties: {
          includeDone: { type: 'boolean' },
          scope: { type: 'string', enum: ['session', 'project', 'all'] },
        },
      },
    })

    try {
      await show($, await load($))
    } catch {
      $.ui.toast('Parked items could not be loaded.')
    }

    // A session that opens with items of its own waiting is told so, once:
    // not again on a reload of the mod.
    try {
      const here = await hereOf($)

      if ((await read($, greeted)) !== here.sessionId) {
        await update($, greeted, () => here.sessionId)
        const digest = digestOf(inScope((await load($)).items, 'session', here), await $.clock.now())

        if (digest !== undefined) {
          $.ui.toast(digest, { timeoutMs: 8000 })
        }
      }
    } catch {
      // Nothing to say.
    }

    // A reload while a thread awaited its reply: go on listening for it.
    if ((await read($, pending)).length > 0) {
      listen($)
    }

    void nameSession($)

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
      (kind !== 'needs-you' && kind !== 'fyi' && kind !== 'self') ||
      typeof title !== 'string' ||
      typeof body !== 'string' ||
      title.trim() === ''
    ) {
      return { deny: 'park needs kind ("needs-you", "fyi" or "self"), a title and a body.' }
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

    const here = await hereOf($)
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
        // The call's own row in the transcript is where the item came up.
        source: e.tool_use_id,
        parkedBy: 'model',
        ...here,
        now,
      }),
    )

    if ('error' in changed) {
      return { deny: changed.error }
    }

    // The first item of a session: find what the session is called.
    if (changed.backlog.sessions?.[here.sessionId] === undefined) {
      void nameSession($)
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
    const here = await hereOf($)
    const asked = e.scope === 'project' || e.scope === 'all' ? e.scope : 'session'
    const list = inScope(backlog.items, asked, here).filter(
      one => e.includeDone === true || one.status === 'open',
    )

    return {
      result:
        list.length === 0
          ? 'No parked items.'
          : list
              .map(one =>
                describe(one, one.sessionId === here.sessionId ? '' : `"${sessionLabel(backlog.sessions, one.sessionId)}"`),
              )
              .join('\n\n'),
    }
  })

  // The ledger mod, where it is loaded, changed its run: a failed gate and a
  // unit's open findings become items here, and close as the run moves on.
  on('state.set', { plugin: 'ledger', key: 'runs' }, async ($, e, next) => {
    const written = await next(e)
    // Every run under way counts, not only the one planned last.
    const seenRun = mergedRuns(e.value)
    const here = await hereOf($)
    const now = await $.clock.now()
    const before = await load($)

    // Most changes of a run (a spawn, a token count) alter no item.
    if (syncSession(before, seenRun, now, here) !== before) {
      await change($, backlog => syncSession(backlog, seenRun, now, here))
    }

    return written
  })

  on('turn.start', async ($, e, next) => {
    isRunning = true

    // What the assistant parked for itself is put before it again: when the
    // list has changed, and every few prompts while it has not. A note only
    // the assistant reads, so a long session does not bury its own list.
    try {
      const own = ownOpen((await load($)).items, await $.session.id())
      const last = await read($, reminded)
      const now = { ...last, turns: last.turns + 1 }

      if (isReminderDue(own, now)) {
        const appended = await $.session.append({
          message: { type: 'user', content: [{ type: 'text', text: reminderOf(own) }] },
        })
        traced(`reminder of ${own.length} own: ${'deny' in appended && appended.deny !== undefined ? `refused, ${appended.deny}` : 'appended'}`)
        await update($, reminded, () => ({ ids: own.map(one => one.id).join(','), turns: 0 }))
      } else {
        await update($, reminded, () => (own.length === 0 ? { ids: '', turns: 0 } : now))
      }
    } catch (error) {
      // A run no plugin may add a row to: the guidance alone has to do.
      traced(`reminder failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    return next(e)
  })

  // A step of a thread's subagent, as its model writes it: the text, the tools
  // it calls, and the report it hands back as a tool call's arguments are kept
  // for the pane to show as they come. Every chunk is passed on as it was.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId

    if (agentId === undefined || liveTimer === undefined) {
      return yield* next(e)
    }

    const stream = next(e)
    // The calls of the run's earlier steps, then this step's as they arrive.
    const earlier = heard.get(agentId)?.tools ?? []
    const earlierIds = heardIds.get(agentId) ?? []
    const calls = new Map<number, { id: string; name: string; json: string }>()
    let said = ''
    let handback = -1
    let json = ''
    let pieces = 0
    const hear = (text: string) => {
      const made = [...calls.values()]

      heardIds.set(agentId, [...earlierIds, ...made.map(call => call.id)].slice(-CALLS_KEPT))
      heard.set(agentId, {
        text,
        tools: [...earlier, ...made.map(call => callLabel(call.name, call.json))].slice(-CALLS_KEPT),
      })
    }

    for (;;) {
      const step = await stream.next()

      if (step.done === true) {
        traced(`agent ${agentId} step ${e.index}: ${pieces} pieces, ${calls.size} calls, ${(heard.get(agentId)?.text ?? '').length} characters heard`)

        return step.value
      }

      pieces += 1
      const chunk = step.value

      if (chunk.kind === 'text') {
        said += chunk.text
        hear(said)
      } else if (chunk.kind === 'tool' && HANDBACK.test(chunk.name)) {
        handback = chunk.index
      } else if (chunk.kind === 'tool') {
        calls.set(chunk.index, { id: chunk.id, name: chunk.name, json: '' })
        hear(said)
      } else if (chunk.kind === 'input' && chunk.index === handback) {
        json += chunk.json
        const report = reportIn(json)

        if (report.length > said.length) {
          hear(report)
        }
      } else if (chunk.kind === 'input') {
        // A call's arguments, which name what it is reading or running.
        const call = calls.get(chunk.index)

        if (call !== undefined) {
          calls.set(chunk.index, { ...call, json: call.json + chunk.json })
          hear(heard.get(agentId)?.text ?? said)
        }
      }

      yield chunk
    }
  })

  // What a call of a thread's subagent gave back, as its result is added to
  // the subagent's conversation: one line of it is kept under the call's row.
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    const voice = e.agentId === undefined ? undefined : heard.get(e.agentId)
    const ids = e.agentId === undefined ? undefined : heardIds.get(e.agentId)

    if (e.agentId !== undefined && voice !== undefined && ids !== undefined) {
      const tools = [...voice.tools]

      for (const block of e.message.content) {
        const at = block.type === 'tool_result' ? ids.indexOf(String(block.tool_use_id)) : -1
        const row = tools[at]

        if (block.type === 'tool_result' && row !== undefined) {
          tools[at] = `${row.split('\n')[0]}\n${resultLine(block.content)}`
        }
      }

      heard.set(e.agentId, { ...voice, tools })
    }

    return next(e)
  })

  // A thread's subagent finished a run: its answer is the thread's next message.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isRunning = false
      void nameSession($)

      // Answers given to this session's items from another session's pane.
      if (unsentOf((await load($)).items, await $.session.id()).length > 0) {
        queueFlush($)
      }
    }

    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const item = (await load($)).items.find(one => one.agentId === agentId)

      if (item !== undefined) {
        const at = await $.clock.now()
        const found = e.answer.trim() !== '' ? e.answer.trim() : await reportOf($, agentId).catch(() => '')
        const text = found !== '' ? found : `(The subagent stopped without a report: ${e.reason}.)`
        const tools = heard.get(agentId)?.tools ?? []
        await change($, backlog =>
          sayReply(backlog, item.id, { role: 'agent', text, at, ...(tools.length > 0 ? { tools } : {}) }),
        )
        heard.delete(agentId)
        heardIds.delete(agentId)
        await update($, live, now => Object.fromEntries(Object.entries(now).filter(([id]) => id !== String(item.id))))
        await update($, pending, list => list.filter(id => id !== item.id))
        follow($)
        traced(`#${item.id} agent ${agentId} replied, ${text.length} characters`)
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
    const armedFor = await read($, armed)
    const typed = e.text.trim()

    // A thread waits on the prompt box: what the user types there next is its
    // question, not the main agent's. A command is still a command.
    if (armedFor !== 0 && kind === 'composer' && typed !== '' && !typed.startsWith('/') && (await read($, chat))) {
      const item = (await read($, items)).find(one => one.id === armedFor)

      await disarm($)

      if (item !== undefined) {
        await ask($, item, typed)

        return { drop: `Parked #${item.id}: sent to its side thread, not to the main agent.` }
      }
    }

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
    // reply. `/park + <note>` parks the reply with the note on it. With text
    // selected in the transcript, that text is what is parked, in the reply's
    // place, whatever was typed with it.
    const typed = e.args.trim()
    const picked = await $.ui.selection().catch(() => undefined)
    const selection = picked !== undefined && picked.text.trim() !== '' ? picked : undefined
    const hasReply = selection === undefined && (typed === '' || typed.startsWith('+'))
    const note = typed.replace(/^\+\s*/, '')
    const reply = hasReply
      ? (await $.session.messages()).findLast(one => one.role === 'assistant' && one.text.trim() !== '')
      : undefined

    if (hasReply && reply === undefined) {
      return { text: 'Nothing to park yet: the assistant has not replied.' }
    }

    const body = selection?.text ?? reply?.text ?? ''
    const here = await hereOf($)
    const now = await $.clock.now()
    const changed = await change($, backlog =>
      park(backlog, {
        kind: 'needs-you',
        title: titleOf(note, body),
        body,
        note,
        ...(selection?.requestId !== undefined ? { source: selection.requestId } : {}),
        parkedBy: 'user',
        ...here,
        now,
      }),
    )

    if (!('error' in changed) && changed.backlog.sessions?.[here.sessionId] === undefined) {
      void nameSession($)
    }

    return {
      text:
        'error' in changed
          ? changed.error
          : `Parked ${selection !== undefined ? 'the selection ' : ''}as #${changed.backlog.nextId - 1}. /parked shows the list.`,
    }
  })

  // What the list's keyboard region posts: a row to open, or the next scope.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || typeof e.data !== 'object' || e.data === null) {
      return next(e)
    }

    const data = e.data as { open?: unknown; scope?: unknown; defaults?: unknown; undo?: unknown }

    if (data.undo === true) {
      await takeBack($)

      return {}
    }

    if (data.defaults === true) {
      await acceptDefaults($)

      return {}
    }

    if (data.scope === true) {
      await update($, scope, now => nextScope(now))

      return {}
    }

    if (typeof data.open === 'number') {
      if ((await listed($)).some(one => one.id === data.open)) {
        await goTo($, data.open)
      }

      return {}
    }

    return next(e)
  })

  // A question sent from an item's thread. The subagent is started here, in a
  // hook, so that its reply can be shown as it is written (see `ask`); the
  // text field's own handler takes an answer for the main agent.
  on('ui.input', { requestId: PANE }, async ($, e, next) => {
    const text = e.value.trim()

    if (
      e.kind === 'submit' &&
      e.element.startsWith('ask-') &&
      text !== '' &&
      !(await read($, answering)) &&
      (await read($, chat))
    ) {
      const id = await read($, selected)
      const item = (await read($, items)).find(one => one.id === id)

      if (item !== undefined) {
        await ask($, item, text)
      }
    }

    return next(e)
  })

  // The composer is in use while the focus ring is on the text field, and no
  // longer once Tab or a click moves the ring elsewhere.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    const isComposer = e.element?.startsWith('ask-') === true

    if (isComposer) {
      await update($, typing, () => true)
    } else if (await read($, typing)) {
      await update($, typing, () => false)
      await update($, answering, () => false)
    }

    return moved
  })

  on('command.run', { command: 'parked' }, async ($, e) => {
    const asked = e.args.trim()

    if (asked === 'lab') {
      const isOn = !(await read($, lab))
      await update($, lab, () => isOn)

      return { text: `Parked: the keyboard view is ${isOn ? 'on' : 'off'}.` }
    }

    if (asked === 'chat') {
      const isOn = !(await read($, chat))
      await update($, chat, () => isOn)

      if (!isOn) {
        await update($, section, () => 'ticket')
        await disarm($)
      }

      return { text: `Parked: side threads are ${isOn ? 'on' : 'hidden'}.` }
    }

    if (asked === 'work') {
      const own = ownOpen((await load($)).items, await $.session.id())

      if (own.length === 0) {
        return { text: 'Parked: the assistant has nothing of its own open in this session.' }
      }

      // A prompt submitted from inside a command's own hook would wait on the
      // turn that hook is holding: it is sent once the command has answered.
      $.clock.after(50, () => {
        void $.prompt.submit({ text: workPrompt(own) }).catch(() => undefined)
      })

      return { text: `Parked: asked the assistant to go through its ${own.length} own item${own.length === 1 ? '' : 's'}.` }
    }

    if (asked === 'trace') {
      const waiting = await read($, pending)
      const shown = Object.entries(await read($, live)).map(([id, voice]) => `#${id} ${voice.text.length} characters`)

      return {
        text: [
          `Parked trace: listening ${liveTimer === undefined ? 'no' : 'yes'} · waiting on ${waiting.length === 0 ? 'nothing' : waiting.map(id => `#${id}`).join(' ')} · shown ${shown.length === 0 ? 'nothing' : shown.join(', ')} · following ${isFollowing ? 'yes' : 'no'}`,
          ...(trace.length === 0 ? ['Nothing traced since the mod last loaded.'] : trace),
        ].join('\n'),
      }
    }

    // Asked for by name, the pane is parked's own again.
    await update($, guest, () => false)

    if (asked === 'session' || asked === 'project' || asked === 'all') {
      await update($, scope, () => asked)
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

  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person') {
      return next(e)
    }

    // An arrow pressed over the list while the pane, not its keyboard region,
    // has the keys arrives as a one-row scroll with no pointer: it is passed
    // to the region as the arrow it was.
    if (
      (await read($, selected)) === 0 &&
      e.pointer === undefined &&
      Math.abs(e.by) === 1 &&
      (await read($, lab))
    ) {
      const key = e.by < 0 ? 'up' : 'down'
      await update($, nudge, last => ({ key, n: last.n + 1 }))

      return {}
    }

    // While lens draws here the scrolling is lens's.
    if (await read($, guest)) {
      return next(e)
    }

    // An item's view is the engine's to scroll. It keeps to the end of a reply
    // being written only while the user is at the end themselves.
    isFollowing = e.offset + e.bodyRows >= e.contentRows

    return next(e)
  })

  // While the agent is blocked on the user, the item it waits on is one row
  // above the prompt: its title, its options to press, and a way into the
  // pane. The options take a click, or the band's own focus (ctrl+x tab): no
  // digit typed at the prompt answers one, so none is answered by accident.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'mobile' || e.props.hasSurvey) {
      return next(e)
    }

    const armedFor = await read($, armed)
    const waitingOn = armedFor === 0 ? undefined : (await read($, items)).find(one => one.id === armedFor)

    // What is typed next is not the main agent's: that has to be plain to see.
    if (waitingOn !== undefined) {
      const beneath = await next(e).catch(() => null)
      const { Box, Button, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          <Box columnGap={1}>
            <Text color="cyan" bold>
              {ICON.thread} Your next prompt goes to the side thread
            </Text>
            <Text wrap="truncate-end">
              of #{waitingOn.id} {cut(waitingOn.title, Math.max(12, e.props.bodyColumns - 70))}, not the main agent
            </Text>
            <Button key="band-disarm" label="cancel" onPress={() => disarm($)} />
          </Box>
          {beneath}
        </Box>
      )
    }

    const here = await hereOf($)
    const blocking = orderOf(inScope(await read($, items), 'session', here)).filter(
      one => one.status === 'open' && one.kind === 'needs-you' && one.isBlocking === true,
    )
    const item = blocking[0]

    if (item === undefined) {
      return next(e)
    }

    // What another mod draws in the band stays, under this row.
    const beneath = await next(e).catch(() => null)
    const { Box, Button, Text } = $.ui.resolve(e)
    const options = item.options ?? []
    const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : ''
    const taken = options.reduce((sum, text) => sum + text.length + 5, 0) + 12 + more.length
    const room = Math.max(12, e.props.bodyColumns - taken - 22)

    return (
      <Box flexDirection="column">
        <Box columnGap={1}>
          <Text color="error" bold>
            {ICON.blocking} Blocked on you
          </Text>
          <Text wrap="truncate-end">
            #{item.id} {cut(item.title, room)}
            {more}
          </Text>
          {options.map((text, index) => (
            <Button
              key={`band-pick-${item.id}-${index + 1}`}
              label={`${text}${item.preferred === index + 1 ? ' ★' : ''}`}
              onPress={() => respond($, item, index + 1, true)}
            />
          ))}
          <Button
            key="band-open"
            plain
            dimColor
            label="open"
            onPress={async () => {
              await goTo($, item.id)
              await $.ui.open({ id: PANE, title: 'Parked', focus: true, closeOnEscape: true, holdToasts: true })
            }}
          />
        </Box>
        {beneath}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // The thread needs a text field, which the mobile surface does not draw.
    if (e.surface === 'mobile') {
      return next(e)
    }

    const table = $.ui.resolve(e)
    const { Box, Button, Code, Input, Markdown, Text } = table
    // The keyboard view is drawn only where the surface has Client.
    const Client = (await read($, lab)) && 'Client' in table ? table.Client : undefined
    const waiting = await read($, pending)
    const here = await hereOf($)
    const shownScope = await read($, scope)
    const names = await read($, sessions)
    const list = inScope(await read($, items), shownScope, here)
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
    const fyi = open.filter(one => one.kind === 'fyi')
    // What the assistant parked for itself: its own list, after the user's.
    const own = open.filter(one => one.kind === 'self')
    const done = list.filter(one => one.status === 'done').slice(-10).reverse()
    // The order the list draws in, which Next and Prev walk.
    const order = orderOf(list)
    const item = order.find(one => one.id === openId)
    home ??= (await $.env.get('HOME').catch(() => undefined)) ?? ''
    const tilde = (text: string) => tildeOf(text, home ?? '')
    const isElsewhere = (one: ParkedItem) => one.sessionId !== here.sessionId

    // A text as an assistant reply is drawn: headings, lists, tables and code
    // fences, which keep a diagram's spacing. A long one is several elements.
    const markdown = (text: string, isDim = false) =>
      // The margin the rest of the pane keeps, which is the transcript's own;
      // a table is fitted to what is left, since the element fits it to
      // another width (see `fitTables`).
      (
        <Box flexDirection="column" paddingX={PAD}>
          {markdownOf(fitTables(tilde(text), columns)).map(piece =>
            isDim ? <Markdown text={piece} dimColor /> : <Markdown text={piece} />,
          )}
        </Box>
      )

    // Lens is drawing its viewer here: this pane's part is the way back.
    if (item !== undefined && (await read($, guest))) {
      return (
        <Box paddingX={PAD} paddingTop={TOP} columnGap={2}>
          <Button
            key="host-back"
            label={`◂ back to #${item.id}`}
            autoFocus
            onPress={() => perform($, item, 'host-back')}
          />
          <Text dimColor wrap="truncate-end">
            {cut(item.title, Math.max(8, columns - 30))} · in lens
          </Text>
        </Box>
      )
    }

    if (item !== undefined) {
      const at = order.indexOf(item)
      const before = order[at - 1]
      const after = order[at + 1]
      const isOpen = item.status === 'open'
      const thread = item.thread ?? []
      const isWaiting = waiting.includes(item.id)
      const voice = (await read($, live))[String(item.id)]
      const isChat = await read($, chat)
      const isThread = isChat && (await read($, section)) === 'thread'
      const isHandoverOpen = await read($, isBriefOpen)
      const isAnswering = (await read($, answering)) && isOpen
      const isTyping = await read($, typing)
      const typed = await read($, draft)
      const written = await read($, typedNow)
      const isArmed = (await read($, armed)) === item.id
      // The field's own room: the pane less its margins, border, label and
      // the word that names what Enter does.
      const isCut = written.length > columns - 22
      const tone = !isOpen ? 'success' : item.kind === 'fyi' ? 'cyan' : item.kind === 'self' ? SELF_COLOR : toneOf(item)
      const label = !isOpen
        ? `${ICON.done} DONE`
        : item.kind === 'fyi'
          ? `${ICON.fyi} FYI`
          : item.kind === 'self'
            ? `${ICON.todo} ASSISTANT · nothing is asked of you`
            : item.isBlocking === true
            ? `${ICON.blocking} NEEDS ATTENTION · BLOCKING`
            : `${ICON.needs} NEEDS ATTENTION`
      const canAccept = isOpen && item.preferred !== undefined
      const canSend = isChat && thread.some(one => one.role === 'agent')
      const options = item.options ?? []
      const refs = item.refs ?? []
      const note = (item.note ?? '').trim()
      const lastBrief = thread.findLastIndex(one => one.role === 'brief')
      const shownFile = await read($, peek)
      const late = await read($, changed)
      const lastDone = await read($, undo)
      const replies = thread.filter(one => one.role === 'you' || one.role === 'agent').length

      // A shortcut's press. While the composer is in use a letter is text for
      // it, never a shortcut: the press means the text field did not get the key.
      const hot = (letter: string, act: string) => async () => {
        if (await read($, typing)) {
          await update($, draft, text => `${text}${letter}`)
        } else {
          await perform($, item, act)
        }
      }

      // A tool call under its dot, as the transcript draws one: the tool in
      // bold, then what it was given.
      const call = (row: string) => {
        const [made = '', gave] = row.split('\n')
        const at = made.indexOf('(')

        return (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color="success">● </Text>
              <Text bold>{at === -1 ? made : made.slice(0, at)}</Text>
              {at === -1 ? '' : made.slice(at)}
            </Text>
            {gave !== undefined && (
              <Text dimColor wrap="truncate-end">
                {'  ⎿ '}
                {tilde(gave)}
              </Text>
            )}
          </Box>
        )
      }

      // The pane's margin, the same the transcript keeps.
      const padded = (...rows: RenderChildren[]) => (
        <Box flexDirection="column" paddingX={PAD}>
          {rows}
        </Box>
      )

      // A reply under its dot, as the transcript draws one.
      const reply = (text: string) => (
        <Box flexDirection="column">
          {padded(<Text dimColor>● Side agent</Text>)}
          {markdown(text)}
        </Box>
      )

      const message = (one: ParkedMessage, index: number) => {
        if (one.role === 'you') {
          return (
            <Box flexDirection="column" paddingX={PAD}>
              {markdownOf(one.text).map((piece, at) => (
                <Text backgroundColor="userMessageBackground" wrap="wrap">
                  <Text dimColor>{at === 0 ? '❯ ' : '  '}</Text>
                  {piece}
                </Text>
              ))}
            </Box>
          )
        }

        if (one.role === 'note') {
          return padded(
            <Text dimColor wrap="wrap">
              · {markdownOf(one.text)[0] ?? ''}
            </Text>,
          )
        }

        if (one.role === 'agent') {
          return (
            <Box flexDirection="column">
              {padded((one.tools ?? []).map(call))}
              {reply(one.text)}
            </Box>
          )
        }

        // What the subagent was started with: a row that opens to show it.
        return (
          <Box flexDirection="column">
            {padded(
              <Button
                key={`brief-${index}`}
                plain
                dimColor
                {...(index === lastBrief ? { hotkey: 'x' } : {})}
                label={`${isHandoverOpen ? '▾' : '▸'} Handover to the side agent (${wordsOf(one.text)} words)`}
                onPress={hot('x', 'brief')}
              />,
            )}
            {isHandoverOpen && markdown(one.text, true)}
          </Box>
        )
      }

      const composer = (
        <Box flexDirection="column" marginTop={1}>
          {isCut && (
            <Text wrap="wrap">
              <Text dimColor>❯ </Text>
              {markdownOf(written)[0] ?? ''}
            </Text>
          )}
        <Box
          borderStyle="round"
          borderColor={isAnswering ? 'warning' : isTyping ? 'cyan' : 'gray'}
          paddingX={1}
        >
          <Input
            key={askKey(item)}
            value={typed}
            onInput={(value: string) => update($, typedNow, () => value)}
            label={isAnswering ? 'Answer › ' : 'Ask › '}
            placeholder={
              isAnswering
                ? 'Your answer for the main agent · enter sends'
                : isWaiting
                  ? 'Add to your question…'
                  : 'Ask a subagent about this item · enter sends'
            }
            submitLabel="send"
            onSubmit={async (value: string) => {
              if (value.trim() !== '') {
                await update($, draft, () => '')
                await update($, typedNow, () => '')

                // A question for the thread was sent by the `ui.input` hook.
                if (await read($, answering)) {
                  await respond($, item, value.trim())
                }
              } else {
                // Enter on an empty line leaves the composer: the ring moves
                // to a button, and the letters are shortcuts again.
                await $.ui.focus({ requestId: PANE, key: 'back' }).catch(() => undefined)
              }
            }}
          />
        </Box>
        </Box>
      )

      return (
        <Box flexDirection="column" paddingTop={TOP}>
          <Box flexDirection="column" paddingX={PAD}>
          <Box justifyContent="space-between">
            <Text color={tone} bold>
              {label}
            </Text>
            <Text dimColor>
              {at + 1} of {order.length}
            </Text>
          </Box>
          <Text bold wrap="wrap">
            #{item.id} {item.title}
          </Text>
          <Text dimColor wrap="truncate-end">
            parked by {parkerOf(item)} · {ageOf(item.createdAt, now)} ago
            {tagOf(item) === '' ? '' : ` · ${tagOf(item)}`}
            {isElsewhere(item) ? ` · in "${cut(sessionLabel(names, item.sessionId), 32)}"` : ''}
          </Text>
          <Box columnGap={1} flexWrap="wrap">
            {canAccept && <Button key="accept" label="a: Accept" hotkey="a" onPress={hot('a', 'accept')} />}
            {isOpen ? (
              <Button key="done" label="d: Done" hotkey="d" autoFocus onPress={hot('d', 'done')} />
            ) : (
              <Button key="reopen" label="r: Reopen" hotkey="r" autoFocus onPress={hot('r', 'reopen')} />
            )}
            {isOpen && <Button key="write" label="w: Answer" hotkey="w" onPress={hot('w', 'write')} />}
            {item.source !== undefined && !isElsewhere(item) && (
              <Button key="where" label="l: Locate" hotkey="l" onPress={hot('l', 'where')} />
            )}
            {after !== undefined && <Button key="next" label="n: Next" hotkey="n" onPress={hot('n', 'next')} />}
            {before !== undefined && <Button key="prev" label="p: Prev" hotkey="p" onPress={hot('p', 'prev')} />}
            {canSend && <Button key="send" label="s: Send" hotkey="s" onPress={hot('s', 'send')} />}
            {lastDone !== null && <Button key="undo" label="u: Undo" hotkey="u" onPress={hot('u', 'undo')} />}
            <Button key="back" label="b: Back" hotkey="b" onPress={hot('b', 'back')} />
          </Box>
          {late.length > 0 && (
            <Text color="warning" wrap="wrap">
              {ICON.blocking} Stale:{' '}
              {late.length < refs.length ? `${late.length} of its files` : refs.length === 1 ? 'its file' : 'all its files'}{' '}
              changed since this was parked.
            </Text>
          )}
          {item.resolution !== undefined && (
            <Text wrap="wrap">
              <Text color="success">Resolved by {item.resolvedBy === 'user' ? 'you' : 'the agent'}: </Text>
              {item.resolution}
            </Text>
          )}
          {isAnswering && composer}
          {options.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                {ICON.options} Options
              </Text>
              {options.map((text, index) => (
                <Box columnGap={2} paddingLeft={2}>
                  {isOpen ? (
                    <Button
                      key={`pick-${index + 1}`}
                      plain
                      hotkey={String(index + 1)}
                      label={text}
                      onPress={hot(String(index + 1), `pick-${index + 1}`)}
                    />
                  ) : (
                    <Text dimColor>
                      {index + 1}. {text}
                    </Text>
                  )}
                  {item.preferred === index + 1 && <Text color={STAR_COLOR}>{ICON.preferred} default</Text>}
                </Box>
              ))}
            </Box>
          )}
          {/* A rule parts what is acted on, above, from what is read, below. */}
          <Text dimColor>{rule}</Text>
          <Box>
            <Button
              key="section-ticket"
              plain
              label={`${isThread ? '▸' : '▾'} Ticket`}
              onPress={hot('', 'ticket')}
            />
          </Box>
          </Box>
          {!isThread && (
            <Box flexDirection="column">
              <Box flexDirection="column" paddingX={PAD}>
              {note !== '' && <Text color="warning">Your note:</Text>}
              {markdownOf(note).map((piece, at) => (
                <Text backgroundColor="userMessageBackground" wrap="wrap">
                  <Text dimColor>{at === 0 ? '❯ ' : '  '}</Text>
                  {piece}
                </Text>
              ))}
              {note !== '' && item.body.trim() !== '' && <Text dimColor>{'─'.repeat(columns - 2)}</Text>}
              {item.parkedBy === 'user' && item.body.trim() !== '' && <Text color="cyan">Assistant reply:</Text>}
              </Box>
              {markdown(item.body)}
              {refs.length > 0 && (
                <Box flexDirection="column" marginTop={1} paddingX={PAD}>
                  <Text>
                    <Text color={FOLDER_COLOR}>{ICON.folderOpen} Files</Text>
                    <Text dimColor> · press one to read it here</Text>
                  </Text>
                  {refs.map((ref, index) => (
                    <Box paddingLeft={2}>
                      <Text color={refIcon(ref).color}>{refIcon(ref).glyph} </Text>
                      <Button
                        key={`ref-${index}`}
                        plain
                        label={`${shownFile?.at === index ? '▾ ' : ''}${tilde(ref)}`}
                        onPress={hot('', `go-${index}`)}
                      />
                      {late.includes(index) && <Text color="warning"> · stale</Text>}
                    </Box>
                  ))}
                  {shownFile !== null && (
                    <Box flexDirection="column" marginTop={1} width={columns - 2}>
                      <Text dimColor wrap="truncate-end">
                        ── {tilde(shownFile.path)}
                        {shownFile.line > 0 ? ` · line ${shownFile.line}` : ''}
                      </Text>
                      {shownFile.error !== undefined ? (
                        <Text color="warning">{shownFile.error}</Text>
                      ) : (
                        <Code
                          source={shownFile.source}
                          path={shownFile.path}
                          startLine={shownFile.start}
                          wrap="truncate-end"
                        />
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )}
          {isChat && (
          <Box marginTop={isThread ? 0 : 1} columnGap={2} paddingX={PAD}>
            <Button
              key="section-thread"
              plain
              hotkey="t"
              label={`${isThread ? '▾' : '▸'} Side thread${replies === 0 ? '' : ` (${replies})`}`}
              onPress={hot('t', 'thread')}
            />
            {!isThread && isWaiting && (
              <Text dimColor wrap="truncate-end">
                ● {cut((voice?.text || voice?.stage || '').replace(/\s+/g, ' ').trim().slice(-Math.max(10, columns - 34)), Math.max(10, columns - 30))}
              </Text>
            )}
          </Box>
          )}
          {isThread && (
            <Box flexDirection="column" rowGap={1}>
              {thread.length === 0 &&
                padded(
                  <Text dimColor wrap="wrap">
                    Ask a subagent to look into this. The main agent does not see this thread.
                  </Text>,
                )}
              {thread.length > THREAD_SHOWN &&
                padded(<Text dimColor>· {thread.length - THREAD_SHOWN} earlier messages are not shown</Text>)}
              {thread.map((one, index) => (index < thread.length - THREAD_SHOWN ? null : message(one, index)))}
              {isWaiting && (
                <Box flexDirection="column">
                  {padded((voice?.tools ?? []).map(call))}
                  {(voice?.text ?? '') !== ''
                    ? reply(voice?.text ?? '')
                    : padded(
                        <Text dimColor wrap="truncate-end">
                          ● {voice?.stage ?? ''}
                        </Text>,
                      )}
                </Box>
              )}
              {!isAnswering && (
                <Box flexDirection="column" paddingX={PAD}>
                  {composer}
                  <Box columnGap={2} flexWrap="wrap">
                    <Button key="type" plain dimColor hotkey="i" label="type here" onPress={hot('i', 'type')} />
                    <Button
                      key="arm"
                      plain
                      dimColor={!isArmed}
                      hotkey="m"
                      label={isArmed ? 'waiting on the prompt box: esc, then type there · m cancels' : 'write it in the prompt box'}
                      onPress={hot('m', 'arm')}
                    />
                  </Box>
                </Box>
              )}
            </Box>
          )}
          <Box flexDirection="column" paddingX={PAD}>
          <Text dimColor>{rule}</Text>
          <Text dimColor wrap="truncate-end">
            {isTyping
              ? 'enter sends · enter on an empty line leaves the composer'
              : `${options.length > 0 && isOpen ? `1-${options.length} answer · ` : ''}${isChat ? `t ${isThread ? 'ticket' : 'side thread'} · ` : ''}scroll moves the view · esc close`}
          </Text>
          </Box>
        </Box>
      )
    }

    // The scope is a button of the pane's own, above the list in either view.
    const scopeText =
      shownScope === 'session'
        ? `this session, "${cut(sessionLabel(names, here.sessionId), Math.max(8, columns - 34))}"`
        : shownScope === 'project'
          ? 'every session of this project'
          : 'every session'
    const scopeRow = (
      <Button
        key="scope"
        plain
        dimColor
        hotkey="v"
        label={`showing ${scopeText}`}
        onPress={() => update($, scope, last => nextScope(last))}
      />
    )
    // One press for every item whose answer can be the agent's own pick.
    const picks = defaultsOf(list).length
    const defaultsRow =
      picks === 0 ? null : (
        <Button
          key="defaults"
          plain
          dimColor
          hotkey="a"
          label={`accept ${picks === 1 ? 'the one default' : `all ${picks} defaults`}`}
          onPress={() => acceptDefaults($)}
        />
      )
    const lastDone = await read($, undo)
    const undoRow =
      lastDone === null ? null : (
        <Button key="undo" plain dimColor hotkey="u" label={`undo ${lastDone.label}`} onPress={() => takeBack($)} />
      )
    // An item of another session is listed with that session's name.
    const metaOf = (one: ParkedItem) => {
      const from = isElsewhere(one) ? `${cut(sessionLabel(names, one.sessionId), 18)} · ` : ''
      const talk =
        (one.thread ?? []).length > 0
          ? `${waiting.includes(one.id) ? '…' : `${ICON.thread} `}${(one.thread ?? []).length} · `
          : ''

      return `${from}${tagOf(one) === '' ? '' : `${tagOf(one)} · `}${talk}${one.status === 'done' ? 'done' : ageOf(one.createdAt, now)}`
    }

    const summary = [
      needs.length > 0 ? `${needs.length} need${needs.length === 1 ? 's' : ''} attention` : '',
      fyi.length > 0 ? `${fyi.length} FYI` : '',
      own.length > 0 ? `${own.length} assistant` : '',
      done.length > 0 ? `${done.length} done` : '',
    ]
      .filter(Boolean)
      .join(' · ')

    // Where the surface has Client, the list is one region that owns the
    // keyboard once clicked; the letter buttons beneath drive it with no click.
    if (Client !== undefined) {
      const entry = (one: ParkedItem, glyph: string, tone: string) => {
        const meta = metaOf(one)
        const room = columns - meta.length - 9 - String(one.id).length

        return { kind: 'row', id: one.id, glyph, tone, text: cut(one.title, Math.max(1, room)), meta, isDone: one.status === 'done' }
      }
      const head = (text: string, tone: string) => ({ kind: 'head', id: 0, glyph: '', tone, text, meta: '', isDone: false })
      const height = Math.max(16, e.props.scroll.bodyRows) - 3 - TOP

      return (
        <Box flexDirection="column" paddingX={PAD} paddingTop={TOP}>
          <Client
            key="detail"
            module="./detail.tsx"
            height={height}
            props={{
              nudge: await read($, nudge),
              from: lastShown,
              columns,
              rows: height,
              summary,
              entries: [
                ...(needs.length > 0 ? [head('NEEDS ATTENTION', 'warning')] : []),
                ...needs.map(one => entry(one, glyphOf(one), toneOf(one))),
                ...(fyi.length > 0 ? [head('FYI', 'cyan')] : []),
                ...fyi.map(one => entry(one, ICON.fyi, 'cyan')),
                ...(own.length > 0 ? [head('ASSISTANT', SELF_COLOR)] : []),
                ...own.map(one => entry(one, ICON.todo, SELF_COLOR)),
                ...(done.length > 0 ? [head('DONE', 'success')] : []),
                ...done.map(one => entry(one, ICON.done, 'success')),
              ],
            }}
          />
          {scopeRow}
          <Box columnGap={2}>
            {defaultsRow}
            {undoRow}
            {(
              [
                ['j', '↓'],
                ['k', '↑'],
                ['o', 'open'],
              ] as const
            ).map(([letter, means]) => (
              <Button
                key={`key-${letter}`}
                plain
                dimColor
                hotkey={letter}
                label={means}
                onPress={() => update($, nudge, last => ({ key: letter, n: last.n + 1 }))}
              />
            ))}
          </Box>
        </Box>
      )
    }

    // Digits 1-9 open the first nine rows; the rest are reached with ↑↓.
    const row = (one: ParkedItem, glyph: string, tone: string) => {
      const index = order.indexOf(one)
      const meta = metaOf(one)

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
              label={cut(one.title, Math.max(1, columns - meta.length - 12))}
              onPress={() => goTo($, one.id)}
            />
          </Box>
          <Text dimColor>{meta}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={PAD} paddingTop={TOP}>
        <Text bold>📌 Parked{summary === '' ? '' : ` · ${summary}`}</Text>
        {scopeRow}
        {defaultsRow}
        {undoRow}
        <Text dimColor>{rule}</Text>
        {list.length === 0 && <Text dimColor>Nothing parked here yet.</Text>}
        {list.length === 0 && (
          <Text dimColor>/park [note] parks the last reply; the agent parks items as jobs report.</Text>
        )}
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
        {own.length > 0 && (
          <Box marginTop={needs.length + fyi.length > 0 ? 1 : 0}>
            <Text color={SELF_COLOR} bold>
              ASSISTANT
            </Text>
          </Box>
        )}
        {own.map(one => row(one, ICON.todo, SELF_COLOR))}
        {done.length > 0 && (
          <Box marginTop={open.length > 0 ? 1 : 0}>
            <Text color="success" bold>
              DONE
            </Text>
          </Box>
        )}
        {done.map(one => row(one, ICON.done, 'success'))}
        <Text dimColor>{rule}</Text>
        <Text dimColor>1-9 open · ↑↓ move · enter open · v scope · esc close</Text>
      </Box>
    )
  })
}
