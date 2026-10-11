import { expect, mock, test } from 'claude-code/testing'

import {
  EMPTY,
  answer,
  answerOf,
  answersNote,
  orderOf,
  sent,
  mergedRuns,
  placeOfRef,
  syncLedger,
  unsend,
  unsentOf,
  briefRequest,
  describe,
  doneNote,
  handoff,
  investigationPrompt,
  park,
  reopen,
  resolve,
  say,
  sayOnce,
  sayReply,
  statusText,
  summaryRequest,
  titleOf,
  handoverOf,
  inScope,
  knowSession,
  markdownOf,
  migrate,
  nextScope,
  pruned,
  reportIn,
  callLabel,
  isReminderDue,
  ownOpen,
  reminderOf,
  sessionLabel,
  sessionNameOf,
  stringsIn,
  syncSession,
  tidyBody,
  pathOfRef,
  restore,
  fitTables,
  tildeOf,
  excerptOf,
  defaultsOf,
  digestOf,
  resultLine,
  workPrompt,
} from '../hooks/backlog'

// The pane as a test mounts it: docked, focused, 80 by 40.
const PANE = {
  plugin: 'parked',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'parked',
  props: {
    title: 'Parked',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
  viewport: { columns: 80, rows: 40 },
} as const

// The list is drawn by a keyboard region; an item by the hooks module itself.
const LIST = { in: 'detail' }

const must = <T>(value: T | string): T => {
  if (typeof value === 'string') {
    throw new Error(value)
  }

  return value
}

const item = (kind: 'needs-you' | 'fyi' | 'self', title: string) => ({
  kind,
  title,
  body: 'body',
  parkedBy: 'model' as const,
  sessionId: 's',
  now: 0,
})

test('park, resolve and reopen keep every item', () => {
  const parked = park(park(EMPTY, item('needs-you', 'a')), item('fyi', 'b'))
  expect(parked.items.map(one => one.id)).toEqual([1, 2])

  const resolved = resolve(parked, 1, 'fixed', 'model', 5)
  expect(typeof resolved).toBe('object')

  if (typeof resolved === 'string') {
    return
  }

  expect(resolved.items[0]?.status).toBe('done')
  expect(resolve(resolved, 1, 'again', 'model', 6)).toBe('Parked item #1 is already done.')
  expect(resolve(resolved, 9, 'x', 'model', 6)).toBe('No parked item #9.')

  const reopened = reopen(resolved, 1)
  expect(typeof reopened === 'string' ? reopened : reopened.items[0]?.status).toBe('open')
  expect(typeof reopened === 'string' ? reopened : reopened.items[0]?.resolution).toBeUndefined()
})

test('status text counts open items by kind', () => {
  const one = park(EMPTY, item('needs-you', 'a'))
  const both = park(park(one, item('fyi', 'b')), item('needs-you', 'c'))

  expect(statusText([])).toBeUndefined()
  expect(statusText(one.items)).toBe('📌 1 needs attention')
  expect(statusText(both.items)).toBe('📌 2 need attention · 1 FYI')
  // FYIs alone leave the status line clear.
  expect(statusText(both.items.filter(item => item.kind === 'fyi'))).toBeUndefined()
})

test('a manual park is titled by the note, else the reply’s first line', () => {
  expect(titleOf('check retries', '## Report\nbody')).toBe('check retries')
  expect(titleOf('', '\n## Report\nbody')).toBe('Report')
  expect(titleOf('', 'x'.repeat(200)).length).toBe(80)
})

test('the model parks, lists and resolves through its tools', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))

  const parked = await $.tool.call({
    tool: 'mcp__parked__park',
    kind: 'needs-you',
    title: 'Pick a queue',
    body: 'Redis or SQS?',
  })
  expect(parked.result).toBe('Parked as #1.')

  const listed = await $.tool.call({ tool: 'mcp__parked__list_parked' })
  expect(String(listed.result)).toContain('#1 [needs-you] Pick a queue')

  const resolved = await $.tool.call({ tool: 'mcp__parked__resolve', id: 1, resolution: 'SQS' })
  expect(resolved.result).toBe('Resolved #1.')

  const after = await $.tool.call({ tool: 'mcp__parked__list_parked' })
  expect(after.result).toBe('No parked items.')
})

test('a side thread stays on the item and out of what the agent lists', () => {
  const parked = park(EMPTY, item('needs-you', 'a'))
  const asked = say(parked, 1, { role: 'you', text: 'why?', at: 1 }, 'agent-1')
  const answered = typeof asked === 'string' ? asked : say(asked, 1, { role: 'agent', text: 'because', at: 2 })

  if (typeof answered === 'string') {
    throw new Error(answered)
  }

  const one = answered.items[0]

  if (one === undefined) {
    throw new Error('no item')
  }

  expect(one.thread?.map(message => message.text)).toEqual(['why?', 'because'])
  expect(one.agentId).toBe('agent-1')
  expect(describe(one)).not.toContain('because')
  expect(handoff(one)).toContain('because')
  expect(handoff(one, 'It was the queue.')).toContain('It was the queue.')
  expect(handoff(one, 'It was the queue.')).not.toContain('because')
  expect(summaryRequest(one)).toContain('Subagent: because')
  expect(investigationPrompt(one, 'and then?')).toContain("The user's message: and then?")
  expect(doneNote(one)).toContain('Last finding: because')
  expect(say(parked, 9, { role: 'you', text: 'x', at: 1 })).toBe('No parked item #9.')
})

test('a fresh subagent gets the briefing, and notes stay out of its replayed thread', () => {
  const parked = park(EMPTY, item('needs-you', 'a'))
  const noted = say(parked, 1, { role: 'note', text: 'briefed', at: 1 })
  const one = typeof noted === 'string' ? undefined : noted.items[0]

  if (one === undefined) {
    throw new Error('no item')
  }

  const prompt = investigationPrompt(one, 'why?', 'The queue lives in src/queue.ts.')
  expect(prompt).toContain('Briefing from the main session')
  expect(prompt).toContain('src/queue.ts')
  expect(prompt).not.toContain('Earlier in this thread')
  expect(investigationPrompt(one, 'why?')).not.toContain('Briefing from the main session')
  // A subagent started ahead of its briefing is told that one is on its way.
  expect(investigationPrompt(one, 'why?', '', true)).toContain('will reach you as a message')
  expect(briefRequest(one)).toContain('Parked item #1 [needs-you]: a')
})

