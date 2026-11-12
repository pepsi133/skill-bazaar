---
name: board-refresh
description: Refresh the cards of a decision board from outside sources, such as an issue tracker, a mail folder or a chat export. Use when the operator wants open items of a source shown as cards, when you refresh a board from those sources, or when you look for an item that two sources share. A script maps saved rows to a card file for the sync command of the decision-board skill; it fetches nothing itself.
---

# Board refresh

`R` is `scripts/refresh.mjs` beside this SKILL.md. It turns the rows of a source into a card file
for `node S sync --agent <name>` of the decision-board skill, which owns the board and every write.

## Refresh

1. **Fetch.** Get every page of each source with the operator's own tools (a CLI, an MCP server,
   an export file) and save the rows as JSON, for example `board/rows/tracker.json`. When the
   source states its total, compare it with your count and pass it as `--min-rows`. A CLI pages
   by default (`gh issue list` returns 30 rows and states no total): pass its own limit flag to
   fetch every row, or a short fetch closes cards a few at a time. Change no row
   by hand or by script: every change goes through the map or an override.
2. **Write the map** (next section), with the tag and priority ids of `board/config.json`.
3. **Map.** Run `node R map board/rows/tracker.json --map board/maps/tracker.json --source tracker
   --out board/tracker.json --config board/config.json`. It prints one line: rows, cards, dropped,
   skipped, unused overrides, and how many rows each rule matched. Why a row was skipped is in
   `board/tracker.json.details.json`. A skipped row, no rows, or fewer than `--min-rows` stops it,
   and it writes no card file. Pass `--allow-skipped` only once you know each skipped row.
4. **Cross-check.** Run `node R xref board/tracker.json board/mail.json ...`. Each line is a key
   (a ticket key such as `OPS-7` or a link URL) that cards of two or more files share. The script
   never merges. Record each decision as an override, for example `{"drop": true}` on the copy.
5. **Judge.** For what a map cannot decide, write `board/overrides/tracker.json`:
   `{"<card id>": {"priority": "now", "tags": [...], "summary": "...", "drop": true}}`. Copy the ids
   from the `--out` file; the raw key of the row works too. An override may set `priority`, `tags`,
   `summary`, `title`, `kind`, `options`, `recommendation`, `blocks`, `evidence`, `status`
   (`"closed"` only) and `drop` (`true` leaves the card out). It wins for the fields it names, and
   its `tags` replace those of the map. Map again with `--overrides <file>`.
6. **Sync.** Run `node S sync <file> --source <s> ... --agent <name>` as the decision-board skill
   says. If it refuses to close cards (a source with no open card, or over half of its open cards
   closing), check the fetch first; add `--allow-close` only when those closes are real.
   A card closed with `close` or `ack --close` stays closed until its content changes. A card
   closed on the page reopens while its row stays open; `"status": "closed"` keeps it closed.

## The map file

One map per source. It is the operator's own file: keep it in `board/`, never in a repository.
Each value names a row field. A dotted name reaches into an object (`author.login`) and over a
list (`labels.name` on `[{"name": "a"}]` gives `["a"]`).

```json
{"key": "iid", "title": "title", "url": "web_url", "created": "created_at", "who": "author.login",
 "closed": {"field": "state", "equals": ["closed", "resolved"]},
 "tags": [{"field": "labels.name", "equals": "security", "tag": "security"}]}
```

`key`, `title`, `url` and `created` are required; `who`, `kind` (default `action`; a `decision`
needs `options` from an override, else the row is skipped), `closed`,
`tags` and `rows` (the field that holds the list when the export wraps it) are optional. A rule
matches when the field, or an element of it, equals a value, case ignored. `created` takes a date,
an ISO timestamp or epoch seconds or milliseconds. The url must be `https:` on a host of
`link_hosts`, for an issue tracker on `tracker.example.com` that host or `example.com`.

The card id is `<source>-<key>`, stable across runs (a key outside the id characters gets a short
hash). The link label is `<source> <key>`.

## Never guess a missing field

A row without a key, url or title, with a bad or future date, or open without a date, is skipped
with its reason; the script never invents a link, a date or an id. Find the row in the source; if
the source lacks the field, tell the operator. A row left out of a `--source` sync closes its card.
