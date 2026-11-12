// The features that build 2 cut stay cut. Run: node cuts-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pageFile, load, ok } = require("./_page.js");
const P = load();
const src = fs.readFileSync(pageFile, "utf8"), skill = path.join(__dirname, "..", "skills", "decision-board");
const script = fs.readFileSync(path.join(skill, "scripts", "board.mjs"), "utf8");

ok("no after, supersedes or area: not in the schema, not in the page, not in the script", () => {
  for (const k of ["after", "supersedes", "area"]) assert.equal(k in P.SCHEMA.item, false, k);
  assert.ok(!/supersedes|waitsFor|replacedBy|\.after\b|\.area\b|f\.area/.test(src));
  assert.ok(!/supersedes|\.after\b|\barea\b/.test(script));
});
ok("the kinds are fixed: decision, action, info; a config kinds list changes nothing", () => {
  P.applyConfig({ kinds: [{ id: "digest", options: ["Read"] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(P.cfg.kinds.map((k) => k.id))), ["decision", "action", "info"]);
  assert.equal(P.cfg.kinds, P.SCHEMA.kinds);
  P.applyConfig(null);
  assert.ok(!/kinds/.test(JSON.stringify(Object.keys(P.DEFAULTS))));
});
ok("no filter row: no Area or Priority chips, no Hide answered, no Show closed", () => {
  assert.ok(!/f-area|f-prio|f-hide|f-closed|Hide answered|Show closed|renderSeg|setSwitch|class="filters"/.test(src));
  assert.equal(P.prioOptions, undefined);
});
ok("no from, status answered, source_file or labels config; the default tabs are All only", () => {
  for (const k of ["from", "source_file"]) assert.equal(k in P.SCHEMA.item, false, k);
  assert.deepEqual(JSON.parse(JSON.stringify(P.SCHEMA.statuses)), ["open", "closed"]);
  assert.ok(!("labels" in P.DEFAULTS) && !/cfg\.labels|source_file|it\.from\b/.test(src));
  assert.deepEqual(JSON.parse(JSON.stringify(P.DEFAULTS.tabs)), []);
});
ok("the script has no remove, no --version, no Board items report path, no responses or notes dump in read", () => {
  assert.ok(!/cmdRemove|remove:|one\(a, "version"\)|Board items|\[no-copy\]/.test(script));
  const skillMd = fs.readFileSync(path.join(skill, "SKILL.md"), "utf8");
  assert.ok(!/--version|node S remove|Board items|\[no-copy\]/.test(skillMd));
});
ok("the old watcher brief is gone; the watch brief and wait.sh are back, and wait.sh has no network client", () => {
  assert.equal(fs.existsSync(path.join(skill, "references", "watcher.md")), false);
  assert.ok(fs.existsSync(path.join(skill, "references", "watch.md")));
  assert.ok(!/curl|wget|https?:/.test(fs.readFileSync(path.join(skill, "assets", "wait.sh"), "utf8")));
});
