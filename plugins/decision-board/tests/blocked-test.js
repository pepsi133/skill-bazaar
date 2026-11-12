// "Blocked on you", kinds and priorities. Run: node blocked-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
[
  { id: "a", title: "later action", priority: "later", blocks: "mail filters", kind: "action", status: "open", created: "1" },
  { id: "b", title: "now decision", priority: "now", blocks: "backfill", status: "open", created: "2" },
  { id: "c", title: "no blocks", priority: "now", status: "open", created: "3" },
  { id: "d", title: "blank blocks", priority: "now", blocks: "   ", kind: "action", status: "open", created: "4" },
  { id: "e", title: "closed blocker", priority: "now", blocks: "x", status: "closed", created: "5" },
  { id: "f", title: "sent blocker", priority: "soon", blocks: "y", status: "open", created: "6" },
  { id: "g", title: "soon action", priority: "soon", blocks: "phone proof", kind: "action", status: "open", created: "7" },
  { id: "h", title: "bad kind", priority: "soon", blocks: "z", kind: "weird", status: "open", created: "8" },
].forEach((i) => P.items.set(i.id, i));
P.resp.set("f", { sent: true, choice: "x" });
const show = () => P.blockedList(P.sortedItems()).map((i) => i.id + ":" + i.priority + ":" + P.kindOf(i)).join(" ");

ok("most urgent first; closed and sent cards are in Done, not blocked; blank blocks ignored", () => {
  assert.equal(show(), "b:now:decision g:soon:action h:soon:decision a:later:action");
});
ok("a changed answer brings the card back", () => {
  P.items.get("f").rev = 2;
  assert.equal(show(), "b:now:decision f:soon:decision g:soon:action h:soon:decision a:later:action");
  delete P.items.get("f").rev;
});
ok("config priorities: order, labels, colour classes; the kinds stay fixed", () => {
  P.applyConfig({ kinds: [{ id: "info", label: "Info" }], priorities: [{ id: "later", label: "Later" }, { id: "now", label: "Now" }, { id: "p4", label: "P4" }, { id: "soon" }] });
  assert.equal(show(), "a:later:action b:now:decision g:soon:action h:soon:decision");
  assert.ok(P.isDefaultKind("decision") && !P.isDefaultKind("info"));
  assert.equal(P.kindLabel("action"), "Action");
  assert.deepEqual(["later", "now", "p4", "soon", "zz"].map(P.priClass), ["now", "soon", "later", "", ""]);
  assert.deepEqual(["soon", "zz", undefined].map(P.priLabel), ["soon", "zz", "none"]);
  P.applyConfig(null);
});
ok("an empty board lists nothing", () => { P.items.clear(); assert.equal(show(), ""); });
