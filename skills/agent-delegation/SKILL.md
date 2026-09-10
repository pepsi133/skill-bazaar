---
name: agent-delegation
description: >-
  Protocol for handing work to a subagent that cannot ask the human mid-run. Use before
  spawning an agent, before doing multi-file work inline instead of delegating it, when a
  subagent hits a decision the spec left open, before a subagent reads a credential store,
  and when an action that needs interactive human consent returns success. Not a
  subagent-preset chooser like cavecrew, and not for background shell commands or plain
  subagent search.
---

# Agent delegation

Delegating a self-contained work item to a background subagent keeps the main session's
context clean, and it lets the subagent start without the parent's irrelevant history. Two
walls make naive delegation fail. Both are measured, not assumed. See *What was measured*,
below, and re-measure before you trust them, because harnesses change.

1. **A background subagent has no direct channel to the human.** It cannot stop mid-run to
   ask the human a question. Handed an ambiguous spec, it guesses, and the guess is already
   written to disk by the time anyone sees it. Some harnesses give the subagent a channel to
   its *parent* session. That channel is a relay, not a human. The question travels from
   subagent to parent to human to parent to subagent, and each hop has a cost. See *Ask and
   continue*, below.
2. **Privilege boundaries return success on refusal.** An action that needs interactive human
   consent, such as a GUI elevation prompt, can return a success exit code whether the human
   approved, denied, or never looked at the screen. An agent that trusts the exit code
   reports success for work that never happened.

## Whether to delegate: the default is yes

Delegation drifts in one direction. Investigation gets delegated, because the token saving is
visible before the spawn. Implementation gets done inline, because by then the work feels
understood, and the spawn feels like overhead. The feeling is the drift, not a reason. A spec
that feels understood is exactly one that passes the gate below cheaply.

Before any edit in the main session, ask whether a subagent can do it from a spec. If yes,
write the spec and spawn. The threshold: delegate when writing the spec costs less than doing
the work inline. A one-line fix fails that test. A multi-file edit passes it. Two carve-outs
stay in the main session whatever the threshold says:

1. **Work that reads or writes secret values**, unless the subagent is handed the exact
   filtered command. See *Secrets*, below.
2. **The step that needs the human: a security warning the human must see, or the
   confirmation before an irreversible action.** The subagent has no direct channel to the
   human (wall 1). The step itself stays in the main session, and the work around it can be
   delegated.

A spec that fails the gate below is not a third carve-out. It stays in the main session until
its open decisions are resolved, and it is delegable once they are.

A delegate-by-default rule written in the context window is advisory. It loses effect as the
session grows and the context fills. Where the harness can gate a tool call before it runs,
put the rule there. See *Platform execution notes*.

### Secrets: keep values out of the transcript

A "report metadata only" instruction does not stop a tool result from carrying values. The
broad listing call comes first, and some endpoints return plaintext. GitLab's CI variables
endpoint does, because `masked` covers job logs only. Strip values in the same command, in
the main session (`... | jq 'map(del(.value))'`), or hand a subagent that exact command.
Compare fingerprints, never values, one variable at a time:
`jq -r '.value' | shasum -a 256 | cut -c1-8`. After a delegated run, grep the subagent
transcript (location under *Platform execution notes*) for the secret field name. Every hit
must be a fingerprint or a stripped field.

## Is the spec ready: the decision-completeness gate

A spec is delegable only when every open decision in it is already resolved. The subagent
cannot ask the human, so an unresolved decision is not a question to it. It is a silent
guess. Before spawning, read the spec as the subagent reads it, and list every place it
can go two ways. Resolve each one yourself, or route it to the human, before the spawn.

If the spec fails the gate, resolve the remaining decisions, or keep the work in-session. The
relay does not lower the gate. A question sent mid-run costs a parent turn and stalls the
subagent. A question resolved before the spawn costs nothing.

## The stop clause

Every delegation prompt carries this clause, verbatim or adapted, as the subagent's
substitute for asking:

```
If any decision in this task is ambiguous or the spec is incomplete — stop, implement
nothing further, and return the open questions instead. Guessing is worse than stopping.
```

### Ask and continue: the relay variant

Use this variant only when all three conditions hold. Otherwise use the plain stop clause.

1. The harness has a measured channel from the subagent to its parent session.
2. The parent is interactive and attentive for the whole run. A parent that runs unattended,
   or in a non-interactive mode, is not measured and does not qualify.
3. The open decision blocks only part of the work. If it blocks all of it, the subagent has
   nothing to do while it waits, and the plain stop clause is cheaper.

The clause, to adapt:

```
If a decision blocks only part of this task, send the question to the parent session,
then continue with the parts that do not depend on the answer. When you reach the blocked
part and no answer has arrived, stop and return the open question. Do not guess.
```

The parent decides how to answer. It can answer from its own context, or forward the question
to the human through its own interactive channel. The subagent cannot tell which one
happened, so the delegation prompt promises the subagent an answer from the parent, and never
an answer from the human.

Two costs to weigh:

- Each question costs one parent turn. The parent must be awake to read and answer.
- The answer does not interrupt the subagent. It arrives at the subagent's next step, so a
  subagent inside a long command sees the answer only after that command returns.

## The delegation prompt template

A delegation prompt is a document written for an agent that cannot ask you anything else, so
treat it with the same rigor as any other agent-facing document. A `writing-for-agents`
skill, where available, covers the underlying levers: completion criteria, pointer wording,
and prompting the positive rather than the prohibition. At minimum, state:

