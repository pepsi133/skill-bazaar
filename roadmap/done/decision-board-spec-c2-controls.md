---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Cluster C2 spec: decision-board-item-controls

Plugin root: `plugins/decision-board/` (every path below is relative to it unless it starts with `/` or `roadmap/`).
Short names: `PAGE` = `skills/decision-board/assets/board.html`, `SCRIPT` = `skills/decision-board/scripts/board.mjs`,
`REFRESH` = `skills/board-refresh/scripts/refresh.mjs`, `SKILL` = `skills/decision-board/SKILL.md`,
`REF` = `skills/decision-board/references/`, `RSKILL` = `skills/board-refresh/SKILL.md`.

This spec is final: every operator question of this cluster is answered (see "Calls made", "operator answer"),
and no step carries an open marker.

Preconditions for the whole spec: clusters A, B and C1 landed exactly as the final `decision-board-spec-a-core.md`, `decision-board-spec-b-config.md` and
`decision-board-spec-c1-fields-groups.md` say, step C2-0 (the name check, section 8) passed, and every test under `tests/` exits 0.

Names of cluster A this spec uses (final decision-board-spec-a-core.md):
- one `cards/main` document, card key = card id, no `--agent`; `export const FLAGS` (one line per command; C2 adds
  no command and no flag, so it changes no `FLAGS` line) and `export const COMMANDS`;
- batches with `status` `"sent"`/`"handled"` and `handled_at`; `const byTime = (x, y) => ...`,
  `const batchesOf = (dump) => ...`, `const waiting = (dump) => ...`; `read --dump <dir> [--all] --dumped` (it refuses
  without `--dumped`) calls `r.logHandled(dump, log)`, which deletes `unlogged[bid]` and `pending["batches/" + bid]`
  once the dump no longer lists the batch; `ack` writes
  `r.put("update", "batches", bid, { status: "handled", handled_at: t }, 1, "batches/" + bid)` (pinned to the
  literal version 1) with its cards write in the same `also` group; every printed array is followed by its
  `if refused:` and `if the reply is lost:` lines;
- the script's `nowMs()` and `now()`; the page's time section (`dayIn(ms, tz)`, `addDays(day, n)`, `stampMs`,
  `cmpStamp`) and `realDate`; outside the pure part the page reads the clock only through `clockMs()`,
  `nowStamp()`, `idStamp()`, `savedTime()` (A's cuts-test "page times come only from the time section and the clock
  helpers" bans `Date.now(` and `new Date(` elsewhere);
- `batchDoc(bid, now, s)` reads each list as `s.x || []` (`var rs = s.r || [], ns = s.n || [];`); `sendGroup(s)`;
  `send()` sends when `s.r.length + s.n.length`;
- the older-state refusal accepts unknown new state keys (C2 adds `ctl_closed` and `snoozed`, 2.3);
- `SKILL` is at most 8000 characters (board-test "SKILL.md stays short") and names `artifact-capabilities` once, at
  `P1`; C2 never names it; build text is in `REF/build.md`;
- tests: `cmd(b, ...argv)`, `ok2(b, ...argv)` (`--dump <fresh dump> --dumped`), every config a test writes sets
  `tz`, and no test pins an exact count, an exact full key list or a key position.

Names of cluster B (final decision-board-spec-b-config.md): `export const CONFIG_KEYS = Object.keys(P.DEFAULTS).filter((k) => !WRITTEN_KEYS.includes(k)).concat(SCRIPT_KEYS);`
(a key C2 adds to `DEFAULTS` is known to `check` and the merge with no edit); object keys deep-merge across layers,
a list entry with an `id` replaces in place; `export function checkFields()` (derived from `SCHEMA.item`, so
`input` and `source_key` join by themselves); `check` prints the `config ids:` line and its `config default:` line
is computed in B's tests from `CONFIG_KEYS`; `read` flags `[rule]` and `[standing]`; `tests/skill-text-test.js`
takes the text cases of later clusters; `.claude-plugin/plugin.json` went to `0.6.0`.

Names of cluster C1 (final decision-board-spec-c1-fields-groups.md): the card field `due`; config `groups`, `sort`, `week_start` and the
default tags `alert`, `incident`; `todayOf(nowMs)`; `cardState(it)` and `isActive(it)`, both with one parameter
(C1's groups-test pins `P.cardState.length === 1`, `P.isActive.length === 1`, `P.groupCards.length === 2` and the
tail ids); `matchOne(m, it, now)` and `groupCards(list, now)`, where `now` is a time in ms; `dueList(sorted, today)`,
which filters on `str(it.status) !== "closed"`; `render()`'s first line
`var now = clockMs(), today = todayOf(now); lastDay = today; lastWeek = weekStartOf(now);` and its line
`var groups = groupCards(vis, now);`; `renderGroups(groups)`, `placeCards(cont, list, focused)`, `renderDue`; the
global `[hidden] { display: none !important; }`; the minute timer
`setInterval(function () { var t = clockMs(); if (todayOf(t) !== lastDay || weekStartOf(t) !== lastWeek) schedule(); }, 60000);`;
the entries-kept loop list `["tabs", "priorities", "domains", "link_hosts", "tags", "groups", "sort"]` with its
`def`; the map keys `due`, `priority`, `summary`, `draft` in `REFRESH` and the new `skills/board-refresh/references/maps.md`;
`.claude-plugin/plugin.json` at `0.7.0`. The old Done section is gone: "Done" below means the group that takes
cards whose `cardState` is `"done"` (the default group `done`, or the tail group `_done`), shown folded.

None of these names exists in the repository today; they come from the A, B and C1 specs. Step C2-0 proves they
landed in the shape quoted here before any other step runs. Where this spec quotes a line that A, B or C1 already
changed, keep their text and apply only the change named here.

Plugin version: this cluster sets `.claude-plugin/plugin.json` `version` from `0.7.0` to `0.8.0` (step C2-11).

SKILL size: this cluster adds 340 characters to `SKILL` (6.1): from B's 6804 to about 7144, under the 8000 limit
(after an edit shortened A's step 2 by 306 characters: from about 6498 to about 6838).

The six controls, always in this order (`SCHEMA.controlNames`): `assign`, `snooze`, `dismiss`, `close`, `done`, `tags`.

---

## 1. Goal

Quick per-card controls on top of the card kind, each off until config `controls` turns it on. A tap saves at
once, the card reacts at once, and the change rides in the next batch beside the answers; `read` prints one
`control` line per change with the exact next step, `ack` applies the controls that only move a card, and only a
`close` control or an assign to the agent lets the agent write to a source, each in its one item (an assign only on a card with a `source_key`).

## 2. Data model

### 2.1 Who holds what

- The operator's control state of a card lives in its response document `responses/<card id>` (writer: the
  page). The page shows the card from that state at once, before Send.
- The batch carries only what changed since the last Send (writer: the page, on Send).
- The agent's card document `cards/main` (writer: the script) holds the card `status` that a control set. Why a
  control closed a card lives only in the state file `board/state.json` (2.3), beside `held`: `ctl_closed` maps
  the card id to `"dismiss"`, `"done"` or `"other"`. The page never writes `cards/main`.
- State-only, like `held`: `adopt` restores cards from the board, not `held`, `ctl_closed` or `snoozed`. After a lost or
  rebuilt state file, a card a control closed is treated like a card the agent closed (it comes back when its
  content changes), and a card assigned to `other` can come back on a content change. That is accepted for an
  alpha; no loss-test case is added for it.
- `snooze`, `tags` and an `assign` other than `other` change nothing in `cards/main`: the page alone shows them.
  A snooze that `ack` read also lives in the state (`snoozed`, 2.3), so `read` can tell the agent which cards wait.

### 2.2 SCHEMA changes in `PAGE` (inside "pure")

Add to the type comment above `SCHEMA`: nothing (no new type).

```js
// in SCHEMA.item, as its last two keys (after every field A and C1 put there; the position is not a contract):
input: "s", source_key: "s",
// in SCHEMA.response, after history:
controls: "o:ctl", controls_sent: "o:ctl",
// in SCHEMA.batch, after noteIds (keep A's fields):
controlIds: "l", controls: "m:bctl",
// new kinds, after bnote:
ctl: { rev: "r", assign: "s", snooze: "s", dismiss: "b", close: "b", done: "b", tags_on: "l", tags_off: "l" },
bctl: { rev: "r", assign: "S", snooze: "S", dismiss: "S", close: "S", done: "S", tags_on: "L", tags_off: "L", keep: "o:bkeep" },
bkeep: { assign: "S", dismiss: "S", done: "S" },
// new lists, after statuses:
controlNames: ["assign", "snooze", "dismiss", "close", "done", "tags"],
assignFixed: ["me", "agent", "other"],
revBound: ["snooze", "dismiss", "close", "done"],
placeKeys: ["assign", "dismiss", "done"],
personRe: /^[a-z0-9][a-z0-9_-]{0,39}$/,
```

Field meanings:

| Where | Field | Type | Default | Writer | Meaning |
|---|---|---|---|---|---|
| card (`cards/main`) | `input` | `s` | absent | the card file (`sync`), filled by `REFRESH` `map` | An opaque marker of the latest source input, for example the row's last update time. A change of it brings a dismissed or done card back (2.5). It does not raise `rev` on its own |
| card (`cards/main`) | `source_key` | `s` | absent | the card file (`sync`), filled by `REFRESH` `map` from the row key | The item's raw key in its source (`7`, `OPS-7`). Only a card with it shows the Close control; `read` names the item by `source`, `source_key` and the first link. Not in `CONTENT` |
| response | `controls` | `o:ctl` | absent | page | The operator's current control state of the card |
| response | `controls_sent` | `o:ctl` | absent | page, on Send | The control state as of the last batch that carried it |
| ctl | `rev` | `r` | 1 | page | The card `rev` when the state was last saved |
| ctl | `assign` | `s` | `""` | page | `""` (nobody), `me`, `agent`, `other`, or a `people` id |
| ctl | `snooze` | `s` | `""` | page | `""`, or the wake day `YYYY-MM-DD` in config `tz` |
| ctl | `dismiss`, `close`, `done` | `b` | false | page | The three switches |
| ctl | `tags_on`, `tags_off` | `l` | `[]` | page | Tag ids the operator added to, or took off, the card's own `tags`; sorted, each once, never in both |
| batch | `controlIds` | `l` | `[]` | page | The card ids with a control change, in send order |
| batch | `controls` | `m:bctl` | `{}` | page | Per card id: `rev` plus only the changed controls (2.4) |
| bctl | `assign`, `snooze` | `S` | absent | page | The new value; `""` means cleared |
| bctl | `dismiss`, `close`, `done` | `S` | absent | page | `"on"` or `"off"` |
| bctl | `tags_on`, `tags_off` | `L` | absent | page | Both present, as full lists, when either changed |
| bctl | `keep` | `o:bkeep` | absent | page | Present only when a place key changed and another enabled place key did not: the unchanged ones, with their current value (2.4). `read` never prints it and `decisions.md` never logs it; only `ack` reads it |
| bkeep | `assign` | `S` | absent | page | The current assign id, `""` for nobody |
| bkeep | `dismiss`, `done` | `S` | absent | page | `"on"` or `"off"` |

Rev binding: `snooze`, `dismiss`, `close` and `done` (`SCHEMA.revBound`) answer one version of the card. When
the card `rev` is higher than `controls.rev`, the page reads them as cleared (`ctlNorm`, 5.1). `assign` and the
tags survive a rev rise.

### 2.3 The state file (`board/state.json`), two new optional fields

A's older-model refusal accepts both (A 1.4 step 2: it reads only the old markers).

- `ctl_closed`: an object, card id -> `"other"`, `"dismiss"` or `"done"` (the first that holds, in that order).
  It holds only cards that were open when `ack` closed them for a control. Only these does `ack` reopen when the
  operator undoes the control; a card the agent closed itself (`close`, `ack --close`) never enters it.
  A card whose reason is `"other"` is kept closed by `sync` whatever the card file says.
- `snoozed`: an object, card id -> `{day: "YYYY-MM-DD", rev}`: the running snoozes that `ack` read (4.3 step 2b).
  `read` drops an entry whose day came, whose card's `rev` differs, or whose card is closed or gone (4.1
  `snoozedLine`), and prints the rest in one line.
- `Run` constructor: after the existing `pending`/`unlogged` line add
  `for (const k of ["ctl_closed", "snoozed"]) if (this.st[k] !== undefined && !isPlain(this.st[k])) delete this.st[k];`.
- `finish()`, after the two `held` lines, add:
  ```js
  for (const k of ["ctl_closed", "snoozed"]) if (this.st[k]) {
    for (const id of Object.keys(this.st[k])) if (!this.card(id)) delete this.st[k][id];
    if (!Object.keys(this.st[k]).length) delete this.st[k];
  }
  ```

### 2.4 What one Send carries

`controlDiff(sent, cur, rev)` (5.1) compares `ctlNorm(sent, rev)` with `ctlNorm(cur, rev)`:
- `assign`, `snooze`: the new value when it differs.
- `dismiss`, `close`, `done`: `"on"`/`"off"` when it differs.
- `tags_on` and `tags_off`: both, as full lists, when either list differs.
- `keep`: when at least one of `SCHEMA.placeKeys` (`assign`, `dismiss`, `done`) differs, every other place key that
  the config turns on and that did NOT differ goes into `keep` with its current value of `b` (`assign` as its id,
  `dismiss`/`done` as `"on"`/`"off"`). `keep` is left out when it would be empty. `ack` then knows the whole
  placement of the card from one batch (4.3), while `read` prints and `decisions.md` logs only the keys that
  changed. A control the config turns off never travels, in `keep` neither (`ctlNorm` gives its default on both sides).
- `rev`: always, the card `rev` at send time. Nothing changed: `null` (`keep` alone is never a change).

Example batch (A's 0.2 shape plus the two new fields):

```json
{"id": "b20261113T133108+0100-k3x9", "created": "2026-11-13T13:31:08.412+01:00",
 "itemIds": ["disk-size"], "noteIds": [], "controlIds": ["disk-size", "tracker-7"],
 "answers": {"disk-size": {"answer": "Yes", "note": "", "rev": 2}}, "notes": {},
 "controls": {"disk-size": {"rev": 2, "snooze": "2026-11-20"},
              "tracker-7": {"rev": 1, "dismiss": "on", "keep": {"assign": "", "done": "off"}}},
 "status": "sent"}
```

### 2.5 Hold rules (the script)

- `held` (existing): closed by `close`, `ack --close`, or `ack` for a control. A held card reopens in `sync` when
  its content changes (existing rule, for every held card).
- New: a held card whose `ctl_closed` reason is `"dismiss"` or `"done"` also reopens when the card file brings an
  `input` that differs from a non-empty stored `input`. Both reopen with `rev + 1`, so the page shows it as a new question. A card the agent
  closed itself does not return on a changed `input`: the agent's own work in the source (the close that a `close`
  control asks for) changes the row's update time, and would otherwise bring its own card back.
- A stored `input` is kept when a card file leaves `input` out (4.4 step 2), so a row that lacks the field does not
  erase the marker.
- Reason `"other"`: never reopened by `sync`. Only `ack` of a batch whose placement is no longer `other` takes the
  card out of `ctl_closed` and reopens it.

## 3. Config

