---
name: herd-delegation
description: >-
  Delegate a unit of work to an agent in its own Herdr pane, then drive that pane as a real
  terminal. Use when the work needs a terminal that a pipe cannot give: an interactive prompt,
  arguments not known in advance, live output, a long run the parent must watch, or a decision the
  parent must answer mid-run. Use also where a background subagent can only guess, because a pane
  agent can be asked and answered. Use before reporting pane work as finished and before reusing a
  pane agent. Do not use it for a one-line fix, for plain file search, or for the herd machinery
  of herd-forge. Requires the herdr CLI and HERDR_ENV=1.
---

# Herd delegation

A background subagent has no channel to the human and no terminal of its own. It guesses, and
the guess is on disk before anyone sees it. A pane removes both limits. A pane is a real
terminal, so an interactive program runs in it. A pane is readable at any moment, so the
parent sees the question, the error and the progress while the work is still running.

**This skill is the pane delta on two others, and it restates neither.**

| for | read | this file adds |
|---|---|---|
| the delegation protocol: the decision gate, secrets, human consent, naming evidence, artifact verification, adversarial review, the safety-critical path list | `agent-delegation` | what a reachable agent changes |
| every `herdr` verb, flag, state and JSON path | `herdr --skill`, printed from the installed binary | the two places this bench overrides it, and the traps it does not carry |

Read `agent-delegation` first where the question is *whether and how to delegate*. Read
`herdr --skill` where the question is *what to type*. The installed binary is the authority on
syntax; this file never repeats it.

## Choose a pane, a subagent, or neither

Use a pane when one of these is true:

- The work drives an interactive program: a console, a shell on a device, a REPL, a serial
  terminal, an installer, a credential prompt. A program that refuses a pipe needs a pane.
- The exact arguments are not known. The error text or the interactive question in the pane
  tells you the right form faster than reasoning about the manual does.
- The output is live: a progress bar, a spinner, a log that must be watched, a server that
  must stay up while other work runs.
- The run is long and the parent must stay free and keep reading it.
- A decision will surface mid-run and the parent can answer it.

Use a plain background subagent when the work is a self-contained file or search task with a
complete spec and no terminal need. Do the work inline when writing the brief costs more than
doing it: a one-line fix fails the delegation test.

## Preflight

```bash
test "${HERDR_ENV:-}" = 1
```

If that fails, say you are not inside Herdr and stop. Do not inspect or drive a Herdr session
from outside it. Then print `herdr --skill` and the group you are about to use. Do not run bare
`herdr`, because it launches or attaches the terminal interface, and do not probe a mutating
subcommand by omitting its arguments.

Your own location arrives in the environment: `$HERDR_WORKSPACE_ID`, `$HERDR_TAB_ID`,
`$HERDR_PANE_ID`.

## The spawn sequence

`herdr --skill` carries the call forms for `agent start` and `agent prompt`, the readiness
semantics, and the JSON paths the identifiers come from. Three things it does not say hold here.

**One tab per unit of work, never a half pane.** This is the first of two overrides of the
official skill, which defaults to a sibling pane in the current tab and tells you to create no
tab at all. So it carries no `tab create` form either, and the form lives here:

```bash
herdr tab create --cwd "$PWD" --label <short-role-name> --no-focus
```

A split halves the rows you came to read, and two agents in one tab compete for the same screen.
Pass `--cwd` on every tab, because a new tab does not inherit yours. Create as many tabs as the
work needs, and move a pane that already sits in a split:

```bash
herdr pane move <pane-id> --new-tab --label <short-role-name> --no-focus
```

The agent name keeps resolving across the move; the pane ID in the response is the one to use
from then on.

**Keep the tab ID, not only the pane ID.** The close step needs both.

**Create a workspace or a worktree only when the operator asks for that topology.**

## The brief

`agent-delegation` states what a delegation prompt must carry: the working directory, the
evidence rather than the command, the report format, and the report-outside-scope-changes
clause. All of it holds. A pane changes exactly one clause.

`agent-delegation` tells a subagent to pause and be resumed, because it cannot be reached. A
pane agent can, so it asks and waits:

```
If a decision in this task is ambiguous or the spec is incomplete, do every part that does
not depend on the answer, leave the blocked part untouched, and print the question in this
pane with the state you left on disk. Wait at the prompt. You will be answered here.
Guessing is worse than asking.
```

Two additions, both because a pane is a screen rather than a return value:

- **Scope the unit so that it ends.** A pane that never finishes cannot be retired.
- **Send a long report to a file.** Ask for Markdown at a named path and a pane reply of that
  path alone. The alternate-screen limit in `herdr --skill` is why. This is the second override:
  the official skill keeps file output as a fallback and says not to request it in the initial
  prompt, and a brief that asks for it up front never reaches the unreadable case.

The gate does not disappear because the agent is reachable. A question answered mid-run costs a
read, a reply and a stalled pane; a decision resolved before the spawn costs nothing.

### The adversarial review pane

`agent-delegation` owns this duty in full: when a review is owed, the seven-item
safety-critical path list, the brief-to-break-it rule, the attempted-and-not-attempted
reporting, where findings go, what makes a fix substantial, and that a nil return is still
reported. Read it there. A pane changes two things and leaves a third alone.

**Inline work takes a pane, not a subagent.** Where the parent itself runs in a pane, the author
is the parent pane, and a review never runs there.

**Give the review pane a kind and flags that can re-derive the evidence**, because
`agent start --kind` chooses among agents with different toolsets.

