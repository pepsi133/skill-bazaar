# limit-guard

Stops a Claude Code session — main agent **and** subagents — from burning past the end of
its 5-hour or 7-day usage window, waits for the reset without spending tokens, and resumes
on its own.

Targets: **Claude Code only.** The hooks, the statusline contract and the `ScheduleWakeup`
tool are all Claude Code surfaces.

## Why it exists

Claude Code ships `autoContinueAtUsageLimit`, which waits in the open session and continues
after a reset. This plugin is independent of it, for two reasons:

1. The built-in reacts to the limit being **hit**. limit-guard stops you at a threshold
   *before* the wall, so the last few percent of the window stay available for the summary
   and for whatever the human wants to do next.
2. The built-in gives up in cases the docs list plainly: repeated hits (it re-arms at most
   twice), and a reset more than 24h out. limit-guard covers those two, because it acts on
   a threshold rather than on a hit and it does not re-arm a limited number of times. It
   does **not** cover the other cases the docs list — `-p`, background and teammate
   sessions — see Limitations.

limit-guard can also **observe** the built-in: it logs every `quota_auto_resume_fired` /
`_stale` / `_disabled` notification to `log.jsonl`. That only yields data when the gate is
not doing its job — pausing at 95% means the built-in never gets to fire — so the log fills
up in exactly the sessions where limit-guard is off, disabled, or has no fresh cache.

## How it works

```
statusline JSON ──> limit-guard-statusline.sh ──> ~/.claude/limit-guard/rate_limits.json
   (rate_limits)          │                                    │
                          └──> inner statusline + badge        │
                                                               v
tool call ────────────> PreToolUse: limit-guard-gate.py <──────┘
                          allow (silence)  |  deny + instructions
```

The statusline command's stdin JSON is the only documented machine-readable source of the
live `rate_limits` percentages ([statusline.md]). A plugin cannot set the main `statusLine`
— only `subagentStatusLine` — so **you install the wrapper by hand**; that is the one manual
step, and without it the guard has no data and stays silent (fail-open).

Decision, evaluated on every tool call:

| Condition | Result |
|---|---|
| No cache, or cache older than `MAX_CACHE_AGE_S` (15 min) | allow — no data is not evidence |
| A window whose `resets_at` is past its plausibility horizon (5h→8h, 7d→8d) | discard that window, keep checking the other |
| `five_hour` ≥ `PAUSE_PCT` (95) | pause until its `resets_at`, auto mode |
| `seven_day` ≥ `PAUSE_PCT`, reset ≤ `MAX_AUTO_WAIT_S` (10h) | pause, auto mode |
| `seven_day` ≥ `PAUSE_PCT`, reset > 10h | pause, **manual** mode |
| Paused, and `now ≥ until` | resume |
| Paused, and a *newer* capture shows the window under `RESUME_PCT` (30) | resume |
| Paused, anything else | deny |

A window whose `resets_at` has passed counts as 0% — Claude Code drops a window after its
reset, and a stale copy of a full window must not pin the session shut.

**Auto mode** tells the model to write a 3-line summary and then `ScheduleWakeup` with
`delaySeconds = min(3600, until − now + 60)`, waking to run `limit-guard status` first. The
3600s cap means a long wait is a chain of cheap hops rather than one long sleep, and each
hop re-checks reality instead of trusting a timestamp. The deny text carries an explicit
fallback — *if `ScheduleWakeup` is unavailable or errors, write the summary, send one
`PushNotification`, end the turn* — because the tool is documented as internal to the
`/loop` skill and its behaviour outside `/loop` is unverified (see Verified behavior).

**Manual mode** (7-day reset more than 10h out) tells the model *not* to schedule anything:
send one `PushNotification`, write the summary, end the turn. Hourly hops across 30 hours
would cost more than the pause saves. A human runs `limit-guard resume`.

Exempt from the gate, because they are how the model obeys a deny: `ScheduleWakeup`,
`PushNotification`, and any `Bash` command that is *entirely* a bare `limit-guard`
read-only subcommand (`status`, `selftest`, `version`, `help`) or that same subcommand run
as `${CLAUDE_PLUGIN_ROOT}/bin/limit-guard`. The whole command must match — anything
chained, redirected, or otherwise carrying a shell metacharacter is denied like any other
tool call. `limit-guard resume`, `off` and `on` are deliberately **not** exempt: ending or
disabling a pause is the human's move.

## Install

1. Register the marketplace once, then enable the plugin:

   ```
   /plugin marketplace add /path/to/skill-bazaar
   /plugin install limit-guard@skill-bazaar
   ```

