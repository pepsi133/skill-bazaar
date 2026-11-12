# Cards

Read this before you write a card file for `node S sync`.

## Fields

A card file is a JSON list of cards. The script fills `rev`, `created` and `updated`, and refuses
an unknown field, so a typing error stops the run. The document a card goes to is its agent.

| Field | Value |
|---|---|
| `id` | Required. A short slug, for example `backup-retention`: letters, digits and `_ - . ~ : @ +`, not `.` or `..`. Keep the id when the card changes. Never reuse it for another finding |
| `title` | Required. A plain question that one option answers, at most about 90 characters |
| `summary`, `evidence` | Text in the format below. `evidence` folds away |
| `options` | Required on a decision card: 2 to 8 complete answers. An action or info card leaves it out to get the options of its kind |
| `recommendation` | One of the options, word for word |
| `kind` | `decision` (default), `action` (the operator must do something outside the board; options "Done", "Done in part, see note", "Later", "Other, see note"), or `info` (one option, "Acknowledge") |
| `priority` | `now`, `soon` (default) or `later`, or an id of the config |
| `source` | A short word for where the card came from. It chooses the tab. `sync --source <s>` sets it on every card of the file |
| `blocks` | What waits for the card, for example `the nightly backup`. The card then shows in "Blocked on you" |
| `status` | `open` (default) or `closed` |
| `links` | Required on every card. A list of 1 to 10 `{"label", "url"}`. A link is valid when the url parses, uses `https:`, has no user name or password, and its host is an entry of the config `link_hosts` or a subdomain of one. `sync` refuses a card without links and every invalid link, and stores the normalised URL. A change of the links raises `rev`. The page shows each valid link with the label as text and the host after it, or the host alone when the label is empty, opens it in a new tab, and drops an invalid one. A card with no natural URL links the report it came from or the repository page of the work |
| `tags` | A list of tag ids from the config `tags`. `sync` refuses an id that is not there, and a repeated id. Ids match exactly, case included. The page shows each as a chip with its label |
| `first_asked` | `{"date": "YYYY-MM-DD", "who": "<id>"}`: when the question was first put to the operator, and by whom. Required on every open card whose kind is not `info`. The date is a real calendar date in the operator's time zone, no later than tomorrow. `who` is optional: empty, or at most 40 of the id characters. The page shows "First asked MM-DD (who), N days", N counted in the operator's calendar days. A card posted again keeps the stored `first_asked` |

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
- To replace a card, close the old one and post a new id. Never reuse an id for another finding.

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
| `Before:`, `Now:`, `Suggested:`, `Why:`, `Risk:`, `Your answer:` at the start of a line | The label in bold |

No links in the text (put them in `links`), no tables or images. `title` and `blocks` are plain
text. Keep lines in a preformatted
block under about 40 characters, because the block wraps on a phone.

## Example

```json
[{"id": "backup-retention", "source": "infra", "blocks": "the nightly backup",
  "title": "Keep nightly backups for 14 days instead of 7?",
  "summary": "Before: `retention_days = 7` in `backup.toml`\nNow: the job fails on day 9 when the volume fills\nSuggested: `retention_days = 14` and a second volume of 200 GB\n\nRisk: the second volume adds a monthly cost.",
  "evidence": "- `df -h /backup` shows 82 % used\n- The log of the account `backup-runner` shows one failure on day 9",
  "options": ["Keep 14 days, add the volume", "Keep 7 days", "Ask me later"],
  "recommendation": "Keep 14 days, add the volume",
  "links": [{"label": "Backup job log", "url": "https://wiki.example.com/backup/nightly"}],
  "tags": ["cost"],
  "first_asked": {"date": "2026-01-15", "who": "infra-agent"}}]
```
