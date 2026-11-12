// Tests of skills/board-refresh/scripts/refresh.mjs, and of its output against the core `sync`.
// Run from the plugin root: node tests/refresh-test.mjs. Exits 1 on the first failure. Temporary files go
// under the system temp directory (TMPDIR) and are removed at the end.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../skills/board-refresh/scripts/refresh.mjs";
import { run as board } from "../skills/decision-board/scripts/board.mjs";
import { writesOf } from "./fakedb.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-test-"));
let n = 0;
function ok(name, fn) { fn(); n++; console.log("ok " + n + " " + name); }
let k = 0;
const put = (name, v) => { const f = path.join(tmp, ++k + "-" + name); fs.writeFileSync(f, JSON.stringify(v)); return f; };
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
function sh(fn, ...argv) { const lines = []; const code = fn(argv, (l) => lines.push(...String(l).split("\n"))); return { code, lines, text: lines.join("\n") }; }
process.env.BOARD_NOW = "2026-02-01T12:00:00Z";
const URL1 = "https://tracker.example.com/infra/-/issues/";

// A sample export of an issue tracker, as a CLI would save it.
const GOOD = [
  { iid: 101, title: "Backup job fails on day 9", web_url: URL1 + "101", created_at: "2026-01-10T08:00:00Z", author: { login: "ops-bot" }, state: "opened", labels: [{ name: "Cost" }, { name: "backup" }] },
  { iid: 102, title: "Rotate the API token", web_url: URL1 + "102", created_at: 1768210200, author: { login: "Jane Doe" }, state: "Closed", labels: [{ name: "security" }] },
  { iid: 103, title: "Resolved one", web_url: URL1 + "103", created_at: "1768296600000", author: { login: "  " }, state: "resolved", labels: [] },
  { iid: "ops/7 #a", title: "Odd key, see OPS-7", web_url: "https://tracker.example.com/ops/-/issues/7", created_at: "2026-01-14", state: "opened", labels: [{ name: "billing" }, { name: "cost" }] },
];
const BAD = [
  { iid: 201, title: "No link here", created_at: "2026-01-13", state: "opened" },
  { title: "No key here", web_url: URL1 + "x", created_at: "2026-01-13", state: "opened" },
];
const ROWS = [...GOOD, ...BAD];
const MAP = { key: "iid", title: "title", url: "web_url", created: "created_at", who: "author.login",
  closed: { field: "state", equals: ["closed", "resolved"] },
  tags: [{ field: "labels.name", equals: "security", tag: "security" }, { field: "labels.name", equals: ["cost", "billing"], tag: "cost" }] };
const CONFIG = { link_hosts: ["example.com"], tags: [{ id: "cost", label: "Costs money" }, { id: "security", label: "Security" }] };
function map(rows = GOOD, m = MAP, ...more) {
  const out = path.join(tmp, ++k + "-cards.json");
  const r = sh(run, "map", put("rows.json", rows), "--map", put("map.json", m), "--source", "tracker", "--out", out, ...more);
  const det = out + ".details.json";
  return Object.assign(r, { out, cards: fs.existsSync(out) ? read(out) : null, details: fs.existsSync(det) ? read(det) : null });
}
const row = (x) => Object.assign({ iid: 1, title: "t", web_url: URL1 + "1", created_at: "2026-01-10", state: "opened" }, x);
const one = (x, m = MAP, ...more) => map([row(x)], m, ...more);

ok("map: fields, source, kind action, tag rules over a list path, both closed values, case-insensitive rules", () => {
  const r = map();
  assert.equal(r.code, 0, r.text);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0], `map: 4 rows, 4 cards (2 closed), 0 dropped, 0 skipped, 0 overrides without a row; rules matched: closed 2, tags[0] security 1, tags[1] cost 2 -> ${r.out}`);
  const [a, b, c, d] = r.cards;
  assert.deepEqual(a, { id: "tracker-101", source: "tracker", kind: "action", title: "Backup job fails on day 9",
    links: [{ label: "tracker 101", url: URL1 + "101" }], first_asked: { date: "2026-01-10", who: "ops-bot" }, tags: ["cost"] });
  assert.deepEqual([b.status, b.tags, b.first_asked], ["closed", ["security"], { date: "2026-01-12", who: "Jane-Doe" }]);
  assert.deepEqual([c.status, c.tags, c.first_asked], ["closed", undefined, { date: "2026-01-13" }], "epoch ms; no empty tags; a blank who is dropped");
  assert.ok(!("tags" in c));
  assert.deepEqual(d.tags, ["cost"], "two matches of one tag give it once");
  assert.equal(d.status, undefined);
  // Chat exports write fractional epoch seconds, as a string or a number.
  assert.deepEqual(one({ created_at: "1768210200.000200" }).cards[0].first_asked.date, "2026-01-12");
  assert.deepEqual(one({ created_at: 1768210200.5 }).cards[0].first_asked.date, "2026-01-12");
  assert.equal(one({ created_at: "1768210200." }).code, 1, "a bare dot is no epoch");
  assert.equal(one({ author: { login: "///" } }).cards[0].first_asked.who, undefined, "a who of only - is dropped");
  const dec = one({}, Object.assign({}, MAP, { kind: "decision" }));
  assert.deepEqual(dec.details.skipped[0].reasons, ["a decision card needs 2 or more options: set them in an override"]);
  const opts = put("opts.json", { "tracker-1": { options: ["Yes", "No"] } });
  assert.equal(one({}, Object.assign({}, MAP, { kind: "decision" }), "--overrides", opts).cards[0].kind, "decision");
});

