---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Cluster D spec: decision-board-agent-status, decision-board-wake-modes

Plugin root: `plugins/decision-board/` (below, paths are relative to it). `S` = `skills/decision-board/scripts/board.mjs`,
`PAGE` = `skills/decision-board/assets/board.html`, `SKILL` = `skills/decision-board/SKILL.md`,
`REF` = `skills/decision-board/references`.

This spec is final: every operator question of this cluster is answered (see "Calls made", "operator answer"),
and no step carries an open marker. Cluster D lands last, after A, B, C1 and C2. It sets
`.claude-plugin/plugin.json` `version` from `0.8.0` to `0.9.0` (step D-13).

Preconditions for the whole spec: clusters A, B, C1 and C2 landed exactly as the final `decision-board-spec-a-core.md`, `decision-board-spec-b-config.md`,
`decision-board-spec-c1-fields-groups.md` and `decision-board-spec-c2-controls.md` say, step D-0 (the name check, section "Steps") passed, and every test
under `tests/` exits 0. "Tests green" = from the plugin root,
`for t in tests/*-test.js tests/*-test.mjs; do node "$t" > /dev/null || echo FAIL "$t"; done` prints nothing.

Names of cluster A this spec uses (final decision-board-spec-a-core.md):
- one `cards/main` document, card key = card id, no `--agent`; `export const FLAGS` with one line per command (a
  command with no line fails with `<cmd>: no FLAGS line for this command in board.mjs`; an unknown flag with
  `<cmd>: unknown flag --<key>`); `export const COMMANDS`; board-test "no command takes --agent" and "every command
  has one FLAGS line" iterate `COMMANDS`, so the new commands `status` and `watch` are covered without a test edit;
- `Run`: `new Run(a)` everywhere (no `o.write`), `new Run(a, { create: true })` in `check`; the older-state refusal
  reads only old markers and keeps every other key (`this.st = plain(saved)`), so the new state key `url` passes;
- `r.pinned(op, collection, id, data, dumped, also)` pins to `r.st.next[<collection>/<id>]`, else creates;
  ArtifactData refuses a write to an existing document without `if_version` (A Call 29), so every write of
  `meta/status` goes through `r.pinned` with the state key `meta/status`, like `meta/config`;
- `finish()` has no `meta` exception in the out-file cleanup: older out files of `meta/status` go;
- every printed array is followed by `if refused: rm -rf <dump>, then <calls>, then node <SELF> adopt <group> --dump <dump> --dumped<st>`
  and `if the reply is lost: node <SELF> push <group><st>`; the group `meta/config` gives `<calls>` =
  `P2 meta with versions`; `adopt <collection>/<id>` (the generic path that `meta/config` takes) pins the write
  again to the dumped version;
- batches with `status` `"sent"`/`"handled"` and `handled_at`; `read --dump <dir> [--all] --dumped`;
  `const waiting = (dump) => ...`; `cmdWaiting(a, log)` prints the ids one per line or `none`; `ack` writes
  `r.put("update", "batches", bid, { status: "handled", handled_at: t }, 1, "batches/" + bid)`; its "already
  handled" branch prints `ack <bid>: already handled` and runs `r.finish(log)`;
- script time: `nowMs()` (honours `BOARD_NOW`), `now()` = `P.stampIn(nowMs(), P.cfg.tz, false)`; page pure part:
  `stampIn(ms, tz, withMs)`, `stampMs(v)` (`-Infinity` when unreadable), `fmtTime(v, tz)`, SCHEMA type `d`;
  outside the pure part the page reads the clock only through `clockMs()`, `nowStamp()`, `idStamp()`, `savedTime()`
  (A's cuts-test "page times come only from the time section and the clock helpers" bans `Date.now(` and
  `new Date(` elsewhere, by pattern);
- `SKILL` (A 6.1 as B and C2 changed it) is at most 8000 characters (board-test "SKILL.md stays short") and names
  `artifact-capabilities` once, in `P1` (board-test "artifact-capabilities is named once, in P1"); D never names it;
  build text is in `REF/build.md`; the SKILL "Watch for answers" section holds `poll limit 30`, asserted by one
  separate `assert` inside board-test "the watch brief makes one database call per poll" (not in cuts-test);
- `REF/watch.md` (A 6.2) holds the watch brief in a ```text block; `assets/wait.sh` ends with `echo "wait ended"`;
- tests: `cmd(b, ...argv)`, `ok2(b, ...argv)` (`--dump <fresh dump> --dumped`), `dumpNow(b)`, `putDoc`, `cfgOf`;
  every config a test writes sets `tz`; no test pins an exact count, an exact full key list or a key position.

Names of cluster B (final decision-board-spec-b-config.md): `export const CONFIG_KEYS = Object.keys(P.DEFAULTS).filter((k) => !WRITTEN_KEYS.includes(k)).concat(SCRIPT_KEYS);`
(a key D adds to `DEFAULTS` is known to `check` and the merge with no edit); object keys deep-merge across layers;
`r.load.config` is the merged raw config; `Run.needConfig()`; the module helper `rel(file)`; B's `check` problem
order (merge, entries kept, unknown fields, `config tz`, then the later clusters' problems); its `config default:`
lines are computed from `CONFIG_KEYS`; `checkFields()` is derived from `SCHEMA.item`; the page footer
`#foot` holds `#zone` then `#settings`; `tests/skill-text-test.js` takes the text cases of later clusters;
SKILL gained the "Operator rules" section and the `rules:` / `[rule]` lines.

Names of cluster C1 (final decision-board-spec-c1-fields-groups.md): `<section id="due" class="due" hidden aria-label="Due today"></section>`
directly before `<section id="blocked" ...>` inside `<div class="in">`; in `render()` the call
`renderDue(dueList(list, today), today);` directly before `renderBlocked(...)`; C1's minute timer; `cardState(it)`.

Names of cluster C2 (final decision-board-spec-c2-controls.md): `ack` with `k1`, `j` (`r.openCards`), `k2`, `k = k1 + k2`, the cards
write when `k + j > 0`, and the printed line
`` `ack ${bid}: handled, ${k} cards closed, ${j} reopened. The answers go to decisions.md when the next read no longer lists the batch` ``;
its USAGE line `  ack <batch id> [--close <id>...] --dump <dir>   mark a batch handled, apply its controls, and close cards`;
`FLAGS.ack` = `["state", "dump", "close"]`; `function ctlHint(c, e, flags)` with the two hints that end
`say what you did in your reply)` and `if you cannot, leave the card and say why in your reply)`; the `check`
`controls` problems directly after C1's `config week_start` problem; `saveControls(id, patch)`; `cardState(it)`
returns `"hidden"`, `"done"`, `"snoozed"` or `"active"`; `send()` sends when `s.r.length + s.n.length + s.c.length`;
`sync` computes `back` and `doc.rev = old ? old.rev + (content || back ? 1 : 0) : 1;`; SKILL step 3 holds
`` (several: in the order `read` printed them)`` and step 2 the `control` bullet; plugin version `0.8.0`.

None of these names exists in the repository today; step D-0 proves they landed before any other step runs. Where
this spec quotes a line that A, B, C1 or C2 already changed, keep their text and apply only the change named here.

SKILL size: D adds about 670 characters to `SKILL` (6 of item 1 and 6 of item 2): from C2's "about 7144" to about
7814, under the 8000 limit. A later edit adds about 90 to the "Say what you do" section and takes 306 out of
A's step 2 ("Read and handle the answers"): about 7598. The `watch --restart` sentence adds 77: about 7675. Step D-12 measures the real file; if it is over 8000 it applies the fallback named there
(move the "Guides" steps to `REF/guides.md`), never a higher limit.

## Who runs what

- Implementer and reviewer (cheaper model, headless): every step D-0 to D-14. They run only Node tests, the
  validator, `wc` and grep. No step reads, writes, republishes or tests against a board in use under
  `board/`.
- **Checks for the maintainer** (section "Checks for the maintainer", after D-14; not implementer steps): the
  render checks R-1 to R-4 and W-R1, and the session check M-1. They run on a new private test artifact published
  from the changed page with `P1` (with `"comments": {}` in its `capabilities`), never a board in use. Renderer:
  the most efficient one the maintainer has: (1) the built-in browser with `preview_start` on a local static
  server of `PAGE` and the stub database the maintainer uses for A's A10 check, at 360 px and desktop width, light
  and dark; (2) else the private test artifact; (3) else a real phone. Stub additions for D: a `meta/status` doc
  `{now: "Build the report", next: ["Mail the team"], waiting: "", updated: <2 h ago>}`, one card with `result` and
  `result_at`, config `wake: {mode: "both"}`. M-1 needs a live session and a real phone; the PR description lists it
  as open until the maintainer records the outcome.

## Research (cited)

R1. Hooks: no hook ships. The read on a comment wake rests on the SKILL rule
alone (item 2, section 6).

R2. The comments capability. Source: the type definitions `comments.d.ts` and `claude.d.ts` of the built-in
capabilities skill (read in full by the first draft). Findings:
- `openComposer({element} | {range})` opens the shell composer; it takes NO text: the page cannot prefill.
  Works under `{comments: {"composer_only": true}}`. It must come from a deliberate gesture; `opened: false` is a
  soft refusal (page not focused, a composer already open with text).
- `sendToClaude({anchor, text} | {threadId, text})` "Post a comment AND send it to Claude, exactly as the viewer
  pressing 'Send to Claude' ... would". Page text is allowed (plain text, at most 4 KiB). Conditions:
  full declaration `capabilities: {comments: {}}`, editors only (the owner is one), "only from the viewer's own
  recent gesture", consent prompt at the first write, `canSendToClaude()` first (`"available" | "writers_only" |
  "no_session" | "off"`). Rejections: `claude_unavailable` (nothing posted; includes "the call did not come from the
  viewer's own recent gesture"), `consent_required`, `forbidden`, `not_found`, `rate_limited`, `capability_removed`.
- `anchorFor(el)`: "element geometry is read at call time, so call it at the moment of the viewer's gesture".
- Writing "@Claude" in page text does NOT bring Claude in; only `sendToClaude` (or the operator's own "Send to
  Claude" in the composer) does.
- The thread limit warning: "design for deliberate, viewer-initiated threads, not one per element". A returned
  `threadId` is not handed back later, so the page must store it to reply into the same thread.
- The `ArtifactComments` tool (session side, checked against its schema): "this session is woken with a new turn
  when ... a comment on it is sent to Claude; ... Plain comments never wake this session"; `action: "watch"` with
  `url` starts a watch; `action: "resolve"` with `url` and `thread_id` marks a thread resolved, and works only on a
  thread activated for Claude (a thread that `sendToClaude` made is one); "a person can reopen them".
- The `ArtifactData` tool (checked against its schema): "A write to a document that already exists is refused
  without [`if_version`]; omit it only when creating a document." So `meta/status` is pinned like `meta/config`.

## Visible strings

Every text the operator sees that this spec adds. The
implementer uses them verbatim.

| Id | Where | Text |
|---|---|---|
| V1 | strip, no status doc | `No status from the agent yet` |
| V2 | strip, task | `Now: <now>` (empty now cannot happen: `status` refuses it) |
| V3 | strip, idle | `Idle` / `Idle, waiting for: <waiting>` |
| V4 | strip, stale age | `last heard <age>`; the exact time (`fmt(updated)`) is the `title` of the age text (shows on hover) |
| V5 | ages | `just now`, `<m> min ago`, `<h> h ago`, `<d> d ago` |
| V6 | strip body | `Next` (heading), `Waiting for: <waiting>` |
| V7 | card result line | `Result: <result> · <time>` |
| V8 | card dot title | `Changed by the agent since you last marked it seen` |
| V9 | wake line | `Wake: off. Tell the agent to read the board.` / `Wake: a comment on Send` / `Wake: poll every <dur>` / `Wake: a comment on Send, and a poll every <dur>` |
| V10 | wake line, watcher part | `, watcher planned until <time>` / `, watcher window ended <time>` / `, no watcher started` |
| V11 | button | `Wake the agent` |
| V12 | comment text (WAKE_TEXT) | `Read the decision board: answers were sent.` |
| V13 | notices under Send | see `wakeNotice` in item 2 §5 |
| V14 | strip body button | `Mark all seen` (shown only while at least one card shows its dot) |

---

## Item 1: decision-board-agent-status

## 1. Goal

The page shows what the agent does now, what comes next, what it waits for, how fresh that is, how it will be
woken, and per card what the agent did with an answer, without the operator opening the agent session.

## 2. Data model

New document `meta/status` (collection `meta`, doc id `status`). One writer: the script (`status` and `watch`),
run from the operator's session (A's root rule: only the owner writes). The page only reads it. Every write is
`r.pinned("set", "meta", "status", doc)` with the state key `meta/status` (call C3): the first write creates the
document, every later one is pinned to the version the state keeps, and a refused write takes the `if refused:`
line that `finish()` prints (`adopt meta/status`, A's generic path).

| Field | Type (SCHEMA) | Default | Writer | Meaning |
|---|---|---|---|---|
| `now` | `s` | `""` | `status` | One line, at most 60 characters. The literal `idle` means stopped for the operator |
| `next` | `l` | `[]` | `status` | 0 to 3 lines, each at most 60 characters |
| `waiting` | `s` | `""` | `status` | One line, at most 60 characters, or `""` |
| `updated` | `d` | `""` | `status`, `watch` | Stamp of the last write (the "last heard" time) |
| `watch` | `o:watch` | absent | `watch` | `{started, until}` of the last watcher the agent started; `until` is set to the time the watcher hit its poll limit once `watch` learns it (item 2) |

Size rule (call C4): the document as written is at most 500 bytes (`Buffer.byteLength(JSON.stringify(doc))`).
With 60-character ASCII lines, 3 next lines and a watch of two stamps, the maximum is about 460 bytes; multi-byte
text can pass 500, and `status` then refuses (`cmdStatus` below).

No `agent` field: one agent per board (call C1).

New card fields in `SCHEMA.item`, appended after C2's `input`, `source_key` (the position is not a contract):
`result: "s"`, `result_at: "d"`. Writer: `ack --result` only. A card file may not carry them (`sync` refuses).
They are kept through `sync` while the card's `rev` stays, and dropped when `rev` rises, C2's `back` return
included (call C5). B's `checkFields()` picks up `result` by itself (a text field); nothing to change there.

New state key `url` (string, the artifact link; writer `check --url`, item 2). A's older-state refusal keeps it.

SCHEMA changes in `PAGE` (inside "pure"):

```js
// in SCHEMA.item, after C2's source_key:
result: "s", result_at: "d",
// new kinds, after C2's bkeep:
status: { now: "s", next: "l", waiting: "s", updated: "d", watch: "o:watch" },
watch: { started: "d", until: "d" },
wake: { thread: "s", updated: "d" },          // item 2
// new list, after C2's personRe:
wakeModes: ["poll", "comment", "both", "off"], // item 2
// in SCHEMA.max, appended to its existing keys:
line: 60, result: 200, statusBytes: 500,
```

Per-viewer browser storage (localStorage, page only, never the database): key `decision-board-cards-seen-v1`,
value `{"<card id>": "<card updated>"}`. It is set for every card at the first visit (the baseline, so a first visit
shows no dot), for every card on a `Mark all seen` tap, and for one card when the operator answers it or changes a
control on it. Nothing else clears a dot.

## 3. Config

New key `status` (object). `DEFAULTS.status = { stale_minutes: 30, guide: false }` in `PAGE`, appended after the
last key C2 left (`people`); the position is not a contract. Nothing to add to `CONFIG_KEYS` (B derives it from
`DEFAULTS`), and B's computed `config default:` lines take it by themselves.

| Key | Type | Default | Validation (`check` problem text, after the `problem: ` prefix) |
|---|---|---|---|
| `status.stale_minutes` | integer | 30 | 1 to 1440, else `config status.stale_minutes: a whole number from 1 to 1440` |
| `status.guide` | boolean | `false` | `true` or `false`, else `config status.guide: true or false` |

Other problems: `config status: not an object`; `config status: unknown field "<k>"` (text through `q(k)`).
The page falls back to the default on any invalid value. `status.guide` turns on the status guide: only when
it is `true` do `ack` and `guide --archive`/`--delete` print the `status guide:` line (section 4).

`normConfig` (PAGE), before `return out` (after C2's `people` line):
`var st = g("status"); out.status = { stale_minutes: intIn(isObj(st) ? st.stale_minutes : undefined, 1, 1440, 30), guide: isObj(st) && st.guide === true };`

New helper in the pure part of `PAGE`, in the `// ---- board config` section directly before `function normConfig`
(used by page and script):

