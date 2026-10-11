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
- **The agent parks things for itself too.** A third kind, **assistant**,
  is for what it means to come back to: a deferred follow-up, a check to
  rerun, cleanup it promised. These sit in their own section, ask nothing of
  you and stay out of the status line count. The agent is reminded of its open
  ones when the list changes and every few prompts after, and is told not to
  call work finished while one is open without saying so.
- **Built for coming back to a run.** A session that opens with items waiting
  says how many and for how long. `a` in the list accepts the agent's pick on
  every item that has one. `l` on an item scrolls the conversation back to
  where it came up. `/parked work` tells the agent to go through its own list.
- **A blocked agent is hard to miss.** While an item blocks the agent, one row
  above the prompt shows its title and its options to click, and a way into
  the pane.
- **Undo.** `u` takes back the last thing done in the pane: a done, an answer,
  a reopen, or every default accepted at once. An answer not yet sent is never
  sent.
- **Stale items say so.** An item is marked stale, and each such file with
  it, when a file it refers to has changed since it was parked.
- **Park what you select.** With text selected in the transcript, `/park` parks
  that text instead of the last reply.
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
- **Tickets drawn as Markdown.** A ticket's body and a thread's replies are
  drawn as Claude Code draws a reply: headings, lists, tables, and code fences
  that keep a diagram's spacing. The agent is told to write bodies that way.
- **A side thread per item** (hidden for now; `/parked chat` shows it, and
  hides it again). Open an item's side thread and ask about it: a
  subagent starts at once, investigates with tools, and its reply appears as it
  is written. A briefing made from the main session's context takes longer to
  write and follows as a message to the subagent; the handover (its
  instructions and that briefing) is kept on the thread for you to read. The
  thread stays out of the main transcript, and the main agent cannot read it.
- **Send findings to the main agent.** One press posts a short summary of the
  thread (at most about 120 words) to the main conversation.
- **Kept per session, listed across them.** An item belongs to the session it
  was parked in and stays with it when you close and resume that session. The
  pane lists this session's items, named as `/resume` names the session; `v`
  widens the list to every session of the project, then to every session.
  An answer you give to another session's item is sent to that session's
  agent when it is next open.

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

Run `/parked`. The pane opens with the keyboard: its letters and digits are
shortcuts until you press Esc, which closes it. `/parked project` and
`/parked all` open it on a wider list.

### List

| Key | Does |
| --- | --- |
| `j` `k` | move the cursor |
| `o` | open the item |
| `v` | the next scope: this session, this project, every session |

Click the list once and the arrow keys, `Enter`, `→` and `l` work too. Arrow
keys only reach a pane's region after a click; that is a limit of the plugin
API, not a choice.

### Item

An item is one page the pane scrolls: its actions, its options, then two
sections of which one is open at a time, the **ticket** and the **side
thread**.

- `1`–`9` answer with that option; `a` accepts the default; `w` opens a text
  field for an answer in your own words (a number typed there picks that
  option).
- `d` done, `r` reopen, `n` next, `p` previous, `b` back to the list.
- Pressing one of the item's files opens it in the pane, in the
  [lens](https://github.com/BuddyLim/claude-code-mod-lens) mod's viewer where
  that is installed, with a button back to the item; without lens, its lines
  around the reference are shown in the item.
- `t` opens the side thread in the ticket's place, and the ticket again. The
  thread's text field is drawn only while the thread is open, so a closed
  thread takes no keys.
- `i` puts the cursor in the thread's text field. `Enter` sends; `Enter` on an
  empty line leaves the field, and the letters are shortcuts again.
- `x` shows or hides the handover the thread's subagent was started with.
- `s` sends the thread's summary to the main agent, once the subagent has
  replied.
- The mouse wheel, `PgUp` and `PgDn` scroll the page. While a reply is being
  written the page stays at its end, unless you have scrolled up.

### List without the keyboard region

`/parked lab` switches the list between its keyboard region and a list of
standard buttons, where `1`–`9` open a row.

## Known limits

- **Early-access API.** The plugin API this depends on may change between Claude
  Code releases. It was written against Claude Code 2.1.288.
- **Arrow keys in the list need a click**, as above.
- **Answers during a running turn.** A mod's own prompt waits for the turn to
  end, so while one runs the answers are put in the prompt box for you to send
  with Enter. If the box cannot take them, they are sent when the turn ends.
- **Subagent completion notices.** When a side thread's subagent stops, the main
  agent may still receive a notice that it finished. The thread's content is not
  included.
- **Sessions open at the same time** share the one backlog, and two writes at
  the same instant can lose one.
- **A session's name** is read from its transcript when a turn ends, so a new
  session is listed by the start of its id until then.
- **Done items** are kept up to the newest 200.

## Development

```bash
claude plugin validate .   # check the manifest and hooks module
claude plugin test .       # run the tests
```

`/parked trace` prints what the side threads' plumbing last did (a question's
stages, each subagent step's pieces, a scroll that was refused), for when a
reply does not show as it is written.

- `hooks/register.tsx`: the hooks module: tools, commands, storage, the pane.
- `hooks/detail.tsx`: the list's keyboard region.
- `hooks/backlog.ts`: the backlog's logic, free of the engine.
- `types/index.d.ts`: the state contract.
- `tests/parked.test.ts`: the tests.

## Licence

MIT
