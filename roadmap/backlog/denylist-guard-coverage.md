---
type: skill
proposed_by: pepsi133
created: 2026-10-11
---

# Static analysis controls: a denylist guard covers only what it lists

## Problem

A repository hygiene guard built from a denylist proves one thing: the listed values
are absent. It says nothing about values of the same shape that nobody listed. A real
device serial or a real GUID, copied from live output into a test fixture, passes such
a guard for as long as nobody adds it to the list. The green result reads as a clean
sweep when it is not one.

## Proposed approach

Add one short rule, a paragraph and one table row, to the `static-analysis-controls`
skill:

- A denylist guard is a positive control for the listed values only.
- Before a push, also sweep by shape over all history: 32-hex serials, GUIDs, device
  instance-ID tails, addresses outside the documentation ranges.
- When a fixture is copied from live output, either add its identifiers to the
  denylist or replace them with fabricated values.

## Notes

The skill already teaches positive controls and asking what a search actually read.
This is the same failure seen from the guard's side. Check first that the skill does
not already state it.

## Acceptance criteria

- [ ] `SKILL.md` states the rule in one paragraph and one table row.
- [ ] The description still fits the 1024-character cap.
- [ ] `python3 scripts/validate-skills.py` passes.
- [ ] The plugin version is bumped.
