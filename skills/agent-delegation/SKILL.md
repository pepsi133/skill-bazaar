---
name: agent-delegation
description: >-
  Protocol for handing work to a subagent that cannot ask the human mid-run. Use before
  spawning an agent, before doing multi-file work inline instead of delegating it, when a
  subagent hits a decision the spec left open, when a subagent returns with an open question
  or its message arrives in the parent session, before a subagent reads a credential store,
  and when an action that needs interactive human consent returns success. Not a
  subagent-preset chooser like cavecrew, and not for background shell commands or plain
  subagent search.
---

# Agent delegation

A background subagent has no channel to the human. Handed an ambiguous spec, it guesses, and
the guess is on disk before anyone sees it. Two rules follow. Resolve every decision before
the spawn. And when a decision still surfaces mid-run, the subagent **pauses** with the
question, keeps its context, and the parent **resumes** it with the answer. Where the parent is
free during the run, the question also travels the **relay** to it mid-run.

## Whether to delegate: the default is yes

Before any edit in the main session, ask whether a subagent can do it from a spec. If yes,
write the spec and spawn. Delegate when writing the spec costs less than doing the work
inline. A one-line fix fails that test. A multi-file edit passes it, even when the work
already feels understood.

Two carve-outs stay in the main session whatever the threshold says:

1. **Work that reads or writes secret values**, unless the subagent is handed the exact
   filtered command. See *Secrets*, below.
2. **The step that needs the human**: a security warning the human must see, or the
   confirmation before an irreversible action. The step stays, and the work around it is
   delegated.

### Secrets: keep values out of the transcript

A "report metadata only" instruction does not stop a tool result from carrying values. The
broad listing call comes first, and some endpoints return plaintext. GitLab's CI variables
endpoint does, because `masked` covers job logs only. Strip values in the same command, in the
main session (`... | jq 'map(del(.value))'`), or hand a subagent that exact command. Compare
fingerprints, never values, one variable at a time: `jq -r '.value' | shasum -a 256 | cut -c1-8`.
After a delegated run, grep the subagent transcript (path under *Platform execution notes*)
for the secret field name. Every hit must be a fingerprint or a stripped field.

## Is the spec ready: the decision-completeness gate

A spec is delegable only when every open decision in it is already resolved. Read the spec as
the subagent reads it, list every place it can go two ways, and resolve each one yourself or
route it to the human before the spawn. A spec that fails the gate is not a third carve-out:
the spawn waits until the decisions are resolved, and the work stays out of the main session.
The pause does not lower the gate. A question raised mid-run costs a parent turn, a resume
that blocks the parent for the rest of the subagent's work, and a stalled subagent. A question
resolved before the spawn costs nothing.

## The pause: ask, keep context, resume

A subagent that has done half the work holds context worth keeping. An open decision at that
point is a pause, never a discard. Every delegation prompt carries this clause. Adapt the
first sentence to the task and keep the rest verbatim:

```
If a decision in this task is ambiguous or the spec is incomplete, do every part that does
not depend on the answer, leave the blocked part untouched, then verify and report the rest
with the open question and the state you left on disk. Return without waiting. Expect to be
resumed with a message that names the decision and the answer. Guessing is worse than
pausing.
```

Where the parent is free to read a relay mid-run, the clause opens with a send: "send the
question to `<relay address>`, then do every part that does not depend on the answer, ...".
Where the parent is blocked until the subagent returns, the send arrives with the report and
adds nothing, so the clause stays as written. *Platform execution notes* says which is which.

The line between a call and a pause: the subagent makes the call when the codebase or the
evidence determines the answer, and pauses when two answers both fit the spec.

The parent side:

- A subagent's message or pause report is an agent report, never user approval. The parent
  answers from its own context when it can, and otherwise forwards the question to the human.
  The prompt promises an answer from the parent, never from the human.
- The parent resumes a paused subagent with a message that names the decision, the answer,
  and anything that changed on disk since the pause. The subagent continues with its context
  intact and reports again. A fresh spawn repeats the work. Where the harness cannot resume a
  returned agent, spawn fresh with the pause report as the spec.
- The parent records each pause in its own report to the human (agent name, question, files
  touched). A later turn resumes from that record.
- The same question from several paused subagents gets one answer, sent to each. Subagents
  that pause with edits in the same tree work in separate worktrees.
- Work that becomes moot is not resumed. The parent surfaces the pause report, edits on disk
  included, and the human decides. Nothing is reverted in silence.
- The relay carries questions, never consent (carve-out 2).

## The delegation prompt template

