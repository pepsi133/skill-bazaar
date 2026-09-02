# Plugin template

Copy this directory to start a new plugin, then delete this file — it documents the
template, not your plugin, and `README.md` is where your plugin's own docs go:

```bash
cp -r templates/plugin/ plugins/your-plugin-name/
rm plugins/your-plugin-name/TEMPLATE.md
```

## What goes where

| Path | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Required manifest — `name`, `description`, `version`. The `author` block ships as the `your-github-handle` placeholder; **replace both `name` and `url` with your own handle** before submitting. |
| `README.md` | Your plugin's documentation — write it yourself, this template ships none. |
| `skills/<name>/SKILL.md` | Plugin-scoped skills, same authoring rules as `skills/` at the repo root. |
| `hooks/hooks.json` | Tool-specific hooks. Ships an empty `"hooks": {}` plus a top-level `_comment` key holding the one example in prose (JSON has no comment syntax). |
| `.mcp.json` | Optional. Add it yourself if the plugin needs MCP server connections — not scaffolded by default. |

## Hooks example

`hooks/hooks.json` is inert until you add an entry. A `PreToolUse` hook that runs a bundled
script before every `Bash` call looks like:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/check-bash.sh"
          }
        ]
      }
    ]
  }
}
```

Once you've filled in the `hooks` object, delete the `_comment` key and keep `hooks`.
`_comment` was left as a top-level, non-`hooks` field so it does not interfere with hook
parsing, but it is not part of the schema. Full reference:
https://code.claude.com/docs/en/hooks.md

## Testing locally

```bash
claude --plugin-dir plugins/your-plugin-name
```

Then run `/plugin` inside Claude Code to confirm it loaded, or add it to
`.claude-plugin/marketplace.json` and use `/plugin install` for the full install path.
