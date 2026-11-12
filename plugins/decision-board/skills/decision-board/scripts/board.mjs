#!/usr/bin/env node
// The script layer of the decision board. Node 18 or later, no dependencies, no network access.
// board/state.json is the truth for one agent's cards, and board/config.json for the board config.
// A write command changes the state, writes one JSON file per document into board/out/, and prints
// the `writes` array of one ArtifactData batch call. The state keeps, per document, the version
// that the next write pins and the last write it printed. The commands that read the board read
// documents that ArtifactData list or query saved with out_dir.
// The fields, kinds and limits come from the page itself (assets/board.html, the part between
// "pure: start" and "pure: end"), so the page and this script cannot drift.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.relative(process.cwd(), fileURLToPath(import.meta.url)) || "board.mjs";
const USAGE = `Usage: node ${SELF} <command> ... --agent <key> [--state <file>]
  check                                     check board/config.json and the state; print the meta/config write when it changed
  sync <file> [--source <s>] [<file> [--source <s>]]... [--allow-close]   add and change cards; a --source closes that source's cards its file no longer holds
  close <id>...                             close cards
  read --dump <dir>                         the batches that wait for you (dump: batches for you, acks)
  waiting --dump <dir>                      only the ids of the batches that wait for you, or "none"
  ack <batch id> [--close <id>...] --dump <dir>   mark a batch handled, and close cards
  guide [<file.md>] --id <id> [--kind text|status|reference] [--item <card id>] [--archive | --delete] --dump <dir>
  purge (--ids <id>... | --closed-before <YYYY-MM-DD>) --dump <dir>
  adopt [cards | guides/<id> | meta/config | acks/<id> | purge/<stamp>] --dump <dir>   after a refused write: merge the board copy, print the write again
  push [cards | guides/<id> | meta/config | acks/<id> | purge/<stamp>]   print the last write of a document again
--agent is required on every command that writes. --state defaults to board/state.json; config.json, out/,
purged/ and decisions.md sit beside it. <dir> holds the ArtifactData dumps: <dir>/<collection>/<doc id>.json;
a missing folder is an empty collection.`;

// ---- the shared definitions of the page
function loadPage() {
  const file = path.join(HERE, "..", "assets", "board.html"), page = fs.readFileSync(file, "utf8");
  const i = page.indexOf("  // ---- pure: start"), j = page.indexOf("  // ---- pure: end", i + 1);
  if (i < 0 || j < 0) throw new Error("the pure markers are missing in " + file);
  const ctx = vm.createContext({ items: new Map(), resp: new Map(), notes: new Map(), guides: new Map(), batches: new Map(), acks: new Map(),
    f: { tab: "all" }, loaded: { config: true }, isPending: () => false, URL });
  vm.runInContext(page.slice(i, j), ctx, { filename: file });
  return ctx;
}
const P = loadPage();
const S = P.SCHEMA;
const plain = (x) => JSON.parse(JSON.stringify(x));
const now = () => process.env.BOARD_NOW || new Date().toISOString().replace(/\.\d+Z$/, "Z");
const q = (s) => JSON.stringify(String(s));
const lower = (s) => String(s || "").trim().toLowerCase();
// JSON with sorted keys, to compare a board copy with a local one.
const stable = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((y) => [y, v[y]])) : v));
// A document id as a local file name: ":" cannot be in a file name on every system.
const fname = (id) => id.replace(/%/g, "%25").replace(/:/g, "%3A");
const unname = (f) => f.replace(/%3A/gi, ":").replace(/%25/g, "%");
const MAX_DOC = 900000;

class Stop extends Error {}
function fail(lines) { throw new Stop([].concat(lines).join("\n")); }

// ---- arguments: positionals, and flags that take every value up to the next flag. sync reads the raw order.
const SWITCHES = ["archive", "delete", "allow-close"];
function parseArgs(argv) {
  const a = { _: [], raw: argv };
  for (let i = 0, key = null; i < argv.length; i++) {
    const v = argv[i];
    if (v.startsWith("--")) { key = v.slice(2); a[key] = a[key] || []; if (SWITCHES.includes(key)) key = null; }
    else if (key) a[key].push(v);
    else a._.push(v);
  }
  return a;
}
const one = (a, k) => (a[k] && a[k].length ? a[k][a[k].length - 1] : "");

// ---- dumps: <dir>/<collection>/<doc id>.json. A file holds the fields (as ArtifactData saves them), {version, data}
// (and maybe id), or the fields with "version" beside them. A version in the file wins; else it comes from
// <dir>/versions.txt, the saved document lines of the dump replies: - "<id>"  <n> bytes  version <v>  "<path>".
// Parsed data is copied key by key into a fresh object, never merged, so a key such as "__proto__" cannot
// change a prototype. A missing folder is an empty collection.
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
  if (!Number.isInteger(ex.version) || ex.version < 1) fail(`${collection}/${id}: the dump has no whole-number version. Save the document lines of the dump replies to versions.txt in the dump folder, or dump again; write nothing until then`);
  return ex.version;
}
export function readDump(dir) {
  if (!dir) fail("--dump <dir> is required");
  const cols = new Map(), listed = new Map(), vt = path.join(dir, "versions.txt");
  // The quoted path of a reply line, absolute or relative to the cwd, names the file.
  for (const ln of fs.existsSync(vt) ? fs.readFileSync(vt, "utf8").split(/\r?\n/) : []) {
    const m = /\sversion (\d+)\s+("(?:[^"\\]|\\.)*")\s*$/.exec(ln);
    if (m) try { listed.set(path.resolve(JSON.parse(m[2])), Number(m[1])); } catch (e) { /* not a reply line */ }
  }
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const sub = path.join(dir, name);
    if (name === "out" || !fs.statSync(sub).isDirectory()) continue;
    const docs = new Map();
    for (const f of fs.readdirSync(sub).filter((x) => x.endsWith(".json"))) {
      let raw;
      try { raw = JSON.parse(fs.readFileSync(path.join(sub, f), "utf8")); } catch (e) { fail("cannot read " + path.join(sub, f) + ": " + e.message); }
      const wrapped = isWrapped(raw, path.join(sub, f)), data = wrapped ? ownCopy(raw.data) : isPlain(raw) ? ownCopy(raw) : {};
      const version = isPlain(raw) && raw.version !== undefined ? raw.version : listed.get(path.resolve(sub, f));
      if (!wrapped) delete data.version;
      docs.set(unname(f.slice(0, -5)), { data, version });
    }
    cols.set(name, docs);
  }
  return { dir, col: (n) => cols.get(n) || new Map() };
}

