// Time stamps, the config zone and DST. Run: node time-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pageFile, load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));

ok("stampIn: the offset of the zone, seconds or milliseconds; UTC is +00:00, never Z", () => {
  const s = [P.stampIn(Date.UTC(2026, 0, 1, 0, 0, 0, 7), "UTC", true), P.stampIn(Date.UTC(2026, 0, 1), "Asia/Kolkata", false),
    P.stampIn(Date.UTC(2026, 2, 8, 7, 0), "America/New_York", false)];
  assert.deepEqual(s, ["2026-01-01T00:00:00.007+00:00", "2026-01-01T05:30:00+05:30", "2026-03-08T03:00:00-04:00"]);
  for (const x of s) assert.match(x, P.SCHEMA.stampRe);
});
ok("across the end of DST, a later instant can have an earlier wall clock; cmpStamp, newerDoc and sortedItems order by instant", () => {
  const a = P.stampIn(Date.UTC(2026, 9, 25, 0, 59, 59), "Europe/Warsaw"), b = P.stampIn(Date.UTC(2026, 9, 25, 1, 30), "Europe/Warsaw");
  assert.deepEqual([a, b], ["2026-10-25T02:59:59+02:00", "2026-10-25T02:30:00+01:00"]);
  assert.ok(b < a, "as strings b sorts first");
  assert.equal(P.cmpStamp(b, a), 1);
  assert.equal(P.cmpStamp(a, b), -1);
  const mine = { updated: b };
  assert.equal(P.newerDoc({ updated: a }, mine), mine);
  P.items.clear();
  P.items.set("y", P.coerce("item", { id: "y", created: b }));
  P.items.set("x", P.coerce("item", { id: "x", created: a }));
  assert.deepEqual(plain(P.sortedItems().map((it) => it.created)), [a, b], "created a sorts first");
  P.items.clear();
});
ok("the start of DST: 02:30 does not exist; the stamps still order", () => {
  const a = P.stampIn(Date.UTC(2026, 2, 29, 0, 59, 59), "Europe/Warsaw"), b = P.stampIn(Date.UTC(2026, 2, 29, 1, 0, 0), "Europe/Warsaw");
  assert.deepEqual([a, b], ["2026-03-29T01:59:59+01:00", "2026-03-29T03:00:00+02:00"]);
  assert.equal(P.cmpStamp(a, b), -1);
  assert.equal(P.stampMs(b) - P.stampMs(a), 1000);
});
ok("compactStamp keeps the sign of the offset", () => {
  assert.equal(P.compactStamp("2026-11-13T13:31:08.412+01:00"), "20261113T133108+0100");
  assert.equal(P.compactStamp("2026-11-13T13:31:08-05:00"), "20261113T133108-0500");
  assert.equal(P.compactStamp("2026-11-13T13:31:08.999-05:00"), "20261113T133108-0500", "the ms part is dropped");
});
ok("tz: an IANA name or UTC; a bad name or a fixed offset keeps the default", () => {
  P.applyConfig({ tz: "europe/warsaw" });
  assert.equal(P.cfg.tz, "Europe/Warsaw");
  P.applyConfig({ tz: "UTC" });
  assert.equal(P.cfg.tz, "UTC");
  for (const raw of [{ tz: "Mars/Base" }, { tz: "+01:00" }, { tz: 5 }, {}, null]) {
    P.applyConfig(raw);
    assert.equal(P.cfg.tz, P.DEFAULTS.tz, JSON.stringify(raw));
  }
  assert.deepEqual(["Mars/Base", "+01:00", "+05:30", 5, "", "UTC", "Europe/Warsaw"].map(P.tzOk), [false, false, false, false, false, true, true]);
  assert.ok("tz" in P.DEFAULTS);
  P.applyConfig(null);
});
ok("the default zone is a valid IANA name the runtime accepts", () => {
  assert.equal(typeof P.DEFAULTS.tz, "string");
  assert.notEqual(P.DEFAULTS.tz, "UTC");
  assert.equal(P.tzOk(P.DEFAULTS.tz), true);
  assert.equal(P.normTz(P.DEFAULTS.tz), P.DEFAULTS.tz);
  assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: P.DEFAULTS.tz }));
});
ok("dayIn and addDays: the calendar day in the zone", () => {
  assert.equal(P.dayIn(Date.UTC(2026, 0, 1, 23, 30), "Europe/Warsaw"), "2026-01-02");
  assert.equal(P.dayIn(Date.UTC(2026, 0, 1, 23, 30), "UTC"), "2026-01-01");
  assert.equal(P.addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(P.addDays("2026-10-24", 1), "2026-10-25");
  assert.equal(P.addDays("2026-12-31", 1), "2027-01-01");
});
ok("stampMs: an unreadable stamp is -Infinity; two of them compare equal", () => {
  assert.equal(P.stampMs("2026-01-01T00:00:00+00:00"), Date.UTC(2026, 0, 1));
  assert.deepEqual(["", "not a time", undefined, null, 5].map(P.stampMs), [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity]);
  assert.equal(P.cmpStamp("", "x"), 0);
  assert.equal(P.cmpStamp("", "2026-01-01T00:00:00+00:00"), -1);
  assert.equal(P.localStamp("x", "UTC"), "");
  assert.equal(P.localStamp("2026-01-03T00:00:00+00:00", "Europe/Warsaw"), "2026-01-03T01:00:00+01:00");
});
ok("fmtTime shows the zone's wall clock", () => {
  assert.ok(P.fmtTime("2026-10-25T00:30:00+00:00", "Europe/Warsaw").includes("02:30"), P.fmtTime("2026-10-25T00:30:00+00:00", "Europe/Warsaw"));
  assert.equal(P.fmtTime("", "UTC"), "");
});
ok("zoneNote: always names the zone", () => {
  assert.equal(P.zoneNote("Europe/Warsaw"), "Times in Europe/Warsaw");
  assert.equal(P.zoneNote("UTC"), "Times in UTC");
  assert.equal(P.zoneNote.length, 1, "it takes no device zone");
});
ok("type d: coerce keeps text, problems wants a stamp with an offset or empty", () => {
  const S = P.SCHEMA;
  assert.ok(S.stampRe.test("2026-11-13T13:31:08+01:00") && S.stampRe.test("2026-11-13T13:31:08.412-05:00"));
  assert.ok(!S.stampRe.test("2026-11-13T13:31:08Z") && !S.stampRe.test("2026-11-13T13:31:08.4+01:00"));
  S.timeProbe = { at: "d" };
  try {
    assert.deepEqual(plain(P.coerce("timeProbe", { at: 5 })), { at: "" });
    assert.deepEqual(plain(P.coerce("timeProbe", { at: "x" })), { at: "x" });
    assert.deepEqual(plain(P.problems("timeProbe", { at: "2026-11-13T13:31:08+01:00" })), []);
    assert.deepEqual(plain(P.problems("timeProbe", { at: "" })), []);
    assert.deepEqual(plain(P.problems("timeProbe", { at: 5 })), ["at: not text"]);
    assert.deepEqual(plain(P.problems("timeProbe", { at: "2026-11-13T13:31:08Z" })), ["at: not a time with an offset, such as 2026-11-13T13:31:08+01:00"]);
  } finally { delete S.timeProbe; }
});
ok("the time functions are plain declarations with the named parameters", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  for (const s of ["function zoneParts(ms, tz) {", "function stampIn(ms, tz, withMs) {", "function stampMs(v) {", "function dayIn(ms, tz) {",
    "function addDays(day, n) {", "function realDate(v) {"]) assert.ok(src.includes(s), s);
});
