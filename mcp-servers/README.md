# MCP Server Configurations

Shared, cross-tool MCP (Model Context Protocol) server configurations.

## Format

Each server config uses the standard `mcpServers` JSON format:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@some-org/mcp-server"],
      "env": {
        "API_KEY": "${MCP_SERVER_API_KEY}"
      }
    }
  }
}
```

## Cross-tool compatibility

This format is recognized by:
- **Claude Code** — reads from `.mcp.json` or project config
- **Antigravity/Gemini** — reads the `mcpServers` key in `~/.gemini/settings.json` (or project-scoped `.gemini/settings.json`)
- **Cursor** — reads from `.cursor/mcp.json`
- **OpenCode** — reads from `opencode.json` `mcpServers` section
- **Most MCP-speaking agents**

## Rules

1. **Never hardcode secrets.** Use environment variable placeholders: `${VAR_NAME}`
2. **Never hardcode absolute paths.** Use relative paths or env vars.
3. **Include a README** in each server directory explaining setup and required env vars.

## Adding a server config

```bash
cp -r templates/mcp-server/ mcp-servers/your-server-name/
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.
