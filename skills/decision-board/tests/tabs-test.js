// Tab and guide checks. Run: node tabs-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
const items = [
  { id: "a", area: "gmail", status: "open" },
  { id: "b", area: "github", status: "open" },
  { id: "c", area: "gmail", status: "open" },
  { id: "d", area: "vm", status: "open" },
  { id: "e", area: "vm", source: "github", status: "open" },
  { id: "f", area: "gmail", source: "other", status: "open" },
  { id: "g", area: "github", status: "answered" },
  { id: "h", area: "plan", source: "bogus", status: "open" },
  { id: "i", area: "gmail", status: "closed" }];
const tabsOf = () => items.map((i) => i.id + ":" + P.tabOf(i, P.cfg.tabs)).join(" ");
P.resp.set("c", { sent: true, choice: "x" });

ok("without meta/config the tabs are All, Email, GitHub, Other as before", () => {
  P.applyConfig(null);
  assert.deepEqual(plain(P.cfg.tabs.map((t) => t.label)), ["Email", "GitHub", "Other"]);
  assert.equal(tabsOf(), "a:email b:github c:email d:other e:github f:other g:github h:other i:email");
  assert.equal(P.tabOf({ source: " Email " }, P.cfg.tabs), "email", "source is trimmed and matched in lower case");
});
ok("tab counts follow the hide rules", () => {
  assert.deepEqual({ ...P.tabCounts(items, P.visibleBase) }, { all: 6, email: 1, github: 2, other: 3 });
  P.f.hide = false; P.f.closed = true;
  assert.deepEqual({ ...P.tabCounts(items, P.visibleBase) }, { all: 9, email: 3, github: 3, other: 3 });
  P.f.hide = true; P.f.closed = false;
});
ok("config tabs by area, with a rest tab", () => {
  P.applyConfig({ tabs: [{ id: "net", label: "Network", match: { area: ["vm", "gmail"] } }, { id: "code", label: "Code", match: { area: ["github"] } },
    { id: "rest", label: "Rest", rest: true }] });
  assert.equal(tabsOf(), "a:net b:code c:net d:net e:net f:net g:code h:rest i:net");
  assert.ok(P.inTab(items[1], "code") && !P.inTab(items[1], "net") && P.inTab(items[1], "all"));
});
ok("source wins over the other fields; no rest tab leaves an item under All only", () => {
  P.applyConfig({ tabs: [{ id: "agent-b", label: "Agent B", match: { from: ["agent-b"] } }, { id: "mail", label: "Mail", match: { source: ["mail-inbox"] } }] });
  assert.equal(P.tabOf({ from: "agent-b", source: "mail-inbox" }, P.cfg.tabs), "mail");
  assert.equal(P.tabOf({ from: "agent-b" }, P.cfg.tabs), "agent-b");
  assert.equal(P.tabOf({ from: "agent-c" }, P.cfg.tabs), "");
  assert.deepEqual({ ...P.tabCounts([{ from: "agent-c", id: "z" }], () => true) }, { all: 1, "agent-b": 0, mail: 0 });
});
ok("bad config entries are dropped, not fatal", () => {
  P.applyConfig({ tabs: [{ id: "all" }, { id: "guide:x" }, { label: "no id" }, { id: "ok", match: { area: "notalist", source: ["", 3, " s "] } }, { id: "ok" }],
    kinds: "x", priorities: [{}], labels: [1] });
  assert.equal(P.cfg.tabs.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(P.cfg.tabs[0])), { id: "ok", label: "ok", match: { source: ["s"] }, rest: false });
  assert.deepEqual(plain(P.cfg.kinds.map((k) => k.id)), ["decision", "action", "info"]);
  assert.deepEqual(plain(P.cfg.priorities.map((k) => k.id)), ["now", "soon", "later"]);
  assert.equal(P.cfg.labels[0], "Before");
  P.applyConfig({ tabs: [] });
  assert.equal(P.cfg.tabs.length, 0);
  P.applyConfig("garbage");
  assert.equal(P.cfg.tabs.length, 3);
});
ok("a tabs list with only invalid entries keeps the default tabs, like kinds", () => {
  P.applyConfig({ tabs: [{ id: "all" }, { label: "x" }, 7] });
  assert.deepEqual(plain(P.cfg.tabs.map((t) => t.id)), ["email", "github", "other"]);
  P.applyConfig(null);
});
ok("config keys __proto__ and constructor are data, not object internals", () => {
  P.applyConfig(JSON.parse('{"tabs":[{"id":"t","match":{"__proto__":["x"],"constructor":["y"],"area":["a"]}},{"id":"constructor","rest":true}],' +
    '"kinds":[{"id":"constructor","label":"C"},{"id":"__proto__"}],"priorities":[{"id":"__proto__"},{"id":"toString"}]}'));
  assert.deepEqual(Object.keys(P.cfg.tabs[0].match), ["area"]);
  assert.equal(Object.getPrototypeOf(P.cfg.tabs[0].match), null);
  assert.equal(P.tabOf({ constructor: "y", area: "b" }, P.cfg.tabs), "constructor");
  assert.equal(P.tabOf({ area: "A " }, P.cfg.tabs), "t");
  assert.deepEqual(plain(P.cfg.kinds.map((k) => k.id)), ["constructor", "__proto__"]);
  assert.equal(P.priRank("toString"), 1);
  assert.equal(P.priRank("valueOf"), 99);
  P.applyConfig(null);
});
ok("config lists stop at 50 entries; the label pattern is built once per config", () => {
  P.applyConfig({ tabs: Array.from({ length: 500 }, (_, i) => ({ id: "t" + i, match: { area: Array.from({ length: 80 }, (_, j) => "a" + j) } })),
    labels: Array.from({ length: 500 }, (_, i) => "L" + i), priorities: Array.from({ length: 70 }, (_, i) => ({ id: "p" + i })) });
  assert.equal(P.cfg.tabs.length, 50);
  assert.equal(P.cfg.tabs[0].match.area.length, 50);
  assert.equal(P.cfg.labels.length, 50);
  assert.equal(P.cfg.priorities.length, 50);
  const re = P.cfg.labelRe;
  P.fmtText("L1: x"); P.fmtText("L2: y");
  assert.equal(P.cfg.labelRe, re);
  assert.ok(P.fmtText("L49: x").startsWith("<p><strong>L49:</strong>") && !P.fmtText("L50: x").includes("<strong>"));
  P.applyConfig(null);
});
ok("tab matching and agent names ignore case and spaces; the configured agent name is the default agent", () => {
  P.applyConfig({ agent: "Coordinator", tabs: [{ id: "b", match: { from: ["Agent-B"] } }] });
  assert.equal(P.tabOf({ from: " agent-b " }, P.cfg.tabs), "b");
  assert.deepEqual(["Agent-B", " agent-b ", "COORDINATOR", "", 5].map(P.agentKey), ["agent-b", "agent-b", "", "", ""]);
  P.applyConfig(null);
  assert.equal(P.agentKey("claude"), "");
});
ok("title: config, then meta/board, then the default", () => {
  P.applyConfig(null);
  assert.equal(P.boardTitle(null), "Decision board");
  assert.equal(P.boardTitle({ title: "Header title" }), "Header title");
  P.applyConfig({ title: "Config title" });
  assert.equal(P.boardTitle({ title: "Header title" }), "Config title");
  P.applyConfig(null);
});
const G = [
  { id: "g2", title: "Second", status: "active", created: "2", item: "b" },
  { id: "g1", title: "First", status: "active", created: "1" },
  { id: "g3", title: "Old", status: "archived", created: "0", item: "a" },
  { id: "g4", title: "No status", created: "3", item: "b" }];
