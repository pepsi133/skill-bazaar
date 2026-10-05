---
name: herd-delegation
description: >-
  Delegate a unit of work to an agent in its own Herdr pane, then drive that pane as a real
  terminal. Use when the work needs a terminal that a pipe cannot give: an interactive prompt, a
  command whose exact arguments are not known in advance, live output or a progress bar, a long
  run the parent must watch, or a decision the parent must answer while the work continues. Use
  also where a background subagent can only guess, because a pane agent can be asked and answered
  mid-run. Use before reporting delegated work that produced new or changed documents or code as
  finished, before reporting any work that touched a safety-critical path as finished, and before
  reusing a pane agent for a further unit. Do not use it for a one-line fix, for plain file
  search, or for the full herd machinery of herd-forge. Requires the herdr CLI and HERDR_ENV=1.
---

# Herd delegation

A background subagent has no channel to the human and no terminal of its own. It guesses, and
the guess is on disk before anyone sees it. A pane removes both limits. A pane is a real
terminal, so an interactive program runs in it. A pane is readable at any moment, so the
parent sees the question, the error and the progress while the work is still running.

This skill is the delegation protocol for a pane. It is the pane form of `agent-delegation`,
and the two differ in one place: a pane agent is reachable, so a question costs a read and a
reply instead of a discarded run. Everything else holds. Resolve the decisions you can
resolve before the spawn, name the evidence rather than the command, and keep secret values
and human consent out of the delegation.

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
complete spec and no terminal need.

Do the work inline when writing the brief costs more than doing it. A one-line fix fails the
delegation test.

## Preflight

Confirm that you are inside a Herdr pane:

```bash
test "${HERDR_ENV:-}" = 1
```

If the check fails, say that you are not inside Herdr and stop. Do not inspect or drive a
Herdr session from outside it.

The installed binary is the authority for syntax. Print a group before you use it:

```bash
herdr --help
herdr pane
herdr agent
```

Do not run bare `herdr`, because it launches or attaches the terminal interface. Do not probe
a mutating subcommand by omitting its arguments.

Read your own location from the injected context:

```bash
printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
```

## The spawn sequence

One unit of work gets one pane of its own. Give the pane a full tab. Do not split a pane in
half to make room for an agent: a half pane truncates the output you came to read, and two
agents in one tab compete for the same rows. Create as many tabs as the work needs.

Create a workspace or a worktree only when the operator asks for that topology.

1. Create a tab in the current workspace, in the caller's working directory, without taking
   the operator's focus:

   ```bash
   herdr tab create --cwd "$PWD" --label <short-role-name> --no-focus
   ```

   Take the tab ID from `.result.tab.tab_id` and the pane ID from
   `.result.root_pane.pane_id`. Parse every identifier out of JSON. Never guess one and never
   read one from a sidebar. Keep both: the close step uses the tab ID.

2. Start the agent in that root pane with a short unique name:

   ```bash
   herdr agent start reviewer --kind claude --pane <root-pane-id>
   ```

   `agent start` needs a pane that is already at an interactive prompt. It never creates or
   moves layout. Native agent arguments go after `--`.

3. Send the brief:

   ```bash
   herdr agent prompt reviewer "<the brief>" --wait --timeout 600000
   ```

   Omit `--wait` when you want the parent free during the run. Add `--wait` when the next
   parent step depends on the result.

A pane that already exists in the wrong place moves to its own tab rather than staying in a
split:

```bash
herdr pane move <pane-id> --new-tab --label <short-role-name> --no-focus
```

The agent name keeps resolving across the move. The pane ID in the response is the one to use
from then on.

## The brief

A pane agent reads one message and then works. Write the brief as a document, not a request.
State all of this:

- **The working directory**, as a literal path, including a worktree or a nested checkout.
- **The unit of work**, scoped so that it ends. A pane that never finishes cannot be retired.
- **The evidence each step must produce**: a file with named content, a value that changed, a
  test that passes. Name the evidence and leave the command to the agent. A check that passes
  for the wrong reason removes the doubt that finds the failure.
