# Herdr facts, measured on this host

Every answer below comes from running the command on the installed binary on
this host. Nothing here is recalled or inferred from documentation. Where an error
proved a rule, the error text is exact. `herdr --skill` prints the agent skill of Herdr
and is the authority on syntax. Read it rather than trusting a copy, including this
one.

## Names

| layer | command | spaces and punctuation |
|---|---|---|
| workspace | `herdr workspace create [--cwd] [--label] [--env] [--focus\|--no-focus]`, `workspace rename <id> <label>` | Yes. `rename wA "probe run — wA"` returned the label unchanged |
| tab | `herdr tab create [--workspace] [--cwd] [--label] [--env]`, `tab rename <id> <label>` | Yes |
| pane | `herdr pane split [--cwd] [--env]`, then `pane rename <id> <label>\|--clear` | Yes. `pane split` takes no `--label`, so a pane takes its name in a second step |
| agent | `herdr agent start <name> --kind KIND --pane ID`, `agent rename <target> <name>\|--clear` | No |

The agent-name rule, from the error itself:

    {"error":{"code":"invalid_agent_name","message":"agent name must start with a
    lowercase letter and contain only lowercase letters, digits, '-' or '_' (1-32
    characters)"}}

Uniqueness, corrected after the reviewer challenged it. The binary states
the rule in its own skill text, which `herdr --skill` prints: "Names must match
`[a-z][a-z0-9_-]{0,31}` and be unique among live agents. A name follows the current
pane occupant and is cleared when that agent exits, is released, or is replaced."

Measured, by provoking the collision: `herdr agent rename herdw8 herdwb` returned

    {"error":{"code":"agent_name_taken","message":"agent name herdwb is already
    used; candidates: ... pane_id=wA:pC workspace_id=wA ... status=Idle"}}

Measured, for the scope: `herdr agent list` returns every live agent across all four
workspaces in one response, and `herdr session list` shows one session, `default`, with
its own socket. The namespace therefore covers the Herdr session and spans every
workspace in it.

Not measured: what a second session does. Nobody has run two sessions on this host, so
nobody has measured whether two sessions share one namespace or hold separate ones. Do
not assume either. An earlier version of this file said "host-wide" and took it from
the report of `wC`, not from a measurement. A later version said that a second session
runs its own namespace, which is a reading of the architecture and not a measurement
either.

`wC` and `wA` each collided with the name `critic` from another herd. That collision
fits either wording, which is why the imprecision survived.

Caution: the agent namespace is shared with every other herd on the machine. Never test
it with a name that another herd can be using. `wA:p1` renamed an agent to `critic` to
test the scope. The test proved nothing, because the `critic` of `w8` had exited and
Herdr had already released the name. Had that agent still run, taking its name could
have misrouted messages meant for that herd into this one. A read-only capability
question was answered with a write. Test with a name that nobody would choose, or on an
agent that you created for the purpose.

`terminal_title` is a separate field. The agent process sets it, and it changes as the
agent works. It is not the pane label. Never use it as a name.

## Move a pane to its own tab

    herdr pane move <pane_id> --new-tab --label "<role>" --no-focus

A pane moved inside its own workspace keeps its pane identifier. A pane moved to another
workspace receives a new one. Read the identifier from the response rather than assuming
it.

Name the tab and the pane for the role that runs there, and set the pane name after the
agent starts, because the pane exists before its occupant. `terminal_title` is not a
substitute: the agent sets that field for itself and it reports activity, not identity.

## Match a directory to a pane, an agent and a session

`herdr agent get <target>` returns it all in one object: `name`, `pane_id`, `tab_id`,
`workspace_id`, `terminal_id`, `cwd`, `foreground_cwd`, `agent_status`, and
`agent_session.value`, which is the session identifier. Measured example: agent
`herdw8`, pane `wA:pD`, tab `wA:t1`, workspace `wA`, session `<session-id>`.

`herdr pane process-info --pane ID` adds the operating-system view: shell pid,
foreground pid, argv and cwd.

Herdr reports this only while the agent runs. That is why `common/IDENTITY.md` is
written at creation and not at the end.

## Agent kinds

`herdr agent` recognises 22 kinds in this build:

    pi, claude, codex, gemini, cursor, devin, agy, cline, omp, mastracode,
    opencode, copilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli,
    qwen, maki

`opencode` is supported. `minimax` is not in the list.

`herdr integration install <kind>` covers a different set: pi, omp, claude, codex,
copilot, devin, droid, kimi, opencode, kilo, hermes, qodercli, qwen, cursor,
mastracode, antigravity-cli, grok. `antigravity-cli` is installable and is not a
recognised kind, and several recognised kinds have no integration. The two lists are
not one list.

## Fallback for a kind that Herdr does not recognise

- `herdr pane run <pane_id> <command>` starts the process in a plain pane.
- `herdr pane send-text` and `herdr pane send-keys` drive it.
- `herdr pane wait-output <pane_id> (--match TEXT | --regex PATTERN) [--timeout MS]`
  waits on output instead of on agent lifecycle state.
- `herdr pane report-agent <pane_id> --source ID --agent LABEL --state
  idle|working|blocked|unknown [--agent-session-id ID] [--agent-session-path PATH]`
  declares the occupant, so an unsupported CLI appears as a managed agent with a
  lifecycle state.
- `herdr pane release-agent` clears it afterwards.

The caller asserts that state, and Herdr does not detect it, so it is only as honest as
the caller. Say so wherever such an agent reports its state.

## Wait, do not poll

    herdr agent wait <target> [--until idle|done|blocked|unknown] [--timeout MS]
    herdr pane wait-output <pane_id> (--match TEXT | --regex PATTERN) [--timeout MS]

Run them in the background, so that the turn of the overseer ends and the wake arrives
as a completion. `--until blocked` catches a worker stopped at an approval dialog,
which otherwise waits forever and looks busy.

`done` is a state, not a delivery. Completed, idle, blocked on a dialog, and dead on
the account limit are one value, and `wC` had a lane report `done` and write nothing.
The wake tells you to look. The file tells you whether anything is there.

`unknown` means that Herdr sees an agent and cannot classify it. That is neither
completion nor failure. `herdr agent explain <target>` reports how Herdr classified the
occupant of a pane, and it is the right next command.

## Reach an agent, and reach an overseer

`herdr agent prompt <target> "<text>"` takes a pane id as well as a name. That is the
only way to reach an overseer pane that carries no agent name. A finishing worker
reports in this way, and three overseers reached a fourth this way.

A `timeout` error from `--wait` on a long task means that the prompt landed and the
agent works. `--wait` waits only for the next settled state. Exit status is 1 and the
JSON says `{"error":{"code":"timeout"}}`. Do not send it again. Run `agent get`.

Build long prompts in a file and pass `"$(cat file)"`. Avoid apostrophes, backticks and
shell metacharacters. A backtick in an unquoted context substitutes empty output in
place of your words, and the recipient cannot tell a mangled message from a whole one.

## Arguments and environment

`herdr agent start <name> --kind KIND --pane ID [--timeout MS] [-- <agent-args...>]`.
Everything after `--` reaches the agent process. Confirmed: `-- --model opus` gives
`argv: ["claude","--model","opus"]`. This is the mechanism for the unrestricted
permission option and for any other native flag.

`--env KEY=VALUE` works in `workspace create`, `tab create` and `pane split`, and a
pane keeps it, so an agent started there inherits it. That is how an agent points at a
different configuration directory or credential, which is the operator-approved way to
spread usage across accounts that the operator owns. This file does not name the
variable. The variable belongs to the agent that you launch, not to Herdr, and a wrong
name fails in silence.

## Working directories, tabs and panes

`--cwd PATH` works in workspace create, tab create and pane split. A path that does not
exist raises no error. The pane lands in the home directory, and the agent then hangs
in startup and looks healthy. `wC` measured this and the help text says nothing. Create
the directory, make sure that it exists, then create the tab.

Use `tab create`, not repeated `pane split`. Repeated splits in one direction are
unusably narrow by about the fourth pane. The new pane id is at
`.result.root_pane.pane_id`.

`herdr agent list` returns every workspace, interleaved. Filter it. Do not read it by
eye. Bare `herdr` starts the TUI, and a command group with no subcommand prints help
and exits 2, which is normal there.

Read transcripts with `--source recent-unwrapped`, which joins soft wraps. Rows that
left the alternate screen never enter host scrollback, so a larger `--lines` cannot
recover them. Ask the agent to write a file instead. The read window is a denominator.
`wB` got zero hits at 60 lines and one hit at 400 lines.
