---
type: skill
proposed_by: pepsi133
created: 2026-11-11
---

# Decision board: show the current work of the agent

## Problem

The operator answers the board in batches, often hours apart. Between two batches the
board shows questions and nothing about what the agent does. To learn that, the operator
opens the agent session and asks. That costs a context switch for the operator and a
turn for the agent.

The board has one field that is near this, `meta/board.updated`, and it says only when
the data changed.

## Proposed approach

A "Now" strip under the header, fed by one small document. Not built yet.

- One document, `meta/status`. Fields: `now` (one line, the major task in progress),
  `next` (array of up to three lines), `waiting` (one line, what the agent waits for, or
  `""`), `updated` (ISO 8601 UTC), `agent` (a short name, for boards with several agents).
- The agent writes it with one `set` call when a major task starts or ends. It is one
  write of under 500 bytes, with no read first, because the document has one writer. The
  rule in `SKILL.md` is one line: write the status when the answer to "what are you doing"
  changes, never for a step inside a task.
- The page reads the document with the snapshot it already holds on `meta`, and shows
  `now`, the age of `updated`, and `next` behind a tap. The page never writes it.
- Staleness is the main risk: a status that says "building X" hours after the agent
  stopped is worse than no status. The page greys the strip after a set age, for example
  30 minutes, and shows "last heard 2 h ago". The agent writes `now: "idle"` with a filled
  `waiting` when it stops for the operator.
- Major tasks only. A history is out of scope for the first version. If it is wanted
  later, a `log` collection with one document per finished task, capped by the page at the
  newest 20, is the cheap form.

Alternatives:

- A card per task in `items`. Rejected: it mixes status with questions, and each task
  costs two writes and a `meta` count update.
- Reuse `notes`. Rejected: the page owns that collection, and a note is the operator's
  word to the agent.
- Several agents on one board: one document per agent, `status/<agent>`, in place of
  `meta/status`. Decide this before the first build, because it changes the path.

## Open questions

- Whether the watcher agent can write a heartbeat into the same document, so that the
  strip also shows that the answer channel is alive.
- Whether the strip belongs above or below "Blocked on you" on a phone.
