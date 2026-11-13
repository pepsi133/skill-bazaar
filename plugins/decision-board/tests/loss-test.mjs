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
process.env.BOARD_NOW = "2026-02-01T12:00:00Z";

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
  assert.equal(sync(b, all(), "--source", "gh").lines[1], "no writes");
  const ch = sync(b, [yn("a", { title: "a, again?" }), yn("b"), yn("c")], "--source", "gh");
  assert.match(ch.lines[0], /, 1 reopened \(a\)$/);
  assert.deepEqual([card(b, "a").status, card(b, "b").status], ["open", "closed"]);
});
ok("a refused ack --close: push prints both writes, and adopt batches/<id> prints only the cards write", () => {
  const b = fresh();
  const r = dumped(b, "ack", ACKED, "--close", "disk-size");
  assert.equal(writesOf(cmd(b, "push", "batches/" + ACKED).lines)[0].length, 2);
  assert.ok(r.lines.some((l) => l.startsWith("if refused: ") && l.includes(` adopt batches/${ACKED} --dump `) && l.includes(" --dumped")), r.text);
  // Another session handled the batch first, so the whole batch call, the close with it, is refused.
  edit(path.join(b.db, "batches", ACKED + ".json"), (raw) => { raw.version = 2; raw.data.status = "handled"; raw.data.handled_at = "2026-02-01T11:00:00+00:00"; });
  assert.throws(() => apply(b, r), /version_mismatch/);
  const ad = ok2(b, "adopt", "batches/" + ACKED);
  assert.equal(ad.lines[0], `batches/${ACKED}: the board holds the last write`, ad.text);
  assert.deepEqual(writesOf(ad.lines).flat().map((w) => [w.collection, w.doc_id]), [["cards", "main"]], ad.text);
  apply(b, ad);
  assert.equal(doc(b, "cards", "main").data.cards.find((c) => c.id === "disk-size").status, "closed");
});
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.log(failed + " of " + n + " failed"); process.exitCode = 1; }
