---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: configurable groups and sort order

## Problem

Tabs split cards by source or tag. Inside a tab the sort is priority, then posted time, and
it is hardcoded. The oldest request cannot come first, and one page cannot show ordered
sections.

## Proposed approach

- Config `groups`: ordered sections on one page. Each has a `label` and a `match`
  (priority, tags, source, kind, due). A card goes to the first group that matches.
- Config `sort`: a key list, for example `["priority", "first_asked", "id"]`.
- On a wide screen, a side list of groups with counts.
- Default groups:
  1. Alerts and incidents
  2. Now: blocked on a human
  3. This week
  4. Next week
  5. Backlog
  6. Done

## Notes

The board is early alpha. The data model may change. No backward compatibility is needed.

## Acceptance criteria

- [ ] A config with no `groups` shows the defaults.
- [ ] Page tests cover group match order and each sort key.