ok("map: a skipped row stops the map unless --allow-skipped; details go to <out>.details.json", () => {
  const r = map(ROWS);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /4 cards .* 2 skipped.*Nothing written/);
  assert.equal(r.cards, null);
  assert.deepEqual(r.details.skipped, [{ row: 5, key: "201", reasons: ["no url (web_url)"] }, { row: 6, key: "", reasons: ["no key (iid)"] }]);
  const ok2 = map(ROWS, MAP, "--allow-skipped");
  assert.equal(ok2.code, 0);
  assert.equal(ok2.cards.length, 4);
  const custom = path.join(tmp, "d.json");
  map(ROWS, MAP, "--allow-skipped", "--details", custom);
  assert.equal(read(custom).skipped.length, 2);
});

ok("map: title required; a bad url, a long title or label, a bad or future date are skipped with a reason", () => {
  const reason = (x, m) => { const r = one(x, m); assert.equal(r.code, 1, r.text); return r.details.skipped[0].reasons; };
  assert.deepEqual(reason({ title: " " }), ["no title (title)"]);
  assert.deepEqual(reason({ web_url: "http://tracker.example.com/1" }), ["url is not https"]);
  assert.deepEqual(reason({ web_url: "not a url" }), ["url does not parse"]);
  assert.deepEqual(reason({ title: "x".repeat(301) }), ["title over 300 characters"]);
  assert.deepEqual(reason({ iid: "k".repeat(300) }), ["link label over 300 characters"]);
  assert.deepEqual(reason({ created_at: "2026-02-30" }), ["created date 2026-02-30 is not a real date"]);
  assert.deepEqual(reason({ created_at: "2026-02-03" }), ["created date 2026-02-03 is in the future"]);
  assert.deepEqual(reason({ created_at: "last week" }), ["created date cannot be read"]);
  assert.deepEqual(reason({ created_at: undefined }), ["no created date"]);
  assert.equal(one({ created_at: "2026-02-02" }).code, 0, "tomorrow is allowed");
  assert.equal(one({ created_at: undefined, state: "closed" }).code, 0, "a closed row needs no date");
  assert.equal(one({ created_at: undefined }, Object.assign({}, MAP, { kind: "info" })).code, 0, "an info card needs no date");
});

ok("map: --config checks link_hosts and tag ids", () => {
  const cfg = put("config.json", CONFIG);
  assert.equal(map(GOOD, MAP, "--config", cfg).code, 0);
  const off = one({ web_url: "https://tracker.other.invalid/1" }, MAP, "--config", cfg);
  assert.deepEqual(off.details.skipped[0].reasons, ["url host tracker.other.invalid not in the config link_hosts"]);
  const tag = one({ labels: [{ name: "security" }] }, MAP, "--config", put("c2.json", { link_hosts: ["example.com"], tags: [] }));
  assert.deepEqual(tag.details.skipped[0].reasons, ["tag security not in the config tags"]);
});

ok("map: the id is <source>-<key>, safe and stable; a hashed clash is the same card id as row N", () => {
  const ids = map().cards.map((c) => c.id);
  assert.deepEqual(ids, map().cards.map((c) => c.id));
  assert.match(ids[3], /^tracker-ops-7--a-[a-z0-9]+$/);
  assert.notEqual(one({ iid: "ops/7 /a" }).cards[0].id, ids[3]);
  assert.ok(one({ iid: "k".repeat(150) }).cards[0].id.length <= 100);
  const r = map([row({}), row({})]);
  assert.deepEqual(r.details.skipped[0].reasons, ["the same card id as row 1"]);
});

ok("map: zero rows, fewer than --min-rows, a flag with no value, a bad equals or map are refused", () => {
  assert.match(map([]).text, /no rows/);
  assert.equal(map([]).code, 1);
  const few = map(GOOD, MAP, "--min-rows", "5");
  assert.equal(few.code, 1);
  assert.match(few.text, /4 rows, fewer than --min-rows 5/);
  assert.equal(map(GOOD, MAP, "--min-rows", "4").code, 0);
  assert.match(map(GOOD, MAP, "--overrides").text, /--overrides: no value/);
  assert.equal(map(GOOD, Object.assign({}, MAP, { closed: { field: "state", equals: { a: 1 } } })).code, 1);
  assert.equal(map(GOOD, Object.assign({}, MAP, { tags: [{ field: "x", equals: [["a"]], tag: "cost" }] })).code, 1);
  const bad = map(GOOD, { key: "iid", title: "title", url: "web_url", colour: "x" });
  assert.match(bad.text, /created: /);
  assert.match(bad.text, /unknown fields: colour/);
  assert.equal(map({ issues: GOOD }, Object.assign({}, MAP, { rows: "issues" })).cards.length, 4);
});

