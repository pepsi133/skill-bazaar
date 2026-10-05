# herd-delegation

The pane form of [`agent-delegation`](../agent-delegation/). The skill itself is
[`SKILL.md`](SKILL.md), written for the agent. This file is for the human. The agent loads
`SKILL.md` alone, and nothing in it points here, so this file costs no context at use time.

## What it does

A background subagent has no terminal and no channel to the human. Two consequences follow. It
cannot run a program that refuses a pipe, and when the spec runs out it guesses. A pane removes
both limits: a pane is a real terminal, and a pane is readable at any moment, so the parent sees
the question, the error and the progress while the work is still running.

## It is a delta, not a copy

This skill states **only what a pane changes**. Everything a pane leaves alone, it cites.

| for | the agent reads | this skill adds |
|---|---|---|
| the delegation protocol — the decision gate, secrets, human consent, naming evidence, artifact verification, adversarial review and the safety-critical path list | `agent-delegation` | what a reachable agent changes |
| every `herdr` verb, flag, lifecycle state and JSON path | `herdr --skill`, printed from the installed binary | the two overrides, and the traps the binary does not document |

That is deliberate. A skill that restates its dependency goes stale against it silently, and
the cost is paid twice in the context window. The official Herdr skill ships with the binary
and is therefore never out of date with it, which is the strongest reason to defer to it rather
than to paraphrase it.

What a pane actually changes, against `agent-delegation`:

| | `agent-delegation` | `herd-delegation` |
|---|---|---|
| Channel to the parent | A relay, or nothing | The pane, read at any time |
| Open decision mid-run | Pause, return, be resumed | Ask in the pane, wait, be answered |
| Interactive program | Out of reach | The reason to use a pane |
| Live output | Arrives at the end | Readable while it runs |
| Review channels to close | Transcripts and reports | Those, plus other panes and the agent list |
| Context figure | Nothing to read | The `ctx` segment of a Claude pane's status line |

## Scope

One pane at a time: the spawn, the brief, the reading, the answer, the review and the close.

It is not a herd. For many panes at once, a model and an effort per role, a steward that runs
compaction and renames, a liaison that fronts the operator, and turnover between panes, use
[`herd-forge`](../../plugins/herd-forge/), which sits one layer above this file and cites it the
same way this file cites `agent-delegation`.

## The rules that are this skill's own

**A tab per agent, never a half pane.** This overrides the official Herdr skill, which defaults
to a sibling pane in the current tab. A split halves the rows you came to read, and two agents
in one tab compete for the same screen. The skill creates a tab per unit of work, keeps the tab
ID for the close, and moves a misplaced pane out of a split.

**Inline work takes a pane, not a subagent**, where the parent itself runs in a pane. The author
is then the parent pane, and a review never runs there.

**A longer closed-channel list for a review.** A herd leaves the authoring pane running while
the review goes on, so `herdr agent list` names it and `agent read` and `pane read` are in the
skill. The reviewer's brief closes those channels by name, on top of the transcripts and reports
that `agent-delegation` already closes.

**A context threshold that can actually be read.** `agent-delegation` sets the figures — reuse
below 30 percent, wind up from 30 to 35, replace at or above 35 — and records that for a
subagent there is no figure to read at all. A pane is the case where there is one, so the
reading mechanics live here: the `ctx` segment, read in full, distinguished from the usage-window
and cache percentages on the same row. A narrow pane truncates it low, which is the direction
that argues for reuse, so where the figure cannot be read in full the rule is silent about that
agent rather than cautious. No pane is retired on a reading nobody has.

**`--effort` binds one session.** Measured on this bench: a pane started with no `--effort` flag
comes up at low. State the flag for every pane whose role needs it.

**The permission mode is the operator's decision**, not a default the skill sets.

## A note on the alternate screen

An agent that draws a full-screen interface runs on the terminal's alternate screen, and rows
that leave it do not enter ordinary host scrollback. For some idle agents Herdr can collect
application-owned history and restore the viewport afterwards, but not every application or
response can be recovered that way, so a larger `--lines` is no reliable path back. The
fallback is a file: the brief asks for a Markdown report at a named path and a pane reply of
that path alone.

The mechanism is documented in `herdr --skill`, which ships with the binary, so the skill cites
it there instead of carrying its own copy to go stale.

## Requirements

The `herdr` CLI, and a session running inside a Herdr-managed pane (`HERDR_ENV=1`). The skill
checks this first and stops if it fails.

## Install

```bash
claude plugin marketplace add pepsi133/skill-bazaar
claude plugin install herd-delegation@skill-bazaar
```

Or load the folder directly:

```bash
claude --plugin-dir "$(pwd)/skills/herd-delegation"
```

## License

MIT.