- **What to do with an open decision.** A pane agent is reachable, so the instruction is to
  ask rather than to stop:

  ```
  If a decision in this task is ambiguous or the spec is incomplete, do every part that does
  not depend on the answer, leave the blocked part untouched, and print the question in this
  pane with the state you left on disk. Wait at the prompt. You will be answered here.
  Guessing is worse than asking.
  ```

- **Report format**: what it did, what it verified and how, the calls it made on its own, the
  open questions, the state on disk, and anything left undone.
- **Out-of-scope changes**: any change outside the working directory is reported explicitly,
  global configuration and the harness configuration directory included.
- **Where the report goes.** For anything longer than a few lines, ask for a Markdown file at
  a named path and a reply of that path alone. See the alternate-screen trap below.

The gate does not disappear because the agent is reachable. Every decision you can resolve
before the spawn costs nothing to resolve. A question answered mid-run costs a read, a reply
and a stalled pane.

The line between a call and a question: the agent decides when the code or the evidence
determines the answer, and asks when two answers both fit the brief.

### The adversarial review pane

Work is not finished until an independent agent has tried to break it when either of these
holds: it was delegated and it produced a new or changed document, or new or changed code; or
it touched a safety-critical path, delegated or done inline in the parent pane. A path is
safety-critical when any one of these holds:

1. It records, it measures, it carries data to something that records, or it produces a count,
   a coverage figure or a pass-or-fail verdict, and it can fail without raising an error, so
   that a dead path reads the same as a working one.
2. It handles a certificate, a key, a credential, or the trust store that validates one.
3. It maps a logical name to a physical output, so that an edit there can actuate something
   other than the thing named.
4. It flashes, erases, re-images or re-provisions a device, or it can leave one unable to boot.
5. It changes what a later agent is permitted to do: a permission rule, a hook, a sandbox
   boundary, or a file an agent is directed to follow as instruction rather than documentation
   a reader consults.
6. It overwrites or deletes evidence, or state that cannot be regenerated, where no commit,
   snapshot or backup holds the prior copy.
7. It holds, enforces, arms, reports or computes a limit, a guard or a stop condition that
   protects something outside the work, such as a device, a third party, or data the work does
   not own, or it is the call site or the configuration that decides whether one is consulted.
   An edit that weakens one of them, moves where it is consulted, or leaves it unenforced in
   any mode is a change to this path, and a path that only reports one, or only computes
   whether one has been reached, is inside this item rather than outside it.

That list is this skill's floor, and a project can name more.

The review goes to the mechanism the work used: a pane where the work had a pane, a background
subagent where it had one. Inline work takes a pane of its own, in preference to the subagent
that `agent-delegation` names for it, because the author is the parent pane and the review
never runs there. The review reads: it makes no edit and runs no git write. Give the review pane
a kind and flags that can re-derive the evidence the brief names, because `agent start --kind`
chooses among agents with different toolsets.

The reviewer's brief is to break the work rather than to confirm it, and it names what the
review must attempt. For each named attempt the review reports the command it ran or the line
it quoted, and an attempt it did not carry out is reported as not attempted, so a pass that
breaks nothing still shows its work.

The author's conclusion is withheld, because a reviewer handed the conclusion confirms it. In a
herd the withholding holds only as a list of closed channels: the authoring pane stays open
until the review returns and its findings are closed, `herdr agent list` names it, and `agent
read` and `pane read` are in this file. So the brief closes those channels itself:

```
Read only the artifact under review and the repository, less the author's commit messages,
notes and status files. Do not read another pane, another agent's transcript, a sibling agent's
report or the agent list, and do not ask another agent what it concluded.
```

An ambiguity in the work is a finding, so a review brief replaces the ask-in-the-pane clause
with this one:

```
An ambiguity in the work under review is a finding. Record it with the file, the line and the
fix you propose, then carry on. Do not stop to ask, and do not ask the author.
```

