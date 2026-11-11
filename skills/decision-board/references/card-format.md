# Card text format

The page renders `summary` and `evidence` with a small formatter, `fmtText` in `assets/board.html`.
It escapes all HTML first and then adds only the tags below. Text without markers renders as plain
paragraphs, and a single line break inside a paragraph stays a line break.

| Marker | Result |
|---|---|
| A blank line | A new paragraph |
| A line that starts with `- ` | A bullet. Consecutive lines form one list |
| A line that starts with `### ` | A small heading |
| `**text**` | Bold |
| `` `text` `` | Inline code in a monospace font that wraps |
| `Before:`, `Now:`, `Suggested:`, `Why:`, `Risk:`, `Your answer:` at the start of a line | The label in bold |

Limits of the formatter:

- No nested lists, no numbered lists, no links, no tables. A URL stays plain text.
- A marker inside inline code stays literal, because code is split out before bold.
- `title` and `blocks` are plain text. Markers in them show as typed.

## One example card

A neutral card that proposes a change and blocks other work.

```json
{
  "id": "backup-retention-days",
  "area": "infra",
  "source": "other",
  "kind": "decision",
  "blocks": "the nightly backup job",
  "title": "Keep nightly backups for 14 days instead of 7?",
  "summary": "The backup volume is 82 % full after one week of nightly copies.\n\nBefore: `retention_days = 7` in `backup.toml`\nNow: the job fails on day 9 when the volume fills\nSuggested: `retention_days = 14` and a second volume of 200 GB\n\nWhy: two weeks covers a fault that shows up after a weekend.\nRisk: the second volume adds a monthly cost.",
  "evidence": "### Measured\n- `df -h /backup` shows 82 % used\n- The job log of the service account `backup-runner` shows one failure on day 9",
  "options": ["Keep 14 days, add the volume", "Keep 7 days", "Ask me later"],
  "recommendation": "Keep 14 days, add the volume",
  "priority": "soon",
  "status": "open",
  "created": "2026-11-11T13:00:00Z",
  "updated": "2026-11-11T13:00:00Z"
}
```

The rules that this card follows are in `SKILL.md`, section "Write a good card". Two points show
only here: each bullet of the evidence holds one fact with the command that measured it, and the
account is named (`backup-runner`), not an internal label.
