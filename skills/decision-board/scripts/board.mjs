#!/usr/bin/env node
// The script layer of the decision board. Node 18 or later, no dependencies, no network access.
// It reads documents that ArtifactData list or query saved with out_dir, and it writes one JSON file
// per document into <dump>/out/ and prints the `writes` array of one ArtifactData batch call.
// The fields, kinds and limits come from the page itself (assets/board.html, the part between
// "pure: start" and "pure: end"), so the page and this script cannot drift.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.relative(process.cwd(), fileURLToPath(import.meta.url)) || "board.mjs";
const USAGE = `Usage: node ${SELF} <command> --dump <dir> ...
  cards <file.json|file.md>        add or change cards; a .md file holds them under "## Board items"
  read [--agent <name>]            print the batches that wait for you
  ack <batch id> [--close <id>...] mark a batch handled, and close cards
  guide [<file.md>] --id <id> [--kind text|status|reference] [--item <card id>] [--archive | --delete]
  purge (--ids <id>... | --closed-before <YYYY-MM-DD>)
  check                            validate the board and print counts
<dir> holds the ArtifactData dumps: <dir>/<collection>/<doc id>.json.`;

// ---- the shared definitions of the page
function loadPage() {
  const file = path.join(HERE, "..", "assets", "board.html"), page = fs.readFileSync(file, "utf8");
  const i = page.indexOf("  // ---- pure: start"), j = page.indexOf("  // ---- pure: end", i + 1);
  if (i < 0 || j < 0) throw new Error("the pure markers are missing in " + file);
  const ctx = vm.createContext({ items: new Map(), resp: new Map(), notes: new Map(), guides: new Map(), batches: new Map(), acks: new Map(),
    f: { area: "", prio: "", hide: true, closed: false, tab: "all" }, loaded: { config: true }, isPending: () => false });
  vm.runInContext(page.slice(i, j), ctx, { filename: file });
  return ctx;
}
const P = loadPage();
const S = P.SCHEMA;
const plain = (x) => JSON.parse(JSON.stringify(x));
const now = () => process.env.BOARD_NOW || new Date().toISOString().replace(/\.\d+Z$/, "Z");
const q = (s) => JSON.stringify(String(s));

class Stop extends Error {}
function fail(lines) { throw new Stop([].concat(lines).join("\n")); }

// ---- arguments: positionals, and flags that take every value up to the next flag
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0, key = null; i < argv.length; i++) {
    const v = argv[i];
    if (v.startsWith("--")) { key = v.slice(2); a[key] = a[key] || []; if (key === "archive" || key === "delete") key = null; }
    else if (key) a[key].push(v);
    else a._.push(v);
  }
  return a;
}
const one = (a, k) => (a[k] && a[k].length ? a[k][a[k].length - 1] : "");

