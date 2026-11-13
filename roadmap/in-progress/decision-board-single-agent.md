---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: one board, one agent

## Problem

The board supports several agents: agent keys, one card document per agent, `for` on
batches, card keys `<agent>:<id>`, `adopt` across agents, and access rules that do not
separate agents anyway. In real use one operator runs one board with one agent. The extra
parts cost text in `SKILL.md`, a flag on every command, and test surface.

## Proposed approach

- One `cards` document. No `--agent` flag. The card key is the card id.
- Batches lose `for`. `adopt` keeps only the lost-reply and refused-write cases.
- Remove the multi-agent text from `SKILL.md` and `references/`.
- Git history keeps the old code. Bring it back only when a second agent is real.

## Notes

The board is early alpha. The data model may change. No backward compatibility is needed.

## Acceptance criteria

- [ ] No command takes `--agent`.
- [ ] Tests pass with the single-agent model, and loss tests still cover lost and refused writes.
