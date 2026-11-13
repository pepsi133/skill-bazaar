// Quick controls: control state, Send, placement, snooze and tags. Run: node controls-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
// A card as the page holds it: coerced, keyed by its id.
const item = (id, x) => P.coerce("item", Object.assign({ id, title: "Q " + id, options: ["Yes", "No"], status: "open" }, x));
const response = (id, x) => Object.assign(P.coerce("response", Object.assign({ choice: "", sent: false }, x || {})), { itemId: id });
function board(list, responses) {
  P.items.clear(); P.resp.clear(); P.notes.clear();
  list.forEach((it) => P.items.set(it.id, it));
  Object.entries(responses || {}).forEach(([id, r]) => P.resp.set(id, response(id, r)));
}
const ON = { assign: true, snooze: true, dismiss: true, close: true, done: true, tags: true };
const OFF = { assign: false, snooze: false, dismiss: false, close: false, done: false, tags: false };
const CONF = (x) => Object.assign({ controls: ON, tags: [{ id: "cost" }, { id: "security" }], people: [{ id: "jane", label: "Jane" }], tz: "Europe/Warsaw" }, x);
function setup(x) { P.applyConfig(CONF(x)); if (P.setCtlDay) P.setCtlDay("2026-11-13"); }

ok("controls are off in the plugin defaults; the config turns each one on", () => {
  P.applyConfig({ tz: "UTC" });
  assert.deepEqual(plain(P.cfg.controls), OFF);
  assert.deepEqual(plain(P.DEFAULTS.controls), OFF);
  assert.equal(P.anyControl(), false);
  P.applyConfig({ tz: "UTC", controls: { snooze: true, bogus: true, done: "yes" } });
  assert.deepEqual(plain(P.cfg.controls), Object.assign({}, OFF, { snooze: true }));
  P.applyConfig({ tz: "UTC", controls: 5 });
  assert.deepEqual(plain(P.cfg.controls), OFF);
});
ok("people add assignees in order; reserved and bad ids are dropped", () => {
  P.applyConfig({ tz: "UTC", agent: "Coordinator", people: [{ id: "jane", label: "Jane" }, { id: "me" }, { id: "Bad Id" }, { id: "jane" }, { id: "bob" }] });
  assert.deepEqual(plain(P.assignIds()), ["me", "agent", "jane", "bob", "other"]);
  assert.deepEqual(plain(P.assignList().map((x) => x.label)), ["Me", "Coordinator", "Jane", "bob", "Not ours"]);
});
ok("ctlNorm: a rev rise clears snooze, dismiss, close and done; assign and tags stay", () => {
  setup();
  const c = { rev: 1, assign: "jane", snooze: "2026-11-20", dismiss: true, close: true, done: true, tags_on: ["cost"] };
  assert.deepEqual(plain(P.ctlNorm(c, 2)), { rev: 2, assign: "jane", snooze: "", dismiss: false, close: false, done: false, tags_on: ["cost"], tags_off: [] });
  assert.deepEqual(plain(P.ctlNorm(c, 1)), { rev: 1, assign: "jane", snooze: "2026-11-20", dismiss: true, close: true, done: true, tags_on: ["cost"], tags_off: [] });
});
ok("ctlNorm: a control the config turns off reads as its default; bad values are cleared", () => {
  setup({ controls: { assign: true } });
  const n = plain(P.ctlNorm({ rev: 1, dismiss: true, assign: "nobody-known", snooze: "2026-02-30", tags_on: ["cost", "zzz", "cost"] }, 1));
  assert.equal(n.dismiss, false);
  assert.equal(n.assign, "");
  assert.equal(n.snooze, "");
  assert.deepEqual(n.tags_on, []);
  setup();
  assert.equal(plain(P.ctlNorm({ rev: 1, snooze: "2026-02-30" }, 1)).snooze, "");
  const t = plain(P.ctlNorm({ rev: 1, tags_on: ["security", "cost", "cost"], tags_off: ["cost"] }, 1));
  assert.deepEqual(t.tags_on, ["security"]);
  assert.deepEqual(t.tags_off, []);
});
ok("controlDiff: only what changed; the unchanged place keys ride in keep; tags as both lists; null when nothing changed", () => {
  setup();
  const d = (a, b, rev) => plain(P.controlDiff(a, b, rev));
  assert.deepEqual(d(undefined, { rev: 1, snooze: "2026-11-20" }, 1), { rev: 1, snooze: "2026-11-20" });
  assert.deepEqual(d(undefined, { rev: 1, dismiss: true }, 1), { rev: 1, dismiss: "on", keep: { assign: "", done: "off" } });
  assert.deepEqual(d(undefined, { rev: 1, assign: "jane", done: true }, 1), { rev: 1, assign: "jane", done: "on", keep: { dismiss: "off" } });
  assert.deepEqual(d({ rev: 1, tags_on: ["cost"] }, { rev: 1, tags_on: ["cost"], tags_off: ["security"] }, 1), { rev: 1, tags_on: ["cost"], tags_off: ["security"] });
  assert.equal(P.controlDiff({ rev: 1, done: true, assign: "me" }, { rev: 1, done: true, assign: "me" }, 1), null);
  assert.equal(P.controlDiff({ rev: 1, dismiss: true }, { rev: 1, dismiss: true }, 2), null, "a sent dismiss read at a higher rev is no change");
  assert.deepEqual(d({ rev: 1, dismiss: true }, { rev: 2, dismiss: true }, 2), { rev: 2, dismiss: "on", keep: { assign: "", done: "off" } });
  setup({ controls: { dismiss: true } });
  assert.deepEqual(d(undefined, { rev: 1, dismiss: true }, 1), { rev: 1, dismiss: "on" });
  setup({ controls: {} });
  assert.equal(P.controlDiff(undefined, { rev: 1, dismiss: true, snooze: "2026-11-20", assign: "me", tags_on: ["cost"] }, 1), null);
});
ok("withControls keeps the answer, history and controls_sent; nextResponse keeps the controls", () => {
  setup();
  const prev = { itemId: "a", choice: "Yes", note: "n", rev: 1, sent: true, batch: "b1", updated: "t0", history: [{ choice: "No" }], controls_sent: { rev: 1, done: true } };
  const w = P.withControls(prev, "a", { snooze: "2026-11-20", bogus: 1, rev: 9 }, 1, "t1");
  for (const k of ["choice", "note", "sent", "batch", "history", "controls_sent"]) assert.deepEqual(plain(w[k]), plain(prev[k]), k);
  assert.equal(w.updated, "t1");
  assert.deepEqual(plain(w.controls), plain(P.ctlNorm({ rev: 1, snooze: "2026-11-20" }, 1)));
  assert.deepEqual(plain(P.withControls(null, "z", { done: true }, 3, "t")),
    { itemId: "z", choice: "", note: "", rev: 3, updated: "t", sent: false, batch: "", controls: plain(P.ctlNorm({ rev: 3, done: true }, 3)) });
  assert.deepEqual(plain(P.nextResponse(w, "a", "No", "", 1, "t2").controls), plain(w.controls));
});
ok("Send takes a control-only change, on a closed card too; the batch carries controlIds and controls; a card counts once", () => {
  setup();
  board([item("a"), item("b", { status: "closed" }), item("c")], {
    a: { choice: "Yes", controls: { rev: 1, snooze: "2026-11-20" } },
    b: { controls: { rev: 1, done: false }, controls_sent: { rev: 1, done: true } },
    c: { choice: "Yes", sent: true },
  });
  const s = P.sendable();
  assert.deepEqual(plain(s.c.map((x) => x.itemId)), ["a", "b"]);
  assert.equal(P.unsentCount(), 2);
  const b = plain(P.batchDoc("b1", "t", s));
  assert.deepEqual(b.itemIds, ["a"]);
  assert.deepEqual(b.controlIds, ["a", "b"]);
  assert.deepEqual(b.controls.b, { rev: 1, done: "off", keep: { assign: "", dismiss: "off" } });
  P.resp.forEach((x) => { if (x.controls) x.controls_sent = x.controls; });
  assert.deepEqual(plain(P.sendable().c), []);
});
ok("an unsent control is a label only; isDone: dismiss, done and not ours; not ours is hidden", () => {
  setup();
  board([item("s")], { s: { controls: { rev: 1, snooze: "2026-11-20" } } });
  const s = P.items.get("s");
  assert.equal(P.stateOf(s), "open");
  assert.equal(P.cardState(s), "snoozed");
  assert.equal(P.stateLabel(s), "unsent");
  P.resp.get("s").controls_sent = P.resp.get("s").controls;
  assert.equal(P.stateLabel(s), "open");
  board([item("j")], { j: { choice: "Yes", sent: true, controls: { rev: 1, assign: "jane" } } });
  const j = P.items.get("j");
  assert.equal(P.stateOf(j), "sent");
  assert.equal(P.isDone(j), true);
  assert.equal(P.cardState(j), "done");
  assert.equal(P.stateLabel(j), "sent");
  board([item("t")], { t: { controls: { rev: 1, tags_on: ["cost"] } } });
  assert.equal(P.openCount(), 1);
  board([item("d1"), item("d2"), item("o"), item("c", { status: "closed" })],
    { d1: { controls: { rev: 1, dismiss: true } }, d2: { controls: { rev: 1, done: true } }, o: { controls: { rev: 1, assign: "other" } } });
  const ids = ["d1", "d2", "o"], get = (id) => P.items.get(id);
  assert.deepEqual(ids.map((id) => P.isDone(get(id))), [true, true, true]);
  assert.deepEqual(ids.map((id) => P.cardState(get(id))), ["done", "done", "hidden"]);
  assert.deepEqual(ids.map((id) => P.doneReason(get(id))), ["dismissed", "done", "not ours"]);
  assert.equal(P.doneReason(get("c")), "closed");
  assert.equal(P.stateLabel(get("o")), "not ours");
});
ok("cardState: one parameter; linger keeps a card's old state; a snooze holds until the wake day; a rev rise brings a dismissed card back; groups and Due today", () => {
  assert.equal(P.cardState.length, 1);
  assert.equal(P.isActive.length, 1);
  setup();
  board([item("z")], { z: { controls: { rev: 1, snooze: "2026-11-20" } } });
  const z = P.items.get("z");
  P.setCtlDay("2026-11-19");
  assert.equal(P.cardState(z), "snoozed");
  assert.equal(P.isSnoozed(z, "2026-11-19"), true);
  P.setCtlDay("2026-11-20");
  assert.equal(P.cardState(z), "active");
  P.setCtlDay(P.todayOf(Date.UTC(2026, 10, 19, 23, 30)));
  assert.equal(P.cardState(z), "active", "23:30 UTC is already 11-20 in Europe/Warsaw");
  P.setCtlDay("2026-11-13");
  board([item("d", { rev: 1 })], { d: { controls: { rev: 1, dismiss: true } } });
  assert.equal(P.cardState(P.items.get("d")), "done");
  P.items.set("d", item("d", { rev: 2 }));
  assert.equal(P.cardState(P.items.get("d")), "active", "a rev rise clears the dismiss");
  const Q = load({ lingerOf: (id) => (id === "x" ? "active" : "") });
  Q.applyConfig(CONF()); Q.setCtlDay("2026-11-13");
  for (const id of ["x", "y"]) {
    Q.items.set(id, Q.coerce("item", { id, title: "Q", status: "open" }));
    Q.resp.set(id, Object.assign(Q.coerce("response", { controls: { rev: 1, dismiss: true } }), { itemId: id }));
  }
  assert.equal(Q.cardState(Q.items.get("x")), "active");
  assert.equal(Q.cardState(Q.items.get("y")), "done");
  P.applyConfig({ controls: ON, tz: "UTC", week_start: "tuesday 12:00" });
  P.setCtlDay("2026-11-13");
  const now = Date.UTC(2026, 10, 13, 12);
  board([item("s1", { priority: "now" }), item("d1"), item("o1"), item("s2", { due: "2026-11-13" }), item("d2", { due: "2026-11-13" }), item("d3", { due: "2026-11-13" })], {
    s1: { controls: { rev: 1, snooze: "2026-11-20" } }, d1: { controls: { rev: 1, dismiss: true } }, o1: { controls: { rev: 1, assign: "other" } },
    s2: { controls: { rev: 1, snooze: "2026-11-20" } }, d2: { controls: { rev: 1, dismiss: true } }, d3: { controls: { rev: 1, done: true } },
  });
  const groups = P.groupCards(P.sortedItems(), now), where = (id) => plain(groups.filter((g) => g.cards.some((c) => c.id === id)).map((g) => g.id));
  assert.deepEqual(where("s1"), ["this-week"]);
  assert.deepEqual(where("d1"), ["done"]);
  assert.deepEqual(where("o1"), []);
  assert.deepEqual(plain(P.notOursList(P.sortedItems()).map((it) => it.id)), ["o1"]);
  assert.equal(P.matchOne({ state: "any" }, P.items.get("o1"), now), false);
  const due = P.dueList(P.sortedItems(), "2026-11-13").map((it) => it.id);
  assert.ok(due.includes("s2"));
  assert.ok(!due.includes("d2") && !due.includes("d3"));
});
ok("snooze days: +1 day, +1 week across a month end and the end of DST; a picked day must be after today and within a year", () => {
  assert.equal(P.snoozeDay("2026-10-24", "day"), "2026-10-25");
  assert.equal(P.snoozeDay("2026-11-27", "week"), "2026-12-04");
  assert.equal(P.snoozeDay("2026-11-27", "x"), "");
  assert.equal(P.snoozeOk("2026-11-28", "2026-11-27"), true);
  assert.equal(P.snoozeOk("2026-11-27", "2026-11-27"), false);
  assert.equal(P.snoozeOk("2027-11-29", "2026-11-27"), false);
  assert.equal(P.snoozeOk("2026-02-30", "2026-11-27"), false);
});
ok("tagsOf and tagPatch: the card's tags, minus off, plus on; tabs, chips and group matches use them", () => {
  setup({ tabs: [{ id: "sec", match: { tags: ["security"] } }] });
  board([item("t", { tags: ["cost"] })]);
  const t = () => P.items.get("t");
  assert.deepEqual(plain(P.tagPatch(t(), "cost")), { tags_on: [], tags_off: ["cost"] });
  assert.deepEqual(plain(P.tagPatch(t(), "security")), { tags_on: ["security"], tags_off: [] });
  board([item("t", { tags: ["cost"] })], { t: { controls: { rev: 1, tags_on: ["security"], tags_off: ["cost"] } } });
  assert.deepEqual(plain(P.tagsOf(t())), ["security"]);
  assert.deepEqual(plain(P.tagChips(t()).map((x) => x.id)), ["security"]);
  assert.equal(P.tabOf(t(), P.cfg.tabs), "sec");
  assert.equal(P.matchOne({ state: "active", tags: ["security"] }, t(), 0), true);
  assert.equal(P.matchOne({ state: "active", tags: ["cost"] }, t(), 0), false);
});
ok("Blocked on you, the tab counts and the Open count leave out snoozed, controlled-done and not-ours cards", () => {
  setup();
  board([item("p", { blocks: "x" }), item("s", { blocks: "x" }), item("d", { blocks: "x" }), item("o", { blocks: "x" })],
    { s: { controls: { rev: 1, snooze: "2099-01-01" } }, d: { controls: { rev: 1, dismiss: true } }, o: { controls: { rev: 1, assign: "other" } } });
  const sorted = P.sortedItems();
  assert.deepEqual(plain(P.blockedList(sorted).map((it) => it.id)), ["p"]);
  assert.equal(P.openCount(), 1);
  assert.equal(P.tabCounts(sorted, P.isActive).all, 1);
});
ok("ctlNote and fmtDay", () => {
  setup();
  const note = (id, c, x) => { board([item(id, x)], { [id]: { controls: Object.assign({ rev: 1 }, c) } }); return P.ctlNote(P.items.get(id), "2026-11-13"); };
  assert.equal(note("a", { assign: "other" }), "Not ours: the agent stops tracking it");
  assert.equal(note("b", { close: true }, { source: "tracker" }), "Close requested: the agent closes it in tracker");
  assert.equal(note("b2", { close: true }), "Close requested: the agent closes it in the source");
  assert.equal(note("b3", { close: true }, { status: "closed" }), "");
  assert.equal(note("c", { dismiss: true }), "Dismissed: it comes back when something new arrives");
  assert.equal(note("d", { done: true }), "Marked done");
  assert.equal(note("e", { snooze: "2026-11-20" }), "Snoozed until " + P.fmtDay("2026-11-20"));
  assert.equal(note("f", { snooze: "2026-11-13" }), "");
  assert.equal(note("g", {}), "");
  assert.ok(P.fmtDay("2026-11-20").includes("20"));
  assert.equal(P.fmtDay("x"), "");
});
P.applyConfig({ tz: "UTC" });
// Send end to end: the page's sendGroup against a stub database, in a sandbox of its own.
(async () => {
  const { cut } = require("./_page.js"), written = [];
  const S = load({ lastDoc: new Map(), idStamp: () => "20261113T120000+0000", rid: () => "abcd", nowStamp: () => "2026-11-13T12:00:00.000+00:00",
    enqueue: (k, fn) => Promise.resolve().then(fn),
    db: { doc: (p) => ({ set: (d) => { written.push([p, JSON.parse(JSON.stringify(d))]); return Promise.resolve(); }, update: () => Promise.resolve() }) } },
    cut("  function sendGroup(s)", "  function send()"));
  S.applyConfig(CONF()); S.setCtlDay("2026-11-13");
  S.items.set("a", S.coerce("item", { id: "a", title: "Q a", options: ["Yes", "No"], status: "open" }));
  S.resp.set("a", Object.assign(S.coerce("response", { choice: "Yes", updated: "t0", controls: { rev: 1, done: true, snooze: "2026-11-20" } }), { itemId: "a" }));
  await S.sendGroup(S.sendable());
  ok("sendGroup marks the controls that went out as sent; a second Send carries no control", () => {
    const batch = written.find(([p]) => p.startsWith("batches/"))[1];
    assert.deepEqual(batch.controlIds, ["a"]);
    const r = S.resp.get("a");
    assert.deepEqual(plain(r.controls_sent), plain(r.controls));
    assert.equal(r.sent, true);
    assert.deepEqual(plain(S.sendable().c), []);
    assert.deepEqual(plain(S.batchDoc("b2", "t", S.sendable()).controlIds), []);
  });
  S.applyConfig({ tz: "UTC" });
})().catch((e) => { console.error(e); process.exit(1); });