// ---- dumps: <dir>/<collection>/<doc id>.json. A file holds {version, data} (and maybe id), or the fields with
// "version" beside them. Parsed data is copied key by key into a fresh object, never merged, so a key
// such as "__proto__" cannot change a prototype.
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const isPlain = (x) => !!x && typeof x === "object" && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
function ownCopy(o, keepUnsafe) {
  const out = {};
  for (const k of Object.keys(o)) {
    if (!UNSAFE.has(k)) out[k] = o[k];
    else if (keepUnsafe) Object.defineProperty(out, k, { value: o[k], enumerable: true, writable: true, configurable: true });
  }
  return out;
}
// Wrapped: exactly version and an object data, maybe id. Version and an object data beside other keys is no known shape.
function isWrapped(raw, file) {
  if (!isPlain(raw) || !isPlain(raw.data) || !Object.prototype.hasOwnProperty.call(raw, "version")) return false;
  if (Object.keys(raw).every((k) => k === "version" || k === "data" || k === "id")) return true;
  fail("unknown dump shape: " + file + " holds version and data beside other keys. Dump the board again");
}
// The version of a dumped document that a write pins. A missing or broken version stops the command.
function pin(collection, id, ex) {
  if (!ex) return undefined;
  if (!Number.isInteger(ex.version) || ex.version < 1) fail(`${collection}/${id}: the dump has no whole-number version. Dump the board again; write nothing until then`);
  return ex.version;
}
export function readDump(dir) {
  if (!dir) fail("--dump <dir> is required");
  if (!fs.existsSync(dir)) fail("no dump directory: " + dir);
  const cols = new Map();
  for (const name of fs.readdirSync(dir)) {
    const sub = path.join(dir, name);
    if (name === "out" || !fs.statSync(sub).isDirectory()) continue;
    const docs = new Map();
    for (const f of fs.readdirSync(sub).filter((x) => x.endsWith(".json"))) {
      let raw;
      try { raw = JSON.parse(fs.readFileSync(path.join(sub, f), "utf8")); } catch (e) { fail("cannot read " + path.join(sub, f) + ": " + e.message); }
      const wrapped = isWrapped(raw, path.join(sub, f)), data = wrapped ? ownCopy(raw.data) : isPlain(raw) ? ownCopy(raw) : {};
      const version = isPlain(raw) ? raw.version : undefined;
      if (!wrapped) delete data.version;
      docs.set(f.slice(0, -5), { data, version, raw });
    }
    cols.set(name, docs);
  }
  const col = (n) => cols.get(n) || new Map();
  const cfgDoc = col("meta").get("config");
  P.applyConfig(cfgDoc ? cfgDoc.data : null);
  return { dir, col };
}

// ---- writes: one file per document, then the writes arrays. At most 50 writes and about 1 MiB per batch call.
class Writes {
  constructor(dump) { this.dir = path.resolve(dump.dir, "out"); this.list = []; }
  file(collection, id, data) {
    const f = path.join(this.dir, collection, id + ".json");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(data, null, 1) + "\n");
    return f;
  }
  // ex is the dumped document, or undefined for a new one.
  put(op, collection, id, data, ex) {
    const version = pin(collection, id, ex), w = { op, collection, doc_id: id };
    if (version !== undefined) w.if_version = version;
    w.size = data ? JSON.stringify(data).length : 0;
    this.list.push({ w, data });
  }
  // The files go to disk only here, so a command that stops writes nothing.
  print(log) {
    this.list = this.list.map(({ w, data }) => {
      const { if_version, ...out } = w;
      if (data) out.file_path = this.file(w.collection, w.doc_id, data);
      if (if_version !== undefined) out.if_version = if_version;
      return out;
    });
    const chunks = [];
    let cur = [], bytes = 0;
    for (const w of this.list) {
      if (cur.length && (cur.length === 50 || bytes + w.size > 900000)) { chunks.push(cur); cur = []; bytes = 0; }
      cur.push(w); bytes += w.size + 200;
    }
    if (cur.length) chunks.push(cur);
    if (!chunks.length) { log("no writes"); return; }
    chunks.forEach((c, i) => {
      log(`batch ${i + 1} of ${chunks.length}: ${c.length} writes. Pass this array as "writes" to one ArtifactData batch call:`);
      log(JSON.stringify(c.map(({ size, ...w }) => w)));
    });
  }
}