// ---- the state: {agent, cards, next, pending, refreshed, purge, unlogged}. next maps "cards", "guides/<id>"
// and "meta/config" to the version that the next write pins (1 after a create, N + 1 after a write pinned to N);
// absent means create. pending holds the last write printed for each, for "acks/<id>" (with the cards write of
// --close), and the deletes of "purge/<stamp>". refreshed is the time of the last sync that wrote. purge lists
// the cards a purge took off the board, kept until adopt sees them gone. held lists the cards that close or
// ack --close closed. unlogged holds the decisions.md lines of an ack that the board does not show yet.
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { fail("cannot read " + file + ": " + e.message); }
}
class Run {
  // o.create: the command may make the state (check). o.write: the command writes, so --agent is required.
  constructor(a, o = {}) {
    this.file = path.resolve(one(a, "state") || path.join("board", "state.json"));
    this.dir = path.dirname(this.file);
    const saved = readJson(this.file);
    if (saved && (!isPlain(saved) || typeof saved.agent !== "string" || !Array.isArray(saved.cards) || !saved.cards.every(isPlain) || !isPlain(saved.next)))
      fail(this.file + ": not a state file {agent, cards, next}");
    const flag = lower(one(a, "agent"));
    if (o.write && !flag) fail(`name the agent: --agent ${saved ? saved.agent : "<name>"}`);
    if (saved && flag && flag !== saved.agent) fail(`${this.file} is the state of the agent ${q(saved.agent)}, not ${q(flag)}. One state file per agent key: name another --state`);
    if (!saved && !o.create) fail(`no state ${this.file}. Run \`node ${SELF} check --agent <name>\` once to make it`);
    if (!saved && !S.agentRe.test(flag)) fail(`agent key ${q(flag)}: use 1 to 40 of a-z 0-9 _ - ~ @ +`);
    this.saved = saved;
    this.st = saved ? plain(saved) : { agent: flag, cards: [], next: {} };
    for (const k of ["pending", "unlogged"]) this.st[k] = isPlain(this.st[k]) ? this.st[k] : {};
    this.agent = this.st.agent;
    this.configFile = path.join(this.dir, "config.json");
    this.config = readJson(this.configFile);
    P.applyConfig(isPlain(this.config) ? this.config : null);
    this.writes = [];
  }
  needConfig() {
    if (!isPlain(this.config)) fail(`no config ${this.configFile}. Write it first (references/data-model.md), then run \`node ${SELF} check\``);
  }
  card(id) { return this.st.cards.find((c) => c.id === id); }
  needCards(ids, cmd) {
    const missing = ids.filter((id) => !this.card(id));
    if (missing.length) fail(cmd + ": no card " + missing.join(", ") + " in " + this.file);
  }
  // A write of a document whose version the state keeps: pinned to next, else to the dumped version (a
  // document that this state never wrote), else a create.
  pinned(op, collection, id, data, dumped, also) {
    const key = collection === "cards" ? "cards" : collection + "/" + id;
    const v = this.st.next[key] !== undefined ? this.st.next[key] : dumped;
    this.put(op, collection, id, data, v, key, also);
    if (op === "delete") delete this.st.next[key]; else this.st.next[key] = v === undefined ? 1 : v + 1;
  }
  // The cards document: the cards that a purge did not take off the board, and the time of the last sync.
  cardsDoc() { const gone = new Set(this.st.purge || []); return { cards: this.st.cards.filter((c) => !gone.has(c.id)), refreshed: this.st.refreshed || "" }; }
  putCards() { this.pinned("set", "cards", this.agent, this.cardsDoc()); }
  // close and ack --close: the cards stay closed through sync (held) until their content changes.
  closeCards(ids, t) {
    let k = 0;
    for (const id of ids) { const c = this.card(id); if (c.status !== "closed") { c.status = "closed"; c.updated = t; k++; } }
    this.st.held = Array.from(new Set((this.st.held || []).concat(ids)));
    return k;
  }
  put(op, collection, doc_id, data, if_version, key, also) { this.writes.push({ w: { op, collection, doc_id, if_version }, data, key, also }); }
  // decisions.md: the lines of every ack that the board shows, once.
  logAcks(acks, log) {
    const done = Object.keys(this.st.unlogged).filter((bid) => acks.has(bid));
    if (!done.length) return;
    const file = path.join(this.dir, "decisions.md"), head = fs.existsSync(file) ? "" : "| Card | Answer | Note | Date |\n|---|---|---|---|\n";
    fs.appendFileSync(file, head + done.map((bid) => this.st.unlogged[bid]).flat().map((x) => "| " + x.map(cell).join(" | ") + " |\n").join(""));
    done.forEach((bid) => { delete this.st.unlogged[bid]; delete this.st.pending["acks/" + bid]; });
    log(`decisions.md: the answers of ${done.join(", ")}`);
  }
  // The out files, the state, then the writes arrays. At most 50 writes and about 1 MiB per batch call.
  // An out file is named by a hash of its content, so a printed array always uploads what it was printed
  // with; the older out files of the same document go (meta/config, which every agent writes, stays).
  // also: the pending key of a group of writes (an ack with its close, a purge's deletes).
  finish(log) {
    const list = this.writes.map(({ w, data, key, also }) => {
      const { if_version, ...out } = w;
      if (data) {
        const body = JSON.stringify(data, null, 1) + "\n", sub = path.join(this.dir, "out", w.collection), base = fname(w.doc_id) + ".";
        const f = path.join(sub, base + createHash("sha256").update(body).digest("hex").slice(0, 8) + ".json");
        fs.mkdirSync(sub, { recursive: true });
        if (w.collection !== "meta") for (const x of fs.readdirSync(sub)) if (x.startsWith(base) && /^[0-9a-f]{8}\.json$/.test(x.slice(base.length)) && path.join(sub, x) !== f) fs.rmSync(path.join(sub, x));
        fs.writeFileSync(f, body);
        out.file_path = f;
      }
      if (if_version !== undefined) out.if_version = if_version;
      if (key) this.st.pending[key] = out;
      if (also) this.st.pending[also] = [].concat(this.st.pending[also] || [], out);
      return { out, size: data ? JSON.stringify(data).length : 0 };
    });
    for (const k of ["pending", "unlogged"]) if (!Object.keys(this.st[k]).length) delete this.st[k];
    if (this.st.purge && !this.st.purge.length) delete this.st.purge;
    if (this.st.held) this.st.held = this.st.held.filter((id) => this.card(id));
    if (this.st.held && !this.st.held.length) delete this.st.held;
    if (JSON.stringify(this.st) !== JSON.stringify(this.saved)) {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.st, null, 1) + "\n");
      fs.renameSync(this.file + ".tmp", this.file);
    }
    printWrites(list, log);
  }
}
function printWrites(list, log) {
  const chunks = [];
  let cur = [], bytes = 0;
  for (const w of list) {
    if (cur.length && (cur.length === 50 || bytes + w.size > MAX_DOC)) { chunks.push(cur); cur = []; bytes = 0; }
    cur.push(w.out); bytes += w.size + 200;
  }
  if (cur.length) chunks.push(cur);
  if (!chunks.length) { log("no writes"); return; }
  chunks.forEach((c, i) => {
    log(`batch ${i + 1} of ${chunks.length}: ${c.length} writes. Pass this array as "writes" to one ArtifactData batch call:`);
    log(JSON.stringify(c));
  });
}
const cell = (s) => String(s).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");

