---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Cluster B spec: config-layers, config-rules, operator-rules

Plugin root: `plugins/decision-board/` (all paths below are relative to it unless they start with `roadmap/`).
`S` = `skills/decision-board/scripts/board.mjs`, `R` = `skills/board-refresh/scripts/refresh.mjs`,
`PAGE` = `skills/decision-board/assets/board.html`.

`REF` = `skills/decision-board/references/`, `SKILL` = `skills/decision-board/SKILL.md`,
`RSKILL` = `skills/board-refresh/SKILL.md`.

This spec is final: every operator question of this cluster is answered (see "Calls made", "operator answer"),
and no step carries an open marker.

Preconditions for the whole cluster: cluster A landed exactly as `decision-board-spec-a-core.md` (final) says, and step B0 (the
name check, section 0 below) passed. Every test under `tests/` exits 0 before step B1. "Tests green" = from the
plugin root, `for t in tests/*-test.js tests/*-test.mjs; do node "$t" > /dev/null || echo FAIL "$t"; done`
prints nothing.

Cluster A facts this spec builds on (from `decision-board-spec-a-core.md`, final):
- the first `check` line is
  `` `state ${path.relative(process.cwd(), r.file) || r.file}: cards ${n} (${counts}); times in ${P.cfg.tz}` ``
  (written inline; `cmdCheck` declares no local `rel`), and the `note: the config agent ...` line is gone;
- `agent` stays a config key (display name, default `Claude`); `tz` is a key of `DEFAULTS`, default
  `"Europe/Warsaw"`, written after `tags`, but its position is not a contract; `check` refuses an invalid `tz` with
  `` `config tz: ${q(raw.tz)} is not a time zone name such as "Europe/Warsaw" or "UTC"` `` and never a missing one;
- `guideId(id)` returns `--id` unchanged, so a write of guide `rules` is the document `guides/rules`;
- `read --dump <dir> [--all] --dumped` calls `r.logHandled(dump, log)` (after the `rules:` line of this cluster); `ack` and `adopt` as A 2.4;
- the state has no `agent` field; the older-model refusal accepts unknown new state keys (B adds `rules_md`);
- `export const FLAGS` holds one line per command and `export const COMMANDS` exists; B adds no command and no flag,
  so B changes no `FLAGS` line;
- every printed write array is followed by its `if refused:` and `if the reply is lost:` lines (A 2.4 step 8);
  a write of `guides/<id>` has the group `guides/<id>`;
- the page footer is `<footer id="foot" class="foot"><span id="zone" class="small muted"></span></footer>`, `#zone`
  first, and `render()` holds `$("zone").textContent = zoneNote(cfg.tz);`; B adds the settings line as the next
  child of `#foot`;
- the build, change-the-page and clean-up text is in `REF/build.md` and `REF/cleanup.md`, not in `SKILL`; `SKILL`
  is at most 8000 characters (board-test "SKILL.md stays short") and names `artifact-capabilities` once, at `P1`;
- tests: `fresh()` has no `agent`, `cmd(b, ...argv)` = `sh(...argv, "--state", b.state)`,
  `ok2(b, ...argv)` = `cmd(b, ...argv, "--dump", dumpNow(b), "--dumped")`; every config a test writes sets `tz`
  (`"UTC"` unless the case names another zone); no test pins an exact count, an exact full key list or a key
  position: tests assert membership, a pattern, or a list computed from the live code (`CONFIG_KEYS`, `checkFields()`).

Names in this spec: the regex-check config key is **`checks`**; the prose file of the operator
is **`board/rules.md`**; the state field is `rules_md`; every printed `rules:` line starts `rules:` at column 0.

Plugin version: this cluster sets `.claude-plugin/plugin.json` `version` from `0.5.0` to `0.6.0` (step B13).

Steps run in this order: B0, B1, B2, B3, B3b, B4, B5 (item 1), B6, B7, B8 (item 2), B9a, B9 (item 3), B10 (item 4),
B12, B13. There is no B11. Each step ends with tests green unless it says otherwise.

Items: 1 config layers (with the footer settings line), 2 config checks, 3 operator rules, 4 optional links.

SKILL size: cluster B adds 449 characters to `SKILL`: A's 6.1 block measures 6355 with `wc -c`, and the same block
with B's three edits of 3.6 applied measures 6804 (limit 8000; step B12 measures the real file). A later edit
shortened A's step 2 by 306 characters (A 6.1), so both figures are now about 306 lower (about 6049 and 6498). The rule-writing
procedure goes to the new `REF/rules.md`, read only when a `rules:` line or a `[rule]`/`[standing]` flag names it;
the `check`-line explanation lives in the `sync` output, not in `SKILL`.

---

## 0. Name check (step B0, before any edit)

Run each grep from the plugin root. Each must print at least one line. If one prints nothing, stop: change no file
and report the name and the grep that failed.

| Name of cluster A that B relies on | Grep |
|---|---|
| `FLAGS` and `COMMANDS` exported | `grep -n "^export const FLAGS = {" skills/decision-board/scripts/board.mjs` and `grep -n "^export const COMMANDS = {" skills/decision-board/scripts/board.mjs` |
| first `check` line with the zone | `grep -n 'times in ${P.cfg.tz}' skills/decision-board/scripts/board.mjs` |
| the `config tz` problem | `grep -n 'config tz: ' skills/decision-board/scripts/board.mjs` |
| the config lines of `Run` that B replaces | `grep -n 'this.config = readJson(this.configFile);' skills/decision-board/scripts/board.mjs` |
| the meta/config compare that B replaces | `grep -n 'holds(last, { op: "set", file_path: r.configFile })' skills/decision-board/scripts/board.mjs` |
| the unknown-field line that B replaces | `grep -n 'unknown field " + q(k)' skills/decision-board/scripts/board.mjs` |
| `guideId(id)` | `grep -n "function guideId(id)" skills/decision-board/scripts/board.mjs` |
| `logHandled(dump, log)` in `read` | `grep -n "r.logHandled(dump, log)" skills/decision-board/scripts/board.mjs` |
| the `[question]` flag in `read` | `grep -n '"\[question\]"' skills/decision-board/scripts/board.mjs` |
| `lineHint` and the note flags in `read` | `grep -n "function lineHint(flags, a)" skills/decision-board/scripts/board.mjs`, `grep -n 'return "(act on it)";' skills/decision-board/scripts/board.mjs` and `grep -n "const nflags = \[\];" skills/decision-board/scripts/board.mjs` |
| no agent in `Run` | `grep -c "this.agent" skills/decision-board/scripts/board.mjs` prints `0` |
| `if refused:` lines | `grep -n "if refused: rm -rf" skills/decision-board/scripts/board.mjs` |
| `tz` in `DEFAULTS` | `grep -n 'tz: "Europe/Warsaw"' skills/decision-board/assets/board.html` |
| the footer | `grep -n '<footer id="foot" class="foot"><span id="zone" class="small muted"></span></footer>' skills/decision-board/assets/board.html` |
| the zone note in `render()` | `grep -n '$("zone").textContent = zoneNote(cfg.tz);' skills/decision-board/assets/board.html` |
| `DEFAULT_TZ` and `tz` in `readConfig` of `R` | `grep -n 'const DEFAULT_TZ = "Europe/Warsaw"' skills/board-refresh/scripts/refresh.mjs` |
| `REF/build.md` step 3 and step 4 | `grep -n "to change it." skills/decision-board/references/build.md`, `grep -n "every card needs a link to one" skills/decision-board/references/build.md` and `grep -n "It makes the state, checks the config and the cards, and writes" skills/decision-board/references/build.md` |
| `SKILL` texts B edits | `grep -n "prints problems or a refusal, do what it says and rerun." skills/decision-board/SKILL.md`, `grep -n "if it failed, stop and say so." skills/decision-board/SKILL.md`, `grep -n "^## What counts as the operator's word" skills/decision-board/SKILL.md`, `grep -n "question\]" skills/decision-board/SKILL.md` |
| `REF/data-model.md` texts B edits | `grep -n "^## The config" skills/decision-board/references/data-model.md` and `grep -n "^| .meta. |" skills/decision-board/references/data-model.md` |
| the size test | `grep -n "SKILL.md stays short" tests/board-test.mjs` |
| the test helpers | `grep -n "^const ok2 = " tests/board-test.mjs` |
| plugin version | `grep -n '"version": "0.5.0"' .claude-plugin/plugin.json` |

---

## Item 1: decision-board-config-layers

### 1.1 Goal

`check` and `sync` read the config from four layers (plugin defaults, a user file outside any repository,
`board/config.json`, `board/config.local.json`), merged later-wins, with `+key` to append to a list.
`check` prints the layer of each key and writes the merged result to `meta/config` and `board/config.merged.json`.

### 1.2 Data model

- `meta/config` (writer: `check`, unchanged doc id): now holds the **merged page keys** of layers 2 to 4
  (user, board, local), with every top-level key that starts with `_` dropped, and without the script-only
  keys (`SCRIPT_KEYS`, see 1.3: in this cluster `checks` and `standing`), plus the key `settings` that `check`
  writes itself (1.4, `settingsText`). It holds no plugin default that no layer file set, except a list that a
  `+key` appended to (that list is written whole, defaults included). The page applies its own `DEFAULTS` for
  every key that is absent, as today. Values are the raw text the operator wrote (A 3.3: only `cfg.tz` is
  normalised, in the page and in `P.cfg`).
- SCHEMA in `PAGE`: no change. `DEFAULTS` in `PAGE`: one new key, `settings: ""`, written as the key after
  `tz`; its position is not a contract. `DEFAULTS` stays layer 1 and the one list of page config keys.