test('one report reaching the thread twice is kept once', () => {
  const asked = say(park(EMPTY, item('needs-you', 'a')), 1, { role: 'you', text: 'why?', at: 1 })

  if (typeof asked === 'string') {
    throw new Error(asked)
  }

  const once = sayOnce(asked, 1, { role: 'agent', text: '**Found it.**\n\n- the queue drops items', at: 2 })
  const twice = typeof once === 'string' ? once : sayOnce(once, 1, { role: 'agent', text: '  Found it.\n  \n  - the queue drops items', at: 3 })
  const other = typeof twice === 'string' ? twice : sayOnce(twice, 1, { role: 'agent', text: 'A different reply.', at: 4 })

  expect(typeof twice === 'string' ? twice : twice.items[0]?.thread?.length).toBe(2)
  expect(typeof other === 'string' ? other : other.items[0]?.thread?.length).toBe(3)

  // A second reply to one message is the first thought again, as when a
  // briefing reaches the subagent late: it takes the first one's place, with
  // the calls of both runs, or is dropped when nothing changed.
  const first = must(sayReply(asked, 1, { role: 'agent', text: 'Two writes race.', at: 2, tools: ['Read(a.ts)'] }))
  const same = must(sayReply(first, 1, { role: 'agent', text: 'NO CHANGE.', at: 3 }))
  expect(same).toBe(first)
  const revised = must(sayReply(first, 1, { role: 'agent', text: 'Three writes race.', at: 4, tools: ['Read(b.ts)'] }))
  expect(revised.items[0]?.thread?.map(one => one.text)).toEqual(['why?', 'Three writes race.'])
  expect(revised.items[0]?.thread?.[1]?.tools).toEqual(['Read(a.ts)', 'Read(b.ts)'])
  // After the user's next message, a reply is a new one.
  const again = must(say(revised, 1, { role: 'you', text: 'and then?', at: 5 }))
  expect(must(sayReply(again, 1, { role: 'agent', text: 'Then it retries.', at: 6 })).items[0]?.thread?.length).toBe(4)
})

test('the list’s keyboard region opens an item, and the item’s own buttons walk and close it', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))

  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'First', body: 'one' })
  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'Second', body: 'two' })

  const ui = await $.ui.mount(PANE)
  const inList = async (text: RegExp) => (await ui.find({ type: 'Text', text, ...LIST })) !== undefined
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined

  // The list: Enter opens the row under the cursor.
  expect(await inList(/Parked · 2 need attention/)).toBe(true)
  await ui.key({ key: 'return', ...LIST })
  expect(await has(/#1 First/)).toBe(true)
  // The body is drawn as a reply is, by the Markdown element.
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('one')

  // Next and Prev walk the items; Back is the list again.
  await ui.press({ key: 'next' })
  expect(await has(/#2 Second/)).toBe(true)
  await ui.press({ key: 'prev' })
  expect(await has(/#1 First/)).toBe(true)
  await ui.press({ key: 'next' })
  await ui.press({ key: 'back' })
  expect(await inList(/Parked · 2 need attention/)).toBe(true)

  // The cursor came back on the second row: k moves up and o opens, as vim
  // keys in the region or as the pane's own letter buttons, which need no click.
  await ui.key({ key: 'k', ...LIST })
  await ui.key({ key: 'o', ...LIST })
  expect(await has(/#1 First/)).toBe(true)
  await ui.press({ key: 'back' })
  await ui.press({ key: 'key-j' })
  await ui.press({ key: 'key-o' })
  expect(await has(/#2 Second/)).toBe(true)
})

test('the side thread is closed until asked for, so no text field takes the keys', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))

  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'First', body: 'one' })

  const ui = await $.ui.mount(PANE)
  await ui.key({ key: 'return', ...LIST })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('one')

  // Side threads are hidden for now: an item offers none until `/parked chat`.
  expect((await ui.findAll({ type: 'Button' })).some(one => one.key === 'section-thread')).toBe(false)
  await $.command.run({ command: 'parked', args: 'chat' } as never)

  // t opens the thread in the ticket's place, with its composer.
  await ui.press({ key: 'section-thread' })
  expect(await ui.find({ type: 'Input' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Ask a subagent to look into this/ })).toBeDefined()

  // The field is one line and cuts a long message: what is typed is shown
  // whole above it once it no longer fits.
  await ui.input({ key: 'ask-1-0', text: 'short', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /❯ short/ })).toBeUndefined()
  const long = `for these findings, what is new in the latest release and what could we ${'do '.repeat(12)}with it?`
  await ui.input({ key: 'ask-1-0', text: long, kind: 'change' })
  expect((await ui.find({ type: 'Text', text: /❯ for these findings/ }))?.text).toContain('with it?')

  // t again, or the ticket's own heading, puts the ticket back and the field away.
  await ui.press({ key: 'section-thread' })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  await ui.press({ key: 'section-thread' })
  await ui.press({ key: 'section-ticket' })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
})

test('a side thread keeps the handover its subagent began with, and shows the reply as it is written', async ($, on) => {
  // The first item's thread already has its subagent, as one asked before
  // does: only the engine starts one, so the store begins with it.
  const first = park(EMPTY, { ...item('needs-you', 'First'), sessionId: 's1' })
  mock.store(on, {
    backlog: {
      ...first,
      items: first.items.map(one => ({
        ...one,
        agentId: 'agent-1',
        isStreamed: true,
        thread: [{ role: 'brief', text: handoverOf(one, 'why does it drop items?', 'The queue lives in src/queue.ts.'), at: 1 }],
      })),
    },
  })
  const clock = mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))
  on('session.send', () => ({ isDelivered: true }))
  // A subagent's step, as the engine streams it: a tool call, then its report
  // handed back as another call's arguments, in pieces.
  on('turn.step', async function* (_$, e) {
    yield { kind: 'tool', index: 0, id: 'tu-1', name: 'Read' }
    yield { kind: 'input', index: 0, json: '{"file_path":"src/que' }
    yield { kind: 'input', index: 0, json: 'ue.ts"}' }
    yield { kind: 'tool', index: 1, id: 'tu-2', name: 'HandBack' }
    yield { kind: 'input', index: 1, json: '{"report":"Two writes' }
    yield { kind: 'input', index: 1, json: ' race.\\n\\n- the second wins"}' }

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })

  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'Second', body: 'two' })
  await $.command.run({ command: 'parked', args: 'chat' } as never)

  const ui = await $.ui.mount(PANE)
  const texts = async () => (await ui.findAll({ type: 'Markdown' })).map(one => one.props.text)

  // What a subagent was handed is a row of its thread, shut until it is pressed.
  await ui.key({ key: 'return', ...LIST })
  await ui.press({ key: 'section-thread' })

  const handover = (await ui.findAll({ type: 'Button' })).find(one => String(one.key).startsWith('brief-'))
  expect(String(handover?.props.label)).toContain('Handover to the side agent')
  expect((await texts()).some(text => String(text).includes('**Your message:**'))).toBe(false)
  await ui.press({ key: String(handover?.key) })
  expect((await texts()).some(text => String(text).includes('**Your message:** why does it drop items?'))).toBe(true)

  // A question to a thread that has its subagent goes to it, and the reply is
  // in the thread as it is written, under the tools it called on the way.
  await ui.press({ key: String(handover?.key) })
  await ui.input({ key: 'ask-1-0', text: 'and when two run?' })

  for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, agentId: 'agent-1' })) {
    // Read to its end, as the engine does.
  }

  await clock.advance(200)
  expect(await texts()).toContain('Two writes race.\n\n- the second wins')
  // A call is drawn as the transcript draws one: the tool, then what it was given.
  expect(await ui.find({ type: 'Text', text: /● Read\(src\/queue\.ts\)/ })).toBeDefined()
})