New keys in `DEFAULTS` of `PAGE`: append `controls` and `people` after the last key that A, B and C1 leave (C1's
`week_start`). The position is not a contract: no test pins the key list or a position (A's convention); B's
`CONFIG_KEYS` and its computed `config default:` lines take them by themselves:

```js
controls: { assign: false, snooze: false, dismiss: false, close: false, done: false, tags: false },
people: [],
```

| Key | Type | Default | Validation |
|---|---|---|---|
| `controls` | object of the six `SCHEMA.controlNames` keys, each `true` or `false` | all `false` | `check` problems: `config controls: not an object`; `config controls: unknown field "<k>"` (text through `q`); `config controls.<k>: true or false` |
| `people` | list of `{id, label}` | `[]` | `id` matches `SCHEMA.personRe` and is not `me`, `agent` or `other`; a bad or repeated entry is dropped and `check` prints the existing `config people: <kept> of <n> entries kept` |

- `normConfig`: `out.controls = normControls(g("controls"))` and
  `out.people = idList(g("people"), personOk).map(function (x) { return { id: x.id, label: x.label || x.id }; });`
- `function normControls(v) { var o = {}; SCHEMA.controlNames.forEach(function (k) { o[k] = isObj(v) && own(v, k) && v[k] === true; }); return o; }`
- `function personOk(id) { return SCHEMA.personRe.test(id) && SCHEMA.assignFixed.indexOf(id) < 0; }`
- Every control is off in the plugin defaults; the operator turns one on in any layer (B), for example
  `"controls": {"snooze": true, "done": true}` in the user file. `controls` is an object, so B deep-merges it.
  `people` is a list of `{id}` entries, so a later layer's entry replaces an earlier one in place (B).
- A control that the config turns off is invisible on the page, never travels in a batch, and `read` flags a
  line of it `[not-enabled]` (it can come from a batch sent before the config changed).
- The assign list, in this order (`assignList()`, 5.1): `{id: "me", label: "Me"}`, `{id: "agent", label: cfg.agent}`,
  each `people` entry, `{id: "other", label: "Not ours"}`. `""` is "Nobody".
- `check` (`SCRIPT` `cmdCheck`): append `"people"` to the "entries kept" loop list that C1 left, and keep C1's
  `def` line: the list becomes
  `["tabs", "priorities", "domains", "link_hosts", "tags", "groups", "sort", "people"]` (for `people`, `def` is
  `P.DEFAULTS.people`, which `normConfig` never returns, so `got` is the kept count). Add, in B's `problem:` order
  directly after C1's `config week_start` problem, with `raw` = the merged config that the loop reads:
  ```js
  if (raw.controls !== undefined) {
    if (!isPlain(raw.controls)) errs.push("config controls: not an object");
    else for (const k of Object.keys(raw.controls)) {
      if (!S.controlNames.includes(k)) errs.push(`config controls: unknown field ${q(k)}`);
      else if (typeof raw.controls[k] !== "boolean") errs.push(`config controls.${k}: true or false`);
    }
  }
  ```
  `controls` and `people` reach `CONFIG_KEYS` through `DEFAULTS` (B); no literal list changes there.
- No setting is a page control: `controls` and `people` are config keys only; the
  controls themselves are per-card actions that go out in a batch.

## 4. Script

### 4.1 `SCRIPT`: shared helpers (module level, after `qid`)

```js
// The control lines of a batch: one entry per changed control, in controlIds order, then SCHEMA.controlNames order.
// tags is one entry when tags_on or tags_off is present. keep is never an entry (it is not in S.controlNames).
function controlsOf(b) {
  const out = [];
  for (const id of b.controlIds) {
    const x = b.controls[id];
    if (!x) continue;
    for (const key of S.controlNames) {
      if (key === "tags" ? x.tags_on !== undefined || x.tags_off !== undefined : x[key] !== undefined) out.push({ id, key, x });
    }
  }
  return out;
}
// The flags of one control line; an empty list means the agent and ack act on it.
function ctlFlags(r, e) {
  const c = r.card(e.id), flags = [];
  if (!c) return ["[missing]"];
  const rev = P.coerce("item", c).rev;
  if (S.revBound.includes(e.key)) { if (e.x.rev < rev) flags.push("[stale-rev]"); else if (e.x.rev !== rev) flags.push("[other-rev]"); }
  if (!P.cfg.controls[e.key]) flags.push("[not-enabled]");
  const v = e.x[e.key], tagIds = P.cfg.tags.map((t) => t.id);
  const bad = e.key === "assign" ? v !== "" && !P.assignIds().includes(v)
    : e.key === "snooze" ? v !== "" && !P.realDate(v)
    : e.key === "tags" ? [...(e.x.tags_on || []), ...(e.x.tags_off || [])].some((t) => !tagIds.includes(t))
    : v !== "on" && v !== "off";
  if (bad) flags.push("[bad-value]");
  // A close needs the item: a card without source_key names none (only map cards have one).
  if (e.key === "close" && v === "on" && !(typeof c.source_key === "string" && c.source_key.trim())) flags.push("[no-item]");
  return flags;
}
// The value as read prints it. Database text goes through q() or JSON.stringify, so no value can forge a line.
const ctlText = (e) => (e.key === "tags" ? `+${JSON.stringify(e.x.tags_on || [])} -${JSON.stringify(e.x.tags_off || [])}` : q(e.x[e.key]));
// The value as decisions.md logs it.
const ctlPlain = (e) => (e.key === "tags" ? [...(e.x.tags_on || []).map((t) => "+" + t), ...(e.x.tags_off || []).map((t) => "-" + t)].join(" ") || "none"
  : e.x[e.key] === "" ? "none" : e.x[e.key]);
// The source item of a card as read names it: source, source_key and the first link, each through q(); a card
// with no link (links are optional, B) prints the bare words "link none" in the link's place.
const itemOf = (c) => {
  const url = Array.isArray(c.links) && c.links[0] && typeof c.links[0].url === "string" ? c.links[0].url : "";
  return `item ${q(c.source || "")} ${q(c.source_key || "")} ${url ? q(url) : "link none"}`;
};
// What the agent does with one control line, printed in brackets at its end: the script decides, the agent follows.
// flags: the line's flags ([superseded] included). This is the one place a later per-source close command would
// change the close step.
function ctlHint(c, e, flags) {
  if (flags.length) return "(skip)";
  const v = e.x[e.key];
  if (e.key === "close" && v === "on") return `(close ${itemOf(c)} in its source with the operator's own tool for it; change nothing else there; then add --close ${qid(e.id)} to the ack line; if you cannot, leave the card and say why in your reply)`;
  if (e.key === "assign" && v === "agent") return typeof c.source_key === "string" && c.source_key.trim()
    ? `(do the work the card asks; in a source change only ${itemOf(c)}; leave the card open and say what you did in your reply)`
    : "(do the work the card asks, with no write to any source; leave the card open and say what you did in your reply)";
  if (e.key === "assign" || e.key === "dismiss" || e.key === "done") return "(ack applies it)";
  if (e.key === "snooze" && v !== "") return `(no follow-up before ${v})`;
  return "(nothing to do)";
}
// read: the running snoozes of the state, as one line, or "". Drops the ones whose day came (today in the config
// tz), whose card changed rev, or whose card is closed or gone. ack writes r.st.snoozed (4.3 step 2b).
function snoozedLine(r) {
  const today = P.dayIn(nowMs(), P.cfg.tz), s = r.st.snoozed || {}, out = [];
  for (const id of Object.keys(s)) {
    const c = r.card(id), x = s[id];
    if (!c || c.status === "closed" || !isPlain(x) || P.coerce("item", c).rev !== x.rev || !(String(x.day) > today)) delete s[id];
    else out.push(`${qid(id)} before ${x.day}`);
  }
  if (r.st.snoozed && !Object.keys(r.st.snoozed).length) delete r.st.snoozed;
  return out.length ? "snoozed: do not follow up on " + out.join(", ") : "";
}
```

`P.assignIds()` is the page function of 5.1. `P.cfg.controls` is set by `P.applyConfig` in `new Run(...)`, from the
merged config (B). `nowMs()` is A's (3.4 step 1). `x.day` is printed raw only because `ack` stored it after the
`realDate` check of `ctlFlags`.

### 4.2 `read --dump <dir> [--all] --dumped`

Precondition: A's `read` (A 2.4 step 3: the `--dumped` refusal, `r.logHandled(dump, log)`, the list `waiting(dump)`
or, with `--all`, `batchesOf(dump)`), with B's `rules:` line and `[rule]`/`[standing]` flags.

1. Directly after `r.logHandled(dump, log)` (and B's `rules:` line, which comes before it), add
   `{ const sl = snoozedLine(r); if (sl) log(sl); }`. It prints before `no batches waiting` and before the first batch.
2. Batch header line: append `  controls on <k> cards` when `b.controlIds.length` is `k > 0`, after the notes part
   and before A's handled suffix:
   `` `batch ${qid(b.id)}  ${q(shown(b.created))}  ${b.itemIds.length} answers  ${b.noteIds.length} notes${b.controlIds.length ? "  controls on " + b.controlIds.length + " cards" : ""}` ``
   then A's `` `  handled ${q(shown(b.handled_at))}` `` for a handled batch. A batch without controls prints exactly A's line.
3. Before the batch loop, the superseded set (a control that a later waiting batch of this list sets again for the
   same card):
   ```js
   const later = new Set(), sup = new Set();
   for (const b of list.slice().reverse()) if (b.status === "sent") for (const e of controlsOf(b)) {
     const k = e.id + "\n" + e.key;
     if (later.has(k)) sup.add(b.id + "\n" + k); else later.add(k);
   }
   ```
4. After the answer lines and before the note lines, for each `e` of `controlsOf(b)`, with
   `const fl = ctlFlags(r, e).concat(sup.has(b.id + "\n" + e.id + "\n" + e.key) ? ["[superseded]"] : []);`:
   `` `  ${qid(e.id)}  control ${e.key} ${ctlText(e)}${fl.length ? "  " + fl.join(" ") : ""}${b.status === "sent" ? "  " + ctlHint(r.card(e.id), e, fl) : ""}` ``
   (a handled batch, shown only with `--all`, gets no hint). `ctlHint` reads the card only when `fl` is empty, so a
   `[missing]` card is never read.
5. Nothing else changes (the `when handled:` line, `--all`, the notes, B's flags).

Exact example for the batch of 2.4, config `tz: "Europe/Warsaw"`, card `disk-size` at rev 2 in the state and
`tracker-7` at rev 1, every control on in the config except `snooze`, which the operator turned off after this
batch went out:

```
batch b20261113T133108+0100-k3x9  "2026-11-13T13:31:08+01:00"  1 answers  0 notes  controls on 2 cards
  disk-size  "Yes"  ""
  disk-size  control snooze "2026-11-20"  [not-enabled]  (skip)
  tracker-7  control dismiss "on"  (ack applies it)
  when handled: node <SELF> ack b20261113T133108+0100-k3x9 --dump board/dump
```

(With `snooze: true` the snooze line is `  disk-size  control snooze "2026-11-20"  (no follow-up before 2026-11-20)`.)
### 4.3 `ack <batch id> [--close <id>...] --dump <dir>`

Precondition: A's `ack` (A 2.4 step 4): the `already handled` and `status not sent` branches, `r.needCards(close, "ack")`,
then `r.put("update", "batches", bid, { status: "handled", handled_at: t }, 1, "batches/" + bid)` (the literal
`if_version: 1`), the cards write with `also = "batches/" + bid`, the `unlogged[bid]` rows with `day`. `t` is A's
`now()`.

New steps, in this order, after the "status not sent" check and `r.needCards(close, "ack")`, before the `put`:

1. **Order.** `const mineIds = new Set(batch.controlIds);`
   ```js
   // An earlier batch that this state already acked (its write is pending, not yet in the dump) does not block:
   // the agent may ack several batches from one dump, in the order read printed them.
   const first = waiting(dump).find((x) => x.id !== bid && byTime(x, batch) < 0 && !r.st.pending["batches/" + x.id] &&
     x.controlIds.some((id) => mineIds.has(id)));
   ```
   If `first`: `` fail(`ack: ack ${qid(first.id)} first: it holds controls for the same cards. Nothing written`) ``.
   (`r.st.pending["batches/" + id]` is set by A's ack `put` and deleted by `r.logHandled` once the dump no longer
   lists the batch.)
2. **Placement per card.**
   ```js
   const toClose = new Set(), toOpen = new Set(), ctl = Object.assign({}, r.st.ctl_closed || {});
   // The value of one place key: the changed value, else the kept one; undefined when absent or flagged.
   const v = (id, key) => {
     const x = batch.controls[id], raw = x[key] !== undefined ? x[key] : x.keep ? x.keep[key] : undefined;
     if (raw === undefined) return undefined;
     return ctlFlags(r, { id, key, x: { rev: x.rev, [key]: raw } }).length ? undefined : raw;
   };
   for (const id of batch.controlIds) {
     const x = batch.controls[id];
     if (!x || !r.card(id) || !S.placeKeys.some((k) => x[k] !== undefined)) continue;
     const why = v(id, "assign") === "other" ? "other" : v(id, "dismiss") === "on" ? "dismiss" : v(id, "done") === "on" ? "done" : "";
     const wasOpen = r.card(id).status !== "closed";
     if (why && (wasOpen || ctl[id])) { toClose.add(id); ctl[id] = why; }   // an agent's own close never enters ctl
     else if (!why && ctl[id]) { toOpen.add(id); delete ctl[id]; }
   }
   r.st.ctl_closed = ctl;
   ```
   - `why` set, card open: closed for a control, reason stored.
   - `why` set, card already closed and in `ctl`: the reason is updated (for example `dismiss` -> `other`).
   - `why` set, card closed by the agent (not in `ctl`): nothing; unticking later reopens nothing.
   - `why` empty, card in `ctl`: reopened.
   - `why` empty, card not in `ctl`: nothing (an agent's own close stays).
   A flagged place value (`[stale-rev]`, `[other-rev]`, `[not-enabled]`, `[bad-value]`) counts as absent, so a
   stale `dismiss "on"` closes nothing.
2b. **Snoozes**:
   ```js
   const sn = Object.assign({}, r.st.snoozed || {});
   for (const e of controlsOf(batch)) {
     if (e.key !== "snooze" || ctlFlags(r, e).length) continue;   // a flagged snooze changes nothing
     if (e.x.snooze === "") delete sn[e.id]; else sn[e.id] = { day: e.x.snooze, rev: e.x.rev };
   }
   r.st.snoozed = sn;                                              // finish() deletes an empty object
   ```
3. **Explicit closes win.** Remove every `--close` id from `toOpen` (its `ctl` entry stays deleted: the card is now
   the agent's own close).
4. `const k1 = r.closeCards(Array.from(toClose), t);` (`closeCards` also adds them to `held`).
   `const j = r.openCards(Array.from(toOpen), t);` with the new `Run` method:
   ```js
   // ack: undo a control close. Back to open, out of held; the content and rev stay.
   openCards(ids, t) {
     let k = 0;
     for (const id of ids) { const c = this.card(id); if (c && c.status === "closed") { c.status = "open"; c.updated = t; k++; } }
     this.st.held = (this.st.held || []).filter((x) => !ids.includes(x));
     return k;
   }
   ```
5. Then the existing `--close` handling: `const k2 = r.closeCards(close, t)`; `k = k1 + k2`.
6. The cards write goes out, in the same `also` group, when `k + j > 0` (A wrote it for `k > 0`).
7. `unlogged[bid]` gets, after the answer rows and before the note rows, one row per `controlsOf(batch)` entry
   (so never a `keep` value):
   `const fl = ctlFlags(r, e);` and the row `[e.id, "control " + e.key + " " + ctlPlain(e) + (fl.length ? " " + fl.join(" ") : ""), "", day]`.
   Flagged entries are logged with their flags (`control dismiss on [stale-rev]`), so the record never shows a
   control that was not applied as a decision.
8. The printed line becomes
   `` `ack ${bid}: handled, ${k} cards closed, ${j} reopened. The answers go to decisions.md when the next read no longer lists the batch` ``.
   (D later inserts `, ${m} results` after `${j} reopened`.)

`close`, `tags` and `assign` values other than `other` change nothing in the state, except that an `assign` change
re-decides the placement of step 2 together with the kept `dismiss`/`done`; `snooze` changes only `snoozed` (2b).
`assign "agent"` closes nothing.

Error cases added: `ack: ack <id> first: it holds controls for the same cards. Nothing written` (exit 1, no write,
no state change).

`USAGE` line for ack (A 2.4 step 7 text, one change): `  ack <batch id> [--close <id>...] --dump <dir>   mark a batch handled, apply its controls, and close cards`.
No new flag: `FLAGS.ack` stays `["state", "dump", "close"]`.

### 4.4 `sync`

Precondition: A's, B's and C1's `sync` (B's `noLink` push and C1's draft warnings stay where they are).

0. In the per-file loop (`list.forEach((c) => { ... })`), directly after the line `if (f.source) c.source = f.source;`:
   ```js
   // source_key names the item a Close or an assign to the agent may write to: only a map file, synced with its
   // --source, carries it.
   if (!f.source && P.isObj(c) && c.source_key !== undefined) errs.push(`${typeof c.id === "string" && c.id ? c.id : "?"}: source_key: set only by board-refresh map; sync that file with --source`);
   ```
1. Before the card loop: `const ctl = Object.assign({}, r.st.ctl_closed || {});`
2. In the loop, right after the line `for (const k of Object.keys(S.item)) ... doc[k] = c[k];` (before the `links`
   line), add:
   ```js
   // A card file without input keeps the stored marker (a row that lacks the field must not erase it).
   if (doc.input === undefined && ex && typeof ex.input === "string") doc.input = ex.input;
   ```
3. Right after `const content = ...`:
   ```js
   // A card the operator dismissed or marked done comes back as a new question (rev up) when its source brings a
   // new input. A card without a stored input comes back only on a content change, so the first map run with an
   // input key reopens nothing. Never a card the agent closed: its own work in the source changes that input.
   const back = !!ex && held.has(c.id) && (ctl[c.id] === "dismiss" || ctl[c.id] === "done") && typeof doc.input === "string" &&
     typeof ex.input === "string" && ex.input !== "" && doc.input !== ex.input;
   ```
   (Operator answers `item-controls-new-input` and `item-controls-done-return`.)
4. Replace `if (content) held.delete(c.id);` by
   `if ((content || back) && ctl[c.id] !== "other") { held.delete(c.id); delete ctl[c.id]; }`.
5. Replace the status line by
   `doc.status = c.status || (old && !content && !back && (!f.source || held.has(c.id)) ? old.status : "open") || "open";`
   then add `if (ctl[c.id] === "other") doc.status = "closed";`.
6. `doc.rev = old ? old.rev + (content || back ? 1 : 0) : 1;` and `if (!old) n.new++; else if (content || back) n.rev++; else n.changed++;`.
   The `reopened` list already catches `back` (old closed, doc open).
7. After the loop, beside `r.st.held = Array.from(held);`: `r.st.ctl_closed = ctl;` (an empty object is deleted by
   `finish()`).
8. The `--source` close of a missing card is unchanged: a card with reason `"other"` is already closed, so it is
   not counted.

No change to the printed line format. A card with reason `"other"` in a refresh file: `0 changed` when nothing
differs, `1 changed (same rev)` when only its non-content fields differ, and it stays closed either way. A card
closed by the agent (`close`, `ack --close`) whose `input` changes: `1 changed (same rev)`, still closed.

### 4.5 `purge`

The test "holds only purged cards" counts the cards of `controlIds` too:
`const cardsOfBatch = (b) => Array.from(new Set(b.itemIds.concat(b.controlIds)));` and the filter becomes
`b !== newest && cardsOfBatch(b).length && !b.noteIds.length && cardsOfBatch(b).every((x) => gone.has(x)) && P.isHandled(b)`.

### 4.6 `REFRESH` (`map`): the `input` key and `source_key`

Precondition: C1's `REFRESH` (C1 2.4: the map keys `due`, `priority`, `summary`, `draft`).

1. `checkMap`: in C1's line `for (const k of ["who", "rows", "kind", "due", "summary", "draft"]) ...` add `"input"`
   (`["who", "rows", "kind", "due", "summary", "draft", "input"]`), and append `"input"` to C1's `known` list
   (`..., "priority", "due", "summary", "draft", "input"]`).
2. `cmdMap`, the card literal `const c = { id, source, kind: m.kind || "action", title, links: [...] };` gains
   `source_key: key` after `source` (the raw row key text, as `text(get(row, m.key))` gave it; the Close control and
   an `assign "agent"` line name the item by it, operator answers `item-controls-close-how` and
   `item-controls-assign-source-write`). An override cannot set it (it is not in `STR_FIELDS`).
3. `cmdMap`, directly after C1's line `if (due && !badDue) c.due = due;`:
   ```js
   // input: the row field that changes when the item gets new activity (for example updated_at). A list is joined.
   if (m.input) {
     const v = get(row, m.input), t = (Array.isArray(v) ? v.map(text).filter(Boolean).join(",") : text(v)).slice(0, MAX_S);
     if (t) c.input = t;
   }
   ```
   A row without the field gets no `input`; that is not a skip reason.
4. `USAGE` of `REFRESH`: no change (the map keys are documented in `RSKILL`).

## 5. Page (`PAGE`)

### 5.1 Pure functions (node-tested; inside "pure", a new section `// ---- quick controls` directly before `// ---- visibility`, after `// ---- revisions and answers`)

