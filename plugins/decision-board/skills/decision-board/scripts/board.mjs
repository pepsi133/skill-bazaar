#!/usr/bin/env node
// The script layer of the decision board. Node 18 or later, no dependencies, no network access.
// A write command changes the state, writes one JSON file per document into board/out/, and prints
// the `writes` array of one ArtifactData batch call. Reads take the files that ArtifactData saved with out_dir.
// Fields, kinds and limits come from the "pure" part of assets/board.html, so page and script cannot drift.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// A path as a word of a printed command line: bare when it is made of safe characters and does not start with - or
// ~, else in single quotes with each ' written as '\''. No shell expands anything inside single quotes.
const SAFE_PATH = /^[A-Za-z0-9_./:@%+=,-]+$/;
const safePath = (p) => SAFE_PATH.test(p) && !/^[-~]/.test(p);
function shq(p) { p = String(p); return safePath(p) ? p : "'" + p.replace(/'/g, "'\\''") + "'"; }
// The same for a path that the script always printed in double quotes: a safe path keeps them, as before.
function dq(p) { p = String(p); return safePath(p) ? '"' + p + '"' : shq(p); }
// A path that cannot stay on one printed line: a control character, U+2028 or U+2029.
const badPath = (p) => /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(p);
const pathRefusal = (cmd, p) => `${cmd}: the path ${q(p)} holds a line break or a control character; use another path`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WAIT_SH = path.resolve(HERE, "..", "assets", "wait.sh");
const SELF = shq(path.relative(process.cwd(), fileURLToPath(import.meta.url)) || "board.mjs");
const USAGE = `Usage: node ${SELF} <command> ... [--state <file>]
  check [--url <link>]                      merge the config layers, check them and the state; print the meta/config write when it changed; --url stores the artifact link for watch
  sync <file> [--source <s>] [<file> [--source <s>]]... [--allow-close]   add and change cards; a --source closes that source's cards its file no longer holds
  close <id>...                             close cards
  read --dump <dir> [--all] --dumped        the batches that wait (dump: batches with status "sent"); --dumped: the dump calls succeeded; --all also prints handled ones
  waiting (--dump <dir> | --count <watch file> --watcher <id>)   the ids of the batches that wait, or "none"; --count: the watcher's step, with the poll count and the dump folder of the watch file
  ack <batch id> [--close <id>...] [--result <id> <text>]... --dump <dir>   mark a batch handled, apply its controls, close cards, store result lines
  status [--now <text>] [--next <text>...] [--waiting <text>] [--idle]   say what you do; one write of meta/status
  watch [--restart]                         what to do about a watcher, from the config wake mode; may write meta/status; --restart: a new window and watcher, also inside a running window or after the poll limit, only when the operator asks
  guide [<file.md>] --id <id> [--kind text|status|reference] [--item <card id>] [--archive | --delete] --dump <dir>
  purge (--ids <id>... | --closed-before <YYYY-MM-DD>) --dump <dir>
  adopt [cards | guides/<id> | meta/config | meta/status | batches/<id> | purge/<stamp>] --dump <dir> --dumped   after a refused write: merge the board copy, print the write again
  push [cards | guides/<id> | meta/config | meta/status | batches/<id> | purge/<stamp>]   print the last write of a document again
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
    f: { tab: "all" }, loaded: { config: true }, isPending: () => false, lingerOf: () => "", URL });
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
// JSON, with what JSON leaves raw escaped too: DEL and the C1 controls, the line separators U+2028 and U+2029,
// the bidi controls, U+200B and U+FEFF; never U+200C and U+200D, which words and emoji need. q quotes one text.
const js = (x) => JSON.stringify(x).replace(/[\u007f-\u009f\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const q = (s) => js(String(s));
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
const SWITCHES = ["archive", "delete", "allow-close", "all", "dumped", "idle", "restart"];
// The flags each command takes. A new command adds its line here.
export const FLAGS = {
  check: ["state", "url"],
  sync: ["state", "source", "allow-close"],
  close: ["state"],
  read: ["state", "dump", "all", "dumped"],
  waiting: ["dump", "count", "watcher"],
  ack: ["state", "dump", "close", "result"],
  guide: ["state", "dump", "id", "kind", "item", "archive", "delete"],
  purge: ["state", "dump", "ids", "closed-before"],
  adopt: ["state", "dump", "dumped"],
  push: ["state"],
  status: ["state", "now", "next", "waiting", "idle"],
  watch: ["state", "restart"],
};
function parseArgs(argv) {
  // No prototype: a flag such as --__proto__ or --constructor is a plain key, refused as an unknown flag.
  // --_ and --raw would overwrite the positionals and the raw order: they are kept aside (BAD) and refused.
  const a = Object.assign(Object.create(null), { _: [], raw: argv });
  let cur = null;
  for (const v of argv) {
    if (v.startsWith("--")) {
      const key = v.slice(2);
      if (key === "_" || key === "raw") { if (a[BAD] === undefined) a[BAD] = key; cur = []; continue; }
      a[key] = a[key] || [];
      cur = SWITCHES.includes(key) ? null : a[key];
    } else if (cur) cur.push(v);
    else a._.push(v);
  }
  return a;
}
const BAD = Symbol("a flag that is a key of the parsed arguments");
// The --state part of a printed command line: the --state the command was given, else nothing.
const stateArg = (a) => (a.state ? " --state " + dq(one(a, "state")) : "");
const one = (a, k) => (a[k] && a[k].length ? a[k][a[k].length - 1] : "");
// The words after the last --k up to the next flag, joined with one space: a text given without quotes.
const words = (a, k) => { const i = a.raw.lastIndexOf("--" + k), out = []; for (let j = i + 1; i >= 0 && j < a.raw.length && !a.raw[j].startsWith("--"); j++) out.push(a.raw[j]); return out.join(" "); };

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
// An id that the script prints as a word of a command line: the page's idRe, and not a leading - (a flag) or ~ (the
// shell expands it).
const plainId = (s) => typeof s === "string" && S.idRe.test(s) && !/^[-~]/.test(s);
// A config id (a tag, a priority) in a printed line: as it is when plain, else JSON-quoted.
const idText = (s) => (plainId(s) ? s : q(s));
// A path in an error line: as it is, or JSON-quoted when it holds a space, a quote, a backslash, $, a backtick,
// a C1 control or a bidi or zero-width character.
const shownPath = (p) => (/[\s"'`$\\\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(p) ? q(p) : p);
// Wrapped: exactly version and an object data, maybe id. Version and an object data beside other keys is no known shape.
function isWrapped(raw, file) {
  if (!isPlain(raw) || !isPlain(raw.data) || !Object.prototype.hasOwnProperty.call(raw, "version")) return false;
  if (Object.keys(raw).every((k) => k === "version" || k === "data" || k === "id")) return true;
  fail("unknown dump shape: " + shownPath(file) + " holds version and data beside other keys. Dump the board again");
}
// The version of a dumped document that a write pins. A missing or broken version stops the command.
function pin(collection, id, ex) {
  if (!ex) return undefined;
  if (!Number.isInteger(ex.version) || ex.version < 1) fail(`${collection}/${qid(id)}: the dump has no whole-number version. Save the document lines of the dump replies to versions.txt in the dump folder, or dump again; write nothing until then`);
  return ex.version;
}
export function readDump(dir, only) {
  if (!dir) fail("--dump <dir> is required");
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) fail(`--dump ${shownPath(dir)}: not a folder. Give the dump folder`);
  const cols = new Map(), listed = new Map(), vt = path.join(dir, "versions.txt");
  let skipped = 0;
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
      // A batch id is printed inside command lines: only a plain id gets in; the others are counted, never shown.
      if (name === "batches" && !plainId(unname(f.slice(0, -5)))) { skipped++; continue; }
      let raw;
      try { raw = JSON.parse(fs.readFileSync(path.join(sub, f), "utf8")); } catch (e) { fail("cannot read " + shownPath(path.join(sub, f)) + ": " + e.message); }
      const wrapped = isWrapped(raw, path.join(sub, f)), data = wrapped ? ownCopy(raw.data) : isPlain(raw) ? ownCopy(raw) : {};
      const version = isPlain(raw) && raw.version !== undefined ? raw.version : listed.get(path.resolve(sub, f));
      if (!wrapped) delete data.version;
      docs.set(unname(f.slice(0, -5)), { data, version });
    }
    cols.set(name, docs);
  }
  return { dir, col: (n) => cols.get(n) || new Map(), skipped };
}
// The one line a command prints when its dump held batches whose id is not a batch id.
function skipLine(dump, log) { if (dump.skipped) log(`skipped ${dump.skipped} batches with an id that is not a batch id`); }

