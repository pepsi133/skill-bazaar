# herd-forge

Forge and drive a herd in Herdr: one agent per pane, one directory per agent, files as the
channel.

## Why it exists

`Bash` gives you a pipe. A pipe has no controlling terminal, so every interactive program
either refuses to start or runs in a mode that answers nothing. A Herdr pane is a pty, so
a REPL, an `ssh` password prompt, a TUI installer or a serial console all work there, and a
human can watch the same pane while an agent drives it.

Three more things follow from that, and the skill covers each:

- A Claude pane started with `--dangerously-skip-permissions`, so an unattended herd does
  not stop on the first prompt.
- A pane per agent program: Claude in one, Codex or Copilot or Gemini in the next, pointed
  at one goal.
- A model and effort choice per role. Judgment work on `fable` or `opus --effort low`. Bulk
  work on `sonnet --effort high`.

## What it is not

It is not a governance protocol. Evidence discipline, review gates and the rest live in
**herd-rigor**, as dials an operator turns on when a wrong answer costs more than a slow
one. herd-forge names no rule the operator did not ask for.

## Layout

| path | holds |
|---|---|
| `skills/herd-forge/SKILL.md` | the core. Read all of it once |
| `skills/herd-forge/reference/briefs.md` | the file you write for each agent |
| `skills/herd-forge/reference/interactive-panes.md` | driving an interactive program, console or device from a pane |
| `skills/herd-forge/reference/herdr-traps.md` | measured Herdr, compaction and account defects |
| `skills/herd-forge/reference/cross-herd.md` | the relay agent, when a second herd exists |

## Requirements

This skill drives [Herdr](https://herdr.dev), a terminal multiplexer for coding agents,
through its `herdr` command-line interface. Herdr is a separate tool and is not bundled
here.

- **Herdr**, installed and on your `PATH`, with `HERDR_ENV=1` inside the pane. Source and
  documentation: <https://github.com/herdrdev/herdr>.
- **A coding agent Herdr recognizes.** `herdr agent 2>&1` prints the list your build
  supports. The list goes to stderr, so a stdout-only capture comes back empty, and
  `herdr agent --help` does not print it at all.
- **`git`**, because the forge makes one repository per agent directory.

`herdr --skill` prints the Herdr command reference and is the authority on syntax. The
skill points at it rather than copying it.

## Install

```
claude plugin marketplace add /path/to/skill-bazaar
claude plugin install herd-forge@skill-bazaar
```

## Companion plugins

- **herd-rigor**, for evidence labels, absence controls, the review gate and a rule budget.
- **static-analysis-controls**, for counting and absence over a corpus of files or binaries.
