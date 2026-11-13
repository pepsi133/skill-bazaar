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
ok("no agent model: no agentRe, agentKey, mergeCards, splitByAgent, acks or for", () => {
  assert.equal("agentRe" in P.SCHEMA, false);
  for (const k of ["agentKey", "agentName", "mergeCards", "splitByAgent", "guideAgent"]) assert.equal(P[k], undefined, k);
  assert.equal("ack" in P.SCHEMA, false);
  for (const k of ["batch", "response", "note"]) assert.equal("for" in P.SCHEMA[k], false, k);
  assert.ok(!/collection\("acks"\)/.test(src), "the page reads no acks");
  assert.ok(!/"acks"/.test(/var COLS = [^;]*;/.exec(src)[0]), "COLS has no acks");
  assert.ok(!/--agent/.test(script), "the script takes no --agent");
  const docs = fs.readFileSync(path.join(__dirname, "..", "docs", "how-it-works.html"), "utf8");
  assert.ok(!/\backs\b/.test(docs) && !/--agent/.test(docs), "docs/how-it-works.html names no acks and no --agent");
});
ok("no toISOString and no UTC stamp writer", () => {
  const refresh = fs.readFileSync(path.join(__dirname, "..", "skills", "board-refresh", "scripts", "refresh.mjs"), "utf8");
  for (const [name, s] of [["page", src], ["board.mjs", script], ["refresh.mjs", refresh]]) assert.ok(!s.includes("toISOString("), name);
  assert.ok(!/date -u/.test(fs.readFileSync(path.join(skill, "assets", "wait.sh"), "utf8")), "wait.sh");
});
// A later cluster adds no Date use outside the time section and the clock helpers; it calls them instead.
ok("page times come only from the time section and the clock helpers", () => {
  const helpers = [/^  function clockMs\(\) \{ return Date\.now\(\); \}$/m,
    /^  function nowStamp\(\) \{ return stampIn\(clockMs\(\), cfg\.tz, true\); \}$/m,
    /^  function idStamp\(\) \{ return compactStamp\(nowStamp\(\)\); \}$/m,
    /^  function savedTime\(\) \{ return new Date\(clockMs\(\)\)\.toLocaleTimeString\(\[\], \{ hour: "2-digit", minute: "2-digit", timeZone: cfg\.tz \}\); \}$/m];
  for (const re of helpers) assert.match(src, re);
  const i = src.indexOf("  // ---- time"), j = src.indexOf("  // ---- board config", i);
  assert.ok(i > 0 && j > i, "the time section");
  const rest = (src.slice(0, i) + src.slice(j)).split("\n")
    .filter((l) => !["  function clockMs(", "  function nowStamp(", "  function idStamp(", "  function savedTime("].some((p) => l.startsWith(p))).join("\n");
  for (const re of [/\.toISOString\(/, /\bDate\.now\(/, /\bnew Date\((?!Date\.UTC\()/, /\.get(Full)?(Year|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\(/, /\biso\(/, /\bstamp\(\)/])
    assert.ok(!re.test(rest), "the page outside the time section and the clock helpers: " + re);
  for (const l of script.split("\n").filter((x) => /\bDate\.now\(|\bnew Date\(/.test(x))) assert.ok(l.startsWith("const nowMs = "), "board.mjs: " + l);
  const refresh = fs.readFileSync(path.join(__dirname, "..", "skills", "board-refresh", "scripts", "refresh.mjs"), "utf8");
  assert.ok(!refresh.includes("toISOString(") && !/\.get(Full)?(Year|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\(/.test(refresh), "refresh.mjs");
});
ok("the old Done box is gone: no #cards, #done, #donelist or #donesum", () => {
  assert.ok(!/id="cards"|id="done"|id="donelist"|id="donesum"|\$\("done"\)|\$\("cards"\)/.test(src));
});
ok("quick controls write no HTML and keep the old cut names away", () => {
  assert.ok(!src.includes("setSwitch"));
  for (const name of ["switchRow", "renderControls", "setControl", "saveControls", "renderNotOurs"]) assert.ok(src.includes("  function " + name + "("), name);
  const i = src.indexOf("  function renderControls"), j = src.indexOf("\n  function ", i + 1);
  assert.ok(i > 0 && j > i);
  assert.ok(!src.slice(i, j).includes("innerHTML"));
});
ok("the status document has no agent field", () => {
  assert.equal("agent" in P.SCHEMA.status, false);
});