const choice = (isBlocking: boolean) => ({
  ...item('needs-you', 'Pick a queue'),
  options: ['Redis', 'SQS'],
  preferred: 1,
  isBlocking,
  refs: ['src/queue.ts:12'],
})

test('a choice shows its options first, and work it blocks comes first', () => {
  const parked = park(park(park(EMPTY, item('needs-you', 'plain')), choice(false)), choice(true))
  const [, open, blocking] = parked.items

  if (open === undefined || blocking === undefined) {
    throw new Error('no item')
  }

  // Whichever option the agent names as its default is listed first.
  const second = park(EMPTY, { ...choice(false), preferred: 2 }).items[0]
  expect(second?.options).toEqual(['SQS', 'Redis'])
  expect(second?.preferred).toBe(1)
  expect(describe(open)).toContain('Options: 1) Redis  2) SQS (default 1)')
  expect(describe(blocking)).toContain('Blocking: work is waiting on the user.')
  expect(orderOf(parked.items).map(one => one.id)).toEqual([3, 1, 2])
  expect(statusText(parked.items)).toBe('📌 3 need attention (1 blocking)')
})

test('taking the default of work already under way is silent; any other answer is sent once', () => {
  const parked = park(park(park(EMPTY, choice(false)), choice(false)), choice(true))
  const [first] = parked.items

  if (first === undefined) {
    throw new Error('no item')
  }

  expect(answerOf(first, 1)).toEqual({ text: 'option 1, Redis', isSilent: true })
  expect(answerOf(first, 2)).toEqual({ text: 'option 2, SQS', isSilent: false })
  // A typed number names an option; other words are the answer as written.
  expect(answerOf(first, ' 2 ')).toEqual({ text: 'option 2, SQS', isSilent: false })
  expect(answerOf(first, 'neither, use the outbox table')).toEqual({
    text: 'neither, use the outbox table',
    isSilent: false,
  })
  expect(answerOf(first, 3)).toBe('Parked item #1 has no option 3.')
  expect(answerOf(first, '  ')).toBe('Parked item #1 needs an answer.')

  // #1 takes its default, #2 overturns its default, #3 was blocking.
  const steps = [
    [1, 1],
    [2, 2],
    [3, 1],
  ] as const
  let backlog = parked

  for (const [id, pick] of steps) {
    const next = answer(backlog, id, pick, 9)

    if (typeof next === 'string') {
      throw new Error(next)
    }

    backlog = next
  }

  expect(backlog.items.map(one => one.status)).toEqual(['done', 'done', 'done'])
  expect(backlog.items[0]?.resolution).toBe('You accepted the default: option 1, Redis')
  expect(unsentOf(backlog.items).map(one => one.id)).toEqual([2, 3])
  expect(answersNote(unsentOf(backlog.items))).toBe(
    [
      'My answers to parked items:',
      '- #2 Pick a queue: option 2, SQS (not your default, option 1, Redis: revise what was built on it)',
      '- #3 Pick a queue: option 1, Redis',
    ].join('\n'),
  )
  expect(unsentOf(sent(backlog, [2, 3]).items)).toEqual([])
  expect(answer(backlog, 1, 2, 10)).toBe('Parked item #1 is already done.')

  // Given a session, only the answers made in it are its agent's to hear; an
  // answer whose sending failed is unsent again.
  const here = must(answer(parked, 1, 2, 9, 's1'))
  const there = must(answer(here, 2, 2, 9, 's2'))
  expect(unsentOf(there.items, 's1').map(one => one.id)).toEqual([1])
  expect(unsentOf(unsend(sent(there, [1]), [1]).items, 's1').map(one => one.id)).toEqual([1])

  // Reopening an answered item forgets the answer.
  const reopened = reopen(backlog, 2)
  expect(typeof reopened === 'string' ? reopened : unsentOf(reopened.items).map(one => one.id)).toEqual([3])
})

test('the park tool takes options, a default, blocking and refs, and refuses a default it has no option for', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))

  const refused = await $.tool.call({
    tool: 'mcp__parked__park',
    kind: 'needs-you',
    title: 'Pick a queue',
    body: 'Which one?',
    options: ['Redis', 'SQS'],
    default: 3,
  })
  expect(String(refused.deny)).toContain('default as the number of one of its 2 options')

  await $.tool.call({
    tool: 'mcp__parked__park',
    kind: 'needs-you',
    title: 'Pick a queue',
    body: 'Which one?',
    options: ['Redis', 'SQS'],
    default: 2,
    blocking: true,
    refs: ['src/queue.ts:12'],
  })

  const listed = String((await $.tool.call({ tool: 'mcp__parked__list_parked' })).result)
  expect(listed).toContain('Options: 1) SQS  2) Redis (default 1)')
  expect(listed).toContain('Blocking: work is waiting on the user.')
  expect(listed).toContain('Files: src/queue.ts:12')
})