**The closed-channel list needs nothing added.** A pane does open channels a subagent does not:
the authoring pane stays open until the review returns, `herdr agent list` names it, and
`agent read` and `pane read` are in this file. `agent-delegation` already closes every one of
them by name, another agent's pane and the agent list included. Send its block verbatim from
there. This file keeps no copy, because a copy is the thing that goes stale.

## Drive the pane

`herdr --skill` carries `agent get`, `agent read`, `agent wait`, `agent send-keys`, `pane run`,
`pane wait-output`, `pane read`, the four read sources, `--format ansi`, the lifecycle states and
the `agent_blocked` refusal. Two notes sit on top of it.

**Answer a printed question by prompting again** with the decision named and the answer given,
plus anything that changed on disk since it asked.

**`unknown` is not completion.** An agent is present and Herdr cannot classify it. Treat it as an
unfinished unit.

An ordinary command rather than an agent gets its own tab the same way, driven through the pane
surface.

## What stays with the parent

`agent-delegation` states both carve-outs. A pane sharpens each.

**Secret values.** A pane keeps scrollback, so a read of that pane puts whatever it holds into
the reader's context. Filter in the same command that fetches and hand the pane the exact
filtered command. After the run, read the pane for the secret field name and confirm that every
hit is a fingerprint or a stripped field.

**Human consent.** A pane agent sitting at an approval dialog has consent from nobody, and
`agent prompt` correctly refuses it with `agent_blocked`. Read the dialog, surface it to the
operator, and send the key only after the operator decides. Delegate the work around that step,
never the step.

## Close the pane

A pane is cheap and a stale pane is not. When the unit is delivered, its evidence read, and any
review it owes returned with its findings closed, close the pane **and the tab you created**,
then start a fresh agent for the next unit, unless the threshold below admits reuse:

```bash
herdr pane close <pane-id>
herdr tab close <tab-id>
```

Record in your own report what each pane produced, where it is, and what still needs a decision.
Do not close a workspace, tab, pane or session you did not create unless the operator asks, and
never stop the Herdr server from inside a live session.

### The context threshold on reuse

`agent-delegation` sets the figures and states that they bind only where the percentage can
actually be read. A pane is the case where it can, so the reading mechanics live here.

Reuse a pane agent below 30 percent. From 30 up to but not including 35, the agent winds up the
unit it holds and takes no further one: send none, let it finish and report, then retire the pane
and its tab once any review that unit owes is closed. At or above 35, retire on the same
condition and spawn fresh, whether or not a further unit waits. In rare cases a compaction
carrying a task-specific prompt replaces the close; no herdr verb compacts, so it is one
submission, `agent prompt <name> "/compact <what the next unit needs carried over>"`, and the
next brief goes in once it settles. Every exception is the operator's to approve.

A Claude pane renders the figure in its own status line:

```bash
herdr agent read reviewer --source visible
```

The figure is the `ctx` segment, read in full as `ctx NN%`, or as `ctx 12k/200k (NN%)` where the
segment is configured wide, and the percent sign is part of what must be read. The rest of that
row carries the 5-hour and 7-day usage-window percentages and a cache percentage, and none of
those is the context figure. A narrow pane truncates the segment, so `ctx 42%` can arrive as
`ctx 4`: readable, wrong, and always lower, which is the direction that argues for reuse. The
status line is the operator's own configuration, other agent kinds do not render it, and the
segment prints `ctx ?%` when the figure is unknown.

**The figures reach only an agent whose `ctx NN%` can be read in that full form.** Where it
cannot, the rule is silent about that agent rather than cautious. Retire no pane on a reading you
do not have, substitute no estimate, and judge that pane on what you can see: the unit it
delivered and what is left. State that judgment in your own report, and ask the operator where
reuse matters.

## Validation

Before you report a delegated run as finished:

1. `herdr agent get <name>` returns `idle` or `done`. `blocked` is settled too, so `--wait`
   returns on it, and a pane at an approval dialog is an unfinished unit, as is `unknown`. So is
   a question the agent printed that nobody answered, and an agent waiting for that answer reads
   as `idle` or `done`.
2. The evidence named in the brief exists and matches. For a file, read it. For a test, read the
   result, not the claim that it passed.
3. Every identifier you used came from a JSON response.
4. Any out-of-scope change the agent reported is accounted for in your own report.
5. The pane and its tab are closed, or there is a stated reason they stay open.
6. Work that owes a review has been through one, its verdict is in your own report with a nil
   return and what it attempted included, and no finding stands without a stated reason.

## Platform execution notes

<!-- Herdr and Claude Code mechanics. The protocol above is tool-agnostic. -->

`herdr --skill` carries `--` argument passing, `agent_not_ready`, `agent_prompt_stalled`,
identifier stability, agent-name grammar and the error exit statuses. For the installed
agent-kind list it sends you to `herdr agent`, which prints the kinds on stderr. Three things it
does not carry.

- **A model or effort flag binds one session.** `-- --model <model> --effort high` reaches that
  agent and does not change the default for the next pane. State the flag for every pane whose
  role needs it. Measured on this bench: a pane started with no `--effort` comes up at **low**.
- **The permission mode is the operator's decision, not this skill's default.** A pane that
  stops at every prompt is visible, which is the point, but it also blocks.
- **For many panes at once**, a steward, a liaison and turnover, use `herd-forge`. This skill
  covers one pane at a time.
