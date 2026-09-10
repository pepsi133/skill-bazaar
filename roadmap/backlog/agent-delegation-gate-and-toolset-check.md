---
type: skill
proposed_by: pepsi133
created: 2026-09-08
---

# Agent delegation: ship the enforcement hook, add a split rule, add a toolset check

## Problem

A session mixed investigation with multi-file implementation. The session found three places
where the `agent-delegation` skill (version 0.3.0) states a rule but does not follow through.

The skill already covers two adjacent points well:

- The heading **"Whether to delegate: the default is yes"** states the delegate-by-default
  rule, the cost threshold ("delegate when writing the spec costs less than doing the work
  inline"), and the two carve-outs (secret values, the confirmation a human must see).
- The heading **"Secrets: keep values out of the transcript"** gives the strip-in-command rule
  and the fingerprint check (`jq -r '.value' | shasum -a 256 | cut -c1-8`) for a task that
  touches a secret store.

Three gaps remain:

1. **The hook is described, not shipped.** Under **"Platform execution notes"**, the skill
   names the exact mechanism: a `PreToolUse` hook input carries `agent_id` only inside a
   subagent, and a hook on `Edit|Write|NotebookEdit` that sees no `agent_id` denies the call.
   The skill gives the JSON shape a hook must emit. It does not ship a working hook script. A
   rule written only in prose "loses effect as the session grows and the context fills" (the
   skill's own words, under "Whether to delegate"). The one place the skill names as durable
   enforcement does not exist as a file a user can install.

2. **No rule for splitting or ordering work above a builder agent's file limit.** A change that
   touches several files can exceed what one delegate handoff is built to take. The skill gives
   no guidance for dividing such work into ordered, safe handoffs, and no guidance on whether
   two delegate agents may work against the same branch at once. Without that guidance, editing
   inline in the main session becomes the easiest path — the exact drift the "Whether to
   delegate" section warns against.

3. **No check that a delegation prompt's required evidence matches the target agent's
   toolset.** The section **"Name the evidence, not the command"** tells the author to state
   the observable a step must produce, not the command that checks it. It never tells the
   author to confirm that the agent receiving the prompt holds a tool that can produce that
   evidence. A prompt that asks for a test run, or any other tool-gated evidence, fails silently
   when the target agent's toolset lacks the needed tool. The agent correctly stops and reports
   that it cannot comply. The fault sits upstream, in the prompt.

## Proposed approach

1. Ship the hook that "Platform execution notes" already describes, as a real file in the skill
   package, not only as documentation of its shape. Default the hook to **confirm mode** ("ask a
   human before allowing") rather than a hard deny. A hard deny is bypassed the moment a
   main-session Bash call performs the edit instead of `Edit`, `Write`, or `NotebookEdit`. A rule
   that can be routed around trains the workaround instead of stopping it. Document plainly that
   a Bash-based edit bypasses the matcher in either mode, so the hook is not oversold as a
   complete gate.

2. Add a splitting rule: how to divide a change above one delegate agent's file limit into
   ordered handoffs, and whether parallel delegates may touch one branch at once — and if so,
   how they avoid overwriting each other's diff.

3. Add a toolset-check step next to "Name the evidence, not the command": before naming the
   evidence a step must produce, confirm the target agent's toolset can produce it. Where a
   companion plugin already lists each preset agent's tools, point to that list instead of
   duplicating it here.

## Notes

**Decision recorded:** the hook defaults to confirm mode, not hard deny. Reason: a hard deny
only blocks the `Edit|Write|NotebookEdit` matcher. A Bash-based edit (`sed -i`, a heredoc, a
patch applied by script) bypasses that matcher outright, in confirm mode or deny mode alike.
Confirm mode still asks a human on every gated call, so it costs a decision each time — but a
hard deny gives a false sense of safety without closing the Bash gap.

**Open question:** confirm mode costs a human decision on every gated call. Whether that cost
is worth paying depends on how often the gate would otherwise be routed around. Worth
validating with real usage before hardening the default further in either direction.

**Estimate:**

- Model: sonnet
- Effort: M
- Tokens: ~40k-80k

**Risks:**

- A shipped hook in confirm mode still asks on every main-session Edit or Write. A user who
  says yes out of habit gets no real gate, only extra friction.
- A Bash-based edit bypasses an `Edit|Write|NotebookEdit` matcher outright, in confirm mode or
  deny mode alike. The hook cannot see it.
- A splitting rule written against one builder agent's file limit goes stale the moment a
  different preset, or a later version of the same preset, ships a different limit.
- A toolset check needs an accurate, current tool list per preset agent. A list embedded in the
  skill drifts the day a preset's tools change.

**Compatibility:**

- The `PreToolUse` hook JSON contract (`hookSpecificOutput.hookEventName`,
  `permissionDecision`) is a host contract, not something this skill controls. Confirm the
  confirm-style decision value against the current host docs before the hook ships.
- A splitting rule and a toolset-check step both want a per-agent tool table. Where a bundled
  agent roster already exists in a companion plugin, point at it instead of duplicating it in
  this skill, so the two cannot drift apart.

## Acceptance criteria

- [ ] The skill package ships a working `PreToolUse` hook file, defaulted to confirm mode, that
      matches the JSON contract already described under "Platform execution notes".
- [ ] The hook's documentation states plainly that a Bash-based edit bypasses the matcher in
      either mode.
- [ ] The skill adds a splitting rule for work above one delegate agent's file limit, covering
      ordered handoffs and whether parallel delegates may share a branch.
- [ ] The skill adds a toolset-check step next to "Name the evidence, not the command" that
      confirms the target agent's toolset can produce the named evidence before the prompt is
      sent.