// ---- cards
const CONTENT = ["title", "summary", "evidence", "options", "recommendation", "kind"];
const MANAGED = ["rev", "created", "updated"];
// The fields that the answer depends on. A change of one of them raises rev; other changes keep it.
const contentKey = (x) => { const c = P.coerce("item", x); return JSON.stringify(CONTENT.map((k) => (c[k] === undefined ? null : c[k]))); };
function parseCardFile(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { fail("cannot read " + file); }
  const h = /^## Board items[ \t]*$/m.exec(text);
  if (h) {
    let sec = text.slice(h.index + h[0].length);
    const next = /^## /m.exec(sec);
    if (next) sec = sec.slice(0, next.index);
    const fence = /```[a-z]*\n([\s\S]*?)```/.exec(sec);
    text = fence ? fence[1] : sec.slice(sec.indexOf("["), sec.lastIndexOf("]") + 1);
  } else if (/\.md$/i.test(file)) fail(file + ": no \"## Board items\" section");
  let v;
  try { v = JSON.parse(text); } catch (e) { fail(file + ": the cards are not valid JSON: " + e.message); }
  return Array.isArray(v) ? v : [v];
}
function cardProblems(c, name, ids, qk) {
  const out = [];
  if (!P.isObj(c)) return [name + ": not an object"];
  const body = ownCopy(c, true);
  MANAGED.forEach((k) => delete body[k]);
  out.push(...P.problems("item", body, qk));
  if (typeof c.id !== "string" || !S.idRe.test(c.id)) out.push("id: use 1 to 100 of A-Z a-z 0-9 _ - . ~ : @ +");
  else if (ids.has(c.id)) out.push("id: twice in this file");
  if (typeof c.title !== "string" || !c.title.trim()) out.push("title: missing");
  if (c.kind !== undefined && !P.cfg.kinds.some((k) => k.id === c.kind)) out.push("kind: not one of " + P.cfg.kinds.map((k) => k.id).join(", "));
  if (c.priority !== undefined && !P.cfg.priorities.some((k) => k.id === c.priority)) out.push("priority: not one of " + P.cfg.priorities.map((k) => k.id).join(", "));
  if (c.status !== undefined && !S.statuses.includes(c.status)) out.push("status: not one of " + S.statuses.join(", "));
  if (Array.isArray(c.options)) {
    if (c.options.length > S.max.options) out.push("options: more than " + S.max.options);
    else if (c.options.length < 2 && (c.kind === undefined ? P.cfg.kinds[0].id : c.kind) === "decision") out.push("options: a decision card needs 2 to " + S.max.options);
    if (new Set(c.options).size !== c.options.length || c.options.some((o) => typeof o === "string" && !o.trim())) out.push("options: empty or repeated");
  }
  if (typeof c.recommendation === "string" && c.recommendation && !P.optionsOf(P.coerce("item", c)).includes(c.recommendation)) out.push("recommendation: not one of the options");
  ["supersedes", "after"].forEach((k) => { if (typeof c[k] === "string" && c[k] && (!S.idRe.test(c[k]) || c[k] === c.id)) out.push(k + ": not another card id"); });
  return out.map((p) => name + ": " + p);
}
function cmdCards(a, log) {
  const file = a._[1];
  if (!file) fail("cards: name the card file");
  const dump = readDump(one(a, "dump")), items = dump.col("items"), cards = parseCardFile(file), ids = new Set(), errs = [];
  cards.forEach((c, i) => { errs.push(...cardProblems(c, c && typeof c.id === "string" && c.id ? c.id : "#" + (i + 1), ids)); if (c && typeof c.id === "string") ids.add(c.id); });
  if (errs.length) fail(errs);
  const w = new Writes(dump), t = now(), n = { new: 0, rev: 0, changed: 0, same: 0, replaced: 0 };
  const defPri = P.cfg.priorities[Math.min(1, P.cfg.priorities.length - 1)].id;
  for (const c of cards) {
    const ex = items.get(c.id), old = ex ? plain(P.coerce("item", ex.data)) : null, doc = { id: c.id };
    for (const k of Object.keys(S.item)) if (k !== "id" && !MANAGED.includes(k) && c[k] !== undefined) doc[k] = c[k];
    doc.priority = c.priority || (old && old.priority) || defPri;
    const content = !old || contentKey(doc) !== contentKey(old);
    doc.status = c.status || (old && !content ? old.status : "open") || "open";
    const strip = (x) => { const y = plain(P.coerce("item", x)); MANAGED.forEach((k) => delete y[k]); return JSON.stringify(y); };
    if (old && strip(doc) === strip(ex.data)) { n.same++; continue; }
    doc.rev = old ? old.rev + (content ? 1 : 0) : 1;
    doc.created = (old && old.created) || t;
    doc.updated = t;
    w.put("set", "items", c.id, doc, ex);
    if (!old) n.new++; else if (content) n.rev++; else n.changed++;
    const prev = doc.supersedes && items.get(doc.supersedes);
    if (prev && !ids.has(doc.supersedes) && P.coerce("item", prev.data).status !== "closed") {
      w.put("update", "items", doc.supersedes, { status: "closed", updated: t }, prev);
      n.replaced++;
    }
  }
  log(`cards: ${n.new} new, ${n.rev} changed (rev up), ${n.changed} changed (same rev), ${n.same} unchanged, ${n.replaced} closed as replaced`);
  w.print(log);
}