// ---- the state: {cards, next, pending, refreshed, purge, held, unlogged}. next maps "cards" (cards/main),
// "guides/<id>" and "meta/config" to the version that the next write pins (1 after a create, N + 1 after a write
// pinned to N); absent means create. pending holds the last write printed for each, for "batches/<id>" an ack (see
// ackEntry), and the deletes of "purge/<stamp>". refreshed is the time of the last sync
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
// A pending ack, pending["batches/<id>"], as {write, cards}: the batch update (absent once the board holds it) and
// whether the ack changed cards. It never holds a cards write: push and adopt build that from the state, with the
// pin of the moment. Stored as the batch update alone, or as {write, cards: true}. An older state's list of the
// batch update and a cards write reads as {write, cards: true}; its cards write is dropped.
function ackEntry(v) {
  const isW = (x) => isPlain(x) && typeof x.collection === "string";
  if (Array.isArray(v)) return { write: v.find((x) => isW(x) && x.collection === "batches"), cards: v.some((x) => isW(x) && x.collection === "cards") };
  if (isW(v)) return { write: v, cards: false };
  return { write: isPlain(v) && isW(v.write) ? v.write : undefined, cards: isPlain(v) && v.cards === true };
}
const ackValue = (e) => (e.cards ? Object.assign(e.write ? { write: e.write } : {}, { cards: true }) : e.write);

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
const userValueOk = (v) => path.isAbsolute(v) || v.startsWith("~/");
function userConfigPath() {
  const v = process.env.BOARD_USER_CONFIG, x = process.env.XDG_CONFIG_HOME;
  // ~/ means the home folder; a relative value is refused by loadConfig and turns the layer off.
  if (v !== undefined) return v === "" || !userValueOk(v) ? "" : v.startsWith("~/") ? path.join(os.homedir(), v.slice(2)) : path.resolve(v);
  if (x && path.isAbsolute(x)) return path.join(x, "decision-board", "config.json");
  return path.join(os.homedir(), ".config", "decision-board", "config.json");
}
function tilde(file) { const h = os.homedir() + path.sep; return file.startsWith(h) ? "~/" + file.slice(h.length) : file; }
function rel(file) { return path.relative(process.cwd(), file) || file; }
// A layer file of the board folder by its folder and file name, the same from any working directory.
function boardName(file) { return path.basename(path.dirname(file)) + "/" + path.basename(file); }
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
  return "Settings: " + files.filter((f) => f.exists).map((f) => (f.name === "user" ? tilde(f.file) : boardName(f.file))).join(", ");
}
// The group and tab entries of one raw layer file. The merge drops a key whose value is null, so a null in a match widens
// it, up to a group that takes every card, and a null label falls back to the id: each null is a problem, named by
// the key in that file. A label that is not text too.
function groupProblems(name, data) {
  const out = [];
  for (const kind of ["groups", "tabs"]) {
    // A group without its match takes every card; a tab without it takes none by source or tag.
    const whole = kind === "groups" ? "null takes every card" : "null drops the match, so the tab takes no card by source or tag";
    const walk = (v, at) => {
      if (Array.isArray(v)) v.forEach((x, j) => (x === null ? out.push(`${name}: ${at}[${j}]: ${whole}; give a match or remove the entry`) : walk(x, `${at}[${j}]`)));
      else if (isPlain(v)) for (const k of Object.keys(v)) {
        if (v[k] === null) out.push(`${name}: ${at}.${k}: null drops the key and ${kind === "groups" ? "widens" : "changes"} the match; give a value or remove the key`);
        else walk(v[k], `${at}.${k}`);
      }
    };
    for (const k of [kind, "+" + kind]) {
      const list = ownVal(data, k);
      if (!Array.isArray(list)) continue;
      list.forEach((g, i) => {
        if (!isPlain(g)) return;
        const at = `${k}[${i}]`, m = ownVal(g, "match"), label = ownVal(g, "label");
        if (m === null) out.push(`${name}: ${at}.match: ${whole}; give a match or remove the key`);
        else walk(m, at + ".match");
        if (label === null) out.push(`${name}: ${at}.label: null; give a text or remove the key`);
        else if (label !== undefined && typeof label !== "string") out.push(`${name}: ${at}.label: not text`);
      });
    }
  }
  return out;
}
// The three layer files of a board folder, merged over the defaults. page: the keys for meta/config; merged: the
// full config for config.merged.json; unknown: the unknown-field problems of each file, top level only.
function loadConfig(dir) {
  const u = userConfigPath(), files = [["user", u], ["board", path.join(dir, "config.json")], ["local", path.join(dir, "config.local.json")]]
    .map(([name, file]) => ({ name, file, exists: !!file && fs.existsSync(file) }));
  // A user file that is a folder is no layer: a problem that names the variable, not a read error.
  const userDir = files[0].exists && fs.statSync(u).isDirectory();
  if (userDir) files[0].exists = false;
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
  for (const { name, data } of layers) problems.push(...groupProblems(name, data));
  const uv = process.env.BOARD_USER_CONFIG;
  if (uv && !userValueOk(uv)) problems.push("user: BOARD_USER_CONFIG must be an absolute path or start with ~/: unset it or give such a path");
  if (userDir) problems.push(`user: BOARD_USER_CONFIG names the folder ${shownPath(tilde(u))}: give the path of a JSON file or unset it`);
  const page =Object.assign({}, config), merged = Object.assign(pageDefaults(), config);
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
    if (badPath(this.file)) fail(pathRefusal(a._[0], this.file));
    const saved = readJson(this.file);
    if (saved && (!isPlain(saved) || !Array.isArray(saved.cards) || !saved.cards.every(isPlain) || !isPlain(saved.next)))
      fail(this.file + ": not a state file {cards, next}");
    if (saved && olderModel(saved)) fail(`${this.file}: a state file of an older board model. Delete it and run \`node ${SELF} check${stateArg(a)}\``);
    if (!saved && !o.create) fail(`no state ${this.file}. Run \`node ${SELF} check${stateArg(a)}\` once to make it`);
    this.saved = saved;
    this.st = saved ? plain(saved) : { cards: [], next: {} };
    for (const k of ["pending", "unlogged"]) this.st[k] = isPlain(this.st[k]) ? this.st[k] : {};
    // A batch id is printed inside command lines: a pending ack or log entry of an id that is not plain goes.
    for (const id of Object.keys(this.st.unlogged)) if (!plainId(id)) delete this.st.unlogged[id];
    // A purge key is printed inside command lines too: only a plain stamp stays.
    for (const k of Object.keys(this.st.pending)) if (k.startsWith("purge/") && !plainId(k.slice(6))) delete this.st.pending[k];
    for (const k of Object.keys(this.st.pending)) if (k.startsWith("batches/")) {
      if (!plainId(k.slice(8))) { delete this.st.pending[k]; continue; }
      const v = ackValue(ackEntry(this.st.pending[k]));
      if (v) this.st.pending[k] = v; else delete this.st.pending[k];
    }
    // cards_wait, a key of an older script: the batches whose cards write was still owed. Each plain id gets the
    // cards flag on its pending ack, then the key goes.
    for (const id of isPlain(this.st.cards_wait) ? Object.keys(this.st.cards_wait) : []) {
      if (UNSAFE.has(id) || !plainId(id)) continue;
      const k = "batches/" + id, e = ackEntry(this.st.pending[k]);
      this.st.pending[k] = ackValue({ write: e.write, cards: true });
    }
    delete this.st.cards_wait;
    for (const k of ["ctl_closed", "snoozed"]) if (this.st[k] !== undefined && !isPlain(this.st[k])) delete this.st[k];
    // Values the script prints or acts on: only what it writes itself (a real wake day, a known close reason).
    for (const [id, x] of Object.entries(this.st.snoozed || {})) if (!isPlain(x) || !P.realDate(x.day)) delete this.st.snoozed[id];
    for (const [id, x] of Object.entries(this.st.ctl_closed || {})) if (!["other", "dismiss", "done"].includes(x)) delete this.st.ctl_closed[id];
    // src_closed: the ids of ctl_closed whose card its source had closed before the control.
    if (this.st.src_closed !== undefined) this.st.src_closed = Array.isArray(this.st.src_closed) ? this.st.src_closed.filter((id) => typeof id === "string" && ownVal(this.st.ctl_closed || {}, id)) : [];
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
      fail(`no config: write ${rel(this.configFile)}${u ? " or the user file " + tilde(u) : ""} (references/data-model.md), then run \`node ${SELF} check${stateArg(this.a)}\``);
    }
    if (!fromCheck && this.load.problems.length) fail(this.load.problems.map((p) => "config " + p).concat(`fix the config, then run \`node ${SELF} check${stateArg(this.a)}\``));
  }
  card(id) { return this.st.cards.find((c) => c.id === id); }
  needCards(ids, cmd) {
    const missing = ids.filter((id) => !this.card(id));
    if (missing.length) fail(cmd + ": no card " + missing.map(qid).join(", ") + " in " + this.file);
  }
  // A write of a document whose version the state keeps: pinned to next, else to the dumped version (a
  // document that this state never wrote), else a create.
  pinned(op, collection, id, data, dumped, also, group) {
    const key = collection === "cards" ? "cards" : collection + "/" + id;
    const v = this.st.next[key] !== undefined ? this.st.next[key] : dumped;
    this.put(op, collection, id, data, v, key, also, group);
    if (op === "delete") delete this.st.next[key]; else this.st.next[key] = v === undefined ? 1 : v + 1;
  }
  // The cards document: the cards that a purge did not take off the board, and the time of the last sync.
  cardsDoc() { const gone = new Set(this.st.purge || []); return { cards: this.st.cards.filter((c) => !gone.has(c.id)), refreshed: this.st.refreshed || "" }; }
  // group: the pending key whose lines the cards write goes under (an ack's batch), else its own.
  putCards(group) { this.pinned("set", "cards", CARDS, this.cardsDoc(), undefined, undefined, group); }
  // push batches/<id>: the cards built now, pinned like push cards: with the pin of the last cards write this state
  // printed (absent: a create), never a version this state has not seen. The board refuses it when the ack's array
  // did land or another writer moved cards/main; adopt then merges.
  putCardsAgain(group) {
    const last = this.st.pending.cards, v = isPlain(last) && Number.isInteger(last.if_version) ? last.if_version : undefined;
    this.put("set", "cards", CARDS, this.cardsDoc(), v, "cards", undefined, group);
    this.st.next.cards = v === undefined ? 1 : v + 1;
  }
  // sync, close and ack of a handled batch, before finish: one note per pending ack that changed cards, unless this
  // command writes the cards itself, which carries that ack's closes.
  ackNotes(log) {
    if (this.writes.some((x) => x.w.collection === "cards")) return;
    for (const k of Object.keys(this.st.pending)) {
      // The load keeps only plain batch ids in pending; the test stays so no other id can reach the line.
      const id = k.slice(8), e = ackEntry(this.st.pending[k]);
      if (!k.startsWith("batches/") || !plainId(id) || !e.cards) continue;
      // Without its batch update the ack is handled on the board and only its cards are owed.
      if (!e.write) log(`note: the cards of ack ${id} are not on the board: node ${SELF} push batches/${id}${this.ctx().state}`);
      else log(`note: ack ${id} changed cards. If its batch call was refused or its reply lost: node ${SELF} push batches/${id}${this.ctx().state}; else do nothing`);
    }
  }
  // A command that read a dump holding cards/main: an ack that owed only its cards is done when they are on the board.
  clearCardsOnly(dump) {
    const d = dump.col("cards").get(CARDS);
    if (!d || !holdsCards(this, d)) return;
    for (const k of Object.keys(this.st.pending)) if (k.startsWith("batches/") && !ackEntry(this.st.pending[k]).write) delete this.st.pending[k];
  }
  // A batch update printed again as it is stored (its out file and pin); cards: the flag of its pending ack.
  rePut(out, key, cards) { this.writes.push({ w: out, data: null, key, flag: cards }); }
  // close and ack --close: the cards stay closed through sync (held) until their content changes.
  closeCards(ids, t) {
    let k = 0;
    for (const id of ids) { const c = this.card(id); if (c.status !== "closed") { c.status = "closed"; c.updated = t; k++; } }
    this.st.held = Array.from(new Set((this.st.held || []).concat(ids)));
    return k;
  }
  // ack: undo a control close. Back to open, out of held; the content and rev stay.
  openCards(ids, t) {
    let k = 0;
    for (const id of ids) { const c = this.card(id); if (c && c.status === "closed") { c.status = "open"; c.updated = t; k++; } }
    this.st.held = (this.st.held || []).filter((x) => !ids.includes(x));
    return k;
  }
  put(op, collection, doc_id, data, if_version, key, also, group) { this.writes.push({ w: { op, collection, doc_id, if_version }, data, key, also, group }); }
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
  // also: the pending key of a group of writes (a purge's deletes). The group of a write (group, else also, else
  // its key) names the adopt and push lines printed under the array. flag: a batch update stored as a pending ack
  // that changed cards.
  finish(log) {
    const list = this.writes.map(({ w, data, key, also, group, flag }) => {
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
      if (key) this.st.pending[key] = flag ? { write: out, cards: true } : out;
      if (also) this.st.pending[also] = [].concat(this.st.pending[also] || [], out);
      return { out, size: data ? JSON.stringify(data).length : 0, group: group || also || key };
    });
    for (const k of ["pending", "unlogged"]) if (!Object.keys(this.st[k]).length) delete this.st[k];
    if (this.st.purge && !this.st.purge.length) delete this.st.purge;
    if (this.st.held) this.st.held = this.st.held.filter((id) => this.card(id));
    if (this.st.held && !this.st.held.length) delete this.st.held;
    for (const k of ["ctl_closed", "snoozed"]) if (this.st[k]) {
      for (const id of Object.keys(this.st[k])) if (!this.card(id)) delete this.st[k][id];
      if (!Object.keys(this.st[k]).length) delete this.st[k];
    }
    if (this.st.src_closed) this.st.src_closed = this.st.src_closed.filter((id) => this.st.ctl_closed && ownVal(this.st.ctl_closed, id));
    if (this.st.src_closed && !this.st.src_closed.length) delete this.st.src_closed;
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
    return { dump: shq(a.dump ? one(a, "dump") : path.relative(process.cwd(), path.join(this.dir, "dump")) || "dump"), state: stateArg(a) };
  }
}
// The calls that dump what adopt needs for a group: the agent never picks the collections itself.
function dumpCalls(group) {
  if (group === "cards") return "P2 cards with versions";
  if (group.startsWith("guides/")) return "P2 guides with versions";
  if (group === "meta/config" || group === "meta/status") return "P2 meta with versions";
  if (group.startsWith("batches/")) return "P4 and P2 cards";
  return "P2 responses, batches and cards with versions";
}
// Each array, then for each group of its writes the line for a refused write and the line for a lost reply. A group
// is a pending key, and every id in one is a plain id (readDump, the state load, guideId and docKey check them).
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
    log(js(c.map((w) => w.out)));
    for (const g of Array.from(new Set(c.map((w) => w.group).filter(Boolean)))) {
      log(`if refused: rm -rf ${ctx.dump}, then ${dumpCalls(g)}, then node ${SELF} adopt ${g} --dump ${ctx.dump} --dumped${ctx.state}`);
      log(`if the reply is lost: node ${SELF} push ${g}${ctx.state}`);
    }
  });
}
const cell = (s) => String(s).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");

