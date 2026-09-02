# ste

Simple Technical English (ASD-STE100) for Claude Code, wired so that it and the caveman
compression plugin stop contradicting each other.

Targets: **Claude Code only.** Hooks and `${CLAUDE_PLUGIN_ROOT}` are Claude Code surfaces.
The ruleset itself (`skills/simple-english/`) is portable and works in any SKILL.md-capable
tool.

## Why it exists

caveman's Auto-Clarity rule tells the model to drop compression for security warnings,
irreversible-action confirmations, multi-step sequences, ambiguity, and when the user asks
to clarify. It then says to "write normal" — which means *unrestricted* English: no limit
on sentence length, no constraint on modal verbs, no guarantee the reader gets one
unambiguous reading. That is the moment where precision matters most, and it is the moment
caveman leaves unspecified.

`AminBlg/SimpleEnglish` already encodes that precision. ASD-STE100 is the controlled
language aerospace uses so that a tired mechanic cannot misread an instruction. Installed
next to caveman unmodified, though, it makes things worse rather than better: caveman's
default says "drop articles, fragments are fine", SimpleEnglish's default says "keep
articles, keep 'that', no contractions", and both inject at `SessionStart` every session
with nothing to reconcile them.

This plugin vendors the ruleset and adds the missing sentence.

## The precedence rule

Stated once, in the text this plugin injects at `SessionStart`. Nothing else restates it:

> **Precedence: caveman wins for ordinary turns. STE wins whenever caveman itself says to
> drop compression** (security warnings, irreversible actions, multi-step sequences,
> ambiguity, or the user asking to clarify).

The bridge does not decide *when* to switch — caveman's own Auto-Clarity list already
decides that. It only decides *what style to switch to*.

When caveman is off, the injected block says so instead: STE is the sole style, there is
nothing to yield to.

## Install

Register the marketplace once, then install from it:

```
/plugin marketplace add /path/to/skill-bazaar
/plugin install ste@skill-bazaar
```

No manual settings edit. Both hooks are declared in `hooks/hooks.json` and are picked up
when the plugin is enabled.

Default state on a machine that has never used it: **STE on, caveman off.**

## Commands

| Command | Effect |
|---|---|
| `/ste on` | Turn the bridge on. Re-injects the ruleset immediately, so it applies to the current turn. |
| `/ste off` | Turn the bridge off. `SessionStart` then emits nothing at all. |
| `/ste status` | Report both values: `ste` and the caveman mode the bridge believes is active. |

A bare `/ste`, or an argument the plugin does not recognise, reports rather than toggles. A
typo must not silently flip the style. Extra words after a good argument (`/ste on junk`) are
ignored, but not in silence: the command runs and the reply names what it dropped.

**`/ste off` makes this plugin inert.** It then parses no caveman command, reads none of
caveman's files, and writes nothing at all. Everything in the rest of this section is gated
on `ste` being on.

The plugin also *watches* caveman's own commands and natural-language phrases, using the
same patterns caveman's `hooks/caveman-mode-tracker.js` uses, so that both plugins agree on
what a sentence means: `/caveman <mode>`, a bare `/caveman`, `stop caveman`, "turn off
caveman", "normal mode", and the activation phrasings. `/caveman-stats` changes nothing,
exactly as it changes nothing in caveman.

### What earns a write, and what does not

caveman deletes a session flag; this plugin writes a default that outlives the session. The
two deserve different thresholds, so a phrase caveman treats as session-only is treated as
session-only here as well — this plugin then writes **nothing**, to either file.
"Persisted" below means caveman's `config.json`, the file that decides every later session.

| Prompt | caveman (session) | ste (persisted) |
|---|---|---|
| `/caveman full`, `/caveman off`, `/caveman:caveman off` | sets/clears the flag | writes `defaultMode` |
| `stop caveman` as the whole prompt | clears the flag | writes `defaultMode: "off"` |
| `please stop caveman now` | clears the flag | writes `defaultMode: "off"` |
| `turn off caveman. now fix the test.` | clears the flag | writes `defaultMode: "off"` |
| `ok, please stop caveman and answer normally` | clears the flag | nothing written |
| `can you disable caveman for this file?` | clears the flag | nothing written |
| `normal mode`, `put the printer in normal mode` | clears the flag | nothing written |
| a bare `/caveman`, `activate caveman` | flag at caveman's default | `state.json` only, never `defaultMode` |

The rule: a persistent `off` needs the deactivation to be **the entire trimmed prompt or a
sentence of its own**, with nothing else in that sentence except leading politeness
(`please`, `ok,`) and a trailing `now` / `please` / `thanks`. `normal mode` never names
caveman, so it can never qualify — it is a session-only toggle by design, and this plugin
deliberately does not remember it.

