// Revisions, answer history and batches. Run: node revisions-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));

ok("rev: only a whole number counts; missing or bad counts as 1", () => {
  assert.deepEqual([{}, { rev: 3 }, { rev: "2" }, { rev: 0 }, { rev: "x" }, null].map(P.revOf), [1, 3, 2, 1, 1, 1]);
  assert.deepEqual([{ rev: "0x10" }, { rev: [5] }, { rev: "1e1" }, { rev: 2.9 }, { rev: " 3 " }, { rev: true }, { rev: -1 }].map(P.revOf), [1, 1, 1, 1, 1, 1, 1]);
});
ok("a card is changed only when its rev is newer than the answered rev", () => {
  P.resp.set("a", { choice: "Yes", sent: true });
  assert.equal(P.isChanged({ id: "a" }), false);
  assert.equal(P.isChanged({ id: "a", rev: 2 }), true);
  P.resp.set("a", { choice: "Yes", sent: true, rev: 2 });
  assert.equal(P.isChanged({ id: "a", rev: 2 }), false);
  assert.equal(P.isChanged({ id: "none", rev: 5 }), false);
  P.resp.set("e", { choice: "", note: "", sent: true });
  assert.equal(P.isChanged({ id: "e", rev: 2 }), false);
});
ok("a changed card leaves Done; a closed one stays there", () => {
  P.resp.set("s", { choice: "Yes", sent: true });
  assert.equal(P.isDone({ id: "s", status: "open" }), true);
  assert.equal(P.isDone({ id: "s", status: "open", rev: 2 }), false);
  assert.equal(P.isDone({ id: "s", status: "answered", rev: 2 }), false);
  assert.equal(P.isDone({ id: "s", status: "closed", rev: 2 }), true);
});
ok("a new answer after a send keeps the sent one in history", () => {
  const sent = { itemId: "a", choice: "Yes", note: "", rev: 1, updated: "t1", sent: true, batch: "b1" };
  const d1 = P.nextResponse(sent, "a", "No", "", 2, "t2");
  assert.deepEqual(plain(d1), { itemId: "a", choice: "No", note: "", rev: 2, updated: "t2", sent: false, batch: "",
    history: [{ choice: "Yes", note: "", rev: 1, updated: "t1", batch: "b1" }] });
  const d2 = P.nextResponse(d1, "a", "No", "typing", 2, "t3");
  assert.equal(d2.history.length, 1, "an unsent draft is replaced, not stacked");
  const d3 = P.nextResponse(Object.assign({}, d2, { sent: true, batch: "b2" }), "a", "Maybe", "", 3, "t4");
  assert.deepEqual(plain(d3.history).map((x) => x.batch), ["b1", "b2"]);
  assert.equal(P.nextResponse(null, "z", "Yes", "", 1, "t").history, undefined);
  const old = P.nextResponse({ choice: "Yes", sent: true }, "o", "No", "", 1, "t");
  assert.equal(old.history[0].rev, 1, "an old response without rev records rev 1");
});
