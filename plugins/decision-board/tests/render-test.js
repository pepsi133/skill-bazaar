// The DOM code of the page, against a small DOM stub: the tags, links and first ask of a card,
// the reference sanitizer, and the list of places that write HTML. Run: node render-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pageFile, cut, load, ok } = require("./_page.js");

// ---- a DOM stub: elements, text, attributes, and a record of every HTML write
const htmlWrites = [];
class Text { constructor(t) { this.nodeType = 3; this.data = t; this.parentNode = null; } get textContent() { return this.data; } remove() { El.prototype.remove.call(this); } }
const holds = (a, b) => { for (; b; b = b.parentNode) if (b === a) return true; return false; };
class El {
  constructor(tag) { this.localName = tag; this.nodeType = 1; this.childNodes = []; this.attrs = new Map(); this.parentNode = null; }
  get attributes() { return Array.from(this.attrs, ([name, value]) => ({ name, value })); }
  setAttribute(n, v) { this.attrs.set(n.toLowerCase(), String(v)); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  hasAttribute(n) { return this.attrs.has(n); }
  removeAttribute(n) { this.attrs.delete(n.toLowerCase()); }
  set className(v) { this.setAttribute("class", v); }
  get firstChild() { return this.childNodes[0] || null; }
  setCustomValidity(m) { this.validationMessage = String(m); }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.childNodes.push(c); return c; }
  append(...k) { k.forEach((c) => this.appendChild(typeof c === "string" ? new Text(c) : c)); }
  insertBefore(c, ref) { if (c.parentNode) c.remove(); c.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); return c; }
  remove() { const p = this.parentNode; if (p) { if (holds(this, document.activeElement)) document.activeElement = document.body; p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; } }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.childNodes.forEach((c) => (c.parentNode = null)); this.childNodes = []; if (v !== "") this.appendChild(new Text(String(v))); }
  set innerHTML(v) { htmlWrites.push(v); }
  addEventListener(type, fn) { (this.listeners = this.listeners || {})[type] = fn; }
  focus() { document.activeElement = this; }
  get classList() { const el = this, has = () => (el.getAttribute("class") || "").split(" ").filter(Boolean);
    return { contains: (c) => has().includes(c), toggle: (c, on) => { const l = has().filter((x) => x !== c); if (on === undefined ? !has().includes(c) : on) l.push(c); el.setAttribute("class", l.join(" ")); } }; }
  // "tag.class" selectors only, enough for the page's closest("details.grp").
  closest(sel) { const [tag, cls] = sel.split("."); for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (e.localName === tag && (!cls || e.classList.contains(cls))) return e; return null; }
  get isConnected() { return holds(document.body, this); }
  // The data-* attributes, read only.
  get dataset() { const o = {}; for (const [k, v] of this.attrs) if (k.startsWith("data-")) o[k.slice(5)] = v; return o; }
  querySelector(tag) { return this.querySelectorAll(tag)[0] || null; }
  querySelectorAll(tag) { const out = [], walk = (n) => n.children.forEach((c) => { if (c.localName === tag) out.push(c); walk(c); }); walk(this); return out; }
}
// A tiny HTML parser for the sanitizer cases: tags, quoted attributes, text. Enough for the inputs below, nothing more.
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "col"]);
function parse(html) {
  const body = new El("body"), stack = [body], re = /<!([^>]*)>|<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) continue;
    if (m[5] !== undefined) { top.appendChild(new Text(m[5])); continue; }
    const tag = m[3].toLowerCase();
    if (tag === "html" || tag === "body") continue;
    if (m[2]) { const i = stack.map((e) => e.localName).lastIndexOf(tag); if (i > 0) stack.length = i; continue; }
    const e = new El(tag), ar = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = ar.exec(m[4]))) e.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? "");
    top.appendChild(e);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[4])) stack.push(e);
  }
  return { body, createElement: (t) => new El(t) };
}
const document = { createElement: (t) => new El(t), createDocumentFragment: () => new El("#fragment"), adoptNode: (n) => n,
  body: new El("body"), activeElement: null, contains(n) { return holds(this.body, n); },
  createTextNode: (t) => new Text(t), querySelector: () => null, documentElement: { style: { setProperty() {} } }, addEventListener() {} };
document.activeElement = document.body;
const DOMParser = class { parseFromString(s) { return parse(s); } };
const ids = {};
const copied = [];
const P = load({ document, DOMParser,
  navigator: { clipboard: { writeText: (s) => { copied.push(s); return Promise.resolve(); } } },
  setTimeout: () => 0, window: {}, cards: new Map(),
  buildCard: (it) => { const ta = new El("textarea"), el = new El("article"); el.appendChild(ta); return { el, ta }; },
  updateCard: () => {}, brokenCard: () => new El("article"), $: (id) => ids[id] },
  cut("  function h(tag, attrs)", "  function fmt(s)") + cut("  function set(s)", "  // ---- cards. Every DOM id") + cut("  function renderMeta", "  function updateCard") + cut("  // Give focus back to el when a DOM move took it away", "  var blockedKey = null;"));

const find = (n, tag) => n.querySelectorAll(tag);
const card = () => ({ chips: new El("div"), links: new El("div"), asked: new El("div") });

