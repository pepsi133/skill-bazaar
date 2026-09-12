# The delegation gate

Claude Code only. The skill reads correctly without it.

`agent-delegation-gate.py` is a `PreToolUse` hook. It asks a human once, at the moment a turn
in the main session starts editing a second file. That is the moment the skill's rule turns
from "fix it inline" into "write a spec and delegate".

## What it does

| Call | Result |
|---|---|
| Any call carrying `agent_id`, which means a subagent | Passes. The gate exists to catch main-session work. |
| The first file of a turn | Passes in silence. A one-line fix stays inline, per the skill. |
| The second distinct file of the same turn | One `ask`, with the reason. |
| Later files of the same turn | Pass in silence. The human already decided for this turn. |

A turn is one `prompt_id`. The set of paths clears when that id changes. State lives in
`scratchpad_dir`, which the host supplies per session, so two sessions never share a counter.

## What it does not do

A Bash-based edit (`sed -i`, a heredoc, a patch applied by a script) never reaches the
`Edit|Write|NotebookEdit` matcher. It bypasses this gate, in `ask` mode and in `deny` mode
alike. The gate is a reminder at the right moment, and it is not a wall. A session running in
a mode that routes file writes through Bash sees no asks at all.

## Install

Installed with the plugin, the hook is discovered from this directory. To register it by hand,
add this to `.claude/settings.json` or `.claude/settings.local.json`, with a real path in
place of `<path>`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "python3 \"<path>/agent-delegation-gate.py\"", "timeout": 10 }
        ]
      }
    ]
  }
}
```

Claude Code reads hook configuration at session start, so start a new session afterwards.

## Check the path after any move

```bash
python3 agent-delegation-gate.py --selftest
```

A hook that exits 2 blocks the call it was asked to observe, and `python3` exits 2 when it
cannot open a script. A wrong path therefore blocks every `Edit`, `Write` and `NotebookEdit`
call, silently. The script itself catches every internal fault and exits 0 on purpose. The
self-test covers the path.

## Configuration

| Variable | Effect |
|---|---|
| `AGENT_DELEGATION_GATE=off` | The gate passes every call. |
| `AGENT_DELEGATION_GATE_THRESHOLD=3` | Ask on the third distinct file instead of the second. Values below 2 are ignored. |

## Measured

Claude Code 2.1.269, 2026-09-12. `agent_id` is present on a subagent call and absent on a
main-session call. `prompt_id` changes with each user turn. Re-measure before you rely on
either, because harnesses change.
