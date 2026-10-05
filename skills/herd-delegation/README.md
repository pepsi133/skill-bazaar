# herd-delegation

The pane form of [`agent-delegation`](../agent-delegation/). The skill itself is
[`SKILL.md`](SKILL.md), written for the agent. This file is for the human. The agent loads
`SKILL.md` alone, and nothing in it points here, so this file costs no context at use time.

## What it does

A background subagent has no terminal and no channel to the human. Two consequences follow. It
cannot run a program that refuses a pipe, and when the spec runs out it guesses. A pane removes
both limits: a pane is a real terminal, and a pane is readable at any moment, so the parent sees
the question, the error and the progress while the work is still running.

This skill is the delegation protocol for that pane. It keeps the parts of `agent-delegation`
that a pane does not change, and it changes the one part a pane does change.

| | `agent-delegation` | `herd-delegation` |
|---|---|---|
| Channel to the parent | A relay, or nothing | The pane, read at any time |
| Open decision mid-run | Pause, return, be resumed | Ask in the pane, wait, be answered |
| Interactive program | Out of reach | The reason to use a pane |
| Live output | Arrives at the end | Readable while it runs |
| Unchanged | Decision gate before the spawn, evidence named instead of commands, secret values and human consent stay with the parent, artifact verification instead of exit codes | |

## Scope

One pane at a time. It covers the spawn, the brief, the reading, the answer, and the close.

It is not a herd. For many panes at once, a model and an effort per role, a steward that runs
compaction and renames, a liaison that fronts the operator, and turnover between panes, use
[`herd-forge`](../../plugins/herd-forge/). Load this skill when the job is "give this unit of
work its own terminal", and that one when the job is "run a herd".

## Two rules worth stating here

**A tab per agent, never a half pane.** A split halves the rows you came to read, and two
agents in one tab compete for the same screen. The skill creates a tab per unit of work and
moves a misplaced pane out of a split.

**The alternate-screen trap.** An agent that draws a full-screen interface writes to the
terminal's alternate screen, and rows that leave it never enter scrollback. A larger
`--lines` cannot recover them. The fallback is a file: the brief asks for a Markdown report at
a named path and a pane reply of that path alone.

## Two more rules, and why they are here

**An adversarial review before a unit is called finished.** A unit is not finished because its
author says so, so a second agent, never the author and never the parent pane, is briefed to
break it. The duty covers delegated work that produced a new or changed document or new or
changed code, and any work that touched a safety-critical path, whether it was delegated or
done inline.
The skill defines that path as a short testable list: a path that records, measures or returns
a verdict and can fail without raising an error, a certificate or key or credential path, a map
from a logical name to a physical output, anything that flashes or erases or re-provisions a
device, anything that changes what a later agent is permitted to do, anything that overwrites
evidence no commit or backup holds, and any path that holds, enforces, reports or computes a
limit, a guard or a stop condition protecting something outside the work.
A herd leaves the authoring pane running while the review goes on, which is exactly why the
reviewer's brief has to close the channels a pane opens: no other pane, no agent list, no other
agent's transcript, no sibling's report.

**A context threshold on reuse.** A pane agent takes a further unit only while it is below 30
percent of its window, winds up what it holds from 30 up to but not including 35, and is
replaced at or above 35. The figure is the `ctx` segment of a Claude pane's status line, read in
full, and a narrow pane truncates it low, which is the direction that argues for reuse. Where
that figure cannot be read in full the rule is silent about that agent rather than cautious: no
pane is retired on a reading nobody has, and the pane is judged on the unit it delivered and
what is left.

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