// ---- cards
const CONTENT = ["title", "summary", "evidence", "options", "recommendation", "kind", "links"];
const MANAGED = ["rev", "created", "updated"];
// The fields that the answer depends on. A change of one of them raises rev; other changes keep it.
const contentKey = (x) => { const c = P.coerce("item", x); return JSON.stringify(CONTENT.map((k) => (c[k] === undefined ? null : c[k]))); };
function parseCardFile(file) {
  let text, v;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { fail("cannot read " + file); }
  try { v = JSON.parse(text); } catch (e) { fail(file + ": the cards are not a JSON list: " + e.message); }
  if (!Array.isArray(v)) fail(file + ": the cards are not a JSON list");
  return v;
}
function cardProblems(c, name, ids, qk) {
  const out = [];
  if (!P.isObj(c)) return [name + ": not an object"];
  const body = ownCopy(c, true);
  MANAGED.forEach((k) => delete body[k]);
  out.push(...P.problems("item", body, qk));
  if (typeof c.id !== "string" || !S.idRe.test(c.id)) out.push("id: use 1 to 100 of A-Z a-z 0-9 _ - . ~ : @ +");
  else if (ids.has(c.id)) out.push("id: twice in these files");
  if (typeof c.title !== "string" || !c.title.trim()) out.push("title: missing");
  if (c.kind !== undefined && !P.cfg.kinds.some((k) => k.id === c.kind)) out.push("kind: not one of " + P.cfg.kinds.map((k) => k.id).join(", "));
  if (c.priority !== undefined && !P.cfg.priorities.some((k) => k.id === c.priority)) out.push("priority: not one of " + P.cfg.priorities.map((k) => k.id).join(", "));
  if (c.status !== undefined && !S.statuses.includes(c.status)) out.push("status: not one of " + S.statuses.join(", "));
  const decision = (c.kind === undefined ? "decision" : c.kind) === "decision";
  if (Array.isArray(c.options)) {
    if (c.options.length > S.max.options) out.push("options: more than " + S.max.options);
    if (new Set(c.options).size !== c.options.length || c.options.some((o) => typeof o === "string" && !o.trim())) out.push("options: empty or repeated");
  }
  if (decision && (c.options === undefined || (Array.isArray(c.options) && c.options.length < 2))) out.push("options: a decision card needs 2 to " + S.max.options);
  if (typeof c.recommendation === "string" && c.recommendation && !P.optionsOf(P.coerce("item", c)).includes(c.recommendation)) out.push("recommendation: not one of the options");
  out.push(...linkProblems(c.links), ...tagProblems(c.tags));
  if (c.first_asked === undefined) { if (P.needsAsked(c)) out.push('first_asked: required on an open card whose kind is not info: {"date": "YYYY-MM-DD", "who": "..."}'); }
  else if (P.isObj(c.first_asked)) {
    const fa = c.first_asked, tomorrow = new Date(Date.parse(now()) + 86400000).toISOString().slice(0, 10);
    if (!P.realDate(fa.date)) out.push("first_asked.date: not a real calendar date written YYYY-MM-DD");
    else if (fa.date > tomorrow) out.push("first_asked.date: later than tomorrow");
    if (fa.who !== undefined && !P.whoOk(fa.who)) out.push("first_asked.who: empty, or at most 40 of A-Z a-z 0-9 _ - . ~ : @ +");
  }
  return out.map((p) => name + ": " + p);
}
// Every card carries 1 to max.links links, each valid by the rules of the page (P.linkProblem).
function linkProblems(links) {
  const hint = P.cfg.link_hosts.length ? "" : ". Set link_hosts in config.json first";
  if (links === undefined || (Array.isArray(links) && !links.length)) return [`links: missing. Every card needs 1 to ${S.max.links} links {"label", "url"}${hint}`];
  if (!Array.isArray(links)) return [];
  const out = links.length > S.max.links ? ["links: more than " + S.max.links] : [];
  links.forEach((l, i) => {
    if (!P.isObj(l)) return;
    if (l.url === undefined) out.push(`links[${i}]: no url`);
    else if (typeof l.url === "string" && P.linkProblem(l.url)) out.push(`links[${i}]: ${P.linkProblem(l.url)}`);
  });
  return out;
}
// Every tag is an id of the config list tags, once.
function tagProblems(tags) {
  if (!Array.isArray(tags)) return [];
  const known = P.cfg.tags.map((t) => t.id), bad = tags.filter((t) => typeof t === "string" && !known.includes(t));
  const out = bad.length ? [`tags: ${bad.map((t) => JSON.stringify(t)).join(", ")} not in the config tags${known.length ? " (" + known.join(", ") + ")" : ". Set tags in config.json first"}`] : [];
  if (new Set(tags).size !== tags.length) out.push("tags: repeated");
  return out;
}
// sync: card files in order, each with the --source that follows it.
function syncFiles(raw) {
  const files = [];
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] === "--source") { if (!files.length || files[files.length - 1].source !== undefined) fail("sync: --source follows the card file it belongs to"); files[files.length - 1].source = lower(raw[++i]); }
    else if (raw[i].startsWith("--")) { if (!SWITCHES.includes(raw[i].slice(2))) i++; }
    else files.push({ file: raw[i], source: undefined });
  }
  if (!files.length) fail("sync: name the card file");
  return files;
}
function cmdSync(a, log) {
  const r = new Run(a, { write: true }), files = syncFiles(a.raw), ids = new Set(), errs = [], cards = [], allow = !!a["allow-close"];
  r.needConfig();
  for (const f of files) {
    const list = parseCardFile(f.file);
    // A source file without an open card would close every card of that source.
    if (f.source && !allow && !list.some((c) => P.isObj(c) && c.status !== "closed")) fail(`${f.file}: no open cards. With --source ${f.source} it would close every card of that source; add --allow-close if that is right`);
    list.forEach((c) => {
      if (!P.isObj(c)) { cards.push({ c, f }); return; }
      // A card posted again keeps the first ask that is stored. With --source, every card has that source.
      const ex = typeof c.id === "string" && r.card(c.id);
      if (ex && P.isObj(ex.first_asked)) c.first_asked = plain(ex.first_asked);
      if (f.source && c.source !== undefined && lower(c.source) !== f.source) errs.push(`${c.id}: source: not the --source ${q(f.source)}`);
      if (f.source) c.source = f.source;
      cards.push({ c, f });
    });
  }
  cards.forEach(({ c }, i) => { errs.push(...cardProblems(c, c && typeof c.id === "string" && c.id ? c.id : "#" + (i + 1), ids)); if (c && typeof c.id === "string") ids.add(c.id); });
  // A source may lose at most half of its open cards in one run, unless --allow-close.
  for (const s of new Set(files.map((f) => f.source).filter(Boolean))) {
    const open = r.st.cards.filter((c) => lower(c.source) === s && c.status !== "closed"), gone = open.filter((c) => !ids.has(c.id));
    if (!allow && gone.length * 2 > open.length) errs.push(`sync: --source ${s} would close ${gone.length} of ${open.length} open cards (${gone.map((c) => c.id).join(", ")}); add --allow-close if that is right`);
  }
  if (errs.length) fail(errs);
  const t = now(), n = { new: 0, rev: 0, changed: 0, same: 0 }, closed = [], reopened = [], held = new Set(r.st.held || []);
  const defPri = P.cfg.priorities[Math.min(1, P.cfg.priorities.length - 1)].id;
  for (const { c, f } of cards) {
    const ex = r.card(c.id), old = ex ? plain(P.coerce("item", ex)) : null, doc = { id: c.id };
    for (const k of Object.keys(S.item)) if (k !== "id" && !MANAGED.includes(k) && c[k] !== undefined) doc[k] = c[k];
    if (Array.isArray(doc.links)) doc.links = doc.links.map((l) => Object.assign({}, l, { url: new URL(l.url).href }));
    doc.priority = c.priority || (old && old.priority) || defPri;
    const content = !old || contentKey(doc) !== contentKey(old);
    // A card back in its source's file is open again, unless close or ack --close closed it (held); elsewhere a
    // closed card stays closed. Either way until its content changes.
    if (content) held.delete(c.id);
    doc.status = c.status || (old && !content && (!f.source || held.has(c.id)) ? old.status : "open") || "open";
    const strip = (x) => { const y = plain(P.coerce("item", x)); MANAGED.forEach((k) => delete y[k]); return JSON.stringify(y); };
    if (old && strip(doc) === strip(ex)) { n.same++; continue; }
    if (old && old.status === "closed" && doc.status === "open") reopened.push(c.id);
    doc.rev = old ? old.rev + (content ? 1 : 0) : 1;
    doc.created = (old && old.created) || t;
    doc.updated = t;
    if (ex) r.st.cards[r.st.cards.indexOf(ex)] = doc; else r.st.cards.push(doc);
    if (!old) n.new++; else if (content) n.rev++; else n.changed++;
  }
  const sources = new Set(files.map((f) => f.source).filter(Boolean));
  for (const c of r.st.cards) {
    if (sources.has(lower(c.source)) && !ids.has(c.id) && c.status !== "closed") { c.status = "closed"; c.updated = t; closed.push(c.id); }
  }
  const size = JSON.stringify(r.cardsDoc()).length;
  if (size > MAX_DOC) fail(`sync: the cards document would be ${size} characters, over ${MAX_DOC}. Nothing changed. Close and purge old cards first`);
  log(`sync: ${n.new} new, ${n.rev} changed (rev up), ${n.changed} changed (same rev), ${n.same} unchanged, ${closed.length} closed${closed.length ? " (" + closed.join(", ") + ")" : ""}` +
    (reopened.length ? `, ${reopened.length} reopened (${reopened.join(", ")})` : ""));
  if (n.new + n.rev + n.changed + closed.length) { r.st.refreshed = t; r.putCards(); }
  r.st.held = Array.from(held);
  r.finish(log);
}
function cmdClose(a, log) {
  const r = new Run(a, { write: true }), ids = a._.slice(1), t = now();
  if (!ids.length) fail("close: name the card ids");
  r.needCards(ids, "close");
  const k = r.closeCards(ids, t);
  log(`close: ${k} cards closed`);
  if (k) r.putCards();
  r.finish(log);
}

