#!/usr/bin/env node
// The script layer of the decision board. Node 18 or later, no dependencies, no network access.
// A write command changes the state, writes one JSON file per document into board/out/, and prints
// the `writes` array of one ArtifactData batch call. Reads take the files that ArtifactData saved with out_dir.
// Fields, kinds and limits come from the "pure" part of assets/board.html, so page and script cannot drift.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.relative(process.cwd(), fileURLToPath(import.meta.url)) || "board.mjs";
const USAGE = `Usage: node ${SELF} <command> ... [--state <file>]
  check                                     merge the config layers, check them and the state; print the meta/config write when it changed
  sync <file> [--source <s>] [<file> [--source <s>]]... [--allow-close]   add and change cards; a --source closes that source's cards its file no longer holds
  close <id>...                             close cards
  read --dump <dir> [--all] --dumped        the batches that wait (dump: batches with status "sent"); --dumped: the dump calls succeeded; --all also prints handled ones
  waiting --dump <dir>                      only the ids of the batches that wait, or "none"
  ack <batch id> [--close <id>...] --dump <dir>   mark a batch handled, and close cards
  guide [<file.md>] --id <id> [--kind text|status|reference] [--item <card id>] [--archive | --delete] --dump <dir>
  purge (--ids <id>... | --closed-before <YYYY-MM-DD>) --dump <dir>
  adopt [cards | guides/<id> | meta/config | batches/<id> | purge/<stamp>] --dump <dir> --dumped   after a refused write: merge the board copy, print the write again
  push [cards | guides/<id> | meta/config | batches/<id> | purge/<stamp>]   print the last write of a document again
--state defaults to board/state.json; config.json, config.local.json, config.merged.json, rules.md, out/, purged/ and decisions.md sit beside it.
The user config is $BOARD_USER_CONFIG, else $XDG_CONFIG_HOME/decision-board/config.json, else ~/.config/decision-board/config.json. <dir> holds the ArtifactData
dumps: <dir>/<collection>/<doc id>.json; a missing folder is an empty collection. Every time written or printed is
ISO 8601 with the offset of the config tz. Under every printed array, an "if refused" and an "if the reply is lost"
line name the next command.`;

// ---- the shared definitions of the page
function loadPage() {
  const file = path.join(HERE, "..", "assets", "board.html"), page = fs.readFileSync(file, "utf8");
  const i = page.indexOf("  // ---- pure: start"), j = page.indexOf("  // ---- pure: end", i + 1);
  if (i < 0 || j < 0) throw new Error("the pure markers are missing in " + file);
  const ctx = vm.createContext({ items: new Map(), resp: new Map(), notes: new Map(), guides: new Map(), batches: new Map(),
    f: { tab: "all" }, loaded: { config: true }, isPending: () => false, URL });
  vm.runInContext(page.slice(i, j), ctx, { filename: file });
  return ctx;
}
const P = loadPage();
const S = P.SCHEMA;
const CARDS = S.cardsDoc;
const plain = (x) => JSON.parse(JSON.stringify(x));
// The clock: BOARD_NOW (any instant Date.parse reads) is the test hook. now() is a stamp in the config tz, so it
// runs only after new Run(...) applied the config.
const nowMs = () => { const v = process.env.BOARD_NOW; if (!v) return Date.now(); const t = Date.parse(v); if (isNaN(t)) fail("BOARD_NOW: not a time: " + q(v)); return t; };
const now = () => P.stampIn(nowMs(), P.cfg.tz, false);
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
const SWITCHES = ["archive", "delete", "allow-close", "all", "dumped"];
// The flags each command takes. A later cluster adds a line here for a new command.
export const FLAGS = {
  check: ["state"],
  sync: ["state", "source", "allow-close"],
  close: ["state"],
  read: ["state", "dump", "all", "dumped"],
  waiting: ["dump"],
  ack: ["state", "dump", "close"],
  guide: ["state", "dump", "id", "kind", "item", "archive", "delete"],
  purge: ["state", "dump", "ids", "closed-before"],
  adopt: ["state", "dump", "dumped"],
  push: ["state"],
};
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
// change a prototype. A missing folder is an empty collection. only: read just that collection.
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
export function readDump(dir, only) {
  if (!dir) fail("--dump <dir> is required");
  const cols = new Map(), listed = new Map(), vt = path.join(dir, "versions.txt");
  // The quoted path of a reply line, absolute or relative to the cwd, names the file.
  for (const ln of fs.existsSync(vt) ? fs.readFileSync(vt, "utf8").split(/\r?\n/) : []) {
    const m = /\sversion (\d+)\s+("(?:[^"\\]|\\.)*")\s*$/.exec(ln);
    if (m) try { listed.set(path.resolve(JSON.parse(m[2])), Number(m[1])); } catch (e) { /* not a reply line */ }
  }
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const sub = path.join(dir, name);
    if (name === "out" || (only && name !== only) || !fs.statSync(sub).isDirectory()) continue;
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

// ---- the state: {cards, next, pending, refreshed, purge, held, unlogged}. next maps "cards" (cards/main),
// "guides/<id>" and "meta/config" to the version that the next write pins (1 after a create, N + 1 after a write
// pinned to N); absent means create. pending holds the last write printed for each, for "batches/<id>" (an ack,
// with the cards write of --close), and the deletes of "purge/<stamp>". refreshed is the time of the last sync
// that wrote. purge lists the cards a purge took off the board, kept until adopt sees them gone. held lists the
// cards that close or ack --close closed. unlogged holds the decisions.md lines of an ack whose batch still waits
// in the last dump. Keys that later versions add are kept as they are.
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { fail("cannot read " + file + ": " + e.message); }
}
// A state of the older board model (one state per agent, acks): an agent field, an acks key or write, or a cards
// write to another document than cards/main. Only these markers count; a key this script does not know is kept.
function olderModel(s) {
  if (Object.prototype.hasOwnProperty.call(s, "agent")) return true;
  if (["next", "pending", "unlogged"].some((k) => isPlain(s[k]) && Object.keys(s[k]).some((x) => x.startsWith("acks/")))) return true;
  const pend = isPlain(s.pending) ? s.pending : {}, writes = (v) => [].concat(v).filter(isPlain);
  if (writes(pend.cards || []).some((w) => w.collection === "cards" && w.doc_id !== S.cardsDoc)) return true;
  return Object.values(pend).some((v) => writes(v).some((w) => w.collection === "acks"));
}

