# Installing Skills — OpenCode

## Prerequisites

- [OpenCode](https://opencode.ai) installed and configured

## Installation

### Option 1: Symlink all skills (recommended)

Clone the marketplace repo, then symlink the skills directory:

```bash
git clone https://github.com/pepsi133/skill-bazaar.git
ln -s "$(pwd)/skill-bazaar/skills" ~/.config/opencode/skills/marketplace
```

### Option 2: Configure in opencode.json

Add the marketplace skills path to your `opencode.json` or `opencode.jsonc`:

```jsonc
{
  "skills": [
    "/path/to/skill-bazaar/skills"
  ]
}
```

### Option 3: Symlink individual skills

```bash
ln -s /path/to/skill-bazaar/skills/mikrotik-routeros ~/.config/opencode/skills/mikrotik-routeros
```

## OpenCode discovery paths

OpenCode discovers skills at:

- **Project**: `.opencode/skills/<name>/SKILL.md`
- **Global**: `~/.config/opencode/skills/<name>/SKILL.md`
- **Compatible paths**: OpenCode also checks `.claude/skills/` and `.agents/skills/`

## MCP Server Configs

OpenCode uses the standard `mcpServers` format in `opencode.json`:

```jsonc
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@scope/mcp-server"]
    }
  }
}
```

Copy server configs from `mcp-servers/` and merge into your `opencode.json`.

## Updating

```bash
cd /path/to/skill-bazaar
git pull
```
