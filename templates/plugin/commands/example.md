---
description: One line saying what this command does, shown in the slash-command list
---

Write the instructions the model follows when someone runs this command. The whole
body is the prompt, so address the model directly and be specific about what to do,
what to show the user first, and what never to touch.

Rename this file to name the command. `commands/install.md` in a plugin named
`my-plugin` becomes `/my-plugin:install`. The plugin name comes from `plugin.json`,
the command name from this filename.

Available in the body:

- `${CLAUDE_PLUGIN_ROOT}` — absolute path to the plugin directory
- `$ARGUMENTS`, or `$1` to `$9` — what the user typed after the command
- `` !`command` `` — runs a shell command and puts its output in the prompt
- `@path/to/file` — includes a file's contents

Optional frontmatter keys: `argument-hint`, `allowed-tools`, `disable-model-invocation`
(set it to `true` to keep the command out of the model's reach, so only a human can run it).

The file must end in `.md` and must carry frontmatter. Claude Code globs this directory
for `.md` only, and it does not warn about anything else it finds — a command shipped
as `.toml`, `.yaml`, or `.json` is not rejected, it simply never registers, and neither
`claude plugin validate` nor a test that reads the file itself will notice. Run
`python3 scripts/validate-skills.py` to catch that before you ship.
