---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: fewer and smaller reads per watcher tick

## Problem

Each watcher tick dumps every batch for the agent and the whole `acks` collection, then runs
`waiting`. The cost grows with the history until a purge.

## Proposed approach

- The page sets `status: "sent"` on a new batch. `ack` sets `status: "handled"`.
- The watcher queries `status == "sent"` only: one small query per tick, no acks dump.
- The watcher brief names a cheap model.
- `read` prints only unhandled lines by default.

## Notes

The board is early alpha. The data model may change. No backward compatibility is needed.

## Acceptance criteria

- [ ] One tick makes one database call when nothing waits.
- [ ] Tests cover a batch that is sent, handled, and sent again.
