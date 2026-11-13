---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: configurable wake-up (poll, comment, both, off)

## Problem

The agent learns about new answers only from a background watcher that polls every 120 s
until a poll limit. Each tick is an agent turn with two database calls and one script call.
An idle board still costs tokens, and the interval and the limit are fixed in the brief.

A comment wake costs nothing while idle, but it has failed in practice. One cause was prose
only: the agent judged a comment by its text and its time stamp and did not read the
database, so it dropped a real batch. No mechanism forced the read.

## Proposed approach

- Config `wake`: `mode` (`poll`, `comment`, `both`, `off`), `poll_seconds`, `poll_limit`.
  The watcher brief reads these values.
- `comment`: Send opens the claude.ai comment box with a fixed text, for example
  `@claude read`. A session that watches the artifact wakes on it.
- `both`: comment first, plus a slow fallback poll (for example every 30 min) for a missed
  comment. This is the default.
- `off`: the operator says "read the board" in the terminal.
- A comment never carries the answer. On every comment wake the agent runs the full read
  (`P4`, acks, `read`) whatever the comment says or when it was stamped.
- Check whether a Claude Code hook can enforce the read, for example a hook that injects
  the read step when an artifact comment arrives. If no hook event fits, keep it as one
  hard rule in `SKILL.md` and a test of the brief.

## Notes

- The board is early alpha. The data model may change. No backward compatibility is needed.
- Related: `decision-board-cheap-reads`, `decision-board-time-zone`.

## Acceptance criteria

- [ ] Each mode works from config, with no edit to the brief.
- [ ] A comment wake always ends in a full read, shown by a test or a hook.
- [ ] The README states the token cost of each mode.
