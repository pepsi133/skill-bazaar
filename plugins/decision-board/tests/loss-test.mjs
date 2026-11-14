// Tests of skills/decision-board/scripts/board.mjs for the cases where a write could drop a card, a close or an
// answer without a message, against the fixtures and the stand-in database of fakedb.mjs. Run: node loss-test.mjs.
// Exits 1 if a check fails. Temporary files go under the system temp directory (TMPDIR).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../skills/decision-board/scripts/board.mjs";
import { applyBatch, dump, readDb, writesOf } from "./fakedb.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, "fixtures");
const SELF = path.relative(process.cwd(), path.join(here, "..", "skills", "decision-board", "scripts", "board.mjs"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loss-test-"));
let n = 0, failed = 0;
function ok(name, fn) {
  n++;
  try { fn(); console.log("ok " + n + " " + name); } catch (e) { failed++; console.log("not ok " + n + " " + name + "\n  " + String(e.message).split("\n")[0]); }
}
function fresh(withState = true) {
  const d = fs.mkdtempSync(path.join(tmp, "b-")), state = path.join(d, "board", "state.json"), db = path.join(d, "db");
  fs.cpSync(path.join(FIX, "dump"), db, { recursive: true });
  fs.mkdirSync(path.dirname(state));
  const config = JSON.parse(fs.readFileSync(path.join(FIX, "config.json"), "utf8"));
  config.tz = "UTC";
  fs.writeFileSync(path.join(d, "board", "config.json"), JSON.stringify(config, null, 1) + "\n");
  if (withState) fs.copyFileSync(path.join(FIX, "state.json"), state);
  return { db, state, board: path.dirname(state), dump: path.join(d, "board", "dump") };
}
function sh(...argv) { const lines = []; const code = run(argv, (l) => lines.push(...String(l).split("\n"))); return { code, lines, text: lines.join("\n") }; }
const cmd = (b, ...argv) => sh(...argv, "--state", b.state);
// A dump as an agent makes it: the data-only files, and the reply lines saved to versions.txt.
function dumpNow(b) { const lines = dump(b.db, b.dump); fs.mkdirSync(b.dump, { recursive: true }); fs.writeFileSync(path.join(b.dump, "versions.txt"), lines.join("\n") + "\n"); return b.dump; }
const dumped = (b, ...argv) => cmd(b, ...argv, "--dump", dumpNow(b));
// A dump whose calls succeeded: read and adopt take --dumped.
const ok2 = (b, ...argv) => cmd(b, ...argv, "--dump", dumpNow(b), "--dumped");
function apply(b, r) { const ws = writesOf(r.lines); ws.forEach((w) => applyBatch(b.db, w)); return ws.flat(); }
const doc = (b, c, id) => { const d = readDb(b.db).get(c); return d && d.get(id); };
const card = (b, id) => JSON.parse(fs.readFileSync(b.state, "utf8")).cards.find((c) => c.id === id);
const edit = (f, fn) => { const raw = JSON.parse(fs.readFileSync(f, "utf8")); fn(raw); fs.writeFileSync(f, JSON.stringify(raw)); };
const NEED = { links: [{ label: "Notes", url: "https://wiki.example.com/notes" }], first_asked: { date: "2026-01-15", who: "infra-agent" }, options: ["Yes", "No"] };
const yn = (id, x) => Object.assign({}, NEED, { id, title: id + "?" }, x);
const sync = (b, list, ...more) => { const f = path.join(tmp, "c" + Math.random().toString(36).slice(2) + ".json"); fs.writeFileSync(f, JSON.stringify(list)); return cmd(b, "sync", f, ...more); };
const ACKED = "b20260103T000000+0000-bbbb";
// The line sync, close and ack print for a pending ack that changed cards when they write no cards themselves.
// The note for an ack the board holds as handled whose cards are owed (no batch update stored).
const cardsNote = (b, id = ACKED) => `note: the cards of ack ${id} are not on the board: node ${SELF} push batches/${id} --state ${JSON.stringify(b.state)}`;
const ackNote = (b, id = ACKED) => `note: ack ${id} changed cards. If its batch call was refused or its reply lost: node ${SELF} push batches/${id} --state ${JSON.stringify(b.state)}; else do nothing`;
process.env.BOARD_NOW = "2026-02-01T12:00:00Z";
process.env.BOARD_USER_CONFIG = "";

ok("out files are named by a hash of their content, so a later write never changes the file an earlier array points at", () => {
  const b = fresh();
  const w1 = writesOf(sync(b, [yn("a")]).lines).flat()[0], body = fs.readFileSync(w1.file_path, "utf8");
  assert.match(path.basename(w1.file_path), /^main\.[0-9a-f]{8}\.json$/);
  assert.equal(path.basename(w1.file_path).split(".")[1], createHash("sha256").update(body).digest("hex").slice(0, 8));
  const w2 = writesOf(sync(b, [yn("a"), yn("b")]).lines).flat()[0];
  assert.notEqual(w2.file_path, w1.file_path);
  assert.ok(!fs.existsSync(w1.file_path) || fs.readFileSync(w1.file_path, "utf8") === body, "the earlier file is gone or unchanged");
});
ok("check refuses a second state file in one folder and names the first", () => {
  const b = fresh(), two = Object.assign({}, b, { state: path.join(b.board, "state-2.json") });
  const r = cmd(two, "check");
  assert.deepEqual([r.code, r.lines[0]], [1, `check: ${b.state} is already a state file in this folder. One state file per board folder: use it, or another folder`]);
  assert.equal(fs.existsSync(two.state), false);
});
ok("purge: a refused purge is pending as purge/<stamp>; adopt prints its deletes again", () => {
  const b = fresh();
  edit(path.join(b.db, "cards", "main.json"), (raw) => { raw.version = 9; });
  const r = dumped(b, "purge", "--ids", "old-dns"), key = (/^(purge\/\S+):/.exec(r.lines[0]) || [])[1];
  assert.ok(key, r.lines[0]);
  assert.throws(() => apply(b, r), /now at version 9/);
  assert.equal(dumped(b, "purge", "--ids", "disk-size").code, 1, "a new purge waits until the earlier one landed");
  const ad = ok2(b, "adopt", key);
  assert.equal(ad.code, 0, ad.text);
  apply(b, ad);
  apply(b, ok2(b, "adopt"));
  assert.deepEqual([doc(b, "responses", "old-dns"), doc(b, "cards", "main").data.cards.map((c) => c.id)], [undefined, ["disk-size"]]);
  assert.deepEqual(ok2(b, "adopt", key).lines, [`${key}: the board holds the purge`, "no writes"]);
});
ok("purge: an answer changed after the dump stops adopt, names the card, and keeps the card on the board", () => {
  const b = fresh();
  const r = dumped(b, "purge", "--ids", "old-dns");
  edit(path.join(b.db, "responses", "old-dns.json"), (raw) => { raw.version += 1; raw.data.note = "Wait, keep it"; });
  assert.throws(() => apply(b, r), /version_mismatch/);
  const stop = ok2(b, "adopt");
  assert.equal(stop.code, 1, stop.text);
  assert.match(stop.lines[0], /^adopt: the answer to old-dns changed after the purge/);
  assert.deepEqual(writesOf(stop.lines), []);
  apply(b, ok2(b, "adopt"));
  assert.ok(doc(b, "cards", "main").data.cards.some((c) => c.id === "old-dns"), "the card stays on the board");
  assert.equal(doc(b, "responses", "old-dns").data.note, "Wait, keep it");
});
ok("sync --source keeps a card closed by close or ack --close closed until its content changes", () => {
  const b = fresh(), all = () => [yn("a"), yn("b"), yn("c")];
  apply(b, sync(b, all(), "--source", "gh"));
  apply(b, cmd(b, "close", "a"));
  assert.deepEqual(sync(b, all(), "--source", "gh").lines, ["sync: 0 new, 0 changed (rev up), 0 changed (same rev), 3 unchanged, 0 closed", "no writes"]);
  apply(b, dumped(b, "ack", ACKED, "--close", "b"));
  // Until a read logs the ack, it is pending with its cards flag: one note line, no write.
  assert.deepEqual(sync(b, all(), "--source", "gh").lines.slice(1), [ackNote(b), "no writes"]);
  const ch = sync(b, [yn("a", { title: "a, again?" }), yn("b"), yn("c")], "--source", "gh");
  assert.match(ch.lines[0], /, 1 reopened \(a\)$/);
  assert.deepEqual([card(b, "a").status, card(b, "b").status], ["open", "closed"]);
});
const st = (b) => JSON.parse(fs.readFileSync(b.state, "utf8"));
const OTHER = Object.assign(yn("other-card"), { status: "open", rev: 1, priority: "soon", created: "2026-02-01T11:00:00+00:00", updated: "2026-02-01T11:00:00+00:00" });
const handledElsewhere = (b, id = ACKED) => edit(path.join(b.db, "batches", id + ".json"), (raw) => { raw.version = 2; raw.data.status = "handled"; raw.data.handled_at = "2026-02-01T11:00:00+00:00"; });
// A pending ack stores the batch update and the cards flag, never a cards write.
function noCardsWrite(b, id = ACKED) {
  const p = st(b).pending["batches/" + id];
  assert.ok(p && p.cards === true, JSON.stringify(p));
  assert.ok(![].concat(p, p.write || []).some((x) => x && x.collection === "cards"), JSON.stringify(p));
}
// Follow the printed lines of r as an agent does: apply each array; when the board refuses it, dump and run the
// adopt of its "if refused" line; after a line that names adopt cards, dump and run adopt cards. Returns the steps.
function follow(b, r, steps = []) {
  assert.ok(steps.length < 8, "no end: " + r.text);
  steps.push(r);
  for (const ws of writesOf(r.lines)) {
    try { applyBatch(b.db, ws); } catch (e) {
      if (!/version_mismatch|if_version is required/.test(e.message)) throw e;
      const line = r.lines.find((l) => l.startsWith("if refused: "));
      return follow(b, ok2(b, "adopt", / adopt (\S+) --dump /.exec(line)[1]), steps);
    }
  }
  if (r.lines.some((l) => / the cards write of this ack is not on the board\. (Once this array is applied:|Now:) .* adopt cards --dump /.test(l))) return follow(b, ok2(b, "adopt", "cards"), steps);
  return steps;
}
// The end of every case: the batches handled, the closes on the board, each batch logged once.
// rows: batch id -> its number of decisions.md lines; each batch has its own created day.
function settled(b, rows, closed, kept = []) {
  const rd = ok2(b, "read");
  assert.equal(rd.code, 0, rd.text);
  assert.equal(ok2(b, "read").lines.some((l) => l.startsWith("decisions.md: ")), false, "logged once");
  const cards = doc(b, "cards", "main").data.cards;
  for (const id of Object.keys(rows)) assert.equal(doc(b, "batches", id).data.status, "handled", id);
  for (const id of closed) assert.equal(cards.find((c) => c.id === id).status, "closed", id + " closed on the board");
  for (const id of kept) assert.ok(cards.some((c) => c.id === id), id + " kept on the board");
  const log = fs.readFileSync(path.join(b.board, "decisions.md"), "utf8").split("\n");
  for (const [id, n] of Object.entries(rows)) {
    const day = doc(b, "batches", id).data.created.slice(0, 10);
    assert.equal(log.filter((l) => l.endsWith(` | ${day} |`)).length, n, `${id}: its ${n} lines, once`);
  }
  assert.deepEqual(Object.keys(st(b).pending || {}).filter((k) => k.startsWith("batches/")), [], "no ack pending");
}
ok("a refused ack --close, the batch handled elsewhere: push prints the batch update and a cards write built now; adopt batches/<id> prints only the cards write", () => {
  const b = fresh();
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");
  noCardsWrite(b);
  const pin = st(b).pending.cards.if_version, pw = writesOf(cmd(b, "push", "batches/" + ACKED).lines).flat();
  assert.deepEqual(pw.map((w) => [w.op, w.collection, w.if_version]), [["update", "batches", 1], ["set", "cards", pin]], "both writes, the cards pinned as the ack's cards write was");
  // A printed array counts as applied: the next cards write builds on the version the pushed one makes.
  assert.equal(st(b).next.cards, pin + 1, "the pin after the push");
  assert.equal(JSON.parse(fs.readFileSync(pw[1].file_path, "utf8")).cards.find((c) => c.id === "disk-size").status, "closed");
  assert.ok(r.lines.some((l) => l.startsWith("if refused: ") && l.includes(` adopt batches/${ACKED} --dump `) && l.includes(" --dumped")), r.text);
  // Another session handled the batch first, so the whole batch call, the close with it, is refused.
  handledElsewhere(b);
  assert.throws(() => apply(b, r), /version_mismatch/);
  const ad = ok2(b, "adopt", "batches/" + ACKED);
  assert.equal(ad.lines[0], `batches/${ACKED}: the board holds the last write`, ad.text);
  assert.deepEqual(writesOf(ad.lines).flat().map((w) => [w.collection, w.doc_id, w.if_version]), [["cards", "main", doc(b, "cards", "main").version]], ad.text);
  assert.ok(!ad.lines.some((l) => l.includes(" adopt cards --dump ") && !l.startsWith("if refused: ")), "the cards write needs no adopt cards line: " + ad.text);
  apply(b, ad);
  assert.equal(doc(b, "cards", "main").data.cards.find((c) => c.id === "disk-size").status, "closed");
  assert.equal((st(b).pending || {})["batches/" + ACKED], undefined, "the ack needs nothing more");
  assert.match(ok2(b, "adopt", "cards").lines[0], /^cards: the board holds this state's cards, version \d+$/, "the board holds the close");
  settled(b, { [ACKED]: 2 }, ["disk-size"]);
});
ok("a refused ack --close after another writer added a card: adopt batches/<id> with cards in the dump lands the batch and the merged cards in one array", () => {
  const b = fresh();
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");
  // Another writer changed cards/main after the dump, so the whole batch call is refused.
  edit(path.join(b.db, "cards", "main.json"), (raw) => { raw.version += 1; raw.data.cards.push(OTHER); });
  assert.throws(() => apply(b, r), /version_mismatch/);
  const ad = ok2(b, "adopt", "batches/" + ACKED);
  assert.equal(ad.code, 0, ad.text);
  assert.deepEqual(ad.lines.slice(0, 4), [`batches/${ACKED}: write again, pinned to version 1`, "cards: added from the board other-card",
    "cards: kept this state's newer copy of disk-size", `cards: write again, pinned to version ${doc(b, "cards", "main").version}`], ad.text);
  assert.equal(writesOf(ad.lines).length, 1, "one array");
  assert.deepEqual(writesOf(ad.lines).flat().map((w) => [w.op, w.collection, w.doc_id, w.if_version]),
    [["update", "batches", ACKED, 1], ["set", "cards", "main", doc(b, "cards", "main").version]], ad.text);
  assert.ok(!ad.lines.some((l) => l.includes(" adopt cards --dump ")), "no adopt cards line: " + ad.text);
  noCardsWrite(b);
  apply(b, ad);
  const rd = ok2(b, "read");
  assert.deepEqual(rd.lines, [`decisions.md: the answers of ${ACKED}`, "no batches waiting"]);
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card"]);
});
// A dump of P4 and P2 cards whose P2 cards call left no file: the batches only.
function dumpNoCards(b) { const dir = dumpNow(b); fs.rmSync(path.join(dir, "cards"), { recursive: true, force: true }); return dir; }
const adoptNoCards = (b, key) => cmd(b, "adopt", key, "--dump", dumpNoCards(b), "--dumped");
// The refused ack of a card close after another writer moved cards/main, then adopt batches/<id> with a dump
// without cards.
function refusedAck(b, bump = (raw) => { raw.version += 1; }) {
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");
  edit(path.join(b.db, "cards", "main.json"), bump);
  assert.throws(() => apply(b, r), /version_mismatch/);
  return adoptNoCards(b, "batches/" + ACKED);
}
const cardsLine = (b, word) => `batches/${ACKED}: the cards write of this ack is not on the board. ${word} rm -rf ${b.dump}, then P2 cards with versions, then node ${SELF} adopt cards --dump ${b.dump} --dumped --state ${JSON.stringify(b.state)}`;
// Follow the adopt cards line of r: it is there, then adopt cards lands the close.
function followCards(b, r, word) {
  assert.ok(r.lines.includes(cardsLine(b, word)), r.text);
  const ac = ok2(b, "adopt", "cards");
  assert.equal(ac.code, 0, ac.text);
  apply(b, ac);
  assert.equal(doc(b, "cards", "main").data.cards.find((c) => c.id === "disk-size").status, "closed", "the close is on the board");
}
ok("a refused ack, a dump without cards: adopt batches/<id> prints the batch update and names adopt cards, which lands the close", () => {
  const b = fresh(), ad = refusedAck(b, (raw) => { raw.version += 1; raw.data.cards.push(OTHER); });
  assert.equal(ad.code, 0, ad.text);
  assert.equal(ad.lines[0], `batches/${ACKED}: write again, pinned to version 1`);
  assert.deepEqual(writesOf(ad.lines).flat().map((w) => [w.op, w.collection, w.doc_id, w.if_version]), [["update", "batches", ACKED, 1]], ad.text);
  assert.equal(ad.lines[ad.lines.length - 1], cardsLine(b, "Once this array is applied:"));
  assert.equal(card(b, "disk-size").status, "closed", "the close stays in the state");
  noCardsWrite(b);
  apply(b, ad);
  followCards(b, ad, "Once this array is applied:");
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card"]);
});
ok("a refused ack: the reprinted batch update is refused too because another session handled the batch; its if refused line leads to the cards", () => {
  const b = fresh(), ad = refusedAck(b, (raw) => { raw.version += 1; raw.data.cards.push(OTHER); });
  handledElsewhere(b);
  assert.throws(() => apply(b, ad), /version_mismatch/);
  assert.ok(ad.lines.some((l) => l.startsWith("if refused: ") && l.includes(` adopt batches/${ACKED} --dump `)), ad.text);
  // Without cards in the dump: the hint names adopt cards now.
  const now = adoptNoCards(b, "batches/" + ACKED);
  assert.deepEqual(now.lines, [`batches/${ACKED}: the board holds the last write`, `decisions.md: the answers of ${ACKED}`, "no writes", cardsLine(b, "Now:")], now.text);
  // A sync before adopt cards cannot pin the other writer's version.
  const s = sync(b, [yn("mine")]);
  assert.throws(() => apply(b, s), /if_version is required/);
  followCards(b, now, "Now:");
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card", "mine"]);
});
ok("the batch handled elsewhere, a dump without cards: Now: adopt cards; a sync in between cannot pin the other writer's version", () => {
  const b = fresh(), r = dumped(b, "ack", ACKED, "--close", "disk-size");
  handledElsewhere(b);
  edit(path.join(b.db, "cards", "main.json"), (raw) => { raw.version += 1; raw.data.cards.push(OTHER); });
  assert.throws(() => apply(b, r), /version_mismatch/);
  const now = adoptNoCards(b, "batches/" + ACKED);
  assert.equal(now.lines[now.lines.length - 1], cardsLine(b, "Now:"), now.text);
  const s = sync(b, [yn("mine")]);
  assert.throws(() => apply(b, s), /if_version is required/, "one other write meets the ack's pin: the sync must not land on it");
  followCards(b, now, "Now:");
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card", "mine"]);
});
ok("a refused ack: adopt batches/<id> twice before applying still names adopt cards", () => {
  const b = fresh();
  refusedAck(b);
  const ad2 = adoptNoCards(b, "batches/" + ACKED);
  assert.deepEqual(writesOf(ad2.lines).flat().map((w) => w.collection), ["batches"], ad2.text);
  apply(b, ad2);
  followCards(b, ad2, "Once this array is applied:");
  settled(b, { [ACKED]: 2 }, ["disk-size"]);
});
ok("a refused ack: a sync before adopt cards is refused by the board and leads to adopt cards; the other writer's card stays", () => {
  const b = fresh();
  const ad = refusedAck(b, (raw) => { raw.version += 1; raw.data.cards.push(OTHER); });
  apply(b, ad);
  const s = sync(b, [yn("mine")]);
  assert.equal(s.code, 0, s.text);
  // The ack's pin assumed its cards landed; that version is now the other writer's. Until a dump shows the cards,
  // a cards write is a create, which the board refuses.
  assert.throws(() => apply(b, s), /if_version is required/, "the sync cannot pin the other writer's version");
  assert.ok(s.lines.some((l) => l.startsWith("if refused: ") && l.includes(" adopt cards --dump ")), s.text);
  const ac = ok2(b, "adopt", "cards");
  apply(b, ac);
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card", "mine"]);
});
ok("a later refused ack without --close names no adopt cards after the close landed and the board moved", () => {
  const b = fresh(), LATER = "b20260105T000000+0000-eeee";
  apply(b, dumped(b, "ack", ACKED, "--close", "disk-size"));
  edit(path.join(b.db, "cards", "main.json"), (raw) => { raw.version += 1; raw.data.cards.push(Object.assign(yn("other-card"), { status: "open", rev: 1, priority: "soon", created: "2026-02-01T11:00:00+00:00", updated: "2026-02-01T11:00:00+00:00" })); });
  fs.writeFileSync(path.join(b.db, "batches", LATER + ".json"), JSON.stringify({ version: 1, data: { id: LATER, created: "2026-01-05T00:00:00+00:00", itemIds: ["disk-size"], noteIds: [],
    answers: { "disk-size": { answer: "Yes", note: "", rev: 2 } }, notes: {}, status: "sent" } }));
  const r = dumped(b, "ack", LATER);
  edit(path.join(b.db, "batches", LATER + ".json"), (raw) => { raw.version = 2; raw.data.status = "handled"; raw.data.handled_at = "2026-02-01T11:00:00+00:00"; });
  assert.throws(() => apply(b, r), /version_mismatch/);
  const ad = ok2(b, "adopt", "batches/" + LATER);
  assert.deepEqual(ad.lines, [`batches/${LATER}: the board holds the last write`, `decisions.md: the answers of ${ACKED}, ${LATER}`, "no writes"], ad.text);
});
ok("an older state with cards_wait and a pending ack that holds a cards write: it loads, the key goes, push builds the cards anew", () => {
  const b = fresh();
  dumped(b, "ack", ACKED, "--close", "disk-size");             // printed, never applied
  const s = st(b), bw = s.pending["batches/" + ACKED].write, v = doc(b, "cards", "main").version;
  // The shape an older script left: the batch group lists both writes, its cards write's out file is gone, and
  // adopt had rolled the cards pin back to the board's version.
  const old = { op: "set", collection: "cards", doc_id: "main", file_path: path.join(b.board, "out", "cards", "main.00000000.json"), if_version: v };
  s.pending["batches/" + ACKED] = [bw, old];
  s.cards_wait = { [ACKED]: old };
  s.next.cards = v;
  fs.writeFileSync(b.state, JSON.stringify(s));
  const p = cmd(b, "push", "batches/" + ACKED);
  assert.equal(p.code, 0, p.text);
  const pw = writesOf(p.lines).flat();
  assert.deepEqual(pw.map((w) => [w.collection, w.if_version]), [["batches", 1], ["cards", v]], p.text);
  assert.ok(fs.existsSync(pw[1].file_path) && pw[1].file_path !== old.file_path, "a fresh out file");
  assert.equal("cards_wait" in st(b), false, "the key is dropped");
  noCardsWrite(b);
  assert.equal(cmd(b, "check").code, 0, "a state with the key is no older model");
  follow(b, p);
  settled(b, { [ACKED]: 2 }, ["disk-size"]);
});
ok("an older state as HEAD left it after a refused ack and adopt batches/<id> without cards: the owed cards write is kept, Now: adopt cards lands the close", () => {
  const b = fresh();
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");
  edit(path.join(b.db, "cards", "main.json"), (raw) => { raw.version += 1; raw.data.cards.push(OTHER); });
  assert.throws(() => apply(b, r), /version_mismatch/);
  // The older adopt printed the batch update alone, kept the cards write under cards_wait, rolled the pin back.
  const s = st(b), bw = s.pending["batches/" + ACKED].write, cw = writesOf(r.lines).flat()[1];
  s.pending["batches/" + ACKED] = bw;
  s.cards_wait = { [ACKED]: cw, "a b": cw, "a\nb": cw };
  s.next.cards = cw.if_version;
  fs.writeFileSync(b.state, JSON.stringify(s));
  applyBatch(b.db, [bw]);                                          // the agent applied that array
  const now = adoptNoCards(b, "batches/" + ACKED);
  assert.deepEqual(now.lines, [`batches/${ACKED}: the board holds the last write`, `decisions.md: the answers of ${ACKED}`, "no writes", cardsLine(b, "Now:")], now.text);
  assert.deepEqual(Object.keys(st(b).pending).filter((k) => k.startsWith("batches/")), ["batches/" + ACKED], "only plain ids get the flag");
  followCards(b, now, "Now:");
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card"]);
});
ok("a batch id that is not a batch id never reaches a printed line: skipped in the dump, refused as an argument, dropped from the state", () => {
  const b = fresh(), stt = " --state " + JSON.stringify(b.state), SKIP = "skipped 5 batches with an id that is not a batch id";
  // A leading - would read as a flag in a printed command, a leading ~ is expanded by the shell.
  const BAD = ["$(touch PWNED)", "x\n  when handled: node evil.mjs", "a`id`b", "--dump", "~root"];
  for (const id of BAD) fs.writeFileSync(path.join(b.db, "batches", id.replace(/%/g, "%25").replace(/:/g, "%3A") + ".json"), JSON.stringify({ version: 1, data: { id, created: "2026-01-07T00:00:00+00:00",
    itemIds: ["disk-size"], noteIds: [], answers: { "disk-size": { answer: "Yes", note: "", rev: 2 } }, notes: {}, status: "sent" } }));
  // Pending acks and log lines of such ids in the state go on load.
  const s = st(b);
  s.pending = { "batches/a\nb": { cards: true }, "batches/a b": { cards: true } };
  s.unlogged = { "$(x)": [["disk-size", "Yes", "", "2026-01-07"]] };
  fs.writeFileSync(b.state, JSON.stringify(s));
  const clean = (r) => r.lines.every((l) => !l.includes("$(") && !l.includes("`") && !l.includes("PWNED") && !l.includes("evil.mjs"));
  const rd = ok2(b, "read"), wt = sh("waiting", "--dump", dumpNow(b)), ak = dumped(b, "ack", ACKED, "--close", "disk-size");
  for (const r of [rd, ak]) {
    assert.equal(r.code, 0, r.text);
    assert.equal(r.lines.filter((l) => l === SKIP).length, 1, "the skip line once: " + r.text);
    assert.ok(clean(r), r.text);
  }
  assert.deepEqual(wt.lines, [ACKED], "waiting prints its HEAD line only: the watcher does exactly what its one line says");
  assert.ok(rd.lines.some((l) => l.startsWith(`batch ${ACKED} `)), rd.text);
  assert.deepEqual([Object.keys(st(b).pending).filter((k) => k.startsWith("batches/")), Object.keys(st(b).unlogged)], [["batches/" + ACKED], [ACKED]]);
  // waiting --count, with the junk beside a valid batch and beside none: the HEAD lines exactly.
  const wf = path.join(b.board, "watch.json"), WAIT_SH = path.resolve(here, "..", "skills", "decision-board", "assets", "wait.sh");
  fs.writeFileSync(wf, JSON.stringify({ dump: b.dump, seconds: 60, limit: 2, poll: 0, started: "2026-02-01T12:00:00+00:00", until: "2026-02-01T13:00:00+00:00" }));
  assert.deepEqual(sh("waiting", "--dump", dumpNow(b), "--count", wf).lines, [`batches ${ACKED} wait. Report exactly: "batches wait: run Read and handle the answers". Then stop.`]);
  // The valid batch handled: the junk alone.
  apply(b, ak);
  assert.deepEqual(sh("waiting", "--dump", dumpNow(b)).lines, ["none"]);
  assert.deepEqual(sh("waiting", "--dump", dumpNow(b), "--count", wf).lines, [`none, poll 1 of 2. Run bash "${WAIT_SH}" 60 in the foreground, then go to step 1.`]);
  // As arguments: refused, the argument quoted as display text.
  assert.deepEqual(dumped(b, "ack", BAD[0]).lines, ['ack: "$(touch PWNED)" is not a batch id']);
  for (const id of ["-x", "~root"]) {
    assert.deepEqual(dumped(b, "ack", id).lines, [`ack: ${JSON.stringify(id)} is not a batch id`]);
    assert.deepEqual(cmd(b, "push", "batches/" + id).code, 1);
    assert.deepEqual(dumped(b, "ack", ACKED, "--close", id).lines, [`ack --close: ${JSON.stringify(id)} is not a card id`]);
    assert.deepEqual(cmd(b, "close", id).lines, [`close: ${JSON.stringify(id)} is not a card id`]);
  }
  assert.deepEqual(sync(b, [yn("-x")]).lines, ["-x: id: must not start with - or ~"], "sync accepted it before: refused now");
  for (const c of ["push", "adopt"]) {
    const r = c === "push" ? cmd(b, c, "batches/" + BAD[2]) : ok2(b, c, "batches/" + BAD[1]);
    assert.equal(r.code, 1);
    assert.match(r.lines[0], new RegExp(`^${c}: "batches/.*" is not a document key such as cards, guides/<id>, meta/config, batches/<id> or purge/<stamp>$`), r.text);
    assert.equal(r.lines.length, 1, r.text);
  }
  // A board card whose id is not a plain id is not merged into the state (as the page reads the board).
  edit(path.join(b.db, "cards", "main.json"), (raw) => { raw.version += 1; raw.data.cards.push(Object.assign({}, OTHER, { id: "$(y)" }), Object.assign({}, OTHER, { id: "~z" })); });
  ok2(b, "adopt", "cards");
  assert.equal(st(b).cards.some((c) => c.id === "$(y)" || c.id === "~z"), false);
  // A state card with such an id (an older state): its control hint prints no command.
  edit(path.join(b.board, "config.json"), (c) => { c.controls = { assign: true }; });
  edit(b.state, (x) => { x.cards.push(Object.assign({}, OTHER, { id: "c z" })); });
  fs.writeFileSync(path.join(b.db, "batches", "b-cz.json"), JSON.stringify({ version: 1, data: { id: "b-cz", created: "2026-01-09T00:00:00+00:00", itemIds: [], noteIds: [],
    answers: {}, notes: {}, controlIds: ["c z"], controls: { "c z": { rev: 1, assign: "agent" } }, status: "sent" } }));
  assert.ok(ok2(b, "read").lines.includes('  "c z"  control assign "agent"  (skip)'));
  // Arguments echoed in an error before they are checked are quoted.
  assert.deepEqual(sh("read", "--a b").lines, ['read: unknown flag --"a b"']);
  const f = path.join(path.dirname(b.state), "a file");
  fs.writeFileSync(f, "{}");
  assert.deepEqual(sh("waiting", "--dump", f).lines, [`--dump ${JSON.stringify(f)}: not a folder. Give the dump folder`]);
  // A batch key with no pending write names push cards, which can still be owed.
  assert.deepEqual(cmd(b, "push", "batches/b-none").lines, [`push: no write of batches/b-none in ${b.state}. If its cards write is not confirmed: node ${SELF} push cards${stt}`]);
});
ok("an ack the board holds whose cards are owed: its own note; push sends the cards under the cards group and the note goes", () => {
  const b = fresh(), stt = " --state " + JSON.stringify(b.state);
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");
  handledElsewhere(b);
  edit(path.join(b.db, "cards", "main.json"), (raw) => { raw.version += 1; raw.data.cards.push(OTHER); });
  assert.throws(() => apply(b, r), /version_mismatch/);
  assert.equal(adoptNoCards(b, "batches/" + ACKED).lines.slice(-1)[0], cardsLine(b, "Now:"));
  assert.deepEqual(cmd(b, "close", "disk-size").lines, ["close: 0 cards closed", cardsNote(b), "no writes"]);
  const p = cmd(b, "push", "batches/" + ACKED);
  const dd = path.relative(process.cwd(), b.dump) || "dump";            // push takes no --dump: the default folder
  assert.deepEqual(p.lines.filter((l) => l.startsWith("if ")), [`if refused: rm -rf ${dd}, then P2 cards with versions, then node ${SELF} adopt cards --dump ${dd} --dumped${stt}`,
    `if the reply is lost: node ${SELF} push cards${stt}`], p.text);
  assert.equal((st(b).pending || {})["batches/" + ACKED], undefined, "push clears it");
  follow(b, p);
  assert.deepEqual(cmd(b, "close", "disk-size").lines, ["close: 0 cards closed", "no writes"], "no note after the push");
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card"]);
});
ok("an ack that owes only its cards is cleared by any command that reads a dump whose cards/main holds the state's cards", () => {
  const b = fresh();
  apply(b, ok2(b, "adopt", "cards"));                           // the board holds this state's cards
  assert.equal(ok2(b, "adopt", "cards").lines[0].startsWith("cards: the board holds this state's cards"), true);
  const s = st(b);
  s.pending = Object.assign(s.pending || {}, { ["batches/" + ACKED]: { cards: true } });
  fs.writeFileSync(b.state, JSON.stringify(s));
  assert.ok(cmd(b, "close", "old-dns").lines.includes(cardsNote(b)));
  ok2(b, "read");                                                 // a dump with cards: they are on the board
  assert.equal((st(b).pending || {})["batches/" + ACKED], undefined);
  assert.deepEqual(cmd(b, "close", "old-dns").lines, ["close: 0 cards closed", "no writes"]);
});
ok("read, check, status, waiting and watch print no note while an ack with the cards flag is pending", () => {
  const b = fresh();
  dumped(b, "ack", ACKED, "--close", "disk-size");             // pending, flagged
  assert.equal(st(b).pending["batches/" + ACKED].cards, true);
  for (const out of [ok2(b, "read"), cmd(b, "check"), cmd(b, "status", "--now", "Working"), sh("waiting", "--dump", dumpNow(b)), cmd(b, "watch")])
    assert.ok(out.lines.length && !out.lines.some((l) => l.startsWith("note: ack ")), out.text);
  assert.ok(cmd(b, "close", "disk-size").lines.includes(ackNote(b)), "close does print it");
});
// Run the push of every pending ack that read names, and follow its lines.
function recover(b) {
  for (const l of ok2(b, "read").lines) { const m = /Run: node \S+ push (batches\/\S+) /.exec(l); if (m) follow(b, cmd(b, "push", m[1])); }
}
// Another writer adds a card in n versions (default: adds it and edits it). After a lost ack the next.cards of this
// state is one ahead of the board (a printed array counts as applied): a close or sync with real changes pins it,
// so a single other write meets it exactly, a known limit. push and the extra writes of a pending ack pin the last
// printed cards pin instead, which a single other write already moved past.
const bumpOther = (b, n = 2) => edit(path.join(b.db, "cards", "main.json"), (raw) => { raw.version += n; raw.data.cards.push(OTHER); });
ok("a lost ack --close, then exactly one other write: the push is refused, adopt merges, the other writer's card stays", () => {
  const b = fresh();
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");     // the array is never applied
  bumpOther(b, 1);
  const p = cmd(b, "push", "batches/" + ACKED);
  assert.equal(writesOf(p.lines).flat()[1].if_version, writesOf(r.lines).flat()[1].if_version, "the push pins the ack's own cards pin");
  assert.throws(() => apply(b, p), /version_mismatch/, "a version this state has not seen: refused");
  const steps = follow(b, p);
  assert.ok(steps.length >= 2 && steps[1].lines[0] === `batches/${ACKED}: write again, pinned to version 1`, steps.map((s) => s.text).join("\n"));
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card"]);
});
ok("a lost ack --close, then a close of another card applied before the push: following the printed lines lands both closes", () => {
  const b = fresh();
  apply(b, sync(b, [yn("c2")]));
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");     // the array is never applied
  assert.equal(writesOf(r.lines).length, 1);
  bumpOther(b);
  follow(b, cmd(b, "close", "c2"));
  noCardsWrite(b);
  follow(b, cmd(b, "push", "batches/" + ACKED));
  settled(b, { [ACKED]: 2 }, ["disk-size", "c2"], ["other-card"]);
});
ok("two batches: the first ack (a dismiss) lost, the second (--close) as the board decides; the printed lines recover both", () => {
  const b = fresh(), B1 = "b20260106T000000+0000-b1b1";
  edit(path.join(b.board, "config.json"), (c) => { c.controls = { dismiss: true }; });
  apply(b, sync(b, [yn("t2")]));
  fs.writeFileSync(path.join(b.db, "batches", B1 + ".json"), JSON.stringify({ version: 1, data: { id: B1, created: "2026-01-06T00:00:00+00:00", itemIds: [], noteIds: [],
    answers: {}, notes: {}, controlIds: ["t2"], controls: { t2: { rev: 1, dismiss: "on", keep: { assign: "", done: "off" } } }, status: "sent" } }));
  const r1 = dumped(b, "ack", B1);                              // lost
  assert.match(r1.lines[0], /^ack \S+: handled, 1 cards closed\. /);
  bumpOther(b);
  follow(b, dumped(b, "ack", ACKED, "--close", "disk-size"));
  recover(b);
  settled(b, { [B1]: 1, [ACKED]: 2 }, ["disk-size", "t2"], ["other-card"]);
});
ok("the batch handled elsewhere and cards moved: adopt batches/<id> lands the close as a cards write of its own; nothing is left pending", () => {
  const b = fresh(), stt = " --state " + JSON.stringify(b.state);
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");
  handledElsewhere(b);
  bumpOther(b);
  assert.throws(() => apply(b, r), /version_mismatch/);
  const ad = ok2(b, "adopt", "batches/" + ACKED), v = doc(b, "cards", "main").version;
  assert.deepEqual(ad.lines.slice(0, 6), [`batches/${ACKED}: the board holds the last write`, `decisions.md: the answers of ${ACKED}`,
    "cards: added from the board other-card", "cards: kept this state's newer copy of disk-size",
    `batches/${ACKED}: the cards write of this ack is not on the board: write it again`, `cards: write again, pinned to version ${v}`], ad.text);
  assert.deepEqual(writesOf(ad.lines).flat().map((w) => [w.collection, w.if_version]), [["cards", v]], ad.text);
  assert.deepEqual(ad.lines.filter((l) => l.startsWith("if ")), [`if refused: rm -rf ${b.dump}, then P2 cards with versions, then node ${SELF} adopt cards --dump ${b.dump} --dumped${stt}`,
    `if the reply is lost: node ${SELF} push cards${stt}`], "the lines of the cards group");
  assert.equal((st(b).pending || {})["batches/" + ACKED], undefined, "the ack needs nothing more");
  apply(b, ad);
  assert.equal(ok2(b, "adopt", "cards").lines[0], `cards: the board holds this state's cards, version ${v + 1}`);
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card"]);
});
ok("a dump without cards, then the reply of that adopt is lost: push pins the last printed cards pin and sets the next pin after it", () => {
  const b = fresh(), ad = refusedAck(b, (raw) => { raw.version += 1; raw.data.cards.push(OTHER); });
  assert.equal(st(b).next.cards, undefined, "the adopt left no pin: the next cards write is a create");
  const pin = st(b).pending.cards.if_version, p = cmd(b, "push", "batches/" + ACKED);
  assert.deepEqual(writesOf(p.lines).flat().map((w) => [w.collection, w.if_version]), [["batches", 1], ["cards", pin]], p.text);
  // A printed array counts as applied, so the next cards write pins the version this one makes: pin + 1.
  assert.equal(st(b).next.cards, pin + 1);
  follow(b, p);
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card"]);
  assert.ok(ad.code === 0);
});
ok("the batch handled elsewhere, cards untouched: ack again, the note, push lands the cards; the ack is done, no later note", () => {
  const b = fresh(), list = [yn("c4")];
  apply(b, sync(b, list));
  dumped(b, "ack", ACKED, "--close", "c4");                     // lost
  handledElsewhere(b);
  const r = dumped(b, "ack", ACKED);
  assert.deepEqual(r.lines, [`ack ${ACKED}: already handled`, cardsNote(b), "no writes"]);
  const p = cmd(b, "push", "batches/" + ACKED), pw = writesOf(p.lines).flat();
  assert.deepEqual(pw.map((w) => w.collection), ["cards"], p.text);
  assert.ok(p.lines.includes(`if the reply is lost: node ${SELF} push cards --state ${JSON.stringify(b.state)}`), "its own cards group: " + p.text);
  apply(b, p);                                                    // the board is at the ack's pin: it lands
  assert.equal((st(b).pending || {})["batches/" + ACKED], undefined);
  assert.ok(!sync(b, list).lines.some((l) => l.startsWith("note: ack ")));
  settled(b, { [ACKED]: 2 }, ["c4"]);
});
ok("adopt batches/<id>: when the merge finds the board holds the state's cards, no write-it-again line and no write", () => {
  const b = fresh();
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");
  handledElsewhere(b);
  // Another session closed the same card, later: after the merge the state equals the board.
  edit(path.join(b.db, "cards", "main.json"), (raw) => { raw.version += 1; Object.assign(raw.data.cards.find((c) => c.id === "disk-size"), { status: "closed", updated: "2026-02-01T13:00:00+00:00" }); });
  assert.throws(() => apply(b, r), /version_mismatch/);
  const ad = ok2(b, "adopt", "batches/" + ACKED);
  assert.deepEqual(ad.lines, [`batches/${ACKED}: the board holds the last write`, `decisions.md: the answers of ${ACKED}`,
    "cards: took the board's newer copy of disk-size", `cards: the board holds this state's cards, version ${doc(b, "cards", "main").version}`, "no writes"], ad.text);
  settled(b, { [ACKED]: 2 }, ["disk-size"]);
});
ok("after adopt batches/<id> landed the cards of an ack the board already held: no note in sync, read, sync, close", () => {
  const b = fresh(), list = [yn("c5")];
  apply(b, sync(b, list));
  const r = dumped(b, "ack", ACKED, "--close", "c5");
  handledElsewhere(b);
  bumpOther(b, 1);
  assert.throws(() => apply(b, r), /version_mismatch/);
  const ad = ok2(b, "adopt", "batches/" + ACKED);
  assert.equal(writesOf(ad.lines).length, 1, ad.text);
  apply(b, ad);
  for (const out of [sync(b, list), ok2(b, "read"), sync(b, list), cmd(b, "close", "c5")]) {
    assert.ok(!out.lines.some((l) => l.startsWith("note: ack ")), out.text);
    assert.equal((st(b).pending || {})["batches/" + ACKED], undefined, out.text);
  }
  settled(b, { [ACKED]: 2 }, ["c5"], ["other-card"]);
});
// Follow the note lines of r as an agent does: its arrays, then the push each note names, then a read; then run the
// command again (again()) and repeat while it still prints a note.
function followNotes(b, r, again) {
  for (let i = 0; i < 4; i++, r = again()) {
    const keys = r.lines.map((l) => /^note: (?:ack \S+ changed cards\. If its batch call was refused or its reply lost|the cards of ack \S+ are not on the board): node \S+ push (batches\/\S+) /.exec(l)).filter(Boolean).map((m) => m[1]);
    if (!keys.length) return i;
    follow(b, r);
    keys.forEach((k) => follow(b, cmd(b, "push", k)));
    recover(b);
  }
  assert.fail("the note does not end");
}
ok("a lost ack --close, the batch handled elsewhere, then ack again: already handled, a note names the push, which lands the close", () => {
  const b = fresh();
  dumped(b, "ack", ACKED, "--close", "disk-size");              // lost
  handledElsewhere(b);
  bumpOther(b, 1);
  const r = dumped(b, "ack", ACKED);
  assert.deepEqual(r.lines, [`ack ${ACKED}: already handled`, cardsNote(b), "no writes"]);
  assert.ok(followNotes(b, r, () => dumped(b, "ack", ACKED)) >= 1);
  settled(b, { [ACKED]: 2 }, ["disk-size"], ["other-card"]);
});
ok("a lost ack, recovery skipped, then a sync of an unchanged card file: no write, a note names the push, which lands the close", () => {
  const b = fresh(), list = [yn("c6")];
  apply(b, sync(b, list));
  dumped(b, "ack", ACKED, "--close", "c6");                     // lost; the agent goes on
  bumpOther(b, 1);
  const s = sync(b, list);
  assert.deepEqual(s.lines, ["sync: 0 new, 0 changed (rev up), 0 changed (same rev), 1 unchanged, 0 closed", ackNote(b), "no writes"]);
  assert.ok(followNotes(b, s, () => sync(b, list)) >= 1);
  settled(b, { [ACKED]: 2 }, ["c6"], ["other-card"]);
});
ok("a lost ack, recovery skipped, then a close of the card it closed: no write, a note names the push, which lands the close", () => {
  const b = fresh();
  apply(b, sync(b, [yn("c7")]));
  dumped(b, "ack", ACKED, "--close", "c7");                     // lost; the agent goes on
  bumpOther(b, 1);
  const c = cmd(b, "close", "c7");
  assert.deepEqual(c.lines, ["close: 0 cards closed", ackNote(b), "no writes"]);
  assert.ok(followNotes(b, c, () => cmd(b, "close", "c7")) >= 1);
  settled(b, { [ACKED]: 2 }, ["c7"], ["other-card"]);
});
ok("a close that closes carries the unconfirmed close and prints no note", () => {
  const b = fresh();
  apply(b, sync(b, [yn("c8"), yn("c9")]));
  dumped(b, "ack", ACKED, "--close", "c8");                     // lost
  const c = cmd(b, "close", "c9");
  assert.ok(!c.lines.some((l) => l.startsWith("note: ack ")), c.text);
  const body = JSON.parse(fs.readFileSync(writesOf(c.lines).flat()[0].file_path, "utf8")).cards;
  assert.deepEqual(["c8", "c9"].map((id) => body.find((x) => x.id === id).status), ["closed", "closed"]);
});
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.log(failed + " of " + n + " failed"); process.exitCode = 1; }
