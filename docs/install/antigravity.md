# Installing Skills — Antigravity / Gemini

## Prerequisites

- [Antigravity IDE](https://antigravity.google) or Gemini CLI installed

## Installation

### Option 1: Symlink all skills globally (recommended)

Clone the marketplace repo, then symlink into Gemini CLI's user-level skills directory:

```bash
git clone https://github.com/pepsi133/skill-bazaar.git
ln -s "$(pwd)/skill-bazaar/skills" ~/.gemini/skills/marketplace
```

`~/.agents/skills/marketplace` is an equivalent alias at the same (user) tier and takes
precedence if both exist. Skills will be available across all your workspaces.

### Option 2: Workspace-level skills

To add skills to a specific project only, symlink into the project's
`.agents/skills/` directory:

```bash
cd /path/to/your-project
mkdir -p .agents/skills
ln -s /path/to/skill-bazaar/skills/* .agents/skills/
```

### Option 3: Symlink individual skills

```bash
ln -s /path/to/skill-bazaar/skills/mikrotik-routeros ~/.gemini/skills/mikrotik-routeros
```

## Gemini CLI discovery paths

Gemini CLI discovers skills at these locations. Within a tier, `.agents/skills/` takes
precedence over `.gemini/skills/`:

1. **Workspace**: `<workspace-root>/.agents/skills/<name>/SKILL.md` or
   `<workspace-root>/.gemini/skills/<name>/SKILL.md`
2. **User**: `~/.agents/skills/<name>/SKILL.md` or `~/.gemini/skills/<name>/SKILL.md`

Checked against https://geminicli.com/docs/cli/skills/: there is no `config/` segment
in the real paths.

## MCP Server Configs

Gemini CLI reads MCP servers from the `mcpServers` key in `~/.gemini/settings.json` (or
`.gemini/settings.json` for a project-scoped config), not a standalone file. Merge the
contents of a server's `mcp.json` into that key:

```bash
cat skill-bazaar/mcp-servers/my-server/mcp.json
# then merge its contents into the "mcpServers" object in ~/.gemini/settings.json
```

## Updating

```bash
cd /path/to/skill-bazaar
git pull
```

Symlinked skills update automatically when you pull.