ok("map: overrides by card id or raw key; they replace tags, set the decision fields, close and drop", () => {
  const over = put("over.json", {
    "tracker-101": { priority: "now", tags: ["security"], summary: "Merged", title: "Grow the backup volume?", kind: "decision",
      options: ["Grow", "Wait"], recommendation: "Grow", blocks: "the nightly backup", evidence: "- 82 %" },
    "ops/7 #a": { status: "closed" }, "102": { drop: true }, "tracker-999": { priority: "later" } });
  const r = map(GOOD, MAP, "--overrides", over);
  assert.equal(r.code, 0, r.text);
  assert.match(r.lines[0], /3 cards \(2 closed\), 1 dropped, 0 skipped, 1 overrides without a row \(tracker-999\)/);
  const [a, , d] = r.cards;
  assert.deepEqual([a.priority, a.tags, a.summary, a.title, a.kind, a.options, a.recommendation, a.blocks, a.evidence],
    ["now", ["security"], "Merged", "Grow the backup volume?", "decision", ["Grow", "Wait"], "Grow", "the nightly backup", "- 82 %"]);
  assert.equal(d.status, "closed");
  assert.ok(!r.cards.some((c) => c.id === "tracker-102"));
  for (const bad of [{ links: [] }, { status: "open" }, { drop: false }, { options: "a" }])
    assert.equal(map(GOOD, MAP, "--overrides", put("o.json", { "tracker-101": bad })).code, 1, JSON.stringify(bad));
});

ok("xref: shared keys across files, grouped by resolved path; CVE, UTF-8 and the like are no keys; nothing merged", () => {
  const a = map().out;
  const chat = put("chat.json", [{ id: "chat-1", title: "Is OPS-7 done? CVE-2026-1234, UTF-8, TLS-13", links: [{ label: "t", url: "https://chat.example.com/t/1" }] },
    { id: "chat-2", title: "Backup", links: [{ label: "issue", url: URL1 + "101/#note" }] },
    { id: "chat-3", title: "Unrelated MOPS-77x", links: [{ label: "t", url: "https://chat.example.com/t/3" }] }]);
  const mail = put("mail.json", [{ id: "mail-1", title: "CVE-2026-1234 and UTF-8 again", links: [{ label: "m", url: "https://chat.example.com/t/1" }] }]);
  const before = fs.readFileSync(chat, "utf8");
  const r = sh(run, "xref", a, chat, mail);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.lines, [
    `OPS-7  ${map().cards[3].id} (${a}), chat-1 (${chat})`,
    `https://chat.example.com/t/1  chat-1 (${chat}), mail-1 (${mail})`,
    `https://tracker.example.com/infra/-/issues/101  tracker-101 (${a}), chat-2 (${chat})`,
    "xref: 3 keys in more than one file, 3 files"]);
  assert.equal(fs.readFileSync(chat, "utf8"), before);
  const twice = sh(run, "xref", chat, path.join(path.dirname(chat), ".", path.basename(chat)));
  assert.equal(twice.code, 1, "one file under two spellings is one file");
  const same = put("same.json", [{ id: "x-1", title: "OPS-7" }, { id: "x-2", title: "OPS-7" }]);
  assert.equal(sh(run, "xref", same, mail).lines[0], "xref: 0 keys in more than one file, 2 files", "two cards of one file are no shared key");
});

ok("the map output passes the core sync (links on link_hosts, first_asked, source) and prints one write", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "board-")), state = path.join(dir, "state.json");
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(CONFIG));
  assert.equal(sh(board, "check", "--agent", "refresh", "--state", state).code, 0);
  const r = map();
  const sync = (f, src, ...more) => sh(board, "sync", f, "--source", src, "--agent", "refresh", "--state", state, ...more);
  const s = sync(r.out, "tracker");
  assert.equal(s.code, 0, s.text);
  assert.equal(s.lines[0], "sync: 4 new, 0 changed (rev up), 0 changed (same rev), 0 unchanged, 0 closed");
  assert.deepEqual(writesOf(s.lines).flat().map((w) => [w.op, w.collection, w.doc_id]), [["set", "cards", "refresh"]]);
  assert.deepEqual(sync(map().out, "tracker").lines, ["sync: 0 new, 0 changed (rev up), 0 changed (same rev), 4 unchanged, 0 closed", "no writes"]);
  const swapped = sync(map().out, "mail");
  assert.equal(swapped.code, 1, "a swapped --source fails");
  assert.match(swapped.text, /source: not the --source "mail"/);
  // A short fetch that holds only a closed row would close every open card. The core refuses it without --allow-close.
  const short = map([GOOD[1]]).out;
  const refused = sync(short, "tracker");
  assert.equal(refused.code, 1);
  assert.match(refused.text, /no open cards.*--allow-close/);
  assert.equal(sync(short, "tracker", "--allow-close").code, 0);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${n} tests passed`);
