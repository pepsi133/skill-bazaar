# Antigravity Workspace Skills

This directory is the Antigravity workspace skills discovery path (`.agents/skills/`).

## How it works

Antigravity automatically discovers skills in this directory. However, the
**canonical skills** for this marketplace live in the top-level `skills/`
directory.

To use marketplace skills with Antigravity, either:

1. **Symlink** the top-level skills into this directory:
   ```bash
   ln -s ../../skills/* .agents/skills/
   ```

2. **Or** symlink the top-level `skills/` directory into your global
   Antigravity config:
   ```bash
   ln -s /path/to/skill-bazaar/skills ~/.gemini/skills/marketplace
   ```

See [docs/install/antigravity.md](../../docs/install/antigravity.md) for
detailed setup instructions.