// ---- config layers: the defaults, the user file, board/config.json and board/config.local.json, later ones win.
// A page key is a key of DEFAULTS in the page; a script-only key is a key of SCRIPT_DEFAULTS. check writes the
// keys of WRITTEN_KEYS itself; config.merged.json leaves out the keys of MERGED_OMIT.
const WRITTEN_KEYS = ["settings"];
const SCRIPT_DEFAULTS = { checks: [], standing: ["always", "never", "from now on"] };
export const SCRIPT_KEYS = Object.keys(SCRIPT_DEFAULTS);
const MERGED_OMIT = ["checks"];
export const CONFIG_KEYS = Object.keys(P.DEFAULTS).filter((k) => !WRITTEN_KEYS.includes(k)).concat(SCRIPT_KEYS);
// The defaults as plain objects of this realm (P.DEFAULTS comes from a vm context, where isPlain is false).
export const pageDefaults = () => plain(Object.assign({}, P.DEFAULTS, SCRIPT_DEFAULTS));
// The user file, outside any repository: BOARD_USER_CONFIG ("" turns the layer off), else XDG, else ~/.config.
function userConfigPath() {
  const v = process.env.BOARD_USER_CONFIG, x = process.env.XDG_CONFIG_HOME;
  if (v !== undefined) return v === "" ? "" : path.resolve(v);
  if (x && path.isAbsolute(x)) return path.join(x, "decision-board", "config.json");
  return path.join(os.homedir(), ".config", "decision-board", "config.json");
}
function tilde(file) { const h = os.homedir() + path.sep; return file.startsWith(h) ? "~/" + file.slice(h.length) : file; }
function rel(file) { return path.relative(process.cwd(), file) || file; }
const ownVal = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
// The problem of key k of the layer object over, given the earlier value of its base key: a text, true to skip the
// key without a problem (the "+key" half of a pair, reported under "key"), or "" when it merges.
function keyProblem(over, k, earlier, name, p) {
  const plus = k.startsWith("+"), base = plus ? k.slice(1) : k, has = (x) => Object.prototype.hasOwnProperty.call(over, x);
  if (UNSAFE.has(base)) return `${name}: field ${q(p)} is not allowed`;
  if (!plus) return has("+" + base) ? `${name}: "+${p}" and "${p}" in one file` : "";
  if (has(base)) return true;
  if (!Array.isArray(over[k])) return `${name}: "+${p}": not a list`;
  if (earlier !== undefined && !Array.isArray(earlier)) return `${name}: "+${p}": the earlier value is not a list`;
  return "";
}
// A value as the merge keeps it: a fresh copy, with the _ keys of its objects dropped.
function cleanValue(v, name, p, problems) {
  if (Array.isArray(v)) return v.map((x, i) => cleanValue(x, name, `${p}[${i}]`, problems));
  if (isPlain(v)) return mergeInto({}, v, name, p, problems);
  return v;
}
// "+key": the entries appended to the earlier list. An object with the string id of an entry replaces that entry in
// place; a text, number or boolean already in the list is skipped.
function appendList(earlier, add, name, p, problems) {
  const list = (earlier || []).slice();
  add.forEach((x, i) => {
    const v = cleanValue(x, name, `+${p}[${i}]`, problems);
    if (isPlain(v) && typeof v.id === "string") {
      const j = list.findIndex((y) => isPlain(y) && y.id === v.id);
      if (j >= 0) { list[j] = v; return; }
    }
    if (["string", "number", "boolean"].includes(typeof v) && list.includes(v)) return;
    list.push(v);
  });
  return list;
}
// One layer object over the merged object so far, recursively: a plain object merges key by key, null removes the
// key, "+key" appends, anything else replaces. Returns a new object; at is the dotted path of over.
function mergeInto(base, over, name, at, problems) {
  const out = Object.assign({}, isPlain(base) ? base : {});
  for (const k of Object.keys(over)) {
    const plus = k.startsWith("+"), key = plus ? k.slice(1) : k, p = at ? at + "." + key : key;
    // An unsafe key is a problem before it could pass for a comment (__proto__ starts with _).
    if (!UNSAFE.has(key) && (k.startsWith("_") || key.startsWith("_"))) continue;
    const bad = keyProblem(over, k, ownVal(out, key), name, p), v = over[k];
    if (bad) { if (bad !== true) problems.push(bad); continue; }
    if (plus) out[key] = appendList(ownVal(out, key), v, name, p, problems);
    else if (v === null) delete out[key];
    else if (isPlain(v)) out[key] = mergeInto(isPlain(ownVal(out, key)) ? out[key] : {}, v, name, p, problems);
    else out[key] = cleanValue(v, name, p, problems);
  }
  return out;
}
// layers: [{name, data}] in merge order (data null is skipped); defaults: the base of a "+key" with no earlier value.
// src: the layers of each top-level key ("+name" for an append, "default" for a default list appended to).
export function mergeLayers(layers, defaults) {
  let config = {};
  const src = {}, problems = [];
  for (const { name, data } of layers) {
    if (!data) continue;
    const keys = Object.keys(data).filter((k) => !k.startsWith("_") && !k.replace(/^\+/, "").startsWith("_"))
      .map((k) => ({ k, plus: k.startsWith("+"), key: k.replace(/^\+/, "") }));
    for (const { k, plus, key } of keys) {
      if (plus && ownVal(config, key) === undefined && Array.isArray(ownVal(defaults, key)) && !keyProblem(data, k, undefined, name, key)) {
        config[key] = plain(defaults[key]);
        src[key] = ["default"];
      }
    }
    const before = config;
    config = mergeInto(config, data, name, "", problems);
    for (const { k, plus, key } of keys) {
      if (keyProblem(data, k, ownVal(before, key), name, key)) continue;
      if (plus) src[key] = (ownVal(src, key) || []).concat("+" + name);
      else if (data[k] === null) delete src[key];
      else if (isPlain(data[k]) && isPlain(ownVal(before, key))) src[key] = (ownVal(src, key) || []).concat(name);
      else src[key] = [name];
    }
  }
  return { config, src, problems };
}
// The footer line of the page: the layer files that exist, the user file first.
function settingsText(files) {
  return "Settings: " + files.filter((f) => f.exists).map((f) => (f.name === "user" ? tilde(f.file) : rel(f.file))).join(", ");
}
// The three layer files of a board folder, merged over the defaults. page: the keys for meta/config; merged: the
// full config for config.merged.json; unknown: the unknown-field problems of each file, top level only.
function loadConfig(dir) {
  const u = userConfigPath(), files = [["user", u], ["board", path.join(dir, "config.json")], ["local", path.join(dir, "config.local.json")]]
    .map(([name, file]) => ({ name, file, exists: !!file && fs.existsSync(file) }));
  const layers = files.filter((f) => f.exists).map((f) => {
    const data = readJson(f.file);
    if (!isPlain(data)) fail(`${f.file}: not a JSON object`);
    return { name: f.name, data };
  });
  const unknown = [];
  for (const { name, data } of layers) {
    for (const k of Object.keys(data)) {
      const base = k.startsWith("+") ? k.slice(1) : k;
      // A comment (_x or +_x) is no field; an unsafe key is reported by the merge alone.
      if (base.startsWith("_") || UNSAFE.has(base)) continue;
      if (!CONFIG_KEYS.includes(base)) unknown.push(`config ${name}: unknown field ${q(base)}`);
    }
  }
  const { config, src, problems } = mergeLayers(layers, pageDefaults());
  const page = Object.assign({}, config), merged = Object.assign(pageDefaults(), config);
  SCRIPT_KEYS.concat(WRITTEN_KEYS).forEach((k) => delete page[k]);
  page.settings = settingsText(files);
  WRITTEN_KEYS.concat(MERGED_OMIT).forEach((k) => delete merged[k]);
  return { files, any: layers.length > 0, config, src, problems, page, merged, unknown };
}

