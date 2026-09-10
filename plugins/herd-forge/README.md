# herd-forge

Build a multi-agent research herd in Herdr: the tree, the git repositories, the names, the
configuration, and the instruction file that each agent receives.

## Why it exists

Four herds ran on one host in September 2026 against related questions. They disagreed
about twelve practices, and the operator ruled on each one. This skill is what survived
that comparison, with the disagreements resolved and the evidence attached.

The reader of the skill **creates** the herd and is normally not its overseer. The rules
for the overseer and the workers are files that the creator produces, so the skill is
written that way throughout.

## When not to use it

When the question fits in one context, and nobody will challenge the answer. The overhead
is real, and every expensive practice in the skill states its cost beside it.

## Layout

| path | holds |
|---|---|
| `skills/herd-forge/SKILL.md` | the core. The creator reads all of it once |
| `skills/herd-forge/reference/` | eleven files, opened when the task points at one: instruction templates, the configuration template, measured Herdr facts, the caveats, evidence and review discipline, context and handover, the cross-herd protocol, independence, sealing, and open issues |

## Requirements

This skill drives [Herdr](https://herdr.dev), a terminal agent multiplexer, through its
`herdr` command-line interface. Herdr is a separate tool and is not bundled with this
skill.

- **Herdr**, installed and on your `PATH`. Install it from the official project:

  ```
  curl -fsSL https://herdr.dev/install.sh | sh
  ```

  Source and documentation: <https://github.com/herdrdev/herdr>.
- **A coding agent that Herdr recognises**, such as Claude Code. The commands here target
  Herdr on Claude Code. The delegation and evidence rules are portable to any agent kind
  Herdr supports; the commands and the measured tooling defects are not.
- **`git`**, because the skill creates one repository per agent directory and the review
  gate depends on the commit history.

## Install

```
/plugin marketplace add /path/to/skill-bazaar
/plugin install herd-forge@skill-bazaar
```

## The evidence

Every rule with a story behind it names the herd that paid for it. A rule with no story
rests on argument, and the skill says which is which. The story sits inline with the rule,
so the reader sees the evidence next to the practice it supports.