// ---- read. Every database text goes through q(), and an id that is not a plain id too, so no value can forge a line.
const qid = (s) => (S.idRe.test(s) ? s : q(s));
function cmdRead(a, log) {
  const dump = readDump(one(a, "dump")), acks = dump.col("acks"), items = dump.col("items"), resps = dump.col("responses"), notes = dump.col("notes");
  const agent = P.agentKey(one(a, "agent"));
  const list = Array.from(dump.col("batches").entries()).map(([id, d]) => Object.assign(P.coerce("batch", d.data), { id }))
    .filter((b) => !P.isHandled(b, acks) && P.agentKey(b.for) === agent).sort((x, y) => (x.created < y.created ? -1 : 1));
  if (!list.length) { log("no new batches for " + P.agentName(agent)); return; }
  for (const b of list) {
    let noCopy = false;
    log(`batch ${qid(b.id)}  ${q(b.created)}  ${b.itemIds.length} answers  ${b.noteIds.length} notes`);
    for (const id of b.itemIds) {
      let x = b.answers[id];
      const flags = [];
      if (!x) {
        // A batch from a page before 0.3.0 has no copy: take the response, or the entry of its history, with this batch id.
        const r = resps.get(id) ? P.coerce("response", resps.get(id).data) : null;
        const hx = r ? [r].concat(r.history).filter((h) => h.batch === b.id).pop() : null;
        if (!hx) { flags.push("[no-copy]"); noCopy = true; }
        x = hx ? { answer: hx.choice, note: hx.note, rev: hx.rev } : { answer: "", note: "", rev: 1 };
      }
      const it = items.get(id) ? P.coerce("item", items.get(id).data) : null;
      if (!it) flags.push("[missing]");
      else if (!flags.length) {
        if (x.rev < it.rev) flags.push("[stale-rev]");
        if (x.note && !x.answer && P.optionsOf(it).length) flags.push("[question]");
      }
      log(`  ${qid(id)}  ${q(x.answer)}  ${q(x.note)}${flags.length ? "  " + flags.join(" ") : ""}`);
    }
    for (const id of b.noteIds) {
      let nb = b.notes[id] || (notes.get(id) ? P.coerce("note", notes.get(id).data) : null), flag = "";
      if (!nb) { nb = { text: "", item: "" }; flag = "  [no-copy]"; noCopy = true; }
      log(`  note ${qid(id)}${nb.item ? "  item " + q(nb.item) : ""}  ${q(nb.text)}${flag}`);
    }
    const ackLine = `node ${SELF} ack ${qid(b.id)} --dump ${one(a, "dump")}${agent ? " --agent " + q(one(a, "agent").trim()) : ""}`;
    log(noCopy ? "  # after the operator answers again: " + ackLine : "  when handled: " + ackLine);
  }
}

