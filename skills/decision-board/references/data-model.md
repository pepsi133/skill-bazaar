# Data model and call shapes

The board keeps every record in the artifact database (the `db` capability). The page source holds
no records. An agent reads and writes the database with the `ArtifactData` tool. Load it with
`ToolSearch("select:ArtifactData")` before the first call. In the calls below, `<URL>` is the artifact
link that the first publish returned.

## Ids

- A document id uses only letters, digits and `_ - . ~ : @ +`. No spaces, no slash.
- An item id is a short slug that names the finding, for example `plan-first-step`. Never reuse an id
  for a different finding.
- A batch id has the shape `b<UTC stamp>-<4 chars>`, for example `b20261111T120600Z-ab12`.
- A note id has the shape `n<UTC stamp>-<4 chars>`.
- The stamp is the ISO time without `-`, `:` and fraction. The page makes both ids itself.

## Collections

| Collection | Doc id | Fields | Written by |
|---|---|---|---|
| `items` | item id | `id`, `area`, `title`, `summary`, `evidence`, `options`, `recommendation`, `priority`, `source`, `kind`, `blocks`, `status`, `created`, `updated`, `source_file` | agents |
| `responses` | the item id | `itemId`, `choice`, `note`, `updated`, `sent`, `batch` | the page |
| `batches` | batch id | `id`, `created`, `itemIds`, `noteIds`, `status`, `delivered_at` | the page creates; the agent sets `delivered` |
| `notes` | note id | `id`, `text`, `created`, `sent`, `batch` | the page |
| `guides` | guide id | `id`, `title`, `body`, `status`, `created`, `updated`, `item` | agents; the page sets only `status` and `updated` |
| `meta` | `board` | `title`, `updated`, `counts` | agents; the page only reads it |

### Item fields

| Field | Value |
|---|---|
| `id` | The doc id again |
| `area` | A free short word that groups items, for example `mail`, `code`, `infra`. The Area filter lists every area that exists |
| `title` | A plain question, at most about 90 characters |
| `summary`, `evidence` | Text in the card format, see `card-format.md`. `evidence` folds away under a "Evidence" toggle |
| `options` | Array of strings. The page shows one radio button per option. An empty array shows no options |
| `recommendation` | One of the options exactly, or `""`. The page marks it "recommended" |
| `priority` | `now`, `soon` or `later`. Sort order and a coloured tag |
| `source` | Optional tab key: `email`, `github` or `other` in the template. Without a valid value the page derives it from `area` through `AREA_SOURCE` |
| `kind` | Optional: `decision` (the default) or `action` |
| `blocks` | Optional string: what waits for the item. Non-empty puts the card into "Blocked on you" |
| `status` | `open`, `answered` (the agent acted on the answer) or `closed` (no longer needed) |
| `created`, `updated` | ISO 8601 UTC, for example `2026-11-11T13:00:00Z` |
| `source_file` | Optional: the report the item came from. The page shows its base name |

### Guide fields

| Field | Value |
|---|---|
| `id` | The doc id again, a short slug, for example `dns-setup` |
| `title` | Short. The page shows it as the tab label |
| `body` | Text in the card format, see `card-format.md` |
| `status` | `active` or `archived`. An active guide has a tab. Any value other than `archived` counts as active |
| `created`, `updated` | ISO 8601 UTC. The guide tabs are in the order of `created` |
| `item` | Optional: the id of the card that the guide belongs to. That card shows "Open guide" while the guide is active |

### What the page writes

- Response, on an option pick or 700 ms after typing stops:
  `{ itemId, choice, note, updated, sent: false, batch: "" }` at `responses/<itemId>`. A change after a
  send writes the same shape again, so the next batch carries the new answer.
- Note: `{ id, text, created, sent: false, batch: "" }` at `notes/<id>`. "Remove" deletes it.
- Send: the page first marks each unsent response and note with `update({ sent: true, batch: <bid> })`,
  and only then writes `{ id, created, itemIds, noteIds, status: "new", delivered_at: "" }` at
  `batches/<bid>`. A watcher that sees a `new` batch therefore finds every response already marked. If
  the send fails part way, the page writes a batch for the documents it did mark and shows an error.
- Guide: "Archive" writes `update({ status: "archived", updated })` at `guides/<id>`, and "Reopen" writes
  the same shape with `status: "active"`. The page writes no other field of a guide.
- The page never writes `items` or `meta`.

## Call shapes

Seed the header record after the first publish (omit `if_version` only when the document does not
exist yet; afterwards read it and pass its `version`):

```json
{"action": "set", "url": "<URL>", "collection": "meta", "doc_id": "board",
 "data": {"title": "<agent-name> decision board", "updated": "2026-11-11T13:00:00Z", "counts": {"items": 0}}}
```

Add items, up to 50 writes in one call. `set` without `if_version` creates a new id:

```json
{"action": "batch", "url": "<URL>",
 "writes": [{"op": "set", "collection": "items", "doc_id": "ITEM_ID", "data": {"id": "ITEM_ID", "...": "..."}}]}
```

Change an item: read it with `get`, then `update` with `if_version` set to the `version` you read.
`update` merges fields, but replaces an array field whole.

```json
{"action": "update", "url": "<URL>", "collection": "items", "doc_id": "ITEM_ID", "if_version": 3,
 "data": {"status": "closed", "updated": "2026-11-11T14:00:00Z"}}
```

Remove one field, for example `blocks`: `"data": {"blocks": {"__delete__": true}}`.

Create a guide. Use `set` without `if_version` for a new id. To change the text later, `get` the
guide and `update` it with `if_version`:

```json
{"action": "set", "url": "<URL>", "collection": "guides", "doc_id": "dns-setup",
 "data": {"id": "dns-setup", "title": "DNS setup", "status": "active", "item": "ITEM_ID",
          "body": "### Records\n1. Open the DNS panel.\n2. Add this record:\n```\nexample.org. 3600 IN TXT \"v=spf1 -all\"\n```\n3. Save the zone.",
          "created": "2026-11-11T13:00:00Z", "updated": "2026-11-11T13:00:00Z"}}
```

List the batches that wait:

```json
{"action": "query", "url": "<URL>", "collection": "batches",
 "query": {"where": [["status", "==", "new"]], "limit": 50}}
```

Read one batch (run it for `responses` and for `notes`):

```json
{"action": "query", "url": "<URL>", "collection": "responses",
 "query": {"where": [["batch", "==", "BATCH_ID"]], "limit": 200}}
```

Read the question behind a response:

```json
{"action": "get", "url": "<URL>", "collection": "items", "doc_id": "ITEM_ID"}
```

Mark a batch delivered, pinned to the version that the listing printed:

```json
{"action": "update", "url": "<URL>", "collection": "batches", "doc_id": "BATCH_ID", "if_version": 1,
 "data": {"status": "delivered", "delivered_at": "2026-11-11T13:10:00Z"}}
```

Then `get` the batch and confirm that `status` reads `delivered`. The page header shows the last batch
and whether it was delivered.

## Access

The page declares `capabilities: {"db": {}}` and no rules. The access limits are in `SKILL.md`,
section "Known limits".