test('answers given in the pane reach the main agent as one prompt, and an accepted default sends nothing', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })

  for (const title of ['First', 'Second', 'Third']) {
    await $.tool.call({
      tool: 'mcp__parked__park',
      kind: 'needs-you',
      title,
      body: 'Which one?',
      options: ['Redis', 'SQS'],
      default: 1,
    })
  }

  const ui = await $.ui.mount(PANE)
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined

  await ui.key({ key: 'return', ...LIST })
  expect(await has(/#1 First/)).toBe(true)
  // Each option is a button its number presses; the default is listed first.
  expect((await ui.find({ type: 'Button', key: 'pick-1' }))?.props.label).toBe('Redis')
  expect(await has(/default/)).toBe(true)

  // a takes the default: the item is done, the next one opens, nothing is sent.
  await ui.press({ key: 'accept' })
  expect(await has(/#2 Second/)).toBe(true)
  // 2 picks SQS on each of the rest; there is no button past the options.
  expect(await ui.find({ type: 'Button', key: 'pick-3' })).toBeUndefined()
  await ui.press({ key: 'pick-2' })
  expect(await has(/#3 Third/)).toBe(true)
  await ui.press({ key: 'pick-2' })
  expect(await ui.find({ type: 'Text', text: /3 done/, ...LIST })).toBeDefined()

  expect(prompts).toEqual([])
  await clock.advance(3000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('- #2 Second: option 2, SQS (not your default')
  expect(prompts[0]).toContain('- #3 Third: option 2, SQS')
  expect(prompts[0]).not.toContain('#1 First')

  // Sent once: a later batch does not carry them again.
  await clock.advance(10000)
  expect(prompts.length).toBe(1)
})

test('w turns the composer into an answer in the user’s own words', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })

  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'Retries', body: 'How many?' })

  const ui = await $.ui.mount(PANE)

  // The answer's text field is drawn only once it is asked for.
  await ui.key({ key: 'return', ...LIST })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.press({ key: 'write' })
  expect((await ui.find({ type: 'Input' }))?.props.placeholder).toContain('Your answer for the main agent')
  await ui.input({ key: 'ask-1-0', text: '3 x' })
  await clock.advance(3000)
  expect(prompts).toEqual(['My answers to parked items:\n- #1 Retries: 3 x'])

  const listed = await $.tool.call({ tool: 'mcp__parked__list_parked', includeDone: true })
  expect(String(listed.result)).toContain('Resolution: You answered: 3 x')
})

test('the ledger’s run parks a failed gate and one review item per unit, and closes them as it moves on', () => {
  const task = (id: string, unit: string, status: 'todo' | 'running' | 'gate-failed' | 'done', note?: string) => ({
    id,
    unit,
    title: `do ${id}`,
    status,
    ...(note !== undefined ? { note } : {}),
  })
  const finding = (id: number, severity: 'error' | 'warning', taskId: string | undefined, status: 'open' | 'fixed' = 'open') => ({
    id,
    path: 'src/a.ts',
    line: id,
    severity,
    summary: `problem ${id}`,
    status,
    ...(taskId !== undefined ? { task: taskId } : {}),
  })
  const run = (tasks: ReturnType<typeof task>[], findings: ReturnType<typeof finding>[] = []) => ({
    goal: 'g',
    tasks,
    findings,
  })
  const open = (backlog: { items: { status: string; title: string }[] }) =>
    backlog.items.filter(one => one.status === 'open').map(one => one.title)

  // With no ledger, or a run with nothing wrong, the backlog is left as it is.
  expect(syncLedger(EMPTY, undefined, 1, 's')).toBe(EMPTY)
  expect(syncLedger(EMPTY, run([task('T1', 'API', 'running')]), 1, 's').items).toEqual([])

  // A gate fails: one FYI. The same run again changes nothing.
  const failed = syncLedger(EMPTY, run([task('T1', 'API', 'gate-failed', 'tests fail')]), 1, 's')
  expect(open(failed)).toEqual(['Gate failed: T1 do T1'])
  expect(failed.items[0]?.kind).toBe('fyi')
  expect(failed.items[0]?.body).toContain('tests fail')
  expect(syncLedger(failed, run([task('T1', 'API', 'gate-failed', 'tests fail')]), 2, 's')).toBe(failed)

  // The gate passes: the item closes by itself.
  const passed = syncLedger(failed, run([task('T1', 'API', 'done')]), 3, 's')
  expect(open(passed)).toEqual([])
  expect(passed.items[0]?.resolution).toBe('The gate passed.')

  // Findings: one item per unit, needing the user when one is an error; a
  // finding with no task is under its own heading.
  const tasks = [task('T1', 'API', 'done'), task('T2', 'Schema', 'done')]
  const reviewed = syncLedger(
    EMPTY,
    run(tasks, [finding(1, 'error', 'T1'), finding(2, 'warning', 'T1'), finding(3, 'warning', 'T2'), finding(4, 'warning', undefined)]),
    4,
    's',
  )
  expect(open(reviewed)).toEqual([
    'Review of API: 2 findings (1 error)',
    'Review of Schema: 1 finding',
    'Review of Other changes: 1 finding',
  ])
  expect(reviewed.items.map(one => one.kind)).toEqual(['needs-you', 'fyi', 'fyi'])
  expect(reviewed.items[0]?.refs).toEqual(['src/a.ts:1', 'src/a.ts:2'])
  expect(reviewed.items[0]?.body).toContain('- error src/a.ts:1 problem 1 (T1)')

  // The error is fixed: the same item is updated, not parked again.
  const partly = syncLedger(
    reviewed,
    run(tasks, [finding(1, 'error', 'T1', 'fixed'), finding(2, 'warning', 'T1'), finding(3, 'warning', 'T2'), finding(4, 'warning', undefined)]),
    5,
    's',
  )
  expect(partly.items.length).toBe(3)
  expect(partly.items[0]?.title).toBe('Review of API: 1 finding')
  expect(partly.items[0]?.kind).toBe('fyi')

  // The user closes a review item by hand: the findings it carried do not
  // bring it back, but a new finding in that unit does.
  const byHand = resolve(partly, 2, 'seen', 'user', 6)

  if (typeof byHand === 'string') {
    throw new Error(byHand)
  }

  const still = run(tasks, [finding(2, 'warning', 'T1'), finding(3, 'warning', 'T2'), finding(4, 'warning', undefined)])
  expect(syncLedger(byHand, still, 7, 's')).toBe(byHand)
  const again = syncLedger(byHand, run(tasks, [...still.findings, finding(5, 'warning', 'T2')]), 8, 's')
  expect(open(again)).toContain('Review of Schema: 2 findings')

  // Everything fixed, then the run cleared: nothing of the ledger's is open.
  const allFixed = syncLedger(again, run(tasks, again.seen?.findings.map(id => finding(id, 'warning', 'T1', 'fixed')) ?? []), 9, 's')
  expect(open(allFixed)).toEqual([])
  expect(syncLedger(allFixed, null, 10, 's').seen).toEqual({ gates: [], findings: [] })

  // An item the agent parks keeps what the ledger has already been through.
  expect(park(again, item('fyi', 'note')).seen).toEqual(again.seen)
})