class Run {
  // o.create: the command may make the state (check).
  constructor(a, o = {}) {
    this.a = a;
    this.file = path.resolve(one(a, "state") || path.join("board", "state.json"));
    this.dir = path.dirname(this.file);
    const saved = readJson(this.file);
    if (saved && (!isPlain(saved) || !Array.isArray(saved.cards) || !saved.cards.every(isPlain) || !isPlain(saved.next)))
      fail(this.file + ": not a state file {cards, next}");
    if (saved && olderModel(saved)) fail(`${this.file}: a state file of an older board model. Delete it and run \`node ${SELF} check\``);
    if (!saved && !o.create) fail(`no state ${this.file}. Run \`node ${SELF} check\` once to make it`);
    this.saved = saved;
    this.st = saved ? plain(saved) : { cards: [], next: {} };
    for (const k of ["pending", "unlogged"]) this.st[k] = isPlain(this.st[k]) ? this.st[k] : {};
    this.configFile = path.join(this.dir, "config.json");
    this.load = loadConfig(this.dir);
    this.config = this.load.any ? this.load.config : null;
    P.applyConfig(isPlain(this.config) ? this.config : null);
    this.writes = [];
  }
  // At least one layer file, and no merge problem (check reports those itself: fromCheck).
  needConfig(fromCheck) {
    if (!this.load.any) {
      const u = this.load.files[0].file;
      fail(`no config: write ${rel(this.configFile)}${u ? " or the user file " + tilde(u) : ""} (references/data-model.md), then run \`node ${SELF} check\``);
    }
    if (!fromCheck && this.load.problems.length) fail(this.load.problems.map((p) => "config " + p).concat(`fix the config, then run \`node ${SELF} check\``));
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
  putCards() { this.pinned("set", "cards", CARDS, this.cardsDoc()); }
  // close and ack --close: the cards stay closed through sync (held) until their content changes.
  closeCards(ids, t) {
    let k = 0;
    for (const id of ids) { const c = this.card(id); if (c.status !== "closed") { c.status = "closed"; c.updated = t; k++; } }
    this.st.held = Array.from(new Set((this.st.held || []).concat(ids)));
    return k;
  }
  put(op, collection, doc_id, data, if_version, key, also) { this.writes.push({ w: { op, collection, doc_id, if_version }, data, key, also }); }
  // decisions.md: the lines of every acked batch that the dump no longer lists as waiting, once. Absence counts as
  // handled, so a failed dump must never reach this: its callers, read and adopt, run only with --dumped.
  logHandled(dump, log) {
    const sent = new Set(waiting(dump).map((b) => b.id));
    const done = Object.keys(this.st.unlogged).filter((bid) => !sent.has(bid));
    if (!done.length) return;
    const file = path.join(this.dir, "decisions.md"), head = fs.existsSync(file) ? "" : "| Card | Answer | Note | Date |\n|---|---|---|---|\n";
    fs.appendFileSync(file, head + done.map((bid) => this.st.unlogged[bid]).flat().map((x) => "| " + x.map(cell).join(" | ") + " |\n").join(""));
    done.forEach((bid) => { delete this.st.unlogged[bid]; delete this.st.pending["batches/" + bid]; });
    log(`decisions.md: the answers of ${done.join(", ")}`);
  }
  // The out files, the state, then the writes arrays. At most 50 writes and about 1 MiB per batch call.
  // An out file is named by a hash of its content, so a printed array always uploads what it was printed
  // with; the older out files of the same document go.
  // also: the pending key of a group of writes (an ack with its close, a purge's deletes). The group of a write
  // (also, else its key) names the adopt and push lines printed under the array.
  finish(log) {
    const list = this.writes.map(({ w, data, key, also }) => {
      const { if_version, ...out } = w;
      if (data) {
        const body = JSON.stringify(data, null, 1) + "\n", sub = path.join(this.dir, "out", w.collection), base = fname(w.doc_id) + ".";
        const f = path.join(sub, base + createHash("sha256").update(body).digest("hex").slice(0, 8) + ".json");
        fs.mkdirSync(sub, { recursive: true });
        for (const x of fs.readdirSync(sub)) if (x.startsWith(base) && /^[0-9a-f]{8}\.json$/.test(x.slice(base.length)) && path.join(sub, x) !== f) fs.rmSync(path.join(sub, x));
        fs.writeFileSync(f, body);
        out.file_path = f;
      }
      if (if_version !== undefined) out.if_version = if_version;
      if (key) this.st.pending[key] = out;
      if (also) this.st.pending[also] = [].concat(this.st.pending[also] || [], out);
      return { out, size: data ? JSON.stringify(data).length : 0, group: also || key };
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
    printWrites(list, log, this.ctx());
  }
  // Where the printed next steps point: the --dump folder of the command, else dump/ beside the state; and --state.
  ctx() {
    const a = this.a;
    return { dump: a.dump ? one(a, "dump") : path.relative(process.cwd(), path.join(this.dir, "dump")) || "dump",
      state: a.state ? " --state " + q(one(a, "state")) : "" };
  }
}
// The calls that dump what adopt needs for a group: the agent never picks the collections itself.
function dumpCalls(group) {
  if (group === "cards") return "P2 cards with versions";
  if (group.startsWith("guides/")) return "P2 guides with versions";
  if (group === "meta/config") return "P2 meta with versions";
  if (group.startsWith("batches/")) return "P4 and P2 cards";
  return "P2 responses, batches and cards with versions";
}
// Each array, then for each group of its writes the line for a refused write and the line for a lost reply.
function printWrites(list, log, ctx) {
  const chunks = [];
  let cur = [], bytes = 0;
  for (const w of list) {
    if (cur.length && (cur.length === 50 || bytes + w.size > MAX_DOC)) { chunks.push(cur); cur = []; bytes = 0; }
    cur.push(w); bytes += w.size + 200;
  }
  if (cur.length) chunks.push(cur);
  if (!chunks.length) { log("no writes"); return; }
  chunks.forEach((c, i) => {
    log(`batch ${i + 1} of ${chunks.length}: ${c.length} writes. Pass this array as "writes" to one ArtifactData batch call:`);
    log(JSON.stringify(c.map((w) => w.out)));
    for (const g of Array.from(new Set(c.map((w) => w.group).filter(Boolean)))) {
      log(`if refused: rm -rf ${ctx.dump}, then ${dumpCalls(g)}, then node ${SELF} adopt ${g} --dump ${ctx.dump} --dumped${ctx.state}`);
      log(`if the reply is lost: node ${SELF} push ${g}${ctx.state}`);
    }
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
    const fa = c.first_asked, tomorrow = P.addDays(P.dayIn(nowMs(), P.cfg.tz), 1);
    if (!P.realDate(fa.date)) out.push("first_asked.date: not a real calendar date written YYYY-MM-DD");
    else if (fa.date > tomorrow) out.push("first_asked.date: later than tomorrow");
    if (fa.who !== undefined && !P.whoOk(fa.who)) out.push("first_asked.who: empty, or at most 40 of A-Z a-z 0-9 _ - . ~ : @ +");
  }
  return out.map((p) => name + ": " + p);
}
// A card carries up to max.links links, each valid by the rules of the page (P.linkProblem). Links are optional.
function linkProblems(links) {
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

// ---- checks: the config list checks, regex checks that sync runs on every open card. The operator's values live
// only in the config; the field list comes from SCHEMA.item.
const CHECK_KEYS = ["id", "field", "match", "forbid", "except", "flags", "when", "message"];
export function checkFields() {
  const text = (t) => ["s", "t", "S"].includes(t), item = S.item, keys = Object.keys(item);
  const top = keys.filter((k) => (text(item[k]) || ["l", "L"].includes(item[k])) && !MANAGED.includes(k));
  const subs = keys.filter((k) => /^[ao]:/.test(item[k])).flatMap((k) => {
    const kind = S[item[k].slice(2)];
    return Object.keys(kind).filter((x) => text(kind[x])).map((x) => k + "." + x);
  });
  return top.concat(subs);
}
// The texts of a card field: a text, the texts of a list, or with a dot the sub field of each object of a list or of one object.
function fieldValues(c, field) {
  const [k, sub] = field.split("."), v = ownVal(c, k), str = (x) => typeof x === "string";
  if (!sub) return str(v) ? [v] : Array.isArray(v) ? v.filter(str) : [];
  if (Array.isArray(v)) return v.filter(isPlain).map((x) => ownVal(x, sub)).filter(str);
  return isPlain(v) && str(ownVal(v, sub)) ? [v[sub]] : [];
}
// The first 50 checks, validated and compiled. re: the match regex, or for forbid the scan regex with g; exceptAt:
// the except regex with y. Both are stateful: checkHits sets lastIndex before every use.
export function compileChecks(list) {
  if (!Array.isArray(list)) return { checks: [], problems: ["config checks: not a list"] };
  const problems = [], checks = [], fields = checkFields(), ids = new Set();
  if (list.length > S.max.list) { problems.push(`config checks: ${S.max.list} of ${list.length} entries kept`); list = list.slice(0, S.max.list); }
  list.forEach((e, i) => {
    const at = `config checks[${i}]`, bad = [];
    if (!isPlain(e)) { problems.push(at + ": not an object"); return; }
    Object.keys(e).filter((k) => !CHECK_KEYS.includes(k)).forEach((k) => bad.push(`${at}: unknown field ${q(k)}`));
    if (e.id !== undefined && (typeof e.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(e.id))) bad.push(`${at}.id: 1 to 40 of a-z 0-9 -`);
    else if (e.id !== undefined) { if (ids.has(e.id)) bad.push(`config checks: id ${q(e.id)} twice`); ids.add(e.id); }
    if (!fields.includes(e.field)) bad.push(`${at}.field: one of ${fields.join(", ")}`);
    const forbid = e.forbid !== undefined;
    if (forbid === (e.match !== undefined)) bad.push(`${at}: give one of match or forbid`);
    if (e.except !== undefined && !forbid) bad.push(`${at}.except: goes with forbid only; widen match instead`);
    const flagsOk = e.flags === undefined || (typeof e.flags === "string" && /^[imsu]*$/.test(e.flags) && new Set(e.flags).size === e.flags.length);
    if (!flagsOk) bad.push(`${at}.flags: distinct letters of i, m, s, u`);
    const flags = flagsOk && e.flags ? e.flags : "";
    for (const k of ["match", "forbid", "except"]) {
      if (e[k] === undefined) continue;
      if (typeof e[k] !== "string") { bad.push(`${at}.${k}: not a regex: not a text`); continue; }
      if (e[k].length > 300) { bad.push(`${at}.${k}: longer than 300 characters`); continue; }
      try { new RegExp(e[k], flags); } catch (err) { bad.push(`${at}.${k}: not a regex: ${err.message}`); }
    }
    const list2 = (x) => Array.isArray(x) && x.length > 0 && x.every((y) => typeof y === "string");
    if (e.when !== undefined && !(isPlain(e.when) && Object.keys(e.when).every((k) => (k === "source" || k === "tags") && list2(e.when[k]))))
      bad.push(`${at}.when: an object with source and tags lists of texts`);
    if (e.message === undefined) bad.push(`${at}.message: missing`);
    else if (typeof e.message !== "string" || !e.message.trim() || e.message.length > 300) bad.push(`${at}.message: 1 to 300 characters`);
    if (bad.length) { problems.push(...bad); return; }
    checks.push({ ref: e.id || String(i + 1), field: e.field, re: new RegExp(forbid ? e.forbid : e.match, forbid ? flags + "g" : flags), forbid,
      exceptAt: e.except !== undefined ? new RegExp(e.except, flags + "y") : null, when: e.when || null, message: e.message });
  });
  return { checks, problems };
}
// The checks that card c fails, as "check <ref>: <message>", in list order. A closed card passes every check.
export function checkHits(c, checks) {
  if (!isPlain(c) || c.status === "closed") return [];
  const out = [];
  for (const k of checks) {
    if (k.when) {
      if (k.when.source && !k.when.source.map(lower).includes(lower(c.source))) continue;
      if (k.when.tags && !(Array.isArray(c.tags) && c.tags.some((t) => k.when.tags.includes(t)))) continue;
    }
    const vals = fieldValues(c, k.field);
    const hit = (v) => {
      k.re.lastIndex = 0;
      for (const m of v.matchAll(k.re)) {
        if (!k.exceptAt) return true;
        k.exceptAt.lastIndex = m.index;
        if (!k.exceptAt.test(v)) return true;
      }
      return false;
    };
    const fails = k.forbid ? vals.some(hit) : !vals.some((v) => { k.re.lastIndex = 0; return k.re.test(v); });
    if (fails) out.push(`check ${k.ref}: ${k.message}`);
  }
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
  const r = new Run(a), files = syncFiles(a.raw), ids = new Set(), errs = [], cards = [], allow = !!a["allow-close"];
  r.needConfig();
  for (const f of files) {
    const list = parseCardFile(f.file);
    // A source file without an open card would close every card of that source.
    if (f.source && !allow && !list.some((c) => P.isObj(c) && c.status !== "closed")) fail(`${f.file}: no open cards. With --source ${f.source} it would close every card of that source. If the fetch held every row, rerun with --allow-close; else fetch again`);
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
  const ck = compileChecks(r.config.checks === undefined ? [] : r.config.checks);
  if (ck.problems.length) fail(ck.problems.concat("fix the config, then run `node " + SELF + " check`"));
  let hit = false;
  cards.forEach(({ c }, i) => { if (!P.isObj(c)) return; const h = checkHits(c, ck.checks); if (h.length) hit = true; errs.push(...h.map((x) => (typeof c.id === "string" && c.id ? c.id : "#" + (i + 1)) + ": " + x)); });
  if (hit) errs.push("a check line is a rule of the operator's config: change the card, never the check");
  // A source may lose at most half of its open cards in one run, unless --allow-close.
  for (const s of new Set(files.map((f) => f.source).filter(Boolean))) {
    const open = r.st.cards.filter((c) => lower(c.source) === s && c.status !== "closed"), gone = open.filter((c) => !ids.has(c.id));
    if (!allow && gone.length * 2 > open.length) errs.push(`sync: --source ${s} would close ${gone.length} of ${open.length} open cards (${gone.map((c) => c.id).join(", ")}). If the fetch held every row, rerun with --allow-close; else fetch again`);
  }
  if (errs.length) fail(errs);
  const t = now(), n = { new: 0, rev: 0, changed: 0, same: 0 }, closed = [], reopened = [], held = new Set(r.st.held || []);
  const noLink = [];
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
    if (doc.status === "open" && !(Array.isArray(doc.links) && doc.links.length)) noLink.push(c.id);
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
  noLink.forEach((id) => log(`note: ${qid(id)}: no link`));
  if (n.new + n.rev + n.changed + closed.length) { r.st.refreshed = t; r.putCards(); }
  r.st.held = Array.from(held);
  r.finish(log);
}
function cmdClose(a, log) {
  const r = new Run(a), ids = a._.slice(1), t = now();
  if (!ids.length) fail("close: name the card ids");
  r.needCards(ids, "close");
  const k = r.closeCards(ids, t);
  log(`close: ${k} cards closed`);
  if (k) r.putCards();
  r.finish(log);
}

// ---- read. Every database text goes through q(), and an id that is not a plain id too, so no value can forge a line.
// The answers of a batch are keyed by card id. A batch waits while its status is "sent"; the order is by instant, then id.
const qid = (s) => (S.idRe.test(s) ? s : q(s));
const byTime = (x, y) => P.cmpStamp(x.created, y.created) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
const batchesOf = (dump) => Array.from(dump.col("batches").entries()).map(([id, d]) => Object.assign(P.coerce("batch", d.data), { id })).sort(byTime);
const waiting = (dump) => batchesOf(dump).filter((b) => b.status === "sent");
// A stamp as read prints it: in the config tz, or as it is when it is unreadable.
const shown = (s) => P.localStamp(s, P.cfg.tz) || s;
// waiting needs no state: it reads only <dump>/batches.
function cmdWaiting(a, log) {
  const list = waiting(readDump(one(a, "dump"), "batches"));
  log(list.length ? list.map((b) => qid(b.id)).join("\n") : "none");
}
// read: what the agent does with one answer or note line of a sent batch, printed in brackets at its end.
// flags: the line's flags, a list. The script decides, the agent follows.
function lineHint(flags, a) {
  const dir = one(a, "dump"), st = a.state ? " --state " + q(one(a, "state")) : "";
  if (flags.includes("[stale-rev]") || flags.includes("[missing]")) return "(skip)";
  if (flags.includes("[other-rev]")) return `(skip; after the ack: rm -rf ${dir}, then P2 cards with versions, then node ${SELF} adopt cards --dump ${dir} --dumped${st})`;
  if (flags.includes("[question]")) return "(answer the note in the card text and post the card again)";
  if (flags.includes("[rule]") || flags.includes("[standing]")) return "(read references/rules.md and do what it says for this line)";
  return "(act on it)";
}
function cmdRead(a, log) {
  const dir = one(a, "dump");
  if (!a.dumped) fail(`read: no --dumped. Run rm -rf ${dir}, then P4; once P4 succeeded, run node ${SELF} read --dump ${dir} --dumped`);
  const dump = readDump(dir), r = new Run(a), list = a.all ? batchesOf(dump) : waiting(dump);
  { const rl = rulesLine(rulesState(r), "read", a); if (rl) log(rl); }
  const stand = standingRe(r.config ? r.config.standing : undefined);
  r.logHandled(dump, log);
  if (!list.length) log(a.all ? "no batches in the dump" : "no batches waiting");
  for (const b of list) {
    const sent = b.status === "sent";
    log(`batch ${qid(b.id)}  ${q(shown(b.created))}  ${b.itemIds.length} answers  ${b.noteIds.length} notes${b.status === "handled" ? `  handled ${q(shown(b.handled_at))}` : ""}`);
    for (const key of b.itemIds) {
      const x = b.answers[key], flags = [], it = x && r.card(key);
      if (!it) flags.push("[missing]");
      else {
        const c = P.coerce("item", it);
        if (x.rev < c.rev) flags.push("[stale-rev]");
        else if (x.rev !== c.rev) flags.push("[other-rev]");
        if (x.note && !x.answer && P.optionsOf(c).length) flags.push("[question]");
      }
      if (!flags.length && it && lower(it.source) === "rules") flags.push("[rule]"); else if (!flags.length && x && stand.test(x.note || "")) flags.push("[standing]");
      log(`  ${qid(key)}  ${q(x ? x.answer : "")}  ${q(x ? x.note : "")}${flags.length ? "  " + flags.join(" ") : ""}${sent ? "  " + lineHint(flags, a) : ""}`);
    }
    for (const id of b.noteIds) {
      const nb = b.notes[id] || { text: "", item: "" }, nflags = [];
      if (stand.test(nb.text)) nflags.push("[standing]");
      log(`  note ${qid(id)}${nb.item ? "  item " + q(nb.item) : ""}  ${q(nb.text)}${nflags.length ? "  " + nflags.join(" ") : ""}${sent ? "  " + lineHint(nflags, a) : ""}`);
    }
    if (sent) log(`  when handled: node ${SELF} ack ${qid(b.id)} --dump ${one(a, "dump")}${a.state ? " --state " + q(one(a, "state")) : ""}`);
  }
  r.finish(() => {});
}

// ---- ack: an update of batches/<id> to status "handled", pinned to version 1 (the page writes a batch once, with
// set, and never again), with the cards write of --close. Its answers go to decisions.md once a read no longer
// lists the batch as waiting.
function cmdAck(a, log) {
  const bid = a._[1], dump = readDump(one(a, "dump")), r = new Run(a), b = bid && dump.col("batches").get(bid);
  if (!b) fail("ack: no batch " + (bid || "named") + " in the dump");
  const batch = Object.assign(P.coerce("batch", b.data), { id: bid });
  if (batch.status === "handled") { log(`ack ${bid}: already handled`); return r.finish(log); }
  if (batch.status !== "sent") fail(`ack: batch ${bid} has status ${q(batch.status)}, not "sent". Nothing written`);
  const close = a.close || [], t = now();
  r.needCards(close, "ack");
  r.put("update", "batches", bid, { status: "handled", handled_at: t }, 1, "batches/" + bid);
  const k = r.closeCards(close, t);
  if (k) r.pinned("set", "cards", CARDS, r.cardsDoc(), undefined, "batches/" + bid);
  const day = P.stampMs(batch.created) === -Infinity ? "" : P.dayIn(P.stampMs(batch.created), P.cfg.tz);
  r.st.unlogged[bid] = batch.itemIds.map((key) => { const x = batch.answers[key] || { answer: "", note: "" }; return [key, x.answer, x.note, day]; })
    .concat(batch.noteIds.map((id) => { const x = batch.notes[id] || { text: "", item: "" }; return [x.item || "", "", x.text, day]; }));
  log(`ack ${bid}: handled, ${k} cards closed. The answers go to decisions.md when the next read no longer lists the batch`);
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
// The guide document of a Markdown text: a section keeps its updated time while its title and body stay the same.
function guideDoc(id, kind, text, old, item, t) {
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
  return { doc, errs };
}
// The guide document: the --id itself.
function guideId(id) { if (!S.idRe.test(id)) fail("guide: --id <id> with 1 to 100 of A-Z a-z 0-9 _ - . ~ : @ +"); return id; }
// The dump gives the old content (the status that the page sets, the section times); the version comes from the state.
function cmdGuide(a, log) {
  const dump = readDump(one(a, "dump")), r = new Run(a), id = guideId(one(a, "id")), ex = dump.col("guides").get(id), t = now();
  if (id.toLowerCase() === RULES_ID) fail(`guide: the guide rules is posted by check from board/rules.md. Run node ${SELF} check`);
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
  const item = a.item ? one(a, "item") : (old ? old.item : "");
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { fail("guide: cannot read " + file); }
  const { doc, errs } = guideDoc(id, kind, text, old, item, t);
  if (errs.length) fail(errs.map((e) => "guide " + id + ": " + e));
  const norm = (x) => { const y = plain(P.coerce("guide", x)); y.updated = ""; y.body = ""; return JSON.stringify(y); };
  if (old && norm(doc) === norm(ex.data)) { log(`guide ${id}: unchanged`); return r.finish(log); }
  r.pinned("set", "guides", id, doc, dumped);
  log(`guide ${id}: ${doc.sections.filter((s) => s.updated === t).length} of ${doc.sections.length} sections changed`);
  r.finish(log);
}

// ---- the operator's rules: <state dir>/rules.md. check posts it as the guide "rules" whenever its hash changed;
// read only says that it changed. The agent never posts it with guide.
const RULES_ID = "rules";
function rulesFile(r) { return path.join(r.dir, "rules.md"); }
// What check does with rules.md: changed = its hash differs from the state's rules_md; write = changed and it has a
// section, or it lost every section after a post (then the guide is deleted).
function rulesState(r) {
  const file = rulesFile(r);
  if (!fs.existsSync(file)) return { file, exists: false, changed: false, write: false };
  const buf = fs.readFileSync(file), text = buf.toString("utf8"), hash = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  const g = parseGuide(text), posted = r.st.next["guides/" + RULES_ID] !== undefined, changed = hash !== r.st.rules_md;
  return { file, exists: true, text, hash, g, posted, changed, write: changed && (g.secs.length > 0 || posted) };
}
// The one rules line of check or read, or "". a: the parsed arguments, for the --state of the printed command.
function rulesLine(rs, cmd, a) {
  if (cmd === "check" && !rs.exists) return `rules: no ${rel(rs.file)}. Read references/rules.md, "Start the rules", and follow it`;
  if (!rs.write) return "";
  if (cmd === "check") return `rules: ${rel(rs.file)} changed. Read it; check posts it as the guide rules in the array below`;
  return `rules: ${rel(rs.file)} changed. Run node ${SELF} check${a.state ? " --state " + q(one(a, "state")) : ""} and pass its array`;
}
// check: the guide document of rules.md with its problems. old is the last guide write that check printed, so a
// section keeps its updated time while its title and body stay the same.
function rulesDoc(r, rs, t) {
  const pw = r.st.pending["guides/" + RULES_ID];
  const old = pw && pw.op === "set" && pw.file_path && fs.existsSync(pw.file_path) ? plain(P.coerce("guide", JSON.parse(fs.readFileSync(pw.file_path, "utf8")))) : null;
  if (old) old.status = "active";
  const { doc, errs } = guideDoc(RULES_ID, "text", rs.text, old, "", t);
  return { doc, errs: errs.map((e) => `rules: ${rel(rs.file)}: ${e}`) };
}
// check, on success: the guide write (set, or delete when every section is gone), then the new hash.
function queueRules(r, rs, rd) {
  if (!rs.changed) return;
  if (rd) r.pinned("set", "guides", RULES_ID, rd.doc);
  else if (rs.write) r.pinned("delete", "guides", RULES_ID, null);
  r.st.rules_md = rs.hash;
}
// read: the words of the config list standing as one regex, case ignored, whole words only; the default list
// when the config value is not valid (check reports it).
function standingOk(v) { return Array.isArray(v) && v.length >= 1 && v.length <= 50 && v.every((x) => typeof x === "string" && x.trim().length >= 1 && x.trim().length <= 40); }
function standingRe(v) {
  const list = (standingOk(v) ? v : SCRIPT_DEFAULTS.standing).map((x) => x.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  return new RegExp("(?<![\\p{L}\\p{N}])(" + list.join("|") + ")(?![\\p{L}\\p{N}])", "iu");
}

// ---- purge: copy every row to disk, then take the cards off the board and delete their responses, and
// the handled batches that hold only purged cards, except the newest batch. The cards stay in the state,
// listed in purge, until adopt sees them gone from the board.
function cmdPurge(a, log) {
  const dump = readDump(one(a, "dump")), r = new Run(a), resps = dump.col("responses"), batches = dump.col("batches");
  const already = new Set(r.st.purge || []);
  // An earlier purge whose rows the board still holds is adopted first; one the board holds is forgotten.
  for (const k of purgeKeys(r)) {
    if (r.st.pending[k].some((w) => dump.col(w.collection).has(w.doc_id))) fail(`purge: ${k} has not landed yet. Run \`node ${SELF} adopt ${k} --dump ${one(a, "dump")} --dumped\` first`);
    delete r.st.pending[k];
  }
  let ids = a.ids || [];
  const before = one(a, "closed-before");
  if (!ids.length && !before) fail("purge: give --ids <id>... or --closed-before <YYYY-MM-DD>");
  if (before) {
    if (!P.realDate(before)) fail("purge: --closed-before takes a date such as 2026-01-31");
    // A card closed before that day in the config tz.
    ids = ids.concat(r.st.cards.filter((c) => c.status === "closed" && P.stampMs(c.updated) !== -Infinity && P.dayIn(P.stampMs(c.updated), P.cfg.tz) < before).map((c) => c.id));
  }
  ids = Array.from(new Set(ids)).filter((id) => !already.has(id));
  r.needCards(ids, "purge");
  if (!ids.length) { log("purge: nothing to delete"); return; }
  const gone = new Set(ids), rows = [];
  ids.forEach((id) => { if (resps.has(id)) rows.push(["responses", id, resps.get(id)]); });
  const all = batchesOf(dump), newest = all[all.length - 1];
  all.filter((b) => b !== newest && b.itemIds.length && !b.noteIds.length && b.itemIds.every((x) => gone.has(x)) && P.isHandled(b))
    .forEach((b) => rows.push(["batches", b.id, batches.get(b.id)]));
  rows.forEach(([c, id, d]) => pin(c, id, d));
  const stamp = P.compactStamp(now()), keep = path.join(r.dir, "purged", stamp);
  const copy = (c, id, raw) => { fs.mkdirSync(path.join(keep, c), { recursive: true }); fs.writeFileSync(path.join(keep, c, fname(id) + ".json"), JSON.stringify(raw, null, 1) + "\n"); };
  ids.forEach((id) => copy("cards", id, r.card(id)));
  rows.forEach(([c, id, d]) => copy(c, id, { version: d.version, data: d.data }));
  rows.forEach(([c, id, d]) => r.put("delete", c, id, null, d.version, undefined, "purge/" + stamp));
  r.st.purge = Array.from(already).concat(ids);
  r.putCards();
  const by = (c) => rows.filter((x) => x[0] === c).length;
  log(`purge/${stamp}: ${ids.length} cards, ${by("responses")} responses, ${by("batches")} batches. Copies: ${path.relative(process.cwd(), keep) || keep}`);
  r.finish(log);
}

// ---- adopt: after a refused write of one document. Missing from the dump means gone from the board.
// For cards/main: add every card that the board has and the state lacks, keep the later "updated" of a
// card in both, say what changed, and write the merged list pinned to the board's version. For another
// document: if the board holds the last write, take its version; else print the write again on it.
// Every adopt reads absence from the dump, so it runs only with --dumped.
function holds(d, w) {
  // A batch missing from a status == "sent" dump is handled or purged.
  if (w.collection === "batches" && w.op === "update") return !d || P.coerce("batch", d.data).status === "handled";
  if (w.op === "delete") return !d;
  if (!d) return false;
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
      changed.push(w.doc_id);
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
  const key = a._[1] || "cards";
  if (!a.dumped) fail(`adopt: no --dumped. Dump again as the "if refused" line says; once every call succeeded, run node ${SELF} adopt ${key} --dump ${one(a, "dump")} --dumped`);
  const dump = readDump(one(a, "dump")), r = new Run(a), w = r.st.pending[key], ctx = r.ctx(), again = (ws) => ws.map((out) => ({ out, size: 0, group: key }));
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
    return printWrites(again(left), log, ctx);
  }
  const [c, id] = key === "cards" ? ["cards", CARDS] : key.split(/\/(.*)/s), d = dump.col(c).get(id);
  // A batch is dumped by P4, without versions: its write keeps the version it was printed with, unless the dump has one.
  const v = c === "batches" ? (d && Number.isInteger(d.version) && d.version >= 1 ? d.version : undefined) : d ? pin(c, id, d) : undefined;
  if (key === "cards") {
    const purge = new Set(r.st.purge || []), add = [], took = [], kept = [];
    for (const bc of d && Array.isArray(d.data.cards) ? d.data.cards.filter(P.isObj) : []) {
      if (purge.has(bc.id)) continue;
      const sc = r.card(bc.id);
      if (!sc) { r.st.cards.push(bc); add.push(bc.id); }
      else if (stable(sc) !== stable(bc)) {
        if (P.cmpStamp(bc.updated, sc.updated) > 0) { r.st.cards[r.st.cards.indexOf(sc)] = bc; took.push(bc.id); } else kept.push(bc.id);
      }
    }
    const ids = (x) => x.map(qid).join(", ");
    if (add.length) log(`cards: added from the board ${ids(add)}`);
    if (took.length) log(`cards: took the board's newer copy of ${ids(took)}`);
    if (kept.length) log(`cards: kept this state's newer copy of ${ids(kept)}`);
    // The purge is done when the board holds none of its cards.
    if (purge.size && !(d && d.data.cards || []).some((x) => P.isObj(x) && purge.has(x.id))) { r.st.cards = r.st.cards.filter((x) => !purge.has(x.id)); delete r.st.purge; log(`cards: the purge of ${ids(Array.from(purge))} is done`); }
    if (v === undefined) delete r.st.next.cards; else r.st.next.cards = v;
    const byId = (l) => stable((Array.isArray(l) ? l : []).slice().sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1)));
    if (d && byId(d.data.cards) === byId(r.cardsDoc().cards)) log(`cards: the board holds this state's cards, version ${v}`);
    else { log(`cards: write again, pinned to ${v === undefined ? "a create" : "version " + v}`); r.putCards(); }
    return r.finish(log);
  }
  // An ack --close also wrote cards in its batch call: that write goes again while it is this state's last cards
  // write and the dumped board lacks it.
  const aw = [].concat(w)[0], cw = [].concat(w).find((x) => x.collection === "cards");
  const also = cw && stable(cw) === stable(r.st.pending.cards) && !holds(dump.col("cards").get(CARDS), cw) ? [cw] : [];
  if (holds(d, aw)) {
    log(`${key}: the board holds the last write${v === undefined || c === "batches" ? "" : ", version " + v}`);
    if (c === "batches") r.logHandled(dump, log);
    else if (v === undefined) delete r.st.next[key]; else r.st.next[key] = v;
    if (!also.length) return r.finish(log);
    log(`${key}: the cards write of this ack is not on the board: write it again`);
    r.finish(() => {});
    return printWrites(again(also), log, ctx);
  }
  const out = Object.assign({}, aw);
  if (c === "batches") { if (v !== undefined) out.if_version = v; } else if (v === undefined) delete out.if_version; else out.if_version = v;
  r.st.pending[key] = also.length ? [out].concat(also) : out;
  if (c !== "batches") { if (aw.op === "delete") delete r.st.next[key]; else r.st.next[key] = v === undefined ? 1 : v + 1; }
  log(`${key}: write again, pinned to ${out.if_version === undefined ? "a create" : "version " + out.if_version}${also.length ? ", with its cards write" : ""}`);
  r.finish(() => {});
  printWrites(again([out].concat(also)), log, ctx);
}
// push: the last write of a document again, as it was printed; for an ack with --close and a purge, the group.
function cmdPush(a, log) {
  const r = new Run(a), key = a._[1] || "cards", w = r.st.pending[key];
  if (!w) fail(`push: no write of ${key} in ${r.file}`);
  printWrites([].concat(w).map((out) => ({ out, size: 0, group: key })), log, r.ctx());
}

// ---- check: the config layers and the state, locally. Prints the meta/config write when the merged page keys changed.
// The first folder from the folder of file up to the root that holds a .git entry, else "".
function inGitTree(file) {
  for (let d = path.dirname(path.resolve(file)); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return "";
  }
}
// A config value in one short text.
function valueText(v) {
  if (typeof v === "string") return v.length > 60 ? JSON.stringify(v.slice(0, 57)) + "..." : JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length === 1 ? "1 entry" : v.length + " entries";
  if (isPlain(v)) return "{" + Object.keys(v).join(", ") + "}";
  return String(v);
}
// The layer files, the layer of each set key, the keys left at their defaults, and the ids that sync accepts.
function configLines(load) {
  const out = [], [u, b, l] = load.files, nFiles = load.files.filter((f) => f.exists).length;
  const set = CONFIG_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(load.src, k));
  out.push(`config layers: user ${!u.file ? "off" : u.exists ? tilde(u.file) : "none"}, board ${b.exists ? rel(b.file) : "none"}, local ${l.exists ? rel(l.file) : "none"}`);
  if (nFiles === 1 && set.length) out.push(`config ${load.files.find((f) => f.exists).name}: ${set.join(", ")}`);
  if (nFiles >= 2) for (const k of set) out.push(`config ${k}: ${load.src[k].join(", ")}  ${valueText(load.config[k])}${SCRIPT_KEYS.includes(k) ? "  (script only)" : ""}`);
  const unset = CONFIG_KEYS.filter((k) => !SCRIPT_KEYS.includes(k) && !set.includes(k));
  if (unset.length) out.push(`config default: ${unset.join(", ")}`);
  out.push(`config ids: tags ${P.cfg.tags.map((t) => t.id).join(", ") || "none"}; priorities ${P.cfg.priorities.map((p) => p.id).join(", ")}`);
  return out;
}
function cmdCheck(a, log) {
  const r = new Run(a, { create: true }), errs = [];
  const t = now();
  const rs = rulesState(r);
  // Two state files in one folder would share the out files and drop cards.
  for (const f of (fs.existsSync(r.dir) ? fs.readdirSync(r.dir) : []).filter((x) => x.endsWith(".json")).map((x) => path.join(r.dir, x))) {
    let o;
    try { o = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { continue; }
    if (f !== r.file && isPlain(o) && Array.isArray(o.cards) && isPlain(o.next))
      fail(`check: ${f} is already a state file in this folder. One state file per board folder: use it, or another folder`);
  }
  r.needConfig(true);
  const raw = r.config, c = P.cfg;
  errs.push(...r.load.problems.map((p) => "config " + p));
  for (const k of ["tabs", "priorities", "domains", "link_hosts", "tags"]) {
    if (raw[k] === undefined) continue;
    const got = c[k] === P.DEFAULTS[k] && Array.isArray(raw[k]) && raw[k].length ? 0 : c[k].length;
    if (!Array.isArray(raw[k]) || got < raw[k].length) errs.push(`config ${k}: ${got} of ${Array.isArray(raw[k]) ? raw[k].length : "a non-list"} entries kept`);
  }
  errs.push(...r.load.unknown);
  if (raw.tz !== undefined && !P.tzOk(raw.tz)) errs.push(`config tz: ${q(raw.tz)} is not a time zone name such as "Europe/Warsaw" or "UTC"`);
  const ck = compileChecks(raw.checks === undefined ? [] : raw.checks);
  errs.push(...ck.problems);
  if (r.config.standing !== undefined && !standingOk(r.config.standing)) errs.push("config standing: a list of 1 to 50 texts, each 1 to 40 characters");
  const rd = rs.write && rs.g.secs.length ? rulesDoc(r, rs, t) : null;
  if (rd) errs.push(...rd.errs);
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
  log(`state ${path.relative(process.cwd(), r.file) || r.file}: cards ${r.st.cards.length} (${Object.entries(count).map(([k, v]) => k + " " + v).join(", ") || "none"}); times in ${P.cfg.tz}`);
  configLines(r.load).forEach((l) => log(l));
  const uf = r.load.files[0], ut = uf.exists ? inGitTree(uf.file) : "";
  if (ut) log(`note: the user config ${tilde(uf.file)} is inside the git work tree ${ut}: keep it out of every repository`);
  if (!P.cfg.link_hosts.length) log("note: config link_hosts: none, so sync refuses every card link. A card needs no link");
  const rl = rulesLine(rs, "check", a);
  if (rl) log(rl);
  // A state card that breaks a check is a note: a new check must not block the config write that brings it.
  r.st.cards.forEach((x) => { if (P.isObj(x) && typeof x.id === "string") checkHits(x, ck.checks).forEach((h) => log(`note: card ${qid(x.id)}: ${h}`)); });
  errs.forEach((e) => log("problem: " + e));
  if (errs.length) throw new Stop(errs.length + " problems");
  const mf = path.join(r.dir, "config.merged.json"), body = JSON.stringify(r.load.merged, null, 1) + "\n";
  if (!fs.existsSync(mf) || fs.readFileSync(mf, "utf8") !== body) { fs.mkdirSync(r.dir, { recursive: true }); fs.writeFileSync(mf, body); }
  const w = r.st.pending["meta/config"];
  const last = w && fs.existsSync(w.file_path) ? { data: JSON.parse(fs.readFileSync(w.file_path, "utf8")) } : null;
  if (!(last && stable(last.data) === stable(r.load.page))) r.pinned("set", "meta", "config", r.load.page);
  log(`config: ${r.writes.some((x) => x.key === "meta/config") ? "changed, write it" : "unchanged"}`);
  queueRules(r, rs, rd);
  r.finish(log);
}

export const COMMANDS = { check: cmdCheck, sync: cmdSync, close: cmdClose, read: cmdRead, waiting: cmdWaiting, ack: cmdAck, guide: cmdGuide, purge: cmdPurge, adopt: cmdAdopt, push: cmdPush };
export function run(argv, log = console.log) {
  const a = parseArgs(argv), cmd = COMMANDS[a._[0]];
  if (!cmd) { log(USAGE); return 2; }
  if (!FLAGS[a._[0]]) { log(`${a._[0]}: no FLAGS line for this command in board.mjs`); return 1; }
  for (const key of Object.keys(a)) if (key !== "_" && key !== "raw" && !FLAGS[a._[0]].includes(key)) { log(`${a._[0]}: unknown flag --${key}`); return 1; }
  try { cmd(a, log); return 0; } catch (e) { if (e instanceof Stop) { log(e.message); return 1; } throw e; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
