#!/usr/bin/env python3
"""Ask a human before the main session edits a second file in one turn.

The skill this ships with states a graded rule: a one-line fix stays in the main
session, and a multi-file change goes to a subagent with a written spec. A
`PreToolUse` matcher sees a tool name and never a change size, so a gate keyed on
the tool name alone asks on every allowed edit and trains the habit of saying yes.

This gate counts distinct file paths instead:

- A call that carries `agent_id` comes from a subagent. It passes, always.
- A main-session call adds its file path to a per-turn set. `prompt_id` marks the
  turn, and the set clears when that id changes.
- The first file of a turn passes in silence.
- The second distinct file raises one `ask`.
- Later files in the same turn pass in silence, because the human already decided.

A Bash-based edit (`sed -i`, a heredoc, a patch script) never reaches the
`Edit|Write|NotebookEdit` matcher, so it bypasses this gate. The gate is a
reminder at the moment a change turns multi-file, not a wall.

Exit code discipline: a `PreToolUse` hook that exits 2 blocks the call. Python
exits 2 when it cannot open a script, so a wrong path in the hook configuration
blocks every matched call. Every fault here is caught, and the process exits 0 on
purpose. Run `--selftest` after any move or rename to confirm the path.

Configuration, both optional:

    AGENT_DELEGATION_GATE=off          turn the gate off for a session
    AGENT_DELEGATION_GATE_THRESHOLD=3  ask on the Nth distinct file instead of the 2nd
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

OFF_ENV = "AGENT_DELEGATION_GATE"
THRESHOLD_ENV = "AGENT_DELEGATION_GATE_THRESHOLD"
DEFAULT_THRESHOLD = 2
STATE_NAME = "agent-delegation-gate.json"
PATH_KEYS = ("file_path", "notebook_path")


def threshold() -> int:
    raw = os.environ.get(THRESHOLD_ENV, "")
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_THRESHOLD
    return value if value >= 2 else DEFAULT_THRESHOLD


def gate_is_off() -> bool:
    return os.environ.get(OFF_ENV, "").strip().lower() in {"off", "0", "false", "no"}


def target_path(payload: dict) -> str | None:
    """The file a matched call writes to, or None when the input names none."""
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return None
    for key in PATH_KEYS:
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            return os.path.abspath(value)
    return None


def decide(payload: dict, state: dict, limit: int) -> tuple[str | None, dict]:
    """Pure. Returns the ask reason (or None) and the state to store next."""
    if payload.get("agent_id"):
        return None, state

    path = target_path(payload)
    if path is None:
        return None, state

    prompt_id = payload.get("prompt_id") or ""
    if state.get("prompt_id") != prompt_id:
        state = {"prompt_id": prompt_id, "paths": [], "asked": False}

    paths = list(state.get("paths", []))
    if path in paths:
        return None, {**state, "paths": paths}

    paths.append(path)
    state = {**state, "paths": paths}

    if state.get("asked") or len(paths) < limit:
        return None, state

    return ask_reason(paths), {**state, "asked": True}


def ask_reason(paths: list[str]) -> tuple[str, str]:
    """The short line for the user, and the long reason for the record."""
    first = Path(paths[0]).name
    current = Path(paths[-1]).name
    headline = (
        f"agent-delegation: second file this turn ({first}, then {current}). "
        f"A multi-file change belongs in a subagent with a written spec."
    )
    detail = (
        f"{headline} The delegate-by-default rule keeps a one-line fix inline and sends a "
        f"multi-file change to a subagent. Allow to continue in the main session, or deny "
        f"and delegate the change. A Bash edit does not reach this gate."
    )
    return headline, detail


def state_file(payload: dict) -> Path:
    scratchpad = payload.get("scratchpad_dir")
    if isinstance(scratchpad, str) and scratchpad:
        return Path(scratchpad) / STATE_NAME
    session = str(payload.get("session_id") or "unknown")
    safe = "".join(c for c in session if c.isalnum() or c in "-_")
    return Path(tempfile.gettempdir()) / f"agent-delegation-gate-{safe}.json"


def load_state(path: Path) -> dict:
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return state if isinstance(state, dict) else {}


def save_state(path: Path, state: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state), encoding="utf-8")
    except OSError:
        pass


def emit_ask(headline: str, detail: str) -> None:
    """Both fields carry the reason. Neither is displayed on Claude Code 2.1.269.

    Measured twice: the permission prompt for an `ask` decision showed the file name
    alone, with no part of `permissionDecisionReason` and none of `systemMessage`. Both
    are sent anyway, because they cost nothing and another client can render them. A gate
    that asks without saying why teaches the habit of answering yes, so re-check this on
    a version bump.
    """
    sys.stdout.write(
        json.dumps(
            {
                "systemMessage": headline,
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": detail,
                },
            }
        )
    )


def run() -> None:
    if gate_is_off():
        return
    payload = json.loads(sys.stdin.read())
    if not isinstance(payload, dict):
        return
    path = state_file(payload)
    reason, state = decide(payload, load_state(path), threshold())
    save_state(path, state)
    if reason:
        emit_ask(*reason)


def selftest() -> int:
    """Exercise decide() against synthetic payloads. Run after a move or rename."""
    failures: list[str] = []

    def check(name: str, got, want) -> None:
        if got != want:
            failures.append(f"{name}: got {got!r}, want {want!r}")

    def call(agent_id=None, path="/repo/a.py", prompt="p1", key="file_path"):
        payload = {"prompt_id": prompt, "tool_input": {key: path}}
        if agent_id:
            payload["agent_id"] = agent_id
        return payload

    empty: dict = {}

    reason, state = decide(call(agent_id="a1"), empty, 2)
    check("a subagent call never asks", reason, None)
    check("a subagent call stores nothing", state, {})

    reason, state = decide(call(path="/repo/a.py"), empty, 2)
    check("the first file passes", reason, None)
    check("the first file is counted", state["paths"], ["/repo/a.py"])

    reason, state2 = decide(call(path="/repo/a.py"), state, 2)
    check("the same file again passes", reason, None)
    check("the same file is counted once", state2["paths"], ["/repo/a.py"])

    reason, state3 = decide(call(path="/repo/b.py"), state, 2)
    check("the second distinct file asks", bool(reason), True)
    check("the ask carries a short line and a long one", len(reason or ()), 2)
    check("the short line names the gate", (reason or ("",))[0].startswith("agent-delegation:"), True)
    check("the ask is recorded", state3["asked"], True)

    reason, state4 = decide(call(path="/repo/c.py"), state3, 2)
    check("a third file stays silent", reason, None)
    check("the third file is counted", len(state4["paths"]), 3)

    reason, state5 = decide(call(path="/repo/d.py", prompt="p2"), state3, 2)
    check("a new turn resets the set", reason, None)
    check("the new turn holds one path", state5["paths"], ["/repo/d.py"])

    reason, _ = decide(call(path="/repo/b.py"), state, 3)
    check("a raised threshold delays the ask", reason, None)

    reason, _ = decide({"prompt_id": "p1", "tool_input": {}}, empty, 2)
    check("input with no path passes", reason, None)

    reason, _ = decide({"prompt_id": "p1"}, empty, 2)
    check("input with no tool_input passes", reason, None)

    reason, state6 = decide(call(path="/repo/n.ipynb", key="notebook_path"), empty, 2)
    check("a notebook path is read", state6["paths"], ["/repo/n.ipynb"])

    state7 = {"prompt_id": "p1", "paths": ["/repo/a.py"], "asked": False}
    reason, _ = decide(call(agent_id="a1", path="/repo/b.py"), state7, 2)
    check("a subagent call does not count toward the turn", reason, None)

    for line in failures:
        sys.stdout.write(f"FAIL {line}\n")
    total = 17
    sys.stdout.write(
        f"agent-delegation-gate selftest: {total - len(failures)}/{total} checks passed\n"
    )
    return 1 if failures else 0


def main() -> int:
    if "--selftest" in sys.argv[1:]:
        return selftest()
    try:
        run()
    except Exception:
        # A hook that exits non-zero can block the call it was asked to observe.
        # Fail open, deliberately, and stay silent.
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
