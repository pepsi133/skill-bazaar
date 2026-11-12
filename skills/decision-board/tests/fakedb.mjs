// A stand-in for the artifact database in the tests. Not a test itself.
// A dump directory plays the database: <dir>/<collection>/<doc id>.json holds {version, data}.
// applyBatch follows the ArtifactData batch contract: 1 to 50 writes, at most 1 MiB, if_version on
// every existing document, all or nothing, {"__delete__": true} in an update removes a field.
import fs from "node:fs";
import path from "node:path";

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
      m.set(f.slice(0, -5), { version: Number(raw.version), data });
    }
    db.set(c, m);
  }
  return db;
}
export function writeDb(dir, db) {
  for (const [c, m] of db) {
    const sub = path.join(dir, c);
    fs.mkdirSync(sub, { recursive: true });
    for (const f of fs.readdirSync(sub)) if (f.endsWith(".json") && !m.has(f.slice(0, -5))) fs.rmSync(path.join(sub, f));
    for (const [id, d] of m) fs.writeFileSync(path.join(sub, id + ".json"), JSON.stringify({ version: d.version, data: d.data }, null, 1) + "\n");
  }
}
function merge(old, upd) {
  const out = Object.assign({}, old);
  for (const [k, v] of Object.entries(upd)) {
    if (v && typeof v === "object" && v.__delete__ === true) delete out[k];
    else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = merge(out[k], v);
    else out[k] = v;
  }
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
    if (cur && w.if_version !== cur.version) throw new Error(`batch: ${w.collection}/${w.doc_id} is at version ${cur.version}, not ${w.if_version}`);
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
