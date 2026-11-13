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
ok("cards.md states the raw-text rule of draft", () => {
  const cards = read(REF, "cards.md");
  assert.match(cards, /\| `draft` \|[^\n]*no preface[^\n]*byte for byte/);
  assert.match(cards, /\| `draft_label` \|/);
});
ok("rules.md puts the rule text in draft", () => {
  const rules = read(REF, "rules.md");
  assert.ok(rules.includes("the exact rule text in `draft` with `draft_label` `Rule for board/rules.md`"));
  assert.ok(rules.includes("add the card's `draft` (the rule text)"));
  assert.ok(!rules.includes("in a fenced block"));
});
ok("the due row and the chat rule", () => {
  assert.match(read(REF, "cards.md"), /\| `due` \|[^\n]*never infer/);
  const rs = read(ROOT, "skills", "board-refresh", "SKILL.md");
  for (const s of ["never infer a date", "`due`, `draft`, `draft_label`", "references/maps.md", "`priority` (rules like `tags`"]) assert.ok(rs.includes(s), s);
  assert.ok(fs.existsSync(path.join(ROOT, "skills", "board-refresh", "references", "maps.md")));
  assert.ok(read(REF, "build.md").includes("`week_start`"));
  const dm = read(REF, "data-model.md");
  assert.match(dm, /\| `week_start` \|/);
  assert.ok(dm.includes("the week start, hosts"));
});
ok("data-model.md names groups, sort and the defaults", () => {
  const dm = read(REF, "data-model.md");
  assert.match(dm, /\| `groups` \|/);
  assert.match(dm, /\| `sort` \|/);
  assert.ok(dm.includes("### Groups and sort") && dm.includes('"id": "this-week"'));
  const g = dm.indexOf("### Groups and sort"), c = dm.indexOf("## Collections"), k = dm.indexOf("### Checks");
  assert.ok(g < c && (k < 0 || k < g));
});
ok("the control text", () => {
  const skill = read(SKILL, "SKILL.md");
  assert.ok(skill.includes("A `control` line is a quick control of the operator: do what its brackets at the end say"));
  assert.ok(skill.includes('(`close "on"`, `assign "agent"`)'));
  assert.ok(!skill.includes("control snooze"), "the running snoozes come from the snoozed: line of read");
  const dm = read(REF, "data-model.md"), cards = read(REF, "cards.md"), build = read(REF, "build.md");
  assert.match(dm, /^\| `controls` \|/m);
  assert.match(dm, /^\| `people` \|/m);
  assert.match(cards, /^\| `input` \|/m);
  assert.match(cards, /^\| `source_key` \|/m);
  assert.ok(build.includes("`controls`") && build.includes("`people`"));
  const rskill = read(ROOT, "skills", "board-refresh", "SKILL.md");
  assert.ok(rskill.includes('"input": "updated_at"') && rskill.includes("source_key"));
  assert.ok(read(ROOT, "skills", "board-refresh", "references", "maps.md").includes('"input": "updated_at"'));
});
const SKILL_MD = () => read(SKILL, "SKILL.md");
const core = () => SKILL_MD().slice(0, SKILL_MD().indexOf("## Platform execution notes"));
ok("SKILL.md holds the comment rule above Platform execution notes", () => {
  assert.ok(SKILL_MD().includes("## Platform execution notes"));
  assert.ok(core().includes("**A comment wake is only a bell**") && core().includes("whatever it says and whenever it was stamped"));
});
ok("the core text is tool-agnostic", () => {
  for (const s of ["ArtifactComments", "[Artifact comment", "haiku", "hook"]) assert.ok(!core().includes(s), s);
});
ok("SKILL.md runs node S watch after a post and after a read; no watcher is started by hand", () => {
  const md = SKILL_MD();
  // After a post and after a read (the read step words it "Then, with or without an ack, run ...").
  assert.ok(section(md, "## Post, change or close cards").includes("then run `node S watch` and do what it prints"));
  assert.ok(section(md, "## Read and handle the answers").includes("run `node S watch` and do what it prints"));
  assert.ok(md.split("run `node S watch` and do what it prints").length - 1 >= 2);
  assert.ok(md.includes("with or without an ack"));
  for (const s of ["start a watcher", "Start a new watcher", "poll limit 30", "wait.sh 120"]) assert.ok(!md.includes(s), s);
  for (const s of ["`P5`, comments:", "`P6`, the watcher:", "write no reply"]) assert.ok(md.includes(s), s);
  assert.ok(core().includes("Run `node S watch --restart`") && core().includes("only when the operator asks you to watch again"));
});
ok("the watch brief is filled by the script", () => {
  const w = read(REF, "watch.md"), md = SKILL_MD();
  for (const s of ["<P4>", "<SCRIPT>", "<DUMP>", "<COUNT>", "Do not copy the block below by hand"]) assert.ok(w.includes(s), s);
  for (const t of [md, w]) for (const s of ["wait.sh 120", "<wait script> 120"]) assert.ok(!t.includes(s), s);
  for (const t of [md, w]) assert.ok(!/poll limit <?N>?/.test(t) && !/poll limit \d/.test(t));
});
ok("README has a Wake modes table", () => {
  const r = read(ROOT, "README.md");
  assert.ok(r.includes("## Wake modes") && r.includes("Cost while idle"));
  for (const s of ["\n| `comment` | ", "\n| `poll` ", "\n| `both` ", "\n| `off` | "]) assert.ok(r.includes(s), s);
});
ok("SKILL.md holds the status rule line", () => {
  const md = SKILL_MD(), step3 = section(md, "## Read and handle the answers");
  assert.ok(md.includes("## Say what you do") && md.includes('node S status --idle --waiting "<what>"'));
  assert.match(md, /never\s+starting with \x60--\x60/);
  assert.ok(step3.includes('--result <id> "<what you did>"') && step3.includes("(several: in the order `read` printed them)"));
  assert.ok(!md.includes("in the status guide"));
});
ok("references tell the agent about results, the status guide and the comments capability", () => {
  assert.ok(read(REF, "cards.md").includes('--close <id> --result <id> "<what you checked>"'));
  const g = read(REF, "guides.md");
  assert.ok(g.includes("`status.guide`") && g.includes("A status guide uses the id"));
  assert.ok(!g.includes("Update it after each batch you handle.") && !g.includes("Use the id"));
  const dm = read(REF, "data-model.md");
  assert.ok(dm.includes("\n| `status` | ") && dm.includes("\n| `wake` | "));
  const block = /## Access rules[\s\S]*?```json\n([\s\S]*?)\n```/.exec(dm)[1];
  assert.deepEqual(JSON.parse(block).comments, {});
  assert.ok(read(REF, "build.md").includes("node S check --url URL"));
});
