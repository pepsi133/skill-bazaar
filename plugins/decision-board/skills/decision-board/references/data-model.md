# Data model

## Access rules

Publish the page with these `capabilities`:

```json
{"db": {"rules": [{"path": "", "read": "view", "write": "owner"}]}, "comments": {}}
```

Only the owner writes. Run the agent in the operator's own session: its ArtifactData calls write as the
owner. A viewer reads the board and writes nothing.

`comments` lets Send post the short wake comment to Claude; the page asks the operator once.

## The config

`check` merges four layers, later ones win: the defaults in the table below; the user file
`~/.config/decision-board/config.json` (`$XDG_CONFIG_HOME/decision-board/config.json` when that is set;
`BOARD_USER_CONFIG` names another file, as an absolute path or one that starts with `~/`, `""` turns it off); `.board/config.json`; `.board/config.local.json`.
Keep private values that hold for every board on the machine (the time zone, the week start, hosts, tags, checks, names of
people) in the user file, outside every repository. Each layer is optional, but one must exist.

- An object merges key by key; a text or a list replaces. `"+tags": [...]` appends to the earlier list,
  and an appended entry with the `id` of an earlier one replaces it in place. `null` removes a key. A key
  that starts with `_` is a comment.
- `check` prints the layer of each key and the tag and priority ids. It writes the merged keys to `meta/config`
  (script-only keys stay off; `settings`, the footer line that names the layer files, is added) and the full
  merged config with its defaults to `.board/config.merged.json` (`checks` stay off), which
  `refresh.mjs map --config` reads. That file is a derived copy: never edit or commit it. `sync` merges the layers
  itself. Every field is optional; a missing or invalid field keeps its default.
  Lists keep their first 50 entries. The page reads `meta/config` live: a change shows without a republish.
  The page has no settings controls: change a setting in a layer file, then run `check`.

| Field | Value | Default |
|---|---|---|
| `title` | The header and the browser tab title | "Decision board" |
| `tz` | The operator's time zone: an IANA name such as `Europe/Warsaw`, or `UTC`. Every time the script and the page write carries its offset; the page and `read` show times in it, and the page footer names it | `Europe/Warsaw` |
| `agent` | The name on the Send button and in the note box | `Claude` |
| `tabs` | A list of `{id, label, match, rest}` | the All tab only |
| `priorities` | A list of `{id, label}` in sort order. The first three get the red, amber and grey tag | `now`, `soon`, `later` |
| `link_hosts` | The hosts card `links` may point to by `https:`. A card needs no link | none |
| `tags` | A list of `{id, label}` that cards name in `tags` | `alert`, `incident` |
| `groups` | The sections of a tab, in order: a list of `{id, label, match}`. A card goes to the first group whose `match` fits ("Groups and sort" below) | the six groups below |
| `sort` | The order inside a group: keys of `priority`, `due`, `first_asked`, `created`, `updated`, `title`, `id`; `-` in front reverses one. Missing values go last | `["priority", "due", "created", "id"]` |
| `week_start` | When the week of the groups starts: a day and a 24-hour time, `"<day> <HH:MM>"`, for example `"monday 00:00"`. "This week" runs from it to the next one | `"tuesday 12:00"` |
| `controls` | Quick controls on every card: an object of `assign`, `snooze`, `dismiss`, `close`, `done`, `tags`, each `true` or `false`. Turn on only what the operator uses; the user file is a good place | all `false` |
| `people` | More names for `assign`: a list of `{id, label}`. `id` is 1 to 40 of `a-z 0-9 _ -`, not `me`, `agent` or `other`. Names of real people belong in the user file, never in a repository | none |
| `status` | `stale_minutes`: after this many minutes a status that is not `idle` shows grey (1 to 1440). `guide`: `true` turns on the status guide; then `ack` and `guide --archive` print when to update it | `{"stale_minutes": 30, "guide": false}` |
| `wake` | How the agent learns of a Send: `mode` is `comment` (Send posts a comment that wakes the session), `poll` (a background watcher), `both`, or `off`; `poll_seconds` (60 to 86400) and `poll_limit` (1 to 1000) set the watcher. `node S watch` reads it | `{"mode": "both"}`; poll 300 s and 24 polls, both 900 s and 32 polls |
| `domains` | Hosts a reference guide may load from by `https:`, for example `["docs.example.com"]`. Only the operator adds a host | none |
| `checks` | Script only, never on the page: regex checks that `sync` runs on each open card, below | none |
| `standing` | Script only: the words that make `read` flag a note `[standing]`; add words of your language with `"+standing"` | `always`, `never`, `from now on` |

