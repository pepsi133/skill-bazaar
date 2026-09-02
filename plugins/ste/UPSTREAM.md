# UPSTREAM — vendored third-party files in `plugins/ste/`

This plugin is two things in one directory:

| Part | Origin | License |
|---|---|---|
| The bridge (`hooks/`, `skills/ste/`, `tests/`, `README.md`, this file) | Written for this repo | MIT |
| The ruleset (`skills/simple-english/`, `prompts/system-prompt.md`) | Vendored from `AminBlg/SimpleEnglish` | MIT |

## Upstream

- **Repository:** https://github.com/AminBlg/SimpleEnglish
- **Pinned commit:** `34855f2ab2101e939618b9fe3151b74a2720d300`
- **Upstream version at that commit:** 2.0.0
- **License:** MIT, Copyright (c) 2026 AminBlg — full text at
  [`vendor/LICENSE.SimpleEnglish-MIT`](vendor/LICENSE.SimpleEnglish-MIT)
- **Local patches:** one, frontmatter-only: `disable-model-invocation: true`
  inserted after `name:` in `skills/simple-english/SKILL.md`, so the skill loads only on
  `/simple-english` (the SessionStart hook injects the STE prompt regardless). Body
  untouched; revert = delete the line. Listed in `UPSTREAM.json` `modified`. Every other
  vendored file is byte-identical to upstream at the pinned commit; the hash table below is
  the check (it records the patched bytes for that one file).
- **Machine-readable twin:** `UPSTREAM.json`, read by `scripts/vendor-sync.sh`
  (`scripts/vendor-sync.sh plugins/ste <sha>`). The renamed license file is outside its
  reach (see the table note).

The files were copied from a read-only clone of upstream checked out at the pinned commit.
Upstream code was never executed.

## Vendored files

`sha256`, computed against the pinned commit and against the copies in this directory
(identical, except the one patched file noted above).

| Path | sha256 |
|---|---|
| `prompts/system-prompt.md` | `73dacf384adf2f158646c03fba3eb2899880c906631e4206e4e9d96ecbcd0b9d` |
| `skills/simple-english/SKILL.md` | `defad72e3b11910e75198193e8af5a39fecc23010424d77c48ce83f09c8f6329` |
| `skills/simple-english/references/checklist.md` | `56c8296bd382a20912c4f789b2dd259d42f194c6a6686a25ea028f51aa0e130b` |
| `skills/simple-english/references/strict-vocabulary.md` | `3f34ef3a878d9dc83de68191b5ddd6220fdb4e3c99eafc89425adfabd46258a7` |
| `skills/simple-english/references/use-cases.md` | `6c5b342f706d346255466b86400d11d558c4db677a2f7ca5ec4dedb978df8a7c` |
| `skills/simple-english/references/word-swaps.md` | `e6cbc5677e3a910190eedf3d87fce49540b42863a6f2166cd1211dcce2074378` |
| `vendor/LICENSE.SimpleEnglish-MIT` | `10b2f9435643bae609e4c1a7690131b2aeb6941e9d867e934bc80619935a6f8f` |

Seven files, about 43 KB. Regenerate the table with:

```
cd plugins/ste && find skills/simple-english prompts vendor -type f | sort | xargs sha256sum
```

The upstream layout is preserved for `skills/simple-english/` and `prompts/`, so a path
in the table above is also the upstream path. `LICENSE` is the one exception: upstream
keeps it at the repository root, and this repository's own root `LICENSE` is also MIT but
under a different copyright holder, so the MIT text for `skills/simple-english/` lives at
`vendor/LICENSE.SimpleEnglish-MIT` instead, keeping the correct copyright notice attached
to the copy. MIT requires only that the notice travel with the copy, not that it keep a
particular filename.

## Excluded files, and why

