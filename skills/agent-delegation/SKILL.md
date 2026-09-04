---
name: agent-delegation
description: >-
  Protocol for handing work to a subagent that cannot ask the human mid-run: delegate by
  default with two main-session carve-outs (secret values, human confirmations), a
  decision-completeness gate, stop-clause wording, an ask-and-continue variant for
  harnesses with a parent relay, and artifact verification instead of exit codes. Use on
  "delegate this", "spawn an agent to...", "hand off to a subagent", "the subagent needs
  an answer", before doing multi-file work inline instead of delegating it, and before a
  subagent reads a credential store. The unsupervised-guess protocol, not a
  subagent-preset chooser like cavecrew; not for background shell commands or plain
  subagent search.
---

# Agent delegation

Delegating a self-contained work item to a background subagent keeps the main session's
context clean and lets the subagent start without the parent's irrelevant history. Two walls
make naive delegation fail, both measured rather than assumed (see *What was measured*,
below; re-measure before trusting — harnesses change):

1. **A background subagent has no direct channel to the human.** It cannot stop mid-run
   to ask the human a question. Handed an ambiguous spec, it guesses, and the guess is
   already written to disk by the time anyone sees it. Some harnesses give the subagent a
   channel to its *parent* session. That channel is a relay, not a human: the question
   travels subagent → parent → human → parent → subagent, and each hop has a cost (see
   *Ask and continue*, below).
2. **Privilege boundaries return success on refusal.** An action that needs interactive human
   consent (a GUI elevation prompt and its kin) can return a success exit code whether the
   human approved, denied, or never looked at the screen. An agent that trusts the exit code
   reports success for work that never happened.

## Whether to delegate: the default is yes

Delegation drifts in one direction. Investigation gets delegated, because the token saving
is visible before the spawn. Implementation gets done inline, because by then the work
feels understood and the spawn feels like overhead. The feeling is the drift, not a reason:
a spec that feels understood is exactly one that passes the gate below cheaply.

Before any edit in the main session, ask whether a subagent can do it from a spec. If yes,
write the spec and spawn. The threshold: delegate when writing the spec costs less than
doing the work inline. A one-line fix fails that test; a multi-file edit passes it. Two
carve-outs stay in the main session whatever the threshold says:

1. **Work that reads or writes secret values**, unless the subagent is handed the exact
   filtered command. See *Secrets*, below.
2. **The step that needs the human: a security warning the human must see, or the
   confirmation before an irreversible action.** The subagent has no direct channel to the
   human (wall 1). The step itself stays; the work around it can be delegated.

A spec that fails the gate below is not a third carve-out. It stays in the main session
only until its open decisions are resolved, and it is delegable once they are.

A delegate-by-default rule written in the context window is advisory. It loses effect as
the session grows and the context fills. Where the harness can gate a tool call before it
runs, put the rule there. See *Platform execution notes*.

### Secrets: the leak is at the tool result

"Report metadata only, never print a value" constrains the report, not what a tool returns
into the transcript. A subagent sent to inventory a credential store starts with the broad
listing call. If the listing returns plaintext values (GitLab's CI variables endpoint does;
`masked` redacts job logs only), every value is in the transcript before the agent forms
any intention. The transcript persists after the run.

This skill does not control the environment, so it cannot prevent the leak. It can name the
two shapes that avoid it:

- Keep the work in the main session and strip values in the same command, so no value
  reaches any tool result: `... | jq 'map(del(.value))'`.
- If the work must be delegated, hand the subagent the exact filtered command. Given a
  goal to explore instead of a command, the subagent tries the broad call first.

To compare secrets without revealing them, compare fingerprints:
`jq -r '.value' | shasum -a 256 | cut -c1-8`. Equal fingerprints mean equal values.

Validate after a delegated run: search the subagent transcript (location under *Platform
execution notes*) for the secret field name, and make sure that every hit is stripped or a
fingerprint.

## Is the spec ready: the decision-completeness gate

A spec is delegable only when every open decision in it is already resolved. The subagent
cannot ask the human, so an unresolved decision is not a question to it — it is a silent
guess. Before spawning, read the spec as if you were the subagent and list every place it
could go two ways. Resolve each one yourself, or route it to the human, before the spawn —
not after.

If the spec fails the gate, the fix is not "delegate anyway and hope" — it is either to
resolve the remaining decisions or to keep the work in-session. The relay does not lower
the gate: a question sent mid-run costs a parent turn and stalls the subagent, and a
question resolved before the spawn costs nothing.

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
2. The parent is interactive and attentive for the whole run. A parent that runs
   unattended, or in a non-interactive mode, is not measured and does not qualify.
3. The open decision blocks only part of the work. If it blocks all of it, the subagent
   has nothing to do while it waits, and the plain stop clause is cheaper.

The clause, to adapt:

```
If a decision blocks only part of this task, send the question to the parent session,
then continue with the parts that do not depend on the answer. When you reach the blocked
part and no answer has arrived, stop and return the open question. Do not guess.
```

The parent decides how to answer. It can answer from its own context, or forward the
question to the human through its own interactive channel. The subagent cannot tell which
one happened, so the delegation prompt must not promise the subagent a human answer.

Two costs to weigh:

- Each question costs one parent turn. The parent must be awake to read and answer.
- The answer does not interrupt the subagent. It arrives at the subagent's next step, so a
  subagent inside a long command sees the answer only after that command returns.

## The delegation prompt template

