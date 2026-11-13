---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: quick per-card controls

## Problem

A card takes one choice from its options plus a note, then Send. A plain "done", "later" or
"not mine" needs a pick per card. There is no owner, no snooze date, and no way to drop a
card for good or to ask the agent to close the source item.

## Proposed approach

Controls on top of the card kind. Config `controls` turns each one on. Every change goes
into the same batch as the answers.

- `assign`: a select. Default list `me`, `agent`, `other`. Config `people` adds names.
  `other` means "not ours": the card leaves the board and the agent stops tracking it.
- `snooze`: +1 day, +1 week, or a date. The card does not vanish: it stays in place for a
  short time, then folds into a slim snoozed row with its wake date. The interaction must
  feel quick and calm on a phone.
- `dismiss`: a switch in the style of a phone settings toggle. A permanent snooze. The
  card returns only when a new source input arrives, as if it were a new card.
- `close`: a switch. The agent closes the related item in the source tracker, then the card
  is dismissed. Only this switch lets the agent write to the source. A plain answer never
  does.
- `done`: a box in the card gutter.
- `tags`: toggle chips in the edit panel.

## Notes

- The board is early alpha. The data model may change. No backward compatibility is needed.
- Related: `decision-board-agent-status` (the result line shows what the agent did).

## Acceptance criteria

- [ ] Each control is off by default in the plugin defaults and on through config.
- [ ] `read` prints control changes as lines the agent can act on.
- [ ] A test covers dismiss and the return of a card on new source input.