2. Add the statusline wrapper to `~/.claude/settings.json` **by hand** (the plugin will not
   edit your settings, and `limit-guard install` only prints this):

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "bash /path/to/skill-bazaar/plugins/limit-guard/hooks/limit-guard-statusline.sh"
     }
   }
   ```

   **The path must be literal.** `settings.json` is JSON, not shell: it expands no globs and
   no `~`, so a `*` or a tilde in that string is a path that does not exist and a statusline
   that silently does nothing. Point it at a clone of this repo (stable across plugin
   updates) or at the resolved plugin-cache path — `limit-guard install` prints the exact
   string for your machine. If you use the cache path, note that
   `${CLAUDE_PLUGIN_ROOT}` changes when the plugin updates, so re-run `limit-guard install`
   and re-paste after an upgrade.

   **Already have a statusline?** Keep it — chaining is **opt-in**, and the wrapper never
   executes anything you have not named. Set `LIMIT_GUARD_INNER` to its command and the
   wrapper prints its output and appends the badge.

   `statusLine` has no `env` field, but its `command` runs in a shell ([statusline.md]), so
   set the variable inline in the same string:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "LIMIT_GUARD_INNER='bash /path/to/skill-bazaar/plugins/caveman/hooks/caveman-statusline.sh' bash /path/to/skill-bazaar/plugins/limit-guard/hooks/limit-guard-statusline.sh"
     }
   }
   ```

   Chaining the *vendored* caveman statusline has a prerequisite: `caveman@caveman` must be
   uninstalled and the upstream `caveman` marketplace removed first, or both copies' hooks
   fire on every turn (see [`../caveman/README.md`](../caveman/README.md)).

   Point it at a stable path you control — a clone of this repo, or your own script. Not at
   `~/.claude/plugins/cache/...`: that path moves on every plugin update, and pointing a
   statusline at an auto-updating cache means executing whatever landed there this morning.

   The value is split on whitespace and run as an argv vector — never through a shell — so
   metacharacters in it are inert and **paths containing spaces are not supported**; wrap
   anything more elaborate in your own script and point at that. The inner statusline runs
   *after* the capture and under a 5-second `timeout`, so a slow or hung one costs you its
   own output, never the rate-limit data the gate depends on. `LIMIT_GUARD_INNER=none` is
   accepted as an explicit "no chaining" and is the same as leaving it unset.

3. Verify:

   ```
   limit-guard selftest
   limit-guard status
   ```

## Requirements

- **`python3` on `PATH`.** The hooks in `hooks/hooks.json` invoke `python3` by name.
  Claude Code substitutes only its own `${CLAUDE_*}` variables in a hook command, so
  `LIMIT_GUARD_PYTHON` — which the CLI and the statusline wrapper do honour — cannot be
  used there. If your `python3` lives somewhere unusual, edit the three `command` strings
  in `hooks/hooks.json`. Python 3.9+, stdlib only, no third-party packages.
- **bash 5** for the wrapper and the CLI.
- **The deny protocol assumes `limit-guard` is on `PATH`.** Claude Code adds a plugin's
  `bin/` to the Bash tool's `PATH` while the plugin is enabled, which is what makes the
  `limit-guard status` instruction in the deny text runnable. Two consequences: the deny
  text is only actionable while the plugin is enabled, and **a plugin with a `bin/`
  directory cannot be distributed through claude.ai org settings** ([plugins-reference.md]).
  Marketplace and local installs are unaffected.

## Configuration

Every threshold is settable by environment variable (`LIMIT_GUARD_<KEY>`) or by
`~/.claude/limit-guard/config.json` (`{"PAUSE_PCT": 90}`). Environment wins.

| Key | Default | Meaning |
|---|---|---|
| `PAUSE_PCT` | 95 | pause at or above this used-percentage |
| `RESUME_PCT` | 30 | resume early once a fresh capture is below this |
| `MAX_AUTO_WAIT_S` | 36000 | 7-day resets further out than this go to manual mode |
| `MAX_CACHE_AGE_S` | 900 | a capture older than this counts as no data |
| `MAX_FIVE_HOUR_HORIZON_S` | 28800 | a 5h window resetting further out than this is ignored as implausible |
| `MAX_SEVEN_DAY_HORIZON_S` | 691200 | a 7d window resetting further out than this is ignored as implausible |
| `WAKE_CAP_S` | 3600 | cap on a single `ScheduleWakeup` hop |
| `WAKE_PAD_S` | 60 | wake this long after the reset |
| `DISABLED` | 0 | `1` turns the gate off entirely |

