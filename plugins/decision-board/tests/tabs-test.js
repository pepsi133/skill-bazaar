// Tab and guide checks. Run: node tabs-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
const items = [
  { id: "a", source: "gmail", status: "open" },
  { id: "b", source: "github", status: "open" },
  { id: "c", source: "email", tags: ["cost"], status: "open" },
  { id: "d", source: "vm", tags: ["sec"], status: "open" },
  { id: "e", source: "GitHub ", tags: ["cost"], status: "open" },
  { id: "f", source: "other", status: "open" },
  { id: "g", source: "github", status: "closed" },
  { id: "h", source: "bogus", status: "open" }];
const tabsOf = () => items.map((i) => i.id + ":" + P.tabOf(i, P.cfg.tabs)).join(" ");
P.resp.set("c", { sent: true, choice: "x" });

ok("without meta/config there is only the All tab", () => {
  P.applyConfig(null);
  assert.deepEqual(plain(P.cfg.tabs), []);
  assert.equal(tabsOf(), "a: b: c: d: e: f: g: h:");
});
ok("tabs match by source (trim, lower case) first, then by tag (exact), then the rest tab; counts leave out Done", () => {
  P.applyConfig({ tabs: [{ id: "cost", label: "Costs", match: { tags: ["cost"] } }, { id: "code", label: "Code", match: { source: ["github"] } },
    { id: "net", label: "Network", match: { source: ["vm", "gmail"], tags: ["Sec"] } }, { id: "rest", label: "Rest", rest: true }] });
  assert.equal(tabsOf(), "a:net b:code c:cost d:net e:code f:rest g:code h:rest");
  assert.deepEqual({ ...P.tabCounts(items, P.isActive) }, { all: 6, cost: 0, code: 2, net: 2, rest: 2 });
  assert.ok(P.inTab(items[1], "code") && !P.inTab(items[1], "net") && P.inTab(items[1], "all"));
  P.applyConfig({ tabs: [{ id: "x", match: { tags: ["cost"] } }] });
  assert.equal(P.tabOf({ tags: ["Cost"] }, P.cfg.tabs), "", "a tag matches by its exact id; no rest tab leaves a card under All only");
});
ok("bad config entries are dropped, not fatal; match keeps only source and tags", () => {
  P.applyConfig({ tabs: [{ id: "all" }, { id: "guide:x" }, { label: "no id" }, { id: "ok", match: { from: ["a"], area: ["x"], kind: ["action"], source: ["", 3, " s "] } }, { id: "ok" }],
    kinds: [{ id: "task" }], priorities: [{}], labels: [1] });
  assert.deepEqual(plain(P.cfg.tabs), [{ id: "ok", label: "ok", match: { source: ["s"] }, rest: false }]);
  assert.deepEqual(plain(P.cfg.kinds.map((k) => k.id)), ["decision", "action", "info"], "the kinds are fixed; a config cannot change them");
  assert.deepEqual(plain(P.cfg.priorities.map((k) => k.id)), ["now", "soon", "later"]);
  assert.equal("labels" in P.cfg, false);
  P.applyConfig({ tabs: [{ id: "all" }, 7] });
  assert.deepEqual(plain(P.cfg.tabs), [], "a tabs list with only invalid entries keeps the default, All only");
  P.applyConfig(null);
});
ok("config keys __proto__ and constructor are data, not object internals", () => {
  P.applyConfig(JSON.parse('{"tabs":[{"id":"t","match":{"__proto__":["x"],"constructor":["y"],"source":["a"]}},{"id":"constructor","rest":true}],' +
    '"priorities":[{"id":"__proto__"},{"id":"toString"}]}'));
  assert.deepEqual(Object.keys(P.cfg.tabs[0].match), ["source"]);
  assert.equal(Object.getPrototypeOf(P.cfg.tabs[0].match), null);
  assert.equal(P.tabOf({ constructor: "y", source: "b" }, P.cfg.tabs), "constructor");
  assert.equal(P.tabOf({ source: "A " }, P.cfg.tabs), "t");
  assert.equal(P.priRank("toString"), 1);
  assert.equal(P.priRank("valueOf"), 99);
  P.applyConfig(null);
});
ok("config lists stop at 50 entries", () => {
  P.applyConfig({ tabs: Array.from({ length: 500 }, (_, i) => ({ id: "t" + i, match: { source: Array.from({ length: 80 }, (_, j) => "a" + j) } })),
    priorities: Array.from({ length: 70 }, (_, i) => ({ id: "p" + i })) });
  assert.equal(P.cfg.tabs.length, 50);
  assert.equal(P.cfg.tabs[0].match.source.length, 50);
  assert.equal(P.cfg.priorities.length, 50);
  P.applyConfig(null);
});
ok("agent keys ignore case and spaces; an empty name is the configured agent", () => {
  P.applyConfig({ agent: "Coordinator" });
  assert.deepEqual(["Agent-B", " agent-b ", "COORDINATOR", "", 5].map(P.agentKey), ["agent-b", "agent-b", "coordinator", "coordinator", "coordinator"]);
  assert.deepEqual(["coordinator", "agent-b"].map(P.agentName), ["Coordinator", "agent-b"]);
  P.applyConfig(null);
  assert.equal(P.agentKey(""), "claude");
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
ok("one status guide per agent: the newest of each agent; with several, each tab names its agent", () => {
  P.applyConfig({ agent: "Coordinator" });
  const gs = [{ id: "coordinator.status", kind: "status", title: "Status", updated: "2", created: "1" }, { id: "coordinator.status-old", kind: "status", title: "Old", updated: "1", created: "0" },
    { id: "net-agent.status", kind: "status", title: "Status", updated: "3", created: "2" }, { id: "coordinator.howto", kind: "text", title: "How to", created: "5" }].map((g) => P.coerce("guide", g));
  const list = P.guideList(gs, false);
  assert.deepEqual(plain(list.map((g) => g.id)), ["coordinator.status", "net-agent.status", "coordinator.howto"]);
  assert.deepEqual(plain(list.map((g) => P.guideLabel(g, 2))), ["Status · Coordinator", "Status · net-agent", "How to"]);
  assert.equal(P.guideLabel(list[0], 1), "Status", "one status guide needs no agent name");
  P.applyConfig(null);
});