// ---- cards
const CONTENT = ["title", "summary", "evidence", "draft", "draft_label", "options", "recommendation", "kind", "links"];
const MANAGED = ["rev", "created", "updated", "result", "result_at"];
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
  else if (!plainId(c.id)) out.push("id: must not start with - or ~");
  else if (ids.has(c.id)) out.push("id: twice in these files");
  if (typeof c.title !== "string" || !c.title.trim()) out.push("title: missing");
  if (c.kind !== undefined && !P.cfg.kinds.some((k) => k.id === c.kind)) out.push("kind: not one of " + P.cfg.kinds.map((k) => k.id).join(", "));
  if (c.priority !== undefined && !P.cfg.priorities.some((k) => k.id === c.priority)) out.push("priority: not one of " + P.cfg.priorities.map((k) => idText(k.id)).join(", "));
  if (c.status !== undefined && !S.statuses.includes(c.status)) out.push("status: not one of " + S.statuses.join(", "));
  const decision = (c.kind === undefined ? "decision" : c.kind) === "decision";
  if (Array.isArray(c.options)) {
    if (c.options.length > S.max.options) out.push("options: more than " + S.max.options);
    if (new Set(c.options).size !== c.options.length || c.options.some((o) => typeof o === "string" && !o.trim())) out.push("options: empty or repeated");
  }
  if (decision && (c.options === undefined || (Array.isArray(c.options) && c.options.length < 2))) out.push("options: a decision card needs 2 to " + S.max.options);
  if (typeof c.recommendation === "string" && c.recommendation && !P.optionsOf(P.coerce("item", c)).includes(c.recommendation)) out.push("recommendation: not one of the options");
  if (typeof c.draft === "string" && !c.draft.trim()) out.push("draft: only spaces; leave it out");
  if (c.draft_label !== undefined && (typeof c.draft !== "string" || !c.draft.trim())) out.push("draft_label: needs a draft");
  out.push(...linkProblems(c.links), ...tagProblems(c.tags));
  if (c.first_asked === undefined) { if (P.needsAsked(c)) out.push('first_asked: required on an open card whose kind is not info: {"date": "YYYY-MM-DD", "who": "..."}'); }
  else if (P.isObj(c.first_asked)) {
    const fa = c.first_asked, tomorrow = P.addDays(P.dayIn(nowMs(), P.cfg.tz), 1);
    if (!P.realDate(fa.date)) out.push("first_asked.date: not a real calendar date written YYYY-MM-DD");
    else if (fa.date > tomorrow) out.push("first_asked.date: later than tomorrow");
    if (fa.who !== undefined && !P.whoOk(fa.who)) out.push("first_asked.who: empty, or at most 40 of A-Z a-z 0-9 _ - . ~ : @ +");
  }
  if (c.due !== undefined && !P.realDate(c.due)) out.push("due: not a real calendar date written YYYY-MM-DD");
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
  const out = bad.length ? [`tags: ${bad.map((t) => js(t)).join(", ")} not in the config tags${known.length ? " (" + known.map(idText).join(", ") + ")" : ". Set tags in config.json first"}`] : [];
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
// The regex tests run with a time limit, so a regex that backtracks without end (such as ^(a+)+$ on a long text)
// stops: fn() runs in one vm context for the whole run. null when the time ran out.
const CHECK_MS = 1000, TIMED = new vm.Script("fn()");
let timedCtx = null;
function timed(fn) {
  if (!timedCtx) timedCtx = vm.createContext(Object.create(null));
  timedCtx.fn = fn;
  try { return TIMED.runInContext(timedCtx, { timeout: CHECK_MS }); }
  catch (e) { if (e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return null; throw e; }
  finally { timedCtx.fn = null; }
}
// Whether card c fails check k (its when already applies).
function checkFails(c, k) {
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
  return k.forbid ? vals.some(hit) : !vals.some((v) => { k.re.lastIndex = 0; return k.re.test(v); });
}
// The checks that card c fails, as "check <ref>: <message>", in list order. A closed card passes every check.
// The checks of one card run in one timed call; at tracks the one that runs. When the time runs out, that check runs
// again alone with the whole limit if others ran before it in the call; if it still runs out, it fails closed as
// "check <ref>: took too long" (slow, when given, collects that line), is marked slow, and no later card runs it.
// The checks after it still run.
export function checkHits(c, checks, slow) {
  if (!isPlain(c) || c.status === "closed") return [];
  const todo = checks.filter((k) => !k.slow && !(k.when && ((k.when.source && !k.when.source.map(lower).includes(lower(c.source))) ||
    (k.when.tags && !(Array.isArray(c.tags) && c.tags.some((t) => k.when.tags.includes(t)))))));
  const res = new Map();
  let at = 0;
  const runFrom = () => { for (; at < todo.length; at++) res.set(todo[at], checkFails(c, todo[at])); return true; };
  while (at < todo.length) {
    const start = at;
    if (timed(runFrom) !== null) break;
    const k = todo[at], alone = at > start ? timed(() => checkFails(c, k)) : null;
    if (alone === null) { k.slow = true; res.set(k, null); } else res.set(k, alone);
    at++;
  }
  const out = [];
  for (const k of todo) {
    const f = res.get(k);
    if (f === null) { const l = `check ${k.ref}: took too long`; out.push(l); if (slow) slow.push(l); }
    else if (f) out.push(`check ${k.ref}: ${k.message}`);
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
// A card of a card file in a problem line: its id (quoted when it is not an id), else its place in the files.
const cardName = (c, i) => (c && typeof c.id === "string" && c.id ? qid(c.id) : "#" + (i + 1));
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
      if (f.source && c.source !== undefined && lower(c.source) !== f.source) errs.push(`${typeof c.id === "string" && c.id ? qid(c.id) : "?"}: source: not the --source ${q(f.source)}`);
      if (f.source) c.source = f.source;
      // source_key names the item a Close or an assign to the agent may write to: only a map file, synced with its
      // --source, carries it.
      if (!f.source && P.isObj(c) && c.source_key !== undefined) errs.push(`${typeof c.id === "string" && c.id ? qid(c.id) : "?"}: source_key: set only by board-refresh map; sync that file with --source`);
      cards.push({ c, f });
    });
  }
  cards.forEach(({ c }, i) => { if (P.isObj(c) && (has(c, "result") || has(c, "result_at"))) errs.push(`${cardName(c, i)}: result: set only by ack --result`); errs.push(...cardProblems(c, cardName(c, i), ids)); if (c && typeof c.id === "string") ids.add(c.id); });
  const ck = compileChecks(r.config.checks === undefined ? [] : r.config.checks);
  if (ck.problems.length) fail(ck.problems.concat("fix the config, then run `node " + SELF + " check" + stateArg(a) + "`"));
  let hit = false, slowHit = false;
  cards.forEach(({ c }, i) => {
    if (!P.isObj(c)) return;
    const slow = [], h = checkHits(c, ck.checks, slow);
    if (h.some((x) => !slow.includes(x))) hit = true;
    if (slow.length) slowHit = true;
    errs.push(...h.map((x) => cardName(c, i) + ": " + x));
  });
  if (hit) errs.push("a check line that does not say took too long is a rule of the operator's config: change the card, never the check");
  // A check that ran out of time says nothing about the card: the check itself needs the change.
  if (slowHit) errs.push("a took too long line is a check too slow to run: ask the operator to change that check in the config; leave the card as it is");
  // A source may lose at most half of its open cards in one run, unless --allow-close.
  for (const s of new Set(files.map((f) => f.source).filter(Boolean))) {
    const open = r.st.cards.filter((c) => lower(c.source) === s && c.status !== "closed"), gone = open.filter((c) => !ids.has(c.id));
    if (!allow && gone.length * 2 > open.length) errs.push(`sync: --source ${s} would close ${gone.length} of ${open.length} open cards (${gone.map((c) => c.id).join(", ")}). If the fetch held every row, rerun with --allow-close; else fetch again`);
  }
  if (errs.length) fail(errs);
  const t = now(), n = { new: 0, rev: 0, changed: 0, same: 0 }, closed = [], reopened = [], held = new Set(r.st.held || []);
  const noLink = [];
  const warn = [];
  const defPri = P.cfg.priorities[Math.min(1, P.cfg.priorities.length - 1)].id;
  const ctl = Object.assign({}, r.st.ctl_closed || {});
  // A card in its source's file again is no longer one that its source closed: an undo of its control reopens it.
  const srcBack = new Set(cards.filter(({ c, f }) => f.source && P.isObj(c)).map(({ c }) => c.id));
  if (r.st.src_closed) r.st.src_closed = r.st.src_closed.filter((id) => !srcBack.has(id));
  let dropped = 0;
  for (const { c, f } of cards) {
    const ex = r.card(c.id), old = ex ? plain(P.coerce("item", ex)) : null, doc = { id: c.id };
    for (const k of Object.keys(S.item)) if (k !== "id" && !MANAGED.includes(k) && c[k] !== undefined) doc[k] = c[k];
    // A card file without input keeps the stored marker (a row that lacks the field must not erase it).
    if (doc.input === undefined && ex && typeof ex.input === "string") doc.input = ex.input;
    if (Array.isArray(doc.links)) doc.links = doc.links.map((l) => Object.assign({}, l, { url: new URL(l.url).href }));
    doc.priority = c.priority || (old && old.priority) || defPri;
    const content = !old || contentKey(doc) !== contentKey(old);
    // A card the operator dismissed or marked done comes back as a new question (rev up) when its source brings a
    // new input. A card without a stored input comes back only on a content change, so the first map run with an
    // input key reopens nothing. Never a card the agent closed: its own work in the source changes that input.
    const back = !!ex && held.has(c.id) && (ctl[c.id] === "dismiss" || ctl[c.id] === "done") && typeof doc.input === "string" &&
      typeof ex.input === "string" && ex.input !== "" && doc.input !== ex.input;
    if (content) { const w = P.draftWarning(c.draft); if (w) warn.push(`warning: ${qid(c.id)}: draft starts with ${q(w)}; put notes in summary`); }
    // A card back in its source's file is open again, unless close or ack --close closed it (held); elsewhere a
    // closed card stays closed. Either way until its content changes.
    if ((content || back) && ctl[c.id] !== "other") { held.delete(c.id); delete ctl[c.id]; }
    doc.status = c.status || (old && !content && !back && (!f.source || held.has(c.id)) ? old.status : "open") || "open";
    if (ctl[c.id] === "other") doc.status = "closed";
    const strip = (x) => { const y = plain(P.coerce("item", x)); MANAGED.forEach((k) => delete y[k]); return JSON.stringify(y); };
    if (old && strip(doc) === strip(ex)) { n.same++; continue; }
    // The no-link count: open cards new or changed in this sync, not the operator's rule cards.
    if (doc.status === "open" && lower(doc.source) !== "rules" && !(Array.isArray(doc.links) && doc.links.length)) noLink.push(c.id);
    if (old && old.status === "closed" && doc.status === "open") reopened.push(c.id);
    doc.rev = old ? old.rev + (content || back ? 1 : 0) : 1;
    if (old && ex.result) { if (doc.rev === old.rev) { doc.result = ex.result; doc.result_at = ex.result_at; } else dropped++; }
    doc.created = (old && old.created) || t;
    doc.updated = t;
    if (ex) r.st.cards[r.st.cards.indexOf(ex)] = doc; else r.st.cards.push(doc);
    if (!old) n.new++; else if (content || back) n.rev++; else n.changed++;
  }
  const sources = new Set(files.map((f) => f.source).filter(Boolean));
  for (const c of r.st.cards) {
    if (sources.has(lower(c.source)) && !ids.has(c.id) && c.status !== "closed") { c.status = "closed"; c.updated = t; closed.push(c.id); }
    // A card a control holds closed whose row its source no longer has: an undo must not reopen it.
    if (sources.has(lower(c.source)) && !ids.has(c.id) && ctl[c.id] && !(r.st.src_closed || []).includes(c.id)) r.st.src_closed = (r.st.src_closed || []).concat(c.id);
  }
  const size = JSON.stringify(r.cardsDoc()).length;
  if (size > MAX_DOC) fail(`sync: the cards document would be ${size} characters, over ${MAX_DOC}. Nothing changed. Close and purge old cards first`);
  log(`sync: ${n.new} new, ${n.rev} changed (rev up), ${n.changed} changed (same rev), ${n.same} unchanged, ${closed.length} closed${closed.length ? " (" + closed.join(", ") + ")" : ""}` +
    (reopened.length ? `, ${reopened.length} reopened (${reopened.join(", ")})` : "") + (dropped ? `, ${dropped} results dropped (rev up)` : ""));
  if (noLink.length) log(`note: no link: ${noLink.length} cards`);
  warn.slice(0, 3).forEach((l) => log(l));
  if (warn.length > 3) log(`warning: and ${warn.length - 3} more drafts that start with a label`);
  if (n.new + n.rev + n.changed + closed.length) { r.st.refreshed = t; r.putCards(); }
  r.st.held = Array.from(held);
  r.st.ctl_closed = ctl;
  r.ackNotes(log);
  r.finish(log);
}
function cmdClose(a, log) {
  const r = new Run(a), ids = a._.slice(1), t = now();
  if (!ids.length) fail("close: name the card ids");
  plainCardIds(ids, "close");
  r.needCards(ids, "close");
  const k = r.closeCards(ids, t);
  log(`close: ${k} cards closed`);
  if (k) r.putCards();
  r.ackNotes(log);
  r.finish(log);
}

