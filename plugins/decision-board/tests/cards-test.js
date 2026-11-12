// The cards collection: one document per agent, merged by the page; keys, the Done section and the empty text.
// Run: node cards-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pageFile, load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
// The documents as the page reads them: every document through coerce, keyed by its id.
const docs = (o) => new Map(Object.entries(o).map(([id, d]) => [id, P.coerce("cards", d)]));
const merge = (o) => { const m = P.mergeCards(docs(o)); P.items.clear(); m.forEach((v, k) => P.items.set(k, v)); return m; };

ok("two agent documents merge into one list; the key is <agent>:<card id>; the document is the agent", () => {
  const m = merge({ coordinator: { cards: [{ id: "disk", title: "Disk?", rev: 2 }, { id: "dns", title: "DNS?" }] }, "net-agent": { cards: [{ id: "vlan", title: "VLAN?", from: "someone-else" }] } });
  assert.deepEqual(Array.from(m.keys()), ["coordinator:disk", "coordinator:dns", "net-agent:vlan"]);
  assert.deepEqual(plain(["id", "cid", "agent", "title", "rev"].map((k) => m.get("coordinator:disk")[k])), ["coordinator:disk", "disk", "coordinator", "Disk?", 2]);
  assert.deepEqual([m.get("net-agent:vlan").agent, "from" in m.get("net-agent:vlan")], ["net-agent", false], "a card cannot name another agent");
});
ok("key collisions: the same card id under two agents is two cards with their own answers", () => {
  const m = merge({ a: { cards: [{ id: "x", title: "A's x" }] }, b: { cards: [{ id: "x", title: "B's x" }] } });
  assert.deepEqual([m.get("a:x").title, m.get("b:x").title], ["A's x", "B's x"]);
  P.resp.clear();
  P.resp.set("a:x", Object.assign(P.coerce("response", { choice: "Yes" }), { itemId: "a:x", for: "a" }));
  assert.deepEqual([P.stateOf(m.get("a:x")), P.stateOf(m.get("b:x"))], ["unsent", "open"]);
  assert.deepEqual(plain(P.splitByAgent(P.sendable()).map((g) => [g.for, g.r.map((r) => r.itemId)])), [["a", ["a:x"]]]);
  P.resp.clear();
});
ok("key collisions: an agent key has no ':', so 'a:b' + 'c' cannot meet 'a' + 'b:c'; bad ids and repeats are left out", () => {
  const m = merge({ "a:b": { cards: [{ id: "c", title: "forged" }] }, a: { cards: [{ id: "b:c", title: "real" }, { id: "b:c", title: "again" }, { id: "..", title: "dots" }, { id: "", title: "none" }] },
    "Upper": { cards: [{ id: "u" }] }, ["x".repeat(41)]: { cards: [{ id: "long" }] }, ok: { cards: "not a list" } });
  assert.deepEqual(Array.from(m.keys()), ["a:b:c"]);
  assert.equal(m.get("a:b:c").title, "real");
  assert.deepEqual(["claude", "net-agent", "a.b", "a:b", "A", "", ".", "x".repeat(41)].map((k) => P.SCHEMA.agentRe.test(k)), [true, true, false, false, false, false, false, false]);
});
ok("Done holds the cards with a sent answer and the closed cards; a changed or unsent card stays out", () => {
  merge({ c: { cards: [{ id: "open" }, { id: "sent" }, { id: "closed", status: "closed" }, { id: "changed", rev: 2 }, { id: "unsent" }] } });
  P.resp.clear();
  P.resp.set("c:sent", { choice: "Yes", sent: true });
  P.resp.set("c:changed", { choice: "Yes", sent: true, rev: 1 });
  P.resp.set("c:unsent", { choice: "Yes", sent: false });
  assert.deepEqual(plain(P.sortedItems().filter(P.isDone).map((it) => it.cid).sort()), ["closed", "sent"]);
  assert.deepEqual(plain(P.sortedItems().filter(P.isActive).map((it) => it.cid).sort()), ["changed", "open", "unsent"]);
  P.resp.clear();
});
ok("the empty text: no cards, all answered with the Done count, or an empty tab", () => {
  assert.equal(P.emptyText(0, 0, 0), "No cards yet. Agents add cards to this board, and they appear here without a reload.");
  assert.equal(P.emptyText(5, 0, 3), "All answered. 3 in Done.");
  assert.equal(P.emptyText(5, 0, 0), "No cards in this tab.");
  assert.equal(P.emptyText(5, 2, 3), "");
});
ok("Refreshed <time> per agent from the refreshed of each document; one agent shows the time alone", () => {
  P.applyConfig({ agent: "Coordinator" });
  const t = (x) => "T" + x.slice(11, 16);
  assert.equal(P.refreshedText(docs({ coordinator: { cards: [], refreshed: "2026-02-01T12:00:00Z" } }), t), "Refreshed T12:00");
  assert.equal(P.refreshedText(docs({ coordinator: { cards: [], refreshed: "2026-02-01T12:00:00Z" }, "net-agent": { cards: [], refreshed: "2026-02-01T09:30:00Z" }, "Bad Key": { cards: [], refreshed: "x" } }), t),
    "Refreshed Coordinator T12:00, net-agent T09:30");
  assert.equal(P.refreshedText(docs({ a: { cards: [] } }), t), "");
  P.applyConfig(null);
  assert.ok(require("node:fs").readFileSync(pageFile, "utf8").includes('$("refreshed").textContent = refreshedText(cardDocs, fmt);'));
});
ok("the page reads the cards collection, folds Done at the end of the cards, and counts it", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  assert.match(src, /var COLS = \[\["cards", cardDocs\],/);
  assert.ok(!/\["items", items\]|collection\("items"\)/.test(src), "the items collection is no longer read");
  assert.match(src, /<div id="cards"><\/div>\s*<div id="empty" class="empty" hidden><\/div>\s*<details id="done" class="donebox" hidden><summary id="donesum">Done<\/summary><div id="donelist"><\/div><\/details>/);
  assert.ok(src.includes('$("donesum").textContent = "Done (" + done.length + ")";') && src.includes('placeCards($("donelist"), done);'));
  assert.ok(src.includes('if (isDone(it)) $("done").open = true;'), "a tap on a card in Done unfolds it");
});
