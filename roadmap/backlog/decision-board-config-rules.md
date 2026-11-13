---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: regex rules in config that sync enforces

## Problem

`sync` checks the fixed schema and `link_hosts` only. A project cannot require a link of a
given shape on some cards, or ban a word from every card.

## Proposed approach

- Config `rules`: a list of checks that `sync` runs on each card. Every check is a regex,
  so one engine covers all cases:
  - `field`: the card field to test (`title`, `summary`, `evidence`, `links.url`, `tags`).
  - `match` or `forbid`: a regex that must, or must not, match.
  - `except`: an optional regex that clears a hit.
  - `when`: an optional scope by `source` or `tags`.
  - `message`: the text `sync` prints on a failure.
- `require_link` is not a separate kind. It is a `match` rule on `links.url`.
- The shipped config holds commented-out examples (as `_examples` or a JSONC file), for
  example a required link prefix per source and a banned word with an exception.
- The engine is public. The rule values live only in the operator's config.

## Notes

- The board is early alpha. The data model may change. No backward compatibility is needed.
- Related: `decision-board-config-layers`.

## Acceptance criteria

- [ ] `sync` refuses a card that breaks a rule and prints the rule message.
- [ ] The shipped examples pass a test when uncommented.
