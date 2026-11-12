#!/usr/bin/env node
// The refresh adapter of the decision board. Node 18 or later, no dependencies, no network access.
// It turns rows that the agent saved from a source into a card file for `board.mjs sync`, and lists the
// keys that card files of different sources share. It writes card files only; the board is the core's.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = path.relative(process.cwd(), fileURLToPath(import.meta.url)) || "refresh.mjs";
const USAGE = `Usage: node ${SELF} <command> ...
  map <rows.json> --map <map.json> --source <name> --out <cards.json> [--overrides <file>] [--config <board/config.json>]
      [--details <file>] [--min-rows <n>] [--allow-skipped]
      turn the rows of one source into a full card file for \`board.mjs sync <cards.json> --source <name>\`.
      The details go to <out>.details.json unless --details names another file.
  xref <cards.json>...   list the keys that cards of more than one file share; it never merges`;

const ID_CHARS = /[^A-Za-z0-9_\-.~:@+]/g;
const SOURCE_RE = /^[a-z0-9_\-.~@+]{1,40}$/;
const MAX_S = 300;
const STR_FIELDS = ["priority", "summary", "title", "kind", "recommendation", "blocks", "evidence"];
const OVERRIDE_FIELDS = [...STR_FIELDS, "tags", "options", "status", "drop"];
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const BOOL_FLAGS = new Set(["allow-skipped"]);
// Prefixes of KEY-123 forms that are not ticket keys.
const NOT_TICKETS = new Set(["CVE", "CWE", "UTF", "TLS", "SSL", "SHA", "ISO", "RFC"]);

class Stop extends Error {}
function fail(msg) { throw new Stop(msg); }
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const isScalar = (x) => ["string", "number", "boolean"].includes(typeof x);
const strList = (x) => Array.isArray(x) && x.every((t) => typeof t === "string");
function readJson(file, what) {
  if (!file) fail(what + ": name the file");
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { fail("cannot read " + file); }
  try { return JSON.parse(text); } catch (e) { fail(file + ": not JSON: " + e.message); }
}
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) { a._.push(argv[i]); continue; }
    const k = argv[i].slice(2);
    if (BOOL_FLAGS.has(k)) { a[k] = true; continue; }
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) fail(`--${k}: no value`);
    a[k] = argv[++i];
  }
  return a;
}

