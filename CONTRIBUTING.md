# Contributing to Skill Bazaar

Thank you for contributing! This guide explains how to add skills, plugins,
MCP server configs, and ideas to the marketplace.

## Before You Start

1. Read [AGENTS.md](AGENTS.md) — it defines the repo conventions and quality expectations.
2. Check `roadmap/backlog/` — someone may have already proposed what you're building.
3. Use the templates in `templates/` as starting points.

## Adding a Skill

See [skills/README.md](skills/README.md) for the layout and the two-manifest rule.

1. **Copy the template:**
   ```bash
   cp -r templates/skill/ skills/your-skill-name/
   ```

2. **Edit `skills/your-skill-name/SKILL.md`:**
   - Fill in the YAML frontmatter (`name` must match the directory name)
   - Write clear, actionable instructions
   - Include a validation section
   - Add platform-specific notes if needed

3. **Optional:** Add supporting files:
   - `references/` — supplementary documentation the skill can reference
   - `scripts/` — helper scripts (include `requirements.txt` if Python)
   - `assets/` — images, templates, or other resources

4. **Edit `skills/your-skill-name/.claude-plugin/plugin.json`** — the template ships it with
   placeholders. Set `name` (must equal the directory name and the SKILL.md `name`),
   `description`, and the `author` block (it ships as the `your-github-handle`
   placeholder). Leave `"skills": ["."]` alone: it tells Claude Code the SKILL.md is at the
   plugin root rather than under a nested `skills/` directory.

5. **Add a marketplace entry** to `.claude-plugin/marketplace.json` — add only your own
   entry, and leave the rest of the file alone:

   ```json
   {
     "name": "your-skill-name",
     "source": "./skills/your-skill-name",
     "description": "One sentence on what the skill does."
   }
   ```

   Every `skills/<name>/` needs both the manifest and the entry. There is no root bundle
   plugin — each skill installs by name. `scripts/validate-skills.py` enforces both
   directions: a manifest without an entry fails, and an entry without a manifest fails.

6. **Test** the skill with at least one agent (Claude Code, Antigravity, etc.). In Claude
   Code, load the folder directly and confirm the skill is offered:

   ```bash
   claude plugin validate skills/your-skill-name
   claude --plugin-dir "$(pwd)/skills/your-skill-name"
   ```

7. **Run the validator:** `python3 scripts/validate-skills.py`

8. **Submit a PR** with a clear description of what the skill does and how you tested it.

Users then install it with:

```bash
# From a local clone
claude plugin marketplace add /path/to/skill-bazaar
# Or from GitHub
claude plugin marketplace add pepsi133/skill-bazaar

claude plugin install your-skill-name@skill-bazaar
```

## Adding a Plugin

1. **Copy the template:**
   ```bash
   cp -r templates/plugin/ plugins/your-plugin-name/
   rm plugins/your-plugin-name/TEMPLATE.md
   ```
   `TEMPLATE.md` documents the template, not your plugin — delete it and write your
   own `README.md`.

2. **Edit `.claude-plugin/plugin.json`** — set name, description, version, and the
   `author` block (it ships as the `your-github-handle` placeholder), and add a matching
   entry to `.claude-plugin/marketplace.json` with `"source": "./plugins/your-plugin-name"`.

3. **Add skills** inside `plugins/your-plugin-name/skills/` following the same
   rules as top-level skills.

4. **Add MCP configs** in `plugins/your-plugin-name/.mcp.json` if the plugin needs
   external tool connections. Claude Code reads `.mcp.json` at the plugin root —
   there is no `mcp/` directory scan.

5. **Hooks are tool-specific** — document which tool(s) they target in a README.

## Adding an MCP Server Config

1. **Copy the template:**
   ```bash
   cp -r templates/mcp-server/ mcp-servers/your-server-name/
   ```

2. **Edit the config** — use environment variable placeholders for secrets and paths.

3. **Add a README** explaining what the server does and setup requirements.

## Proposing an Idea

1. **Copy the idea template:**
   ```bash
   cp templates/idea.md roadmap/backlog/your-idea-name.md
   ```

   The filename is the subject only — no type or status prefix. See
   [roadmap/README.md](roadmap/README.md) for the full naming and frontmatter convention.

2. **Fill in the template**, including the YAML frontmatter (`type`, `proposed_by`,
   `created`), with the problem, proposed approach, and any notes.

3. **Submit a PR** — ideas are welcome even if rough.

## Roadmap Workflow

Ideas move through the kanban:

```
roadmap/backlog/     → idea proposed
roadmap/in-progress/ → someone is actively working on it
roadmap/done/        → merged into skills/, plugins/, or mcp-servers/
```

Move files between directories via PR (or rename in a commit) to track status.
Clean up `done/` periodically — once a skill/plugin is live, the idea file has
served its purpose.

## Naming Conventions

- Directories: `lowercase-kebab-case`
- SKILL.md `name` field: must match containing directory name
- Roadmap files: subject-only, see [roadmap/README.md](roadmap/README.md)
- Commits: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)

## Quality Bar

- Every skill must be **functional** — no stubs or placeholders
- Every skill must be **tested** with at least one agent
- Every skill must have **valid YAML frontmatter** (`name` + `description`)
- Every `skills/<name>/` must ship a `.claude-plugin/plugin.json` **and** a
  `.claude-plugin/marketplace.json` entry — the validator checks both directions
- Skills should be **cross-tool compatible** (avoid tool-specific assumptions in core logic)