The pure part reads no clock (A's rule): every function that needs today's day takes it, or reads `ctlDay`, which
`render()` sets.

```text
var ctlDay = ""   // the day "YYYY-MM-DD" in cfg.tz that cardState compares a snooze with; set by render() through setCtlDay
setCtlDay(day) -> ctlDay = day
assignList() -> [{id: "me", label: "Me"}, {id: "agent", label: cfg.agent}, ...cfg.people, {id: "other", label: "Not ours"}]
assignIds() -> assignList().map(x => x.id)
anyControl() -> SCHEMA.controlNames.some(k => cfg.controls[k])
ctlDefault() -> {rev: 1, assign: "", snooze: "", dismiss: false, close: false, done: false, tags_on: [], tags_off: []}
ctlNorm(c, rev) -> a new ctl object:
    start from ctlDefault(); copy assign, snooze, dismiss, close, done, tags_on, tags_off of c (when c is an object);
    when wholeRev(c && c.rev) < rev: snooze = "", dismiss = close = done = false;
    for each k of controlNames with !cfg.controls[k]: its default (k "tags" resets tags_on and tags_off);
    assign not in assignIds() -> ""; snooze that fails realDate -> "";
    tags_on, tags_off: only ids of cfg.tags, each once, sorted; an id in both is dropped from both;
    rev = rev
ctlOf(it) -> ctlNorm(r && r.controls, revOf(it)) with r = resp.get(it.id)
controlDiff(sent, cur, rev) -> bctl object or null, by the rules of 2.4 over a = ctlNorm(sent, rev), b = ctlNorm(cur, rev):
    out = {rev}; per controlName k with cfg.controls[k] and a differs from b on k: set out's key(s) for k;
    then when some placeKey was set: keep = {} and per placeKey p with cfg.controls[p] not set in out:
    keep[p] = p === "assign" ? b.assign : (b[p] ? "on" : "off"); out.keep = keep when it has a key;
    return null when out has no key but rev
ctlUnsent(it, r) -> !!r && controlDiff(r.controls_sent, r.controls, revOf(it)) !== null
withControls(prev, itemId, patch, rev, now) -> the response doc after a control tap:
    prev null -> {itemId, choice: "", note: "", rev, updated: now, sent: false, batch: ""};
    else a copy of prev with updated = now (choice, note, rev, sent, batch, history, controls_sent unchanged);
    controls = ctlNorm(prev && prev.controls, rev), then each key of patch that is a ctl key other than rev
    overwrites it, then controls = ctlNorm(controls, rev) again (sorts tags, drops bad values)
tagsOf(it) -> effective tag ids: strs(it.tags) minus c.tags_off, then c.tags_on not yet in it; c = ctlOf(it)
tagPatch(it, id) -> {tags_on, tags_off} after a tap on the chip of tag id:
    effective -> remove: drop it from tags_on, and add it to tags_off when strs(it.tags) holds it;
    not effective -> add: drop it from tags_off, and add it to tags_on when strs(it.tags) lacks it
ctlDone(it) -> c.dismiss || c.done || c.assign === "other"   (c = ctlOf(it))
isSnoozed(it, today) -> !isDone(it) && ctlOf(it).snooze > today   (a day compare: the card wakes at 00:00 of the wake day in cfg.tz)
notOursList(list) -> list.filter(it => cardState(it) === "hidden")   (list order kept)
doneReason(it) -> "not ours" (assign other), "dismissed", "done" (in that order of ctlOf), else stateOf(it) ("closed" or "sent")
stateLabel(it) -> the state tag text key:
    cs = cardState(it); cs === "done" or cs === "hidden" -> doneReason(it);
    else st = stateOf(it); st is not "closed" or "changed" and ctlUnsent(it, resp.get(it.id)) -> "unsent";
    else st
ctlNote(it, today) -> the banner text, first match in this order, else "":
    c.assign === "other" -> "Not ours: the agent stops tracking it"
    c.close && it.status !== "closed" -> "Close requested: the agent closes it in " + (str(it.source) || "the source")
    c.dismiss -> "Dismissed: it comes back when something new arrives"
    c.done -> "Marked done"
    c.snooze > today -> "Snoozed until " + fmtDay(c.snooze)
fmtDay(day) -> realDate(day) ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString([], {timeZone: "UTC", weekday: "short", month: "short", day: "numeric"}) : ""   ("" on a throw)
snoozeDay(today, pick) -> pick "day": addDays(today, 1); pick "week": addDays(today, 7); else ""
snoozeOk(day, today) -> realDate(day) && day > today && day <= addDays(today, 366)
```

Changes to existing pure functions (C1's code as C1 3.5 and 2.5 write it; keep every other line):

- C1's `cardState(it)` keeps its one parameter (C1's groups-test pins `P.cardState.length === 1`) and becomes:
  ```js
  // The state a group matches: hidden (Not ours: no group takes it), done, snoozed or active. A card that a control
  // just moved keeps its old state while it lingers (lingerOf, outside "pure"; the tests and the script stub it as
  // function () { return ""; }). A snooze is compared with ctlDay, the day render() set.
  function cardState(it) {
    var held = lingerOf(it.id);
    if (held) return held;
    if (ctlOf(it).assign === "other") return "hidden";
    if (isDone(it)) return "done";
    return isSnoozed(it, ctlDay) ? "snoozed" : "active";
  }
  ```
  C1's `isActive(it)` is unchanged (`return cardState(it) === "active";`, one parameter), so `blockedList`,
  `tabCounts(list, isActive)`, `vis.filter(isActive)` and the Open count leave snoozed and Not ours cards out with
  no change of their own.
- C1's `matchOne(m, it, now)`: its first line
  `if (m.state !== "any" && m.state !== cardState(it)) return false;` becomes
  `var st = cardState(it); if (st === "hidden" || (m.state !== "any" && m.state !== st && !(st === "snoozed" && m.state === "active"))) return false;`
  A snoozed card stays in the group it had while active, as a slim row in its place (5.4); a Not ours card matches
  no group, `state: "any"` included. Its tags line `if (m.tags && !strs(it.tags).some(` reads `tagsOf(it)` in place
  of `strs(it.tags)`. C1's `normMatch` and `GROUP_STATES` are unchanged (`active`, `done`, `any`).
- C1's `groupCards(list, now)`: inside `list.forEach(function (it) {`, add as the first line
  `if (cardState(it) === "hidden") return;` (a Not ours card is in no group, so not in `_other` either). Nothing else
  changes: two parameters, tail ids `_other` and `_done`.
- C1's `dueList(sorted, today)`: its filter `str(it.status) !== "closed" && realDate(it.due) && it.due <= today` becomes
  `str(it.status) !== "closed" && !ctlDone(it) && realDate(it.due) && it.due <= today`.
- `nextResponse(prev, itemId, choice, note, rev, now)` (A's form): after `doc` is built, add
  `if (prev && prev.controls) doc.controls = prev.controls; if (prev && prev.controls_sent) doc.controls_sent = prev.controls_sent;`.
- `isDone(it)`: `var st = stateOf(it); return st === "sent" || st === "closed" || ctlDone(it);`.
- `stateOf(it)`: unchanged. It reads only the answer state, so an unsent control never moves a sent card out of
  Done and never takes an unanswered card out of the Open count. The "unsent" cue of a control is a label only
  (`stateLabel`, shown by `updateCard`, 5.2).
- `sendable()` returns `{r, n, c}`: `r` and `n` as A has them; `c` = every response `x` whose card `it = items.get(id)`
  exists and `ctlUnsent(it, x)`, whether the card is closed or not (an undo on a closed card must reach the agent).
- `unsentCount()`: `var s = sendable(), ids = {}; s.r.concat(s.c).forEach(function (x) { ids[x.itemId] = true; }); return Object.keys(ids).length + s.n.length;`.
- `batchDoc(bid, now, s)`: after A's first line `var rs = s.r || [], ns = s.n || [];` add `var cs = s.c || [];` (A's
  convention: a caller without `c`, such as model-test's `batchDoc("b1", "t", {})`, gets `controlIds: []` and
  `controls: {}`). Add `controlIds: cs.map(function (x) { return x.itemId; })` and `controls` = an
  `Object.create(null)` map from each `x.itemId` of `cs` to `controlDiff(x.controls_sent, x.controls, revOf(items.get(x.itemId)))`.
  Field order in the returned object: A's, with `controlIds` after `noteIds` and `controls` after `notes`.
- `byTag(tab, it)`: `tagsOf(it)` in place of `strs(it.tags)`. `tagChips(it)`: iterate `tagsOf(it)`.
- `openCount()`: counts cards whose `stateOf` is `open` or `changed` and whose `cardState(it)` is `"active"`
  (exact body: `var n = 0; items.forEach(function (it) { var s = stateOf(it); if ((s === "open" || s === "changed") && cardState(it) === "active") n++; }); return n;`).
- `blockedList` and `tabCounts`: no change (they use `isActive`).

### 5.2 Shared render code (outside "pure"; the look is a maintainer check, section 8)

Every time read outside the pure part goes through A's clock helpers: `clockMs()`, `nowStamp()`, `savedTime()`.
No `Date.now()` and no `new Date(` here (A's cuts-test "page times come only from the time section and the clock
helpers").

State, beside `timers`:
```js
var lingerUntil = new Map();   // itemId -> {until: ms, state: the cardState before the tap}
var LINGER_MS = 4000;          // done, dismiss, Not ours and snooze keep the card in place this long, with Undo
// The state a lingering card keeps, or "" (read by cardState in "pure").
function lingerOf(id) { var x = lingerUntil.get(id); return x && x.until > clockMs() ? x.state : ""; }
```
`tests/_page.js` (`load()` context) and `SCRIPT` `loadPage()` (its `vm` context) gain `lingerOf: () => ""` beside
`isPending`.

CSS, appended before the `@media (prefers-reduced-motion ...)` line:
```css
.chead { display: flex; gap: 8px; align-items: flex-start; }
.chead h2 { flex: 1; min-width: 0; }
.gut { flex: none; display: grid; place-items: center; width: 44px; height: 44px; margin: -10px 0 -10px -10px; cursor: pointer; }
.gut input { width: 22px; height: 22px; margin: 0; accent-color: var(--good); }
.ctl { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ctl select, .ctl button, .snz button, .snz input { min-height: 40px; }
.snz, .panel { display: grid; gap: 6px; padding: 8px; background: var(--surface-2); border-radius: 6px; }
.snz .row { display: flex; flex-wrap: wrap; gap: 6px; }
.sw { display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 4px 0; background: none; border: 0; text-align: left; }
.sw .k { flex: none; position: relative; width: 44px; height: 26px; border-radius: 13px; background: var(--line); }
.sw .k::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--surface); }
.sw[aria-checked="true"] .k { background: var(--good); }
.sw[aria-checked="true"] .k::after { left: 21px; }
.sw:disabled { opacity: 0.5; }
.chip[aria-pressed] { min-height: 36px; cursor: pointer; border: 1px solid var(--line); background: var(--surface); }
.chip[aria-pressed="true"] { border-color: var(--accent); background: var(--surface-2); font-weight: 600; }
.banner { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 6px; background: var(--surface-2); font-size: 13px; }
.slimrow { display: none; }
.card.slim > * { display: none; }
.card.slim > .slimrow { display: flex; gap: 8px; align-items: center; min-height: 44px; }
.card.slim { padding: 4px 8px; opacity: 0.85; }
.slimrow .open { flex: 1; min-width: 0; text-align: left; background: none; border: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
```
and edit the existing rule `@media (prefers-reduced-motion: no-preference) { .card, .guide, .opt { transition: ... } }`
(the motion-allowed rule, the last line before `</style>`): append `, opacity 0.25s` to its `transition` list.
No other media rule changes.

`buildCard(it)` changes (each element made with `h()` and `text`, never HTML):
- Wrap the title: `c.chead = h("div", { class: "chead" }, c.gut, c.title)`, where `c.gut` is 5.7's done box. The
  `article` children list uses `c.chead` where it used `c.title`.
- After `c.ta` and before the `foot`: `c.banner` (5.2 below), `c.ctl` (the control row, operator answer
  `item-controls-layout`: `c.ctl = h("div", { class: "ctl" }, c.assign, c.snzBtn, c.more)`, that is Assign 5.3, the
  Snooze button 5.4 and the Edit button), `c.snz` (5.4), `c.panel` (the edit panel:
  `c.panel = h("div", { class: "panel", hidden: true }, c.dismissSw, c.closeSw, c.tagWrap)`, 5.5, 5.6, 5.8). Before
  `c.chead`: nothing. As the last child: `c.slimrow` (5.4).
- `c.more = h("button", { type: "button", class: "link small", "aria-expanded": "false", text: "Edit" })`; a tap
  toggles `c.panelOpen`, sets `aria-expanded` to `String(c.panelOpen)` and calls `render()`. Its text is `"Edit"`
  while closed and `"Hide"` while open (the scoping names it the edit panel).
- `c.banner = h("div", { class: "banner", hidden: true }, c.bannerText = h("span", { class: "grow" }), c.undoBtn = h("button", { type: "button", class: "link small", text: "Undo" }))`.
  A tap on Undo: `var u = c.undo; c.undo = null; lingerUntil.delete(c.it.id); setControl(c, u, null);`.

New functions:
```js
// A control tap: save at once; a card that this moves to Snoozed, Done or Not ours stays in place for LINGER_MS, with Undo.
function setControl(c, patch, undo) {
  var id = c.it.id;
  // A tap that cannot move the card (tags, or an assign other than "other") keeps a running linger and its Undo.
  var quiet = Object.keys(patch).every(function (k) { return k === "tags_on" || k === "tags_off" || (k === "assign" && patch.assign !== "other"); });
  if (quiet) { saveControls(id, patch); render(); return; }
  var before = cardState(c.it);                 // a lingering card reports the state it keeps
  lingerUntil.delete(id);
  saveControls(id, patch);                      // sets resp synchronously, before the write resolves
  var after = cardState(c.it);
  c.undo = undo || null;
  if (undo && after !== before && after !== "active") {
    lingerUntil.set(id, { until: clockMs() + LINGER_MS, state: before });
    setTimeout(function () { if (!lingerOf(id)) { lingerUntil.delete(id); c.undo = null; schedule(); } }, LINGER_MS + 50);
  }
  render();
}
// The one write of a control: the whole response, through the item's chain, like saveResponse.
function saveControls(id, patch) {
  var c = cards.get(id);
  if (!c || c.broken || !db) return Promise.resolve();
  var prev = resp.get(id) || null, doc = withControls(prev, id, patch, revOf(c.it), nowStamp());
  lastDoc.set(id, doc); resp.set(id, doc);
  inflight.set(id, (inflight.get(id) || 0) + 1); totalInflight++; renderSync();
  return enqueue(id, function () {
    if (resp.get(id) !== doc) return null;                   // a later tap already folded this one in
    return db.doc("responses/" + id).set(doc).then(function () { lastSaved = savedTime(); showMsg(""); });
  }).catch(function (e) {
    // Put prev back only when nothing newer (a later tap, or an answer saveResponse stored) replaced this doc.
    if (resp.get(id) === doc) { lastDoc.delete(id); if (prev) resp.set(id, prev); else resp.delete(id); }
    showMsg("A control was not saved: " + errText(e));
  }).then(function () { inflight.set(id, inflight.get(id) - 1); totalInflight--; schedule(); });
}
```
Implementation notes for `saveControls`: the optimistic `resp.set` before the chain is what makes the card react
at the tap; a second tap before the first write builds on the first doc (`resp.get(id)`), and the chain skips the
older write (`resp.get(id) !== doc`). `saveResponse` keeps reading `prev = resp.get(id)` inside its chain, so an answer saved after a control
keeps the controls (`nextResponse` copies them).

`updateCard(c, it)` keeps its signature; at its end call `renderControls(c, it);`:
```js
// The control parts of one card. today is ctlDay, the day render() set (no clock read here).
function renderControls(c, it) {
  var on = cfg.controls, ctl = ctlOf(it), today = ctlDay, lingering = !!lingerOf(it.id);
  var place = cardState(it), note = ctlNote(it, today);
  c.more.hidden = !(on.dismiss || (on.close && str(it.source_key)) || (on.tags && cfg.tags.length));
  c.more.textContent = c.panelOpen ? "Hide" : "Edit";
  c.ctl.hidden = !(on.assign || on.snooze) && c.more.hidden;
  c.panel.hidden = c.more.hidden || !c.panelOpen;
  c.banner.hidden = !note; c.bannerText.textContent = note; c.undoBtn.hidden = !(lingering && c.undo);
  c.el.classList.toggle("slim", place === "snoozed" && !c.expanded);
  // then the per-control parts of 5.3 to 5.8, in that order (they read on, ctl, today and place)
}
```

`render()` and `updateCard()` changes:
- `render()`, directly after C1's first line
  `var now = clockMs(), today = todayOf(now); lastDay = today; lastWeek = weekStartOf(now);`, add the new line
  `setCtlDay(today);` (on its own line, so C1's due-test source check of that first line still matches).
- No other placement change in `render()`: C1's `groupCards(vis, now)` places every card by `cardState`, so done,
  snoozed and lingering cards land where 5.1 says, and Not ours cards in no group.
- `render()`, directly after C1's line `renderSide(groups, onGuide);`, add
  `renderNotOurs(onGuide ? [] : notOursList(vis));`.
- In `updateCard`, the state tag: before the `c.state.className` line add `var lab = stateLabel(it);`,
  and in the `c.state.className` line and the `c.state.textContent` line use `lab` in place of `st`:
  `c.state.className = "tag" + (lab === "unsent" || lab === "changed" || lab === "waiting" ? " soon" : (lab === "sent" ? " good" : ""));`
  and `c.state.textContent = STATE_TEXT[lab] || lab;`. Every other use of `st` in `updateCard` stays on `st`.

Not ours: the cards set to Not ours leave every group; one line
at the end of the tab opens them.
- HTML: directly after C1's `#board` block (its closing `</div>`) and before `<div id="empty" class="empty" hidden></div>`:
  `<details id="notours" class="grp" hidden><summary id="nosum"></summary><div id="nolist" class="glist"></div></details>`
  (C1's `.grp`, `.grp > summary` and `.glist` rules style it; C1's global `[hidden]` rule hides it).
- Directly after the closing brace of C1's `renderDue`:
  ```js
  // Not ours: the cards the operator set to "Not ours", out of every group. One folded line at the end of the tab
  // opens them; the Assign select of a card there brings it back.
  function renderNotOurs(rows) {
    var box = $("notours");
    box.hidden = !rows.length;
    $("nosum").textContent = rows.length + " not ours - " + (box.open ? "hide" : "show");
    placeCards($("nolist"), rows);
  }
  ```
- Wiring section, beside C1's minute timer: `$("notours").addEventListener("toggle", schedule);` (the line text
  turns to "hide" when open).

`sendGroup(s)` (A's form, `s = {r, n, c}`): the marks step runs once per item id of `s.r` and `s.c` together:
```js
var byId = {};
s.r.forEach(function (x) { byId[x.itemId] = { x: x, ans: true }; });
s.c.forEach(function (x) { (byId[x.itemId] = byId[x.itemId] || { x: x }).ctl = true; });
var marks = Object.keys(byId).map(function (id) {
  var m = byId[id];
  return enqueue(id, function () {
    var cur = resp.get(id);
    if (!cur || cur.updated !== m.x.updated) return null;      // changed during the send: stays unsent
    var d = Object.assign({}, cur, { updated: nowStamp() });
    if (m.ans) { d.sent = true; d.batch = bid; }
    if (m.ctl && cur.controls) d.controls_sent = cur.controls;
    lastDoc.set(id, d); resp.set(id, d);
    return db.doc("responses/" + id).set(d);
  });
});
```
(The note marks are unchanged and are appended to `marks` as today.) In `send()`, A's
`if (s.r.length + s.n.length) return sendGroup(s);` becomes `if (s.r.length + s.n.length + s.c.length) return sendGroup(s);`.

The Send label count is `unsentCount()` (5.1), so a card with an answer and a control counts once.

### 5.3 Control `assign` (end to end)

Shown when `cfg.controls.assign`. Its look is a maintainer check (R2).

- **Element.** In `c.ctl`, first: `c.assign = h("select", { "aria-label": "Assign" })`. Its options, rebuilt only
  when `JSON.stringify(assignList())` changes (key kept in `c.assignKey`): `h("option", { value: "", text: "Assign: nobody" })`,
  then per entry `h("option", { value: x.id, text: "Assign: " + x.label })`. Labels go in by `text` only.
- **Render.** `c.assign.hidden = !cfg.controls.assign; if (!isPending(it.id)) c.assign.value = ctlOf(it).assign;`
- **Tap.** The phone opens its own picker. On `change`:
  `var was = ctlOf(c.it).assign, v = c.assign.value; setControl(c, { assign: v }, v === "other" ? { assign: was } : null);`
- **Screen.**
  - `me`, `agent`, a person: the select shows "Assign: <label>"; the card stays where it is; the state tag turns
    "unsent" until Send.
  - `other`: the banner shows "Not ours: the agent stops tracking it" with Undo for 4 s, then the card leaves every group and the line `<n> not ours - show` at the end of
    the tab counts it. Opened, that line lists the card with its
    state tag "not ours" and its select; choosing anything else there moves it back at once (no linger: the move is
    to "active").
- **Batch.** `controls[<id>] = {rev, assign: "<value>", keep: {dismiss: "on"|"off", done: "on"|"off"}}` (the
  unchanged enabled place keys ride in `keep`, 2.4).
- **`read`.** One line; `keep` is not printed (4.2): `  <id>  control assign "agent"  (do the work the card asks; in a source change only item "tracker" "7" "https://tracker.example.com/t/7"; leave the card open and say what you did in your reply)`
  for a map card, `... (do the work the card asks, with no write to any source; leave the card open and say what you did in your reply)`
  for a card without `source_key`, and `  <id>  control assign "jane"  (ack applies it)` for any other value.
- **Agent.** The `read` line ends with the step (`ctlHint`, 4.1). `"agent"`: do the work the card asks; in a source,
  change only the one item the line names by `source`, `source_key` and link (none when the card has no
  `source_key`); leave the card open and say what you did (D's `--result` later puts that line on the card); the
  operator ticks it done. `"other"`: nothing; `ack` closes the card and `sync` keeps it closed. Any other value:
  nothing (the operator or that person does it); `ack` reopens the card if a control had closed it.
- **`ack`.** Per 4.3 step 2.

### 5.4 Control `snooze` (end to end)

Shown when `cfg.controls.snooze` and the card is not in Done or Not ours. Its look is a maintainer check (R3).

- **Elements.**
  - In `c.ctl`, second: `c.snzBtn = h("button", { type: "button", "aria-expanded": "false" })`. Text: `"Snooze"`, or
    `"Snoozed to " + fmtDay(ctl.snooze)` while `ctl.snooze > today`.
  - `c.snz` (hidden until the button is tapped):
    `h("div", { class: "snz", hidden: true }, h("div", { class: "row" }, c.snzDay, c.snzWeek, c.snzWake), h("div", { class: "row" }, h("label", { class: "small muted", for: "d" + c.n, text: "Until" }), c.snzDate, c.snzCancel))`
    with `c.snzDay` text `"+1 day"`, `c.snzWeek` text `"+1 week"`, `c.snzWake` text `"Wake now"` (shown only while
    snoozed), `c.snzDate = h("input", { type: "date", id: "d" + c.n })`, `c.snzCancel` text `"Cancel"`.
  - `c.slimrow = h("div", { class: "slimrow" }, c.slimOpen = h("button", { type: "button", class: "open" }), c.slimWake = h("button", { type: "button", class: "link small", text: "Wake" }))`.
- **Render.** `c.snzBtn.hidden = !cfg.controls.snooze || place === "done" || place === "hidden";` `c.snz.hidden = c.snzBtn.hidden || !c.snzOpen;`
  `c.snzDate.min = addDays(today, 1); c.snzDate.max = addDays(today, 366);` `c.snzWake.hidden = !(ctl.snooze > today);`
  `c.slimOpen.textContent = "Snoozed to " + fmtDay(ctl.snooze) + " · " + (it.title || it.id);`
- **Taps on a phone.**
  1. The operator taps **Snooze**: `c.snzOpen = true`, the chooser row opens under the controls (no dialog, the
     page does not scroll).
  2. **+1 day** or **+1 week** (in each handler `var today = todayOf(clockMs()), ctl = ctlOf(c.it);`):
     `setControl(c, { snooze: snoozeDay(today, "day" | "week") }, { snooze: ctl.snooze })`,
     `c.snzOpen = false`. **Until** with a date picked in the phone's date picker: on `change`, when
     `snoozeOk(c.snzDate.value, today)` the same call with that day; else the input clears and nothing is saved.
     **Cancel**: `c.snzOpen = false`.
  3. The card stays in place for 4 s with the banner "Snoozed until Fri, Nov 20" and **Undo**.
  4. Then it folds, in place in its list or group, into one slim row: "Snoozed to Fri, Nov 20 · <title>", and
     **Wake**. The fold is a class change (`.card.slim`) with an opacity fade only when the viewer allows motion.
  5. A tap on the slim row text sets `c.expanded = !c.expanded`: the whole card shows again, still snoozed, with the
     banner and **Wake now** in the chooser; a second tap folds it. **Wake** / **Wake now**:
     `setControl(c, { snooze: "" }, null)`; the card is a full card again at once.
  6. On the wake day the card is a full card again by itself: C1's minute timer
     (`setInterval(function () { var t = clockMs(); if (todayOf(t) !== lastDay || weekStartOf(t) !== lastWeek) schedule(); }, 60000);`)
     schedules a render within a minute after 00:00 in `cfg.tz`, and that render's `setCtlDay(today)` sets the wake
     day. No timer of its own.
- **Not counted.** A snoozed card is left out of "Blocked on you", the tab counts and the Open count (5.1); C1's
  "Due today" strip still lists it when it is due.
- **Rev.** When the agent changes the card's question (`rev` up), the snooze ends at once (`ctlNorm`).
- **Batch.** `controls[<id>] = {rev, snooze: "2026-11-20"}`; a wake before the day: `{rev, snooze: ""}`.
- **`read`.** `  <id>  control snooze "2026-11-20"  (no follow-up before 2026-11-20)`, or `  <id>  control snooze ""  (nothing to do)`.
- **Agent.** The `read` line ends `(no follow-up before <day>)`. `ack` stores the snooze in the state (`snoozed`,
  4.3 step 2b), and every later `read` prints `snoozed: do not follow up on <id> before <day>, ...` until the day
  comes, the card's `rev` rises, the card closes, or the operator wakes it.

### 5.5 Control `dismiss` (end to end)

Shown in the edit panel when `cfg.controls.dismiss`. Its look is a maintainer check (R4).

- **Element.** A switch in the style of a phone settings toggle, made by one helper used for `dismiss` and `close`:
  ```js
  // A switch: the whole row is the tap target; aria-checked carries the state. Text by textContent only.
  // b.lab and b.hint are the two text spans, so a caller can change the text later.
  function switchRow(label, hint) {
    var k = h("span", { class: "k", "aria-hidden": "true" });
    var lab = h("span", { text: label }), hint2 = h("span", { class: "small muted", text: hint });
    var b = h("button", { type: "button", class: "sw", role: "switch", "aria-checked": "false" },
      h("span", null, lab, h("br"), hint2), k);
    b.lab = lab; b.hint = hint2;
    return b;
  }
  ```
  (Do not name it `setSwitch`: `tests/cuts-test.js` forbids that name.)
  `c.dismissSw = switchRow("Dismiss", "Hide it until something new comes in")`, in `c.panel`, first.
- **Render.** `c.dismissSw.hidden = !cfg.controls.dismiss; c.dismissSw.setAttribute("aria-checked", ctl.dismiss ? "true" : "false");`
- **Tap.** `var v = !ctlOf(c.it).dismiss; setControl(c, { dismiss: v }, v ? { dismiss: false } : null);`
- **Screen.** On: the knob slides right, the banner shows "Dismissed: it comes back when something new arrives"
  with Undo for 4 s, then the card moves to the folded Done group with the state tag "dismissed".
  Off (in Done): the card moves back to its place at once.
- **Batch.** `controls[<id>] = {rev, dismiss: "on", keep: {assign, done}}` (2.4).
- **`read`.** `  <id>  control dismiss "on"  (ack applies it)` (one line).
- **Agent.** Nothing. `ack` closes the card and holds it (`held`, and `ctl_closed` with reason `"dismiss"`).
- **Return on new source input**.
  1. The operator dismisses card `tracker-7` (rev 1) and sends. `ack` closes it: state `status: "closed"`, `held`
     and `ctl_closed` hold `tracker-7`.
  2. The next refresh maps the same row: `map` gives the same card, with `input` equal to the stored one. `sync`
     prints `0 new, 0 changed (rev up), 0 changed (same rev), 1 unchanged, 0 closed`; the card stays closed.
  3. The item gets new activity in the source; its `updated_at` changes. `map` (map key `"input": "updated_at"`)
     gives a new `input`. `sync`: `back` is true (4.4), so the card reopens with `rev` 2 and leaves `held` and
     `ctl_closed`; the line reads `sync: 0 new, 1 changed (rev up), 0 changed (same rev), 0 unchanged, 0 closed, 1 reopened (tracker-7)`.
  4. The page: the card `rev` 2 is above `controls.rev` 1, so `ctlNorm` clears `dismiss`; `cardState` is "active"; the
     card is open again with the state "open" (no answer) or "changed" (an earlier answer), like a new question.
  5. A content change of the card (title, text, options, links) brings it back the same way, with or without `input`.
- **Undo after `ack`.** The operator turns the switch off on the card in Done and sends: the batch carries
  `dismiss: "off"`; `ack` finds the card in `ctl_closed`, reopens it (`openCards`) and prints `1 reopened`.

### 5.6 Control `close` (end to end)

Shown in the edit panel when `cfg.controls.close` and the card has a `source_key`. Its look is a maintainer check (R4).

- **Element.** `c.closeSw = switchRow("Close in " + (str(it.source) || "the source"), "The agent closes the item there, then the card leaves")`,
  in `c.panel`, second. In `renderControls`, when `str(it.source)` differs from `c.closeSrc`: set
  `c.closeSrc = str(it.source); c.closeSw.lab.textContent = "Close in " + (c.closeSrc || "the source");` (the hint
  text never changes).
- **Render.** `c.closeSw.hidden = !cfg.controls.close || !str(it.source_key);`
  `c.closeSw.setAttribute("aria-checked", ctl.close ? "true" : "false"); c.closeSw.disabled = it.status === "closed";`
- **Tap.** `setControl(c, { close: !ctlOf(c.it).close }, null);` (no linger: the card does not move yet).
- **Screen.** On: the knob slides right and the banner reads "Close requested: the agent closes it in <source>".
  The card stays in place. When the agent has closed the source item and acked with `--close`, the card is closed
  and moves to Done ("closed"). Off before the agent acted: the banner goes away.
- **Batch.** `controls[<id>] = {rev, close: "on"}` or `"off"`.
- **`read`.** `  tracker-7  control close "on"  (close item "tracker" "7" "https://tracker.example.com/t/7" in its source with the operator's own tool for it; change nothing else there; then add --close tracker-7 to the ack line; if you cannot, leave the card and say why in your reply)`
  (4.2; the item comes from the card's `source`, `source_key` and first link, each through `q()`; a card with no
  link prints `link none` in the link's place, for example `close item "tracker" "8" link none in its source`).
- **Agent.** Do what the brackets say: close exactly that item, with the operator's own CLI or MCP tool for that
  source, and change nothing else there; then add `--close <id>` to the
  `ack` line. If there is no tool or the close fails, leave the card as it is (do not post it again: a content
  change raises `rev` and clears the operator's controls), do not add `--close`, and say why in the reply; D's
  `ack --result` later puts that line on the card. `"off"`: the line says `(nothing to do)`. An earlier line of a
  card that a later waiting batch sets again says `[superseded]  (skip)`. This line and an `assign "agent"` line are
  the only things on the board that let the agent write to a source, each for its one item. A later per-source custom close action is parked; only `ctlHint` would change.
- **`ack`.** Nothing automatic; only the agent's `--close`.
- **Next refresh.** The source row is closed now, so `map` gives `status: "closed"` (map `closed` rule) or the row is
  gone; `sync` keeps the card closed either way.

### 5.7 Control `done` (end to end)

Shown when `cfg.controls.done`. Its look is a maintainer check (R1).

- **Element.** The box in the card gutter, left of the title:
  `c.doneBox = h("input", { type: "checkbox", id: "x" + c.n })`;
  `c.gut = h("label", { class: "gut", for: "x" + c.n, title: "Done" }, c.doneBox)`; the label is a 44 x 44 px tap target.
- **Render.** `c.gut.hidden = !cfg.controls.done; if (!isPending(it.id)) c.doneBox.checked = ctl.done;`
- **Tap.** On `change`: `var v = c.doneBox.checked; setControl(c, { done: v }, v ? { done: false } : null);`
- **Screen.** Checked: the banner "Marked done" with Undo for 4 s, then the card moves to the folded Done group with
  the state tag "done". Unchecked in Done: back to its place at once. An action card keeps its options ("Done", "Later", ...):
  the box is a separate, quicker mark and needs no option.
- **Batch.** `controls[<id>] = {rev, done: "on", keep: {assign, dismiss}}` (2.4).
- **`read`.** `  <id>  control done "on"  (ack applies it)` (one line).
- **Agent.** Nothing; `ack` closes the card (the operator's own done needs no check by the agent), reason `"done"`.
  Unchecked after `ack`: `ack` reopens it.
- **New input**. A card marked done comes back like a dismissed one:
  when its content or its `input` changes (4.4 `back`), with `rev + 1`.
- **Placement.** The box sits in the left gutter of the card, at the height of the title row (`.gut`, a 44 x 44 px
  label with a negative left margin), not in a gutter column that runs the full height of the card.

### 5.8 Control `tags` (end to end)

Shown in the edit panel when `cfg.controls.tags` and the config has tags (C1's default tags `alert` and
`incident` count). Its look is a maintainer check (R4).

- **Element.** `c.tagWrap = h("div", null, h("div", { class: "small muted", text: "Tags" }), c.tagBox = h("div", { class: "tags" }))`,
  in `c.panel`, last.
  One chip per `cfg.tags` entry: `h("button", { type: "button", class: "tag chip", "aria-pressed": "false", "data-tag": t.id, text: t.label })`.
  Rebuild the chips only when `JSON.stringify(cfg.tags)` changes (`c.tagKey`). The `data-tag` value is a config id
  (an attribute, not HTML).
- **Render.** `c.tagWrap.hidden = !cfg.controls.tags || !cfg.tags.length;` each chip
  `chip.setAttribute("aria-pressed", tagsOf(it).indexOf(chip.dataset.tag) >= 0 ? "true" : "false")`.
- **Tap.** `setControl(c, tagPatch(c.it, id), null);` The chip turns pressed (bold, accent border) or plain at once,
  the tag chips under the title follow (`tagChips` reads `tagsOf`), and the card moves to another tab or group
  only on the next render, without linger (it was the operator's own move).
- **Batch.** `controls[<id>] = {rev, tags_on: ["security"], tags_off: ["cost"]}` (both full lists).
- **`read`.** `  <id>  control tags +["security"] -["cost"]  (nothing to do)`.
- **Agent.** Nothing. The page keeps the operator's tags on top of the card's own `tags`; never copy them into
  the card file (a refresh would then fight the operator).

## 6. Agent-facing text

All edits apply on top of the texts that A, B and C1 left (A 6.1 to 6.8, B 1.6, 2.6, 3.6, 4.6, C1 1.6, 2.6, 3.6).
`SKILL` grows by 340 characters (measured with `wc -c` on the three insertions below): from B's 6804 to about 7144,
under the 8000 limit of A's test "SKILL.md stays short". Nothing here names `artifact-capabilities`.

### 6.1 `SKILL`

- "Read and handle the answers", step 2: after B's bullet `` - `[rule]`, `[standing]`: read `references/rules.md` and do what it says for that line.``
  add, at the same indent, exactly:
  ```markdown
     - A `control` line is a quick control of the operator: do what its brackets at the end say, and nothing more.
  ```
- "Read and handle the answers", step 3: in A's sentence `` 3. Run the `ack` line that `read` printed, with `--close <id>` ... ``
  insert directly after "Run the `ack` line that `read` printed" the text `` (several: in the order `read` printed them)``
  (it begins with a space and ends before A's comma).
- "What counts as the operator's word": add as the last bullet, exactly:
  ```markdown
  - Write to a source only where a `control` line's brackets allow it (`close "on"`, `assign "agent"`), and only
    in the one item that line names. An answer or a note never allows it.
  ```
- Description (frontmatter): unchanged. No other `SKILL` change: the `snoozed:` line of `read` says itself what to do.

### 6.2 `REF/build.md` ("Build a board", step 3)

- In B's sentence (as C1 left it) replace ``(`tz`, `week_start`, `link_hosts`, `tags`, `checks`)`` by
  ``(`tz`, `week_start`, `link_hosts`, `tags`, `checks`, `people`)`` (B "Needs ... C2": names of people are private).
- Append, after the last sentence of step 3, exactly:
  `` Ask which quick controls they want on the cards (`controls` in `references/data-model.md`); all are off by default.``

### 6.3 `REF/data-model.md`

- Config table, directly after C1's `week_start` row (exact rows):
  ```markdown
  | `controls` | Quick controls on every card: an object of `assign`, `snooze`, `dismiss`, `close`, `done`, `tags`, each `true` or `false`. Turn on only what the operator uses; the user file is a good place | all `false` |
  | `people` | More names for `assign`: a list of `{id, label}`. `id` is 1 to 40 of `a-z 0-9 _ -`, not `me`, `agent` or `other`. Names of real people belong in the user file, never in a repository | none |
  ```
- Collections table (A's 0.1 table): `responses` content `the draft answer, with the earlier sent answers in \`history\``
  -> `the draft answer and the operator's quick controls, with the earlier sent answers in \`history\``;
  `batches` content: append `, and the controls that changed` to `a copy of each answer and note`.
- Under the Collections table, after A's sentence `` A batch has `status` "sent" until `ack` sets "handled" and `handled_at`. ``, append (exact):
  `` A card that `ack` closed for `dismiss` or `done` comes back when its content or its `input` changes; one set to Not ours (`assign` `other`) leaves the board and stays closed until the operator assigns it again.``

### 6.4 `REF/cards.md`

Fields table, directly after C1's `due` row (exact):
```markdown
| `input` | Optional. A marker of the latest source input, such as the item's last update time. When it changes, a card the operator dismissed or marked done comes back as a new question. A card file without it keeps the stored one. `board-refresh` fills it from the map key `input` |
| `source_key` | Optional. The item's raw key in its source, such as `7` or `OPS-7`; only `board-refresh` fills it: never write it in a card file yourself (`sync` refuses it in a file without `--source`). Only a card with it shows the Close control, and `read` names the item by it and its first link, or `link none` |
```

### 6.5 `RSKILL` and `skills/board-refresh/references/maps.md`

- "The map file", C1's "Optional:" sentence: directly after `` `draft` (a row field, kept byte for byte), `` insert
  `` `input` (the field that changes when the item gets new activity, for example `updated_at`: a card the operator dismissed or marked done comes back when it changes), ``.
- The example map: add `"input": "updated_at"` after `"who": "author.login"` (so `..."who": "author.login", "input": "updated_at",`).
- After the sentence `` The link label is `<source> <key>`. `` append
  `` The card's `source_key` is the raw key: the Close control and an assign to the agent name the item by it.``
- Step 6 "Sync": replace the sentence `` A card closed on the page reopens while its row stays open; `"status": "closed"` keeps it closed. `` by
  `` A card closed by `close` or `ack --close` stays closed until its content changes; one the operator dismissed or marked done stays closed until its content or its `input` changes, and one set to Not ours until the operator assigns it again; `"status": "closed"` in an override keeps any card closed.``
- `maps.md` (C1's file), the tracker example: `` `created_at`, `state` and `labels`: `` -> `` `created_at`, `updated_at`, `state` and `labels`: ``,
  and its first JSON line `{"key": "number", "title": "title", "url": "url", "created": "created_at",` ->
  `{"key": "number", "title": "title", "url": "url", "created": "created_at", "input": "updated_at",`.

### 6.6 `README.md`

In "How the agent works with it", append the paragraph (exact):
`Quick controls on a card (assign, snooze, dismiss, close in the source, done, tags) are off until the config turns them on. A tap acts on the page at once; the change goes out in the next batch with the answers, \`read\` prints one \`control\` line per changed control with the step to take, and \`ack\` applies the ones that only move a card. Only a \`close\` control or an assign to the agent lets the agent write to a source, and only in that one item.`
In "Test it", after C1's sentence that ends `` `groups-test.js` the groups and the sort. `` insert
`` `controls-test.js` covers the quick controls.`` and re-wrap the bullet's lines to under 100 characters.

### 6.7 `docs/how-it-works.html`

In the part that describes batches, add one sentence with the same content as the README paragraph's first two
sentences, inside the existing paragraph (`<p>` text through plain text, no new section).

## 7. Tests

Node 18 built-ins only, in the style of `tests/`. Page tests load the pure part through `tests/_page.js`.

### 7.1 New `tests/controls-test.js` (page pure part)

Helpers: `const plain = (x) => JSON.parse(JSON.stringify(x));` (as in `model-test.js`: objects built inside the
`vm` sandbox have another prototype, so every `assert.deepEqual` on a page result compares `plain(result)` with
the literal; this holds for every case below, and is written out in cases 1, 3, 5, 6 and 7);
`item(id, x)` = `P.coerce("item", Object.assign({ id, title: "Q " + id, options: ["Yes", "No"], status: "open" }, x))`;
`board(list, responses)` as in `model-test.js`; `ON = { assign: true, snooze: true, dismiss: true, close: true, done: true, tags: true }`;
`P.applyConfig({ controls: ON, tags: [{ id: "cost" }, { id: "security" }], people: [{ id: "jane", label: "Jane" }], tz: "Europe/Warsaw" })`
and `P.setCtlDay("2026-11-13")` unless a case says otherwise. Every `applyConfig` call names `tz` (A's rule: no case
depends on the default zone); the file ends with `P.applyConfig({ tz: "UTC" })`. Header comment:
`// Quick controls: control state, Send, placement, snooze and tags. Run: node controls-test.js [board.html]. Exits 1 on the first failure.`

1. **"controls are off in the plugin defaults; the config turns each one on"**: `P.applyConfig({ tz: "UTC" })` gives
   `plain(cfg.controls)` deep-equal to all six `false` and `plain(P.DEFAULTS.controls)` the same; `P.anyControl() === false`;
   `{tz: "UTC", controls: {snooze: true, bogus: true, done: "yes"}}` gives only `snooze: true`; `{tz: "UTC", controls: 5}` gives all false.
2. **"people add assignees in order; reserved and bad ids are dropped"**: people
   `[{id: "jane", label: "Jane"}, {id: "me"}, {id: "Bad Id"}, {id: "jane"}, {id: "bob"}]` with `agent: "Coordinator"`, `tz: "UTC"`
   -> `assignIds()` = `["me", "agent", "jane", "bob", "other"]`, labels `["Me", "Coordinator", "Jane", "bob", "Not ours"]`.
3. **"ctlNorm: a rev rise clears snooze, dismiss, close and done; assign and tags stay"**: `plain(ctlNorm({rev: 1, assign: "jane", snooze: "2026-11-20", dismiss: true, close: true, done: true, tags_on: ["cost"]}, 2))`
   -> `{rev: 2, assign: "jane", snooze: "", dismiss: false, close: false, done: false, tags_on: ["cost"], tags_off: []}`; at rev 1 all stay.
4. **"ctlNorm: a control the config turns off reads as its default; bad values are cleared"**: with `controls: {assign: true}`,
   a stored `dismiss: true` reads false; `assign: "nobody-known"` -> `""`; `snooze: "2026-02-30"` -> `""`; `tags_on: ["cost", "zzz", "cost"]` -> `[]` (tags off).
   With tags on: `tags_on: ["security", "cost", "cost"], tags_off: ["cost"]` -> `tags_on: ["security"], tags_off: []`.
5. **"controlDiff: only what changed; the unchanged place keys ride in keep; tags as both lists; null when nothing changed"**
   (each result through `plain`):
   `controlDiff(undefined, {rev: 1, snooze: "2026-11-20"}, 1)` = `{rev: 1, snooze: "2026-11-20"}`;
   `controlDiff(undefined, {rev: 1, dismiss: true}, 1)` = `{rev: 1, dismiss: "on", keep: {assign: "", done: "off"}}`;
   `controlDiff(undefined, {rev: 1, assign: "jane", done: true}, 1)` = `{rev: 1, assign: "jane", done: "on", keep: {dismiss: "off"}}`;
   with `controls: {dismiss: true}` only: `controlDiff(undefined, {rev: 1, dismiss: true}, 1)` = `{rev: 1, dismiss: "on"}` (no `keep`);
   `controlDiff({rev: 1, tags_on: ["cost"]}, {rev: 1, tags_on: ["cost"], tags_off: ["security"]}, 1)` = `{rev: 1, tags_on: ["cost"], tags_off: ["security"]}`;
   equal states -> `null`; a sent dismiss at rev 1 and the same state read at rev 2 -> `null`; a dismiss sent at rev 1,
   then dismissed again at rev 2 -> `{rev: 2, dismiss: "on", keep: {assign: "", done: "off"}}`; with `controls: {}` any change -> `null`.
6. **"withControls keeps the answer, history and controls_sent; nextResponse keeps the controls"**:
   `prev = {itemId: "a", choice: "Yes", note: "n", rev: 1, sent: true, batch: "b1", updated: "t0", history: [{choice: "No"}], controls_sent: {rev: 1, done: true}}`;
   (compare through `plain`) `withControls(prev, "a", {snooze: "2026-11-20", bogus: 1, rev: 9}, 1, "t1")` keeps `choice, note, sent, batch, history, controls_sent`,
   has `updated: "t1"` and `controls` = `ctlNorm({rev: 1, snooze: "2026-11-20"}, 1)`; `withControls(null, "z", {done: true}, 3, "t")` =
   `{itemId: "z", choice: "", note: "", rev: 3, updated: "t", sent: false, batch: "", controls: ctlNorm({rev: 3, done: true}, 3)}`;
   `nextResponse(withControls(...), "a", "No", "", 1, "t2").controls` deep-equals the input's `controls`.
7. **"Send takes a control-only change, on a closed card too; the batch carries controlIds and controls; a card counts once"**:
   board with `a` (answer unsent and snooze set), `b` (closed, `controls: {done: false}`, `controls_sent: {done: true}`),
   `c` (sent answer, no controls) -> `sendable().c` item ids `["a", "b"]`, `unsentCount() === 2`;
   `batchDoc("b1", "t", sendable())` has `itemIds: ["a"]`, `controlIds: ["a", "b"]`,
   `plain(controls.b)` = `{rev: 1, done: "off", keep: {assign: "", dismiss: "off"}}`; after setting each `controls_sent = controls`, `sendable().c` is empty.
8. **"an unsent control is a label only; isDone: dismiss, done and not ours; not ours is hidden"**: a card with only an
   unsent snooze `"2026-11-20"` (`ctlDay` `"2026-11-13"`): `stateOf` is `"open"`, `cardState` is `"snoozed"`,
   `stateLabel(it)` is `"unsent"`; after `controls_sent = controls` `stateLabel` is `"open"`. A card with a sent answer
   (`sent: true`, `choice: "Yes"`) and an unsent `assign: "jane"`: `stateOf` is `"sent"`, `isDone` is true,
   `cardState(it) === "done"`, `stateLabel` is `"sent"`. An unanswered card with an unsent tag (`tags_on: ["cost"]`)
   counts in `openCount()` (1 with that card alone). `isDone` is true for each of `dismiss`, `done`, `assign: "other"`;
   `cardState` gives `"done"`, `"done"`, `"hidden"`; `doneReason` gives `"dismissed"`, `"done"`, `"not ours"`, and
   `"closed"` for a closed card without controls; `stateLabel` of the `assign: "other"` card is `"not ours"`.
9. **"cardState: one parameter; linger keeps a card's old state; a snooze holds until the wake day; a rev rise brings a dismissed card back; groups and Due today"**:
   `P.cardState.length === 1` and `P.isActive.length === 1` (C1's pins). Snooze `"2026-11-20"`: after
   `P.setCtlDay("2026-11-19")` `cardState(it) === "snoozed"` and `P.isSnoozed(it, "2026-11-19") === true`; after
   `P.setCtlDay("2026-11-20")` `"active"`; `P.setCtlDay(P.todayOf(Date.UTC(2026, 10, 19, 23, 30)))` (tz
   `Europe/Warsaw`: the day is `"2026-11-20"`) gives `"active"`. Dismissed at `controls.rev: 1` on a card at `rev: 1`
   -> `"done"`; the same card at `rev: 2` -> `"active"`. In a second sandbox
   `load({ lingerOf: (id) => (id === "x" ? "active" : "") })` (same config, `setCtlDay("2026-11-13")`), a dismissed
   card `x` reads `"active"` and a dismissed card `y` reads `"done"`.
   Groups: `P.applyConfig({ controls: ON, tz: "UTC", week_start: "tuesday 12:00" })` (C1's default groups),
   `P.setCtlDay("2026-11-13")`, `now = Date.UTC(2026, 10, 13, 12)`: of `groupCards(P.sortedItems(), now)`, a snoozed
   card `s1` (priority `now`, no `due`, snooze `"2026-11-20"`) is in group `this-week`, a dismissed card `d1` in
   `done`, and a Not ours card `o1` (`assign: "other"`) in no group's `cards`; `notOursList(P.sortedItems())` ids are
   `["o1"]`; `matchOne({ state: "any" }, o1, now) === false`. `dueList(P.sortedItems(), "2026-11-13")` holds a snoozed
   card `s2` due `"2026-11-13"`, and neither a dismissed card `d2` nor a done-marked card `d3` due that day.
10. **"snooze days: +1 day, +1 week across a month end and the end of DST; a picked day must be after today and within a year"**:
    `snoozeDay("2026-10-24", "day") === "2026-10-25"`, `snoozeDay("2026-11-27", "week") === "2026-12-04"`,
    `snoozeDay("2026-11-27", "x") === ""`; `snoozeOk("2026-11-28", "2026-11-27") === true`, `"2026-11-27"` and `"2027-11-29"` false, `"2026-02-30"` false.
11. **"tagsOf and tagPatch: the card's tags, minus off, plus on; tabs, chips and group matches use them"**: card `tags: ["cost"]`;
    `tagPatch(it, "cost")` = `{tags_on: [], tags_off: ["cost"]}`; `tagPatch(it, "security")` = `{tags_on: ["security"], tags_off: []}`;
    with `controls: {tags_on: ["security"], tags_off: ["cost"]}`: `tagsOf(it)` = `["security"]`, `tagChips(it)` ids `["security"]`,
    `tabOf` puts it in a tab with `match: {tags: ["security"]}`, and `matchOne({ state: "active", tags: ["security"] }, it, 0) === true`
    while `matchOne({ state: "active", tags: ["cost"] }, it, 0) === false`.
12. **"Blocked on you, the tab counts and the Open count leave out snoozed, controlled-done and not-ours cards"**: four
    cards with `blocks`: plain, snoozed to `"2099-01-01"` (`ctlDay` `"2026-11-13"`), dismissed, `assign: "other"` ->
    `blockedList(sorted)` ids `[plain]`, `openCount() === 1`, `tabCounts(list, isActive).all === 1`.
13. **"ctlNote and fmtDay"**: each banner text of 5.1 for one card each (with today `"2026-11-13"`);
    `fmtDay("2026-11-20")` contains `20`; `fmtDay("x") === ""`.
13. **"ctlNote and fmtDay"**: each banner text of 5.1 for one card each; `fmtDay("2026-11-20")` contains `20`; `fmtDay("x") === ""`.

### 7.2 `tests/model-test.js`

- "the batch carries a copy ...": the expected `batchDoc` result gains `controlIds: []` and `controls: {}`.
- "coerce: ...": add `plain(P.coerce("batch", {}).controlIds)` deep-equals `[]` and `plain(P.coerce("batch", {}).controls)` deep-equals `{}`
  (the expected `batchDoc` result above is compared through `plain` as that test already does);
  `"controls" in P.coerce("response", {})` is `false`.

### 7.3 `tests/board-test.mjs`

A's rules hold: every config a case writes sets `tz` (`"UTC"` unless the case names a zone), `read` and `adopt` run
through A's `ok2(b, ...)` (`--dump <fresh dump> --dumped`), and no assert pins a count of all lines or a line position.
Helpers: `const ctlBatch = (id, created, controls, x) => Object.assign(batch(id, created, {}), { controlIds: Object.keys(controls), controls }, x || {});`
and `const ctlOn = (b, on) => cfgOf(b, (c) => { c.controls = on; });`. The card `tracker-7` used below is synced first
with `{id: "tracker-7", title: "T7", source: "tracker", source_key: "7", links: [{label: "tracker 7", url: "https://example.com/t/7"}]}`
with `--source tracker`, at rev 1 (from C2-8 on, 4.4 step 0 refuses a `source_key` without it, so every sync of a
file that holds `tracker-7`, in this file's cases and in D's, passes `--source tracker`); `disk-size` is the fixture card, at rev 2 in the fixture state, without
`source_key`.

1. **"check: controls and people are checked; groups stay in the entries-kept list"**: `controls: {snooze: "yes", bogus: true}`
   -> lines include `problem: config controls.snooze: true or false` and `problem: config controls: unknown field "bogus"`;
   `controls: 5` -> `problem: config controls: not an object`; `people: [{id: "jane"}, {id: "me"}]` ->
   `problem: config people: 1 of 2 entries kept`; with also `groups: [{id: "a", match: {due: ["thisweek"]}}, {id: "b", match: {}}]`
   the lines include `problem: config groups: 1 of 2 entries kept` too (C1's list is kept);
   `controls: {snooze: true}, people: [{id: "jane", label: "Jane"}]` passes; `CONFIG_KEYS.includes("controls")` and
   `CONFIG_KEYS.includes("people")` (membership).
2. **"read prints one control line per change, after the answers, with its flags and what to do"**: config
   `tz: "Europe/Warsaw"`, every control on; `putDoc` the batch of 2.4; `ok2(b, "read")` contains, in this order, the
   exact lines of 4.2 with the snooze line `  disk-size  control snooze "2026-11-20"  (no follow-up before 2026-11-20)`.
   Then with `controls: {dismiss: true, done: true}`: the snooze line is `  disk-size  control snooze "2026-11-20"  [not-enabled]  (skip)`,
   and no line shows the `keep` values (no `control assign` or `control done` line for `tracker-7`). Each of these
   batch values gives the line shown (every control on):
   - `{rev: 1, snooze: "2026-02-30"}` for `tracker-7` -> `  tracker-7  control snooze "2026-02-30"  [bad-value]  (skip)`;
   - `{rev: 1, dismiss: "maybe"}` -> `... control dismiss "maybe"  [bad-value]  (skip)`;
   - `{rev: 1, tags_on: ["zzz"], tags_off: []}` -> `  tracker-7  control tags +["zzz"] -[]  [bad-value]  (skip)`;
   - a control for card `nope` -> `  nope  control done "on"  [missing]  (skip)`;
   - a `dismiss` at `rev: 1` for `disk-size` -> `[stale-rev]  (skip)`, at `rev: 3` -> `[other-rev]  (skip)`; `assign` at `rev: 1` has no rev flag;
   - `{rev: 1, close: "on"}` for `tracker-7` -> `  tracker-7  control close "on"  (close item "tracker" "7" "https://example.com/t/7" in its source with the operator's own tool for it; change nothing else there; then add --close tracker-7 to the ack line; if you cannot, leave the card and say why in your reply)`;
   - `{rev: 2, close: "on"}` for `disk-size` -> `  disk-size  control close "on"  [no-item]  (skip)`;
   - `{rev: 1, close: "off"}` for `tracker-7` -> `... control close "off"  (nothing to do)`;
   - `{rev: 1, assign: "agent", keep: {dismiss: "off", done: "off"}}` for `tracker-7` -> `  tracker-7  control assign "agent"  (do the work the card asks; in a source change only item "tracker" "7" "https://example.com/t/7"; leave the card open and say what you did in your reply)`;
   - `{rev: 2, assign: "agent", keep: {dismiss: "off", done: "off"}}` for `disk-size` -> `  disk-size  control assign "agent"  (do the work the card asks, with no write to any source; leave the card open and say what you did in your reply)`;
   - `{rev: 1, assign: "jane", keep: {dismiss: "off", done: "off"}}` with `people: [{id: "jane"}]` -> `... control assign "jane"  (ack applies it)`;
   - two waiting batches a minute apart for `tracker-7`, the earlier `{rev: 1, close: "on"}`, the later `{rev: 1, close: "off"}`:
     the earlier batch's line is `  tracker-7  control close "on"  [superseded]  (skip)` and the later's `  tracker-7  control close "off"  (nothing to do)`.
   - a card without a link: sync one file holding the `tracker-7` card above and
     `{id: "tracker-8", title: "T8", source: "tracker", source_key: "8"}` with `--source tracker` (B prints
     `note: tracker-8: no link`); then `{rev: 1, close: "on"}` for `tracker-8` -> the line contains
     `(close item "tracker" "8" link none in its source with the operator's own tool for it;`.
   A batch without controls prints A's header line unchanged. With `--all`, a handled batch's control lines end
   after their flags, with no hint.
3. **"ack applies dismiss, done and assign; undo reopens only what a control closed; close and assign agent are left to the agent"**:
   `ack` the 2.4 batch: the line `ack <bid>: handled, 1 cards closed, 0 reopened. The answers go to decisions.md when the next read no longer lists the batch`;
   writes `[["update", "batches", <bid>, 1], ["set", "cards", "main", <n>]]`; state `tracker-7` closed, in `held`, and
   `ctl_closed` deep-equals `{"tracker-7": "dismiss"}`. A batch with `{rev: 1, close: "on"}` for `tracker-7` ->
   `0 cards closed, 0 reopened`, no cards write. A batch `{rev: 1, assign: "agent", keep: {dismiss: "off", done: "off"}}`
   for an open card -> `0 cards closed, 0 reopened`, the card still open. A batch
   `{rev: 1, dismiss: "off", keep: {assign: "", done: "off"}}` for `tracker-7` -> `0 cards closed, 1 reopened`,
   `tracker-7` open, not in `held`, no `ctl_closed` key in the state, and a cards write in the same array.
   `--close tracker-7` with `dismiss: "off"` -> closed (`--close` wins), no `ctl_closed` entry.
   An agent's own close: `cmd(b, "close", "disk-size")`, then ack `{rev: 2, done: "on", keep: {assign: "", dismiss: "off"}}` for
   `disk-size` -> `0 cards closed, 0 reopened`, no `ctl_closed` entry; then ack `{rev: 2, done: "off", keep: {assign: "", dismiss: "off"}}`
   -> `0 reopened`, still closed.
   Flagged controls do nothing: `{rev: 1, dismiss: "on", keep: {assign: "", done: "off"}}` for `disk-size` (rev 2, so `[stale-rev]`)
   -> `0 cards closed`; with config `controls: {dismiss: true}`, `{rev: 1, done: "on", keep: {dismiss: "off"}}` for `tracker-7`
   (`[not-enabled]`) -> `0 cards closed`.
4. **"ack: an earlier waiting batch with controls for the same card goes first"**: two sent batches with controls
   for `tracker-7`, created a minute apart, both in ONE dump; `ack <later>` exits 1 with
   `ack: ack <earlier> first: it holds controls for the same cards. Nothing written`, and the state file is
   byte-identical before and after. From the same unchanged dump: `ack <earlier>` passes, then `ack <later>` passes (the
   earlier one is pending in the state). A later batch for another card acks without the earlier one.
5. **"sync: a dismissed or done card stays closed until its content or its input changes, then comes back with rev up"**:
   sync `tracker-7` with `input: "i1"`, ack a dismiss; sync the same file -> the line that starts `sync: ` is
   `sync: 0 new, 0 changed (rev up), 0 changed (same rev), 1 unchanged, 0 closed`, status closed; sync with
   `input: "i2"` -> `sync: 0 new, 1 changed (rev up), 0 changed (same rev), 0 unchanged, 0 closed, 1 reopened (tracker-7)`,
   rev 2, not in `held`, no `ctl_closed` entry. Again from a fresh dismiss: a title change brings it back the same way.
   The same two runs with a done mark (`{rev: <current rev>, done: "on", keep: {assign: "", dismiss: "off"}}`) in
   place of the dismiss give the same lines.
   A held card first synced without `input` and then with `input: "i1"` stays closed (no stored marker).
   An open card whose `input` changes: `1 changed (same rev)`, rev unchanged.
   The marker survives a file without it: dismissed with `input: "i1"`, sync the file without `input` -> stored
   `input` still `"i1"`, `1 unchanged`; then sync with `input: "i2"` -> `1 reopened (tracker-7)`.
   The agent's own close: sync with `input: "i1"`, `cmd(b, "close", "tracker-7")` (or an ack with `--close tracker-7`),
   sync with `input: "i2"` -> `0 changed (rev up), 1 changed (same rev)`, still closed.
   A `source_key` in a file synced without `--source` (4.4 step 0): `sync` of
   `[{id: "hand-1", title: "H", source_key: "9"}]` exits 1, its text contains
   `hand-1: source_key: set only by board-refresh map; sync that file with --source`, and nothing is written.
6. **"sync: a card assigned to other stays closed whatever its source file says, until the operator assigns it again"**:
   ack `{rev: 1, assign: "other", keep: {dismiss: "off", done: "off"}}` for `tracker-7`; `ctl_closed` deep-equals
   `{"tracker-7": "other"}`; syncs with a changed title, a changed `input`, and `status: "open"` keep it closed; ack
   `{rev: <current rev>, assign: "me", keep: {dismiss: "off", done: "off"}}` -> `1 reopened`, no `ctl_closed` key.
7. **"decisions.md logs the changed control lines, with their flags"**: after the ack of the 2.4 batch (config tz
   `UTC`) and the next `ok2(b, "read")`, `board/decisions.md` holds `| tracker-7 | control dismiss on |  | 2026-11-13 |`
   (date per A's `day`) and `| disk-size | control snooze 2026-11-20 |  | 2026-11-13 |`, and no row `control assign` or
   `control done` for `tracker-7` (those rode in `keep`). After the ack of the stale-rev batch of case 3 and the next
   read: the row `| disk-size | control dismiss on [stale-rev] |  | ... |`.
8. **"purge counts the cards of controlIds"**: a handled batch with only `controlIds: ["old-dns"]` is deleted by a
   purge of `old-dns`; one with `controlIds: ["disk-size"]` stays.
9. A's case **"ack: an update of batches/<id> pinned to version 1, ..."**: its printed line gains `, 0 reopened`
   (`ack b...bbbb: handled, 1 cards closed, 0 reopened. The answers go to decisions.md when the next read no longer lists the batch`).
10. **"read lists the running snoozes; the script drops a snooze whose day came, whose card changed or closed"**:
    `BOARD_NOW` as the fixture (`2026-02-01T12:00:00Z`); ack `{rev: 2, snooze: "2026-11-20"}` for `disk-size`, apply,
    then `ok2(b, "read")` prints `snoozed: do not follow up on disk-size before 2026-11-20` (after the `decisions.md:`
    line and before `no batches waiting`), and `state(b).snoozed` deep-equals `{"disk-size": {day: "2026-11-20", rev: 2}}`.
    Then each of these removes the line and the `snoozed` key: an ack of `{rev: 2, snooze: ""}`; a read with
    `BOARD_NOW=2026-11-20T12:00:00Z`; a sync that changes the title of `disk-size` (rev 3); `cmd(b, "close", "disk-size")`.
    A flagged snooze (`{rev: 1, snooze: "2026-11-20"}`, `[stale-rev]`) adds nothing.

### 7.4 `tests/refresh-test.mjs`

1. **"map: input is the row field that changes with new activity; a list is joined; a missing field adds nothing; source_key is the raw key"**:
   `one({ updated_at: "2026-01-11T08:00:00Z" }, Object.assign({}, MAP, { input: "updated_at" }))` -> card `input === "2026-01-11T08:00:00Z"`;
   a list `[{at: "a"}, {at: "b"}]` with `input: "notes.at"` -> `"a,b"`; no field -> no `input` key; `input: 5` in the map
   -> text contains `input: a string`. Every mapped card has `source_key` equal to the raw key text of its row (for
   the row of `one({})`, `String(<its key value>)`).
2. **"a dismissed card returns only when a new source input arrives"** (the scoping's acceptance test, end to end):
   rows `[row({ iid: 7, updated_at: "u1" })]`, map with `input: "updated_at"` -> `map` -> `board sync <out> --source tracker`
   (apply the writes to a stand-in db as `board-test.mjs` does); config `tz: "UTC"`, `controls: {dismiss: true}`; a sent batch with
   `controls: {"tracker-7": {rev: 1, dismiss: "on"}}` (only `dismiss` is on, so no `keep`); `board read --dumped` prints
   `  tracker-7  control dismiss "on"  (ack applies it)`; `board ack <bid>` closes it. Map and sync the same rows:
   `1 unchanged`, the card closed. Rows with `updated_at: "u2"`: sync prints `... 1 changed (rev up) ... 1 reopened (tracker-7)`
   and the card is open at rev 2. The page side of the return (a dismiss saved at rev 1 reads as cleared on a card at
   rev 2) is controls-test case 9; this file does not load the page.
3. C1's case **"map: the example maps of references/maps.md map their sample rows"**: the tracker sample row gains
   `updated_at: "2026-01-11T08:00:00Z"`, and the card has `input` `"2026-01-11T08:00:00Z"` and `source_key` `"7"`.

### 7.5 Other test files

- `tests/cuts-test.js`: add **"quick controls write no HTML and keep the old cut names away"**: the page source
  has no `setSwitch`; `switchRow`, `renderControls`, `setControl`, `saveControls` and `renderNotOurs` exist; the body
  of `renderControls` (from `function renderControls` to the next `\n  function `) has no `innerHTML`. (A's clock
  case covers the clock reads: C2 code calls `clockMs()`, `nowStamp()` and `savedTime()` only.)
- `tests/render-test.js`: the "HTML reaches the page only at the known places" list is unchanged (the control code
  adds no HTML write). No other change.
- `tests/groups-test.js`, `tests/due-test.js`: no change; both must pass after C2-4 (C1's hook pins hold).
- `tests/skill-text-test.js` (B's file), add **"the control text"**: `SKILL` contains
  `` A `control` line is a quick control of the operator: do what its brackets at the end say `` and
  `` (`close "on"`, `assign "agent"`) ``, and does not contain `control snooze` (the running snoozes come from the
  `snoozed:` line of `read`, not from `decisions.md`); `REF/data-model.md` has a row starting `` | `controls` | `` and one starting `` | `people` | ``; `REF/cards.md`
  has rows starting `` | `input` | `` and `` | `source_key` | ``; `REF/build.md` contains `` `controls` `` and
  `` `people` ``; `RSKILL` contains `"input": "updated_at"` and `source_key`; `skills/board-refresh/references/maps.md`
  contains `"input": "updated_at"`.

### 7.6 Acceptance map

| Scoping criterion | Evidence |
|---|---|
| Each control is off by default in the plugin defaults and on through config | controls-test 1 (defaults and config), controls-test 4 (an off control reads as default), controls-test 5 (an off control never travels), board-test 2 (`[not-enabled]`), board-test 1 (check) |
| `read` prints control changes as lines the agent can act on | board-test 2 (exact lines, flags and the printed next step), skill-text-test (the one SKILL sentence and the source-write bullet), board-test 3 (ack acts on them) |
| A test covers dismiss and the return of a card on new source input | refresh-test 2 (end to end), board-test 5 (the sync rules, dismiss and done), controls-test 9 (the page shows it again on rev up) |

Operator answers: layout, linger and Not ours place -> maintainer checks R1, R2, R4; Not ours hidden ->
controls-test 8, 9, 12; done returns -> board-test 5; due snooze -> controls-test 9, check R7; wake time ->
controls-test 9, check R8; assign labels -> controls-test 2, check R2; assign agent and source writes -> board-test
2 and 3, skill-text-test; close on map cards -> board-test 2 (`[no-item]`), check R4.

## 8. Steps (in order)

"Tests green" = from the plugin root, `for t in tests/*-test.js tests/*-test.mjs; do node "$t" > /dev/null || echo FAIL "$t"; done`
prints nothing. Every step below ends with tests green unless it says otherwise.

C2-0. **Name check.** Pre: clusters A, B and C1 merged; tests green. From the plugin root run:
      ```sh
      while IFS='|' read -r f n; do
        c=$(grep -cF -- "$n" "$f" 2>/dev/null || true); [ "${c:-0}" -gt 0 ] || echo "MISSING in $f: $n"
      done < <(sed 's/^ *//' <<'LIST'
      skills/decision-board/scripts/board.mjs|export const FLAGS = {
      skills/decision-board/scripts/board.mjs|export const COMMANDS = {
      skills/decision-board/scripts/board.mjs|const byTime = (x, y) =>
      skills/decision-board/scripts/board.mjs|const batchesOf = (dump) =>
      skills/decision-board/scripts/board.mjs|const waiting = (dump) =>
      skills/decision-board/scripts/board.mjs|r.logHandled(dump, log)
      skills/decision-board/scripts/board.mjs|read: no --dumped
      skills/decision-board/scripts/board.mjs|r.put("update", "batches", bid, { status: "handled", handled_at: t }, 1, "batches/" + bid)
      skills/decision-board/scripts/board.mjs|if refused: rm -rf
      skills/decision-board/scripts/board.mjs|export const CONFIG_KEYS = Object.keys(P.DEFAULTS)
      skills/decision-board/scripts/board.mjs|export function checkFields
      skills/decision-board/scripts/board.mjs|for (const k of ["tabs", "priorities", "domains", "link_hosts", "tags", "groups", "sort"])
      skills/decision-board/scripts/board.mjs|config week_start: 
      skills/decision-board/scripts/board.mjs|const noLink = []
      skills/decision-board/assets/board.html|function clockMs() { return Date.now(); }
      skills/decision-board/assets/board.html|function nowStamp() { return stampIn(clockMs(), cfg.tz, true); }
      skills/decision-board/assets/board.html|function savedTime()
      skills/decision-board/assets/board.html|function dayIn(ms, tz)
      skills/decision-board/assets/board.html|function addDays(day, n)
      skills/decision-board/assets/board.html|function realDate(v)
      skills/decision-board/assets/board.html|var rs = s.r || [], ns = s.n || [];
      skills/decision-board/assets/board.html|function sendGroup(
      skills/decision-board/assets/board.html|settings: ""
      skills/decision-board/assets/board.html|[hidden] { display: none !important; }
      skills/decision-board/assets/board.html|function todayOf(nowMs)
      skills/decision-board/assets/board.html|function cardState(it) { return isDone(it) ? "done" : "active"; }
      skills/decision-board/assets/board.html|function isActive(it) { return cardState(it) === "active"; }
      skills/decision-board/assets/board.html|function matchOne(m, it, now) {
      skills/decision-board/assets/board.html|if (m.state !== "any" && m.state !== cardState(it)) return false;
      skills/decision-board/assets/board.html|if (m.tags && !strs(it.tags).some(
      skills/decision-board/assets/board.html|function groupCards(list, now) {
      skills/decision-board/assets/board.html|(cardState(it) === "done" ? done : other).cards.push(it);
      skills/decision-board/assets/board.html|function dueList(sorted, today) {
      skills/decision-board/assets/board.html|str(it.status) !== "closed" && realDate(it.due) && it.due <= today
      skills/decision-board/assets/board.html|var now = clockMs(), today = todayOf(now); lastDay = today; lastWeek = weekStartOf(now);
      skills/decision-board/assets/board.html|var groups = groupCards(vis, now);
      skills/decision-board/assets/board.html|function renderGroups(groups)
      skills/decision-board/assets/board.html|function placeCards(cont, list, focused)
      skills/decision-board/assets/board.html|<footer id="foot" class="page-foot"><span id="zone"
      skills/board-refresh/scripts/refresh.mjs|for (const k of ["who", "rows", "kind", "due", "summary", "draft"])
      skills/board-refresh/scripts/refresh.mjs|"closed", "tags", "priority", "due", "summary", "draft"]
      skills/board-refresh/scripts/refresh.mjs|if (due && !badDue) c.due = due;
      skills/decision-board/SKILL.md|Run the `ack` line that `read` printed, with `--close <id>`
      skills/decision-board/SKILL.md|## What counts as the operator's word
      skills/decision-board/SKILL.md|- `[rule]`, `[standing]`: read `references/rules.md`
      skills/decision-board/references/build.md|(`tz`, `week_start`, `link_hosts`, `tags`, `checks`)
      skills/board-refresh/SKILL.md|`draft` (a row field, kept byte for byte), and `rows`
      skills/board-refresh/references/maps.md|"created": "created_at",
      tests/cuts-test.js|page times come only from the time section and the clock helpers
      tests/board-test.mjs|SKILL.md stays short
      tests/board-test.mjs|const ok2 = 
      tests/groups-test.js|P.cardState.length === 1
      tests/skill-text-test.js|ok(
      .claude-plugin/plugin.json|"version": "0.7.0"
      LIST
      )
      ```
      Run it in bash, copied without its six-space indent (the closing `LIST` must start its line). Each line is
      `<file>|<exact text>`; the quoted `'LIST'` keeps the backticks and `$` of the texts literal.
      Also read `function sendGroup(` and `function send(` in `PAGE`: `sendGroup` takes the object that `sendable()`
      returns (`{r, n}` after A), whatever its parameter is named; 5.2 calls it `s`.
      Evidence: the loop prints no `MISSING` line. If it prints one, or a function has another argument list than
      quoted here, STOP: change nothing and report the missing name and its grep. Do not guess a replacement.
C2-1. **SCHEMA and config.** Pre: C2-0 passed. Add the SCHEMA entries of 2.2 (with `input` and `source_key` in
      `SCHEMA.item`) and the `DEFAULTS`, `normControls`, `personOk`, `normConfig` lines of 3. Create
      `tests/controls-test.js` with cases 1 and 2.
      Evidence: `node tests/controls-test.js` exits 0 and prints `ok 1 controls are off in the plugin defaults; the config turns each one on`;
      tests green (B's `checkFields()` and computed `config default:` lines take the new keys by themselves).
C2-2. **Control state functions.** Pre: C2-1. Add `assignList`, `assignIds`, `anyControl`, `ctlDefault`, `ctlNorm`, `ctlOf`,
      `controlDiff`, `ctlUnsent`, `withControls`; change `nextResponse`. Add controls-test cases 3 to 6.
      Evidence: controls-test exits 0 with 6 cases; tests green.
C2-3. **Send.** Pre: C2-2. Change `sendable`, `unsentCount`, `batchDoc` (with `var cs = s.c || [];`), `isDone`; add
      `ctlDone`, `doneReason` (`stateOf` stays unchanged; `stateLabel` comes in C2-4, because it reads `cardState`).
      Update `tests/model-test.js` per 7.2; add controls-test cases 7 and 8. Evidence: both exit 0; tests green.
C2-4. **Placement, snooze and tags functions.** Pre: C2-3. Add `ctlDay`, `setCtlDay`, `isSnoozed`, `stateLabel`,
      `ctlNote`, `fmtDay`, `snoozeDay`, `snoozeOk`, `tagsOf`, `tagPatch`, `notOursList`; change C1's `cardState`,
      `matchOne`, `groupCards`, `dueList`, and `byTag`, `tagChips`, `openCount` (5.1); add `lingerOf: () => ""` to the
      contexts of `tests/_page.js` and `SCRIPT` `loadPage()`. Add controls-test cases 9 to 13.
      Evidence: controls-test exits 0 with 13 cases; `node tests/groups-test.js` exits 0 with C1's hook case
      unchanged (`P.cardState.length === 1`, `P.isActive.length === 1`, `P.groupCards.length === 2`); `tests/due-test.js`,
      `tests/tabs-test.js`, `tests/render-test.js` exit 0; tests green.
C2-5. **Script: check.** Pre: C2-1. Apply the `check` lines of 3 (the entries-kept list, the `controls` problems).
      Add board-test case 1. Evidence: board-test exits 0 and contains "check: controls and people are checked".
C2-6. **Script: read.** Pre: C2-4 (the script loads `P.assignIds`). Add the helpers of 4.1 and the `read` changes of
      4.2. Add board-test case 2. Evidence: board-test exits 0 and contains "read prints one control line per change".
C2-7. **Script: ack and purge.** Pre: C2-6. Apply 4.3 (with `Run.openCards` and the `snoozed` state) and 4.5; add
      the `Run` constructor lines and the `finish()` lines of 2.3; update USAGE. Add board-test cases 3, 4, 7, 8, 9 and
      10. Evidence: board-test and loss-test exit 0.
C2-8. **Script: sync.** Pre: C2-7. Apply 4.4. Add board-test cases 5 and 6. Evidence: board-test exits 0 and contains
      "sync: a dismissed or done card stays closed until its content or its input changes".
C2-9. **Refresh.** Pre: C2-8. Apply 4.6. Add refresh-test cases 1 and 2, and the `input` assert of 7.4 in C1's
      example-maps case. Evidence: `node tests/refresh-test.mjs` exits 0 and contains "a dismissed card returns only
      when a new source input arrives".
C2-10. **Page render code.** Pre: C2-4. Apply 5.2 to 5.8 (CSS, `buildCard`, `switchRow`, `setControl`, `saveControls`,
      `renderControls`, `updateCard`, `renderNotOurs` and its HTML, the `render()` lines, `sendGroup`, `send`). Add the
      cuts-test case of 7.5. Evidence: tests green (A's cuts-test "page times come only from the time section and the
      clock helpers" included); `grep -n "innerHTML" PAGE` shows only the three known sites; `grep -n setSwitch PAGE`
      prints nothing; `grep -n "Date.now()" PAGE` prints only the `clockMs` line.
C2-11. **Text and version.** Pre: C2-9 and C2-10. Write section 6 into `SKILL`, `REF/build.md`, `REF/data-model.md`,
      `REF/cards.md`, `RSKILL`, `skills/board-refresh/references/maps.md`, `README.md`, `docs/how-it-works.html`. Set
      `.claude-plugin/plugin.json` `version` from `0.7.0` to `0.8.0`. Add the skill-text-test asserts of 7.5.
      Evidence: tests green; `wc -c skills/decision-board/SKILL.md` prints at most 8000 (expected about 6838, earlier about 7144: B's 6804
      plus the 340 characters of 6.1; if it is over 8000, move text to a reference read at a named step, never raise the
      limit); board-test "SKILL.md stays short" and "artifact-capabilities is named once, in P1" pass (C2 names that
      skill nowhere); `grep -n '"version": "0.8.0"' .claude-plugin/plugin.json` prints one line;
      `python3 scripts/validate-skills.py` from the repository root exits 0.
C2-12. **Review.** Pre: C2-11. A reviewer reruns the suite, checks every acceptance-map row against a named test,
      checks that no test or text holds a real name, host or address (`people` examples use `jane`/`bob`, hosts
      `tracker.example.com` and `example.com`), greps the diff for `curl|wget|https?://` (only `example.com` hosts and
      documentation links), and runs `git status`: changes only under `plugins/decision-board/`, and no file under
      `board/`.

### Checks for the maintainer (after C2-12; not implementer steps)

On a new private test artifact published from the changed page with `P1` (never a board in use under
`board/`), at 390 px width and on a real phone (iOS and Android), with a stub or test
database holding one `cards/main` with five cards (one with `source: "tracker"` and `source_key: "7"`, one with
`blocks`, one with `due` today, one with `tags: ["cost"]`), config `{"tz": "Europe/Warsaw", "agent": "Coordinator",
"link_hosts": ["tracker.example.com"], "tags": [{"id": "cost", "label": "Costs money"}], "people": [{"id": "jane", "label": "Jane"}],
"controls": {"assign": true, "snooze": true, "dismiss": true, "close": true, "done": true, "tags": true}}`. Record
pass or fail for each:
- R1 the Done box sits left of the title and is easy to hit; checked, the "Marked done" banner with Undo shows, and
  after about 4 s the card is in the folded Done group with the tag "done"; Undo within the 4 s keeps it in place.
- R2 the Assign select opens the phone picker with "Assign: nobody", Me, Coordinator, Jane, Not ours; "Not ours"
  lingers with Undo, then the card leaves the groups and the line `1 not ours - show` shows at the end of the tab; a
  tap opens it, and choosing "Assign: Me" there brings the card back at once.
- R3 Snooze opens the chooser in place; +1 day shows "Snoozed until <tomorrow>" with Undo, then folds into one slim
  row in its group; a tap on the row unfolds it, Wake makes it a full card; the date picker refuses today.
- R4 Edit opens the edit panel (its text turns to Hide): the Dismiss and "Close in tracker" switches look and slide
  like phone settings toggles; Close is missing on the cards without a `source_key`; tag chips toggle and the chips
  under the title follow.
- R5 the Send label counts a card with an answer and a control once; after Send the "unsent" tags clear; a sent card
  in Done stays in Done when its assign changes to Jane; two quick taps (done, then a tag chip within 4 s) keep the
  "Marked done" banner and its Undo.
- R6 with `controls` removed from the config, no control element shows and the card looks as before this spec.
- R7 the snoozed card with `blocks` is gone from "Blocked on you" and from the tab counts; the card due today is in
  C1's Due today strip while snoozed, and leaves it when dismissed.
- R8 at midnight in `Europe/Warsaw` (or with the device clock moved past it) a card snoozed to that day is a full card
  again within a minute.

---

## Calls made

1. **The operator's control state lives in `responses/<card id>`, not in `cards/main`.** The page may write only
   responses, notes, batches and guide status; `cards/main` has one writer, the script. The response already
   holds the operator's draft and its sent copy, so controls reuse its chain, its newer-copy rule and its marks.
2. **A tap saves at once and acts on the page at once; the agent learns at Send.** The scoping says every change
   goes into the same batch as the answers, and the snooze must react on the tap.
3. **The batch carries only changes (`controls_sent` is the baseline), and `read` prints and `decisions.md` logs
   only changed keys**: one `read` line per tap keeps the agent's tokens low.
4. **The unchanged place keys ride in `keep`.** `ack` must decide close or reopen from one batch (an undo of
   `dismiss` must not reopen a card that `done` still keeps closed), but the agent never needs to read them, so
   they are data for `ack` only, not `read` lines.
5. **`ack` applies `assign`, `dismiss` and `done` itself; the agent acts only on `assign "agent"` and `close "on"`;
   `snooze` is kept by the script.** These only move a card or hold a follow-up, so the script does it
   deterministically and the agent spends no turn; the other two need a tool, and `read` prints the step for each.
6. **`ack` reopens only cards that a control closed while they were open (`ctl_closed`).** Ticking and unticking
   done on a card the agent finished must not reopen it, and assigning it must not either.
7. **Dismiss reuses the `held` close.** A held card already stays closed through `sync` until its content changes;
   the scoping's "returns when a new source input arrives" adds one condition, a changed `input`.
8. **The return raises `rev`.** "As if it were a new card": an old answer then shows as answered for an older
   version, and the rev-bound controls clear by themselves.
9. **A held card with no stored `input` comes back only on a content change**: the first refresh after a map gains
   an `input` key would otherwise reopen every held card at once.
10. **The `input` rule applies only to a card a dismiss or a done mark closed, never to one the agent closed.** The
    agent's own work in the source (the close the `close` control asks for) changes the row's update time; applying
    the rule there would bring the agent's finished card back as a new question, in a loop. The agent-closed card
    keeps today's rule: it comes back when its content changes. An `assign "agent"` card stays open while the agent
    works, so its later done mark stores the input after that work.
11. **A card file without `input` keeps the stored marker** (like `first_asked`): a row that lacks the field must
    not erase it and silently cancel the return of a dismissed card.
12. **`assign other` holds for good (reason `"other"` in `ctl_closed`)**: "the agent stops tracking it". Only the
    operator's next assign undoes it. On the page it leaves the board (Call 34).
13. **`ctl_closed` is one object (card id -> reason), state-only like `held`.** One field replaces two lists, and
    `sync` reads the reason it needs. A lost state loses it as it loses `held` (2.1); no card field is added.
14. **Snooze, dismiss, close and done answer one `rev`; a rev rise clears them.** The SKILL rule already says an
    answer applies to its card and its rev only; a changed question deserves a fresh look. `assign` and tags stay.
15. **A picked snooze day must be after today and at most 366 days ahead**: a snooze into the past is a no-op, an
    endless one is a dismiss.
16. **Operator tags are an overlay on the page (`tags_on`/`tags_off`), never written into the card file.** A refresh
    re-creates the card's `tags` from the map, so a copy in the file would be overwritten; the overlay survives it.
17. **The `done` box is separate from an action card's "Done" option.** The box is the quick mark the scoping asks
    for; the option stays the answer the agent checks.
18. **The done box sits in the card's left gutter, at the title row** (the scoping's "box in the card gutter"):
    one flex row changes no other part of the card layout.
19. **The panel is the scoping's "edit panel"; its button reads "Edit", and "Hide" while open.** The scoping names
    it; "Close" would clash with the close switch.
20. **`close` shows only on a card with a `source_key`**, the raw row key that `map` fills. A hand-written card has no item to close.
21. **A failed close in the source is reported in the agent's reply, not on the card, until D lands; then with
    `ack --result`** (Needs, D). Posting the card again with a new `evidence` line is a content change: `rev` would
    rise and clear the operator's controls.
22. **Running snoozes live in the state (`snoozed`), and `read` prints them in one line**:
    the script drops a snooze whose day came, whose card changed `rev`, or whose card is closed or gone, so the
    agent compares no dates and reads no log.
23. **`ack` refuses a later batch while an earlier waiting one, not yet acked by this state, holds controls for the
    same card.** The order of control changes matters; an earlier batch acked from the same dump (pending in the
    state) does not block, so the agent can ack several batches from one dump in the order `read` printed them.
24. **A control the config turns off is invisible, never sent, and flagged `[not-enabled]` in `read`.** Acceptance:
    off by default, on through config, with no stray effect.
25. **A flagged control is logged with its flags** (`control dismiss on [stale-rev]`): `decisions.md` is a record,
    and it must not show a control that was not applied as if it were.
26. **`people` ids are 1 to 40 of `a-z 0-9 _ -` and not a fixed id**, so a name can never collide with `me`, `agent`
    or `other`; the label carries the display name.
27. **`controls` is an object of booleans, not a list**: B deep-merges objects, so a user file and a board file can
    each turn single controls on or off.
28. **No new reference file and no control rules in `SKILL`**: `read` ends each control line with what to do
    (`ctlHint`, 4.1), so `SKILL` holds one sentence in step 2 and one bullet on source writes.
29. **An unsent control is a label, not an answer state.** `stateOf` stays the answer state, so a tap on a sent
    card in Done or on an unanswered card never moves it or changes the Open count; `stateLabel` shows "unsent".
30. **A tap that cannot move a card (tags, an assign other than "other") keeps a running linger and its Undo**, and a
    failed write restores the earlier doc only when nothing newer replaced it.
31. **The wake re-render uses C1's one-minute timer** (it schedules a render when `todayOf(clockMs())` leaves
    `lastDay`); C2 adds no timer.
32. **Operator answer `item-controls-layout`**: Assign and Snooze in a row on the card with an Edit button; the edit
    panel holds the Dismiss and Close switches and the tag chips; the Done box sits in the gutter.
33. **Operator answer `item-controls-snooze-fold`**: done, dismiss and Not ours keep the card in place about 4 seconds
    (`LINGER_MS = 4000`) with a banner and Undo, as snooze does.
34. **Operator answer `item-controls-dismissed-place`**: dismissed and done cards go to the folded Done group; a Not
    ours card leaves the board (`cardState` `"hidden"`, which no group takes), and one line `<n> not ours - show` at
    the end of the tab opens a list of them, where the Assign select brings one back.
35. **Operator answer `item-controls-new-input`**: a dismissed card returns on a change of its question or text, or of
    the `input` marker that the source map fills.
36. **Operator answer `item-controls-done-return`**: a card marked done returns like a dismissed one, on new activity
    in the source (`back` covers `"dismiss"` and `"done"`).
37. **Operator answer `item-controls-due-snooze`**: a snoozed card that is due shows in Due today. With the operator
    answer `due-dates-answered-in-strip` (a card leaves the strip when closed, dismissed or done by a control), C1's
    `dueList` gains `!ctlDone(it)`; a snoozed card stays in it.
38. **Operator answer `item-controls-wake-time`**: a snoozed card wakes at 00:00 at the start of the wake day in
    `tz`: `isSnoozed` compares the wake day with today's day in `tz`.
39. **Operator answer `item-controls-assign-labels`**: "Nobody", "Me", the agent name from the config, the `people`
    names, "Not ours".
40. **Operator answer `item-controls-assign-agent`**: the agent does the work, then leaves the card OPEN with a short
    result line; the operator ticks it done. `ack` closes nothing for `assign "agent"`.
41. **Operator answer `item-controls-close-how`**: the agent closes the item with the operator's own CLI or MCP tool
    for that source; the Close switch shows on every card from a source map (`source_key`). The later per-source
    custom close action is parked (maintainer backlog); nothing is built for it, and `ctlHint` is the one place a
    configured close command would change the printed step.
42. **Operator answer `item-controls-assign-source-write`**: exactly two things allow a write to a source: a
    `close "on"` line (close that item, nothing else) and an `assign "agent"` line (the changes the card asks for, in
    that item only). The `read` line names the item by `source`, `source_key` and its first link; a plain answer or
    note never allows a write, and an `assign "agent"` card without a `source_key` allows none.
43. **Operator answer, no settings toggles**: the controls are per-card actions that go out in a
    batch, not settings; `controls` and `people` are config keys with no page control.
44. **`read` prints the next step on every control line** (`ctlHint`): `(ack applies it)`,
    `(nothing to do)`, `(skip)`, or the exact close or assign step with the item. The agent decides nothing per line.
45. **`[superseded]` is a `read` flag only**: a control line that a later waiting batch in the same `read` sets again
    for the same card is skipped by the agent; `ack` still applies every batch in order, and the last placement wins
    in the state.
46. **The snooze compare day is a pure variable, `ctlDay`, set by `render()`** (`setCtlDay(today)`): C1's groups-test
    pins one parameter for `cardState` and `isActive`, and the pure part reads no clock.
47. **`close "on"` on a card without a `source_key` is flagged `[no-item]`**: a batch sent before a card lost its key,
    or a forged batch, names no item to close.

## Needs from other clusters

- **A, B, C1**: nothing beyond their final specs. Step C2-0 greps every name this spec uses and stops on a miss. C2
  adds no command and no flag, so it changes no `FLAGS` line; it adds the state keys `ctl_closed` and `snoozed`,
  which A's older-model refusal accepts (A 1.4 step 2); it adds the batch lists `controlIds`/`controls` read as
  `s.c || []` (A 1.5); it calls only A's clock helpers outside the pure part; it keeps C1's one-parameter
  `cardState(it)`/`isActive(it)` and two-parameter `groupCards(list, now)` (C1's groups-test pins them).
- **D (agent-status)**, which lands after C2. Exact changes D must make on top of C2:
  - `ack`: keep C2's `k1`, `j`, `k2` and `k = k1 + k2`; add `const m = setResults();` after `k2`; the cards write goes
    out when `k + j + m > 0`; the printed line is
    `` `ack ${bid}: handled, ${k} cards closed, ${j} reopened, ${m} results. The answers go to decisions.md when the next read no longer lists the batch` ``.
    USAGE: `  ack <batch id> [--close <id>...] [--result <id> <text>]... --dump <dir>   mark a batch handled, apply its controls, close cards, store result lines`;
    `FLAGS` line `ack: ["state", "dump", "close", "result"]`.
  - `ctlHint` (4.1): the `assign "agent"` hints end `; leave the card open and add --result <id> "<what you did, in a few words>" to the ack line)`
    in place of `; leave the card open and say what you did in your reply)`; the `close "on"` hint ends
    `...then add --close <id> to the ack line; if you cannot, add --result <id> "not closed: <why, in a few words>" to it instead)`
    in place of `...; if you cannot, leave the card and say why in your reply)`. board-test 2 strings follow.
  - D's replacement of SKILL "Read and handle the answers" step 3 keeps C2's ` (several: in the order \`read\` printed them)`
    after "Run the `ack` line that `read` printed".
  - D's "agent changed" dot compares a card's `updated`: an `ack` that closes or reopens a card for a control changes
    `updated`, so D should not dot a card whose `cardState` is `"done"` or `"hidden"`.
  - A result line (D) must drop when `rev` rises, including C2's `back` return (`content` false, `rev + 1`): compare
    `doc.rev` with `old.rev`, not `content`.
- **D (wake-modes)**: nothing; a batch with only controls wakes the agent like any batch.
- **Maintainer**: the parked per-source custom close action goes in the
  backlog; nothing of it is built here. The checks for the maintainer (section 8, after C2-12) run on a new test
  artifact, never on a board in use under `board/`.

## Unverified

- That a native `<input type="date">` and `<select>` open the phone pickers inside the claude.ai artifact frame on
  iOS and Android (maintainer checks R2, R3).
- That `text()` and `get()` in `REFRESH` behave for `input` as they do for `title` (a scalar becomes trimmed text, a
  dotted path over a list gives a list); read them before step C2-9.
- The A, B and C1 code as landed: the names and shapes this spec uses come from the final `decision-board-spec-a-core.md`, `decision-board-spec-b-config.md`
  and `decision-board-spec-c1-fields-groups.md`, not from code; step C2-0 greps them before any change.
- That C1's `render()` first line, its `var groups = groupCards(vis, now);` line and its `dueList` filter land
  exactly as C1 3.5 and 2.5 write them (5.1 and 5.2 edit those lines).
- That `P.coerce` handles the nested `"o:bkeep"` inside `"m:bctl"`: read in today's `coerce` (the `o` and `m`
  branches call `coerce` recursively), not run.
- That a `source_key` longer than 300 characters never occurs in practice: `map` copies the raw key, and `sync`
  refuses such a card with the page's `source_key: longer than 300` problem.
- No code was run. The function bodies are untested designs, to be proved by the tests listed.
- No change to an earlier spec is needed for C2 to work.

