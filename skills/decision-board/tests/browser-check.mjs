// Optional browser check of the board page. It needs Playwright for node and a Chromium build.
// Run: npx -y -p playwright node browser-check.mjs [path of board.html]
// Pin the version that matches an installed Chromium build, for example -p playwright@1.63.0.
// Without Playwright or Chromium the script prints SKIP and exits with 2.
// The page talks to an in-memory stub of the database. The script contacts no real board.
// It prints one PASS or FAIL line per check and exits with 1 when a check fails.
// Part 1 loads data without meta/config, as an older board has it. Part 2 loads a board with a
// config, a revised card, cards from two agents and a reference guide with hostile HTML. Part 3
// loads guides that try to load from another host, run script or cover the page. Part 4 loads data
// that an agent or a second device wrote, and checks the features of 0.3.0. Part 5 checks the config
// list domains for url() and non-link href values.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright, openPage as open } from "./_browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageFile = path.resolve(process.argv[2] || path.join(here, "..", "assets", "board.html"));
const openPage = (browser, seedData, file) => open(browser, seedData, file || pageFile);
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
      body: "### Records\nBefore: nothing is set\n\n1. Open the DNS panel of `docs.invalid`.\n2. Add this record:\n```\ndocs.invalid. 3600 IN TXT \"v=spf1 -all\"\n```\n3. Save the zone.\n\n- A bullet with **bold** text\n\n<script>window.__xss = 1</script>" },
  ],
  responses: [], notes: [],
  batches: [{ id: "b20260101T090000Z-ab12", created: "2026-01-01T09:00:00Z", itemIds: ["old-one", "old-two"], noteIds: [], status: "delivered", delivered_at: "2026-01-01T09:05:00Z" }],
  meta: [{ id: "board", title: "Check board", updated: T }],
};

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " (" + detail + ")" : ""));
}
// Where the card sits: its top must be below the sticky header and inside the viewport.
const place = (page, id) => page.evaluate((cid) => {
  const el = document.querySelector("[data-item=\"" + cid + "\"]"), hd = document.querySelector("header.bar");
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), header: Math.round(hd.getBoundingClientRect().bottom), vh: window.innerHeight, flash: el.classList.contains("flash") };
}, id);
const inView = (p) => !!p && p.top >= p.header && p.top < p.vh * 0.6;
const show = (p) => (p ? "card top " + p.top + ", header bottom " + p.header + ", viewport " + p.vh : "card not in the page");


