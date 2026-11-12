// End-to-end run on fixtures: cards -> batch applied to a fixture database -> the page renders it in
// Chromium -> the operator answers and sends -> read prints the batch -> ack -> purge.
// Run: npx -y -p playwright node e2e.mjs. Prints PASS or FAIL per step, exits 1 on a failure, 2 without Playwright.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/board.mjs";
import { applyBatch, readDb, writeDb, writesOf } from "./fakedb.mjs";
import { loadPlaywright, openPage } from "./_browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageFile = path.join(here, "..", "assets", "board.html");
const pw = loadPlaywright();
if (!pw) { console.log("SKIP: Playwright for node was not found."); process.exit(2); }

let failed = 0;
function check(name, ok, detail) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail && !ok ? " (" + detail + ")" : "")); }
function sh(...argv) { const lines = []; run(argv, (l) => lines.push(...String(l).split("\n"))); return lines; }
function apply(dump, lines) { const ws = writesOf(lines); ws.forEach((w) => applyBatch(dump, w)); return ws.flat(); }
// The database as the page stub's seed, and the stub's collections back into the database with new versions.
function seedOf(dump) {
  const seed = {};
  for (const [c, m] of readDb(dump)) seed[c] = Array.from(m.entries()).map(([id, d]) => Object.assign({}, d.data, { id }));
  return seed;
}
async function saveBack(page, dump) {
  const db = readDb(dump), cols = await page.evaluate(() => Array.from(window.__db.cols.entries()).map(([c, m]) => [c, Array.from(m.entries())]));
  for (const [c, docs] of cols) {
    const old = db.get(c) || new Map(), next = new Map();
    for (const [id, data] of docs) {
      const was = old.get(id), d = Object.assign({}, data);
      if (!(was && "id" in was.data) && !["items", "batches", "notes", "guides"].includes(c)) delete d.id;
      next.set(id, was && JSON.stringify(was.data) === JSON.stringify(d) ? was : { version: (was ? was.version : 0) + 1, data: d });
    }
    db.set(c, next);
  }
  writeDb(dump, db);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "board-e2e-"));
const dump = path.join(tmp, "dump");
fs.cpSync(path.join(here, "fixtures", "dump"), dump, { recursive: true });
process.env.BOARD_NOW = "2026-02-01T12:00:00Z";
let browser;
try { browser = await pw.chromium.launch(); } catch (e) { console.log("SKIP: Chromium did not start: " + String(e.message).split("\n")[0]); process.exit(2); }
try {
  // 1. cards
  const c = sh("cards", path.join(here, "fixtures", "report.md"), "--dump", dump);
  const ws = apply(dump, c);
  check("cards prints writes that the batch call accepts", ws.length === 3 && readDb(dump).get("items").size === 4, c.join(" | "));

  // 2. the page renders the database and the operator answers
  const o = await openPage(browser, seedOf(dump), pageFile);
  await o.page.waitForSelector("#cards .card");
  await o.page.waitForTimeout(300);
  const shown = await o.page.$$eval("#cards .card", (cs) => cs.map((x) => x.dataset.item).sort().join());
  const title = await o.page.textContent("#ttl");
  check("the page renders the cards and the config", shown === "cam-firmware,disk-size,vlan-plan" && title === "Lab board", shown + " " + title);
  await o.page.locator("[data-item=disk-size] label.opt", { hasText: "Yes" }).click();
  await o.page.locator("[data-item=vlan-plan] label.opt", { hasText: "No" }).click();
  await o.page.locator("[data-item=cam-firmware] label.opt", { hasText: "Done in part" }).click();
  await o.page.locator("[data-item=cam-firmware] textarea").fill("Camera 2 is offline.");
  await o.page.locator("[data-item=cam-firmware] textarea").blur();
  await o.page.fill("#newnote", "Thanks.");
  await o.page.click("#addnote");
  await o.page.waitForTimeout(300);
  const label = (await o.page.textContent("#send")).trim();
  await o.page.click("#send");
  await o.page.waitForTimeout(500);
  await saveBack(o.page, dump);
  check("the page writes one batch per agent", label === "Send to 2 agents (4)" && readDb(dump).get("batches").size === 5 && o.errors.length === 0 && o.requests.length === 0,
    label + " " + o.errors.join(" | "));
  await o.ctx.close();

  // 3. read
  const r = sh("read", "--dump", dump);
  const mine = r.filter((l) => !l.startsWith("batch b20260103"));
  const newId = (r.find((l) => l.startsWith("batch ") && !l.startsWith("batch b20260103")) || "").split("  ")[0].slice(6);
  check("read prints the new batch of the default agent, one line per answer",
    mine.includes("  disk-size  \"Yes\"  \"\"") && mine.includes("  cam-firmware  \"Done in part, see note\"  \"Camera 2 is offline.\"") &&
    mine.some((l) => /^ {2}note n\S+  "Thanks\."$/.test(l)) && !r.join("\n").includes("Grow the disk"), r.join(" | "));
  const rb = sh("read", "--dump", dump, "--agent", "net-agent");
  check("read --agent prints the batch of that agent", rb.includes("  vlan-plan  \"No\"  \"\""), rb.join(" | "));

  // 4. ack
  apply(dump, sh("ack", newId, "--dump", dump, "--close", "disk-size"));
  rb.filter((l) => l.startsWith("batch ")).forEach((l) => apply(dump, sh("ack", l.split("  ")[0].slice(6), "--dump", dump)));
  const after = sh("read", "--dump", dump);
  check("after ack, read leaves the batch out and the card is closed",
    !after.some((l) => l.startsWith("batch " + newId)) && readDb(dump).get("items").get("disk-size").data.status === "closed", after.join(" | "));
  const o2 = await openPage(browser, seedOf(dump), pageFile);
  await o2.page.waitForTimeout(500);
  const last = await o2.page.textContent("#lastbatch"), gone = await o2.page.locator("[data-item=disk-size]").count();
  check("the page shows the batch handled and hides the closed card", gone === 0 && /handled/.test(last) && !/not handled/.test(last), last);
  await o2.ctx.close();

  // 5. purge
  const p = sh("purge", "--ids", "disk-size", "--dump", dump);
  apply(dump, p);
  const db = readDb(dump), keep = (p[0].split("Copies: ")[1] || "").trim();
  check("purge deletes the card and its response, and keeps a copy on disk",
    !db.get("items").has("disk-size") && !db.get("responses").has("disk-size") && fs.existsSync(path.join(keep, "items", "disk-size.json")), p[0]);
  const ch = sh("check", "--dump", dump);
  check("check passes on the database after the run", !ch.some((l) => l.startsWith("problem:")), ch.join(" | "));
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? failed + " step(s) failed" : "all steps passed");
process.exit(failed ? 1 : 0);
