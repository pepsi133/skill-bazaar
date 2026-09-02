# Roadmap

A kanban-style tracking system for ideas, work-in-progress, and completed items.

## How it works

```
roadmap/
├── backlog/        ← Ideas proposed but not yet started
├── in-progress/    ← Someone is actively working on this
└── done/           ← Merged into skills/, plugins/, or mcp-servers/
```

**The directory is the status.** Move a file to change its status, and record status
nowhere else — not in the filename, not inside the file. One place to edit means nothing
to drift out of sync.

## Naming

The filename is the subject and nothing else: `agent-delegation.md`, `weather-api.md`.
No status prefix, no type prefix, no date. An idea keeps its name for its whole life, so
links to it never break, and the editor tab tells you which idea you have open.

## Frontmatter

Everything that is not the subject goes in YAML frontmatter, matching the convention
`SKILL.md` files already use:

```yaml
---
type: skill | mcp | plugin | meta
proposed_by: username
created: YYYY-MM-DD
---
```

Filter by type with a frontmatter scan rather than a glob. Start from
[the idea template](../templates/idea.md).

## Workflow

1. **Propose**: add a file to `backlog/` using the template
2. **Start**: `git mv` it to `in-progress/`
3. **Complete**: `git mv` it to `done/` once the deliverable is merged

## Cleanup

Delete an idea file from `done/` once its deliverable exists in `skills/`, `plugins/`, or
`mcp-servers/`. That is a condition you can check at any time, rather than a periodic
review nobody schedules. The shipped thing is the documentation; the idea file has served
its purpose.
