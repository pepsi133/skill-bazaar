---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Cluster C1 spec: draft-field, due-dates, grouping

Plugin root: `plugins/decision-board/` (paths below are relative to it unless they start with `/`).
Short names, as in the A and B specs: `PAGE` = `skills/decision-board/assets/board.html`,
`SCRIPT` = `skills/decision-board/scripts/board.mjs`, `SKILL` = `skills/decision-board/SKILL.md`,
`REF` = `skills/decision-board/references/`.

`REFRESH` = `skills/board-refresh/scripts/refresh.mjs`, `RSKILL` = `skills/board-refresh/SKILL.md`,
`RREF` = `skills/board-refresh/references/` (new in this cluster).

This spec is final: every operator question of this cluster is answered (see "Calls made", "operator answer"),
and no step carries an open marker.

Preconditions for every step: clusters A and B landed exactly as the final `roadmap/in-progress/decision-board-spec-a-core.md` and
`roadmap/in-progress/decision-board-spec-b-config.md` say, step C1-N0 (the name check, section 0 below) passed, and
`for t in tests/*-test.js tests/*-test.mjs; do node "$t" > /dev/null || echo FAIL "$t"; done` (run from the plugin
root; "all tests" below) prints nothing.

Cluster A facts this spec builds on (from the final `decision-board-spec-a-core.md`):
- one `cards/main` document, card key = card id, no `agent` on items;
- the page section `// ---- time` (placed before `// ---- board config`) holds `zoneParts(ms, tz)` (2-digit strings,
  year 4, an hour `"24"` read as `"00"`), `stampMs(v)`, `cmpStamp(a, b)`, `dayIn(ms, tz)`, `addDays(day, n)`;
  `realDate(v)` stays in `// ---- links, tags and the first ask of a card`; `cfg.tz` is the normalised zone, default
  `DEFAULTS.tz = "Europe/Warsaw"`;
- outside the pure part the page reads the device clock only through the four clock helpers `clockMs()`,
  `nowStamp()`, `idStamp()`, `savedTime()`; A's cuts-test "page times come only from the time section and the clock
  helpers" bans `Date.now(`, `new Date(` (other than `new Date(Date.UTC(`), `.toISOString(` and the local-clock
  getters everywhere else in the page. So this cluster calls `clockMs()`, never `Date.now()`;
- A's `sortedItems` compares `created` with `cmpStamp`; this cluster replaces it by `cardCmp(cfg.sort)`;
- render-test's `load(...)` cut list is
  `cut("  function h(tag, attrs)", "  function fmt(s)") + cut("  function set(s)", "  // ---- cards. Every DOM id") + cut("  function renderMeta", "  function updateCard")`,
  and every `P.applyConfig(...)` of render-test sets `tz: "UTC"`;
- `FLAGS` has one line per command; this cluster adds no command and no flag to `SCRIPT`, so it changes no `FLAGS` line;
- `batchDoc` reads each list as `s.x || []` and the older-state refusal accepts unknown state keys; this cluster adds
  no batch list and no state key, so neither matters here;
- the page footer `#foot` holds A's `#zone` first and B's `#settings` after it; this cluster does not touch it;
- no test pins an exact count, an exact full key list or a key position; every config a test writes sets `tz`;
  no test depends on a default value that the operator may change (`DEFAULTS.tz`; here also `DEFAULTS.week_start`);
- `REFRESH` after A: `const DEFAULT_TZ = "Europe/Warsaw";`, `readConfig(file)` returns `null` without `--config`, else
  `{ hosts, tags, tz }`; `createdDate(v, tz)`; in `cmdMap`, `const tz = cfg ? cfg.tz : DEFAULT_TZ;`;
- `SKILL` is at most 8000 characters (board-test "SKILL.md stays short") and names `artifact-capabilities` once, at `P1`.

Cluster B facts this spec builds on (from the final `decision-board-spec-b-config.md`):
- `DEFAULTS` ends with `settings: ""` (after `tz`); `export const CONFIG_KEYS = Object.keys(P.DEFAULTS).filter((k) => !WRITTEN_KEYS.includes(k)).concat(SCRIPT_KEYS);`,
  so a key this cluster adds to `DEFAULTS` is known to `check` and to the merge with no edit;