ok("a card renders only the valid links, with the parsed href, the label as text and the host after it", () => {
  P.applyConfig({ tz: "UTC", link_hosts: ["example.com"], tags: [{ id: "cost", label: "Costs <b>money</b>" }] });
  const c = card(), label = "<img src=x onerror=alert(1)>";
  P.renderMeta(c, P.coerce("item", { id: "a", tags: ["cost", "nope"], first_asked: { date: "2026-03-01", who: "infra-agent" },
    links: [{ label: "first", url: "http://example.com/" }, { label, url: "https://Wiki.Example.com/a b" }, { label: "", url: "https://example.com/z" },
      { label: "u", url: "https://u:p@example.com/" }, { label: "js", url: "javascript:alert(1)" }] }), Date.UTC(2026, 2, 3));
  const as = find(c.links, "a");
  assert.deepEqual(as.map((a) => [a.getAttribute("href"), a.textContent, a.getAttribute("target"), a.getAttribute("rel")]),
    [["https://wiki.example.com/a%20b", label, "_blank", "noopener noreferrer"], ["https://example.com/z", "example.com", "_blank", "noopener noreferrer"]]);
  assert.deepEqual(find(c.links, "span").filter((s) => s.getAttribute("class") === "small muted").map((s) => s.textContent), [" wiki.example.com"],
    "the host follows a label that differs from it, and only then");
  assert.equal(c.asked.textContent, "First asked 03-01 (infra-agent), 2 days");
  assert.deepEqual(find(c.chips, "span").map((s) => s.textContent), ["Costs <b>money</b>"]);
  assert.deepEqual(htmlWrites, [], "no HTML is written");
  P.applyConfig({ tz: "UTC" });
});
ok("without valid links, tags or a first ask the boxes are empty and hidden", () => {
  P.applyConfig({ tz: "UTC", link_hosts: ["example.com"] });
  const c = card();
  P.renderMeta(c, P.coerce("item", { id: "b", links: [{ label: "x", url: "https://other.invalid/" }], tags: ["cost"], first_asked: { date: "2026-02-30" } }), Date.UTC(2026, 2, 3));
  assert.deepEqual([c.links.childNodes.length, c.links.hidden, c.chips.hidden, c.asked.textContent, c.asked.hidden], [0, true, true, "", true]);
  P.applyConfig({ tz: "UTC" });
});
ok("sanitizeRef: no script, no on* attribute, no javascript: href, no url() of an unlisted host", () => {
  P.applyConfig({ tz: "UTC", domains: ["docs.example.com"] });
  const out = P.sanitizeRef('<p onclick="alert(1)" class="k">hi<script>alert(1)</script></p><a href="javascript:alert(1)">x</a><a href="https://docs.example.com/a">y</a>' +
    '<svg><rect fill="url(https://evil.invalid/a)" stroke="url(#g)"/><rect fill="url(https://docs.example.com/p.svg)"/></svg>' +
    '<span style="color: red; background-color: url(https://evil.invalid/x)" onmouseover="x()">s</span>');
  const p = find(out, "p")[0], a = find(out, "a"), r = find(out, "rect"), s = find(out, "span")[0];
  assert.deepEqual([p.attributes.map((x) => x.name), p.textContent, find(out, "script").length], [["class"], "hi", 0]);
  assert.deepEqual(a.map((x) => [x.getAttribute("href"), x.getAttribute("target"), x.getAttribute("rel")]),
    [[null, "_blank", "noopener noreferrer"], ["https://docs.example.com/a", "_blank", "noopener noreferrer"]]);
  assert.deepEqual(r.map((x) => [x.getAttribute("fill"), x.getAttribute("stroke")]), [[null, "url(#ref-g)"], ["url(https://docs.example.com/p.svg)", null]]);
  assert.deepEqual([s.getAttribute("style"), s.getAttribute("onmouseover")], ["color: red", null]);
  P.applyConfig({ tz: "UTC" });
});
ok("HTML reaches the page only at the known places, each through fmtText", () => {
  const src = fs.readFileSync(pageFile, "utf8"), js = src.slice(src.indexOf("<script>"));
  const re = /[\w.$[\]"]+(\.(innerHTML|outerHTML)|\[\s*["'](innerHTML|outerHTML)["']\s*\])\s*=[^;]*|insertAdjacentHTML|document\.write|createContextualFragment|Reflect\.set|setHTML|srcdoc|outerHTML/g, sites = js.match(re);
  assert.deepEqual(sites, ["c.summary.innerHTML = fmtText(it.summary)", "c.evBody.innerHTML = fmtText(it.evidence)", "body.innerHTML = fmtText(s.body)"]);
  // The check sees every other way to write HTML.
  const probe = 'e["innerHTML"] = x; e[\'outerHTML\'] = x; Reflect.set(e, "innerHTML", x); e.setHTML(x); f.srcdoc = x; e.outerHTML = x; e.insertAdjacentHTML("beforeend", x); document.write(x); r.createContextualFragment(x);';
  assert.equal(probe.match(re).length, 9, "a positive control for the pattern");
});
ok("the footer always names the zone", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  assert.match(src, /<footer id="foot" class="page-foot"><span id="zone" class="small muted"><\/span>/, "#zone is the first child of #foot");
  assert.ok(!/<span id="zone"[^>]*hidden/.test(src), "#zone is not hidden");
  assert.ok(/<section id="archived" class="notes" hidden aria-label="Archived guides"><\/section>\s*<footer id="foot"/.test(src), "the footer follows the last notes section");
  const render = src.slice(src.indexOf("  function render() {"), src.indexOf("  // The cards of a list in order."));
  assert.ok(render.includes('$("zone").textContent = zoneNote(cfg.tz);'));
  P.applyConfig({ tz: "Europe/Warsaw" });
  assert.equal(P.zoneNote(P.cfg.tz), "Times in Europe/Warsaw");
  P.applyConfig({ tz: "UTC" });
});
ok("the footer names where the settings live", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  assert.ok(src.includes('<footer id="foot" class="page-foot"><span id="zone" class="small muted"></span><span id="settings" class="small muted" hidden></span></footer>'));
  assert.ok(src.includes('$("settings").textContent = cfg.settings; $("settings").hidden = !cfg.settings;'));
  const Q = load();
  Q.applyConfig({ tz: "UTC", settings: "Settings: .board/config.json" });
  assert.equal(Q.cfg.settings, "Settings: .board/config.json");
  Q.applyConfig({ tz: "UTC", settings: 5 });
  assert.equal(Q.cfg.settings, "");
  Q.applyConfig({ tz: "UTC" });
  assert.equal(Q.cfg.settings, "");
});
ok("CSS: one [hidden] rule hides every element, whatever its display", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  assert.equal(src.split("[hidden] { display: none !important; }").length - 1, 1);
  assert.ok(!/\.donebox\[hidden\]|\.guide\[hidden\]|\.links\[hidden\]/.test(src));
});
ok("CSS: the children of the agent strip may shrink, so a long summary ends in an ellipsis inside the box", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  assert.ok(src.includes(".agentnow summary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.agentnow > * { min-width: 0; }"));
});
ok("CSS: the Assign select never grows past its row, so a long person label is cut instead of widening the page", () => {
  const src = fs.readFileSync(pageFile, "utf8"), rule = /^\.ctl select \{([^}]*)\}/m.exec(src);
  assert.ok(rule, "the .ctl select rule");
  assert.match(rule[1], /(^|;)\s*max-width: 100%;/);
  assert.match(rule[1], /(^|;)\s*min-width: 0;/);
  assert.match(rule[1], /(^|;)\s*text-overflow: ellipsis;/);
  const row = /^\.ctl \{([^}]*)\}/m.exec(src);
  assert.ok(row, "the .ctl rule");
  assert.match(row[1], /(^|;)\s*min-width: 0;/, "the row may shrink in the card grid, so the select's max-width has a bound");
});
ok("CSS: a refused snooze date shows: the invalid date field has the red border of the now token", () => {
  const src = fs.readFileSync(pageFile, "utf8");
  assert.ok(src.includes(".snz input:invalid { border-color: var(--now); }"));
  assert.ok(src.includes(".tag.now { background: var(--now-bg); color: var(--now); }"), "--now is the red of the now priority tag");
});
ok("CSS: the slim row of a snoozed card may shrink, so its title ends in an ellipsis instead of widening the page", () => {
  const src = fs.readFileSync(pageFile, "utf8"), rule = /^\.card\.slim > \.slimrow \{([^}]*)\}/m.exec(src);
  assert.ok(rule, "the .card.slim > .slimrow rule");
  assert.match(rule[1], /(^|;)\s*min-width: 0;/);
});
ok("draft: the box shows the field as text, and Copy passes the stored field to the clipboard byte for byte", () => {
  const s = "Hi Sam,\r\n\n  indented\tTab  \n```\nnot a fence\n```\n<b>x</b> — ✓  ", c = {};
  P.buildDraft(c);
  assert.equal(c.draft.hidden, true, "hidden before any render");
  c.it = P.coerce("item", { id: "a", draft: s, draft_label: "Reply <i>here</i>" });
  P.renderDraft(c, c.it);
  assert.equal(c.draft.hidden, false);
  assert.equal(c.dpre.textContent, s);
  assert.equal(c.dlabel.textContent, "Reply <i>here</i>");
  c.dcopy.listeners.click();
  assert.deepEqual(copied, [s]);
  assert.equal(copied[0].length, s.length);
  assert.deepEqual(htmlWrites, []);
  P.renderDraft(c, P.coerce("item", { id: "a" }));
  assert.equal(c.draft.hidden, true);
  assert.equal(c.dpre.textContent, "");
});
ok("groups: a card that moves to a later group while its text box has focus keeps the focus", () => {
  ids.groups = new El("div"); document.body.appendChild(ids.groups);
  const x = P.coerce("item", { id: "x" }), G = (a, b) => [{ id: "ga", label: "A", fold: false, cards: a }, { id: "gb", label: "B", fold: false, cards: b }];
  P.renderGroups(G([x], []));
  const ta = P.cards.get("x").ta; ta.focus();
  assert.equal(document.activeElement, ta);
  P.renderGroups(G([], [x]));
  assert.equal(document.activeElement, ta);
  assert.equal(P.cards.get("x").el.parentNode, P.groupEls.get("gb").list);
  assert.equal(P.groupEls.get("ga").el.hidden, true);
  P.renderGroups(G([x], []));
  assert.equal(document.activeElement, ta);
  assert.deepEqual(htmlWrites, []);
});
ok("groups: one focus snapshot for every group list, and one restore at the end", () => {
  const listA = new El("div"), listB = new El("div"), x = P.coerce("item", { id: "y" });
  document.body.appendChild(listA); document.body.appendChild(listB);
  P.placeCards(listA, [x]);
  const ta = P.cards.get("y").ta; ta.focus();
  P.placeCards(listA, [], ta);
  assert.equal(document.activeElement, document.body, "the move out of listA drops focus");
  P.placeCards(listB, [x], ta);
  assert.equal(document.activeElement, ta, "placeCards restores the focus it was given");
  // renderGroups passes its one snapshot to every placeCards call and restores it once more at the end.
  const real = P.placeCards, seen = [];
  P.placeCards = (cont, list, focused) => { seen.push(focused); real(cont, list, focused); document.activeElement = document.body; };
  try {
    const G = (a, b) => [{ id: "ga", label: "A", fold: false, cards: a }, { id: "gb", label: "B", fold: false, cards: b }];
    P.renderGroups(G([x], []));
    ta.focus();
    seen.length = 0;
    P.renderGroups(G([], [x]));
    assert.equal(seen.length, 2);
    assert.ok(seen.every((f) => f === ta), "every group list gets the snapshot taken before the first");
    assert.equal(document.activeElement, ta, "the end of renderGroups restores the focus");
  } finally { P.placeCards = real; }
  listA.remove(); listB.remove();
});
ok("the side list shows only with two or more groups that hold a card, and never on a guide tab", () => {
  ids.side = new El("nav"); ids.board = new El("div");
  const g = (id, n) => ({ id, label: id, fold: false, cards: Array.from({ length: n }, (_, i) => ({ id: id + i })) });
  P.renderSide([g("a", 2), g("b", 0)], false);
  assert.deepEqual([ids.side.hidden, ids.board.classList.contains("has-side")], [true, false]);
  P.renderSide([g("a", 2), g("b", 1)], false);
  assert.deepEqual([ids.side.hidden, ids.board.classList.contains("has-side"), ids.side.children.length], [false, true, 2]);
  P.renderSide([g("a", 2), g("b", 1)], true);
  assert.equal(ids.side.hidden, true);
});
// A second sandbox for render, updateCard, renderDue and goToCard: the other DOM functions of render are stubs.
const qids = {}, shown = { groups: null, view: [] };
const Q = load({ document, DOMParser, navigator: { clipboard: { writeText: () => Promise.resolve() } }, setTimeout: () => 0, window: {},
  cards: new Map(), cardDocs: new Map(), meta: null, sending: false, dueKey: null, lastDay: "", lastWeek: 0,
  $: (id) => qids[id] || (qids[id] = new El("div")), fmt: () => "", ready: () => false, saveFilter: () => {},
  renderGuide: () => {}, renderTabs: () => {}, renderArchived: () => {}, renderBlocked: () => {}, renderSide: () => {}, renderNotes: () => {}, renderSync: () => {},
  renderNow: () => {}, agentStatus: null, seenCards: null, markAllSeen: () => {}, seenOne: () => {}, wakeOutcome: "",
  renderGroups: (g) => { shown.groups = g; }, placeCards: () => {}, bringIntoView: (el) => { shown.view.push(el); },
  lingerUntil: new Map(), LINGER_MS: 4000 },
  cut("  function h(tag, attrs)", "  function fmt(s)") + cut("  function set(s)", "  // ---- cards. Every DOM id") +
  cut("  function setSave(c, t)", "  function updateCard") + cut("  function updateCard(c, it)", "  // A card that fails to render") +
  cut("  function render() {", "  // Give focus back to el") + cut('  // "Due today": a link per card', "  // Scroll an element to just below"));
