// "Blocked on you", kinds and priorities. Run: node blocked-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
[
  { id: "a", title: "later action", priority: "later", blocks: "mail filters", kind: "action", status: "open", area: "gmail", created: "1" },
  { id: "b", title: "now decision", priority: "now", blocks: "backfill", status: "open", area: "vm", created: "2" },
  { id: "c", title: "no blocks", priority: "now", status: "open", area: "vm", created: "3" },
  { id: "d", title: "blank blocks", priority: "now", blocks: "   ", kind: "action", status: "open", area: "vm", created: "4" },
  { id: "e", title: "closed blocker", priority: "now", blocks: "x", status: "closed", area: "vm", created: "5" },
  { id: "f", title: "sent blocker", priority: "soon", blocks: "y", status: "open", area: "github", created: "6" },
  { id: "g", title: "soon action", priority: "soon", blocks: "phone proof", kind: "action", status: "open", area: "github", created: "7" },
  { id: "h", title: "bad kind", priority: "soon", blocks: "z", kind: "weird", status: "open", area: "vm", created: "8" },
].forEach((i) => P.items.set(i.id, i));
P.resp.set("f", { sent: true, choice: "x" });
const show = () => P.blockedList(P.sortedItems(), P.shownByRules).map((i) => i.id + ":" + i.priority + ":" + P.kindOf(i)).join(" ");

ok("default: most urgent first, closed and sent hidden, blank blocks ignored", () => {
  assert.equal(show(), "b:now:decision g:soon:action h:soon:decision a:later:action");
});
ok("show closed adds the closed blocker", () => {
  P.f.closed = true; assert.equal(show(), "b:now:decision e:now:decision g:soon:action h:soon:decision a:later:action"); P.f.closed = false;
});
ok("hide answered off adds the sent blocker", () => {
  P.f.hide = false; assert.equal(show(), "b:now:decision f:soon:decision g:soon:action h:soon:decision a:later:action"); P.f.hide = true;
});
ok("config kinds and priorities: order, default kind, labels, colour classes", () => {
  P.applyConfig({ kinds: [{ id: "info", label: "Info" }, { id: "action", label: "Do it" }],
    priorities: [{ id: "later", label: "Later" }, { id: "now", label: "Now" }, { id: "p4", label: "P4" }, { id: "soon" }] });
  assert.equal(show(), "a:later:action b:now:info g:soon:action h:soon:info");
  assert.ok(P.isDefaultKind("info") && !P.isDefaultKind("action"));
  assert.equal(P.kindLabel("action"), "Do it");
  assert.deepEqual(["later", "now", "p4", "soon", "zz"].map(P.priClass), ["now", "soon", "later", "", ""]);
  assert.deepEqual(["soon", "zz", undefined].map(P.priLabel), ["soon", "zz", "none"]);
  assert.deepEqual(JSON.parse(JSON.stringify(P.prioOptions())), [["", "All"], ["later", "Later"], ["now", "Now"], ["p4", "P4"], ["soon", "soon"]]);
  P.applyConfig(null);
});
ok("an empty board lists nothing", () => { P.items.clear(); assert.equal(show(), ""); });