Host rules, for `link_hosts` and `domains`: a host has at least one dot and matches itself and its
subdomains, on any port. An entry of digits and dots must be a full IPv4 address and matches only
itself. A two-label entry of two short labels, such as `co.uk`, is dropped as a public suffix: name
the full host.

A tab: `id` is unique, not `all`, and does not start with `guide:`. `match` holds `source`, a list
of sources (matched after trim and lower case), and `tags`, a list of tag ids (matched exactly).
`rest: true` takes every card no other tab takes. A card belongs to one tab besides All: the first
tab whose `match.source` lists its `source`, else the first whose `match.tags` lists one of its tags,
else the first `rest` tab, else All only.

### Checks

Each check is `{id, field, match | forbid, except, flags, when, message}`: `field` is a card field
(`links.url` and `first_asked.who` reach inside); `match` needs one value of the field to match; `forbid`
refuses every occurrence it finds, except one where `except` matches starting at the same character; `flags`
takes `i m s u`; `when` limits the check to `{"source": [...], "tags": [...]}`. At most 50 checks. Closed cards
pass. `sync` refuses a card that fails and prints `<card>: check <id>: <message>`. Examples:
`assets/config.example.json`, under `_examples`.

```json
{"title": "Lab network", "tz": "Europe/Warsaw", "agent": "Coordinator", "link_hosts": ["wiki.example.com"], "tags": [{"id": "cost", "label": "Costs money"}],
 "tabs": [{"id": "router", "label": "Router", "match": {"source": ["router", "wifi"]}},
  {"id": "cost", "label": "Costs", "match": {"tags": ["cost"]}}, {"id": "other", "label": "Other", "rest": true}]}
```

### Groups and sort

A tab picks the cards; groups order them inside it. A group: `id` (a-z 0-9 _ -), `label`, and `match`, an object or
a list of objects of which any may fit. In an object every key must fit: `source`, `tags`, `priority`, `kind`
(lists, any value), `due` (a list of `overdue`, `today`, `this_week`, `next_week`, `later`, `none`; the week starts
at `week_start`, and a due day counts from its 00:00), `blocked` (true or false), `state` (`active`, the default,
`done` or `any`). `{}` takes every active card. An entry with an unknown key or value is dropped, and `check` says
so. Cards no group takes go to "Other" and "Done". `+groups` adds groups to the defaults; an entry with a default id
replaces that group. The defaults:

```json
{"groups": [
 {"id": "alerts", "label": "Alerts and incidents", "match": {"tags": ["alert", "incident"]}},
 {"id": "blocked", "label": "Now: blocked on a human", "match": {"blocked": true}},
 {"id": "this-week", "label": "This week", "match": [{"due": ["overdue", "today", "this_week"]}, {"priority": ["now"], "due": ["none"]}]},
 {"id": "next-week", "label": "Next week", "match": [{"due": ["next_week"]}, {"priority": ["soon"], "due": ["none"]}]},
 {"id": "backlog", "label": "Backlog", "match": {}},
 {"id": "done", "label": "Done", "match": {"state": "done"}}
]}
```

## Collections

`SCHEMA` in `assets/board.html` is the full field list.

| Collection | Doc id | Written by | Content |
|---|---|---|---|
| `cards` | `main` (the only document; `SCHEMA.cardsDoc`) | the agent: `sync`, `close`, `ack --close`, `purge`, `adopt` | `{cards: [item], refreshed: stamp or ""}` |
| `guides` | the guide id (`--id`), any id of `SCHEMA.idRe` | the agent: `guide`; the page sets `status` and `updated` | kind, title, sections, status, linked card id in `item` |
| `responses` | the card id | the page | the draft answer and the operator's quick controls, with the earlier sent answers in `history` |
| `notes` | `n<compact stamp>-<4 chars>` | the page | a free note |
| `batches` | `b<compact stamp>-<4 chars>` | the page creates it with `status: "sent"`; the agent's `ack` sets `status: "handled"` and `handled_at` | a copy of each answer and note, and the controls that changed |
| `meta` | `config`, `status`, `wake` | the agent: `check`; `status` and `watch` (status); the page (wake) | the merged config of the layers, without script-only keys, with `settings`; `status`: what the agent does now and the window of its last watcher; `wake`: the comment thread that Send writes into. (`meta/board` is still read for the title fallback; nothing writes it.) |

A batch has `status` "sent" until `ack` sets "handled" and `handled_at`. A card that `ack` closed for `dismiss` or `done` comes back when its content or its `input` changes; one set to Not ours (`assign` `other`) leaves the board and stays closed until the operator assigns it again.
