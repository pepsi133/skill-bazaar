---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: a custom close action per source

## Status

Parked. Today the agent picks the operator's own tool for a source and closes the item
(see `decision-board-item-controls`).

## Problem

"Close" does not mean the same thing in every source. One tracker needs a transition
name, another a resolution, a third a comment before the close. The agent decides that
again on every close, which costs tokens and can go wrong on a small model.

## Proposed approach

- A config key in the user file, one entry per source, with the exact command and a
  placeholder for the item key, for example `"close_with": {"tracker": "<cli> close {key}"}`.
- When a source has an entry, the agent runs exactly that command and nothing else. When a
  source has none, the present behaviour stays.
- `read` prints the finished command on the close line, so the agent composes nothing.

## Open questions

- Whether an entry may hold more than one step, for example a comment and then a close.
- Whether the same key can describe other actions later, such as "reassign".
