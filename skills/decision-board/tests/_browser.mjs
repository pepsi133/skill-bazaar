// Shared parts of the browser checks. Not a test itself.
// loadPlaywright finds Playwright; openPage loads a board page in a phone-sized Chromium context
// with an in-memory stub in place of the database.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

// Find Playwright: a normal install first, then the package that "npx -p playwright" put on PATH.
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ["playwright"].concat((process.env.PATH || "").split(path.delimiter)
    .filter((d) => d.endsWith(path.join("node_modules", ".bin")))
    .map((d) => path.join(d, "..", "playwright")));
  for (const t of tries) { try { return require(t); } catch (e) { /* try the next one */ } }
  return null;
}

// In-memory stub of the calls that the page makes on window.claude.use("db"). seed.__delay holds a delay in ms
// per collection for snapshots. window.__db.hold = <collection> holds the next get() of it, with the data of that moment.
export function stub(seedData) {
  const cols = new Map(), subs = [];
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  Object.keys(seedData).filter((n) => n !== "__delay").forEach((n) => seedData[n].forEach((d) => col(n).set(d.id, JSON.parse(JSON.stringify(d)))));
  const dsnap = (n, id) => { const d = col(n).get(id); return { id, exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) }; };
  const qsnap = (n, pred) => ({ docs: Array.from(col(n).keys()).map((id) => dsnap(n, id)).filter((d) => !pred || pred(d.data())) });
  const fire = (n) => setTimeout(() => subs.filter((s) => s.n === n).forEach((s) => s.cb(s.id ? dsnap(n, s.id) : qsnap(n))), (seedData.__delay || {})[n] || 0);
  const split = (p) => { const i = p.indexOf("/"); return [p.slice(0, i), p.slice(i + 1)]; };
  window.__db = { cols, writes: [], fire, hold: null, held: [] };
  const db = {
    collection: (n) => ({
      get: () => {
        const snap = qsnap(n);
        if (window.__db.hold === n) return new Promise((res) => window.__db.held.push(() => res(snap)));
        return Promise.resolve(snap);
      },
      onSnapshot: (cb) => { subs.push({ n, cb }); fire(n); return () => {}; },
    }),
    doc: (p) => {
      const [n, id] = split(p);
      const write = (op, fn) => { window.__db.writes.push(op + " " + p); fn(); fire(n); return Promise.resolve(); };
      return {
        get: () => Promise.resolve(dsnap(n, id)),
        onSnapshot: (cb) => { subs.push({ n, id, cb }); fire(n); return () => {}; },
        set: (d) => write("set", () => col(n).set(id, JSON.parse(JSON.stringify(d)))),
        update: (d) => write("update", () => col(n).set(id, Object.assign({}, col(n).get(id), JSON.parse(JSON.stringify(d))))),
        delete: () => write("delete", () => col(n).delete(id)),
      };
    },
  };
  window.claude = { use: (name) => (name === "db" ? Promise.resolve(db) : Promise.reject(new Error("no " + name))) };
}

export const htmlOf = (file) => "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body>" +
  readFileSync(file, "utf8") + "</body></html>";

// Open the page in a phone-sized context. The test origin serves the page; every other request is
// recorded and aborted, so a sanitizer gap shows as a recorded request, and nothing leaves the machine.
export const ORIGIN = "http://board.invalid/";
export async function openPage(browser, seedData, file) {
  const body = htmlOf(file);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  ctx.on("request", (r) => { if (!r.url().startsWith(ORIGIN)) requests.push(r.url()); });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(ORIGIN) ? r.fulfill({ contentType: "text/html; charset=utf-8", body }) : r.abort()));
  await page.addInitScript("window.__x = []; (" + stub.toString() + ")(" + JSON.stringify(seedData) + ")");
  await page.goto(ORIGIN);
  return { ctx, page, errors, requests };
}
