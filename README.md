# Skill Bazaar

A curated library of AI agent skills, MCP server configurations, and plugin packages — designed to work across **all** major coding agents.

## Supported Tools

| Tool | Skills | MCP Configs | Plugin Wrapper |
|:-----|:------:|:-----------:|:--------------:|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | ✅ | ✅ | ✅ (marketplace) |
| [Antigravity (Gemini)](https://antigravity.google) | ✅ | ✅ | ✅ (.agents/) |
| [OpenCode](https://opencode.ai) | ✅ | ✅ | — |
| [Cursor](https://cursor.com) | ✅ | ✅ | — |
| Any SKILL.md-compatible agent | ✅ | ✅ | — |

## Quick Start

```bash
# Clone the repo
git clone https://github.com/pepsi133/skill-bazaar.git
cd skill-bazaar

# Symlink skills into your tool of choice (pick one):

# Claude Code
ln -s "$(pwd)/skills" ~/.claude/skills/marketplace

# Antigravity / Gemini (or ~/.agents/skills/marketplace — same tier, takes precedence)
ln -s "$(pwd)/skills" ~/.gemini/skills/marketplace

# OpenCode
ln -s "$(pwd)/skills" ~/.config/opencode/skills/marketplace
```

### Or install through the Claude Code marketplace

There is no single bundle plugin — **every entry installs by name**. Each
`skills/<name>/` is packaged as its own plugin, alongside the bundles under
`plugins/<name>/`.

```bash
# From a local clone
claude plugin marketplace add /path/to/skill-bazaar
# Or from GitHub
claude plugin marketplace add pepsi133/skill-bazaar

claude plugin install mikrotik-routeros@skill-bazaar
```

See [docs/install/](docs/install/) for detailed per-tool setup guides.

## Repository Structure

```
skill-bazaar/
├── skills/                 # Cross-tool portable skills (the core), one plugin each
├── plugins/                # Self-contained plugin packages (skills + mcp + hooks)
├── mcp-servers/            # Shared MCP server configurations
├── templates/              # Skeleton files for new contributions
├── roadmap/                # Kanban-style idea/progress tracking
├── docs/install/           # Per-tool installation guides
├── .claude-plugin/         # marketplace.json — one entry per skill/plugin
├── .agents/                # Antigravity workspace scaffold
└── .github/workflows/      # CI: validates SKILL.md/plugin/roadmap frontmatter on every PR
```

### What goes where?

- **Standalone skills** → `skills/<skill-name>/SKILL.md` (see [skills/README.md](skills/README.md)), plus a
  `skills/<skill-name>/.claude-plugin/plugin.json` and a matching entry in
  `.claude-plugin/marketplace.json`
- **Plugin packages** (bundled skills + MCP + hooks) → `plugins/<plugin-name>/`
- **Shared MCP server configs** → `mcp-servers/<server-name>/`
- **Ideas for future work** → `roadmap/backlog/`

## Philosophy

**Skills are the portable core.** The `SKILL.md` format ([agentskills.io](https://agentskills.io)) is the open standard adopted by 25+ agent platforms. Every skill in this repo follows it, making them work with any compatible tool via clone + symlink.

**MCP configs are near-universal.** The `mcpServers` JSON format is recognized by Claude Code, Antigravity, Cursor, OpenCode, and most MCP-speaking tools.

**Plugin wrappers are thin.** Tool-specific wrappers (`.claude-plugin/`, `.agents/`) are scaffolded but never duplicate content — they point back to the shared `skills/` and `mcp-servers/` directories. A standalone skill's own `.claude-plugin/plugin.json` sits beside its `SKILL.md` and adds nothing but metadata, so the folder stays portable to any SKILL.md-compatible tool.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add skills, plugins, and MCP server configs.

## License

[MIT License](LICENSE) for this repository's own code and docs. Vendored third-party
plugins keep their upstream license alongside their files (e.g. `plugins/caveman/LICENSE`,
MIT, © Julius Brussee); each such directory has an `UPSTREAM.md` naming the pin and license.
