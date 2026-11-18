#!/usr/bin/env python3
"""bobby-statusline — one status line row for caveman, ste, limit-guard, and the session.

One file, python3 standard library only. Claude Code runs this on every assistant
message, so the whole render must finish in about 50 milliseconds. A second
interpreter start costs more than the render itself, which is why this script
forks nothing: it reads its inputs, imports limit-guard in process, and prints.

Entry points, selected by argv[1]:

  (no args)    Render. Reads the statusline JSON on stdin, prints one row
               (two when the two-row layout is configured).
  install      Prints the settings.json snippet with this file's path filled in.
               Touches no file.
  demo [name]  Renders a fixture at several widths in a throwaway config
               directory, so the row can be looked at before anything is
               installed. Writes nothing outside that directory.
  --selftest   Renders the built-in fixtures and reports p95 render time.

Design invariants:
  * NEVER raise. A traceback on stdout becomes the status line. Every fallible
    step is wrapped; a broken segment is omitted, and a broken render prints an
    empty line and exits 0.
  * Never echo raw bytes from a file. Flag files and JSON strings are stripped
    of control characters and length-capped before they reach the terminal.
  * Refuse symlinks on every path read. A local attacker who can plant a symlink
    must not be able to have the status line render ~/.ssh/id_rsa every keystroke.
  * limit-guard owns its own cache, state, and pause logic. This script calls it,
    it does not reimplement it.
  * The usage ledger is the only thing this script writes. It runs only when
    the cost segment shows an estimate, it stops reading at LEDGER_BUDGET_MS,
    and every failure in it is swallowed.
  * No network. This script imports no module that can open a connection, and
    a render starts no process.
"""

from __future__ import annotations

import binascii
import glob
import io
import json
import os
import re
import stat
import sys
import time

VERSION = "0.3.0"

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------


def config_home() -> str:
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(
        os.path.expanduser("~"), ".claude"
    )


CONFIG_FILE = "bobby-statusline.json"
CAVEMAN_FLAG = ".caveman-active"
STE_FLAG = ".ste-active"


# --------------------------------------------------------------------------
# Safe IO
# --------------------------------------------------------------------------


def read_text(path: str, limit: int = 65536) -> str | None:
    """Read a regular file, refusing symlinks and pipes. None on absence or any error."""
    try:
        if os.path.islink(path):
            return None
        fd = open_regular(path)
    except OSError:
        return None
    try:
        with os.fdopen(fd, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read(limit)
    except OSError:
        return None


def read_json(path: str) -> dict | None:
    raw = read_text(path)
    if not raw:
        return None
    try:
        val = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return val if isinstance(val, dict) else None


# C0, DEL, C1, and the bidi overrides. C1 matters because 0x9b is a second
# CSI introducer in some terminals, and the bidi marks can visually reorder a
# row so that a low percentage reads as a high one.
CONTROL = re.compile(r"[\x00-\x1f\x7f\u0080-\u009f\u202a-\u202e\u2066-\u2069]")


def clean(text, cap: int = 64) -> str:
    """Strip control characters and cap the length. Everything printed passes here."""
    if not isinstance(text, str):
        text = "" if text is None else str(text)
    return CONTROL.sub("", text)[:cap]


# --------------------------------------------------------------------------
# Configuration: defaults < JSON file < environment
# --------------------------------------------------------------------------

PRIORITY = [
    "paused",
    "vim",
    "flags",
    "ctx",
    "five_hour",
    "seven_day",
    "cost",
    "cache",
    "model",
    "effort",
    "mode",
    "agent",
    "pr",
    "worktree",
    "lines",
]

DEFAULTS = {
    "layout": "one-row",  # one-row | two-row
    "billing": "auto",  # auto | plan | cost | both
    "cost_source": "auto",  # auto | payload | estimate
    "glyphs": "ascii",  # ascii | unicode
    "color": True,
    "separator": " | ",
    "segments": {key: True for key in PRIORITY},
    "priority": list(PRIORITY),
    "prices": {},
}
DEFAULTS["segments"]["worktree"] = False

ENUMS = {
    "layout": ("one-row", "two-row"),
    "billing": ("auto", "plan", "cost", "both"),
    "glyphs": ("ascii", "unicode"),
    "cost_source": ("auto", "payload", "estimate"),
}

# The two-row layout splits by meaning, not by width: a segment never jumps rows
# because a number grew.
IDENTITY_ROW = ("paused", "vim", "flags", "model", "effort", "mode", "agent", "pr", "worktree")


def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULTS))  # deep copy, stdlib only

    stored = read_json(os.path.join(config_home(), CONFIG_FILE)) or {}
    for key in ("layout", "billing", "cost_source", "glyphs", "separator"):
        if isinstance(stored.get(key), str):
            cfg[key] = stored[key]
    if isinstance(stored.get("color"), bool):
        cfg["color"] = stored["color"]
    if isinstance(stored.get("segments"), dict):
        # Sparse: the file lists only what differs from the default.
        for key, val in stored["segments"].items():
            if key in cfg["segments"] and isinstance(val, bool):
                cfg["segments"][key] = val
    if isinstance(stored.get("priority"), list):
        cfg["priority"] = _merge_priority(stored["priority"])
    if isinstance(stored.get("prices"), dict):
        cfg["prices"] = _user_prices(stored["prices"])

    env = os.environ
    for key in ("layout", "billing", "cost_source", "glyphs", "separator"):
        val = env.get("BOBBY_STATUSLINE_" + key.upper())
        if val:
            cfg[key] = val
    if env.get("BOBBY_STATUSLINE_COLOR"):
        cfg["color"] = env["BOBBY_STATUSLINE_COLOR"] not in ("0", "false", "no")
    if env.get("NO_COLOR"):
        cfg["color"] = False
    # Delta list, not a full set: "+worktree,-agent" turns two segments around
    # and leaves the rest of the configuration alone.
    for item in (env.get("BOBBY_STATUSLINE_SEGMENTS") or "").split(","):
        item = item.strip()
        if len(item) > 1 and item[0] in "+-" and item[1:] in cfg["segments"]:
            cfg["segments"][item[1:]] = item[0] == "+"
    if env.get("BOBBY_STATUSLINE_PRIORITY"):
        cfg["priority"] = _merge_priority(
            [p.strip() for p in env["BOBBY_STATUSLINE_PRIORITY"].split(",")]
        )

    # An unknown enum value is a typo, not an instruction. Fall back rather than
    # render something the user did not ask for.
    for key, allowed in ENUMS.items():
        if cfg[key] not in allowed:
            cfg[key] = DEFAULTS[key]
    cfg["separator"] = clean(cfg["separator"], 8) or DEFAULTS["separator"]
    return cfg


def _user_prices(raw: dict) -> dict:
    """The valid rows of the `prices` key. A malformed row is ignored."""
    out = {}
    for key, val in raw.items():
        if not isinstance(key, str) or not key.strip() or len(out) >= 256:
            continue
        row = price_row(val)
        if row is not None:
            out[key.strip().lower()[:128]] = row
    return out


def _merge_priority(order) -> list:
    """Honor the user's order, then append anything they did not mention.

    A segment missing from a hand-written list must not silently vanish, so it
    lands at the end, which is where the least protected segments live anyway.
    """
    seen = [k for k in order if isinstance(k, str) and k in PRIORITY]
    return seen + [k for k in PRIORITY if k not in seen]


# --------------------------------------------------------------------------
# limit-guard bridge
# --------------------------------------------------------------------------


def limit_guard_gate_path() -> str | None:
    """Locate limit-guard's gate script. Explicit path, sibling, then the cache."""
    explicit = os.environ.get("BOBBY_STATUSLINE_LIMIT_GUARD")
    if explicit:
        return explicit if os.path.isfile(explicit) else None

    here = os.path.dirname(os.path.abspath(__file__))
    sibling = os.path.join(
        os.path.dirname(os.path.dirname(here)), "limit-guard", "hooks", "limit-guard-gate.py"
    )
    if os.path.isfile(sibling):
        return sibling

    # One bounded glob. The plugin cache nests by marketplace and version, and
    # neither is knowable from here.
    pattern = os.path.join(
        config_home(), "plugins", "cache", "*", "limit-guard", "*", "hooks", "limit-guard-gate.py"
    )
    found = glob.glob(pattern)
    if not found:
        return None
    # Highest version, not the lexically last path: plain string order puts
    # "0.9.0" after "0.10.0", which would pin an old copy forever.
    return max(found, key=_version_key)


def _version_key(path: str):
    """Sort key from the version directory in a plugin-cache path."""
    parts = path.split(os.sep)
    version = parts[-3] if len(parts) >= 3 else ""
    numbers = []
    for chunk in re.split(r"[._-]", version):
        numbers.append(int(chunk) if chunk.isdigit() else 0)
    return (numbers, path)