Also: `LIMIT_GUARD_HOME` (state directory), `LIMIT_GUARD_PYTHON`, `LIMIT_GUARD_INNER`,
`NO_COLOR` / `LIMIT_GUARD_NO_COLOR`.

`limit-guard off` writes an override file that makes the gate allow everything and log that
it did; `limit-guard on` removes it.

## CLI

| Command | Does |
|---|---|
| `limit-guard status` | one-line status, raw per-window numbers, cache age, thresholds. Always exits 0 — the model is told to run it on every wake, and a non-zero exit reads there as a failed command. |
| `limit-guard resume` | clear a pause. **Not exempt from the gate**: this is the human's escape hatch, and a paused model that could run it would have no pause. |
| `limit-guard off` / `on` | set / clear the override |
| `limit-guard install` | print the settings.json snippet — edits nothing |
| `limit-guard selftest` | run the decision function over built-in fixtures; touches no state |

## State

`~/.claude/limit-guard/`, every file mode 0600, every write atomic (tmp + rename), every
path refused if it is a symlink.

| File | Contents |
|---|---|
| `rate_limits.json` | last statusline capture: `captured_at`, `rate_limits` (per window: `used_percentage`, `resets_at`), `context_window`, `model`, `version` |
| `state.json` | `paused`, `since`, `until`, `window`, `manual`, `notified`, `pct`, `reason` |
| `status.md` | one human-readable line, rewritten on every state change and every statusline run |
| `log.jsonl` | one JSON line per transition, override, error, and quota notification |
| `config.json` | optional overrides (you create it) |
| `override` | present = gate disabled |

## Security posture

- The gate **fails open**. Corrupt JSON, a symlinked state file, an unreadable directory, a
  missing interpreter — every one of them logs a line and lets the tool call through. A
  guard that bricks a session is worse than no guard.
- "Allow" is *silence*, never `permissionDecision: "allow"`. An explicit allow would
  override your own permission rules; the gate has no business doing that.
- The statusline wrapper cannot fail: fallible steps run in `set -euo pipefail` subshells
  whose failure is swallowed, and it always `exit 0`. The worst case is a missing badge.
- Nothing read from disk reaches the terminal without control bytes stripped and length
  capped — the same reasoning as caveman's statusline: a local attacker who can plant a
  file should not be able to render ANSI escapes into your status bar on every keystroke.
- Nothing edits `settings.json`. `install` prints.
- **The deny text is built only from fixed labels and computed numbers.**
  `permissionDecisionReason` goes straight into the model's context, and the state file is
  writable by anything that can write your home directory — the same threat model that
  motivates the symlink refusals. An unrecognised `window` value renders as `usage`, never
  as its own contents, so the state file is not a prompt-injection channel.
- **The `limit-guard` exemption matches the whole command, not its first word.** Anything
  carrying a shell metacharacter is not exempt, so `limit-guard status; <anything>` is
  denied like any other tool call during a pause.