// ---- read. Every database text goes through q(), and an id that is not a plain id too, so no value can forge a line.
// The answers of a batch are keyed "<agent>:<card id>"; the line shows the card id. A batch waits for this agent
// when its "for" is the agent and no acks/<batch id> is in the dump.
const qid = (s) => (S.idRe.test(s) ? s : q(s));
function waiting(r, dump) {
  const acks = dump.col("acks");
  return Array.from(dump.col("batches").entries()).map(([id, d]) => Object.assign(P.coerce("batch", d.data), { id }))
    .filter((b) => !P.isHandled(b, acks) && P.agentKey(b.for) === r.agent).sort((x, y) => (x.created < y.created ? -1 : x.created > y.created ? 1 : x.id < y.id ? -1 : 1));
}
const mine = (r, key) => (typeof key === "string" && key.startsWith(r.agent + ":") ? key.slice(r.agent.length + 1) : null);
function cmdWaiting(a, log) {
  const r = new Run(a), list = waiting(r, readDump(one(a, "dump")));
  log(list.length ? list.map((b) => qid(b.id)).join("\n") : "none");
}
function cmdRead(a, log) {
  const dump = readDump(one(a, "dump")), r = new Run(a), list = waiting(r, dump);
  r.logAcks(dump.col("acks"), log);
  if (!list.length) log("no new batches for " + r.agent);
  for (const b of list) {
    log(`batch ${qid(b.id)}  ${q(b.created)}  ${b.itemIds.length} answers  ${b.noteIds.length} notes`);
    for (const key of b.itemIds) {
      const x = b.answers[key], flags = [], cid = mine(r, key), it = x && cid !== null && r.card(cid);
      if (!it) flags.push("[missing]");
      else {
        const c = P.coerce("item", it);
        if (x.rev < c.rev) flags.push("[stale-rev]");
        else if (x.rev !== c.rev) flags.push("[other-rev]");
        if (x.note && !x.answer && P.optionsOf(c).length) flags.push("[question]");
      }
      log(`  ${qid(cid !== null ? cid : key)}  ${q(x ? x.answer : "")}  ${q(x ? x.note : "")}${flags.length ? "  " + flags.join(" ") : ""}`);
    }
    for (const id of b.noteIds) {
      const nb = b.notes[id] || { text: "", item: "" }, item = mine(r, nb.item) !== null ? mine(r, nb.item) : nb.item;
      log(`  note ${qid(id)}${item ? "  item " + q(item) : ""}  ${q(nb.text)}`);
    }
    log(`  when handled: node ${SELF} ack ${qid(b.id)} --agent ${r.agent} --dump ${one(a, "dump")}${a.state ? " --state " + q(one(a, "state")) : ""}`);
  }
  r.finish(() => {});
}

