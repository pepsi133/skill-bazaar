// Groups and the sort order. Run: node groups-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
const base = (x) => Object.assign({ tz: "UTC", week_start: "tuesday 12:00" }, x);
// Friday 12:00 UTC; the week runs from Tuesday 11-10 12:00 to Tuesday 11-17 12:00.
const now = Date.UTC(2026, 10, 13, 12);
const item = (x) => P.coerce("item", x);
const fill = (list) => { P.items.clear(); list.forEach((x) => P.items.set(x.id, item(x))); };
// The group ids of groupCards, each with the ids of its cards.
const byGroup = (list) => plain(Object.fromEntries(P.groupCards(list, now).map((g) => [g.id, g.cards.map((c) => c.id)])));
const groupOf = (x) => P.groupCards([item(x)], now).find((g) => g.cards.length).id;

ok("no groups in the config: the six default groups, in order", () => {
  assert.ok(P.cfg.groups === P.DEFAULT_GROUPS, "normConfig(null) at load reads DEFAULT_GROUPS");
  assert.ok(P.DEFAULT_GROUPS.length > 0);
  assert.ok(P.cfg.week_start !== null && P.cfg.week_start !== undefined);
  for (const c of [base(), base({ title: "x" })]) {
    P.applyConfig(c);
    assert.deepEqual(plain(P.cfg.groups.map((g) => g.id)), ["alerts", "blocked", "this-week", "next-week", "backlog", "done"]);
    assert.deepEqual(plain(P.cfg.groups.map((g) => g.label)), ["Alerts and incidents", "Now: blocked on a human", "This week", "Next week", "Backlog", "Done"]);
    assert.deepEqual(plain(P.cfg.groups.map((g) => g.fold)), [false, false, false, false, false, true]);
    assert.deepEqual(plain(P.cfg.sort), ["priority", "due", "created", "id"]);
    assert.deepEqual(plain(P.cfg.tags.map((t) => t.id)), ["alert", "incident"]);
  }
  assert.ok("groups" in P.DEFAULTS && "sort" in P.DEFAULTS && "week_start" in P.DEFAULTS);
});
ok("cardState takes one card and gives active or done; groupCards takes a list and a time and ends with the tail groups _other and _done", () => {
  assert.equal(typeof P.cardState, "function");
  assert.equal(P.cardState.length, 1);
  assert.equal(P.isActive.length, 1);
  assert.equal(P.cardState(item({ id: "a", status: "open" })), "active");
  assert.equal(P.cardState(item({ id: "b", status: "closed" })), "done");
  assert.deepEqual(plain(P.GROUP_STATES), ["active", "done", "any"]);
  P.applyConfig(base());
  assert.deepEqual(plain(P.groupCards([], now).map((g) => g.id)), ["alerts", "blocked", "this-week", "next-week", "backlog", "done", "_other", "_done"]);
  assert.equal(P.groupCards.length, 2);
});
ok("the default groups place each card", () => {
  P.applyConfig(base());
  const x = (id, y) => Object.assign({ id, priority: "soon", status: "open" }, y);
  fill([x("a", { tags: ["alert"] }), x("b", { blocks: "backup" }), x("c", { due: "2026-11-13" }), x("d", { due: "2026-11-10" }),
    x("e", { priority: "now" }), x("f", { due: "2026-11-18" }), x("g"), x("h", { due: "2026-12-20" }), x("i", { status: "closed", tags: ["alert"] }),
    x("j", { blocks: "x" }), x("k", { priority: "later" }), x("l", { due: "2026-11-17" }), x("m", { due: "2026-11-24" }), x("o", { due: "2026-11-25" })]);
  P.resp.set("j", { sent: true, choice: "x" });
  assert.deepEqual(byGroup(P.sortedItems()), { alerts: ["a"], blocked: ["b"], "this-week": ["e", "d", "c", "l"], "next-week": ["f", "m", "g"],
    backlog: ["o", "h", "k"], done: ["i", "j"], _other: [], _done: [] });
  P.resp.clear();
  P.items.clear();
});
ok("the first matching group takes the card; a list matches any; every key of an object must fit", () => {
  P.applyConfig(base({ groups: [{ id: "x", match: { tags: ["cost"], priority: ["now"] } }, { id: "y", match: [{ source: [" Mail "] }, { kind: ["info"] }] }, { id: "z", match: { tags: ["cost"] } }] }));
  assert.equal(groupOf({ id: "a", tags: ["cost"], priority: "now" }), "x");
  assert.equal(groupOf({ id: "a", tags: ["cost"], priority: "soon" }), "z");
  assert.equal(groupOf({ id: "a", source: "mail", tags: ["cost"], priority: "soon" }), "y", "y comes before z");
  assert.equal(groupOf({ id: "a", kind: "info" }), "y");
  assert.equal(groupOf({ id: "a" }), "_other");
  assert.equal(groupOf({ id: "a", status: "closed", tags: ["cost"], priority: "now" }), "_done");
  P.applyConfig(base({ groups: [{ id: "q", match: { blocked: false, state: "any" } }] }));
  assert.equal(groupOf({ id: "a", status: "closed" }), "q");
  assert.equal(groupOf({ id: "a", status: "closed", blocks: "x" }), "_done");
});
ok("groups: [] keeps only the tail groups, Open and Done", () => {
  P.applyConfig(base({ groups: [] }));
  assert.deepEqual(plain(P.cfg.groups), []);
  const gs = P.groupCards([item({ id: "a" }), item({ id: "b", status: "closed" })], now);
  assert.deepEqual(plain(gs.map((g) => [g.id, g.label, g.cards.map((c) => c.id)])), [["_other", "Open", ["a"]], ["_done", "Done", ["b"]]]);
});
ok("a group entry with a typo is dropped whole, never a catch-all", () => {
  P.applyConfig(base({ groups: [{ id: "a", match: { due: ["thisweek"] } }, { id: "b", match: { tag: ["x"] } }, { id: "c", match: [{}, 5] }, { id: "d", matches: {} },
    { id: "Bad" }, { id: "_x" }, { id: "e", label: "E", _note: "ok", match: { _why: "ok" } }] }));
  assert.deepEqual(plain(P.cfg.groups.map((g) => g.id)), ["e"]);
  P.applyConfig(base({ groups: [{ id: "a", match: { due: ["thisweek"] } }] }));
  assert.ok(P.cfg.groups === P.DEFAULT_GROUPS, "every entry invalid gives the defaults");
  P.applyConfig(base(JSON.parse('{"groups":[{"id":"z","match":{"__proto__":["x"]}},{"id":"y","match":{"source":[" Mail "]}}]}')));
  assert.deepEqual(plain(P.cfg.groups.map((g) => g.id)), ["y"]);
  assert.deepEqual(plain(P.cfg.groups[0].match[0].source), ["mail"]);
  assert.equal(Object.getPrototypeOf(P.cfg.groups[0].match[0]), null);
});
ok("sort: each key, both directions, missing values last, the id breaks ties", () => {
  fill([{ id: "p", priority: "now", due: "2026-11-20", first_asked: { date: "2026-11-01" }, created: "2026-11-03T10:00:00+00:00", updated: "2026-11-05T10:00:00+00:00", title: "b" },
    { id: "q", priority: "soon", first_asked: { date: "2026-10-01" }, created: "2026-11-01T10:00:00+00:00", updated: "bad", title: "A" },
    { id: "r", priority: "later", due: "2026-11-15", created: "bad", updated: "2026-11-04T10:00:00+00:00", title: "c" },
    { id: "s", priority: "p9", first_asked: { date: "2026-11-02" }, created: "2026-11-02T10:00:00+00:00", updated: "2026-11-06T10:00:00+00:00", title: "" }]);
  const want = { priority: "pqrs", "-priority": "srqp", due: "rpqs", "-due": "prqs", first_asked: "qpsr", "-first_asked": "spqr", created: "qspr",
    "-created": "psqr", updated: "rpsq", "-updated": "sprq", title: "sqpr", "-title": "rpqs", id: "pqrs", "-id": "srqp" };
  assert.equal(Object.keys(want).length, 14);
  for (const [k, ids] of Object.entries(want)) {
    P.applyConfig(base({ sort: [k] }));
    assert.equal(P.sortedItems().map((it) => it.id).join(""), ids, k);
  }
  fill([{ id: "t2", priority: "soon" }, { id: "t1", priority: "soon" }]);
  for (const k of ["priority", "-priority"]) {
    P.applyConfig(base({ sort: [k] }));
    assert.equal(P.sortedItems().map((it) => it.id).join(","), "t1,t2", k);
  }
  P.items.clear();
});
ok("sort: unknown and repeated keys are dropped; nothing valid gives the default", () => {
  P.applyConfig(base({ sort: ["due", "-due", "nope", " title "] }));
  assert.deepEqual(plain(P.cfg.sort), ["due", "title"]);
  for (const v of [["nope"], [], "due"]) {
    P.applyConfig(base({ sort: v }));
    assert.ok(P.cfg.sort === P.DEFAULTS.sort, JSON.stringify(v));
  }
});
ok("dueBucket feeds the due match", () => {
  P.applyConfig(base({ groups: [{ id: "n", match: { due: ["none"] } }, { id: "l", match: { due: ["later"] } }] }));
  assert.equal(groupOf({ id: "a" }), "n");
  assert.equal(groupOf({ id: "a", due: "2026-11-25" }), "l");
  assert.equal(groupOf({ id: "a", due: "2026-11-18" }), "_other", "next_week");
});
P.applyConfig(base());
