# parked

A Claude Code mod that keeps a backlog of things that need your attention, so
they don't scroll away during long agentic sessions.

When you orchestrate subagents, the main agent relays job reports full of
findings, questions and decisions. You can't deal with all of them as they
arrive, and after an unattended run you'd otherwise have to search the
transcript for them. With this mod the agent parks each one as it comes up, and
you work through them later in a side pane.

## What it does

- **The agent parks items for you.** It gets three tools (`park`, `resolve`,
  `list_parked`) and a system-prompt section telling it when to use them. Items
  are either **needs attention** (a deferred decision, an unanswered question, a
  blocker, a finding to act on) or **FYI** (a finished job, a notable finding,
  an assumption made on your behalf).
- **Choices come with options.** The agent can give a decision numbered
  options, the one it would pick, the files it is about, and whether work is
  blocked on it. Unless it is blocked, the agent goes ahead on its pick.
- **Answer in one key.** A digit picks an option, `a` accepts the agent's pick,
  and `w` lets you answer in your own words. Accepting the pick of work already
  under way sends nothing. Other answers are gathered for three seconds and
  sent to the main agent as one message.
- **Works with the ledger mod, where it is installed.** A task whose gate
  fails is parked as an FYI that closes by itself when the gate passes. Each
  unit with open review findings gets one item listing them with their files,
  which updates as findings are fixed and closes when none is left. Without
  the ledger, nothing changes.
- **You can park too.** `/park [note]` parks the assistant's last reply.
- **A pane to work through them.** `/parked` opens the backlog: needs attention, FYI,
  then done. Nothing is deleted; done items can be reopened.
- **A status line count**, such as `📌 2 need attention · 1 FYI`.
- **A side thread per item.** Ask about an item in its composer and a subagent
  investigates with tools. It is briefed from the main session's context first.
  The thread stays out of the main transcript, and the main agent cannot read
  it.
- **Send findings to the main agent.** One press posts a short summary of the
  thread (at most about 120 words) to the main conversation.
- **One backlog per project**, keyed by the working directory and kept across
  sessions.

## Install

This mod uses Claude Code's function-hooks plugin API.

Clone it into your personal skills folder, where Claude Code loads it in every
session:

```bash
git clone https://github.com/BuddyLim/claude-code-mod-parked ~/.claude/skills/parked
```

Or clone it anywhere and load it for one session:

```bash
claude --plugin-dir /path/to/claude-code-mod-parked
```

## Using the pane

Run `/parked`, then **click the pane once**. Arrow keys only reach the pane
after a click; that is a limit of the plugin API, not a choice.

### List

| Key | Does |
| --- | --- |
| `↑` `↓` or `k` `j` | move the cursor |
| `Enter`, `→`, `l` or `o` | open the item |
| `1`–`9` | open that row |

### Item

An item has three levels, marked with `▸`. `↑` `↓` (or `k` `j`) move between
them.

| Level | `←` `→` (or `h` `l`) | Other keys |
| --- | --- | --- |
| Tickets | previous / next item | |
| Actions | choose an action | `Enter` or `o` runs it |
| Composer | | type a question, `Enter` sends, `↑` leaves |

- `1`–`9` answer with that option; `a` accepts the default; `w` opens the
  composer for an answer in your own words (a number typed there picks that
  option). These need the click; without one, reach Accept and Answer on the
  actions row.
- `d` done, `r` reopen, `n` next, `p` previous, `b` back to the list.
- `i` jumps to the composer.
- `s` sends the thread's summary to the main agent, once the subagent has
  replied.
- `PgUp` `PgDn` or the mouse wheel scroll the thread; the wheel over the ticket
  scrolls the ticket.
- While you are in the composer, every letter is text.

### Without a click

After `Ctrl+X` `Tab` (or a fresh `/parked`) the pane has the keyboard but the
arrows do not work. `Tab` moves down, as `↓` does, in both views. The letter row at the bottom does: `h` `j` `k` `l`, `o` for
Enter and `i` for the composer.

### Fallback view

`/parked lab` switches between the keyboard view and an older view built from
standard buttons.

## Known limits

- **Early-access API.** The plugin API this depends on may change between Claude
  Code releases. It was written against Claude Code 2.1.288.
- **Arrow keys need a click**, as above.
- **Answers during a running turn.** A mod's own prompt waits for the turn to
  end, so while one runs the answers are put in the prompt box for you to send
  with Enter. If the box cannot take them, they are sent when the turn ends.
- **Plain text in the pane.** The ticket and thread are shown without Markdown
  formatting, because the pane scrolls them a row at a time.
- **Subagent completion notices.** When a side thread's subagent stops, the main
  agent may still receive a notice that it finished. The thread's content is not
  included.
- **Two sessions in one project** share a backlog, and two writes at the same
  instant can lose one.
- **Terminal and desktop only** for the keyboard view; other surfaces get the
  fallback view.

## Development

```bash
claude plugin validate .   # check the manifest and hooks module
claude plugin test .       # run the tests
```

- `hooks/register.tsx`: the hooks module: tools, commands, storage, the pane.
- `hooks/detail.tsx`: the pane's keyboard region.
- `hooks/backlog.ts`: the backlog's logic, free of the engine.
- `types/index.d.ts`: the state contract.
- `tests/parked.test.ts`: the tests.

## Licence

MIT