A bare `/caveman` records what caveman is doing this session in `state.json`, but does not
rewrite caveman's own default: the user named no mode, so no new default was asked for.

`/caveman-commit`, `/caveman-review` and `/caveman-compress` are ignored on purpose. caveman
treats them as one-shot modes and keeps them only in its session flag file, never in its
config, so persisting one here would wrongly make it the default style of every later
session. The cost is that `/ste status` cannot see them; see Limitations.

### When caveman's default is off

Because `defaultMode: "off"` is persisted, a later bare `/caveman` or "activate caveman"
resolves that default, gets `off`, and does nothing — in caveman's own tracker, silently.
This plugin says so in one line instead:

> STE-BRIDGE: caveman default is off; run `/caveman <mode>` (full|lite|ultra) — ste will
> remember it. Last mode you chose: `full`.

The last mode is `cavemanLastMode` in `state.json`, updated on every explicit non-`off`
mode, so the hint names a mode that is actually worth going back to.

## How the setting persists

Two files, one for each half.

```
/ste on|off  ─────────────────> $XDG_CONFIG_HOME/ste/state.json
                                 {"ste": true, "caveman": "off",
                                  "cavemanLastMode": "full"}
                                        │
                                        └──> read by ste-activate.js at SessionStart

/caveman full ────────────────> $XDG_CONFIG_HOME/caveman/config.json
  (also an explicit             {"defaultMode": "full", ...your other keys...}
   "stop caveman")
                                        │
                                        └──> read by caveman-activate.js at ITS SessionStart
```

`$XDG_CONFIG_HOME` falls back to `~/.config` (and to `%APPDATA%` on Windows), matching
caveman's own resolver. A missing state file means the defaults.

The caveman half deserves the detail, because it is the part that looks like it should be
fragile and is not. caveman's `SessionStart` hook **always** rewrites the active mode from
`config.json`. So writing `defaultMode` there at toggle time is the whole persistence
mechanism, and it is also why **cross-plugin hook ordering does not matter to this plugin**:
the write happens on a `UserPromptSubmit` turn, and caveman reads it at a `SessionStart`
that is a whole session later. The two never race. This plugin never writes caveman's
session flag file (`~/.claude/.caveman-active`) — caveman's own tracker owns that for the
current session, and two writers on one file would be a bug looking for a place to happen.

The merge preserves every other key in `config.json`: a test writes a config with four keys,
runs a deactivation through the real hook process, and asserts that the key set is unchanged
and that only `defaultMode` differs.

### Reading and writing safely

Both files are read with the hardening caveman's `hooks/caveman-config.js` applies to its
flag file, for the same reason: a predictable path under a config directory is a place a
local attacker can plant a symlink, and every reader here injects what it reads into model
context.

