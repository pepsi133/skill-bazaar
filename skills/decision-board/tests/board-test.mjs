// Tests of scripts/board.mjs against the fixture dump and the stand-in database of fakedb.mjs.
// Run: node board-test.mjs. Exits 1 on the first failure. Temporary files go under the system temp directory (TMPDIR).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, readDump } from "../scripts/board.mjs";
import { applyBatch, readDb, writesOf } from "./fakedb.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, "fixtures");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "board-test-"));
let n = 0;
function ok(name, fn) { fn(); n++; console.log("ok " + n + " " + name); }
function fresh() {
  const d = fs.mkdtempSync(path.join(tmp, "dump-"));
  fs.cpSync(path.join(FIX, "dump"), d, { recursive: true });
  return d;
}
function sh(...argv) { const lines = []; const code = run(argv, (l) => lines.push(...String(l).split("\n"))); return { code, lines, text: lines.join("\n") }; }
function apply(dump, r) { const ws = writesOf(r.lines); ws.forEach((w) => applyBatch(dump, w)); return ws.flat(); }
const doc = (dump, c, id) => { const d = readDb(dump).get(c); return d && d.get(id); };
process.env.BOARD_NOW = "2026-02-01T12:00:00Z";

ok("cards: a report's Board items become writes; unchanged cards are skipped; rev rises only on a content change", () => {
  const dump = fresh();
  const r = sh("cards", path.join(FIX, "report.md"), "--dump", dump);
  assert.equal(r.code, 0, r.text);
  assert.match(r.lines[0], /^cards: 1 new, 1 changed \(rev up\), 1 changed \(same rev\), 0 unchanged, 0 closed as replaced$/);
  assert.ok(!r.text.includes("Grow the disk"), "no card text in the output");
  const ws = apply(dump, r);
  assert.deepEqual(ws.map((w) => [w.op, w.doc_id, w.if_version]), [["set", "disk-size", 3], ["set", "vlan-plan", 2], ["set", "cam-firmware", undefined]]);
  const disk = doc(dump, "items", "disk-size").data, vlan = doc(dump, "items", "vlan-plan").data, cam = doc(dump, "items", "cam-firmware").data;
  assert.equal(disk.rev, 3); assert.equal(disk.created, "2026-01-01T10:00:00Z"); assert.equal(disk.updated, "2026-02-01T12:00:00Z");
  assert.equal(vlan.rev, 1, "a priority change keeps the rev"); assert.equal(vlan.priority, "soon");
  assert.deepEqual([cam.rev, cam.status, cam.kind, cam.priority, cam.options], [1, "open", "action", "soon", undefined]);
  const again = sh("cards", path.join(FIX, "report.md"), "--dump", dump);
  assert.match(again.lines[0], /0 new, 0 changed \(rev up\), 0 changed \(same rev\), 3 unchanged/);
  assert.equal(again.lines[1], "no writes");
});
ok("cards: a bad card stops the run with one line per problem and no writes", () => {
  const dump = fresh(), f = path.join(tmp, "bad.json");
  fs.writeFileSync(f, JSON.stringify([{ id: "a b", title: "" }, { id: "x", title: "T", recomendation: "Yes", kind: "nope", options: ["A", "A"] },
    { id: "y", title: "T", recommendation: "Maybe", options: ["Yes"], supersedes: "y" }, { id: "x", title: "again" }]));
  const r = sh("cards", f, "--dump", dump);
  assert.equal(r.code, 1);
  assert.deepEqual(r.lines, ["a b: id: use 1 to 100 of A-Z a-z 0-9 _ - . ~ : @ +", "a b: title: missing", "x: recomendation: unknown field",
    "x: kind: not one of decision, action, info", "x: options: empty or repeated", "y: options: a decision card needs 2 to 8", "y: recommendation: not one of the options",
    "y: supersedes: not another card id", "x: id: twice in this file"]);
  assert.equal(fs.existsSync(path.join(dump, "out")), false);
});
ok("cards: the ids . and .. are refused; a __proto__ key is an unknown field; an action card keeps its default options", () => {
  const dump = fresh(), f = path.join(tmp, "odd.json");
  fs.writeFileSync(f, '[{"id": ".", "title": "T"}, {"id": "..", "title": "T"}, {"id": "a.b", "title": "T", "options": ["A", "B"]},' +
    ' {"id": "p", "title": "T", "__proto__": {"status": "closed"}}, {"id": "act", "title": "T", "kind": "action"}]');
  const r = sh("cards", f, "--dump", dump);
  assert.equal(r.code, 1);
  assert.deepEqual(r.lines, [".: id: use 1 to 100 of A-Z a-z 0-9 _ - . ~ : @ +", "..: id: use 1 to 100 of A-Z a-z 0-9 _ - . ~ : @ +", "p: __proto__: unknown field"]);
});
ok("cards: supersedes closes the open card it replaces, without a rev change", () => {
  const dump = fresh(), f = path.join(tmp, "sup.json");
  fs.writeFileSync(f, JSON.stringify([{ id: "disk-size-2", title: "Grow the disk to 300 GB?", options: ["Yes", "No"], supersedes: "disk-size" }]));
  const ws = apply(dump, sh("cards", f, "--dump", dump));
  assert.deepEqual(ws.map((w) => [w.op, w.doc_id]), [["set", "disk-size-2"], ["update", "disk-size"]]);
  assert.equal(doc(dump, "items", "disk-size").data.status, "closed");
  assert.equal(doc(dump, "items", "disk-size").data.rev, 2);
});
ok("cards: more than 50 writes print as several numbered arrays", () => {
  const dump = fresh(), f = path.join(tmp, "many.json");
  fs.writeFileSync(f, JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ id: "c" + i, title: "Card " + i }))));
  const r = sh("cards", f, "--dump", dump), ws = writesOf(r.lines);
  assert.deepEqual(ws.map((w) => w.length), [50, 50, 20]);
  assert.ok(r.lines.some((l) => l.startsWith("batch 3 of 3: 20 writes")));
  ws.forEach((w) => applyBatch(dump, w));
  assert.equal(readDb(dump).get("items").size, 123);
});
ok("read: new batches of the default agent, one line per answer, notes, flags; acked batches are left out", () => {
  const dump = fresh();
  const r = sh("read", "--dump", dump);
  assert.deepEqual(r.lines, [
    "batch b20260103T000000Z-bbbb  \"2026-01-03T00:00:00Z\"  1 answers  1 notes",
    "  disk-size  \"\"  \"Which disk?\"  [stale-rev] [question]",
    "  note n20260103T000000Z-cccc  item \"disk-size\"  \"Back up first.\\nThen grow it.\"",
    "  when handled: node " + path.relative(process.cwd(), path.join(here, "..", "scripts", "board.mjs")) + " ack b20260103T000000Z-bbbb --dump " + dump]);
  const b = sh("read", "--dump", dump, "--agent", " Net-Agent ");
  assert.equal(b.lines[0].split("  ")[0], "batch b20260104T000000Z-dddd");
  assert.equal(b.lines[1], "  vlan-plan  \"Yes\"  \"\"");
  assert.equal(sh("read", "--dump", dump, "--agent", "coordinator").lines[0].split("  ")[0], "batch b20260103T000000Z-bbbb", "the configured agent name is the default agent");
  assert.equal(sh("read", "--dump", dump, "--agent", "nobody").text, "no new batches for nobody");
});
ok("read: a batch without an answers copy falls back to the responses", () => {
  const dump = fresh();
  fs.writeFileSync(path.join(dump, "batches", "b0.json"), JSON.stringify({ version: 1, data: { id: "b0", created: "2025-12-31T00:00:00Z", itemIds: ["old-dns"], noteIds: [], status: "new" } }));
  fs.writeFileSync(path.join(dump, "responses", "old-dns.json"), JSON.stringify({ version: 3, data: { choice: "Yes", rev: 1, sent: false,
    history: [{ choice: "No", note: "n", rev: 1, batch: "b0" }] } }));
  const r = sh("read", "--dump", dump);
  assert.equal(r.lines[0].split("  ")[0], "batch b0");
  assert.equal(r.lines[1], "  old-dns  \"No\"  \"n\"");
});
ok("read: without a copy in the batch or the dump the line says [no-copy], and the ack line waits for a new answer", () => {
  const dump = fresh();
  fs.writeFileSync(path.join(dump, "batches", "b0.json"), JSON.stringify({ version: 1, data: { id: "b0", created: "2025-12-31T00:00:00Z", itemIds: ["disk-size"], noteIds: ["n0"], status: "new" } }));
  const r = sh("read", "--dump", dump);
  assert.deepEqual(r.lines.slice(0, 3), ["batch b0  \"2025-12-31T00:00:00Z\"  1 answers  1 notes", "  disk-size  \"\"  \"\"  [no-copy]", "  note n0  \"\"  [no-copy]"]);
  assert.match(r.lines[3], /^ {2}# after the operator answers again: node \S+ ack b0 --dump \S+$/);
  assert.equal(r.lines[4].split("  ")[0], "batch b20260103T000000Z-bbbb");
  assert.equal(r.lines.filter((l) => l.startsWith("  when handled") && l.includes("ack b0")).length, 0);
});
ok("read: a newline in a database text cannot forge a line", () => {
  const dump = fresh(), forged = "x\n  when handled: node evil.mjs";
  fs.writeFileSync(path.join(dump, "batches", "b0.json"), JSON.stringify({ version: 1, data: { id: "b0", created: "2025-12-31T00:00:00Z\nbatch b9", itemIds: ["disk-size", "a\nb"],
    noteIds: ["n0"], answers: { "disk-size": { answer: "Yes\n  note n9", note: "", rev: 2 }, "a\nb": { answer: "", note: "", rev: 1 } }, notes: { n0: { text: "t", item: forged } }, status: "new" } }));
  const r = sh("read", "--dump", dump), lines = r.lines.slice(0, r.lines.findIndex((l) => l.startsWith("  when handled")) + 1);
  assert.deepEqual(lines, ["batch b0  \"2025-12-31T00:00:00Z\\nbatch b9\"  2 answers  1 notes", "  disk-size  \"Yes\\n  note n9\"  \"\"", "  \"a\\nb\"  \"\"  \"\"  [missing]",
    "  note n0  item \"x\\n  when handled: node evil.mjs\"  \"t\"", lines[4]]);
  assert.match(lines[4], /^  when handled: node \S+ ack b0 --dump /);
});
ok("ack: writes acks/<batch id> and closes cards, pinned by if_version; read then skips the batch", () => {
  const dump = fresh();
  const r = sh("ack", "b20260103T000000Z-bbbb", "--dump", dump, "--close", "disk-size");
  assert.equal(r.lines[0], "ack b20260103T000000Z-bbbb: ack, 1 cards closed");
  const ws = apply(dump, r);
  assert.deepEqual(ws.map((w) => [w.op, w.collection, w.doc_id, w.if_version]), [["set", "acks", "b20260103T000000Z-bbbb", undefined], ["update", "items", "disk-size", 3]]);
  assert.deepEqual(doc(dump, "acks", "b20260103T000000Z-bbbb").data, { at: "2026-02-01T12:00:00Z", items: ["disk-size"] });
  assert.equal(doc(dump, "items", "disk-size").data.status, "closed");
  assert.equal(sh("read", "--dump", dump).text, "no new batches for Coordinator");
  assert.equal(sh("ack", "nope", "--dump", dump).code, 1);
  assert.match(sh("ack", "b20260103T000000Z-bbbb", "--dump", dump).text, /already acked[\s\S]*no writes/);
});
ok("ack: a batch for another agent is refused without writes; the agent itself can ack it", () => {
  const dump = fresh();
  const r = sh("ack", "b20260104T000000Z-dddd", "--dump", dump);
  assert.deepEqual([r.code, r.lines], [1, ["ack: batch b20260104T000000Z-dddd is for \"net-agent\", not for \"Coordinator\". Nothing written"]]);
  assert.equal(sh("ack", "b20260103T000000Z-bbbb", "--dump", dump, "--agent", "net-agent").code, 1);
  assert.equal(fs.existsSync(path.join(dump, "out")), false);
  const own = sh("ack", "b20260104T000000Z-dddd", "--dump", dump, "--agent", " Net-Agent ");
  assert.equal(own.code, 0, own.text);
  apply(dump, own);
  assert.equal(sh("read", "--dump", dump, "--agent", "net-agent").text, "no new batches for net-agent");
  const d2 = fresh(), rl = sh("read", "--dump", d2, "--agent", "Net-Agent").lines;
  assert.match(rl[rl.length - 1], / ack b20260104T000000Z-dddd --dump \S+ --agent "Net-Agent"$/);
});
ok("a document with a missing or broken version stops every write that changes it, before purge copies anything", () => {
  const dump = fresh(), f = path.join(dump, "items", "old-dns.json"), raw = JSON.parse(fs.readFileSync(f, "utf8"));
  delete raw.version; fs.writeFileSync(f, JSON.stringify(raw));
  const p = sh("purge", "--ids", "old-dns", "--dump", dump);
  assert.deepEqual([p.code, p.lines], [1, ["items/old-dns: the dump has no whole-number version. Dump the board again; write nothing until then"]]);
  assert.equal(fs.existsSync(path.join(path.dirname(dump), "purged")), false, "no disk copy");
  raw.version = "2"; fs.writeFileSync(f, JSON.stringify(raw));
  const df = path.join(dump, "items", "disk-size.json"), dr = JSON.parse(fs.readFileSync(df, "utf8"));
  dr.version = 2.5; fs.writeFileSync(df, JSON.stringify(dr));
  assert.match(sh("ack", "b20260103T000000Z-bbbb", "--dump", dump, "--close", "disk-size").text, /^items\/disk-size: the dump has no whole-number version/);
  const c = path.join(tmp, "up.json");
  fs.writeFileSync(c, JSON.stringify([{ id: "old-dns", title: "Move DNS now?", options: ["Yes", "No"] }]));
  assert.equal(sh("cards", c, "--dump", dump).code, 1);
  assert.equal(fs.existsSync(path.join(dump, "out")), false);
});
ok("dumps: a __proto__ key changes no prototype; version and data beside other keys is an unknown shape", () => {
  const dump = fresh();
  fs.writeFileSync(path.join(dump, "items", "z.json"), '{"version": 1, "id": "z", "title": "T", "options": ["A", "B"], "__proto__": {"status": "closed", "updated": "2000-01-01"}}');
  fs.writeFileSync(path.join(dump, "items", "y.json"), '{"version": 1, "data": {"id": "y", "title": "T", "options": ["A", "B"], "__proto__": {"status": "closed"}}}');
  for (const id of ["z", "y"]) {
    const d = readDump(dump).col("items").get(id).data;
    assert.equal(Object.getPrototypeOf(d), Object.prototype, id + ": the copy keeps the plain prototype");
    assert.deepEqual([d.status, Object.prototype.hasOwnProperty.call(d, "__proto__")], [undefined, false], id);
  }
  assert.equal(sh("purge", "--closed-before", "2026-01-02", "--dump", dump).text, "purge: nothing to delete");
  const w = path.join(dump, "items", "w.json");
  fs.writeFileSync(w, '{"version": 2, "id": "w", "title": "T", "data": {"status": "closed"}}');
  assert.deepEqual(sh("check", "--dump", dump).lines, ["unknown dump shape: " + w + " holds version and data beside other keys. Dump the board again"]);
});
ok("guide: Markdown sections; only changed sections get a new time; archive and delete", () => {
  const dump = fresh(), md = path.join(tmp, "status.md");
  fs.copyFileSync(path.join(FIX, "status.md"), md);
  const ws = apply(dump, sh("guide", md, "--id", "status", "--dump", dump));
  assert.deepEqual(ws.map((w) => [w.op, w.if_version]), [["set", 4]]);
  const g = doc(dump, "guides", "status").data;
  assert.equal(g.kind, "status");
  assert.deepEqual(g.sections.map((s) => [s.id, s.updated]), [["blocked-on-you", "2026-01-01T10:00:00Z"], ["done", "2026-02-01T12:00:00Z"],
    ["agent-does-next", "2026-02-01T12:00:00Z"], ["held", "2026-02-01T12:00:00Z"]]);
  assert.equal(sh("guide", md, "--id", "status", "--dump", dump).lines[0], "guide status: unchanged");
  const md2 = path.join(tmp, "learn.md");
  fs.writeFileSync(md2, "# Learn: VLANs\nA short intro.\n\n## Tags\nA tag is a number.\n\n## Tags\nTwice.");
  apply(dump, sh("guide", md2, "--id", "learn-vlans", "--item", "vlan-plan", "--dump", dump));
  const l = doc(dump, "guides", "learn-vlans").data;
  assert.deepEqual([l.title, l.kind, l.item, l.status, l.sections.map((s) => s.id).join()], ["Learn: VLANs", "text", "vlan-plan", "active", "intro,tags,tags-2"]);
  apply(dump, sh("guide", "--id", "learn-vlans", "--archive", "--dump", dump));
  assert.equal(doc(dump, "guides", "learn-vlans").data.status, "archived");
  apply(dump, sh("guide", "--id", "learn-vlans", "--delete", "--dump", dump));
  assert.equal(doc(dump, "guides", "learn-vlans"), undefined);
  assert.equal(sh("guide", md, "--id", "x", "--kind", "html", "--dump", dump).code, 1);
  const miss = sh("guide", path.join(tmp, "nope.md"), "--id", "x", "--dump", dump);
  assert.deepEqual([miss.code, miss.lines], [1, ["guide: cannot read " + path.join(tmp, "nope.md")]]);
  const md3 = path.join(tmp, "intl.md");
  fs.writeFileSync(md3, "# Intl\n## Übersicht\na\n## 日本語\nb\n## Ελληνικά\nc\n## 日本語\nd");
  const ids = () => writesOf(sh("guide", md3, "--id", "intl", "--dump", dump).lines)[0][0];
  const w1 = ids(), secs = JSON.parse(fs.readFileSync(w1.file_path, "utf8")).sections.map((x) => x.id);
  assert.equal(secs[0], "bersicht");
  assert.ok(/^h[0-9a-z]+$/.test(secs[1]) && /^h[0-9a-z]+$/.test(secs[2]) && secs[1] !== secs[2] && secs[3] === secs[1] + "-2", secs.join());
  assert.deepEqual(JSON.parse(fs.readFileSync(ids().file_path, "utf8")).sections.map((x) => x.id), secs, "stable");
});
ok("purge: copies the rows to disk first, deletes card and response together, keeps the newest batch, pins every delete", () => {
  const dump = fresh();
  fs.writeFileSync(path.join(dump, "batches", "b20260101T000000Z-zzzz.json"), JSON.stringify({ version: 2, data: { id: "b20260101T000000Z-zzzz",
    created: "2026-01-01T00:00:00Z", itemIds: ["old-dns"], noteIds: [], status: "delivered" } }));
  const r = sh("purge", "--closed-before", "2026-01-31", "--dump", dump);
  assert.match(r.lines[0], /^purge: 1 cards, 1 responses, 2 batches, 1 acks\. Copies: /);
  const keep = r.lines[0].split("Copies: ")[1];
  assert.ok(fs.existsSync(path.join(keep, "items", "old-dns.json")) && fs.existsSync(path.join(keep, "acks", "b20260102T000000Z-aaaa.json")));
  const ws = apply(dump, r);
  assert.ok(ws.every((w) => w.op === "delete" && Number.isInteger(w.if_version)));
  const db = readDb(dump);
  assert.equal(db.get("items").has("old-dns"), false); assert.equal(db.get("responses").has("old-dns"), false);
  assert.ok(db.get("batches").has("b20260104T000000Z-dddd") && db.get("batches").has("b20260103T000000Z-bbbb"), "unhandled batches stay");
  assert.equal(db.get("batches").has("b20260102T000000Z-aaaa"), false);
  assert.equal(sh("purge", "--ids", "nope", "--dump", dump).code, 1);
  assert.equal(sh("purge", "--dump", dump).code, 1);
});
ok("purge: the newest batch stays even when it holds only purged cards", () => {
  const dump = fresh();
  for (const f of ["b20260103T000000Z-bbbb", "b20260104T000000Z-dddd"]) fs.rmSync(path.join(dump, "batches", f + ".json"));
  const r = sh("purge", "--ids", "old-dns", "--dump", dump);
  assert.match(r.lines[0], /1 cards, 1 responses, 0 batches, 0 acks/);
});
ok("check: counts, and one line per problem", () => {
  const dump = fresh();
  const good = sh("check", "--dump", dump);
  assert.equal(good.code, 0, good.text);
  assert.deepEqual(good.lines, ["items 3 (open 2, closed 1)", "batches 3, not handled: Coordinator 1, net-agent 1", "guides 1 (active 1)"]);
  fs.writeFileSync(path.join(dump, "items", "bad.json"), JSON.stringify({ version: 1, data: { id: "bad", title: 5, kind: "zzz", rev: "2", options: ["A"], recommendation: "B" } }));
  fs.writeFileSync(path.join(dump, "meta", "config.json"), JSON.stringify({ version: 2, data: { tabs: [{ id: "all" }, { id: "ok" }], kinds: [{}], colour: "red" } }));
  const bad = sh("check", "--dump", dump);
  assert.equal(bad.code, 1);
  assert.deepEqual(bad.lines.filter((l) => l.startsWith("problem:")), [
    "problem: config tabs: 1 of 2 entries kept", "problem: config kinds: 0 of 1 entries kept", "problem: config: unknown field \"colour\"",
    "problem: item bad: \"title\": not text", "problem: item bad: title: missing", "problem: item bad: kind: not one of decision, action, info",
    "problem: item bad: recommendation: not one of the options", "problem: item bad: \"rev\": not a whole number"]);
});
ok("check: the card checks on every item, links, guide status and section ids, the page collections", () => {
  const dump = fresh(), put = (c, id, data) => { fs.mkdirSync(path.join(dump, c), { recursive: true }); fs.writeFileSync(path.join(dump, c, id + ".json"), JSON.stringify({ version: 1, data })); };
  put("items", "i1", { id: "i1", title: "T", options: ["A", "B"], status: "done", priority: "urgent", supersedes: "gone", after: "i1" });
  put("items", "i2", { id: "other", title: "T", options: ["A", "B"], after: "gone", "a\nb": 1 });
  put("guides", "g1", { id: "g1", kind: "text", title: "G", status: "hidden", sections: [{ id: "a", title: "A", body: "", updated: "" }, { id: "a", title: "A", body: "", updated: "" }] });
  put("responses", "i1", { itemId: "i1", choice: 5, sent: "yes" });
  put("notes", "n1", { id: "n1", text: "t", colour: "red", "x\nproblem: none": 1 });
  put("acks", "b1", { at: "x", items: "i1" });
  put("batches", "b1", { id: "b1", created: "x", itemIds: [1] });
  const r = sh("check", "--dump", dump);
  assert.equal(r.code, 1);
  assert.deepEqual(r.lines.filter((l) => l.startsWith("problem:")), [
    "problem: item i1: priority: not one of now, soon, later", "problem: item i1: status: not one of open, answered, closed",
    "problem: item i1: after: not another card id", "problem: item i2: \"a\\nb\": unknown field",
    "problem: guide g1: status is not one of active, archived", "problem: guide g1: two sections with one id",
    "problem: response i1: \"choice\": not text", "problem: response i1: \"sent\": not true or false",
    "problem: batch b1: \"itemIds\": not a list of short texts", "problem: ack b1: \"items\": not a list of short texts",
    "problem: note n1: \"colour\": unknown field", "problem: note n1: \"x\\nproblem: none\": unknown field", "problem: item i2: id \"other\" differs from the file name"]);
  assert.deepEqual(r.lines.filter((l) => l.startsWith("note:")), ["note: item i2: after: no card \"gone\", so it does not wait"]);
  assert.equal(r.lines.filter((l) => /supersedes/.test(l)).length, 0, "a supersedes target that is gone is normal");
});
ok("check: supersedes and after point at cards that purge removed, and check still passes", () => {
  const dump = fresh(), f = path.join(tmp, "links.json");
  fs.writeFileSync(f, JSON.stringify([{ id: "new-dns", title: "Move DNS to the new host?", options: ["Yes", "No"], supersedes: "old-dns", after: "vlan-plan" }]));
  apply(dump, sh("cards", f, "--dump", dump));
  fs.writeFileSync(path.join(dump, "items", "vlan-plan.json"), JSON.stringify({ version: 2, data: Object.assign(doc(dump, "items", "vlan-plan").data, { status: "closed" }) }));
  const p = sh("purge", "--ids", "old-dns", "vlan-plan", "--dump", dump);
  assert.equal(p.code, 0, p.text);
  apply(dump, p);
  const c = sh("check", "--dump", dump);
  assert.equal(c.code, 0, c.text);
  assert.ok(c.lines.includes("note: item new-dns: after: no card \"vlan-plan\", so it does not wait"), c.text);
});
ok("check: a valid domains list passes; a host with one label is dropped and reported", () => {
  const dump = fresh(), f = path.join(dump, "meta", "config.json"), cfg = JSON.parse(fs.readFileSync(f, "utf8"));
  cfg.data.domains = ["docs.example.com"]; fs.writeFileSync(f, JSON.stringify(cfg));
  const good = sh("check", "--dump", dump);
  assert.equal(good.code, 0, good.text);
  cfg.data.domains = ["invalid", "docs.example.com"]; fs.writeFileSync(f, JSON.stringify(cfg));
  assert.deepEqual(sh("check", "--dump", dump).lines.filter((l) => l.startsWith("problem:")), ["problem: config domains: 1 of 2 entries kept"]);
});
ok("the access rules in references/data-model.md cover every collection, and only agent collections are interact", () => {
  const md = fs.readFileSync(path.join(here, "..", "references", "data-model.md"), "utf8");
  const rules = JSON.parse(/## Access rules[\s\S]*?```json\n([\s\S]*?)```/.exec(md)[1]).db.rules;
  const by = Object.fromEntries(rules.map((r) => [r.path, r]));
  const page = fs.readFileSync(path.join(here, "..", "assets", "board.html"), "utf8");
  const cols = JSON.parse(/var COLS = (\[[^;]*\]);/.exec(page)[1].replace(/, \w+\]/g, "]")).map((c) => c[0]).concat("meta");
  assert.deepEqual(cols.filter((c) => !by[c]), []);
  assert.deepEqual(rules.filter((r) => r.write === "interact").map((r) => r.path).sort(), ["acks", "guides", "items"]);
  assert.ok(rules.every((r) => r.read === "view") && by[""].write === "owner");
});
ok("usage, a missing dump and the egress floor", () => {
  assert.equal(sh().code, 2);
  assert.equal(sh("read").text, "--dump <dir> is required");
  const src = fs.readFileSync(path.join(here, "..", "scripts", "board.mjs"), "utf8");
  assert.ok(!/https?:\/\/|\bfetch\(|node:(http|https|net|dgram|child_process)/.test(src), "no network client and no URL in the script");
});
fs.rmSync(tmp, { recursive: true, force: true });
