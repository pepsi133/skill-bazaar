# Data model

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

An agent writing under its own claude.ai identity (Contributor) can write cards, guides and acks;
only the owner writes answers, batches and `meta`. An agent in the operator's session has the
owner's level. So write `meta/config` (the `check` write) from
the operator's session. The rules do not separate agents: any agent can write any card document,
guide or ack.

## The config

`board/config.json` is the one source of the board config: `check` writes it to `meta/config`, and
`sync` checks cards against it. Every field but `link_hosts` is optional, and a missing or invalid
field keeps its default. Lists keep their first 50 entries. The page reads `meta/config` live, so a
change shows without a republish.

| Field | Value | Default |
|---|---|---|
| `title` | The header and the browser tab title | "Decision board" |
| `agent` | The default agent: "Send to <agent>", and the agent of a free note | `Claude` |
| `tabs` | A list of `{id, label, match, rest}` | the All tab only |
| `priorities` | A list of `{id, label}` in sort order. The first three get the red, amber and grey tag | `now`, `soon`, `later` |
| `link_hosts` | Required before the first card. The hosts card `links` may point to by `https:` | none |
| `tags` | A list of `{id, label}` that cards name in `tags` | none |
| `domains` | Hosts a reference guide may load from by `https:`, for example `["docs.example.com"]`. Only the operator adds a host | none |

An agent key is the agent name in lower case: 1 to 40 of `a-z 0-9 _ - ~ @ +`. A card's key on the
board is `<agent key>:<card id>`, so two agents can use one card id.

Host rules, for `link_hosts` and `domains`: a host has at least one dot and matches itself and its
subdomains, on any port. An entry of digits and dots must be a full IPv4 address and matches only
itself. A two-label entry of two short labels, such as `co.uk`, is dropped as a public suffix: name
the full host.

A tab: `id` is unique, not `all`, and does not start with `guide:`. `match` holds `source`, a list
of sources (matched after trim and lower case), and `tags`, a list of tag ids (matched exactly).
`rest: true` takes every card no other tab takes. A card belongs to one tab besides All: the first
tab whose `match.source` lists its `source`, else the first whose `match.tags` lists one of its tags,
else the first `rest` tab, else All only.

```json
{"title": "Lab network", "agent": "Coordinator", "link_hosts": ["wiki.example.com"], "tags": [{"id": "cost", "label": "Costs money"}],
 "tabs": [{"id": "router", "label": "Router", "match": {"source": ["router", "wifi"]}},
  {"id": "cost", "label": "Costs", "match": {"tags": ["cost"]}}, {"id": "other", "label": "Other", "rest": true}]}
```

## Collections

`SCHEMA` in `assets/board.html` is the full field list.

| Collection | Doc id | Written by | Content |
|---|---|---|---|
| `cards` | agent key | agents (`sync`) | That agent's card list and the time of its last sync |
| `guides` | `<agent key>.<id>` | agents (`guide`); the page sets `status` | Kind, title, sections, status, linked card |
| `responses` | card key | the page | The draft answer, with the earlier sent answers in `history` |
| `notes` | `n<stamp>-<4>` | the page | A free note |
| `batches` | `b<stamp>-<4>` | the page, on Send | `for` (an agent key), and a copy of each answer and note |
| `acks` | batch id | agents (`ack`) | Marks the batch handled |
| `meta` | `config` | the operator | The config above |
