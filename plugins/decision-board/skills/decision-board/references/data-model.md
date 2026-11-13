# Data model

## Access rules

Publish the page with these `capabilities`:

```json
{"db": {"rules": [{"path": "", "read": "view", "write": "owner"}]}}
```

Only the owner writes. Run the agent in the operator's own session: its ArtifactData calls write as the
owner. A viewer reads the board and writes nothing.

## The config

`board/config.json` is the one source of the board config: `check` writes it to `meta/config`, and
`sync` checks cards against it. Every field but `link_hosts` is optional, and a missing or invalid
field keeps its default. Lists keep their first 50 entries. The page reads `meta/config` live, so a
change shows without a republish.

| Field | Value | Default |
|---|---|---|
| `title` | The header and the browser tab title | "Decision board" |
| `tz` | The operator's time zone: an IANA name such as `Europe/Warsaw`, or `UTC`. Every time the script and the page write carries its offset; the page and `read` show times in it, and the page footer names it | `Europe/Warsaw` |
| `agent` | The name on the Send button and in the note box | `Claude` |
| `tabs` | A list of `{id, label, match, rest}` | the All tab only |
| `priorities` | A list of `{id, label}` in sort order. The first three get the red, amber and grey tag | `now`, `soon`, `later` |
| `link_hosts` | Required before the first card. The hosts card `links` may point to by `https:` | none |
| `tags` | A list of `{id, label}` that cards name in `tags` | none |
| `domains` | Hosts a reference guide may load from by `https:`, for example `["docs.example.com"]`. Only the operator adds a host | none |

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
{"title": "Lab network", "tz": "Europe/Warsaw", "agent": "Coordinator", "link_hosts": ["wiki.example.com"], "tags": [{"id": "cost", "label": "Costs money"}],
 "tabs": [{"id": "router", "label": "Router", "match": {"source": ["router", "wifi"]}},
  {"id": "cost", "label": "Costs", "match": {"tags": ["cost"]}}, {"id": "other", "label": "Other", "rest": true}]}
```

## Collections

`SCHEMA` in `assets/board.html` is the full field list.

| Collection | Doc id | Written by | Content |
|---|---|---|---|
| `cards` | `main` (the only document; `SCHEMA.cardsDoc`) | the agent: `sync`, `close`, `ack --close`, `purge`, `adopt` | `{cards: [item], refreshed: stamp or ""}` |
| `guides` | the guide id (`--id`), any id of `SCHEMA.idRe` | the agent: `guide`; the page sets `status` and `updated` | kind, title, sections, status, linked card id in `item` |
| `responses` | the card id | the page | the draft answer, with the earlier sent answers in `history` |
| `notes` | `n<compact stamp>-<4 chars>` | the page | a free note |
| `batches` | `b<compact stamp>-<4 chars>` | the page creates it with `status: "sent"`; the agent's `ack` sets `status: "handled"` and `handled_at` | a copy of each answer and note |
| `meta` | `config` | the agent: `check` | the config. (`meta/board` is still read for the title fallback; nothing writes it.) |

A batch has `status` "sent" until `ack` sets "handled" and `handled_at`.
