// Formatter checks. Run: node fmt-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
const fmt = (s) => P.fmtText(s);

ok("plain text: paragraphs and a line break", () => {
  assert.equal(fmt("one\ntwo\n\nthree"), "<p>one<br>two</p><p>three</p>");
});
ok("HTML is escaped, markers become tags", () => {
  const o = fmt("### Filter\nBefore: `from:a&b <script>alert(1)</script>`\nNow: **blocked**\nYour answer: pick one\n\n- one fact\n- two <b>facts</b>");
  assert.equal(o, "<h4>Filter</h4><p><strong>Before:</strong> <code>from:a&amp;b &lt;script&gt;alert(1)&lt;/script&gt;</code><br>" +
    "<strong>Now:</strong> <strong>blocked</strong><br><strong>Your answer:</strong> pick one</p><ul><li>one fact</li><li>two &lt;b&gt;facts&lt;/b&gt;</li></ul>");
  assert.ok(!/<script|<b>/i.test(o));
});
ok("numbered steps keep their numbers around a fenced block", () => {
  const o = fmt("1. Open\n2. Add:\n```\nx **not bold** <b>&\n```\n3. Save\n\n7. Seven");
  assert.deepEqual(o.match(/<ol start="\d+">/g), ['<ol start="1">', '<ol start="3">', '<ol start="7">']);
  assert.equal((o.match(/class="copy"/g) || []).length, 1);
  assert.ok(o.includes("<pre>x **not bold** &lt;b&gt;&amp;</pre>"));
});
ok("a fence keeps blank lines and markers literal; an open fence ends at the end", () => {
  const o = fmt("```\n<script>x</script>\n\n- not a bullet\n```\nAfter\n```\nnever closed");
  assert.equal((o.match(/<pre>/g) || []).length, 2);
  assert.ok(o.includes("&lt;/script&gt;\n\n- not a bullet") && !o.includes("<ul>"));
});
ok("the section labels are fixed; a config labels list changes nothing", () => {
  P.applyConfig({ labels: ["Was"] });
  assert.equal(fmt("Was: old\nBefore: x\nRisk: y"), "<p>Was: old<br><strong>Before:</strong> x<br><strong>Risk:</strong> y</p>");
  P.applyConfig(null);
});
ok("quotes and ampersands are escaped too, so text cannot leave an attribute", () => {
  assert.equal(fmt(`a "b" 'c' & <d>`), "<p>a &quot;b&quot; &#39;c&#39; &amp; &lt;d&gt;</p>");
  assert.equal(P.esc(`"'&<>`), "&quot;&#39;&amp;&lt;&gt;");
});
