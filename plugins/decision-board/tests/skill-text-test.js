// Text checks of the agent-facing files: SKILL.md, the references, the board-refresh skill and the example config.
// Run: node tests/skill-text-test.js. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SKILL = path.join(ROOT, "skills", "decision-board");
const REF = path.join(SKILL, "references");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
// The text from a heading to the next heading of the same level, or to the end.
const section = (text, head) => { const i = text.indexOf(head); assert.ok(i >= 0, head); const j = text.indexOf("\n## ", i + head.length); return text.slice(i, j < 0 ? undefined : j); };
let n = 0;
function ok(name, fn) { fn(); n++; console.log("ok " + n + " " + name); }

ok("data-model.md names the config layers", () => {
  const md = read(REF, "data-model.md");
  for (const s of ["config.local.json", "BOARD_USER_CONFIG", '"+tags"', "config.merged.json"]) assert.ok(md.includes(s), s);
});
ok("board-refresh maps with config.merged.json and the config ids line", () => {
  const md = read(ROOT, "skills", "board-refresh", "SKILL.md");
  assert.ok(md.includes("--config board/config.merged.json"));
  assert.ok(md.includes("config ids:"));
  assert.ok(!md.includes("--config board/config.json"));
});
ok("config.example.json parses, names only example.com hosts, and holds three example checks", () => {
  const ex = JSON.parse(read(SKILL, "assets", "config.example.json"));
  for (const h of ex.link_hosts) assert.ok(/(^|\.)example\.com$/.test(h), h);
  const texts = [];
  const walk = (x) => { if (typeof x === "string") texts.push(x); else if (x && typeof x === "object") Object.values(x).forEach(walk); };
  walk(ex);
  for (const t of texts) for (const u of t.match(/https?:\/\/[^\s"]+|\b[a-z0-9-]+(\.[a-z0-9\\-]+)+\.[a-z]{2,}\b/gi) || []) {
    const host = u.replace(/^\^?https?:\/\//, "").split("/")[0].replace(/\\/g, "");
    assert.ok(/(^|\.)example\.com$/.test(host), u);
  }
  assert.equal(ex._examples.checks.length, 3);
  assert.ok(read(REF, "data-model.md").includes("### Checks"));
});
ok("build.md: the build names the config layers line", () => {
  const build = section(read(REF, "build.md"), "## Build a board");
  assert.ok(build.includes("config layers:"));
  assert.ok(!build.includes("every card needs a link"));
});
ok("SKILL.md names the operator rules and when to read them; rules.md holds the card flow", () => {
  const skill = read(SKILL, "SKILL.md");
  for (const s of ["## Operator rules", "`board/rules.md`", "Read it at the start of each session and when a", "references/rules.md", "`[rule]`", "`[standing]`"]) assert.ok(skill.includes(s), s);
  assert.ok(!skill.includes("guide board/rules.md"));
  const rules = read(REF, "rules.md");
  for (const s of ["## Start the rules", "Add it", "Add it with my change, see note", "Leave it out", "source", "rules-cards.json"]) assert.ok(rules.includes(s), s);
  assert.ok(section(read(REF, "build.md"), "## Build a board").includes("printed a `rules:` line"));
  assert.ok(read(ROOT, "skills", "board-refresh", "SKILL.md").includes("board/rules.md"));
  assert.ok(!read(REF, "watch.md").includes("rules.md"));
});
ok("links are optional in cards.md and build.md", () => {
  const cards = read(REF, "cards.md");
  assert.ok(cards.includes("Optional. Up to 10") && !cards.includes("Required. 1 to 10"));
  assert.ok(!read(REF, "build.md").includes("every card needs a link"));
});
