// Due dates and the "Due today" strip. Run: node due-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pageFile, load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
const item = (x) => P.coerce("item", x);

ok("dayDiff counts calendar days, across a month and a DST change", () => {
  assert.equal(P.dayDiff("2026-02-28", "2026-03-01"), 1);
  assert.equal(P.dayDiff("2026-10-24", "2026-10-26"), 2);
  assert.equal(P.dayDiff("2026-01-05", "2026-01-01"), -4);
});
ok("dueInfo: overdue, today, tomorrow, a later day, none", () => {
  const t = "2026-11-13", at = (due) => { const d = P.dueInfo(item(due === undefined ? { id: "a" } : { id: "a", due }), t); return d && plain(d); };
  assert.deepEqual(at("2026-11-11"), { days: -2, text: "Overdue 2 days", cls: "now" });
  assert.equal(at("2026-11-12").text, "Overdue 1 day");
  assert.deepEqual([at("2026-11-13").text, at("2026-11-13").cls], ["Due today", "now"]);
  assert.deepEqual([at("2026-11-14").text, at("2026-11-14").cls], ["Due tomorrow", "soon"]);
  assert.deepEqual([at("2026-12-01").text, at("2026-12-01").cls], ["Due 12-01", ""]);
  assert.equal(at("2026-02-30"), null);
  assert.equal(at(""), null);
  assert.equal(at(undefined), null);
});
ok("week_start: a day and an optional 24-hour time; anything else keeps the default", () => {
  assert.deepEqual(plain(P.normWeek("tuesday 12:00")), { day: 2, min: 720 });
  assert.deepEqual(plain(P.normWeek(" Monday ")), { day: 1, min: 0 });
  assert.deepEqual(plain(P.normWeek("tuesday 7:05")), { day: 2, min: 425 });
  for (const v of ["TUE 12:00", "tuesday 24:00", "tuesday 12:60", "tuesday12:00", 5]) assert.equal(P.normWeek(v), null, String(v));
  P.applyConfig({ tz: "UTC", week_start: "Friday 08:30" });
  assert.deepEqual(plain(P.cfg.week_start), { day: 5, min: 510 });
  const def = plain(P.normWeek(P.DEFAULTS.week_start));
  assert.notEqual(def, null, "the default is valid");
  P.applyConfig({ tz: "UTC", week_start: "someday" });
  assert.deepEqual(plain(P.cfg.week_start), def);
  P.applyConfig({ tz: "UTC" });
  assert.deepEqual(plain(P.cfg.week_start), def);
});
ok("dueBucket: with weeks from Monday 00:00 in UTC", () => {
  P.applyConfig({ tz: "UTC", week_start: "monday 00:00" });
  const fri = Date.UTC(2026, 10, 13, 12);
  assert.deepEqual(["2026-11-12", "2026-11-13", "2026-11-15", "2026-11-16", "2026-11-22", "2026-11-23", "x"].map((d) => P.dueBucket(d, fri)),
    ["overdue", "today", "this_week", "next_week", "next_week", "later", "none"]);
  const sun = Date.UTC(2026, 10, 15, 12);
  assert.deepEqual(["2026-11-16", "2026-11-23"].map((d) => P.dueBucket(d, sun)), ["next_week", "later"]);
  const mon = Date.UTC(2026, 10, 16, 0, 0);
  assert.deepEqual(["2026-11-22", "2026-11-23"].map((d) => P.dueBucket(d, mon)), ["this_week", "next_week"]);
});
ok("dueBucket: a week from Tuesday 12:00 turns at noon in the config tz", () => {
  P.applyConfig({ tz: "Europe/Warsaw", week_start: "tuesday 12:00" });
  const before = Date.UTC(2026, 10, 17, 10, 59), after = Date.UTC(2026, 10, 17, 11, 1);
  assert.deepEqual(["2026-11-17", "2026-11-18", "2026-11-24", "2026-11-25"].map((d) => P.dueBucket(d, before)),
    ["today", "next_week", "next_week", "later"]);
  assert.deepEqual(["2026-11-17", "2026-11-18", "2026-11-24", "2026-11-25", "2026-12-01", "2026-12-02"].map((d) => P.dueBucket(d, after)),
    ["today", "this_week", "this_week", "next_week", "next_week", "later"]);
  assert.equal(P.dueBucket("2026-10-28", Date.UTC(2026, 9, 27, 10, 59)), "next_week");
  assert.equal(P.dueBucket("2026-10-28", Date.UTC(2026, 9, 27, 11, 1)), "this_week");
  assert.equal(P.weekStartOf(after) - P.weekStartOf(before), 10080);
});
ok("week start: in the hour that repeats when clocks go back, a week that turned stays turned (Warsaw, Sydney)", () => {
  // Europe/Warsaw, 2026-10-25: 03:00 CEST becomes 02:00 CET at 01:00Z, so 02:00 to 02:59 comes twice.
  P.applyConfig({ tz: "Europe/Warsaw", week_start: "sunday 02:30" });
  const w = ["2026-10-25T00:29:00Z", "2026-10-25T00:31:00Z", "2026-10-25T01:29:00Z", "2026-10-25T01:31:00Z"].map(Date.parse);
  assert.deepEqual(w.map((t) => P.dueBucket("2026-10-31", t)), ["next_week", "this_week", "this_week", "this_week"]);
  const s = w.map((t) => P.weekStartOf(t));
  assert.equal(s[1] - s[0], 10080, "the week turns at the first 02:30");
  assert.deepEqual([s[2], s[3]], [s[1], s[1]], "and stays turned through the second pass of 02:00 to 02:59");
  // An hour and more after the change the result is the plain wall-clock one again.
  assert.equal(P.weekStartOf(Date.parse("2026-10-25T03:00:00Z")), s[1]);
  assert.deepEqual(["2026-11-01", "2026-11-02"].map((d) => P.dueBucket(d, Date.parse("2026-10-25T03:00:00Z"))), ["this_week", "next_week"]);
  // Australia/Sydney, 2026-04-05: 03:00 AEDT becomes 02:00 AEST at 16:00Z on 04-04.
  P.applyConfig({ tz: "Australia/Sydney", week_start: "sunday 02:30" });
  const y = ["2026-04-04T15:29:00Z", "2026-04-04T15:31:00Z", "2026-04-04T16:29:00Z", "2026-04-04T16:31:00Z"].map(Date.parse);
  assert.deepEqual(y.map((t) => P.dueBucket("2026-04-11", t)), ["next_week", "this_week", "this_week", "this_week"]);
  const ys = y.map((t) => P.weekStartOf(t));
  assert.deepEqual([ys[1] - ys[0], ys[2], ys[3]], [10080, ys[1], ys[1]]);
  P.applyConfig({ tz: "UTC" });
});
ok("week start: the look-back reaches far enough: 02:59 probed 45 to 59 min after the change, 02:00 probed 170 min after", () => {
  // Europe/Warsaw, 2026-10-25, the change at 01:00Z. sunday 02:59 turns at 00:59Z (02:59 CEST); 02:45 to 02:59 CET
  // comes 45 to 59 minutes after the change and must not turn the week back.
  P.applyConfig({ tz: "Europe/Warsaw", week_start: "sunday 02:59" });
  const turned = P.weekStartOf(Date.parse("2026-10-25T00:59:00Z"));
  assert.equal(turned - P.weekStartOf(Date.parse("2026-10-25T00:58:00Z")), 10080);
  for (let m = 45; m <= 59; m++) assert.equal(P.weekStartOf(Date.parse("2026-10-25T01:00:00Z") + m * 60000), turned, m + " min after");
  assert.equal(P.dueBucket("2026-10-31", Date.parse("2026-10-25T01:50:00Z")), "this_week");
  // sunday 02:00 turned at 00:00Z; 170 minutes after the change the look-back still sees it and the result is unchanged.
  P.applyConfig({ tz: "Europe/Warsaw", week_start: "sunday 02:00" });
  const t0 = P.weekStartOf(Date.parse("2026-10-25T00:00:00Z"));
  assert.equal(t0 - P.weekStartOf(Date.parse("2026-10-24T23:59:00Z")), 10080);
  assert.equal(P.weekStartOf(Date.parse("2026-10-25T01:00:00Z") + 170 * 60000), t0);
  P.applyConfig({ tz: "UTC" });
});
ok("week start: a week_start in the spring gap turns when the clock jumps past it", () => {
  // Europe/Warsaw, 2026-03-29: 02:00 CET becomes 03:00 CEST at 01:00Z; 02:30 never shows on the clock.
  P.applyConfig({ tz: "Europe/Warsaw", week_start: "sunday 02:30" });
  const t = ["2026-03-29T00:59:00Z", "2026-03-29T01:00:00Z", "2026-03-29T01:31:00Z"].map(Date.parse);
  assert.deepEqual(t.map((x) => P.dueBucket("2026-04-04", x)), ["next_week", "this_week", "this_week"]);
  const s = t.map((x) => P.weekStartOf(x));
  assert.deepEqual([s[1] - s[0], s[2]], [10080, s[1]]);
  P.applyConfig({ tz: "UTC" });
});
ok("dueList: open cards due today or earlier stay after an answer, the most overdue first", () => {
  P.applyConfig({ tz: "UTC" });
  // a is due today with the first priority, b was due yesterday with the last: the most overdue still comes first.
  const all = [["a", { due: "2026-11-13", priority: "now" }], ["b", { due: "2026-11-12", priority: "later" }], ["c", { due: "2026-11-14" }], ["d", {}],
    ["e", { due: "2026-11-06", status: "closed" }], ["f", { due: "2026-11-13" }], ["g", { due: "2026-02-30" }]];
  all.forEach(([id, x]) => P.items.set(id, item(Object.assign({ id, priority: "soon" }, x))));
  P.resp.set("f", { choice: "Yes", sent: true });
  assert.deepEqual(plain(P.sortedItems().slice(0, 1).map((it) => it.id)), ["a"], "the sort puts a first");
  assert.deepEqual(plain(P.dueList(P.sortedItems(), "2026-11-13").map((it) => it.id)), ["b", "a", "f"]);
  P.resp.clear();
  P.items.clear();
});
ok("a card becomes due overnight in the config tz, not in UTC", () => {
  P.applyConfig({ tz: "Europe/Warsaw" });
  const sorted = [item({ id: "a", due: "2026-11-14" })];
  let t = Date.UTC(2026, 10, 13, 22, 59);
  assert.deepEqual(plain(P.dueList(sorted, P.todayOf(t))), []);
  assert.equal(P.dueInfo(sorted[0], P.todayOf(t)).text, "Due tomorrow");
  t = Date.UTC(2026, 10, 13, 23, 1);
  assert.deepEqual(plain(P.dueList(sorted, P.todayOf(t)).map((it) => it.id)), ["a"]);
  assert.equal(P.dueInfo(sorted[0], P.todayOf(t)).text, "Due today");
});
ok("the page re-renders on a new day or week and shows the strip above Blocked on you", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  assert.ok(src.includes("setInterval(function () { var t = clockMs(); if (todayOf(t) !== lastDay || weekStartOf(t) !== lastWeek) schedule(); }, 60000);"));
  assert.ok(src.includes("var now = clockMs(), today = todayOf(now); lastDay = today; lastWeek = weekStartOf(now);"));
  assert.ok(src.includes("renderDue(dueList(list, today), today);"));
  assert.ok(src.indexOf('id="due"') > 0 && src.indexOf('id="due"') < src.indexOf('id="blocked"'));
});
P.applyConfig({ tz: "UTC" });
