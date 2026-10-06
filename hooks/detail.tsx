import type { ClientModule, ClientSurface } from 'claude-code'

type Line = { text: string; kind: 'you' | 'dot' | 'text' | 'note' }
type Action = { act: string; label: string; hot: string }

// One row of the list: a section heading, or an item.
type Entry = {
  kind: 'head' | 'row'
  id: number
  glyph: string
  tone: string
  text: string
  meta: string
  isDone: boolean
}

type ListProps = {
  view: 'list'
  columns: number
  rows: number
  summary: string
  entries: Entry[]
  nudge: Nudge
}

type DetailProps = {
  view: 'detail'
  id: number
  columns: number
  label: string
  tone: string
  position: string
  title: string
  meta: string
  actions: Action[]
  // Whether the thread has findings the Send row can pass to the main agent.
  canSend: boolean
  // How many options the item offers: a digit up to it answers with that one.
  options: number
  // Whether the composer sends the user's answer to the main agent.
  isAnswering: boolean
  note: string
  resolution: string
  // The ticket's rows, how many its window shows, and how far it is scrolled.
  // Each row is the pieces it is drawn in, a glyph's piece with its colour.
  ticket: { text: string; color?: string; shade?: boolean }[][]
  ticketRows: number
  top: number
  // The thread's rows, how many its window shows, and how far the pane's own
  // scroll (the wheel) has moved it up from its newest row.
  talk: Line[]
  threadRows: number
  back: number
  heading: string
  // What the thread is waiting on, shown beside a spinner; empty when idle.
  busy: string
  // Whether the pane's text field has the focus ring: the composer level.
  isTyping: boolean
  // Counts the times the ring has entered the text field.
  typingAt: number
  // The text the composer holds that was typed through this region.
  draft: string
  nudge: Nudge
}

type Props = ListProps | DetailProps

// The levels of an item's view the keyboard moves between with ↑ and ↓.
const TICKETS = 0
const ACTIONS = 1
const COMPOSER = 2

// `id` is the item last shown in full (0 for none), and `cursor` the list row
// the keyboard is on. One instance draws both views, so the keyboard stays
// with the pane when it moves between the list and an item.
type State = {
  id: number
  tier: number
  pick: number

  up: number
  cursor: number
  frame: number
  // The visit to the composer this region has ended by taking the keys back.
  left: number
  // What this region has typed for the composer, ahead of what props hold;
  // null when it has typed nothing.
  typed: string | null
}

const START: State = { id: 0, tier: TICKETS, pick: 0, up: 0, cursor: 0, frame: 0, left: -1, typed: null }

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
// Stops the spinner's timer while one runs; the module keeps it between calls.
let stopSpin: (() => void) | undefined

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

// The vim keys, as the arrows and Enter they stand for.
const VIM: Record<string, string> = { h: 'left', j: 'down', k: 'up', l: 'right', o: 'return' }

// A key pressed on one of the pane's own letter buttons, which need no click:
// the hooks module counts them, and a new count is a key to answer.
type Nudge = { key: string; n: number }
type KeyInfo = { ctrl?: true; meta?: true; isNudge?: true }

// The last nudge answered (-1 before the first drawing), and the last ↑ or ↓
// that came as a real key: the pane may report the same press again as a
// scroll, which the hooks module turns into a nudge.
let seen = -1
let lastArrow = { key: '', at: 0 }

// Hands a view's key handler both routes: the region's own keys, once it is
// clicked, and the nudges from the pane's letter buttons.
const listen = (surface: ClientSurface<State>, nudge: Nudge, onKey: (key: string, info?: KeyInfo) => void) => {
  surface.onKey(event => {
    if (event.key === 'up' || event.key === 'down') {
      lastArrow = { key: event.key, at: Date.now() }
    }

    onKey(event.key, event)
  })

  if (seen === -1) {
    seen = nudge.n
  } else if (nudge.n !== seen) {
    seen = nudge.n

    if (!(nudge.key === lastArrow.key && Date.now() - lastArrow.at < 80)) {
      onKey(nudge.key, { isNudge: true })
    }
  }
}