- `lstat` first; a symlink or a non-regular file is refused outright.
- A size cap before the read (4 KiB for `state.json`, 64 KiB for caveman's config).
- A value whitelist. `caveman` must be one of caveman's own `VALID_MODES`; `ste` must be a
  boolean. A bad value falls back per field, so one bad field does not discard the other.
- Writes go through a temp file opened `O_EXCL|O_NOFOLLOW` at `0600`, then `rename`.
- A parent directory that is itself a symlink is resolved and its ownership checked, so a
  legitimately symlinked `~/.config` still works while an attacker-planted one does not.
- **Two levels, not one.** caveman's `safeWriteFlag` checks only the immediate parent of the
  file it writes. `resolveWritableDir` checks the config directory (`~/.config/ste`,
  `~/.config/caveman`) *and* its own parent (`~/.config`), because a symlink one level up is
  the same attack with one more step. The parent is validated **before** the leaf directory
  is created, so a refusal never leaves an empty directory behind in a foreign-owned tree. A
  test builds exactly that case against a root-owned temp directory.

## The two linters, and why they are not here

Upstream SimpleEnglish ships two advisory linters through one script,
`src/hooks/lint_hook.py`:

- **`PostToolUse` on `Write|Edit`** — lints the `.md` file the model just wrote, prints a
  violation count to stderr, exits 2 (advisory, never blocking).
- **`Stop`** — checks the reply that just ended for sentence count, openers and closers,
  emits a `systemMessage`, always exits 0.

**Neither is vendored. This is a deliberate decision, not an oversight.**

**Against shipping them.** They add a second language runtime: the rest of this plugin is
Node with no dependencies, and `lint_hook.py` needs `python3` plus a second vendored file
(`evals/ste_lint.py`, 208 lines of regex rules) that exists only to serve it. They also
lint against *unconditional* STE, which is exactly the assumption this plugin exists to
break — under the precedence rule an ordinary turn is supposed to be caveman-compressed, so
the `Stop` linter would report a violation on almost every ordinary turn and train the user
to ignore it. The `PostToolUse` linter fires on every `Write` and `Edit` of a `.md` file,
which in a documentation-heavy session is most tool calls, and a plugin whose neighbour
exists to cut token overhead should not add a per-edit process spawn.

**For shipping them.** Advisory feedback is the only thing in the upstream design that
*checks* the output rather than instructing the model. Without it, nothing in this plugin
verifies that a reply actually followed the rules; the model's compliance is taken on
trust. For a user who writes documentation all day and keeps caveman off, the `PostToolUse`
linter is the most valuable part of upstream.

**To add them later**, in order:

1. Vendor two files from the same pinned commit: `src/hooks/lint_hook.py` →
   `hooks/lint_hook.py`, and `evals/ste_lint.py` → `hooks/ste_lint.py`. Fix the
   `sys.path.insert` in `lint_hook.py` that reaches for `evals/`; keep both hashes in
   `UPSTREAM.md`.
2. Gate both on state. The script must read `state.json` through `hooks/ste-config.js`'s
   rules (or a Python port of them) and exit 0 immediately when `ste` is false — otherwise
   `/ste off` stops meaning off.
3. Gate the `Stop` linter on `caveman` being `off` as well, for the reason above.
4. Add to `hooks/hooks.json`:

   ```json
   "PostToolUse": [
     { "matcher": "Write|Edit",
       "hooks": [{ "type": "command",
                   "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/lint_hook.py\"",
                   "timeout": 10,
                   "statusMessage": "ste: checking the file" }] }
   ],
   "Stop": [
     { "hooks": [{ "type": "command",
                   "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/lint_hook.py\"",
                   "timeout": 10 }] }
   ]
   ```

5. Budget the cost honestly before enabling: one `python3` process per `Write`/`Edit` of a
   `.md` file, and one per assistant turn. A bare `python3 -c pass` is typically
   20–30 ms of startup, so the visible cost is that much added latency per event,
   plus whatever the regex pass costs on the file. Nothing is added to the model's context
   by the `PostToolUse` path (stderr), but the `Stop` path's `systemMessage` is context.
6. Add tests. `tests/` currently covers only Node; a Python linter needs its own runner,
   and this repo's other plugin (`limit-guard`) uses `unittest` for exactly that.

## Layout

```
plugins/ste/
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json               SessionStart + UserPromptSubmit
│   ├── ste-config.js            state.json and caveman config.json, hardened
│   ├── ste-activate.js          SessionStart: ruleset + the bridge block
│   └── ste-mode-tracker.js      UserPromptSubmit: /ste, caveman mirroring
├── skills/
│   ├── ste/SKILL.md             makes /ste resolve as a command
│   └── simple-english/          VENDORED (MIT), one frontmatter patch
├── prompts/system-prompt.md     VENDORED, unmodified (MIT)
├── vendor/LICENSE.SimpleEnglish-MIT
├── tests/                       node:test, no dependencies
└── UPSTREAM.md                  pin, hashes, exclusions, security review
```

## Tests

```
cd plugins/ste && node --test
```

61 tests, no dependencies, no network. Every test runs against a throwaway
`XDG_CONFIG_HOME` under the OS temp directory and asserts that the resolved paths are
inside it, so no test can touch a real `~/.config/ste` or `~/.config/caveman`. Each sandbox
is removed when the test process exits, so a run leaves no `ste-test-*` directories behind.

## Verified behavior

Claims checked against the Claude Code docs, against the vendored upstream files, or pinned
by the test suite. Harnesses change: re-check [hooks.md] before you trust a claim on a newer
version.

**`SessionStart` output shape.** [hooks.md] states: "For most events, Claude Code writes
stdout to the debug log and doesn't show it in the transcript. The exceptions are
`UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, and `PostModelSwitch`, where
Claude Code adds plain-text stdout as context that Claude can see and act on." So the
**plain stdout** this plugin's `SessionStart` hook writes is a documented shape, and it
matches upstream SimpleEnglish's shipping behaviour
(`src/hooks/simple-english-activate.js:61-68`).

**`UserPromptSubmit` output shape.** This plugin emits
`{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "..."}}`,
matching caveman's shipping `hooks/caveman-mode-tracker.js:124-127`. [hooks.md] documents
`additionalContext` as a `UserPromptSubmit` output field, and documents `hookSpecificOutput`
carrying `hookEventName` plus that event's fields as the JSON wrapper. Plain stdout would
also work for this event, per the quote above; the JSON form is kept because it is explicit
about which event the context belongs to and because it matches caveman byte for byte.

**Cross-plugin hook ordering is irrelevant here, by construction.** [hooks.md] is silent on
the execution order of hooks contributed by different plugins for the same event, and silent
on whether their outputs are concatenated or one overrides another. That is not a risk for
the persistence path, and the reason is structural rather than lucky: this plugin writes
caveman's `config.json` during a `UserPromptSubmit` turn, and caveman reads it at *its own*
`SessionStart` in a later session. Different events, different sessions, no shared instant
in which order could matter. What ordering could still affect is the *concatenated context*:
if two `SessionStart` outputs were ever truncated under a combined cap, whichever ran last
could be the one cut. That is why the bridge block is at the end of a payload capped at
9,500 characters and phrased as a standing conditional, and it stays **UNVERIFIED**.

**The 9,500-character cap.** [hooks.md] documents no stdout cap for hooks. The number is
upstream SimpleEnglish's, with the comment "Claude Code caps hook stdout at 10,000
characters. Anything above that is written to a file and replaced by a preview, which
defeats the hook." Copied, not verified independently. The `SessionStart` payload with the
vendored prompt and the bridge block measures **6,307 characters with caveman on**
(`caveman: full`) and 5,848 with caveman off; the longest mode label, `wenyan-ultra`,
reaches 6,315. Budget with the largest number, 6,315: that leaves about 3,200 characters of
headroom under the 9,500 cap. A test asserts the payload stays under the cap for every state
combination.

**`timeout` and `statusMessage` are documented hook fields.** [hooks.md] documents `timeout`
in seconds (default 600 for a `command` hook) and `statusMessage` as a custom spinner
message. This plugin sets `timeout: 5` for both hooks; each is one Node process doing at
most two small file reads.

**caveman parity.** The mode whitelist, the resolution order (`CAVEMAN_DEFAULT_MODE`, then
`config.json`, then `full`), and all six prompt patterns were copied from caveman at
`ef6050c5e184` and are covered by tests. A test asserts the whitelist is byte-for-byte
caveman's list, so a caveman pin bump that adds a mode fails here loudly rather than
silently disagreeing.

**Test suite.** `node --test` from `plugins/ste/`, about two seconds. Covers the state
hardening (symlink refusal on read and on write, a symlinked parent directory accepted when
this user owns it and refused when another user does, size cap, per-field fallback,
malformed JSON, a directory in place of the file), the four state combinations for
`SessionStart`, every `/ste` and `/caveman` prompt form including case, spacing and
junk-tail variants, `/caveman-stats` leaving the mode alone, the persistence threshold
(which phrasings write caveman's `defaultMode` and which are session-only, asserted
byte-for-byte on both files), the `ste: false` gate, the "default is off" hint, the caveman
config merge, and end-to-end runs of the real hook processes.

**`node --test <directory>` does not work on Node 24.** Passing a directory path
(`node --test plugins/ste/tests/`) makes Node try to load the directory as a module and
fail. Use `node --test` from the plugin directory (auto-discovery), or
`node --test plugins/ste/tests/*.test.js` from the repository root.

**No egress, zero hits.**

```
grep -rnE 'curl|wget|fetch\(|https?://|requests\.|urllib|net\.|http\.|child_process|execFile|spawn|socket' hooks/
```

returns nothing (exit 1). The three hook files import `node:fs`, `node:path` and `node:os`
and nothing else: no network client, no hardcoded URL, no child process, no shell. The only
`execFileSync` in the plugin is in `tests/`, where it runs the plugin's own hooks against a
sandbox directory.

## Limitations

- **A persisted `off` makes caveman's own bare commands no-ops.** This is the price of
  remembering the setting, and it is upstream behaviour, not a bug here. While
  `defaultMode` is `off`, caveman's tracker resolves the default for a bare `/caveman` or
  "activate caveman", gets `off`, and writes no flag — so those two forms do nothing, in
  caveman, silently. `/caveman full|lite|ultra|wenyan-*` works normally and clears the
  condition. This plugin cannot fix caveman's tracker, so it explains it instead: see "When
  caveman's default is off". Design decision: persisting `off` is required —
  caveman should stay off across sessions unless asked for by name — and `off` is in
  caveman's own `VALID_MODES` for exactly this purpose.
- **`/caveman-commit`, `/caveman-review` and `/caveman-compress` are not tracked.** caveman
  keeps those one-shot modes in its session flag only, so this plugin never records them and
  `/ste status` cannot report them. During one of those turns `/ste status` will name
  whatever standing mode it last recorded. Persisting them is the wrong fix — it would make
  a one-shot behaviour the default style of every later session. Every effect here is text injected into
  context. Nothing checks that a reply obeyed the rules — that is what the upstream linters
  did, and they are not vendored (see above).
- **The bridge only knows about caveman mode changes it sees.** It records the mode when a
  caveman command passes through its own `UserPromptSubmit` hook. A mode set before this
  plugin was installed, set through `CAVEMAN_DEFAULT_MODE` in the environment, or set by
  hand-editing caveman's config, is not observed, so `/ste status` can report `caveman: off`
  while caveman is in fact compressing. Running any `/caveman <mode>` command resynchronises
  the two.
- **caveman's own per-turn reinforcement still fires.** With both plugins on, a turn carries
  caveman's line and this plugin's line. That is two short strings, deliberately: caveman
  cannot state the precedence rule, and this plugin should not restate caveman's rules.
- **No statusline badge.** A plugin cannot set Claude Code's single `statusLine` key — only
  `subagentStatusLine` — so composing a `[CAVEMAN:FULL]` badge with an `[STE]` badge is a
  general problem for any two statusline-producing plugins. It is a separate piece of work
  and deliberately not solved here.
- **Running the marketplace-installed `caveman@caveman` alongside the vendored caveman is
  unsupported.** [`../caveman/README.md`](../caveman/README.md) (see "Name clash") requires
  uninstalling `caveman@caveman` and removing the upstream marketplace before enabling
  `caveman@skill-bazaar`. With both enabled, caveman's hooks run twice — the same ruleset
  injected twice and the same reinforcement string every turn. This plugin's writes stay
  atomic, but the configuration is not one to run or to report bugs against.
- **The `Write`/`Edit` linting path is absent**, so `.md` files this plugin's ruleset
  produces are never machine-checked.
- **Symlink checking stops two levels up.** `resolveWritableDir` validates the config
  directory and its parent (`~/.config`), one level deeper than caveman's `safeWriteFlag`,
  which checks the immediate parent only. Neither walks the whole path to the root, so a
  symlink planted at `~` itself is out of scope for both. That is a deliberate stopping
  point: an attacker who can replace a user's home directory has already won.

## Open questions

None of these blocks use.

1. **Hook-output concatenation under a combined cap.** If two plugins' `SessionStart`
   outputs are ever truncated together rather than concatenated whole, the bridge block —
   last in this plugin's payload — is the part that would be cut. Unverified either way; see
   Verified behavior.
2. **Whether a session-only deactivation should still be remembered somewhere.** Today
   "normal mode" and a `stop caveman` buried in a longer sentence write nothing at all, so
   the next session starts in the persisted mode as if they had never happened — which is
   what caveman does, and what makes the two agree. A third state ("off for this session
   only, recorded") would need a session-scoped file this plugin does not have.
3. **Whether the bridge should read caveman's real state instead of its own record.**
   Reading caveman's `config.json` at `SessionStart` would fix the desynchronisation in
   Limitations, at the cost of the "STE on, caveman off" default meaning something different
   on a machine that already has caveman configured. The current answer follows the design
   decision: the state file is the record, and a caveman command resynchronises it.
4. **A fourth copy of Auto-Clarity-adjacent text.** caveman already carries the same rule in
   three places that drift (its `SKILL.md`, its activate fallback, its per-turn paraphrase).
   The bridge block adds a fourth. A shared source of truth would fix all four; nothing here
   attempts it.
5. **Whether the linters should come back, gated.** The decision above is a decision, not a
   verdict. If someone measures the per-edit latency and finds it negligible, step 2's
   state gate is the design that makes them safe to add.
6. **The composite statusline hand-off.** A statusline that shows an `[STE]` badge needs a
   source for the state. This plugin keeps it in `$XDG_CONFIG_HOME/ste/state.json`.
   Whichever lands that badge should read the state file, or this plugin should also write
   a small flag file; not decided.

## Licensing

The bridge is MIT, matching this repository. `skills/simple-english/` and
`prompts/system-prompt.md` are vendored from `AminBlg/SimpleEnglish` under MIT
(Copyright (c) 2026 AminBlg), with one frontmatter patch. Pin, per-file hashes, the patch,
exclusions and the security review are in [UPSTREAM.md](UPSTREAM.md).

## References

- [hooks.md]: https://code.claude.com/docs/en/hooks
- Upstream ruleset: https://github.com/AminBlg/SimpleEnglish
- ASD-STE100: https://asd-ste100.org

[hooks.md]: https://code.claude.com/docs/en/hooks
