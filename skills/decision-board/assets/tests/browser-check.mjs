// Optional browser check of the board page. It needs Playwright for node and a Chromium build.
// Run: npx -y -p playwright node browser-check.mjs [path of board.html]
// Pin the version that matches an installed Chromium build, for example -p playwright@1.63.0.
// Without Playwright or Chromium the script prints SKIP and exits with 2.
// The page talks to an in-memory stub of the database. The script contacts no real board.
// It prints one PASS or FAIL line per check and exits with 1 when a check fails.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageFile = path.resolve(process.argv[2] || path.join(here, "..", "board.html"));

// Find Playwright: a normal install first, then the package that "npx -p playwright" put on PATH.
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ["playwright"].concat((process.env.PATH || "").split(path.delimiter)
    .filter((d) => d.endsWith(path.join("node_modules", ".bin")))
    .map((d) => path.join(d, "..", "playwright")));
  for (const t of tries) { try { return require(t); } catch (e) { /* try the next one */ } }
  return null;
}
const pw = loadPlaywright();
if (!pw) {
  console.log("SKIP: Playwright for node was not found. Run: npx -y -p playwright node " + path.basename(fileURLToPath(import.meta.url)));
  process.exit(2);
}

const T = "2026-01-01T10:00:00Z";
const long = "This sentence fills the card so that the page is longer than one phone screen. ".repeat(4);
const item = (id, source, priority, extra) => Object.assign({ id, area: source === "email" ? "mail" : (source === "github" ? "code" : "infra"),
  source, title: "Question " + id + "?", summary: long, evidence: "- `measured` here", options: ["Yes", "No"], recommendation: "Yes",
  priority, status: "open", created: T, updated: T }, extra || {});
const seed = {
  items: [
    item("mail-one", "email", "now", { blocks: "the mail filters", kind: "action" }),
    item("mail-two", "email", "soon"),
    item("mail-three", "email", "later"),
    item("code-one", "github", "soon"),
    item("code-two", "github", "later", { blocks: "the release branch" }),
    item("infra-one", "other", "now"),
    item("infra-two", "other", "later", { title: "Title <script>window.__xss = 1</script>",
      summary: "Summary <script>window.__xss = 1</script> and <img src=x onerror=\"window.__xss = 1\">\n\n```\n<script>window.__xss = 1</script>\n```" }),
  ],
  guides: [
    { id: "dns-setup", title: "DNS setup", status: "active", created: T, updated: T, item: "code-one",
      body: "### Records\nBefore: nothing is set\n\n1. Open the DNS panel of `example.org`.\n2. Add this record:\n```\nexample.org. 3600 IN TXT \"v=spf1 -all\"\n```\n3. Save the zone.\n\n- A bullet with **bold** text\n\n<script>window.__xss = 1</script>" },
  ],
  responses: [], notes: [],
  batches: [{ id: "b20260101T090000Z-ab12", created: "2026-01-01T09:00:00Z", itemIds: ["old-one", "old-two"], noteIds: [], status: "delivered", delivered_at: "2026-01-01T09:05:00Z" }],
  meta: [{ id: "board", title: "Check board", updated: T }],
};

// In-memory stub of the calls that the page makes on window.claude.use("db").
function stub(seedData) {
  const cols = new Map(), subs = [];
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  Object.keys(seedData).forEach((n) => seedData[n].forEach((d) => col(n).set(d.id, JSON.parse(JSON.stringify(d)))));
  const dsnap = (n, id) => { const d = col(n).get(id); return { id, exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) }; };
  const qsnap = (n, pred) => ({ docs: Array.from(col(n).keys()).map((id) => dsnap(n, id)).filter((d) => !pred || pred(d.data())) });
  const fire = (n) => setTimeout(() => subs.filter((s) => s.n === n).forEach((s) => s.cb(s.id ? dsnap(n, s.id) : qsnap(n))), 0);
  const split = (p) => { const i = p.indexOf("/"); return [p.slice(0, i), p.slice(i + 1)]; };
  window.__db = { cols, writes: [], fire };
  const db = {
    collection: (n) => ({
      get: () => Promise.resolve(qsnap(n)),
      onSnapshot: (cb) => { subs.push({ n, cb }); fire(n); return () => {}; },
      where: (k, op, v) => ({ get: () => Promise.resolve(qsnap(n, (d) => d[k] === v)) }),
    }),
    doc: (p) => {
      const [n, id] = split(p);
      const write = (op, fn) => { window.__db.writes.push(op + " " + p); fn(); fire(n); return Promise.resolve(); };
      return {
        get: () => Promise.resolve(dsnap(n, id)),
        onSnapshot: (cb) => { subs.push({ n, id, cb }); fire(n); return () => {}; },
        set: (d) => write("set", () => col(n).set(id, JSON.parse(JSON.stringify(d)))),
        update: (d) => write("update", () => col(n).set(id, Object.assign({}, col(n).get(id), d))),
        delete: () => write("delete", () => col(n).delete(id)),
      };
    },
  };
  window.claude = { use: (name) => (name === "db" ? Promise.resolve(db) : Promise.reject(new Error("no " + name))) };
}

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " (" + detail + ")" : ""));
}
// Where the card sits: its top must be below the sticky header and inside the viewport.
const place = (page, id) => page.evaluate((cid) => {
  const el = document.getElementById(cid), hd = document.querySelector("header.bar");
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), header: Math.round(hd.getBoundingClientRect().bottom), vh: window.innerHeight, flash: el.classList.contains("flash") };
}, "card-" + id);
const inView = (p) => !!p && p.top >= p.header && p.top < p.vh * 0.6;
const show = (p) => (p ? "card top " + p.top + ", header bottom " + p.header + ", viewport " + p.vh : "card not in the page");

