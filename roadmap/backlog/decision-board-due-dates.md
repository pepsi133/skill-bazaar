---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: due dates and a Due today strip

## Problem

A card has `first_asked` only. A deadline (a form, a review, a renewal) looks like any
other card.

## Proposed approach

- An optional `due` date on a card.
- Cards due today or overdue also show in a highlighted strip at the top. The strip links
  to each card and holds no copy.
- `sort` and `groups` can use `due`.

## Notes

The board is early alpha. The data model may change. No backward compatibility is needed.

## Acceptance criteria

- [ ] The strip shows only cards due today or earlier.
- [ ] A test covers a card that becomes due overnight.