- New local file `board/config.merged.json` (writer: `check`, on success only): the full merged config, layer 1
  included: `Object.assign(pageDefaults(), config)` (1.4) without the keys of `WRITTEN_KEYS` and of `MERGED_OMIT`
  (`const MERGED_OMIT = ["checks"]` in `S`: the operator's regexes stay only in the layer files they wrote),
  `_` keys dropped. So `refresh.mjs map --config` sees the default tags, priorities and `tz` too, not only the keys
  a layer file set. Script-only keys not in `MERGED_OMIT` (`standing` in this cluster; cluster D may add some for
  the watch brief) are kept. JSON with `JSON.stringify(x, null, 1) + "\n"`.
  Written only when its content differs from the file on disk. Never sent to the database. It is a derived copy:
  nobody edits it, and it lives in `board/`, which SKILL "Script rules" (the `info/exclude` bullet) already keeps out of
  git. `check` prints a note when it is not git-ignored (1.4 step 6b).
- New optional local file `board/config.local.json` (writer: the agent or the operator). Same shape as
  `board/config.json`.
- The user file (writer: the operator, or the agent on the operator's word). Default path below.
- State file: no new field for this item.

### 1.3 Config

Layers, in merge order (later wins):

| # | Name printed | File | Notes |
|---|---|---|---|
| 1 | `default` | none: `P.DEFAULTS` (page) and `SCRIPT_DEFAULTS` (script) | never merged as a file; it is the base for `+key` and the fallback |
| 2 | `user` | `userConfigPath()` | outside any repository |
| 3 | `board` | `<state dir>/config.json` | as today, now optional |
| 4 | `local` | `<state dir>/config.local.json` | optional |

`userConfigPath()` (new, in `S`), checked in this order at call time (not at module load):
1. `process.env.BOARD_USER_CONFIG` is defined: `""` returns `""` (the user layer is off); any other value
   returns `path.resolve(value)`.
2. `process.env.XDG_CONFIG_HOME` is an absolute path: `path.join(it, "decision-board", "config.json")`.
3. Else `path.join(os.homedir(), ".config", "decision-board", "config.json")`.

Merge rules (`mergeLayers`, 1.4):
- A key whose name starts with `_` is a comment: dropped, at every depth.
- `null` as a value removes the key from the merged result (the plugin default applies again).
- A plain object merges into an earlier plain object key by key, with these same rules, recursively.
- Any other value (text, number, boolean, list, or an object over a non-object) replaces the earlier value.
- `"+key": [ ... ]` appends to the earlier list of `key`. The earlier list is the merged value so far,
  else the default list (`P.DEFAULTS[key]` or `SCRIPT_DEFAULTS[key]`, when that is a list), else `[]`.
  An appended plain object with a string `id` equal to the `id` of an entry already in the list replaces
  that entry in place. An appended text, number or boolean already in the list is skipped. Anything else is pushed.
- Problems (all reported, nothing merged for the offending key), `<name>` is the layer name, `<p>` the dotted key path:
  - `"+<p>"` and `"<p>"` both in one object: `<name>: "+<p>" and "<p>" in one file`
  - `"+<p>"` whose value is not a list (null included): `<name>: "+<p>": not a list`
  - `"+<p>"` over an earlier value that is not a list: `<name>: "+<p>": the earlier value is not a list`
  - a key `__proto__`, `constructor` or `prototype` (with or without `+`): `<name>: field "<p>" is not allowed`
- A layer file that does not parse: stop with the existing `readJson` message `cannot read <file>: <error>`.
  A layer file that parses to anything but a plain object: stop with `<file>: not a JSON object`.

Keys:
- `const WRITTEN_KEYS = ["settings"];` in `S`: page keys that `check` writes itself into `meta/config`; no layer
  file may set them.
- `CONFIG_KEYS` in `S` becomes
  `export const CONFIG_KEYS = Object.keys(P.DEFAULTS).filter((k) => !WRITTEN_KEYS.includes(k)).concat(SCRIPT_KEYS);`
  (replaces the literal list; exported for the tests). Any key that a later cluster adds to `DEFAULTS` is then
  known to `check` and to the merge. A layer file that sets `settings` gets `config <layer>: unknown field "settings"`.
- `const SCRIPT_DEFAULTS = { checks: [], standing: ["always", "never", "from now on"] };` and
  `export const SCRIPT_KEYS = Object.keys(SCRIPT_DEFAULTS);` in `S`. A script-only key is merged and validated,
  written to `config.merged.json` unless it is in `MERGED_OMIT`, never to `meta/config`. `checks` is item 2;
  `standing` is item 3 (the words that make `read` flag a note `[standing]`; a layer adds words with
  `"+standing": [...]`, for example the words of the operator's own language).
- Unknown keys are checked per layer file, top level only: for each top-level key `k` of the file, skip it when
  `k.startsWith("_")`; else take `base = k.startsWith("+") ? k.slice(1) : k` and report
  `config <layer name>: unknown field "<base>"` (text via `q(base)`) when `!CONFIG_KEYS.includes(base)`.
  So `_about`, `_examples` and `+tags` are never unknown fields.
- "At least one layer": `needConfig` fails only when none of the user, board and local files exists.

### 1.4 Script

New and changed functions in `S` (all at module level unless noted; `os` is imported from `node:os`):

- `function userConfigPath()`: as in 1.3.
- `function tilde(file)`: `file` with a leading `os.homedir() + path.sep` replaced by `~/`; else `file`.
- `function rel(file)`: `path.relative(process.cwd(), file) || file`.
- `export function mergeLayers(layers, defaults)`: `layers` is `[{name, data}]` in merge order, `data` a
  plain object or `null` (skipped); `defaults` is a plain object of default values. Returns
  `{ config, src, problems }`: `config` the merged object (fresh objects, no input shared),
  `src` an object from each top-level key of `config` to a list of tags, `problems` a list of texts.
  Tags: a replace sets `src[k] = [name]`; a deep merge into an existing object pushes `name`; an append
  pushes `"+" + name`, and when the earlier list came from `defaults` it first sets `src[k] = ["default"]`;
  `null` deletes `src[k]`. Implement the recursion as one inner function
  `mergeInto(base, over, name, at, problems)` that returns the new object; `mergeLayers` tracks `src`
  for top-level keys only.
- `function loadConfig(dir)`: reads the three files. Returns
  `{ files: [{name, file, exists}], any, config, src, problems, page, merged, unknown }` where `unknown` is the list of
  per-layer unknown-field problem texts of 1.3 (kept apart from `problems` so `check` can print them in the order of
  1.4 step 8; `needConfig` for other commands ignores them, as `sync` ignores unknown fields today), and `files` has the three
  entries `user` (file `""` when off), `board`, `local`; `any` is true when at least one exists;
  `config` and `src` come from `mergeLayers(present layers, pageDefaults())`;
  `page` is `config` without the `SCRIPT_KEYS`, with `page.settings = settingsText(files)` added last;
  `merged` is `Object.assign(pageDefaults(), config)` without the keys of `WRITTEN_KEYS` and `MERGED_OMIT`.
- `export const pageDefaults = () => plain(Object.assign({}, P.DEFAULTS, SCRIPT_DEFAULTS));` (exported for the
  `mergeLayers` unit test; `loadConfig` calls the same function, so the test covers the real path).
  The `plain(...)` (the JSON-clone helper `const plain = (x) => JSON.parse(JSON.stringify(x))` already in `S`) is
  required: `P.DEFAULTS` comes from a `vm` context, so its objects and their entries have another realm's
  prototype and `isPlain` is false for them. Every "plain object" test inside `mergeLayers` uses `isPlain`; without
  the clone, an appended `{id: "now", ...}` would not replace the default `now` in place.
- `function settingsText(files)`: the footer line of the page:
  `return "Settings: " + files.filter((f) => f.exists).map((f) => (f.name === "user" ? tilde(f.file) : rel(f.file))).join(", ");`
  For a lone board file run from the repository root it is `Settings: board/config.json`.
- `class Run` constructor: replace the lines that set `this.configFile` and `this.config` with
  `this.configFile = path.join(this.dir, "config.json"); this.load = loadConfig(this.dir);
  this.config = this.load.any ? this.load.config : null;` and keep `P.applyConfig(isPlain(this.config) ? this.config : null)`.
- `Run.needConfig()`: when `!this.load.any`, fail with exactly
  ``no config: write ${rel(this.configFile)}${u ? " or the user file " + tilde(u) : ""} (references/data-model.md), then run `node ${SELF} check` ``
  where `u` is the `file` of the `user` entry. When `this.load.problems.length` and the command is not
  `check`, fail with the problems, each prefixed `config `, then the line ``fix the config, then run `node ${SELF} check` ``.
  (Give `needConfig` a parameter `fromCheck`; `cmdCheck` passes `true` and reports the problems itself.)
- `function inGitTree(file)`: walks up from `path.dirname(file)` to the root; returns the first folder
  that holds a `.git` entry (file or folder), else `""`.
- `function gitIgnored(file)`: `import { spawnSync } from "node:child_process"` at the top of `S`. Returns
  `true` when `inGitTree(file) === ""`; else runs `spawnSync("git", ["check-ignore", "-q", path.basename(file)], { cwd: path.dirname(file), stdio: "ignore" })`
  and returns `res.status !== 1` (status 0 = ignored, 1 = not ignored; an error or any other status, for
  example no `git` installed, counts as ignored so no false note). Local only, no network.
- `function valueText(v)`: text → `JSON.stringify(v)` of the first 57 characters plus `...` when longer
  than 60, else `JSON.stringify(v)`; number or boolean → `String(v)`; list → `1 entry` or `<n> entries`;
  plain object → `{` + its keys joined by `, ` + `}`.
- `function configLines(load)`: returns the lines below.

`check` (`cmdCheck`), the printed lines in this order:
1. the `state ...` line exactly as cluster A leaves it (`state <rel>: cards <n> (<counts>); times in <tz>`), then:
2. (no line here: cluster A deleted the `note: the config agent ...` line.)
3. `config layers: user <u>, board <b>, local <l>` where `<u>` is `off` when the user layer is off,
   `none` when its file does not exist, else `tilde(file)`; `<b>` and `<l>` are `none` or `rel(file)`.
4. The layer of each set key. Let `set` = the keys of `CONFIG_KEYS`, in that order, that have `src[k]`, and
   `nFiles` = the number of the three layer files that exist.
   - `nFiles === 1` (the common case, a lone `board/config.json`): one line
     `config <name>: <set joined by ", ">`, where `<name>` is that file's layer name (`user`, `board` or `local`).
     Example for a board file holding `title`, `agent`, `tabs`, `link_hosts`, `tags`, `tz`:
     `config board: title, agent, tabs, link_hosts, tags, tz` (the order is `CONFIG_KEYS` order, whatever it is).
     When `set` is empty: no line.
   - `nFiles >= 2`: for each key `k` of `set`: `config <k>: <src[k] joined by ", ">  <valueText(config[k])>`,
     plus `  (script only)` at the end for a key of `SCRIPT_KEYS`.
     Example: `config link_hosts: user, +board  2 entries`, `config checks: user  1 entry  (script only)`.
5. a. When some page keys (keys of `CONFIG_KEYS` not in `SCRIPT_KEYS`) have no `src`:
   `config default: <those keys, in CONFIG_KEYS order, joined by ", ">`. Unset script-only keys are never listed.
   b. Always: `` `config ids: tags ${P.cfg.tags.map((t) => t.id).join(", ") || "none"}; priorities ${P.cfg.priorities.map((p) => p.id).join(", ")}` ``
   (the ids that `sync` accepts, defaults included; board-refresh step 2 takes its ids from this line).
6. a. When the user file exists and `inGitTree(file)` is not `""`:
   `note: the user config <tilde(file)> is inside the git work tree <root>: keep it out of every repository`.
   b. When `!gitIgnored(path.join(r.dir, "config.merged.json"))`:
   ``note: ${rel(<that file>)} is not git-ignored: add board/ to the file that `git rev-parse --git-path info/exclude` names``.
   (Test it on the path even before the file exists: `git check-ignore` works on paths that do not exist.)
   c. When `!P.cfg.link_hosts.length`: `note: config link_hosts: none, so sync refuses every card link. A card needs no link`
   (item 4 makes links optional; this line replaces the problem `config link_hosts: none. Every card needs a link to one of them`).
7. The `rules:` line of item 3 (3.4), then the check notes of item 2 (2.4).
8. `problem: ...` lines, in this order: merge problems (`config <problem text>`), the existing
   "entries kept" problems (the loop over `["tabs", "priorities", "domains", "link_hosts", "tags"]`, unchanged list,
   now with `raw` = the merged `config`), unknown fields (`config <layer name>: unknown field "<key>"`, per layer in
   merge order, per 1.3; this replaces the line `Object.keys(raw).filter((k) => !CONFIG_KEYS.includes(k))...`),
   cluster A's `config tz: ...` problem, the `compileChecks` problems of item 2 (2.3, including its own
   `50 of <m> entries kept`), the `standing` problem of item 3 (3.3), the rules-guide problems of item 3 (3.4), the
   existing card problems. (The `config link_hosts: none...` problem is gone, see 6c.) Then stop with `<n> problems`
   as today.
9. On success, in this order: write `config.merged.json` (the `merged` part of `loadConfig`, 1.2); compare the page
   part with the last `meta/config` write: replace `if (!holds(last, { op: "set", file_path: r.configFile })) r.pinned("set", "meta", "config", raw);`
   by `if (!(last && stable(last.data) === stable(r.load.page))) r.pinned("set", "meta", "config", r.load.page);`;
   then the existing line, now computed from that one write only:
   `` log(`config: ${r.writes.some((x) => x.key === "meta/config") ? "changed, write it" : "unchanged"}`); ``
   (the rules guide write of item 3 must not turn it into `changed`); then the rules guide write of item 3 (3.4,
   `queueRules`); then `r.finish(log)` (the write arrays).

`sync`: no new flag. It merges the layers itself through `Run` (no read of `config.merged.json`). A merge problem
stops it (see `needConfig`). New lines: item 2 (check hits) and item 4 (`note: <id>: no link`).

`USAGE` in `S` (A 2.4 step 7 text): the `check` line becomes
`check                                     merge the config layers, check them and the state; print the meta/config write when it changed`;
in the footer replace `config.json, out/,` by `config.json, config.local.json, config.merged.json, rules.md, out/,`
and add, after the sentence that ends `sit beside it.`, the sentence
`The user config is $BOARD_USER_CONFIG, else $XDG_CONFIG_HOME/decision-board/config.json, else ~/.config/decision-board/config.json.`

`R` (refresh.mjs): no code change. Its `--config` now takes `board/config.merged.json` (text only, 1.6);
`readConfig` (A 3.4) already reads `link_hosts`, `tags` and `tz` of any object, and the merged file now holds the
defaults too. In `USAGE` of `R` replace `[--config <board/config.json>]` by `[--config <board/config.merged.json>]`.

Error cases: broken JSON in a layer (stop, `cannot read ...`); a layer that is not an object (stop);
no layer at all (stop, `no config: ...`); merge problems (check: `problem:` lines; sync and others: stop).

### 1.5 Page

The page reads `meta/config` only; `check` writes the merged page part there. One addition, the settings line:

- `DEFAULTS`: add `settings: ""` as the key after `tz`.
- `normConfig(raw)`: before `return out`, add `out.settings = str(g("settings")).slice(0, 200);`
  (`str` trims and gives `""` for a non-text).
- HTML: the footer of A 3.5 becomes exactly
  `<footer id="foot" class="foot"><span id="zone" class="small muted"></span><span id="settings" class="small muted" hidden></span></footer>`
  (`#zone` stays the first child).
- CSS: beside A's `.foot { margin-top: 24px; padding: 12px 0; }` add `.foot span { display: block; }` (one line each).
- `render()`: directly after A's `$("zone").textContent = zoneNote(cfg.tz);` add
  `$("settings").textContent = cfg.settings; $("settings").hidden = !cfg.settings;`.
- No toggle, no input, no write: the line is text from `meta/config` through `textContent`.

Render check (for the maintainer, not an implementer step): on a test artifact (never a board in use), after
`check` wrote `meta/config`, the footer shows `Times in <zone>` and below it `Settings: board/config.json`.

### 1.6 Agent-facing text

`REF/build.md`, "Build a board" (A 6.7; the build steps are no longer in `SKILL`):
- Step 3: in A's sentence `Ask the operator for \`link_hosts\`, the hosts card links may point to (every card needs a link to one).`
  replace `(every card needs a link to one)` by `(a card needs no link; a link it carries must point to one of them)` (item 4).
  Then append, after A's last sentence of the step (the `tz` clause that ends `to change it.`), without deleting it:
  `Private values that hold for all the operator's boards on this machine (\`tz\`, \`link_hosts\`, \`tags\`, \`checks\`) go in the user file instead, outside every repository: its path is on the \`config layers:\` line of \`check\` (data-model.md, "The config").`
- Step 4: replace `It makes the state, checks the config and the cards, and writes \`meta/config\`.` by
  `It makes the state, merges the config layers and prints the layer of each key, checks the config and the cards, and writes \`meta/config\`.`
- Step 6 (new, item 3): see 3.6.

`REF/data-model.md`, section "The config": replace the first paragraph (the one A 6.3 leaves, which starts
`` `board/config.json` is the one source of the board config: `` and ends `without a republish.`) by:

```markdown
`check` merges four layers, later ones win: the defaults in the table below; the user file
`~/.config/decision-board/config.json` (`$XDG_CONFIG_HOME/decision-board/config.json` when that is set;
`BOARD_USER_CONFIG` names another file, `""` turns it off); `board/config.json`; `board/config.local.json`.
Keep private values that hold for every board on the machine (the time zone, hosts, tags, checks, names of
people) in the user file, outside every repository. Each layer is optional, but one must exist.

- An object merges key by key; a text or a list replaces. `"+tags": [...]` appends to the earlier list,
  and an appended entry with the `id` of an earlier one replaces it in place. `null` removes a key. A key
  that starts with `_` is a comment.
- `check` prints the layer of each key and the tag and priority ids. It writes the merged keys to `meta/config`
  (script-only keys stay off; `settings`, the footer line that names the layer files, is added) and the full
  merged config with its defaults to `board/config.merged.json` (`checks` stay off), which
  `refresh.mjs map --config` reads. That file is a derived copy: never edit or commit it. `sync` merges the layers
  itself. Every field is optional; a missing or invalid field keeps its default.
  Lists keep their first 50 entries. The page reads `meta/config` live: a change shows without a republish.
  The page has no settings controls: change a setting in a layer file, then run `check`.
```

In the same table: row `link_hosts` (today `Required before the first card. The hosts card \`links\` may point to by \`https:\``)
becomes `` | `link_hosts` | The hosts card `links` may point to by `https:`. A card needs no link | none | ``.

In the table "Collections" (A's 0.1 table), row `meta`: in the Content cell replace `the config.` by
`the merged config of the layers, without script-only keys, with \`settings\`.` (keep A's sentence about `meta/board`).

`README.md`:
- "Start a board" step 2: after `and writes the config:` keep the text, then add the sentence
  `Private settings that hold for all your boards on one machine (time zone, hosts, tags) live in a user file outside any repository, \`~/.config/decision-board/config.json\` (see \`references/data-model.md\`).`
- Intro paragraph 2: replace `A config, kept in \`board/config.json\` and written to the database,` by
  `A config, kept in \`board/config.json\` and optional layers around it, merged by \`check\` and written to the database,`.
  (If A's README wording of that clause differs, replace the clause that names `board/config.json` the same way.)

`RSKILL`:
- Step 2: `Write the map (next section), with the tag and priority ids of \`board/config.json\`.` becomes
  `Write the map (next section), with the tag and priority ids of the \`config ids:\` line that \`node S check\` prints.`
- Step 3 command: `--config board/config.json` → `--config board/config.merged.json` (written by `check` of the decision-board skill).

`docs/how-it-works.html` (the `meta` row, today line 241, as A leaves it): replace
`link hosts (required before the first card)` by `link hosts`, and replace the clause
`The agent keeps it in <code>board/config.json</code> and writes it with <code>check</code>` by
`The agent keeps it in <code>board/config.json</code>, you may keep private values in a user file outside any repository, and <code>check</code> merges the layers and writes the result; the page footer names the files`.
In the "Web links" item (today line 215): replace `Every card carries 1 to 10 <code>links</code>` by
`A card carries up to 10 <code>links</code>` and `, which you set before the first card` by `` (empty).

### 1.7 Tests

`tests/board-test.mjs`:
- Top, beside `process.env.BOARD_NOW`: `process.env.BOARD_USER_CONFIG = "";` (no developer file can leak in).
- A's rule holds for every B case: the merged config of each case sets `tz` (`"UTC"` unless the case names a zone),
  from the fixture board file or, where a case has no board file, in the user file it writes (for example
  `{"link_hosts": ["example.com"], "tz": "UTC"}`). No B assert names the default zone.
- Import, beside `run`: `CONFIG_KEYS, SCRIPT_KEYS, mergeLayers, pageDefaults, compileChecks, checkHits, checkFields`
  from the script. Add two helpers after `cfgOf` (no literal key list anywhere: a key a later cluster adds to
  `DEFAULTS` needs no edit of these tests):
  ```js
  // The config keys that layer objects set (a "+key" sets key), in CONFIG_KEYS order, and the expected config default: line.
  const setKeys = (...objs) => CONFIG_KEYS.filter((k) => objs.some((o) => o && (Object.hasOwn(o, k) || Object.hasOwn(o, "+" + k))));
  const defaultLine = (...objs) => "config default: " + CONFIG_KEYS.filter((k) => !SCRIPT_KEYS.includes(k) && !setKeys(...objs).includes(k)).join(", ");
  const boardCfg = (b) => JSON.parse(fs.readFileSync(path.join(b.board, "config.json"), "utf8"));
  ```
- Change test "check: local only; ..." (as cluster A leaves it). These asserts change:
  - the `r.lines.slice(0, 2)` assert becomes three asserts by prefix, never by position:
    `assert.equal(r.lines[0], <cluster A's state line, unchanged>);` (A's own line 0 assert stays as A wrote it),
    `assert.ok(r.lines.includes(\`config layers: user off, board ${path.relative(process.cwd(), path.join(b.board, "config.json"))}, local none\`));`,
    `assert.ok(r.lines.includes("config board: " + setKeys(boardCfg(b)).join(", ")));`,
    `assert.ok(r.lines.includes(defaultLine(boardCfg(b))));`,
    `assert.ok(r.lines.some((l) => /^config ids: tags .+; priorities .+$/.test(l)));`,
    and `assert.equal(r.lines.filter((l) => l.startsWith("config:")).join("|"), "config: changed, write it");`
  - the `cmd(b, "check").lines.slice(1)` assert becomes
    `{ const l = cmd(b, "check").lines; assert.deepEqual(l.filter((x) => x.startsWith("config:") || x === "no writes"), ["config: unchanged", "no writes"]); }`
  - the `writesOf(...)` assert after the title change is unchanged.
  - the last assert (no `config.json`) becomes
    `assert.match(cmd(b, "check").text, /^no config: write .*config\.json \(references\/data-model\.md\), then run/)`.
  The test tmp folders are not inside a git work tree (`os.tmpdir()`), so no `not git-ignored` note appears.
- Sweep: every other assert in `tests/*.mjs` that indexes `check` output by position (`lines[<n>]` with `n > 0`,
  `lines.slice(...)` on a `check` result) is changed the same way: filter by prefix instead of position. Find them
  with `grep -n '"check"' tests/*.mjs` after cluster A; a `check` result assert on `lines[0]` (A's state line) stays.
- Change test "check: problems in config.json ...": `"problem: config: unknown field \"kinds\""` →
  `"problem: config board: unknown field \"kinds\""`, same for `labels`. Problem order per 1.4 step 8 (the order
  of today's list does not change: entries kept, then unknown fields, then card problems).
- Add `config layers: check merges user, board and local and prints the layer of each key` (AC 1):
  user file in `tmp` = `{"link_hosts": ["tracker.example.com"], "tags": [{"id": "ops"}], "checks": [{"id": "t", "field": "title", "forbid": "zzz", "message": "No zzz"}]}`;
  board config = the fixture config (as A leaves it, with its `tz`) with `link_hosts` renamed `+link_hosts`;
  local = `{"title": "Local title"}`. Set `BOARD_USER_CONFIG` to the user file. Expect (`<user>` = the user file path
  with a leading home folder shown as `~/`, as `tilde` does; `<rb>`/`<rl>` = `path.relative(process.cwd(), <file>)`):
  - the lines include, each exactly: `config layers: user <user>, board <rb>, local <rl>`, `config title: local  "Local title"`,
    `config agent: board  "Coordinator"`, `config tabs: board  2 entries`, `config link_hosts: user, +board  2 entries`,
    `config tags: board  2 entries`, `config checks: user  1 entry  (script only)`, and `defaultLine(user, board, local)`;
  - the per-key lines (lines that match `/^config ([a-z_]+): /` with a name other than `layers`, `default`, `ids`) name,
    in output order, exactly `setKeys(user, board, local)` (so the order is `CONFIG_KEYS` order and every set key has one line);
  - no line starts `config board: ` (two or more files give per-key lines).
  (The user `tags` is replaced by the board `tags`, so `src.tags` is `["board"]`.)
  Also assert `JSON.parse(fs.readFileSync(<board>/config.merged.json)).link_hosts` deep-equals
  `["tracker.example.com", "example.com"]`, that it has no `checks` key and no `settings` key, and that it has the key
  `priorities` deep-equal to `pageDefaults().priorities` (the defaults are in the merged file, 1.2).
  Reset `BOARD_USER_CONFIG` to `""` in a `finally`.
- Add `config layers: the unknown-field check skips _ keys and reads +key by its base name`: board config gets
  `"_note": "x"` and `"+tags": [{"id": "ops"}]` (and loses `tags`), local gets `{"zzz": 1}` → the only unknown-field
  problem is `problem: config local: unknown field "zzz"`.
- Add `config layers: a list replaces, "+key" appends, an id replaces in place, null removes, _ keys are comments` (AC 2),
  a unit test of the exported `mergeLayers` with `defaults = {priorities: [{id:"now"},{id:"soon"},{id:"later"}], title: "Decision board"}`:
  user `{tags:[{id:"a",label:"A"},{id:"b"}], domains:["x.example.com"], obj:{a:1,b:2}, _c:1}`,
  board `{"+tags":[{id:"a",label:"A2"},{id:"c"}], domains:["y.example.com"], "+priorities":[{id:"someday"}], obj:{b:3,_d:1}, title:null}`.
  Expect `tags` = `[{id:"a",label:"A2"},{id:"b"},{id:"c"}]`, `domains` = `["y.example.com"]`,
  `priorities` ids = `now, soon, later, someday`, `obj` = `{a:1,b:3}`, no `_c`, no `title`;
  `src.tags` = `["user","+board"]`, `src.priorities` = `["default","+board"]`, `src.domains` = `["board"]`.
  And the three problem texts of 1.3 for `{"+tags":[],"tags":[]}`, `{"+title":"x"}`, and user `{title:"t"}` then board `{"+title":["x"]}`.
  Second part, over the real defaults: `mergeLayers([{name: "user", data: {"+priorities": [{id: "now", label: "X"}]}}], pageDefaults())`
  (`pageDefaults` is the export of 1.4; `loadConfig` calls the same function, so the test covers the real path) →
  `priorities` deep-equals `pageDefaults().priorities` with its entry of id `now` replaced by `{id:"now",label:"X"}`
  in the same place (computed from the live defaults, so a later default list needs no edit), and its length is
  `pageDefaults().priorities.length`.
- Add `config layers: no layer stops with the paths; BOARD_USER_CONFIG names the user file; a user file in a git tree is noted`:
  remove `config.json`, user off → `check` exit 1 with the `no config:` line; set `BOARD_USER_CONFIG` to a
  tmp file with `{"link_hosts": ["example.com"], "tz": "UTC"}` → `check` exit 0; put the user file in a tmp folder that
  holds an empty `.git` folder → the `note: the user config ... git work tree ...` line, exit 0.
- Add `check: a board in a git tree that does not ignore board/ gets the not-git-ignored note`: make a tmp folder,
  run `git init -q` in it (skip the test with a printed `skip: no git` when `spawnSync("git", ["--version"]).status !== 0`),
  put the board under it → `check` prints `note: <rel>/config.merged.json is not git-ignored: add board/ to ...`, exit 0;
  append `board/` to its `.git/info/exclude` → the note is gone.
- Add `check: meta/config holds the merged page keys only; config.merged.json holds no checks; a change in the user file alone is a new write`:
  with a user file `{"title": "U", "checks": [<the valid check above>]}`: the written `meta/config` data has no `checks`
  and no `standing`, and its `settings` is `"Settings: " + tilde(userFile) + ", " + path.relative(process.cwd(), path.join(b.board, "config.json"))`
  (compute `tilde` in the test as the script does: a leading `os.homedir() + path.sep` shown as `~/`);
  `board/config.merged.json` has no `checks` but has `link_hosts` and `standing`; change only the user
  file's `title` → the next `check` prints `config: changed, write it`; unchanged → `config: unchanged`.
- Add `check: a layer file may not set settings; meta/config settings names the board file alone`: fresh board, user off →
  `meta/config` data `settings` is `"Settings: " + path.relative(process.cwd(), path.join(b.board, "config.json"))`;
  board config with `"settings": "x"` → `problem: config board: unknown field "settings"`, exit 1.
- Add `check: config ids lists the tag and priority ids that sync accepts`: the fixture board → the line
  `"config ids: tags " + boardCfg(b).tags.map((t) => t.id).join(", ") + "; priorities " + pageDefaults().priorities.map((p) => p.id).join(", ")`
  is in the output (the fixture sets `tags` and no `priorities`).

`tests/render-test.js` (A's footer case is there): add `the footer names where the settings live`:
the page source contains exactly
`<footer id="foot" class="foot"><span id="zone" class="small muted"></span><span id="settings" class="small muted" hidden></span></footer>`
and `$("settings").textContent = cfg.settings; $("settings").hidden = !cfg.settings;`; with the page pure part loaded
(`load()` of `_page.js`), `applyConfig({ tz: "UTC", settings: "Settings: board/config.json" })` gives
`cfg.settings === "Settings: board/config.json"`, and `applyConfig({ tz: "UTC", settings: 5 })` and
`applyConfig({ tz: "UTC" })` give `cfg.settings === ""`.

`tests/loss-test.mjs`: top, `process.env.BOARD_USER_CONFIG = "";`.

`tests/refresh-test.mjs`: top, `process.env.BOARD_USER_CONFIG = "";`. Add
`map --config takes the config.merged.json that check writes, with link_hosts from the user layer`:
user file `{"link_hosts": ["example.com"]}` (set `BOARD_USER_CONFIG` to it, reset to `""` in a `finally`), board
`config.json` with only `tags` (the two tags of `CONFIG`) and `"tz": "UTC"`; run the board script's `check` with
`--state <dir>/state.json` (as the existing case "the map output passes the core sync" runs it), then
`map(GOOD, MAP, "--config", <dir>/config.merged.json)` exits 0 with the same card count as the existing `--config`
case of this file with `CONFIG` (compare with that call's count, not with a literal).

`tests/skill-text-test.js` (new, plain Node, no `_page.js` needed; every later cluster adds its text cases here):
`REF/data-model.md` names `config.local.json`, `BOARD_USER_CONFIG`, `"+tags"` and `config.merged.json`;
`RSKILL` contains `--config board/config.merged.json`, `config ids:` and not `--config board/config.json`;
`REF/build.md` "Build a board" contains `config layers:` and not `every card needs a link`.

AC map: "check shows the merged config and the layer of each value" → the first added board-test (a layer line for
each set key, the `config default:` line for the rest). "A test covers replace and append" → the `mergeLayers` unit test.

### 1.8 Steps

- B0. The name check of section 0. Pre: cluster A merged. Done: every grep of the table printed a line (the
  `this.agent` count is `0`). If one did not: stop, change nothing, report the name and its grep.
- B1. Add `process.env.BOARD_USER_CONFIG = ""` to the three `.mjs` tests. Pre: B0, tests green.
  Done: `grep -c 'BOARD_USER_CONFIG = ""' tests/board-test.mjs tests/loss-test.mjs tests/refresh-test.mjs` prints 1 for each; tests green.
- B2. In `S`: `import os from "node:os"` and `import { spawnSync } from "node:child_process"`; add `WRITTEN_KEYS`,
  `SCRIPT_DEFAULTS`, `SCRIPT_KEYS` (exported), `MERGED_OMIT`, the new `CONFIG_KEYS` (exported), `userConfigPath`,
  `tilde`, `rel`, `mergeLayers` (exported), `pageDefaults` (exported), `settingsText`, `loadConfig`; switch `Run` and
  `needConfig`. Add the `mergeLayers` unit test and the "no layer" test of 1.7. Pre: B1. Done: those two tests pass;
  tests green except the "check: local only" assert on the old `no config` text, which B3 changes.
- B3. Change `cmdCheck` per 1.4 (lines 3 to 9 except 6c, which is item 4: the `config layers:` line, the layer lines,
  `config default:`, `config ids:`, `config.merged.json`, the page write and the `config:` line from the
  `meta/config` write only, per-layer unknown fields, `inGitTree`, `gitIgnored` and notes 6a and 6b); add the helpers
  `setKeys`, `defaultLine`, `boardCfg` and change the asserts of "check: local only" and "problems" per 1.7; add the
  layer-lines test, the `_`-key test, the git-ignore test, the meta/config test, the `settings` test and the
  `config ids` test. Pre: B2. Done: those tests pass; tests green.
- B3b. The page settings line of 1.5 (`DEFAULTS.settings`, `normConfig`, footer HTML, CSS, `render()`); the
  render-test case of 1.7. Pre: B3. Done: `node tests/render-test.js` exits 0 with the new case, A's footer case
  included (`#zone` still the first child); tests green.
- B4. `R` USAGE text; `RSKILL` steps 2 and 3; refresh-test case. Pre: B3. Done: `node tests/refresh-test.mjs` exits 0 with the new case.
- B5. `REF/build.md`, `REF/data-model.md`, `README.md`, `docs/how-it-works.html` text of 1.6; `S` USAGE; the config
  part of `tests/skill-text-test.js`. Pre: B3. Done: `node tests/skill-text-test.js` exits 0; tests green;
  `python3 scripts/validate-skills.py` (repo root) prints no problem.

---

## Item 2: decision-board-config-rules

### 2.1 Goal

A config list `checks` of regex checks that `sync` runs on every open card of its files; a card that breaks
one stops the sync with the check's message. One engine (`match`/`forbid`/`except`) covers required link
shapes and banned words; the values live only in the operator's config.

### 2.2 Data model

No database change. No SCHEMA change. `checks` is script-only: in `config.merged.json`, never in `meta/config`.

### 2.3 Config

`checks`: a list, default `[]`, at most `SCHEMA.max.list` (50) entries. `compileChecks` itself enforces the cap:
when the list has `m > 50` entries it keeps the first 50, adds the problem `config checks: 50 of <m> entries kept`,
and validates and compiles only those 50. `checks` is not added to the "entries kept" loop of `cmdCheck` (that loop
stays `["tabs", "priorities", "domains", "link_hosts", "tags"]`), so an invalid entry gives only its own problem.
The same `compileChecks` runs in `sync` and in `check`, so both see the same 50 checks and the same problems
(`check` prints them as `problem:` lines; `sync` stops on them). Each entry:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | text, `^[a-z0-9-]{1,40}$` | no | names the check in output; an appended entry with the same `id` replaces it (1.3) |
| `field` | text, one of `checkFields()` | yes | the card field to test |
| `match` | regex text, at most 300 characters | one of `match`/`forbid` | at least one value of the field must match |
| `forbid` | regex text, at most 300 characters | one of `match`/`forbid` | no value of the field may match |
| `except` | regex text, at most 300 characters | no, only with `forbid` | clears one `forbid` hit when `except` matches starting at that hit's first character |
| `flags` | text of distinct letters from `imsu` | no, default `""` | the RegExp flags |
| `when` | `{source?: [text], tags?: [text]}`, each list non-empty | no | the check applies only to cards whose `source` (trimmed, lower case) is in `source`, AND that carry a tag of `tags`; a missing key does not limit |
| `message` | text, 1 to 300 characters | yes | printed when a card fails |

`export function checkFields()` (new, in `S`, exported for the tests) derives the list from `S.item`: every key
whose type letter is one of `s t S l L`, except `rev`, `created`, `updated` (A's stamp type `d` is not in the list
either); and for each key of type `a:<kind>` or `o:<kind>`, every `<key>.<sub>` whose sub type in `S[<kind>]` is `s`,
`t` or `S`. After cluster A this gives, for example, `id, title, summary, evidence, options, recommendation, priority,
source, kind, blocks, status, tags, links.label, links.url, first_asked.date, first_asked.who`; a field a later
cluster adds (for example `draft`) joins by itself, and no test holds that list as a literal.

Semantics, per card `c`:
- A card with `status: "closed"` passes every check.
- `when` false: the check does not apply.
- Values `fieldValues(c, field)`: for `k` without a dot, a text gives `[text]`, a list gives its texts,
  anything else `[]`; for `k.sub`, a list gives `x[sub]` of each plain object `x`, a plain object gives
  `[c[k][sub]]`, texts only. Empty texts count as values.
- `forbid`: every occurrence is a hit. For each value `v`, scan `v.matchAll(reAll)` (`reAll` = the `forbid` regex
  built with `flags + "g"`). A hit `m` is cleared when `except` is given and `exceptAt` (the `except` regex built
  with `flags + "y"`) matches at `m.index`: set `exceptAt.lastIndex = m.index`, then `exceptAt.test(v)`. The card
  fails when some value has a hit that is not cleared. So `password: <redacted> ... password = hunter2` fails (the
  second hit is not cleared), and `password: <redacted>` alone passes. Build `reAll` and `exceptAt` once in
  `compileChecks`; set `lastIndex` before every use (they are stateful by design, and only `compileChecks` /
  `checkHits` use them). The operator's `flags` never contain `g` or `y` (validation below), so `flags + "g"` and
  `flags + "y"` are always valid.
- `match`: the card fails when no value `v` has `match.test(v)` (an absent field fails).

Validation (`compileChecks`), each problem text exactly, `<i>` the 0-based index in the merged list:
- `config checks: not a list`
- `config checks[<i>]: not an object`
- `config checks[<i>]: unknown field "<k>"`
- `config checks[<i>].id: 1 to 40 of a-z 0-9 -`
- `config checks: id "<id>" twice`
- `config checks[<i>].field: one of <checkFields() joined by ", ">`
- `config checks[<i>]: give one of match or forbid`
- `config checks[<i>].except: goes with forbid only; widen match instead`
- `config checks[<i>].<match|forbid|except>: longer than 300 characters`
- `config checks[<i>].<match|forbid|except>: not a regex: <e.message>`
- `config checks[<i>].flags: distinct letters of i, m, s, u`
- `config checks[<i>].when: an object with source and tags lists of texts`
- `config checks[<i>].message: missing` (also for empty or over 300 characters: `config checks[<i>].message: 1 to 300 characters`)

### 2.4 Script

New in `S`:
- `export function compileChecks(list)` → `{ checks, problems }`. `list` that is not an array: `{checks: [], problems: ["config checks: not a list"]}`.
  Else first the cap of 2.3 (`list.slice(0, 50)` and its problem), then each entry in order. Each compiled check
  `{ ref, field, re, forbid, exceptAt, when, message }` where `ref` is the `id` or `String(i + 1)`, `forbid` a boolean,
  `re` the regex built with `flags + "g"` when `forbid` (it is `reAll` of 2.3) and with `flags` alone for `match`,
  `exceptAt` the `except` regex built with `flags + "y"`, or `null`. An entry with a problem is left out.
  `checkHits` sets `re.lastIndex = 0` before a `match` test as well, for safety.
- `function fieldValues(c, field)` as in 2.3.
- `export function checkHits(c, checks)` → list of texts `check <ref>: <message>`, in list order.

`sync` (`cmdSync`): after the existing `cards.forEach(... cardProblems ...)` line, add:
`const ck = compileChecks(r.config.checks === undefined ? [] : r.config.checks);`
`if (ck.problems.length) fail(ck.problems.concat("fix the config, then run \`node " + SELF + " check\`"));`
`let hit = false;`
`cards.forEach(({ c }, i) => { if (!P.isObj(c)) return; const h = checkHits(c, ck.checks); if (h.length) hit = true; errs.push(...h.map((x) => (typeof c.id === "string" && c.id ? c.id : "#" + (i + 1)) + ": " + x)); });`
`if (hit) errs.push("a check line is a rule of the operator's config: change the card, never the check");`
These lines run before the existing `--source` close guard and its `if (errs.length) fail(errs);`, so a failure
prints `<card id>: check <ref>: <message>` among the other problem lines, then the one `a check line is ...` line
(the script says what to do, so `SKILL` needs no sentence for it), exit 1, nothing written, state unchanged.
The whole sync stops (see Calls made). No new flag.

`check` (`cmdCheck`): `compileChecks(config.checks)` problems go to the `problem:` lines (1.4 step 8).
For every card of the state that fails a valid check: `note: card <qid(id)>: check <ref>: <message>`
(1.4 step 7). These notes do not fail `check` and do not stop the `meta/config` write.

### 2.5 Page

No change. No render check.

### 2.6 Agent-facing text

New file `skills/decision-board/assets/config.example.json` (generic, example hosts only):

```json
{
 "_about": "An example board config. Keys that start with _ are comments. Copy what you need into board/config.json or the user file; to use the checks, rename _examples.checks to checks at the top level.",
 "title": "Lab network",
 "link_hosts": ["wiki.example.com", "tracker.example.com"],
 "tags": [{"id": "cost", "label": "Costs money"}, {"id": "ops", "label": "Operations"}],
 "tabs": [{"id": "tracker", "label": "Tracker", "match": {"source": ["tracker"]}}, {"id": "other", "label": "Other", "rest": true}],
 "_examples": {
  "checks": [
   {"id": "tracker-link", "field": "links.url", "match": "^https://tracker\\.example\\.com/", "when": {"source": ["tracker"]},
    "message": "A tracker card links its ticket on tracker.example.com"},
   {"id": "no-secrets", "field": "summary", "forbid": "\\bpassword\\s*[:=]", "except": "password: <redacted>", "flags": "i",
    "message": "No secret on a card: write password: <redacted>"},
   {"id": "mail-tag", "field": "tags", "match": ".", "when": {"source": ["mail"]},
    "message": "A mail card carries at least one tag"}
  ]
 }
}
```

`REF/data-model.md`, table of "The config": add the two rows
`| \`checks\` | Script only, never on the page: regex checks that \`sync\` runs on each open card, below | none |` and
`| \`standing\` | Script only: the words that make \`read\` flag a note \`[standing]\`; add words of your language with \`"+standing"\` | \`always\`, \`never\`, \`from now on\` |`
(the second row is item 3's; write it in this step with the first),
and after the tab paragraph (before the example config) add:

```markdown
### Checks

Each check is `{id, field, match | forbid, except, flags, when, message}`: `field` is a card field
(`links.url` and `first_asked.who` reach inside); `match` needs one value of the field to match; `forbid`
refuses every occurrence it finds, except one where `except` matches starting at the same character; `flags`
takes `i m s u`; `when` limits the check to `{"source": [...], "tags": [...]}`. At most 50 checks. Closed cards
pass. `sync` refuses a card that fails and prints `<card>: check <id>: <message>`. Examples:
`assets/config.example.json`, under `_examples`.
```

`SKILL`: no change for this item. A's "Post" step 2 already says `If it prints problems or a refusal, do what it says
and rerun.`, and `sync` itself prints `a check line is a rule of the operator's config: change the card, never the check`
(2.4: the sentence moves into the script output).

`README.md` "Layout": add the bullet `- \`skills/decision-board/assets/config.example.json\`: an example config with example checks.`

### 2.7 Tests

`tests/board-test.mjs`:
- Add `checks: sync refuses a card that breaks a check and prints the check message; closed cards and cards outside when pass` (AC 1):
  board config gets `checks: [{"id":"tl","field":"links.url","match":"^https://wiki\\.example\\.com/x/","when":{"source":["infra"]},"message":"Link the x page"},
  {"field":"title","forbid":"\\bASAP\\b","except":"ASAP-ok","flags":"i","message":"No ASAP"}]`.
  A card `yn("a", {source: "infra"})` (link `/notes`) → exit 1, lines include `a: check tl: Link the x page` and,
  once, `a check line is a rule of the operator's config: change the card, never the check`;
  the card with title `"asap?"` → `<id>: check 2: No ASAP`; title `"ASAP-ok?"` passes (the one hit is cleared, the
  `i` flag applies to `except` too); title `"ASAP-ok, then asap"` fails with `check 2` (the second hit is not cleared);
  the same cards with `status: "closed"` pass; a card with source `"other"` passes `tl`. The state file is byte-equal
  before and after a refused sync. A sync with no hit prints no `a check line` line.
- Add `checks: check refuses a broken check with its reason`: one config with eight bad entries, one per problem of 2.3
  (unknown field, bad field, both match and forbid, except with match, bad regex `"("`, flags `"g"`, bad `when`, no message,
  plus a duplicate id) → the exact `problem:` lines, exit 1, and no `config checks: ... entries kept` line among them.
  The expected bad-field line is built from the live list:
  `` `problem: config checks[1].field: one of ${checkFields().join(", ")}` `` (never a literal field list, cross-spec 6);
  the bad-regex line is built from the engine's own message: `"problem: config checks[4].match: not a regex: " + (() => { try { new RegExp("("); } catch (e) { return e.message; } })()`
  (index numbers follow the order of the entries in the test config).
- Add `checks: more than 50 checks keep the first 50 in check and in sync`: 51 valid checks, the 51st a `forbid` on
  `title` of `"."` → `check` prints exactly one check problem, `problem: config checks: 50 of 51 entries kept`, exit 1;
  `sync` of a compliant card stops with the same text (via `fail`), exit 1.
- Add `checks: check notes the state's cards that break a check and still writes the config`: a check that the fixture's
  open card fails → line `note: card <id>: check <ref>: <message>`, exit 0, `config: changed, write it`.
- Add `checks: the shipped examples in assets/config.example.json pass check and fire when uncommented` (AC 2):
  copy the example, move `_examples.checks` to `checks`, drop `_examples`, add `"tz": "UTC"` (A's test rule), write it as `board/config.json` of a fresh board
  (state from the fixture with its cards re-linked to `wiki.example.com`, or a fresh state from `check`). `check` exits 0.
  Then sync: a `tracker` card linking `https://wiki.example.com/a` → `check tracker-link`; a card whose summary has
  `Password = hunter2` → `check no-secrets`; one with `password: <redacted>` passes; one with
  `password: <redacted>, old password = hunter2` → `check no-secrets` (one clean and one leaking occurrence in one summary);
  a `mail` card without tags → `check mail-tag`;
  a compliant card of each source → exit 0.
- Unit test of `compileChecks` + `checkHits`: a `links.url` match over two links passes when one matches; `first_asked.who` forbid;
  `checkHits` called twice in a row on the same card gives the same result (no `lastIndex` carry-over).

`tests/skill-text-test.js`: `config.example.json` parses; every host in `link_hosts` and every URL-looking text in it ends
in `example.com` (or `example.com/`); `_examples.checks` has 3 entries; `data-model.md` contains `### Checks`.

AC map: "sync refuses a card that breaks a rule and prints the rule message" → the first added test.
"The shipped examples pass a test when uncommented" → the example test.

### 2.8 Steps

- B6. Add `checkFields`, `compileChecks`, `checkHits` (all three exported), `fieldValues` and the `sync` lines of 2.4
  (with the one `a check line ...` line). The config key is `checks`. Pre: B3 (the merged config
  carries `checks`). Done: the refuse test and the unit test pass; tests green.
- B7. `check`: the `compileChecks` problems (with its own 50 cap; `checks` stays out of the entries-kept loop), the
  state-card notes. Pre: B6. Done: the bad-checks test, the 50-cap test and the notes test pass; tests green.
- B8. `assets/config.example.json`, the `REF/data-model.md` row and section, the README line. Pre: B7.
  Done: the example test and the skill-text cases pass; tests green.

---

## Item 3: decision-board-operator-rules

### 3.1 Goal

`board/rules.md` holds the operator's standing judgments in prose. The agent reads it at the start of each session
and when the script prints that the file changed. No rule lands in it
without an answered card. `check` posts the file as the guide `rules` (a Rules tab) whenever its hash changed: the
script builds the guide write itself and the agent composes nothing.
The build flow offers to start it. `read` flags the answer lines that need the rules procedure, so the agent never
has to decide whether an answer or a note is about a rule.

### 3.2 Data model

- `board/rules.md` (writer: the agent, only after an answered rule card; or the operator by hand). Format:
  the guide Markdown of `REF/guides.md`: first line `# Rules`, then one `## <topic>` section per topic;
  section text in the card text format. One file per board; there is no user-level rules file (Calls made 24).
- State file: new optional field `rules_md`: the first 12 hex characters of the SHA-256 of `board/rules.md` as
  `check` last handled it (posted it as the guide, deleted the guide, or found it without sections and never
  posted). Absent until then. Named `rules_md`, not `rules`, so it cannot be read as the config key of item 2.
  A's older-model refusal accepts it (A 1.4 step 2).
- Rule cards: ordinary cards in `cards`, with `source: "rules"`, `id` `rule-<topic slug>`, `kind: "decision"`.
  They need no link (item 4 makes links optional on every card).
- Guide `rules` (doc `guides/rules`, kind `text`, title from the `# Rules` line, so the tab reads `Rules`): written
  only by `check` (3.4). `status` is always `"active"`; a file without any `## ` section, once posted, deletes the doc.

### 3.3 Config

No key for the path: it is fixed, `<state dir>/rules.md`. One script-only key (1.3): `standing`, default
`["always", "never", "from now on"]`, the words that make `read` flag a note `[standing]`. Valid: a list of 1 to 50
texts, each 1 to 40 characters after trim. Otherwise `check` prints the problem
`config standing: a list of 1 to 50 texts, each 1 to 40 characters` (1.4 step 8), and `read` uses the default list.

### 3.4 Script

New in `S`:
New in `S`, in a new section `// ---- the operator's rules` placed directly after the `// ---- guide` section
(it uses `parseGuide` and `guideDoc`):

```js
// ---- the operator's rules: <state dir>/rules.md. check posts it as the guide "rules" whenever its hash changed;
// read only says that it changed. The agent never posts it with guide.
const RULES_ID = "rules";
function rulesFile(r) { return path.join(r.dir, "rules.md"); }
// What check does with rules.md: changed = its hash differs from the state's rules_md; write = changed and it has a
// section, or it lost every section after a post (then the guide is deleted).
function rulesState(r) {
  const file = rulesFile(r);
  if (!fs.existsSync(file)) return { file, exists: false, changed: false, write: false };
  const buf = fs.readFileSync(file), text = buf.toString("utf8"), hash = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  const g = parseGuide(text), posted = r.st.next["guides/" + RULES_ID] !== undefined, changed = hash !== r.st.rules_md;
  return { file, exists: true, text, hash, g, posted, changed, write: changed && (g.secs.length > 0 || posted) };
}
// The one rules line of check or read, or "". a: the parsed arguments, for the --state of the printed command.
function rulesLine(rs, cmd, a) {
  if (cmd === "check" && !rs.exists) return `rules: no ${rel(rs.file)}. Read references/rules.md, "Start the rules", and follow it`;
  if (!rs.write) return "";
  if (cmd === "check") return `rules: ${rel(rs.file)} changed. Read it; check posts it as the guide rules in the array below`;
  return `rules: ${rel(rs.file)} changed. Run node ${SELF} check${a.state ? " --state " + q(one(a, "state")) : ""} and pass its array`;
}
// check: the guide document of rules.md with its problems. old is the last guide write that check printed, so a
// section keeps its updated time while its title and body stay the same.
function rulesDoc(r, rs, t) {
  const pw = r.st.pending["guides/" + RULES_ID];
  const old = pw && pw.op === "set" && pw.file_path && fs.existsSync(pw.file_path) ? plain(P.coerce("guide", JSON.parse(fs.readFileSync(pw.file_path, "utf8")))) : null;
  if (old) old.status = "active";
  const { doc, errs } = guideDoc(RULES_ID, "text", rs.text, old, "", t);
  return { doc, errs: errs.map((e) => `rules: ${rel(rs.file)}: ${e}`) };
}
// check, on success: the guide write (set, or delete when every section is gone), then the new hash.
function queueRules(r, rs, rd) {
  if (!rs.changed) return;
  if (rd) r.pinned("set", "guides", RULES_ID, rd.doc);
  else if (rs.write) r.pinned("delete", "guides", RULES_ID, null);
  r.st.rules_md = rs.hash;
}
// read: the words of the config list standing as one regex, case ignored, whole words only; the default list
// when the config value is not valid (check reports it).
function standingOk(v) { return Array.isArray(v) && v.length >= 1 && v.length <= 50 && v.every((x) => typeof x === "string" && x.trim().length >= 1 && x.trim().length <= 40); }
function standingRe(v) {
  const list = (standingOk(v) ? v : SCRIPT_DEFAULTS.standing).map((x) => x.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  return new RegExp("(?<![\\p{L}\\p{N}])(" + list.join("|") + ")(?![\\p{L}\\p{N}])", "iu");
}
```

Changed in `S`:
- **`guideDoc`** (refactor, no behaviour change): move the part of `cmdGuide` from `const g = parseGuide(text), prev = ...`
  through `if (JSON.stringify(doc).length > S.max.g) errs.push(...)` into a module-level function placed directly
  after `parseGuide`:
  ```js
  // The guide document of a Markdown text: a section keeps its updated time while its title and body stay the same.
  function guideDoc(id, kind, text, old, item, t) {
    const g = parseGuide(text), prev = new Map((old ? old.sections : []).map((s) => [s.id, s]));
    const sections = g.secs.map((s) => {
      const p = prev.get(s.id);
      return Object.assign(s, { updated: p && p.title === s.title && p.body === s.body ? p.updated : t });
    });
    const doc = { id, kind, title: g.title || (old && old.title) || id, sections, status: old ? old.status || "active" : "active",
      created: (old && old.created) || t, updated: t };
    if (item) doc.item = item;
    const errs = P.problems("guide", doc);
    if (JSON.stringify(doc).length > S.max.g) errs.push("the guide is longer than " + S.max.g + " characters");
    return { doc, errs };
  }
  ```
  and in `cmdGuide` write `const { doc, errs } = guideDoc(id, kind, text, old, item, t);` in place of the moved lines
  (the next line, `if (errs.length) fail(...)`, and the rest stay). If cluster A's `cmdGuide` differs inside the moved
  part, move A's text unchanged and keep this signature.
- **`cmdGuide`**: directly after `id` is known (`guideId(one(a, "id"))`), add
  `` if (id === RULES_ID) fail(`guide: the guide rules is posted by check from board/rules.md. Run node ${SELF} check`); ``
  (one writer for that document; applies to `--archive` and `--delete` too).
- **`cmdCheck`**: after `new Run(...)` add `const t = now();` (if A's `cmdCheck` already has a `t`, use it) and
  `const rs = rulesState(r);`. Before the loop over the state's cards (so the order of 1.4 step 8 holds), push the
  `standing` problem when `r.config.standing !== undefined && !standingOk(r.config.standing)`, then
  `const rd = rs.write && rs.g.secs.length ? rulesDoc(r, rs, t) : null; if (rd) errs.push(...rd.errs);`.
  At 1.4 step 7: `const rl = rulesLine(rs, "check", a); if (rl) log(rl);` (before the check notes of item 2).
  At 1.4 step 9, after the `config:` line: `queueRules(r, rs, rd);`. On a failed `check` nothing is queued and
  `rules_md` stays, so the next `check` tries again.
- **`cmdRead`**: after cluster A's `--dumped` refusal and before `r.logHandled(dump, log)`:
  `{ const rl = rulesLine(rulesState(r), "read", a); if (rl) log(rl); }` (read writes no `rules_md`; only `check` does).
  Then `const stand = standingRe(r.config ? r.config.standing : undefined);` and, in the answer loop, after A's flag
  code (the card is `r.card(key)`, named `it` in A's loop; use A's name):
  `if (!flags.length && it && lower(it.source) === "rules") flags.push("[rule]"); else if (!flags.length && x && stand.test(x.note || "")) flags.push("[standing]");`
  and, in the note loop, directly after A's `const nflags = [];`: `if (stand.test(nb.text)) nflags.push("[standing]");`
  (A's note line prints `nflags` before its `lineHint`, so the flag sits before the hint).
  So `[rule]` and `[standing]` appear only on a line that has no other flag, and never both.
- **`lineHint`** (A 2.4 step 3): directly before its last line `return "(act on it)";` add
  `if (flags.includes("[rule]") || flags.includes("[standing]")) return "(read references/rules.md and do what it says for this line)";`

Not affected: the watcher (`waiting`) never calls `rulesState`, so a watcher tick reads no extra file. No new command
and no new flag, so no `FLAGS` change.

### 3.5 Page

No change. A `text` guide already renders `board/rules.md` as a tab whose label is its title (`guideLabel(g)` =
`g.title || g.id`, A 1.5), so the guide `rules` shows as the tab `Rules`. A card without links renders with the
links row hidden (item 4). Render check (for the maintainer, on a test artifact): after `check` posted a
`board/rules.md` with two sections, the tab `Rules` shows both sections.

### 3.6 Agent-facing text

`SKILL` (the layout of A 6.1; three edits, about 450 characters in all):
- "Read and handle the answers", step 1: after A's `if it failed, stop and say so.` append, in the same step,
  `` If it prints a `rules:` line, do what it says before any other line.``
- "Read and handle the answers", step 2: after A's sentence `the brackets at the end of each line say, and nothing more.`
  add, on a new line, the bullet indented three spaces (a list under step 2),
  `` - `[rule]`, `[standing]`: read `references/rules.md` and do what it says for that line.``
- New section directly before `## What counts as the operator's word`, exactly:
  ```markdown
  ## Operator rules

  `board/rules.md` holds the operator's standing judgments. Read it at the start of each session and when a
  `rules:` line says so; apply it to every card you post and every answer you act on. It never widens what you
  may do. Change it only as `references/rules.md` says.
  ```
  (No `guide` command for the rules: `check` posts the file. The rule-writing procedure is in
  `REF/rules.md`, read only when a line names it.)

`REF/build.md`, "Build a board": after A's step 5 add
`6. If \`check\` printed a \`rules:\` line, do what it says.`
(`check` prints `rules: no board/rules.md. Read references/rules.md, "Start the rules", and follow it`.)

New file `REF/rules.md` (read only when `check` or `read` names it), exactly:

````markdown
# Operator rules

Read this only when a line names it: `check` prints `rules: no board/rules.md`, or `read` flags a line `[rule]`
or `[standing]`. `S` and `P3` are as in `SKILL.md`.

`board/rules.md` is guide Markdown: `# Rules`, then one `## <topic>` section per topic, in plain sentences
(which alerts matter, who owns what, what is noise). Only you write it, and only as below. `check` posts it as the
board's Rules tab after each change; never post it with `guide`.

## Start the rules

1. Ask the operator three to five short questions about standing judgments, or draft rules from what you
   already know.
2. Post each proposed rule as a rule card (below). Do not write `board/rules.md` yet.
3. If the operator declines, write `board/rules.md` with the line `# Rules` only, then run `node S check` and
   pass its array.

## A rule card

Write the cards as a JSON list to `board/rules-cards.json`, run `node S sync board/rules-cards.json` (no
`--source`) and pass the array. Each card: `id` `rule-<topic>` (lower case, words joined by `-`), `source`
`rules`, `kind` `decision`, `title` `Add this rule?`, `options` `["Add it", "Add it with my change, see note",
"Leave it out"]`, `first_asked` `{"date": "<today, YYYY-MM-DD>", "who": "operator"}`, and in `summary` the
section name and the exact rule text in a fenced block. A rule card needs no link.

## A `[rule]` line

- `Add it`: add the rule text of the card's `summary` to its `## <topic>` section of `board/rules.md`; make the
  section when it is missing.
- `Add it with my change, see note`: the same, with the note's text as the rule text.
- `Leave it out`: change nothing in `board/rules.md`.

Then add `--close <id>` to the ack of that batch. After you passed the ack's array, run `node S check` and pass
its array: it posts the file.

## A `[standing]` line

The answer note or the free note states a standing preference. Do what the line asks as usual, then post a rule
card that proposes the preference as a rule.
````

`REF/watch.md`: no change; the watcher never reads `board/rules.md`.

`RSKILL`, step 5 "Judge": prepend `Apply the operator's rules in \`board/rules.md\`, which you read at the start of the session.`

`README.md`, "How the agent works with it": append the sentence
`The operator's standing judgments live in \`board/rules.md\`; every new rule reaches it through a card the operator answers, and \`check\` posts the file as the Rules tab.`

### 3.7 Tests

`tests/board-test.mjs`:
In every case below `<rf>` = `path.relative(process.cwd(), path.join(b.board, "rules.md"))` and `<st>` =
`JSON.stringify(b.state)` (the `q()` of the `--state` value that `cmd` passes).
- Add `rules: check offers board/rules.md when it is missing; read says nothing`: fresh board, no `rules.md` → `check`
  output includes `rules: no <rf>. Read references/rules.md, "Start the rules", and follow it`; `ok2(b, "read")` prints
  no line that starts with `rules:`; write `# Rules\n` → `check` prints no line that starts with `rules:`, `writesOf`
  of it holds no write with `collection` `guides`, and `state(b).rules_md` matches `/^[0-9a-f]{12}$/`; the next `check` and
  `ok2(b, "read")` print no `rules:` line.
- Add `rules: a change of board/rules.md: read names check, check posts the guide rules once`:
  write `# Rules\n\n## Alerts\n- x\n\n## Owners\n- y\n` → `ok2(b, "read")` includes
  `` `rules: <rf> changed. Run node ${SELF} check --state <st> and pass its array` `` and the state has no `rules_md`;
  `cmd(b, "check")` exits 0, includes `rules: <rf> changed. Read it; check posts it as the guide rules in the array below`,
  its `config:` line is the one the meta/config compare gives (`config: changed, write it` on this fresh board), and
  `writesOf` holds exactly one write with `collection` `guides`: `op` `set`, `doc_id` `rules`, no `if_version`; after
  `apply`, the db document `guides/rules` has `kind` `"text"`, `title` `"Rules"`, `status` `"active"` and section titles
  `["Alerts", "Owners"]`; `state(b).rules_md` matches `/^[0-9a-f]{12}$/`. A second `check`: no `rules:` line, no
  `guides` write. `ok2(b, "read")`: no `rules:` line. Append `\n## Noise\n- z\n` to the file → `check` writes
  `guides/rules` with `if_version` 1, and the section `alerts` keeps the `updated` of the first write. Write `# Rules\n`
  → `check` prints the changed line and writes `["delete", "guides", "rules", 2]` (op, collection, doc_id, if_version).
- Add `rules: a rules.md that is not a valid guide is a check problem and keeps the hash`: a file
  `"# Rules\n\n## Big\n" + "x".repeat(210000) + "\n"` (over the page's guide and section limits) → `check` exits 1,
  at least one line starts `problem: rules: <rf>: ` (assert the prefix only; the exact texts are the page's
  `problems` and the guide length line of `guideDoc`), no write is printed, and `state(b).rules_md` is what it was
  before the call.
- Add `rules: guide refuses the id rules`: `dumped(b, "guide", <any md file>, "--id", "rules")` exits 1 with
  `` `guide: the guide rules is posted by check from board/rules.md. Run node ${SELF} check` ``.
- Add `rules: read flags rule answers and standing notes`: a card `yn("rule-alerts", {source: "rules"})` synced; a sent
  batch (`putDoc`, A's `batch()` helper) with an answer `Add it` for `rule-alerts`, an answer for `disk-size` with note
  `From now on, back up first.`, a free note `never page me at night`, and a free note `not a preference` → `ok2(b, "read")`:
  with `R = "(read references/rules.md and do what it says for this line)"`, the `rule-alerts` line ends
  `  [rule]  ` + R, the `disk-size` line ends `  [standing]  ` + R, the first note line ends `  [standing]  ` + R,
  the second note line has no flag and ends `  (act on it)`. With a board config `"+standing": ["zawsze"]` a note
  `Zawsze pytaj` ends `  [standing]  ` + R; a note `alwaysish` has no flag (whole words only). A `[stale-rev]` answer
  on a rules card gets no `[rule]` and ends `  [stale-rev]  (skip)`.
- Add `rules: check refuses an invalid standing list`: board config `"standing": []` → `problem: config standing: a list of 1 to 50 texts, each 1 to 40 characters`, exit 1.

`tests/skill-text-test.js` (AC 1 and the text half of AC 2): `SKILL` contains `## Operator rules`, `` `board/rules.md` ``,
`Read it at the start of each session and when a`, `references/rules.md`, `` `[rule]` `` and `` `[standing]` ``, and no
`guide board/rules.md`; `REF/rules.md` contains `## Start the rules`, `Add it`, `Add it with my change, see note`,
`Leave it out`, `source` and `rules-cards.json`; `REF/build.md` "Build a board" (the text between `## Build a board`
and the next `## `) contains `printed a \`rules:\` line`; `RSKILL` contains `board/rules.md`; `REF/watch.md` does not
contain `rules.md`.

Manual check M1, for the maintainer (AC 2, "the install flow offers to start it, and every rule passes through a
card"; not an implementer step): on a scratch board in a scratch repository and a new test artifact (never the live
board under `board/`), an agent runs "Build a board". Evidence: `check` printed the
`rules: no ...` line; the agent read `REF/rules.md` and asked in the terminal; each drafted rule became a card with
`source: "rules"`; `board/rules.md` was written only after a batch answered `Add it` (its `read` line carried
`[rule]`), `decisions.md` holds that answer, and the next `check` printed the `guides/rules` write; the Rules tab shows
on a phone width. Record the result in the PR text, not in the repo.

AC map: "SKILL.md names the file and when to read it" → skill-text-test (`Read it at the start of each session ...`).
"The install flow offers to start it, and every rule passes through a card" → skill-text-test (text), the `[rule]`
read test (script), M1 (behaviour).

### 3.8 Steps

- B9a. Refactor `guideDoc` out of `cmdGuide` (no behaviour change). Pre: B8. Done: every existing `guide` test of
  board-test and loss-test passes unchanged; tests green.
- B9. The `// ---- the operator's rules` section of 3.4 (`RULES_ID`, `rulesFile`, `rulesState`, `rulesLine`,
  `rulesDoc`, `queueRules`, `standingOk`, `standingRe`); the `cmdCheck` lines (the `standing` problem, the rules
  problems, the `rules:` line at 1.4 step 7, `queueRules` after the `config:` line); the `cmdRead` line and the
  `[rule]`/`[standing]` flags; the `cmdGuide` refusal of the id `rules`. Add the rules tests of 3.7. Pre: B9a.
  Done: the rules tests pass; tests green; `grep -n "rules_md" skills/decision-board/scripts/board.mjs` shows it
  written only inside `queueRules`.
- B12. The text of 3.6 (`SKILL` three edits, `REF/build.md` step 6, the new `REF/rules.md`, `RSKILL` step 5, README)
  and the rules part of `tests/skill-text-test.js`. Pre: B5, B8, B9, B10. Done: `node tests/skill-text-test.js`
  exits 0; `wc -c skills/decision-board/SKILL.md` prints at most 8000 (expected about 6498 when A's file is A's 6.1 block, 6804 in an earlier draft; board-test "SKILL.md stays
  short" passes; if it does not, move text to `REF/rules.md`, never raise the limit); board-test "artifact-capabilities
  is named once, in P1" passes (`REF/rules.md` does not name it); `python3 scripts/validate-skills.py` (repo root)
  prints no problem.
- B13. Set `.claude-plugin/plugin.json` `version` from `0.5.0` to `0.6.0`. Whole run: tests green;
  `git status` shows changes only under `plugins/decision-board/` (and no `config.local.json`, `config.merged.json`,
  `rules.md`, `rules-cards.json` or user file anywhere in the tree); grep of the diff for `curl|wget|https?://` finds only
  `example.com` hosts and documentation links; grep of the diff for `spawnSync` finds only the `git check-ignore` call
  of 1.4 and the `git` calls of the tests. M1 and the render checks are the maintainer's, after this step.

---

## Item 4: optional links

### 4.1 Goal

Links are optional on every card. For an open card without a link, `sync` prints one line `note: <id>: no link`; it
is not a problem and refuses nothing. A link that a card carries is still checked as today.

### 4.2 Data model

No database change, no SCHEMA change (`links` is already `a:link`, at most `S.max.links`). A card may hold `links`
absent or `[]`.

### 4.3 Config

`link_hosts` is no longer required: `check` prints the note of 1.4 step 6c in place of the problem
`config link_hosts: none. Every card needs a link to one of them`. A link to a host not on `link_hosts` (or any link
while `link_hosts` is empty) is still refused by the page's `linkProblem`, unchanged.

### 4.4 Script

- `linkProblems(links)`: delete the `hint` line and the `links: missing` line; the function starts
  `if (!Array.isArray(links)) return [];` (an absent or non-list `links` gives no problem here; a non-list is still
  refused by `P.problems("item", ...)` as today) and keeps the `more than` and per-link checks.
- `cmdSync`: in the loop over `cards` that builds each `doc`, after `doc.status` is set, add
  `if (doc.status === "open" && !(Array.isArray(doc.links) && doc.links.length)) noLink.push(c.id);` with
  `const noLink = [];` declared beside `closed` and `reopened`. Place the push before the `n.same` `continue`, so an
  unchanged open card without a link gets its note on every run. After the existing `sync: ...` summary line, add
  `noLink.forEach((id) => log(\`note: ${qid(id)}: no link\`));` (so the summary stays the first line, as A's tests read it).
- `cmdCheck`: the `config link_hosts: none...` problem is replaced by the note of 1.4 step 6c. `check` prints no
  per-card `no link` note.
- `R`: no change. `map` still needs a `url` for every row: it builds the card's one link and the `xref` key from it
  (Calls made 31).

### 4.5 Page

No change: a card without valid links already renders with its links row hidden (`validLinks` is empty).
Render check (for the maintainer, phone width): a card without links shows no links row and no gap.

### 4.6 Agent-facing text

The link clauses of 1.6 (`REF/build.md` step 3, the `REF/data-model.md` `link_hosts` row and "Every field is
optional", `docs/how-it-works.html` "Web links" and `meta` row) are written in step B10, not in B5. Also:
- `REF/cards.md`, table row `links`: replace `Required. 1 to 10 \`{"label", "url"}\`.` by
  `Optional. Up to 10 \`{"label", "url"}\`; \`sync\` prints \`note: <id>: no link\` for an open card without one.`
  and replace `A card with no natural URL links the report it came from or the repository page of the work` by
  `Give the link of the item when it has one`.

### 4.7 Tests

`tests/board-test.mjs`: replace the case "sync: every card needs a link; without link_hosts the refusal says to set them"
(as A leaves it) by `sync: links are optional; an open card without a link gets one note line; a given link is still checked`:
- `cfgOf(b, (x) => { x.link_hosts = []; })`; `sync(b, [mk({ id: "nolink", title: "T", links: undefined }), mk({ id: "haslink", title: "T" })])`
  → exit 1, lines exactly `["haslink: links[0]: no link_hosts in the config: set link_hosts in meta/config"]`.
- on a fresh board, `sync` of `mk({ id: "empty", title: "T", links: [] })`, `mk({ id: "many", title: "T", links: Array.from({ length: 11 }, () => NEED.links[0]) })`,
  `mk({ id: "info", kind: "info", status: "closed", title: "T", links: undefined, options: undefined })` → exit 1,
  lines exactly `["many: links: more than 10"]`.
- on a fresh board, `sync` of `mk({ id: "nolink", title: "T", links: undefined })`, `mk({ id: "shut", title: "T", status: "closed", links: undefined })`
  and `mk({ id: "haslink", title: "T" })` → exit 0; the first line starts `sync: `; the lines that start `note: ` are
  exactly `["note: nolink: no link"]`; a second identical `sync` prints `note: nolink: no link` again and `no writes`.
- on `fresh(false)` (no state, so no card to check) with `link_hosts: []`, `cmd(b, "check")` exits 0 and prints
  `note: config link_hosts: none, so sync refuses every card link. A card needs no link`.
Sweep: `grep -n "links: missing\|Every card needs\|link_hosts: none" tests/*.mjs tests/*.js` after the change prints
only the new note text.

`tests/skill-text-test.js`: `REF/cards.md` contains `Optional. Up to 10` and not `Required. 1 to 10`; `REF/build.md`
does not contain `every card needs a link`.

### 4.8 Steps

- B10. `linkProblems`, the `sync` note, the `check` note 6c, the link texts of 1.6 and 4.6, the tests of 4.7. Pre: B3.
  Done: the new links case passes; the sweep grep prints only the new note; tests green.

---

## Calls made

1. Layer 1 (plugin defaults) is `DEFAULTS` in the page plus `SCRIPT_DEFAULTS` in the script, not a new JSON file:
   the page needs its defaults anyway, and one source cannot drift.
2. `meta/config` gets only keys a layer file set (plus a `+`-appended list in full), not the defaults: the page
   applies its own `DEFAULTS`, so a later page default reaches boards without a rerun of `check`.
3. Script-only keys (`checks`) never go to `meta/config`: the page does not use them, and check values (banned words,
   internal link shapes) are operator-private; the board can be shared for viewing.
4. `check` writes `board/config.merged.json` for `refresh.mjs`: the refresh skill must see the same `link_hosts`,
   `tags` and `tz` as `sync` without importing code across skills, so the file holds the full merged config with
   the defaults of layer 1 (a board on default tags or priorities would otherwise give `map` an empty tag list).
   `sync` merges live, so it never runs on a stale snapshot.
   The file leaves out `checks` (`MERGED_OMIT`), lives in `board/`, which SKILL.md already tells the agent to add to
   `info/exclude` before the first write, and `check` notes when `git check-ignore` says it is not ignored. Why not a
   question: the existing exclude rule already answers where board files may live; the note and the omission close
   the gap the review found without changing anything the operator sees in normal use.
5. `CONFIG_KEYS = Object.keys(P.DEFAULTS) + SCRIPT_KEYS`: a key that clusters C and D add to `DEFAULTS` is known to the
   merge and to `check` with no second edit.
6. Objects deep-merge; lists and texts replace; `+key` appends; `null` removes; `_` keys are comments. The scoping fixes
   replace and append; deep merge is needed for object keys such as a later `wake`; `_` keys are needed for `_examples`.
   The per-layer unknown-field check skips `_` keys and reads `+key` by its base name.
7. An appended entry with an existing `id` replaces it in place: the page's `idList` would otherwise keep the earlier
   entry and silently drop the later layer's change. The defaults are JSON-cloned (`pageDefaults`) before the merge,
   because `P.DEFAULTS` lives in a `vm` realm where `isPlain` is false.
8. `+key` with no earlier layer appends to the default list: "append" to `priorities` in a user file must keep now/soon/later.
9. User file path: `BOARD_USER_CONFIG`, else XDG, else `~/.config/decision-board/config.json`. The env var lets tests turn
   the layer off, so no developer's private file can reach a test or its output, and it follows the `BOARD_NOW` pattern.
10. A user file inside a git work tree is a `note:`, not a problem: a home folder kept in git (dotfiles) is a real setup,
    and the note still warns.
11. `board/config.json` becomes optional; one layer file must exist: the user file can carry `link_hosts`.
12. `check` shows the layer of every set key: with one layer file, one line `config <layer>: <keys>`; with two or more,
    one line per set key with its layers and a short value; then one `config default:` line of the unset page keys
    (unset script-only keys are not listed). The AC is met in both cases, and the common one-file board pays one line.
    No `--layers` switch: the agent never has to choose.
13. Operator answer `config-rules-key-name`: the config key is `checks`. The rename table and every `rules` alternative
    of item 2 are gone; `rules` now names only the prose file `board/rules.md`, its `rules:` lines and rule cards.
14. A check failure stops the whole sync, like every other card problem: leaving out only the failing card would close
    it under `--source` (a card missing from its source file closes).
15. `except` works with `forbid` only and clears one hit at a time: it must match starting at that hit's first character.
    The scoping says "clears a hit"; a whole-value test would let a second, leaking occurrence through.
16. Closed cards pass every check: a closed card asks nothing, and a refreshed closed row must not block a source.
17. `check` reports state cards that break a check as notes: a new check must not block the config write that
    introduces it; the next `sync` of those cards enforces it.
18. Regex length cap 300 and flags limited to `imsu`: the operator never sets stateful `g`/`y`; the engine adds `g`
    and `y` itself for the forbid scan and the `except` test, and resets `lastIndex` before each use.
19. The check field list is derived from `SCHEMA.item`, so a field added later (for example `draft`) is checkable at once.
20. Rule cards go through the normal `sync` with `"source": "rules"` on each card and without `--source`: `--source`
    would close rule cards left out of the file and refuse a file of closed cards.
21. The `rules.md` format is the guide Markdown, so `check` builds the guide with the same `parseGuide` and the new
    `guideDoc` that `guide` uses (one code path, no second parser).
22. A declined offer leaves a `board/rules.md` holding `# Rules`, so `check` does not offer again on every run; a file
    without sections that was never posted gives no write and no line.
23. The page change of this cluster is the footer settings line only (1.5); its render check and the Rules tab look
    are the maintainer's, on a test artifact.
24. The prose rules live in `board/rules.md` only, as the scoping names it; no user-level rules file. (Was the question
    `operator-rules-location`; the scoping answers it.)
25. `compileChecks` owns the 50-entry cap and its problem text, and the same function runs in `sync` and `check`.
26. The state field for the rules hash is `rules_md`, so it cannot be confused with the config key of item 2.
27. Operator answer `operator-rules-reread`: the agent reads `board/rules.md` at the start of each session and when the
    script prints that it changed. `rules_md` is the hash of the file as `check` last handled it; `read` only reports a
    difference and names `check`, and `check` (which also posts the guide) is the one writer of `rules_md`. So an
    unhandled change is reported on every `read` until `check` runs, and a failed `check` keeps reporting it. The
    agent's own approved change is reported once by `check` and costs one re-read of a short file: accepted, it keeps
    one rule ("read it when a `rules:` line says so") with no exception.
28. Operator answer `operator-rules-guide-tab`: a Rules tab, posted by the script. `check` builds the `guides/rules`
    write whenever the hash changed (a set, or a delete when every section is gone after a post); the agent composes
    nothing, and `guide --id rules` is refused so the document has one writer. `read` prints no array (A's `read`
    prints none), so the post happens in `check`, which `read`'s line names.
29. Operator answer `operator-rules-card-links`: links are optional on every card (item 4); an open card without a link
    gets `note: <id>: no link` from `sync`, once per run, after the summary line. The rule-card exemption of the earlier
    draft is gone. Consequence made a call, not a question: `link_hosts` is no longer required, and its `check` problem
    becomes a note (a board whose cards carry no link needs no host; a link is still refused without a matching host).
30. Operator answer (no settings toggles): `check` writes `settings` (`Settings: <layer files>`) into
    `meta/config`, and the page footer shows it under `Times in <zone>`. `settings` is in `DEFAULTS` (so the page
    normalises it like every config key) but in `WRITTEN_KEYS`, so no layer file may set it. The text names the files
    that exist, user file first as `~/...`: it says where to change a setting and holds no value of one.
31. `refresh.mjs map` still requires a `url` per row: the link and the `xref` key come from it. A source without a
    URL (a chat export) is written as a hand-made card file, which item 4 lets carry no link. Changing `map` is a
    map-key change, cluster C1's subject (Needs).
32. `read` flags `[rule]` (an answer on a card whose `source` is `rules`) and `[standing]` (an answer note or a free
    note that holds a word of the config list `standing`), each only on a line with no other flag: the script makes the
    judgment "is this about a rule?", and `SKILL` holds one bullet that sends both flags to `REF/rules.md`. The word
    list is a script-only config key with an English default, because the operator's notes may be in another
    language; a layer appends words with `"+standing"`. Whole-word match, case ignored, Unicode letters.
33. `check` prints `config ids: tags ...; priorities ...`: board-refresh step 2 takes the ids
    from that line, not from a file, and the line shows defaults too.
34. Operator answer (private values live in the user layer): the build step and data-model.md say that `tz`,
    `link_hosts`, `tags`, `checks` (and later the names of people) go in the user file. The defaults `tz:
    "Europe/Warsaw"` (cluster A) and the week start (cluster C1) are public plugin defaults by the operator's choice.
35. Plugin version 0.6.0 (maintainer, A Call 23).

## Needs from other clusters

- A: nothing beyond the final decision-board-spec-a-core.md. Step B0 greps every name B uses; A's tests that B changes are named in 1.7
  and 4.7 ("check: local only", "check: problems", "sync: every card needs a link").
- C1, C2, D (every later cluster): B leaves these names, which later specs may grep in their step 0:
  `export const CONFIG_KEYS`, `export const SCRIPT_KEYS`, `const SCRIPT_DEFAULTS`, `const WRITTEN_KEYS`,
  `const MERGED_OMIT`, `export function mergeLayers`, `export const pageDefaults`, `function loadConfig`,
  `function settingsText`, `export function checkFields`, `export function compileChecks`, `export function checkHits`,
  `function guideDoc`, `function rulesState`, `const RULES_ID`, `function standingRe`, `r.load.config`, `r.load.page`,
  the state field `rules_md`, the file `tests/skill-text-test.js` (later text cases go there, cross-spec 18), and the
  test helpers `setKeys`, `defaultLine`, `boardCfg`. The `config default:` and per-key lines are computed from
  `CONFIG_KEYS` in every B test, so a key added to `DEFAULTS` needs no B test edit (cross-spec 5). The bad-check `field`
  line is built from `checkFields()` (cross-spec 6). A page key goes in `DEFAULTS`; a script-only key in
  `SCRIPT_DEFAULTS`; a key `check` writes itself in `WRITTEN_KEYS`.
- C1 (due dates, groups, week start): the week start key holds a private value: add it to the list
  `tz`, `link_hosts`, `tags`, `checks` in `REF/build.md` step 3 and in the data-model.md layers paragraph. If `map` gains
  an optional `url` for chat sources, item 4 already lets such a card carry no link (Calls made 31). Once `draft`
  exists, `REF/rules.md` "A rule card" puts the rule text in `draft` instead of a fenced block in `summary`; `draft`
  becomes a check field without code.
- C2 (controls, people): `people` entries need an `id` so a layer replaces one in place; add `people` to the private
  list of `REF/build.md` step 3 and data-model.md. The Close switch and assign rules are C2's; B adds no control.
- D (wake-modes, agent-status): `wake` is an object key and deep-merges. The watch values come from the merged config
  through `Run` (`r.load.config`), never from `board/config.json`. A key read only by the script goes in
  `SCRIPT_DEFAULTS`; it stays in `config.merged.json` unless added to `MERGED_OMIT`. The status guide switch is a
  config key only, never a page control. D's `ack --result` text may cite `REF/rules.md` only if it
  changes the rule-card flow.
- board-refresh (same plugin, changed here): `refresh.mjs --config` takes `board/config.merged.json`, step 2 takes the
  ids from the `config ids:` line, and the Judge step applies `board/rules.md`.

## Unverified

- That cluster A lands as decision-board-spec-a-core.md says; B0 checks the names, not the behaviour.
- The exact code of A's `cmdRead` answer loop (the name of the card variable, `it` today) and of A's `cmdGuide` around
  the lines `guideDoc` moves: written against today's code plus decision-board-spec-a-core.md; the steps say to keep A's names.
- That `os.homedir()` and `XDG_CONFIG_HOME` resolve as expected on the operator's work machine (not tested on macOS or Windows).
- That `git check-ignore -q` behaves the same on the operator's git version (status 0 ignored, 1 not ignored, 128 error).
- That `ArtifactData` stores the merged `meta/config` unchanged (size well under the limits; not checked against the real database).
- That a card with no links and the footer settings line look right on a phone (code path read, not rendered; the
  render checks are the maintainer's).
- That an agent follows the build offer and the card-before-rule flow (M1 is manual, the maintainer's).
- That `standingRe` (a lookbehind with the `u` flag) gives the same results on the stated minimum Node 18: run here on
  Node 22 only, where the six test texts of 3.7 give the expected flags.
- No change to an earlier spec is needed for B to work. One note for A's text (no edit needed): A's `REF/build.md`
  step 3 says `(every card needs a link to one)`; B replaces that clause in B10 because of the operator's
  optional-links answer.