A delegation prompt is a document written for an agent that cannot ask you anything else —
treat it with the same rigor as any other agent-facing document (a `writing-for-agents`
skill, where available, covers the underlying levers: completion criteria, pointer wording,
prompting the positive rather than the prohibition). At minimum, state:

- **Working directory** — the exact path the subagent operates in. Not "the repo" — the
  literal directory, especially when worktrees or nested checkouts are in play.
- **The evidence each step must produce** — not the command that checks it. Name the
  observable (a file exists with X content, a value changed, a build passes locally) rather
  than a check that can pass for the wrong reason. See *Name the evidence*, below.
- **Report format** — what the subagent hands back: what it did, what it verified and how,
  open decisions it made a defensible call on, and anything left undone.
- **The report-outside-scope-changes clause** — any change made outside the named working
  directory (global git config, credential helpers, `~/.claude`, system files) must be
  reported explicitly, even when it was a reasonable means to an end. "Do X in repo Y" does
  not mean "and nothing anywhere else" to an agent that needs, say, auth configured to
  finish the task.
- **The stop clause**, above, or its ask-and-continue variant.
- **The question channel**, only with the ask-and-continue variant: the address the
  subagent sends to, and which parts of the work it must continue with while it waits.

### Name the evidence, not the command

A check that passes for the wrong reason manufactures false confidence, which is worse than
no check — it forecloses the doubt that would have caught the failure. Confirming a remote
merge with `git rev-parse main origin/main` and no preceding `git fetch` compares a local ref
to a possibly-stale local copy of the remote; it can report success while proving nothing.
State the evidence a step must produce ("the remote's HEAD, fetched fresh, matches local
main") and let the agent choose the command — don't hand it a command and let it stand in for
the evidence.

## Artifact verification: missing means unknown

Where an action crosses a privilege or GUI boundary, the exit code carries no information.
Define the observable artifact the work produces — a file, a state change, a queryable
property — and check *that*, never the exit code alone.

**Absence of the artifact means unknown, not failed.** Denied, still pending, and
unattended are indistinguishable from the caller's side, and collapsing them into "failed"
is as wrong as collapsing them into "succeeded." Report the artifact's state plainly: found
and matches expectation, found and does not match, or absent — and stop there rather than
inferring a cause the observation doesn't support.

## Routing: who can actually act

| Action class | Can a subagent do it? | Path |
|---|---|---|
| Non-interactive credential (stored secret, key auth) | Yes | Direct — no special handling |
| Interactive GUI consent (an elevation prompt and its kin) | No | Hand the command to the human directly; a subagent cannot complete it |
| A decision the spec left open | Not alone | Relay to the parent where the harness has a channel; the parent answers or forwards to the human. Without a channel: stop and return the question |
| Work that reads or writes secret values | Not safely | Main session, or the exact filtered command; see *Secrets* |
| A security warning or an irreversible-action confirmation | No | The step stays in the main session; the work around it can be delegated |

The load-bearing point: a *separate* agent or CLI instance hits the same wall. The obstacle
is interactive consent, not agent shape — spawning another agent to get past a consent
prompt does not help, because the prompt still needs a human at the screen. Route the step
to the human instead of reaching for more delegation. The relay does not pass a consent
prompt either: it carries a question to a parent, and the parent still needs the human at
the screen.

## Model selection

**Choosing a cheaper model relocates the reasoning into the prompt — it does not remove it.**
A cheap model needs the decisions pre-made and the steps literal, in order, with explicit
precondition checks; a capable model works from a spec plus pre-resolved decisions and
sequences the work itself.

## What was measured

Measured on Claude Code (WSL2, subagents on Sonnet and Haiku), the relay twice on two
consecutive versions. Nothing here is guaranteed stable across releases: re-measure before
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
  requires — state the worktree path explicitly rather than letting the agent infer it, and
  expect the tool to report the path and branch back on completion (or clean up silently if
  the agent made no changes).
- **The relay channel**: a background subagent (Agent tool) loads `SendMessage` with
  `ToolSearch("select:SendMessage")` and sends to the literal address `main`. The addresses
  `parent` and `lead` are not valid. The parent replies with `SendMessage` to the agent ID
  from the spawn result. The reply is queued and delivered at the subagent's next tool
  round. In the delegation prompt, name `main` as the question channel.
- **The parent's side**: the subagent's message arrives inside the parent's running turn,
  attached to the next tool result, marked as coming from an agent and not from the user.
  The parent must not treat it as user approval for anything. To forward the question to
  the human, the parent uses its own `AskUserQuestion`; the subagent never sees that step.
- **Enforcing the delegation default**: hook input on `PreToolUse` carries `agent_id` only
  when the hook fires inside a subagent. Key on `agent_id` alone: `agent_type` also appears
  when the session runs with `--agent`, and `session_id` is not documented as a subagent
  signal. A hook matched on `Edit|Write|NotebookEdit` that sees no `agent_id` denies the
  call. To deny, print this JSON on stdout and exit 0. Exit 2 blocks whether or not you
  print JSON, and a JSON allow cannot override it:

  ```json
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
  ```

  Two limits. The matcher does not see a file write done through `Bash` (`sed -i`, a
  redirect). A wrong or non-executable script path fails open: the harness allows the call
  and the gate is silently off. Validate once after setup: an `Edit` in the main session is
  denied with the reason text, and the same `Edit` inside a subagent passes.
- **Subagent transcripts**: a subagent's tool results, secrets included, are written to
  `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`. Removing the symlink
  under the session's `tasks/` directory leaves that file in place.
