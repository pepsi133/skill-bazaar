// A stand-in for the artifact database in the tests. Not a test itself.
// A directory plays the database: <dir>/<collection>/<doc id>.json holds {version, data}. dump copies it
// as ArtifactData list with out_dir does: data-only files, and the versions only in the reply lines.
// applyBatch follows the ArtifactData batch contract: 1 to 50 writes, at most 1 MiB, if_version on
// every existing document, all or nothing. File names encode ":" as %3A, as board.mjs does.
import fs from "node:fs";
import path from "node:path";

const fname = (id) => id.replace(/%/g, "%25").replace(/:/g, "%3A");
const unname = (f) => f.replace(/%3A/gi, ":").replace(/%25/g, "%");
export function readDb(dir) {
  const db = new Map();
  if (!fs.existsSync(dir)) return db;
  for (const c of fs.readdirSync(dir)) {
    const sub = path.join(dir, c);
    if (c === "out" || !fs.statSync(sub).isDirectory()) continue;
    const m = new Map();
    for (const f of fs.readdirSync(sub).filter((x) => x.endsWith(".json"))) {
      const raw = JSON.parse(fs.readFileSync(path.join(sub, f), "utf8"));
      const wrapped = raw && raw.data && typeof raw.data === "object";
      const data = wrapped ? raw.data : Object.assign({}, raw);
      if (!wrapped) delete data.version;
      m.set(unname(f.slice(0, -5)), { version: Number(raw.version), data });
    }
    db.set(c, m);
  }
  return db;
}
export function writeDb(dir, db) {
  for (const [c, m] of db) {
    const sub = path.join(dir, c);
    fs.mkdirSync(sub, { recursive: true });
    for (const f of fs.readdirSync(sub)) if (f.endsWith(".json") && !m.has(unname(f.slice(0, -5)))) fs.rmSync(path.join(sub, f));
    for (const [id, d] of m) fs.writeFileSync(path.join(sub, fname(id) + ".json"), JSON.stringify({ version: d.version, data: d.data }, null, 1) + "\n");
  }
}
// The platform dump: <out>/<collection>/<doc id>.json holds only the data; the returned lines are the reply's
// document lines, which an agent saves to <out>/versions.txt.
export function dump(dir, out) {
  fs.rmSync(out, { recursive: true, force: true });
  const lines = [];
  for (const [c, m] of readDb(dir)) {
    if (!m.size) continue;
    fs.mkdirSync(path.join(out, c), { recursive: true });
    for (const [id, d] of m) {
      const f = path.resolve(out, c, fname(id) + ".json"), body = JSON.stringify(d.data);
      fs.writeFileSync(f, body);
      lines.push(`- ${JSON.stringify(id)}  ${Buffer.byteLength(body)} bytes  version ${d.version}  ${JSON.stringify(f)}`);
    }
  }
  return lines;
}
function merge(old, upd) {
  const out = Object.assign({}, old);
  for (const [k, v] of Object.entries(upd)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? merge(out[k], v) : v;
  return out;
}
export function applyBatch(dir, writes) {
  if (!Array.isArray(writes) || writes.length < 1 || writes.length > 50) throw new Error("batch: 1 to 50 writes, got " + (writes && writes.length));
  const db = readDb(dir);
  const bodies = writes.map((w) => (w.file_path ? JSON.parse(fs.readFileSync(w.file_path, "utf8")) : w.data));
  const size = JSON.stringify(writes).length + bodies.reduce((n, b) => n + (b ? JSON.stringify(b).length : 0), 0);
  if (size > 1024 * 1024) throw new Error("batch: more than 1 MiB");
  writes.forEach((w, i) => {
    if (!["set", "update", "delete"].includes(w.op)) throw new Error("batch: bad op " + w.op);
    const cur = (db.get(w.collection) || new Map()).get(w.doc_id);
    if (cur && w.if_version === undefined) throw new Error(`batch: ${w.collection}/${w.doc_id} exists, if_version is required`);
    if (cur && w.if_version !== cur.version) throw new Error(`db write failed (version_mismatch): the document is no longer at version ${w.if_version}, the one this write was pinned to — it is now at version ${cur.version}; nothing was written`);
    if (!cur && w.op !== "set") throw new Error(`batch: ${w.collection}/${w.doc_id} does not exist`);
    if (w.op !== "delete" && (!bodies[i] || typeof bodies[i] !== "object" || Array.isArray(bodies[i]))) throw new Error("batch: a body must be an object");
  });
  writes.forEach((w, i) => {
    if (!db.has(w.collection)) db.set(w.collection, new Map());
    const m = db.get(w.collection), cur = m.get(w.doc_id);
    if (w.op === "delete") m.delete(w.doc_id);
    else m.set(w.doc_id, { version: (cur ? cur.version : 0) + 1, data: w.op === "set" ? bodies[i] : merge(cur.data, bodies[i]) });
  });
  writeDb(dir, db);
}
// The writes arrays that board.mjs printed: every line after a "batch i of n" line.
export function writesOf(lines) {
  const out = [];
  lines.forEach((l, i) => { if (/^batch \d+ of \d+:/.test(l)) out.push(JSON.parse(lines[i + 1])); });
  return out;
}
