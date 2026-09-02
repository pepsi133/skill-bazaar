# caveman (vendored)

Ultra-compressed communication mode for Claude Code. Cuts roughly 75% of output tokens by
answering in terse caveman style while keeping technical substance exact — code, commands,
identifiers and numbers are never abbreviated. Intensity levels: `lite`, `full` (default),
`ultra`, plus `wenyan-*` variants, and `off`.

Two hooks do the work: `SessionStart` writes the mode flag and injects the ruleset,
`UserPromptSubmit` parses `/caveman*` prompts and re-injects a one-line reinforcement each
turn. Everything else — skills, agents, slash commands — is text.

## This is a pinned vendored copy

**Upstream is [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman), MIT,
Copyright (c) 2026 Julius Brussee.** This directory is a copy of a *subset* of that repo at
one reviewed commit (`ef6050c5e18…`, tag `v1.7.0`). It does not track upstream and does not
auto-update. Read [`UPSTREAM.md`](UPSTREAM.md) for the pin, the per-file SHA-256 table, what
was deliberately left out and why, the security review, and the update procedure. The
upstream `LICENSE` ships verbatim as [`LICENSE`](LICENSE).

Nothing here is maintained in this repo. Do not edit the vendored files — a local fix
becomes an invisible fork that the next sync silently reports as drift. Change the pin
instead, through the procedure in `UPSTREAM.md`.

## Install

```
/plugin marketplace add <this repo>
/plugin install caveman@skill-bazaar
```

Verify the plugin manifest before or after installing:

```bash
claude plugin validate plugins/caveman
```

### Name clash — read this before enabling

Upstream publishes its own marketplace, also named `caveman`, so the installed identity
there is `caveman@caveman` while this one is `caveman@skill-bazaar`. The
identities differ, so there is no install-time collision — but **if both are enabled, both
fire**. Claude Code concatenates both plugins' `SessionStart` output (the same ruleset,
twice) and runs both `UserPromptSubmit` hooks on every turn (the same reinforcement string,
twice). For a tool whose entire purpose is cutting token overhead, doubling its own overhead
is the specific failure to avoid. Both also target the same flag file; the atomic-rename
write means nothing corrupts, but it is still two hook processes doing redundant work every
turn.

So, before enabling this one:

1. `/plugin uninstall caveman@caveman`
2. Remove the upstream `caveman` marketplace (`/plugin marketplace remove caveman`),
   otherwise it can be reinstalled or re-enabled by accident.
3. Then install and enable `caveman@skill-bazaar`.

Keep *this* copy as the one in use: it is the one that is security-reviewed at a fixed
commit and gated by `scripts/vendor-sync.sh`. The upstream-marketplace copy follows whatever
upstream ships next, which is the problem vendoring exists to solve.

## Statusline — a manual step