test('every ledger run under way counts, and a file reference is a place to show', () => {
  const task = (id: string, status: 'gate-failed' | 'done') => ({ id, unit: 'U', title: id, status })
  const finding = (id: number) => ({
    id,
    path: 'a.ts',
    severity: 'warning' as const,
    summary: 's',
    status: 'open' as const,
  })

  // No ledger; a ledger with no run; two runs, one of them done.
  expect(mergedRuns(undefined)).toBeUndefined()
  expect(mergedRuns([])).toBeNull()
  const merged = mergedRuns([
    { goal: 'old', doneAt: 5, tasks: [task('A1', 'gate-failed')], findings: [finding(1)] },
    { goal: 'new', tasks: [task('B1', 'gate-failed')], findings: [finding(2)] },
  ])
  // A done run's failed gate is past; its open finding still counts.
  expect(merged?.tasks.map(one => one.id)).toEqual(['B1'])
  expect(merged?.findings.map(one => one.id)).toEqual([1, 2])

  // Planning a second run leaves the first run's items standing.
  const first = { goal: 'first', tasks: [task('A1', 'gate-failed')], findings: [] }
  const one = syncLedger(EMPTY, mergedRuns([first]), 1, 's')
  const two = syncLedger(one, mergedRuns([first, { goal: 'second', tasks: [task('B1', 'done')], findings: [] }]), 2, 's')
  expect(two.items.filter(item => item.status === 'open').map(item => item.title)).toEqual(['Gate failed: A1 A1'])

  expect(placeOfRef('src/a.ts:12')).toEqual({ path: 'src/a.ts', line: 12 })
  expect(placeOfRef('src/a.ts:12:4')).toEqual({ path: 'src/a.ts', line: 12 })
  expect(placeOfRef(' README.md ')).toEqual({ path: 'README.md', line: 0 })
})

test('a body is kept as Markdown: escaped line breaks are read, and a long one is cut where a paragraph ends', () => {
  // A body with real line breaks is left as written, a diagram's spacing included.
  const diagram = 'Flow:\n\n```\nA --> B\n      |\n      v\n      C\n```'
  expect(tidyBody(diagram)).toBe(diagram)
  expect(tidyBody('It said \\n here.\nSecond line.')).toBe('It said \\n here.\nSecond line.')
  // One with none at all, but the two characters a model sent in their place.
  expect(tidyBody('Needs a call.\\n\\n- one\\n- two')).toBe('Needs a call.\n\n- one\n- two')
  expect(park(EMPTY, { ...item('fyi', 'a'), body: ' a\\nb ' }).items[0]?.body).toBe('a\nb')

  expect(markdownOf('short')).toEqual(['short'])
  expect(markdownOf('')).toEqual([])
  const long = `${'x'.repeat(60)}\n\n${'y'.repeat(60)}\n\n${'z'.repeat(60)}`
  expect(markdownOf(long, 130)).toEqual([`${'x'.repeat(60)}\n\n${'y'.repeat(60)}`, 'z'.repeat(60)])
  // An escape sequence, which the element refuses, is left out.
  expect(markdownOf('a\u001b[31mb')).toEqual(['a[31mb'])
})

test('items are listed by session, by project or all together, under the name /resume gives the session', () => {
  const here = { sessionId: 's1', project: '/app' }
  const parked = park(
    park(park(EMPTY, { ...item('fyi', 'mine'), sessionId: 's1', project: '/app' }), { ...item('fyi', 'sibling'), sessionId: 's2', project: '/app' }),
    { ...item('fyi', 'elsewhere'), sessionId: 's3', project: '/other' },
  )
  const titles = (scope: 'session' | 'project' | 'all') => inScope(parked.items, scope, here).map(one => one.title)

  expect(titles('session')).toEqual(['mine'])
  expect(titles('project')).toEqual(['mine', 'sibling'])
  expect(titles('all')).toEqual(['mine', 'sibling', 'elsewhere'])
  expect([nextScope('session'), nextScope('project'), nextScope('all')]).toEqual(['project', 'all', 'session'])

  // The name is the one the user set, else the one Claude Code made.
  const rows = [
    '"type":"ai-title","aiTitle":"Queue fixes"',
    '"type":"agent-name","agentName":"Queue fixes"',
    '"type":"ai-title","aiTitle":"Queue and \\"retry\\" fixes"',
  ]
  expect(sessionNameOf(rows.join('\n'))).toBe('Queue fixes')
  expect(sessionNameOf(rows[2] ?? '')).toBe('Queue and "retry" fixes')
  expect(sessionNameOf([...rows, '"type":"custom-title","customTitle":"Outbox"'].join('\n'))).toBe('Outbox')
  expect(sessionNameOf('')).toBe('')

  const named = knowSession(parked, 's1', { name: 'Outbox', project: '/app', transcript: '/t/s1.jsonl' }, 5)
  expect(sessionLabel(named.sessions, 's1')).toBe('Outbox')
  expect(sessionLabel(named.sessions, '0123456789abcdef')).toBe('session 01234567')
  // Told the same again, nothing changes; a look that finds no name keeps the old one.
  expect(knowSession(named, 's1', { name: 'Outbox', project: '/app', transcript: '/t/s1.jsonl' }, 9)).toBe(named)
  expect(knowSession(named, 's1', { name: '', project: '/app' }, 9)).toBe(named)
  expect(describe(parked.items[1]!, '"Outbox"')).toContain('#2 [fyi] sibling (parked in "Outbox")')
})

test('the backlogs once kept per folder become one, and the ledger is followed per session', () => {
  const app = park(park(EMPTY, { ...item('fyi', 'app 1'), now: 10 }), { ...item('fyi', 'app 2'), sessionId: 't', now: 30 })
  const lib = park(EMPTY, { ...item('needs-you', 'lib 1'), sessionId: 'u', now: 20 })
  const one = migrate([
    ['/app', { ...app, seen: { gates: ['T1'], findings: [] } }],
    ['/lib', lib],
  ])

  // Oldest first, numbered afresh, each in the folder it was kept under.
  expect(one.items.map(each => [each.id, each.title, each.project])).toEqual([
    [1, 'app 1', '/app'],
    [2, 'lib 1', '/lib'],
    [3, 'app 2', '/app'],
  ])
  expect(one.nextId).toBe(4)
  expect(one.ledger).toEqual({ s: { gates: ['T1'], findings: [] }, t: { gates: ['T1'], findings: [] } })

  // A gate fails in session u: its item is u's, and no other session's moves.
  const run = { goal: 'g', tasks: [{ id: 'T2', unit: 'API', title: 'do T2', status: 'gate-failed' as const }], findings: [] }
  const failed = syncSession(one, run, 40, { sessionId: 'u', project: '/lib' })
  expect(failed.items.map(each => each.id)).toEqual([1, 2, 3, 4])
  expect(failed.items[3]).toMatchObject({ title: 'Gate failed: T2 do T2', sessionId: 'u', project: '/lib' })
  expect(failed.ledger?.u).toEqual({ gates: ['T2'], findings: [] })
  expect(failed.ledger?.s).toEqual({ gates: ['T1'], findings: [] })
  expect(syncSession(failed, run, 41, { sessionId: 'u', project: '/lib' })).toBe(failed)

  // Only so many done items are kept, the ones closed longest ago going first.
  let many = EMPTY

  for (let at = 1; at <= 203; at += 1) {
    many = must(resolve(park(many, item('fyi', `n${at}`)), at, 'seen', 'user', at))
  }

  expect(pruned(many).items.length).toBe(200)
  expect(pruned(many).items[0]?.id).toBe(4)
  expect(pruned(one)).toBe(one)
})

