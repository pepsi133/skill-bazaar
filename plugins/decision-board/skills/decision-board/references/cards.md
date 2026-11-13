# Cards

## Fields

A card file is a JSON list of cards. The script fills `rev`, `created` and `updated`, and refuses an
unknown field.

| Field | Value |
|---|---|
| `id` | Required. A short slug, for example `backup-retention`: letters, digits and `_ - . ~ : @ +`, not `.` or `..`. Keep it when the card changes. To replace a card, close it and post a new id: an id belongs to one finding for good |
| `title` | Required. A plain question that one option answers, at most about 90 characters |
| `summary`, `evidence` | Text in the format below. `evidence` folds away |
| `draft` | Only the text the operator pastes elsewhere: a reply, a prompt, a message. Raw text: no preface, no notes, no approval line, no fence. Copy copies it byte for byte. Where it goes, why, and any caveat go in `summary` |
| `draft_label` | Where the draft goes, for example `Reply in the thread`. Plain text; needs `draft` |
| `options` | Required on a decision card: 2 to 8 complete answers. An action or info card leaves it out and gets the options of its kind |
| `recommendation` | One of the options, word for word |
| `kind` | `decision` (default), `action` (the operator does something outside the board; options "Done", "Done in part, see note", "Later", "Other, see note"), or `info` (one option, "Acknowledge") |
| `priority` | `now`, `soon` (default) or `later`, or an id of the config |
| `source` | A short word for where the card came from; it chooses the tab. `sync --source <s>` sets it on every card of the file |
| `blocks` | What waits for the card, for example `the nightly backup`. The card then shows in "Blocked on you" |
| `status` | `open` (default) or `closed` |
| `links` | Optional. Up to 10 `{"label", "url"}`; `sync` prints `note: <id>: no link` for an open card without one. A url must parse, use `https:`, carry no user name or password, and have a host of the config `link_hosts` or a subdomain of one. Give the link of the item when it has one |
| `tags` | Tag ids from the config `tags`, each once, matched exactly |
| `first_asked` | `{"date": "YYYY-MM-DD", "who": "<id>"}`: when the question was first put to the operator, and by whom. Required on every open card whose kind is not `info`. A real date in the config `tz`, no later than tomorrow. `who` is optional: at most 40 of the id characters. A card posted again keeps the stored value |
| `due` | Optional. `YYYY-MM-DD`, a day in the config `tz`, for a real deadline (a form, a review, a renewal). Only a date the source states; never infer one. From that day the card also shows in "Due today" until it is closed. Post it again without `due` to remove it |
| `input` | Optional. A marker of the latest source input, such as the item's last update time. When it changes, a card the operator dismissed or marked done comes back as a new question. A card file without it keeps the stored one. `board-refresh` fills it from the map key `input` |
| `source_key` | Optional. The item's raw key in its source, such as `7` or `OPS-7`; only `board-refresh` fills it: never write it in a card file yourself (`sync` refuses it in a file without `--source`). Only a card with it shows the Close control, and `read` names the item by it and its first link, or `link none` |

## Rules for a good card

The operator reads the card on a phone, without your session: it must stand alone.

- One decision or one action per card. Quote the real setting or command in backticks.
- Name the account, host or repository; an internal label such as `R17` means nothing on a phone.
- For a change, write `Before:` (what is in place), `Now:` (what goes wrong), `Suggested:` (the new
  value), and `Why:` and `Risk:` when they help. Measurements go into `evidence`.
- Every action for the operator gets a card with `blocks`, even when a guide holds the steps: a
  terminal reply scrolls away.
- Safety mechanisms that are the operator's own to manage stay off the cards as choices.
- When a "done" needs a check, check it yourself, then add --close <id> to the ack of that batch.
- A text to paste goes in `draft`, never in a fenced block. `sync` warns when a draft starts with a label such as `DRAFT` or `Note:`.

## Text format

`summary`, `evidence` and text guide sections take these markers; all HTML is escaped.

| Marker | Result |
|---|---|
| A blank line | A new paragraph |
| `- ` at the start of a line | A bullet |
| `1. ` at the start of a line | A numbered step; a list starts at the number of its first line |
| A line of three backticks, then the closing line | A preformatted block with a "Copy" button, for a command or a short sample. Keep its lines under about 40 characters |
| `### ` at the start of a line | A small heading |
| `**text**`, `` `text` `` | Bold, inline code |
| `Before:`, `Now:`, `Suggested:`, `Why:`, `Risk:`, `Your answer:` at the start of a line | The label in bold |

Links go in `links`; the text takes no links, tables or images. `title` and `blocks` are plain text.

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