// ---- ack. Only a batch for this agent that the dump shows without an ack. Its answers go to decisions.md
// once the board shows the ack (read or adopt).
function cmdAck(a, log) {
  const bid = a._[1], dump = readDump(one(a, "dump")), r = new Run(a, { write: true }), b = bid && dump.col("batches").get(bid);
  if (!b) fail("ack: no batch " + (bid || "named") + " in the dump");
  const batch = Object.assign(P.coerce("batch", b.data), { id: bid });
  if (P.agentKey(batch.for) !== r.agent) fail(`ack: batch ${bid} is for ${q(P.agentKey(batch.for))}, not for ${q(r.agent)}. Nothing written`);
  if (dump.col("acks").has(bid)) { r.logAcks(dump.col("acks"), log); log(`ack ${bid}: already acked`); return r.finish(log); }
  const close = a.close || [], t = now();
  r.needCards(close, "ack");
  r.put("set", "acks", bid, { at: t, items: batch.itemIds }, undefined, "acks/" + bid);
  const k = r.closeCards(close, t);
  if (k) r.pinned("set", "cards", r.agent, r.cardsDoc(), undefined, "acks/" + bid);
  const day = batch.created.slice(0, 10), shown = (key) => (mine(r, key) !== null ? mine(r, key) : key || "");
  r.st.unlogged[bid] = batch.itemIds.map((key) => { const x = batch.answers[key] || { answer: "", note: "" }; return [shown(key), x.answer, x.note, day]; })
    .concat(batch.noteIds.map((id) => { const x = batch.notes[id] || { text: "", item: "" }; return [shown(x.item), "", x.text, day]; }));
  log(`ack ${bid}: ack, ${k} cards closed. The answers go to decisions.md when the next read sees the ack`);
  r.finish(log);
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
// The guide document of this agent: "<agent>.<id>". An id with a "." names another agent's guide.
function guideId(r, id) {
  if (id.startsWith(r.agent + ".")) id = id.slice(r.agent.length + 1);
  if (id.includes(".")) fail(`guide: ${q(id)} names another agent's guide. Your guide ids are ${r.agent}.<id>; give --id without a "."`);
  const doc = r.agent + "." + id;
  if (!id || !S.idRe.test(doc)) fail("guide: --id <id> with 1 to " + (99 - r.agent.length) + " of A-Z a-z 0-9 _ - ~ : @ +");
  return doc;
}
// The dump gives the old content (the status that the page sets, the section times); the version comes from the state.
function cmdGuide(a, log) {
  const dump = readDump(one(a, "dump")), r = new Run(a, { write: true }), id = guideId(r, one(a, "id")), ex = dump.col("guides").get(id), t = now();
  const old = ex ? plain(P.coerce("guide", ex.data)) : null, dumped = ex ? pin("guides", id, ex) : undefined;
  if (a.delete || a.archive) {
    if (!ex) fail("guide: no guide " + id + " in the dump");
    if (a.delete) r.pinned("delete", "guides", id, null, dumped);
    else if (old.status !== "archived") r.pinned("update", "guides", id, { status: "archived", updated: t }, dumped);
    log(`guide ${id}: ${a.delete ? "delete" : "archive"}`);
    return r.finish(log);
  }
  const file = a._[1];
  if (!file) fail("guide: name the Markdown file, or use --archive or --delete");
  const kind = one(a, "kind") || (old && old.kind) || "text";
  if (!S.guideKinds.includes(kind)) fail("guide: --kind is one of " + S.guideKinds.join(", "));
  const item = a.item ? r.agent + ":" + one(a, "item") : (old ? old.item : "");
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
  if (old && norm(doc) === norm(ex.data)) { log(`guide ${id}: unchanged`); return r.finish(log); }
  r.pinned("set", "guides", id, doc, dumped);
  log(`guide ${id}: ${sections.filter((s) => s.updated === t).length} of ${sections.length} sections changed`);
  r.finish(log);
}

// ---- purge: copy every row to disk, then take the cards off the board and delete their responses, and
// the handled batches that hold only purged cards, except the newest batch. The cards stay in the state,
// listed in purge, until adopt sees them gone from the board.
function cmdPurge(a, log) {
  const dump = readDump(one(a, "dump")), r = new Run(a, { write: true }), resps = dump.col("responses"), batches = dump.col("batches"), acks = dump.col("acks");
  const already = new Set(r.st.purge || []);
  // An earlier purge whose rows the board still holds is adopted first; one the board holds is forgotten.
  for (const k of purgeKeys(r)) {
    if (r.st.pending[k].some((w) => dump.col(w.collection).has(w.doc_id))) fail(`purge: ${k} has not landed yet. Run \`node ${SELF} adopt ${k} --agent ${r.agent} --dump ${one(a, "dump")}\` first`);
    delete r.st.pending[k];
  }
  let ids = a.ids || [];
  const before = one(a, "closed-before");
  if (!ids.length && !before) fail("purge: give --ids <id>... or --closed-before <YYYY-MM-DD>");
  if (before) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(before)) fail("purge: --closed-before takes a date such as 2026-01-31");
    ids = ids.concat(r.st.cards.filter((c) => c.status === "closed" && String(c.updated) < before).map((c) => c.id));
  }
  ids = Array.from(new Set(ids)).filter((id) => !already.has(id));
  r.needCards(ids, "purge");
  if (!ids.length) { log("purge: nothing to delete"); return; }
  const key = (id) => r.agent + ":" + id, gone = new Set(ids.map(key)), rows = [];
  ids.forEach((id) => { if (resps.has(key(id))) rows.push(["responses", key(id), resps.get(key(id))]); });
  const all = Array.from(batches.entries()).map(([id, d]) => Object.assign(P.coerce("batch", d.data), { id }));
  const newest = all.slice().sort((x, y) => (x.created < y.created ? 1 : -1))[0];
  all.filter((b) => b !== newest && b.itemIds.length && !b.noteIds.length && b.itemIds.every((x) => gone.has(x)) && P.isHandled(b, acks))
    .forEach((b) => { rows.push(["batches", b.id, batches.get(b.id)]); if (acks.has(b.id)) rows.push(["acks", b.id, acks.get(b.id)]); });
  rows.forEach(([c, id, d]) => pin(c, id, d));
  const stamp = now().replace(/[-:]/g, ""), keep = path.join(r.dir, "purged", stamp);
  const copy = (c, id, raw) => { fs.mkdirSync(path.join(keep, c), { recursive: true }); fs.writeFileSync(path.join(keep, c, fname(id) + ".json"), JSON.stringify(raw, null, 1) + "\n"); };
  ids.forEach((id) => copy("cards", id, r.card(id)));
  rows.forEach(([c, id, d]) => copy(c, id, { version: d.version, data: d.data }));
  rows.forEach(([c, id, d]) => r.put("delete", c, id, null, d.version, undefined, "purge/" + stamp));
  r.st.purge = Array.from(already).concat(ids);
  r.putCards();
  const by = (c) => rows.filter((x) => x[0] === c).length;
  log(`purge/${stamp}: ${ids.length} cards, ${by("responses")} responses, ${by("batches")} batches, ${by("acks")} acks. Copies: ${path.relative(process.cwd(), keep) || keep}`);
  r.finish(log);
}

