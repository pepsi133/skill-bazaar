# bobby-statusline

One status line row for `caveman`, `ste`, and `limit-guard`, plus the numbers the session
already knows: vim mode, context, the 5-hour and 7-day usage windows or the session cost,
the prompt cache, the model, the agent, and the pull request.

```
INSERT | [CAVEMAN:FULL] [STE] | ctx 132k/1M (13%) | 5h 26% >03:20 | 7d 14% >Wed 11:00 | cache warm 91% | Opus 5 1M | high effort | fast+think | @general-purpose | #1234 pending | +156/-23
```

## Why one script and not a chain

Claude Code gives a session exactly one `statusLine.command`. Three plugins want a piece of
it, and chaining them means one process per plugin. Measured here, a bare `python3` start
costs about 11 milliseconds and a start with the standard library imports costs about 18.
The whole render is allowed about 50. So this plugin replaces the chain rather than
extending it: one process reads stdin once, imports `limit-guard` in the same interpreter,
and prints.

Measured end to end on the maintainer's machine, WSL2, 30 runs, including the interpreter
start and the `limit-guard` capture:

```
render only     median 0.80ms   p95 1.03ms
end to end      median 30.1ms   p95 32.7ms   max 34.8ms
```

Run `bin/bobby-statusline.py --selftest` to reproduce both numbers. It fails when the
end-to-end p95 exceeds 50 milliseconds.

## Look at it before you install

```bash
python3 /path/to/plugins/bobby-statusline/bin/bobby-statusline.py demo
python3 /path/to/plugins/bobby-statusline/bin/bobby-statusline.py demo cost-only
```

`demo` renders a fixture at your terminal width and at five fixed widths, so the drop order
is visible. It builds a throwaway `CLAUDE_CONFIG_DIR`, plants sample badge flags in it, and
removes it on exit, so your real configuration directory is neither read nor written and
`limit-guard`'s cache is untouched. Any fixture name under `tests/fixtures/` works.

To try the real thing against your own session without editing `settings.json`, point the
whole plugin at a scratch configuration directory:

```bash
CLAUDE_CONFIG_DIR=/tmp/bobby-test COLUMNS=$COLUMNS \
  python3 bin/bobby-statusline.py < tests/fixtures/full.json
```

## Install

A plugin cannot set the main `statusLine`. That key belongs to the user, and only `agent`
and `subagentStatusLine` are plugin-settable, so nothing is wired up by installing the
plugin. There are two ways to finish the job.

**Let Claude do it.** Run the slash command:

```
/bobby-statusline:install
```

It locates the script, runs `install` to get the resolved path, shows you the diff, and
writes it. If `statusLine` is already set to something else, it stops and asks rather than
replacing what you or another plugin put there.

**Or paste it yourself.** The script only ever prints:

```bash
python3 /path/to/plugins/bobby-statusline/bin/bobby-statusline.py install
```

Add what it prints to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "python3 /abs/path/to/bin/bobby-statusline.py"
  },
  "hideVimModeIndicator": true
}
```

`hideVimModeIndicator` removes the built-in `-- INSERT --` row, because this status line
renders the vim mode itself. Without it the mode appears twice, and on a short terminal the
extra row is the one that gets cut off.

The status line updates on the next assistant message. A settings change is itself a refresh
trigger, so no restart is needed.

## What it renders

Segments appear left to right in this order. The number is also the drop order: segment 1
is dropped last.

| # | Segment | Source | Example | Default |
|---|---|---|---|---|
| 1 | pause | `limit-guard` state | `PAUSED >14:05` | on |
| 2 | vim mode | `vim.mode` | `INSERT` | on |
| 3 | badges | flag files | `[CAVEMAN:FULL] [STE]` | on |
| 4 | context | `context_window` | `ctx 132k/1M (13%)` | on |
| 5 | 5 hour | `rate_limits.five_hour` | `5h 26% >03:20` | auto |
| 6 | 7 day | `rate_limits.seven_day` | `7d 14% >Wed 11:00` | auto |
| 7 | cost | `cost.total_cost_usd` | `$0.42` | auto |
| 8 | prompt cache | `prompt_cache` | `cache warm 91%` | on |
| 9 | model | `model.display_name` | `Opus 5 1M` | on |
| 10 | effort | `effort.level` | `high effort` | on |
| 11 | fast, thinking | `fast_mode`, `thinking.enabled` | `fast+think` | on |
| 12 | agent | `agent.name` | `@general-purpose` | on |
| 13 | PR or MR | `pr.number`, `pr.kind` | `#1234 pending`, `!123 approved` | on |
| 14 | worktree | `worktree`, `workspace.git_worktree` | `git:main` | off |
| 15 | lines changed | `cost.total_lines_*` | `+156/-23` | on |