// ---- read. Every database text goes through q(), and an id that is not a plain id too, so no value can forge a line.
// The answers of a batch are keyed by card id. A batch waits while its status is "sent"; the order is by instant, then id.
const qid = (s) => (S.idRe.test(s) ? s : q(s));
// The control lines of a batch: one entry per changed control, in controlIds order, then SCHEMA.controlNames order.
// tags is one entry when tags_on or tags_off is present. keep is never an entry (it is not in S.controlNames).
// The number of cards a batch holds controls for: the ids of controlIds that have a controls entry.
const nCtl = (b) => b.controlIds.filter((id) => b.controls[id]).length;
function controlsOf(b) {
  const out = [];
  for (const id of b.controlIds) {
    const x = b.controls[id];
    if (!x) continue;
    for (const key of S.controlNames) {
      if (key === "tags" ? x.tags_on !== undefined || x.tags_off !== undefined : x[key] !== undefined) out.push({ id, key, x });
    }
  }
  return out;
}
// The flags of one control line; an empty list means the agent and ack act on it.
function ctlFlags(r, e) {
  const c = r.card(e.id), flags = [];
  // A card that a purge took off the board is not on the board, though the state keeps it until adopt.
  if (!c || (r.st.purge || []).includes(e.id)) return ["[missing]"];
  const rev = P.coerce("item", c).rev;
  if (S.revBound.includes(e.key)) { if (e.x.rev < rev) flags.push("[stale-rev]"); else if (e.x.rev !== rev) flags.push("[other-rev]"); }
  if (!P.cfg.controls[e.key]) flags.push("[not-enabled]");
  const v = e.x[e.key], tagIds = P.cfg.tags.map((t) => t.id);
  const bad = e.key === "assign" ? v !== "" && !P.assignIds().includes(v)
    : e.key === "snooze" ? v !== "" && !P.realDate(v)
    : e.key === "tags" ? [...(e.x.tags_on || []), ...(e.x.tags_off || [])].some((t) => !tagIds.includes(t))
    : v !== "on" && v !== "off";
  if (bad) flags.push("[bad-value]");
  // A close needs the item: a card without source_key names none (only map cards have one).
  if (e.key === "close" && v === "on" && !(typeof c.source_key === "string" && c.source_key.trim())) flags.push("[no-item]");
  return flags;
}
// The value as read prints it. Database text goes through q() or js(), so no value can forge a line.
const ctlText = (e) => (e.key === "tags" ? `+${js(e.x.tags_on || [])} -${js(e.x.tags_off || [])}` : q(e.x[e.key]));
// The value as decisions.md logs it.
const ctlPlain = (e) => (e.key === "tags" ? [...(e.x.tags_on || []).map((t) => "+" + t), ...(e.x.tags_off || []).map((t) => "-" + t)].join(" ") || "none"
  : e.x[e.key] === "" ? "none" : e.x[e.key]);
