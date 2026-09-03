# AGENTS.md — Project Rules for AI Agents

This file follows the [AGENTS.md standard](https://agents-md.org) and is read by
Claude Code, Antigravity/Gemini, Cursor, OpenCode, and other compatible tools.

---

## Repository Overview

This is a **curated marketplace** of AI agent skills, MCP server configs, and
plugin packages. The repo is designed for cross-tool interoperability — every
skill must work with any SKILL.md-compatible agent.

## Directory Conventions

```
skills/<name>/                   — Standalone, cross-tool skills (the portable core)
  ├── SKILL.md                   — The skill itself; portable to any SKILL.md tool
  ├── .claude-plugin/
  │   └── plugin.json            — Packages the skill as a one-skill Claude Code plugin
  └── references/                — Optional supplementary docs
plugins/<name>/                  — Self-contained plugin packages
  ├── .claude-plugin/
  │   └── plugin.json            — Plugin manifest
  ├── .mcp.json                  — Optional: plugin-scoped MCP servers (plugin root)
  ├── skills/                    — Plugin-scoped skills
  └── hooks/                     — Plugin-scoped hooks (tool-specific)
mcp-servers/<name>/              — Shared MCP server configurations
templates/                       — Skeleton files for new contributions
roadmap/{backlog,in-progress,done}/  — Idea tracking (kanban-style)
```

## Skill Authoring Rules

1. **Every skill MUST have valid YAML frontmatter** with `name` and `description` fields.
2. **`name` must match the containing directory name** (lowercase, kebab-case).
3. **`description` must include trigger conditions** — when should the agent activate this skill?
4. **Keep SKILL.md self-contained.** Use `references/` for large supplementary docs; keep the main file focused on procedure.
5. **No tool-specific assumptions in the core instructions.** If a skill has tool-specific notes (e.g., "in Claude Code, use WebFetch"), put them in a clearly marked `## Platform execution notes` section at the end.
6. **Include validation steps.** Every non-trivial skill should tell the agent how to verify its output.
7. **Every `skills/<name>/` ships its own `.claude-plugin/plugin.json` and its own entry in
   `.claude-plugin/marketplace.json`.** There is no root bundle plugin — the marketplace
   root is a marketplace, not a plugin, and each skill installs by name
   (`claude plugin install <name>@skill-bazaar`). The manifest's `name` must
   equal the directory name and the SKILL.md `name`; the marketplace entry's `name` must
   equal the manifest's, and its `source` must be `./skills/<name>`.
   `scripts/validate-skills.py` enforces both directions — a manifest with no marketplace
   entry fails, and a marketplace entry with no manifest fails.
8. **The SKILL.md sits at the plugin root**, not under a nested `skills/` directory. Claude
   Code loads a root `SKILL.md` as the plugin's single skill; the manifests here declare
   `"skills": ["."]` to say so explicitly. The layout is what keeps the folder a plain
   portable skill for every other tool.
9. **`references/` holds only material the skill reads while it runs.** Every file there
   is a context cost at use time. Roadmap material for the skill does not belong there:
   measurement records, evidence logs, harness comparisons, open decisions, review notes,
   scoping. Put that in `roadmap/` (a backlog item for the skill), or in a place of your
   own outside this repo. Test: if the agent never needs the file to do the job the skill
   describes, it is not a reference.

## Plugin Authoring Rules

1. Each plugin is a self-contained directory under `plugins/<name>/`.
2. Must include a `.claude-plugin/plugin.json` manifest with `name`, `description`, and
   `version`, and a matching entry in `.claude-plugin/marketplace.json`.
3. Plugin-scoped skills follow the same rules as top-level skills.
4. Hooks and slash commands are inherently tool-specific — document which tool(s) they target.

## MCP Server Config Rules

1. Use the standard `mcpServers` JSON format.
2. Never hardcode absolute paths or secrets — use environment variable placeholders.
3. Include a README explaining what the server does and how to set it up.

## Naming Conventions

- Directories: `lowercase-kebab-case`
- SKILL.md `name` field: must match directory name
- Roadmap files: subject-only, see [roadmap/README.md](roadmap/README.md)
- Standalone skill layout and manifests: see [skills/README.md](skills/README.md)

## Commit Conventions

- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`
- Scope with the contribution type when relevant: `feat(skills): add git-release skill`

## Quality Expectations

- Skills should be **tested by the author** with at least one agent before submitting.
- Skills should be **documented** — the SKILL.md itself serves as documentation.
- Don't submit placeholder/stub skills — every merged skill must be functional.
- Before opening a PR, run the structural validator locally:
  `python3 scripts/validate-skills.py`. It checks SKILL.md frontmatter (`name`
  matches its directory, `description` is present and within the length
  limit), plugin manifests, `.claude-plugin/marketplace.json`, and roadmap
  frontmatter, and prints `path: message` for every problem it finds — the
  same check CI runs on every PR and push to `main`
  (`.github/workflows/validate-skills.yml`). It does not check prose quality
  or run the skill itself, only structure.

## Repo hygiene — this repo is public

Write every file as if it were already public, because it is. Skills here are written from
real work, and that is the leak path: private detail travelling here as context.
De-identify at the point of writing, not in a later sweep.

| Write this | Not this |
|---|---|
| RFC 5737 addresses: `192.0.2.10`, `198.51.100.0/24`, `203.0.113.0/24` | An address from a real network |
| Placeholder hosts and users: `user@lab-vm-01` | A real hostname, login, or device serial |
| The technique, and the shape of the finding | The specific target it was found on |
| A fact about the tool, stated without a date | A dated work log, a session note, or a decision record |

The maintainer's public GitHub identity (`pepsi133`, `@pepsi133` in `CODEOWNERS`) is
deliberate and stays.

The check is manual: `docs/pre-publish-audit.md` is the content gate. Note that a
`git ls-files` sweep skips **untracked** files, which is exactly where new writing lives.
Check the file you are about to add, not only the ones already in.

## Network egress policy — no endpoint the author chose

**The rule:** no skill, plugin, hook, or MCP config in this repo may send data to an endpoint
*its author* chose. Data may go to Anthropic through the user's own Claude Code session or
`claude` CLI (for example a `claude -p` subprocess that summarises or compresses), and to
endpoints **the user themselves** configures or names at use time.

| Allowed — the user chose it | Banned — the author chose it |
|---|---|
| Anthropic, through the user's own session or `claude` CLI | A service run by the plugin's own author, self-hosted or not. A plugin that ships a client for its author's backend is rejected on that ground alone, whatever else it does |
| A host the user supplies at use time — a URL passed to `WebFetch`, their own router in `skills/mikrotik-routeros` | Telemetry, analytics, crash reporting, "sync", any phone-home |
| An MCP server the user installs and configures — `mcp-servers/` and `templates/mcp-server/mcp.json` are configuration the user opts into, not egress | A third-party SaaS baked into a hook or script, keyed or not |

The grep-able floor: **a hook or script shipped in this repo contains no hardcoded network
client and no hardcoded URL other than a documentation link.** No `curl`/`wget`/`nc`, no
`ssh` to a fixed host, no `requests`/`httpx`/`fetch` aimed at a literal address. If the
destination is not something the user typed, configured, or named, it does not belong in the
file.

A vendored third-party plugin is reviewed for egress at its pinned commit before it is added,
and again on every pin bump (each plugin's `UPSTREAM.md` carries the procedure).

CI does not yet assert the floor by grep over hook and script sources, so the check is
manual. The grep is the floor, the review is the check.

Why: Anthropic has already seen everything a Claude session produced, so sending it back is
no new exposure, and an endpoint the user picked is one they already trust. An endpoint the
*author* picked is a new trust boundary the user never agreed to.

## Files You Should Not Modify

- `LICENSE` — MIT, do not change
- `CODEOWNERS` — managed by maintainers

`.claude-plugin/marketplace.json` is maintainer-managed, with one exception: adding or
removing **your own** contribution's entry is part of adding or removing the contribution,
and the validator fails if you don't. Change only that entry — never another's, and never
the top-level `name`/`owner`/`description`. An entry carries `name`, `source` and
`description` only, and `source` is `./skills/<name>` or `./plugins/<name>`. Maintainer
review still applies (see `CODEOWNERS`).
