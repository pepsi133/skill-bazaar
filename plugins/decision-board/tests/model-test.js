// Schema, card states, what Send takes, and the batch it writes. Run: node model-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
// A card as the page holds it after the merge: coerced, with the agent of its document.
const item = (id, x) => Object.assign(P.coerce("item", Object.assign({ id, title: "Q " + id, options: ["Yes", "No"], status: "open" }, x || {})), x && x.agent ? { agent: x.agent } : {});
const response = (id, x) => Object.assign(P.coerce("response", Object.assign({ choice: "Yes", sent: false }, x || {})), { itemId: id });
function board(list, responses, noteList) {
  P.items.clear(); P.resp.clear(); P.notes.clear();
  list.forEach((it) => P.items.set(it.id, it));
  Object.entries(responses || {}).forEach(([id, r]) => P.resp.set(id, response(id, r)));
  (noteList || []).forEach((n) => P.notes.set(n.id, P.coerce("note", n)));
}

ok("coerce: a value of the wrong type becomes the empty value of its type", () => {
  const x = P.coerce("item", { id: "a", title: { toString: null }, options: ["a", 5, null, "b"], rev: "0x10", blocks: ["x"], extra: 1, area: "x" });
  assert.equal(x.title, ""); assert.deepEqual(plain(x.options), ["a", "b"]); assert.equal(x.rev, 1); assert.equal(x.blocks, ""); assert.equal("extra" in x, false); assert.equal("area" in x, false);
  assert.equal("options" in P.coerce("item", { id: "b" }), false, "absent options stay absent, so the kind defaults apply");
  const b = P.coerce("batch", { itemIds: "notarray", noteIds: [1, "n1"], answers: { a: { answer: 5 }, b: "x" } });
  assert.deepEqual(plain(b.itemIds), []); assert.deepEqual(plain(b.noteIds), ["n1"]);
  assert.deepEqual(plain(b.answers), { a: { answer: "", note: "", rev: 1 } });
  assert.deepEqual(plain(P.coerce("response", null).history), []);
  assert.equal(P.coerce("response", { for: 5 }).for, undefined);
});
ok("problems: the strict check names unknown fields, wrong types and long text", () => {
  assert.deepEqual(plain(P.problems("item", { id: "a", title: "ok", rev: 2, options: ["x"] })), []);
  assert.deepEqual(plain(P.problems("item", { recomendation: "x", rev: "2", options: "x", title: "t".repeat(301) })),
    ["recomendation: unknown field", "rev: not a whole number", "options: not a list of short texts", "title: longer than 300"]);
  assert.deepEqual(plain(P.problems("guide", { sections: [{ id: "a", body: 1 }] })), ["sections[0].body: not text"]);
});
ok("default options per kind: action and info have them, a card's own list wins", () => {
  assert.deepEqual(plain(P.optionsOf(P.coerce("item", { kind: "action" }))), ["Done", "Done in part, see note", "Later", "Other, see note"]);
  assert.deepEqual(plain(P.optionsOf(P.coerce("item", { kind: "info" }))), ["Acknowledge"]);
  assert.deepEqual(plain(P.optionsOf(P.coerce("item", { kind: "decision" }))), []);
  assert.deepEqual(plain(P.optionsOf(P.coerce("item", { kind: "action", options: [] }))), []);
});
ok("states: open, unsent, sent, waiting on agent, changed, closed; counts come from the data", () => {
  board([item("o"), item("u"), item("s"), item("q"), item("c", { rev: 2 }), item("x", { status: "closed" }), item("n", { options: [] }), item("a", { status: "answered" })],
    { u: {}, s: { sent: true }, q: { choice: "", note: "why?", sent: true }, c: { sent: true, rev: 1 }, n: { choice: "", note: "fine", sent: true } });
  assert.deepEqual(plain(["o", "u", "s", "q", "c", "x", "n", "a"].map((id) => P.stateOf(P.items.get(id)))),
    ["open", "unsent", "sent", "waiting", "changed", "closed", "sent", "open"], "answered is no status any more");
  assert.deepEqual(plain(["o", "u", "s", "q", "c", "x", "n", "a"].map((id) => P.isDone(P.items.get(id)))), [false, false, true, false, false, true, true, false]);
  assert.equal(P.openCount(), 3);
  assert.equal(P.unsentCount(), 1);
});
ok("Send takes only answers of cards that exist, are not closed and did not change after the draft", () => {
  board([item("ok"), item("closed", { status: "closed" }), item("newer", { rev: 3 }), item("same", { rev: 2 })],
    { ok: {}, closed: {}, ghost: {}, newer: { rev: 2 }, same: { rev: 2 }, empty: { choice: "" } },
    [{ id: "n1", text: "hi", sent: false }, { id: "n2", text: "", sent: false }, { id: "n3", text: "old", sent: true }]);
  const s = P.sendable();
  assert.deepEqual(plain(s.r.map((x) => x.itemId).sort()), ["ok", "same"]);
  assert.deepEqual(plain(s.n.map((x) => x.id)), ["n1"]);
  assert.equal(P.stateOf(P.items.get("newer")), "changed");
});
ok("answers route by the agent saved in the response, not by the card's from at send time; empty is the config agent", () => {
  board([item("a", { agent: "agent-evil" }), item("b", { agent: "agent-b" }), item("c"), item("d", { agent: "agent-b" })],
    { a: { for: "agent-a" }, b: {}, c: { for: "" }, d: { for: "AGENT-B " } },
    [{ id: "n1", text: "about d", item: "d", for: "agent-b" }, { id: "n2", text: "free" }]);
  const g = P.splitByAgent(P.sendable()).map((x) => [x.for, x.r.map((r) => r.itemId).sort(), x.n.map((n) => n.id)]);
  assert.deepEqual(plain(g).sort(), [["agent-a", ["a"], []], ["agent-b", ["b", "d"], ["n1"]], ["claude", ["c"], ["n2"]]]);
});
ok("the batch carries a copy of the answers and notes", () => {
  const gp = { for: "agent-b", r: [response("x", { choice: "No", note: "n", rev: 2 })], n: [P.coerce("note", { id: "n1", text: "hi", item: "x" })] };
  assert.deepEqual(plain(P.batchDoc("b1", "t", gp)), { id: "b1", created: "t", for: "agent-b", itemIds: ["x"], noteIds: ["n1"],
    answers: { x: { answer: "No", note: "n", rev: 2 } }, notes: { n1: { text: "hi", item: "x" } }, status: "new" });
  const odd = P.batchDoc("b2", "t", { for: "", r: [response("__proto__")], n: [] });
  assert.deepEqual(plain(Object.keys(odd.answers)), ["__proto__"]);
});
ok("a newer copy wins over a stale read; a tie keeps the database copy", () => {
  const db = { updated: "2026-01-01T10:00:00.000Z" }, mine = { updated: "2026-01-01T10:00:01.000Z" };
  assert.equal(P.newerDoc(db, mine), mine);
  assert.equal(P.newerDoc(mine, db), mine);
  assert.equal(P.newerDoc(db, { updated: db.updated }), db);
  assert.equal(P.newerDoc(undefined, mine), mine);
  assert.equal(P.newerDoc(db, undefined), db);
});
ok("a batch is handled when an ack exists, or when an old batch says done or delivered", () => {
  const acks = new Map([["b1", {}]]);
  assert.deepEqual(plain([{ id: "b1", status: "new" }, { id: "b2", status: "new" }, { id: "b3", status: "done" }, { id: "b4", status: "delivered" }].map((b) => P.isHandled(b, acks))),
    [true, false, true, true]);
});