- **Working directory**: the literal directory path the subagent operates in, including the
  worktree or nested checkout in play.
- **The evidence each step must produce**: the observable, such as a file that exists with
  X content, a value that changed, or a build that passes locally. See *Name the evidence*,
  below.
- **Report format**: what the subagent hands back. It states what it did, what it
  verified and how, the open decisions it made a defensible call on, and anything left
  undone.
- **The report-outside-scope-changes clause**: any change made outside the named working
  directory (global git config, credential helpers, `~/.claude`, system files) must be
  reported explicitly, even when it was a reasonable means to an end. "Do X in repo Y" reads
  as permission to configure whatever the task needs, to an agent that needs, say, auth
  configured to finish.
- **The stop clause**, above, or its ask-and-continue variant.
- **The question channel**, only with the ask-and-continue variant: the address the subagent
  sends to, and which parts of the work it must continue with while it waits.

### Name the evidence, not the command

A check that passes for the wrong reason manufactures false confidence, which is worse than
no check, because it removes the doubt that finds the failure. Confirming a
remote merge with `git rev-parse main origin/main` and no preceding `git fetch` compares a
local ref to a possibly stale local copy of the remote. It can report success while proving
nothing. State the evidence a step must produce ("the remote's HEAD, fetched fresh, matches
local main"), and leave the command to the agent. The evidence is yours to name. The command
is the agent's to choose.

## Artifact verification: missing means unknown

Where an action crosses a privilege or GUI boundary, the exit code carries no information.
Define the observable artifact the work produces, such as a file, a state change, or a
queryable property, and check that artifact rather than the exit code.

**Absence of the artifact means unknown, not failed.** Denied, still pending, and unattended
are indistinguishable from the caller's side. Collapsing them into "failed" is as wrong as
collapsing them into "succeeded". Report the artifact's state plainly: found and matches
expectation, found and does not match, or absent. Stop at the observation, and leave the
cause to whoever can observe more.

## Routing: who can actually act

| Action class | Can a subagent do it? | Path |
|---|---|---|
| Non-interactive credential (stored secret, key auth) | Yes | Direct, with no special handling |
| Interactive GUI consent (an elevation prompt and its kin) | No | Hand the command to the human directly. A subagent cannot complete it |
| A decision the spec left open | Not alone | Relay to the parent where the harness has a channel, and the parent answers or forwards to the human. Without a channel, stop and return the question |
| Work that reads or writes secret values | Not safely | Main session, or the exact filtered command. See *Secrets* |
| A security warning or an irreversible-action confirmation | No | The step stays in the main session, and the work around it can be delegated |

The load-bearing point: a *separate* agent or CLI instance hits the same wall. The obstacle is
interactive consent, not agent shape. Spawning another agent to get past a consent prompt does
not help, because the prompt still needs a human at the screen. Route the step to the human
instead of reaching for more delegation. The relay does not pass a consent prompt either. It
carries a question to a parent, and the parent still needs the human at the screen.

## Model selection

**Choosing a cheaper model relocates the reasoning into the prompt, and it does not remove
it.** A cheap model needs the decisions pre-made and the steps literal, in order, with
explicit precondition checks. A capable model works from a spec plus pre-resolved decisions,
and it sequences the work itself.

## What was measured

Measured on Claude Code (WSL2, subagents on Sonnet and Haiku), the relay twice on two
consecutive versions. Nothing here is guaranteed stable across releases, so re-measure before
you rely on it. Not measured: agent teams, non-interactive parents, other harnesses.

- **Wall 1.** No tool for asking the human was in a background subagent's list, and a tool
  search for one returned nothing. The parent session was reachable in both directions, and
  the subagent kept working between its question and the answer.
- **Wall 2.** A GUI elevation prompt returned success within milliseconds, before the human
  responded. Approval, denial and "nobody looked" were indistinguishable from the caller's
  side. Only the artifact the elevated process wrote showed what happened.

## Platform execution notes

<!-- Claude-Code-specific mechanics. Core protocol above is tool-agnostic. -->

- **Isolation worktree**: `isolation: "worktree"` gives the delegated agent its own git
  worktree, which is the natural home for the *working directory* the prompt template
  requires. State the worktree path explicitly rather than letting the agent infer it, and
  expect the tool to report the path and branch back on completion, or clean up silently if
  the agent made no changes.
- **The relay channel**: a background subagent (Agent tool) loads `SendMessage` with
  `ToolSearch("select:SendMessage")` and sends to the literal address `main`. The addresses
  `parent` and `lead` are not valid. The parent replies with `SendMessage` to the agent ID
  from the spawn result. The reply is queued and delivered at the subagent's next tool round.
  In the delegation prompt, name `main` as the question channel.
- **The parent's side**: the subagent's message arrives inside the parent's running turn,
  attached to the next tool result, marked as coming from an agent and not from the user. The
  parent treats it as an agent report, never as user approval. To forward the question to the
  human, the parent uses its own `AskUserQuestion`, and the subagent never sees that step.
- **Enforcing the delegation default**: `PreToolUse` hook input carries `agent_id` only
  inside a subagent, which the hooks documentation names as the way to tell a subagent call
  from a main-session one. A hook on `Edit|Write|NotebookEdit` that sees no `agent_id` gates
  the call by printing this on stdout and exiting 0. A wrong or non-executable script path
  fails open, and the gate is then silently off:

  ```json
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
  ```
- **Subagent transcripts**: a subagent's tool results, secrets included, are written to
  `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`. Removing the symlink
  under the session's `tasks/` directory leaves that file in place.
