# MCP server config template

Copy `mcp.json` to start a new entry under `mcp-servers/`, then delete this file:

```bash
mkdir -p mcp-servers/your-server-name
cp templates/mcp-server/mcp.json mcp-servers/your-server-name/mcp.json
```

Write a `README.md` beside it naming every environment variable the server needs. That is
rule 3 of the MCP rules in `AGENTS.md`, and it is the only place a user learns what to set.

## Why this file is `mcp.json` and not `.mcp.json`

Two different things share the `mcpServers` JSON shape, and only one of them is loaded by a
tool. Copying the wrong one into the wrong place fails silently — nothing reports an
unrecognized path.

| | `mcp-servers/<name>/mcp.json` | `plugins/<name>/.mcp.json` |
|---|---|---|
| What it is | A portable source config a user copies out | A plugin-scoped config Claude Code loads |
| Who reads it | Nobody, until a user copies it | Claude Code, automatically |
| Where it goes | Copied to `.mcp.json`, `.cursor/mcp.json`, or pasted into `~/.gemini/settings.json` | Stays at the plugin root, dotted |
| This template | Yes — undotted on purpose | No. See `templates/plugin/TEMPLATE.md` |

So the undotted name here is deliberate: this directory holds configs that are *offered* to
a user for several tools, not a file any one tool picks up. `docs/install/claude-code.md`
shows the copy step (`cp … mcp.json .mcp.json`), and `mcp-servers/README.md` lists where each
tool reads from.

If you are adding MCP servers to a plugin rather than publishing a standalone config, you
want `.mcp.json` at that plugin's root instead, and none of this directory applies.
