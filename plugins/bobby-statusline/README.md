# bobby-statusline

One status line row for `caveman`, `ste`, and `limit-guard`, plus the numbers the session
already knows: vim mode, context, the 5-hour and 7-day usage windows or the session cost,
the prompt cache, the model, the agent, and the pull request.

```
INSERT | [CAVEMAN:FULL] [STE] | ctx 132k/1M (13%) | 5h 26% >03:20 | 7d 14% >Wed 11:00 | cache 1h warm >03:52 91% | Opus 5 1M | high effort | fast+think | @general-purpose | #1234 pending | +156/-23
```

## Why one script and not a chain

Claude Code gives a session exactly one `statusLine.command`. Three plugins want a piece of
it, and chaining them means one process per plugin. A bare `python3` start typically
costs about 11 milliseconds, the standard library imports about 10 more, and Python needs
about 14 to compile this script, because a script that is started by its path has no
compiled cache. The whole render is allowed about 50. So this plugin replaces the chain
rather than extending it: one process reads stdin once, imports `limit-guard` in the same
interpreter, and prints.

Typical figures on a Linux machine, end to end, including the interpreter start and the
`limit-guard` capture:

```
render only     fixtures=8 runs=160  median=0.91ms  p95=1.34ms
end to end      runs=30  median=45.1ms  p95=46.5ms  max=47.3ms
estimate scan   runs=7  median=51.3ms  p95=51.6ms  max=52.8ms  catch-up only, over budget
estimate idle   runs=20  median=45.1ms  p95=46.0ms  max=46.2ms
```

Run `bin/bobby-statusline.py --selftest` to reproduce these numbers. It fails when the p95
of the end-to-end render or of the steady estimate render exceeds 50 milliseconds.

The `estimate scan` line is a render that still reads transcripts. It happens a few times
in a session, while the estimate catches up. The selftest prints its p95 and marks it, and
it is not part of the verdict. With the `limit-guard` gate installed, such a render can be
a few milliseconds above 50. Without the gate the same four lines measure about 8
milliseconds less.

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
| 7 | cost | `cost.total_cost_usd`, or the session transcripts | `$0.42`, `~$1.63 (sub $0.40)` | auto |
| 8 | prompt cache | `prompt_cache` | `cache 1h warm >03:52 91%` | on |
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
first API response lands. A question mark also appears in four cases where the number
exists but cannot be trusted:

- A usage window whose `resets_at` has already passed. The percentage belongs to the window
  that just ended. Claude Code drops such a window from the payload, so this covers only the
  gap before the next render.
- `prompt_cache` present without a `warm` field, which means the cache state is unknown
  rather than cold. A cache expiry time outside the platform's time range shows `cache ?` too.
- A percentage that is there but is not a number shows `?%`. A reset time that is not a
  time, or that is more than 400 days away, is not shown.
- The context segment falls back to `ctx 13%` without the token counts when
  `total_input_tokens` plus `total_output_tokens` exceeds the window size. Input includes
  cache reads and writes, so that sum can run past the window, and `ctx 1.2M/1M (13%)` would
  read as a fault. The percentage is the authoritative number.

## How it fits the width

Claude Code sets `COLUMNS` before it runs the script. It captures the output instead of
connecting it to the terminal, so `tput cols` and every language-level width call see
nothing useful. This script reads `COLUMNS` and falls back to 80.

If the joined row is wider than `COLUMNS`, the lowest-priority segment is dropped and the
row is measured again. There is no abbreviation and no wrapping. The documentation says
long output "may get truncated or wrap awkwardly", which is undefined behavior rather than
a layout, so the row is kept inside the width by construction.

One segment always survives. If even the most protected segment is wider than the terminal,
it is cut to fit rather than dropped, because a truncated `PAUSE` still tells you the session
is paused and a blank row looks like the script crashed.

```
COLUMNS = 200   nothing dropped
INSERT | [CAVEMAN:FULL] [STE] | ctx 132k/1M (13%) | 5h 26% >03:20 | 7d 14% >Wed 11:00 | cache 1h warm >03:52 91% | Opus 5 1M | high effort | fast+think | @general-purpose | #1234 pending | +156/-23

COLUMNS = 120   dropped: lines, pr, agent, fast+think, effort, model
INSERT | [CAVEMAN:FULL] [STE] | ctx 132k/1M (13%) | 5h 26% >03:20 | 7d 14% >Wed 11:00 | cache 1h warm >03:52 91%

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
  "cost_source": "auto",
  "glyphs": "ascii",
  "color": true,
  "separator": " | ",
  "segments": { "worktree": true },
  "priority": ["paused", "vim", "flags", "ctx", "five_hour", "seven_day", "cost",
               "cache", "model", "effort", "mode", "agent", "pr", "worktree", "lines"],
  "prices": { "claude-opus-5-5": [4, 20, 0.2, 5, 8] }
}
```