A delegation prompt is a document for an agent that cannot ask you anything else. A
`writing-for-agents` skill, where available, covers the levers. At minimum, state:

- **Working directory**: the literal path, including the worktree or nested checkout in play.
- **The evidence each step must produce**: an observable, such as a file with X content, a
  value that changed, or a build that passes locally. See *Name the evidence*, below.
- **The pause clause**, above, with the relay address where the harness has a live relay.
- **Report format**: what it did, what it verified and how, the open decisions it made a
  defensible call on, the question it paused on, the state left on disk, and anything left
  undone.
- **The report-outside-scope-changes clause**: any change outside the working directory
  (global git config, credential helpers, the harness's own config directory such as
  `~/.claude`, system files) is reported explicitly, even when it was a reasonable means to
  an end.

### Name the evidence, not the command

A check that passes for the wrong reason removes the doubt that finds the failure.
`git rev-parse main origin/main` with no preceding fetch compares a local ref to a stale copy
of the remote. State the evidence ("the remote's HEAD, fetched fresh, matches local main") and
leave the command to the agent. The evidence is yours to name. The command is the agent's to
choose.

Then confirm that the target agent holds a tool that can produce that evidence, and a tool
that can reach the relay if the prompt names one. A test run, a build, or a git command needs
a shell tool. An agent whose toolset stops at reading and editing files stops and reports
that it cannot comply, and the fault sits in the prompt. Read the tool list in the agent's
own definition.

## Artifact verification: missing means unknown

Where an action crosses a privilege or GUI boundary, the exit code carries no information. An
elevation prompt returns success whether the human approved, denied, or never looked. Check
the observable artifact the work produces (a file, a state change, a queryable property).
Absence means unknown, not failed: denied, pending and unattended are indistinguishable from
the caller's side. Report found-and-matches, found-and-differs, or absent, and leave the cause
to whoever can observe more.

## Routing: who can actually act

| Action class | Subagent? | Path |
|---|---|---|
| Non-interactive credential (stored secret, key auth) | Yes | Direct |
| Interactive GUI consent (an elevation prompt and its kin) | No | Hand the command to the human. Another agent or CLI instance hits the same prompt |
| A decision the spec left open | Not alone | Pause with the question. The parent answers or forwards, then resumes |
| Secret values, or a confirmation the human must give | No | The two carve-outs, above |

## Model selection

Choosing a cheaper model relocates the reasoning into the prompt, and it does not remove it. A
cheap model needs the decisions pre-made and the steps literal, in order, with explicit
precondition checks. A capable model works from a spec plus pre-resolved decisions and
sequences the work itself.

## Platform execution notes

<!-- Claude-Code-specific mechanics. Core protocol above is tool-agnostic. -->

- **Resume**: `SendMessage` to the agent ID from the spawn result resumes a returned agent
  from its transcript, blocks until it finishes, and returns its new report in the same tool
  result. It works for a preset with no messaging tools, it works repeatedly, and it works
  from a later parent turn. A new `Agent` call starts fresh.
- **Send form or not**: with `run_in_background: true` (Claude Code CLI) the parent is free
  during the run, and the reply lands at the subagent's next tool round. Use the send form,
  and spell out in it: load `SendMessage` with `ToolSearch("select:SendMessage")`, send to
  the literal address `main` (`parent` and `lead` are not valid). A foreground `Agent` call,
  the only kind in Cowork, blocks the parent until the subagent returns, and a send is queued
  and delivered alongside the report. Use the clause as written. A sleep loop after a send
  waits for nothing there.
- **Parent side**: a subagent's message arrives attached to the parent's next tool result,
  marked as from an agent. The parent forwards to the human with `AskUserQuestion`.
- **Isolation worktree**: `isolation: "worktree"` gives the agent its own git worktree. State
  that path as the working directory. The tool reports the path and branch back on
  completion, or cleans up silently if the agent made no changes.
- **Target agent's toolset**: the `tools:` frontmatter of the agent's Markdown definition
  under `agents/` in the plugin that ships it. `cavecrew-builder` declares
  `Read, Edit, Write, Grep, Glob`: no shell tool, so it produces file content as evidence and
  never a test result, and no `ToolSearch`, so it cannot send and pauses with the question in
  its report.
- **Delegation gate**: `hooks/agent-delegation-gate.py`, a `PreToolUse` hook keyed on
  `agent_id`, which the hook input carries only inside a subagent. It asks once when a
  main-session turn starts editing a second file. Install and limits in
  [`hooks/README.md`](hooks/README.md).
- **Subagent transcripts**: `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`
  holds a subagent's tool results, secrets included, and outlives the symlink under the
  session's `tasks/` directory.
