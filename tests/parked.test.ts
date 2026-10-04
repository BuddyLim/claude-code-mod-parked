import { expect, mock, test } from 'claude-code/testing'

import {
  EMPTY,
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
  expect(statusText(one.items)).toBe('📌 1 needs you')
  expect(statusText(both.items)).toBe('📌 2 need you · 1 FYI')
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
  expect(await has(/Parked · 2 need you/)).toBe(true)
  await ui.key({ key: 'return', ...region })
  expect(await has(/#1 First/)).toBe(true)

  // On the ticket level → is the next ticket.
  await ui.key({ key: 'right', ...region })
  expect(await has(/#2 Second/)).toBe(true)

  // ↓ to the actions, → twice to Back (Done, Prev, Back), Enter runs it.
  await ui.key({ key: 'down', ...region })
  await ui.key({ key: 'right', ...region })
  await ui.key({ key: 'right', ...region })
  await ui.key({ key: 'return', ...region })
  expect(await has(/Parked · 2 need you/)).toBe(true)

  // The vim keys do the same. The cursor came back on the second row: k moves
  // up, o opens, l is the next ticket, j then l l o runs Back.
  await ui.key({ key: 'k', ...region })
  await ui.key({ key: 'o', ...region })
  expect(await has(/#1 First/)).toBe(true)
  await ui.key({ key: 'l', ...region })
  expect(await has(/#2 Second/)).toBe(true)
  await ui.key({ key: 'j', ...region })
  await ui.key({ key: 'l', ...region })
  await ui.key({ key: 'l', ...region })
  await ui.key({ key: 'o', ...region })
  expect(await has(/Parked · 2 need you/)).toBe(true)

  // The pane's own letter buttons need no click and drive the same view.
  await ui.press({ key: 'key-k' })
  await ui.press({ key: 'key-o' })
  expect(await has(/#1 First/)).toBe(true)
  await ui.press({ key: 'key-l' })
  expect(await has(/#2 Second/)).toBe(true)
  await ui.press({ key: 'key-j' })
  await ui.press({ key: 'key-l' })
  await ui.press({ key: 'key-l' })
  await ui.press({ key: 'key-o' })
  expect(await has(/Parked · 2 need you/)).toBe(true)

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
  expect(await has(/NEEDS YOU/)).toBe(true)

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
