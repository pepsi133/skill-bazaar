---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: layered config with a private user file

## Problem

All settings sit in one `board/config.json` per board. Settings that belong to one machine
or one employer (hosts, people, rules, groups) cannot live apart from the board, and the
public plugin has nowhere to keep a shared default.

## Proposed approach

`check` merges these layers, later ones win:

1. plugin defaults
2. a user file outside any repository, for example `~/.config/decision-board/config.json`
3. `board/config.json`
4. an optional `board/config.local.json`

Lists replace by default. A key with a `+` prefix appends. `check` prints the source layer
of each value.

## Notes

- The board is early alpha. The data model may change. No backward compatibility is needed. Rename or move config keys freely.
- The public repository holds only generic defaults and examples.

## Acceptance criteria

- [ ] `check` shows the merged config and the layer of each value.
- [ ] A test covers replace and append.