`function intIn(v, lo, hi, def) { return Number.isInteger(v) && v >= lo && v <= hi ? v : def; }`

New function in `S`, module level, directly before `function cmdCheck`:

```js
// The problems of config "status", on the merged config.
function statusProblems(raw) {
  const v = raw.status, out = [];
  if (v === undefined) return out;
  if (!P.isObj(v)) return ["config status: not an object"];
  for (const k of Object.keys(v)) if (k !== "stale_minutes" && k !== "guide") out.push("config status: unknown field " + q(k));
  if (v.stale_minutes !== undefined && P.intIn(v.stale_minutes, 1, 1440, null) === null)
    out.push("config status.stale_minutes: a whole number from 1 to 1440");
  if (v.guide !== undefined && typeof v.guide !== "boolean") out.push("config status.guide: true or false");
  return out;
}
```

In `cmdCheck`, push `...statusProblems(raw)` into `errs` directly after C2's `controls` problems (the block that
starts `if (raw.controls !== undefined) {`), where `raw` is the merged config that B's "entries kept" loop reads.
The same step (D-3) adds `...wakeProblems(raw)` directly after it (item 2, section 3).

## 4. Script (`S`)

### New command `status`

Usage line, added to A's `USAGE` directly after the `ack` line:
`  status [--now <text>] [--next <text>...] [--waiting <text>] [--idle]   say what you do; one write of meta/status`

`FLAGS` (A 1.4 step 1, one new line): `status: ["state", "now", "next", "waiting", "idle"],`. Add `status: cmdStatus`
to `COMMANDS`. Add `"idle"` to `SWITCHES`. `parseArgs` facts the implementer relies on: `--next` with no value
gives `a.next = []` (= clear next); a value that starts with `--` is read as a flag, so a line cannot start with
`--` (a limit of `parseArgs`; the SKILL "Say what you do" sentence states it).

New module-level helpers in `S`, directly before `function cmdStatus` (place both after `function cmdCheck`):

```js
const has = (a, k) => Object.hasOwn(a, k);
// The stored status in the state, coerced; a fresh one when absent.
function storedStatus(r) {
  const x = isPlain(r.st.status) ? P.coerce("status", r.st.status) : {};
  return { now: x.now || "", next: x.next || [], waiting: x.waiting || "", updated: x.updated || "", watch: P.isObj(x.watch) ? x.watch : undefined };
}
function statusDoc(s) { return Object.assign({ now: s.now, next: s.next, waiting: s.waiting, updated: s.updated }, s.watch ? { watch: { started: s.watch.started, until: s.watch.until } } : {}); }
// The one write of meta/status, pinned like meta/config (ArtifactData refuses an unpinned write of an existing document).
function putStatus(r, s) {
  r.st.status = statusDoc(s);
  r.pinned("set", "meta", "status", statusDoc(s));
}
// Text the agent typed on a command line. Line breaks
// and runs of white space become one space, a double quote becomes ', $ and backtick are dropped, and a text over
// max characters is cut to max - 3 characters plus "...". The caller refuses only an empty result.
function cleanText(v, max) {
  const s = String(v).replace(/"/g, "'").replace(/[$`]/g, "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}
```

If the name `has` is already taken in `S` after A to C2 (`grep -n "const has = \|function has(" SCRIPT`), use that
helper when it has the same meaning, else name this one `hasKey` and use it in every place this spec writes `has`.

`r.st.status` is a new state key (A's older-state refusal keeps it). `putStatus` gives the write the group
`meta/status`; its `if refused:` line needs the `<calls>` text `P2 meta with versions` (step D-4 makes A's group
mapping give it for `meta/status` as for `meta/config`).

`cmdStatus(a, log)`, in this order:

```js
function cmdStatus(a, log) {
  const r = new Run(a); r.needConfig();
  if (!["now", "next", "waiting", "idle"].some((k) => has(a, k))) fail("status: give --now, --next, --waiting or --idle");
  const errs = [], s = storedStatus(r);
  let nowText = has(a, "now") ? cleanText(one(a, "now"), S.max.line) : null;
  if (nowText !== null && !nowText) errs.push("status --now: empty text");
  if (nowText !== null && lower(nowText) === "idle") nowText = "idle";      // --now idle is the same as --idle
  if (has(a, "idle") && nowText !== null && nowText !== "idle") errs.push("status: --idle and --now together; give one");
  if (has(a, "idle")) nowText = "idle";
  if (nowText) {
    if (nowText !== "idle") s.waiting = "";                                  // call C6: a new task ends the old wait, first
    s.now = nowText;
  }
  if (has(a, "next")) {
    const raw = a.next.map((x) => cleanText(x, S.max.line));
    if (raw.some((x) => !x)) errs.push("status --next: an empty line");
    s.next = raw.filter(Boolean);
  }
  if (has(a, "waiting")) s.waiting = cleanText(one(a, "waiting"), S.max.line);   // after the clear above, so it wins
  if (s.next.length > 3) errs.push("status --next: at most 3 lines");
  s.updated = now();
  const bytes = Buffer.byteLength(JSON.stringify(statusDoc(Object.assign({}, s, { watch: { started: s.updated, until: s.updated } }))));
  if (!errs.length && bytes > S.max.statusBytes) errs.push(`status: ${bytes} bytes with a watcher, over ${S.max.statusBytes}; shorten the lines`);
  if (errs.length) fail(errs.join("\n"));
  putStatus(r, s);
  log(`status: now ${q(s.now)}, next ${JSON.stringify(s.next)}, waiting ${q(s.waiting)}`);   // what was stored, after cleanText
  r.finish(log);
}
```

Notes: `--waiting ""` (or `--waiting` with no value) sets `waiting` to `""`. `--next` alone with no `--now` keeps
`now` and `waiting`. The size check counts a watch even when none is stored, so a later `watch` cannot push the
document over 500 bytes. `push meta/status` works through A's pending key (`pending["meta/status"]`), and
`adopt meta/status --dump <dir> --dumped` through A's generic `<collection>/<id>` path (a dump of `meta` with
versions): "the board holds the last write", or "write again, pinned to version N". No `adopt` change.

`USAGE`: in A's `adopt` and `push` lines, the key list `[cards | guides/<id> | meta/config | batches/<id> | purge/<stamp>]`
becomes `[cards | guides/<id> | meta/config | meta/status | batches/<id> | purge/<stamp>]`.

### Changed command `ack`: `--result <card id> <text>`

`USAGE`: C2's ack line becomes
`  ack <batch id> [--close <id>...] [--result <id> <text>]... --dump <dir>   mark a batch handled, apply its controls, close cards, store result lines`.
`FLAGS`: C2's `ack: ["state", "dump", "close"],` becomes `ack: ["state", "dump", "close", "result"],`.

`a.result` is the flat list of all values after every `--result` (parseArgs appends). Place, in `cmdAck` as A and
C2 left it: right after the "no batch in the dump" failure and BEFORE the `status handled` ("already handled")
branch:

```js
const res = a.result || [], t = now(), pairs = [];
if (res.length % 2) fail("ack --result: give a card id and one text per --result");
for (let i = 0; i < res.length; i += 2) pairs.push([res[i], cleanText(res[i + 1], S.max.result)]);
r.needCards(pairs.map((p) => p[0]), "ack");
const rerr = [], seenIds = new Set();
for (const [id, text] of pairs) {
  if (seenIds.has(id)) rerr.push(`ack --result: card ${qid(id)} twice`); seenIds.add(id);
  if (!text) rerr.push(`ack --result ${qid(id)}: empty text`);
}
if (rerr.length) fail(rerr.join("\n"));
const setResults = () => { for (const [id, text] of pairs) { const c = r.card(id); c.result = text; c.result_at = t; c.updated = t; } return pairs.length; };
// What was stored, after cleanText, one line per result (printed after the ack line in both branches).
const resultLines = () => pairs.map(([id, text]) => `  result ${qid(id)}: ${q(text)}`);
```

Then:
- In the "already handled" branch (a rerun after a lost reply): when `pairs.length`, call `const m = setResults();`
  `r.putCards();` and print `ack <bid>: already handled, <m> results stored` instead of `ack <bid>: already handled`,
  then `for (const l of resultLines()) log(l);`; then `r.finish(log)` as A has it. With no pairs the branch is unchanged.
- In the handled-write branch (A's `put` of the batch update, then C2's steps 4 to 8): use the one `t` above for
  `handled_at`, `k1`, `j` and `k2` (delete the `const t = now()` that A and C2 use there; `t` is already declared).
  Keep C2's `k1`, `j`, `k2` and `k = k1 + k2` unchanged; add `const m = setResults();` directly after the line that
  sets `k2`. The cards write goes out, in the same `also = "batches/" + bid` group, when `k + j + m > 0` (C2 wrote
  `k + j > 0`). C2's printed line becomes
  `` `ack ${bid}: handled, ${k} cards closed, ${j} reopened, ${m} results. The answers go to decisions.md when the next read no longer lists the batch` ``.
- Directly after that printed line (handled-write branch): `for (const l of resultLines()) log(l);`. Then, when
  `P.cfg.status.guide` is `true`, print `statusGuideLine(r, a, "Add what you did with this batch")` (below).
- `ack` never touches `board/watch.json`.
- A failure (odd count, unknown card, twice, empty after `cleanText`) writes nothing, in either branch. A line
  break, a text over 200 characters, a `"`, `$` or backtick is cleaned, not refused (`cleanText`), so a result text
  never fails the ack and the batch never stays `sent` for its wording (no wake loop).

New module-level helper in `S`, directly after `cmdAck`:

```js
// The status guide line of ack and guide.
function statusGuideLine(r, a, what) {
  const f = rel(path.join(r.dir, "status.md")), st = a.state ? " --state " + q(one(a, "state")) : "";
  return `status guide: on in the config. ${what} in ${f}, dump guides with versions, then run node ${SELF} guide ${f} --id status --kind status --dump ${one(a, "dump") || "board/dump"}${st} and pass its array`;
}
```

`cmdGuide`: directly before its `r.finish(log)`, add
`if (P.cfg.status.guide && (a.archive || a.delete) && id !== "status") log(statusGuideLine(r, a, `Say under "Done" that ${id} is done`));`
(`id` is the name `cmdGuide` gives the `--id` after A's `guideId`; use A's name if it differs).

### Changed command `sync`

- `MANAGED` becomes A's list plus `"result", "result_at"`: `["rev", "created", "updated", "result", "result_at"]`
  (if an earlier cluster added a name to `MANAGED`, keep it and append the two).
- In the `cards.forEach(({ c }, i) => { ... cardProblems(...) ... })` line that checks the file cards (not in
  `cardProblems` itself, because `check` runs it on state cards that hold results), before the `cardProblems` push:
  `if (P.isObj(c) && (has(c, "result") || has(c, "result_at"))) errs.push(`${typeof c.id === "string" && c.id ? c.id : "#" + (i + 1)}: result: set only by ack --result`);`
