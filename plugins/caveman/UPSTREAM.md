# Upstream pin — `plugins/caveman/`

This directory is a **vendored, pinned subset** of a third-party plugin. It is not
maintained here; it is copied from a single reviewed upstream commit and updated only
through a human-read diff (see [Update policy](#update-policy)).

| | |
|---|---|
| Upstream | <https://github.com/JuliusBrussee/caveman> |
| Pinned SHA | `ef6050c5e1848b6880ff47c32ade1a608a64f85e` |
| Upstream tag at that SHA | `v1.7.0` (exact match — `git describe --tags`) |
| Upstream commit date | 2026-05-01 |
| License | MIT — `Copyright (c) 2026 Julius Brussee` (shipped verbatim as `LICENSE`) |
| Upstream HEAD examined | `df2ccd85c94ec3c8289cb62ac020d241ccfb0c60` (2026-08-29). Drift examined and the pin **deliberately held**; see [Candidate cherry-picks](#candidate-cherry-picks). |

Every vendored file was copied from a pristine clone of upstream at the pinned SHA and
verified byte-identical to `git show ef6050c5e18…:<path>`. The local patches listed below
were applied afterwards, and the hash table records the patched bytes.

## Machine-readable twin

`UPSTREAM.json` in this directory carries the same repo URL, SHA and file→SHA-256 map in a
form `scripts/vendor-sync.sh` can read without a Markdown table parser, plus an `excluded`
array (the "Excluded from upstream" decisions below, as path prefixes) so a genuinely new
upstream file stands out from the ones we already decided against. The two files must agree;
`vendor-sync.sh` fails if the path lists drift apart.

Check the pin at any time — it exits 0 when the vendored bytes still match upstream:

```bash
scripts/vendor-sync.sh plugins/caveman
```

## Vendored files (29) — SHA-256 of the bytes in this repo

| Path | SHA-256 |
|---|---|
| `.claude-plugin/plugin.json` | `c871bb3cbd898b06c3f4b26aa6bb6c8d22b3d783f30a0229f06f686a196eb554` |
| `LICENSE` | `5eb826cd03151bcc7cce3f80d40e87733237fedfc6c36d6908aca5fd650a0bdb` |
| `agents/cavecrew-builder.md` | `d7f68a923779f04a59410f09ee48adf3edc4673301b19960059278339775a32b` |
| `agents/cavecrew-investigator.md` | `66239d2a35456d6d17a320f863dadedd31522d6860c9a7a3d235e85720e6721f` |
| `agents/cavecrew-reviewer.md` | `d1e07f832a6d20817b9bbae4d7b442d3fba4b42b68e535f851c83bb2517ad2d6` |
| `commands/caveman-commit.toml` | `7e8b8a070bc825d0b8764a8f060e618860697c951bb0c26a42bfb1129935630d` |
| `commands/caveman-review.toml` | `7571e79f0eb7a207be6eb6b38e4a46b7c2e3e6bfa90a577af53f2bc4084c2128` |
| `commands/caveman.toml` | `a031a349a181b2806e89bef7ec60f8616f19f96a4f8bc9261fe6666254a3efe7` |
| `hooks/caveman-activate.js` | `9366e01e5050c8ae415f2574a5cf9f792494b5a48fc14e1b90109ef01bbde03e` |
| `hooks/caveman-config.js` | `4e7a7707bb049ae05e5dc49cb8ebfffca56492610a878d6f36a0493cd5e9d96d` |
| `hooks/caveman-mode-tracker.js` | `0a3044b6635318fec9d14a9bd203ad2a8618acaa29f3988a5d45689a05f14e63` |
| `hooks/caveman-stats.js` | `4e58a6f1bf52aa02f59c881ec16448fb263e7fa2792b4386aae215f560dfcc17` |
| `hooks/caveman-statusline.ps1` | `0fbe831543f479950dfb63e842958cec3e26aa6933577194b31e656f4ad88969` |
| `hooks/caveman-statusline.sh` | `d2deff457d0a5d8e1848193e6af6a68a0ebdba4fbdf250889400d5ea231e088f` |
| `hooks/package.json` | `8005a3491db7d92f36ac66369861589f9c47123d3a7c71e643fc2c06168cd45a` |
| `skills/cavecrew/SKILL.md` | `b74f374f6aae6e9a31e78e7d876860406fe5833378e9298536edf176c12f379b` |
| `skills/caveman-commit/SKILL.md` | `c6faf4ea436407ff06c53bcdf7823364bbc5cf5f6e6d15d634002c700388e581` |
| `skills/caveman-help/SKILL.md` | `90756b65082b3edf2f317ceb5cff64f6c0624f2dedf92cf27bead058fd3866f7` |
| `skills/caveman-review/SKILL.md` | `178e2234f98ce7e45dff1a5eeede9e105630193542548551cd7c21ef42ac97e0` |
| `skills/caveman-stats/SKILL.md` | `1a0b4b09b7117f5b2a6100b84ca3f1a07d36826f638e2dc56d2089b3841ea187` |
| `skills/caveman/SKILL.md` | `6a93e68b5d843ab6da3290dfe81cfdf26de166be7f3feca5acb52744f63db593` |
| `skills/compress/SKILL.md` | `c3af1249a59a0924422b6e54e4691210b154f9ea4279010e7df32ac5dc6316c5` |
| `skills/compress/scripts/__init__.py` | `429c3e1c5cc5b9705f28d77f303c728304ae68693913ad3d5ce9b5a44c8ee40f` |
| `skills/compress/scripts/__main__.py` | `6d8b7d7846a845059d7a3107143f11131f63c5511d669b44085b15ec5e3d2279` |
| `skills/compress/scripts/benchmark.py` | `842f208bde8150d17e312eae851c9b0831533339a7c9b3562aaa5a231f40eebf` |
| `skills/compress/scripts/cli.py` | `caa8a8620990f15cbe4d4f5d4a43d33d7b136aac1c5a0f3e696444d5e151451d` |
| `skills/compress/scripts/compress.py` | `61ac8994770585354bcef2ab257bb62a9d83d08cae6be5e13bafdfcea7419acd` |
| `skills/compress/scripts/detect.py` | `7ab164dbcbc0b60e04d7f00257e2e691ce75a048f238f9a789c0b890a053f12b` |
| `skills/compress/scripts/validate.py` | `8b9e752b70868f6e03b3d7e76de19dd6b4ac92dad50522992738340e9916dc0d` |

Recompute at any time with, from this directory:

```bash
find . -type f ! -name UPSTREAM.md ! -name UPSTREAM.json ! -name README.md \
  | sed 's#^\./##' | sort | xargs sha256sum
```

### Why `hooks/package.json` is included

Upstream's `hooks/package.json` is `{"type": "commonjs"}`, byte-identical. Every hook uses
`require()` and there is no `package.json` above `hooks/` in this repo, so CommonJS is the
current default and the file is currently a no-op. It is vendored so that adding a root
`package.json` with `"type": "module"` to this repo later cannot silently break the hooks.

## Local patches

**Code patches: NONE.** Every `.js`, `.sh`, `.ps1`, `.py` and `.toml` file above is
byte-identical to upstream at the pinned SHA.

**Frontmatter-only patches, five skills:** one line
`disable-model-invocation: true` inserted after `name:` in `skills/caveman-commit`,
`caveman-review`, `compress`, `caveman-help`, `caveman-stats` `SKILL.md`. Effect: those
skills load only on explicit `/name`, so their descriptions no longer cost context every
session. Bodies untouched. Listed in `UPSTREAM.json` `modified`; the table above records the
patched bytes, so `vendor-sync.sh` reports them as expected patches. Revert = delete the line.

One **metadata-only** change, to `.claude-plugin/plugin.json` — two keys added, nothing
removed or altered:

```diff
 3a4,5
 >   "version": "1.7.0",
 >   "license": "MIT",
```

`version` is required by this repo's `scripts/validate-skills.py` (and by
`AGENTS.md` → Plugin Authoring Rules) and upstream's manifest has none; `1.7.0` is the
upstream tag that resolves to exactly this commit. `license` records the MIT terms the
`LICENSE` file already states. The `name`, `description`, `author` and — critically — the
`hooks` block (`SessionStart` → `caveman-activate.js`, `UserPromptSubmit` →
`caveman-mode-tracker.js`, both `timeout: 5`) are untouched. Upstream's sha256 for this file
is `77e448b7b70c2dbc9f772aea59722ff18c5811bcd5d8aeb629a85c7cca06fd56`; the table above
records the vendored bytes, so `vendor-sync.sh` will always report this one file as
differing. That is expected and is why the file is listed in `UPSTREAM.json`'s `modified`
array.

## Excluded from upstream, with reasons

These are **decisions, not omissions** — a file
appearing upstream that is not in the table above is out by choice.

| Excluded | Why |
|---|---|
| `commands/caveman-init.toml`, `tools/caveman-init.js` | **Permanent exclusion.** `/caveman-init` writes an activation-rule file into whatever repo the user currently has open — a write outside the plugin's own directory, a different risk profile from everything else here (which only touches `$CLAUDE_CONFIG_DIR`). Note for a future bump: the **pinned** `.toml` only says "run `node tools/caveman-init.js`" locally — it does **not** curl. At upstream HEAD the same file gained a `curl -fsSL …/main/src/tools/caveman-init.js \| node -` fallback, i.e. remote code execution from an unpinned author-controlled branch. Excluded at the pin for the write-scope reason; that exclusion now also covers the HEAD regression. |
| `caveman-setup`, `caveman-discover`, `caveman-learn`, `caveman-manage`, `caveman-optimize` skills | **Permanent exclusion.** Not present at this pin; they exist at upstream HEAD. They route the user's LLM traffic through the author's "Caveman Cloud" gateway (`gateway.caveman.so`, `app.caveman.so`). Shipping them would violate this repo's egress policy (AGENTS.md → "no endpoint the author chose"). Never vendor these. |
| `benchmarks/`, `evals/`, `tests/` | Maintainer dev tooling; not referenced by `plugin.json`, not reachable through normal use. |
| `caveman-compress/` (top-level dir) | Byte-identical `scripts/` to `skills/compress/scripts/` — duplicate packaging for the standalone Agent-Skills path, not what Claude Code's loader reads. Vendoring both means fixing bugs twice. |
| `install.sh`, `install.ps1`, `hooks/install.sh`, `hooks/uninstall.{sh,ps1}`, `hooks/README.md` | Installers and docs for caveman's non-plugin (curl-and-run) install path. Irrelevant once installed as a marketplace plugin. |
| `mcp-servers/caveman-shrink/` | `plugin.json` has no `mcpServers` key, so this is unreachable from the plugin. Separate component, separate threat model, would need its own review. |
| `.claude-plugin/marketplace.json`, `plugins/caveman/` (nested), `.agents/plugins/marketplace.json` | Upstream's own marketplace stubs — a third packaging surface. This repo's root `.claude-plugin/marketplace.json` is the one that registers the vendored copy. |
| `docs/`, `rules/`, `.codex/`, `.agents/`, `.cursor/`, `.windsurf/`, `.clinerules/`, `gemini-extension.json`, `GEMINI.md`, `CLAUDE.md`, `CLAUDE.original.md`, `AGENTS.md`, `README.md`, `.github/`, `CONTRIBUTING.md`, `.gitattributes`, `.gitignore`, `caveman.skill`, `caveman/` | Packaging, CI and docs for other tools or for upstream's own repo hygiene. None read by Claude Code's plugin loader. |
| `skills/compress/scripts/__pycache__/` | Build artifacts, not source. |

### BSL note (applies to any future bump, not to this pin)

At this pin upstream is uniformly MIT. At upstream HEAD it is **not**: `LICENSING.md` puts
`engine/`, `proxy/`, `cacheengine/`, `rewriter/`, `browse/`, `mcp/`, `shrink/`, the `mem/`
Go core and `shared/platform/` under Business Source License 1.1, whose Additional Use Grant
does not permit offering the work to third parties as a hosted/embedded service — which is
what publishing it in this marketplace would be. Upstream's scope note also says **new
Engine-linked runtime modules default to BSL-1.1**, so a file can change license without its
own diff announcing it. `scripts/vendor-sync.sh` refuses any vendored path that matches a
BSL row in upstream's `LICENSING.md`; on every bump, re-read that table rather than trusting
the check alone.

## Security review at the pinned commit

Static, read-only review of every hook file at this pin. **No upstream code was executed.**
Line numbers are from the pinned files.

| Concern | Finding | Evidence |
|---|---|---|
| Network calls | **Hooks: none.** No `fetch`/`http`/`https`/`net`/`dns`/`tls`/`axios`/`requests`/`urllib`/`socket` in any hook file (direct read of all six). **Skills: one, allowed.** `skills/compress/scripts/compress.py` calls Anthropic via the `anthropic` SDK with the user's own `ANTHROPIC_API_KEY`, falling back to the user's own `claude --print` subprocess — the permitted destination under AGENTS.md "Network egress policy". No author-chosen endpoint anywhere. The update-policy grep below must include `anthropic\|openai\|httpx\|subprocess\|--print` so an SDK client cannot pass a keyword gate again. | `skills/compress/scripts/compress.py:76-98` |
| `eval` / dynamic exec | **None.** No `eval()`, `Function()`, shell-string `exec`. The one subprocess is `execFileSync` with a fixed argv array (no shell), re-invoking the sibling `caveman-stats.js` for `/caveman-stats`. | `hooks/caveman-mode-tracker.js:44-54` |
| Flag-file write, symlink hardening | `safeWriteFlag` refuses a symlinked parent dir not owned by the current user (on Windows, outside `$HOME`); refuses if the flag itself is a symlink; writes via `O_EXCL\|O_NOFOLLOW` temp file + atomic rename, mode 0600. | `hooks/caveman-config.js:81-145` |
| Flag-file read | `readFlag` `lstat`s and rejects symlinks, hard-caps at 64 bytes, and requires the value to be in `VALID_MODES` or returns `null` — a corrupted, oversized or symlinked flag never reaches model context. | `hooks/caveman-config.js:158-190` |
| History-log append | `appendFlag`: identical symlink/ownership checks, `O_APPEND\|O_NOFOLLOW`, 0600. | `hooks/caveman-config.js:198-249` |
| Writes outside the config dir | None. Two files under `$CLAUDE_CONFIG_DIR`: `.caveman-active` (mode flag) and `.caveman-history.jsonl` (session id / mode / model / token counts, no prompt text). No crontab, profile or daemon writes. | `hooks/caveman-stats.js:296-320` |
| Reads conversation content | `caveman-stats.js` reads the user's own session transcript JSONL under `~/.claude/projects/` to count tokens. Local-only, no egress — but it is the one file that touches conversation content rather than just its own state. | `hooks/caveman-stats.js:48-93` |
| Control-byte / ANSI rendering | `caveman-statusline.sh` refuses a symlinked flag, caps the read at 64 bytes, strips to `[a-z0-9-]` and whitelists known modes before printing — a local attacker planting ANSI/OSC escapes in the flag cannot render them in the terminal. | `hooks/caveman-statusline.sh:16-28` |
| Per-turn context injection | The reinforcement string is read through the hardened `readFlag`, never as raw bytes, before becoming `additionalContext`. | `hooks/caveman-mode-tracker.js:119-129` |

**Verdict for this pin: no findings of concern.** The symlink/size/whitelist hardening
throughout is more defensive than the median hook script.

Two non-vulnerability findings carried forward:

- **Auto-Clarity triple-copy drift (behavioural).** The fallback ruleset exists in three
  independently-maintained copies that can silently diverge: canonical
  (`skills/caveman/SKILL.md:54-74`), the hardcoded standalone-install fallback
  (`hooks/caveman-activate.js:92-110`), and a one-line per-turn paraphrase that drops two of
  five trigger conditions (`hooks/caveman-mode-tracker.js:124-127`). Relevant to the `ste`
  plugin, which depends on Auto-Clarity firing reliably.
- **`hooks/caveman-statusline.ps1` was not reviewed line-by-line at this pin.** It is
  vendored, but Windows parity is **not** claimed. (Upstream HEAD's `.ps1` is at parity
  with the `.sh`; that hardening is a candidate cherry-pick, not what is shipped here.)

## Update policy

Never trust-on-first-use against upstream `main`. Never a submodule, never a live subtree.

1. Run `scripts/vendor-sync.sh plugins/caveman <candidate-sha>`. It fetches upstream at that
   SHA with `git` only, diffs the vendored file list, and exits non-zero if anything differs.
   It never writes into `plugins/caveman/` and never executes upstream code.
2. **Read every printed diff line in full context.** Diff-only review is acceptable when the
   diff is small (a handful of lines, one or two files). A diff touching
   `caveman-config.js`'s symlink handling, or introducing any new file outside the vendored
   list, requires the full six-point review above again — not a glance at the diff stat.
3. Re-check upstream's `LICENSING.md` by hand for MIT→BSL moves (see the BSL note above).
   Re-run the egress grep over the whole vendored tree with the full vocabulary —
   `fetch|https?://|net\.|dns\.|tls\.|axios|requests|urllib|socket|anthropic|openai|httpx|subprocess|child_process|--print`
   — and classify every hit as user-credentialed Anthropic (allowed) or anything else (stop).
4. Apply the change by hand, then recompute the SHA-256 table for every file touched, and
   bump the SHA and the hash table in this file and in `UPSTREAM.json`, in the same commit
   as the code change.

**Re-evaluate on a trigger, not a schedule:** an upstream release whose notes name the
Claude Code hooks or `skills/caveman/SKILL.md`. Platform releases need no review.

### Candidate cherry-picks

A read-only audit of upstream HEAD (`df2ccd85c9`, 2026-08-29: 294 commits ahead of the pin,
93 touching the plugin surface) concluded: **stay on `ef6050c…` and cherry-pick.** A full
bump nearly triples the hook JavaScript (896 to 2,532 lines), imports the `caveman-init`
curl fallback and the Caveman Cloud skills excluded above, and puts the MIT/BSL boundary
under per-bump policing. The changes worth taking are confined to `SKILL.md` text,
`caveman-stats.js`, `caveman-config.js` and a `plugin.json` timeout. Diffs were read, not
inferred from subject lines.

| # | Upstream commit(s) | What it changes | Files at this pin | Lines |
|---|---|---|---|---|
| 1 | `f436843` session-scoped mode | Mode state moves from one machine-wide `.caveman-active` to `.caveman-sessions/<session_id>.mode`, keyed on the `session_id` in every hook payload. Fixes three bugs: parallel windows shared one mode; "off" was spelled *file absent*, so `SessionStart` re-derived the default after every compaction and undid an explicit "stop caveman"; the statusline showed whichever window wrote last. | `hooks/caveman-config.js`, `caveman-activate.js`, `caveman-mode-tracker.js`, `caveman-stats.js`, both statusline scripts | ~450-500, hooks only; drop the installer changes |
| 2 | `e11d002` | Hook `timeout` 5s to 30s for both hooks, with event-driven stdin parsing in `caveman-activate.js`. A lagging pipe close on Windows burned the 5s budget before the flag was written or the ruleset emitted. | `.claude-plugin/plugin.json` | 2 |
| 3 | `710173f` | `SKILL.md`: never drop not/never/no/only/except; no preamble around tool calls; language-drift hardening under compaction; CJK particles exempt from article-dropping. | `skills/caveman/SKILL.md` | ~18 |
| 4 | `f06348c` | Preserve the user's language; no self-reference; no tool-call narration; no invented abbreviations. | `skills/caveman/SKILL.md`, `caveman-commit`, `caveman-help` | ~20 |
| 5 | `456de36`, `f68111a`, `aaaf97d` | Pricing table corrections: the Opus output price for the 4.5+ era, Claude 5 family rows (5-series sessions dropped the USD line entirely), the Sonnet 5 price, a fabricated `claude-haiku-5` row removed. | `hooks/caveman-stats.js` | ~25 |
| 6 | `8909f6a` | Shorter skill descriptions. Claude Code budgets about 6,000 characters for the skill listing, and overflow is binary per skill: a skill past the cutoff renders as a bare name with no description. | frontmatter of the vendored `SKILL.md` files | ~40 |
| 7 | `82864c8` (extracted) | Standalone skills absent at the pin: `investigate-first`, `lean-build`, `safe-refactor`, `verify-and-stop`, `surgical-patch`, `migration`. Drop the Codex-only `agents/openai.yaml` companions. `lean-build` references `skills/native-core.md`. | new `skills/*/SKILL.md` | ~100 |
| 8 | `e9cb843`, `d833f4a`, `6919dc2`, `8a5ab60` | Stats honesty: attribute tokens to the mode active when each message happened; an "Est. net" line that subtracts the rule-injection overhead; a correctly labelled headroom meter. | `hooks/caveman-stats.js`, small touches to `caveman-config.js` and `caveman-mode-tracker.js` | ~250-300 |
| 9 | `781c384` | `SKILL.md`: never add a word to sound caveman; compression must not grow output. | `skills/caveman/SKILL.md` | 4 |
| 10 | `dcd51f1`, `4b1c03f`, `4345fde`, `339443f`, `a6261ef` | `compress.py` hardening: UTF-8 on every read and write (a locale codec error could leave the target file at 0 bytes), atomic writes, `credentials` and `secrets` path components blocked, `O_NOFOLLOW` on the lock file, a lock timeout instead of a hang. | `skills/compress/scripts/{compress,detect,validate}.py` | ~210 |
| 11 | `.ps1` hardening | `caveman-statusline.ps1` at parity with the `.sh` symlink, size and whitelist checks. | `hooks/caveman-statusline.ps1` | ~30 |

**Ordering constraint:** items 1 and 8 both rewrite `caveman-stats.js` attribution and both
touch `caveman-config.js`. Take `f436843` first, then the stats bundle. The other items are
independent.

**Not applicable, recorded so nobody backports a no-op:** `0385ad9` removes an `"agents"`
array from `plugin.json` that made Claude Code 2.1.235 load zero agents. The pinned
`plugin.json` has no `agents` key; the bug was introduced after the pin and fixed before
HEAD.

Every cherry-pick goes through the update policy above: read the diff in full context,
re-run the egress grep, recompute the hashes, and record the change under Local patches.
