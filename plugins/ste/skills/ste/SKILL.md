---
name: ste
disable-model-invocation: true
description: >-
  Turn the Simple Technical English bridge on or off, or report its state,
  together with the caveman mode it defers to. Use when the user types
  "/ste", "/ste on", "/ste off", or "/ste status", or asks to enable,
  disable, or check the STE bridge, the simple-english style, or plain
  technical English.
argument-hint: "on|off|status"
license: MIT
---

# /ste

The `ste` plugin's `UserPromptSubmit` hook has **already** applied the command
before you read this. It wrote the new state to `state.json` and, for `on`, it
re-injected the Simple Technical English ruleset into this turn's context.

Do not run a command, edit a file, or read the state yourself.

## What to do

Acknowledge in one line, using the state the hook injected, then answer the rest
of the user's message normally:

- `on` — say that the bridge is on and that the setting persists.
- `off` — say that the bridge is off and that the setting persists.
- `status` (also a bare `/ste` or an unrecognised argument) — report the two
  values the hook injected: `ste` and `caveman`.

If no state text appears in this turn's context, the hook did not run. Say that,
and tell the user to check that the `ste` plugin is enabled.
