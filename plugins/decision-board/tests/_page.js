// Shared loader for the *-test.js files. Not a test itself.
// The page is ../skills/decision-board/assets/board.html, or the file given as the first argument.
// load() runs the part of the page between "pure: start" and "pure: end" in a sandbox.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

const pageFile = path.resolve(process.argv[2] || path.join(__dirname, "..", "skills", "decision-board", "assets", "board.html"));
const page = fs.readFileSync(pageFile, "utf8");

function cut(a, b) {
  const i = page.indexOf(a), j = page.indexOf(b, i + 1);
  if (i < 0 || j < 0) throw new Error("marker not found in " + pageFile + ": " + a + " / " + b);
  return page.slice(i, j);
}
function load(state, extra) {
  const ctx = vm.createContext(Object.assign({
    items: new Map(), resp: new Map(), notes: new Map(), guides: new Map(), batches: new Map(), acks: new Map(),
    f: { tab: "all" },
    loaded: { config: true }, isPending: () => false, URL,
  }, state || {}));
  vm.runInContext(cut("  // ---- pure: start", "  // ---- pure: end") + (extra || ""), ctx, { filename: pageFile });
  return ctx;
}
let n = 0;
// Run one named check. A failed assert throws, the process ends with exit code 1.
function ok(name, fn) { fn(); n++; console.log("ok " + n + " " + name); }

module.exports = { pageFile, cut, load, ok };