for (const g of G) Object.assign(g, P.coerce("guide", g));
ok("guides: active ones are tabs in order of created", () => {
  assert.equal(P.guideList(G, false).map(P.guideKey).join(" "), "guide:g1 guide:g2 guide:g4");
  assert.equal(P.guideList(G, true).map((g) => g.id).join(" "), "g3");
  assert.equal(P.guideOfTab(G, "guide:g2").title, "Second");
  assert.equal(P.guideOfTab(G, "guide:g3"), null);
  assert.ok(P.isGuideTab("guide:g2") && !P.isGuideTab("email"));
  assert.equal(P.guideForItem(G, "b").id, "g2");
  assert.equal(P.guideForItem(G, "a"), null);
  assert.equal(P.inTab(items[0], "guide:g1"), false);
});
ok("a status guide is pinned first and marks a change since the viewer looked", () => {
  const S = G.concat([P.coerce("guide", { id: "st", kind: "status", title: "Status", created: "9", updated: "2026-01-02T00:00:00Z" })]);
  assert.equal(P.guideList(S, false).map((g) => g.id).join(" "), "st g1 g2 g4");
  const st = S[S.length - 1];
  assert.equal(P.guideChanged(st, {}), true);
  assert.equal(P.guideChanged(st, { st: "2026-01-02T00:00:00Z" }), false);
  assert.equal(P.guideChanged(st, { st: "2026-01-01T00:00:00Z" }), true);
  assert.equal(P.guideChanged(G[0], {}), false, "only a status guide gets the marker");
});
ok("a guide shows its sections, or its body as one section", () => {
  const g = P.coerce("guide", { id: "x", body: "old", sections: [{ id: "a", title: "A", body: "one", updated: "t" }, 5, { id: "b", body: { toString: null } }] });
  assert.deepEqual(plain(P.guideSections(g)), [{ id: "a", title: "A", body: "one", updated: "t" }, { id: "b", title: "", body: "", updated: "" }]);
  assert.deepEqual(plain(P.guideSections(P.coerce("guide", { id: "y", body: "only" }))), [{ id: "", title: "", body: "only", updated: "" }]);
});
