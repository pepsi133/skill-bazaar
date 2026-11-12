# Data model

Read this before you publish a board, write `meta/config`, or change the page.

## Access rules

Publish the page with these `capabilities`:

```json
{"db": {"rules": [
  {"path": "", "read": "view", "write": "owner"},
  {"path": "items", "read": "view", "write": "interact"},
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
has the operator's level, so write `meta/config` from the operator's session.

## The config document

`meta/config` sets up the board. Every field is optional, and a missing or invalid field keeps its
default. Lists keep their first 50 entries. The page reads the document live, so a change shows
without a republish. `node S check` reports the entries that the page drops.

| Field | Value | Default |
|---|---|---|
| `title` | The header and the browser tab title | "Decision board" |
| `agent` | The name of the default agent: "Send to <agent>". A card whose `from` is this name goes to the default agent | `Claude` |
| `tabs` | A list of `{id, label, match, rest}`. `[]` leaves only the All tab | Email, GitHub, Other |
| `kinds` | A list of `{id, label, options}`. The first is the default kind. Without `options`, a built-in kind keeps its own | `decision`, `action`, `info` |
| `priorities` | A list of `{id, label}` in sort order. The first three get the red, amber and grey tag | `now`, `soon`, `later` |
| `labels` | The section labels that the formatter sets in bold | `Before`, `Now`, `Suggested`, `Why`, `Risk`, `Your answer` |
| `domains` | Hosts that a reference guide can load from by `https:`, for example `["docs.example.com"]`. A host also matches its subdomains. Only the operator adds a host | none |

A tab: `id` is unique, not `all`, and does not start with `guide:`. `match` maps a card field to a
list of values, for example `{"area": ["router", "wifi"]}`. Values match after trim and lower
case. `rest: true` takes every card that no other tab takes. A card belongs to one tab besides All:
the first tab whose `match.source` lists its `source`, else the first tab that matches another
field, else the first `rest` tab, else All only. A `tabs` list whose every entry is invalid keeps
the default tabs.

Examples:

```json
{"title": "Lab network", "tabs": [{"id": "router", "label": "Router", "match": {"area": ["router", "wifi"]}},
  {"id": "other", "label": "Other", "rest": true}]}
```

```json
{"title": "Agents", "agent": "Coordinator",
 "tabs": [{"id": "mail", "label": "Mail agent", "match": {"from": ["mail-agent"]}}, {"id": "mine", "label": "Coordinator", "rest": true}],
 "kinds": [{"id": "decision"}, {"id": "action"}, {"id": "info"}, {"id": "digest", "label": "Digest", "options": ["Read"]}]}
```

## Collections

`SCHEMA` in `assets/board.html` is the full field list. The page reads every value through a type
check, so a wrong type shows as empty, never as a broken board.

| Collection | Doc id | Written by | Content |
|---|---|---|---|
| `items` | card id | agents (`cards`) | The card fields of `references/cards.md`, and `rev`, `created`, `updated` |
| `guides` | guide id | agents (`guide`); the page sets `status` | `kind`, `title`, `sections: [{id, title, body, updated}]`, `body` (older guides), `status`, `item` |
| `responses` | card id | the page | The draft answer: `choice`, `note`, `rev`, `for`, `sent`, `batch`, and `history`, the earlier sent answers |
| `notes` | `n<stamp>-<4>` | the page | A free note: `text`, `item`, `for`, `sent`, `batch` |
| `batches` | `b<stamp>-<4>` | the page | `for`, `itemIds`, `noteIds`, `answers: {<card id>: {answer, note, rev}}`, `notes: {<note id>: {text, item}}`, `created` |
| `acks` | batch id | agents (`ack`) | `at`, `items`. The page shows the batch as handled. A batch of an older page counts as handled when its `status` is `done` or `delivered` |
| `meta` | `config` | the operator | See above. `meta/board` of an older board gives only a fallback title |

## What the page writes

- A response on an option tap, or 700 ms after typing stops. The response stores `for`, the agent
  of the card at that moment, and the `rev`. A tap on the checked option of a changed card is a
  new answer.
- On Send: for each agent, first `batches/<id>` with a copy of every answer and note, then each
  response and note marked `sent`. An answer that changed during the send stays unsent. Send skips
  a card that is missing or closed, and a draft for an older `rev`. Send is off until the cards
  have loaded.
- A note without an option, on a card with options, is a question: the card shows "waiting on
  agent" until the agent posts a new `rev`.
- A guide's `status` and `updated` on Archive and Reopen. It never writes `items`, `acks` or `meta`.