def limit_guard_module():
    """Import limit-guard's gate in this process. None when it is not installed.

    In process, not as a subprocess: a second python3 start measures about 18ms
    on its own, which is more than this whole render is allowed to cost.
    """
    path = limit_guard_gate_path()
    if not path or os.path.islink(path):
        return None
    try:
        import importlib.util

        spec = importlib.util.spec_from_file_location("_lg_gate", path)
        if spec is None or spec.loader is None:
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception:
        return None


def limit_guard_capture(mod, stdin_text: str) -> None:
    """Have limit-guard write its own cache and advance its own pause state.

    `capture` is the badge-free entry point. Older copies of limit-guard only
    have `run_capture`, which also prints a badge, so that output is swallowed
    rather than allowed to land in the middle of our line.
    """
    if mod is None:
        return
    try:
        if hasattr(mod, "capture"):
            mod.capture(stdin_text)
        elif hasattr(mod, "run_capture"):
            import contextlib

            with contextlib.redirect_stdout(io.StringIO()):
                mod.run_capture(stdin_text)
    except Exception:
        pass


def limit_guard_state(mod) -> dict:
    """Read the pause state. Fail open: any doubt means 'not paused'."""
    try:
        if mod is not None and hasattr(mod, "load_state"):
            state = mod.load_state()
            if isinstance(state, dict):
                return state
    except Exception:
        pass
    # limit-guard's own base_dir() honors LIMIT_GUARD_HOME, so a fallback that
    # ignored it would read the wrong file and always report "not paused".
    base = os.environ.get("LIMIT_GUARD_HOME") or os.path.join(config_home(), "limit-guard")
    stored = read_json(os.path.join(base, "state.json")) or {}
    return {
        "paused": bool(stored.get("paused")),
        "manual": bool(stored.get("manual")),
        "until": _num(stored.get("until"), 0.0),
    }


def _num(val, fallback=0.0) -> float:
    try:
        num = float(val)
    except (TypeError, ValueError):
        return fallback
    # NaN and infinity are not numbers a row can show.
    return num if num - num == 0 else fallback


def _obj(data: dict, key: str) -> dict:
    """A field of the payload that should be an object. Anything else is absent."""
    val = data.get(key)
    return val if isinstance(val, dict) else {}


def _cost(val):
    """The payload cost as a float, or None when it is not a finite number.

    A numeric string counts: the payload is JSON from another program.
    """
    if isinstance(val, bool) or not isinstance(val, (int, float, str)):
        return None
    try:
        num = float(val)
    except ValueError:
        return None
    return num if num - num == 0 else None


# --------------------------------------------------------------------------
# Badges
# --------------------------------------------------------------------------

CAVEMAN_MODES = {
    "off", "lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-full",
    "wenyan-ultra", "commit", "review", "compress",
}


def caveman_badge() -> str | None:
    """Same hardening as caveman's own script: 64 bytes, whitelist, silent-empty."""
    raw = read_text(os.path.join(config_home(), CAVEMAN_FLAG), limit=64)
    if raw is None:
        return None
    mode = re.sub(r"[^a-z0-9-]", "", raw.strip().lower())
    if mode not in CAVEMAN_MODES:
        return None
    if mode in ("", "full"):
        return "[CAVEMAN]"
    return "[CAVEMAN:%s]" % mode.upper()


def ste_badge() -> str | None:
    """Reads the flag file ste writes. The JSON state file is ste's own business."""
    raw = read_text(os.path.join(config_home(), STE_FLAG), limit=64)
    if raw is None:
        return None
    val = re.sub(r"[^a-z0-9-]", "", raw.strip().lower())
    return "[STE]" if val in ("", "on", "1", "true", "ste") else None


# --------------------------------------------------------------------------
# Formatting
# --------------------------------------------------------------------------

GLYPHS = {
    "ascii": {"reset": ">", "dot": "+", "branch": "git:"},
    "unicode": {"reset": "↻", "dot": "·", "branch": "⎇ "},
}


def fmt_short(ts: float, now: float) -> str:
    """'03:20' when the reset is today, 'Wed 11:00' when it is not.

    A bare '11:00' on a window that resets in three days reads as this morning.
    """
    lt, ln = time.localtime(ts), time.localtime(now)
    if (lt.tm_year, lt.tm_yday) == (ln.tm_year, ln.tm_yday):
        return time.strftime("%H:%M", lt)
    return time.strftime("%a %H:%M", lt)