- **Exactly two spellings are exempt**: the bare name (Claude Code puts the plugin's `bin/`
  on the Bash tool's `PATH`) and the absolute `${CLAUDE_PLUGIN_ROOT}/bin/limit-guard`. A
  path-prefix pattern would exempt *any* executable named `limit-guard` anywhere on the
  disk, so `/tmp/evil/limit-guard status` would buy a bypass to whoever can drop a file.
- **`resume`, `off` and `on` are deliberately not exempt.** Lifting or disabling the guard
  is a human's decision; a model that can clear its own pause does not have a pause. The
  deny text does not name `limit-guard resume` either — `permissionDecisionReason` goes
  straight into the model's context, and naming the one command that would end the pause is
  an invitation.
- **A window claiming to reset absurdly far out is ignored** — more than eight hours for
  `five_hour`, more than eight days for `seven_day`. A corrupt or planted cache should not
  be able to pin a session behind an unbounded wakeup chain, or behind a manual pause that
  only a human can lift.
- **Chaining to another statusline is opt-in.** With `LIMIT_GUARD_INNER` unset the wrapper
  executes nothing but its own capture. It never discovers a script to run, and it never
  runs one out of an auto-updating plugin cache.
- **The cache stores only the fields the plugin reads, nested ones included.** Five keys at
  the top (`captured_at`, `rate_limits`, `context_window`, `model`, `version`), and inside
  `rate_limits` only `used_percentage` and `resets_at` per window, at most eight windows.
  The statusline payload also carries `cwd`, `transcript_path`, session ids and repo/PR
  metadata; none of it is kept. The cache is read back and rendered into the status bar, so
  "only what we read" has to hold for the nested objects too.
- `log.jsonl` suppresses consecutive identical events and rotates to `log.jsonl.1` at 1 MB,
  so a standing override or a persistent error cannot fill the disk one tool call at a
  time.
- `LIMIT_GUARD_INNER` is executed as an argv vector, never `bash -c`. An environment
  variable should not be an arbitrary-command surface.

## Limitations — read these before trusting it

- **`rate_limits` only exists for claude.ai Pro/Max sessions, and only after the first API
  response.** The first turn of every session is unguarded. This is a property of the data
  source, not a bug here.
- **The data is only as fresh as the last statusline render.** Claude Code re-runs the
  statusline on each new assistant message, on `/compact`, on permission-mode changes, on a
  `refreshInterval` timer, and when a rate-limit window's `resets_at` passes. A long
  single tool call sees a slightly stale number — hence a 95% threshold rather than 99%.
- **Without the manual `statusLine` step, the plugin does nothing.** By design: no data,
  no pause.
- **No statusline means no guard — so `-p`, background and teammate sessions are
  uncovered.** The gate's only data source is the JSON Claude Code pipes to
  `statusLine.command`. A session that renders no statusline produces no capture, the cache
  goes stale within `MAX_CACHE_AGE_S`, and the gate fails open. These are cases the
  built-in `autoContinueAtUsageLimit` also gives up on, and limit-guard does not rescue
  them. Nothing here catches you there.
- **The `quota_auto_resume_*` log is evidence only when the gate is not working.** If
  limit-guard pauses you at 95%, the built-in never reaches its trigger and never fires a
  notification. Those log lines therefore appear only while the gate is off (`limit-guard
  off`), `DISABLED=1`, or blind for want of a fresh capture.
- The `spend_limit` window is captured and shown in `status`, but is not a pause trigger.
- Wake turns are billed. A chain of hourly hops across a long wait costs real tokens, just
  far less than continuing to work would.

## Open questions

None of these blocks use. Each is a thing to settle with evidence rather than an argument.

- **`MAX_CACHE_AGE_S = 900` is a guess.** No documented number says how often the statusline
  re-renders during a long tool call, so the staleness cutoff was picked, not measured.
  Re-tune it once a real session has produced a `log.jsonl`.
- **A composite statusline could absorb this wrapper.** Until one exists,
  `limit-guard-statusline.sh` is what you put in `statusLine.command`, and chaining is how
  anything else gets a look at the JSON.
- **No real pause and auto-resume has been observed yet**, and no `quota_auto_resume_*`
  line in `log.jsonl`. That line is what would settle whether `autoContinueAtUsageLimit`
  fires at all. See Limitations for why it only appears while the gate is off or blind.

## Verified behavior

Claims checked against the Claude Code docs or pinned by the test suite. Harnesses change:
re-check the documents in References before you trust a claim on a newer version.

**Hook and plugin schema.** The `PreToolUse` denial shape is
`hookSpecificOutput: {hookEventName, permissionDecision: "deny", permissionDecisionReason}`
([hooks.md]). The plugin `hooks/hooks.json` shape and the `${CLAUDE_PLUGIN_ROOT}`
substitution match [plugins-reference.md]. The default `command` hook timeout is 600s. This
plugin sets 10s, which is generous: the gate is one stdlib Python process that reads two
small files.

**A `PreToolUse` deny reaches subagent tool calls: documented, not observed live.**
[hooks.md] states: *"Hooks from settings files, managed policy settings, and plugins also
run inside subagents. When a subagent calls a tool, tool events such as `PreToolUse` and
`PostToolUse` fire the same configured hooks as in the main conversation, and the input
carries the `agent_id` and `agent_type` common input fields that identify the subagent."*
The gate logs `agent_type` on every transition, so `log.jsonl` answers the question the
first time a subagent trips it (`tests/test_gate.py::test_subagent_fields_are_logged` covers
the logging path). To observe it live, about two minutes:

1. `limit-guard off` (so a mistake cannot strand you), then enable the plugin.
2. Write a fake capture that forces a pause a few minutes out:
   ```bash
   python3 - <<'EOF'
   import json, time, os
   d = os.path.expanduser("~/.claude/limit-guard"); os.makedirs(d, mode=0o700, exist_ok=True)
   p = os.path.join(d, "rate_limits.json")
   json.dump({"captured_at": int(time.time()),
              "rate_limits": {"five_hour": {"used_percentage": 99,
                                            "resets_at": time.time() + 300}}}, open(p, "w"))
   os.chmod(p, 0o600)
   EOF
   ```
3. `limit-guard on`, then ask the main session to spawn a trivial subagent that reads one
   file (`Explore` will do).
4. Expected if the docs hold: the subagent's `Read` is denied with the limit-guard reason,
   and `~/.claude/limit-guard/log.jsonl` gains a line whose `agent_type` names the subagent.
5. Clean up: `limit-guard resume` and delete `~/.claude/limit-guard/rate_limits.json`.

**`ScheduleWakeup` outside `/loop`: not observed live. This is the load-bearing uncertainty
in auto mode.** The tool is present in an interactive session's toolset with `delaySeconds`
(clamped 60–3600) and `prompt` fields. [scheduled-tasks.md] describes it as the mechanism
behind the `/loop` skill and does not document a direct call from an ordinary turn. Whether
a wakeup scheduled from a plain denied turn fires is not verified. Auto-resume therefore
carries an UNCONFIRMED-LIVE label until someone watches one fire.

The design does not depend on it being reliable. If the call is unavailable or errors, the
deny text tells the model to fall back to the manual path — one `PushNotification`, a
written summary, end of turn. The worst case of a wakeup that never fires is the manual
case: a paused session with a summary written, waiting for a human. That is the outcome
without this plugin, minus the summary.

**Statusline re-run at `resets_at`: documented, not observed live.** [statusline.md] lists
"a rate-limit window in the data your script last received reaches its `resets_at` time"
among the refresh triggers, which is what makes a pause lift without a tool call. It cannot
be forced in a test. As a safety net the gate also unpauses on `now ≥ until` on the next
tool call, so a missed refresh delays the badge, not the resume.

**Test suite.** 110 tests, `python3 -m unittest discover -s plugins/limit-guard/tests`, no
network, every test against a throwaway `HOME` / `CLAUDE_CONFIG_DIR`. Covers all decision
branches, the deny text, exemptions, corrupt and symlinked state, fail-open, file modes, the
badge, inner-statusline chaining, and the CLI. Runs in about 9s. One test waits on a
deliberately hung inner statusline and skips itself where coreutils `timeout` is missing.

**`statusLine` settings shape.** `statusLine` accepts `type`, `command`, `padding`,
`refreshInterval` and `hideVimModeIndicator` — there is **no `env` field**. Its `command`
"runs in a shell" ([statusline.md]), which is why `LIMIT_GUARD_INNER=... bash
.../limit-guard-statusline.sh` in the one `command` string is the documented way to chain.

**Properties pinned by tests.** Each of these has a test that fails if it regresses:

- `resume` is not an exempt subcommand, so a paused model cannot clear its own pause. The
  deny text does not name the command that would.
- The CLI exemption matches the whole command and refuses shell metacharacters, so
  `limit-guard status; <anything>` is denied during a pause.
- The exemption applies only to this plugin's own `bin/limit-guard`, not to any file of that
  name elsewhere on disk.
- `state["window"]` is cleaned before it reaches `permissionDecisionReason`, so the state
  file is not a prompt-injection channel into the model's context.
- The wrapper captures first and runs the inner statusline second, under a timeout, so a
  hung inner statusline cannot cost the capture.
- The wrapper never auto-detects or executes a third-party statusline. The inner command is
  opt-in through `LIMIT_GUARD_INNER`.
- Each window has a plausibility horizon, so a corrupt `resets_at` cannot wedge a manual
  pause.
- A pause with no `until` expires.
- `rate_limits` is filtered to the fields the plugin reads before it is cached.
- Resume-by-percentage ignores a capture whose `rate_limits` is `null` (every session's
  first turn), so a pause survives a restart.

## References

- Statusline: https://code.claude.com/docs/en/statusline.md
- Hooks: https://code.claude.com/docs/en/hooks.md
- Plugins reference: https://code.claude.com/docs/en/plugins-reference.md
- Scheduled tasks, wakeups and their cost: https://code.claude.com/docs/en/scheduled-tasks.md
- Auto-continue behaviour: https://code.claude.com/docs/en/interactive-mode.md

[statusline.md]: https://code.claude.com/docs/en/statusline.md
[hooks.md]: https://code.claude.com/docs/en/hooks.md
[plugins-reference.md]: https://code.claude.com/docs/en/plugins-reference.md
[scheduled-tasks.md]: https://code.claude.com/docs/en/scheduled-tasks.md
