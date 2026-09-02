---
name: limit-guard
description: What to do when a tool call is denied with a message starting "limit-guard:" — the session has hit its 5-hour or 7-day usage window and is paused. Use when you see that deny reason, when the user asks about usage limits, rate limits, quota, "am I paused", or asks to check or resume limit-guard.
---

# limit-guard — you are paused, here is the protocol

A `PreToolUse` hook denied your tool call because the session's usage window is at or
above the pause threshold. The deny reason carries the numbers and the exact delay to
use. This skill is the standing procedure behind it.

**The pause is the point.** Do not work around it. Every tool call you make while paused
burns window the user is trying to protect, and the gate will deny it anyway.

## Do not

- Do not retry the denied tool, or try a different tool to do the same thing.
- Do not edit, delete, or `chmod` anything under `~/.claude/limit-guard/`.
- Do not run `limit-guard resume` or `limit-guard off`, set `LIMIT_GUARD_DISABLED`, or
  touch the override file. Those exist for the human, not for you. Ending or disabling the
  pause to finish a task is the one failure mode this plugin has — and the gate exempts
  none of them, so the attempt is denied anyway.
- Do not sit in a tight loop calling `limit-guard status`.

Only the human decides to bypass the guard. If you think the pause is wrong, say so in
your summary and let them run `limit-guard off`.

## Auto mode — the reset is close (default: within 10 hours)

The deny reason names a `delaySeconds`. Do exactly this, in order:

1. **Write a 3-line summary for the user**: what you finished, what is left, what you
   will do first on resume. This is what they will read if they walk away — it is the
   whole value of the pause, so make it specific.
2. **Call `ScheduleWakeup`** with the `delaySeconds` from the deny reason (capped at
   3600 by design) and this prompt:

   ```text
   limit-guard: run `limit-guard status` and continue the task if allowed
   ```
3. **End the turn.** Do not call anything else.

**If `ScheduleWakeup` is unavailable or errors:** write the summary, call
`PushNotification` once if available, end the turn; the human resumes. Do not substitute a
sleep, a polling loop, or any other tool — every one of those spends the window the pause
exists to protect. `ScheduleWakeup` is documented as internal to the `/loop` skill, so its
behaviour outside `/loop` is not guaranteed; failing over to the manual path is the
correct response, not an error to work around.

**On wake, the first thing you run is `limit-guard status`** (exempt from the gate, so it
always works, and it exits 0 whether or not you are paused). Read its output, not its exit
code, before anything else:

| `limit-guard status` says | Do |
|---|---|
| `running` | Resume the task from your summary. |
| `PAUSED (auto)` | Write nothing new; schedule the next hop and end the turn. |
| `PAUSED (manual)` | Switch to the manual protocol below. |

The 3600-second cap means a long wait is a **chain of hops**, not one long sleep. Each
hop is a real billed turn, so keep the wake turn tiny: status, one line, reschedule.

## Manual mode — the reset is far away (7-day window, >10 hours out)

Waiting 30 hours in hourly hops would cost more than the work is worth.

1. **Call `PushNotification` once** — only once, and only if it is available. The gate
   records that it was sent; if the deny reason says it was already sent, skip this.
2. **Write the summary** (same 3 lines).
3. **End the turn.** Schedule nothing. A human resumes with `limit-guard resume`.

## Checking on demand

`limit-guard status` prints the one-line status, the raw per-window percentages and reset
times, the cache age, and the active thresholds. It always exits 0 — the state is in the
line it prints, not in the exit code. Use it when the user asks about usage, and before
assuming a pause is over.

If it says `cache: none`, the guard has no data — the statusline wrapper is not installed
as `statusLine.command`, or the session has not had its first API response yet. The gate
fails open in that state, so nothing is blocked; tell the user to run
`limit-guard install` and follow the printed snippet.

## Platform execution notes

Claude Code only. `rate_limits` reaches the guard through the statusline JSON, which is
the only documented machine-readable source of the live window percentages, and it only
appears for claude.ai Pro/Max sessions after the first API response. `ScheduleWakeup` and
`PushNotification` are Claude Code tools; both are exempt from the gate, as are `Bash`
commands that are *entirely* a bare `limit-guard` read-only subcommand (`status`,
`selftest`, `version`, `help`). Anything chained, redirected, or otherwise carrying shell
metacharacters is not exempt, so `limit-guard status && keep-working` is denied — run the
two separately. `resume`, `off` and `on` are **not** exempt: only the human ends a pause.