// ---- ack. Only a batch for this agent: no --agent means the default agent of the config.
function cmdAck(a, log) {
  const bid = a._[1], dump = readDump(one(a, "dump")), b = bid && dump.col("batches").get(bid), items = dump.col("items");
  if (!b) fail("ack: no batch " + (bid || "named") + " in the dump");
  const batch = P.coerce("batch", b.data), agent = P.agentKey(one(a, "agent"));
  if (P.agentKey(batch.for) !== agent) fail(`ack: batch ${bid} is for ${q(P.agentName(P.agentKey(batch.for)))}, not for ${q(P.agentName(agent))}. Nothing written`);
  const close = a.close || [], missing = close.filter((id) => !items.has(id));
  if (missing.length) fail("ack: no card " + missing.join(", ") + " in the dump");
  const w = new Writes(dump), t = now(), acked = dump.col("acks").has(bid);
  if (!acked) w.put("set", "acks", bid, { at: t, items: batch.itemIds });
  for (const id of close) if (P.coerce("item", items.get(id).data).status !== "closed") w.put("update", "items", id, { status: "closed", updated: t }, items.get(id));
  log(`ack ${bid}: ${acked ? "already acked" : "ack"}, ${w.list.length - (acked ? 0 : 1)} cards closed`);
  w.print(log);
}

// ---- guide
// A heading without ASCII letters or digits gets an id from a short stable hash of its text (FNV-1a).
function hashId(s) { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return "h" + h.toString(36); }
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || hashId(s); }
function parseGuide(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let title = "";
  if (/^# /.test(lines[0] || "")) title = lines.shift().slice(2).trim();
  const secs = [], used = new Set();
  let cur = { title: "", body: [] };
  const end = () => {
    const body = cur.body.join("\n").trim();
    if (!cur.title && !body) return;
    let id = cur.title ? slug(cur.title) : "intro", k = 2;
    while (used.has(id)) id = slug(cur.title || "intro") + "-" + k++;
    used.add(id);
    secs.push({ id, title: cur.title, body });
  };
  for (const ln of lines) {
    const m = /^## (.+)$/.exec(ln);
    if (m) { end(); cur = { title: m[1].trim(), body: [] }; } else cur.body.push(ln);
  }
  end();
  return { title, secs };
}
function cmdGuide(a, log) {
  const id = one(a, "id"), dump = readDump(one(a, "dump")), ex = dump.col("guides").get(id), w = new Writes(dump), t = now();
  if (!S.idRe.test(id)) fail("guide: --id <id> with 1 to 100 of A-Z a-z 0-9 _ - . ~ : @ +");
  const old = ex ? plain(P.coerce("guide", ex.data)) : null;
  if (a.delete || a.archive) {
    if (!ex) fail("guide: no guide " + id + " in the dump");
    if (a.delete) w.put("delete", "guides", id, null, ex);
    else if (old.status !== "archived") w.put("update", "guides", id, { status: "archived", updated: t }, ex);
    log(`guide ${id}: ${a.delete ? "delete" : "archive"}`);
    return w.print(log);
  }
  const file = a._[1];
  if (!file) fail("guide: name the Markdown file, or use --archive or --delete");
  const kind = one(a, "kind") || (old && old.kind) || "text";
  if (!S.guideKinds.includes(kind)) fail("guide: --kind is one of " + S.guideKinds.join(", "));
  const item = a.item ? one(a, "item") : (old ? old.item : "");
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { fail("guide: cannot read " + file); }
  const g = parseGuide(text), prev = new Map((old ? old.sections : []).map((s) => [s.id, s]));
  const sections = g.secs.map((s) => {
    const p = prev.get(s.id);
    return Object.assign(s, { updated: p && p.title === s.title && p.body === s.body ? p.updated : t });
  });
  const doc = { id, kind, title: g.title || (old && old.title) || id, sections, status: old ? old.status || "active" : "active",
    created: (old && old.created) || t, updated: t };
  if (item) doc.item = item;
  const errs = P.problems("guide", doc);
  if (JSON.stringify(doc).length > S.max.g) errs.push("the guide is longer than " + S.max.g + " characters");
  if (errs.length) fail(errs.map((e) => "guide " + id + ": " + e));
  const norm = (x) => { const y = plain(P.coerce("guide", x)); y.updated = ""; y.body = ""; return JSON.stringify(y); };
  const same = old && norm(doc) === norm(ex.data);
  if (same) { log(`guide ${id}: unchanged`); return w.print(log); }
  w.put("set", "guides", id, doc, ex);
  log(`guide ${id}: ${sections.filter((s) => s.updated === t).length} of ${sections.length} sections changed`);
  w.print(log);
}

// ---- purge: copy every row to disk, then delete items with their responses, and the handled batches
// that hold only purged items, except the newest batch.
function cmdPurge(a, log) {
  const dump = readDump(one(a, "dump")), items = dump.col("items"), resps = dump.col("responses"), batches = dump.col("batches"), acks = dump.col("acks");
  let ids = a.ids || [];
  const before = one(a, "closed-before");
  if (!ids.length && !before) fail("purge: give --ids <id>... or --closed-before <YYYY-MM-DD>");
  if (before) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(before)) fail("purge: --closed-before takes a date such as 2026-01-31");
    ids = ids.concat(Array.from(items.entries()).filter(([, d]) => { const it = P.coerce("item", d.data); return it.status === "closed" && it.updated < before; }).map(([id]) => id));
  }
  ids = Array.from(new Set(ids));
  const missing = ids.filter((id) => !items.has(id));
  if (missing.length) fail("purge: no card " + missing.join(", ") + " in the dump");
  const gone = new Set(ids), rows = [];
  ids.forEach((id) => { rows.push(["items", id, items.get(id)]); if (resps.has(id)) rows.push(["responses", id, resps.get(id)]); });
  const all = Array.from(batches.entries()).map(([id, d]) => Object.assign(P.coerce("batch", d.data), { id }));
  const newest = all.slice().sort((x, y) => (x.created < y.created ? 1 : -1))[0];
  all.filter((b) => b !== newest && b.itemIds.length && !b.noteIds.length && b.itemIds.every((x) => gone.has(x)) && P.isHandled(b, acks))
    .forEach((b) => { rows.push(["batches", b.id, batches.get(b.id)]); if (acks.has(b.id)) rows.push(["acks", b.id, acks.get(b.id)]); });
  if (!rows.length) { log("purge: nothing to delete"); return; }
  rows.forEach(([c, id, d]) => pin(c, id, d));
  const keep = path.resolve(path.dirname(path.resolve(dump.dir)), "purged", now().replace(/[-:]/g, ""));
  for (const [c, id, d] of rows) {
    fs.mkdirSync(path.join(keep, c), { recursive: true });
    fs.writeFileSync(path.join(keep, c, id + ".json"), JSON.stringify(d.raw, null, 1) + "\n");
  }
  const w = new Writes(dump);
  rows.forEach(([c, id, d]) => w.put("delete", c, id, null, d));
  const by = (c) => rows.filter((r) => r[0] === c).length;
  log(`purge: ${by("items")} cards, ${by("responses")} responses, ${by("batches")} batches, ${by("acks")} acks. Copies: ${keep}`);
  w.print(log);
}

