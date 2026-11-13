// The agent status strip, the agent-changed dot and the wake modes. Run: node status-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pageFile, load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));

ok("wakePlan: defaults per mode (poll 300 and 24, both 900 and 32); an unknown mode is both; out-of-range values keep defaults", () => {
  assert.deepEqual(plain(P.wakePlan({ mode: "poll" })), { mode: "poll", comment: false, poll: true, poll_seconds: 300, poll_limit: 24 });
  assert.deepEqual(plain(P.wakePlan({ mode: "both" })), { mode: "both", comment: true, poll: true, poll_seconds: 900, poll_limit: 32 });
  assert.deepEqual(plain(P.wakePlan({ mode: "comment", poll_seconds: 120 })), { mode: "comment", comment: true, poll: false, poll_seconds: 0, poll_limit: 0 });
  assert.deepEqual(plain(P.wakePlan({ mode: "off" })), { mode: "off", comment: false, poll: false, poll_seconds: 0, poll_limit: 0 });
  assert.equal(P.wakePlan({ mode: "sometimes" }).mode, "both");
  assert.equal(P.wakePlan(undefined).mode, "both");
  assert.equal(P.wakePlan([]).mode, "both");
  assert.deepEqual([P.wakePlan({ mode: "poll", poll_seconds: 30, poll_limit: 0 }).poll_seconds, P.wakePlan({ mode: "poll", poll_seconds: 30, poll_limit: 0 }).poll_limit], [300, 24]);
  assert.deepEqual([P.wakePlan({ mode: "both", poll_seconds: 600, poll_limit: 6 }).poll_seconds, P.wakePlan({ mode: "both", poll_seconds: 600, poll_limit: 6 }).poll_limit], [600, 6]);
  assert.equal(P.wakePlan({ mode: "poll", poll_seconds: 90.5 }).poll_seconds, 300);
  P.applyConfig({ tz: "UTC" });
  assert.equal(P.cfg.wake.mode, "both");
  P.applyConfig({ tz: "UTC", wake: { mode: "poll", poll_limit: 3 } });
  assert.deepEqual([P.cfg.wake.mode, P.cfg.wake.poll_seconds, P.cfg.wake.poll_limit], ["poll", 300, 3]);
});
ok("coerce status: next drops non-strings; watch absent stays absent", () => {
  const s = P.coerce("status", { now: "Build", next: ["A", 5, null, "B"], waiting: 3, updated: "2026-02-01T12:00:00+00:00" });
  assert.deepEqual(plain(s), { now: "Build", next: ["A", "B"], waiting: "", updated: "2026-02-01T12:00:00+00:00" });
  assert.equal("watch" in s, false);
  const w = P.coerce("status", { now: "x", watch: { started: "2026-02-01T12:00:00+00:00", until: 7 } });
  assert.deepEqual(plain(w.watch), { started: "2026-02-01T12:00:00+00:00", until: "" });
});
const NOW = Date.parse("2026-02-01T12:00:00Z");
const at = (min) => P.stampIn(NOW - min * 60000, "UTC", false);
const st = (x) => P.coerce("status", Object.assign({ now: "Build the report", next: [], waiting: "", updated: at(0) }, x));
const f1 = (s) => "T(" + s + ")";
ok("ageText: just now, minutes, hours, days, a bad stamp, a future stamp", () => {
  assert.equal(P.ageText(at(0.5), NOW), "just now");
  assert.equal(P.ageText(at(5), NOW), "5 min ago");
  assert.equal(P.ageText(at(59), NOW), "59 min ago");
  assert.equal(P.ageText(at(120), NOW), "2 h ago");
  assert.equal(P.ageText(at(47 * 60 + 59), NOW), "47 h ago");
  assert.equal(P.ageText(at(3 * 1440), NOW), "3 d ago");
  assert.equal(P.ageText("yesterday", NOW), "");
  assert.equal(P.ageText(at(-30), NOW), "just now");
});
ok("statusView: no document, a task, idle with waiting, stale after stale_minutes, idle never stale, at most 3 next", () => {
  P.applyConfig({ tz: "UTC" });
  const none = P.statusView(null, NOW, f1);
  assert.deepEqual([none.has, none.head, none.age, none.stale, plain(none.next), none.waiting], [false, "No status from the agent yet", "", false, [], ""]);
  const task = P.statusView(st({ next: ["A", "B"], waiting: "the key" }), NOW, f1);
  assert.deepEqual([task.has, task.idle, task.head, task.age, task.stale, plain(task.next), task.waiting], [true, false, "Now: Build the report", "just now", false, ["A", "B"], "the key"]);
  const idle = P.statusView(st({ now: "idle", waiting: "your answer", updated: at(600) }), NOW, f1);
  assert.deepEqual([idle.idle, idle.head, idle.stale, idle.age, idle.waiting], [true, "Idle, waiting for: your answer", false, "10 h ago", ""]);
  assert.equal(P.statusView(st({ now: "Idle" }), NOW, f1).head, "Idle");
  const old = P.statusView(st({ updated: at(31) }), NOW, f1);
  assert.deepEqual([old.stale, old.age], [true, "last heard 31 min ago"]);
  assert.equal(P.statusView(st({ updated: at(30) }), NOW, f1).stale, false);
  assert.deepEqual(plain(P.statusView(st({ next: ["a", "b", "c", "d"] }), NOW, f1).next), ["a", "b", "c"]);
});
ok("statusView: an empty now (a watcher window before any status) is the idle status: head, waiting tail, never stale", () => {
  P.applyConfig({ tz: "UTC" });
  const watch = { started: at(1), until: at(-60) };
  const v = P.statusView(st({ now: "", updated: at(0.5), watch }), NOW, f1);
  assert.deepEqual([v.has, v.idle, v.head, v.age, v.stale, v.when], [true, true, "Idle", "just now", false, "T(" + at(0.5) + ")"]);
  assert.equal(P.statusView(st({ now: "   " }), NOW, f1).head, "Idle", "blank text is empty");
  for (const now of ["IDLE ", " idle", "Idle", "iDlE\t"]) {
    const x = P.statusView(st({ now, updated: at(600) }), NOW, f1);
    assert.deepEqual([x.idle, x.head, x.stale], [true, "Idle", false], JSON.stringify(now));
  }
  const old = P.statusView(st({ now: "", waiting: "the key", next: ["A"], updated: at(600) }), NOW, f1);
  const word = P.statusView(st({ now: "idle", waiting: "the key", next: ["A"], updated: at(600) }), NOW, f1);
  assert.deepEqual([old.head, old.stale, old.age, old.waiting, plain(old.next)], ["Idle, waiting for: the key", false, "10 h ago", "", ["A"]]);
  assert.deepEqual(plain(old), plain(word), "the same strip as now: idle");
  assert.equal(P.statusView(st({ now: "Build" }), NOW, f1).head, "Now: Build");
});
ok("statusView: an unreadable updated is no status; a stamp 10 minutes ahead is stale", () => {
  P.applyConfig({ tz: "UTC" });
  const bad = P.statusView(st({ updated: "soon" }), NOW, f1);
  assert.deepEqual([bad.has, bad.head, bad.when], [false, "No status from the agent yet", ""]);
  const ahead = P.statusView(st({ updated: at(-10) }), NOW, f1);
  assert.deepEqual([ahead.stale, ahead.age], [true, "last heard just now"]);
  assert.equal(P.statusView(st({ updated: at(-4) }), NOW, f1).stale, false);
});
ok("statusView: config status.stale_minutes changes the stale bound; an invalid value keeps 30", () => {
  P.applyConfig({ tz: "UTC", status: { stale_minutes: 5 } });
  assert.equal(P.statusView(st({ updated: at(6) }), NOW, f1).stale, true);
  for (const v of [0, 1441, 2.5, "10"]) {
    P.applyConfig({ tz: "UTC", status: { stale_minutes: v } });
    assert.equal(P.cfg.status.stale_minutes, 30, String(v));
    assert.deepEqual([P.statusView(st({ updated: at(29) }), NOW, f1).stale, P.statusView(st({ updated: at(31) }), NOW, f1).stale], [false, true]);
  }
  P.applyConfig({ tz: "UTC", status: { guide: "yes" } });
  assert.equal(P.cfg.status.guide, false);
  P.applyConfig({ tz: "UTC", status: { guide: true } });
  assert.equal(P.cfg.status.guide, true);
});
ok("statusView: when is the exact time of updated through the formatter it is given, \"\" without a status", () => {
  P.applyConfig({ tz: "UTC" });
  assert.equal(P.statusView(st({ updated: at(120) }), NOW, f1).when, "T(" + at(120) + ")");
  assert.equal(P.statusView(null, NOW, f1).when, "");
});
const card = (id, updated, x) => P.coerce("item", Object.assign({ id, title: id, options: ["Yes", "No"], status: "open", updated }, x));
ok("cardChanged: first visit shows none; a new card and a newer updated show; the same updated does not", () => {
  const a = card("a", at(10));
  assert.equal(P.cardChanged(a, null), false);
  const m = P.seenOf([a]);
  assert.equal(P.cardChanged(a, m), false);
  assert.equal(P.cardChanged(card("b", at(10)), m), true);
  assert.equal(P.cardChanged(card("a", at(5)), m), true);
  assert.equal(P.cardChanged(card("a", at(20)), m), false);
  assert.equal(P.cardChanged(card("a", "bad"), m), true);
});
ok("cardChanged: compares instants across a DST offset", () => {
  const seen = P.seenOf([card("a", "2026-11-01T01:50:00-04:00")]);
  assert.equal(P.cardChanged(card("a", "2026-11-01T01:10:00-05:00"), seen), true);
  const back = P.seenOf([card("a", "2026-11-01T01:10:00-05:00")]);
  assert.equal(P.cardChanged(card("a", "2026-11-01T01:50:00-04:00"), back), false);
});
ok("seenOf and seenFrom: map id to updated; a __proto__ id is an own key and shows no dot when unchanged; bad text is null", () => {
  const p = card("__proto__", at(3)), m = P.seenOf([card("a", at(1)), p]);
  assert.equal(Object.getPrototypeOf(m), null);
  assert.deepEqual(Object.keys(m), ["a", "__proto__"]);
  assert.equal(P.cardChanged(p, m), false);
  const back = P.seenFrom(JSON.stringify(m));
  assert.deepEqual([Object.getPrototypeOf(back), back.a, Object.hasOwn(back, "__proto__"), back["__proto__"]], [null, at(1), true, at(3)]);
  assert.equal(P.cardChanged(p, back), false);
  assert.deepEqual(Object.keys(P.seenFrom('{"a": "x", "b": 5, "c": null}')), ["a"]);
  for (const t of [null, "", "not json", "[]", "5", '"x"', "null"]) assert.equal(P.seenFrom(t), null, String(t));
});
ok("dotOn: a card in Done or Not ours shows no dot; an active or snoozed changed card does", () => {
  P.applyConfig({ tz: "UTC", controls: { assign: true, snooze: true, dismiss: true, close: true, done: true, tags: true } });
  P.setCtlDay("2026-02-01");
  const ids = ["act", "snz", "done", "other", "closed"], m = P.seenOf(ids.map((id) => card(id, at(60))));
  const list = ids.map((id) => card(id, at(1), id === "closed" ? { status: "closed" } : {}));
  P.items.clear(); P.resp.clear();
  list.forEach((it) => P.items.set(it.id, it));
  const ctl = (id, x) => P.resp.set(id, Object.assign(P.coerce("response", { choice: "", sent: false, controls: Object.assign({ rev: 1 }, x) }), { itemId: id }));
  ctl("snz", { snooze: "2026-02-10" }); ctl("done", { done: true }); ctl("other", { assign: "other" });
  assert.deepEqual(list.map((it) => P.cardState(it)), ["active", "snoozed", "done", "hidden", "done"]);
  assert.deepEqual(list.map((it) => P.dotOn(it, m)), [true, true, false, false, false]);
  assert.equal(P.dotOn(list[0], null), false);
  P.resp.clear(); P.items.clear();
});
ok("durText: seconds, minutes, hours", () => {
  assert.deepEqual([90, 300, 900, 7200].map(P.durText), ["90 s", "5 min", "15 min", "2 h"]);
});
ok("wakeLine: off, comment, poll and both; watcher planned until, window ended, none started", () => {
  const plan = (mode, x) => P.wakePlan(Object.assign({ mode }, x));
  assert.equal(P.wakeLine(plan("off"), null, NOW, f1), "Wake: off. Tell the agent to read the board.");
  assert.equal(P.wakeLine(plan("comment"), { started: at(10), until: at(-60) }, NOW, f1), "Wake: a comment on Send");
  assert.equal(P.wakeLine(plan("poll"), null, NOW, f1), "Wake: poll every 5 min, no watcher started");
  assert.equal(P.wakeLine(plan("poll"), { started: at(10), until: at(-60) }, NOW, f1), "Wake: poll every 5 min, watcher planned until T(" + at(-60) + ")");
  assert.equal(P.wakeLine(plan("both"), { started: at(600), until: at(60) }, NOW, f1), "Wake: a comment on Send, and a poll every 15 min, watcher window ended T(" + at(60) + ")");
  assert.equal(P.wakeLine(plan("both"), { started: "", until: "" }, NOW, f1), "Wake: a comment on Send, and a poll every 15 min, no watcher started");
  P.applyConfig({ tz: "UTC", wake: { mode: "poll" } });
  assert.equal(P.statusView(st({ watch: { started: at(10), until: at(-60) } }), NOW, f1).wake, "Wake: poll every 5 min, watcher planned until T(" + at(-60) + ")");
  assert.equal(P.statusView(null, NOW, f1).wake, "Wake: poll every 5 min, no watcher started");
});
ok("wakeNotice: each mode and outcome gives its line, no_capability included; WAKE_TEXT carries no batch id or card id", () => {
  const plan = (mode) => P.wakePlan({ mode });
  for (const o of ["sent", "none", "no_capability"]) {
    assert.equal(P.wakeNotice(plan("off"), o), "Sent. Tell the agent to read the board.");
    assert.equal(P.wakeNotice(plan("poll"), o), "Sent. The watcher picks it up within 5 min.");
  }
  const both = plan("both"), com = plan("comment");
  assert.equal(P.wakeNotice(both, "no_capability"), "Sent. This page cannot post comments: ask the agent to republish it. The poll every 15 min picks it up.");
  assert.equal(P.wakeNotice(com, "no_capability"), "Sent. This page cannot post comments: ask the agent to republish it, and to read the board.");
  for (const p of [both, com]) {
    assert.equal(P.wakeNotice(p, "sent"), "Sent, and the agent was woken by a comment.");
    assert.equal(P.wakeNotice(p, "sent_unsaved"), "Sent, and the agent was woken. The thread was not saved, so the next wake starts a new one.");
    assert.equal(P.wakeNotice(p, "mark_sent"), "Sent, but some answers were not marked sent. The agent was woken.");
    assert.equal(P.wakeNotice(p, "gesture"), "Sent. Tap Wake the agent to send the comment.");
    assert.equal(P.wakeNotice(p, "consent_required"), "Sent. Allow comments from this page, then tap Wake the agent.");
    assert.equal(P.wakeNotice(p, "rate_limited"), "Sent. Too many wakes just now; tap Wake the agent in a minute.");
  }
  for (const o of ["no_session", "writers_only", "off", "unavailable", "forbidden", "none"]) {
    assert.equal(P.wakeNotice(both, o), "Sent. No agent session takes comments here; the poll every 15 min picks it up.");
    assert.equal(P.wakeNotice(com, o), "Sent. No agent session takes comments here; tell the agent to read the board.");
  }
  assert.equal(P.WAKE_TEXT, "Read the decision board: answers were sent.");
  assert.ok(!/\bb\d{8}T|card|batch/i.test(P.WAKE_TEXT));
});
ok("the dot clears on Mark all seen and on an answer or a control of that card", () => {
  const src = fs.readFileSync(pageFile, "utf8"), body = (head) => src.slice(src.indexOf(head) + head.length).trimStart();
  assert.ok(src.includes("  function markAllSeen() {") && src.includes("  function seenOne(id) {"));
  assert.ok(body("  function saveResponse(id) {").startsWith("seenOne(id);"));
  assert.ok(body("  function saveControls(id, patch) {").startsWith("seenOne(id);"));
  assert.ok(src.includes("if (seenCards === null && loaded.items) markAllSeen();"));
  assert.ok(!src.includes('addEventListener("pagehide"') && !src.includes("IntersectionObserver"));
});
ok("PAGE never writes meta/status", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  assert.ok(!/doc\("meta\/status"\)\.(set|update)/.test(src));
  assert.ok(src.includes('db.doc("meta/status").onSnapshot(applyStatus'));
});
ok("the page wakes only from a click", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  const fnBody = (head) => { const i = src.indexOf(head); assert.ok(i >= 0, head); return src.slice(i, src.indexOf("\n  }\n", i) + 4); };
  const wa = fnBody("  function wakeAgent(anchorP) {"), sendFn = fnBody("  function send() {");
  const click = src.slice(src.indexOf('  $("wake").addEventListener("click", function () {'), src.indexOf("\n", src.indexOf('  $("wake").addEventListener("click"')));
  assert.ok(click.length > 10, "the #wake click handler");
  const count = (t, x) => t.split(x).length - 1;
  assert.ok(count(wa, "sendToClaude") >= 1);
  assert.equal(count(src, "sendToClaude"), count(wa, "sendToClaude"), "sendToClaude only inside wakeAgent");
  const calls = count(src, "wakeAgent(") - 1;                     // less the definition
  assert.equal(calls, count(sendFn, "wakeAgent(") + count(click, "wakeAgent("), "wakeAgent is called only from send and the #wake click");
  assert.ok(count(sendFn, "wakeAgent(") >= 1 && count(click, "wakeAgent(") === 1);
  const firstStmt = (t) => t.slice(t.indexOf("{") + 1).trimStart().split(";")[0];
  assert.ok(firstStmt(sendFn).includes("wakeAnchor()"), firstStmt(sendFn));
  assert.ok(firstStmt(click).includes("wakeAnchor()"), firstStmt(click));
  assert.ok(sendFn.includes("if (went) wakeAgent(anchorP).then(sentOutcome)"));
});
