---
type: skill
proposed_by: pepsi133
created: 2026-09-08
---

# Agent delegation: ship the enforcement gate, add a toolset check

## Problem

The `agent-delegation` skill (version 0.3.0) states two rules that it does not carry through.

The skill covers the adjacent points well.

- The heading **"Whether to delegate: the default is yes"** states the delegate-by-default
  rule, the cost threshold ("delegate when writing the spec costs less than doing the work
  inline"), and the two carve-outs (secret values, the confirmation a human must see).
- The heading **"Secrets: keep values out of the transcript"** gives the strip-in-command rule
  and the fingerprint check (`jq -r '.value' | shasum -a 256 | cut -c1-8`).

Two gaps remain.

### Gap 1: the gate is described, not shipped

Under **"Platform execution notes"**, the skill names the mechanism. A `PreToolUse` hook input
carries `agent_id` only inside a subagent. A hook on `Edit|Write|NotebookEdit` that sees no
`agent_id` denies the call. The skill gives the JSON that a hook must emit. It ships no hook
file.

The skill states the consequence in its own words, under "Whether to delegate". A rule written
in the context window "loses effect as the session grows and the context fills". The one
durable mechanism the skill names does not exist as a file that a user can install.

A second defect sits under the first. The rule is graded, and a tool matcher is not. The skill
allows an inline one-line fix, and it allows both carve-outs. A `PreToolUse` hook input carries
the tool name, the tool input, the session id, and `agent_id`. It carries no measure of the
change size. A gate keyed on the tool name alone asks a human on every main-session edit,
including every edit that the skill allows. Habituation follows. The gate then costs friction
and returns nothing.

### Gap 2: no toolset check before the prompt is sent

The section **"Name the evidence, not the command"** tells the author to state the observable
that a step must produce. It never tells the author to confirm that the target agent holds a
tool that can produce that observable. A prompt that asks for a test run fails when the target
agent has no `Bash`. The agent stops and reports that it cannot comply. The fault sits
upstream, in the prompt.

The case is real in this repository. `plugins/caveman/agents/cavecrew-builder.md` declares
`tools: Read, Edit, Write, Grep, Glob` and states "No `Bash` available". Any evidence that
needs a command fails for that preset.

## Proposed approach

1. Ship the gate as a hook file under `skills/agent-delegation/hooks/`. Default it to ask mode,
   not deny mode. Raise the ask on the second distinct file path in one turn. Document that a
   Bash-based edit bypasses the matcher in either mode.

2. Add a toolset-check step next to "Name the evidence, not the command". Before you name the
   evidence, confirm that the target agent holds a tool that can produce it. Point at the agent
   definition file as the source of truth for the tool list.

## Decisions recorded

**D1. The hook ships inside the skill package, at `skills/agent-delegation/hooks/`.** Reason:
the skill already depends on Claude Code behavior. The relay channel, the address `main`, and
the subagent transcript path are all harness facts. Portability is already spent, so a second
package buys nothing.

**D2. Ask mode, not deny mode.** Reason: a hard deny blocks the `Edit|Write|NotebookEdit`
matcher only. A Bash-based edit (`sed -i`, a heredoc, a patch script) bypasses that matcher in
either mode. Ask mode still puts a human in the path. Deny mode gives a false sense of safety,
and it closes nothing more.

**D3. The ask triggers on the second distinct file path in a turn.** Reason: the rule in the
skill is about size, and the tool name carries no size. A `UserPromptSubmit` hook clears the
set at the start of each turn. The `PreToolUse` hook adds each `file_path` to the set. The
first file passes in silence. The second distinct file raises the ask. This maps onto the word
"multi-file" in the skill, and it keeps the allowed one-line fix silent.

**D4. The splitting rule is dropped from this item.** Reason: it anchored on one builder
agent's file limit, which is a preset property. The skill description states that the skill is
"not a subagent-preset chooser like cavecrew". *Platform execution notes* already answers the
branch half of the question, because `isolation: "worktree"` gives each delegate its own tree.
What remained was generic work splitting, which carries no delegation-specific fact.

**D5. A recorded measurement blocks the ship.** Reason: the skill holds a *What was measured*
section, and it tells its readers to measure before they trust. Two claims under *Platform
execution notes* carry no measurement in this repository. Claim 1: hook input carries
`agent_id` only inside a subagent. Claim 2: a wrong or non-executable script path fails open,
and the gate is then silently off. Claim 2 decides whether the hook needs a self-test, because
a silent failure leaves the user in trust of a gate that is off.

**D6. `AGENTS.md` gains a written condition for hooks under `skills/<name>/`.** Reason: the
directory map puts hooks under `plugins/<name>/hooks/` only, and skill rule 5 keeps a skill
free of tool-specific assumptions outside *Platform execution notes*. D1 breaks both. A rule
with one silent exception decays. The condition lands in the same commit as the hook.

## Open question

Ask mode costs a human decision on each gated call. The distinct-file counter lowers the count,
and it does not remove it. Validate the real ask rate against real usage before you harden the
default in either direction.

## Estimate

- Model: sonnet
- Effort: M
- Tokens: ~40k-80k

## Risks

- A user who answers yes out of habit gets friction and no gate. The distinct-file counter
  lowers the ask rate, and it does not remove the habit.
- A Bash-based edit bypasses an `Edit|Write|NotebookEdit` matcher in either mode. The hook
  cannot see it.
- A wrong or non-executable script path fails open. The user is then in trust of a gate that is
  off. D5 measures this before the ship.
- A tool list copied into the skill goes stale when a preset changes. The toolset check points
  at the agent definition file instead, so one source of truth stays.

## Compatibility

- The `PreToolUse` JSON contract (`hookSpecificOutput.hookEventName`, `permissionDecision`) is
  a host contract. Confirm the ask value against the current host documentation before the hook
  ships. `plugins/limit-guard/hooks/limit-guard-gate.py` is the working reference in this
  repository.
- The turn reset in D3 needs a `UserPromptSubmit` hook. Confirm that the event exists, and that
  it fires before the first tool call of a turn.
- The state file must be per session. Two sessions in one project must not share a counter.

## Acceptance criteria

- [ ] The measurement in D5 is recorded in `roadmap/private/` with harness version and date,
      and it covers both claims.
- [ ] `skills/agent-delegation/hooks/` ships a `PreToolUse` hook that emits the JSON contract
      under *Platform execution notes*, defaulted to ask mode.
- [ ] A probe confirms the trigger. One edit to one file in a turn raises no ask. An edit to a
      second distinct file in the same turn raises one ask.
- [ ] A probe confirms that an edit from inside a subagent raises no ask.
- [ ] The hook documentation states that a Bash-based edit bypasses the matcher in either mode.
- [ ] `AGENTS.md` carries the D6 condition, in the same commit as the hook.
- [ ] `SKILL.md` carries a toolset-check step next to "Name the evidence, not the command", and
      it points at the agent definition file for the tool list.
- [ ] `python3 scripts/validate-skills.py` passes.