// ---- part 2: a board set up by meta/config.
const hostile = [
  "<h3>Site</h3><table><tr><th>Port</th><td id=\"p1\">ether1</td></tr></table>",
  "<svg viewBox=\"0 0 40 20\" width=\"40\" onload=\"window.__xss = 2\"><defs><circle id=\"dot\" r=\"3\"/></defs>",
  "<use href=\"#dot\" x=\"5\" y=\"5\"/><use href=\"https://evil.invalid/x.svg#a\"/><use xlink:href=\"data:image/svg+xml,x#a\"/>",
  "<rect width=\"10\" height=\"10\" fill=\"url(#dot)\" style=\"fill: url(https://evil.invalid/x)\"/>",
  "<foreignObject><div onclick=\"window.__xss = 3\">fo</div></foreignObject><script>window.__xss = 4</script><style>body{display:none}</style></svg>",
  "<p onclick=\"window.__xss = 5\" style=\"color: red\">Kept text <a href=\"javascript:window.__xss = 6\">bad link</a> ",
  "<a href=\"java&#x09;script:window.__xss = 7\">tab link</a> <a href=\"https://docs.invalid/doc\">good link</a> <a href=\"#p1\">frag</a> <a href=\"notes.html\">rel</a></p>",
  "<iframe src=\"https://evil.invalid\"></iframe><object data=\"x\"></object><embed src=\"x\"><img src=\"x\" onerror=\"window.__xss = 8\">",
  "<div style=\"width: expression(alert(1))\">expr</div><div style=\"background: url(javascript:alert(1))\">bg</div><form><input name=\"send\"></form>",
].join("");
const seed2 = {
  meta: [{ id: "board", title: "Header title", updated: T }, { id: "config", title: "Config board", agent: "Coordinator",
    tabs: [{ id: "net", label: "Network", match: { area: ["router", "wifi"] } }, { id: "agentb", label: "Agent B", match: { from: ["agent-b"] } },
      { id: "rest", label: "Rest", rest: true }],
    kinds: [{ id: "decision", label: "Decision" }, { id: "action", label: "Action" }, { id: "info", label: "Digest" }],
    priorities: [{ id: "p1", label: "P1" }, { id: "p2", label: "P2" }],
    labels: ["Was", "Is"] }],
  items: [
    item("router-one", "router", "p1", { area: "router", summary: "Was: old\nIs: new" }),
    item("wifi-one", "", "p2", { area: "wifi", rev: 2, options: ["Yes", "No", "Later"], kind: "info" }),
    item("b-one", "", "p1", { area: "mail", from: "agent-b" }),
    item("misc-one", "", "p2", { area: "misc" }),
  ],
  responses: [{ id: "wifi-one", itemId: "wifi-one", choice: "Yes", note: "", rev: 1, updated: T, sent: true, batch: "b20260101T090000Z-ab12" }],
  notes: [], batches: [],
  guides: [{ id: "site-ref", kind: "reference", title: "Site record", status: "active", created: T, updated: T, body: hostile }],
};
async function part2(browser) {
  const { ctx, page, errors, requests } = await openPage(browser, seed2);
  await page.waitForSelector("#cards .card");
  await page.waitForTimeout(200);

  // Config: title, tabs, kinds, priorities, labels, agent name.
  const tabs = await page.$$eval("#tabs .tab", (bs) => bs.map((b) => b.getAttribute("data-tab") + "=" + b.querySelector(".tl").textContent + (b.querySelector(".n") ? ":" + b.querySelector(".n").textContent : "")));
  check("config sets the tabs in order, with counts", tabs.join(" ") === "all=All:4 net=Network:2 agentb=Agent B:1 rest=Rest:1 guide:site-ref=Site record", tabs.join(" "));
  check("config sets the title over meta/board", (await page.textContent("#ttl")) === "Config board");
  await page.tap("#tabs [data-tab=net]");
  const net = await page.$$eval("#cards .card", (cs) => cs.map((c) => c.dataset.item));
  check("a tab matched on area shows its cards", net.join() === "router-one,wifi-one", net.join());
  await page.tap("#tabs [data-tab=agentb]");
  check("a tab matched on from shows the card of that agent", (await page.$$eval("#cards .card", (cs) => cs.map((c) => c.dataset.item))).join() === "b-one");
  await page.tap("#tabs [data-tab=all]");
  check("config priorities label the tags", (await page.textContent("[data-item=router-one] .tag.now")) === "P1");
  check("a non-default kind shows its label", (await page.textContent("[data-item=wifi-one] .tags")).includes("Digest"));
  check("config section labels are bold", (await page.innerHTML("[data-item=router-one] .summary")).includes("<strong>Was:</strong> old<br><strong>Is:</strong> new"));
  check("the card shows the posting agent", (await page.textContent("[data-item=b-one] .tags")).includes("from agent-b"));

  // A revised card: rev 2, answered at rev 1, sent. Hide answered is on, the card still shows.
  check("a card revised after a sent answer shows, marked changed",
    (await page.locator("[data-item=wifi-one] .changed:visible").count()) === 1 && (await page.textContent("[data-item=wifi-one] .tags")).includes("changed"),
    (await page.textContent("[data-item=wifi-one] .changed")).trim());
  await page.tap("[data-item=wifi-one] label.opt:has-text(\"No\")");
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => window.__db.cols.get("responses").get("wifi-one"));
  check("answering again records the new rev and keeps the earlier answer in history",
    r.choice === "No" && r.rev === 2 && r.sent === false && Array.isArray(r.history) && r.history.length === 1 && r.history[0].choice === "Yes" && r.history[0].rev === 1,
    JSON.stringify(r));
  check("after the new answer the card no longer shows changed", (await page.locator("[data-item=wifi-one] .changed:visible").count()) === 0);

  // Answers for two agents and a note: one batch each.
  await page.tap("[data-item=b-one] label.opt:has-text(\"Yes\")");
  await page.tap("[data-item=router-one] label.opt:has-text(\"No\")");
  await page.fill("#newnote", "A free note");
  await page.tap("#addnote");
  await page.waitForTimeout(300);
  const label = (await page.textContent("#send")).trim();
  check("the send button names the number of agents", label === "Send to 2 agents (4)", label);
  await page.tap("#send");
  await page.waitForTimeout(500);
  const bs = await page.evaluate(() => Array.from(window.__db.cols.get("batches").values()));
  const byFor = {};
  bs.forEach((b) => { byFor[b.for] = b; });
  const resp = await page.evaluate(() => Object.fromEntries(Array.from(window.__db.cols.get("responses").entries())));
  check("the send writes one batch per agent", bs.length === 2 && !!byFor["agent-b"] && !!byFor[""], JSON.stringify(bs.map((b) => [b.for, b.itemIds, b.noteIds])));
  check("each batch holds only the answers of its agent, the note goes to the default agent",
    JSON.stringify(byFor["agent-b"] && byFor["agent-b"].itemIds) === "[\"b-one\"]" &&
    JSON.stringify((byFor[""] && byFor[""].itemIds || []).slice().sort()) === "[\"router-one\",\"wifi-one\"]" &&
    (byFor[""] && byFor[""].noteIds.length) === 1 && byFor["agent-b"].noteIds.length === 0);
  check("each response carries the id of its own batch",
    resp["b-one"].batch === byFor["agent-b"].id && resp["router-one"].batch === byFor[""].id && resp["wifi-one"].batch === byFor[""].id);
  check("each batch carries a copy of its answers and notes",
    JSON.stringify(byFor["agent-b"].answers) === JSON.stringify({ "b-one": { answer: "Yes", note: "", rev: 1 } }) &&
    byFor[""].answers["wifi-one"].answer === "No" && byFor[""].answers["wifi-one"].rev === 2 &&
    Object.values(byFor[""].notes).map((n) => n.text).join() === "A free note", JSON.stringify(byFor[""].answers));

  // The reference guide: allowed content stays, hostile content is gone.
  // Hostile CSS can hide the page, so wait for the guide in the DOM, not for it to be visible.
  await page.evaluate(() => document.querySelector("#tabs [data-tab=\"guide:site-ref\"]").click());
  await page.waitForSelector("#guide:not([hidden])", { state: "attached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  const g = await page.evaluate(() => {
    const box = document.querySelector("#guide .gbody");
    const all = Array.from(box.querySelectorAll("*"));
    return {
      flag: window.__xss,
      bad: all.filter((e) => /^(script|style|iframe|object|embed|foreignobject|img|form|input)$/i.test(e.localName)).map((e) => e.localName),
      on: all.filter((e) => Array.from(e.attributes).some((a) => /^on/i.test(a.name))).length,
      styleUrl: all.filter((e) => /url\(|expression/i.test(e.getAttribute("style") || "")).length,
      hrefs: all.map((e) => e.getAttribute("href") || e.getAttribute("xlink:href")).filter((v) => v != null),
      uses: Array.from(box.querySelectorAll("use")).map((u) => u.getAttribute("href")),
      fill: (box.querySelector("rect") || { getAttribute: () => null }).getAttribute("fill"),
      table: box.querySelectorAll("table td").length, circle: box.querySelectorAll("svg circle").length,
      text: box.textContent, pStyle: (box.querySelector("p") || { getAttribute: () => null }).getAttribute("style"),
      sendIsButton: document.getElementById("send").tagName, ids: all.map((e) => e.id).filter(Boolean),
    };
  });
  check("the reference guide keeps the table, the SVG and the text", g.table === 1 && g.circle === 1 && g.text.includes("Kept text") && g.text.includes("good link"), JSON.stringify({ table: g.table, circle: g.circle }));
  check("the sanitizer removed script, style, iframe, object, embed, foreignObject, img and form", g.bad.length === 0 && !g.text.includes("fo") && g.flag === undefined, "left: " + g.bad.join(",") + ", flag " + g.flag);
  check("the sanitizer removed every on* attribute and every style with url( or expression", g.on === 0 && g.styleUrl === 0 && g.pStyle === "color: red", "on " + g.on + ", style " + g.styleUrl);
  check("only https:, # and relative links remain, ids get the ref- prefix",
    JSON.stringify(g.hrefs) === JSON.stringify(["#ref-dot", "https://docs.invalid/doc", "#ref-p1", "notes.html"]) && JSON.stringify(g.ids) === JSON.stringify(["ref-p1", "ref-dot"]),
    JSON.stringify(g.hrefs) + " ids " + JSON.stringify(g.ids));
  check("a use with an external href is gone, a local use stays, url(#id) gets the ref- prefix", JSON.stringify(g.uses) === "[\"#ref-dot\"]" && g.fill === "url(#ref-dot)", JSON.stringify(g.uses) + " fill " + g.fill);
  check("the page controls are intact", g.sendIsButton === "BUTTON" && (await page.locator("#guide .garchive").count()) === 1);
  check("part 2 raised no script error", errors.length === 0, errors.join(" | "));
  check("part 2 loaded nothing from the network", requests.length === 0, requests.join(" "));
  await ctx.close();
}