// The source item of a card as read names it: source, source_key and the first link, each through q(); a card
// with no link (links are optional) prints the bare words "link none" in the link's place.
const itemOf = (c) => {
  const url = Array.isArray(c.links) && c.links[0] && typeof c.links[0].url === "string" ? c.links[0].url : "";
  return `item ${q(c.source || "")} ${q(c.source_key || "")} ${url ? q(url) : "link none"}`;
};
// What the agent does with one control line, printed in brackets at its end: the script decides, the agent follows.
// flags: the line's flags ([superseded] included). The close step of every source is worded here, in one place.
function ctlHint(c, e, flags) {
  // The hints below print the card id inside --close and --result: only a plain id.
  if (flags.length || !plainId(e.id)) return "(skip)";
  const v = e.x[e.key];
  if (e.key === "close" && v === "on") return `(close ${itemOf(c)} in its source with the operator's own tool for it; change nothing else there; then add --close ${qid(e.id)} to the ack line; if you cannot, add --result ${qid(e.id)} "not closed: <why, in a few words>" to it instead)`;
  if (e.key === "assign" && v === "agent") return typeof c.source_key === "string" && c.source_key.trim()
    ? `(do the work the card asks; in a source change only ${itemOf(c)}; leave the card open and add --result ${qid(e.id)} "<what you did, in a few words>" to the ack line)`
    : `(do the work the card asks, with no write to any source; leave the card open and add --result ${qid(e.id)} "<what you did, in a few words>" to the ack line)`;
  if (e.key === "assign" || e.key === "dismiss" || e.key === "done") return "(ack applies it)";
  // A wake day that is today or already past asks for nothing.
  if (e.key === "snooze" && v !== "" && v > P.dayIn(nowMs(), P.cfg.tz)) return `(no follow-up before ${v})`;
  return "(nothing to do)";
}
// read: the running snoozes of the state, as one line, or "". Drops the ones whose day came (today in the config
// tz), whose card changed rev, or whose card is closed or gone. ack writes r.st.snoozed.
function snoozedLine(r) {
  const today = P.dayIn(nowMs(), P.cfg.tz), s = r.st.snoozed || {}, out = [];
  for (const id of Object.keys(s)) {
    const c = r.card(id), x = s[id];
    if (!c || c.status === "closed" || !isPlain(x) || P.coerce("item", c).rev !== x.rev || !(String(x.day) > today)) delete s[id];
    else out.push(`${qid(id)} before ${x.day}`);
  }
  if (r.st.snoozed && !Object.keys(r.st.snoozed).length) delete r.st.snoozed;
  return out.length ? "snoozed: do not follow up on " + out.join(", ") : "";
}
const byTime = (x, y) => P.cmpStamp(x.created, y.created) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
// A batch as the script reads it: coerced, with each card id once in controlIds (the first occurrence wins).
const batchOf = (data, id) => { const b = Object.assign(P.coerce("batch", data), { id }); b.controlIds = Array.from(new Set(b.controlIds)); return b; };
const batchesOf = (dump) => Array.from(dump.col("batches").entries()).map(([id, d]) => batchOf(d.data, id)).sort(byTime);
const waiting = (dump) => batchesOf(dump).filter((b) => b.status === "sent");
// A stamp as read prints it: in the config tz, or as it is when it is unreadable.
const shown = (s) => P.localStamp(s, P.cfg.tz) || s;
// waiting needs no state: it reads only <dump>/batches.
const REPLACED = 'another watcher took over. Report exactly: "replaced by a newer watcher". Then stop.';
function cmdWaiting(a, log) {
  // The watcher does exactly what the one line says: no skip line here (read prints it to the owning session).
  if (!a.count) {                                                        // the form without --count
    const list = waiting(readDump(one(a, "dump"), "batches"));
    log(list.length ? list.map((b) => qid(b.id)).join("\n") : "none"); return;
  }
  const file = path.resolve(one(a, "count")), w = readWatch(file);
  const notWatch = `waiting: ${file} is not a watch file. Report "watch file missing, run node S watch" and stop`;
  if (!w) fail(notWatch);
  // The watcher's reports name watch with the --state of the watch that started it; inside the quoted report the
  // path takes single quotes (shq) when it needs any.
  // A state path that cannot sit inside the quoted report (a line break, a double quote, a bidi or zero-width
  // character) is left out.
  const st = typeof w.state === "string" && w.state && !badPath(w.state) && !/["\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(w.state) ? " --state " + shq(w.state) : "";
  // A newer watch started another watcher and wrote its id: this one changes nothing and stops. A file from before
  // ids holds none and is counted for a call without --watcher. A call and a file of which only one names an id
  // come from different versions of the brief: no newer watcher is known, so the report says the brief is old.
  // A quote, a backtick or a closing mark copied around the id is never part of an id the script makes.
  const id = one(a, "watcher").replace(/^['"`]+/, "").replace(/[.,;:'")\]`]+$/, "");
  const wrote = `. Report "watch file not written, run node S watch${st}" and stop`;
  if (id && w.watcher !== undefined && id !== w.watcher) { log(REPLACED); return; }
  if (!id !== (w.watcher === undefined)) {
    // No watcher of this window polls any more: the mark lets the next plain watch start one.
    if (!keepWatch(file, Object.assign(w, { stopped: true }), notWatch, wrote)) { log(REPLACED); return; }
    log('this watcher\'s brief is out of date. Report exactly: "watcher brief out of date: the operator can restart the watcher". Then stop.'); return;
  }
  // The dump folder comes from the watch file; a --dump that is given must be it.
  if (a.dump && path.resolve(one(a, "dump")) !== w.dump) fail(`waiting: --dump is not the dump folder of ${file}. Report "wrong dump folder, run node S watch${st}" and stop`);
  let list;
  try { list = waiting(readDump(w.dump, "batches")); } catch (e) {
    if (!(e instanceof Stop)) throw e;
    fail(`waiting: the dump folder of ${file} cannot be read. Report "watch dump unreadable, run node S watch${st}" and stop`);
  }
  fs.rmSync(w.dump, { recursive: true, force: true });                 // the next poll starts clean; no rm in the brief
  // A watch that started a new window since the read above owns the file now: keep its write and stop this watcher.
  const save = () => keepWatch(file, w, notWatch, wrote);
  if (list.length) {
    w.reported = true;
    if (!save()) { log(REPLACED); return; }
    log(`batches ${list.map((b) => qid(b.id)).join(" ")} wait. Report exactly: "batches wait: run Read and handle the answers". Then stop.`);
    return;
  }
  // At the limit already: say so again and keep the count at the limit, so watch still sees the ended window.
  if (w.poll < w.limit) { w.poll += 1; if (!save()) { log(REPLACED); return; } }
  if (w.poll >= w.limit) { log(`none, poll ${w.poll} of ${w.limit}: the limit. Report exactly: "no batch, poll limit reached: run node S watch${st} and do what it prints". Then stop.`); return; }
  log(`none, poll ${w.poll} of ${w.limit}. Run bash ${dq(WAIT_SH)} ${w.seconds} in the foreground, then go to step 1.`);
}
// read: what the agent does with one answer or note line of a sent batch, printed in brackets at its end.
// flags: the line's flags, a list. The script decides, the agent follows.
function lineHint(flags, a) {
  const dir = shq(one(a, "dump")), st = stateArg(a);
  if (flags.includes("[stale-rev]") || flags.includes("[missing]")) return "(skip)";
  if (flags.includes("[other-rev]")) return `(skip; after the ack: rm -rf ${dir}, then P2 cards with versions, then node ${SELF} adopt cards --dump ${dir} --dumped${st})`;
  if (flags.includes("[question]")) return "(answer the note in the card text and post the card again)";
  if (flags.includes("[rule]") || flags.includes("[standing]")) return "(read references/rules.md and do what it says for this line)";
  return "(act on it)";
}
function cmdRead(a, log) {
  const dir = one(a, "dump");
  if (!a.dumped) fail(`read: no --dumped. Run rm -rf ${shq(dir)}, then P4; once P4 succeeded, run node ${SELF} read --dump ${shq(dir)} --dumped${stateArg(a)}`);
  const dump = readDump(dir), r = new Run(a), list = a.all ? batchesOf(dump) : waiting(dump);
  skipLine(dump, log);
  r.clearCardsOnly(dump);
  { const rl = rulesLine(rulesState(r), "read", a); if (rl) log(rl); }
  const stand = standingRe(r.config ? r.config.standing : undefined);
  r.logHandled(dump, log);
  { const sl = snoozedLine(r); if (sl) log(sl); }
  if (!list.length) log(a.all ? "no batches in the dump" : "no batches waiting");
  // A control that a later waiting batch of this list sets again for the same card is superseded.
  const later = new Set(), sup = new Set();
  for (const b of list.slice().reverse()) if (b.status === "sent") for (const e of controlsOf(b)) {
    const k = e.id + "\n" + e.key;
    if (later.has(k)) sup.add(b.id + "\n" + k); else later.add(k);
  }
  for (const b of list) {
    const sent = b.status === "sent";
    log(`batch ${qid(b.id)}  ${q(shown(b.created))}  ${b.itemIds.length} answers  ${b.noteIds.length} notes${nCtl(b) ? "  controls on " + nCtl(b) + " cards" : ""}${b.status === "handled" ? `  handled ${q(shown(b.handled_at))}` : ""}`);
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
    for (const e of controlsOf(b)) {
      const fl = ctlFlags(r, e).concat(sup.has(b.id + "\n" + e.id + "\n" + e.key) ? ["[superseded]"] : []);
      log(`  ${qid(e.id)}  control ${e.key} ${ctlText(e)}${fl.length ? "  " + fl.join(" ") : ""}${b.status === "sent" ? "  " + ctlHint(r.card(e.id), e, fl) : ""}`);
    }
    for (const id of b.noteIds) {
      const nb = b.notes[id] || { text: "", item: "" }, nflags = [];
      if (stand.test(nb.text)) nflags.push("[standing]");
      log(`  note ${qid(id)}${nb.item ? "  item " + q(nb.item) : ""}  ${q(nb.text)}${nflags.length ? "  " + nflags.join(" ") : ""}${sent ? "  " + lineHint(nflags, a) : ""}`);
    }
    if (sent && r.st.pending["batches/" + b.id]) log("  " + pushHint(b.id, r));
    else if (sent) log(`  when handled: node ${SELF} ack ${qid(b.id)} --dump ${shq(one(a, "dump"))}${stateArg(a)}`);
  }
  r.finish(() => {});
}

// ack and read: the line for a batch whose ack this state printed but the dump does not show as handled.
// bid is a plain id: ack checks its argument, and readDump lets only plain batch ids in.
const pushHint = (bid, r) => `ack ${bid}: its write is printed but not confirmed. Run: node ${SELF} push batches/${bid}${r.ctx().state}`;
// Card ids that a command prints inside a command line: plain ids only, else one refusal that shows the id quoted.
function plainCardIds(ids, cmd) { const bad = ids.find((id) => !plainId(id)); if (bad !== undefined) fail(`${cmd}: ${q(bad)} is not a card id`); }
// ---- ack: an update of batches/<id> to status "handled", pinned to version 1 (the page writes a batch once, with
// set, and never again), with the cards write of --close. Its answers go to decisions.md once a read no longer
// lists the batch as waiting.
function cmdAck(a, log) {
  // Ids printed in command lines below: a batch id and every --close id must be plain ids.
  if (a._[1] && !plainId(a._[1])) fail(`ack: ${q(a._[1])} is not a batch id`);
  plainCardIds(a.close || [], "ack --close");
  const bid = a._[1], dump = readDump(one(a, "dump")), r = new Run(a), b = bid && dump.col("batches").get(bid);
  skipLine(dump, log);
  r.clearCardsOnly(dump);
  const batch = b ? batchOf(b.data, bid) : null;
  // --result is checked in every branch, before the already-handled one, so a rerun after a lost reply still
  // stores it. A pending ack stores none (its write goes again through push); a batch missing from the dump with
  // no pending ack fails first with the no-batch line.
  const pend = !!(bid && r.st.pending["batches/" + bid]);
  const res = batch || pend ? a.result || [] : [], t = now(), pairs = [];
  const nFlags = batch || pend ? a.raw.filter((x) => x === "--result").length : 0;
  if (res.length % 2 || res.length !== 2 * nFlags) fail("ack --result: give a card id and one text per --result");
  for (let i = 0; i < res.length; i += 2) pairs.push([res[i], cleanText(res[i + 1], S.max.result)]);
  r.needCards(pairs.map((p) => p[0]), "ack");
  const rerr = [], seenIds = new Set();
  for (const [id, text] of pairs) {
    if (seenIds.has(id)) rerr.push(`ack --result: card ${qid(id)} twice`); seenIds.add(id);
    if (!text) rerr.push(`ack --result ${qid(id)}: empty text`);
  }
  if (rerr.length) fail(rerr.join("\n"));
  const setResults = () => { for (const [id, text] of pairs) { const c = r.card(id); c.result = text; c.result_at = t; c.updated = t; } return pairs.length; };
  // What was stored, after cleanText, one line per result (printed after the ack line in both branches).
  const resultLines = () => pairs.map(([id, text]) => `  result ${qid(id)}: ${q(text)}`);
  const close = a.close || [];
  if (batch && batch.status === "handled") {
    // A pending ack of this batch that changed cards: the board may lack its closes. A cards write of this run
    // carries them; else the ack stays pending without its batch update, and the note names its push.
    const flagged = ackEntry(r.st.pending["batches/" + bid]).cards;
    r.needCards(close, "ack");
    if (pairs.length) {
      const m = setResults();
      log(`ack ${bid}: already handled, ${m} results stored`);
      for (const l of resultLines()) log(l);
    } else log(`ack ${bid}: already handled`);
    if (close.length) log(`ack ${qid(bid)}: --close ${close.map(qid).join(" ")} not applied. Run: node ${SELF} close ${close.map(qid).join(" ")}${r.ctx().state}`);
    if (pairs.length) r.putCards();
    if (flagged && !pairs.length) r.st.pending["batches/" + bid] = ackValue({ cards: true }); else delete r.st.pending["batches/" + bid];
    r.ackNotes(log);
    return r.finish(log);
  }
  // An ack this state already printed whose write the dump does not show yet: acking it again would apply its
  // controls a second time. Its write goes again through push; a --close of this run is not applied.
  if (pend) {
    log(pushHint(bid, r));
    if (close.length) log(`ack ${bid}: --close ${close.map(qid).join(" ")} not applied. After the push is confirmed, run: node ${SELF} close ${close.map(qid).join(" ")}${r.ctx().state}`);
    if (pairs.length) log(`ack ${bid}: --result not stored. After the push is confirmed, run this ack again with --result`);
    return r.finish(log);
  }
  if (!b) fail(bid ? `ack: no batch ${qid(bid)} in the dump: already handled or not dumped` : "ack: no batch named in the dump");
  if (batch.status !== "sent") fail(`ack: batch ${bid} has status ${q(batch.status)}, not "sent". Nothing written`);
  r.needCards(close, "ack");
  const mineIds = new Set(batch.controlIds);
  // An earlier batch that this state already acked (its write is pending, not yet in the dump) does not block:
  // the agent may ack several batches from one dump, in the order read printed them.
  const first = waiting(dump).find((x) => x.id !== bid && byTime(x, batch) < 0 && !r.st.pending["batches/" + x.id] &&
    x.controlIds.some((id) => mineIds.has(id)));
  if (first) fail(`ack: ack ${qid(first.id)} first: it holds controls for the same cards. Nothing written`);
  // The placement of each card: closed for a control (ctl_closed holds why), or reopened when the control that
  // closed it is undone. A card the agent closed itself never enters ctl_closed.
  const toClose = new Set(), toOpen = new Set(), ctl = Object.assign({}, r.st.ctl_closed || {}), ownClosed = new Set(r.st.held || []);
  // src: the cards whose control arrived after their source had closed them; an undo leaves those closed (unheld).
  const src = new Set(r.st.src_closed || []), unheld = [];
  // The value of one place key: the changed value, else the kept one; undefined when absent or flagged.
  const v = (id, key) => {
    const x = batch.controls[id], raw = x[key] !== undefined ? x[key] : x.keep ? x.keep[key] : undefined;
    if (raw === undefined) return undefined;
    return ctlFlags(r, { id, key, x: { rev: x.rev, [key]: raw } }).length ? undefined : raw;
  };
  for (const id of batch.controlIds) {
    const x = batch.controls[id];
    if (!x || !r.card(id) || !S.placeKeys.some((k) => x[k] !== undefined)) continue;
    const why = v(id, "assign") === "other" ? "other" : v(id, "dismiss") === "on" ? "dismiss" : v(id, "done") === "on" ? "done" : "";
    // A card that its source closed (closed, not held by the agent's own close) takes the control too, so the
    // card stays closed when the row comes back unchanged. An agent's own close never enters ctl.
    const wasOpen = r.card(id).status !== "closed", bySource = !wasOpen && !ctl[id] && !ownClosed.has(id);
    if (why && (wasOpen || ctl[id] || bySource)) { toClose.add(id); ctl[id] = why; if (bySource) src.add(id); }
    else if (!why && ctl[id]) { delete ctl[id]; if (src.delete(id)) unheld.push(id); else toOpen.add(id); }
  }
  r.st.ctl_closed = ctl;
  // The running snoozes; a flagged snooze changes nothing.
  const sn = Object.assign({}, r.st.snoozed || {});
  for (const e of controlsOf(batch)) {
    if (e.key !== "snooze" || ctlFlags(r, e).length) continue;
    if (e.x.snooze === "") delete sn[e.id]; else sn[e.id] = { day: e.x.snooze, rev: e.x.rev };
  }
  r.st.snoozed = sn;                                              // finish() deletes an empty object
  // An explicit --close wins over a reopen: the card is now the agent's own close.
  // The source mark stays: an own close does not bring the row back to its source.
  for (const id of close) toOpen.delete(id);
  const k1 = r.closeCards(Array.from(toClose), t);
  const j = r.openCards(Array.from(toOpen), t);
  // An undone control on a card its source closed: the card stays closed as the source left it, not held.
  r.st.held = (r.st.held || []).filter((x) => !unheld.includes(x));
  r.st.src_closed = Array.from(src);
  const k2 = r.closeCards(close, t), k = k1 + k2;
  const m = setResults();
  // One array: the batch update, and the cards write when cards changed. The pending ack keeps the batch update
  // and that flag only; the state holds every close and control effect, so push and adopt build the cards anew.
  r.put("update", "batches", bid, { status: "handled", handled_at: t }, 1, "batches/" + bid);
  if (k + j + m > 0) { r.writes[r.writes.length - 1].flag = true; r.putCards("batches/" + bid); }
  const day = P.stampMs(batch.created) === -Infinity ? "" : P.dayIn(P.stampMs(batch.created), P.cfg.tz);
  r.st.unlogged[bid] = batch.itemIds.map((key) => { const x = batch.answers[key] || { answer: "", note: "" }; return [key, x.answer, x.note, day]; })
    .concat(controlsOf(batch).map((e) => { const fl = ctlFlags(r, e); return [e.id, "control " + e.key + " " + ctlPlain(e) + (fl.length ? " " + fl.join(" ") : ""), "", day]; }))
    .concat(batch.noteIds.map((id) => { const x = batch.notes[id] || { text: "", item: "" }; return [x.item || "", "", x.text, day]; }));
  log(`ack ${bid}: handled, ${k} cards closed${j ? `, ${j} reopened` : ""}${m ? `, ${m} results` : ""}. The answers go to decisions.md when the next read no longer lists the batch`);
  for (const l of resultLines()) log(l);
  if (P.cfg.status.guide) log(statusGuideLine(r, a, "Add what you did with this batch"));
  r.finish(log);
}
// The status guide line of ack and guide.
function statusGuideLine(r, a, what) {
  const f = rel(path.join(r.dir, "status.md"));
  return `status guide: on in the config. ${what} in ${f}, dump guides with versions, then run node ${SELF} guide ${shq(f)} --id status --kind status --dump ${shq(one(a, "dump") || "board/dump")}${stateArg(a)} and pass its array`;
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
  r.clearCardsOnly(dump);
  if (id.toLowerCase() === RULES_ID) fail(`guide: the guide rules is posted by check from board/rules.md. Run node ${SELF} check${stateArg(a)}`);
  const old = ex ? plain(P.coerce("guide", ex.data)) : null, dumped = ex ? pin("guides", id, ex) : undefined;
  if (a.delete || a.archive) {
    if (!ex) fail("guide: no guide " + id + " in the dump");
    if (a.delete) r.pinned("delete", "guides", id, null, dumped);
    else if (old.status !== "archived") r.pinned("update", "guides", id, { status: "archived", updated: t }, dumped);
    log(`guide ${id}: ${a.delete ? "delete" : "archive"}`);
    if (P.cfg.status.guide && (a.archive || a.delete) && id !== "status") log(statusGuideLine(r, a, `Say under "Done" that ${id} is done`));
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
// "## " section, or it lost every section after a post (then the guide is deleted).
function rulesState(r) {
  const file = rulesFile(r);
  if (!fs.existsSync(file)) return { file, exists: false, changed: false, write: false };
  const buf = fs.readFileSync(file), text = buf.toString("utf8"), hash = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  // Only a "## " heading makes a section: a file of a title or plain text alone is handled as an empty file.
  const g = parseGuide(text), posted = r.st.next["guides/" + RULES_ID] !== undefined, changed = hash !== r.st.rules_md;
  const sections = g.secs.some((s) => s.title);
  return { file, exists: true, text, hash, g, sections, posted, changed, write: changed && (sections || posted) };
}
// The one rules line of check or read, or "". a: the parsed arguments, for the --state of the printed command.
function rulesLine(rs, cmd, a) {
  if (cmd === "check" && !rs.exists) return `rules: no ${rel(rs.file)}. Read references/rules.md, "Start the rules", and follow it`;
  if (!rs.write) return "";
  if (cmd === "check" && !rs.sections) return `rules: ${rel(rs.file)} holds no section: the guide rules is removed in the array below`;
  if (cmd === "check") return `rules: ${rel(rs.file)} changed. Read it; check posts it as the guide rules in the array below`;
  return `rules: ${rel(rs.file)} changed. Run node ${SELF} check${stateArg(a)} and pass its array`;
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
  skipLine(dump, log);
  r.clearCardsOnly(dump);
  const already = new Set(r.st.purge || []);
  // An earlier purge whose rows the board still holds is adopted first; one the board holds is forgotten.
  for (const k of purgeKeys(r)) {
    if (r.st.pending[k].some((w) => dump.col(w.collection).has(w.doc_id))) fail(`purge: ${k} has not landed yet. Run \`node ${SELF} adopt ${k} --dump ${shq(one(a, "dump"))} --dumped${stateArg(a)}\` first`);
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
  const cardsOfBatch = (b) => Array.from(new Set(b.itemIds.concat(b.controlIds)));
  all.filter((b) => b !== newest && cardsOfBatch(b).length && !b.noteIds.length && cardsOfBatch(b).every((x) => gone.has(x)) && P.isHandled(b))
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
const byId = (l) => stable((Array.isArray(l) ? l : []).slice().sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1)));
// Whether the dumped cards/main d holds this state's cards.
const holdsCards = (r, d) => !!d && byId(d.data.cards) === byId(r.cardsDoc().cards);
// adopt cards, and the cards part of adopt batches/<id>: add every card that the board has and the state lacks,
// keep the later "updated" of a card in both, say what changed, then write the cards pinned to v (the dumped
// version) unless the board holds them. group: the lines of that write; lead: a line printed only with that write.
// Returns true when the board holds them.
function mergeCards(r, d, v, log, group, lead) {
  const purge = new Set(r.st.purge || []), add = [], took = [], kept = [];
  for (const bc of d && Array.isArray(d.data.cards) ? d.data.cards.filter(P.isObj) : []) {
    // As the page reads the board: a card whose id is not a plain id is not a card (its id would reach command lines).
    if (purge.has(bc.id) || !plainId(bc.id)) continue;
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
  if (holdsCards(r, d)) { log(`cards: the board holds this state's cards, version ${v}`); return true; }
  if (lead) log(lead);
  log(`cards: write again, pinned to ${v === undefined ? "a create" : "version " + v}`);
  r.putCards(group);
  return false;
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
// adopt and push: the document key, checked before any line prints it. An id after the collection is a plain id.
function docKey(a, cmd) {
  const key = a._[1] || "cards";
  if (key !== "cards" && !/^(guides|meta|batches|purge)\/[^/]/.test(key) || key.includes("/") && !(key.startsWith("batches/") ? plainId : (x) => S.idRe.test(x))(key.slice(key.indexOf("/") + 1))) fail(`${cmd}: ${q(key)} is not a document key such as cards, guides/<id>, meta/config, batches/<id> or purge/<stamp>`);
  return key;
}
// The refusal for a key with no pending write. A batch key whose ack sent its cards as a write of their own may still
// owe that write: push cards prints it again.
function noWrite(r, cmd, key) {
  fail(`${cmd}: no write of ${key} in ${r.file}` + (key.startsWith("batches/") ? `. If its cards write is not confirmed: node ${SELF} push cards${r.ctx().state}` : ""));
}
function cmdAdopt(a, log) {
  const key = docKey(a, "adopt");
  if (!a.dumped) fail(`adopt: no --dumped. Dump again as the "if refused" line says; once every call succeeded, run node ${SELF} adopt ${key} --dump ${shq(one(a, "dump"))} --dumped${stateArg(a)}`);
  const dump = readDump(one(a, "dump")), r = new Run(a), w = r.st.pending[key], ctx = r.ctx(), again = (ws) => ws.map((out) => ({ out, size: 0, group: key }));
  if (!w && key !== "cards") noWrite(r, "adopt", key);
  skipLine(dump, log);
  r.clearCardsOnly(dump);
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
    mergeCards(r, d, v, log);
    // A pending ack whose batch update the board already holds waited only for its cards: they are on the board,
    // or in the write printed now.
    for (const k of Object.keys(r.st.pending)) if (k.startsWith("batches/") && !ackEntry(r.st.pending[k]).write) delete r.st.pending[k];
    return r.finish(log);
  }
  if (c === "batches") return adoptBatch(r, key, d, v, dump, log);
  if (holds(d, w)) {
    log(`${key}: the board holds the last write${v === undefined ? "" : ", version " + v}`);
    if (v === undefined) delete r.st.next[key]; else r.st.next[key] = v;
    return r.finish(log);
  }
  const out = Object.assign({}, w);
  if (v === undefined) delete out.if_version; else out.if_version = v;
  r.st.pending[key] = out;
  if (w.op === "delete") delete r.st.next[key]; else r.st.next[key] = v === undefined ? 1 : v + 1;
  log(`${key}: write again, pinned to ${out.if_version === undefined ? "a create" : "version " + out.if_version}`);
  r.finish(() => {});
  printWrites(again([out]), log, ctx);
}
// adopt batches/<id>: d is the dumped batch, v its version if the dump has one (P4 dumps without versions: the
// update then keeps the version it was printed with). The batch update goes again unless the board holds it. An
// ack that changed cards carries no cards write: its cards are built from the state. A dump with cards/main merges
// them as adopt cards does and writes them in the same array, pinned to the dumped version; a dump without cards
// names adopt cards. Until a dump shows the cards, the next cards write is a create, which the board refuses, so a
// sync or close in between cannot pin a version another writer made; adopt cards pins it anew.
function adoptBatch(r, key, d, v, dump, log) {
  const e = ackEntry(r.st.pending[key]), ctx = r.ctx(), cd = dump.col("cards").get(CARDS);
  const cv = e.cards && cd ? pin("cards", CARDS, cd) : undefined;
  const hint = (after) => log(`${key}: the cards write of this ack is not on the board. ${after ? "Once this array is applied:" : "Now:"} rm -rf ${ctx.dump}, then ${dumpCalls("cards")}, then node ${SELF} adopt cards --dump ${ctx.dump} --dumped${ctx.state}`);
  if (!e.write || holds(d, e.write)) {
    log(`${key}: the board holds the last write`);
    r.logHandled(dump, log);
    // The board holds the batch update. Without cards in the dump the flag stays, without the update, until adopt
    // cards. With them, the merged cards go as a write of their own (adopt cards and push cards recover it), and
    // the ack needs nothing more.
    if (e.cards && !cd) { r.st.pending[key] = ackValue({ cards: true }); delete r.st.next.cards; r.finish(log); return hint(false); }
    delete r.st.pending[key];
    if (e.cards && !holdsCards(r, cd)) mergeCards(r, cd, cv, log, undefined, `${key}: the cards write of this ack is not on the board: write it again`);
    return r.finish(log);
  }
  const out = Object.assign({}, e.write);
  if (v !== undefined) out.if_version = v;
  log(`${key}: write again, pinned to ${out.if_version === undefined ? "a create" : "version " + out.if_version}`);
  r.rePut(out, key, e.cards);
  if (e.cards && cd) mergeCards(r, cd, cv, log, key);
  else if (e.cards) delete r.st.next.cards;
  r.finish(log);
  if (e.cards && !cd) hint(true);
}
// push: the last write of a document again, as it was printed; for a purge, the group. For an ack: its batch
// update, and when the ack changed cards a cards write built now from the state, pinned as push cards pins.
function cmdPush(a, log) {
  const key = docKey(a, "push"), r = new Run(a), w = r.st.pending[key];
  if (!w) noWrite(r, "push", key);
  if (!key.startsWith("batches/")) return printWrites([].concat(w).map((out) => ({ out, size: 0, group: key })), log, r.ctx());
  const e = ackEntry(w);
  if (e.write) { r.rePut(e.write, key, e.cards); if (e.cards) r.putCardsAgain(key); }
  // An ack whose batch update the board holds owes only its cards: they go as a write of their own (adopt cards and
  // push cards recover it), and the ack needs nothing more.
  else { r.putCardsAgain(); delete r.st.pending[key]; }
  r.finish(log);
}

// ---- check: the config layers and the state, locally. Prints the meta/config write when the merged page keys changed.
// The first folder from the folder of file up to the root that holds a .git entry, else "".
function inGitTree(file) {
  for (let d = path.dirname(path.resolve(file)); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return "";
  }
}
// check: the board folder keeps itself out of git with a .gitignore of the one line "*", created once and never
// changed. Never in a repository root or the home folder, where it would hide every new file; never through a
// symlink (lstat, and an exclusive create). An existing file without the line * is kept and named; a line counts as
// git reads it: * once trailing spaces and a trailing carriage return are gone.
function ignoreBoard(dir, log, errs) {
  const shown = shownPath(rel(dir)), gi = path.join(dir, ".gitignore"), giShown = shownPath(path.join(rel(dir), ".gitignore"));
  const lst = (f) => { try { return fs.lstatSync(f); } catch (e) { if (e.code === "ENOENT" || e.code === "ENOTDIR") return null; throw e; } };
  const real = (f) => { try { return fs.realpathSync(f); } catch (e) { return path.resolve(f); } };
  const none = (why) => log(`note: ${shown} ${why}: no .gitignore written; keep the board in its own folder`);
  try {
    if (lst(path.join(dir, ".git"))) return none("is a repository root");
    if ([real(os.homedir()), path.parse(real(dir)).root].includes(real(dir))) return none(real(dir) === real(os.homedir()) ? "is the home folder" : "is the root folder");
    const st = lst(gi);
    if (st) {
      // A link to a file is the operator's own arrangement: read through it, never write. statSync throws for a
      // link to nothing, which the catch reports.
      if (!(st.isSymbolicLink() ? fs.statSync(gi) : st).isFile()) { errs.push(`${giShown} is not a file: the board folder is not ignored. Remove it, then run check`); return; }
      if (!fs.readFileSync(gi, "utf8").split("\n").some((l) => l.replace(/\r$/, "").replace(/ +$/, "") === "*")) log(`note: ${giShown} does not hold the line *: the board folder is not ignored; add a line * to it`);
      return;
    }
    // A board folder holds only what the script and the agent put there: .json, .md and .html files, a state
    // file being written, and the folders the script makes.
    const ours = (name) => { const x = lst(path.join(dir, name)); return x && (x.isFile() ? /\.(json|md|html)$|\.json\.tmp$/.test(name) : x.isDirectory() && BOARD_DIRS.includes(name)); };
    const other = fs.existsSync(dir) ? fs.readdirSync(dir).find((x) => !ours(x)) : undefined;
    if (other !== undefined) { log(`note: ${shown} holds ${plainId(other) ? other : q(other)}, which is not a board file: no .gitignore written; move it out or keep the board in its own folder`); return; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(gi, "*\n", { flag: "wx" });
  } catch (e) { errs.push(`${giShown}: ${e.code || e.message}: the board folder is not ignored. Fix the folder, then run check`); }
}
// The folders the script makes in the board folder: the dump of the agent, the out files, the purge copies, the
// dump of the watcher.
const BOARD_DIRS = ["dump", "out", "purged", "watch-dump"];
// A config value in one short text.
function valueText(v) {
  if (typeof v === "string") return v.length > 60 ? js(v.slice(0, 57)) + "..." : js(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length === 1 ? "1 entry" : v.length + " entries";
  if (isPlain(v)) return "{" + Object.keys(v).join(", ") + "}";
  return String(v);
}
// The layer files, the layer of each set key, the keys left at their defaults, and the ids that sync accepts.
function configLines(load) {
  const out = [], [u, b, l] = load.files, nFiles = load.files.filter((f) => f.exists).length;
  const set = CONFIG_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(load.src, k));
  out.push(`config layers: user ${!u.file ? "off" : u.exists ? tilde(u.file) : `none (${tilde(u.file)})`}, board ${b.exists ? boardName(b.file) : "none"}, local ${l.exists ? boardName(l.file) : "none"}`);
  if (nFiles === 1 && set.length) out.push(`config ${load.files.find((f) => f.exists).name}: ${set.join(", ")}`);
  if (nFiles >= 2) for (const k of set) out.push(`config ${k}: ${load.src[k].join(", ")}  ${valueText(load.config[k])}${SCRIPT_KEYS.includes(k) ? "  (script only)" : ""}`);
  const unset = CONFIG_KEYS.filter((k) => !SCRIPT_KEYS.includes(k) && !set.includes(k));
  if (unset.length) out.push(`config default: ${unset.join(", ")}`);
  out.push(`config ids: tags ${P.cfg.tags.map((t) => idText(t.id)).join(", ") || "none"}; priorities ${P.cfg.priorities.map((p) => idText(p.id)).join(", ")}`);
  return out;
}
// The problems of config "status", on the merged config.
function statusProblems(raw) {
  const v = raw.status, out = [];
  if (v === undefined) return out;
  if (!P.isObj(v)) return ["config status: not an object"];
  for (const k of Object.keys(v)) if (k !== "stale_minutes" && k !== "guide") out.push("config status: unknown field " + q(k));
  if (v.stale_minutes !== undefined && P.intIn(v.stale_minutes, 1, 1440, null) === null)
    out.push("config status.stale_minutes: a whole number from 1 to 1440");
  if (v.guide !== undefined && typeof v.guide !== "boolean") out.push("config status.guide: true or false");
  return out;
}
// The problems of config "wake", on the merged config.
function wakeProblems(raw) {
  const v = raw.wake, out = [];
  if (v === undefined) return out;
  if (!P.isObj(v)) return ["config wake: not an object"];
  for (const k of Object.keys(v)) if (!["mode", "poll_seconds", "poll_limit"].includes(k)) out.push("config wake: unknown field " + q(k));
  if (v.mode !== undefined && !S.wakeModes.includes(v.mode)) out.push("config wake.mode: not one of poll, comment, both, off");
  if (v.poll_seconds !== undefined && P.intIn(v.poll_seconds, 60, 86400, null) === null) out.push("config wake.poll_seconds: a whole number from 60 to 86400");
  if (v.poll_limit !== undefined && P.intIn(v.poll_limit, 1, 1000, null) === null) out.push("config wake.poll_limit: a whole number from 1 to 1000");
  return out;
}
function cmdCheck(a, log) {
  const r = new Run(a, { create: true }), errs = [];
  if (a.url) {
    const u = one(a, "url");
    // An https link with no space or quote; the egress test bans a literal URL in this file, so the regex is escaped.
    if (!/^https:\/\/[^\s"'`\\]{1,300}$/.test(u)) fail("check --url: the https link of the artifact, with no space or quote");
    r.st.url = u;
  }
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
  ignoreBoard(r.dir, log, errs);
  const raw = r.config, c = P.cfg;
  errs.push(...r.load.problems.map((p) => "config " + p));
  for (const k of ["tabs", "priorities", "domains", "link_hosts", "tags", "groups", "sort", "people"]) {
    const def = k === "groups" ? P.DEFAULT_GROUPS : P.DEFAULTS[k];
    if (raw[k] === undefined) continue;
    const got = c[k] === def && Array.isArray(raw[k]) && raw[k].length ? 0 : c[k].length;
    if (!Array.isArray(raw[k]) || got < raw[k].length) errs.push(`config ${k}: ${got} of ${Array.isArray(raw[k]) ? raw[k].length : "a non-list"} entries kept`);
  }
  errs.push(...r.load.unknown);
  // A people id becomes an object key on the page: the unsafe keys are refused as in the config layers.
  if (Array.isArray(raw.people)) raw.people.forEach((x, i) => { if (isPlain(x) && UNSAFE.has(x.id)) errs.push(`config people[${i}].id: ${q(x.id)} is not allowed`); });
  if (raw.tz !== undefined && !P.tzOk(raw.tz)) errs.push(`config tz: ${js(raw.tz)} is not a time zone name such as "Europe/Warsaw" or "UTC"`);
  if (raw.week_start !== undefined && !P.normWeek(raw.week_start)) errs.push(`config week_start: ${q(raw.week_start)} is not a day and a time such as "tuesday 12:00"`);
  if (raw.controls !== undefined) {
    if (!isPlain(raw.controls)) errs.push("config controls: not an object");
    else for (const k of Object.keys(raw.controls)) {
      if (!S.controlNames.includes(k)) errs.push(`config controls: unknown field ${q(k)}`);
      else if (typeof raw.controls[k] !== "boolean") errs.push(`config controls.${k}: true or false`);
    }
  }
  errs.push(...statusProblems(raw), ...wakeProblems(raw));
  const ck = compileChecks(raw.checks === undefined ? [] : raw.checks);
  errs.push(...ck.problems);
  if (r.config.standing !== undefined && !standingOk(r.config.standing)) errs.push("config standing: a list of 1 to 50 texts, each 1 to 40 characters");
  const rd = rs.write && rs.sections ? rulesDoc(r, rs, t) : null;
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
  // A state card that breaks a check is a note: a new check must not block the config write that brings it. A check
  // that took too long is a problem of the check itself.
  r.st.cards.forEach((x) => {
    if (!P.isObj(x) || typeof x.id !== "string") return;
    const slow = [];
    checkHits(x, ck.checks, slow).forEach((h) => (slow.includes(h) ? errs.push(`card ${qid(x.id)}: ${h}`) : log(`note: card ${qid(x.id)}: ${h}`)));
  });
  // A group that names a tag or a priority the config does not have: valid, but it never takes a card.
  for (const g of P.cfg.groups) for (const m of g.match) {
    for (const x of m.tags || []) if (!P.cfg.tags.some((t) => t.id === x)) log(`note: config groups: ${g.id} matches tag ${q(x)} that is not in tags`);
    for (const x of m.priority || []) if (!P.cfg.priorities.some((p) => p.id === x)) log(`note: config groups: ${g.id} matches priority ${q(x)} that is not in priorities`);
  }
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

// ---- status: what the agent does now, one write of meta/status.
const has = (a, k) => Object.hasOwn(a, k);
// The stored status in the state, coerced; a fresh one when absent.
function storedStatus(r) {
  const x = isPlain(r.st.status) ? P.coerce("status", r.st.status) : {};
  return { now: x.now || "", next: x.next || [], waiting: x.waiting || "", updated: x.updated || "", watch: P.isObj(x.watch) ? x.watch : undefined };
}
function statusDoc(s) { return Object.assign({ now: s.now, next: s.next, waiting: s.waiting, updated: s.updated }, s.watch ? { watch: { started: s.watch.started, until: s.watch.until } } : {}); }
// The one write of meta/status, pinned like meta/config (ArtifactData refuses an unpinned write of an existing document).
function putStatus(r, s) {
  r.st.status = statusDoc(s);
  r.pinned("set", "meta", "status", statusDoc(s));
}
// Text the agent typed on a command line. Line breaks
// and runs of white space become one space, a double quote becomes ', $ and backtick are dropped, and a text over
// max characters is cut to max - 3 characters plus "...". The caller refuses only an empty result.
// Control characters other than white space, bidi controls, zero-width characters (not the emoji joiner U+200D)
// and lone surrogates are dropped; the cut never splits a character (a surrogate pair stays
// whole), and the result stays within max UTF-16 units, the unit of the SCHEMA limits.
function cleanText(v, max) {
  const s = String(v).replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "").replace(/"/g, "'").replace(/[$`]/g, "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  let out = "";
  for (const ch of s) { if (out.length + ch.length > max - 3) break; out += ch; }
  return out + "...";
}
function cmdStatus(a, log) {
  const r = new Run(a); r.needConfig();
  if (!["now", "next", "waiting", "idle"].some((k) => has(a, k))) fail("status: give --now, --next, --waiting or --idle");
  const errs = [], s = storedStatus(r);
  let nowText = has(a, "now") ? cleanText(words(a, "now"), S.max.line) : null;
  if (nowText !== null && !nowText) errs.push("status --now: empty text");
  if (nowText !== null && lower(nowText) === "idle") nowText = "idle";      // --now idle is the same as --idle
  if (has(a, "idle") && nowText !== null && nowText !== "idle") errs.push("status: --idle and --now together; give one");
  if (has(a, "idle")) nowText = "idle";
  if (nowText === "idle" && !has(a, "next")) s.next = [];                    // idle ends the old next list too
  if (nowText) {
    if (nowText !== "idle") s.waiting = "";                                  // a new task ends the old wait, first
    s.now = nowText;
  }
  if (has(a, "next")) {
    const raw = a.next.map((x) => cleanText(x, S.max.line));
    if (raw.some((x) => !x)) errs.push("status --next: an empty line");
    s.next = raw.filter(Boolean);
  }
  if (has(a, "waiting")) s.waiting = cleanText(words(a, "waiting"), S.max.line);   // after the clear above, so it wins
  if (s.next.length > 3) errs.push("status --next: at most 3 lines");
  s.updated = now();
  const bytes = Buffer.byteLength(JSON.stringify(statusDoc(Object.assign({}, s, { watch: { started: s.updated, until: s.updated } }))));
  if (!errs.length && bytes > S.max.statusBytes) errs.push(`status: ${bytes} bytes with a watcher, over ${S.max.statusBytes}; shorten the lines`);
  if (errs.length) fail(errs.join("\n"));
  putStatus(r, s);
  log(`status: now ${q(s.now)}, next ${js(s.next)}, waiting ${q(s.waiting)}`);   // what was stored, after cleanText
  r.finish(log);
}

// ---- watch: what to do about a watcher, from the config wake mode.
// The watch file of the board: written by watch when it starts a watcher, counted by waiting --count.
const watchFile = (r) => path.join(r.dir, "watch.json");
function readWatch(file) {
  // The poll count holds the watcher's stop condition: the ranges of config wake poll_limit and poll_seconds.
  // watcher: the id of the watcher that owns the window, a plain id; a file from before ids has none.
  // dump: only the watch-dump folder beside the watch file, since waiting --count clears it; any other is refused.
  try {
    const w = JSON.parse(fs.readFileSync(file, "utf8"));
    return isPlain(w) && typeof w.dump === "string" && w.dump !== "" && path.resolve(w.dump) === path.resolve(path.dirname(file), "watch-dump") && P.intIn(w.limit, 1, 1000, null) !== null && P.intIn(w.poll, 0, w.limit, null) !== null &&
      P.intIn(w.seconds, 60, 86400, null) !== null && (!Object.hasOwn(w, "watcher") || plainId(w.watcher)) &&
      (!Object.hasOwn(w, "stopped") || typeof w.stopped === "boolean") ? w : null;
  } catch (e) { return null; }
}
// A watch file is written to a temp file in its folder and renamed over the old one: a reader sees the old or the new.
// A failed write removes its temp file and stops with one line: cmd names the command, tail ends the line.
function writeWatch(file, w, cmd, tail = "") {
  // <name>.<random>.json.tmp: one per writer, and a name the board folder check counts as a board file.
  const tmp = path.join(path.dirname(file), path.basename(file, ".json") + "." + randomBytes(4).toString("hex") + ".json.tmp");
  let done = false;
  try { fs.writeFileSync(tmp, JSON.stringify(w) + "\n"); fs.renameSync(tmp, file); done = true; }
  catch (e) { fail(`${cmd}: cannot write ${file}: ${e.code || e.message}${tail}`); }
  finally { if (!done) fs.rmSync(tmp, { force: true }); }
}
// waiting --count writes the watch file only while it still holds the window it read: false when a watch started
// another window since. This narrows the window for a lost restart and does not close it: a restart can still land
// between this re-read and the rename, and no lock is taken.
function keepWatch(file, w, notWatch, tail) {
  const now2 = readWatch(file);
  if (!now2) fail(notWatch);
  if (now2.watcher !== w.watcher || now2.started !== w.started) return false;
  writeWatch(file, w, "waiting", tail); return true;
}
const COMMENTS_LINE = "comments: if this session has not run P5 for this board yet, run it now.";
// The watcher's prompt: the text block of references/watch.md with every value filled in.
function briefText(url, dump, wf, id) {
  const md = fs.readFileSync(path.join(HERE, "..", "references", "watch.md"), "utf8"), m = md.match(/```text\n([\s\S]*?)\n```/);
  if (!m) fail("watch: references/watch.md has no text block");
  const p4 = js({ action: "query", url, collection: "batches", out_dir: dump, query: { where: [["status", "==", "sent"]], limit: 1000 } });
  return m[1].split("<P4>").join(p4).split("<SCRIPT>").join(dq(fileURLToPath(import.meta.url))).split("<COUNT>").join(dq(wf)).split("<ID>").join(id);
}
function cmdWatch(a, log) {
  const r = new Run(a); r.needConfig();
  const bad = wakeProblems(r.load.config);
  if (bad.length) fail(bad.concat([`fix the config, then run \`node ${SELF} check${stateArg(a)}\``]).join("\n"));
  const w = P.cfg.wake, wf = watchFile(r), cur = readWatch(wf);
  if (w.mode === "off") log("wake off: start no watcher. Read the board when the operator asks.");
  else if (w.mode === "comment") { log("wake comment: start no watcher; a comment on the board wakes you."); log(COMMENTS_LINE); }
  else if (cur && cur.poll >= cur.limit && !has(a, "restart")) {
    // At the poll limit the watcher has stopped and the page shows the window ended; a new window starts only on
    // watch --restart, which the agent runs when the operator asks. --restart always starts a new window and watcher.
    if (!cur.ended) {
      const s = storedStatus(r), t = now();
      if (s.watch) { s.watch = { started: s.watch.started, until: t }; putStatus(r, s); }
      cur.ended = true; writeWatch(wf, cur, "watch");
    }
    log(`wake ${w.mode}: the watcher window ended at its poll limit; start none. Start a new one only when the operator asks you to watch again: node ${SELF} watch --restart${stateArg(a)}.` + (w.comment ? " A comment on the board still wakes you." : " Read the board when the operator asks."));
    if (w.comment) log(COMMENTS_LINE);
  } else if (cur && cur.poll < cur.limit && !cur.reported && !cur.stopped && P.stampMs(cur.until) > nowMs() && !has(a, "restart")) {
    log(`wake ${w.mode}: a watcher runs until ${cur.until}; start none. Only when the operator asks to watch again: node ${SELF} watch --restart${stateArg(a)}`);
    if (w.comment) log(COMMENTS_LINE);
  } else {
    if (!r.st.url) fail(`watch: no board URL in ${r.file}. Run node ${SELF} check --url <the artifact link>${stateArg(a)} once, then watch again`);
    const dump = path.join(r.dir, "watch-dump");
    // The brief quotes every path for the shell (dq); a line break or another control character cannot stay on its line.
    for (const p of [dump, wf, fileURLToPath(import.meta.url)]) if (badPath(p)) fail(`watch: the path ${q(p)} holds a line break or a control character; move the board`);
    const t = now(), until = P.stampIn(P.stampMs(t) + w.poll_seconds * w.poll_limit * 1000, P.cfg.tz, false);
    fs.rmSync(dump, { recursive: true, force: true });
    // state: the --state of watch as an absolute path, so the watcher's reports name the same board from anywhere.
    // watcher: a new id for each watcher; waiting --count stops a watcher whose id is no longer the one in the file.
    const id = "w" + randomBytes(3).toString("hex");
    writeWatch(wf, Object.assign({ dump, seconds: w.poll_seconds, limit: w.poll_limit, poll: 0, started: t, until, watcher: id }, a.state ? { state: r.file } : {}), "watch");
    // Only the window changes: now, next, waiting and updated stay as status stored them, so the page still sees how
    // old the task is. Before any status, updated is the empty stamp: the page reads it as no status yet.
    const s = storedStatus(r); s.watch = { started: t, until }; putStatus(r, s);
    // stopped: waiting --count marked that no watcher of the window polls any more; plain watch says why it starts one.
    const why = cur && cur.stopped && !has(a, "restart") ? "the watcher of this window stopped; " : "";
    log(`wake ${w.mode}: ${why}start one watcher, every ${w.poll_seconds} s, at most ${w.poll_limit} polls, until ${until}. Pass the array below to P3, then start P6 with the lines between "--- brief" and "--- end" as its prompt.`);
    log("--- brief"); log(briefText(r.st.url, dump, wf, id)); log("--- end");
    if (w.comment) log(COMMENTS_LINE);
  }
  r.finish(log);
}

export const COMMANDS = { check: cmdCheck, sync: cmdSync, close: cmdClose, read: cmdRead, waiting: cmdWaiting, ack: cmdAck, status: cmdStatus, watch: cmdWatch, guide: cmdGuide, purge: cmdPurge, adopt: cmdAdopt, push: cmdPush };
export function run(argv, log = console.log) {
  const a = parseArgs(argv), cmd = COMMANDS[a._[0]];
  if (!cmd) { log(USAGE); return 2; }
  if (!FLAGS[a._[0]]) { log(`${a._[0]}: no FLAGS line for this command in board.mjs`); return 1; }
  for (const key of (a[BAD] !== undefined ? [a[BAD]] : []).concat(Object.keys(a))) if ((key === a[BAD] || (key !== "_" && key !== "raw")) && !FLAGS[a._[0]].includes(key)) { log(`${a._[0]}: unknown flag --${/^[a-z-]{1,40}$/.test(key) ? key : q(key)}`); return 1; }
  // A path with a line break or another control character would break the command lines printed with it.
  for (const k of ["state", "dump", "count"]) for (const v of a[k] || []) if (badPath(v)) { log(pathRefusal(a._[0], v)); return 1; }
  // The user file and the script itself are printed too: the same refusal.
  for (const v of [process.env.BOARD_USER_CONFIG || "", fileURLToPath(import.meta.url)]) if (badPath(v)) { log(pathRefusal(a._[0], v)); return 1; }
  try { cmd(a, log); return 0; } catch (e) { if (e instanceof Stop) { log(e.message); return 1; } throw e; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