- `Run` applies the merged config of the layers with `P.applyConfig`, so `P.cfg` in `SCRIPT` is the merged config;
  `cmdCheck` runs the "entries kept" loop over `["tabs", "priorities", "domains", "link_hosts", "tags"]` with `raw`
  = the merged `config`, then prints, in B's order (B 1.4 steps 6 to 9): notes, the `rules:` line, the check notes
  (`note: card <id>: check <ref>: <message>`), the `problem:` lines (with A's `config tz: ...` problem among them),
  and on success the writes;
- `+key` appends to the raw default list (`pageDefaults()`, a JSON copy of `P.DEFAULTS` and `SCRIPT_DEFAULTS`); an
  appended entry with an `id` already in the list replaces it in place;
- `export function checkFields()` derives the check fields from `SCHEMA.item`, so `draft`, `draft_label` and `due`
  join by themselves; the config key of regex checks is `checks`;
- B's tests compute every `config default:` and per-key line from `CONFIG_KEYS` (`setKeys`, `defaultLine`), so no B
  test needs an edit when `DEFAULTS` gains keys;
- `sync` prints `note: <id>: no link` lines directly after its `sync:` line (`const noLink = [];` declared beside
  `closed` and `reopened`);
- `check` writes `board/config.merged.json`, the full merged config with the defaults (`groups`, `sort`, `tags`,
  `priorities`, `week_start` included); `refresh.mjs map --config board/config.merged.json` reads it;
- the rule-card procedure lives in `REF/rules.md` ("A rule card", "A `[rule]` line"), not in `SKILL`;
- text cases of later clusters go in `tests/skill-text-test.js` (plain Node, its own `ok` helper);
- `.claude-plugin/plugin.json` is at `0.6.0`.

Plugin version: this cluster sets `.claude-plugin/plugin.json` `version` from `0.6.0` to `0.7.0` (step C1-10).

SKILL size: this cluster adds nothing to `SKILL` (the only `SKILL` edit of the earlier draft, the rule-card bullet,
is now B's `REF/rules.md`, which 1.6 edits). After this cluster `wc -c skills/decision-board/SKILL.md` prints what B
left (B measured 6804 on A's 6.1 block); the limit is 8000.

Order inside this cluster: step C1-N0 (name check), C1-0 (the `[hidden]` defect), then item 1, item 2, item 3
(section 8 of each item, and "Steps for the cluster" at the end). C2 (item-controls) lands after this cluster and
builds on `cardState` and the tail groups of item 3.

Page layout after this cluster, top to bottom (phone and wide screen):

```
header bar (title, Send)                          sticky, unchanged
#now      "Now" strip of cluster D                 cross-tab; D lands later, first at the top
#due      "Due today" strip (item 2)               cross-tab, hidden when empty
#blocked  "Blocked on you", one folded line        cross-tab; a tap opens the list
#tabs     All, config tabs, guide tabs (unchanged) a tab FILTERS which cards show
main:
  #guide                                           on a guide tab only
  #board  = #side (wide screens only) + #groups    groups ORDER the cards of the selected tab into sections
            #groups: one section per group, empty groups hidden, the "done" group folded
  #empty, New note, Archived guides, #foot         unchanged (#foot: A's zone note, then B's settings line)
```

- Tabs keep their meaning and counts (active cards per tab). A group is a section inside the selected tab; the
  All tab shows every group over all cards. A guide tab shows no groups.
- The folded "Done" section is replaced by the default group `done` (or by the tail group `_done` when the
  config has no group for done cards). It behaves as today: folded, counted in its header, unfolded by a tap
  in "Blocked on you" or "Due today" on one of its cards.
- "Blocked on you" stays a cross-tab list of links, now folded to one line `Blocked on you <n>`; a tap opens the
  list. With no blocked card it is the one line `Nothing is blocked on you.` The default group `blocked` holds
  the same cards inside the tab.
- The side list is a column left of the cards on a screen at least 1280 px wide: one row per non-empty group of
  the selected tab with its count; a tap scrolls to that group (and unfolds it). Below 1280 px it is not shown.
- The operator-visible texts this cluster adds are final:
  "Due today", "Overdue N days", "Overdue 1 day", "Due tomorrow", "Due MM-DD", "Draft", "Other", "Open", "Done",
  and the default group labels of 3.3.
- No setting is a control on the page: `groups`, `sort` and `week_start` are config keys only.

---

## 0. Name check (step C1-N0, before any edit)

Run each grep from the plugin root. Each must print at least one line. If one prints nothing, stop: change no file
and report the name and the grep that failed.

| Name of cluster A or B that this cluster relies on | Grep |
|---|---|
| A: `zoneParts`, `dayIn`, `stampMs`, `realDate` in the page | `grep -n "function zoneParts(ms, tz)" skills/decision-board/assets/board.html`, `grep -n "function dayIn(ms, tz)" skills/decision-board/assets/board.html`, `grep -n "function stampMs(v)" skills/decision-board/assets/board.html`, `grep -n "function realDate(v)" skills/decision-board/assets/board.html` |
| A: the time section and the clock helper | `grep -n "^  // ---- time" skills/decision-board/assets/board.html` and `grep -n "function clockMs() { return Date.now(); }" skills/decision-board/assets/board.html` |
| A: `sortedItems` through `cmpStamp` | `grep -n "cmpStamp(a.created, b.created)" skills/decision-board/assets/board.html` |
| A: `DEFAULTS.tz`, B: `DEFAULTS.settings` | `grep -n 'tz: "Europe/Warsaw"' skills/decision-board/assets/board.html` and `grep -n 'settings: ""' skills/decision-board/assets/board.html` |
| A: the page clock cuts-test | `grep -n "page times come only from the time section and the clock helpers" tests/cuts-test.js` |
| A: the render-test cut list | `grep -n 'cut("  function h(tag, attrs)", "  function fmt(s)")' tests/render-test.js` |
| A: the size test | `grep -n "SKILL.md stays short" tests/board-test.mjs` |
| A: refresh zone code | `grep -n 'const DEFAULT_TZ = "Europe/Warsaw"' skills/board-refresh/scripts/refresh.mjs`, `grep -n "function createdDate(v, tz)" skills/board-refresh/scripts/refresh.mjs`, `grep -n "const tz = cfg ? cfg.tz : DEFAULT_TZ;" skills/board-refresh/scripts/refresh.mjs` |
| B: config keys from `DEFAULTS`, the exports this cluster's tests import | `grep -n "^export const CONFIG_KEYS = Object.keys(P.DEFAULTS)" skills/decision-board/scripts/board.mjs`, `grep -n "^export const pageDefaults" skills/decision-board/scripts/board.mjs`, `grep -n "^export function mergeLayers" skills/decision-board/scripts/board.mjs`, `grep -n "^export function checkFields" skills/decision-board/scripts/board.mjs` |
| B: the entries-kept loop, the check notes, A's tz problem | `grep -n 'for (const k of \["tabs", "priorities", "domains", "link_hosts", "tags"\])' skills/decision-board/scripts/board.mjs`, `grep -n "note: card " skills/decision-board/scripts/board.mjs`, `grep -n "config tz: " skills/decision-board/scripts/board.mjs` |
| B: the `noLink` list of `sync` | `grep -n "const noLink = \[\]" skills/decision-board/scripts/board.mjs` |
| B: test helpers and the text-test file | `grep -n "^const defaultLine = " tests/board-test.mjs`, `grep -n "BOARD_USER_CONFIG" tests/refresh-test.mjs`, `ls tests/skill-text-test.js` |
| B: `REF/rules.md` texts this cluster edits | `grep -n "exact rule text in a fenced block" skills/decision-board/references/rules.md` and `grep -n "add the rule text of the card's" skills/decision-board/references/rules.md` |
| B: the private-values lists | ``grep -n '(`tz`, `link_hosts`, `tags`, `checks`)' skills/decision-board/references/build.md`` and `grep -n "the time zone, hosts, tags, checks, names of" skills/decision-board/references/data-model.md` |
| B: `RSKILL` after B | `grep -n "config ids:" skills/board-refresh/SKILL.md` and `grep -n -- "--config board/config.merged.json" skills/board-refresh/SKILL.md` |
| B: plugin version | `grep -n '"version": "0.6.0"' .claude-plugin/plugin.json` |

---

## C1-0. Known defect: `[hidden]` elements that a class makes `display: grid` still show

`.notes { ... display: grid; ... }` wins over the browser's `[hidden] { display: none }`, so the empty
`<section id="archived" class="notes" hidden>` shows a box. The same trap holds for every new box of this
cluster (`.due`, `.grp`, `.side`, `.draft`).

Fix (in `PAGE`, `<style>`):
1. Add, directly after the `* { box-sizing: border-box; }` line:
   `[hidden] { display: none !important; }`
2. Delete the rules that this makes redundant:
   `.donebox[hidden] { display: none; }`, `.guide[hidden], #cards[hidden] { display: none; }`,
   `.links[hidden], .chips[hidden], .asked[hidden] { display: none; }`.

Test (render-test.js, new case) **"CSS: one [hidden] rule hides every element, whatever its display"**: the page
source contains `[hidden] { display: none !important; }` exactly once, and matches none of
`/\.donebox\[hidden\]|\.guide\[hidden\]|\.links\[hidden\]/`.
Render check R1 (for the maintainer, on a test artifact): with no archived guide the box "Archived guides" is absent; archive one guide and it
shows with the guide and "Reopen".

---

## Item 1: decision-board-draft-field

### 1.1 Goal
A card may carry `draft`, only the raw text the operator pastes elsewhere, and `draft_label`, where it goes.
The page shows it wrapped in its own box, and Copy copies the field byte for byte.

### 1.2 Data model
- `SCHEMA.item` (in `PAGE`): add `draft: "t"` and `draft_label: "s"`, after `evidence`. No new collection, no
  new document. Writer: the agent through `sync` (as every card field). Default: absent.
- `draft` keeps every byte: no trim, no line-ending change, by the script or the page.
- `CONTENT` in `SCRIPT` (the fields that raise `rev`) becomes
  `["title", "summary", "evidence", "draft", "draft_label", "options", "recommendation", "kind", "links"]`.
  A changed draft or target asks the operator again ("changed"), because an approval was for the old text.
- B's `checkFields()` picks up `draft` and `draft_label` by itself (types `t`, `s`); nothing to add there.

### 1.3 Config
None.

### 1.4 Script (`SCRIPT`)

`cardProblems(c, name, ids, qk)`: add, after the `recommendation` line:
```js
if (typeof c.draft === "string" && !c.draft.trim()) out.push("draft: only spaces; leave it out");
if (c.draft_label !== undefined && (typeof c.draft !== "string" || !c.draft.trim())) out.push("draft_label: needs a draft");
```
(A non-string `draft` is already reported by `P.problems` as `draft: not text`.)

`cmdSync`, three edits, in this order:
1. In the line that declares `closed = []` and `reopened = []` (A's `const t = now(), n = { new: 0, rev: 0, changed: 0, same: 0 }, closed = [], reopened = [], held = ...;`,
   where B declared `noLink` beside them), add `warn = []` directly after `reopened = []`. If B declared
   `const noLink = [];` on its own line instead, declare `const warn = [];` on the line after it.
2. In the per-card loop `for (const { c, f } of cards) {`, directly after the line
   `const content = !old || contentKey(doc) !== contentKey(old);`, add:
   ```js
   if (content) { const w = P.draftWarning(c.draft); if (w) warn.push(`warning: ${qid(c.id)}: draft starts with ${q(w)}; put notes in summary`); }
   ```
   (`content` is true for a new card and for a card whose `CONTENT` fields changed, which includes `draft`. An
   unchanged card never warns again, so a run that changes nothing prints no warning.)
3. Directly after B's `noLink.forEach((id) => log(\`note: ${qid(id)}: no link\`));` line (which follows the
   `log(\`sync: ...\`)` call) and before `if (n.new + n.rev ...)`, add:
   ```js
   warn.slice(0, 3).forEach((l) => log(l));
   if (warn.length > 3) log(`warning: and ${warn.length - 3} more drafts that start with a label`);
   ```
A warning does not stop `sync` and does not change its exit code. So the printed lines of `sync` are, in order:
the `sync:` line, B's `note: <id>: no link` lines, zero to four `warning:` lines, then `no writes` or the
`batch ...` lines with A's `if refused:` / `if the reply is lost:` lines.

Example: a new card `reply-vendor` with `"draft": "DRAFT\nHi Sam, ..."` prints
`warning: reply-vendor: draft starts with "DRAFT"; put notes in summary`.

`read`, `ack`, `close`, `check`: no change (`check` reports the two new problems through `cardProblems`).

`REFRESH`: the map key `draft` and the override fields `draft`, `draft_label` are in 2.4.

### 1.5 Page (`PAGE`)

Pure part (node-tested), in the section `// ---- links, tags and the first ask of a card`, after `askedText`:
```js
// A draft: the raw text to paste. Shown when it holds more than spaces; copied exactly as stored.
// A label: [draft], (draft), a fence, the word draft alone on the first line, or a label word followed by ":" or a
// spaced dash (" - "). "Draft agenda ..." and "Note-taking ..." are text, not labels.
var DRAFT_LABEL_RE = /^\s*(?:\[\s*draft\s*\]|\(\s*draft\s*\)|```|draft[ \t]*(?:\r?\n|$)|\**(?:draft|note|notes|nb|preface|approval|caveat|proposed (?:reply|message|text|prompt)|suggested (?:reply|message|text|prompt))\**(?:[ \t]*:|[ \t]+[-–—][ \t]))/i;
function draftText(it) { return typeof it.draft === "string" ? it.draft : ""; }
function hasDraft(it) { return draftText(it).trim() !== ""; }
function draftLabelOf(it) { return str(it.draft_label) || "Draft"; }
// The label that a draft starts with, such as "DRAFT" or "Note:", or "" when it starts with the text itself.
function draftWarning(t) { var m = typeof t === "string" ? DRAFT_LABEL_RE.exec(t) : null; return m ? m[0].trim() : ""; }
```

Outside the pure part:
1. Refactor the Copy code of the document click listener (the block under `// Copy button of a preformatted
   block`) into one function, placed in a new block `// ---- draft` directly before
   `// ---- cards. Every DOM id of a card comes from its card number`:
   ```js
   // Copy text to the clipboard; if the clipboard is closed, select the text of pre instead. b shows the result.
   function copyText(text, pre, b) {
     function done(ok) { b.textContent = ok ? "Copied" : "Selected. Copy it by hand"; setTimeout(function () { b.textContent = "Copy"; }, 1800); }
     function bySelection() {
       var ok = false;
       try {
         var r = document.createRange(), sel = window.getSelection();
         r.selectNodeContents(pre); sel.removeAllRanges(); sel.addRange(r);
         ok = document.execCommand("copy");
         if (ok) sel.removeAllRanges();
       } catch (err) {}
       done(ok);
     }
     if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, bySelection);
     else bySelection();
   }
   ```
   The document listener keeps its `button.copy` lookup and becomes
   `if (!pre) return; copyText(pre.textContent, pre, b);`.
2. In the same `// ---- draft` block:
   ```js
   // The draft box of a card: its label, a Copy button, and the text. Text goes in by textContent only.
   function buildDraft(c) {
     c.dlabel = h("span", { class: "dlabel" });
     c.dcopy = h("button", { class: "dcopy", type: "button", text: "Copy" });
     c.dpre = h("pre", { class: "dtext" });
     c.draft = h("div", { class: "draft" }, h("div", { class: "dhead" }, c.dlabel, c.dcopy), c.dpre);
     c.draft.hidden = true;
     c.dcopy.addEventListener("click", function () { copyText(draftText(c.it), c.dpre, c.dcopy); });
   }
   function renderDraft(c, it) {
     var show = hasDraft(it), t = show ? draftText(it) : "";
     c.draft.hidden = !show;
     c.dlabel.textContent = show ? draftLabelOf(it) : "";
     if (c.dpre.textContent !== t) c.dpre.textContent = t;
   }
   ```
   The button's class is `dcopy`, not `copy`, so the document listener never handles it: Copy takes the stored
   field (`draftText(c.it)`), never the DOM text. `hidden` is set as a property (`c.draft.hidden = true;`), not
   through the `h()` attribute, so the render-test stub can read it.
3. `buildCard`: call `buildDraft(c);` after `c.evBody`/`c.ev` are made, and put `c.draft` in the article
   directly after `c.summary`: `... c.guide, c.summary, c.draft, c.links, c.ev, ...`.
4. `updateCard`: call `renderDraft(c, it);` directly after the `if (c.rich !== rich) { ... }` line.
5. CSS, after the `.rich pre` rule:
   ```css
   .draft { display: grid; gap: 4px; min-width: 0; padding: 8px; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 6px; background: var(--bg); }
   .draft .dhead { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; }
   .draft .dlabel { font-size: 12px; font-weight: 600; color: var(--muted); overflow-wrap: anywhere; min-width: 0; }
   .draft .dcopy { font-size: 12px; padding: 2px 12px; min-height: 34px; flex: none; }
   .draft pre { margin: 0; font-family: var(--font); font-size: 14px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-width: 70ch; }
   ```
   The whole draft always shows, however long (Call C24: the scoping asks the page to wrap the text and names no
   fold). No `max-height`, no "Show all".

Render check R2 (for the maintainer, on a test artifact, phone width 360 px, light and dark): a draft of one 300-character line wraps inside
the card with no horizontal scroll; blank lines and leading spaces show; the label row shows the label left and
Copy right; Copy shows "Copied"; a paste into a notes app equals the draft (manual check M-C1).

### 1.6 Agent-facing text

`REF/cards.md`:
- Fields table, add after the `summary`, `evidence` row:
  ```markdown
  | `draft` | Only the text the operator pastes elsewhere: a reply, a prompt, a message. Raw text: no preface, no notes, no approval line, no fence. Copy copies it byte for byte. Where it goes, why, and any caveat go in `summary` |
  | `draft_label` | Where the draft goes, for example `Reply in the thread`. Plain text; needs `draft` |
  ```
- "Rules for a good card", add as the last bullet:
  `- A text to paste goes in \`draft\`, never in a fenced block. \`sync\` warns when a draft starts with a label such as \`DRAFT\` or \`Note:\`.`
- Text format table, the fence row: replace
  `A preformatted block with a "Copy" button. Keep its lines under about 40 characters: it wraps on a phone`
  by `A preformatted block with a "Copy" button, for a command or a short sample. Keep its lines under about 40 characters`.

`REF/rules.md` (B's new file; B "Needs from other clusters": once `draft` exists the rule text goes in `draft`), two edits:
- Section "A rule card", last sentence but one: replace
  ``and in `summary` the section name and the exact rule text in a fenced block.`` (in B's file the words
  ``and in `summary` the`` end one line and the rest starts the next; replace across the line break) by
  ``the section name in `summary`, and the exact rule text in `draft` with `draft_label` `Rule for board/rules.md`.``
  The sentence `A rule card needs no link.` after it stays.
- Section "A `[rule]` line", first bullet: replace
  ``add the rule text of the card's `summary` to its `## <topic>` section of `board/rules.md`;`` by
  ``add the card's `draft` (the rule text) to the `## <topic>` section of `board/rules.md` that its `summary` names;``
  (the rest of the bullet, `make the section when it is missing.`, stays).

`SKILL`: no change for this item (0 characters).

`README.md`: no change for this item.

### 1.7 Tests

`tests/fields-test.js`, add:
- **"draft: shown when it holds more than spaces; the label defaults to Draft; the text is the field unchanged"**:
  `hasDraft(coerce("item", {draft: " \n\t"}))` is false, `hasDraft(coerce("item", {}))` false, `hasDraft` of
  `{draft: "x"}` true; `draftLabelOf` of `{draft: "x"}` is `"Draft"`, of `{draft: "x", draft_label: "  Reply in the thread "}`
  is `"Reply in the thread"`; `draftText(coerce("item", {draft: s}))` is `s` for
  `s = "Hi Sam,\r\n\n  indented\tTab  \n```\nnot a fence\n```\n<b>x</b> — ✓  "`; a non-string draft gives `""`.
- **"draftWarning: names the label a draft starts with, and nothing for plain text"**, exact pairs:
  `"DRAFT\nHi"` -> `"DRAFT"`; `"Draft: Hi"` -> `"Draft:"`; `"[DRAFT] Hi"` -> `"[DRAFT]"`; `"  Note: send after 5"` -> `"Note:"`;
  `"**Note:** x"` -> `"**Note:"`; `"Proposed reply: thanks"` -> `"Proposed reply:"`; `"```\nHi\n```"` -> `"```"`;
  `"DRAFT"` -> `"DRAFT"`; `"Draft\r\nHi"` -> `"Draft"`; `"Note - send after 5"` -> `"Note -"`; `"NB:x"` -> `"NB:"`;
  `"Hi team, note: x"` -> `""`; `"Drafting is done."` -> `""`; `"Notes are attached"` -> `""`;
  `"Draft agenda for Monday"` -> `""`; `"Note-taking is fine"` -> `""`; `"Hi"` -> `""`; `5` -> `""`.
  (All 18 pairs were run against the regex of 1.5 in Node: every one holds.)

`tests/render-test.js`:
- DOM stub, five changes to `class El` and the `document` object:
  - `insertBefore` becomes `insertBefore(c, ref) { if (c.parentNode) c.remove(); c.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); return c; }`
    (today `insertBefore(c, null)` splices at index -1, which puts `c` before the last child instead of at the end;
    `placeCards` and `renderGroups` call it with `null`).
  - `addEventListener(type, fn) { (this.listeners = this.listeners || {})[type] = fn; }` replaces the no-op.
  - add `focus() { document.activeElement = this; }`.
  - `remove()` becomes: `remove() { const p = this.parentNode; if (p) { if (holds(this, document.activeElement)) document.activeElement = document.body; p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; } }`
    with, above `class El`, `const holds = (a, b) => { for (; b; b = b.parentNode) if (b === a) return true; return false; };`
    (a browser moves focus to the body when the focused element leaves the page; `insertBefore` and `appendChild`
    call `remove()` first, so a move also drops focus, as in a browser).
  - the `document` object gains `body: new El("body"), activeElement: null, contains(n) { return holds(this.body, n); }`;
    set `document.activeElement = document.body;` directly after it.
  Load the page with `navigator: { clipboard: { writeText: (s) => { copied.push(s); return Promise.resolve(); } } }`,
  `setTimeout: () => 0`, `window: {}`, `cards: new Map()`,
  `buildCard: (it) => { const ta = new El("textarea"), el = new El("article"); el.appendChild(ta); return { el, ta }; }`,
  `updateCard: () => {}`, `brokenCard: () => new El("article")` and `$: (id) => ids[id]` (with `const ids = {}` above)
  added to the state object of `load(...)`, `const copied = [];` above it (`$` itself is defined above
  `function h`, outside every cut, so the stub's `$` is the one the cut code calls). The `cut(...)` list of
  `load(...)` is A's three cuts unchanged, with a fourth appended in step C1-8:
  `cut("  function h(tag, attrs)", "  function fmt(s)") + cut("  function set(s)", "  // ---- cards. Every DOM id") + cut("  function renderMeta", "  function updateCard") + cut("  // Give focus back to el when a DOM move took it away", "  var blockedKey = null;")`.
  The second cut now includes the `// ---- draft` block. The fourth starts at the comment line of `restoreFocus`,
  which 3.5 places directly above the comment `// The cards of a list in order.` (so the cut cannot miss it), and
  holds `restoreFocus`, `placeCards`, `groupEl`, `renderGroups`, `renderSide` and `goToGroup`.
- Add **"draft: the box shows the field as text, and Copy passes the stored field to the clipboard byte for byte"**:
  `c = {}`; `P.buildDraft(c)`; assert `c.draft.hidden === true` (hidden before any render);
  `c.it = P.coerce("item", {id: "a", draft: s, draft_label: "Reply <i>here</i>"})` with
  `s` from the fields-test case; `P.renderDraft(c, c.it)`; assert `c.draft.hidden === false`,
  `c.dpre.textContent === s`, `c.dlabel.textContent === "Reply <i>here</i>"`; call `c.dcopy.listeners.click()`;
  assert `copied` deep-equals `[s]` and `copied[0].length === s.length`; `htmlWrites` is still `[]`. Then
  `P.renderDraft(c, P.coerce("item", {id: "a"}))`: `c.draft.hidden === true`, `c.dpre.textContent === ""`.
- The case "HTML reaches the page only at the known places" keeps its list of three sites unchanged (the draft
  writes no HTML).

`tests/board-test.mjs`, add:
- **"sync: draft and draft_label are card fields; a draft change raises rev; a label warning prints and does not stop"**:
  sync `[yn("d", {draft: "Hi Sam,\r\n  thanks  ", draft_label: "Reply in the thread"})]`: exit 0, line 0 starts `sync: 1 new`,
  `card(b, "d").draft === "Hi Sam,\r\n  thanks  "` (bytes kept), rev 1. Sync again with `draft: "Hi Sam, thanks"`: rev 2.
  Sync with `draft_label: "Mail"`: rev 3. Sync `[yn("w", {draft: "DRAFT\nHi"})]` plus `d` unchanged: exit 0, the
  lines that start with `warning:` are exactly `["warning: w: draft starts with \"DRAFT\"; put notes in summary"]`,
  every one of them comes after the line that starts `sync: ` (filter by prefix, never by position: B's
  `note: <id>: no link` lines sit between them when a card has no link), and the writes still apply. Sync the same
  two cards again: no line starts with `warning:` (an unchanged card does not warn again). Sync five new cards `w1`
  to `w5`, each `{draft: "Note: x"}`: exactly four lines start with `warning:`, the last of them is
  `warning: and 2 more drafts that start with a label`.
- **"check: a config check can test draft"** (B's config key `checks`): board config gets
  `checks: [{"id": "nd", "field": "draft", "forbid": "secret", "flags": "i", "message": "No secret in a draft"}]`;
  sync `[yn("s", {draft: "the Secret is x"})]` exits 1 and its lines include `s: check nd: No secret in a draft`
  (B's line form `<card id>: check <ref>: <message>`). This proves `checkFields()` holds `draft`; also assert
  `checkFields()` includes `"draft"`, `"draft_label"` and `"due"` (membership; B exports `checkFields`).
- **"sync: a draft of only spaces and a draft_label without a draft are refused"**: `yn("e", {draft: "  \n"})` ->
  exit 1, text contains `e: draft: only spaces; leave it out`; `yn("f", {draft_label: "Mail"})` -> `f: draft_label: needs a draft`.

`tests/skill-text-test.js` (B's file for text cases), add:
- **"cards.md states the raw-text rule of draft"**: `REF/cards.md` matches
  `/\| `draft` \|[^\n]*no preface[^\n]*byte for byte/` and `/\| `draft_label` \|/`.
- **"rules.md puts the rule text in draft"**: `REF/rules.md` contains ``the exact rule text in `draft` with `draft_label` `Rule for board/rules.md` ``
  and ``add the card's `draft` (the rule text)``, and does not contain `in a fenced block`.

Acceptance map:
- "Copy copies the field byte for byte" -> render-test "draft: the box shows the field as text, and Copy passes the
  stored field to the clipboard byte for byte" + board-test "sync: draft and draft_label are card fields ..." (the
  script keeps the bytes) + manual check M-C1 (paste on a phone, for the maintainer).
- "`references/cards.md` states the raw-text rule" -> skill-text-test "cards.md states the raw-text rule of draft".

### 1.8 Steps

1. **C1-D1 SCHEMA and pure helpers.** Pre: C1-0 done. Add the two SCHEMA fields and the pure functions of 1.5.
   Done: `node tests/fields-test.js` exits 0 with the two new cases; `node tests/model-test.js` exits 0.
2. **C1-D2 Script.** Pre: C1-D1. `CONTENT`, the two `cardProblems` lines, the warning loop in `cmdSync`.
   Done: `node tests/board-test.mjs` exits 0 with the two `sync:` draft cases and "check: a config check can test draft".
3. **C1-D3 Page box and Copy.** Pre: C1-D1. `copyText`, `buildDraft`, `renderDraft`, `buildCard`/`updateCard`
   lines, CSS, the document listener change, and the render-test stub and `load(...)` changes of 1.7 (the fourth
   cut is added in step C1-8, when its markers exist; until then the list holds A's three cuts).
   Done: `node tests/render-test.js` exits 0 with the draft case and the unchanged HTML site list.
4. **C1-D4 Text.** Pre: C1-D2. The `REF/cards.md` lines, the two `REF/rules.md` edits, the two skill-text-test cases.
   Done: `node tests/skill-text-test.js` exits 0; `python3 scripts/validate-skills.py` (repo root) prints no problem.
5. **Render check R2 and M-C1**: for the maintainer, after step C1-10, on a test artifact (never a board in use).

---

## Item 2: decision-board-due-dates

### 2.1 Goal
A card may carry `due`, a calendar day in the config `tz`. Cards due today or earlier also show in a highlighted
"Due today" strip at the top that links to each card and holds no text to copy; a card stays there after an answer
and leaves it only when closed. `sort` and `groups` can use `due`; the week of the groups starts at the config
`week_start` (default `tuesday 12:00`). `board-refresh` fills `due`, `priority`, `summary` and `draft` from map keys,
and an override may set `due`, `draft` and `draft_label`.

### 2.2 Data model
- `SCHEMA.item`: add `due: "s"` after `first_asked`. A day `YYYY-MM-DD` (the `realDate` rule), read as a day in
  `cfg.tz`, like `first_asked.date`. Writer: the agent through `sync`. Default: absent (no deadline).
- `due` is not in `CONTENT`: a new deadline does not ask the operator again (the line counts it as
  "changed (same rev)", like `priority`).
- A card posted again takes the `due` of the new file (unlike `first_asked`, which keeps the stored value): the
  deadline is the agent's current knowledge. A card file without `due` removes it.
- B's `checkFields()` picks up `due` (type `s`) by itself.

### 2.3 Config
One page key, `week_start`: the start of
the week of the groups' `this_week` and `next_week` buckets, a day name and a 24-hour time, `"<day> <HH:MM>"`,
for example `"tuesday 12:00"` for a support rota. Day names `monday` to `sunday`, case ignored; the time is
optional (`"monday"` is `monday 00:00`); the hour may have one digit. Default `DEFAULTS.week_start = "tuesday 12:00"`
(the operator's public default). It is an ordinary config key: any layer overrides it, and the operator's own value
belongs in the user file (B's private-values list, 2.6). Invalid (an unknown day, `24:00`, `12:60`, three-letter
names, a non-text): `check` prints the problem of 2.4 and stops; the page uses the default.
It also uses `cfg.tz` (cluster A).

### 2.4 Script (`SCRIPT`) and `REFRESH`

`SCRIPT`:
- `cardProblems`: add after the `first_asked` block:
  ```js
  if (c.due !== undefined && !P.realDate(c.due)) out.push("due: not a real calendar date written YYYY-MM-DD");
  ```
  A due date in the past is allowed (an overdue card). `read` and `ack` do not print `due`.
- `cmdCheck`: in the `problem:` lines, directly after A's `config tz: ...` problem (B 1.4 step 8 keeps it there), add
  ```js
  if (raw.week_start !== undefined && !P.normWeek(raw.week_start)) errs.push(`config week_start: ${q(raw.week_start)} is not a day and a time such as "tuesday 12:00"`);
  ```
  where `raw` is the merged config that B's entries-kept loop reads (use B's variable name if it differs, and note
  it in the PR). `q` is the script's `(s) => JSON.stringify(String(s))`, so the number `5` prints as `"5"`.

`REFRESH`. Every
`sync --source` run replaces a card with the file's card, so a value the agent adds by hand to a `map` output is
lost on the next refresh; the map and the override file are the places that survive a refresh.
1. Override fields: `const STR_FIELDS = ["priority", "summary", "title", "kind", "recommendation", "blocks", "evidence"];` becomes
   `const STR_FIELDS = ["priority", "summary", "title", "kind", "recommendation", "blocks", "evidence", "due", "draft", "draft_label"];`.
   `OVERRIDE_FIELDS` follows by itself (it spreads `STR_FIELDS`), and so does the `a string` check of `checkOverrides`.
   `REFRESH` does not check an override's date: `board.mjs sync` refuses a bad `due` with the `cardProblems` line above.
2. `checkMap`, three edits:
   - the line `for (const k of ["who", "rows", "kind"]) if (...) errs.push(k + ": a string");` takes
     `["who", "rows", "kind", "due", "summary", "draft"]`;
   - after the `tags` rule check add:
     ```js
     if (m.priority !== undefined && !(Array.isArray(m.priority) && m.priority.every((r) => rule(r) && typeof r.priority === "string" && r.priority)))
       errs.push('priority: a list of {"field": ..., "equals": a value or a list of values, "priority": <config priority id>}');
     ```
   - `const known = ["rows", "key", "title", "url", "created", "who", "kind", "closed", "tags"]` becomes
     `const known = ["rows", "key", "title", "url", "created", "who", "kind", "closed", "tags", "priority", "due", "summary", "draft"]`.
3. `readConfig(file)` (as A left it, returning `{ hosts, tags, tz }`): add the field
   `priorities: Array.isArray(c.priorities) ? c.priorities.map((p) => (isObj(p) ? p.id : p)) : null`
   (`null`: the file names no priorities, so `map` does not check priority ids; `sync` still refuses an unknown one).
   B's `board/config.merged.json` always holds `priorities`, defaults included.
4. `cmdMap`:
   - directly after A's `const tz = cfg ? cfg.tz : DEFAULT_TZ;` add:
     ```js
     // A priority rule must name a priority of the config (when the config names its priorities).
     const badPri = cfg && cfg.priorities ? (m.priority || []).map((r, i) => [r, i]).filter(([r]) => !cfg.priorities.includes(r.priority)) : [];
     if (badPri.length) fail(badPri.map(([r, i]) => `${a.map}: priority[${i}]: ${JSON.stringify(r.priority)} not in the config priorities (${cfg.priorities.join(", ")})`).join("\n"));
     ```
   - the `rules` list gains the priority rules after the tag rules (so the printed `rules matched:` part and the
     details count them): `...(m.priority || []).map((r, i) => ({ name: \`priority[${i}] ${r.priority}\`, r }))`.
   - directly after the line `if (m.closed && matches(row, m.closed)) c.status = "closed";` add:
     ```js
     // Map keys of the card text and the deadline. An override below still wins for each field it names.
     const pr = (m.priority || []).find((r) => matches(row, r));
     if (pr) c.priority = pr.priority;
     if (m.summary) { const s = text(get(row, m.summary)); if (s) c.summary = s.length > MAX_S ? s.slice(0, MAX_S - 3) + "..." : s; }
     if (m.draft) { const dv = get(row, m.draft); if (typeof dv === "string" && dv.trim()) c.draft = dv; }
     const due = m.due ? createdDate(get(row, m.due), tz) : undefined, badDue = due === null || (due !== undefined && !realDate(due));
     if (due && !badDue) c.due = due;
     ```
     (`createdDate` reads a date, a timestamp with `Z` or an offset as its day in `tz`, a timestamp without a zone
     as its own date part, and epoch seconds or milliseconds, as A left it. `draft` keeps every byte: no trim.)
   - a row `due` that cannot be read never skips the row (a skipped row is missing from the `--out` file, and
     `sync --source` would then close its open card). The card keeps no `due` (the line above sets none), the groups
     place it by priority, and `map` prints one note line. Three edits:
     - the line `const cards = [], skipped = [], seen = new Map(), used = new Set();` becomes
       `const cards = [], skipped = [], seen = new Map(), used = new Set(), notes = [];`;
     - directly before the line `cards.push(c);` (in `cmdMap`; the row has passed `cardProblems` there) add:
       `if (badDue && fields.due === undefined) notes.push(\`note: ${key}: due not read\`);`
       (`fields` is the override of the row, already destructured above; an override `due` wins over a row value
       that cannot be read, so no note then);
     - directly after the line ``log(`${line} -> ${a.out}`);`` add `for (const n of notes) log(n);`, and the
       `JSON.stringify({ rows: rows.length, ...` object of the details file gains the key `notes` after
       `unused_overrides: unused,` (so a run that fails for another reason still names them in the details file).
     An override `due` is not read by `REFRESH`: a bad one reaches `board.mjs sync`, which refuses it with the
     `cardProblems` line above (`due: not a real calendar date written YYYY-MM-DD`), so the whole sync stops and no
     card closes.
   - USAGE of `REFRESH`: no change (map keys are in `RSKILL`).
5. `RSKILL` and the new `RREF/maps.md`: 2.6.

### 2.4b Chat sources
A chat message (Teams, Slack) has no due date, or only an implied one. The map key `due` is optional: without it a
card has no `due`, and the default groups place it by its priority (3.3). The agent never infers a date; only when
the message text states a date explicitly may it set `due`, through an override. `RSKILL` says this in one sentence
(2.6); `REF/cards.md` says the same for a card file the agent writes itself (the `due` row).

### 2.5 Page (`PAGE`)

Pure part (node-tested), a new section `// ---- due dates`, placed after the section
`// ---- links, tags and the first ask of a card` and before `// ---- revisions and answers` (it needs `realDate`,
`dayIn`, `zoneParts`, `cfg`). It is outside A's `// ---- time` section, so it follows A's clock rule: it never reads
the device clock (every function takes the time `ms` as an argument) and uses `Date.UTC` only for calendar
arithmetic, which A's cuts-test allows.
```js
// ---- due dates. A due date is a day YYYY-MM-DD in the config tz. ms is a time in milliseconds, given by the caller.
// The day of ms in the config tz, YYYY-MM-DD.
function todayOf(nowMs) { return dayIn(nowMs, cfg.tz); }
// Whole calendar days from day a to day b (both YYYY-MM-DD): b - a.
function dayDiff(a, b) {
  var p = a.split("-"), q = b.split("-");
  return Math.round((Date.UTC(+q[0], +q[1] - 1, +q[2]) - Date.UTC(+p[0], +p[1] - 1, +p[2])) / 86400000);
}
// The due line of a card, or null without a real due date. cls is the tag colour.
function dueInfo(it, today) {
  if (!realDate(it.due)) return null;
  var d = dayDiff(today, it.due);
  if (d < 0) return { days: d, text: "Overdue " + -d + (d === -1 ? " day" : " days"), cls: "now" };
  if (d === 0) return { days: 0, text: "Due today", cls: "now" };
  if (d === 1) return { days: 1, text: "Due tomorrow", cls: "soon" };
  return { days: d, text: "Due " + it.due.slice(5), cls: "" };
}
// The wall clock of ms in the config tz, as minutes since 1970-01-01 00:00 of that clock (calendar arithmetic:
// a DST change moves no week boundary).
function wallMin(ms) { var p = zoneParts(ms, cfg.tz); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 60000; }
// The wall-clock minute (as wallMin) at which the week of ms started: the last cfg.week_start at or before ms.
// Day 0 of the count, 1970-01-01, was a Thursday (day of week 4, Sunday 0).
function weekStartOf(ms) {
  var w = wallMin(ms), day = Math.floor(w / 1440), s = (day - (day + 4 - cfg.week_start.day + 7) % 7) * 1440 + cfg.week_start.min;
  return s > w ? s - 10080 : s;
}
// The bucket of a due date that a group can match: overdue, today, this_week (from tomorrow to the end of the
// current week), next_week (the week after), later, or none (no real due date). A due day counts at its start
// (00:00), so a card due on the start day of a week that starts at 12:00 belongs to the week that ends that noon.
// The bucket names are DUE_BUCKETS, defined at the top of "// ---- board config" (item 3 needs them at load time).
function dueBucket(due, ms) {
  if (!realDate(due)) return "none";
  var d = dayDiff(todayOf(ms), due);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  var p = due.split("-"), at = Date.UTC(+p[0], +p[1] - 1, +p[2]) / 60000, s = weekStartOf(ms);
  if (at < s + 10080) return "this_week";
  if (at < s + 20160) return "next_week";
  return "later";
}
// "Due today": the cards due today or earlier that are not closed, the most overdue first, then in the order of
// sorted. An answered card stays until it is closed.
function dueList(sorted, today) {
  return sorted.filter(function (it) { return str(it.status) !== "closed" && realDate(it.due) && it.due <= today; })
    .sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });
}
```
In `// ---- board config`, after `DEFAULT_GROUPS` (3.5 gives the exact place and writes it there; it is shown here
once more for item 2 only, write it once): the week start parser, used by `normConfig` and by `check`:
```js
// A week start: a day name and an optional 24-hour time, such as "tuesday 12:00"; case and spaces around ignored.
// -> {day: 0 (Sunday) to 6, min: minutes after midnight}, or null when it is not one.
var WEEK_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function normWeek(v) {
  var m = typeof v === "string" ? /^\s*([a-z]+)(?:\s+(\d{1,2}):(\d{2}))?\s*$/i.exec(v) : null, d = m ? WEEK_DAYS.indexOf(m[1].toLowerCase()) : -1;
  if (d < 0 || (m[2] !== undefined && (+m[2] > 23 || +m[3] > 59))) return null;
  return { day: d, min: m[2] === undefined ? 0 : +m[2] * 60 + +m[3] };
}
```
`dueBucket` and `weekStartOf` are the only places that know the week. `dueList` filters on `status` only, so an
answered card stays in the strip until the agent closes it; C2
adds its own controls (dismiss, done, a due snooze) to this filter.
These functions were run in Node 22 (Intl with full ICU) with the inputs of the due-test cases of 2.7; the
expected values written there are their results.

Outside the pure part:
1. HTML: in `<div class="in">` above the tabs, directly before `<section id="blocked" ...>` (and after D's
   `#now` once D lands):
   `<section id="due" class="due" hidden aria-label="Due today"></section>`.
2. Globals, on a new line directly after `var blockedKey = null;` (not before it: that line ends render-test's
   fourth cut): `var dueKey = null, lastDay = "", lastWeek = 0;` (`lastDay`: the day of the last render;
   `lastWeek`: the `weekStartOf` of the last render).
3. ```js
   // "Due today": a link per card, no card text and no Copy button. Hidden when no card is due.
   function renderDue(rows, today) {
     var box = $("due"), key = JSON.stringify([rows.map(function (it) { return [it.id, it.title, it.due]; }), today]);
     box.hidden = !rows.length;
     if (key === dueKey) return;
     dueKey = key;
     box.textContent = "";
     if (!rows.length) return;
     box.append(h("h3", null, "Due today", h("span", { class: "n", text: String(rows.length) })));
     var list = h("div", { class: "blist" });
     rows.forEach(function (it) {
       var di = dueInfo(it, today);
       list.append(h("button", { type: "button", class: "brow", onclick: function () { goToCard(it.id); } },
         h("span", { class: "bt" }, h("span", { class: "tag now", text: di.text }), h("span", { class: "tt", text: it.title || it.id }))));
     });
     box.append(list);
   }
   ```
   Place `renderDue` directly after the closing brace of `renderBlocked`.
4. `render()`: as its first line `var now = clockMs(), today = todayOf(now); lastDay = today; lastWeek = weekStartOf(now);`
   (A's clock helper: no `Date.now()` here, A's cuts-test bans it outside the helpers). After the line that builds
   `list` (the sorted items), call `renderDue(dueList(list, today), today);` directly before `renderBlocked(...)`.
5. The due tag on a card: `buildCard` adds `c.due = h("span", { class: "tag", hidden: true });` and puts it in the
   tags row after `c.kind`. `updateCard`, after the `c.kind` lines:
   ```js
   var di = dueInfo(it, lastDay);
   c.due.textContent = di ? di.text : "";
   c.due.className = "tag" + (di && di.cls ? " " + di.cls : "");
   c.due.hidden = !di;
   ```
6. A new day or a new week re-renders: in the wiring section, after `window.addEventListener("focus", refresh);`:
   `setInterval(function () { var t = clockMs(); if (todayOf(t) !== lastDay || weekStartOf(t) !== lastWeek) schedule(); }, 60000);`
   (one timer for the page; a week that starts at `tuesday 12:00` turns at noon, within a minute; cluster D may
   move its own check into it).
7. CSS: change the selector `.blocked {` to `.blocked, .due {` and `.blocked h3 {` to `.blocked h3, .due h3 {` and
   `.blocked h3 .n {` to `.blocked .n, .due h3 .n {` (the count pill also serves the folded summary of 3.5); then add
   `.due { border-color: var(--now); background: var(--now-bg); }`.

Render check R3 (for the maintainer, on a test artifact, phone and wide, light and dark): with one card due
yesterday and one due today, the strip shows above "Blocked on you" with "Overdue 1 day" first; it holds titles
only; an answered due card stays in it; a tap selects the card's tab, unfolds its group if folded, scrolls and
flashes the card; each card shows its due tag; with no card due the strip is absent.

### 2.6 Agent-facing text
`REF/cards.md` fields table, add after the `first_asked` row:
```markdown
| `due` | Optional. `YYYY-MM-DD`, a day in the config `tz`, for a real deadline (a form, a review, a renewal). Only a date the source states; never infer one. From that day the card also shows in "Due today" until it is closed. Post it again without `due` to remove it |
```

`REF/data-model.md`, config table (the table B left), add after the `tags` row together with the rows of 3.6:
```markdown
| `week_start` | When the week of the groups starts: a day and a 24-hour time, `"<day> <HH:MM>"`, for example `"monday 00:00"`. "This week" runs from it to the next one | `"tuesday 12:00"` |
```
and in B's layers paragraph replace `(the time zone, hosts, tags, checks, names of` by
`(the time zone, the week start, hosts, tags, checks, names of` (B "Needs": the week start is a private value of
the operator's own boards; the public default stays the plugin's).

`REF/build.md`, "Build a board", step 3 (B's sentence): replace ``(`tz`, `link_hosts`, `tags`, `checks`)`` by
``(`tz`, `week_start`, `link_hosts`, `tags`, `checks`)``.

`RSKILL` (it is read on every refresh run; the map examples go to a reference read only when a map is written):
- Step 2 (B's text ``Write the map (next section), with the tag and priority ids of the `config ids:` line that `node S check` prints.``):
  append ` For a new source, read \`references/maps.md\` first.`
- "The map file", the sentence that starts ``Optional: `who`, `kind` ``: replace `` `closed`, `tags`, and `rows` `` by
  `` `closed`, `tags`, `priority` (rules like `tags`, each with `"priority": <config priority id>`; the first that matches sets it), `due` (a row field, read like `created`; a value that cannot be read leaves the card without a due date and prints `note: <key>: due not read`), `summary` (a row field, cut to 300 characters), `draft` (a row field, kept byte for byte), and `rows` ``.
- "The map file", after the sentence that ends `on a host of \`link_hosts\`.`, add the one sentence:
  `A chat source (Teams, Slack) has no due date: leave out \`due\` and the groups place its cards by priority; never infer a date, and set \`due\` in an override only when the message text states one.`
- Step 5 "Judge": in the sentence `An override may set \`priority\`, \`tags\`, \`summary\`, \`title\`, \`kind\`, \`options\`, \`recommendation\`, \`blocks\`, \`evidence\`, \`status\` ...`,
  replace `` `blocks`, `evidence`, `` by `` `blocks`, `evidence`, `due`, `draft`, `draft_label`, ``.

New file `RREF/maps.md` (`skills/board-refresh/references/maps.md`), exactly:

````markdown
# Example maps

Read this only when you write the map of a new source (step 2 of `SKILL.md`). Each value names a row field. A
value in `equals` is compared as text, case ignored, so `4` and `true` match too. Every url must be on a host of
`link_hosts`, for example `tracker.example.com`.

An issue tracker that exports `number`, `title`, `url`, `created_at`, `state` and `labels`:

```json
{"key": "number", "title": "title", "url": "url", "created": "created_at",
 "closed": {"field": "state", "equals": ["closed"]},
 "priority": [{"field": "labels.name", "equals": ["p1", "urgent"], "priority": "now"},
              {"field": "labels.name", "equals": ["p3"], "priority": "later"}],
 "tags": [{"field": "labels.name", "equals": "incident", "tag": "incident"}]}
```

A task list that exports `id`, `content`, `url`, `created_at`, `due.date`, `priority` and `is_completed`:

```json
{"key": "id", "title": "content", "url": "url", "created": "created_at", "due": "due.date",
 "closed": {"field": "is_completed", "equals": [true]},
 "priority": [{"field": "priority", "equals": [4], "priority": "now"}]}
```
````

`SKILL`: no change. `README.md`: no change for this item (README in item 3).

### 2.7 Tests

New `tests/due-test.js` (the `_page.js` style; header comment
`// Due dates and the "Due today" strip. Run: node due-test.js [board.html]. Exits 1 on the first failure.`).
Every `applyConfig` call of this file names `tz` (and, where a bucket is computed, `week_start`), so no case
depends on a default the operator may change; the file ends with `P.applyConfig({ tz: "UTC" })`.
Step C1-5 creates the file with the first seven cases below only. Step C1-8 appends the eighth case (the source
checks) at the end of the same file. `ok()` throws on the first failure, so the eighth case must not exist before the
page code of C1-8 does.
1. **"dayDiff counts calendar days, across a month and a DST change"**: `dayDiff("2026-02-28", "2026-03-01") === 1`,
   `dayDiff("2026-10-24", "2026-10-26") === 2`, `dayDiff("2026-01-05", "2026-01-01") === -4`.
2. **"dueInfo: overdue, today, tomorrow, a later day, none"** with `today = "2026-11-13"`: due `"2026-11-11"` ->
   `{days: -2, text: "Overdue 2 days", cls: "now"}`; `"2026-11-12"` -> `"Overdue 1 day"`; `"2026-11-13"` -> `"Due today"`,
   `"now"`; `"2026-11-14"` -> `"Due tomorrow"`, `"soon"`; `"2026-12-01"` -> `"Due 12-01"`, `""`; `"2026-02-30"`, `""`, missing -> `null`.
3. **"week_start: a day and an optional 24-hour time; anything else keeps the default"**: `normWeek` (compare with
   `JSON.parse(JSON.stringify(...))`): `"tuesday 12:00"` -> `{day: 2, min: 720}`; `" Monday "` -> `{day: 1, min: 0}`;
   `"tuesday 7:05"` -> `{day: 2, min: 425}`; `"TUE 12:00"`, `"tuesday 24:00"`, `"tuesday 12:60"`, `"tuesday12:00"`, `5` -> `null`.
   `applyConfig({tz: "UTC", week_start: "Friday 08:30"})` -> `cfg.week_start` deep-equals `{day: 5, min: 510}`;
   `applyConfig({tz: "UTC", week_start: "someday"})` and `applyConfig({tz: "UTC"})` -> `cfg.week_start` deep-equals
   `normWeek(P.DEFAULTS.week_start)`, and that is not `null` (the default is valid; no assert names its value).
4. **"dueBucket: with weeks from Monday 00:00 in UTC"**: `applyConfig({tz: "UTC", week_start: "monday 00:00"})`.
   At `Date.UTC(2026, 10, 13, 12)` (Friday): `"2026-11-12"` overdue, `"2026-11-13"` today, `"2026-11-15"` (Sun)
   this_week, `"2026-11-16"` (Mon) next_week, `"2026-11-22"` (Sun) next_week, `"2026-11-23"` later, `"x"` none. At
   `Date.UTC(2026, 10, 15, 12)` (Sunday): `"2026-11-16"` next_week, `"2026-11-23"` later. At `Date.UTC(2026, 10, 16, 0, 0)`
   (Monday 00:00, the start itself): `"2026-11-22"` this_week, `"2026-11-23"` next_week.
5. **"dueBucket: a week from Tuesday 12:00 turns at noon in the config tz"**: `applyConfig({tz: "Europe/Warsaw", week_start: "tuesday 12:00"})`.
   At `Date.UTC(2026, 10, 17, 10, 59)` (Tuesday 11:59 in Warsaw): `"2026-11-17"` today, `"2026-11-18"` next_week,
   `"2026-11-24"` next_week, `"2026-11-25"` later. At `Date.UTC(2026, 10, 17, 11, 1)` (12:01 in Warsaw): `"2026-11-17"`
   today, `"2026-11-18"` this_week, `"2026-11-24"` this_week (a due day counts at 00:00, before that day's noon),
   `"2026-11-25"` next_week, `"2026-12-01"` next_week, `"2026-12-02"` later. Across the end of DST: `"2026-10-28"` is
   next_week at `Date.UTC(2026, 9, 27, 10, 59)` and this_week at `Date.UTC(2026, 9, 27, 11, 1)` (Tuesday 11:59 and
   12:01 in Warsaw, CET). Also `weekStartOf(Date.UTC(2026, 10, 17, 11, 1)) - weekStartOf(Date.UTC(2026, 10, 17, 10, 59)) === 10080`.
6. **"dueList: open cards due today or earlier stay after an answer, the most overdue first"**: `applyConfig({tz: "UTC"})`;
   items a (due today), b (due yesterday), c (due tomorrow), d (no due), e (due last week, `status: "closed"`), f (due
   today, a sent answer in `resp`: `P.resp.set("f", {choice: "Yes", sent: true})`), g (due `"2026-02-30"`), all
   `priority: "soon"` and no `created`; `dueList(P.sortedItems(), "2026-11-13")` ids are `["b", "a", "f"]` (operator
   answer: an answered card stays until it is closed); `P.resp.clear()` at the end.
7. **"a card becomes due overnight in the config tz, not in UTC"**: `applyConfig({tz: "Europe/Warsaw"})`; a card due
   `"2026-11-14"`; at `Date.UTC(2026, 10, 13, 22, 59)` (23:59 in Warsaw) `dueList(sorted, todayOf(t))` is empty and
   `dueInfo` says `"Due tomorrow"`; at `Date.UTC(2026, 10, 13, 23, 1)` (00:01 in Warsaw, still 11-13 in UTC) the list
   holds the card and `dueInfo` says `"Due today"`.
8. (appended in step C1-8) **"the page re-renders on a new day or week and shows the strip above Blocked on you"**
   (source checks): the page contains
   `setInterval(function () { var t = clockMs(); if (todayOf(t) !== lastDay || weekStartOf(t) !== lastWeek) schedule(); }, 60000);`,
   `var now = clockMs(), today = todayOf(now); lastDay = today; lastWeek = weekStartOf(now);`,
   `renderDue(dueList(list, today), today);`, and `id="due"` occurs before `id="blocked"`.

`tests/board-test.mjs`, add:
- **"sync: due is a real date; a due change keeps rev; a card file without due removes it"**:
  `yn("u", {due: "2026-02-30"})` -> exit 1, `u: due: not a real calendar date written YYYY-MM-DD`; `yn("u", {due: "2026-01-20"})`
  (a past date) -> exit 0, rev 1; `due: "2026-03-01"` -> the line that starts `sync: ` is
  `sync: 0 new, 0 changed (rev up), 1 changed (same rev), 0 unchanged, 0 closed`, rev 1; `yn("u")` -> `card(b, "u").due === undefined`.
- **"check: week_start is checked"**: `cfgOf(b, (c) => { c.week_start = "someday 12:00"; })` -> `check` exits 1 and its
  lines include `problem: config week_start: "someday 12:00" is not a day and a time such as "tuesday 12:00"`;
  `c.week_start = 5` -> `problem: config week_start: "5" is not a day and a time such as "tuesday 12:00"`;
  `c.week_start = "Monday 08:30"` -> exit 0 and no line contains `week_start`. Also `CONFIG_KEYS.includes("week_start")`.

`tests/refresh-test.mjs`, add (every config these cases write sets `tz`, A's rule):
- **"map: an override sets due, draft and draft_label"**: in the style of the existing override case, an override
  `{"tracker-1": {"due": "2026-11-20", "draft": "Hi,\n  thanks ", "draft_label": "Reply"}}` with `one({})` gives a card in
  the `--out` file with those three values byte for byte; an override `{"tracker-1": {"due": 5}}` stops `map` with
  `<file>: tracker-1: due: a string`.
- **"map: map keys due, priority, summary and draft fill the card; an override still wins"**: `const M2 = Object.assign({}, MAP, { due: "due_on", summary: "body", draft: "reply", priority: [{ field: "labels.name", equals: ["urgent"], priority: "now" }, { field: "labels.name", equals: ["p3"], priority: "later" }] });`
  - `one({ due_on: "2026-02-20", labels: [{ name: "Urgent" }], body: "x".repeat(400), reply: "Hi,\n  thanks " }, M2)`: exit 0;
    the card has `due` `"2026-02-20"`, `priority` `"now"`, `summary` of length 300 that ends with `"..."`, `draft`
    `"Hi,\n  thanks "` (byte for byte); `details.rules` has the key `"priority[0] now"` with value 1;
  - `one({ labels: [{ name: "p3" }] }, M2)`: `priority` `"later"`, and the card has no key `due`, `summary` or `draft`;
  - `one({ labels: [] }, M2)`: the card has no key `priority`;
  - `one({ due_on: "2026-02-20T23:30:00Z" }, M2, "--config", put("tzc.json", { link_hosts: ["example.com"], tz: "Europe/Warsaw" }))`:
    `due` `"2026-02-21"` (the day in the config tz);
  - `one({ due_on: "soon" }, M2)` and `one({ due_on: "2026-02-30" }, M2)`: exit 0, one card in the `--out` file with no
    key `due`, `details.skipped` is `[]`, `details.notes` deep-equals `["note: 1: due not read"]` (the `one` row's key is
    `1`, card id `tracker-1`), and the printed text has the line `note: 1: due not read` after the `map:` line;
    `one({ due_on: "soon" }, M2, "--overrides", put("od.json", { "tracker-1": { due: "2026-03-01" } }))`:
    exit 0, `due` `"2026-03-01"`, `details.notes` is `[]`;
  - `one({}, M2, "--overrides", put("op.json", { "tracker-1": { priority: "soon" } }))`: `priority` `"soon"` (the override wins);
  - `one({}, Object.assign({}, M2, { priority: [{ field: "labels.name", equals: ["x"], priority: "urgent" }] }), "--config", put("pc.json", { link_hosts: ["example.com"], tz: "UTC", priorities: [{ id: "now" }, { id: "soon" }, { id: "later" }] }))`:
    exit 1 and its text contains `priority[0]: "urgent" not in the config priorities (now, soon, later)`; the same map with
    a config that has no `priorities` key exits 0;
  - `map(GOOD, Object.assign({}, MAP, { priority: "now" }))`: exit 1, text contains `priority: a list of`; `{ due: 5 }` in the
    map: text contains `due: a string`.
- **"map: the example maps of references/maps.md map their sample rows"**: read `skills/board-refresh/references/maps.md`,
  take its two ```` ```json ```` blocks in order and `JSON.parse` each (`T`, `K`). Map
  `[{ number: 7, title: "Disk full on the backup host", url: "https://tracker.example.com/t/7", created_at: "2026-01-10T08:00:00Z", state: "open", labels: [{ name: "Urgent" }, { name: "incident" }] }]`
  with `T` (`--source tracker`): exit 0, the card has `id` `"tracker-7"`, `priority` `"now"`, `tags` `["incident"]`, no
  `status`. Map
  `[{ id: "t1", content: "Renew the domain", url: "https://tracker.example.com/task/t1", created_at: "2026-01-05", due: { date: "2026-02-20" }, priority: 4, is_completed: false }]`
  with `K`: exit 0, the card has `due` `"2026-02-20"`, `priority` `"now"`, no `status`; the same row with
  `is_completed: true` gives `status` `"closed"`. (The `map(rows, m, ...)` helper names `--source tracker`; the card
  id is then `tracker-t1`.)
- **"map: a board config without tags gets the default tags through config.merged.json"** (replaces the earlier
  draft's `DEFAULT_TAGS` change): write a board folder with `config.json`
  `{ "link_hosts": ["example.com"], "tz": "UTC" }` (no `tags`), run the board script's `check` with
  `--state <dir>/state.json` as B's refresh-test case does, then
  `one({ labels: [{ name: "incident" }] }, Object.assign({}, MAP, { tags: [{ field: "labels.name", equals: "incident", tag: "incident" }] }), "--config", <dir>/config.merged.json)`:
  exit 0 and the card's `tags` is `["incident"]`; `read(<dir>/config.merged.json).tags.map((t) => t.id)` includes `"incident"`.

`tests/skill-text-test.js`, add:
- **"the due row and the chat rule"**: `REF/cards.md` matches `/\| `due` \|[^\n]*never infer/`; `RSKILL` contains
  `never infer a date`, `` `due`, `draft`, `draft_label` ``, `references/maps.md` and `` `priority` (rules like `tags` ``;
  `skills/board-refresh/references/maps.md` exists; `REF/build.md` contains `` `week_start` ``; `REF/data-model.md`
  matches `/\| `week_start` \|/` and contains `the week start, hosts`.

`tests/render-test.js`: no new case (renderDue writes text only; the HTML site list stays three).

Acceptance map:
- "The strip shows only cards due today or earlier" -> due-test "dueList: open cards due today or earlier stay after
  an answer ..." + render check R3.
- "A test covers a card that becomes due overnight" -> due-test "a card becomes due overnight in the config tz, not in UTC"
  + the source check of the minute timer (case 8).
- Operator answers: the week start -> due-test cases 3 to 5 and board-test "check: week_start is checked"; refresh
  overrides and map keys -> the three refresh-test map cases; chat sources -> skill-text-test "the due row and the chat rule".

### 2.8 Steps
1. **C1-U1 Field and script.** Pre: C1-0. `due` in SCHEMA, the `cardProblems` line. Done: board-test "sync: due ..." passes.
2. **C1-U2 Pure functions.** Pre: C1-U1. `todayOf`, `dayDiff`, `dueInfo`, `wallMin`, `weekStartOf`, `dueBucket`,
   `dueList` (section `// ---- due dates`); `DUE_BUCKETS`, `WEEK_DAYS`, `normWeek`, `DEFAULTS.week_start` and the
   `normConfig` `week_start` line (3.5 gives their places). Create `tests/due-test.js` with the seven pure cases only.
   Done: `node tests/due-test.js` exits 0 and prints `ok 1` to `ok 7`; `node tests/cuts-test.js` exits 0 (A's clock case
   passes: no device clock in the new section).
3. **C1-U2b Script check.** Pre: C1-U2. The `config week_start` problem of 2.4. Done: board-test "check: week_start is checked" passes.
4. **C1-U3 Page.** Pre: C1-U2. `#due`, `renderDue`, the `render()` lines, the card tag, the timer, CSS; then
   append the eighth case to `tests/due-test.js`. Done: `node tests/due-test.js` prints `ok 1` to `ok 8`; render-test exits 0.
5. **C1-U3b Refresh.** Pre: C1-U1 and C1-D1. `REFRESH` steps 1 to 4 of 2.4 (override fields, map keys, `readConfig`
   priorities); the new `RREF/maps.md`; the `RSKILL` edits of 2.6; the refresh-test cases of 2.7.
   Done: `node tests/refresh-test.mjs` exits 0 with the four new cases; `grep -n "DEFAULT_TAGS" skills/board-refresh/scripts/refresh.mjs` prints nothing.
6. **C1-U4 Text.** Pre: C1-U1. The `due` row of `REF/cards.md`, the `week_start` row and the layers-paragraph edit of
   `REF/data-model.md`, the `REF/build.md` edit, the skill-text-test case. Done: `node tests/skill-text-test.js` exits 0.
7. **Render check R3**: for the maintainer, after step C1-10.

---

## Item 3: decision-board-grouping

### 3.1 Goal
Config `groups` splits the cards of the selected tab into ordered sections (the first group that matches takes a
card), and config `sort` orders the cards inside each group. A wide screen shows a side list of the groups with counts.

### 3.2 Data model
No database change, no new SCHEMA field. `meta/config` may carry `groups`, `sort` and `week_start` (written by
`check` from the layers, as every page key, B 1.2). The groups and the order are computed by the page on every
render; nothing stores them.

### 3.3 Config

`DEFAULTS` (in `PAGE`) gains three keys, appended after the last key that A and B leave (`settings`, after `tz`).
Their position is not a contract: no test pins the key list or a position (A's convention); tests assert
membership (`"groups" in P.DEFAULTS`, `CONFIG_KEYS.includes("week_start")`).
```js
groups: [
  { id: "alerts", label: "Alerts and incidents", match: { tags: ["alert", "incident"] } },
  { id: "blocked", label: "Now: blocked on a human", match: { blocked: true } },
  { id: "this-week", label: "This week", match: [{ due: ["overdue", "today", "this_week"] }, { priority: ["now"], due: ["none"] }] },
  { id: "next-week", label: "Next week", match: [{ due: ["next_week"] }, { priority: ["soon"], due: ["none"] }] },
  { id: "backlog", label: "Backlog", match: {} },
  { id: "done", label: "Done", match: { state: "done" } }
],
sort: ["priority", "due", "created", "id"],
week_start: "tuesday 12:00"
```
- `sort`: priority, then the due date (soonest first; cards without one
  after those with one), then the posted time, then the id.
- `groups`, no due date: a card without `due` goes to "This week" when its
  priority is `now`, to "Next week" when `soon`, and to "Backlog" when `later` (or any other priority, through the
  catch-all `{}`). The agent never infers a date (2.4b), so these alternatives keep undated work in the right week.
- `week_start`: item 2, 2.3.

Default tags:
`DEFAULTS.tags` becomes `[{ id: "alert", label: "Alert" }, { id: "incident", label: "Incident" }]` (was `[]`), so a
card the agent tags `alert` or `incident` lands in group 1 on a board whose config sets no `tags`. A config `tags`
list replaces the defaults (B's rule); `+tags` appends to them. What else this changes, all in step C1-6:
- `normConfig` gives the defaults for a missing `tags` key and keeps `[]` for `tags: []` (the tags line of 3.5).
- `tagProblems` in `SCRIPT` (no code change): on a board without config `tags`, an unknown tag now prints
  `tags: "cost" not in the config tags (alert, incident)`; the hint `. Set tags in config.json first` prints only
  for a config with `tags: []`. The board-test case on tags (config tags `cost, security`) is unaffected; run it to
  show that.
- B's `config ids:` line of `check` now prints `tags alert, incident` on a board without config `tags`; B's test of
  that line uses the fixture's own `tags`, so it is unaffected.
- `REFRESH` needs no change for the default tags: `readConfig` reads the `tags` of the `--config` file, and B's
  `board/config.merged.json` (the file `RSKILL` names) holds the full merged config with the defaults, so a board
  without config `tags` gives `map` the ids `alert`, `incident`. refresh-test "map: a board config without tags gets
  the default tags through config.merged.json" (2.7) pins it.
- Every other test that names tags sets its own config `tags` (checked: `tabs-test.js`, `render-test.js`,
  `refresh-test.mjs` with `tags: []`, `board-test.mjs`); only the `fields-test.js` assert of 3.7 changes.
  Step C1-6 still runs all tests and, for any other case that relied on empty default tags, passes `tags: []` in
  that case's config instead of changing the expected output.
- `REF/data-model.md` `tags` row default: `none` -> `` `alert`, `incident` `` (3.6). `REF/cards.md`, `SKILL`: no text
  says the default tags are empty (checked by grep), so no change.

**`groups`**: a list of at most 50 entries. Each entry:

| Key | Type | Rule |
|---|---|---|
| `id` | text | required, `GROUP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/`, unique (a later duplicate is dropped by `idList`). An id never starts with `_`: `_other` and `_done` are the page's tail groups |
| `label` | text | optional, default the id. The section header and the side list row |
| `match` | an object, or a list of 1 to 50 objects | optional, default `{}`. A list matches when any of its objects matches |
| a key starting with `_` | any | a comment, ignored |

Any other key in an entry drops the whole entry. A match object holds any of these keys; all keys present must
hold (AND); a list value holds when the card has any of its values (OR):

| Key | Value | Holds when |
|---|---|---|
| `source` | non-empty list of texts | the card's `source`, trimmed and in lower case, is in the list (values are trimmed and lower-cased too) |
| `tags` | non-empty list of texts | the card carries one of these tag ids (exact) |
| `priority` | non-empty list of texts | the card's `priority` is in the list (exact) |
| `kind` | non-empty list of `decision`, `action`, `info` | `kindOf(card)` is in the list |
| `due` | non-empty list of `overdue`, `today`, `this_week`, `next_week`, `later`, `none` | `dueBucket(card.due, now)` is in the list (item 2; the week starts at `week_start`) |
| `blocked` | `true` or `false` | the card's `blocks` is non-empty (`true`) or empty (`false`) |
| `state` | `active` (default), `done`, or `any` | `cardState(card)` equals it; `any` always holds |

A match object with an unknown key (other than `_...`), a value of the wrong type, an empty list, a list entry
that is not a non-empty text, or a `kind`/`due`/`state` value outside its list is invalid, and an entry with one
invalid match object is dropped whole. So a typo can never turn a group into a catch-all. `match: {}` is the
catch-all of active cards. Every match object without `state` matches active cards only, so done cards pass by
every group until one with `state: "done"` (or `any`).

`groups: []` means no configured groups: the cards show in the two tail groups only, "Open" and "Done" (today's
layout). A missing `groups`, `null` (B's rule), or a list in which every entry is invalid gives the defaults.

**`sort`**: a list of at most 50 texts from `SORT_KEYS = ["priority", "due", "first_asked", "created", "updated", "title", "id"]`,
each optionally prefixed with `-` (descending). Unknown texts and a repeated key (with or without `-`) are dropped.
A list with no valid entry, and `[]`, give the default. The order of a key:

| Key | Value compared | Missing |
|---|---|---|
| `priority` | `priRank(card.priority)` (config order; unknown 99) | never missing |
| `due` | the `due` day | no real date: last |
| `first_asked` | `first_asked.date` | no real date: last |
| `created`, `updated` | `stampMs(...)` | unreadable: last |
| `title` | `str(title).toLowerCase()` | never missing (`""`) |
| `id` | the card id | never missing |

Missing values sort last in both directions. When every key ties, the card id decides (ascending).

`check` (B's validation of the merged config): the "entries kept" loop over
`["tabs", "priorities", "domains", "link_hosts", "tags"]` becomes
`["tabs", "priorities", "domains", "link_hosts", "tags", "groups", "sort"]`, and in its `got` expression
`c[k] === P.DEFAULTS[k]` becomes `c[k] === def`, with `const def = k === "groups" ? P.DEFAULT_GROUPS : P.DEFAULTS[k];`
as the first line of the loop body. So an invalid group or sort entry prints
`problem: config groups: <kept> of <n> entries kept` (or `config sort: ...`) and `check` stops, as for tabs today.
(`normSort` returns `DEFAULTS.sort` itself when no entry is valid, and `normConfig` returns `DEFAULT_GROUPS` and
`DEFAULTS.tags` themselves, so the identity compare works for all three.) B's unknown-field check knows `groups`,
`sort` and `week_start` through `CONFIG_KEYS` without a code change. Later clusters append their keys to this list
(C2: `people`) and keep `def`.

`check`, a note for a group that can never match. Place it at B's 1.4 step 7: directly after B's check notes
(the loop that logs `note: card <id>: check <ref>: <message>`) and before the `problem:` lines, so it prints on a
failed `check` too and no B line moves. `P.cfg` there is the merged config that `Run` applied (B 1.4). Add:
```js
// A group that names a tag or a priority the config does not have: valid, but it never takes a card.
for (const g of P.cfg.groups) for (const m of g.match) {
  for (const x of m.tags || []) if (!P.cfg.tags.some((t) => t.id === x)) log(`note: config groups: ${g.id} matches tag ${q(x)} that is not in tags`);
  for (const x of m.priority || []) if (!P.cfg.priorities.some((p) => p.id === x)) log(`note: config groups: ${g.id} matches priority ${q(x)} that is not in priorities`);
}
```
A `note:` line never changes the exit code. Example: a config with `tags: [{"id": "cost"}]` and no `groups` prints
`note: config groups: alerts matches tag "alert" that is not in tags` and
`note: config groups: alerts matches tag "incident" that is not in tags`, and `check` still exits 0. A config whose
`priorities` have no `now` or `soon` gets the notes for `this-week` and `next-week`.

`+groups` (B's merge): B merges the raw JSON lists. The base of `"+groups"` is the raw `DEFAULTS.groups` list (B's
`pageDefaults()`, a plain copy of `P.DEFAULTS`), never `DEFAULT_GROUPS` (the normalised form, whose `match` is always
a list). An appended entry whose `id` equals a default id replaces that default in place (B's rule); the page then
normalises the merged list with `normGroups`. No code in this cluster for it; the board-test case of 3.7 pins it.

### 3.4 Script (`SCRIPT`)
The `check` loop change and the `note:` block of 3.3, and the `config week_start` problem of 2.4. `sync`, `read`,
`ack`: no change (the script never groups or sorts cards for the page). B's `config default: <keys>` line lists
the unset page keys in `CONFIG_KEYS` order, so it now also names `groups`, `sort` and `week_start` where they are
unset; B's tests compute that line with `defaultLine(...)` from `CONFIG_KEYS`, so no B test changes.

### 3.5 Page (`PAGE`)

Pure part (node-tested). In `// ---- board config`: the whole block below goes between the closing brace of
`function hostOk(host, list) { ... }` and the line `var cfg = normConfig(null);`. Nothing else goes between them.
It lands in two steps: step C1-5 (item 2) inserts its last part, from the comment `// A week start:` to
`var DEFAULT_WEEK = ...;`, directly before `var cfg = normConfig(null);`; step C1-6 inserts the rest, from
`// ---- groups and sort.` to `var DEFAULT_GROUPS = ...;`, between `hostOk`'s closing brace and the comment
`// A week start:`.
The block's last line, `var DEFAULT_GROUPS = normGroups(DEFAULTS.groups);`, must come before `var cfg = normConfig(null);`:
`normConfig` reads `DEFAULT_GROUPS`, and a `var` that is assigned later is still `undefined` when `normConfig(null)`
runs at load, which leaves `cfg.groups` undefined and makes the first `render()` throw in `groupCards`.
groups-test pins this (its first assert runs before any `applyConfig`).
```js
// ---- groups and sort. A group is {id, label, match: [match objects], fold}; fold is true when every match is for done cards.
var GROUP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
var MATCH_KEYS = ["source", "tags", "priority", "kind", "due", "blocked", "state"];
var GROUP_STATES = ["active", "done", "any"];
var SORT_KEYS = ["priority", "due", "first_asked", "created", "updated", "title", "id"];
function normMatch(m) {
  if (!isObj(m)) return null;
  var out = Object.create(null), bad = false;
  Object.keys(m).forEach(function (k) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") { bad = true; return; }
    if (k.charAt(0) === "_") return;
    var v = m[k];
    if (MATCH_KEYS.indexOf(k) < 0) { bad = true; return; }
    if (k === "blocked") { if (typeof v === "boolean") out.blocked = v; else bad = true; return; }
    if (k === "state") { if (GROUP_STATES.indexOf(v) >= 0) out.state = v; else bad = true; return; }
    var l = Array.isArray(v) ? v.slice(0, SCHEMA.max.list) : [];
    if (!l.length || l.some(function (x) { return typeof x !== "string" || !x.trim(); })) { bad = true; return; }
    if (k === "source") l = l.map(function (x) { return x.trim().toLowerCase(); });
    if (k === "kind" && l.some(function (x) { return !SCHEMA.kinds.some(function (y) { return y.id === x; }); })) { bad = true; return; }
    if (k === "due" && l.some(function (x) { return DUE_BUCKETS.indexOf(x) < 0; })) { bad = true; return; }
    out[k] = l;
  });
  if (bad) return null;
  if (!out.state) out.state = "active";
  return out;
}
function normGroups(a) {
  return idList(a, function (id) { return GROUP_ID_RE.test(id); }).map(function (x) {
    if (!Object.keys(x.src).every(function (k) { return k === "id" || k === "label" || k === "match" || k.charAt(0) === "_"; })) return null;
    var raw = own(x.src, "match") ? x.src.match : {}, list = Array.isArray(raw) ? cfgList(raw) : [raw], ms = list.map(normMatch);
    if (!ms.length || ms.some(function (m) { return m === null; })) return null;
    return { id: x.id, label: x.label || x.id, match: ms, fold: ms.every(function (m) { return m.state === "done"; }) };
  }).filter(Boolean);
}
function normSort(a) {
  var seen = Object.create(null), out = [];
  strs(cfgList(a)).forEach(function (x) {
    var k = x.trim(), base = k.charAt(0) === "-" ? k.slice(1) : k;
    if (SORT_KEYS.indexOf(base) < 0 || seen[base]) return;
    seen[base] = true; out.push(k);
  });
  return out.length ? out : DEFAULTS.sort;
}
var DEFAULT_GROUPS = normGroups(DEFAULTS.groups);
// A week start: a day name and an optional 24-hour time, such as "tuesday 12:00"; case and spaces around ignored.
// -> {day: 0 (Sunday) to 6, min: minutes after midnight}, or null when it is not one.
var WEEK_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function normWeek(v) {
  var m = typeof v === "string" ? /^\s*([a-z]+)(?:\s+(\d{1,2}):(\d{2}))?\s*$/i.exec(v) : null, d = m ? WEEK_DAYS.indexOf(m[1].toLowerCase()) : -1;
  if (d < 0 || (m[2] !== undefined && (+m[2] > 23 || +m[3] > 59))) return null;
  return { day: d, min: m[2] === undefined ? 0 : +m[2] * 60 + +m[3] };
}
// The parsed DEFAULTS.week_start: the fallback of normConfig.
var DEFAULT_WEEK = normWeek(DEFAULTS.week_start);
```
(These are the same `WEEK_DAYS` and `normWeek` that 2.5 shows; write them once, here.) Put `var DUE_BUCKETS = ["overdue", "today", "this_week", "next_week", "later", "none"];` as the first line under
the comment line that starts `// ---- board config` (with the comment `// The due buckets a group can match; dueBucket returns one.`
on the line above it), before `var DEFAULTS = {`. The `var DEFAULT_GROUPS = normGroups(DEFAULTS.groups);` line
runs at load time and reads `DUE_BUCKETS`, so that assignment must come before it; `var DEFAULT_WEEK` runs at load
time too and calls `normWeek`, a function declaration (hoisted), but reads `WEEK_DAYS`, so `WEEK_DAYS` comes first.
The order at load is thus: `DUE_BUCKETS`, `DEFAULTS`, ..., `hostOk`, `GROUP_ID_RE`, `MATCH_KEYS`, `GROUP_STATES`,
`SORT_KEYS`, `normMatch`, `normGroups`, `normSort`, `DEFAULT_GROUPS`, `WEEK_DAYS`, `normWeek`, `DEFAULT_WEEK`,
`var cfg = normConfig(null);`. The functions of the `// ---- due dates` section can stay in their own section:
function declarations hoist, and none of them runs at load.

`normConfig`, add before `return out;` (next to B's `out.settings` line; the order of these lines does not matter):
```js
var rawGroups = g("groups"), gs = normGroups(rawGroups);
out.groups = Array.isArray(rawGroups) && (gs.length || !rawGroups.length) ? gs : DEFAULT_GROUPS;
out.sort = normSort(g("sort"));
out.week_start = normWeek(g("week_start")) || DEFAULT_WEEK;
```
The `normConfig` tags line (`out.tags = idList(g("tags")).map(...)`, operator answer `grouping-alerts-match`) becomes:
```js
var rawTags = g("tags"), tg = idList(rawTags).map(function (x) { return { id: x.id, label: x.label || x.id }; });
out.tags = Array.isArray(rawTags) && (tg.length || !rawTags.length) ? tg : DEFAULTS.tags;
```

In `// ---- visibility`, replace `isActive` and `sortedItems`, and add the group functions:
```js
// The state a group matches. C2 adds "snoozed" here; nothing else needs to change for it.
function cardState(it) { return isDone(it) ? "done" : "active"; }
function isActive(it) { return cardState(it) === "active"; }
function sortVal(key, it) {
  if (key === "priority") return priRank(it.priority);
  if (key === "due") return realDate(it.due) ? it.due : null;
  if (key === "first_asked") return isObj(it.first_asked) && realDate(it.first_asked.date) ? it.first_asked.date : null;
  if (key === "created" || key === "updated") { var t = stampMs(it[key]); return t === -Infinity ? null : t; }
  if (key === "title") return str(it.title).toLowerCase();
  return String(it.id);
}
function cardCmp(keys) {
  return function (a, b) {
    for (var i = 0; i < keys.length; i++) {
      var desc = keys[i].charAt(0) === "-", k = desc ? keys[i].slice(1) : keys[i], va = sortVal(k, a), vb = sortVal(k, b);
      if (va === null && vb === null) continue;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va !== vb) return (va < vb ? -1 : 1) * (desc ? -1 : 1);
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}
function sortedItems() { return Array.from(items.values()).sort(cardCmp(cfg.sort)); }
// now: the time in ms for the due buckets (the caller reads the clock, the pure part never does).
function matchOne(m, it, now) {
  if (m.state !== "any" && m.state !== cardState(it)) return false;
  if (m.source && !(typeof it.source === "string" && m.source.indexOf(it.source.trim().toLowerCase()) >= 0)) return false;
  if (m.tags && !strs(it.tags).some(function (t) { return m.tags.indexOf(t) >= 0; })) return false;
  if (m.priority && m.priority.indexOf(str(it.priority)) < 0) return false;
  if (m.kind && m.kind.indexOf(kindOf(it)) < 0) return false;
  if (m.due && m.due.indexOf(dueBucket(it.due, now)) < 0) return false;
  if (own(m, "blocked") && (blocksOf(it) !== "") !== m.blocked) return false;
  return true;
}
function groupMatch(g, it, now) { return g.match.some(function (m) { return matchOne(m, it, now); }); }
// The sections of a list of sorted cards: the configured groups in order, then the tail groups "Other" (active
// cards no group took; "Open" when no group is configured) and "Done" (done cards no group took). Every card is
// in exactly one group, in the order of the list. Empty groups stay in the result; the page hides them.
function groupCards(list, now) {
  var gs = cfg.groups.map(function (g) { return { id: g.id, label: g.label, fold: g.fold, cards: [] }; });
  var other = { id: "_other", label: gs.length ? "Other" : "Open", fold: false, cards: [] }, done = { id: "_done", label: "Done", fold: true, cards: [] };
  list.forEach(function (it) {
    for (var i = 0; i < cfg.groups.length; i++) if (groupMatch(cfg.groups[i], it, now)) { gs[i].cards.push(it); return; }
    (cardState(it) === "done" ? done : other).cards.push(it);
  });
  return gs.concat([other, done]);
}
```
`isDone` stays as it is. `blockedList`, `tabCounts(list, isActive)` and `emptyText` are unchanged. `isActive` keeps
one parameter, so `vis.filter(isActive)` in `render()` stays correct. The second parameter
of `groupCards` is a time in ms (not a day, as in the earlier draft): a week that starts at `tuesday 12:00` turns at
noon, so the buckets need the time, not only the day.

Outside the pure part:
1. HTML: replace
   `<div id="cards"></div>`, `<div id="empty" class="empty" hidden></div>` and the `<details id="done" ...>...</details>` line by:
   ```html
   <div id="board" class="board">
     <nav id="side" class="side" hidden aria-label="Groups"></nav>
     <div id="groups" class="groups"></div>
   </div>
   <div id="empty" class="empty" hidden></div>
   ```
2. CSS: delete `#cards, #donelist { display: grid; gap: 10px; }` and the four `.donebox` rules; add:
   ```css
   .groups { display: grid; gap: 16px; min-width: 0; }
   .grp { display: grid; gap: 10px; min-width: 0; }
   .grp > h3, .grp > summary { margin: 0; font-size: 13px; font-weight: 600; display: flex; gap: 8px; align-items: center; }
   .grp > summary { padding: 6px 0; color: var(--fg); }
   .grp .n, .side .n { font-size: 12px; font-weight: 400; color: var(--muted); font-variant-numeric: tabular-nums; }
   .glist { display: grid; gap: 10px; min-width: 0; }
   .side { display: none; }
   @media (min-width: 1280px) {
     .board.has-side { display: grid; grid-template-columns: 180px minmax(0, 1fr); column-gap: 20px; align-items: start; margin-left: -200px; }
     .board.has-side > .side { display: grid; gap: 2px; position: sticky; top: var(--hdr, 120px); }
     .side .srow { display: flex; justify-content: space-between; gap: 8px; text-align: left; border: 0; background: none; min-height: 32px; }
     .side .srow .sl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
   }
   ```
3. `placeCards(cont, list)` (today directly after the comment `// The cards of a list in order. The DOM changes only
   when the order changes.`) becomes `placeCards(cont, list, focused)`, and the focus restore moves into a helper.
   Three edits to the function body, nothing else:
   - `var keep = new Set(want), focused = document.activeElement;` becomes
     `var keep = new Set(want); focused = focused || document.activeElement;`
   - the last line `if (focused && focused !== document.activeElement && document.contains(focused)) { try { focused.focus({ preventScroll: true }); } catch (e) {} }`
     becomes `restoreFocus(focused);`
   - add, directly above the comment line `// The cards of a list in order. The DOM changes only when the order
     changes.` (so above the comment, not between the comment and `function placeCards`; render-test's fourth cut
     starts at this new comment line):
     ```js
     // Give focus back to el when a DOM move took it away and el is still on the page.
     function restoreFocus(el) { if (el && el !== document.activeElement && document.contains(el)) { try { el.focus({ preventScroll: true }); } catch (e) {} } }
     ```
   Why: with groups a card can move from one group list to a later one while the operator types in it (the agent
   changed its `due` or `priority`). The first list's `placeCards` call removes the card, which drops focus, and
   the second call's own snapshot is then the body. `renderGroups` therefore takes one snapshot before any group
   and passes it to every call, and restores once more at its end.
4. Put everything of this item below (the globals line, `groupEl`, `renderGroups`, `renderSide`, `goToGroup`), in this
   order, directly after the closing brace of `placeCards` and before the line `var blockedKey = null;`. render-test
   cuts the range from `restoreFocus`'s comment to that line
   (`cut("  // Give focus back to el when a DOM move took it away", "  var blockedKey = null;")`, 1.7).
   Globals line: `var groupEls = new Map(), sideKey = null;` (group id -> `{el, list, lab, n, fold}`).
   ```js
   // One section per group, built once per group id. A group for done cards is a folded details element.
   function groupEl(g) {
     var x = groupEls.get(g.id);
     if (x && x.fold === g.fold) return x;
     var lab = h("span", { class: "gl" }), n = h("span", { class: "n" }), list = h("div", { class: "glist" });
     var el = g.fold ? h("details", { class: "grp" }, h("summary", null, lab, n), list) : h("section", { class: "grp" }, h("h3", null, lab, n), list);
     x = { el: el, list: list, lab: lab, n: n, fold: g.fold };
     groupEls.set(g.id, x);
     return x;
   }
   function renderGroups(groups) {
     var box = $("groups"), focused = document.activeElement, want = groups.map(function (g) {
       var x = groupEl(g);
       x.lab.textContent = g.label;
       x.n.textContent = String(g.cards.length);
       x.el.hidden = !g.cards.length;
       placeCards(x.list, g.cards, focused);
       return x.el;
     });
     var keep = new Set(want);
     Array.from(box.children).forEach(function (e) { if (!keep.has(e)) e.remove(); });
     want.forEach(function (e, i) { if (box.children[i] !== e) box.insertBefore(e, box.children[i] || null); });
     restoreFocus(focused);
   }
   // The side list: one row per group that holds a card, on a wide screen only (CSS). A tap opens and shows the group.
   function renderSide(groups, onGuide) {
     var box = $("side"), rows = groups.filter(function (g) { return g.cards.length; });
     box.hidden = onGuide || rows.length < 2;
     $("board").classList.toggle("has-side", !box.hidden);
     var hd = document.querySelector("header.bar");
     if (hd) document.documentElement.style.setProperty("--hdr", Math.ceil(hd.getBoundingClientRect().height) + 8 + "px");
     var key = JSON.stringify(rows.map(function (g) { return [g.id, g.label, g.cards.length]; }));
     if (key === sideKey) return;
     sideKey = key;
     box.textContent = "";
     rows.forEach(function (g) {
       box.append(h("button", { type: "button", class: "srow", onclick: function () { goToGroup(g.id); } },
         h("span", { class: "sl", text: g.label }), h("span", { class: "n", text: String(g.cards.length) })));
     });
   }
   function goToGroup(id) {
     var x = groupEls.get(id);
     if (!x || x.el.hidden) return;
     if (x.fold) x.el.open = true;
     bringIntoView(x.el, false);
   }
   ```
5. `render()`: the line `var active = vis.filter(isActive), done = vis.filter(isDone), onGuide = isGuideTab(f.tab);`
   stays unchanged (`emptyText(items.size, active.length, done.length)` still reads `active` and `done`). Delete these
   five lines: `$("cards").hidden = onGuide;`, `placeCards($("cards"), active);`, `placeCards($("donelist"), done);`,
   `$("done").hidden = onGuide || !done.length;`, `$("donesum").textContent = "Done (" + done.length + ")";`. Put in
   their place, directly after the `renderBlocked(blockedList(list));` line (and so after item 2's `renderDue(...)`):
   ```js
   var groups = groupCards(vis, now);
   $("board").hidden = onGuide;
   renderGroups(groups);
   renderSide(groups, onGuide);
   ```
   (`now` is the `clockMs()` value of `render()`'s first line, item 2.) The `Array.from(cards.keys()).forEach(...)`
   cleanup line stays directly after these four lines.
6. `goToCard(id)`: replace `if (isDone(it)) $("done").open = true;` and the lines after `render();` by:
   ```js
   render();
   var c = cards.get(id);
   if (!c || !c.el.isConnected) return;
   var fold = c.el.closest("details.grp");
   if (fold) fold.open = true;
   bringIntoView(c.el, true);
   ```
   (the tab switch before `render()` is unchanged).
7. "Blocked on you" folded to one line with the count. The HTML
   `<section id="blocked" class="blocked" aria-label="Blocked on you"></section>` stays. `var blockedKey = null;`
   stays as it is (it ends render-test's fourth cut). `renderBlocked(rows)` becomes, whole:
   ```js
   // "Blocked on you": one folded line with the count; a tap opens the list. With no row, one plain line.
   // The fold keeps its open state when the list is rebuilt.
   function renderBlocked(rows) {
     var box = $("blocked");
     var key = JSON.stringify([rows.map(function (it) { return [it.id, it.title, kindOf(it), blocksOf(it), it.priority]; }), cfg.kinds]);
     if (key === blockedKey) return;
     blockedKey = key;
     var was = box.querySelector("details.bfold"), open = !!(was && was.open);
     box.textContent = "";
     if (!rows.length) { box.append(h("div", { class: "muted small", text: "Nothing is blocked on you." })); return; }
     var list = h("div", { class: "blist" });
     rows.forEach(function (it) {
       var k = kindOf(it);
       list.append(h("button", { type: "button", class: "brow", onclick: function () { goToCard(it.id); } },
         h("span", { class: "bt" },
           h("span", { class: "tag" + (isDefaultKind(k) ? "" : " now"), text: kindLabel(k) }),
           h("span", { class: "tt", text: it.title || it.id })),
         h("span", { class: "bb", text: "Blocks: " + blocksOf(it) })));
     });
     var fold = h("details", { class: "bfold" }, h("summary", null, "Blocked on you ", h("span", { class: "n", text: String(rows.length) })), list);
     fold.open = open;
     box.append(fold);
   }
   ```
   (The row buttons are today's, unchanged; only the heading becomes the `summary` of a `details`.) CSS, after the
   `.blocked .n, .due h3 .n` rule of item 2:
   ```css
   .bfold > summary { font-size: 13px; font-weight: 600; cursor: pointer; padding: 4px 0; min-height: 32px; }
   .bfold[open] > summary { margin-bottom: 6px; }
   ```
   The `summary` keeps its default display, so the browser's fold marker stays. A tap on a row of the open list
   goes to the card as today (`goToCard`).

Render checks (for the maintainer, on a test artifact, never a board in use):
- R4 (phone 360 px and desktop, light and dark): the default groups show in order with their counts; empty groups are
  absent; "Done" is folded and opens on a tap; a tap in "Blocked on you" on a done card unfolds "Done" and scrolls;
  a config tab shows only its cards, grouped; a guide tab shows no group; `groups: []` shows "Open" and "Done" only;
  "Blocked on you" is one line `Blocked on you <n>` that opens on a tap and stays open across a sync, and with no
  blocked card is the line `Nothing is blocked on you.`
- R5 (desktop at 1280 px and at 1279 px, with a visible vertical scrollbar): at 1280 px and two or more non-empty
  groups the side list shows left of the cards, its left edge is at 0 px or more (`#side.getBoundingClientRect().left >= 0`
  in the console; expected about 18 px), it sticks under the header while scrolling, and a row tap scrolls to (and
  unfolds) its group; the card column's left edge is where it is at 1279 px; at 1279 px the list is absent and the
  cards keep their width. In the claude.ai artifact panel (often narrower than 1280 px) it is absent
  (see Unverified U3).

### 3.6 Agent-facing text

`REF/data-model.md`, config table (as A and B left it):
- `tags` row, default column: `none` -> `` `alert`, `incident` ``.
- add after the `tags` row (with the `week_start` row of 2.6 directly after these two):
  ```markdown
  | `groups` | The sections of a tab, in order: a list of `{id, label, match}`. A card goes to the first group whose `match` fits ("Groups and sort" below) | the six groups below |
  | `sort` | The order inside a group: keys of `priority`, `due`, `first_asked`, `created`, `updated`, `title`, `id`; `-` in front reverses one. Missing values go last | `["priority", "due", "created", "id"]` |
  ```
- insert a section directly before the heading `## Collections` (after the example config block and whatever B put
  before it, so it does not fall under B's `### Checks`), with one blank line before, between and after its parts:
  the heading `### Groups and sort`, then the paragraph
  ```markdown
  A tab picks the cards; groups order them inside it. A group: `id` (a-z 0-9 _ -), `label`, and `match`, an object or
  a list of objects of which any may fit. In an object every key must fit: `source`, `tags`, `priority`, `kind`
  (lists, any value), `due` (a list of `overdue`, `today`, `this_week`, `next_week`, `later`, `none`; the week starts
  at `week_start`, and a due day counts from its 00:00), `blocked` (true or false), `state` (`active`, the default,
  `done` or `any`). `{}` takes every active card. An entry with an unknown key or value is dropped, and `check` says
  so. Cards no group takes go to "Other" and "Done". `+groups` adds groups to the defaults; an entry with a default id
  replaces that group. The defaults:
  ```
  then a ```` ```json ```` block with exactly the `DEFAULTS.groups` value of 3.3 as JSON (`{"groups": [...]}`, keys
  and texts in double quotes, one group per line).

`README.md`, two edits (edit the text as A and B left it):
- The intro sentence that B left as ``A config, kept in `board/config.json` and optional layers around it, merged by
  `check` and written to the database, sets the title, the tabs, the priorities and the tags.`` (line breaks as in the
  file): replace `sets the title, the tabs, the priorities and the tags.` by
  `sets the title, the tabs, the groups and their order, the priorities and the tags. Cards due today show in a
  strip at the top.`
- "Test it", the bullet that starts `` - `tests/*-test.js` run the part of the page ``: replace `the Done section,` by
  `the groups and the sort order,`, and after the sentence `` `cuts-test.js` checks that removed features stay removed. ``
  insert `` `due-test.js` covers the due dates, the week start and the Due today strip, `groups-test.js` the groups and the sort. ``
  Re-wrap the bullet's lines to under 100 characters.

`SKILL`: no change for this item (the agent never sets groups unless the operator asks; `data-model.md` holds the keys).

### 3.7 Tests

New `tests/groups-test.js` (the `_page.js` style; header comment
`// Groups and the sort order. Run: node groups-test.js [board.html]. Exits 1 on the first failure.`). Fixture items
built in the test with `P.coerce("item", ...)` and stamps `...+00:00`. Every `applyConfig` call of the file goes
through `const base = (x) => Object.assign({ tz: "UTC", week_start: "tuesday 12:00" }, x);` (no case depends on
`DEFAULTS.tz` or `DEFAULTS.week_start`), and `now = Date.UTC(2026, 10, 13, 12)` (Friday 12:00 UTC; the week runs
from Tuesday 11-10 12:00 to Tuesday 11-17 12:00). The file ends with `P.applyConfig(base())`.
- **"no groups in the config: the six default groups, in order"**: first, before any `applyConfig` call in the
  file: `P.cfg.groups === P.DEFAULT_GROUPS`, `P.DEFAULT_GROUPS.length > 0` and `P.cfg.week_start !== null` (the load
  order of 3.5: `DEFAULT_GROUPS` and `DEFAULT_WEEK` are set before `var cfg = normConfig(null)` runs). Then
  `applyConfig(base())` and `applyConfig(base({title: "x"}))`: `cfg.groups.map(g => g.id)` is
  `["alerts", "blocked", "this-week", "next-week", "backlog", "done"]`, labels exactly as 3.3, `fold` true for `done`
  only; `cfg.sort` is `["priority", "due", "created", "id"]`; `cfg.tags` ids are `["alert", "incident"]`; `"groups" in P.DEFAULTS`, `"sort" in P.DEFAULTS`, `"week_start" in P.DEFAULTS` (membership only).
- **"the hooks that C2 builds on: cardState and the tail groups"**: `typeof P.cardState === "function"`,
  `P.cardState.length === 1`, `P.isActive.length === 1`;
  `P.cardState(P.coerce("item", {id: "a", status: "open"})) === "active"`, of `{id: "b", status: "closed"}` is `"done"`;
  `P.GROUP_STATES` deep-equals `["active", "done", "any"]`; after `applyConfig(base())`,
  `P.groupCards([], now).map(g => g.id)` is exactly
  `["alerts", "blocked", "this-week", "next-week", "backlog", "done", "_other", "_done"]`, and `P.groupCards.length === 2`
  (two parameters, `list` and `now`).
- **"the default groups place each card"**: every card has `priority: "soon"`, `status: "open"` and no `created`
  unless named: a (tags `["alert"]`), b (`blocks: "backup"`), c (`due` `"2026-11-13"`), d (`due` `"2026-11-10"`),
  e (`priority: "now"`, no due), f (`due` `"2026-11-18"`), g (no due), h (`due` `"2026-12-20"`),
  i (`status: "closed"`, tags `["alert"]`), j (`blocks: "x"`, and `resp.set("j", {sent: true, choice: "x"})`),
  k (`priority: "later"`, no due), l (`due` `"2026-11-17"`), m (`due` `"2026-11-24"`), o (`due` `"2026-11-25"`);
  `groupCards(sortedItems(), now)` gives, by group id: alerts `[a]`, blocked `[b]`, this-week `[e, d, c, l]`,
  next-week `[f, m, g]`, backlog `[o, h, k]`, done `[i, j]`, `_other` `[]`, `_done` `[]`. The buckets are those of the
  due-test runs of 2.5 (`2026-11-17` this_week, `2026-11-18` and `2026-11-24` next_week, `2026-11-25` later at this
  `now`); the order inside a group follows `sort` (`priority`, then `due` with undated cards last, then `id`).
  `P.resp.clear()` at the end.
- **"the first matching group takes the card; a list matches any; every key of an object must fit"**: config groups
  `[{id: "x", match: {tags: ["cost"], priority: ["now"]}}, {id: "y", match: [{source: [" Mail "]}, {kind: ["info"]}]}, {id: "z", match: {tags: ["cost"]}}]`;
  a card with tag cost and priority now -> x; tag cost, priority soon -> z; source `"mail"` with tag cost and
  priority soon -> y (y comes before z); kind info -> y; neither -> `_other`; a done card -> `_done`;
  `blocked: false` and `state: "any"` cases: `{id: "q", match: {blocked: false, state: "any"}}` takes a done card
  without `blocks`.
- **"groups: [] keeps only the tail groups, Open and Done"**: `applyConfig(base({groups: []}))`: `cfg.groups` is `[]`;
  `groupCards` result ids `["_other", "_done"]`, the first labelled `"Open"`; active cards in `_other`, done in `_done`.
- **"a group entry with a typo is dropped whole, never a catch-all"**: `applyConfig(base({groups: [{id: "a", match: {due: ["thisweek"]}}, {id: "b", match: {tag: ["x"]}}, {id: "c", match: [{}, 5]}, {id: "d", matches: {}}, {id: "Bad"}, {id: "_x"}, {id: "e", label: "E", _note: "ok", match: {_why: "ok"}}]}))`
  keeps only `["e"]`; `applyConfig(base({groups: [{id: "a", match: {due: ["thisweek"]}}]}))` (every entry invalid) gives the
  defaults (`cfg.groups === P.DEFAULT_GROUPS`); with
  `base(JSON.parse('{"groups":[{"id":"z","match":{"__proto__":["x"]}},{"id":"y","match":{"source":[" Mail "]}}]}'))` only `y` is
  kept, its `match[0].source` is `["mail"]`, and `Object.getPrototypeOf(cfg.groups[0].match[0])` is `null`.
- **"sort: each key, both directions, missing values last, the id breaks ties"**: four cards (stamps written out):
  p `{priority: "now", due: "2026-11-20", first_asked: {date: "2026-11-01"}, created: "2026-11-03T10:00:00+00:00", updated: "2026-11-05T10:00:00+00:00", title: "b"}`,
  q `{priority: "soon", first_asked: {date: "2026-10-01"}, created: "2026-11-01T10:00:00+00:00", updated: "bad", title: "A"}`,
  r `{priority: "later", due: "2026-11-15", created: "bad", updated: "2026-11-04T10:00:00+00:00", title: "c"}`,
  s `{priority: "p9", first_asked: {date: "2026-11-02"}, created: "2026-11-02T10:00:00+00:00", updated: "2026-11-06T10:00:00+00:00", title: ""}`.
  With `applyConfig(base({sort: [k]}))` the ids of `sortedItems()` joined are exactly (7 keys x 2 = 14 asserts):
  `priority` pqrs, `-priority` srqp; `due` rpqs, `-due` prqs; `first_asked` qpsr, `-first_asked` spqr; `created` qspr,
  `-created` psqr; `updated` rpsq, `-updated` sprq; `title` sqpr, `-title` rpqs; `id` pqrs, `-id` srqp. (Run against the
  code of 3.5: these are its results.) Two more cards t1, t2 equal on every field but the id sort `t1, t2` under
  `["priority"]` and under `["-priority"]`.
- **"sort: unknown and repeated keys are dropped; nothing valid gives the default"**: `["due", "-due", "nope", " title "]` ->
  `["due", "title"]`; `["nope"]`, `[]`, `"due"` -> the default.
- **"dueBucket feeds the due match"**: with `applyConfig(base({groups: [{id: "n", match: {due: ["none"]}}, {id: "l", match: {due: ["later"]}}]}))`
  and `now`: a card without `due` goes to `n`; a card due `"2026-11-25"` goes to `l`; a card due `"2026-11-18"`
  (next_week) goes to `_other`.

`tests/cards-test.js`, case "the page reads the cards collection, folds Done at the end of the cards, and counts it"
(as A left it): rename to **"the page reads the cards collection and shows the cards in groups; Done is a folded group"**;
replace the asserts on the `<div id="cards">...<details id="done" ...>` HTML, on `$("donesum")`,
`placeCards($("donelist"), done);` and `if (isDone(it)) $("done").open = true;` by asserts that the source contains
`var groups = groupCards(vis, now);`, `renderGroups(groups);`, `h("details", { class: "grp" }` and
`var fold = c.el.closest("details.grp");` (keep A's `COLS` and items-collection asserts).

`tests/blocked-test.js`, add **"Blocked on you is one folded line with the count; a tap opens the list"** (source
checks, `fs.readFileSync(pageFile, "utf8")`): the page contains
`h("details", { class: "bfold" }, h("summary", null, "Blocked on you ", h("span", { class: "n", text: String(rows.length) })), list)`,
`fold.open = open;` and `"Nothing is blocked on you."`, and still contains `<section id="blocked" class="blocked" aria-label="Blocked on you"></section>`.

`tests/render-test.js`, add **"groups: a card that moves to a later group while its text box has focus keeps the focus"**
(uses the stub and `load(...)` of 1.7): `ids.groups = new El("div"); document.body.appendChild(ids.groups);`;
`const x = P.coerce("item", {id: "x"}), G = (a, b) => [{id: "ga", label: "A", fold: false, cards: a}, {id: "gb", label: "B", fold: false, cards: b}];`
`P.renderGroups(G([x], []));` `const ta = P.cards.get("x").ta; ta.focus();` assert `document.activeElement === ta`;
`P.renderGroups(G([], [x]));` assert `document.activeElement === ta`, `P.cards.get("x").el.parentNode === P.groupEls.get("gb").list`,
and `P.groupEls.get("ga").el.hidden === true`. Then the reverse move `P.renderGroups(G([x], []));`: again
`document.activeElement === ta`. Without the single snapshot of 3.5 the first move ends with `document.activeElement === document.body`
(the stub's `remove()` drops focus as a browser does), so this case fails on the old code. `htmlWrites` stays `[]`.

`tests/cuts-test.js`, add **"the old Done box is gone: no #cards, #done, #donelist or #donesum"**: the page source
matches none of `/id="cards"|id="done"|id="donelist"|id="donesum"|\$\("done"\)|\$\("cards"\)/`.

`tests/fields-test.js`: the assert `assert.deepEqual([plain(P.cfg.link_hosts), plain(P.cfg.tags)], [[], []]);` becomes
`[[], [{ id: "alert", label: "Alert" }, { id: "incident", label: "Incident" }]]`.
If the `P.applyConfig(null)` call above it lost its `null` in cluster A (for example `P.applyConfig({ tz: "UTC" })`),
keep A's call.

`tests/blocked-test.js`: the existing cases need no change (their cards have no `due`, so the default sort gives
today's order); run it to show that. The new fold case is above.

`tests/board-test.mjs`:
- Add **"check: an invalid group or sort entry is named and stops check"**: `cfgOf(b, c => { c.groups = [{id: "a", match: {due: ["thisweek"]}}, {id: "b", match: {}}]; c.sort = ["due", "nope"]; })`;
  `check` exits 1 and its lines contain `problem: config groups: 1 of 2 entries kept` and
  `problem: config sort: 1 of 2 entries kept`. With `c.groups = [{id: "b", label: "B", match: {}}]` and
  `c.sort = ["-due"]` it exits 0 and the `meta/config` write holds both keys unchanged; also `CONFIG_KEYS.includes("groups")`
  and `CONFIG_KEYS.includes("sort")` (membership).
- Add **"config layers: +groups replaces a default group in place by its id"** (beside B's `mergeLayers` cases, same
  imports): `mergeLayers([{name: "board", data: {"+groups": [{id: "backlog", label: "Later", match: {}}, {id: "ops", match: {tags: ["ops"]}}]}}], pageDefaults())`
  gives `config.groups` whose ids are `pageDefaults().groups.map((g) => g.id).concat("ops")` (computed from the live
  defaults), whose entry with id `backlog` deep-equals `{id: "backlog", label: "Later", match: {}}` and sits at the
  index of `backlog` in `pageDefaults().groups`, and whose entry with id `this-week` has the `match` of the raw
  default (`pageDefaults().groups.find((g) => g.id === "this-week").match`, a list: the base is the raw
  `DEFAULTS.groups`, not `DEFAULT_GROUPS`).
- Add **"check: a group that names an unknown tag or priority gets a note, not a problem"**: `cfgOf(b, c => { c.tags = [{id: "cost"}]; c.groups = [{id: "x", match: {tags: ["alart"], priority: ["urgent"]}}]; })`;
  `check` exits 0, and its lines include `note: config groups: x matches tag "alart" that is not in tags` and
  `note: config groups: x matches priority "urgent" that is not in priorities`, and no line starts with `problem:`.
  With `c.groups` deleted (the defaults) and `c.tags = [{id: "cost"}]`, the lines include
  `note: config groups: alerts matches tag "alert" that is not in tags`.
- Any existing `check` case that compares every printed line (not a slice, a prefix filter or `includes`) and whose
  config sets `tags` without `alert` now also gets the two `alerts` note lines: drop lines that start with
  `note: config groups:` in that assert (`lines.filter((l) => !l.startsWith("note: config groups:"))`) rather than
  changing its config. (B rewrote its own `check` asserts by prefix; find any other with `grep -n '"check"' tests/*.mjs`.)

`tests/skill-text-test.js`, add **"data-model.md names groups, sort and the defaults"**: `REF/data-model.md` matches
`/\| `groups` \|/` and `/\| `sort` \|/`, contains `### Groups and sort` and `"id": "this-week"`, and the `### Groups and sort`
heading comes after `### Checks` (when B's heading is there) and before `## Collections`.

Acceptance map:
- "A config with no `groups` shows the defaults" -> groups-test "no groups in the config: the six default groups, in
  order" and "the default groups place each card", + render check R4.
- "Page tests cover group match order and each sort key" -> groups-test "the first matching group takes the card; ..."
  and "sort: each key, both directions, missing values last, the id breaks ties".
- Operator answers: default sort and no-due placement -> groups-test cases 1 and 3; alerts by tag -> groups-test case 1,
  fields-test and board-test "check: a group that names an unknown tag ..."; Blocked on you folded -> blocked-test fold
  case + render check R4.

### 3.8 Steps
1. **C1-G1 Config and pure functions.** Pre: C1-U2 (`DUE_BUCKETS`, `dueBucket`, the week block). `DEFAULTS.groups`,
   `DEFAULTS.sort`, `DEFAULTS.tags`, the `// ---- groups and sort` block (placed between `hostOk` and the comment
   `// A week start:`), the `normConfig` groups, sort and tags lines, `cardState`, `isActive`, `sortVal`, `cardCmp`,
   `sortedItems`, `matchOne`, `groupMatch`, `groupCards`. Done: `node tests/groups-test.js` exits 0 with its nine
   cases; `tests/fields-test.js`, `tests/blocked-test.js` (old cases), `tests/tabs-test.js`, `tests/model-test.js`,
   `tests/revisions-test.js`, `tests/time-test.js`, `tests/due-test.js` exit 0.
2. **C1-G2 Script check.** Pre: C1-G1. The loop list and `def`, the `note:` block of 3.3. Done: board-test "check: an
   invalid group or sort entry ...", "check: a group that names an unknown tag ..." and "config layers: +groups
   replaces ..." pass; every B case passes unchanged.
3. **C1-G3 Page sections, side list, Blocked fold.** Pre: C1-G1, C1-U3. HTML, CSS, `restoreFocus`, `groupEl`,
   `renderGroups`, `renderSide`, `goToGroup`, the `placeCards` change, the `render()` and `goToCard` changes, the new
   `renderBlocked` and its CSS; the fourth render-test cut. Done: `node tests/cards-test.js`, `node tests/cuts-test.js`
   and `node tests/blocked-test.js` exit 0 with the changed and new cases; `node tests/render-test.js` exits 0 with
   the focus case and the HTML site list unchanged.
4. **C1-G4 Text.** Pre: C1-G2. `REF/data-model.md` rows, section and defaults block; `README.md` lines; the
   skill-text-test case. Done: `node tests/skill-text-test.js` exits 0; `python3 scripts/validate-skills.py` (repo
   root) prints no problem.
5. **Render checks R4 and R5**: for the maintainer, after step C1-10.

---

## Steps for the cluster (in order)

Each step leaves every test green. "All tests" means the loop of the README, run from the plugin root, printing nothing.

| Step | What | Pre | Done when |
|---|---|---|---|
| C1-N0 | Name check (section 0) | A and B landed, all tests pass | every grep of section 0 printed a line; else stop, change nothing, report the name and its grep |
| C1-0 | `[hidden]` CSS fix (C1-0 section) | C1-N0 | render-test "CSS: one [hidden] rule ..." passes; all tests |
| C1-1 | C1-D1 draft SCHEMA and pure helpers | C1-0 | fields-test draft cases; all tests |
| C1-2 | C1-D2 draft script (`CONTENT`, `cardProblems`, warning on new or changed cards only, after B's `note: <id>: no link` lines) | C1-1 | board-test draft cases and "check: a config check can test draft"; all tests |
| C1-3 | C1-D3 draft box and Copy, render-test stub and `load(...)` changes (A's three cuts; the fourth comes in C1-8) | C1-1 | render-test draft case, HTML site list unchanged; all tests |
| C1-4 | C1-U1 `due` field and script | C1-0 | board-test "sync: due ..."; all tests |
| C1-5 | C1-U2 due pure functions, `DUE_BUCKETS`, the week block (`WEEK_DAYS`, `normWeek`, `DEFAULT_WEEK`) directly before `var cfg = normConfig(null);`, `DEFAULTS.week_start`, the `normConfig` `week_start` line; create `tests/due-test.js` with its seven pure cases only | C1-4 | `node tests/due-test.js` prints `ok 1` to `ok 7`; cuts-test exits 0; all tests |
| C1-5b | C1-U2b the `config week_start` problem in `check` | C1-5 | board-test "check: week_start is checked"; all tests |
| C1-6 | C1-G1 groups/sort config and pure functions (`DEFAULTS.groups`, `DEFAULTS.sort`, `DEFAULTS.tags`), the groups block placed between `hostOk` and the comment `// A week start:` | C1-5 | groups-test (9 cases); fields-test, tabs-test, model-test, render-test, blocked-test, time-test, board-test (incl. the tags case, see the `tagProblems` bullet of 3.3) and refresh-test exit 0; all tests |
| C1-7 | C1-G2 `check` loop and `def`, `note:` block, `+groups` board-test case | C1-6 | board-test "check: an invalid group ...", "check: a group that names an unknown tag ...", "config layers: +groups ..."; all tests |
| C1-8 | C1-U3 and C1-G3 page: `#due`, `renderDue`, card due tag, `render()` first line, timer, `restoreFocus` and `placeCards(cont, list, focused)`, `#board`/`#groups`/`#side`, `goToCard`, the folded `renderBlocked`; the fourth render-test cut; append the eighth case to `tests/due-test.js` | C1-3, C1-5, C1-6 | `node tests/due-test.js` prints `ok 1` to `ok 8`; cards-test, cuts-test and blocked-test changed/new cases; render-test with the focus case; all tests |
| C1-8b | C1-U3b `REFRESH` (override fields, map keys `due`, `priority`, `summary`, `draft`, `readConfig` priorities), `RREF/maps.md`, `RSKILL` edits | C1-4, C1-1 | the four new refresh-test cases; `grep -n "DEFAULT_TAGS" skills/board-refresh/scripts/refresh.mjs` prints nothing; all tests |
| C1-9 | Text: C1-D4, C1-U4, C1-G4 (`REF/cards.md`, `REF/rules.md`, `REF/data-model.md`, `REF/build.md`, README) and their `tests/skill-text-test.js` cases | C1-2, C1-4, C1-7, C1-8b | `node tests/skill-text-test.js` exits 0; `python3 scripts/validate-skills.py` at the repo root prints no problem; `wc -c skills/decision-board/SKILL.md` prints the same number as before C1-N0 (this cluster adds 0 characters; at most 8000, board-test "SKILL.md stays short" passes); board-test "artifact-capabilities is named once, in P1" passes (`RREF/maps.md` does not name it) |
| C1-10 | Set `.claude-plugin/plugin.json` `version` from `0.6.0` to `0.7.0` | C1-1 to C1-9 and C1-8b | all tests; `grep -n '"version": "0.7.0"' .claude-plugin/plugin.json` prints one line; `git status` shows changes only under `plugins/decision-board/`; a grep of the diff for `curl\|wget\|https\?://` finds only `example.com` hosts and documentation links |

Checks for the maintainer, after C1-10, not implementer steps (on a new test artifact published from the changed
page with `P1`; never a board in use under `board/`, which no step of this spec reads,
writes or tests against): render checks R1 to R5 (1.5, 2.5, 3.5) and manual check M-C1 on a real phone: post a card
with a 10-line draft that holds a blank line, two leading spaces and a trailing space; Copy; paste into a notes app;
the pasted text equals the draft (the trailing space included).

---

## Calls made

- C1. **`draft` and `draft_label` raise `rev`** (`CONTENT`). The scoping makes the draft the text the operator
  approves; an answer to the old text must not apply to the new one. `sync` already defines `CONTENT` as "the
  fields that the answer depends on".
- C2. **The draft Copy reads the stored field, not the DOM** (`draftText(c.it)`, button class `dcopy`, outside the
  document `button.copy` listener). "Byte for byte" rules out `pre.textContent` after a render, and the global
  listener would copy the DOM text.
- C3. **The draft shows in the body font with `white-space: pre-wrap`**, not monospace: drafts are replies and
  messages, and the scoping's problem is bad wrapping. Spaces and line breaks still show as stored.
- C4. **`sync` warns, never refuses, on a label at the start of a draft** (the scoping says "warns"); the warning
  is a separate `warning:` line after the `sync:` line so existing parsers of line 0 stay valid.
- C5. **A draft of only spaces and a `draft_label` without a draft are refused**: both are agent mistakes that the
  page would hide silently.
- C6. **`due` is a calendar day, not a time**, read in `cfg.tz` like `first_asked.date` (the scoping says "date";
  A fixed days in `tz`). A due date in the past is allowed (overdue is the point of the strip).
- C7. **`due` does not raise `rev`** and is not kept across posts (unlike `first_asked`): a deadline is not part
  of the question, and the agent's newest file is its current knowledge.
- C8. **The "Due today" strip is hidden when empty**, sits above "Blocked on you", is cross-tab, and holds a link
  row per card (title and due text) and no card text, as the scoping says ("links to each card and holds no copy").
- C9. **A day or week change re-renders through a one-minute timer** that only schedules a render when
  `todayOf(t)` or `weekStartOf(t)` changed, with `t = clockMs()` (A's clock helper): cheap, and it makes "becomes
  due overnight" and "the week turns at Tuesday 12:00" true on an open page.
- C10. (Superseded by the operator answer `due-dates-refresh-overrides`, see C30.) The earlier draft had no map key
  `due`; this cluster now adds the map keys `due`, `priority`, `summary`, `draft`.
- C11. **Groups order cards inside the selected tab; tabs keep filtering and counting.** The scoping adds groups
  "on one page" without removing tabs, and tab counts and `inTab` are tested behaviour.
- C12. **The folded Done section becomes a group** (default `done`, else the tail `_done`), keeping its behaviour.
  Two places for done cards would contradict "a card goes to the first group that matches".
- C13. **Every match object matches active cards unless it sets `state`**, so the `done` group can be last in the
  list (as the scoping orders the defaults) and still receive every done card.
- C14. **`match` may be a list (any of)**: the default "This week" needs an OR (due this week, or priority now
  without a date) and the alternative, a second group with the same label, would split one section in two.
- C15. **An invalid group entry is dropped whole**, and `check` names the count, so a typo never turns a group
  into a catch-all; same "entries kept" mechanism as tabs.
- C16. **Two tail groups "Other" and "Done" catch the cards no group takes**, so a card never vanishes from the
  board because the config's groups do not cover it. With `groups: []` they are today's layout ("Open", "Done").
- C17. (Answered: `grouping-default-sort`, C33.) The default sort is `["priority", "due", "created", "id"]`; cards
  with no `due` keep today's order (priority, then created).
- C18. **Missing values sort last in both directions**: a card with no due date should never jump to the top
  under `-due`.
- C19. **The side list shows at 1280 px and wider, with two or more non-empty groups**, as a grid column pulled
  left by 200 px (180 px list + 20 px gap), so the cards keep their place and width. Geometry: `.in` is 860 px wide
  including its 16 px side padding (`box-sizing: border-box`), so the card column is 828 px. At a 1280 px window
  with a 15 px scrollbar the page is 1265 px, the `.in` box starts at (1265 - 860) / 2 = 202.5 px and its content at
  218.5 px; the board's left edge is then 218.5 - 200 = 18.5 px. A wider breakpoint is not needed; R5 checks the
  edge. The padding is `max(16px, safe-area inset)`, and a desktop at 1280 px has no safe-area inset.
- C20. **Group ids `^[a-z0-9][a-z0-9_-]{0,39}$`** and no DOM attribute or DOM id carries a config text: B needs an
  `id` for in-place replace (`+groups`), and labels reach the page by `textContent` only.
- C21. **One global `[hidden] { display: none !important; }`** fixes the "Archived guides" defect and every box
  this cluster adds, and lets three per-class rules go.
- C22. **No `SKILL` text for groups, due or the week start**: the agent sets `due` from `REF/cards.md` (read before
  the first hand-written card) and from map keys, and groups, sort and `week_start` are operator config
  (`REF/data-model.md`). `SKILL` grows by 0 characters; the rule-card text that now uses `draft` is B's
  `REF/rules.md`, read only when a `rules:` line or a `[rule]` flag names it.
- C23. **`isActive` is defined through `cardState`** (both one parameter), the single hook C2 extends;
  `blockedList` and the tab counts then follow C2's states without further change. `dueList` filters on `status`
  only, so C2 adds its own controls there. groups-test pins `cardState`, `GROUP_STATES`, the
  tail ids and the two parameters of `groupCards`.
- C24. **A long draft always shows in full** (was the question `draft-field-long-draft`): the scoping asks only that
  the page wrap the text and that Copy copy the field; a fold is new scope. A fold can be a follow-up after use.
- C25. **The draft `warning:` prints only for a card that is new or whose content changed in this run, at most three
  lines plus one `and N more` line, in a short form**: a warning on every unchanged card on every `sync` costs tokens
  for no new information. The regex no longer warns on text that only starts with the word (`Draft agenda ...`,
  `Note-taking ...`): a label is `[draft]`, `(draft)`, a fence, `draft` alone on the first line, or a label word
  followed by `:` or a spaced dash.
- C26. **`check` prints a `note:` (not a `problem:`) for a group that names a tag or priority the config lacks**:
  such a group is valid but can never take a card; a note keeps `check` exit 0, and the `alerts` default gets the
  note on a board whose own `tags` drop `alert` and `incident`.
- C27. (Withdrawn.) The earlier draft added `DEFAULT_TAGS` to `refresh.mjs`. B's `board/config.merged.json` holds the
  full merged config with the defaults, and `RSKILL` passes that file to `map --config`, so `map` already sees the
  default tags `alert` and `incident`; a second copy of the defaults in `REFRESH` would only drift. refresh-test
  pins the path through `config.merged.json` instead.
- C28. **`renderGroups` takes one focus snapshot for all groups and restores it at the end** (`placeCards` gets an
  optional third argument `focused`): a card that moves between group lists while the operator types in it would
  otherwise lose focus, and the keyboard on a phone. The render-test stub learns to drop focus on `remove()` so the
  case fails on the old code.
- C29. **The render-test stub's `insertBefore(c, null)` appends** (a fix of the stub, not of the page): the new
  focus case calls it with `null`, which today inserts before the last child.
- C30. **Operator answer `due-dates-refresh-overrides`**: yes. An override may set `due`, `draft` and `draft_label`
  (`STR_FIELDS`), and, the source map gains the keys `due` (read like `created`, a value
  that cannot be read leaves the card without `due` and prints `note: <key>: due not read`, so the card stays open), `priority` (rules like `tags`; the first that
  matches; `map` refuses an id that the `--config` priorities lack), `summary` (cut to 300 characters) and `draft`
  (byte for byte). An override still wins for every field it names. Two generic example maps go to the new
  `RREF/maps.md`, read only when a map is written (step 2), not into `RSKILL`, which every refresh run reads.
- C31. **Operator answers `due-dates-week-start` and `personal-defaults-place` (PUBLIC)**: a page config
  key `week_start`, `"<day> <HH:MM>"`, default `"tuesday 12:00"`, any layer overrides it; `check` refuses an invalid
  value. Made a call, not a question: a due day counts at its start (00:00 in `tz`), so a card due on the start day of
  a week that starts at noon belongs to the week that ends that noon (the rota that hands over at noon still holds
  that morning). With a `monday 00:00` week this rule is the plain calendar week. The buckets are computed on the
  wall clock in `tz` (`zoneParts`), so a DST change moves no boundary. `dueBucket` and `groupCards` take a time in
  ms, not a day, because the week turns at a time of day.
- C32. **Operator answer `due-dates-answered-in-strip`**: a card stays in "Due today" after an answer and leaves it
  only when closed (C2 adds its dismiss and done controls to the same filter). `dueList` filters on `status`.
- C33. **Operator answer `grouping-default-sort`**: priority, due date, posted time, then id:
  `DEFAULTS.sort = ["priority", "due", "created", "id"]`.
- C34. **Operator answer `grouping-no-due-date`**: a card without a due date goes to This week when its priority is
  `now`, to Next week when `soon`, to Backlog when `later`. `next-week` gains the alternative
  `{ priority: ["soon"], due: ["none"] }`.
- C35. **Operator answer `grouping-alerts-match`**: by tag; `DEFAULTS.tags` gains `alert` and `incident`; `check`
  notes a default group whose tags the board's own `tags` drop.
- C36. **Operator answer `grouping-blocked-strip`**: "Blocked on you" stays, folded to one line with the count; a tap
  opens the list; the fold keeps its open state across renders; with no blocked card it is one plain line.
- C37. **Operator answer "Label wording: as proposed"** (`due-dates-visible-names`): the texts of the page layout
  section are final.
- C38. **Operator answer, chat sources**: the map key `due` is optional; without it a card has no due
  date and the groups place it by priority; the agent never infers a date and sets `due` through an override only
  when the message states one. One sentence in `RSKILL` "The map file", and the same rule in the `REF/cards.md` `due` row.
- C39. **Operator answer, no settings toggles**: `groups`, `sort` and `week_start` are config keys only;
  the side list and the folds are navigation, not settings.
- C40. **The page clock**: every new page code reads the time through A's `clockMs()` (in `render()` and the timer)
  and passes it into the pure part; the `// ---- due dates` section reads no clock. A's cuts-test enforces it.
- C41. **Plugin version 0.7.0** (A Call 23).

## Needs from other clusters

- **A**: nothing beyond the final `decision-board-spec-a-core.md`. Step C1-N0 greps every A name this cluster uses (`zoneParts`, `dayIn`,
  `stampMs`, `realDate`, `clockMs`, the time section, A's `sortedItems`, `DEFAULTS.tz`, the render-test cuts, the
  clock cuts-test, the size test, `DEFAULT_TZ`/`createdDate(v, tz)` in `REFRESH`). A's `sortedItems`
  (`cmpStamp` on `created`) is replaced by `cardCmp(cfg.sort)`, which keeps that behaviour; 1.7 appends a fourth
  render-test cut to A's three.
- **B**: nothing beyond the final `decision-board-spec-b-config.md`. This cluster appends `groups`, `sort` to B's entries-kept list with
  a `def`, writes its group notes after B's check notes, puts the `config week_start` problem after A's `config tz`
  problem, declares `warn` beside B's `noLink`, prints its warnings after B's `note: <id>: no link` lines, edits B's
  `REF/rules.md` (rule text in `draft`), B's private-values lists (`week_start`) and B's `RSKILL` step 2, and adds
  text cases to B's `tests/skill-text-test.js`. B's `checkFields()` picks up `draft`, `draft_label` and `due`; B's
  computed `config default:` lines pick up `groups`, `sort`, `week_start`; no B test changes.
- **C2 (item-controls)**, which lands after this spec (replaces the earlier draft's list):
  - C2 extends `cardState(it)` only (one parameter; keep `isActive(it)` one parameter).
    `groupCards(list, now)` keeps two parameters and the tail ids `_other`, `_done` (groups-test pins both); its
    second parameter is a time in ms, not a day: C2's step-0 grep is `function groupCards(list, now)`, not
    `(list, today)`. `dueList(sorted, today)` and `lastDay` keep their names; `lastWeek` is new.
  - `dueList` filters on `str(it.status) !== "closed"`; C2 adds its dismiss and done controls to
    that filter, and its "a snoozed card that is due shows in Due today" needs no change there.
  - The entries-kept list after this cluster is `["tabs", "priorities", "domains", "link_hosts", "tags", "groups", "sort"]`;
    C2 appends `"people"` and keeps `def`.
  - Snooze and wake dates are days in `cfg.tz`: use `todayOf`, `addDays`, `dayDiff`; any page time read goes through
    `clockMs()`.
- **D (agent-status)**: D's `#now` strip goes directly before this cluster's `#due`. D's card dot and result line live inside cards, so they work in any
  group. If D adds a page interval, it may fold this cluster's minute timer into it (keep both checks:
  `todayOf(t) !== lastDay || weekStartOf(t) !== lastWeek`).
- **board-refresh**: changed in this cluster (2.4, 2.6): override fields `due`, `draft`, `draft_label`; map keys
  `due`, `priority`, `summary`, `draft`; `readConfig` returns `priorities`; new `RREF/maps.md`. C2 adds its map key
  `input` to the same `known` list and may add `"input"` to the example maps.
- **Maintainer**: render checks R1 to R5 and M-C1 (after C1-10, on a test artifact). Backlog notes from the
  operator answers that concern later work are the maintainer's (no file of this cluster records them).

## Unverified

- U1. That clusters A and B land with the names this spec quotes; read from their final specs, not from code. Step
  C1-N0 greps each one and stops when one is missing.
- U2. That `navigator.clipboard.writeText` is allowed in the claude.ai artifact frame; the existing Copy uses the
  same call with the same `execCommand` fallback, which the operator has used, but no test reaches a real clipboard.
- U3. The width at which a claude.ai artifact renders: in the side panel it may stay under 1280 px, so the side
  list shows only on a full-page view of the artifact on a wide screen (R5 checks it).
- U4. `position: sticky` inside a grid column inside the artifact frame (R5).
- U5. That `Element.closest` and `details.open` behave in the artifact frame as in a browser (standard; not run here).
- U6. Run in Node 22 (full ICU), not Node 18: the draft label regex on its 18 fields-test pairs (all hold);
  `normWeek`, `weekStartOf` and `dueBucket` on every input of due-test cases 3 to 5 (with a local `zoneParts` built
  as A 3.5 describes, not A's landed code); the default-group placement of groups-test case 3 (a reduced model of
  `matchOne`, `cardCmp` and the default groups). The sort table of the earlier draft was run against the page's pure
  part then; the focus case, the `+groups` merge, the `note:` lines and the `REFRESH` changes were not run.
- U7. B's names that this spec quotes (`mergeLayers`, `pageDefaults()`, `checkFields()`, the variable `raw` of the
  entries-kept loop, `noLink`, the check-notes loop, `REF/rules.md` wording, the private-values lists, `RSKILL` step
  2): read from `roadmap/in-progress/decision-board-spec-b-config.md`, not code; C1-N0 greps them.
- U9. That an `.n` pill inside a `summary` and a `details` inside `.blocked` (a grid) render as intended on a phone,
  and that the default `summary` marker shows in the artifact frame (render check R4).
- U10. A due day counts at its 00:00 (C31). An operator whose rota means "due Tuesday" as "by the Tuesday handover"
  sees such a card in the ending week, which is this rule; the other reading (counting at the end of the day) would
  move start-day cards to the next week. Not asked: with the default it differs only for cards due on the start day
  of the week, and the operator can see it on the board.
- U8. The render-test stub's focus model (`remove()` drops focus to the body) is a model of the browser, not a
  browser; render check R4 should also type in a card while an agent sync moves it (manual, optional).

