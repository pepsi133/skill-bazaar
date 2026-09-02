# Installing Skills — Claude Code

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and configured

## Installation

### Option 1: Symlink all skills (recommended)

Clone the marketplace repo, then symlink the skills directory:

```bash
git clone https://github.com/pepsi133/skill-bazaar.git
ln -s "$(pwd)/skill-bazaar/skills" ~/.claude/skills/marketplace
```

All skills will be automatically discovered by Claude Code at startup.

### Option 2: Symlink individual skills

If you only want specific skills:

```bash
ln -s /path/to/skill-bazaar/skills/mikrotik-routeros ~/.claude/skills/mikrotik-routeros
```

### Option 3: Install from the marketplace (per skill or plugin)

There is no single bundle plugin. **Every entry in the marketplace is installed by
name** — each `skills/<name>/` is packaged as its own plugin, alongside the bundles
under `plugins/<name>/`. Add the marketplace once, then install only what you want:

```bash
# Add the marketplace — a GitHub repo, or a local clone's path
claude plugin marketplace add pepsi133/skill-bazaar
# or: claude plugin marketplace add /path/to/skill-bazaar

# Then install entries by name — the full list:
claude plugin install mikrotik-routeros@skill-bazaar  # MikroTik RouterOS design, config, audit and troubleshooting
claude plugin install agent-delegation@skill-bazaar   # Protocol for briefing a subagent that cannot ask you mid-run
claude plugin install caveman@skill-bazaar            # Vendored, pinned caveman: ultra-compressed replies, ~75% fewer output tokens
claude plugin install limit-guard@skill-bazaar        # Pause a session before it burns the 5-hour or 7-day usage window, resume after the reset
claude plugin install ste@skill-bazaar                # Simple Technical English bridged to caveman; toggle with /ste on|off|status
```

The same commands are available as slash commands inside a session
(`/plugin marketplace add …`, `/plugin install …`).

The authoritative list of what is on offer is
[`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json).
`claude plugin marketplace list` shows the marketplaces you have configured, and
`claude plugin list` the plugins you have installed.

To try a skill without installing it, point Claude Code straight at its directory:

```bash
claude --plugin-dir /path/to/skill-bazaar/skills/mikrotik-routeros
```

## MCP Server Configs

To use shared MCP server configs, copy or merge them into your Claude Code
MCP configuration:

```bash
# Copy a specific server config
cp skill-bazaar/mcp-servers/my-server/mcp.json .mcp.json
```

Or merge into your existing `.mcp.json`.

## Updating

```bash
cd /path/to/skill-bazaar
git pull
```

Symlinked skills update automatically when you pull.
