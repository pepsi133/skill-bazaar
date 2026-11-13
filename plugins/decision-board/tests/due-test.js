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
