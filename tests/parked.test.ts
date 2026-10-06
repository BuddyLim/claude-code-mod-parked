import { expect, mock, test } from 'claude-code/testing'

import { ticketLines } from '../hooks/backlog'

import {
  EMPTY,
  ICON,
  fileIcon,
  answer,
  answerOf,
  answersNote,
  orderOf,
  sent,
  mergedRuns,
  placeOfRef,
  syncLedger,
  unsend,
  ticketParts,
  ticketText,
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
  statusText,
  threadLines,
  summaryRequest,
  titleOf,
  wrap,
} from '../hooks/backlog'

const must = <T>(value: T | string): T => {
  if (typeof value === 'string') {
    throw new Error(value)
  }

  return value
}

const item = (kind: 'needs-you' | 'fyi', title: string) => ({
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

test('text wraps to the pane width and keeps a list line’s indent', () => {
  expect(wrap('short', 20)).toEqual(['short'])
  expect(wrap('a\n\nb', 20)).toEqual(['a', '', 'b'])
  expect(wrap('- one two three four five six', 16)).toEqual(['- one two three', '  four five six'])
  expect(wrap('x'.repeat(45), 20).map(row => row.length)).toEqual([20, 20, 5])
  expect(wrap('**bold** text', 20)).toEqual(['bold text'])
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
})

test('the keyboard region opens an item, switches ticket, and goes back', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/project' }))

  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'First', body: 'one' })
  await $.tool.call({ tool: 'mcp__parked__park', kind: 'needs-you', title: 'Second', body: 'two' })

  const ui = await $.ui.mount({
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
  })
  const region = { in: 'detail' }
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text, ...region })) !== undefined

  // The list: Enter opens the row under the cursor.
  expect(await has(/Parked · 2 need attention/)).toBe(true)
  await ui.key({ key: 'return', ...region })
  expect(await has(/#1 First/)).toBe(true)

  // On the ticket level → is the next ticket.
  await ui.key({ key: 'right', ...region })
  expect(await has(/#2 Second/)).toBe(true)

  // ↓ to the actions, → three times to Back (Done, Answer, Prev, Back), Enter
  // runs it.
  await ui.key({ key: 'down', ...region })
  await ui.key({ key: 'right', ...region })
  await ui.key({ key: 'right', ...region })
  await ui.key({ key: 'right', ...region })
  await ui.key({ key: 'return', ...region })
  expect(await has(/Parked · 2 need attention/)).toBe(true)

  // The vim keys do the same. The cursor came back on the second row: k moves
  // up, o opens, l is the next ticket, j then l l l o runs Back.
  await ui.key({ key: 'k', ...region })
  await ui.key({ key: 'o', ...region })
  expect(await has(/#1 First/)).toBe(true)
  await ui.key({ key: 'l', ...region })
  expect(await has(/#2 Second/)).toBe(true)
  await ui.key({ key: 'j', ...region })
  await ui.key({ key: 'l', ...region })
  await ui.key({ key: 'l', ...region })
  await ui.key({ key: 'l', ...region })
  await ui.key({ key: 'o', ...region })
  expect(await has(/Parked · 2 need attention/)).toBe(true)

  // The pane's own letter buttons need no click and drive the same view.
  await ui.press({ key: 'key-k' })
  await ui.press({ key: 'key-o' })
  expect(await has(/#1 First/)).toBe(true)
  await ui.press({ key: 'key-l' })
  expect(await has(/#2 Second/)).toBe(true)
  await ui.press({ key: 'key-j' })
  await ui.press({ key: 'key-l' })
  await ui.press({ key: 'key-l' })
  await ui.press({ key: 'key-l' })
  await ui.press({ key: 'key-o' })
  expect(await has(/Parked · 2 need attention/)).toBe(true)

  // In an item the composer is the pane's own text field, and i gives it the
  // focus ring, so a question can be typed and sent with no click.
  await ui.press({ key: 'key-o' })
  expect(await ui.find({ type: 'Input' })).toBeDefined()
  await ui.press({ key: 'key-i' })

  // In the composer every letter is text, whichever way it arrives: typed in
  // the region, or pressed on a letter button. None is a shortcut, so d does
  // not mark the item done and b does not go back to the list.
  const wasFirst = await has(/#1 First/)
  await ui.key({ key: 'd', ...region })
  await ui.key({ key: 'b', ...region })
  await ui.press({ key: 'key-k' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('dbk')
  expect(await has(wasFirst ? /#1 First/ : /#2 Second/)).toBe(true)
  expect(await has(/NEEDS ATTENTION/)).toBe(true)

  // A key in the region after that means the region has the keyboard again:
  // the first one takes it back from the composer and lands on the actions
  // level; ↑ is then the tickets level, where ← and → switch ticket.
  const isFirst = await has(/#1 First/)
  const toOther = isFirst ? 'right' : 'left'
  await ui.key({ key: 'up', ...region })
  await ui.key({ key: 'up', ...region })
  await ui.key({ key: toOther, ...region })
  expect(await has(isFirst ? /#2 Second/ : /#1 First/)).toBe(true)

  // ↓ twice from the tickets reaches the composer again, and the region can
  // take the keys back from it again.
  await ui.key({ key: 'down', ...region })
  await ui.key({ key: 'down', ...region })
  await ui.key({ key: 'up', ...region })
  await ui.key({ key: 'up', ...region })
  await ui.key({ key: toOther === 'right' ? 'left' : 'right', ...region })
  expect(await has(isFirst ? /#1 First/ : /#2 Second/)).toBe(true)
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

  expect(ticketText(open).split('\n').slice(0, 3)).toEqual([
    `${ICON.options} Options`,
    `  1. Redis  ${ICON.preferred} default`,
    '  2. SQS',
  ])
  expect(ticketText(open)).toContain(`${ICON.folderOpen} Files\n  ${fileIcon('a.ts')} src/queue.ts:12`)

  // The glyph that leads a row and the default's star are drawn in a colour.
  expect(ticketParts(`${ICON.options} Options`)).toEqual([
    { text: `${ICON.options} `, color: 'cyan' },
    { text: 'Options' },
  ])
  expect(ticketParts(`  1. Redis  ${ICON.preferred} default`)).toEqual([
    { text: '  1. Redis  ' },
    { text: `${ICON.preferred} default`, color: '#ffd43b' },
  ])
  expect(ticketParts(`  ${fileIcon('a.ts')} src/queue.ts:12`)).toEqual([
    { text: '  ' },
    { text: `${fileIcon('a.ts')} `, color: '#519aba' },
    { text: 'src/queue.ts:12' },
  ])
  expect(ticketParts('- a plain row')).toEqual([{ text: '- a plain row' }])
  expect(ticketParts('')).toEqual([])

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

  const ui = await $.ui.mount({
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
  })
  const region = { in: 'detail' }
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text, ...region })) !== undefined

  await ui.key({ key: 'return', ...region })
  expect(await has(/#1 First/)).toBe(true)
  expect(await has(/1\. Redis .* default/)).toBe(true)

  // a takes the default: the item is done, the next one opens, nothing is sent.
  await ui.key({ key: 'a', ...region })
  expect(await has(/#2 Second/)).toBe(true)
  // A digit past the options does nothing; 2 picks SQS on each of the rest.
  await ui.key({ key: '7', ...region })
  expect(await has(/#2 Second/)).toBe(true)
  await ui.key({ key: '2', ...region })
  expect(await has(/#3 Third/)).toBe(true)
  await ui.key({ key: '2', ...region })
  expect(await has(/3 done/)).toBe(true)

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

  const ui = await $.ui.mount({
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
  })
  const region = { in: 'detail' }

  await ui.key({ key: 'return', ...region })
  await ui.key({ key: 'w', ...region })
  expect((await ui.find({ type: 'Input' }))?.props.placeholder).toContain('Your answer for the main agent')

  for (const key of ['3', 'space', 'x']) {
    await ui.key({ key, ...region })
  }

  await ui.key({ key: 'return', ...region })
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

test('a thread draws the user’s message as a shaded prompt and a reply under a dot, with no labels', () => {
  const lines = threadLines(
    [
      { role: 'you', text: 'why does it drop items when two run?', at: 1 },
      { role: 'note', text: 'briefed', at: 2 },
      { role: 'agent', text: 'Because two writes race.\nThe second one wins.', at: 3 },
    ],
    30,
  )

  expect(lines.map(line => line.kind)).toEqual(['you', 'you', 'text', 'note', 'text', 'dot', 'text'])
  expect(lines[0]?.text).toBe('❯ why does it drop items when ')
  expect(lines[1]?.text).toBe('  two run?                    ')
  expect(lines.every(line => line.text.length <= 30)).toBe(true)
  expect(lines[5]?.text).toBe('● Because two writes race.')
  expect(lines[6]?.text).toBe('  The second one wins.')
  expect(lines.some(line => /You|Subagent/.test(line.text))).toBe(false)
})

test('a ticket labels the user’s note and the parked reply, and draws them apart', () => {
  const both = park(EMPTY, { ...item('needs-you', 'a'), body: 'The reply.\nIts second line.', note: 'check this', parkedBy: 'user' })
  const noteOnly = park(EMPTY, { ...item('needs-you', 'a'), body: '', note: 'popover opens upward and clips', parkedBy: 'user' })
  const replyOnly = park(EMPTY, { ...item('needs-you', 'a'), body: 'The reply.', parkedBy: 'user' })
  const fromAgent = park(EMPTY, item('needs-you', 'a'))
  const rows = (backlog: typeof both) => ticketLines(backlog.items[0]!, 24)

  expect(rows(both).map(row => row.text.trimEnd())).toEqual([
    'Your note:',
    '❯ check this',
    '',
    'Assistant reply:',
    '● The reply.',
    '  Its second line.',
  ])
  expect(rows(both).map(row => row.isNote)).toEqual([false, true, false, false, false, false])
  expect(rows(both)[1]?.text.length).toBe(24)

  // A note parked alone is the whole ticket; it wraps and its rows are shaded.
  expect(rows(noteOnly).map(row => row.text.trimEnd())).toEqual(['Your note:', '❯ popover opens upward', '  and clips'])

  // A reply parked with no note has its label and nothing above it.
  expect(rows(replyOnly).map(row => row.text)).toEqual(['Assistant reply:', '● The reply.'])

  // What the agent parked is its own description, drawn plain with no label.
  expect(rows(fromAgent)).toEqual([{ text: 'body', isNote: false }])
})
