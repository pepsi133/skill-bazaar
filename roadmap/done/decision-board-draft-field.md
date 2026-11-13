---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: a draft field that holds only the text to paste

## Problem

A draft (a reply, a prompt, a message) goes in a fenced block inside `summary`, with lines
under 40 characters. Long drafts wrap badly. Agents also put a preface, notes or approval
lines inside the block, so Copy copies text the operator must cut by hand.

## Proposed approach

- An optional `draft` field: the raw text only, ready to paste. Nothing else.
- Anything the agent wants to add (where it goes, why, caveats) goes in `summary`.
- An optional `draft_label` names the target, for example "Reply in the thread".
- The page wraps the text and Copy copies the field exactly.
- `sync` warns when a draft starts with a label such as `DRAFT` or `Note:`.

## Notes

The board is early alpha. The data model may change. No backward compatibility is needed.

## Acceptance criteria

- [ ] Copy copies the field byte for byte.
- [ ] `references/cards.md` states the raw-text rule.