// A card object whose every DOM part is a stub element.
const cardObj = () => new Proxy({}, { get: (o, k) => (k in o || typeof k !== "string" ? o[k] : (o[k] = new El("div"))) });

ok("the due strip and the card due tag use the day of the config tz, not of UTC", () => {
  Q.applyConfig({ tz: "Europe/Warsaw" });
  Q.items.clear();
  const it = Q.coerce("item", { id: "a", title: "Renew", due: "2026-11-14", priority: "soon" });
  Q.items.set("a", it);
  Q.clockMs = () => Date.UTC(2026, 10, 13, 23, 1); // 00:01 on 11-14 in Warsaw, still 11-13 in UTC
  Q.render();
  assert.equal(Q.lastDay, "2026-11-14");
  assert.equal(qids.settings.hidden, true, "#settings is hidden while the config has no settings line");
  assert.equal(qids.due.hidden, false);
  assert.ok(qids.due.textContent.includes("Due today"), qids.due.textContent);
  const c = cardObj();
  Q.buildControls(c);
  Q.updateCard(c, it);
  assert.deepEqual([c.due.textContent, c.due.hidden, c.due.getAttribute("class")], ["Due today", false, "tag now"]);
  htmlWrites.length = 0;
  Q.applyConfig({ tz: "UTC" });
});
ok("the due strip hides when no card is due", () => {
  Q.applyConfig({ tz: "UTC" });
  Q.renderDue([Q.coerce("item", { id: "a", due: "2026-11-13" })], "2026-11-13");
  assert.equal(qids.due.hidden, false);
  Q.renderDue([], "2026-11-13");
  assert.equal(qids.due.hidden, true);
  assert.equal(qids.due.textContent, "");
});
ok("goToCard unfolds the folded group of the card, then scrolls to it", () => {
  Q.applyConfig({ tz: "UTC" });
  Q.items.clear();
  Q.items.set("d", Q.coerce("item", { id: "d", status: "closed" }));
  const el = new El("article"), fold = new El("details");
  fold.className = "grp"; fold.appendChild(el); document.body.appendChild(fold);
  Q.cards.set("d", { el });
  shown.view.length = 0;
  Q.goToCard("d");
  assert.equal(fold.open, true);
  assert.deepEqual(shown.view, [el]);
  fold.remove();
  Q.items.clear(); Q.cards.clear();
});
// The card controls with this sandbox's stub elements. Not covered here: the look (CSS, the fold fade, 44 px
// targets), the phone pickers of the select and date input, the 4 s linger timer (setTimeout is a stub), and the
// writes of saveControls (this sandbox has no database: a tap changes no response).
ok("card controls: a control the config turns off is hidden; the close switch needs a source_key", () => {
  const ON = { assign: true, snooze: true, dismiss: true, close: true, done: true, tags: true };
  const built = (it) => { const c = cardObj(); c.it = it; c.panelOpen = false; c.snzOpen = false; c.expanded = false; c.undo = null; Q.buildControls(c); Q.updateCard(c, it); return c; };
  Q.applyConfig({ tz: "UTC" }); Q.setCtlDay("2026-11-13");
  let c = built(Q.coerce("item", { id: "k1", title: "K", source: "tracker", source_key: "7" }));
  assert.deepEqual([c.assign.hidden, c.gut.hidden, c.closeSw.hidden, c.dismissSw.hidden, c.snzBtn.hidden, c.ctl.hidden, c.more.hidden], [true, true, true, true, true, true, true]);
  Q.applyConfig({ tz: "UTC", controls: ON });
  c = built(Q.coerce("item", { id: "k2", title: "K" }));
  assert.deepEqual([c.assign.hidden, c.gut.hidden, c.closeSw.hidden, c.dismissSw.hidden, c.ctl.hidden], [false, false, true, false, false]);
  c = built(Q.coerce("item", { id: "k3", title: "K", source: "tracker", source_key: "7" }));
  assert.equal(c.closeSw.hidden, false);
  assert.equal(c.closeSw.lab.textContent, "Close in tracker");
  Q.applyConfig({ tz: "UTC" });
});
ok("card controls: a new snooze folds an expanded card again", () => {
  Q.applyConfig({ tz: "UTC", controls: { snooze: true } }); Q.setCtlDay("2026-11-13");
  Q.items.clear();
  const it = Q.coerce("item", { id: "z1", title: "Z" });
  Q.items.set("z1", it);
  const c = cardObj(); c.it = it; c.undo = null; Q.buildControls(c);
  for (const tap of [() => c.snzDay.listeners.click(), () => c.snzWeek.listeners.click(),
    () => { c.snzDate.value = "2026-11-20"; Q.clockMs = () => Date.UTC(2026, 10, 13, 12); c.snzDate.listeners.change(); }]) {
    c.expanded = true;
    tap();
    assert.equal(c.expanded, false);
  }
  Q.items.clear(); Q.cards.clear();
  Q.applyConfig({ tz: "UTC" });
});
ok("card controls: a lingering Undo stands directly after the control that made the change; the banner keeps only the text", () => {
  const ON = { assign: true, snooze: true, dismiss: true, close: true, done: true, tags: true };
  Q.applyConfig({ tz: "UTC", controls: ON }); Q.setCtlDay("2026-11-13");
  const it = Q.coerce("item", { id: "u1", title: "U", source: "tracker", source_key: "7" });
  const c = cardObj(); c.it = it; c.panelOpen = true; c.snzOpen = false; c.expanded = false; c.undo = null; Q.buildControls(c);
  Q.updateCard(c, it);
  assert.equal(c.undoBtn.hidden, true, "no linger: no Undo");
  assert.deepEqual([c.undoBtn.textContent, c.undoBtn.getAttribute("class")], ["Undo", "undo"]);
  assert.ok(!c.banner.querySelectorAll("button").length, "the banner holds no button");
  const was = Q.lingerOf;
  Q.lingerOf = () => "active";
  const next = (el) => el.parentNode.childNodes[el.parentNode.childNodes.indexOf(el) + 1];
  for (const [at, anchor, row] of [["done", c.gut, c.chead], ["assign", c.assign, c.ctl], ["snooze", c.snzBtn, c.ctl], ["dismiss", c.dismissSw, c.dismissRow], ["close", c.closeSw, c.closeRow]]) {
    c.undo = { [at]: false }; c.undoAt = at;
    Q.updateCard(c, it);
    assert.equal(c.undoBtn.hidden, false, at);
    assert.equal(c.undoBtn.parentNode, row, at);
    assert.equal(next(anchor), c.undoBtn, "directly after the control: " + at);
  }
  // The edit panel closed during a Dismiss linger: the Undo stands in the banner beside the text; opened again, back.
  c.undo = { dismiss: false }; c.undoAt = "dismiss";
  c.panelOpen = false; Q.updateCard(c, it);
  assert.deepEqual([c.panel.hidden, c.undoBtn.parentNode === c.banner, c.undoBtn.hidden], [true, true, false]);
  assert.equal(next(c.bannerText), c.undoBtn, "beside the state text");
  c.panelOpen = true; Q.updateCard(c, it);
  assert.deepEqual([c.panel.hidden, c.undoBtn.parentNode === c.dismissRow, next(c.dismissSw) === c.undoBtn], [false, true, true]);
  assert.deepEqual(Q.undoAt({ done: true }), "done");
  assert.deepEqual([Q.undoAt({ assign: "other" }), Q.undoAt({ snooze: "" }), Q.undoAt({ dismiss: true }), Q.undoAt({ tags_on: [] })], ["assign", "snooze", "dismiss", ""]);
  Q.lingerOf = was;
  Q.applyConfig({ tz: "UTC" });
});
ok("card controls: keyboard focus around Undo: to the restored control, to the Undo after a snooze, to the control when the linger ends", () => {
  const ON = { assign: true, snooze: true, dismiss: true, close: true, done: true, tags: true };
  Q.applyConfig({ tz: "UTC", controls: ON }); Q.setCtlDay("2026-11-13");
  const it = Q.coerce("item", { id: "f1", title: "F" });
  const c = cardObj(); c.it = it; c.panelOpen = true; c.snzOpen = false; c.expanded = false; c.undo = null; Q.buildControls(c);
  const was = [Q.lingerOf, Q.renderGroups];
  Q.lingerOf = () => "active";
  Q.renderGroups = () => Q.updateCard(c, c.it);           // render() reaches this card
  Q.updateCard(c, it);
  const undoBy = (key, at, ctl) => {
    c.undo = { [at]: at === "assign" ? "" : false }; c.undoAt = at; Q.updateCard(c, it);
    document.activeElement = c.undoBtn; Q.keyNav = key;
    c.undoBtn.listeners.click();
    return document.activeElement === ctl;
  };
  for (const [at, ctl] of [["done", c.doneBox], ["assign", c.assign], ["snooze", c.snzBtn], ["dismiss", c.dismissSw]]) {
    assert.equal(undoBy(true, at, ctl), true, "keyboard Undo focuses the control: " + at);
    assert.equal(undoBy(false, at, ctl), false, "a pointer Undo leaves focus alone: " + at);
  }
  // Undo pressed in the state line (the edit panel hidden): focus falls back to the Edit/Hide toggle.
  c.panelOpen = false;
  assert.equal(undoBy(true, "dismiss", c.more), true, "keyboard Undo in the banner focuses Edit");
  assert.equal(c.panel.hidden, true);
  c.panelOpen = true;
  for (const key of [true, false]) {
    document.activeElement = document.body; Q.keyNav = key; c.undo = null;
    c.snzDay.listeners.click();
    assert.equal(document.activeElement === c.undoBtn, key, "after a snooze choice, by keyboard " + key);
  }
  Q.lingerOf = () => ""; Q.schedule = () => {};
  for (const had of [true, false]) {
    c.undo = { dismiss: false }; c.undoAt = "dismiss";
    document.activeElement = had ? c.undoBtn : document.body;
    Q.lingerEnd(c, "f1");
    assert.equal(document.activeElement === c.dismissSw, had, "linger end with the Undo focused: " + had);
    assert.equal(c.undo, null);
  }
  [Q.lingerOf, Q.renderGroups] = was; delete Q.schedule; Q.keyNav = false; document.activeElement = document.body;
  Q.applyConfig({ tz: "UTC" });
});
ok("card controls: a date typed by keyboard snoozes only when complete and in range; out of range it stays, marked invalid", () => {
  Q.applyConfig({ tz: "UTC", controls: { snooze: true } }); Q.setCtlDay("2026-11-13");
  const it = Q.coerce("item", { id: "t1", title: "T" });
  const c = cardObj(); c.it = it; c.undo = null; Q.buildControls(c);
  const calls = [], was = [Q.setControl, Q.clockMs];
  Q.setControl = (cc, patch) => calls.push(patch);
  Q.clockMs = () => Date.UTC(2026, 10, 13, 12);
  const type = (v) => { c.snzOpen = true; c.snzDate.value = v; c.snzDate.listeners.change(); return [c.snzDate.value, c.snzDate.validationMessage !== "", calls.length, c.snzOpen]; };
  // Typing 11/20/2026 passes the years 0002, 0020 and 0202 before 2026.
  // realDate reads a year under 100 as no date (Date.UTC maps it to 19xx): left alone; 0202 is a date out of range.
  for (const [y, bad] of [["0002", false], ["0020", false], ["0202", true]]) assert.deepEqual(type(y + "-11-20"), [y + "-11-20", bad, 0, true], y);
  assert.deepEqual(type(""), ["", false, 0, true], "an incomplete value does nothing");
  for (const d of ["2026-11-13", "2026-11-01", "2027-11-15"]) assert.deepEqual(type(d), [d, true, 0, true], "refused: " + d);
  assert.deepEqual(type("2026-11-20"), ["2026-11-20", false, 1, false], "a complete day in range snoozes once");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ snooze: "2026-11-20" }]);
  [Q.setControl, Q.clockMs] = was;
  Q.applyConfig({ tz: "UTC" });
});
ok("a card shows its result line by textContent, hidden without a result", () => {
  Q.applyConfig({ tz: "UTC" }); Q.setCtlDay("2026-11-13");
  const was = Q.fmt; Q.fmt = (s) => (s ? "T(" + s + ")" : "");
  const built = (it) => { const c = cardObj(); c.it = it; c.undo = null; Q.buildControls(c); Q.updateCard(c, it); return c; };
  const text = "closed <b>it</b>";
  htmlWrites.length = 0;
  let c = built(Q.coerce("item", { id: "r1", title: "R", result: text, result_at: "2026-11-13T10:00:00+00:00" }));
  assert.deepEqual([c.result.textContent, c.result.hidden], ["Result: closed <b>it</b> · T(2026-11-13T10:00:00+00:00)", false]);
  assert.ok(!htmlWrites.some((x) => String(x).includes("closed <b>")), "no HTML write of the result");
  c = built(Q.coerce("item", { id: "r2", title: "R" }));
  assert.deepEqual([c.result.textContent, c.result.hidden], ["", true]);
  assert.equal(c.dot.hidden, true, "a first visit shows no dot");
  Q.fmt = was;
});