// ---- adopt: after a refused write of one document. Missing from the dump means gone from the board.
// For cards/<agent>: add every card that the board has and the state lacks, keep the newer "updated" of a
// card in both, say what changed, and write the merged list pinned to the board's version. For another
// document: if the board holds the last write, take its version; else print the write again on it.
function holds(d, w) {
  if (w.op === "delete") return !d;
  if (!d) return false;
  if (w.collection === "acks") return true;
  const want = JSON.parse(fs.readFileSync(w.file_path, "utf8"));
  return w.op === "set" ? stable(d.data) === stable(want) : Object.keys(want).every((k) => stable(d.data[k]) === stable(want[k]));
}
const purgeKeys = (r) => Object.keys(r.st.pending).filter((k) => k.startsWith("purge/"));
// Before a purge goes on: a response that the board holds and that differs from its copy in purged/<stamp> is an
// answer the operator changed after the dump. Its card leaves the purge and stays on the board, its delete is
// dropped, the state keeps that, and the command stops without a write.
function purgeGuard(r, dump) {
  const changed = [];
  for (const k of purgeKeys(r)) {
    const copies = readDump(path.join(r.dir, "purged", k.slice(6)));
    r.st.pending[k] = r.st.pending[k].filter((w) => {
      const d = dump.col(w.collection).get(w.doc_id), old = copies.col(w.collection).get(w.doc_id);
      if (w.collection !== "responses" || !d || (old && d.version === old.version && stable(d.data) === stable(old.data))) return true;
      changed.push(mine(r, w.doc_id) ?? w.doc_id);
      return false;
    });
    if (!r.st.pending[k].length) delete r.st.pending[k];
  }
  if (!changed.length) return;
  r.st.purge = (r.st.purge || []).filter((x) => !changed.includes(x));
  r.finish(() => {});
  fail(`adopt: the answer to ${changed.map(qid).join(", ")} changed after the purge. Nothing written: the card stays on the board, out of the purge. Run adopt again`);
}
function cmdAdopt(a, log) {
  const dump = readDump(one(a, "dump")), r = new Run(a, { write: true }), key = a._[1] || "cards", w = r.st.pending[key];
  if (!w && key !== "cards") fail(`adopt: no write of ${key} in ${r.file}`);
  purgeGuard(r, dump);
  // purge/<stamp>: the deletes that the board has not taken yet, pinned to the dumped versions.
  if (key.startsWith("purge/")) {
    const left = (r.st.pending[key] || []).filter((x) => dump.col(x.collection).has(x.doc_id))
      .map((x) => Object.assign({}, x, { if_version: pin(x.collection, x.doc_id, dump.col(x.collection).get(x.doc_id)) }));
    if (!left.length) { delete r.st.pending[key]; log(`${key}: the board holds the purge`); return r.finish(log); }
    r.st.pending[key] = left;
    log(`${key}: ${left.length} deletes again, pinned to the board's versions. Then adopt cards`);
    r.finish(() => {});
    return printWrites(left.map((out) => ({ out, size: 0 })), log);
  }
  const [c, id] = key === "cards" ? ["cards", r.agent] : key.split(/\/(.*)/s), d = dump.col(c).get(id), v = d ? pin(c, id, d) : undefined;
  if (key === "cards") {
    const purge = new Set(r.st.purge || []), add = [], took = [], kept = [];
    for (const bc of d && Array.isArray(d.data.cards) ? d.data.cards.filter(P.isObj) : []) {
      if (purge.has(bc.id)) continue;
      const sc = r.card(bc.id);
      if (!sc) { r.st.cards.push(bc); add.push(bc.id); }
      else if (stable(sc) !== stable(bc)) {
        if (String(bc.updated) > String(sc.updated)) { r.st.cards[r.st.cards.indexOf(sc)] = bc; took.push(bc.id); } else kept.push(bc.id);
      }
    }
    const ids = (x) => x.map(qid).join(", ");
    if (add.length) log(`cards/${r.agent}: added from the board ${ids(add)}`);
    if (took.length) log(`cards/${r.agent}: took the board's newer copy of ${ids(took)}`);
    if (kept.length) log(`cards/${r.agent}: kept this state's newer copy of ${ids(kept)}`);
    // The purge is done when the board holds none of its cards.
    if (purge.size && !(d && d.data.cards || []).some((x) => P.isObj(x) && purge.has(x.id))) { r.st.cards = r.st.cards.filter((x) => !purge.has(x.id)); delete r.st.purge; log(`cards/${r.agent}: the purge of ${ids(Array.from(purge))} is done`); }
    if (v === undefined) delete r.st.next.cards; else r.st.next.cards = v;
    const byId = (l) => stable((Array.isArray(l) ? l : []).slice().sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1)));
    if (d && byId(d.data.cards) === byId(r.cardsDoc().cards)) log(`cards: the board holds this state's cards, version ${v}`);
    else { log(`cards: write again, pinned to ${v === undefined ? "a create" : "version " + v}`); r.putCards(); }
    return r.finish(log);
  }
  // An ack --close also wrote cards in its batch: that write goes again while it is this state's last cards
  // write and the dumped board lacks it.
  const aw = [].concat(w)[0], cw = [].concat(w).find((x) => x.collection === "cards");
  const also = cw && stable(cw) === stable(r.st.pending.cards) && !holds(dump.col("cards").get(r.agent), cw) ? [cw] : [];
  if (holds(d, aw)) {
    log(`${key}: the board holds the last write${v === undefined ? "" : ", version " + v}`);
    if (c === "acks") r.logAcks(dump.col("acks"), log);
    else if (v === undefined) delete r.st.next[key]; else r.st.next[key] = v;
    if (!also.length) return r.finish(log);
    log(`${key}: the cards write of this ack is not on the board: write it again`);
    r.finish(() => {});
    return printWrites(also.map((out) => ({ out, size: 0 })), log);
  }
  const out = Object.assign({}, aw);
  if (v === undefined) delete out.if_version; else out.if_version = v;
  r.st.pending[key] = also.length ? [out].concat(also) : out;
  if (c !== "acks") { if (aw.op === "delete") delete r.st.next[key]; else r.st.next[key] = v === undefined ? 1 : v + 1; }
  log(`${key}: write again, pinned to ${v === undefined ? "a create" : "version " + v}${also.length ? ", with its cards write" : ""}`);
  r.finish(() => {});
  printWrites([out].concat(also).map((x) => ({ out: x, size: 0 })), log);
}
// push: the last write of a document again, as it was printed; for an ack with --close and a purge, the group.
function cmdPush(a, log) {
  const r = new Run(a, { write: true }), key = a._[1] || "cards", w = r.st.pending[key];
  if (!w) fail(`push: no write of ${key} in ${r.file}`);
  printWrites([].concat(w).map((out) => ({ out, size: 0 })), log);
}