test('a report is read out of a tool call’s arguments while they are still arriving', () => {
  expect(stringsIn('{"report":"Found it.","note":"x"}')).toEqual(['Found it.', 'x'])
  // Cut mid-string, mid-escape and mid-key: what has arrived so far.
  expect(stringsIn('{"report":"Two writes\\nra')).toEqual(['Two writes\nra'])
  expect(stringsIn('{"report":"a \\"quote\\" and \\u00e9\\')).toEqual(['a "quote" and é'])
  expect(stringsIn('{"report":"a \\u00')).toEqual(['a '])
  expect(stringsIn('{"rep')).toEqual([])
  expect(reportIn('{"status":"done","report":"The long one."')).toBe('The long one.')
  expect(reportIn('')).toBe('')

  // A tool call is named with the first thing it was given, arriving or whole.
  expect(callLabel('Read', '')).toBe('Read')
  expect(callLabel('Bash', '{"command":"git log\\n  --oneline","description":"x"}')).toBe('Bash(git log --oneline)')
  expect(callLabel('Grep', '{"pattern":"TODO')).toBe('Grep(TODO)')
  expect(callLabel('mcp__ledger__report', '{}')).toBe('ledger: report')

  const one = park(EMPTY, { ...item('needs-you', 'Pick a queue'), note: 'check this' }).items[0]!
  const shown = handoverOf(one, 'why?', 'The queue lives in src/queue.ts.')
  expect(shown).toContain('**Ticket:** #1 Pick a queue, with its full text and your note.')
  expect(shown).toContain('The queue lives in src/queue.ts.')
  expect(shown).toContain('**Your message:** why?')
  expect(handoverOf(one, 'why?', '')).toContain('the subagent has the ticket only')
})

test('the pane lists this session’s items until v widens it, and the agent’s list does the same', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  let session = 's1'
  on('session.id', () => ({ value: session }))
  on('session.cwd', () => ({ value: '/project' }))

  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'From the first', body: 'one' })
  session = 's2'
  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'From the second', body: 'two' })

  const mine = String((await $.tool.call({ tool: 'mcp__parked__list_parked' })).result)
  expect(mine).toContain('#2 [needs-you] From the second')
  expect(mine).not.toContain('From the first')
  const all = String((await $.tool.call({ tool: 'mcp__parked__list_parked', scope: 'all' })).result)
  expect(all).toContain('#1 [needs-you] From the first (parked in "session s1")')

  const ui = await $.ui.mount(PANE)
  const inList = async (text: RegExp) => (await ui.find({ type: 'Text', text, ...LIST })) !== undefined
  expect(await inList(/Parked · 1 needs attention/)).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'scope' }))?.props.label).toContain('this session')

  // v, in the region or on the pane's own button, is the next scope.
  await ui.key({ key: 'v', ...LIST })
  await ui.press({ key: 'scope' })
  expect((await ui.find({ type: 'Button', key: 'scope' }))?.props.label).toBe('showing every session')
  expect(await inList(/Parked · 2 need attention/)).toBe(true)
  expect(await inList(/session s1 · /)).toBe(true)
})

test('the first load brings in what was kept per folder, under the session it was parked in', async ($, on) => {
  mock.store(on, { 'backlog:/old/folder': park(EMPTY, { ...item('needs-you', 'Kept from before'), sessionId: 's1' }) })
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/somewhere/else' }))

  // The session's folder has moved since, and the item is still its own.
  const listed = String((await $.tool.call({ tool: 'mcp__parked__list_parked' })).result)
  expect(listed).toContain('#1 [needs-you] Kept from before')

  const parked = await $.tool.call({ tool: 'mcp__parked__park', kind: 'fyi', title: 'New', body: 'b' })
  expect(parked.result).toBe('Parked as #2.')
})

test('the assistant parks things for itself, apart from the user’s, and is reminded of them', async ($, on) => {
  const mine = park(park(EMPTY, { ...item('self', 'Rerun the flaky test'), sessionId: 's1' }), item('needs-you', 'Pick a queue'))
  const own = ownOpen(mine.items, 's1')

  // Its own list is not the user's: last in the order, absent from the status row.
  expect(own.map(one => one.id)).toEqual([1])
  expect(ownOpen(mine.items, 's2')).toEqual([])
  expect(orderOf(mine.items).map(one => one.id)).toEqual([2, 1])
  expect(statusText(mine.items)).toBe('📌 1 needs attention')
  expect(statusText(own)).toBeUndefined()

  // Reminded when the list is new, then again only after some prompts.
  expect(isReminderDue(own, { ids: '', turns: 1 })).toBe(true)
  expect(isReminderDue(own, { ids: '1', turns: 2 })).toBe(false)
  expect(isReminderDue(own, { ids: '1', turns: 6 })).toBe(true)
  expect(isReminderDue([], { ids: '1', turns: 9 })).toBe(false)
  expect(reminderOf(own)).toContain('- #1 Rerun the flaky test')
  expect(reminderOf(own)).toContain('not a request from the user')

  mock.store(on)
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))

  const parked = await $.tool.call({ tool: 'mcp__parked__park', kind: 'self', title: 'Tidy the fixtures', body: 'Left over from the queue work.' })
  expect(parked.result).toBe('Parked as #1.')
  expect(String((await $.tool.call({ tool: 'mcp__parked__list_parked' })).result)).toContain('#1 [self] Tidy the fixtures')

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /ASSISTANT/, ...LIST })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Parked · 1 assistant/, ...LIST })).toBeDefined()
})

