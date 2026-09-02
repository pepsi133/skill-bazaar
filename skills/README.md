# Standalone Skills

Cross-tool portable skills — the core of this marketplace. Each one is a plain
[SKILL.md](https://agentskills.io/specification) folder that any compatible agent can
consume by clone + symlink, and is *also* packaged as a single-skill Claude Code plugin.

## Directory structure

```
skills/
└── my-skill/
    ├── SKILL.md             # Required: the skill, at the directory root
    ├── .claude-plugin/
    │   └── plugin.json      # Required: packages the folder as a one-skill plugin
    ├── references/          # Optional: supplementary docs the skill can pull in
    ├── scripts/             # Optional: helper scripts
    └── assets/              # Optional: images, templates, other resources
```

`SKILL.md` stays at the directory root — that is the layout every SKILL.md-compatible
tool expects. Claude Code loads a root `SKILL.md` as the plugin's single skill, and the
manifest declares `"skills": ["."]` to say so explicitly rather than relying on the
fallback (Claude Code ≥ 2.1.221; older versions rejected `"."`, use `"./"` there).

## The two-manifest rule

Every `skills/<name>/` ships **both**:

1. `skills/<name>/.claude-plugin/plugin.json`, whose `name` equals the directory name and
   the SKILL.md frontmatter `name`.
2. An entry in [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json)
   with the same `name`, `"source": "./skills/<name>"`, and a one-sentence `description`.

There is no root bundle plugin — the marketplace root is a marketplace, not a plugin, and
each skill installs by name. `scripts/validate-skills.py` enforces both directions: a
manifest with no marketplace entry fails, and a marketplace entry with no manifest fails.

## Creating a skill

```bash
cp -r templates/skill/ skills/my-skill/
```

Then fill in `SKILL.md`, `.claude-plugin/plugin.json`, and the marketplace entry. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the full checklist.

## Installing

```bash
# From a local clone
claude plugin marketplace add /path/to/skill-bazaar
# Or from GitHub
claude plugin marketplace add pepsi133/skill-bazaar

claude plugin install my-skill@skill-bazaar
```

Or use one of the clone + symlink routes in [docs/install/](../docs/install/), which work
with Antigravity/Gemini, OpenCode, Cursor, and Claude Code alike.
