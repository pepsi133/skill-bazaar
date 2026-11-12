// Filter controls (segmented rows and switches). Run: node sliders-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, cut, ok } = require("./_page.js");
// A minimal DOM stub: enough for renderSeg and setSwitch.
function el() {
  const a = {}, k = [];
  return { children: k, attrs: a, setAttribute(n, v) { a[n] = String(v); }, getAttribute(n) { return a[n] === undefined ? null : a[n]; },
    set textContent(v) { k.length = 0; }, append(c) { k.push(c); }, addEventListener(t, fn) { (this.l = this.l || {})[t] = fn; },
    focus() {}, tabIndex: 0, click() { this.l.click(); } };
}
const h = (tag, at) => { const e = el(); for (const n in at) if (n !== "text") e.setAttribute(n, at[n]); e.label = at.text; return e; };
const P = load({ h }, cut("  function areaOptions", "  function render()"));
const f = { area: "", prio: "" };
const areas = ["drive", "github", "gmail", "vm"];
const abox = el(), pbox = el();
const show = (b) => b.children.map((c) => c.label + (c.attrs["aria-checked"] === "true" ? "*" : "") + "/" + c.tabIndex).join(" ");
const draw = (list) => { P.renderSeg(abox, P.areaOptions(list || areas), f.area, (v) => (f.area = v)); P.renderSeg(pbox, P.prioOptions(), f.prio, (v) => (f.prio = v)); };

ok("first render selects All", () => {
  draw();
  assert.equal(show(abox), "All*/0 drive/-1 github/-1 gmail/-1 vm/-1");
  assert.equal(show(pbox), "All*/0 Now/-1 Soon/-1 Later/-1");
});
ok("a pick moves the selection and the tab stop", () => {
  abox.children[3].click(); pbox.children[2].click(); draw();
  assert.deepEqual(f, { area: "gmail", prio: "soon" });
  assert.equal(show(abox), "All/-1 drive/-1 github/-1 gmail*/0 vm/-1");
  assert.equal(show(pbox), "All/-1 Now/-1 Soon*/0 Later/-1");
});
ok("same options keep the nodes, new options rebuild", () => {
  const before = abox.children[0]; draw();
  assert.equal(abox.children[0], before);
  draw(areas.concat("plan"));
  assert.notEqual(abox.children[0], before);
  assert.equal(show(abox), "All/-1 drive/-1 github/-1 gmail*/0 vm/-1 plan/-1");
});
ok("an unknown value falls back to All", () => {
  f.area = "gone"; draw();
  assert.equal(show(abox), "All*/0 drive/-1 github/-1 gmail/-1 vm/-1");
});
ok("a switch toggles aria-checked", () => {
  const sw = el(); let on = true;
  sw.addEventListener("click", () => { on = !on; P.setSwitch(sw, on); });
  P.setSwitch(sw, on); assert.equal(sw.attrs["aria-checked"], "true");
  sw.click(); assert.equal(sw.attrs["aria-checked"], "false");
  sw.click(); assert.equal(sw.attrs["aria-checked"], "true");
});