`auto` means the billing mode decides. `>` marks a reset time. A GitLab merge request uses
`!` instead of `#`, because `pr.kind` reports `mr` for one.

When a value has not arrived yet, the segment shows a question mark rather than a zero:
`ctx ?%`, `5h ?%`, `$?`. The segment keeps its place, so the row does not reshuffle when the
first API response lands.

## How it fits the width

Claude Code sets `COLUMNS` before it runs the script. It captures the output instead of
connecting it to the terminal, so `tput cols` and every language-level width call see
nothing useful. This script reads `COLUMNS` and falls back to 80.

If the joined row is wider than `COLUMNS`, the lowest-priority segment is dropped and the
row is measured again. There is no abbreviation and no wrapping. The documentation says
long output "may get truncated or wrap awkwardly", which is undefined behavior rather than
a layout, so the row is kept inside the width by construction.

```
COLUMNS = 200   nothing dropped
INSERT | [CAVEMAN:FULL] [STE] | ctx 132k/1M (13%) | 5h 26% >03:20 | 7d 14% >Wed 11:00 | cache warm 91% | Opus 5 1M | high effort | fast+think | @general-purpose | #1234 pending | +156/-23

COLUMNS = 120   dropped: lines, pr, agent, fast+think, effort, model
INSERT | [CAVEMAN:FULL] [STE] | ctx 132k/1M (13%) | 5h 26% >03:20 | 7d 14% >Wed 11:00 | cache warm 91%

COLUMNS = 80    ... and cost, cache, 7d
INSERT | [CAVEMAN:FULL] [STE] | ctx 132k/1M (13%) | 5h 26% >03:20
```

## Configuration

Three layers, later wins: built-in defaults, then the JSON file, then the environment.

`${CLAUDE_CONFIG_DIR:-~/.claude}/bobby-statusline.json`, every key optional:

```json
{
  "layout": "one-row",
  "billing": "auto",
  "glyphs": "ascii",
  "color": true,
  "separator": " | ",
  "segments": { "worktree": true },
  "priority": ["paused", "vim", "flags", "ctx", "five_hour", "seven_day", "cost",
               "cache", "model", "effort", "mode", "agent", "pr", "worktree", "lines"]
}
```

| Key | Values | Meaning |
|---|---|---|
| `layout` | `one-row`, `two-row` | `two-row` puts identity above and numbers below |
| `billing` | `auto`, `plan`, `cost`, `both` | which of the usage windows and the cost segment appear |
| `glyphs` | `ascii`, `unicode` | `unicode` uses `↻`, `·`, and `⎇` instead of `>`, `+`, and `git:` |
| `color` | `true`, `false` | `NO_COLOR` in the environment also turns color off |
| `separator` | any short string | the text between segments |
| `segments` | sparse object | lists only what differs from the default |
| `priority` | list of keys | drop order, most protected first. Unlisted keys go to the end |

Environment overrides, useful for one project or one experiment:

```bash
BOBBY_STATUSLINE_LAYOUT=two-row
BOBBY_STATUSLINE_BILLING=both
BOBBY_STATUSLINE_GLYPHS=unicode
BOBBY_STATUSLINE_SEGMENTS=+worktree,-agent    # a delta list, not a full set
BOBBY_STATUSLINE_PRIORITY=vim,ctx,five_hour
BOBBY_STATUSLINE_SEPARATOR=' * '
NO_COLOR=1
```

ASCII is the default because `↻`, `·`, and `⎇` render as boxes in many terminals. Unicode is
the opt-in.

### Billing detection

`rate_limits` appears only for Claude.ai Pro and Max subscribers, or behind a Claude apps
gateway with a spend limit, and only after the first API response. Its absence is therefore
the signal that this session bills by token cost. In `auto` mode a plan session shows the
5-hour and 7-day windows and hides the cost, and a token-cost session shows the cost and
hides the windows. One blind spot: at the very first render of a session, before any API
response, a plan user looks like a token-cost user for one row. Set `billing` explicitly to
avoid that, or set `both` to see everything.

## Color

256-color codes at mid-palette tones, so they read on a light and a dark background. Red
belongs to exactly one condition: a usage window at 95 percent or above.

| What | Code |
|---|---|
| usage below 70% | `108` muted green |
| usage 70 to 89% | `179` muted amber |
| usage 90 to 94% | `173` muted orange |
| usage 95% and above | `160` red |
| cost | `109` muted blue |
| cache warm, cache cold | `108`, `179`. Never red |
| vim `INSERT`, `NORMAL`, `VISUAL` | `114`, `111`, `176` |
| caveman badge, ste badge | `173`, `109` |
| agent | `110` |
| model, effort, worktree, fast and thinking | `245` grey |
| PR approved, pending, changes requested | `108`, `244`, `173` |
| lines added, lines removed | `108`, `174` |