Never prompt an agent to review what it wrote, and never run the review in the parent pane.
Findings go back to the authoring pane while it is open, and otherwise to a fresh pane briefed
with the original unit, the artifact and the findings; a fix pass is scope on the original unit
rather than a further unit. The work is not reported finished while a finding stands, and a
finding the parent declines to fix goes to the operator with the reason rather than into a
finished report. A fix that changes a claim, a number, an interface or an instruction is
substantial and goes to a second review pane, run by an agent that did not raise the finding.

## Drive the pane

Lifecycle states are `idle`, `working`, `blocked`, `done` and `unknown`. `blocked` means
Herdr recognized an approval or question interface. `unknown` means an agent is present but
Herdr cannot classify it, and it is not proof of completion.

```bash
herdr agent get reviewer
herdr agent read reviewer --source recent-unwrapped --lines 120
herdr agent wait reviewer --until blocked --timeout 120000
herdr agent send-keys reviewer esc
```

Answer a question the agent printed by prompting it again with the decision named and the
answer given, plus anything that changed on disk since it asked.

`agent prompt` refuses an agent that sits at an approval dialog and returns `agent_blocked`
before it writes anything. That refusal is correct. Read the dialog, then follow the consent
rule below.

For an ordinary command rather than an agent, give it its own tab the same way and use the
pane surface:

```bash
herdr pane run <pane-id> "<command>"
herdr pane wait-output <pane-id> --match "<literal text>" --timeout 120000
herdr pane read <pane-id> --source recent-unwrapped --lines 120
```

`pane wait-output` searches the current snapshot first, so text that already exists matches.
Use `--format ansi` only when color is the evidence.

### The alternate-screen trap

An agent that draws a full-screen interface runs on the terminal's alternate screen. Rows that
leave it do not enter ordinary host scrollback. For some idle agents Herdr can collect
application-owned history and restore the viewport afterward, but not every application or
response can be recovered that way, so a larger `--lines` is no reliable path back. Raising
`--lines` once and getting no more output is the signal.

The fallback is a file. Ask the agent to write its complete response as Markdown at a
temporary path and to reply with that path alone, then read the file. Plan for this in the
brief for any long report, and keep the pane reply to a path and a short summary.

## What stays with the parent

Two things never move into a pane.

**Secret values.** A pane keeps scrollback, and a read of that pane puts whatever it holds
into the reader's context. Filter in the same command that fetches, and hand the pane the
exact filtered command. Compare fingerprints rather than values, one at a time. After the
run, read the pane for the secret field name and confirm that every hit is a fingerprint or a
stripped field.

**Human consent.** A security warning the human must read, and the confirmation before an
irreversible action, stay with the parent. A pane agent sitting at an approval dialog has not
been given consent by anyone. Read the dialog, surface it to the operator, and send the key
only after the operator decides. Delegate the work around that step, never the step.

### Artifact verification

Where the work crosses a privilege or interface boundary, an exit code carries no
information. An elevation prompt returns success whether the human approved, denied or never
looked. Check the artifact the work produces. Absence means unknown, not failed. Report
found-and-matches, found-and-differs, or absent, and leave the cause to whoever can observe
more.

## Close the pane

A pane is cheap and a stale pane is not. When the unit of work is delivered and its evidence is
read, and where the unit owes a review once that review has returned and its findings are
closed, close the pane and the tab you created for it, then start a fresh agent for the next
unit, unless the threshold below admits reuse, or, where no figure can be read, the judgment in
that section does:

```bash
herdr pane close <pane-id>
herdr tab close <tab-id>
```

Record in your own report what each pane produced, where it is, and what still needs a
decision.

Do not close a workspace, tab, pane or session you did not create unless the operator asks.
Never stop the Herdr server from inside a live session.

### The context threshold on reuse