The statusline badge is **not** wired automatically. Plugins cannot set the main
`statusLine`, so you have to point `~/.claude/settings.json` at the script yourself:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash /path/to/skill-bazaar/plugins/caveman/hooks/caveman-statusline.sh"
  }
}
```

**Already running limit-guard's statusline?** Chain through its wrapper rather than picking
one — set `LIMIT_GUARD_INNER` to the caveman command and limit-guard prints its output and
appends its own badge:

```json
{
  "statusLine": {
    "type": "command",
    "command": "LIMIT_GUARD_INNER='bash /path/to/skill-bazaar/plugins/caveman/hooks/caveman-statusline.sh' bash /path/to/skill-bazaar/plugins/limit-guard/hooks/limit-guard-statusline.sh"
  }
}
```

`LIMIT_GUARD_INNER` is split on whitespace and run as an argv vector, never through a shell,
so paths containing spaces are not supported. See
[`../limit-guard/README.md`](../limit-guard/README.md) for the exact semantics.

**If you are migrating from `caveman@caveman`:** your current `statusLine.command` almost
certainly points into the plugin cache
(`~/.claude/plugins/cache/caveman/caveman/ef6050c5e184/hooks/caveman-statusline.sh`). That
path goes stale the moment the upstream plugin is uninstalled and its cache pruned, and it
was never safe to begin with — a cache path moves on every plugin update, so pointing a
statusline at it means executing whatever landed there this morning. Repoint it at a clone
of this repo, as above.

## Precedence with `ste`

When [`ste`](../ste/README.md) is installed, the two styles do not compete for the same
turns. The rule, as `ste` states it:

> **Precedence: caveman wins for ordinary turns. STE wins whenever caveman itself says to
> drop compression** (security warnings, irreversible actions, multi-step sequences,
> ambiguity, or the user asking to clarify).

`ste` also **manages caveman's `defaultMode`**: set the mode with `/caveman <mode>`; ste
observes it and persists it as `defaultMode`. Do not also set it through
`CAVEMAN_DEFAULT_MODE` or `$XDG_CONFIG_HOME/caveman/config.json`, or the two will fight.
`ste` itself exposes only `/ste on|off|status` — it has no mode argument of its own.

## What it writes

Two files under `$CLAUDE_CONFIG_DIR` (default `~/.claude`): `.caveman-active`, the current
mode, and `.caveman-history.jsonl`, one line per session with mode, model and token counts —
no prompt text. Both writes are symlink-hardened and 0600. `/caveman-stats` additionally
*reads* your own session transcripts under `~/.claude/projects/` to count tokens. The hooks
have no network client. The one path that sends data off-box is `/compress`
(`skills/compress/scripts/compress.py`): it sends the file you name to Anthropic through
your own `ANTHROPIC_API_KEY` or, failing that, your own `claude --print` — the allowed case
in AGENTS.md's egress policy — and refuses sensitive paths by denylist. Nothing else in this
directory talks to the network.

`$XDG_CONFIG_HOME/caveman/config.json` (or `~/.config/caveman/config.json`) sets
`defaultMode` if you want a persistent default; `CAVEMAN_DEFAULT_MODE` overrides it —
unless `ste` is installed, which manages `defaultMode` for you (see above).

## Open questions

1. **Windows parity is not claimed.** `hooks/caveman-statusline.ps1` is vendored but was
   **not** reviewed line by line at this pin. Run `UPSTREAM.md`'s six-point checklist against
   it before advertising Windows support. Upstream HEAD's `.ps1` is hardened to parity with
   the `.sh` and is a candidate cherry-pick (see "Candidate cherry-picks" in `UPSTREAM.md`).
2. **`mcp-servers/caveman-shrink` is left out entirely.** `plugin.json` never registers it.
   If it is wanted it needs its own review pass — an MCP server is a different threat model
   from a hook — and its own `UPSTREAM.md` file-table entry.
3. **Do `commands/*.toml` register slash commands in current Claude Code?** Upstream commits
   after this pin assert Claude Code scans only `commands/*.md` and ignores `.toml` (Codex
   and Gemini read the `.toml`), contradicting an earlier upstream commit. **UNVERIFIED.**
   If true, the three vendored `.toml` files register nothing and `/caveman`,
   `/caveman-commit`, `/caveman-review` work only because the `UserPromptSubmit` hook regex
   intercepts the raw prompt text — which it does independently, so the commands work either
   way. Worth settling before anyone debugs a "missing" slash command.
4. **The candidate cherry-picks have not landed.** `UPSTREAM.md` lists the upstream fixes
   worth taking on top of this pin (session-scoped mode, the 5s to 30s hook timeout,
   `SKILL.md` correctness fixes including "never drop not/never/no", the `caveman-stats.js`
   pricing corrections). Until they land, this copy carries the known upstream bugs those
   commits fix: "stop caveman" does not survive a `/compact`, and `/caveman-stats` shows
   wrong or absent dollar figures on current models.
