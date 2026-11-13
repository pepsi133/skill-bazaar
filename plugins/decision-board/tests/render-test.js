// The DOM code of the page, against a small DOM stub: the tags, links and first ask of a card,
// the reference sanitizer, and the list of places that write HTML. Run: node render-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pageFile, cut, load, ok } = require("./_page.js");

// ---- a DOM stub: elements, text, attributes, and a record of every HTML write
const htmlWrites = [];
class Text { constructor(t) { this.nodeType = 3; this.data = t; this.parentNode = null; } get textContent() { return this.data; } remove() { El.prototype.remove.call(this); } }
class El {
  constructor(tag) { this.localName = tag; this.nodeType = 1; this.childNodes = []; this.attrs = new Map(); this.parentNode = null; }
  get attributes() { return Array.from(this.attrs, ([name, value]) => ({ name, value })); }
  setAttribute(n, v) { this.attrs.set(n.toLowerCase(), String(v)); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  hasAttribute(n) { return this.attrs.has(n); }
  removeAttribute(n) { this.attrs.delete(n.toLowerCase()); }
  set className(v) { this.setAttribute("class", v); }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.childNodes.push(c); return c; }
  append(...k) { k.forEach((c) => this.appendChild(typeof c === "string" ? new Text(c) : c)); }
  insertBefore(c, ref) { if (c.parentNode) c.remove(); c.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); return c; }
  remove() { const p = this.parentNode; if (p) { p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; } }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.childNodes.forEach((c) => (c.parentNode = null)); this.childNodes = []; if (v !== "") this.appendChild(new Text(String(v))); }
  set innerHTML(v) { htmlWrites.push(v); }
  addEventListener() {}
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
const document = { createElement: (t) => new El(t), createDocumentFragment: () => new El("#fragment"), adoptNode: (n) => n };
const DOMParser = class { parseFromString(s) { return parse(s); } };
const P = load({ document, DOMParser },
  cut("  function h(tag, attrs)", "  function fmt(s)") + cut("  function set(s)", "  // ---- cards. Every DOM id") + cut("  function renderMeta", "  function updateCard"));

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
  Q.applyConfig({ tz: "UTC", settings: "Settings: board/config.json" });
  assert.equal(Q.cfg.settings, "Settings: board/config.json");
  Q.applyConfig({ tz: "UTC", settings: 5 });
  assert.equal(Q.cfg.settings, "");
  Q.applyConfig({ tz: "UTC" });
  assert.equal(Q.cfg.settings, "");
});
