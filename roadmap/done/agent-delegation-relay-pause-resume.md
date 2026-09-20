---
type: skill
proposed_by: pepsi133
created: 2026-09-17
---

# Agent delegation: make the relay the default, and make the stop a pause

## Problem

The `agent-delegation` skill (version 0.5.1) treated the parent channel as an opt-in "ask and
continue" variant behind three conditions, and its default clause told the subagent to stop
and return the question. A stop threw away the subagent's context. The skill also said
nothing about the parent continuing a returned subagent instead of spawning a fresh one, and
nothing about what happens to the partial edits of a subagent nobody resumes.

## Decisions recorded

**D1. Pause and resume is the default. The mid-run send is an addition for background
spawns.** A foreground `Agent` call blocks the parent, so a send during the run is queued and
arrives with the report it duplicates. The clause pauses by default and gains a send sentence
only where the platform note says the parent is free.

**D2. Active waiting (a sleep loop after the send) is set aside.** It works only with a free
parent and a subagent that has a shell. The pause needs neither.

**D3. Which questions the parent forwards to the human is the parent's judgment.** The skill
fixes only that a subagent's message is never treated as approval.

**D4. Abandoned partial edits stay in place and are reported.** Nothing is reverted in
silence. Worktree isolation is the recommended container.

**D5. `README.md` is for the human and is not pointed at from `SKILL.md`**, so it costs no
context at use time. Measured runs live here, and the README keeps the undated harness facts.

## Runs

Measured on a Cowork cloud session (Claude Code Agent tool, foreground calls,
general-purpose subagents and the `cavecrew-builder` preset). Three subagents, five resumes.

| Subagent | Setup | Observed |
|---|---|---|
| alpha (general-purpose) | Pause clause. Task with one open decision. | Loaded `SendMessage` via `ToolSearch`, sent to `main` (result: "Message queued for the main conversation's next turn"), did the unblocked part, returned with the question open. |
| bravo (general-purpose) | Same, plus a sleep loop: `sleep 20` up to six times. | All six sleeps ran (134 s wall). Nothing arrived during any of them. Returned with the question open. |
| charlie (`cavecrew-builder`) | Same task. Tools: Read, Edit, Write, Grep, Glob. | No `SendMessage`, no `ToolSearch`, no `Bash`. Send not possible. Returned the question in its report without writing anything. |

Both queued messages from alpha and bravo reached the parent attached to the `Agent` tool
results, in the same turn as the reports.

Resumes, each a `SendMessage` from the parent to the agent ID:

| Resume | Observed |
|---|---|
| alpha, first | The call blocked until the agent finished and returned its new report inline. The agent wrote the blocked file and, asked to prove it, reported the earlier file's content without re-reading it. Its transcript confirms: no read of that file after the resume, only an `ls -la` for existence. |
| bravo | Same. The agent reported its earlier sleep count from memory. The answer had arrived, in its words, "as a new user-turn message beginning with 'The coordinator sent a message while you were working'", not attached to any tool result during the loop. |
| charlie | Resumed with the answer despite having no messaging tool. Wrote the file and reported in one line. |
| alpha, second | A new task with a new open decision. The agent sent, found nothing to continue with, paused again, still recalling the codename from the first round. |
| alpha, third | The answer. The agent finished and reported. |
| charlie, later turn | Resumed from a later parent turn, after other work. Reported its earlier write from memory without reading. |

Artifacts on disk after the runs: every expected file, with the expected content, and
nothing guessed.

Not measured: a background spawn on this harness (the `Agent` tool here has no
`run_in_background`), a resume after a session restart or a compaction, an unattended parent,
agent teams. The earlier Claude Code CLI measurement (background spawn, reply delivered at the
subagent's next tool round) stands as recorded in the skill's previous version.