// ---- check: config.json and the state, locally. Prints the meta/config write when config.json changed.
const CONFIG_KEYS = ["title", "agent", "tabs", "priorities", "domains", "link_hosts", "tags"];
function cmdCheck(a, log) {
  const r = new Run(a, { create: true, write: true }), errs = [];
  // Two state files of one agent key in one folder would share the out files and drop cards.
  for (const f of (fs.existsSync(r.dir) ? fs.readdirSync(r.dir) : []).filter((x) => x.endsWith(".json")).map((x) => path.join(r.dir, x))) {
    let o;
    try { o = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { continue; }
    if (f !== r.file && isPlain(o) && o.agent === r.agent && Array.isArray(o.cards) && isPlain(o.next))
      fail(`check: ${f} is already the state of the agent ${q(r.agent)}. One state file per agent key in a folder: use it, or another folder`);
  }
  r.needConfig();
  const raw = r.config, c = P.cfg;
  for (const k of ["tabs", "priorities", "domains", "link_hosts", "tags"]) {
    if (raw[k] === undefined) continue;
    const got = c[k] === P.DEFAULTS[k] && Array.isArray(raw[k]) && raw[k].length ? 0 : c[k].length;
    if (!Array.isArray(raw[k]) || got < raw[k].length) errs.push(`config ${k}: ${got} of ${Array.isArray(raw[k]) ? raw[k].length : "a non-list"} entries kept`);
  }
  Object.keys(raw).filter((k) => !CONFIG_KEYS.includes(k)).forEach((k) => errs.push("config: unknown field " + q(k)));
  if (!c.link_hosts.length) errs.push("config link_hosts: none. Every card needs a link to one of them");
  const ids = new Set(), count = {};
  r.st.cards.forEach((x, i) => {
    const name = "card " + (P.isObj(x) && typeof x.id === "string" ? qid(x.id) : "#" + (i + 1));
    errs.push(...cardProblems(x, name, ids, q));
    const managed = {};
    MANAGED.forEach((k) => { if (Object.prototype.hasOwnProperty.call(x, k)) managed[k] = x[k]; });
    errs.push(...P.problems("item", managed, q).map((p) => `${name}: ${p}`));
    ids.add(x.id);
    const st = P.coerce("item", x).status || "open";
    count[st] = (count[st] || 0) + 1;
  });
  log(`state ${path.relative(process.cwd(), r.file) || r.file}: agent ${r.agent}, cards ${r.st.cards.length} (${Object.entries(count).map(([k, v]) => k + " " + v).join(", ") || "none"})`);
  if (c.agent.toLowerCase() !== r.agent) log(`note: the config agent ${q(c.agent)} is not ${q(r.agent)}: free notes go to ${q(c.agent.toLowerCase())}`);
  errs.forEach((e) => log("problem: " + e));
  if (errs.length) throw new Stop(errs.length + " problems");
  const w = r.st.pending["meta/config"];
  const last = w && fs.existsSync(w.file_path) ? { data: JSON.parse(fs.readFileSync(w.file_path, "utf8")) } : null;
  if (!holds(last, { op: "set", file_path: r.configFile })) r.pinned("set", "meta", "config", raw);
  log(`config: ${r.writes.length ? "changed, write it" : "unchanged"}`);
  r.finish(log);
}

const COMMANDS = { check: cmdCheck, sync: cmdSync, close: cmdClose, read: cmdRead, waiting: cmdWaiting, ack: cmdAck, guide: cmdGuide, purge: cmdPurge, adopt: cmdAdopt, push: cmdPush };
export function run(argv, log = console.log) {
  const a = parseArgs(argv), cmd = COMMANDS[a._[0]];
  if (!cmd) { log(USAGE); return 2; }
  try { cmd(a, log); return 0; } catch (e) { if (e instanceof Stop) { log(e.message); return 1; } throw e; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