// ---- check
function cmdCheck(a, log) {
  const dump = readDump(one(a, "dump")), errs = [], cfgDoc = dump.col("meta").get("config");
  if (cfgDoc) {
    const raw = cfgDoc.data, c = P.cfg;
    for (const k of ["tabs", "kinds", "priorities", "labels", "domains"]) {
      if (raw[k] === undefined) continue;
      const got = c[k] === P.DEFAULTS[k] && Array.isArray(raw[k]) && raw[k].length ? 0 : c[k].length;
      if (!Array.isArray(raw[k]) || got < raw[k].length) errs.push(`config ${k}: ${got} of ${Array.isArray(raw[k]) ? raw[k].length : "a non-list"} entries kept`);
    }
    Object.keys(raw).filter((k) => !["id", "title", "agent", "tabs", "kinds", "priorities", "labels", "domains"].includes(k)).forEach((k) => errs.push("config: unknown field " + q(k)));
  }
  const count = (m, k, f) => { const o = {}; m.forEach((d) => { const v = f(P.coerce(k, d.data)); o[v] = (o[v] || 0) + 1; }); return o; };
  const items = dump.col("items"), notes = [], pq = (kind, data) => P.problems(kind, data, q);
  items.forEach((d, id) => {
    // The checks of cards, and the fields that cards fills.
    const c = ownCopy(d.data, true), name = "item " + qid(id);
    if (c.id === undefined) c.id = id;
    errs.push(...cardProblems(c, name, new Set(), q));
    const managed = {};
    MANAGED.forEach((k) => { if (Object.prototype.hasOwnProperty.call(c, k)) managed[k] = c[k]; });
    errs.push(...pq("item", managed).map((p) => `${name}: ${p}`));
    if (!S.idRe.test(id)) errs.push(`${name}: bad id`);
    // A card that waits for a card that is gone does not wait (the page shows it as open). A missing supersedes target is normal after a purge.
    const it = P.coerce("item", d.data);
    if (it.after && it.after !== id && !items.has(it.after)) notes.push(`${name}: after: no card ${q(it.after)}, so it does not wait`);
  });
  dump.col("guides").forEach((d, id) => {
    const name = "guide " + qid(id);
    errs.push(...pq("guide", d.data).map((p) => `${name}: ${p}`));
    const g = P.coerce("guide", d.data), secIds = g.sections.map((x) => x.id);
    if (g.kind && !S.guideKinds.includes(g.kind)) errs.push(`${name}: kind is not one of ${S.guideKinds.join(", ")}`);
    if (g.status && !["active", "archived"].includes(g.status)) errs.push(`${name}: status is not one of active, archived`);
    if (new Set(secIds).size !== secIds.length) errs.push(`${name}: two sections with one id`);
  });
  for (const [col, kind] of [["responses", "response"], ["batches", "batch"], ["acks", "ack"], ["notes", "note"]]) {
    dump.col(col).forEach((d, id) => errs.push(...pq(kind, d.data).map((p) => `${kind} ${qid(id)}: ${p}`)));
  }
  // A document id lives in the file name; a different id inside the document is a copy gone wrong.
  for (const [col, kind] of [["items", "item"], ["guides", "guide"], ["batches", "batch"], ["notes", "note"]]) {
    dump.col(col).forEach((d, id) => { if (d.data.id !== undefined && d.data.id !== id) errs.push(`${kind} ${qid(id)}: id ${q(d.data.id)} differs from the file name`); });
  }
  const fmtc = (o) => Object.entries(o).map(([k, v]) => k + " " + v).join(", ");
  const acks = dump.col("acks"), bs = Array.from(dump.col("batches").entries()).map(([id, d]) => Object.assign(P.coerce("batch", d.data), { id }));
  const waiting = {};
  bs.filter((b) => !P.isHandled(b, acks)).forEach((b) => { const k = P.agentName(P.agentKey(b.for)); waiting[k] = (waiting[k] || 0) + 1; });
  log(`items ${items.size} (${fmtc(count(items, "item", (x) => x.status || "open"))})`);
  log(`batches ${bs.length}, not handled: ${fmtc(waiting) || "none"}`);
  log(`guides ${dump.col("guides").size} (${fmtc(count(dump.col("guides"), "guide", (x) => (x.status === "archived" ? "archived" : "active")))})`);
  notes.forEach((e) => log("note: " + e));
  errs.forEach((e) => log("problem: " + e));
  if (errs.length) throw new Stop(errs.length + " problems");
}

const COMMANDS = { cards: cmdCards, read: cmdRead, ack: cmdAck, guide: cmdGuide, purge: cmdPurge, check: cmdCheck };
export function run(argv, log = console.log) {
  const a = parseArgs(argv), cmd = COMMANDS[a._[0]];
  if (!cmd) { log(USAGE); return 2; }
  try { cmd(a, log); return 0; } catch (e) { if (e instanceof Stop) { log(e.message); return 1; } throw e; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