def fmt_tokens(n: float) -> str:
    n = int(n)
    if n >= 1_000_000:
        text = "%.1fM" % (n / 1_000_000)
        return text.replace(".0M", "M")
    if n >= 1000:
        return "%dk" % (n // 1000)
    return str(n)


# 256-color codes, mid-palette so they read on a light and a dark background.
# Red belongs to exactly one condition: a usage window at 95% or above.
C_OK, C_WARN, C_HOT, C_RED = 108, 179, 173, 160
C_COST, C_AGENT, C_GREY, C_DIM = 109, 110, 245, 244
C_CAVEMAN, C_STE = 173, 109
C_ADD, C_DEL = 108, 174
VIM_COLORS = {"INSERT": 114, "NORMAL": 111, "VISUAL": 176, "VISUAL LINE": 176}
PR_COLORS = {"approved": C_OK, "pending": C_DIM, "changes_requested": C_HOT, "draft": C_DIM}


def usage_color(pct: float) -> int:
    if pct >= 95:
        return C_RED
    if pct >= 90:
        return C_HOT
    if pct >= 70:
        return C_WARN
    return C_OK


def paint(text: str, code: int | None, enabled: bool) -> str:
    if not enabled or code is None:
        return text
    return "\033[38;5;%dm%s\033[0m" % (code, text)


# --------------------------------------------------------------------------
# Prompt cache
# --------------------------------------------------------------------------

# Claude Code sends two TTL values, "5m" and "1h". The pattern accepts any
# "<n>s|m|h" so a third value renders instead of vanishing.
TTL_RE = re.compile(r"^([0-9]{1,4})([smh])$")
TTL_UNIT = {"s": 1, "m": 60, "h": 3600}

# The warm segment turns amber when less than this share of the TTL is left:
# 1 minute of a 5m TTL, 12 minutes of a 1h TTL.
CACHE_WARN_SHARE = 0.2

# Short labels for prompt_cache.last_miss_cause.causes. An unknown cause name
# renders as itself, cleaned, rather than disappearing.
MISS_LABELS = {
    "system_prompt_changed": "system",
    "tools_changed": "tools",
    "defer_loading_changed": "tools",
    "model_changed": "model",
    "fast_mode_changed": "fast",
    "cache_scope_or_ttl_changed": "ttl",
    "betas_changed": "betas",
    "effort_changed": "effort",
    "thinking_mode_changed": "think",
    "thinking_display_changed": "think",
    "auto_mode_changed": "auto",
    "overage_changed": "overage",
    "extra_body_changed": "body",
    "messages_rewritten": "history",
    "ttl_expired_5m": "idle",
    "ttl_expired_1h": "idle",
    "likely_server_side": "server",
    "unknown": "?",
}


def ttl_seconds(ttl: str) -> int | None:
    m = TTL_RE.match(ttl)
    return int(m.group(1)) * TTL_UNIT[m.group(2)] if m else None


def miss_text(cache: dict) -> str:
    """'2 miss: tools' from the miss count and the last miss cause."""
    misses = int(_num(cache.get("misses"), 0))
    if misses <= 0:
        return ""
    cause = cache.get("last_miss_cause")
    names = cause.get("causes") if isinstance(cause, dict) else None
    labels = []
    for name in names if isinstance(names, list) else []:
        if not isinstance(name, str):
            continue
        label = MISS_LABELS.get(name) or re.sub(r"[^a-z0-9_]", "", clean(name, 24).lower())
        if label and label not in labels:
            labels.append(label)
    return "%d miss: %s" % (misses, "/".join(labels[:2])) if labels else "%d miss" % misses


def cache_segment(cache: dict, now: float, g: dict) -> tuple:
    """Text and color for the prompt cache, from Claude Code's prompt_cache object.

    Warm:  'cache 1h warm >17:47 91% 2 miss: tools'   the clock time is the expiry.
    Cold:  'cache 1h cold since 17:47 ~40k'           ~40k is what the next turn re-caches.
    A clock time, not a countdown: Claude Code redraws the row at expires_at, but not
    between, so a countdown would be stale and a clock time is not.
    """
    if "warm" not in cache:
        return "cache ?", C_GREY
    if cache.get("caching_observed") is False:
        # The API reported no cache reads or writes at all.
        return "cache off", C_GREY

    ttl = re.sub(r"[^0-9smh]", "", clean(cache.get("ttl") or "", 8))
    span = ttl_seconds(ttl)
    expires = _num(cache.get("expires_at"))
    # warm is computed when the payload is built. A payload that reaches the
    # renderer after expires_at describes a cache that is already cold.
    warm = bool(cache.get("warm")) and not (expires and now >= expires)

    words = ["cache"]
    if span:
        words.append(ttl)
    if warm:
        words.append("warm")
        if expires:
            words.append("%s%s" % (g["reset"], fmt_short(expires, now)))
    else:
        words.append("cold")
        if expires:
            words.append("since %s" % fmt_short(expires, now))
        recache = cache.get("recache_tokens_if_cold")
        # null means the next turn re-caches a compacted prompt of unknown size.
        if isinstance(recache, (int, float)) and recache > 0:
            words.append("~%s" % fmt_tokens(recache))

    # The first request only writes, so its hit ratio is always 0. Showing it
    # would read as a broken cache.
    ratio = cache.get("hit_ratio")
    requests = cache.get("requests")
    if isinstance(ratio, (int, float)) and not (isinstance(requests, (int, float)) and requests < 2):
        words.append("%d%%" % round(_num(ratio) * 100))

    misses = miss_text(cache)
    if misses:
        words.append(misses)

    if not warm:
        # Amber, never red. A cold cache costs money on the next request; it is
        # not the emergency that a full usage window is.
        return " ".join(words), C_WARN
    if span and expires and expires - now < span * CACHE_WARN_SHARE:
        return " ".join(words), C_WARN
    return " ".join(words), C_OK


# --------------------------------------------------------------------------
# Usage ledger: token totals from the session transcripts
# --------------------------------------------------------------------------

# On some accounts the payload carries no cost at all. The transcripts carry
# the usage of every API response, the subagents included. Reading them whole
# on every render costs far more than the render is allowed, so the ledger
# keeps a byte offset and the running totals for each transcript in a sidecar
# file and reads only what was appended.

LEDGER_BUDGET_MS = 15.0  # reading time per render. The next render continues.
LEDGER_SCHEMA = 2
LEDGER_IDS = 16  # message ids remembered per transcript
LEDGER_IDLE_S = 600  # a transcript this quiet keeps only its newest id
LEDGER_ID_FILES = 32  # transcripts that keep the whole id map, newest first
LEDGER_PRUNE_S = 30 * 86400
LEDGER_MAX_FILES = 2000
LEDGER_MAX_DIRS = 512
LEDGER_MAX_DEPTH = 3  # subagents/workflows/<id>/agent-*.jsonl
LEDGER_CHUNK = 1 << 20
LEDGER_MAX_LINE = 4 << 20  # a longer line is skipped, never held in memory
LEDGER_HEAD = 256  # bytes of a transcript that identify it
LEDGER_MAX_SIDECAR = 8 << 20
LEDGER_MAX_MODELS = 32
TOKEN_MAX = 10**15  # one stored number
TOKENS_SANE = 10**12  # a session total above this is not shown
USD_SANE = 100000.0

SESSION_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
SIDECAR_RE = re.compile(r"(?:[A-Za-z0-9_-]{1,64}\.json|\.[A-Za-z0-9_-]{1,64}\.[0-9]+\.tmp)")

# A usage tuple: input, output, cache read, cache write 5m, cache write 1h,
# web search requests.
ZERO = (0, 0, 0, 0, 0, 0)

# Totals are kept apart by how a request is priced: normal, fast, above the
# long-prompt threshold of its model, and both.
BUCKETS = ("n", "f", "a", "af")


def open_regular(path: str) -> int:
    """A read-only descriptor of a regular file. OSError for anything else.

    O_NOFOLLOW refuses a symlink. O_NONBLOCK keeps a named pipe from blocking
    the open, and the fstat then refuses it.
    """
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise OSError("not a regular file: %s" % path)
    except BaseException:
        os.close(fd)
        raise
    return fd


def _tok(val) -> int:
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        return 0
    return int(val) if 0 <= val < TOKEN_MAX else 0


def usage_tuple(usage: dict) -> list:
    created = _tok(usage.get("cache_creation_input_tokens"))
    detail = usage.get("cache_creation")
    five, hour = created, 0
    if isinstance(detail, dict):
        five = _tok(detail.get("ephemeral_5m_input_tokens"))
        hour = _tok(detail.get("ephemeral_1h_input_tokens"))
        # The top-level number is the authority. A split that does not add up
        # to it, in either direction, counts at the 5m rate, the lower one.
        if five + hour != created:
            five, hour = created, 0
    tools = usage.get("server_tool_use")
    searches = _tok(tools.get("web_search_requests")) if isinstance(tools, dict) else 0
    return [
        _tok(usage.get("input_tokens")),
        _tok(usage.get("output_tokens")),
        _tok(usage.get("cache_read_input_tokens")),
        five,
        hour,
        searches,
    ]


def _new_entry() -> dict:
    return {"off": 0, "skip": False, "ino": 0, "mt": 0, "hn": 0, "hc": 0, "t": {}, "ids": {}}


def _checked_int(val, top: int = TOKEN_MAX) -> int:
    if type(val) is not int or not 0 <= val <= top:  # bool is not int here
        raise ValueError("number")
    return val


def _checked_tuple(raw) -> list:
    if type(raw) is not list or len(raw) != 6:
        raise ValueError("tuple")
    for n in raw:
        if type(n) is not int or not 0 <= n <= TOKEN_MAX:
            raise ValueError("number")
    return raw


def _checked_totals(totals, top: int = LEDGER_MAX_MODELS + 1) -> dict:
    if type(totals) is not dict or len(totals) > top:
        raise ValueError("totals")
    for buckets in totals.values():
        if type(buckets) is not dict:
            raise ValueError("buckets")
        for name, tup in buckets.items():
            if name not in BUCKETS:
                raise ValueError("bucket")
            _checked_tuple(tup)
    return totals


def _checked_entry(raw) -> dict:
    """A sidecar entry, or ValueError. A sidecar is trusted only as far as its shape."""
    if type(raw) is not dict or len(raw) != 8:
        raise ValueError("entry")
    ids = raw.get("ids")
    if type(ids) is not dict or len(ids) > LEDGER_IDS:
        raise ValueError("entry")
    if type(raw.get("skip")) is not bool:
        raise ValueError("skip")
    _checked_int(raw.get("off"))
    _checked_int(raw.get("ino"), 2**64)
    _checked_int(raw.get("mt"), 2**63)
    _checked_int(raw.get("hn"), LEDGER_HEAD)
    _checked_int(raw.get("hc"), 2**32)
    _checked_totals(raw.get("t"))
    for tup in ids.values():
        _checked_tuple(tup)
    return raw


def _where(entry) -> tuple:
    """(offset, inode, mtime) of an entry: all that an unchanged transcript needs.

    A session can have a thousand subagent transcripts, and nearly all of them
    are finished. Their entries get this check on every render, and the full
    one only when they are read or added up again.
    """
    if type(entry) is not dict:
        raise ValueError("entry")
    off, ino, mt = entry.get("off"), entry.get("ino"), entry.get("mt")
    if type(off) is not int or type(ino) is not int or type(mt) is not int or off < 0:
        raise ValueError("entry")
    return off, ino, mt


def ledger_count(entry: dict, line: bytes, threshold) -> None:
    """Add one transcript line to an entry, if it is an API response.

    One response is written as several lines, one per content block, with the
    same message id and the same usage, so an id counts once. A later line of a
    known id adds only what grew. A `user` line can quote the usage of a finished
    subagent; the subagent's own transcript already has it, so only a line whose
    top-level type is `assistant` counts. `threshold` maps a model id to its
    long-prompt threshold, or to None.
    """
    if b'"usage"' not in line:
        return
    if b'"type":"assistant"' not in line and b'"type": "assistant"' not in line:
        return
    try:
        obj = json.loads(line)
    except (ValueError, RecursionError):
        return
    if not isinstance(obj, dict) or obj.get("type") != "assistant":
        return
    msg = obj.get("message")
    usage = msg.get("usage") if isinstance(msg, dict) else None
    if not isinstance(usage, dict):
        return

    tup = usage_tuple(usage)
    ids = entry["ids"]
    mid = msg.get("id")
    mid = clean(mid, 128) if isinstance(mid, str) and mid else None
    if mid is not None and mid in ids:
        seen = ids.pop(mid)
        delta = [max(0, new - old) for new, old in zip(tup, seen)]
        ids[mid] = [max(new, old) for new, old in zip(tup, seen)]  # newest last
    else:
        delta = tup
        if mid is not None:
            ids[mid] = tup
            while len(ids) > LEDGER_IDS:
                del ids[next(iter(ids))]
    if not any(delta):
        return

    model = msg.get("model")
    model = clean(model, 96) if isinstance(model, str) and model else "?"
    totals = entry["t"]
    if model not in totals and len(totals) >= LEDGER_MAX_MODELS:
        model = "?"
    # A request is priced on its own: its whole prompt decides its rate.
    limit = threshold(model)
    above = limit is not None and tup[0] + tup[2] + tup[3] + tup[4] > limit
    name = ("a" if above else "") + ("f" if usage.get("speed") == "fast" else "") or "n"
    bucket = totals.setdefault(model, {}).setdefault(name, list(ZERO))
    for i, n in enumerate(delta):
        bucket[i] = min(TOKEN_MAX, bucket[i] + n)


def ledger_scan(path: str, entry: dict, info, deadline: float, threshold) -> bool:
    """Read what was appended to one transcript. False when the time ran out.

    The offset moves only past complete lines, so a line that Claude Code is
    still writing is read by a later render. The clock is looked at only after
    the offset moved, so every call makes progress. A line longer than
    LEDGER_MAX_LINE is not held: the `skip` flag and the offset record how far
    into it the scan is, and a later render goes on from there.
    """
    with os.fdopen(open_regular(path), "rb") as fh:
        head = fh.read(LEDGER_HEAD)
        if entry["hn"] and binascii.crc32(head[: entry["hn"]]) != entry["hc"]:
            # Other content under the same name. The totals belong to the old one.
            entry.update(_new_entry())
        entry["ino"], entry["mt"] = info.st_ino, info.st_mtime_ns
        entry["hn"], entry["hc"] = len(head), binascii.crc32(head)
        fh.seek(entry["off"])
        held, size = [], 0
        while True:
            chunk = fh.read(LEDGER_CHUNK)
            if not chunk:
                return True
            if entry["skip"]:
                cut = chunk.find(b"\n")
                if cut < 0:
                    entry["off"] += len(chunk)
                    if time.perf_counter() >= deadline:
                        return False
                    continue
                entry["off"] += cut + 1
                entry["skip"] = False
                chunk = chunk[cut + 1:]
            end = chunk.rfind(b"\n")
            if end < 0:
                held.append(chunk)
                size += len(chunk)
                if size > LEDGER_MAX_LINE:
                    entry["off"] += size
                    entry["skip"] = True
                    held, size = [], 0
                    if time.perf_counter() >= deadline:
                        return False
                continue
            held.append(chunk[:end])
            buf = b"".join(held)
            held, size = [chunk[end + 1:]], len(chunk) - end - 1
            used, whole = 0, len(buf) + 1
            for line in buf.split(b"\n"):
                ledger_count(entry, line, threshold)
                used += len(line) + 1
                if used < whole and time.perf_counter() >= deadline:
                    entry["off"] += used
                    return False
            entry["off"] += whole


def ledger_files(transcript: str) -> list:
    """(key, path) of every subagent transcript of a session, symlinks refused."""
    session = transcript[: -len(".jsonl")]
    if os.path.islink(session):
        return []
    stack, found, scanned = [(os.path.join(session, "subagents"), "", 1)], [], 0
    while stack and scanned < LEDGER_MAX_DIRS and len(found) < LEDGER_MAX_FILES:
        path, rel, depth = stack.pop()
        scanned += 1
        try:
            if os.path.islink(path):
                continue
            with os.scandir(path) as it:
                for item in it:
                    name = item.name
                    if item.is_symlink():
                        continue
                    if item.is_dir(follow_symlinks=False):
                        if depth < LEDGER_MAX_DEPTH:
                            stack.append((item.path, rel + name + "/", depth + 1))
                    elif (
                        name.startswith("agent-")
                        and name.endswith(".jsonl")
                        and item.is_file(follow_symlinks=False)
                    ):
                        found.append((rel + name, item.path))
                        if len(found) >= LEDGER_MAX_FILES:
                            break
        except OSError:
            continue
    found.sort()
    return found


def ledger_dir() -> str:
    return os.path.join(config_home(), "bobby-statusline", "usage")


def ledger_dir_ok() -> bool:
    """False when the ledger directory or its parent is something else than a directory."""
    for folder in (os.path.dirname(ledger_dir()), ledger_dir()):
        try:
            if not stat.S_ISDIR(os.lstat(folder).st_mode):  # a symlink is not one to lstat
                return False
        except FileNotFoundError:
            return True  # nothing below it exists either
        except OSError:
            return False
    return True


def ledger_load(path: str, transcript: str, tiers: list) -> dict | None:
    """The sidecar of a session. None means start from zero.

    The entries of the subagent transcripts are not checked here: see _where().
    """
    try:
        with os.fdopen(open_regular(path), "rb") as fh:
            raw = json.loads(fh.read(LEDGER_MAX_SIDECAR))
        if not isinstance(raw, dict) or raw.get("v") != LEDGER_SCHEMA:
            return None
        if raw.get("path") != transcript or type(raw.get("sub")) is not dict:
            return None
        # The thresholds decided which bucket a request went to.
        if raw.get("tiers") != tiers or type(raw.get("cur")) is not str:
            return None
        live = raw.get("live")
        if type(live) is not list or len(live) > 2 * LEDGER_ID_FILES or len(raw["sub"]) > LEDGER_MAX_FILES:
            return None
        if not all(type(key) is str for key in live):
            return None
        _checked_entry(raw.get("main"))
        _checked_totals(raw.get("sum"), 4 * LEDGER_MAX_MODELS)
        return {key: raw[key] for key in ("cur", "live", "main", "sub", "sum")}
    except (OSError, ValueError, RecursionError):
        return None


def ledger_save(session_id: str, transcript: str, tiers: list, state: dict) -> None:
    """Write the sidecar: temp file in the same directory, then rename."""
    for folder in (os.path.dirname(ledger_dir()), ledger_dir()):
        try:
            os.mkdir(folder, 0o700)
            os.chmod(folder, 0o700)
        except FileExistsError:
            pass
        if not stat.S_ISDIR(os.lstat(folder).st_mode):
            raise OSError("not a directory: %s" % folder)
    dest = os.path.join(ledger_dir(), session_id + ".json")
    fresh = not os.path.lexists(dest)
    if not fresh and not stat.S_ISREG(os.lstat(dest).st_mode):
        raise OSError("not a regular file: %s" % dest)

    body = json.dumps(
        {
            "v": LEDGER_SCHEMA,
            "path": transcript,
            "tiers": tiers,
            "cur": state["cur"],
            "live": state["live"],
            "main": state["main"],
            "sub": state["sub"],
            "sum": state["sum"],
        },
        separators=(",", ":"),
    ).encode("utf-8")
    tmp = os.path.join(ledger_dir(), ".%s.%d.tmp" % (session_id, os.getpid()))
    try:
        os.unlink(tmp)
    except OSError:
        pass
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(tmp, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(body)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    if fresh:
        ledger_prune(time.time())


def ledger_prune(wall: float) -> None:
    """Delete sidecars of sessions that ended long ago. Runs once per new session."""
    try:
        with os.scandir(ledger_dir()) as it:
            for item in it:
                try:
                    if not SIDECAR_RE.fullmatch(item.name) or item.is_symlink():
                        continue
                    info = item.stat(follow_symlinks=False)
                    if stat.S_ISREG(info.st_mode) and wall - info.st_mtime > LEDGER_PRUNE_S:
                        os.unlink(item.path)
                except OSError:
                    continue
    except OSError:
        pass


def _merge_totals(into: dict, totals: dict) -> None:
    for model, buckets in totals.items():
        for name, tup in buckets.items():
            bucket = into.setdefault(model, {}).setdefault(name, list(ZERO))
            for i, n in enumerate(tup):
                bucket[i] += n


def ledger_totals(data: dict, table: dict | None = None) -> dict | None:
    """Token totals of the session: {'main', 'sub', 'partial', 'read'}, or None.

    `main` and `sub` map a model id to its buckets, {'n': tuple, 'f': tuple, ...}.
    `table` is the price table, which holds the long-prompt thresholds. None
    means there is nothing to estimate from: no transcript, no usable session
    id, or a failure. This function never raises.
    """
    if table is None:
        table = price_table()
    try:
        return _ledger_totals(data, table, False)
    except Exception:
        pass
    try:
        # A sidecar that passed the load and is broken further in. Without it.
        return _ledger_totals(data, table, True)
    except Exception:
        return None


def _ledger_totals(data: dict, table: dict, fresh: bool) -> dict | None:
    session_id = data.get("session_id")
    transcript = data.get("transcript_path")
    if not isinstance(session_id, str) or not SESSION_ID_RE.fullmatch(session_id):
        return None
    if not isinstance(transcript, str) or not transcript.endswith(".jsonl"):
        return None
    if not os.path.isabs(transcript) or "\x00" in transcript:
        return None
    try:
        if not stat.S_ISREG(os.lstat(transcript).st_mode):
            return None
    except OSError:
        return None
    if not ledger_dir_ok():
        return None

    tiers = price_tiers(table)
    sidecar = os.path.join(ledger_dir(), session_id + ".json")
    state = None if fresh else ledger_load(sidecar, transcript, tiers)
    if state is None:
        state = {"cur": "", "live": [], "main": _new_entry(), "sub": {}, "sum": {}}

    # First every file is looked at, which is one lstat each and has no time
    # limit: without it "nothing changed" cannot be told from "not looked at".
    dirty, resum, mtimes, pending = False, False, {}, []
    for key, path in [("", transcript)] + ledger_files(transcript):
        try:
            info = os.lstat(path)
        except OSError:
            continue
        if not stat.S_ISREG(info.st_mode):
            continue
        mtimes[key] = info.st_mtime
        entry = state["sub"].get(key) if key else state["main"]
        known = entry is not None
        if not known:
            entry, off, mt = _new_entry(), 0, 0
        else:
            off, ino, mt = _where(entry)
            if info.st_size < off or (ino and ino != info.st_ino):
                # Truncated or replaced. The totals belong to bytes that are gone.
                entry.clear()
                entry.update(_new_entry())
                off, mt, dirty, resum = 0, 0, True, resum or bool(key)
        if info.st_size != off or (mt and mt != info.st_mtime_ns):
            # More bytes, or the same number of bytes written at another time.
            # The second case costs one open, which compares the first bytes.
            pending.append((key, path, entry, info, known))

    # Then the reading, inside the time limit. It starts after the file the
    # last render read, so a file that never stops growing cannot starve the
    # others.
    start = next((i for i, item in enumerate(pending) if item[0] >= state["cur"]), 0)
    pending = pending[start:] + pending[:start]
    cache = {}

    def threshold(model):
        if model not in cache:
            hit = price_for(model, table)
            cache[model] = hit[0][5][0] if hit and hit[0][5] else None
        return cache[model]

    partial, read, cursor, touched = False, 0, "", set()
    deadline = time.perf_counter() + LEDGER_BUDGET_MS / 1000.0
    for i, (key, path, entry, info, known) in enumerate(pending):
        if i and time.perf_counter() >= deadline:
            partial, cursor = True, key
            break
        if known:
            _checked_entry(entry)
        before = entry["off"]
        try:
            done = ledger_scan(path, entry, info, deadline, threshold)
        except OSError:
            continue
        read += max(0, entry["off"] - before)
        dirty = True
        touched.add(key)
        if key:
            state["sub"][key] = entry
            resum = True
        if not done:
            partial = True
            cursor = pending[i + 1][0] if i + 1 < len(pending) else ""
            break

    if resum:
        # The sum of the subagent transcripts is kept, so a render that found
        # none of them changed does not add up a thousand entries.
        state["sum"] = {}
        for entry in state["sub"].values():
            _merge_totals(state["sum"], _checked_totals(entry.get("t") if type(entry) is dict else None))
    if dirty:
        state["cur"] = cursor
        # The whole id map is for the transcripts that are being written now.
        # Every other one keeps its newest id, which is the one that the next
        # line of a resumed transcript can still belong to. `live` names the
        # entries that still have a whole map, so only those are visited.
        wall = time.time()
        named = touched.union(state["live"])
        live = sorted(
            (key for key in named if key in mtimes and wall - mtimes[key] <= LEDGER_IDLE_S),
            key=mtimes.get, reverse=True,
        )[:LEDGER_ID_FILES]
        for key in named.difference(live):
            entry = state["sub"].get(key) if key else state["main"]
            if entry is not None and len(_checked_entry(entry)["ids"]) > 1:
                newest = next(reversed(entry["ids"]))
                entry["ids"] = {newest: entry["ids"][newest]}
        state["live"] = live
        try:
            ledger_save(session_id, transcript, tiers, state)
        except OSError:
            # The totals of this render are still right. Without a sidecar the
            # next render starts from zero again.
            pass

    return {"main": state["main"]["t"], "sub": state["sum"], "partial": partial, "read": read}


# --------------------------------------------------------------------------
# Prices
# --------------------------------------------------------------------------

# USD per million tokens: input, output, cache read. List prices of the
# Claude API. A partner platform has its own list; the `prices` key of the
# configuration file overrides a row.
PRICES = {
    "claude-fable-5-2": (8, 40, 0.20),
    "claude-fable-5-1": (10, 50, 0.25),
    "claude-fable-5": (10, 50, 1.00),
    "claude-mythos-5-2": (8, 40, 0.20),
    "claude-mythos-5-1": (10, 50, 0.25),
    "claude-mythos-5": (10, 50, 1.00),
    "claude-opus-5-5": (4, 20, 0.20),
    "claude-opus-5": (5, 25, 0.50),
    "claude-opus-4-8": (5, 25, 0.50),
    "claude-opus-4-7": (5, 25, 0.50),
    "claude-opus-4-6": (5, 25, 0.50),
    "claude-sonnet-5-5": (2, 10, 0.10),
    "claude-sonnet-5": (2, 10, 0.20),
    "claude-sonnet-4-6": (3, 15, 0.30),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
    "claude-haiku-4-5": (1, 5, 0.10),
}
# Long-prompt rates: prompt tokens above which a whole request pays them, then
# input, output, cache read. The prompt is input plus cache read plus cache
# writes of that one request.
PRICE_TIERS = {
    "claude-haiku-5-5": (100000, 0.50, 2.50, 0.05),
}
CACHE_WRITE_5M, CACHE_WRITE_1H = 1.25, 2.0  # multiples of the input price
WEB_SEARCH_USD = 0.01  # per request
FAST_FACTOR = 2.0  # on the token prices
PRICE_MAX = 100000.0  # USD per million tokens. Above this a row is a mistake.
THRESHOLD_MAX = 10**9

MODEL_TAIL = re.compile(r"(?:\[1m\]|-v[0-9]+(?::[0-9]+)?|-[0-9]{8})$")
FAST_TAIL = "-fast"


def _rates(inp, out, read) -> tuple:
    return (inp, out, read, inp * CACHE_WRITE_5M, inp * CACHE_WRITE_1H)


def _price_num(val, top: float = PRICE_MAX):
    """A price as a float, or None. NaN and infinity fail the comparison."""
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        return None
    return float(val) if 0 <= val <= top else None


def _price_keys(raw: dict):
    """Five prices from an object row, or None.

    `input`, `output`, `cacheRead` and `cacheWrite` are the names of Claude
    Code's `modelPricing` setting. That setting has one cache write price;
    `cacheWrite5m` and `cacheWrite1h` give the two apart.
    """
    five = raw.get("cacheWrite5m", raw.get("cacheWrite"))
    hour = raw.get("cacheWrite1h", raw.get("cacheWrite"))
    vals = [_price_num(v) for v in (raw.get("input"), raw.get("output"), raw.get("cacheRead"), five, hour)]
    return None if None in vals else vals


def price_row(val):
    """One row of the `prices` key as (5 prices..., tier), or None when malformed.

    A row is a list of five numbers, or an object. An object can carry a
    `multiplier` on all its prices and an `above` object: a `threshold` in
    prompt tokens and the prices of a request above it.
    """
    if isinstance(val, list):
        vals = [_price_num(v) for v in val]
        return tuple(vals) + (None,) if len(vals) == 5 and None not in vals else None
    if not isinstance(val, dict):
        return None
    vals = _price_keys(val)
    factor = _price_num(val.get("multiplier", 1), 1000.0)
    if vals is None or factor is None:
        return None
    tier = None
    above = val.get("above")
    if above is not None:
        if not isinstance(above, dict):
            return None
        limit = above.get("threshold")
        high = _price_keys(above)
        if isinstance(limit, bool) or not isinstance(limit, int) or high is None:
            return None
        if not 0 < limit <= THRESHOLD_MAX:
            return None
        tier = (limit,) + tuple(p * factor for p in high)
    return tuple(p * factor for p in vals) + (tier,)


def model_name(model: str) -> tuple:
    """('claude-opus-5-5', fast) from any written form of a model id.

    Lower case, no provider prefix, no `@` suffix, no `[1m]`, version or date
    suffix. `fast` is True for a deployment name that ends in `-fast`.
    """
    name = model.strip().lower()
    cut = name.find("anthropic.")
    if cut >= 0:
        name = name[cut + len("anthropic."):]
    name = name.split("@", 1)[0]
    fast = False
    while True:
        short = MODEL_TAIL.sub("", name)
        if short.endswith(FAST_TAIL):
            short, fast = short[: -len(FAST_TAIL)], True
        if short == name:
            return name, fast
        name = short


def normalise_model(model: str) -> str:
    """'us.anthropic.claude-opus-5-5-20260101-v1:0' -> 'claude-opus-5-5'."""
    return model_name(model)[0]


def price_table(user: dict | None = None) -> dict:
    """The built-in rows and the user's rows, ready for price_for().

    A user row is found first by its key as written, then by the model the key
    names, so a key covers the dated and provider forms of its own model and
    no other version. A user row that matches always wins over a built-in row.
    """
    builtin = {}
    for key, base in PRICES.items():
        tier = PRICE_TIERS.get(key)
        builtin[key] = _rates(*base) + (((tier[0],) + _rates(*tier[1:])) if tier else None,)
    exact, named = {}, {}
    for key in sorted(user or {}):
        row = user[key]
        exact[key] = row
        name, fast = model_name(key)
        if fast:
            continue  # a `-fast` key prices that one deployment name only
        if name not in named or key == name:
            named[name] = row
    return {"exact": exact, "named": named, "builtin": builtin, "hits": {}}


def price_tiers(table: dict) -> list:
    """Every long-prompt threshold in the table, in a form a sidecar can hold."""
    out = []
    for kind in ("exact", "named", "builtin"):
        for key, row in table[kind].items():
            # A user row is listed with or without a threshold: it can take
            # the place of a built-in row that has one.
            if row[5] or kind != "builtin":
                out.append([kind, key, row[5][0] if row[5] else 0])
    out.sort()
    return out


def price_for(model: str, table: dict):
    """(row, fast) for a model id, or None when no row is for this model.

    There is no prefix match: `claude-opus-5-1` is not `claude-opus-5`, and an
    unknown model gets no price instead of the price of another one.
    """
    hits = table["hits"]
    if model in hits:
        return hits[model]
    raw = model.strip().lower()
    hit = None
    if raw in table["exact"]:
        hit = (table["exact"][raw], False)
    else:
        name, fast = model_name(raw)
        row = table["named"].get(name) or table["builtin"].get(name)
        if row is not None:
            hit = (row, fast)
    if len(hits) < 256:
        hits[model] = hit
    return hit


def ledger_cost(totals: dict, table: dict) -> tuple:
    """(USD, unknown) for {model: {bucket: tuple}}.

    A model with tokens and no price counts as zero and sets `unknown`. A model
    with no tokens, such as a synthetic message, is ignored.
    """
    usd, unknown = 0.0, False
    for model, buckets in totals.items():
        if not any(any(tup) for tup in buckets.values()):
            continue
        hit = price_for(model, table)
        if hit is None:
            unknown = True
            continue
        row, fast = hit
        for name, tup in buckets.items():
            rates = row[5][1:] if "a" in name and row[5] else row[:5]
            factor = FAST_FACTOR if fast or "f" in name else 1.0
            usd += sum(n * p for n, p in zip(tup[:5], rates)) / 1e6 * factor
            usd += tup[5] * WEB_SEARCH_USD
    return usd, unknown


def _tokens(totals: dict) -> int:
    return sum(sum(tup[:5]) for buckets in totals.values() for tup in buckets.values())


def estimate_text(data: dict, cfg: dict) -> str:
    """'~$1.63+? (sub $0.40)': the total with subagents, then the subagent share.

    `~` marks an estimate, `+` a scan that is not finished, `?` a model with no
    price. '$?' when there is nothing to estimate from, or when the result is
    outside any sane range.
    """
    try:
        table = price_table(cfg.get("prices"))
        result = ledger_totals(data, table)
        if result is None:
            return "$?"
        main, unknown_main = ledger_cost(result["main"], table)
        sub, unknown_sub = ledger_cost(result["sub"], table)
        if _tokens(result["main"]) + _tokens(result["sub"]) > TOKENS_SANE:
            return "$?"
        if not 0 <= main + sub <= USD_SANE:  # NaN fails this too
            return "$?"
        text = "~$%.2f" % (main + sub)
        if result["partial"]:
            text += "+"
        if unknown_main or unknown_sub:
            text += "?"
        if float("%.2f" % sub) >= 0.01:
            text += " (sub $%.2f)" % sub
        return text
    except Exception:
        return "$?"


# --------------------------------------------------------------------------
# Segments
# --------------------------------------------------------------------------


class Seg:
    """One segment, as a list of (text, color) pieces.

    Most segments are one piece. The badges and the changed-lines count carry
    more than one color, so the row is painted piece by piece rather than by
    special-casing a key at paint time.
    """

    __slots__ = ("key", "parts")

    def __init__(self, key: str, parts: list):
        self.key = key
        self.parts = parts

    @property
    def text(self) -> str:
        return "".join(text for text, _ in self.parts)

    def truncated(self, width: int) -> "Seg":
        """A copy cut to `width` visible characters, colors preserved."""
        kept, left = [], width
        for text, color in self.parts:
            if left <= 0:
                break
            kept.append((text[:left], color))
            left -= len(text[:left])
        return Seg(self.key, kept)


def build_segments(data: dict, cfg: dict, state: dict, now: float) -> list:
    g = GLYPHS[cfg["glyphs"]]
    on = cfg["segments"]
    out = []

    def add(key, text, color=None):
        if on.get(key) and text:
            out.append(Seg(key, [(text, color)]))

    def add_parts(key, parts):
        parts = [(t, c) for t, c in parts if t]
        if on.get(key) and parts:
            out.append(Seg(key, parts))

    # PAUSED first and hardest to drop. A session that is not spending tokens
    # must say so; every other segment is information, this one is a state.
    if state.get("paused"):
        tag = "PAUSED(manual)" if state.get("manual") else "PAUSED"
        until = _num(state.get("until"))
        text = tag if not until else "%s %s%s" % (tag, g["reset"], fmt_short(until, now))
        add("paused", text, C_RED)

    vim = _obj(data, "vim").get("mode")
    if isinstance(vim, str):
        mode = clean(vim, 12).upper()
        add("vim", mode, VIM_COLORS.get(mode, C_GREY))

    # Both badges live in one segment so they drop together, and each keeps its
    # own color.
    badges = [(caveman_badge(), C_CAVEMAN), (ste_badge(), C_STE)]
    badges = [(text, color) for text, color in badges if text]
    add_parts("flags", [p for pair in badges for p in ((" ", None), pair)][1:])

    ctx = _obj(data, "context_window")
    pct = ctx.get("used_percentage")
    size = _num(ctx.get("context_window_size"), 0)
    used_tokens = _num(ctx.get("total_input_tokens"), 0) + _num(ctx.get("total_output_tokens"), 0)
    if pct is None:
        add("ctx", "ctx ?%", C_GREY)
    elif size and used_tokens > size:
        # total_input_tokens includes cache reads and writes, so the sum can
        # exceed the window. The percentage is the authoritative number; a
        # token count larger than the window would read as a fault.
        add("ctx", "ctx %d%%" % _num(pct), usage_color(_num(pct)))
    elif size:
        add(
            "ctx",
            "ctx %s/%s (%d%%)" % (fmt_tokens(used_tokens), fmt_tokens(size), _num(pct)),
            usage_color(_num(pct)),
        )
    else:
        add("ctx", "ctx %d%%" % _num(pct), usage_color(_num(pct)))

    limits = _obj(data, "rate_limits")
    show_plan, show_cost = billing_view(cfg["billing"], limits)
    if show_plan:
        for key, label in (("five_hour", "5h"), ("seven_day", "7d")):
            win = limits.get(key) if isinstance(limits.get(key), dict) else None
            if not win:
                add(key, "%s ?%%" % label, C_GREY)
                continue
            wpct = _num(win.get("used_percentage"))
            resets = _num(win.get("resets_at"))
            if resets and now >= resets:
                # The window already reset, so the percentage is stale. Claude
                # Code drops such a window from the payload; this covers the gap
                # between the reset and the next render. limit-guard's own badge
                # skips it for the same reason.
                add(key, "%s ?%%" % label, C_GREY)
                continue
            stamp = "%s%s" % (g["reset"], fmt_short(resets, now)) if resets else ""
            add(key, "%s %d%% %s" % (label, wpct, stamp) if stamp else "%s %d%%" % (label, wpct),
                usage_color(wpct))
    if show_cost and on.get("cost"):
        cost = _cost(_obj(data, "cost").get("total_cost_usd"))
        source = cfg["cost_source"]
        if source == "auto":
            source = "payload" if cost is not None else "estimate"
        if source == "estimate":
            # The only branch that reads transcripts and writes the sidecar.
            add("cost", estimate_text(data, cfg), C_COST)
        else:
            add("cost", "$?" if cost is None else "$%.2f" % cost, C_COST)

    cache = data.get("prompt_cache")
    if isinstance(cache, dict):
        try:
            text, color = cache_segment(cache, now, g)
        except (ValueError, OverflowError, OSError, TypeError):
            # A timestamp outside the platform's range. Unknown, not a blank row.
            text, color = "cache ?", C_GREY
        add("cache", text, color)
    elif on.get("cache"):
        add("cache", "cache ?", C_GREY)

    name = clean(_obj(data, "model").get("display_name") or "", 32)
    add("model", name, C_GREY)

    level = clean(_obj(data, "effort").get("level") or "", 12)
    add("effort", "%s effort" % level if level else "", C_GREY)

    marks = []
    if data.get("fast_mode"):
        marks.append("fast")
    if _obj(data, "thinking").get("enabled"):
        marks.append("think")
    add("mode", g["dot"].join(marks) if marks else "", C_GREY)

    agent = clean(_obj(data, "agent").get("name") or "", 32)
    add("agent", "@%s" % agent if agent else "", C_AGENT)

    pr = _obj(data, "pr")
    if pr.get("number") is not None:
        marker = "!" if pr.get("kind") == "mr" else "#"
        review = clean(pr.get("review_state") or "", 20)
        label = "%s%s" % (marker, clean(str(pr.get("number")), 12))
        add("pr", "%s %s" % (label, review) if review else label, PR_COLORS.get(review, C_DIM))

    tree = _obj(data, "worktree")
    branch = clean(
        tree.get("branch") or tree.get("name") or _obj(data, "workspace").get("git_worktree") or "",
        40,
    )
    add("worktree", "%s%s" % (g["branch"], branch) if branch else "", C_GREY)

    cost_obj = _obj(data, "cost")
    added, removed = cost_obj.get("total_lines_added"), cost_obj.get("total_lines_removed")
    if added is not None or removed is not None:
        add_parts(
            "lines",
            [
                ("+%d" % _num(added), C_ADD),
                ("/", C_GREY),
                ("-%d" % _num(removed), C_DEL),
            ],
        )

    return out


def billing_view(mode: str, limits: dict):
    """Which of the plan segments and the cost segment this session shows.

    `rate_limits` is present only for Pro and Max subscribers, or behind a
    gateway with a spend limit, and only after the first API response. Its
    absence is therefore the billing signal, with one blind spot: the first
    render of a session, where a plan user looks like a token-cost user.
    """
    if mode == "plan":
        return True, False
    if mode == "cost":
        return False, True
    if mode == "both":
        return True, True
    has_plan = bool(limits.get("five_hour") or limits.get("seven_day"))
    return has_plan, not has_plan


# --------------------------------------------------------------------------
# Fitting and painting
# --------------------------------------------------------------------------


def columns(fallback: int = 80) -> int:
    """Claude Code sets $COLUMNS before running the script.

    It captures stdout instead of connecting it to the terminal, so `tput cols`
    and every language-level width call see nothing useful.
    """
    try:
        val = int(os.environ.get("COLUMNS", ""))
        return val if val > 0 else fallback
    except ValueError:
        return fallback


def fit(segments: list, width: int, sep: str, order: list) -> list:
    """Drop whole segments, lowest priority first, until the row fits.

    No abbreviation and no wrapping in this version. The docs say long output
    "may get truncated or wrap awkwardly", which is undefined behavior rather
    than a layout, so the row is kept inside the width by construction.
    """
    rank = {key: i for i, key in enumerate(order)}
    kept = list(segments)
    while len(kept) > 1:
        if len(sep.join(s.text for s in kept)) <= width:
            return kept
        victim = max(kept, key=lambda s: rank.get(s.key, len(rank)))
        kept.remove(victim)
    if not kept:
        return kept
    # One segment left. If even that does not fit, cut it rather than return an
    # empty row: a truncated PAUSED still tells the user the session is paused,
    # and a blank status line looks like the script crashed.
    return kept if len(kept[0].text) <= width else [kept[0].truncated(width)]


def paint_row(segments: list, sep: str, color: bool) -> str:
    return sep.join(
        "".join(paint(text, code, color) for text, code in seg.parts) for seg in segments
    )


# --------------------------------------------------------------------------
# Render
# --------------------------------------------------------------------------


def render(stdin_text: str, now: float | None = None) -> str:
    """Render the row. `now` exists so a caller can pin the clock.

    The tests pass it, and `demo` anchors it to the fixture so the sample rows
    do not go stale. A live render leaves it unset and reads the real clock.
    """
    try:
        data = json.loads(stdin_text) if stdin_text.strip() else {}
        if not isinstance(data, dict):
            data = {}
    except ValueError:
        data = {}

    cfg = load_config()
    if now is None:
        now = time.time()

    mod = limit_guard_module()
    if data:
        limit_guard_capture(mod, stdin_text)
    state = limit_guard_state(mod)

    segments = build_segments(data, cfg, state, now)
    order = cfg["priority"]
    segments.sort(key=lambda s: order.index(s.key) if s.key in order else len(order))

    width, sep, color = columns(), cfg["separator"], cfg["color"]
    if cfg["layout"] == "two-row":
        top = [s for s in segments if s.key in IDENTITY_ROW]
        bottom = [s for s in segments if s.key not in IDENTITY_ROW]
        rows = [
            paint_row(fit(top, width, sep, order), sep, color),
            paint_row(fit(bottom, width, sep, order), sep, color),
        ]
        return "\n".join(r for r in rows if r)
    return paint_row(fit(segments, width, sep, order), sep, color)


# --------------------------------------------------------------------------
# install
# --------------------------------------------------------------------------

INSTALL_TEXT = """\
bobby-statusline %s

A plugin cannot set the main statusLine: that key is the user's own, and only
`agent` and `subagentStatusLine` are plugin-settable. So this command prints the
snippet and changes nothing.

To have Claude make the edit instead, with the change shown first, run the slash
command /bobby-statusline:install.

Add to %s:

{
  "statusLine": {
    "type": "command",
    "command": "python3 %s"
  },
  "hideVimModeIndicator": true
}

hideVimModeIndicator removes the built-in "-- INSERT --" row, because this
status line renders the vim mode itself. Without it the mode appears twice.

The 5h and 7d countdowns are a snapshot taken when the row was drawn, not a
live clock. Claude Code re-runs this script on events, not on a timer. For a
ticking countdown, add "refreshInterval": 30 next to "command" above, which
costs one python3 start every 30 seconds while the session is idle.

Preferences live in %s. Every key is optional:

{
  "layout": "one-row",        // one-row | two-row
  "billing": "auto",          // auto | plan | cost | both
  "cost_source": "auto",      // auto | payload | estimate
  "glyphs": "ascii",          // ascii | unicode
  "color": true,
  "separator": " | ",
  "segments": { "worktree": true },
  "priority": [%s],
  "prices": { "claude-opus-5-5": [4, 20, 0.2, 5, 8] }
}

cost_source decides where the cost segment gets its number. "payload" shows
cost.total_cost_usd from Claude Code, which is absent on some accounts and then
shows as "$?". "estimate" sums the token usage in the session
transcripts, subagents included, against list prices, and shows it as
"~$1.63 (sub $0.40)". "auto" uses the payload number when there is one and the
estimate when there is not. The estimate keeps its progress in
%s
and writes nothing else. "prices" overrides a list price: a model id and five
numbers in USD per million tokens (input, output, cache read, cache write 5m,
cache write 1h). A row covers the dated and provider forms of its model id and
no other version.
"""


def run_install() -> int:
    here = os.path.abspath(__file__)
    sys.stdout.write(
        INSTALL_TEXT
        % (
            VERSION,
            os.path.join(config_home(), "settings.json"),
            here,
            os.path.join(config_home(), CONFIG_FILE),
            ", ".join('"%s"' % k for k in PRIORITY),
            os.path.join(ledger_dir(), "<session id>.json"),
        )
    )
    return 0


# --------------------------------------------------------------------------
# demo
# --------------------------------------------------------------------------

DEMO_WIDTHS = (200, 160, 120, 80, 60)


def fixture_now(payload: str) -> float | None:
    """A clock that makes a fixture's rate-limit windows look live.

    Fixtures carry absolute `resets_at` timestamps. Rendered against the real
    clock they eventually fall in the past, and the row correctly but uselessly
    shows `5h ?%`. Anchoring an hour before the earliest reset keeps the sample
    readable for as long as the fixture exists. Returns None when the payload
    has no window, in which case the real clock is right.
    """
    try:
        limits = (json.loads(payload) or {}).get("rate_limits") or {}
    except (ValueError, AttributeError):
        return None
    resets = [
        win["resets_at"]
        for win in limits.values()
        if isinstance(win, dict) and isinstance(win.get("resets_at"), (int, float))
    ]
    return min(resets) - 3600 if resets else None


def run_demo(argv: list) -> int:
    """Render the fixtures in a throwaway config directory, so nothing is installed.

    Looking at the row before editing settings.json is the point. This builds a
    temporary CLAUDE_CONFIG_DIR, plants sample badge flags in it, and renders
    there, so the real configuration directory is neither read nor written and
    limit-guard's cache is left alone.

    `demo` uses the real terminal size, because a shell does not export COLUMNS
    to a child process. Claude Code does set it, which is why a render trusts it.
    """
    import shutil
    import tempfile

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    wanted = argv[2] if len(argv) > 2 else "full"
    path = os.path.join(root, "tests", "fixtures", "%s.json" % wanted)
    if not os.path.isfile(path):
        names = sorted(
            os.path.basename(f)[:-5]
            for f in glob.glob(os.path.join(root, "tests", "fixtures", "*.json"))
        )
        sys.stderr.write("no such fixture: %s\nfixtures: %s\n" % (wanted, ", ".join(names)))
        return 1
    payload = read_text(path) or "{}"

    with tempfile.TemporaryDirectory(prefix="bobby-statusline-demo-") as tmp:
        os.environ["CLAUDE_CONFIG_DIR"] = tmp
        # An absent path, so the demo never imports limit-guard and never writes
        # a cache. The row still shows the windows: they come from stdin.
        os.environ["BOBBY_STATUSLINE_LIMIT_GUARD"] = os.path.join(tmp, "absent.py")
        for name, content in ((CAVEMAN_FLAG, "full"), (STE_FLAG, "on")):
            with open(os.path.join(tmp, name), "w", encoding="utf-8") as fh:
                fh.write(content)

        real = shutil.get_terminal_size(fallback=(80, 24)).columns
        widths = [real] + [w for w in DEMO_WIDTHS if w != real]
        sys.stdout.write(
            "fixture %s, config dir %s (temporary, removed on exit)\n\n" % (wanted, tmp)
        )
        for width in widths:
            os.environ["COLUMNS"] = str(width)
            label = "%d%s" % (width, " <- this terminal" if width == real else "")
            sys.stdout.write("COLUMNS %s\n" % label)
            for row in render(payload, now=fixture_now(payload)).split("\n"):
                sys.stdout.write("  %s\n" % row)
            sys.stdout.write("\n")
    return 0


# --------------------------------------------------------------------------
# selftest
# --------------------------------------------------------------------------


BUDGET_MS = 50.0


def _percentile(samples: list, fraction: float) -> float:
    return samples[max(0, int(len(samples) * fraction) - 1)]


def run_selftest() -> int:
    """Measure the render, then measure what Claude Code actually pays.

    Two numbers, because they answer different questions. The in-process figure
    says whether the rendering logic is cheap. The end-to-end figure includes
    the python3 start, which is the larger half of the cost and the reason this
    plugin forks nothing during a render. The budget applies to the second one.
    """
    import tempfile

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    paths = sorted(glob.glob(os.path.join(root, "tests", "fixtures", "*.json")))
    if not paths:
        sys.stderr.write("no fixtures found under %s\n" % root)
        return 1

    # Every render below calls limit-guard's capture, which writes its cache and
    # advances its pause state. Point that at a throwaway directory, for the
    # in-process renders and, through the inherited environment, for the child
    # processes. CLAUDE_CONFIG_DIR stays real: it is only read, and locating
    # limit-guard through it is part of what is measured.
    previous = os.environ.get("LIMIT_GUARD_HOME")
    with tempfile.TemporaryDirectory(prefix="bobby-statusline-selftest-") as tmp:
        home = os.path.join(tmp, "limit-guard")
        os.environ["LIMIT_GUARD_HOME"] = home
        sys.stdout.write("limit-guard state %s (temporary, removed on exit)\n" % home)
        try:
            return _measure(root, paths)
        finally:
            if previous is None:
                os.environ.pop("LIMIT_GUARD_HOME", None)
            else:
                os.environ["LIMIT_GUARD_HOME"] = previous


def _measure(root: str, paths: list) -> int:
    inner = []
    for path in paths:
        payload = read_text(path) or "{}"
        pinned = fixture_now(payload)
        for _ in range(20):
            start = time.perf_counter()
            render(payload, now=pinned)
            inner.append((time.perf_counter() - start) * 1000)
    inner.sort()
    sys.stdout.write(
        "render only     fixtures=%d runs=%d  median=%.2fms  p95=%.2fms\n"
        % (len(paths), len(inner), inner[len(inner) // 2], _percentile(inner, 0.95))
    )

    # Only the selftest forks. A render never does.
    import subprocess

    payload = read_text(os.path.join(root, "tests", "fixtures", "full.json")) or "{}"
    outer = []
    for _ in range(30):
        start = time.perf_counter()
        subprocess.run(
            [sys.executable, os.path.abspath(__file__)],
            input=payload, capture_output=True, text=True,
        )
        outer.append((time.perf_counter() - start) * 1000)
    outer.sort()
    p95 = _percentile(outer, 0.95)
    sys.stdout.write(
        "end to end      runs=%d  median=%.1fms  p95=%.1fms  max=%.1fms\n"
        % (len(outer), outer[len(outer) // 2], p95, outer[-1])
    )
    _measure_estimate()
    if p95 > BUDGET_MS:
        sys.stderr.write("FAIL: p95 %.1fms exceeds the %.0fms budget\n" % (p95, BUDGET_MS))
        return 1
    sys.stdout.write("OK: p95 within the %.0fms budget\n" % BUDGET_MS)
    return 0


def _measure_estimate() -> None:
    """Time the estimate on a synthetic session: the first render, then the rest.

    The fixtures have no transcript, so they never reach the ledger. This
    builds one main and three subagent transcripts in a throwaway directory
    and points CLAUDE_CONFIG_DIR at it, so the sidecar lands there too.
    """
    import tempfile

    line = json.dumps(
        {
            "type": "assistant",
            "message": {
                "id": "msg_%d",
                "model": "claude-opus-5-5",
                "usage": {"input_tokens": 1000, "output_tokens": 200, "cache_read_input_tokens": 50000},
            },
        },
        separators=(",", ":"),
    )
    filler = json.dumps({"type": "user", "message": {"content": "x" * 2000}})
    keys = ("CLAUDE_CONFIG_DIR", "BOBBY_STATUSLINE_COST_SOURCE", "BOBBY_STATUSLINE_BILLING")
    saved = {key: os.environ.get(key) for key in keys}
    with tempfile.TemporaryDirectory(prefix="bobby-statusline-selftest-") as tmp:
        session = "selftest-session"
        project = os.path.join(tmp, "projects", "sample")
        agents = os.path.join(project, session, "subagents")
        os.makedirs(agents)
        transcript = os.path.join(project, session + ".jsonl")
        names = [transcript] + [os.path.join(agents, "agent-%d.jsonl" % i) for i in range(3)]
        for n, name in enumerate(names):
            with open(name, "w", encoding="utf-8") as fh:
                for i in range(200):
                    fh.write(filler + "\n" + line % (n * 1000 + i) + "\n")
        os.environ.update(
            CLAUDE_CONFIG_DIR=tmp,
            BOBBY_STATUSLINE_COST_SOURCE="estimate",
            BOBBY_STATUSLINE_BILLING="cost",
        )
        payload = json.dumps({"session_id": session, "transcript_path": transcript})
        try:
            runs = []
            for _ in range(21):
                start = time.perf_counter()
                row = render(payload)
                runs.append((time.perf_counter() - start) * 1000)
        finally:
            for key, val in saved.items():
                if val is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = val
    steady = sorted(runs[1:])
    sys.stdout.write(
        "estimate        files=%d  first=%.2fms  then median=%.2fms  p95=%.2fms  %s\n"
        % (len(names), runs[0], steady[len(steady) // 2], _percentile(steady, 0.95),
           "ok" if "~$14.40 (sub $10.80)" in row else "WRONG ROW: %s" % clean(row, 120))
    )


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main(argv: list) -> int:
    arg = argv[1] if len(argv) > 1 else ""
    if arg == "install":
        return run_install()
    if arg == "demo":
        return run_demo(argv)
    if arg == "--selftest":
        return run_selftest()
    if arg in ("--version", "-V"):
        sys.stdout.write("bobby-statusline %s\n" % VERSION)
        return 0

    try:
        stdin_text = sys.stdin.read()
    except Exception:
        stdin_text = ""
    try:
        sys.stdout.write(render(stdin_text) + "\n")
    except Exception:
        # An empty status line is a small loss. A traceback rendered into the
        # status bar on every keystroke is not.
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
