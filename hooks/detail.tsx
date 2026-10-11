import type { ClientModule, ClientSurface } from 'claude-code'

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

// A key pressed on one of the pane's own letter buttons, which need no click:
// the hooks module counts them, and a new count is a key to answer.
type Nudge = { key: string; n: number }

type Props = {
  columns: number
  rows: number
  summary: string
  entries: Entry[]
  // The item last shown in full (0 for none): the cursor starts on its row.
  from: number
  nudge: Nudge
}

// `cursor` is the list row the keyboard is on; -1 until a key or a click has
// moved it, while it rests on the row of the item last shown.
type State = { cursor: number }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

// The vim keys, as the arrows and Enter they stand for.
const VIM: Record<string, string> = { h: 'left', j: 'down', k: 'up', l: 'right', o: 'return' }

// The last nudge answered (-1 before the first drawing), and the last ↑ or ↓
// that came as a real key: the pane may report the same press again as a
// scroll, which the hooks module turns into a nudge.
let seen = -1
let lastArrow = { key: '', at: 0 }

// Hands the key handler both routes: the region's own keys, once it is
// clicked, and the nudges from the pane's letter buttons.
const listen = (surface: ClientSurface<State>, nudge: Nudge, onKey: (key: string) => void) => {
  surface.onKey(event => {
    if (event.key === 'up' || event.key === 'down') {
      lastArrow = { key: event.key, at: Date.now() }
    }

    onKey(event.key)
  })

  if (seen === -1) {
    seen = nudge.n
  } else if (nudge.n !== seen) {
    seen = nudge.n

    if (!(nudge.key === lastArrow.key && Date.now() - lastArrow.at < 80)) {
      onKey(nudge.key)
    }
  }
}

// The backlog as a list the keyboard walks: ↑ and ↓ move, Enter or → opens,
// v asks for the next scope. An item itself is drawn by the hooks module.
const List: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const rows = props.entries.filter(entry => entry.kind === 'row')
  const last = Math.max(0, rows.length - 1)
  // Coming back from an item, the cursor is on that item's row.
  const came = rows.findIndex(entry => entry.id === props.from)
  const kept = surface.state?.cursor ?? -1
  const cursor = clamp(kept >= 0 ? kept : came, 0, last)
  const move = (to: number) => surface.setState({ cursor: clamp(to, 0, last) })
  const open = (at: number) => {
    const entry = rows[at]

    if (entry !== undefined) {
      surface.setState({ cursor: at })
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
    } else if (key === 'v') {
      surface.post({ scope: true })
    } else if (key === 'a') {
      surface.post({ defaults: true })
    } else if (key === 'u') {
      surface.post({ undo: true })
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
        {rows.length === 0 && <Text dimColor>Nothing parked here yet. /park [note] parks the last reply.</Text>}
        {shown.map(entry => {
          if (entry.kind === 'head') {
            return (
              <Text color={entry.tone} bold>
                {entry.text}
              </Text>
            )
          }

          const isHere = rows.indexOf(entry) === cursor

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
        click once for keys · ↑↓ or j k move · enter, → or l opens · v scope · esc releases
      </Text>
    </Box>
  )
}

export default List