// ---- part 3: hostile reference guides. Each payload must load nothing, run nothing and cover nothing.
const E = "https://evil.invalid/";
const X = (n) => "window.__x.push(" + n + ")";
const PAYLOADS = {
  imageSet: `<div style="width:50px;height:50px;background-image:image-set('${E}imageset.png' 1x)">is</div>`,
  webkitImageSet: `<div style="width:50px;height:50px;background-image:-webkit-image-set('${E}wimageset.png' 1x)">wis</div>`,
  cursorSet: `<div style="cursor:image-set('${E}cursor.png' 1x), auto;width:300px;height:300px">cur</div>`,
  listStyle: `<ul style="list-style-image:image-set('${E}list.png' 1x)"><li>li</li></ul>`,
  borderImg: `<div style="border:10px solid;border-image-source:image-set('${E}border.png' 1x)">bi</div>`,
  maskImg: `<div style="width:50px;height:50px;-webkit-mask-image:image-set('${E}mask.png' 1x)">mi</div>`,
  styleEsc: `<div style="width:40px;height:40px;background:u\\72 l(${E}esc.png)">esc</div>`,
  styleComment: `<div style="width:40px;height:40px;background:u/**/rl(${E}comment.png)">cm</div>`,
  fillPlain: `<svg width="50" height="50"><rect width="50" height="50" fill="url(${E}fillplain.svg#p)"/></svg>`,
  fillEsc: `<svg width="50" height="50"><rect width="50" height="50" fill="\\75 rl('${E}fill.svg#p')"/></svg>`,
  clipEsc: `<svg width="50" height="50"><rect width="50" height="50" clip-path="\\75 rl('${E}clip.svg#c')"/></svg>`,
  markerEsc: `<svg width="50" height="50"><line x1="0" y1="0" x2="40" y2="40" stroke="black" marker-start="\\75 rl('${E}marker.svg#m')"/></svg>`,
  fillEntity: `<svg width="50" height="50"><rect width="50" height="50" fill="&#117;rl('${E}entfill.svg#p')"/></svg>`,
  fillUpper: `<svg width="50" height="50"><rect width="50" height="50" fill="URL('${E}upper.svg#p')"/></svg>`,
  gradHref: `<svg width="50" height="50"><defs><linearGradient id="g" href="${E}grad.svg#g"/></defs><rect width="50" height="50"/></svg>`,
  useOdd: `<svg><use href="${E}use.svg#a"/><use href="//evil.invalid/use2.svg#a"/></svg>`,
  svgImage: `<svg><image href="${E}image.png" width="10" height="10"/></svg>`,
  animate: `<svg><a href="#a"><animate attributeName="href" to="javascript:${X(1)}" begin="0s" fill="freeze"/><text y="10">anim</text></a></svg>`,
  jsEnt: `<a href="&#106;&#x61;vascript&colon;${X(2)}">ent</a><a href="java\u0000script:${X(3)}">nul</a>`,
  links: `<a href="//evil.invalid/protorel">protorel</a><a href="https:\\\\evil.invalid\\bs">bs</a><a href="/ok">abs</a><a href="https://docs.invalid/">ok</a>`,
  svgLink: `<svg><a href="#x"><text y="10">frag</text></a></svg><span href="https://evil.invalid/">span</span>`,
  noscript: `<noscript><p title="</noscript><img src=x onerror=${X(4)}>"></p></noscript>`,
  base: `<base href="${E}"><meta http-equiv="refresh" content="0;url=${E}meta"><title>Hijacked title</title>`,
  overlay: `<a href="${E}overlay" style="position:fixed;inset:0;z-index:2147483647;opacity:0;pointer-events:auto;transform:none;top:0;left:0">o</a>` +
    `<div style="margin-top:-400px;height:900px;width:900px;background-color:red">cover</div>`,
};
async function part3(browser) {
  const ids = Object.keys(PAYLOADS);
  const seed3 = { items: [{ id: "q", title: "Q?", options: ["Yes"], status: "open", priority: "now", created: T, updated: T }],
    responses: [{ id: "q", itemId: "q", choice: "Yes", note: "", rev: 1, sent: false, batch: "", updated: T }], notes: [], batches: [], meta: [],
    guides: ids.map((id, i) => ({ id, kind: "reference", title: id, status: "active", created: String(1000 + i), updated: T, body: PAYLOADS[id] })) };
  const { ctx, page, errors, requests } = await openPage(browser, seed3);
  await page.waitForSelector("#tabs [data-tab^=\"guide:\"]", { state: "attached" });
  const leaks = [], covered = [], badLinks = [];
  for (const id of ids) {
    const before = requests.length;
    await page.evaluate((k) => document.querySelector("#tabs [data-tab=\"guide:" + k + "\"]").click(), id);
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const s = document.getElementById("send").getBoundingClientRect(), b = document.querySelector("#guide .gbody");
      const links = Array.from(b.querySelectorAll("[href]")).map((e) => [e.localName, e.getAttribute("href")]);
      return { hit: (document.elementFromPoint(s.x + s.width / 2, s.y + s.height / 2) || {}).id, links };
    });
    if (requests.length > before) leaks.push(id + ": " + requests.slice(before).join(" "));
    if (r.hit !== "send") covered.push(id + " covers Send with " + r.hit);
    const okA = (v) => !/\\/.test(v) && !/^\/\//.test(v) && (/^https?:\/\//i.test(v) || !/^[a-z][a-z0-9+.-]*:/i.test(v));
    r.links.forEach(([tag, v]) => { if (tag === "a" ? !okA(v) : v.charAt(0) !== "#") badLinks.push(id + ": " + tag + " " + v); });
  }
  await page.tap("#send", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ flags: window.__x, title: document.title, batches: window.__db.cols.get("batches") ? window.__db.cols.get("batches").size : 0 }));
  check("hostile guides load nothing from another host", leaks.length === 0 && requests.length === 0, leaks.join(" | "));
  check("hostile guides cannot cover the Send button", covered.length === 0, covered.join(" | "));
  const box = await page.evaluate(() => { const st = getComputedStyle(document.querySelector("#guide .gbody.ref")); return [st.contain, st.position, st.overflow, st.isolation].join(" "); });
  check("a reference guide paints only inside its own box", /paint/.test(box) && / relative hidden isolate$/.test(box), box);
  check("links: http(s), # and relative on <a> only, never //host or a backslash; # targets elsewhere", badLinks.length === 0, badLinks.join(" | "));
  check("hostile guides run no script and keep the page title", after.flags.length === 0 && after.title === "Decision board" && errors.length === 0,
    JSON.stringify(after.flags) + " " + after.title + " " + errors.join(" | "));
  check("a tap on Send after the hostile guides sends", after.batches === 1);
  await page.evaluate(() => document.querySelector("#tabs [data-tab=\"guide:overlay\"]").click());
  await page.waitForTimeout(100);
  const ov = await page.evaluate(() => ({ style: (document.querySelector("#guide .gbody div") || {}).getAttribute("style"), a: (document.querySelector("#guide .gbody a") || {}).getAttribute("style") }));
  check("the style allowlist keeps plain properties and drops position, inset, z-index, opacity, pointer-events, transform",
    ov.style === "height: 900px; width: 900px; background-color: red" && ov.a === null, JSON.stringify(ov));
  await ctx.close();
}

