// The cards collection: one document, cards/main; keys, the Done section and the empty text.
// Run: node cards-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pageFile, load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
// The cards document as the page reads it: through coerce, then cardsOf; the items map is keyed by the card id.
const put = (o) => { const m = P.cardsOf(P.coerce("cards", o)); P.items.clear(); m.forEach((v, k) => P.items.set(k, v)); return m; };

ok("cardsOf: one document; the key is the card id; bad ids and repeats are left out", () => {
  const m = P.cardsOf(P.coerce("cards", { cards: [{ id: "disk", title: "first" }, { id: "disk", title: "again" }, { id: ".." }, { id: "" }, { id: "b:c" }] }));
  assert.deepEqual(Array.from(m.keys()), ["disk", "b:c"]);
  assert.equal(m.get("disk").title, "first", "the first disk wins");
  assert.deepEqual(["cid", "agent"].map((k) => k in m.get("disk")), [false, false]);
  assert.equal(P.cardsOf(undefined).size, 0);
});
ok("Done holds the cards with a sent answer and the closed cards; a changed or unsent card stays out", () => {
  put({ cards: [{ id: "open" }, { id: "sent" }, { id: "closed", status: "closed" }, { id: "changed", rev: 2 }, { id: "unsent" }] });
  P.resp.clear();
  P.resp.set("sent", { choice: "Yes", sent: true });
  P.resp.set("changed", { choice: "Yes", sent: true, rev: 1 });
  P.resp.set("unsent", { choice: "Yes", sent: false });
  assert.deepEqual(plain(P.sortedItems().filter(P.isDone).map((it) => it.id).sort()), ["closed", "sent"]);
  assert.deepEqual(plain(P.sortedItems().filter(P.isActive).map((it) => it.id).sort()), ["changed", "open", "unsent"]);
  P.resp.clear();
});
ok("the empty text: no cards, all answered with the Done count, or an empty tab", () => {
  assert.equal(P.emptyText(0, 0, 0), "No cards yet. Agents add cards to this board, and they appear here without a reload.");
  assert.equal(P.emptyText(5, 0, 3), "All answered. 3 in Done.");
  assert.equal(P.emptyText(5, 0, 0), "No cards in this tab.");
  assert.equal(P.emptyText(5, 2, 3), "");
});
ok("Refreshed <time> from the refreshed of cards/main", () => {
  const t = (x) => "T" + x.slice(11, 16);
  assert.equal(P.refreshedText(P.coerce("cards", { cards: [], refreshed: "2026-02-01T12:00:00+00:00" }), t), "Refreshed T12:00");
  assert.equal(P.refreshedText(P.coerce("cards", { cards: [] }), t), "");
  assert.equal(P.refreshedText(undefined, t), "");
  assert.ok(fs.readFileSync(pageFile, "utf8").includes("refreshedText(cardDocs.get(SCHEMA.cardsDoc), fmt)"));
});
ok("the page reads the cards collection, folds Done at the end of the cards, and counts it", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  assert.match(src, /var COLS = \[\["cards", cardDocs\],/);
  assert.ok(!/\["items", items\]|collection\("items"\)/.test(src), "the items collection is no longer read");
  assert.match(src, /<div id="cards"><\/div>\s*<div id="empty" class="empty" hidden><\/div>\s*<details id="done" class="donebox" hidden><summary id="donesum">Done<\/summary><div id="donelist"><\/div><\/details>/);
  assert.ok(src.includes('$("donesum").textContent = "Done (" + done.length + ")";') && src.includes('placeCards($("donelist"), done);'));
  assert.ok(src.includes('if (isDone(it)) $("done").open = true;'), "a tap on a card in Done unfolds it");
});
