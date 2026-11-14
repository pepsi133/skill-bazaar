---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: operator rules in prose that the agent keeps

## Problem

Many judgments are specific to one operator: which alerts matter, which teams own what,
what counts as noise. The plugin has no place for them, so each project invents its own
file, or the agent asks again.

## Proposed approach

- A `board/rules.md` file in prose, one topic per section. The agent reads it before each
  refresh and each read.
- After install, the agent offers to start it: it asks the operator a few questions, or
  drafts rules from what it already knows, and posts each one as a card for review.
- A new rule from an operator note becomes a card ("Add this rule?") before it lands in
  the file.
- Optional: show the file as a guide tab, read-only.

## Notes

The board is early alpha. The data model may change. No backward compatibility is needed.

## Acceptance criteria

- [ ] `SKILL.md` names the file and when to read it.
- [ ] The install flow offers to start it, and every rule passes through a card.
