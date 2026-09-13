---
name: example
description: When to hand work to this agent, written so the main thread can tell whether it fits. This text is the whole routing decision.
tools: Read, Grep, Glob
model: sonnet
---

Write the agent's system prompt here. A subagent cannot ask the human anything mid-run,
so state what it must do when the task is ambiguous, what it must never do, and what
shape its final report takes.

Rename this file to name the agent. `agents/cavecrew-builder.md` becomes the agent type
`cavecrew-builder`.

`tools` narrows what the agent may use; omit it to grant the full set. `model` accepts
`sonnet`, `opus`, `haiku`, or `inherit`.

The same loader rule as `commands/` applies: `.md` with frontmatter, or the agent never
registers and nothing reports an error. Run `python3 scripts/validate-skills.py`.
