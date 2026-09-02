#!/usr/bin/env bash
# limit-guard — statusline wrapper.
#
# Claude Code pipes the session JSON to `statusLine.command` on stdin, and that
# JSON is the only documented machine-readable source of `rate_limits`. So this
# script is the plugin's data tap: it captures the JSON to disk for the
# PreToolUse gate, appends a usage badge, and — only if you ask it to — chains
# to a statusline of your own.
#
# Install (~/.claude/settings.json — a plugin cannot set the main statusLine):
#   "statusLine": {
#     "type": "command",
#     "command": "bash /abs/path/to/hooks/limit-guard-statusline.sh"
#   }
#
# `statusLine` has no `env` field, but its `command` runs in a shell, so an
# inline assignment is how you chain:
#   "command": "LIMIT_GUARD_INNER='bash /abs/path/to/your-statusline.sh' bash /abs/path/to/hooks/limit-guard-statusline.sh"
#
# Environment:
#   LIMIT_GUARD_INNER   command for the statusline to chain to, split on
#                       whitespace and executed as an argv vector -- NOT through
#                       a shell, so metacharacters in it are inert and paths
#                       containing spaces are not supported. Wrap anything more
#                       elaborate in a script of your own and point at that.
#                       Unset (or "none") -> no inner statusline. This wrapper
#                       never executes anything you did not name here.
#   LIMIT_GUARD_PYTHON  python3 interpreter (default: python3)
#   LIMIT_GUARD_HOME    state directory (default: $CLAUDE_CONFIG_DIR/limit-guard)
#   NO_COLOR            set to render the badge without ANSI colors
#
# This script MUST NEVER fail the statusline: every fallible step runs in a
# `set -euo pipefail` subshell whose failure is swallowed. The worst outcome is
# a missing badge, never a broken status bar.

# Deliberately no top-level `set -e`: see above.
set -uo pipefail 2>/dev/null || true

# An inner statusline that hangs must not take the capture down with it, so it
# is bounded. Claude Code cancels an in-flight statusline script when a new
# update arrives, and the capture is the whole point of this wrapper.
INNER_TIMEOUT_S=5

lg_dir() {
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/hooks/limit-guard-gate.py" ]; then
    printf '%s' "${CLAUDE_PLUGIN_ROOT}/hooks"
    return
  fi
  local src="${BASH_SOURCE[0]:-$0}"
  printf '%s' "$(cd -- "$(dirname -- "$src")" >/dev/null 2>&1 && pwd -P)"
}

INPUT="$(cat 2>/dev/null)" || INPUT=""

HOOK_DIR="$(lg_dir 2>/dev/null)"
PY="${LIMIT_GUARD_PYTHON:-python3}"
GATE="${HOOK_DIR}/limit-guard-gate.py"

# 1. Capture the rate_limits to disk and render the badge. This runs FIRST and
#    unconditionally: it is the data the gate depends on, and it must not be at
#    the mercy of a slow or hung inner statusline. Failure here is swallowed;
#    BADGE simply stays empty.
BADGE=""
if [ -f "$GATE" ] && [ ! -L "$GATE" ]; then
  BADGE=$(
    set -euo pipefail
    printf '%s' "$INPUT" | "$PY" "$GATE" --capture
  ) 2>/dev/null || BADGE=""
fi

# 2. Chain to the inner statusline, if the user named one, with the SAME stdin
#    JSON. Executed as an argv vector, never through `bash -c`: the value comes
#    from the environment, and running it as a shell string would make any
#    statusline config an arbitrary-command surface for whatever can set that
#    variable. Nothing is auto-detected: this wrapper executes only a command
#    the user wrote down.
INNER_ARGV=()
INNER_ERR=""
INNER="${LIMIT_GUARD_INNER:-}"
if [ -n "$INNER" ] && [ "$INNER" != "none" ]; then
  read -r -a INNER_ARGV <<<"$INNER" || INNER_ARGV=()
  # Whitespace splitting mangles a path containing a space, and there is no way
  # to tell that apart from a genuine `cmd arg` without quoting rules this has
  # deliberately not got. So: quote-free paths only, and say so in the log
  # rather than exec'ing something the user did not mean.
  if [ "${#INNER_ARGV[@]}" -gt 0 ] && ! command -v -- "${INNER_ARGV[0]}" >/dev/null 2>&1; then
    INNER_ERR="LIMIT_GUARD_INNER not executable (paths with spaces are not supported): ${INNER_ARGV[0]}"
    INNER_ARGV=()
  fi
fi

# `timeout` is coreutils and not guaranteed; without it the inner runs unbounded
# rather than not at all.
LG_TIMEOUT=()
if command -v timeout >/dev/null 2>&1; then
  LG_TIMEOUT=(timeout "$INNER_TIMEOUT_S")
fi

INNER_OUT=""
if [ "${#INNER_ARGV[@]}" -gt 0 ]; then
  INNER_OUT=$(printf '%s' "$INPUT" | ${LG_TIMEOUT[@]+"${LG_TIMEOUT[@]}"} "${INNER_ARGV[@]}" 2>/dev/null)
  INNER_RC=$?
  if [ "$INNER_RC" -ne 0 ]; then
    if [ "$INNER_RC" -eq 124 ] && [ "${#LG_TIMEOUT[@]}" -gt 0 ]; then
      INNER_ERR="LIMIT_GUARD_INNER timed out after ${INNER_TIMEOUT_S}s: ${INNER_ARGV[0]}"
    else
      INNER_ERR="LIMIT_GUARD_INNER exited non-zero: ${INNER_ARGV[0]}"
    fi
    INNER_OUT=""
  fi
fi

# 3. Hand any chaining failure to log.jsonl. The capture already ran, so this
#    is a second, cheap call — and only when something is actually broken.
if [ -n "$INNER_ERR" ] && [ -f "$GATE" ] && [ ! -L "$GATE" ]; then
  LIMIT_GUARD_INNER_ERROR="$INNER_ERR" "$PY" "$GATE" --log-inner-error \
    </dev/null >/dev/null 2>&1 || true
fi

# 4. Print inner output first, then the badge. `$(...)` already stripped the
#    inner's trailing newlines, so the whole thing stays on one line.
printf '%s%s' "$INNER_OUT" "$BADGE"
exit 0
