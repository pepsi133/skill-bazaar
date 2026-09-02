# Plugin Packages

Each plugin is a self-contained directory with its own skills, MCP configs,
hooks, and metadata.

## Directory Structure

```
plugins/
└── my-plugin/
    ├── .claude-plugin/
    │   └── plugin.json      # Required: plugin manifest
    ├── .mcp.json            # Optional: plugin-scoped MCP servers (at the plugin root)
    ├── skills/              # Plugin-scoped skills
    │   └── my-skill/
    │       └── SKILL.md
    ├── hooks/               # Plugin-scoped hooks (tool-specific)
    │   └── hooks.json
    └── README.md            # Plugin documentation
```

## When to use a plugin vs. a standalone skill

Both ship as marketplace entries and both install by name — the difference is what's in
the box, not how it's distributed:

- **Standalone skill** (`skills/<name>/`): One skill, useful on its own, needing no MCP
  servers or hooks. Its `SKILL.md` sits at the directory root so every SKILL.md-compatible
  tool can consume the folder as-is; its `.claude-plugin/plugin.json` adds nothing but
  metadata and `"skills": ["."]`.
- **Plugin package** (`plugins/<name>/`): Several skills, or skills that work together
  with specific MCP servers, hooks, or other config — a coherent bundle. Skills live under
  `skills/<skill-name>/SKILL.md` inside the plugin.

## Marketplace entries

Every plugin here — and every `skills/<name>/` — needs an entry in the repo's
[`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json). There is no root
bundle plugin; the marketplace root is a marketplace, not a plugin.
`scripts/validate-skills.py` fails if a manifest has no entry or an entry has no manifest.

```bash
# From a local clone
claude plugin marketplace add /path/to/skill-bazaar
# Or from GitHub
claude plugin marketplace add pepsi133/skill-bazaar

claude plugin install my-plugin@skill-bazaar
```

## Creating a plugin

```bash
cp -r templates/plugin/ plugins/my-plugin/
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) and [templates/plugin/](../templates/plugin/) for details.