// ---- A third sandbox: Send, the wake comment, the agent strip and the seen marking, against a stub database and a
// stub comments object. Each box is a fresh page; with load: true it also runs the wiring and the start of the page.
// Not covered here: the real comments capability (consent prompt, the gesture window, the thread that a resolve
// leaves), the real database, a phone, the look of the strip, and the order of async replies of a real network.
function stubComments(o = {}) {
  const c = { sent: [], asked: 0,
    anchorFor: (el) => Promise.resolve({ el }),
    canSendToClaude: () => { c.asked++; return Promise.resolve(o.can || "available"); },
    sendToClaude: (t) => { c.sent.push(t); const e = o.reject && o.reject(t); return e ? Promise.reject(e) : Promise.resolve({ threadId: o.thread || "th-1" }); } };
  if (o.noSend) delete c.sendToClaude;
  return c;
}
function wakeBox(o = {}) {
  const els = {}, later = [], writes = [], store = Object.assign({}, o.store || {});
  const docSnap = (p) => { const d = (o.metaDocs || {})[p]; return { exists: !!d, data: () => d }; };
  const colSnap = (c) => ({ docs: ((o.cols || {})[c] || []).map((x) => ({ id: x.id, exists: true, data: () => x.data })) });
  const db = {
    doc: (p) => ({
      set: (d) => { writes.push([p, JSON.parse(JSON.stringify(d))]); return o.failSet && o.failSet(p) ? Promise.reject({ code: "refused", message: "no" }) : Promise.resolve(); },
      update: (d) => { writes.push([p, d]); return Promise.resolve(); }, delete: () => Promise.resolve(),
      get: () => Promise.resolve(docSnap(p)),
      onSnapshot: (fn, err) => { if (o.configFails && p === "meta/config") err({ code: "refused", message: "no" }); else if (!(o.configNever && p === "meta/config")) fn(docSnap(p)); return () => {}; } }),
    collection: (c) => ({ get: () => Promise.resolve(colSnap(c)), onSnapshot: (fn) => { fn(colSnap(c)); return () => {}; } }),
  };
  const comments = o.comments === undefined ? stubComments() : o.comments;
  const win = o.load ? { addEventListener() {}, claude: { use: (n) => (n === "db" ? Promise.resolve(db) : o.commentsP || Promise.resolve(comments)) } } : {};
  const W = load({ document, DOMParser, navigator: { clipboard: { writeText: () => Promise.resolve() } }, window: win,
    setTimeout: (f, ms) => { later.push({ f, ms, cleared: false }); return later.length; }, clearTimeout: (i) => { if (later[i - 1]) later[i - 1].cleared = true; },
    setInterval: () => 0, requestAnimationFrame: () => 0,
    localStorage: { getItem: (k) => (Object.hasOwn(store, k) ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    cards: new Map(), cardDocs: new Map(), meta: null, sending: false, dueKey: null, lastDay: "", lastWeek: 0,
    $: (id) => els[id] || (els[id] = new El("div")), fmt: (x) => (x ? "T(" + x + ")" : ""), ready: () => true, saveFilter: () => {},
    renderGuide: () => {}, renderTabs: () => {}, renderArchived: () => {}, renderBlocked: () => {}, renderSide: () => {}, renderNotes: () => {}, renderSync: () => {},
    renderGroups: () => {}, placeCards: () => {}, bringIntoView: () => {}, copyText: () => {}, lingerUntil: new Map(), LINGER_MS: 4000,
    db: o.load ? null : db, comments: o.load ? null : comments, commentsOff: !!o.commentsOff, wakeDoc: null, wakeOutcome: "", wakeTimer: 0,
    agentStatus: null, seenCards: null, nowKey: null, CKEY: "decision-board-cards-seen-v1",
    timers: new Map(), inflight: new Map(), chains: new Map(), lastDoc: new Map(), totalInflight: 0, lastSaved: "", cardSeq: 0, noteItem: "", rid: () => "abcd" },
    cut("  function h(tag, attrs)", "  function fmt(s)") + cut("  function set(s)", "  // ---- cards. Every DOM id") +
    cut("  function setSave(c, t)", "  function updateCard") + cut("  function updateCard(c, it)", "  // A card that fails to render") +
    cut("  function render() {", "  // Give focus back to el") + cut("  // The agent strip:", '  // "Due today": a link per card') +
    cut('  // "Due today": a link per card', "  // Scroll an element to just below") +
    cut("  function saveCardsSeen()", "  function showMsg(t)") + cut("  function showMsg(t)", "  // ---- pure: start") +
    cut("  var raf = 0;", "  // ---- reads.") + (o.realReady ? cut("  function ready()", "  function render() {") + cut('  // The one write of the page to "guides"', "  function renderNotes()") + cut("  function renderSync()", "  var raf = 0;") + cut("  function applyConfigDoc(d)", "  function applyStatus(d)") : "") + (o.load ? cut("  // ---- reads.", "})();") : ""));
  return { W, els, later, writes, store, comments, db };
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
const NOWS = () => new Date().toISOString().slice(0, 19) + "+00:00";
// One unsent answer on card a; the page has loaded.
function answered(x, o) {
  Object.assign(x.W.loaded, { items: true, responses: true, notes: true, config: true });
  x.W.applyConfig(Object.assign({ tz: "UTC" }, o || {}));
  x.W.items.set("a", x.W.coerce("item", { id: "a", title: "A", options: ["Yes", "No"], status: "open", rev: 1, updated: "2026-01-01T00:00:00+00:00" }));
  x.W.resp.set("a", Object.assign(x.W.coerce("response", { choice: "Yes", note: "", rev: 1, sent: false, updated: NOWS() }), { itemId: "a" }));
}
const WAKE = "Read the decision board: answers were sent.";
const tests = [];
const aok = (name, fn) => tests.push([name, fn]);
aok("wake: Send posts exactly WAKE_TEXT on a new thread, saves the thread to meta/wake, and the next wake reuses it", async () => {
  const x = wakeBox();
  answered(x);
  x.W.send(); await settle();
  assert.ok(x.writes.some(([p]) => p.startsWith("batches/")), "the batch went out");
  assert.equal(x.comments.sent.length, 1);
  assert.deepEqual(Object.keys(x.comments.sent[0]).sort(), ["anchor", "text"]);
  assert.equal(x.comments.sent[0].text, WAKE);
  assert.equal(x.comments.sent[0].anchor.el, x.els.send, "the anchor of the Send button");
  const mw = x.writes.filter(([p]) => p === "meta/wake");
  assert.deepEqual(mw.map(([, d]) => d.thread), ["th-1"]);
  assert.equal(x.W.wakeOutcome, "sent");
  x.W.wakeDoc = x.W.coerce("wake", mw[0][1]);
  assert.equal(await x.W.wakeAgent(x.W.wakeAnchor()), "sent");
  assert.deepEqual(JSON.parse(JSON.stringify(x.comments.sent[1])), { threadId: "th-1", text: WAKE });
  assert.equal(x.writes.filter(([p]) => p === "meta/wake").length, 1, "the same thread is not written again");
  const y = wakeBox({ comments: stubComments({ thread: "th-2", reject: (t) => (t.threadId ? { code: "not_found" } : null) }) });
  answered(y);
  y.W.wakeDoc = y.W.coerce("wake", { thread: "gone", updated: "" });
  assert.equal(await y.W.wakeAgent(y.W.wakeAnchor()), "sent");
  assert.deepEqual(y.comments.sent.map((t) => t.threadId || "anchor"), ["gone", "anchor"]);
  assert.deepEqual(y.writes.filter(([p]) => p === "meta/wake").map(([, d]) => d.thread), ["th-2"]);
});
aok("wake: a Send that fails at the mark stage still wakes; one that fails at the batch or sends nothing does not", async () => {
  let x = wakeBox({ failSet: (p) => p.startsWith("responses/") });
  answered(x);
  x.W.send(); await settle();
  assert.equal(x.comments.sent.length, 1);
  assert.equal(x.W.wakeOutcome, "mark_sent");
  x.W.render();
  assert.equal(x.els.wakestate.textContent, "Sent, but some answers were not marked sent. The agent was woken.");
  x = wakeBox({ failSet: (p) => p.startsWith("batches/") });
  answered(x);
  x.W.send(); await settle();
  assert.deepEqual([x.comments.sent.length, x.W.wakeOutcome], [0, ""]);
  x = wakeBox();
  answered(x);
  x.W.resp.clear();
  x.W.send(); await settle();
  assert.deepEqual([x.comments.sent.length, x.comments.asked, x.W.wakeOutcome], [0, 0, ""], "nothing to send wakes nobody");
});
aok("wake: each outcome shows its notice and the Wake button only where a tap can help; a plain notice clears after 30 s", async () => {
  const cases = [
    [{ can: "no_session" }, {}, "Sent. No agent session takes comments here; the poll every 15 min picks it up.", true],
    [{ reject: () => ({ code: "claude_unavailable" }) }, {}, "Sent. Tap Wake the agent to send the comment.", false],
    [{ reject: () => ({ code: "consent_required" }) }, {}, "Sent. Allow comments from this page, then tap Wake the agent.", false],
    [{ reject: () => ({ code: "rate_limited" }) }, {}, "Sent. Too many wakes just now; tap Wake the agent in a minute.", false],
    [{ reject: () => ({ code: "forbidden" }) }, {}, "Sent. No agent session takes comments here; the poll every 15 min picks it up.", true],
    [{ noSend: true }, {}, "Sent. No agent session takes comments here; the poll every 15 min picks it up.", true],
    [{ can: "writers_only" }, { wake: { mode: "comment" } }, "Sent. No agent session takes comments here; tell the agent to read the board.", true],
    [{}, { wake: { mode: "poll" } }, "Sent. The watcher picks it up within 5 min.", true],
    [{}, { wake: { mode: "off" } }, "Sent. Tell the agent to read the board.", true],
    [null, {}, "Sent. This page cannot post comments: ask the agent to republish it. The poll every 15 min picks it up.", true, true],
    [null, {}, "Sent. The wake is not ready yet: tap Wake in a moment.", false, false],
  ];
  for (const [co, conf, text, hidden, off] of cases) {
    const x = wakeBox({ comments: co ? stubComments(co) : null, commentsOff: off });
    answered(x, conf);
    x.W.send(); await settle();
    x.W.render();
    assert.deepEqual([x.els.wakestate.textContent, x.els.wake.hidden], [text, hidden], JSON.stringify([co, conf]));
    const t = x.later.filter((l) => l.ms === 30000);
    assert.equal(t.length, hidden ? 1 : 0, "a timer only for a plain notice: " + text);
    if (conf.wake && conf.wake.mode !== "comment" && co) assert.equal(co && x.comments.sent.length, 0, "no comment in mode " + conf.wake.mode);
    if (hidden) { t[0].f(); x.W.render(); assert.deepEqual([x.W.wakeOutcome, x.els.wakestate.textContent], ["", ""], "cleared after 30 s"); }
  }
  const x = wakeBox();
  answered(x);
  x.W.setWakeOutcome("sent"); x.W.setWakeOutcome("gesture");
  assert.equal(x.later.filter((l) => l.ms === 30000)[0].cleared, true, "a new outcome clears the old timer");
});
aok("wake: a tap before the comments capability resolved says Not ready yet and keeps the Wake button; once it resolved absent the old texts apply", async () => {
  const tap = (x) => x.W.wakeAgent(x.W.wakeAnchor()).then(x.W.setWakeOutcome);   // what the #wake click does
  for (const mode of ["both", "comment"]) {
    const x = wakeBox({ comments: null, commentsOff: false });
    answered(x, { wake: { mode } });
    await tap(x); await settle();
    x.W.render();
    assert.deepEqual([x.W.wakeOutcome, x.els.wakestate.textContent, x.els.wake.hidden], ["not_ready", "Not ready yet. Try again in a moment.", false], mode);
    assert.equal(x.later.filter((l) => l.ms === 30000).length, 0, "the notice stays until the next press");
    x.W.commentsOff = true;                          // the capability resolved: absent
    await tap(x); await settle();
    x.W.render();
    assert.equal(x.W.wakeOutcome, "no_capability");
    assert.equal(x.els.wakestate.textContent, mode === "both"
      ? "Sent. This page cannot post comments: ask the agent to republish it. The poll every 15 min picks it up."
      : "Sent. This page cannot post comments: ask the agent to republish it, and to read the board.");
    assert.equal(x.els.wake.hidden, true);
  }
});
aok("wake: a Send before the comments capability resolved says it was sent; 30 s after the start it counts as absent until it resolves; a late capability is adopted", async () => {
  const card = { id: "a", title: "A", options: ["Yes", "No"], status: "open", rev: 1, updated: "2026-01-01T00:00:00+00:00" };
  let resolve;
  const commentsP = new Promise((r) => { resolve = r; });
  const x = wakeBox({ load: true, commentsP, metaDocs: { "meta/config": { tz: "UTC" } },
    cols: { cards: [{ id: "main", data: { cards: [card] } }], responses: [{ id: "a", data: { choice: "Yes", note: "", rev: 1, sent: false, updated: NOWS() } }] } });
  await settle();
  const bound = x.later.filter((l) => l.ms === 30000 && !l.cleared);
  assert.equal(bound.length, 1, "one 30 s bound set at the start");
  x.W.send(); await settle();
  x.W.render();
  assert.ok(x.writes.some(([p]) => p.startsWith("batches/")), "the batch went out");
  assert.deepEqual([x.W.wakeOutcome, x.els.wakestate.textContent, x.els.wake.hidden], ["not_ready_sent", "Sent. The wake is not ready yet: tap Wake in a moment.", false]);
  bound[0].f();                                         // 30 s after the start, still unresolved
  x.W.render();
  assert.deepEqual([x.W.commentsOff, x.W.wakeOutcome, x.els.wakestate.textContent, x.els.wake.hidden],
    [true, "no_capability", "Sent. This page cannot post comments: ask the agent to republish it. The poll every 15 min picks it up.", true]);
  const late = stubComments();
  resolve(late); await settle();                       // resolves at 31 s: adopted
  assert.equal(x.W.comments, late, "a late capability is adopted");
  assert.equal(late.sent.length, 0, "adopting it wakes nobody");
  x.W.resp.set("a", Object.assign(x.W.coerce("response", { choice: "No", note: "", rev: 1, sent: false, updated: NOWS() }), { itemId: "a" }));
  x.W.send(); await settle();
  x.W.render();
  assert.equal(late.sent.length, 1, "the next Send wakes once");
  assert.deepEqual([x.W.wakeOutcome, x.els.wakestate.textContent, x.els.wake.hidden], ["sent", "Sent, and the agent was woken by a comment.", true]);
  // A capability that resolves to null stays absent.
  const y = wakeBox({ load: true, commentsP: Promise.resolve(null), metaDocs: { "meta/config": { tz: "UTC" } } });
  await settle();
  assert.deepEqual([y.W.comments, y.W.commentsOff], [null, true]);
  assert.equal(await y.W.wakeAgent(y.W.wakeAnchor()), "no_capability");
});
aok("load: the page starts, reads the board and wakes nobody and sends nothing", async () => {
  const card = { id: "a", title: "A", options: ["Yes", "No"], status: "open", rev: 1, updated: "2026-01-01T00:00:00+00:00" };
  const comments = stubComments();
  const x = wakeBox({ load: true, comments, metaDocs: { "meta/config": { tz: "UTC" } },
    cols: { cards: [{ id: "main", data: { cards: [card] } }], responses: [{ id: "a", data: { choice: "Yes", note: "", rev: 1, sent: false, updated: NOWS() } }] } });
  await settle();
  for (const l of x.later.slice()) if (!l.cleared) l.f();         // every timer the page set while it started fires
  await settle();
  x.W.render();
  assert.equal(x.W.comments, comments, "the comments capability resolved");
  assert.equal(x.W.unsentCount(), 1, "an unsent answer is there to send");
  assert.deepEqual([comments.sent.length, comments.asked, x.W.wakeOutcome], [0, 0, ""]);
  assert.ok(!x.writes.some(([p]) => p.startsWith("batches/") || p.startsWith("responses/") || p === "meta/wake"), JSON.stringify(x.writes));
  assert.deepEqual(Object.keys(x.W.seenCards), ["a"], "the first visit set the baseline");
});
aok("seen: the first render sets the baseline, so a first visit shows no dot; a later change shows one", async () => {
  const x = wakeBox();
  answered(x);
  assert.equal(x.W.seenCards, null);
  x.W.render();
  assert.deepEqual(JSON.parse(x.store["decision-board-cards-seen-v1"]), { a: "2026-01-01T00:00:00+00:00" });
  assert.equal(x.W.dotCount(), 0);
  x.W.items.set("a", Object.assign({}, x.W.items.get("a"), { updated: "2026-01-02T00:00:00+00:00" }));
  assert.equal(x.W.dotCount(), 1);
  x.W.seenOne("a");
  assert.equal(x.W.dotCount(), 0, "an answer or a control marks that card seen");
  const y = wakeBox({ store: { "decision-board-cards-seen-v1": JSON.stringify({ a: "2025-12-01T00:00:00+00:00" }) } });
  answered(y);
  y.W.seenCards = y.W.seenFrom(y.store["decision-board-cards-seen-v1"]);
  y.W.render();
  assert.equal(y.W.dotCount(), 1, "a stored map is no first visit");
});
aok("strip: hidden before the config loads; Mark all seen shows while a dot shows and clears it; the fold stays open over a render", async () => {
  const x = wakeBox();
  answered(x);
  x.W.loaded.config = false;
  x.W.renderNow();
  assert.equal(x.els.agentnow.hidden, true);
  x.W.loaded.config = true;
  x.W.seenCards = x.W.seenFrom(JSON.stringify({ a: "2025-12-01T00:00:00+00:00" }));
  x.W.renderNow();
  assert.equal(x.els.agentnow.hidden, false);
  const btn = () => x.els.agentnow.querySelectorAll("button").find((b) => b.textContent === "Mark all seen");
  assert.ok(x.els.agentnow.textContent.includes("No status from the agent yet"));
  assert.ok(btn(), "one dot: the button shows");
  btn().listeners.click();
  assert.equal(x.W.dotCount(), 0);
  x.W.renderNow();
  assert.equal(btn(), undefined, "no dot: no button");
  const d1 = x.els.agentnow.querySelector("details");
  d1.open = true;
  x.W.agentStatus = x.W.coerce("status", { now: "Build", next: ["Mail"], waiting: "", updated: NOWS() });
  x.W.renderNow();
  const d2 = x.els.agentnow.querySelector("details");
  assert.ok(d2 !== d1 && d2.open === true, "rebuilt and still open");
  assert.ok(x.els.agentnow.textContent.includes("Now: Build") && x.els.agentnow.textContent.includes("Mail"));
});
aok("config wait: before meta/config loads, a save, a note, a Send, a control and a guide status write nothing; once it loads they write with the config offset", async () => {
  const x = wakeBox({ realReady: true }), W = x.W;
  Object.assign(W.loaded, { items: true, responses: true, notes: true, config: false });
  const it = W.coerce("item", { id: "a", title: "A", options: ["Yes", "No"], status: "open", rev: 1, updated: "2026-01-01T00:00:00+00:00" });
  W.items.set("a", it);
  W.resp.set("a", Object.assign(W.coerce("response", { choice: "Yes", note: "", rev: 1, sent: false, updated: "2026-01-01T00:00:00+00:00" }), { itemId: "a" }));
  W.guides.set("g", W.coerce("guide", { id: "g", title: "G", status: "active" }));
  const c = { it, broken: false, undo: null, fs: { querySelector: () => ({ value: "No" }) }, ta: { value: "typed" }, save: new El("span") };
  W.cards.set("a", c);
  const tryAll = () => { W.saveResponse("a"); W.$("newnote").value = "hello"; W.addNote(); W.send(); W.setControl(c, { done: true }, null); W.setGuideStatus("g", "archived"); };
  W.renderSync();
  assert.equal(W.$("sync").textContent, "Loading", "the sync text says the page still loads");
  tryAll(); await settle();
  assert.deepEqual(x.writes, [], "nothing before the config");
  assert.deepEqual([W.timers.has("a"), W.isPending("a"), W.$("newnote").value, W.$("notestate").textContent], [true, true, "hello", "Saving"], "the answer stays pending, the note stays in its box");
  W.renderSync();
  assert.equal(W.$("sync").textContent, "Loading", "a held answer does not read as Saving");
  assert.deepEqual([W.$("msg").textContent, W.$("msg").hidden], ["The board is still loading. Try again in a moment.", false], "the guide click says why nothing happened");
  W.$("newnote").value = "hello again";                 // typed on while the note waits: the latest text wins
  W.applyConfigDoc({ exists: true, data: () => ({ tz: "Asia/Kolkata", controls: { done: true } }) });
  await settle();
  const n1 = x.writes.filter(([p]) => p.startsWith("notes/"));
  assert.ok(n1.length === 1 && n1[0][1].text === "hello again" && /\+05:30$/.test(n1[0][1].created), "the waiting note is added once the config is in: " + JSON.stringify(x.writes));
  assert.equal(W.$("newnote").value, "");
  for (const l of x.later.slice()) if (!l.cleared && l.ms === 700) l.f();   // the held answer saves itself
  await settle();
  const r1 = x.writes.find(([p]) => p === "responses/a");
  assert.ok(r1 && r1[1].choice === "No" && r1[1].note === "typed" && /\+05:30$/.test(r1[1].updated), JSON.stringify(x.writes));
  x.writes.length = 0;
  tryAll(); await settle();
  const by = (pre) => x.writes.filter(([p]) => p.startsWith(pre));
  assert.ok(by("notes/").length === 1 && /^notes\/n\d{8}T\d{6}\+0530-abcd$/.test(by("notes/")[0][0]) && /\+05:30$/.test(by("notes/")[0][1].created), JSON.stringify(x.writes));
  assert.ok(by("batches/").length === 1 && /\+0530-abcd$/.test(by("batches/")[0][0]) && /\+05:30$/.test(by("batches/")[0][1].created), JSON.stringify(x.writes));
  assert.ok(by("responses/a").some(([, d]) => d.controls && d.controls.done === true && /\+05:30$/.test(d.updated)), JSON.stringify(x.writes));
  assert.ok(by("guides/g").length === 1 && /\+05:30$/.test(by("guides/g")[0][1].updated), JSON.stringify(x.writes));
  assert.equal(W.$("newnote").value, "", "the note was saved and its box cleared");
  // loaded.config is set also when meta/config does not exist, or its read fails.
  for (const o of [{ load: true }, { load: true, configFails: true }]) { const y = wakeBox(o); y.W.loaded.config = false; await settle(); assert.equal(y.W.loaded.config, true, JSON.stringify(o)); }
  // meta/config never arrives: after 10 s the sync line says so, though the cards and answers loaded.
  const z = wakeBox({ load: true, configNever: true, realReady: true });
  z.W.loaded.config = false;                // the page starts with it false; the sandbox default is true
  await settle();
  assert.equal(z.W.loaded.config, false);
  for (const l of z.later.slice()) if (!l.cleared && l.ms === 10000) l.f();
  assert.equal(z.W.$("sync").textContent, "Cannot reach the database yet");
  z.W.renderSync();                                    // as the retry of a held answer does
  assert.equal(z.W.$("sync").textContent, "Cannot reach the database yet", "the text stays until the data is in");
  z.W.applyConfigDoc(null); z.W.renderSync();
  assert.notEqual(z.W.$("sync").textContent, "Cannot reach the database yet", "the data is in");
  // A note queued before the config, then its box emptied: nothing is added and the note state clears.
  const e = wakeBox({ realReady: true });
  Object.assign(e.W.loaded, { items: true, responses: true, notes: true, config: false });
  e.W.$("newnote").value = "x"; e.W.addNote();
  assert.equal(e.W.$("notestate").textContent, "Saving");
  e.W.$("newnote").value = "";
  e.W.applyConfigDoc(null); await settle();
  assert.deepEqual([e.writes, e.W.$("notestate").textContent], [[], ""]);
});
(async () => {
  let k = 0;
  for (const [name, fn] of tests) { await fn(); console.log("ok async " + ++k + " " + name); }
})().catch((e) => { console.error(e); process.exit(1); });