## The limit-guard bridge

`limit-guard` needs the `rate_limits` object, and the status line is the only place Claude
Code hands it out. This script imports `limit-guard`'s gate in the same interpreter and
calls its `capture()` function, which writes `limit-guard`'s own cache and advances its own
pause state.

The import, not a copy, because `capture()` does four things: write the cache, unpause a
window whose reset time passed, save the state, and append to the log. Copying the cache
write means copying a state machine, which then drifts.

The gate is located in this order:

1. `BOBBY_STATUSLINE_LIMIT_GUARD`, an explicit path.
2. A sibling directory: `../limit-guard/hooks/limit-guard-gate.py`.
3. One glob under `${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/cache/*/limit-guard/*/hooks/`.

Degradation, in order:

- `limit-guard` imports cleanly: the cache is written, and the windows render as usual.
- `limit-guard` is absent, or the import raises: nothing is written, and the windows still
  render from stdin. The session loses the gate, not the display.
- The whole render raises: the script prints an empty line and exits 0. A blank status line
  is a small loss. A traceback in the status bar on every keystroke is not.

An older `limit-guard` that has only `run_capture()` also works. That function prints a
badge, and this script swallows the output so it cannot land in the middle of the row.

## Badge flag files

| Badge | File | Written by |
|---|---|---|
| `[CAVEMAN:level]` | `${CLAUDE_CONFIG_DIR:-~/.claude}/.caveman-active` | `caveman` |
| `[STE]` | `${CLAUDE_CONFIG_DIR:-~/.claude}/.ste-active` | `ste` |

Both readers refuse symlinks, cap the read at 64 bytes, and strip every character outside
`[a-z0-9-]`. An unrecognized value renders nothing rather than echoing the bytes. A local
attacker who can plant a file must not be able to have the status line print
`~/.ssh/id_rsa`, or an ANSI escape sequence, on every keystroke.

`ste` does not write `.ste-active` yet, so the `[STE]` badge stays absent until it does.
The change is about ten lines in a hook `ste` already runs: write `on` to the flag on
`/ste on`, remove the file on `/ste off`, refuse a symlink at the path, and write
atomically at mode 0600. Absence is the "off" signal, matching `caveman`, so a reader that
finds no file renders nothing rather than empty brackets.

Reading `ste`'s own `$XDG_CONFIG_HOME/ste/state.json` instead was the alternative. One read
path won: one hardening routine rather than two, one fixture shape, and `caveman` and `ste`
then look identical to any future status line.

## The countdown is a snapshot

Claude Code re-runs the status line on events: a new assistant message, `/compact`
finishing, a permission-mode change, a vim-mode toggle, a settings change, a rate-limit
window reaching its `resets_at` time, and a prompt-cache TTL expiring. There is no timer
unless you ask for one.

So `5h 26% >03:20` is correct when it is drawn and does not tick down afterward. For a
ticking countdown, add `"refreshInterval": 30` next to `"command"` in `settings.json`. The
cost is one `python3` start every 30 seconds while the session sits idle.

## What this cannot show

- **The permission mode.** No field in the payload carries it, so
  `auto mode on (shift+tab to cycle)` stays on Claude Code's own row. A hook could cache it,
  but `shift+tab` fires no hook, so the cached value would be wrong exactly when the user
  just changed it.
- **Per-model sub-limits.** `rate_limits` exposes three aggregate percentages and no
  breakdown.
- **Your actual bill.** `cost.total_cost_usd` is computed client-side at list price and
  resets on `/clear`.
- **Spend outside this session.** Today, this week, and other sessions are not in the
  payload. Session transcripts under `~/.claude/projects/` do record per-message token
  counts and timestamps, with no dollar field, so a figure means summing tokens against a
  price table. Scanning that per render costs far more than the budget allows, so it needs
  a cached sidecar and is not part of this version.

## Tests

```bash
cd plugins/bobby-statusline && python3 -m unittest discover -s tests -p 'test_*.py'
python3 bin/bobby-statusline.py --selftest
```

62 tests cover the golden renders, width fitting at nine widths, badge hardening (symlink,
oversize, escape bytes, whitelist), the billing modes, the color thresholds, both layouts,
the configuration layers, the pause state, and the `limit-guard` bridge including an old
gate and a raising gate.

Every test isolates `CLAUDE_CONFIG_DIR` into a temporary directory and pins the clock with
`BOBBY_STATUSLINE_NOW`, so a run reads none of the developer's own session state and the
expectations do not drift with the date.

## Not in this version

- Abbreviated segment forms, so a narrow terminal shrinks instead of dropping.
- Bars in place of percentages.
- A `subagentStatusLine` variant. That input is a different shape: a `tasks` array with a
  per-row `columns` field.
- Editing `settings.json` for you.
