#!/usr/bin/env bash
# Usage: wait.sh [seconds]   default 480, maximum 570.
# Waits, then prints "wait ended".
set -eu
s="${1:-480}"
case "$s" in ''|*[!0-9]*) echo "wait.sh: seconds must be a whole number" >&2; exit 2;; esac
if [ "$s" -gt 570 ]; then s=570; fi
sleep "$s"
echo "wait ended"