// The backlog as a list the keyboard walks: ↑ and ↓ move, Enter or → opens.
const List = (props: ListProps, surface: ClientSurface<State>) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? START
  const rows = props.entries.filter(entry => entry.kind === 'row')
  const last = Math.max(0, rows.length - 1)
  // Coming back from an item, the cursor is on that item's row.
  const came = state.id === 0 ? -1 : rows.findIndex(entry => entry.id === state.id)
  const cursor = clamp(came >= 0 ? came : state.cursor, 0, last)
  const move = (to: number) => surface.setState({ ...state, id: 0, cursor: clamp(to, 0, last) })
  const open = (at: number) => {
    const entry = rows[at]

    if (entry !== undefined) {
      // An item opened from the list starts on its tickets level.
      surface.setState({ ...state, id: 0, cursor: at, tier: TICKETS })
      surface.post({ open: entry.id })
    }
  }

  // The window of entries that fits, kept around the cursor's row.
  const height = Math.max(3, props.rows - 4)
  const here = rows[cursor]
  const cursorAt = here === undefined ? 0 : props.entries.indexOf(here)
  const start = clamp(cursorAt - Math.floor(height / 2), 0, Math.max(0, props.entries.length - height))
  const shown = props.entries.slice(start, start + height)

  listen(surface, props.nudge, raw => {
    const key = VIM[raw] ?? raw

    if (key === 'up') {
      move(cursor - 1)
    } else if (key === 'down' || key === 'tab') {
      move(cursor + 1)
    } else if (key === 'pageup') {
      move(cursor - height)
    } else if (key === 'pagedown') {
      move(cursor + height)
    } else if (key === 'return' || key === 'right') {
      open(cursor)
    }
  })

  surface.onPointer(event => {
    // Two rows sit above the entries: the summary and a rule.
    const entry = event.type === 'down' ? shown[event.y - 2] : undefined

    if (entry !== undefined && entry.kind === 'row') {
      open(rows.indexOf(entry))
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        📌 Parked{props.summary === '' ? '' : ` · ${props.summary}`}
      </Text>
      <Text dimColor>{'─'.repeat(props.columns)}</Text>
      <Box flexDirection="column" height={height} overflow="hidden">
        {rows.length === 0 && <Text dimColor>Nothing parked yet. /park [note] parks the last reply.</Text>}
        {shown.map(entry => {
          if (entry.kind === 'head') {
            return (
              <Text color={entry.tone} bold>
                {entry.text}
              </Text>
            )
          }

          const at = rows.indexOf(entry)
          const isHere = at === cursor

          return (
            <Box justifyContent="space-between">
              <Text wrap="truncate-end">
                <Text color="cyan">{isHere ? '▸ ' : '  '}</Text>
                <Text color={entry.tone}>{entry.glyph} </Text>
                <Text dimColor>#{entry.id} </Text>
                <Text inverse={isHere} dimColor={entry.isDone && !isHere}>
                  {entry.text}
                </Text>
              </Text>
              <Text dimColor>{entry.meta}</Text>
            </Box>
          )
        })}
      </Box>
      <Text dimColor>{'─'.repeat(props.columns)}</Text>
      <Text dimColor wrap="truncate-end">
        click once for keys · ↑↓ or j k move · enter, → or l opens · esc releases
      </Text>
    </Box>
  )
}

// One parked item's header, actions, ticket and side thread. ↑ and ↓ move
// between the tickets, the actions and the composer; ← and → act on the level
// in focus. The composer itself is the pane's own text field beneath this
// region: reaching its level asks the hooks module to give it the focus ring,
// so typing needs no click. What changes the backlog is posted there too.
const Detail = (props: DetailProps, surface: ClientSurface<State>) => {
  const { Box, Text } = surface.elements
  const kept = surface.state
  // Another item starts afresh, but stays on the level the keyboard was at.
  const state: State =
    kept !== undefined && kept.id === props.id
      ? kept
      : { ...START, id: props.id, tier: kept?.tier ?? TICKETS, cursor: kept?.cursor ?? 0 }
  const set = (patch: Partial<State>) => surface.setState({ ...state, ...patch })
  // The composer level is on while the pane's text field has the focus ring.
  // A key or a click that reaches this region means the region has the keys
  // instead, whatever the ring last reported: that visit to the composer is
  // then over, and `left` remembers which one it was.
  const isTyping = props.isTyping && state.left !== props.typingAt
  const tier = isTyping ? COMPOSER : state.tier === COMPOSER ? ACTIONS : state.tier
  const leave = isTyping ? { left: props.typingAt } : {}
  const toComposer = () => surface.post({ focus: 'composer' })
  const pick = clamp(state.pick, 0, props.actions.length - 1)
  const mostBack = Math.max(0, props.talk.length - props.threadRows)
  const backAt = clamp(props.back + state.up, 0, mostBack)
  const scroll = (by: number) => set({ up: clamp(backAt + by, 0, mostBack) - props.back })

  // The spinner turns on the surface's frame clock while the thread waits. The
  // timer reads the state as it is when it fires, not as it was when it began.
  if (props.busy !== '' && stopSpin === undefined) {
    stopSpin = surface.every(120, () => {
      const now = surface.state ?? state
      surface.setState({ ...now, frame: now.frame + 1 })
    })
  } else if (props.busy === '' && stopSpin !== undefined) {
    stopSpin()
    stopSpin = undefined
  }

  const run = (act: string | undefined) => {
    if (act !== undefined && (act !== 'send' || props.canSend)) {
      surface.post({ act })
    }
  }

  // Where each action sits on its row, for a click to find it.
  let column = 2
  const spans = props.actions.map(action => {
    const from = column
    column += action.label.length + 3

    return { action, from, to: column - 2 }
  })
  const actionRow = 3

  // Both listeners are set again on each call, so they read this call's state.
  listen(surface, props.nudge, (raw, info = {}) => {
    // On the composer level every key is for the composer, never a shortcut.
    // A key that arrives here means this region has the keyboard and the text
    // field does not, so the region does the typing itself: it keeps the text
    // and posts it, and the hooks module draws it in the field. Only ↑ and ↓
    // leave the level.
    if (isTyping) {
      const text = state.typed ?? props.draft

      if (raw === 'up' || raw === 'down') {
        set({ ...leave, tier: raw === 'up' ? ACTIONS : TICKETS, typed: null })
        surface.post({ blur: true })
      } else if (info.isNudge === true) {
        // A letter button pressed while typing is answered by the hooks module.
      } else if (raw === 'return') {
        if (text.trim() !== '') {
          surface.post({ ask: text.trim() })
          set({ typed: '', up: -props.back })
        }
      } else if (raw === 'backspace' || raw === 'delete') {
        const next = [...text].slice(0, -1).join('')
        set({ typed: next })
        surface.post({ draft: next })
      } else if (raw === 'space' || (info.ctrl !== true && info.meta !== true && [...raw].length === 1)) {
        const next = `${text}${raw === 'space' ? ' ' : raw}`
        set({ typed: next })
        surface.post({ draft: next })
      }

      return
    }

    // h j k l o are ← ↓ ↑ → Enter.
    const key = VIM[raw] ?? raw
    const page = Math.max(1, props.threadRows - 1)

    if (key === 'pageup') {
      scroll(page)
    } else if (key === 'pagedown') {
      scroll(-page)
    } else if (key === 'i') {
      toComposer()
    } else if (key === 'up') {
      // Up from the tickets wraps round to the composer.
      if (tier === TICKETS) {
        toComposer()
      } else {
        set({ tier: tier === COMPOSER ? ACTIONS : TICKETS })
      }
    } else if (key === 'down' || key === 'tab') {
      if (tier === TICKETS) {
        set({ tier: ACTIONS })
      } else if (tier === ACTIONS) {
        toComposer()
      } else {
        set({ tier: TICKETS })
      }
    } else if (tier === TICKETS && (key === 'left' || key === 'right')) {
      run(key === 'left' ? 'prev' : 'next')
    } else if (tier === ACTIONS && key === 'left') {
      set({ pick: clamp(pick - 1, 0, props.actions.length - 1) })
    } else if (tier === ACTIONS && key === 'right') {
      set({ pick: clamp(pick + 1, 0, props.actions.length - 1) })
    } else if (tier === ACTIONS && key === 'return') {
      run(props.actions[pick]?.act)
    } else if (key === 's') {
      run('send')
    } else if (/^[1-9]$/.test(key)) {
      if (Number(key) <= props.options) {
        run(`pick-${key}`)
      }
    } else {
      run(props.actions.find(action => action.hot === key)?.act)
    }
  })

  surface.onPointer(event => {
    if (event.type !== 'down') {
      return
    }

    if (event.y === actionRow) {
      const hit = spans.find(span => event.x >= span.from && event.x <= span.to)

      if (hit === undefined) {
        set({ ...leave, tier: ACTIONS })
      } else {
        set({ ...leave, tier: ACTIONS, pick: props.actions.indexOf(hit.action) })
        run(hit.action.act)

        return
      }
    } else if (event.y < actionRow) {
      set({ ...leave, tier: TICKETS })
    } else if (isTyping) {
      set({ ...leave, tier: ACTIONS })
    }

    // A click here took the keys from the composer.
    if (isTyping) {
      surface.post({ blur: true })
    }
  })

  const mark = (level: number) => (tier === level ? '▸ ' : '  ')
  const more = (above: number, below: number) =>
    [above > 0 ? `↑${above}` : '', below > 0 ? `↓${below}` : ''].filter(Boolean).join(' ')
  const topAt = clamp(props.top, 0, Math.max(0, props.ticket.length - props.ticketRows))
  const end = props.talk.length - backAt
  const shown = props.talk.slice(Math.max(0, end - props.threadRows), end)
  // With options, what answers them leads the hint: the row is cut at the edge.
  const picks = props.options > 0 ? `1-${props.options} answer · ` : ''
  const hint =
    tier === TICKETS
      ? `${picks}←→ or h l switch ticket · ↓ or j actions · i composer`
      : tier === ACTIONS
        ? `${picks}←→ or h l choose · enter or o runs · ↑↓ or k j levels`
        : props.isAnswering
          ? 'answering the main agent · enter sends · ↑ leaves it'
          : 'typing in the composer · enter sends · ↑ leaves it'

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>
          <Text color="cyan">{mark(TICKETS)}</Text>
          <Text color={props.tone} bold>
            {props.label}
          </Text>
        </Text>
        <Text dimColor>
          {tier === TICKETS ? '← ' : ''}
          {props.position}
          {tier === TICKETS ? ' →' : ''}
        </Text>
      </Box>
      <Text bold wrap="truncate-end">
        {'  '}
        {props.title}
      </Text>
      <Text dimColor wrap="truncate-end">
        {'  '}
        {props.meta}
      </Text>
      <Text wrap="truncate-end">
        <Text color="cyan">{mark(ACTIONS)}</Text>
        {spans.map(({ action }, index) => (
          <Text>
            <Text inverse={tier === ACTIONS && index === pick}>[{action.label}]</Text>{' '}
          </Text>
        ))}
      </Text>
      <Box justifyContent="space-between">
        <Text dimColor>── Ticket</Text>
        <Text dimColor>{more(topAt, props.ticket.length - props.ticketRows - topAt)}</Text>
      </Box>
      {props.note !== '' && (
        <Text wrap="truncate-end">
          <Text color="warning">Your note: </Text>
          {props.note}
        </Text>
      )}
      {props.resolution !== '' && (
        <Text wrap="truncate-end">
          <Text color="success">Resolved: </Text>
          {props.resolution}
        </Text>
      )}
      <Box flexDirection="column" height={props.ticketRows} overflow="hidden">
        {props.ticket.slice(topAt, topAt + props.ticketRows).map(parts =>
          // A row of the user's own note: shaded under a ❯, as a prompt is.
          parts[0]?.shade === true ? (
            <Text backgroundColor="userMessageBackground">
              <Text dimColor>{parts[0].text.slice(0, 2)}</Text>
              {parts[0].text.slice(2)}
            </Text>
          ) : (
            <Text wrap="truncate-end" bold={parts[0]?.text.startsWith('#') === true}>
              {parts.length === 0
                ? ' '
                : parts.map(part =>
                    part.color === undefined ? <Text>{part.text}</Text> : <Text color={part.color}>{part.text}</Text>,
                  )}
            </Text>
          ),
        )}
      </Box>
      <Text dimColor>{'─'.repeat(props.columns)}</Text>
      <Box justifyContent="space-between">
        <Text>
          <Text bold>{props.heading}</Text>
          {props.busy !== '' && (
            <Text color="cyan">
              {' '}
              {[...SPIN][state.frame % 10]} {props.busy}
            </Text>
          )}
        </Text>
        <Text dimColor>{more(Math.max(0, end - props.threadRows), backAt)}</Text>
      </Box>
      <Box flexDirection="column" height={props.threadRows} overflow="hidden">
        {props.talk.length === 0 && (
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
      <Text dimColor wrap="truncate-end">
        {hint}
      </Text>
    </Box>
  )
}

const Pane: ClientModule<Props, State> = (props, surface) => {
  // A new instance has no state yet: a timer left by an earlier one died with
  // it. The list shows no spinner, so it runs none either.
  if (stopSpin !== undefined && (surface.state === undefined || props.view === 'list')) {
    stopSpin()
    stopSpin = undefined
  }

  return props.view === 'list' ? List(props, surface) : Detail(props, surface)
}

export default Pane