// A dotted path into a row: "author.login". Over a list it maps each element: "labels.name" on
// [{name: "a"}, {name: "b"}] gives ["a", "b"]. Own keys only.
function get(v, p) {
  const parts = typeof p === "string" ? p.split(".") : p;
  if (!parts.length) return v;
  if (Array.isArray(v)) return v.flatMap((e) => { const r = get(e, parts); return r === undefined ? [] : [].concat(r); });
  const [k, ...rest] = parts;
  if (!isObj(v) || UNSAFE.has(k) || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
  return get(v[k], rest);
}
const text = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const low = (x) => String(x).trim().toLowerCase();
// A rule {field, equals}: equals is a scalar or a list of scalars, compared without case; a list in the
// row matches on any element.
function matches(row, rule) {
  const want = [].concat(rule.equals).map(low);
  return [].concat(get(row, rule.field)).filter(isScalar).some((h) => want.includes(low(h)));
}
function hash(s) { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
// <source>-<key> in the id characters of the board. A key that had to change, or that is too long, gets a
// hash of the raw key, so two keys never meet in one id and the same key always gives the same id.
function cardId(source, key) {
  const clean = key.replace(ID_CHARS, "-");
  const id = source + "-" + clean;
  if (clean === key && id.length <= 100) return id;
  return id.slice(0, 90) + "-" + hash(key);
}
function who(v) { const w = text(v).replace(ID_CHARS, "-").slice(0, 40); return /^-*$/.test(w) ? "" : w; }

function realDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
// The created field as YYYY-MM-DD: a date, an ISO timestamp (its own date part), or epoch seconds or
// milliseconds (12 digits or more before any fraction), as a number or a digit string such as
// "1762650000.000200", in UTC. undefined when the row has none, null when it cannot be read.
function createdDate(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const EPOCH = /^\d+(\.\d+)?$/;
  if (typeof v === "number" || (typeof v === "string" && EPOCH.test(v.trim()))) {
    const s = String(v).trim(), n = Number(s);
    if (!Number.isFinite(n) || !EPOCH.test(s)) return null;
    const d = new Date(s.split(".")[0].length >= 12 ? n : n * 1000);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const m = typeof v === "string" ? /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(v.trim()) : null;
  return m ? m[1] : null;
}
const tomorrow = () => new Date(Date.parse(process.env.BOARD_NOW || new Date().toISOString()) + 86400000).toISOString().slice(0, 10);

function checkMap(m, file) {
  if (!isObj(m)) fail(file + ": not a JSON object");
  const errs = [];
  for (const k of ["key", "title", "url", "created"]) if (typeof m[k] !== "string" || !m[k]) errs.push(`${k}: the row field that holds it, for example "${k}": "${k}"`);
  for (const k of ["who", "rows", "kind"]) if (m[k] !== undefined && (typeof m[k] !== "string" || !m[k])) errs.push(k + ": a string");
  const rule = (r) => isObj(r) && typeof r.field === "string" && (isScalar(r.equals) || (Array.isArray(r.equals) && r.equals.length && r.equals.every(isScalar)));
  if (m.closed !== undefined && !rule(m.closed)) errs.push('closed: {"field": ..., "equals": a value or a list of values}');
  if (m.tags !== undefined && !(Array.isArray(m.tags) && m.tags.every((r) => rule(r) && typeof r.tag === "string" && r.tag)))
    errs.push('tags: a list of {"field": ..., "equals": a value or a list of values, "tag": <config tag id>}');
  const known = ["rows", "key", "title", "url", "created", "who", "kind", "closed", "tags"], extra = Object.keys(m).filter((k) => !known.includes(k));
  if (extra.length) errs.push("unknown fields: " + extra.join(", "));
  if (errs.length) fail(errs.map((e) => file + ": " + e).join("\n"));
}
function checkOverrides(o, file) {
  if (!isObj(o)) fail(file + ": not a JSON object {<card id or key>: {fields}}");
  const errs = [];
  for (const [id, v] of Object.entries(o)) {
    if (!isObj(v)) { errs.push(id + ": not an object"); continue; }
    const bad = Object.keys(v).filter((k) => !OVERRIDE_FIELDS.includes(k));
    if (bad.length) errs.push(`${id}: ${bad.join(", ")}: an override names only ${OVERRIDE_FIELDS.join(", ")}`);
    for (const k of STR_FIELDS) if (v[k] !== undefined && typeof v[k] !== "string") errs.push(`${id}: ${k}: a string`);
    for (const k of ["tags", "options"]) if (v[k] !== undefined && !strList(v[k])) errs.push(`${id}: ${k}: a list of strings`);
    if (v.status !== undefined && v.status !== "closed") errs.push(`${id}: status: only "closed"`);
    if (v.drop !== undefined && v.drop !== true) errs.push(`${id}: drop: only true`);
  }
  if (errs.length) fail(errs.map((e) => file + ": " + e).join("\n"));
}
// The board config, when named: link_hosts and tag ids.
function readConfig(file) {
  if (!file) return null;
  const c = readJson(file, "--config");
  if (!isObj(c)) fail(file + ": not a JSON object");
  return { hosts: (Array.isArray(c.link_hosts) ? c.link_hosts : []).map(low), tags: (Array.isArray(c.tags) ? c.tags : []).map((t) => (isObj(t) ? t.id : t)) };
}

// The reasons a finished card cannot go to sync; empty when it can.
function cardProblems(c, date, cfg) {
  const out = [];
  if (c.title.length > MAX_S) out.push(`title over ${MAX_S} characters`);
  if (c.links[0].label.length > MAX_S) out.push(`link label over ${MAX_S} characters`);
  let u = null;
  try { u = new URL(c.links[0].url); } catch (e) { out.push("url does not parse"); }
  if (u && u.protocol !== "https:") out.push("url is not https");
  if (u && cfg && !cfg.hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) out.push(`url host ${u.hostname} not in the config link_hosts`);
  if (date === null) out.push("created date cannot be read");
  else if (date !== undefined && !realDate(date)) out.push(`created date ${date} is not a real date`);
  else if (date !== undefined && date > tomorrow()) out.push(`created date ${date} is in the future`);
  else if (date === undefined && c.status !== "closed" && c.kind !== "info") out.push("no created date");
  if (c.kind === "decision" && !(Array.isArray(c.options) && c.options.length >= 2)) out.push("a decision card needs 2 or more options: set them in an override");
  if (cfg && c.tags) for (const t of c.tags) if (!cfg.tags.includes(t)) out.push(`tag ${t} not in the config tags`);
  return out;
}

function cmdMap(a, log) {
  const rowsFile = a._[1], source = String(a.source || "").trim().toLowerCase();
  if (!rowsFile) fail("map: name the rows file");
  if (!SOURCE_RE.test(source)) fail("map: --source <name> with 1 to 40 of a-z 0-9 _ - . ~ @ +");
  if (!a.out) fail("map: --out <cards.json>");
  const minRows = a["min-rows"] === undefined ? 1 : Number(a["min-rows"]);
  if (!Number.isInteger(minRows) || minRows < 1) fail("map: --min-rows <n>, a whole number of 1 or more");
  const m = readJson(a.map, "--map");
  checkMap(m, a.map);
  const over = a.overrides ? readJson(a.overrides, "--overrides") : {};
  checkOverrides(over, a.overrides);
  const cfg = readConfig(a.config);
  const doc = readJson(rowsFile, "rows");
  const rows = m.rows ? get(doc, m.rows) : doc;
  if (!Array.isArray(rows)) fail(`${rowsFile}: ${m.rows ? `the field "${m.rows}" is` : "the rows are"} not a JSON list`);
  if (!rows.length) fail(`${rowsFile}: no rows. A source with no rows would close every card of the source; fetch it again`);
  if (rows.length < minRows) fail(`${rowsFile}: ${rows.length} rows, fewer than --min-rows ${minRows}. Fetch every page again`);

  const cards = [], skipped = [], seen = new Map(), used = new Set();
  const rules = [...(m.closed ? [{ name: "closed", r: m.closed }] : []), ...(m.tags || []).map((r, i) => ({ name: `tags[${i}] ${r.tag}`, r }))];
  const hits = rules.map(() => 0);
  let dropped = 0;
  rows.forEach((row, i) => {
    const at = i + 1;
    if (!isObj(row)) { skipped.push({ row: at, reasons: ["not an object"] }); return; }
    rules.forEach((x, j) => { if (matches(row, x.r)) hits[j]++; });
    const key = text(get(row, m.key)), url = text(get(row, m.url)), title = text(get(row, m.title));
    const miss = [];
    if (!key) miss.push(`no key (${m.key})`);
    if (!url) miss.push(`no url (${m.url})`);
    if (!title) miss.push(`no title (${m.title})`);
    if (miss.length) { skipped.push({ row: at, key, reasons: miss }); return; }
    const id = cardId(source, key);
    if (seen.has(id)) { skipped.push({ row: at, key, reasons: [`the same card id as row ${seen.get(id)}`] }); return; }
    seen.set(id, at);
    const c = { id, source, kind: m.kind || "action", title, links: [{ label: source + " " + key, url }] };
    const date = createdDate(get(row, m.created));
    if (date && realDate(date)) {
      c.first_asked = { date };
      if (m.who && who(get(row, m.who))) c.first_asked.who = who(get(row, m.who));
    }
    const tags = (m.tags || []).filter((r) => matches(row, r)).map((r) => r.tag);
    if (tags.length) c.tags = [...new Set(tags)];
    if (m.closed && matches(row, m.closed)) c.status = "closed";
    // An override names the card id or the raw key; the id wins where both name a field.
    const own = (k) => (Object.prototype.hasOwnProperty.call(over, k) ? over[k] : undefined);
    const o = Object.assign({}, own(key), own(id));
    if (own(key)) used.add(key);
    if (own(id)) used.add(id);
    const { drop, ...fields } = JSON.parse(JSON.stringify(o));
    Object.assign(c, fields);
    if (drop) { dropped++; return; }
    const problems = cardProblems(c, date, cfg);
    if (problems.length) { skipped.push({ row: at, key, reasons: problems }); return; }
    cards.push(c);
  });
  const unused = Object.keys(over).filter((k) => !used.has(k));
  const detailsFile = a.details || a.out + ".details.json";
  fs.mkdirSync(path.dirname(path.resolve(detailsFile)), { recursive: true });
  fs.writeFileSync(detailsFile, JSON.stringify({ rows: rows.length, cards: cards.length, dropped, skipped, unused_overrides: unused,
    rules: Object.fromEntries(rules.map((x, j) => [x.name, hits[j]])) }, null, 1) + "\n");
  const closedN = cards.filter((c) => c.status === "closed").length;
  const matched = rules.length ? "; rules matched: " + rules.map((x, j) => `${x.name} ${hits[j]}`).join(", ") : "";
  const line = `map: ${rows.length} rows, ${cards.length} cards (${closedN} closed), ${dropped} dropped, ${skipped.length} skipped, ${unused.length} overrides without a row${unused.length ? " (" + unused.join(", ") + ")" : ""}${matched}`;
  if (!cards.length) fail(`${line}. No cards; nothing written. Details: ${detailsFile}`);
  if (skipped.length && !a["allow-skipped"]) fail(`${line}. Nothing written: fix the rows or the map, or pass --allow-skipped. Details: ${detailsFile}`);
  fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
  fs.writeFileSync(a.out, JSON.stringify(cards, null, 1) + "\n");
  log(`${line} -> ${a.out}`);
}

// Keys in a card: ticket keys such as ABC-123 in the title and the link urls, and each link url itself
// (without its fragment and trailing slash). CVE-2026-1234, UTF-8 and the like are no ticket keys.
function keysOf(c) {
  const out = new Set(), urls = (Array.isArray(c.links) ? c.links : []).map((l) => (isObj(l) ? text(l.url) : "")).filter(Boolean);
  for (const s of [text(c.title), ...urls])
    for (const k of s.matchAll(/(?<![A-Za-z0-9])([A-Z][A-Z0-9]+)-\d+(?![A-Za-z0-9])(?!-\d)/g)) if (!NOT_TICKETS.has(k[1])) out.add(k[0]);
  for (const u of urls) { try { const x = new URL(u); x.hash = ""; out.add(x.href.replace(/\/$/, "")); } catch (e) { /* not a url */ } }
  return out;
}
function cmdXref(a, log) {
  // One file named twice, or by two spellings, is one file: grouped by its resolved path, shown as first named.
  const named = new Map();
  for (const f of a._.slice(1)) if (!named.has(path.resolve(f))) named.set(path.resolve(f), f);
  const files = [...named.keys()];
  if (files.length < 2) fail("xref: name two or more card files");
  const index = new Map();
  for (const f of files) {
    const list = readJson(f, "cards");
    if (!Array.isArray(list)) fail(f + ": the cards are not a JSON list");
    for (const c of list) {
      if (!isObj(c)) continue;
      for (const k of keysOf(c)) {
        if (!index.has(k)) index.set(k, []);
        index.get(k).push({ f, id: text(c.id) || "?" });
      }
    }
  }
  const shared = [...index].filter(([, hits]) => new Set(hits.map((h) => h.f)).size > 1).sort(([x], [y]) => (x < y ? -1 : 1));
  for (const [k, hits] of shared) log(`${k}  ${hits.map((h) => `${h.id} (${named.get(h.f)})`).join(", ")}`);
  log(`xref: ${shared.length} keys in more than one file, ${files.length} files`);
}

const COMMANDS = { map: cmdMap, xref: cmdXref };
export function run(argv, log = console.log) {
  try {
    const a = parseArgs(argv), cmd = COMMANDS[a._[0]];
    if (!cmd) { log(USAGE); return 2; }
    cmd(a, log);
    return 0;
  } catch (e) { if (e instanceof Stop) { log(e.message); return 1; } throw e; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