Context here means the percentage of its window an agent has consumed. Reuse a pane agent for
a further unit only while it is below 30 percent. From 30 percent up to but not including 35
percent the agent winds up the unit it holds and takes no further one: the parent sends none,
lets the agent finish and report that unit, and then retires the pane and its tab once any
review that unit owes is closed. At or above 35 percent the parent retires the pane on the same
condition and spawns a new one by the spawn sequence, whether or not a further unit is
waiting. In rare cases a compaction carrying a
task-specific prompt replaces the close; no herdr verb compacts, so that compaction is one
submission, `agent prompt <name> "/compact <what the next unit needs carried over>"`, and the
next brief goes in once it settles. Every exception is the operator's to approve rather than
the parent's.

A Claude pane can render the figure in its own status line:

```bash
herdr agent read reviewer --source visible
```

The figure is the `ctx` segment, read in full as `ctx NN%`, or as `ctx 12k/200k (NN%)` where
the segment is configured wide, and the percent sign is part of what must be read. The rest of
that row carries the 5-hour and 7-day usage-window percentages and a cache percentage, and none
of those is the context figure. A narrow pane truncates the segment, so `ctx 42%` can arrive as
`ctx 4`: readable, wrong, and always lower, which is the direction that argues for reuse. The
status line is the operator's own configuration, other agent kinds do not render it, and the
segment itself prints `ctx ?%` when the figure is unknown.

**The two figures reach only an agent whose `ctx NN%` can be read in that full form.** Where it
cannot, the rule above is silent about that agent rather than cautious about it. Retire no pane
on the strength of a reading you do not have, substitute no estimate, and judge that pane on
what you can see: the unit it delivered and what is left. State that judgment in your own report
where you reuse a pane agent, and ask the operator where reuse matters.

## Validation

Before you report a delegated run as finished, confirm each of these:

1. `herdr agent get <name>` returns `idle` or `done`. `blocked` is also a settled state, so
   `--wait` returns on it, and a pane at an approval dialog is an unfinished unit, as is
   `unknown` by *Drive the pane*. A question the agent printed and nobody answered is an
   unfinished unit too, and an agent waiting at the prompt for that answer reads as `idle` or
   `done`.
2. The evidence named in the brief exists and matches. For a file, read it. For a test, read
   the result, not the claim that it passed.
3. Every identifier you used came from a JSON response.
4. Any out-of-scope change the agent reported is accounted for in your own report.
5. The pane and its tab are closed, or there is a stated reason they stay open, such as a
   pending review of that unit.
6. Work that owes a review by *The adversarial review pane* has been through one, its verdict
   is in your own report with a nil return and what it attempted included, and no finding is
   left standing without a stated reason.

## Platform execution notes

<!-- Herdr and Claude Code mechanics. The protocol above is tool-agnostic. -->

- `herdr agent` prints the installed agent kinds. Pass native arguments after `--`:
  `herdr agent start reviewer --kind claude --pane w1:p2 -- --model <model> --effort high`.
- A model or effort flag passed this way binds that one session. It does not change the
  default for the next pane. State the flag for every pane where the role needs it.
- Start a Claude pane with a permission mode that matches the operator's intent. A pane that
  stops at every prompt is visible, which is the point, but it also blocks. A pane started
  with prompts bypassed is a decision the operator makes, not a default this skill sets.
- A successful `agent start` returns only once Herdr detects the agent and considers it ready.
  A startup that is blocked returns `agent_not_ready` and still leaves the name usable for
  `agent read` and `agent send-keys`. Wait for `idle` before you prompt.
- `agent prompt` returns `agent_prompt_stalled` when a prompt sent from a non-working state
  produces no lifecycle change within a few seconds.
- Public identifiers (`w1`, `w1:t1`, `w1:p1`) are stable and are not reused after a close. A
  pane moved to another workspace gets a new identifier; continue with the value in
  `.result.move_result.pane.pane_id` or with the live agent name.
- Agent names match `[a-z][a-z0-9_-]{0,31}`, are unique among live agents, follow the pane
  occupant, and clear when that agent exits.
- Server errors arrive as JSON on stderr with exit status 1. A syntax error exits with
  status 2.
- For the wider machinery of many panes at once, a steward, a liaison and turnover, use a
  herd skill built for that. This skill covers one pane at a time.