test('each of an item’s files opens by itself, and the home folder is written ~', async ($, on) => {
  expect(tildeOf('/Users/kim/Code/app/src/a.ts:12', '/Users/kim')).toBe('~/Code/app/src/a.ts:12')
  expect(tildeOf('See /Users/kim/a and /Users/kim/b.', '/Users/kim')).toBe('See ~/a and ~/b.')
  expect(tildeOf('/Users/kim', '/Users/kim')).toBe('~')
  // Another folder that only begins the same way is left as it is.
  expect(tildeOf('/Users/kimberly/a.ts', '/Users/kim')).toBe('/Users/kimberly/a.ts')
  expect(tildeOf('/srv/a.ts', '')).toBe('/srv/a.ts')

  mock.store(on)
  mock.clock(on)
  mock.env(on, { HOME: '/Users/kim' })
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/Users/kim/Code/app' }))
  const asked: unknown[] = []
  on('fs.read', (_$, e) => {
    if (e.path !== '/Users/kim/Code/app/src/a.ts') {
      throw new Error('no such file')
    }

    return { value: Array.from({ length: 40 }, (_, at) => `line ${at + 1}`).join('\n') }
  })
  on('state.set', { plugin: 'parked', key: 'jump' }, (_$, e, next) => {
    asked.push(e.value)

    return next(e)
  })

  await $.tool.call({
    tool: 'mcp__parked__park',
    kind: 'needs-you',
    title: 'Two files',
    body: 'Look in /Users/kim/Code/app/notes.md first.',
    refs: ['/Users/kim/Code/app/src/a.ts:12', '/Users/kim/Code/app/src/b.ts'],
  })

  const ui = await $.ui.mount(PANE)
  await ui.key({ key: 'return', ...LIST })
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('Look in ~/Code/app/notes.md first.')
  expect((await ui.find({ type: 'Button', key: 'ref-0' }))?.props.label).toBe('~/Code/app/src/a.ts:12')
  expect((await ui.find({ type: 'Button', key: 'ref-1' }))?.props.label).toBe('~/Code/app/src/b.ts')

  // A file pressed is read here, in the item, around the line referred to;
  // nothing is asked of lens, and pressing it again puts it away.
  await ui.press({ key: 'ref-0' })
  const shown = await ui.find({ type: 'Code' })
  expect(shown?.props.path).toBe('/Users/kim/Code/app/src/a.ts')
  expect(shown?.props.startLine).toBe(6)
  expect(String(shown?.props.source).split('\n')[6]).toBe('line 12')
  expect(asked).toEqual([])

  // There is no key that sends a file to another pane.
  expect(await ui.find({ type: 'Button', key: 'go' })).toBeUndefined()
  await ui.press({ key: 'ref-0' })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()

  // A file that cannot be read says so.
  await ui.press({ key: 'ref-1' })
  expect(await ui.find({ type: 'Text', text: /could not be read/ })).toBeDefined()

  // The lines around the one referred to; the first lines for a file alone.
  const text = Array.from({ length: 100 }, (_, at) => `l${at + 1}`).join('\n')
  expect(excerptOf(text, 50).start).toBe(44)
  expect(excerptOf(text, 50).source.split('\n')[6]).toBe('l50')
  expect(excerptOf(text, 0).start).toBe(1)
  expect(excerptOf(text, 0).source.split('\n').length).toBe(37)
  expect(excerptOf('only', 9)).toEqual({ start: 1, source: 'only' })
})

test('a run left unattended is cleared in a few presses: every default at once, a digest, and the assistant’s own list handed to it', async ($, on) => {
  const waiting = park(
    park(park(EMPTY, { ...item('needs-you', 'Pick a queue'), options: ['Redis', 'SQS'], preferred: 1, now: 0 }), {
      ...item('needs-you', 'Pick a region'),
      options: ['eu', 'us'],
      preferred: 2,
      isBlocking: true,
      now: 3_600_000,
    }),
    { ...item('needs-you', 'A question with no options'), now: 0 },
  )

  // Only a choice with a default can be taken without reading it.
  expect(defaultsOf(waiting.items).map(one => one.id)).toEqual([1, 2])
  expect(digestOf(waiting.items, 7_200_000)).toBe(
    'Parked: 3 need your attention, 1 blocking, the oldest for 2h. /parked shows them.',
  )
  expect(digestOf([], 0)).toBeUndefined()
  expect(digestOf(park(EMPTY, item('fyi', 'note')).items, 0)).toBeUndefined()

  const own = park(EMPTY, item('self', 'Rerun the flaky test')).items
  expect(workPrompt(own)).toContain('Go through the item you parked for yourself, now:\n- #1 Rerun the flaky test')

  // A tool's result as the one line under its call.
  expect(resultLine('first\n\nsecond\nthird')).toBe('first (+2 lines)')
  expect(resultLine([{ type: 'text', text: 'only' }])).toBe('only')
  expect(resultLine('')).toBe('(nothing)')
  expect(resultLine('x'.repeat(200)).length).toBe(90)

  mock.store(on, { backlog: { ...waiting, items: waiting.items.map(one => ({ ...one, sessionId: 's1' })) } })
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  await $.tool.call({ tool: 'mcp__parked__park', kind: 'self', title: 'Tidy the fixtures', body: 'b' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Button', key: 'defaults' }))?.props.label).toBe('accept all 2 defaults')
  await ui.press({ key: 'defaults' })
  expect(await ui.find({ type: 'Button', key: 'defaults' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Parked · 1 needs attention/, ...LIST })).toBeDefined()

  // The blocked agent is told its default stood; the other one already went that way.
  await clock.advance(3000)
  expect(prompts).toEqual(['My answers to parked items:\n- #2 Pick a region: option 1, us'])

  // /parked work hands the assistant what it parked for itself.
  const handed = await $.command.run({ command: 'parked', args: 'work' } as never)
  expect(handed.text).toContain('asked the assistant to go through its 1 own item')
  await clock.advance(100)
  expect(prompts[1]).toContain('- #4 Tidy the fixtures')
})

test('an item goes back to where it came up, and a selection is what /park parks', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))
  on('ui.selection', () => ({ value: { text: 'the queue drops items when two run', requestId: 'row-9' } }))
  // With text selected, that is what /park parks, and its row is remembered.
  const parked = await $.command.run({ command: 'park', args: 'look into this' } as never)
  expect(parked.text).toBe('Parked the selection as #1. /parked shows the list.')
  const listed = String((await $.tool.call({ tool: 'mcp__parked__list_parked' })).result)
  expect(listed).toContain('Note: look into this')
  expect(listed).toContain('the queue drops items when two run')

  // l is offered on an item that has a row to go back to, and only on one.
  const ui = await $.ui.mount(PANE)
  await ui.key({ key: 'return', ...LIST })
  expect((await ui.find({ type: 'Button', key: 'where' }))?.props.label).toBe('l: Locate')
  await ui.press({ key: 'where' })
  await ui.press({ key: 'back' })
  await $.tool.call({ tool: 'mcp__parked__park', kind: 'fyi', title: 'No row behind it', body: 'b', tool_use_id: '' })
})