// ---- part 5: the config list domains. A url() or a non-link href to a listed https: host stays,
// every other host goes. The route aborts every request, so a listed URL loads nothing either.
const L = "https://assets.invalid/";
const DOMAIN_CASES = {
  listed: [`fill="url(${L}a.svg#g)"`, `url(${L}a.svg#g)`],
  sub: [`fill="url(https://img.assets.invalid/b.svg#g)"`, "url(https://img.assets.invalid/b.svg#g)"],
  quoted: [`fill="url('${L}c.svg#g')"`, `url(${L}c.svg#g)`],
  suffix: [`fill="url(https://assets.invalid.evil.invalid/d.svg#g)"`, null],
  prefix: [`fill="url(https://xassets.invalid/e.svg#g)"`, null],
  plainHttp: [`fill="url(http://assets.invalid/f.svg#g)"`, null],
  userinfo: [`fill="url(https://u@assets.invalid/g.svg#g)"`, null],
  mixed: [`fill="url(${L}h.svg#g) url(https://evil.invalid/h.svg#g)"`, null],
  comment: [`fill="u/**/rl(${L}i.svg#g)"`, null],
  frag: [`fill="url(#grad)"`, "url(#ref-grad)"],
};
async function part5(browser) {
  const body = Object.keys(DOMAIN_CASES).map((k) => `<svg width="10" height="10"><rect id="${k}" width="10" height="10" ${DOMAIN_CASES[k][0]}/></svg>`).join("") +
    `<svg><use href="${L}u.svg#a"/><use href="https://evil.invalid/u.svg#a"/></svg><p style="color: red; fill: url(${L}s.svg#s)">s</p>`;
  const seed5 = { items: [], responses: [], notes: [], batches: [],
    meta: [{ id: "config", domains: ["Assets.Invalid", "bad host!", 7] }],
    guides: [{ id: "dom", kind: "reference", title: "dom", status: "active", created: T, updated: T, body }] };
  const { ctx, page, errors, requests } = await openPage(browser, seed5);
  await page.waitForSelector("#tabs [data-tab=\"guide:dom\"]", { state: "attached" });
  await page.evaluate(() => document.querySelector("#tabs [data-tab=\"guide:dom\"]").click());
  await page.waitForTimeout(200);
  const got = await page.evaluate((ids) => {
    const b = document.querySelector("#guide .gbody"), o = {};
    ids.forEach((k) => { const r = b.querySelector("#ref-" + k); o[k] = r ? r.getAttribute("fill") : "missing"; });
    o.uses = Array.from(b.querySelectorAll("use")).map((u) => u.getAttribute("href"));
    o.style = (b.querySelector("p") || { getAttribute: () => null }).getAttribute("style");
    return o;
  }, Object.keys(DOMAIN_CASES));
  const wrong = Object.keys(DOMAIN_CASES).filter((k) => got[k] !== DOMAIN_CASES[k][1]).map((k) => k + "=" + got[k]);
  check("domains: a listed host and its subdomains stay, by https: only; every other url() goes", wrong.length === 0, wrong.join(" | "));
  check("domains: a use keeps a listed host and loses another", JSON.stringify(got.uses) === JSON.stringify([L + "u.svg#a"]), JSON.stringify(got.uses));
  check("domains: a style keeps a listed url()", got.style === "color: red; fill: url(" + L + "s.svg#s)", got.style);
  check("domains: no request to a host off the list", requests.every((r) => /^https:\/\/([a-z0-9-]+\.)?assets\.invalid\//.test(r)), requests.join(" "));
  check("domains: the page raised no script error", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---- part 4: data that an agent or a second device wrote, and the features of 0.3.0.
const it4 = (id, x) => Object.assign({ id, area: "infra", title: "Q " + id, summary: "s", options: ["Yes", "No"], recommendation: "Yes", priority: "now", status: "open", created: T, updated: T }, x || {});
const empty4 = () => ({ items: [], responses: [], notes: [], batches: [], guides: [], meta: [], acks: [] });
const C = (id) => "[data-item=\"" + id + "\"]";
const colOf = (page, n) => page.evaluate((c) => Array.from(window.__db.cols.get(c) ? window.__db.cols.get(c).values() : []), n);
const docOf = (page, n, id) => page.evaluate(([c, i]) => (window.__db.cols.get(c) || new Map()).get(i), [n, id]);
const dbset = (page, n, id, d) => page.evaluate(([c, i, x]) => { if (!window.__db.cols.has(c)) window.__db.cols.set(c, new Map()); window.__db.cols.get(c).set(i, x); window.__db.fire(c); }, [n, id, d]);
const pick = async (page, id, opt) => { await page.locator(C(id) + " label.opt", { hasText: opt }).first().click(); await page.waitForTimeout(150); };
const sendNow = async (page) => { await page.click("#send"); await page.waitForTimeout(400); };
async function scenario(browser, name, seedData, fn) {
  const o = await openPage(browser, Object.assign(empty4(), seedData));
  await o.page.waitForTimeout(300);
  try { await fn(o.page, o); } catch (e) { check(name + " ran to the end", false, String(e.message).split("\n")[0]); }
  if (o.errors.length) check(name + " raised no script error", false, o.errors.join(" | "));
  await o.ctx.close();
}
async function part4(browser) {
  await scenario(browser, "ids a.b and a_b", { items: [it4("a.b", { title: "First" }), it4("a_b", { title: "Second" })] }, async (page) => {
    await pick(page, "a.b", "Yes"); await pick(page, "a_b", "No");
    await page.locator(C("a.b") + " textarea").fill("note"); await page.waitForTimeout(1000);
    const r = (await colOf(page, "responses")).map((x) => x.itemId + "=" + x.choice + "/" + x.note).sort().join(" ");
    check("two item ids with one DOM-safe form keep their own answers", r === "a.b=Yes/note a_b=No/", r);
  });
  await scenario(browser, "forged responses", {
    items: [it4("x"), it4("y", { status: "closed", from: "agent-b", title: "Deploy?" })],
    responses: [{ id: "y", itemId: "y", choice: "Approve", note: "", sent: false, batch: "", rev: 1, updated: T },
      { id: "ghost", itemId: "ghost", choice: "Yes", note: "rm ok", sent: false, batch: "", updated: T }] }, async (page) => {
    await pick(page, "x", "Yes");
    const label = (await page.textContent("#send")).trim();
    await sendNow(page);
    const b = (await colOf(page, "batches")).map((x) => [x.for, x.itemIds]);
    check("Send leaves out answers for closed and missing cards", JSON.stringify(b) === "[[\"\",[\"x\"]]]" && label === "Send to Claude (1)", label + " " + JSON.stringify(b));
  });
  await scenario(browser, "from changed after the answer", { items: [it4("z", { from: "agent-a" })] }, async (page) => {
    await pick(page, "z", "Yes");
    await dbset(page, "items", "z", Object.assign(await docOf(page, "items", "z"), { from: "agent-evil" }));
    await page.waitForTimeout(200);
    await sendNow(page);
    const b = (await colOf(page, "batches")).map((x) => [x.for, x.itemIds]);
    check("an answer goes to the agent of the card at the time of the answer", JSON.stringify(b) === "[[\"agent-a\",[\"z\"]]]", JSON.stringify(b));
  });
  await scenario(browser, "send before the items load", { __delay: { items: 1500 }, items: [it4("m", { from: "agent-b" })],
    responses: [{ id: "m", itemId: "m", choice: "Yes", note: "", rev: 1, for: "agent-b", sent: false, batch: "", updated: T }] }, async (page) => {
    const early = await page.isDisabled("#send");
    await page.click("#send", { force: true }); await page.waitForTimeout(200);
    const none = (await colOf(page, "batches")).length;
    await page.waitForTimeout(1500);
    check("Send is disabled until the items have loaded", early && none === 0 && !(await page.isDisabled("#send")), "early disabled " + early + ", batches " + none);
  });
  await scenario(browser, "re-answer after a send", { items: [it4("r")] }, async (page) => {
    await pick(page, "r", "Yes"); await sendNow(page);
    const b = (await colOf(page, "batches"))[0];
    await page.click("#f-hide"); await page.waitForTimeout(150);
    await pick(page, "r", "No");
    const b2 = await docOf(page, "batches", b.id), r = await docOf(page, "responses", "r");
    check("a re-answer leaves the sent batch intact; the response keeps the sent answer in history",
      b2.answers.r.answer === "Yes" && r.choice === "No" && r.history.length === 1 && r.history[0].batch === b.id, JSON.stringify([b2.answers, r]));
  });
  await scenario(browser, "stale refresh", { items: [it4("w", { rev: 2 })],
    responses: [{ id: "w", itemId: "w", choice: "Yes", note: "", rev: 1, sent: true, batch: "b1", updated: T }] }, async (page) => {
    await page.evaluate(() => { window.__db.hold = "responses"; window.dispatchEvent(new Event("focus")); });
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.__db.hold = null; });
    await pick(page, "w", "No");
    await sendNow(page);
    await page.evaluate(() => { window.__db.held.splice(0).forEach((f) => f()); });
    await page.waitForTimeout(200);
    const state = await page.evaluate((s) => { const c = document.querySelector(s); return c ? c.querySelector(".tags").textContent : "hidden"; }, C("w"));
    await page.click("#f-hide"); await page.waitForTimeout(150);
    await pick(page, "w", "Yes");
    const r = await docOf(page, "responses", "w");
    check("a late refresh does not undo a send; history keeps every sent answer",
      !/unsent|changed/.test(state) && JSON.stringify((r.history || []).map((x) => x.choice)) === "[\"Yes\",\"No\"]", state + " " + JSON.stringify(r.history));
  });
  await scenario(browser, "re-confirm on a changed card", { items: [it4("c", { rev: 2 })],
    responses: [{ id: "c", itemId: "c", choice: "Yes", note: "", rev: 1, sent: true, batch: "b1", updated: T }] }, async (page) => {
    await pick(page, "c", "Yes");
    const r = await docOf(page, "responses", "c");
    check("a tap on the checked option of a changed card is a new answer at the new rev",
      r.rev === 2 && r.sent === false && (await page.locator(C("c") + " .changed:visible").count()) === 0 && (await page.textContent("#c-unsent")) === "1", JSON.stringify(r));
    await pick(page, "c", "Yes");
    check("a second tap on the same option writes nothing", (await page.evaluate(() => window.__db.writes.length)) === 1);
  });
  await scenario(browser, "agent names", {
    meta: [{ id: "config", agent: "Claude", tabs: [{ id: "b", label: "B", match: { from: ["agent-b"] } }] }],
    items: [it4("k1", { from: "Agent-B" }), it4("k2", { from: "agent-b " }), it4("k3", { from: "claude" }), it4("k4")] }, async (page) => {
    for (const id of ["k1", "k2", "k3", "k4"]) await pick(page, id, "Yes");
    const tab = await page.textContent("#tabs [data-tab=b] .n");
    await sendNow(page);
    const b = (await colOf(page, "batches")).map((x) => x.for + ":" + x.itemIds.slice().sort().join(",")).sort().join(" ");
    check("agent names match after trim and lower case; the configured name is the default agent", b === ":k3,k4 agent-b:k1,k2" && tab === "2", b + " tab " + tab);
  });
  await scenario(browser, "draft for an older rev", { items: [it4("d")] }, async (page) => {
    await pick(page, "d", "Yes");
    await dbset(page, "items", "d", Object.assign(await docOf(page, "items", "d"), { rev: 2, summary: "new text" }));
    await page.waitForTimeout(200);
    const st = await page.textContent(C("d") + " .tags"), label = (await page.textContent("#send")).trim();
    check("a draft for an older rev is not sent and the card shows changed", st.includes("changed") && label.endsWith("(0)") && (await page.isDisabled("#send")), st + " / " + label);
  });
  const bad = JSON.parse('{"toString":null}');
  await scenario(browser, "malformed values", {
    items: [it4("good"), Object.assign(it4("bad"), { title: bad, summary: bad, evidence: [1], options: [bad, "ok"], priority: bad, from: bad, rev: bad, kind: bad, blocks: bad, area: bad, source_file: bad, supersedes: bad, after: bad })],
    responses: [{ id: "bad", choice: bad, note: bad, rev: bad, history: bad, sent: "yes", updated: bad }],
    batches: [{ id: "bx", created: bad, for: bad, itemIds: "notarray", noteIds: bad, answers: bad, status: bad }],
    notes: [{ id: "nx", text: bad, created: bad, sent: false }],
    guides: [{ id: "gx", title: bad, body: bad, sections: bad, status: "active", created: bad, updated: bad, item: bad }],
    meta: [{ id: "board", title: bad }, { id: "config", title: bad, agent: bad, tabs: bad, kinds: [bad], priorities: bad, labels: bad }] }, async (page, o) => {
    await page.click("#f-hide"); await page.waitForTimeout(200);
    const cards = await page.$$eval("#cards .card", (cs) => cs.map((c) => c.dataset.item).sort().join());
    check("one malformed value does not blank the board", cards === "bad,good" && o.errors.length === 0, cards + " " + o.errors.join(" | "));
  });
  await scenario(browser, "a card that fails to render", { items: [it4("fine"), it4("boom", { summary: "BOOM" })] }, async (page) => {
    // Fault injection: make the render of one card throw.
    await page.evaluate(() => { const js = JSON.stringify; JSON.stringify = function (v) { if (Array.isArray(v) && v[0] === "BOOM") throw new Error("injected"); return js.apply(JSON, arguments); }; window.__db.fire("items"); });
    await page.waitForTimeout(200);
    const t = await page.$$eval("#cards .card", (cs) => cs.map((c) => c.dataset.item + "=" + (c.querySelector("h2") ? "ok" : c.textContent)).sort().join());
    check("a card that fails to render shows one line, the others render", t === "boom=Could not render boom,fine=ok", t);
  });
  await scenario(browser, "question to the agent", { items: [it4("q")] }, async (page) => {
    await page.locator(C("q") + " textarea").fill("Which disk?"); await page.locator(C("q") + " textarea").blur(); await page.waitForTimeout(300);
    await sendNow(page);
    const st = await page.textContent(C("q") + " .tags");
    await dbset(page, "items", "q", Object.assign(await docOf(page, "items", "q"), { rev: 2, summary: "The disk is sdb." }));
    await page.waitForTimeout(200);
    const st2 = await page.textContent(C("q") + " .tags");
    check("a note without an option stays visible as waiting on agent; a new rev shows it changed", st.includes("waiting on agent") && st2.includes("changed"), st + " / " + st2);
  });
  await scenario(browser, "supersedes, after, note about a card, acks", {
    items: [it4("old", { title: "Old question" }), it4("new", { title: "New question", supersedes: "old", from: "agent-b" }), it4("next", { title: "Next", after: "new" })],
    batches: [{ id: "b20260101T090000Z-ab12", created: "2026-01-01T09:00:00Z", for: "", itemIds: ["x"], noteIds: [], answers: {}, status: "new" }],
    acks: [{ id: "b20260101T090000Z-ab12", at: "2026-01-01T09:05:00Z", items: ["x"] }] }, async (page) => {
    const rel = await page.evaluate((s) => [s.map((x) => (document.querySelector(x + " .rel") || {}).textContent), document.querySelector(s[2]).classList.contains("wait")],
      [C("old"), C("new"), C("next")]);
    check("supersedes shows replaced by and replaces; after greys the card", rel[0][0] === "Replaced by: New question" && rel[0][1] === "Replaces: Old question" &&
      rel[0][2] === "Answer this one first: New question" && rel[1] === true, JSON.stringify(rel));
    check("an ack marks the batch handled", (await page.textContent("#lastbatch")).includes("handled") && !(await page.textContent("#lastbatch")).includes("not handled"));
    await page.click(C("new") + " .foot button:has-text(\"Free note about this card\")");
    await page.fill("#newnote", "Use the newer disk");
    await page.click("#addnote"); await page.waitForTimeout(300);
    const n = (await colOf(page, "notes"))[0];
    await pick(page, "new", "Yes");
    await sendNow(page);
    const b = (await colOf(page, "batches")).filter((x) => x.status === "new" && x.id !== "b20260101T090000Z-ab12");
    const greyed = await page.evaluate((s) => document.querySelector(s).classList.contains("wait"), C("next"));
    check("a note names its card and goes to the agent of that card", n.item === "new" && n.for === "agent-b" && b.length === 1 && b[0].for === "agent-b" &&
      b[0].notes[n.id].item === "new", JSON.stringify([n, b]));
    check("a sent answer releases the card that waits for it", greyed === false);
  });
  await scenario(browser, "status guide and sections", {
    guides: [{ id: "learn", title: "Learn: VLANs", status: "active", created: "1", updated: T, body: "text" },
      { id: "status", kind: "status", title: "Status", status: "active", created: "2", updated: "2026-01-02T10:00:00Z",
        sections: [{ id: "blocked-on-you", title: "Blocked on you", body: "- Approve the key", updated: "2026-01-02T10:00:00Z" }, { id: "done", title: "Done", body: "- Backup", updated: T }] }] }, async (page) => {
    const tabs = await page.$$eval("#tabs .tab.g", (bs) => bs.map((b) => b.getAttribute("data-tab") + (b.querySelector(".dot") ? "*" : "")));
    await page.click("#tabs [data-tab=\"guide:status\"]"); await page.waitForTimeout(150);
    const g = await page.evaluate(() => ({ secs: Array.from(document.querySelectorAll("#guide .gsec h3")).map((e) => e.textContent), upd: document.querySelectorAll("#guide .gsec .small").length,
      archive: document.querySelectorAll("#guide .garchive").length, mark: document.querySelector("#guide .tags").textContent.includes("changed since you looked") }));
    await page.click("#tabs [data-tab=all]"); await page.waitForTimeout(150);
    const dot = await page.locator("#tabs [data-tab=\"guide:status\"] .dot").count();
    check("a status guide is the first guide tab, with a changed marker", tabs.join() === "guide:status*,guide:learn", tabs.join());
    check("a guide shows its sections with their update times", g.secs.join() === "Blocked on you,Done" && g.upd === 2, JSON.stringify(g));
    check("a status guide has no Archive button", g.archive === 0 && g.mark);
    check("the marker goes once the viewer looked", dot === 0);
  });
}

async function part1(browser) {
  const { ctx, page, errors, requests } = await openPage(browser, seed);
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
    text: document.querySelector("[data-item=infra-two]").textContent }));
  check("text with <script> in a card stays escaped", xss.flag === undefined && xss.tags === 0 && xss.text.split("<script>window.__xss = 1</script>").length === 4,
    "flag " + xss.flag + ", injected elements " + xss.tags);
  check("a fenced block in a card renders as a preformatted block with a copy button",
    (await page.locator("[data-item=infra-two] .summary pre").count()) === 1 && (await page.locator("[data-item=infra-two] .summary button.copy").count()) === 1);

  // Guide tab.
  const gtab = page.locator("#tabs [data-tab=\"guide:dns-setup\"]");
  check("a guide tab appears", (await gtab.count()) === 1, "label: " + ((await gtab.count()) ? (await gtab.innerText()).trim() : "none"));
  check("the card of the guide shows \"Open guide\"", (await page.locator("[data-item=code-one] .gopen:visible").count()) === 1 &&
    (await page.locator("#cards .gopen:visible").count()) === 1);
  await page.tap("[data-item=code-one] .gopen");
  await page.waitForSelector("#guide:not([hidden])");
  const g = await page.evaluate(() => {
    const q = (s) => Array.from(document.querySelectorAll("#guide " + s)).map((e) => e.textContent);
    return { ol: q("ol").length, li: q("ol > li"), start: Array.from(document.querySelectorAll("#guide ol")).map((e) => e.getAttribute("start")),
      pre: q("pre"), copy: q("button.copy").length, h4: q("h4"), cards: document.querySelectorAll("#cards .card").length, flag: window.__xss };
  });
  check("the guide renders a numbered list", g.li.length === 3 && g.start.join() === "1,3", g.li.length + " steps, list starts " + g.start.join());
  check("the guide renders a code block with a copy button", g.pre.length === 1 && g.pre[0] === "docs.invalid. 3600 IN TXT \"v=spf1 -all\"" && g.copy === 1, JSON.stringify(g.pre));
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
  check("the page loaded nothing from the network", requests.length === 0, requests.join(" "));
  await ctx.close();
}

let browser;
try {
  browser = await pw.chromium.launch();
} catch (e) {
  console.log("SKIP: Chromium did not start. Run: npx -y playwright install chromium\n" + String(e.message).split("\n")[0]);
  process.exit(2);
}
try {
  for (const [name, fn] of [["part 1", part1], ["part 2", part2], ["part 3", part3], ["part 4", part4], ["part 5", part5]]) {
    try { await fn(browser); } catch (e) { check(name + " ran to the end", false, String(e.message).split("\n")[0]); }
  }
} finally {
  await browser.close();
}
console.log(failed ? failed + " check(s) failed" : "all checks passed");
process.exit(failed ? 1 : 0);