| Excluded | Why |
|---|---|
| `src/hooks/simple-english-activate.js` | Replaced by `hooks/ste-activate.js`, which does the same job and adds the bridge block and the on/off state. Vendoring both would mean two SessionStart hooks injecting the same ruleset twice. |
| `src/hooks/lint_hook.py` | The two advisory linters. Dropped on purpose — see "The two linters" in [README.md](README.md), which records the trade-off and the exact steps to add them back. |
| `evals/ste_lint.py` | Only reachable through `lint_hook.py`. Dropped with it. |
| `evals/` (the rest: `run_bench.py`, `run_pi_bench.py`, `run_reply_bench.py`, `scenarios.json`, `reply_scenarios.json`, `pressure-tests.md`, `slop.tsv`, `score_text_dir.py`, `test_run_pi_bench.py`, `results/`) | Maintainer benchmark harnesses. Not wired to any hook, run by hand against local CLIs, and `results/` is hundreds of fixture files. Pure bloat in a plugin. |
| `output-styles/simple-english.md` | A Claude Code output style is selected by the user through `/config`, and it competes with this plugin's own SessionStart injection. Shipping both invites a session where the style and the hook disagree about whether caveman wins. |
| `.claude-plugin/plugin.json` | Upstream's manifest, which registers upstream's three hooks. This plugin has its own manifest and its own two hooks. |
| `package/`, `examples/before-after.md`, `README.md` | Documentation and packaging artifacts, not runtime. |
| `src/hooks/simple-english-activate.test.js` | Test for a file that is not vendored. |
| `.codex-plugin/`, `hooks/hooks.json` (upstream's), `.agents/plugins/marketplace.json` | Packaging for other tools and other standards. Claude Code reads none of them. |

## Security review at the pinned commit

Static, read-only review of upstream at the pinned commit. No upstream code was executed.

| Concern | Finding | Upstream file:line |
|---|---|---|
| Network calls | None. `grep` for `fetch\|axios\|requests\.\|urllib\|http\.client\|socket\.` across the repository (fixtures excluded) returns nothing. | n/a |
| `eval` / dynamic exec | None. No `eval()`, `exec()`, `os.system`, or `shell=True` anywhere in shipped code. | n/a |
| SessionStart execution | Reads only its own bundled `prompts/system-prompt.md` through a short fixed candidate list, all plugin-relative; writes only to stdout. | `src/hooks/simple-english-activate.js:61-68`, `:21-32` |
| Reads outside the repository, or of dotfiles | None. `readFirstFile` tries only `pluginRoot`/`hookDirectory`-relative paths. | `src/hooks/simple-english-activate.js:34-43` |
| Writes outside its own directory | None in shipped hooks. `lint_hook.py` only reads `tool_input.file_path`, the file the model itself just wrote. | `src/hooks/lint_hook.py:39-59` |
| Symlink handling | No shared or predictable state file exists upstream (the plugin is stateless), so the symlink-clobber class does not apply. The one read path is a plain `fs.readFileSync` over a fixed candidate list. | `src/hooks/simple-english-activate.js:34-43` |
| Persistence | None upstream — no flag file, no config file, no profile or crontab writes, no daemons. | n/a |
| PostToolUse / Stop advisory hook | Lints `.md` files through `evals/ste_lint.py` (pure regex, 208 lines, no exec and no network), prints a violation count to stderr, exits 2 (advisory). The Stop hook always exits 0, so it cannot loop. | `src/hooks/lint_hook.py:39-59`, `:62-81` |

**Result: no findings of concern.** Note that the two vendored artifacts are Markdown
prose, not code: nothing in `skills/simple-english/` or `prompts/system-prompt.md`
executes. The whole executable surface of this plugin is the three Node files in `hooks/`,
which were written here and are covered by `tests/`.

## Bumping the pin

1. Clone upstream read-only into a scratch directory and check out the new commit. Do not
   execute anything from it.
2. `diff -ru` the vendored paths against the new commit. Read every changed line.
3. Re-run the egress and dynamic-execution greps from the table above.
4. Copy the changed files, regenerate the hash table, and update the pinned SHA and the
   version at the top of this file.
5. Run `node --test` from `plugins/ste/`. The tests read the vendored prompt, so a
   breaking change to its shape fails there.
