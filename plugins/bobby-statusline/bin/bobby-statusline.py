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
"""

from __future__ import annotations

import glob
import io
import json
import os
import re
import sys
import time

VERSION = "0.1.0"

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
    """Read a file, refusing symlinks. None on absence or any error."""
    try:
        if os.path.islink(path):
            return None
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
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


CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def clean(text, cap: int = 64) -> str:
    """Strip control bytes and cap the length. Everything printed passes here."""
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
    "glyphs": "ascii",  # ascii | unicode
    "color": True,
    "separator": " | ",
    "segments": {key: True for key in PRIORITY},
    "priority": list(PRIORITY),
}
DEFAULTS["segments"]["worktree"] = False

ENUMS = {
    "layout": ("one-row", "two-row"),
    "billing": ("auto", "plan", "cost", "both"),
    "glyphs": ("ascii", "unicode"),
}

# The two-row layout splits by meaning, not by width: a segment never jumps rows
# because a number grew.
IDENTITY_ROW = ("paused", "vim", "flags", "model", "effort", "mode", "agent", "pr", "worktree")


def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULTS))  # deep copy, stdlib only

    stored = read_json(os.path.join(config_home(), CONFIG_FILE)) or {}
    for key in ("layout", "billing", "glyphs", "separator"):
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

    env = os.environ
    for key in ("layout", "billing", "glyphs", "separator"):
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
    found = sorted(glob.glob(pattern))
    return found[-1] if found else None


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
    stored = read_json(os.path.join(config_home(), "limit-guard", "state.json")) or {}
    return {
        "paused": bool(stored.get("paused")),
        "manual": bool(stored.get("manual")),
        "until": _num(stored.get("until"), 0.0),
    }


def _num(val, fallback=0.0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return fallback


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
# Segments
# --------------------------------------------------------------------------


class Seg:
    __slots__ = ("key", "text", "color")

    def __init__(self, key: str, text: str, color: int | None = None):
        self.key = key
        self.text = text
        self.color = color


def build_segments(data: dict, cfg: dict, state: dict, now: float) -> list:
    g = GLYPHS[cfg["glyphs"]]
    on = cfg["segments"]
    out = []

    def add(key, text, color=None):
        if on.get(key) and text:
            out.append(Seg(key, text, color))

    # PAUSED first and hardest to drop. A session that is not spending tokens
    # must say so; every other segment is information, this one is a state.
    if state.get("paused"):
        tag = "PAUSED(manual)" if state.get("manual") else "PAUSED"
        until = _num(state.get("until"))
        text = tag if not until else "%s %s%s" % (tag, g["reset"], fmt_short(until, now))
        add("paused", text, C_RED)

    vim = (data.get("vim") or {}).get("mode")
    if isinstance(vim, str):
        mode = clean(vim, 12).upper()
        add("vim", mode, VIM_COLORS.get(mode, C_GREY))

    # Both badges live in one segment so they drop together, but each keeps its
    # own color. paint_row resolves that per badge; the segment color stays None.
    badges = [b for b in (caveman_badge(), ste_badge()) if b]
    add("flags", " ".join(badges), None)

    ctx = data.get("context_window") or {}
    pct = ctx.get("used_percentage")
    size = _num(ctx.get("context_window_size"), 0)
    used_tokens = _num(ctx.get("total_input_tokens"), 0) + _num(ctx.get("total_output_tokens"), 0)
    if pct is None:
        add("ctx", "ctx ?%", C_GREY)
    elif size:
        add(
            "ctx",
            "ctx %s/%s (%d%%)" % (fmt_tokens(used_tokens), fmt_tokens(size), _num(pct)),
            usage_color(_num(pct)),
        )
    else:
        add("ctx", "ctx %d%%" % _num(pct), usage_color(_num(pct)))

    limits = data.get("rate_limits") or {}
    show_plan, show_cost = billing_view(cfg["billing"], limits)
    if show_plan:
        for key, label in (("five_hour", "5h"), ("seven_day", "7d")):
            win = limits.get(key) if isinstance(limits.get(key), dict) else None
            if not win:
                add(key, "%s ?%%" % label, C_GREY)
                continue
            wpct = _num(win.get("used_percentage"))
            resets = _num(win.get("resets_at"))
            stamp = "%s%s" % (g["reset"], fmt_short(resets, now)) if resets else ""
            add(key, "%s %d%% %s" % (label, wpct, stamp) if stamp else "%s %d%%" % (label, wpct),
                usage_color(wpct))
    if show_cost:
        cost = (data.get("cost") or {}).get("total_cost_usd")
        add("cost", "$?" if cost is None else "$%.2f" % _num(cost), C_COST)

    cache = data.get("prompt_cache")
    if isinstance(cache, dict):
        if cache.get("warm"):
            ratio = cache.get("hit_ratio")
            text = "cache warm" if ratio is None else "cache warm %d%%" % (_num(ratio) * 100)
            add("cache", text, C_OK)
        else:
            # Amber, never red. A cold cache costs money on the next request; it
            # is not the emergency that a full usage window is.
            add("cache", "cache cold", C_WARN)
    elif on.get("cache"):
        add("cache", "cache ?", C_GREY)

    name = clean((data.get("model") or {}).get("display_name") or "", 32)
    add("model", name, C_GREY)

    level = clean((data.get("effort") or {}).get("level") or "", 12)
    add("effort", "%s effort" % level if level else "", C_GREY)

    marks = []
    if data.get("fast_mode"):
        marks.append("fast")
    if (data.get("thinking") or {}).get("enabled"):
        marks.append("think")
    add("mode", g["dot"].join(marks) if marks else "", C_GREY)

    agent = clean((data.get("agent") or {}).get("name") or "", 32)
    add("agent", "@%s" % agent if agent else "", C_AGENT)

    pr = data.get("pr") or {}
    if pr.get("number") is not None:
        marker = "!" if pr.get("kind") == "mr" else "#"
        review = clean(pr.get("review_state") or "", 20)
        label = "%s%s" % (marker, clean(str(pr.get("number")), 12))
        add("pr", "%s %s" % (label, review) if review else label, PR_COLORS.get(review, C_DIM))

    tree = data.get("worktree") or {}
    branch = clean(
        tree.get("branch") or tree.get("name") or (data.get("workspace") or {}).get("git_worktree") or "",
        40,
    )
    add("worktree", "%s%s" % (g["branch"], branch) if branch else "", C_GREY)

    cost_obj = data.get("cost") or {}
    added, removed = cost_obj.get("total_lines_added"), cost_obj.get("total_lines_removed")
    if added is not None or removed is not None:
        add("lines", "+%d/-%d" % (_num(added), _num(removed)), C_GREY)

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
    while kept:
        if len(sep.join(s.text for s in kept)) <= width:
            return kept
        victim = max(kept, key=lambda s: rank.get(s.key, len(rank)))
        kept.remove(victim)
    return kept


def paint_row(segments: list, sep: str, color: bool) -> str:
    parts = []
    for seg in segments:
        if seg.key == "flags":
            # Two badges, each with its own color, inside one segment.
            parts.append(
                " ".join(
                    paint(b, C_CAVEMAN if b.startswith("[CAVEMAN") else C_STE, color)
                    for b in seg.text.split(" ")
                )
            )
        else:
            parts.append(paint(seg.text, seg.color, color))
    return sep.join(parts)


# --------------------------------------------------------------------------
# Render
# --------------------------------------------------------------------------


def render(stdin_text: str) -> str:
    try:
        data = json.loads(stdin_text) if stdin_text.strip() else {}
        if not isinstance(data, dict):
            data = {}
    except ValueError:
        data = {}

    cfg = load_config()
    now = _num(os.environ.get("BOBBY_STATUSLINE_NOW"), 0.0) or time.time()

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
  "glyphs": "ascii",          // ascii | unicode
  "color": true,
  "separator": " | ",
  "segments": { "worktree": true },
  "priority": [%s]
}
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
        )
    )
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
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    paths = sorted(glob.glob(os.path.join(root, "tests", "fixtures", "*.json")))
    if not paths:
        sys.stderr.write("no fixtures found under %s\n" % root)
        return 1

    inner = []
    for path in paths:
        payload = read_text(path) or "{}"
        for _ in range(20):
            start = time.perf_counter()
            render(payload)
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
    if p95 > BUDGET_MS:
        sys.stderr.write("FAIL: p95 %.1fms exceeds the %.0fms budget\n" % (p95, BUDGET_MS))
        return 1
    sys.stdout.write("OK: p95 within the %.0fms budget\n" % BUDGET_MS)
    return 0


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main(argv: list) -> int:
    arg = argv[1] if len(argv) > 1 else ""
    if arg == "install":
        return run_install()
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