- Before the loop that builds `doc`: `let dropped = 0;`. In that loop, directly after the line
  `doc.rev = old ? old.rev + (content || back ? 1 : 0) : 1;` (C2's form), add:
  `if (old && ex.result) { if (doc.rev === old.rev) { doc.result = ex.result; doc.result_at = ex.result_at; } else dropped++; }`
  The `n.same` path (`continue` before `doc.rev`) keeps `ex` as is, so its result stays.
- The `sync:` summary line: append `+ (dropped ? `, ${dropped} results dropped (rev up)` : "")` at the end of its
  expression (after the `reopened` part).
- `sync` never touches `board/watch.json`.

`check` needs no card change (`result` and `result_at` are `MANAGED`, which `check` validates by type).

## 5. Page (`PAGE`)

### Pure functions (between "pure: start" and "pure: end", in a new section `// ---- agent status` placed directly before `// ---- visibility`, after C2's `// ---- quick controls`), node-tested

- `function ageText(stamp, nowMs)`: `t = stampMs(stamp)`; `t === -Infinity` -> `""`; `m = Math.floor((nowMs - t) / 60000)`;
  `m < 1` (a future stamp included) -> `"just now"`; `m < 60` -> `m + " min ago"`; `m < 48 * 60` ->
  `Math.floor(m / 60) + " h ago"`; else `Math.floor(m / 1440) + " d ago"`.
- `function statusView(st, nowMs, fmtTime)` (reads `cfg`; `fmtTime` is a one-argument formatter, the page passes
  `fmt`): `st` is a coerced status or `null`. Returns `{ has, idle, head, age, when, stale, next, waiting, wake }`:
  - `when = has ? fmtTime(st.updated) : ""` (the exact time, the `title` of the age text; operator answer: the
    exact time shows on hover).
  - `t = st ? stampMs(st.updated) : -Infinity`; `has = t !== -Infinity` (an unreadable `updated` counts as no status);
    `idle = has && st.now.toLowerCase() === "idle"`.
  - `head`: not `has` -> V1; `idle` -> `"Idle" + (st.waiting ? ", waiting for: " + st.waiting : "")`;
    else `"Now: " + st.now`.
  - `age = has ? ageText(st.updated, nowMs) : ""`.
  - `stale = has && !idle && (nowMs - t > cfg.status.stale_minutes * 60000 || t - nowMs > 5 * 60000)`
    (a stamp more than 5 minutes ahead is stale too). When `stale`, `age = "last heard " + age`.
  - `next = has ? st.next.slice(0, 3) : []`; `waiting = has && !idle ? st.waiting : ""`.
  - `wake = wakeLine(cfg.wake, has ? st.watch || null : null, nowMs, fmtTime)` (item 2).
- `function cardChanged(it, seenMap)`:
  `seenMap === null` -> `false`; `!own(seenMap, it.id)` -> `true`; `seenMap[it.id] === it.updated` -> `false`;
  else `a = stampMs(seenMap[it.id]), b = stampMs(it.updated)`; `a === -Infinity || b === -Infinity` -> `true`;
  else `a < b`. (Compare instants, never text: stamps carry offsets and change at DST, call C7.)
- `function seenOf(list)`: `var m = Object.create(null); list.forEach(function (it) { m[it.id] = it.updated; }); return m;`
  No id is skipped; `__proto__` is an ordinary key on a null-prototype object.
- `function seenFrom(text)`: parse a stored value: `JSON.parse` in try/catch; a value that is not a plain object -> `null`;
  else a fresh `Object.create(null)` with every own key whose value is a string copied in. Used by the page load.
- `function dotOn(it, seenMap)`: `return cardChanged(it, seenMap) && cardState(it) !== "done" && cardState(it) !== "hidden";`
  (C2 "Needs ... D": an `ack` that closes or reopens a card for a control changes `updated`, so a card in Done or
  Not ours shows no dot. `cardState` is C2's one-parameter function; the tests stub `lingerOf` as C2 says.)

### Render changes (DOM)

1. HTML: insert `<section id="agentnow" class="agentnow" hidden aria-label="Agent status"></section>` inside
   `<div class="in">` directly before C1's `<section id="due" class="due" hidden aria-label="Due today"></section>`. C1's layout
   note calls this strip `#now`; its id is `agentnow` (a class `.now` exists for tags).
2. CSS, appended before the `@media (prefers-reduced-motion ...)` line: `.agentnow` with the same box rules as
   `.blocked`; `.agentnow summary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`;
   `.agentnow.stale { opacity: .6; }`; `.agentnow .age { color: var(--muted); font-size: 13px; }` (use the muted
   colour variable that `.muted` uses); `.result { font-size: 13px; border-left: 3px solid var(--line); padding-left: 8px; }`.
   The card dot reuses the existing `.dot` rule; add no second dot rule.
3. Globals, beside C2's `lingerUntil`: `var agentStatus = null, seenCards = null; var CKEY = "decision-board-cards-seen-v1";`
   and `var nowKey = null;`. At start (before the first `render()`):
   `try { seenCards = seenFrom(localStorage.getItem(CKEY)); } catch (e) { seenCards = null; }`
   (`getItem` returning `null` gives `seenFrom(null)` = `null`: first visit).
   `function saveCardsSeen() { try { localStorage.setItem(CKEY, JSON.stringify(seenCards)); } catch (e) {} }`.
4. Reads: `function applyStatus(d) { var x = d && d.exists ? d.data() : null; agentStatus = isObj(x) ? coerce("status", x) : null; schedule(); }`.
   In `start`, after the `meta/config` listener: `db.doc("meta/status").onSnapshot(applyStatus, function () {});`. In
   `refresh`: A's `Promise.all([db.doc("meta/board").get(), db.doc("meta/config").get()])` becomes
   `Promise.all([db.doc("meta/board").get(), db.doc("meta/config").get(), db.doc("meta/status").get()])`, and the next
   `.then` gains `applyStatus(d[2]);` after `applyConfigDoc(d[1]);`.
5. `function renderNow()`, placed directly before C1's `function renderDue`, with a key cache like `renderBlocked`:
   `var view = statusView(agentStatus, clockMs(), fmt), n = dotCount();` key = `JSON.stringify([view, n])`;
   unchanged key -> return. Build, all text by `textContent` (`h(..., {text})`):
   `details` > `summary` [`span.tt` head, `span.age` age with `title: view.when`] + body: if `next.length`, `h4`
   "Next" and an `ol` of `li` texts; if `waiting`, `div` "Waiting for: " + waiting; `div.small.muted` the wake line;
   when `n > 0`, `h("button", { type: "button", class: "link small", text: "Mark all seen", onclick: markAllSeen })`.
   Toggle class `stale` on the section. Keep `details.open` across rebuilds (read it before `textContent = ""`, set
   it after). The section is `hidden` while `!loaded.config`. `render()` calls `renderNow();` directly before C1's
   `renderDue(dueList(list, today), today);`.
6. Age refresh: `setInterval(renderNow, 60000);` beside C1's minute timer. It rebuilds nothing while the key is
   unchanged; it does not call `render()`.
7. Result line per card: in `buildCard` add `c.result = h("div", { class: "result", hidden: true })`, placed in the
   `c.el` children directly after `c.changed`. In `updateCard`:
   `c.result.textContent = it.result ? "Result: " + it.result + (fmt(it.result_at) ? " · " + fmt(it.result_at) : "") : ""; c.result.hidden = !it.result;`
8. Agent-changed dot: in `buildCard` add `c.dot = h("span", { class: "dot", title: "Changed by the agent since you last marked it seen", hidden: true })`
   as the first child of the tags row (`h("div", { class: "tags" }, c.dot, ...)`). In `updateCard`:
   `c.dot.hidden = !dotOn(it, seenCards);`.
9. Marking seen, outside the pure part, beside `saveCardsSeen`:
   ```js
   // The number of cards that show the agent-changed dot.
   function dotCount() { var n = 0; items.forEach(function (it) { if (dotOn(it, seenCards)) n++; }); return n; }
   // Mark all seen: every card as it is now; also the baseline of a first visit.
   function markAllSeen() { if (loaded.items) { seenCards = seenOf(Array.from(items.values())); saveCardsSeen(); schedule(); } }
   // One card seen: the operator answered it or changed a control on it.
   function seenOne(id) { var it = items.get(id); if (seenCards && it) { seenCards[id] = it.updated; saveCardsSeen(); } }
   ```
   - First visit: in `render()`, directly after C2's `setCtlDay(today);` line:
     `if (seenCards === null && loaded.items) markAllSeen();` (a first visit shows no dot; later changes do).
   - `seenOne(id);` is the first line of `saveResponse(id)` and of C2's `saveControls(id, patch)`.
   - No automatic marking on leaving the page or on scrolling.
10. No new `innerHTML` site: `render-test.js` "HTML reaches the page only at the known places" keeps its list.
11. No `Date.now(` and no `new Date(` in this code: the clock is `clockMs()` (A's cuts-test).

## 6. Agent-facing text

All `SKILL` edits of both items are applied in one step (D-12), on the text that A, B and C2 left. The step-3
text of "Read and handle the answers" is given whole in item 2, section 6 (it carries both items).

`SKILL` — new section directly after "Watch for answers" (exact text, about 320 characters):

```markdown
## Say what you do

When your task changes, run `node S status --now "<task>" --next "<a>" "<b>"` and pass the array; when you
stop for the operator, `node S status --idle --waiting "<what>"`. Plain words, at most 60 characters, never
starting with `--`; the script cleans and cuts the text and prints what it stored.
```

`SKILL` "Guides", the sentence that ends `pass the array, and say so under "Done" in the status guide.` (A's text):
replace `pass the array, and say so under "Done" in the status guide.` by `pass the array.`.

`REF/data-model.md`:
- Collections table (A's 0.1 table as B and C2 left it), row `meta`: append to the Doc id cell `` , `status`, `wake` ``;
  to the Written by cell `` ; `status` and `watch` (status); the page (wake) ``; to the Content cell
  `` ; `status`: what the agent does now and the window of its last watcher; `wake`: the comment thread that Send writes into ``.
- Config table, directly after C2's `people` row (exact):
  `` | `status` | `stale_minutes`: after this many minutes a status that is not `idle` shows grey (1 to 1440). `guide`: `true` turns on the status guide; then `ack` and `guide --archive` print when to update it | `{"stale_minutes": 30, "guide": false}` | ``

`REF/cards.md`:
- in the Fields intro, "The script fills `rev`, `created` and `updated`" -> "The script fills `rev`, `created` and
  `updated`, and `ack --result` fills `result` and `result_at`" (if A to C2 changed that sentence, append
  `` , and `ack --result` fills `result` and `result_at` `` to its list instead);
- "Rules for a good card", A's last bullet `- When a "done" needs a check, check it yourself, then add --close <id> to the ack of that batch.`
  becomes exactly (A 6.4 names this edit for D):
  `- When a "done" needs a check, check it yourself, then add --close <id> --result <id> "<what you checked>" to the ack of that batch.`

`REF/guides.md` "The status guide": replace the whole paragraph under the heading (today the one line
`Use the id \`status\` and these four sections. Update it after each batch you handle.`, directly above the
```` ```markdown ```` block) with exactly
`Keep one only when the config sets \`status.guide\` to \`true\`; the script then prints a \`status guide:\` line after \`ack\` and \`guide --archive\` that says when and how to update it. A status guide uses the id \`status\` and these four sections:`
(the old first sentence alone told the agent to build the guide, which is off by default).

`README.md`, "How the agent works with it", append: "The agent says what it does with `status`: one small write
that the page shows as a strip at the top, greyed when it is old. `ack --result` puts one line under a card,
saying what the agent did with the answer. A dot marks a card the agent changed since you last marked it seen."

## 7. Tests

`tests/board-test.mjs` (new `ok` cases; names exact; every config sets `tz` as A requires):
- `status: --now and --next write meta/status, a create first and then pinned` — `status --now "Build X" --next "A" "B"`;
  line `status: now "Build X", next ["A","B"], waiting ""`; one write `{op:"set", collection:"meta", doc_id:"status"}` with
  no `if_version` (a create); the out file equals `{now:"Build X", next:["A","B"], waiting:"", updated: <now() of BOARD_NOW>}`;
  the lines after the JSON line are `if refused: rm -rf board/dump, then P2 meta with versions, then node <SELF> adopt meta/status --dump board/dump --dumped --state "<state>"`
  and `if the reply is lost: node <SELF> push meta/status --state "<state>"` (`<dump>` as A's printed-lines case builds it).
  Apply the write (`writesOf` and the stand-in db, as A's cases do), then `status --now "Build Y"`: its write carries
  `if_version: 1`.
- `status: a refused write is adopted through the generic path` — apply a status write, change the db document
  (version 2) by hand, run `status --now "Z"` (pinned to 1, refused by the stand-in db), then
  `ok2(b, "adopt", "meta/status")` after a dump of `meta` with versions: the line `meta/status: write again, pinned to version 2`
  and one write with `if_version: 2`.
- `status: size` — ASCII maxima (`--now`, three `--next`, `--waiting`, each 60 `x`): written, and
  `Buffer.byteLength` of the out file content (as JSON without whitespace) plus a watch `{started, until}` of two
  stamps is at most 500. Then `--now` of 60 `"€"` (3 bytes each) with three `--next` of 60 `"€"`: refused with `status: <n> bytes with a watcher, over 500; shorten the lines`, nothing written.
- `status: --idle keeps waiting; a new --now clears it; --waiting in the same call wins; --next with no value clears next; --now idle is --idle`.
- `status: refused input` — exact lines, each with exit 1 and no write: no flag ->
  `status: give --now, --next, --waiting or --idle`; `--idle --now "x"` -> `status: --idle and --now together; give one`;
  `--now ""` -> `status --now: empty text`; `--next "a" ""` -> `status --next: an empty line`; 4 `--next` ->
  `status --next: at most 3 lines`; a `--now` argv value of a space, a dollar sign, a backtick and a space (the JS
  string `" $\x60 "`) -> `status --now: empty text`.
- `status: cleans and cuts the text and prints what it stored` — exit 0 and one write each (argv values given as JS
  strings, passed without a shell): `"x".repeat(61)` -> stored `now` is `"x".repeat(57) + "..."` (60 characters);
  `"a\nb"` -> `"a b"`; `'say "hi" for $5 \x60now\x60'` -> `"say 'hi' for 5 now"`; each printed `status:` line holds
  the stored text (`q` of it).
- `status: push meta/status prints the last write again` — `cmd(b, "push", "meta/status")` prints the same JSON line.
- `status: two status calls leave one out file of meta/status` (A's cleanup; guards against unbounded files).
- `ack --result: stores one line on the card and writes the cards document with the ack` — line ends
  `0 cards closed, 0 reopened, 1 results. The answers go to decisions.md when the next read no longer lists the batch`;
  card has `result`, `result_at` = `updated` = the stamp, same `rev`; the writes are the batch update and the cards set.
- `ack: a batch whose only effect is a dismiss undo still writes the cards document` — C2's
  helpers `ctlBatch`, `ctlOn`: dismiss `tracker-7` and ack, apply; then a batch `{rev: 1, dismiss: "off", keep: {assign: "", done: "off"}}`:
  the line holds `0 cards closed, 1 reopened, 0 results` and the writes include `["set", "cards", "main", <n>]`.
- `ack --result: odd value count, unknown card, twice, empty: refused, nothing written`.
- `ack --result: a line break, 201 characters, a double quote, a dollar sign and a backtick are cleaned, not refused` —
  `ack <bid> --result c1 <text>` with the JS string `'not closed in X: why "timeout" $1 \x60y\x60\n' + "z".repeat(200)`:
  exit 0, the batch is handled, the card's `result` is `cleanText` of it (200 characters, ends with `...`, holds
  `why 'timeout' 1 y z`), and the line after the ack line is `  result c1: ` plus `q` of that stored text.
- `ack --result: a second ack of a handled batch still stores the result` — first `ack <bid>`, then a dump where the
  batch is handled, then `ack <bid> --result c1 "done"`: line `ack <bid>: already handled, 1 results stored`; one
  cards write; card has the result.
- `sync: a card file with result is refused; a resync keeps the result; a rev rise drops it and says so` — the
  refusal line `<id>: result: set only by ack --result`; the drop line ends `, 1 results dropped (rev up)`.
- `sync: a dismissed card that returns on a new input drops its result` — C2's dismiss and
  `input` flow (C2 board-test 5) with an `ack --result tracker-7 "x"` on the dismiss ack: the sync with `input: "i2"`
  prints `1 reopened (tracker-7)` and `, 1 results dropped (rev up)`, and the card has no `result`.
- `check: status problems` — config `status: {stale_minutes: 0, guide: "yes", x: 1}` on an otherwise clean fixture:
  the lines include `problem: config status: unknown field "x"`, `problem: config status.stale_minutes: a whole number from 1 to 1440`
  and `problem: config status.guide: true or false`, in that order; `status: []` -> a line
  `problem: config status: not an object`; `status: {stale_minutes: 45, guide: true}` -> no `problem: config status` line.
- `the status guide line shows only when the config turns it on` — config without `status`: `ack <bid>` prints no
  line that starts `status guide:`; with `status: {guide: true}`: the line after the ack line is
  `status guide: on in the config. Add what you did with this batch in <rel status.md>, dump guides with versions, then run node <SELF> guide <rel status.md> --id status --kind status --dump <dump> --state "<state>" and pass its array`;
  `guide --id a --archive` (after a `guide` of `a`) prints the line with `Say under "Done" that a is done`.

`tests/status-test.js` (new, page pure part via `_page.js`):
- `ageText: just now, minutes, hours, days, a bad stamp, a future stamp`.
- `statusView: no document, a task, idle with waiting, stale after stale_minutes, idle never stale, at most 3 next`.
- `statusView: an unreadable updated is no status; a stamp 10 minutes ahead is stale`.
- `statusView: config status.stale_minutes changes the stale bound; an invalid value keeps 30`.
- `cardChanged: first visit shows none; a new card and a newer updated show; the same updated does not`.
- `cardChanged: compares instants across a DST offset` — seen `"2026-11-01T01:50:00-04:00"`, updated
  `"2026-11-01T01:10:00-05:00"` (later in real time, lower as text) -> `true`; the reverse -> `false`.
- `seenOf and seenFrom: map id to updated; a __proto__ id is an own key and shows no dot when unchanged; bad text is null`.
- `statusView: when is the exact time of updated through the formatter it is given, "" without a status`.
- `dotOn: a card in Done or Not ours shows no dot; an active or snoozed changed card does` (stub `lingerOf` as
  C2's `tests/_page.js` does; build the cards with C2's `resp` controls).
- `coerce status: next drops non-strings; watch absent stays absent`.
- `PAGE never writes meta/status` — the source has no match of `/doc\("meta\/status"\)\.(set|update)/`.
- `the dot clears on Mark all seen and on an answer or a control of that card` — source checks: `function markAllSeen`
  and `function seenOne` exist; `seenOne(id);` is the first statement inside `function saveResponse(id) {` and inside
  `function saveControls(id, patch) {`; the source holds `if (seenCards === null && loaded.items) markAllSeen();`;
  it has no `addEventListener("pagehide"` and no `IntersectionObserver`.

`tests/render-test.js`: new case `a card shows its result line by textContent, hidden without a result`: if the
harness builds cards through `updateCard` (as the link case does), build one with and one without `result`; else
assert the source line `c.result.textContent =` exists. The HTML site list stays unchanged.

`tests/cuts-test.js`: `the status document has no agent field` (`"agent" in P.SCHEMA.status === false`).

Acceptance (the scoping has no checklist; derived from "Proposed approach" and "Additions"):

| Derived criterion | Covered by |
|---|---|
| One write under 500 bytes, no read first | board-test `status: --now and --next ...` (a create, then pinned to the state's version: no read), `status: size` |
| One rule line in SKILL.md | skill-text-test `SKILL.md holds the status rule line` |
| Page shows now, age, next behind a tap; never writes | status-test `statusView`, `PAGE never writes meta/status`; maintainer check R-1 |
| Stale strip greys, "last heard", exact time on hover | status-test stale and `when` cases; maintainer check R-1 |
| Idle with waiting | status-test idle case |
| Result line | board-test ack/sync cases; render-test; maintainer check R-2 |
| Agent-changed dot via localStorage | status-test `cardChanged`, `seenOf and seenFrom`, `dotOn`, the Mark-all-seen source case; maintainer check R-3 |
| Strip shows wake mode | status-test `wakeLine` (item 2) |
| Strip shows "the time of the last watcher tick" | replaced by the planned watcher window; a tick time would need a write per tick, against cheap-reads criterion 1 |

Maintainer checks of item 1 (see "Who runs what"; listed again in "Checks for the maintainer"):
- R-1 strip: first above Due today and Blocked on you; idle, task, stale (stub `updated` 2 h back) with
  `last heard 2 h ago` and the exact time on hover; next unfolds on tap and stays open over a snapshot.
- R-2 result line on an open card and on a card in Done.
- R-3 dot: change a card's `updated` in the stub: its dot shows and the strip body shows `Mark all seen`; a tap on
  it clears every dot; change two cards, answer one: only the other keeps its dot; reload: the same dots.

---

## Item 2: decision-board-wake-modes

## 1. Goal

The operator picks how the agent learns of a Send: a comment wake, a poll, both, or nothing, in config, with no
edit to the brief; every comment wake ends in a full read, and the README states what each mode costs.

After a watcher reached its poll limit, nothing starts a new one by itself: no `sync`, `ack` or plain `watch` does. A new window starts only when the operator tells the agent to
watch again, and the agent then runs `node S watch --restart`.

## 2. Data model

- `meta/status.watch` (written only by `watch`, see §4): `{ started, until }`, two stamps:
  `started` = the time `watch` told the agent to start a watcher,
  `until = P.stampIn(P.stampMs(started) + poll_seconds * poll_limit * 1000, P.cfg.tz, false)`.
  When a later `watch` finds that the watcher reached its poll limit, it sets `until` to that moment (`now()`), once; only `watch --restart` writes a new window after that. It
  records a plan, not a heartbeat: nothing proves the watcher still runs (README says so).
- New local file `board/watch.json` (beside the state; writer: `watch` creates it and sets `ended`, `watch --restart`
  replaces it after the poll limit, `waiting --count` updates it; nothing deletes it; never sent to the database):
  `{"dump": "<absolute path of board/watch-dump>", "seconds": S, "limit": N, "poll": 0, "started": "<stamp>", "until": "<stamp>"}`,
  plus `"reported": true` once `waiting` found batches and `"ended": true` once `watch` wrote the end of the window.
  It is the watcher's poll count, kept by the script: the watcher remembers nothing.
  A's `check` second-state test ignores it (it has no `cards` list).
- New document `meta/wake` (SCHEMA `wake: { thread: "s", updated: "d" }`). Writer: the page only (the operator is
  owner). `thread` is the id of the comment thread the page writes into for every wake; `updated` the stamp of
  the last change. The script never reads or writes it.
- `SCHEMA.wakeModes = ["poll", "comment", "both", "off"]`.
- No per-tick database write (call C11; operator answer `agent-status-watcher-tick`).

Access rules (`REF/data-model.md`, "Access rules"): A's JSON block
`{"db": {"rules": [{"path": "", "read": "view", "write": "owner"}]}}` becomes
`{"db": {"rules": [{"path": "", "read": "view", "write": "owner"}]}, "comments": {}}` (the full form, which
`sendToClaude` needs; consent is asked once at the first wake). A's access-rules test compares only `.db.rules`, so
it keeps passing. No db rule change. A page published before this cluster lacks the capability: its `Send` then
shows the `no_capability` notice (§5), which tells the operator to have the page republished (`REF/build.md`,
"Change the page", which passes the capabilities).

## 3. Config

New key `wake` (object). `DEFAULTS.wake = { mode: "both" }` in `PAGE`, appended after `status` (B then knows the
key; the position is not a contract).

| Key | Type | Default | Validation (`check` problem text) |
|---|---|---|---|
| `wake.mode` | string | `"both"` | one of `poll`, `comment`, `both`, `off`, else `config wake.mode: not one of poll, comment, both, off` |
| `wake.poll_seconds` | integer | `300` in `poll`, `900` in `both` | 60 to 86400, else `config wake.poll_seconds: a whole number from 60 to 86400` |
| `wake.poll_limit` | integer | `24` in `poll` (2 hours), `32` in `both` (8 hours) | 1 to 1000, else `config wake.poll_limit: a whole number from 1 to 1000` |

(Operator answer `wake-modes-defaults`: poll mode 300 s for 2 h, 24 polls; both mode 900 s for 8 h, 32 polls.)
Also `config wake: not an object`, `config wake: unknown field "<k>"` (through `q(k)`). A present `poll_seconds` or
`poll_limit` is validated in every mode (a bad value would bite on the next mode switch); in `comment` and `off`
a valid one is accepted and ignored, so a mode switch needs one edit. A's literal `poll limit 30` leaves the text
(the number lives in `wakePlan`).

Function in `S`, directly after `statusProblems`:

```js
// The problems of config "wake", on the merged config.
function wakeProblems(raw) {
  const v = raw.wake, out = [];
  if (v === undefined) return out;
  if (!P.isObj(v)) return ["config wake: not an object"];
  for (const k of Object.keys(v)) if (!["mode", "poll_seconds", "poll_limit"].includes(k)) out.push("config wake: unknown field " + q(k));
  if (v.mode !== undefined && !S.wakeModes.includes(v.mode)) out.push("config wake.mode: not one of poll, comment, both, off");
  if (v.poll_seconds !== undefined && P.intIn(v.poll_seconds, 60, 86400, null) === null) out.push("config wake.poll_seconds: a whole number from 60 to 86400");
  if (v.poll_limit !== undefined && P.intIn(v.poll_limit, 1, 1000, null) === null) out.push("config wake.poll_limit: a whole number from 1 to 1000");
  return out;
}
```

Pure function in `PAGE` (used by page and script):

```js
function wakePlan(raw) {
  var w = isObj(raw) ? raw : {}, mode = SCHEMA.wakeModes.indexOf(w.mode) >= 0 ? w.mode : DEFAULTS.wake.mode;
  var poll = mode === "poll" || mode === "both", d = mode === "poll" ? [300, 24] : [900, 32];
  return { mode: mode, comment: mode === "comment" || mode === "both", poll: poll,
    poll_seconds: poll ? intIn(w.poll_seconds, 60, 86400, d[0]) : 0, poll_limit: poll ? intIn(w.poll_limit, 1, 1000, d[1]) : 0 };
}
```
Place it directly after `intIn`. `normConfig`, directly after the `out.status` line: `out.wake = wakePlan(g("wake"));`.

## 4. Script

The script makes every judgment of the wake (operator goal): whether a watcher runs, starts, or has ended; the
watcher's whole prompt; the poll count; the next wait. The agent runs one command and does what it prints.

### Changed command `check`: `--url <artifact link>`

`FLAGS`: A's `check: ["state"],` becomes `check: ["state", "url"],`. `USAGE`: B's check line becomes
`  check [--url <link>]                      merge the config layers, check them and the state; print the meta/config write when it changed; --url stores the artifact link for watch`.
In `cmdCheck`, directly after the `new Run(a, { create: true })` line:

```js
if (a.url) {
  const u = one(a, "url");
  // An https link with no space or quote; the egress test bans a literal URL in this file, so the regex is escaped.
  if (!/^https:\/\/[^\s"'`\\]{1,300}$/.test(u)) fail("check --url: the https link of the artifact, with no space or quote");
  r.st.url = u;
}
```
The link is kept in `board/state.json` (git-excluded with `board/`) and used only to fill the watcher's `P4` call.

### New command `watch`

Usage line, added to `USAGE` directly after the `status` line:
`  watch [--restart]                         what to do about a watcher, from the config wake mode; may write meta/status; --restart: a new window after the poll limit, only when the operator asks`

`FLAGS`: `watch: ["state", "restart"],`. `COMMANDS`: `watch: cmdWatch`. Add `"restart"` to `SWITCHES` (as item 1 adds
`"idle"`); `cmdWatch` reads it with `has(a, "restart")` (item 1's helper).

New module-level code in `S`, directly before `function cmdWatch` (after `cmdStatus`):

```js
// The watch file of the board: written by watch when it starts a watcher, counted by waiting --count.
const watchFile = (r) => path.join(r.dir, "watch.json");
function readWatch(file) {
  try { const w = JSON.parse(fs.readFileSync(file, "utf8")); return isPlain(w) && typeof w.dump === "string" && [w.poll, w.limit, w.seconds].every(Number.isInteger) ? w : null; } catch (e) { return null; }
}
const COMMENTS_LINE = "comments: if this session has not run P5 for this board yet, run it now.";
// The watcher's prompt: the text block of references/watch.md with every value filled in.
function briefText(url, dump, wf) {
  const md = fs.readFileSync(path.join(HERE, "..", "references", "watch.md"), "utf8"), m = md.match(/```text\n([\s\S]*?)\n```/);
  if (!m) fail("watch: references/watch.md has no text block");
  const p4 = JSON.stringify({ action: "query", url, collection: "batches", out_dir: dump, query: { where: [["status", "==", "sent"]], limit: 1000 } });
  return m[1].split("<P4>").join(p4).split("<SCRIPT>").join(fileURLToPath(import.meta.url)).split("<DUMP>").join(dump).split("<COUNT>").join(wf);
}
```

`cmdWatch(a, log)`, exactly:

```js
function cmdWatch(a, log) {
  const r = new Run(a); r.needConfig();
  const bad = wakeProblems(r.load.config);
  if (bad.length) fail(bad.concat([`fix the config, then run \`node ${SELF} check\``]).join("\n"));
  const w = P.cfg.wake, wf = watchFile(r), cur = readWatch(wf);
  if (w.mode === "off") log("wake off: start no watcher. Read the board when the operator asks.");
  else if (w.mode === "comment") { log("wake comment: start no watcher; a comment on the board wakes you."); log(COMMENTS_LINE); }
  else if (cur && cur.poll >= cur.limit && !has(a, "restart")) {
    // Operator answers wake-modes-limit-reached and wake-limit-restart: the watcher stopped; the page shows the
    // window ended; a new window only on watch --restart, which the agent runs when the operator asks.
    if (!cur.ended) {
      const s = storedStatus(r), t = now();
      if (s.watch) { s.watch = { started: s.watch.started, until: t }; s.updated = t; putStatus(r, s); }
      cur.ended = true; fs.writeFileSync(wf, JSON.stringify(cur) + "\n");
    }
    log(`wake ${w.mode}: the watcher window ended at its poll limit; start none. Start a new one only when the operator asks you to watch again: node ${SELF} watch --restart.` + (w.comment ? " A comment on the board still wakes you." : " Read the board when the operator asks."));
    if (w.comment) log(COMMENTS_LINE);
  } else if (cur && cur.poll < cur.limit && !cur.reported && P.stampMs(cur.until) > nowMs()) {
    log(`wake ${w.mode}: a watcher runs until ${cur.until}; start none.`);
    if (w.comment) log(COMMENTS_LINE);
  } else {
    if (!r.st.url) fail(`watch: no board URL in ${r.file}. Run node ${SELF} check --url <the artifact link> once, then watch again`);
    const dump = path.join(r.dir, "watch-dump");
    for (const p of [dump, wf, fileURLToPath(import.meta.url)]) if (p.includes('"')) fail(`watch: the path ${p} holds a double quote; move the board`);
    const t = now(), until = P.stampIn(P.stampMs(t) + w.poll_seconds * w.poll_limit * 1000, P.cfg.tz, false);
    fs.rmSync(dump, { recursive: true, force: true });
    fs.writeFileSync(wf, JSON.stringify({ dump, seconds: w.poll_seconds, limit: w.poll_limit, poll: 0, started: t, until }) + "\n");
    const s = storedStatus(r); s.watch = { started: t, until }; s.updated = t; putStatus(r, s);
    log(`wake ${w.mode}: start one watcher, every ${w.poll_seconds} s, at most ${w.poll_limit} polls, until ${until}. Pass the array below to P3, then start P6 with the lines between "--- brief" and "--- end" as its prompt.`);
    log("--- brief"); log(briefText(r.st.url, dump, wf)); log("--- end");
    if (w.comment) log(COMMENTS_LINE);
  }
  r.finish(log);
}
```

Printed lines, for the tests (`<until>` and `<t>` are stamps in `tz`; `<SELF>` as A's lines):
- `wake off: start no watcher. Read the board when the operator asks.`
- `wake comment: start no watcher; a comment on the board wakes you.` then `comments: if this session has not run P5 for this board yet, run it now.`
- `wake poll: start one watcher, every 300 s, at most 24 polls, until <until>. Pass the array below to P3, then start P6 with the lines between "--- brief" and "--- end" as its prompt.`
- `wake both: start one watcher, every 900 s, at most 32 polls, until <until>. ...` (the same tail), and after `--- end` the comments line.
- `wake both: a watcher runs until <until>; start none.` (then the comments line).
- `wake poll: the watcher window ended at its poll limit; start none. Start a new one only when the operator asks you to watch again: node <SELF> watch --restart. Read the board when the operator asks.`
- `wake both: the watcher window ended at its poll limit; start none. Start a new one only when the operator asks you to watch again: node <SELF> watch --restart. A comment on the board still wakes you.` (then the comments line).
- `watch: no board URL in <state file>. Run node <SELF> check --url <the artifact link> once, then watch again`.
- then A's `finish()` output: `no writes`, or the `meta/status` array with its `if refused:` and `if the reply is lost:` lines.

A watcher that dies early (its session ended) leaves `watch.json` with `poll < limit`; once `until` passes, `watch`
starts a new one. A watcher that reported batches set `reported`, so the `watch` after the read starts a new one.
A watcher that reached its poll limit (`poll >= limit`) holds back every plain `watch`, whatever `until` says: the
first one ends the window (one `meta/status` write), every later one prints the same line and writes nothing.
`watch --restart` skips only that branch: after the poll limit it starts a fresh window (the start branch: new
`watch.json` without `ended`, new `meta/status` window); with a watcher that still runs, or in `comment` or `off`,
it prints what a plain `watch` prints and writes the same (call C39).

### Changed command `waiting`: `--count <watch file>`

`FLAGS`: A's `waiting: ["dump"],` becomes `waiting: ["dump", "count"],` (`--state` stays unknown, so A's test
"waiting needs no state and reads only batches" still passes). `USAGE`: A's waiting line becomes
`  waiting --dump <dir> [--count <watch file>]   the ids of the batches that wait, or "none"; --count: the watcher's step, with the poll count`.
Add near the top of `S`, after `const HERE = ...`: `const WAIT_SH = path.resolve(HERE, "..", "assets", "wait.sh");`.

`cmdWaiting(a, log)` becomes exactly:

```js
function cmdWaiting(a, log) {
  const dir = one(a, "dump"), list = waiting(readDump(dir));
  if (!a.count) { log(list.length ? list.map((b) => qid(b.id)).join("\n") : "none"); return; }   // A's form
  const file = path.resolve(one(a, "count")), w = readWatch(file);
  if (!w) fail(`waiting: ${file} is not a watch file. Report "watch file missing, run node S watch" and stop`);
  if (path.resolve(dir) !== w.dump) fail(`waiting: --dump is not the dump folder of ${file}`);
  fs.rmSync(w.dump, { recursive: true, force: true });                 // the next poll starts clean; no rm in the brief
  if (list.length) {
    w.reported = true; fs.writeFileSync(file, JSON.stringify(w) + "\n");
    log(`batches ${list.map((b) => qid(b.id)).join(" ")} wait. Report exactly: "batches wait: run Read and handle the answers". Then stop.`);
    return;
  }
  w.poll += 1; fs.writeFileSync(file, JSON.stringify(w) + "\n");
  if (w.poll >= w.limit) { log(`none, poll ${w.poll} of ${w.limit}: the limit. Report exactly: "no batch, poll limit reached: run node S watch and do what it prints". Then stop.`); return; }
  log(`none, poll ${w.poll} of ${w.limit}. Run bash "${WAIT_SH}" ${w.seconds} in the foreground, then go to step 1.`);
}
```

(`readDump` of a missing folder is an empty dump, as A has it. `waiting` takes no state, as A has it. The report
texts name `S` and the SKILL section, which the owning session knows; the watcher only relays them.)

### Changed `assets/wait.sh` (full file)

```bash
#!/usr/bin/env bash
# Usage: wait.sh [seconds]   default 480. Waits at most BOARD_WAIT_CAP (default 570) seconds per call.
# Prints "wait ended", or "wait paused: run bash "<this file>" <rest> again" when seconds is over the cap.
set -eu
s="${1:-480}"; cap="${BOARD_WAIT_CAP:-570}"
case "$s" in ''|*[!0-9]*) echo "wait.sh: seconds must be a whole number" >&2; exit 2;; esac
case "$cap" in ''|*[!0-9]*|0) echo "wait.sh: BOARD_WAIT_CAP must be a whole number from 1" >&2; exit 2;; esac
if [ "$s" -gt "$cap" ]; then
  sleep "$cap"; echo "wait paused: run bash \"$0\" $((s - cap)) again"
else
  sleep "$s"; echo "wait ended"
fi
```
No time stamp in the output (A: no `date -u`); no network client, no URL (egress cases). The cap keeps one call
under the 600 s foreground limit (C12); `$0` is the path the watcher ran, so the pause line is a whole command.

### Unchanged

`read` keeps the form A, B and C2 left. The comment wake uses the same full read.

## 5. Page

### Pure functions (node-tested)

- `wakePlan(raw)` (above).
All of these go in the `// ---- agent status` section of item 1, after `dotOn`.

- `function durText(s)`: `s < 120` -> `s + " s"`; `s < 7200` -> `Math.round(s / 60) + " min"`; else `Math.round(s / 3600) + " h"`.
  (`300` -> `5 min`, `900` -> `15 min`.)
- `function wakeLine(plan, watch, nowMs, fmtTime)`:
  - off -> `"Wake: off. Tell the agent to read the board."`
  - comment -> `"Wake: a comment on Send"`
  - poll -> `"Wake: poll every " + durText(plan.poll_seconds) + part`
  - both -> `"Wake: a comment on Send, and a poll every " + durText(plan.poll_seconds) + part`
  - `part`: `u = watch ? stampMs(watch.until) : -Infinity`; `u > nowMs` -> `", watcher planned until " + fmtTime(watch.until)`;
    `u !== -Infinity` (past) -> `", watcher window ended " + fmtTime(watch.until)`; else `", no watcher started"`.
- `function wakeNotice(plan, outcome)` -> the line under Send. `outcome` is one of
  `"sent" | "sent_unsaved" | "mark_sent" | "no_session" | "writers_only" | "off" | "unavailable" | "no_capability" | "forbidden" | "consent_required" | "gesture" | "rate_limited" | "none"`:
  - `plan.mode === "off"` -> `"Sent. Tell the agent to read the board."` (any outcome).
  - `plan.mode === "poll"` -> `"Sent. The watcher picks it up within " + durText(plan.poll_seconds) + "."`.
  - comment or both:
    - `no_capability` (the page was published without the comments capability) -> both:
      `"Sent. This page cannot post comments: ask the agent to republish it. The poll every " + durText(plan.poll_seconds) + " picks it up."`;
      comment: `"Sent. This page cannot post comments: ask the agent to republish it, and to read the board."`
    - `sent` -> `"Sent, and the agent was woken by a comment."`
    - `sent_unsaved` -> `"Sent, and the agent was woken. The thread was not saved, so the next wake starts a new one."`
    - `mark_sent` -> `"Sent, but some answers were not marked sent. The agent was woken."`
    - `gesture` -> `"Sent. Tap Wake the agent to send the comment."` (the button shows)
    - `consent_required` -> `"Sent. Allow comments from this page, then tap Wake the agent."` (the button shows)
    - `rate_limited` -> `"Sent. Too many wakes just now; tap Wake the agent in a minute."` (the button shows)
    - others (`no_session`, `writers_only`, `off`, `unavailable`, `forbidden`, `none`) -> both:
      `"Sent. No agent session takes comments here; the poll every " + durText(plan.poll_seconds) + " picks it up."`;
      comment: `"Sent. No agent session takes comments here; tell the agent to read the board."`
- `var WAKE_TEXT = "Read the decision board: answers were sent.";` (V12; never an answer, a batch id or a card).

### DOM changes

1. HTML: in the header row that holds `#send`, directly after `<button id="send" ...>...</button>`:
   `<button id="wake" type="button" hidden>Wake the agent</button>`, and directly after the closing tag of that row
   `<div id="wakestate" class="small muted" aria-live="polite"></div>`.
2. Globals, beside the `agentStatus` line of item 1: `var comments = null, commentsOff = false, wakeDoc = null, wakeOutcome = "", wakeTimer = 0;`
3. At the end of the script, directly after A's `window.claude.use("db").then(start, function () { start(null); });`
   line (inside the same `if`): `window.claude.use("comments").then(function (c) { comments = c || null; commentsOff = !c; }, function () { commentsOff = true; });`
4. Reads, in `start` after the `meta/status` listener:
   `db.doc("meta/wake").onSnapshot(function (d) { var x = d && d.exists ? d.data() : null; wakeDoc = isObj(x) ? coerce("wake", x) : null; }, function () {});`
5. `function wakeAnchor()`: called synchronously at the START of the click handler (the gesture), before any await:
   `return comments && typeof comments.anchorFor === "function" ? comments.anchorFor($("send")).catch(function () { return null; }) : Promise.resolve(null);`
6. `function wakeAgent(anchorP)` (called only from a click handler, Send or Wake, with the promise from step 5):
   ```
   if (!cfg.wake.comment) return Promise.resolve("none");
   if (!comments) return Promise.resolve(commentsOff ? "no_capability" : "unavailable");
   if (typeof comments.sendToClaude !== "function") return Promise.resolve("unavailable");
   return comments.canSendToClaude().then(function (v) {
     if (v !== "available") return v;
     var go = function (target) { return comments.sendToClaude(target).then(function (r) {
         if (wakeDoc && wakeDoc.thread === r.threadId) return "sent";
         return db.doc("meta/wake").set({ thread: r.threadId, updated: nowStamp() }).then(function () { return "sent"; }, function () { return "sent_unsaved"; });
       }); };
     var fresh = function () { return anchorP.then(function (an) { if (!an) throw { code: "unavailable" }; return go({ anchor: an, text: WAKE_TEXT }); }); };
     return (wakeDoc && wakeDoc.thread ? go({ threadId: wakeDoc.thread, text: WAKE_TEXT }).catch(function (e) { if (e && e.code === "not_found") return fresh(); throw e; }) : fresh());
   }).catch(function (e) {
     var c = e && e.code;
     return c === "claude_unavailable" ? "gesture" : c === "consent_required" || c === "forbidden" || c === "rate_limited" ? c : "unavailable";
   });
   ```
7. `function setWakeOutcome(o)`: `wakeOutcome = o; clearTimeout(wakeTimer); if (o !== "gesture" && o !== "consent_required" && o !== "rate_limited") wakeTimer = setTimeout(function () { wakeOutcome = ""; schedule(); }, 30000); schedule();`
   (a plain notice clears after 30 s; a notice that shows the Wake button stays until the next Send or Wake press).
8. `send()` (A's form with C2's `s.c`): its first line becomes `var anchorP = wakeAnchor(), went = false;`
   (before A's `if (sending || !ready()) return;`; `setWakeOutcome("")` is not called, so the old notice stays until
   replaced). In the first `.then`, C2's `if (s.r.length + s.n.length + s.c.length) return sendGroup(s);` becomes
   `if (s.r.length + s.n.length + s.c.length) { went = true; return sendGroup(s); }`. Wake only when a batch write
   went out: in the success branch (A's `showMsg("")`) add `if (went) wakeAgent(anchorP).then(setWakeOutcome);`; in
   the error branch, when `x && x.stage === "mark"`, keep A's `showMsg(...)` and add
   `wakeAgent(anchorP).then(function (o) { setWakeOutcome(o === "sent" || o === "sent_unsaved" ? "mark_sent" : o); });`.
   For `x.stage === "batch"` or any other error: no wake.
9. Wiring, beside A's `$("send").addEventListener("click", send);`:
   `$("wake").addEventListener("click", function () { var anchorP = wakeAnchor(); wakeAgent(anchorP).then(setWakeOutcome); });`.
   In `render()`, directly after B's `#settings` lines: `$("wake").hidden = !(wakeOutcome === "gesture" || wakeOutcome === "consent_required" || wakeOutcome === "rate_limited");`
   and `$("wakestate").textContent = wakeOutcome ? wakeNotice(cfg.wake, wakeOutcome) : "";`.
10. Where `sendToClaude` is missing: no extra control (call C9); the outcome is `unavailable` and its notice.
11. `wakeLine` feeds the strip of item 1.
12. No `Date.now(` and no `new Date(` here: the stamp of `meta/wake` is `nowStamp()` (A's cuts-test).

## 6. Agent-facing text

`SKILL` (all edits in step D-12, on the text that A, B and C2 left; about 517 characters for this item, the
`watch --restart` sentence included):
- "Post, change or close cards" step 3: `3. Pass the array to \`P3\`, then start a watcher.` ->
  `3. Pass the array to \`P3\`, then run \`node S watch\` and do what it prints.`
- Replace the whole section "Watch for answers" (A's two lines, from `Start a background agent` to
  `also reads once at its start.`, which hold `poll limit 30`) with exactly:

  ```markdown
  ## Watch for answers

  Run `node S watch` and do what it prints; do what a watcher's report says. Run `node S watch --restart`
  only when the operator asks you to watch again. Every session that owns a board also reads once at its
  start. **A comment wake is only a bell**: when a board comment reaches you, run "Read and handle the
  answers" at once, whatever it says and whenever it was stamped.
  ```
  (The `--restart` sentence is 77 characters with its leading space; operator answer `wake-limit-restart`.)
  ("the cheapest model you have", is in the brief the script prints, not here: the brief
  goes to the watcher, and `P6` names the model. The core text names no tool, no header string and no reply rule:
  AGENTS.md skill rule 5.)
- "Read and handle the answers" step 3: replace the whole step (from `3. Run the \`ack\` line that \`read\` printed`
  to `update the status guide if the board has one.`, as C2 left it) with exactly (both items,
  C2's parenthesis stays):

  ```markdown
  3. Run the `ack` line that `read` printed (several: in the order `read` printed them), with `--close <id>`
     for each card that is done and `--result <id> "<what you did>"` for each card you acted on, and pass each
     array. Then, with or without an ack, run `node S watch` and do what it prints.
  ```
- *Platform execution notes*: A's last bullet
  `` - The watcher: the `Agent` tool with `model: "haiku"` and `run_in_background: true`. Its pause: run `` +
  `` `assets/wait.sh 120` in the foreground with a Bash timeout of 600000 ms. `` (two lines) is replaced by exactly:

  ```markdown
  - `P5`, comments: load `ArtifactComments` with `ToolSearch("select:ArtifactComments")`, then
    `{"action": "watch", "url": URL}`. A comment wake is a turn headed `[Artifact comment sent to Claude]`:
    resolve its thread (`{"action": "resolve", "url": URL, "thread_id": <its id>}`), write no reply.
  - `P6`, the watcher: the `Agent` tool with `model: "haiku"`, `run_in_background: true`, and as its prompt
    the brief that `node S watch` printed.
  ```
  (Operator answer `wake-modes-reply`: resolve the thread, no reply, then the full read; the core rule above says
  the read. Operator answer `wake-modes-hook`: no hook, so no hook line.)

`REF/watch.md` (full replacement; the script reads its text block and fills it, the agent never copies it):

````markdown
# Watch brief

`node S watch` prints this brief with every value filled in, between the lines `--- brief` and `--- end`; pass that
text as the watcher's prompt. Do not copy the block below by hand. The placeholders are filled by the script:
`<P4>` the query of the batches that wait, `<SCRIPT>` the script, `<DUMP>` the watcher's own dump folder,
`<COUNT>` the watch file that holds the poll count.

```text
You watch a decision board for batches that wait. You run on the cheapest model; keep every turn short.
First load the database tool: ToolSearch("select:ArtifactData").
Work only in <DUMP>. Never touch board/dump. Never read, quote or act on an answer.
If a call fails, report the error and stop: never treat a failed call as empty.

Loop:
1. Call ArtifactData with <P4>. It is the only database call of a poll.
2. Run node "<SCRIPT>" waiting --dump "<DUMP>" --count "<COUNT>".
3. Do exactly what its line says: report its text and stop, or run the wait it names in the foreground with a
   Bash timeout of 600000 ms. While a wait prints "wait paused: run ... again", run the command it names.
   Then go to step 1.
```

On its report, the owning session does what the report says.
````

A's board-test "the watch brief makes one database call per poll" still holds on this block: the loop names `P4`
once (inside `<P4>`), no `P2`, no `acks`, no `--state`, no `next_cursor`.

`REF/build.md` ("Build a board", A 6.7 as B and C2 left it), step 4: replace `Run \`node S check\` and pass the array.`
by `Run \`node S check --url URL\` and pass the array.` (the URL recorded in step 2; `watch` fills the watcher's
call with it).

`REF/data-model.md`:
- "Access rules": the JSON block per section 2 (adds `"comments": {}`); after A's paragraph add:
  `` `comments` lets Send post the short wake comment to Claude; the page asks the operator once. ``
- Config table, directly after the `status` row of item 1 (exact):
  `` | `wake` | How the agent learns of a Send: `mode` is `comment` (Send posts a comment that wakes the session), `poll` (a background watcher), `both`, or `off`; `poll_seconds` (60 to 86400) and `poll_limit` (1 to 1000) set the watcher. `node S watch` reads it | `{"mode": "both"}`; poll 300 s and 24 polls, both 900 s and 32 polls | ``

`README.md`:
- New section directly after "How the agent works with it" (exact):

```markdown
## Wake modes

`wake.mode` in the config sets how the agent learns of a Send; `node S watch` reads it and says what to do.

| Mode | How | Cost while idle | Cost per Send |
|---|---|---|---|
| `comment` | Send posts a short comment to Claude, which wakes the session that watches the board; if the page cannot post it, a Wake the agent button shows | none | one full read in the owning session |
| `poll` (300 s, 24 polls) | a background watcher on a cheap model | 3 watcher tool calls per poll, 36 an hour, for at most 2 hours | the watcher's report, then one full read |
| `both` (default; 900 s, 32 polls) | a comment, and a slow poll that catches a missed one | 4 watcher tool calls per poll (the 900 s wait is two calls), 16 an hour, for at most 8 hours | one full read; a poll that sees the same batch adds a read that finds nothing |
| `off` | you tell the agent to read the board | none | one full read |

Each watcher tool call is a model turn, and the watcher's context grows over its run. The figures count calls,
not measured tokens. When a watcher reaches its poll limit it stops, and no new watcher starts until you ask the
agent to watch again; the status strip then shows that the window ended. The strip shows the window of the
last watcher the agent started; it does not prove that the watcher still runs. A page published before version
0.9.0 cannot post comments: the agent republishes it ("Change the page" in `references/build.md`).
```
- "Layout": the `scripts/board.mjs` line gains `status`, `watch` in its command list, after `ack`.

`docs/how-it-works.html`: replace the whole `<p>` that starts `Between steps 3 and 4` (whatever text A, B and C2
left in it) with exactly:

```html
<p>Between steps 3 and 4 the config's wake mode decides how the agent learns of a Send. In <code>comment</code> mode Send also posts a short comment to Claude, which wakes the session that owns the board; the agent resolves that comment and reads the board. In <code>poll</code> mode a cheap background watcher polls the board, and the script counts its polls and tells it when to stop. <code>both</code>, the default, does the two, with a slow poll that catches a missed comment. In <code>off</code> mode nothing pushes the agent: tell it to read the board. Either way the agent then reads the batches itself, and it also reads at the start of each session that owns the board. A batch waits until the agent marks it handled, so a phone with a wrong clock cannot hide one.</p>
```

## 7. Tests

`tests/board-test.mjs` (every config sets `tz`, as A requires; `BOARD_NOW` as the fixture, `2026-02-01T12:00:00Z`;
the state is made with `check --url https://claude.ai/artifact/test-board` unless a case says otherwise; a test may
hold that literal link, the egress test reads only the shipped scripts):
- `watch: poll starts one watcher, writes the watch file and the status window, and prints the filled brief` —
  config `wake: {mode: "poll"}`, tz `UTC`: the first line is
  `wake poll: start one watcher, every 300 s, at most 24 polls, until 2026-02-01T14:00:00+00:00. Pass the array below to P3, then start P6 with the lines between "--- brief" and "--- end" as its prompt.`;
  then `--- brief`; the brief lines hold `ToolSearch("select:ArtifactData")`, the `P4` JSON with
  `"url":"https://claude.ai/artifact/test-board"`, `"out_dir":"<abs board>/watch-dump"` and
  `"where":[["status","==","sent"]]`, and `waiting --dump "<abs board>/watch-dump" --count "<abs board>/watch.json"`;
  they hold no `<P4>`, `<SCRIPT>`, `<DUMP>` or `<COUNT>`; then `--- end`; then one write
  `{op: "set", collection: "meta", doc_id: "status"}` whose out file has `watch` deep-equal
  `{started: "2026-02-01T12:00:00+00:00", until: "2026-02-01T14:00:00+00:00"}`; `board/watch.json` parses to
  `{dump: <abs watch-dump>, seconds: 300, limit: 24, poll: 0, started: ..., until: ...}`; no comments line.
- `watch: both uses 900 s and 32 polls by default, the config values when set, and prints the comments line` —
  `wake: {mode: "both"}` -> `every 900 s, at most 32 polls, until 2026-02-01T20:00:00+00:00`, and the line after
  `--- end` is `comments: if this session has not run P5 for this board yet, run it now.`;
  `wake: {mode: "both", poll_seconds: 600, poll_limit: 6}` -> `every 600 s, at most 6 polls, until 2026-02-01T13:00:00+00:00`.
- `watch: a running watcher is not started again` — after the poll case, with the db write applied, `watch` again:
  `wake poll: a watcher runs until 2026-02-01T14:00:00+00:00; start none.` and `no writes`.
- `watch: after a batch report or a dead watcher a new one starts` — set `reported: true` in `watch.json` (as
  `waiting --count` does): `watch` starts one (the `start one watcher` line); then, with `BOARD_NOW` 3 hours later
  and no `reported`, `watch` starts one too.
- `watch: at the poll limit it ends the window once and starts none; only watch --restart starts a new one` —
  after the poll case (db write applied), set `poll: 24` in `watch.json`, `BOARD_NOW=2026-02-01T14:05:00Z`: `watch` prints
  `wake poll: the watcher window ended at its poll limit; start none. Start a new one only when the operator asks you to watch again: node <SELF> watch --restart. Read the board when the operator asks.`
  and one `meta/status` write whose `watch.until` is `2026-02-01T14:05:00+00:00` (pinned to the state's version);
  `watch.json` holds `ended: true`. Apply the write; then `watch` again prints exactly that one line, then `no writes`,
  and `watch.json` is byte-equal to before. Then `sync` of the fixture file and an `ack` of the fixture batch (each
  with its write applied): `watch.json` is still byte-equal, and `watch` still prints that line and `no writes`.
  Then `watch --restart` prints the `wake poll: start one watcher, every 300 s, at most 24 polls, until 2026-02-01T16:05:00+00:00. ...`
  line and the brief, and one `meta/status` write whose `watch` deep-equals
  `{started: "2026-02-01T14:05:00+00:00", until: "2026-02-01T16:05:00+00:00"}`; `watch.json` has `poll: 0` and no
  `ended`. In mode `both` the limit line ends `A comment on the board still wakes you.` and the comments line follows.
- `watch --restart: before until at the limit it starts one; with a running watcher it starts none` — after the
  poll case, `poll: 24` in `watch.json` and `BOARD_NOW=2026-02-01T13:58:00Z` (before `until`): `watch --restart`
  prints the `start one watcher` line with `until 2026-02-01T15:58:00+00:00`. A fresh poll case (`poll: 0`, same
  `BOARD_NOW` as it): `watch --restart` prints `wake poll: a watcher runs until 2026-02-01T14:00:00+00:00; start none.`
  and `no writes`. In mode `off`, `watch --restart` prints the `wake off: ...` line and writes nothing.
- `watch: comment and off start no watcher` — exact lines `wake comment: start no watcher; a comment on the board wakes you.`,
  then the comments line, and `wake off: start no watcher. Read the board when the operator asks.`; neither writes
  nor creates `watch.json`.
- `watch: keeps now, next and waiting of the last status` (`status --now "X" --next "Y"`, apply, then `watch` in
  `poll`: the out file holds `now: "X"`, `next: ["Y"]`).
- `watch: refuses without a board URL or with bad wake values` — a state made by `check` without `--url`: exit 1,
  `watch: no board URL in <state>. Run node <SELF> check --url <the artifact link> once, then watch again`;
  `wake: {mode: "poll", poll_seconds: 5}`: exit 1, the lines `config wake.poll_seconds: a whole number from 60 to 86400`
  and ``fix the config, then run `node <SELF> check` ``.
- `check --url stores the link; a link with a space or no https is refused` — `check --url "https://claude.ai/artifact/x y"`
  and `check --url "http://x"` exit 1 with `check --url: the https link of the artifact, with no space or quote`.
- `waiting --count: the script keeps the poll count, removes the dump, and names the next step` — a watch file
  `{dump: <dir>, seconds: 300, limit: 2, poll: 0, ...}` (as `watch` wrote it) and an empty dump folder `<dir>`:
  `sh("waiting", "--dump", dir, "--count", wf)` prints
  `none, poll 1 of 2. Run bash "<abs assets/wait.sh>" 300 in the foreground, then go to step 1.`, `<dir>` no
  longer exists, and `poll` is 1; again (empty dump) ->
  `none, poll 2 of 2: the limit. Report exactly: "no batch, poll limit reached: run node S watch and do what it prints". Then stop.`;
  with a fresh file and the fixture batch `bbbb` in the dump -> `batches b20260103T000000+0000-bbbb wait. Report exactly: "batches wait: run Read and handle the answers". Then stop.`
  and `reported: true` in the file. `--dump` of another folder -> exit 1, `waiting: --dump is not the dump folder of <wf>`;
  a missing watch file -> exit 1, the line starts `waiting: ` and ends `is not a watch file. Report "watch file missing, run node S watch" and stop`.
  A's form without `--count` is unchanged (A's cases pass as they are).
- `check: wake problems` — config `wake: {mode: "sometimes", poll_seconds: 30, poll_limit: 0, x: 1}` on an otherwise
  clean fixture: the lines include, in this order, `problem: config wake: unknown field "x"`,
  `problem: config wake.mode: not one of poll, comment, both, off`,
  `problem: config wake.poll_seconds: a whole number from 60 to 86400`,
  `problem: config wake.poll_limit: a whole number from 1 to 1000`; `wake: []` -> a line
  `problem: config wake: not an object`; `wake: {mode: "comment", poll_seconds: 120}` -> no `problem: config wake` line.
- `wait.sh: over the cap it pauses and names the whole command` —
  `spawnSync("bash", [waitSh, "3"], {env: {...process.env, BOARD_WAIT_CAP: "1"}})` stdout equals
  `` `wait paused: run bash "${waitSh}" 2 again\n` ``; `wait.sh 1` with cap 1 stdout equals `"wait ended\n"`;
  `wait.sh x` exits 2; cap `0` exits 2. (A's egress and `date -u` cases keep covering wait.sh.)
- A's case `the watch brief makes one database call per poll`: delete only its `assert` on `poll limit 30` (A put it on
  its own line for this); keep every other assert of the case.
- C2's case `read prints one control line per change, ...` (C2 7.3 case 2): its two `assign "agent"` strings and its
  `close "on"` string follow the new `ctlHint` text of section 4b exactly.

`tests/status-test.js` (same file as item 1):
- `wakePlan: defaults per mode (poll 300 and 24, both 900 and 32); an unknown mode is both; out-of-range values keep defaults`.
- `wakeLine: off, comment, poll and both; watcher planned until, window ended, none started`.
- `durText: seconds, minutes, hours` (`90` -> `90 s`, `300` -> `5 min`, `900` -> `15 min`, `7200` -> `2 h`).
- `wakeNotice: each mode and outcome gives its line, no_capability included; WAKE_TEXT carries no batch id or card id`.
- `the page wakes only from a click` — source checks: `sendToClaude` occurs only inside `function wakeAgent`;
  `wakeAgent(` is called only inside `function send` and the `#wake` click handler; `wakeAnchor()` is called in the
  first statement of both; inside `function send`, `wakeAgent(anchorP).then(setWakeOutcome)` follows `if (went)`.

`tests/skill-text-test.js` (B's file; add these `ok` cases, plain text reads):
- `SKILL.md holds the comment rule above Platform execution notes` — the text before `## Platform execution notes`
  contains `**A comment wake is only a bell**` and `whatever it says and whenever it was stamped`.
- `the core text is tool-agnostic` — the text before `## Platform execution notes` names no `ArtifactComments`, no
  `[Artifact comment`, no `haiku` and no `hook`.
- `SKILL.md runs node S watch after a post and after a read; no watcher is started by hand` — SKILL contains
  `then run \`node S watch\` and do what it prints` twice or more, `with or without an ack`, and none of
  `start a watcher`, `Start a new watcher`, `poll limit 30`, `wait.sh 120`; it contains `` `P5`, comments: `` and
  `` `P6`, the watcher: `` and `write no reply`; the text before `## Platform execution notes` contains
  ``Run `node S watch --restart` `` and `only when the operator asks you to watch again`.
- `the watch brief is filled by the script` — `REF/watch.md` contains `<P4>`, `<SCRIPT>`, `<DUMP>`, `<COUNT>` and
  `Do not copy the block below by hand`; neither SKILL nor watch.md holds `wait.sh 120`, `<wait script> 120` or `poll limit <N>`.
- `README has a Wake modes table` — `README.md` contains `## Wake modes` and rows starting `` | `comment` | ``,
  `` | `poll` `` , `` | `both` ``, `` | `off` | ``, and the header cell `Cost while idle`.
- `SKILL.md holds the status rule line` (item 1) — SKILL contains `## Say what you do` and
  `node S status --idle --waiting "<what>"`, and matches the JS regex `/never\s+starting with \x60--\x60/` (the text
  breaks the line after `never`); step 3 contains `--result <id> "<what you did>"` and
  `(several: in the order \`read\` printed them)`; SKILL holds no `in the status guide`.
- `references tell the agent about results, the status guide and the comments capability` — `REF/cards.md` contains
  `--close <id> --result <id> "<what you checked>"`; `REF/guides.md` contains `` `status.guide` `` and
  `A status guide uses the id`, and neither `Update it after each batch you handle.` nor `Use the id`; `REF/data-model.md` has rows starting `` | `status` | `` and `` | `wake` | ``
  and its Access rules block parses with `"comments"` deep-equal `{}`; `REF/build.md` contains `node S check --url URL`.

`tests/cuts-test.js`: no change for item 2 (A's wait.sh cases keep passing on the new file).

Acceptance mapping:

| Criterion | Covered by |
|---|---|
| Each mode works from config, with no edit to the brief | board-test `watch` cases, `waiting --count`, `check: wake problems`; skill-text-test `the watch brief is filled by the script`; status-test `wakePlan`, `wakeNotice`; maintainer check M-1 |
| A comment wake always ends in a full read, shown by a test or a hook | skill-text-test comment-rule and tool-agnostic cases (no hook ships: operator answer `wake-modes-hook`); maintainer check M-1 |
| The README states the token cost of each mode | skill-text-test README case (rows and the cost column) |

## 8. Steps (in order)

Each step ends with tests green unless it says otherwise.

D-0. **Name check.** Pre: clusters A, B, C1 and C2 merged; tests green. From the plugin root run:
     ```sh
     while IFS='|' read -r f n; do
       c=$(grep -cF -- "$n" "$f" 2>/dev/null || true); [ "${c:-0}" -gt 0 ] || echo "MISSING in $f: $n"
     done < <(sed 's/^ *//' <<'LIST'
     skills/decision-board/scripts/board.mjs|export const FLAGS = {
     skills/decision-board/scripts/board.mjs|export const COMMANDS = {
     skills/decision-board/scripts/board.mjs|check: ["state"],
     skills/decision-board/scripts/board.mjs|waiting: ["dump"],
     skills/decision-board/scripts/board.mjs|ack: ["state", "dump", "close"],
     skills/decision-board/scripts/board.mjs|const waiting = (dump) =>
     skills/decision-board/scripts/board.mjs|function cmdWaiting(a, log)
     skills/decision-board/scripts/board.mjs|r.logHandled(dump, log)
     skills/decision-board/scripts/board.mjs|r.put("update", "batches", bid, { status: "handled", handled_at: t }, 1, "batches/" + bid)
     skills/decision-board/scripts/board.mjs|already handled
     skills/decision-board/scripts/board.mjs|const j = r.openCards(Array.from(toOpen), t);
     skills/decision-board/scripts/board.mjs|cards closed, ${j} reopened. The answers go to decisions.md when the next read no longer lists the batch
     skills/decision-board/scripts/board.mjs|mark a batch handled, apply its controls, and close cards
     skills/decision-board/scripts/board.mjs|function ctlHint(c, e, flags)
     skills/decision-board/scripts/board.mjs|leave the card open and say what you did in your reply)
     skills/decision-board/scripts/board.mjs|if you cannot, leave the card and say why in your reply)
     skills/decision-board/scripts/board.mjs|if (raw.controls !== undefined) {
     skills/decision-board/scripts/board.mjs|doc.rev = old ? old.rev + (content || back ? 1 : 0) : 1;
     skills/decision-board/scripts/board.mjs|const MANAGED = ["rev", "created", "updated"
     skills/decision-board/scripts/board.mjs|P2 meta with versions
     skills/decision-board/scripts/board.mjs|if refused: rm -rf
     skills/decision-board/scripts/board.mjs|pinned(op, collection, id, data, dumped, also)
     skills/decision-board/scripts/board.mjs|export const CONFIG_KEYS = Object.keys(P.DEFAULTS)
     skills/decision-board/scripts/board.mjs|r.load.config
     skills/decision-board/scripts/board.mjs|function rel(file)
     skills/decision-board/scripts/board.mjs|const HERE = path.dirname(fileURLToPath(import.meta.url));
     skills/decision-board/scripts/board.mjs|const now = () => P.stampIn(nowMs(), P.cfg.tz, false);
     skills/decision-board/scripts/board.mjs|lingerOf: () => ""
     skills/decision-board/assets/board.html|function clockMs() { return Date.now(); }
     skills/decision-board/assets/board.html|function nowStamp() { return stampIn(clockMs(), cfg.tz, true); }
     skills/decision-board/assets/board.html|function stampMs(
     skills/decision-board/assets/board.html|function stampIn(
     skills/decision-board/assets/board.html|function cardState(it) {
     skills/decision-board/assets/board.html|if (ctlOf(it).assign === "other") return "hidden";
     skills/decision-board/assets/board.html|function saveControls(id, patch) {
     skills/decision-board/assets/board.html|function saveResponse(id) {
     skills/decision-board/assets/board.html|setCtlDay(today);
     skills/decision-board/assets/board.html|<section id="due" class="due" hidden aria-label="Due today"></section>
     skills/decision-board/assets/board.html|renderDue(dueList(list, today), today);
     skills/decision-board/assets/board.html|function renderDue(
     skills/decision-board/assets/board.html|.dot {
     skills/decision-board/assets/board.html|c.changed = h("div", { class: "changed", hidden: true });
     skills/decision-board/assets/board.html|if (s.r.length + s.n.length + s.c.length) return sendGroup(s);
     skills/decision-board/assets/board.html|x.stage === "mark"
     skills/decision-board/assets/board.html|Promise.all([db.doc("meta/board").get(), db.doc("meta/config").get()])
     skills/decision-board/assets/board.html|db.doc("meta/config").onSnapshot(
     skills/decision-board/assets/board.html|window.claude.use("db").then(start, function () { start(null); });
     skills/decision-board/assets/board.html|$("settings").hidden = !cfg.settings;
     skills/decision-board/assets/board.html|people: [],
     skills/decision-board/assets/board.html|// ---- quick controls
     skills/decision-board/assets/board.html|// ---- visibility
     skills/decision-board/assets/board.html|function normConfig(raw)
     skills/decision-board/SKILL.md|3. Pass the array to `P3`, then start a watcher.
     skills/decision-board/SKILL.md|poll limit 30
     skills/decision-board/SKILL.md|(several: in the order `read` printed them)
     skills/decision-board/SKILL.md|update the status guide if the board has one.
     skills/decision-board/SKILL.md|and say so under "Done" in the status guide.
     skills/decision-board/SKILL.md|`assets/wait.sh 120` in the foreground with a Bash timeout of 600000 ms.
     skills/decision-board/SKILL.md|## Platform execution notes
     skills/decision-board/references/watch.md|poll limit <N>
     skills/decision-board/references/build.md|Run `node S check` and pass the array.
     skills/decision-board/references/cards.md|then add --close <id> to the ack of that batch.
     skills/decision-board/references/guides.md|Update it after each batch you handle.
     skills/decision-board/references/data-model.md|{"db": {"rules": [{"path": "", "read": "view", "write": "owner"}]}}
     skills/decision-board/references/data-model.md|`people`
     skills/decision-board/assets/wait.sh|echo "wait ended"
     docs/how-it-works.html|Between steps 3 and 4
     tests/board-test.mjs|the watch brief makes one database call per poll
     tests/board-test.mjs|poll limit 30
     tests/board-test.mjs|SKILL.md stays short
     tests/board-test.mjs|const ok2 = 
     tests/board-test.mjs|const ctlBatch = 
     tests/skill-text-test.js|ok(
     tests/_page.js|lingerOf
     .claude-plugin/plugin.json|"version": "0.8.0"
     LIST
     )
     ```
     Run it in bash, copied without its five-space indent (the closing `LIST` must start its line). Each line is
     `<file>|<exact text>`; the quoted `'LIST'` keeps the backticks and `$` literal.
     Also read `function cmdAck`, `function cmdSync`, `function cmdWaiting` and the function that maps a printed
     group to its `<calls>` text (it holds `P2 meta with versions`) in `SCRIPT`, and `function send(` in `PAGE`.
     Evidence: the loop prints no `MISSING` line. If it prints one, or a function has another argument list than
     quoted here, STOP: change nothing and report the missing name and its grep. Do not guess a replacement.
D-1. **SCHEMA, config defaults, plan.** Pre: D-0. Do: the SCHEMA entries of item 1 section 2 (with `wake` and
     `wakeModes`), `intIn`, `wakePlan`, `DEFAULTS.status`, `DEFAULTS.wake`, the two `normConfig` lines. Create
     `tests/status-test.js` with the `wakePlan` and `coerce status` cases. Evidence: `node tests/status-test.js`
     exits 0; tests green (B's computed `config default:` lines and `checkFields()` take the new keys by themselves).
D-2. **Page pure functions.** Pre: D-1. Do: `ageText`, `durText`, `wakeLine`, `statusView`, `cardChanged`, `seenOf`,
     `seenFrom`, `dotOn`, `wakeNotice`, `WAKE_TEXT` in the `// ---- agent status` section. Add the status-test cases
     of both items except the source-check cases (those come with D-10 and D-11).
     Evidence: `node tests/status-test.js` exits 0 and prints each case name; tests green.
D-3. **Script: check.** Pre: D-1. Do: `statusProblems` and `wakeProblems`, both pushed in `cmdCheck` directly after
     C2's `controls` problems, `statusProblems` first; `check --url` and its `FLAGS` and USAGE line. Add board-test
     `check: status problems`, `check: wake problems`, `check --url stores the link ...`.
     Evidence: board-test exits 0 and contains the three case names.
D-4. **Script: status.** Pre: D-3. Do: `has`, `storedStatus`, `statusDoc`, `putStatus`, `cleanText`, `cmdStatus`, its
     `FLAGS` line, `COMMANDS`, `SWITCHES` `idle`, USAGE (the status line, the `meta/status` keys in `adopt` and `push`).
     In the function that maps a group to `<calls>`: make the group `meta/status` give `P2 meta with versions`, as
     `meta/config` does (if it tests `group === "meta/config"`, make it `group === "meta/config" || group === "meta/status"`;
     if it maps by the collection `meta`, change nothing). Add the board-test `status: ...` cases.
     Evidence: board-test exits 0 and contains every `status: ` case name; A's cases "every command has one FLAGS line"
     and "no command takes --agent" pass with `status` in `COMMANDS`.
D-5. **Script: ack --result, the status guide line, the control hints.** Pre: D-4. Do: the `ack` changes of item 1
     section 4 (validation, both branches, `k + j + m > 0`, the printed line), `statusGuideLine`, the `cmdGuide` line,
     the `FLAGS.ack` and USAGE change, and section 4b below. Update C2's board-test strings: every
     `cards closed, <j> reopened. The answers go` becomes `cards closed, <j> reopened, 0 results. The answers go`
     (A's ack case and C2 cases 3 and 9; `<j>` as each case has it), and C2 case 2's hint strings per 4b. Add the
     board-test `ack --result: ...` cases, `ack: a batch whose only effect is a dismiss undo ...` and
     `the status guide line shows only when the config turns it on`.
     Evidence: board-test and loss-test exit 0.
D-6. **Script: sync.** Pre: D-5. Do: the `sync` changes of item 1 section 4. Add the two `sync:` result cases. Evidence: board-test exits 0; refresh-test exits 0.
D-7. **Script: watch, waiting --count, watch.md.** Pre: D-6. Do: replace `REF/watch.md` whole (item 2 section 6);
     `WAIT_SH`, `watchFile`, `readWatch`, `COMMENTS_LINE`, `briefText`, `cmdWatch` with its `FLAGS` line
     (`["state", "restart"]`), `"restart"` in `SWITCHES`, `COMMANDS` and USAGE line (`watch [--restart]`);
     `cmdWaiting` and `FLAGS.waiting`. `cmdSync` and `cmdAck` get no watch-file code. Add the board-test
     `watch: ...`, `watch --restart: ...` and `waiting --count: ...` cases.
     Evidence: board-test exits 0 (A's "the watch brief makes one database call per poll" included, its
     `poll limit 30` assert still passing on the unchanged SKILL); `grep -n "https://" skills/decision-board/scripts/board.mjs`
     prints nothing; the bodies of `function cmdSync` and `function cmdAck`, read whole, hold neither `watchFile`
     nor `watch.json`.
D-8. **wait.sh.** Pre: none after D-0. Do: the full file of item 2 section 4. Add the board-test `wait.sh:` case.
     Evidence: board-test and cuts-test exit 0 (A's `date -u` and egress cases included).
D-9. **Page: the strip.** Pre: D-2. Do: item 1 section 5 render items 1 to 6 (HTML, CSS, globals, reads, `renderNow`
     with its `Mark all seen` button wired to `markAllSeen` from D-10, the interval). Evidence: tests green
     (render-test with its unchanged HTML site list; A's clock cuts-test).
D-10. **Page: result line, dot, seen marking.** Pre: D-9. Do: item 1 section 5 render items 7 to 11 (`dotCount`,
     `markAllSeen`, `seenOne`, the first-visit line, the two `seenOne(id);` lines). Add the status-test case
     `the dot clears on Mark all seen ...` and the render-test result case. Evidence: tests green.
D-11. **Page: wake.** Pre: D-10. Do: item 2 section 5 DOM items 1 to 12. Add the status-test case
     `the page wakes only from a click`. Evidence: tests green; `grep -n "Date.now()" PAGE` prints only the `clockMs`
     line; `grep -n "innerHTML" PAGE` shows only the three known sites.
D-12. **Text.** Pre: D-7, D-11. Do: every `SKILL` edit of both items (item 1 section 6, item 2 section 6), and
     `REF/data-model.md`, `REF/cards.md`, `REF/guides.md`, `REF/build.md`, `README.md`, `docs/how-it-works.html` per
     the same sections; delete the `poll limit 30` assert of A's board-test case (item 2 section 7); add the
     `tests/skill-text-test.js` cases of both items and the cuts-test case of item 1.
     Evidence: tests green; `wc -c skills/decision-board/SKILL.md` prints at most 8000 (expected about 7675 and the `watch --restart` sentence). If it
     prints more than 8000: move the "Guides" section of `SKILL` (its two numbered steps and its last sentence) whole to
     the top of `REF/guides.md` under a heading `## Post a guide`, and put in its place in `SKILL` exactly
     `## Guides` + blank line + `` To post, archive or delete a guide, read `references/guides.md`, "Post a guide", and follow it. ``;
     then measure again; never raise the limit. board-test "artifact-capabilities is named once, in P1" passes (D names
     it nowhere); from the repository root `python3 scripts/validate-skills.py` exits 0; the SKILL description is unchanged.
D-13. **Version.** Pre: D-12. Set `.claude-plugin/plugin.json` `version` from `0.8.0` to `0.9.0`. Evidence:
     `grep -n '"version": "0.9.0"' .claude-plugin/plugin.json` prints one line; tests green; the validator exits 0.
D-14. **Review.** Pre: D-13. A reviewer reruns the suite, checks every acceptance row of both items against a named
     test, greps the diff for `curl|wget|https?://` (only documentation links, test literals and `example.com` hosts),
     confirms no `hooks/` folder was added, and runs `git status`: changes only under `plugins/decision-board/`, no file
     under `board/`. The PR description lists the checks for the maintainer (below) as open.

### 4b. `ctlHint` (C2 4.1), the two hints that report

Operator answer `item-controls-assign-agent` (the agent leaves the card open with a short result line) and C2
"Needs ... D": in `function ctlHint(c, e, flags)` replace, in the `close "on"` hint, the tail
`; if you cannot, leave the card and say why in your reply)` by
`; if you cannot, add --result ${qid(e.id)} "not closed: <why, in a few words>" to it instead)`, and in both
`assign "agent"` hints the tail `; leave the card open and say what you did in your reply)` by
`; leave the card open and add --result ${qid(e.id)} "<what you did, in a few words>" to the ack line)`.
Example lines (C2's `tracker-7` card): `  tracker-7  control close "on"  (close item "tracker" "7" "https://example.com/t/7" in its source with the operator's own tool for it; change nothing else there; then add --close tracker-7 to the ack line; if you cannot, add --result tracker-7 "not closed: <why, in a few words>" to it instead)`
and `  tracker-7  control assign "agent"  (do the work the card asks; in a source change only item "tracker" "7" "https://example.com/t/7"; leave the card open and add --result tracker-7 "<what you did, in a few words>" to the ack line)`.

### Checks for the maintainer (after D-14; not implementer steps)

On a new private test artifact published from the changed page with `P1` (capabilities with `"comments": {}`), or the
built-in browser preview with the stub database (see "Who runs what"); never a board in use under
`board/`. Record pass or fail for each:
- R-1 to R-3 (item 1 section 7).
- R-4 a card with `result` in the Done group shows its result line; a Not ours card shows no dot.
- W-R1 the Wake button and the notice under Send at 360 px; the strip's wake line for `both` with a planned and an
  ended window.
- M-1 (a live owning session and a real phone; mode `both`): Send -> the session gets a turn headed
  `[Artifact comment sent to Claude]`, resolves the thread, writes no reply, runs the full read, then `node S watch`;
  a second Send writes into the same thread even though it was resolved (or the `not_found` branch makes a new one)
  and wakes the session again. Mode `comment` with the session gone -> the notice "No agent session takes comments
  here ...". Mode `off` -> its notice. A page published without `comments` -> the `no_capability` notice. Note
  whether `sendToClaude` after the awaited batch write still counts as the Send gesture; if it rejects
  `claude_unavailable`, the Wake button must appear and work. A watcher started by `watch` polls, waits, and after its
  limit reports the line that names `node S watch`; the next `watch` ends the window and starts none, and prints
  the line that names `watch --restart`; after the operator asks the session to watch again, it runs
  `node S watch --restart` and a new watcher starts.

---

## Cluster calls, needs, unverified

## Calls made

- C1. `meta/status` has no `agent` field: one agent per board (cluster A); the scoping's Additions say "`meta/status` is the path".
- C2. The agent writes the status through a script command (`status`), not hand-typed JSON: the script enforces the
  line, count, size and plain-text rules and stamps `updated` in config tz.
- C3. `status` and `watch` write `meta/status` with `r.pinned` (the state key `meta/status`): ArtifactData refuses an
  unpinned write of an existing document (A Call 29, and the tool schema), so the first draft's "no `if_version`" and its
  `adopt meta/status` refusal are gone. One writer still holds: the pin comes from the state, no read first; a refusal
  takes A's printed `if refused:` line and the generic `adopt` path.
- C4. Lines at most 60 characters, next at most 3, and a 500-byte check that counts a watch of two stamps: the
  scoping says "under 500 bytes"; 60-character ASCII lines with a watch reach about 460 bytes. The end of a window
  overwrites `until` instead of adding a field, so the bound holds.
- C5. A result line is dropped when the card's `rev` rises, C2's `back` return included (the compare is `doc.rev`
  against `old.rev`), and `sync` says how many.
- C6. A new `--now` (not `idle`) clears `waiting` first, then an explicit `--waiting` in the same call applies;
  `--idle` keeps `waiting`; `--now idle` equals `--idle`.
- C7. The agent-changed dot compares the card's `updated` as instants (`stampMs`), not text and not `rev`. A first
  visit sets the baseline and shows no dot. The seen map is a null-prototype object, so no id is special. A card in
  Done or Not ours shows no dot (C2 "Needs ... D").
- C8. The page writes every wake into one thread stored in `meta/wake`: the thread limit warns against a thread per
  Send. The anchor is built at gesture time (R2 `anchorFor`). The agent resolves the thread after each wake; whether a
  later `sendToClaude({threadId})` into a resolved thread still wakes the session is checked in M-1 (U3), and the
  `not_found` branch makes a new thread.
- C9. No extra fallback control where `sendToClaude` is missing: the `both` poll covers a missed wake; the Wake
  button covers the gesture, consent and rate cases.
- C10. Default mode `both`: the scoping says "This is the default".
- C11. No database write per watcher tick: cheap-reads criterion 1 ("One tick makes one database call when nothing
  waits"). The poll count lives in the local `board/watch.json`, written by `waiting --count` (a file write, not a
  database call).
- C12. `wait.sh` splits long waits itself and prints the whole next command (`run bash "<path>" <n> again`): the Bash
  foreground timeout is 600 s, and a cheap model does no arithmetic and fills no path. It prints no time (cluster A).
- C13. The comment rule lives in `SKILL` core text in tool-agnostic words; the header string, the watch call, the
  resolve and the watcher model go to *Platform execution notes* (AGENTS.md skill rule 5).
- C14. `watch` makes every watcher judgment: start, running, ended,
  the filled brief, the comments line, the status window. It has no `--started` flag: it writes the window when it
  tells the agent to start the watcher, and the agent passes that array.
- C15. The page reads `meta/status` and `meta/wake` by their own doc listeners, like `meta/board` and `meta/config`.
- C16. The strip is shown once the config loads, with V1 when no document exists: the wake line is useful on its own.
- C17. A watcher that exits early, or a dead session, still shows a planned window up to `until`: the wording says
  "planned", and the README says the strip proves nothing. After `until`, with the poll limit not reached, `watch` starts a new watcher; after the poll limit only `watch --restart` does (C39).
- C18. `ack --result` is validated before the "already handled" branch and stores results there too, so a rerun
  after a lost reply loses nothing.
- C19. Wake values are validated whenever present, in every mode, by `check` and by `watch`.
- C20. The comment wake also runs after a `mark`-stage send failure: the batch went out. No wake when no batch write
  went out (`went`), so a Send with nothing to send wakes nobody.
- C21. The out-file cleanup for `meta/status` needs no change: cluster A removed the `meta` exception in `finish()`.
- C22. A plain wake notice clears after 30 s; a notice that shows the Wake button stays until the next press.
- C23. The artifact link is stored by `check --url` in the state (git-excluded `board/`), so `watch` can fill the
  watcher's `P4` call; a board made before this cluster gets the exact command from `watch`'s refusal.
- C24. The watch brief stays in `REF/watch.md`, now a template that only the script reads and fills; A's brief test
  keeps reading it. The agent never copies it by hand.
- C25. A page published without the comments capability shows the `no_capability` notice on Send, which tells the
  operator to have it republished. The script cannot know the published capabilities, so
  `watch` prints no republish line (rejected part of that finding).
- C26. Shell text guard: `status` and `ack --result` clean a
  text instead of refusing it (`cleanText`: line breaks to a space, `"` to `'`, `$` and backtick dropped, cut to the
  limit with `...`), print what they stored, and refuse only an empty text; SKILL says "plain words", the 60-character
  limit and "never starting with `--`" (a `parseArgs` limit; `--now=<text>` is not added, as it would change
  `parseArgs` for every command).
- C27. Operator answer `agent-status-strip-place`: the strip `#agentnow` is first at the top, directly before C1's
  `#due` (Due today) and so above `#blocked`.
- C28. Operator answer `agent-status-seen`: the dots clear on a `Mark all seen` tap (a button in the strip body,
  shown while a dot shows); one card's dot also clears when the operator answers it or changes a control on it
  (`seenOne` at the start of `saveResponse` and `saveControls`). No marking on leaving the page.
- C29. Operator answer `agent-status-status-guide`: the status guide is optional and off by default; the config key
  `status.guide` (any layer, never a page control) turns it on, and then `ack`
  and `guide --archive`/`--delete` print the exact `status guide:` line; SKILL names the guide nowhere.
- C30. Operator answer `agent-status-watcher-tick`: no poll time on the page; the strip shows the planned watcher window.
- C31. Operator answer (`last heard 2 h ago`): the exact time is the `title` of the age text, set by the page.
- C32. Operator answer `wake-modes-defaults`: poll mode 300 s for 2 h (24 polls); both mode 900 s for 8 h (32 polls).
- C33. Operator answer `wake-modes-reply`: after a comment wake the agent resolves the thread, writes no reply, and
  runs the full read.
- C34. Operator answer `wake-modes-send-posts`: Send posts the wake comment (`sendToClaude`), with a fallback
  `Wake the agent` button; the composer variant is removed.
- C35. Operator answer `wake-modes-hook`: no hook ships; section 6b, its tests, M-2 and the hook lines are removed.
- C36. Operator answer `wake-modes-wording`: the visible strings table holds the listed defaults.
- C37. Operator answer `wake-modes-limit-reached`: the watcher stops at its limit and reports a line
  that names `node S watch`; that `watch` sets `until` to the end time once, so the page shows "watcher window
  ended <time>", and starts no new watcher; what starts the next one is call C39.
- C38. No setting is a page control: `status` and `wake` are config keys only.
- C39. Operator answer `wake-limit-restart`: option C, "Only when I ask". After a watcher reached its
  poll limit nothing restarts it by itself: the drafted `clearEnded` helper and its two call sites (in `cmdSync` and
  in the handled-write branch of `cmdAck`) are removed, so `sync` and `ack` never touch `board/watch.json`. A new
  window starts only when the operator tells the agent to watch again, through `node S watch --restart` (a
  `SWITCHES` flag, its `FLAGS` and USAGE entries, one SKILL sentence in "Watch for answers", board-test cases). A
  plain `watch` after an ended window prints one fixed line that says the window ended and names `watch --restart`,
  and writes nothing. README: no new watcher starts until you ask the agent to watch again. The page text for an
  ended window (V10) stays. Implementation call within that answer: `--restart` skips only the limit branch; with a
  watcher that still runs, or in `comment` or `off`, it does what a plain `watch` does, so it never starts a second
  watcher beside a live one; the running branch tests `cur.poll < cur.limit`, so a restart before `until` starts one.

## Needs from other clusters

- A, B, C1, C2: nothing beyond their final specs. Step D-0 greps every name this spec uses and stops on a miss.
  D adds the `FLAGS` lines `status` and `watch` and the flags `check --url`, `waiting --count`, `ack --result`
  (A's extension point); the state keys `status` and `url`, which A's older-state refusal keeps; the batch shape is
  unchanged. D calls only A's clock helpers outside the page's pure part. D edits C2's `ack`, `ctlHint` hints and the
  C2 board-test strings that quote them, as C2 "Needs ... D" asks.
- No earlier spec has to change for D to work.
- Maintainer: the checks after D-14 run on a test artifact or preview, never on a board in use.

## Unverified

- U2. How long "the viewer's own recent gesture" lasts for `sendToClaude` after the awaited batch write. M-1; the
  Wake button covers a miss.
- U3. Whether `sendToClaude({threadId})` into a thread the agent resolved still posts and wakes the session. M-1
  (second Send). The `not_found` branch makes a new thread; any other rejection gives the `unavailable` notice.
- U4. How a comment wake appears in the Claude Code CLI (the header string `[Artifact comment sent to Claude]` is
  known for cloud sessions).
- U5. README cost figures count tool calls, not measured tokens.
- U7. Whether an anchor built at the start of the click still positions the comment correctly after the batch write
  (geometry may move when the notice line appears). M-1.
- U8. The SKILL size after D (about 7675 characters) is an estimate from C2's estimate (about 7144) plus the
  measured length of D's insertions and removals; D-12 measures the real file and names the fallback.
- U9. That `ArtifactComments` `resolve` accepts the thread that a page's `sendToClaude` made as "activated for
  Claude" (the schema says activation comes from Send to Claude, which `sendToClaude` mirrors). M-1.
- U10. That the shape of A's group-to-`<calls>` mapping is a test on `meta/config` or on the collection: D-4 gives
  both edits; D-0 reads the function first.
- No code was run. The function bodies are untested designs, to be proved by the tests listed.

