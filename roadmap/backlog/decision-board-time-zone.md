---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: time stamps with an offset in the operator's zone

## Problem

Stamps are UTC. An agent compared a UTC comment stamp with a local refresh time and dropped
a real batch.

## Proposed approach

- Config `tz`, for example an IANA zone name.
- The page and the script write every stamp as ISO 8601 with the offset of that zone, for
  example `2026-11-13T13:31:08+01:00`. The offset travels with the value, so the agent reads
  local time and can still compare stamps exactly.
- `read` and the page print local times.

## Notes

- The board is early alpha. The data model may change. No backward compatibility is needed.
- Platform stamps (comment times) stay UTC. The rule in `SKILL.md`: convert before any
  compare, and never decide from a stamp alone (see `decision-board-wake-modes`).

## Acceptance criteria

- [ ] Every stamp the plugin writes has an offset.
- [ ] A test compares stamps across a DST change.
