#!/usr/bin/env bash
# Usage: wait.sh [seconds]   default 480. Waits at most BOARD_WAIT_CAP (default 570) seconds per call.
# Prints "wait ended", or "wait paused: run bash "<this file>" <rest> again" when seconds is over the cap.
set -eu
s="${1-480}"; cap="${BOARD_WAIT_CAP:-570}"
case "$s" in ''|*[!0-9]*) echo "wait.sh: seconds must be a whole number" >&2; exit 2;; esac
case "$cap" in ''|*[!0-9]*) echo "wait.sh: BOARD_WAIT_CAP must be a whole number from 1" >&2; exit 2;; esac
s="${s#"${s%%[!0]*}"}"; cap="${cap#"${cap%%[!0]*}"}"   # no leading zeros: base 10, never octal
if [ "${#s}" -gt 9 ]; then echo "wait.sh: seconds must be a whole number" >&2; exit 2; fi
if [ "${#cap}" -gt 9 ] || [ -z "$cap" ]; then echo "wait.sh: BOARD_WAIT_CAP must be a whole number from 1" >&2; exit 2; fi
s=$((10#${s:-0})); cap=$((10#$cap))
if [ "$s" -gt "$cap" ]; then
  sleep "$cap"; echo "wait paused: run bash \"$0\" $((s - cap)) again"
else
  sleep "$s"; echo "wait ended"
fi