const html = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body>" +
  readFileSync(pageFile, "utf8").replace(/<link rel="stylesheet"[^>]*>/, "") + "</body></html>";

let browser;
try {
  browser = await pw.chromium.launch();
} catch (e) {
  console.log("SKIP: Chromium did not start. Run: npx -y playwright install chromium\n" + String(e.message).split("\n")[0]);
  process.exit(2);
}
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("http://board.test/**", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await page.addInitScript("(" + stub.toString() + ")(" + JSON.stringify(seed) + ")");
  await page.goto("http://board.test/");
  console.log("page: " + pageFile);

  await page.waitForSelector("#cards .card");
  check("the page renders cards", (await page.locator("#cards .card").count()) === seed.items.length,
    (await page.locator("#cards .card").count()) + " cards on the All tab");
  check("\"Blocked on you\" lists the two cards with blocks", (await page.locator("#blocked .brow").count()) === 2);

  // A card in another tab: select Email, then tap the entry of the GitHub card.
  await page.tap("#tabs [data-tab=email]");
  check("the Email tab hides the GitHub card", (await place(page, "code-two")) === null);
  await page.tap("#blocked .brow:has-text(\"Question code-two?\")");
  await page.waitForTimeout(300);
  const mid = await place(page, "code-two");
  check("the tapped card shows a highlight", !!mid && mid.flash);
  await page.waitForTimeout(1200);
  let p = await place(page, "code-two");
  check("tap on a blocked entry in another tab ends with the card in view", inView(p), show(p));
  check("the tap selects the tab of the card", (await page.getAttribute("#tabs [data-tab=github]", "aria-selected")) === "true");

  // A card that a filter hides: select priority Now, then tap the entry of a "later" card again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.tap("#f-prio [data-v=now]");
  check("the priority filter hides the card", (await place(page, "code-two")) === null);
  await page.tap("#blocked .brow:has-text(\"Question code-two?\")");
  await page.waitForTimeout(1500);
  p = await place(page, "code-two");
  check("tap on a blocked entry that a filter hides ends with the card in view", inView(p), show(p));

  // A card in the selected tab, far down the page.
  await page.tap("#tabs [data-tab=all]");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.tap("#blocked .brow:has-text(\"Question code-two?\")");
  await page.waitForTimeout(1500);
  p = await place(page, "code-two");
  check("tap on a blocked entry in the selected tab ends with the card in view", inView(p), show(p));

  // Escaping.
  const xss = await page.evaluate(() => ({ flag: window.__xss, tags: document.querySelectorAll("#cards script, #cards img, #guide script").length,
    text: document.getElementById("card-infra-two").textContent }));
  check("text with <script> in a card stays escaped", xss.flag === undefined && xss.tags === 0 && xss.text.split("<script>window.__xss = 1</script>").length === 4,
    "flag " + xss.flag + ", injected elements " + xss.tags);
  check("a fenced block in a card renders as a preformatted block with a copy button",
    (await page.locator("#card-infra-two .summary pre").count()) === 1 && (await page.locator("#card-infra-two .summary button.copy").count()) === 1);

  // Guide tab.
  const gtab = page.locator("#tabs [data-tab=\"guide:dns-setup\"]");
  check("a guide tab appears", (await gtab.count()) === 1, "label: " + ((await gtab.count()) ? (await gtab.innerText()).trim() : "none"));
  check("the card of the guide shows \"Open guide\"", (await page.locator("#card-code-one .gopen:visible").count()) === 1 &&
    (await page.locator("#cards .gopen:visible").count()) === 1);
  await page.tap("#card-code-one .gopen");
  await page.waitForSelector("#guide:not([hidden])");
  const g = await page.evaluate(() => {
    const q = (s) => Array.from(document.querySelectorAll("#guide " + s)).map((e) => e.textContent);
    return { ol: q("ol").length, li: q("ol > li"), start: Array.from(document.querySelectorAll("#guide ol")).map((e) => e.getAttribute("start")),
      pre: q("pre"), copy: q("button.copy").length, h4: q("h4"), cards: document.querySelectorAll("#cards .card").length, flag: window.__xss };
  });
  check("the guide renders a numbered list", g.li.length === 3 && g.start.join() === "1,3", g.li.length + " steps, list starts " + g.start.join());
  check("the guide renders a code block with a copy button", g.pre.length === 1 && g.pre[0] === "example.org. 3600 IN TXT \"v=spf1 -all\"" && g.copy === 1, JSON.stringify(g.pre));
  check("the guide tab shows no cards and runs no script", g.cards === 0 && g.flag === undefined);
  await page.tap("#guide .garchive");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ status: window.__db.cols.get("guides").get("dns-setup").status, writes: window.__db.writes,
    tab: document.querySelectorAll("#tabs [data-tab^=\"guide:\"]").length, cards: document.querySelectorAll("#cards .card").length,
    archived: document.querySelectorAll("#archived .arow").length }));
  check("Archive removes the guide tab", after.tab === 0 && after.status === "archived" && after.cards > 0, "status " + after.status + ", writes: " + after.writes.join(", "));
  check("the archived guide is listed at the bottom", after.archived === 1);
  await page.tap("#archived .greopen");
  await page.waitForTimeout(300);
  check("Reopen brings the guide tab back", (await gtab.count()) === 1 && (await page.locator("#guide:not([hidden]) ol").count()) === 2);
  check("the page wrote only to guides", (await page.evaluate(() => window.__db.writes.every((w) => /^update guides\//.test(w)))));
  check("the page raised no script error", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}
console.log(failed ? failed + " check(s) failed" : "all checks passed");
process.exit(failed ? 1 : 0);
