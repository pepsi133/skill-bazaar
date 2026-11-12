# Cards

Read this before you write a card file for `node S cards`.

## Fields

A card file is a JSON list of cards. The script fills `rev`, `created` and `updated`, and refuses
an unknown field, so a typing error stops the run.

| Field | Value |
|---|---|
| `id` | Required. A short slug, for example `backup-retention`: letters, digits and `_ - . ~ : @ +`. Keep the id when the card changes. Never reuse it for another finding |
| `title` | Required. A plain question that one option answers, at most about 90 characters |
| `summary`, `evidence` | Text in the format below. `evidence` folds away |
| `options` | Two to five complete answers. Leave it out to get the default options of the kind |
| `recommendation` | One of the options, word for word |
| `kind` | `decision` (default), `action` (the operator must do something outside the board; options "Done", "Done in part, see note", "Later", "Other, see note"), or `info` (one option, "Acknowledge"). A config can add kinds |
| `priority` | `now`, `soon` (default) or `later`, or an id of the config |
| `area`, `source` | Short words that group cards and choose the tab. Spaces at the ends do not count |
| `from` | The name of the posting agent, if it is not the default agent. Its answers go to batches for that name. Case and spaces at the ends do not count |
| `blocks` | What waits for the card, for example `the nightly backup`. The card then shows in "Blocked on you" |
| `supersedes` | The id of the card that this one replaces. The script closes the old card. Both show the link |
| `after` | The id of a card that the operator should answer first. This card is grey until then |
| `status` | `open` (default), `answered` or `closed` |
| `source_file` | The report that the card came from. The page shows its base name |

## Rules for a good card

The operator reads the card on a phone, without your session. The card must stand alone.

- One decision or one action per card. Quote the real setting or command in backticks.
- Name the account, host or repository. An internal label such as `R17` means nothing on a phone.
- For a change, write `Before:` (what is in place), `Now:` (what goes wrong), `Suggested:` (the
  new value). Add `Why:` and `Risk:` when they help. Put measurements into `evidence`.
- Every action for the operator gets a card with `blocks`, even when a guide holds the steps. A
  terminal reply scrolls away.
- Do not ask the operator to choose a safety mechanism that is the operator's own to manage.
- When a "done" needs a check, check it yourself. Then post the card again with `status: "closed"`
  and one evidence line that says what you checked. Do not add a new state.

## Text format

`summary`, `evidence` and the sections of a text guide use these markers. All HTML is escaped.

| Marker | Result |
|---|---|
| A blank line | A new paragraph |
| `- ` at the start of a line | A bullet |
| `1. ` at the start of a line | A numbered step. A list starts at the number of its first line |
| A line of three backticks, then the closing line | A preformatted block with a "Copy" button |
| `### ` at the start of a line | A small heading |
| `**text**`, `` `text` `` | Bold, inline code |
| `Before:`, `Now:`, `Suggested:`, `Why:`, `Risk:`, `Your answer:` at the start of a line | The label in bold. The config `labels` replace the list |

No links, tables or images. `title` and `blocks` are plain text. Keep lines in a preformatted
block under about 40 characters, because the block wraps on a phone.

## Example

```json
[{"id": "backup-retention", "area": "infra", "from": "infra-agent", "blocks": "the nightly backup",
  "title": "Keep nightly backups for 14 days instead of 7?",
  "summary": "Before: `retention_days = 7` in `backup.toml`\nNow: the job fails on day 9 when the volume fills\nSuggested: `retention_days = 14` and a second volume of 200 GB\n\nRisk: the second volume adds a monthly cost.",
  "evidence": "- `df -h /backup` shows 82 % used\n- The log of the account `backup-runner` shows one failure on day 9",
  "options": ["Keep 14 days, add the volume", "Keep 7 days", "Ask me later"],
  "recommendation": "Keep 14 days, add the volume"}]
```