test('a table is made to fit the pane: in fixed columns when it can, as a list when it cannot', () => {
  const table = ['Before.', '', '| # | Kind | Title |', '|---|:-----|-------|', '| 23 | `self` | **Cover** the path |', '| 24 | fyi | Short |', '', 'After.'].join('\n')

  // Narrow enough to fit: fixed columns in a code fence, which keeps spacing.
  expect(fitTables(table, 40).split('\n')).toEqual([
    'Before.',
    '',
    '```',
    '#  │ Kind │ Title',
    '───┼──────┼───────────────',
    '23 │ self │ Cover the path',
    '24 │ fyi  │ Short',
    '```',
    '',
    'After.',
  ])

  // Too wide for the pane: each row an entry, each further cell named by its column.
  expect(fitTables(table, 20).split('\n')).toEqual([
    'Before.',
    '',
    '- **23**',
    '  - Kind: `self`',
    '  - Title: **Cover** the path',
    '- **24**',
    '  - Kind: fyi',
    '  - Title: Short',
    '',
    'After.',
  ])

  // Text with no table, and a table shown as code, are left as written.
  expect(fitTables('a | b\nnot a rule', 10)).toBe('a | b\nnot a rule')
  const fenced = ['```', '| a | b |', '|---|---|', '| 1 | 2 |', '```'].join('\n')
  expect(fitTables(fenced, 5)).toBe(fenced)
})

test('what is done in the pane can be taken back, and a blocked agent’s item is above the prompt', async ($, on) => {
  // Putting items back by id; an answer the agent already has is named.
  const two = park(park(EMPTY, { ...item('needs-you', 'Pick a queue'), options: ['Redis', 'SQS'], preferred: 1 }), item('fyi', 'note'))
  const answered = must(answer(two, 1, 2, 5, 's'))
  expect(restore(answered, two.items)).toEqual({ backlog: two, told: [] })
  expect(restore(sent(answered, [1]), two.items).told).toEqual([1])

  // A file named from the project the item was parked in, or from home.
  const filed = { ...two.items[0]!, project: '/app' }
  expect(pathOfRef(filed, 'src/a.ts:12', '/Users/kim')).toBe('/app/src/a.ts')
  expect(pathOfRef(filed, '~/notes.md', '/Users/kim')).toBe('/Users/kim/notes.md')
  expect(pathOfRef(filed, '/etc/hosts', '/Users/kim')).toBe('/etc/hosts')

  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/kim' })
  const prompts: string[] = []
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/app' }))
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  // One file was changed after the item was parked, the other before.
  on('fs.stat', (_$, e) => ({
    value: { kind: 'file', size: 1, mtimeMs: e.path.endsWith('a.ts') ? 5000 : 10, isLink: false },
  }))

  await $.tool.call({
    tool: 'mcp__parked__park',
    kind: 'needs-you',
    title: 'Pick a queue',
    body: 'Which one?',
    options: ['Redis', 'SQS'],
    default: 1,
    blocking: true,
    refs: ['/app/src/a.ts:3', '/app/src/b.ts'],
  })

  // The band: the blocking item's title and its options, the default starred.
  const band = await $.ui.mount({
    plugin: 'parked',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  } as never)
  expect(await band.find({ type: 'Text', text: /Blocked on you/ })).toBeDefined()
  expect((await band.find({ type: 'Button', key: 'band-pick-1-1' }))?.props.label).toBe('Redis ★')

  // The item says which of its files changed since it was parked.
  const ui = await $.ui.mount(PANE)
  await ui.key({ key: 'return', ...LIST })
  expect(await ui.find({ type: 'Text', text: /Stale: 1 of its files changed since this was parked/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: / · stale/ })).toHaveLength(1)

  // Done, then taken back: the item is open again and nothing was sent.
  expect(await ui.find({ type: 'Button', key: 'undo' })).toBeUndefined()
  await ui.press({ key: 'done' })
  expect(await ui.find({ type: 'Text', text: /1 done/, ...LIST })).toBeDefined()
  await ui.key({ key: 'u', ...LIST })
  expect(await ui.find({ type: 'Text', text: /Parked · 1 needs attention/, ...LIST })).toBeDefined()

  // An answer taken back before it is sent never reaches the agent.
  await band.press({ key: 'band-pick-1-2' })
  await ui.press({ key: 'undo' })
  await clock.advance(5000)
  expect(prompts).toEqual([])
  expect(String((await $.tool.call({ tool: 'mcp__parked__list_parked' })).result)).toContain('#1 [needs-you] Pick a queue')
})

test('a thread can take its question from Claude Code’s own prompt box, once and plainly', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const reached: string[] = []
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))
  on('prompt.submit', (_$, e) => {
    reached.push(e.text)

    return { text: e.text }
  })
  const typed = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)

  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'Pick a queue', body: 'Which one?' })
  await $.command.run({ command: 'parked', args: 'chat' } as never)

  const ui = await $.ui.mount(PANE)
  await ui.key({ key: 'return', ...LIST })
  await ui.press({ key: 'section-thread' })

  // Not waiting: a prompt is the main agent's.
  await typed('hello agent')
  expect(reached).toEqual(['hello agent'])

  // m makes the thread wait on the prompt box, and the band says so.
  await ui.press({ key: 'arm' })
  const band = await $.ui.mount({
    plugin: 'parked',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} },
    viewport: { columns: 120, rows: 40 },
  } as never)
  expect(await band.find({ type: 'Text', text: /Your next prompt goes to the side thread/ })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'band-disarm' })).toBeDefined()
  await band.unmount()

  // A command typed meanwhile is still a command, and leaves it waiting.
  await typed('/help')
  expect(reached).toEqual(['hello agent', '/help'])

  // The next prompt is the thread's question, kept from the main agent, and
  // it is one message only.
  const sent = await typed('why does it drop items\nwhen two run?')
  expect(String(sent.drop)).toContain('sent to its side thread')
  expect(reached).toEqual(['hello agent', '/help'])
  expect(await ui.find({ type: 'Text', text: /why does it drop items/ })).toBeDefined()
  await typed('back to the agent')
  expect(reached).toEqual(['hello agent', '/help', 'back to the agent'])

  // Asked for and then cancelled, nothing is diverted.
  await ui.press({ key: 'arm' })
  await ui.press({ key: 'arm' })
  await typed('still the agent')
  expect(reached.at(-1)).toBe('still the agent')
})