| Key | Values | Meaning |
|---|---|---|
| `layout` | `one-row`, `two-row` | `two-row` puts identity above and numbers below |
| `billing` | `auto`, `plan`, `cost`, `both` | which of the usage windows and the cost segment appear |
| `cost_source` | `auto`, `payload`, `estimate` | where the cost segment gets its number. See [The cost estimate](#the-cost-estimate) |
| `glyphs` | `ascii`, `unicode` | `unicode` uses `↻`, `·`, and `⎇` instead of `>`, `+`, and `git:` |
| `color` | `true`, `false` | `NO_COLOR` in the environment also turns color off |
| `separator` | any short string | the text between segments |
| `segments` | sparse object | lists only what differs from the default |
| `priority` | list of keys | drop order, most protected first. Unlisted keys go to the end |
| `prices` | object | price overrides for the estimate: a model id and its prices. See [Your own prices](#your-own-prices) |

Environment overrides, useful for one project or one experiment:

```bash
BOBBY_STATUSLINE_LAYOUT=two-row
BOBBY_STATUSLINE_BILLING=both
BOBBY_STATUSLINE_COST_SOURCE=estimate
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

`billing` decides whether the cost segment appears. `cost_source` decides where its number
comes from. With both on `auto`, the shape of the payload decides:

| Account | Payload | Row in `auto` | Transcripts read |
|---|---|---|---|
| Subscription (Pro, Max) | `rate_limits` present | `5h` and `7d`, no cost segment | no |
| API key, billed by token | no `rate_limits`, `cost.total_cost_usd` present | `$0.42`, the number from Claude Code, subagents included | no |
| Partner platform or enterprise gateway | no `rate_limits`, no `cost.total_cost_usd` | `~$0.42 (sub $0.10)`, the estimate | yes |

A subscription session shows a cost only when `billing` is `cost` or `both`. Any session
shows the estimate when `cost_source` is `estimate`.

## The cost estimate

On some accounts the payload has no `cost.total_cost_usd`, and the cost segment shows `$?`.
The estimate fills that gap. It adds up the token usage that Claude Code writes to the
session transcripts, for the main session and for every subagent, and multiplies it by a
price table.

```
~$1.63                  an estimate. No subagent cost, or less than one cent
~$1.63 (sub $0.40)      1.63 in total, of which 0.40 is subagents
~$1.63+ (sub $0.40)     a lower bound. The scan is not finished, or the session has more
                        transcripts than the limits take
~$1.63?                 a model with no price is in the session. It counts as 0
$?                      no transcript, no usable session id, a read failure, a total that
                        is outside any sane range, or a progress file that cannot be
                        written while the scan is not finished
```

| `cost_source` | Cost segment |
|---|---|
| `payload` | `cost.total_cost_usd` from Claude Code, `$?` when it is absent or not a number. No transcript is read |
| `estimate` | always the estimate |
| `auto` | the payload number when it is a number, the estimate when it is not |

The payload number, when it exists, already includes the subagents. It has no `(sub ...)`
part, because the payload does not split it.

### What it reads and writes

- The main transcript, from `transcript_path` in the payload.
- Every `agent-*.jsonl` file in the `subagents` directory next to it, inside three limits:
  three directory levels, which covers `subagents/workflows/<id>/`, 512 directories, and
  2000 files. The files are taken in the order of their names. What is past a limit is not
  counted. The `+` marker stays on the row for as long as a limit leaves a transcript
  out, because the number is then a lower bound. A transcript that was counted keeps its
  place: with 2000 counted, a new file is left out wherever its name sorts, so the number
  does not go down.
- A transcript that cannot be read, or a directory that cannot be listed, is not counted.
  The `+` marker stays for as long as that holds.
- Only lines whose top-level type is `assistant`. One API response is several lines with one
  message id, so an id counts once.

A render reads only the bytes that were appended since the last render. The progress is in
`${CLAUDE_CONFIG_DIR:-~/.claude}/bobby-statusline/usage/<session id>.json`: for each
transcript a byte offset, its token totals, its inode, and a checksum of its first 256
bytes. A transcript that got smaller, or whose inode or first bytes changed, is read again
from the start. A transcript that is not there any more, or that a limit now cuts off,
leaves the sum.

When the progress file cannot be written, a later render starts from zero. A total that one
render read to the end is correct, and it shows. A total that one render did not finish
would be another number on each render, so the segment shows `$?` then.

When the progress file is deleted, or is from an earlier version of the plugin, the scan
starts again from the first byte. Until it caught up, the row shows a number with `+` that
is lower than the one before.

The file is written to a temporary name in the same directory and then renamed. It has mode
0600. The plugin creates the two directories above it with mode 0700 and leaves the mode of
a directory that already exists as it is. A new session deletes the files of sessions that
are more than 30 days old.

What is refused: a transcript, a `subagents` directory, a session directory, or any entry
below them that is a symlink, and anything that is not a regular file, such as a named pipe.
The same holds for the progress file and its two directories. When one of those two
directories is a symlink the segment shows `$?` and nothing is written. Path components
above these, such as the configuration directory itself, are not checked.

### Time

Reading has 5 milliseconds for each render. The clock is looked at between two lines and
after each buffer of 1 MB, so a render can pass the limit by the time that one buffer
takes. The load and the write of the progress file are outside that limit. Each render
reads at least one line, so a slow machine still moves forward. A render continues after the transcript that the last render read, so one
transcript that never stops growing does not hold up the others. While the scan is not
complete the `+` marker shows.

A render does not look at every transcript:

- The main transcript and the 32 subagent transcripts that were written last get one
  `lstat` on every render.
- The list of files is made again only when a directory under `subagents` changed. So a
  new subagent transcript is seen on the next render.
- With time left inside the 5 milliseconds, the other transcripts get their `lstat`, at
  least 16 of them in each render. The round starts at a random place on each render. An
  append to one of them is seen some renders late when there are more of them than the
  time allows.

Typical figures on a Linux machine. `In process` is the estimate alone. `Whole render` is the process
from start to end, without and with the `limit-guard` gate:

| Session | First time | Nothing new, in process | One new line, in process | Nothing new, whole render |
|---|---|---|---|---|
| 1 main and 6 subagent transcripts, 12 MB | 12 renders | 0.2 ms | 0.4 ms | 37 ms, 44 ms |
| 200 subagent transcripts | 16 renders | 1.5 ms | 2.2 ms | 38 ms, 46 ms |
| 1000 subagent transcripts | 76 renders | 7.2 ms | 10 ms | 45 ms, 53 ms |
| 2000 subagent transcripts | 150 renders | 11 ms | 16 ms | 53 ms, 62 ms |

A render that still reads costs about 5 milliseconds more than the last column. The cost
with many transcripts is the progress file. It holds an entry for each transcript, and it
is read on every render and written on every render that found something new: about 6
milliseconds to read it with 2000 entries. A session with about 1000 subagent transcripts
or more is therefore above 50 milliseconds for the whole render when the gate is installed.

`--selftest` measures the estimate on a small synthetic session, end to end: a render that
still reads, and a render that finds nothing new.

A line longer than 4 MB is not held in memory. The scan steps over it, across several
renders if it must, and the progress file records how far it is. Such a line is a pasted
image or document in a `user` line. An `assistant` line of that size is not counted.

The scan runs only when the cost segment is shown and its source is the estimate. With
`payload`, or with `auto` and a payload number, nothing is read and nothing is written.

### Prices

Built-in list prices, in USD for each million tokens:

| Model id | Input | Output | Cache read |
|---|---|---|---|
| `claude-fable-5-2`, `claude-mythos-5-2` | 8 | 40 | 0.20 |
| `claude-fable-5-1`, `claude-mythos-5-1` | 10 | 50 | 0.25 |
| `claude-fable-5`, `claude-mythos-5` | 10 | 50 | 1.00 |
| `claude-opus-5-5` | 4 | 20 | 0.20 |
| `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6` | 5 | 25 | 0.50 |
| `claude-sonnet-5-5` | 2 | 10 | 0.10 |
| `claude-sonnet-5` | 2 | 10 | 0.20 |
| `claude-sonnet-4-6` | 3 | 15 | 0.30 |
| `claude-haiku-5-5`, prompt up to 100,000 tokens | 0.10 | 0.50 | 0.01 |
| `claude-haiku-5-5`, prompt above 100,000 tokens | 0.50 | 2.50 | 0.05 |
| `claude-haiku-4-5` | 1 | 5 | 0.10 |

A cache write with a 5 minute TTL costs 1.25 times the input price. A cache write with a
1 hour TTL costs 2 times the input price. A web search costs $0.01 for each request. Fast
mode doubles the token prices. A deployment name that ends in `-fast` gets the fast rate
too.

Haiku 5.5 is priced by the length of the prompt. Each request is priced on its own: when its
input tokens plus its cache reads plus its cache writes are above 100,000, the whole request
pays the higher row. The estimate does the same for each line of a transcript.

The table has no row for `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-opus-4-1`,
`claude-3-5-haiku`, or any older model. A session on one of them shows the `?` marker. Add
the row to `prices`.

**Which row a model gets.** The model id is made lower-case, and these parts are removed:

- a provider prefix that ends in `anthropic.`
- a `[1m]` suffix
- an `@` with a date after it, such as `@20260101`
- a version suffix of the form `-v1:0`, with any two numbers, on an id that had the
  `anthropic.` prefix only
- a date: eight digits that are a day of the years 2020 to 2099

One `-fast` at the end selects the fast rate. What is left must be equal to the id of a row.
There is no prefix match: `claude-opus-5-5-20260101` and `us.anthropic.claude-opus-5-5-v1:0`
are `claude-opus-5-5`, and `claude-opus-5-1` is not `claude-opus-5`. An id that only looks
like one of these forms gets no row: `claude-opus-5-5-12345678`, `claude-opus-5-5-v2`,
`claude-opus-5-5@latest` and `claude-opus-5-5-fast-fast`. A model with no row counts as $0 and the `?` marker appears,
so a new model is never priced as an older one without a sign.

### Your own prices

Put a row in `bobby-statusline.json` to change a price or to add a model. The five numbers
are input, output, cache read, cache write 5m and cache write 1h:

```json
{
  "prices": {
    "claude-opus-5-5": [4, 20, 0.2, 5, 8],
    "my-gateway-model": [1, 5, 0.1, 1.25, 2]
  }
}
```

A row can also be an object. `input`, `output`, `cacheRead` and `cacheWrite` are the names
that a row of Claude Code's `modelPricing` setting has, so the rows of that table can be
pasted here. `cacheWrite5m` and `cacheWrite1h` give the two cache write prices apart,
`multiplier` scales every price of the row, and `above` holds the prices of a request whose
prompt is above a threshold:

```json
{
  "prices": {
    "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2, "cacheWrite": 5 },
    "claude-haiku-5-5": {
      "input": 0.1, "output": 0.5, "cacheRead": 0.01, "cacheWrite5m": 0.125, "cacheWrite1h": 0.2,
      "above": { "threshold": 100000, "input": 0.5, "output": 2.5, "cacheRead": 0.05,
                 "cacheWrite5m": 0.625, "cacheWrite1h": 1 }
    }
  }
}
```

The rules:

- A key covers its own model and no other version. The key is reduced in the same way as a
  model id, so `claude-opus-5-5`, `claude-opus-5-5-20260101` and
  `us.anthropic.claude-opus-5-5-v1:0` are three ways to write the same key.
- A model id that is equal to a key as written takes that row first. So a row keyed
  `us.anthropic.claude-opus-5-5-v1:0` can hold a regional price next to a row keyed
  `claude-opus-5-5`.
- A row of yours that matches always wins over the built-in row.
- A row of yours replaces the built-in row whole. For Haiku 5.5, write the `above` part
  again, or the higher rate is gone.
- A row that is malformed is ignored: a wrong number of prices, a price that is not a
  number, that is negative, or that is above 100,000. The limit holds for the price after
  the `multiplier`.
- The configuration file is read up to 1 MB. A larger file is not used at all. Of the rows
  in `prices`, the first 256 are used. A byte order mark at the start of the file is
  accepted.
- The `modelPricing` setting has one `multiplier` for the whole table. Here `multiplier`
  belongs to one row.
- A row that is added or removed, or a threshold that changes, makes the next render read
  the session again from the start, because the thresholds decide how a request was
  counted.

Prices come from the built-in table and from your file only. The status line downloads
nothing.

### Limits

- It is an estimate at list price, not a bill. A partner platform has its own price list,
  and a contract can have a discount. Use `prices` for those.
- It is lower than the number from Claude Code. See
  [What this cannot show](#what-this-cannot-show) for the three causes.
- A price multiplier for US-only inference is not applied.
- When a transcript does not say how a cache write splits into 5 minute and 1 hour TTL, or
  the split does not add up to the total, the write counts at the 5 minute rate.
- A transcript holds one JSON object on each line. A transcript that another tool wrote
  again with one object across several lines is not counted.
- An `assistant` line longer than 4 MB is not counted. Such a line is not held in memory.
- A request with more than 1,000,000,000 tokens in one field, or with a field that is not a
  finite number, is not a request. It is ignored, and the rest of the session is counted.
- With more than 128 different model ids in the subagent transcripts of one session, the
  ids past that number are counted together as an unknown model, at $0 and with the `?`
  marker.
- A directory below the third level is not read. The `+` marker shows when such a
  directory holds an `agent-*.jsonl` file.
- An append to a subagent transcript that is not among the 32 written last is seen some
  renders late. See [Time](#time).
- A message id counts once in each transcript. Three cases can count a response twice: an
  id that comes back after 16 other ids, the same id in two transcripts, and a line with no
  id. With more than 32 transcripts in work at once, the ones written least recently
  remember only their newest id. None of these was seen in real sessions.
- A transcript that was written again in place with the same size, the same first 256 bytes
  and the same modification time is taken as unchanged.
- A transcript that was written again in place, larger than before and with the same first
  256 bytes, is taken as an append. The scan goes on from the old offset.
- The transcript of a session that was removed or rotated cannot be counted.

## No network access

The status line opens no connection and a render starts no process. Prices are in the
script and in your configuration file. Nothing is downloaded and nothing is sent.

What it reads, all of it local: the payload on standard input, the session transcripts for
the estimate, the two badge flag files, its configuration file, and the `limit-guard`
state.

What it writes: the progress file of the estimate under
`${CLAUDE_CONFIG_DIR:-~/.claude}/bobby-statusline/usage/`. When `limit-guard` is installed,
Python also keeps its bytecode cache of the gate script in a `__pycache__` directory next
to that script, as it does for every module that a program imports. Nothing else.

Two tests guard this:

- A static one. `bin/bobby-statusline.py` may import the modules on a short list, all from
  the Python standard library and none with network code, and no other. The roundabout
  ways to a module are closed too: a computed import, `sys.modules`, the `__dict__` or
  `vars()` of a module, a frame, and every `importlib` call except the ones that load the
  `limit-guard` gate from its file. `subprocess` is on the list for `--selftest` only, and
  the test makes sure that a render cannot reach that function. The plugin ships no script
  other than the two in `bin/`.
- A runtime one. Every fixture is rendered, with and without the estimate, in a process of
  its own under a Python audit hook. The events of the render are compared with the list
  of events that a clean render makes. Every other event fails the test: a socket, a
  process start, an import of a module that is not on the list. A control run proves that
  the hook reports each of those.

The tests are a regression guard. They catch network or process code that a change adds by
mistake or by habit. They are not a proof against code that is written to get past them.

Two things are outside that claim. `--selftest` starts copies of this script to time them.
And when `limit-guard` is installed, the status line runs its gate script in the same
process: see [The companion plugin](#the-companion-plugin-limit-guard).

The claim covers the code of this plugin and the `limit-guard` gate of this repository.
The tests read both: the static rules and the runtime check also run on that gate,
including a render in the paused state. A render executes the gate file that
`BOBBY_STATUSLINE_LIMIT_GUARD` names, or the one that it finds in the plugin cache. A
different file at that place is outside the claim.

The tests also fail when the plugin gets a `hooks` directory or an `.mcp.json` file, when
its manifest gets a new key, or when a command file names a download tool or an address.

## Optional: update the prices

The built-in table is fixed for each release of the plugin. When a price changes before the
next release, you can write the new price into `prices` by hand, or let a separate script
do it:

```bash
python3 /path/to/plugins/bobby-statusline/bin/bobby-statusline-prices.py --from prices.json
python3 /path/to/plugins/bobby-statusline/bin/bobby-statusline-prices.py --from <https address> --dry-run
```

It is optional and manual. The status line never runs it, never imports it, and does not
know that it exists. The `/bobby-statusline:install` command does not run it either.

- **You give the source.** The script has no built-in address. `--from` takes a local file
  or an `https` address that you type. `http` and every other scheme are refused. A
  redirect is followed only to the same host and port over `https`, and only when the new
  address has no user name in it. Every other redirect is refused, and the message names
  both hosts. At most three redirects are followed.
- **The host that is shown gets the connection.** An address with a `%` in its host part,
  or with a host name that has a character outside ASCII, is refused. The question names
  the host and the port.
- **A local file needs no network.** On a machine with no outside access, get the price
  list in any way you trust and pass its path.
- **It asks first, twice.** Before a download it prints the address, the host, the proxy
  and what it sends, and asks. Before it writes it prints the old and the new price of each
  model, and asks again. Both questions default to No. A local file has no download, so it
  has one question.
- **An answer counts only after its question.** What was typed, or pasted with the
  command, before a question was on the screen is thrown away. The script needs the
  `termios` module for that. Without it, as on Windows, the script does nothing.
- **It needs a terminal.** Standard input, standard output and standard error must all be
  terminals. With one of them redirected it does nothing and exits with an error. No flag
  and no environment variable answers the questions. A terminal is not proof of a person,
  because a program can make one. The check keeps the script out of pipelines. The script
  is for a manual run.
- **It sends no data.** The download is one `GET` request for each address, so at most
  four with three redirects on the same host, each with a fixed, generic `User-Agent`. No
  cookie, no credentials of yours, and nothing about the machine, the user or a session.
  Text from the server or from a file is printed without control characters.
- **It has limits.** The whole download has 30 seconds, the name lookup included. At that
  time the script prints the refusal and ends. It stops at 20 MB. A body that ends before
  the length that the server named is refused.
- **It shows the proxy.** When the environment sets a proxy for the host, the connection
  goes to the proxy first. The script prints the host and the port of the proxy and the
  name of the variable before the first question, or `proxy : none`. A user name or a
  password inside that variable goes to the proxy. The script does not print them.
- **It shows another certificate store.** When `SSL_CERT_FILE` or `SSL_CERT_DIR` is set,
  the certificates come from there, and the script prints that path before the first
  question. `SSLKEYLOGFILE` has no effect: no key log is written.
- **It writes one key.** The rows that differ go into `prices` in `bobby-statusline.json`.
  Every other key stays. The file is written to a temporary name and renamed, with mode
  0600. `--dry-run` shows the table and writes nothing. It writes no other file: no
  bytecode cache next to the scripts.
- **It removes a key that would keep the old price in use.** The new row goes under the
  plain model id. A stored key that is that id with a date at its end, or that id in other
  letter case, is removed in the same write. The table shows it as `removed` before the
  question, and as `would remove` with `--dry-run`. A key in a provider form, with
  `[1m]`, with `@` or with `-fast` is a row of its own and stays.
- **It does not write over a change.** When another program changed the configuration
  file while the second question waited, the script writes nothing and asks you to run it
  again.
- **It leaves a file in a bad state alone.** A configuration file that is not valid JSON,
  that has no write permission, or whose `prices` value is not an object is not changed.
  The script says why and writes nothing. A byte order mark at the start of the
  configuration file or of the price list is accepted. `Ctrl-C` at any point stops the
  script with nothing written.

Two formats are read: the LiteLLM price file (`input_cost_per_token` and its relatives, in
USD for each token), and the row shape of Claude Code's `modelPricing` setting. Only rows
whose model id starts with `claude-` are kept. A dated id is folded into its model: the
plain id wins, and without one the newest date wins. A number that is negative, not finite,
or above 100,000 USD for each million tokens after its `multiplier` drops its row, and so
does a cache price that is not a number. A row with a provider prefix or with `-fast` is
not taken: add such a row by hand. When the list has
no long-prompt rates for a model that has them now, the ones in use are kept and the table
says so.

## The companion plugin: limit-guard

`limit-guard` is in the same marketplace:
<https://github.com/pepsi133/skill-bazaar/tree/main/plugins/limit-guard>. It pauses a
session at the 5-hour or the 7-day usage window, and lets it go on after the reset. The two
plugins are made for each other: `limit-guard` needs the `rate_limits`
object, which Claude Code gives to the status line only, and this status line shows its
pause as `PAUSED >14:05`.

```bash
claude plugin install limit-guard@skill-bazaar
```

When `limit-guard` is installed, the status line loads its gate script and runs it in the
same Python process on every render. That script is code of another plugin. The gate
does local file work only, and the tests above also read and render the gate of this
repository: no socket, no process. It writes its cache, its pause state and its
log under `${CLAUDE_CONFIG_DIR:-~/.claude}/limit-guard/`. Without `limit-guard` the status
line works as before and shows no pause. [The limit-guard bridge](#the-limit-guard-bridge)
has the details.

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
| cache warm, cache warm in the last fifth of its TTL, cache cold | `108`, `179`, `179`. Never red |
| cache off or unknown | `245` grey |
| vim `INSERT`, `NORMAL`, `VISUAL` | `114`, `111`, `176` |
| caveman badge, ste badge | `173`, `109` |
| agent | `110` |
| model, effort, worktree, fast and thinking | `245` grey |
| PR approved, pending, changes requested | `108`, `244`, `173` |
| lines added, lines removed | `108`, `174`, two colors within one segment |

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
3. One glob under `${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/cache/*/limit-guard/*/hooks/`,
   taking the highest version. Plain string order would put `0.9.0` after `0.10.0` and pin
   an old copy forever, so the version directory is compared as numbers.

The pause state is read through `limit-guard`'s own `load_state()` when the import succeeds.
The fallback reads the file directly and honors `LIMIT_GUARD_HOME`, the same variable
`limit-guard` uses, so a relocated state directory does not silently report "not paused".

Degradation, in order:

- `limit-guard` imports cleanly: the cache is written, and the windows render as usual.
- `limit-guard` is absent, or the import raises: nothing is written, and the windows still
  render from stdin. The session loses the gate, not the display.
- The payload cannot be used, for example because it is nested thousands of levels deep:
  the row of a session with no data yet is printed.
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
`[a-z0-9-]`. Text taken from the session JSON, such as a model or agent name, cannot use that
whitelist, so it is stripped of C0 and C1 control characters, `DEL`, the direction marks,
overrides and isolates, and the line separators U+2028 and U+2029. C1 matters because `0x9b` is a second `CSI` introducer in some terminals, and a bidi
override can visually reorder a row so that a low percentage reads as a high one. An unrecognized value renders nothing rather than echoing the bytes. A local
attacker who can plant a file must not be able to have the status line print
`~/.ssh/id_rsa`, or an ANSI escape sequence, on every keystroke.

`ste` does not write `.ste-active` yet, so the `[STE]` badge stays absent until it does.
The change is about ten lines in a hook `ste` already runs: write `on` to the flag on
`/ste:ste on`, remove the file on `/ste:ste off`, refuse a symlink at the path, and write
atomically at mode 0600. Absence is the "off" signal, matching `caveman`, so a reader that
finds no file renders nothing rather than empty brackets.

Reading `ste`'s own `$XDG_CONFIG_HOME/ste/state.json` instead was the alternative. One read
path won: one hardening routine rather than two, one fixture shape, and `caveman` and `ste`
then look identical to any future status line.

## The prompt cache

Claude Code adds a `prompt_cache` object to the payload after the first API response. It
describes the cache of the main session only. Subagent caches are not in the payload.

```
cache 1h warm >17:47 91% 2 miss: tools     warm, expires at 17:47
cache 5m cold since 17:47 ~40k             cold since 17:47, the next turn writes ~40k tokens again
cache off                                  the API reported no cache reads or writes
```

| Part | Field | Shown when |
|---|---|---|
| `1h`, `5m` | `ttl` | always, if the value has the form `<n>s`, `<n>m` or `<n>h` |
| `warm`, `cold` | `warm`, `expires_at` | always. A payload with `warm: true` that arrives after `expires_at` renders cold |
| `>17:47` | `expires_at` | warm. The time at which the cache goes cold |
| `since 17:47` | `expires_at` | cold. The time at which the cache went cold |
| `~40k` | `recache_tokens_if_cold` | cold. `null` means the next turn writes a compacted prompt of unknown size |
| `91%` | `hit_ratio` | from the second request on. The first request only writes, so its ratio is always 0 |
| `2 miss: tools` | `misses`, `last_miss_cause.causes` | after a miss. The label names the last cause, `2 miss` alone when Claude Code has not attributed it |

Miss cause labels: `system`, `tools`, `model`, `fast`, `ttl`, `betas`, `effort`, `think`,
`auto`, `overage`, `body`, `history`, `idle` (the TTL expired), `server` (the prompt did not
change), and `?`. A cause name that this version does not know renders as its cleaned name.

The segment is green while the cache is warm. It turns amber in the last fifth of the TTL,
which is the last minute of a `5m` cache and the last 12 minutes of a `1h` cache, so you can
send a turn before it goes cold. A cold cache is amber too. It costs money on the next
request, but it is not an emergency, so it is never red.

The segment shows a clock time and not a countdown. Claude Code redraws the status line at
`expires_at`, so the change from warm to cold appears without a timer. Between redraws a
countdown would show a stale value, and a clock time does not.

### Which TTL a session gets

Claude Code chooses the TTL. The status line only reports it. The default depends on the
account type and on server-side configuration. A session in usage overage gets `5m`. To set
the TTL yourself, use one of these, highest precedence first:

| Setting | Effect |
|---|---|
| `FORCE_PROMPT_CACHING_5M=1` | always `5m` |
| `CLAUDE_CODE_PROMPT_CACHE_TTL=5m` or `1h` | the main session TTL |
| `"promptCacheTtl": "5m"` or `"1h"` in `settings.json` | the main session TTL |
| `ENABLE_PROMPT_CACHING_1H=1` | `1h` |

## The countdown is a snapshot

Claude Code re-runs the status line on events: a new assistant message, `/compact`
finishing, a permission-mode change, a vim-mode toggle, a settings change, a rate-limit
window reaching its `resets_at` time, and a prompt cache reaching its `expires_at` time. There is no timer
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
  resets on `/clear`. The estimate is computed from list prices too. Neither knows a
  discount or the price list of a partner platform.
- **The requests that are in no transcript.** Claude Code makes requests of its own beside
  the conversation: the one that names the session, the session recap, prompt suggestions,
  and others. It writes no usage line for them, so the estimate cannot count them, and it
  reads lower than the number from Claude Code. The difference is small in a short session
  and grows with the length of the session, because many of those requests read the whole
  cached conversation. `cost.total_cost_usd` contains them. No transcript reader can.
- **The compaction request.** `/compact` and automatic compaction send one request that
  reads the whole conversation and writes the summary. It has no usage line either. On a
  large model with a full context that one request can cost dollars.
- **The history before a fork of a compacted session.** A session started with
  `--fork-session` from a session that was compacted gets a transcript that holds only the
  lines after the compaction, and no subagent files. The estimate of the fork starts there,
  so it is lower than the payload number and has no `(sub ...)` part. A fork of a session
  that was never compacted has the whole history. `--resume` and `--continue` keep the
  session id and the transcript, so they lose nothing.
- **A cost on the first render of a session.** The transcript file does not exist before
  the first response, so the estimate shows `$?` for that one row.
- **Subagent tokens in the context segment.** `context_window` describes the main session.
  The estimate counts subagent cost, but no segment shows a subagent's context.
- **A cost split when Claude Code supplies the number.** `cost.total_cost_usd` is one
  figure. Only the estimate can show the `(sub ...)` part.
- **Spend outside this session.** Today, this week, and other sessions are not in the
  payload. The estimate reads the transcripts of the current session only.

## Tests

```bash
cd plugins/bobby-statusline && python3 -m unittest discover -s tests -p 'test_*.py'
python3 bin/bobby-statusline.py --selftest
```

367 tests cover the golden renders, width fitting at nine widths, badge hardening (symlink,
oversize, escape bytes, whitelist), the billing modes, the color thresholds, both layouts,
the configuration layers, the prompt cache states and colors, the pause state, the
`limit-guard` bridge including an old gate and a raising gate, the slash command's contract,
and one regression test per fixed defect (`TestAuditRegressions`, nine tests). Each of those
fails against the code as it stood before its fix.

For the estimate they cover the ledger (one count for each message id, main and subagent
totals, incremental reads, the time limit, a 10 MB line, the three limits on the list of
transcripts, truncated and replaced transcripts, named pipes, every symlink case, a
progress file of the wrong shape), every row of the price table, the row matching, the
long-prompt rate, the cost sources for the three account shapes, payload fields of the
wrong type or of an absurd size, and the absence of network code (`TestNoEgress`).

For the price update script they cover the questions and the terminal check, input that
was typed before a question, the banner, the configuration file in each bad state and a
change to it during a question, and the text that is printed (`TestPriceScript`, no
network). `TestPriceDownload` runs the download against a TLS listener on `127.0.0.1`:
the exact request, the redirect rules, the size limit and the time limits, with a name
lookup that does not answer among them. It makes its certificate with the `openssl`
command in a temporary directory, and it is skipped where that command is absent.

Every test isolates `CLAUDE_CONFIG_DIR` into a temporary directory, including the tests that
run the script as a subprocess, so a run reads none of the developer's own session state and
writes nothing into their real `limit-guard` cache. The ledger tests write synthetic
transcripts into that temporary directory. `--selftest` does the same from a shell:
it points `LIMIT_GUARD_HOME` at a temporary directory for the run, so the captures it measures
never touch the real cache or pause state. Its two `estimate` lines render a synthetic session
in a throwaway configuration directory, because the fixtures have no transcript. The clock is pinned by passing
`render(payload, now=...)`, so the expectations do not drift with the date and nothing in the
environment can freeze a real session's countdown.

The performance test asserts that the selftest measures, not that this machine was fast. The
50 millisecond budget is checked by `--selftest` itself, where a person or CI reads the
number; asserting it inside the suite makes a loaded laptop fail a run, which teaches people
to ignore red.

## Not in this version

- Abbreviated segment forms, so a narrow terminal shrinks instead of dropping.
- Bars in place of percentages.
- A `subagentStatusLine` variant. That input is a different shape: a `tasks` array with a
  per-row `columns` field.
