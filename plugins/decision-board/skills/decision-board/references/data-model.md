# Data model

Read this before you publish a board, write `board/config.json`, or change the page.

## Access rules

Publish the page with these `capabilities`:

```json
{"db": {"rules": [
  {"path": "", "read": "view", "write": "owner"},
  {"path": "cards", "read": "view", "write": "interact"},
  {"path": "guides", "read": "view", "write": "interact"},
  {"path": "acks", "read": "view", "write": "interact"},
  {"path": "responses", "read": "view", "write": "owner"},
  {"path": "batches", "read": "view", "write": "owner"},
  {"path": "notes", "read": "view", "write": "owner"},
  {"path": "meta", "read": "view", "write": "owner"}]}}
```

So an agent can write cards, guides and acks, but not answers or batches, and the operator (the
owner) writes the rest. The rules protect only against an agent that writes under its own
claude.ai identity at the Contributor level; an agent that writes through the operator's session
has the operator's level, so write `meta/config` (the `check` write) from the operator's session. The rules do not
separate agents from each other: any agent can write any card document, guide or ack.

## The config

`board/config.json` is the one source of the board config. `node S check` reports the entries that
the page would drop and prints the write of `meta/config` from it; `sync` checks cards against it.
Every field but `link_hosts` is optional: `sync` refuses every card until `link_hosts` lists a host.
A missing or invalid field keeps its default. Lists keep their first 50 entries. The page reads
`meta/config` live, so a change shows without a republish.

| Field | Value | Default |
|---|---|---|
| `title` | The header and the browser tab title | "Decision board" |
| `agent` | The name of the default agent: "Send to <agent>", and the agent of a free note | `Claude` |
| `tabs` | A list of `{id, label, match, rest}` | the All tab only |
| `priorities` | A list of `{id, label}` in sort order. The first three get the red, amber and grey tag | `now`, `soon`, `later` |
| `link_hosts` | Required before the first card. Hosts that the `links` of a card can point to, by `https:`, with the host rules below. Every card needs a link to one of them. It does not open hosts to reference guides | none |
| `tags` | A list of `{id, label}` that cards name in `tags`. The page shows the label, or the id without one | none |
| `domains` | Hosts that a reference guide can load from by `https:`, for example `["docs.example.com"]`, with the host rules below. Only the operator adds a host | none |

Host rules, for `link_hosts` and `domains`: a host has at least one dot, and matches itself and its
subdomains, on any port. An entry of digits and dots must be a full IPv4 address, and matches only
itself. A two-label entry whose two labels both have one or two characters, such as `co.uk`, is
dropped as a public suffix. Name the full host, never a public suffix.

A tab: `id` is unique, not `all`, and does not start with `guide:`. `match` holds `source`, a list
of sources (matched after trim and lower case), and `tags`, a list of tag ids (matched exactly).
`rest: true` takes every card that no other tab takes. A card belongs to one tab besides All: the
first tab whose `match.source` lists its `source`, else the first tab whose `match.tags` lists one
of its tags, else the first `rest` tab, else All only.

Example:

```json
{"title": "Lab network", "agent": "Coordinator", "link_hosts": ["wiki.example.com"], "tags": [{"id": "cost", "label": "Costs money"}],
 "tabs": [{"id": "router", "label": "Router", "match": {"source": ["router", "wifi"]}},
  {"id": "cost", "label": "Costs", "match": {"tags": ["cost"]}}, {"id": "other", "label": "Other", "rest": true}]}
```

## The state file

`board/state.json` is the truth for one agent's cards, and only the script writes it. `agent` is
the agent key, set once by `check --agent`. `cards` is the full card list. `next` maps `cards`,
`guides/<id>` and `meta/config` to the version that the next write of that document pins: 1 after
a create, N + 1 after a write pinned to N; without an entry the write is a create. `pending` holds
the last write of each, of each `acks/<id>` (with the cards write of its `--close`) and the deletes
of each `purge/<stamp>`, for `push` and `adopt`. `refreshed` is the time of the last `sync` that
wrote. `purge` lists the cards a purge took off the board; they stay until `adopt` sees them gone.
`held` lists the cards that `close` or `ack --close` closed: `sync` keeps them closed until their
content changes. `unlogged` holds the `decisions.md` lines of an ack that the board does not show
yet. One state file per agent key, and `check` refuses a second one with the same key in a folder.
Each write points at a file in `out/` named by a hash of its content.

A batch waits for an agent when its `for` is the agent key and no `acks/<batch id>` exists. No
clock decides it, so a batch from a phone with a wrong clock still waits.

## Collections

`SCHEMA` in `assets/board.html` is the full field list. The page reads every value through a type
check, so a wrong type shows as empty, never as a broken board.

| Collection | Doc id | Written by | Content |
|---|---|---|---|
| `cards` | agent key | agents (the script) | `cards`: that agent's list, the fields of `references/cards.md` with `rev`, `created`, `updated`; `refreshed`: the time of its last sync, which the page shows |
| `guides` | `<agent key>.<id>` | agents (`guide`); the page sets `status` and shows the newest status guide of each agent | `kind`, `title`, `sections: [{id, title, body, updated}]`, `body` (older guides), `status`, `item` (a card key) |
| `responses` | card key | the page | The draft answer: `choice`, `note`, `rev`, `for`, `sent`, `batch`, and `history`, the earlier sent answers |
| `notes` | `n<stamp>-<4>` | the page | A free note: `text`, `item`, `for`, `sent`, `batch` |
| `batches` | `b<stamp>-<4>` | the page | `for`, `itemIds`, `noteIds`, `answers: {<card key>: {answer, note, rev}}`, `notes: {<note id>: {text, item}}`, `created` |
| `acks` | batch id | agents (`ack`) | `at`, `items`. The page shows the batch as handled. A batch of an older page counts as handled when its `status` is `done` or `delivered` |
| `meta` | `config` | the operator | See above. `meta/board` of an older board gives only a fallback title |

An agent key is the agent name in lower case: 1 to 40 of `a-z 0-9 _ - ~ @ +`, never `:` or `.`. The
page merges the documents of `cards`, and a card's key is `<agent key>:<card id>`, so two agents
can use one card id. The page leaves out a document whose id is no agent key, a card without a
valid id, and a second card with the same id in one document.

## What the page writes

- A response on an option tap, or 700 ms after typing stops. The response stores `for`, the agent
  key of the card, and the `rev`. A tap on the checked option of a changed card is a new answer.
- On Send: for each agent, first `batches/<id>` with a copy of every answer and note, then each
  response and note marked `sent`. An answer that changed during the send stays unsent. Send skips
  a card that is missing or closed, and a draft for an older `rev`. Send is off until the cards
  have loaded.
- A note without an option, on a card with options, is a question: the card shows "waiting on
  agent" until the agent posts a new `rev`.
- A guide's `status` and `updated` on Archive and Reopen. It never writes `cards`, `acks` or `meta`.
