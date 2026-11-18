// Links, tags and the first ask of a card, as the page checks and shows them. Run: node fields-test.js [board.html]. Exits 1 on the first failure.
const assert = require("node:assert/strict");
const { load, ok } = require("./_page.js");
const P = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
const shown = (links) => plain(P.validLinks(P.coerce("item", { id: "a", links })));

ok("config: link_hosts keeps hosts with two labels or more, lower case, like domains; tags follow the idList rules", () => {
  P.applyConfig({ link_hosts: [" Example.COM ", "invalid", "a..b", 5, "wiki.invalid"], tags: [{ id: "cost", label: "Costs money" }, { id: "cost", label: "again" }, { id: " sec " }, { label: "x" }, "y"] });
  assert.deepEqual(plain(P.cfg.link_hosts), ["example.com", "wiki.invalid"]);
  assert.deepEqual(plain(P.cfg.tags), [{ id: "cost", label: "Costs money" }, { id: "sec", label: "sec" }]);
  assert.deepEqual(plain(P.cfg.domains), [], "link_hosts does not open reference guides");
  P.applyConfig({ link_hosts: ["2.10", "192.0.2.10", "192.0.2.300", "a1.b2", "a.b2", "abc.invalid", "ab.cd.invalid", "x.invalid"], domains: ["a1.b2", "203.0.113.5"] });
  assert.deepEqual(plain(P.cfg.link_hosts), ["192.0.2.10", "abc.invalid", "ab.cd.invalid", "x.invalid"], "an entry of digits is a full IPv4 address; two short labels look like a public suffix");
  assert.deepEqual(plain(P.cfg.domains), ["203.0.113.5"]);
  assert.equal(P.linkProblem("https://192.0.2.10/x"), "");
  assert.equal(P.hostOk("1.192.0.2.10", P.cfg.link_hosts), false, "an IPv4 entry has no subdomains");
  assert.equal(P.hostOk("wiki.x.invalid", P.cfg.link_hosts), true);
  P.applyConfig(null);
  assert.deepEqual([plain(P.cfg.link_hosts), plain(P.cfg.tags)], [[], [{ id: "alert", label: "Alert" }, { id: "incident", label: "Incident" }]]);
});
ok("a link is valid for https:, no user name or password, a listed host or a subdomain, on any port", () => {
  P.applyConfig({ link_hosts: ["example.com", "invalid", "wiki.invalid"] });
  assert.equal(P.linkProblem("https://example.com/a"), "");
  assert.equal(P.linkProblem("https://a.b.example.com:8443/x"), "", "a subdomain on another port");
  assert.equal(P.linkProblem("http://example.com/"), "not an https: URL");
  assert.equal(P.linkProblem("javascript:alert(1)"), "not an https: URL");
  assert.equal(P.linkProblem("https://user@example.com/"), "has a user name or password");
  assert.equal(P.linkProblem("https://:pw@example.com/"), "has a user name or password");
  assert.equal(P.linkProblem("https://other.invalid/"), "host \"other.invalid\" is not on link_hosts");
  assert.equal(P.linkProblem("https://notwiki.invalid/"), "host \"notwiki.invalid\" is not on link_hosts", "a suffix is not a subdomain");
  assert.equal(P.linkProblem("https://example.com.other.invalid/"), "host \"example.com.other.invalid\" is not on link_hosts");
  assert.equal(P.linkProblem("https://invalid/x"), "host \"invalid\" is not on link_hosts", "a one-label host in link_hosts matches nothing");
  assert.equal(P.linkProblem("/relative"), "not a URL");
  assert.equal(P.linkProblem(5), "not text");
  P.applyConfig(null);
  assert.equal(P.linkProblem("https://example.com/"), "no link_hosts in the config: set link_hosts in meta/config");
});
ok("the page shows only valid links, at most 10, with the label or else the host as text", () => {
  P.applyConfig({ link_hosts: ["example.com"] });
  assert.deepEqual(shown([{ label: "Graph", url: "https://grafana.example.com/d/1" }, { label: "", url: "https://Wiki.Example.com/a b" }, { label: "bad", url: "http://example.com/" },
    { label: "user", url: "https://u:p@example.com/" }, { url: "https://other.invalid/" }, "https://example.com/", { label: "  " , url: " https://example.com/x " }]),
  [{ href: "https://grafana.example.com/d/1", text: "Graph", host: "grafana.example.com" }, { href: "https://wiki.example.com/a%20b", text: "wiki.example.com", host: "wiki.example.com" },
    { href: "https://example.com/x", text: "example.com", host: "example.com" }]);
  assert.equal(shown(Array.from({ length: 12 }, (_, i) => ({ label: "L" + i, url: "https://example.com/" + i }))).length, 10);
  assert.deepEqual(shown(undefined), []);
  assert.deepEqual(shown("https://example.com/"), [], "a links value that is not a list shows nothing");
  P.applyConfig(null);
  assert.deepEqual(shown([{ label: "Graph", url: "https://grafana.example.com/d/1" }]), [], "without link_hosts no link shows");
});
ok("tags: each known id once, as its label; unknown ids are dropped", () => {
  P.applyConfig({ tags: [{ id: "cost", label: "Costs money" }, { id: "sec" }] });
  assert.deepEqual(plain(P.tagChips(P.coerce("item", { tags: ["sec", "nope", "cost", "sec", 5] }))), [{ id: "sec", label: "sec" }, { id: "cost", label: "Costs money" }]);
  assert.deepEqual(plain(P.tagChips(P.coerce("item", { tags: "cost" }))), []);
  assert.deepEqual(plain(P.tagChips(P.coerce("item", { tags: ["Cost", "COST", " cost"] }))), [], "tag ids match by case and exactly");
  P.applyConfig(null);
  assert.deepEqual(plain(P.tagChips(P.coerce("item", { tags: ["cost"] }))), []);
});
ok("first_asked: a real calendar date, and required only on an open card whose kind is not info", () => {
  assert.deepEqual(["2026-01-31", "2024-02-29", "2026-02-29", "2026-13-01", "2026-00-10", "2026-1-01", "20260101", "2026-01-01T00:00", 20260101, ""].map(P.realDate),
    [true, true, false, false, false, false, false, false, false, false]);
  assert.deepEqual([{}, { status: "open" }, { kind: "action" }, { kind: "info" }, { status: "closed" }, { status: "answered" }, { kind: "info", status: "open" }].map(P.needsAsked),
    [true, true, true, false, false, false, false]);
  P.applyConfig({ kinds: [{ id: "info" }, { id: "decision" }] });
  assert.equal(P.needsAsked({}), true, "the default kind is decision; a config cannot change it");
  P.applyConfig(null);
  assert.equal(P.coerce("item", { first_asked: "2026-01-01" }).first_asked, undefined, "a first_asked that is not an object reads as absent");
});
ok("the age text: First asked MM-DD (who), N days, counted in calendar days of the config tz", () => {
  const at = (date, who, now, tz) => P.askedText(P.coerce("asked", { date, who }), now, tz || "UTC");
  assert.equal(at("2026-01-02", "infra-agent", Date.UTC(2026, 0, 12, 0, 1)), "First asked 01-02 (infra-agent), 10 days");
  assert.equal(at("2026-01-02", "infra-agent", Date.UTC(2026, 0, 12, 23, 59)), "First asked 01-02 (infra-agent), 10 days", "the hour of the day does not count");
  assert.equal(at("2025-12-31", "", Date.UTC(2026, 0, 1, 0, 0)), "First asked 12-31, 1 day", "an empty who leaves out the brackets");
  assert.equal(at("2026-03-01", "x", Date.UTC(2026, 2, 1, 12)), "First asked 03-01 (x), 0 days");
  assert.equal(at("2026-03-29", "x", Date.UTC(2026, 2, 30, 12), "Europe/Warsaw"), "First asked 03-29 (x), 1 day", "a daylight saving change keeps whole days");
  assert.equal(at("2026-03-05", "x", Date.UTC(2026, 2, 1, 12)), "First asked 03-05 (x), 0 days", "a date after today counts 0");
  assert.equal(at("2026-02-30", "x", Date.UTC(2026, 2, 1)), "", "a date that is not real shows nothing");
  assert.equal(at("2026-03-01", "x), 0 days. Approved (y", Date.UTC(2026, 2, 3)), "First asked 03-01, 2 days", "a who that is not a short id is left out");
  assert.equal(at("2026-03-01", "a".repeat(41), Date.UTC(2026, 2, 3)), "First asked 03-01, 2 days");
  assert.equal(P.askedText(undefined, Date.UTC(2026, 2, 3), "UTC"), "");
  // One instant, two zones: the day is the config zone's, never the device's.
  const instant = Date.UTC(2026, 0, 11, 23, 30);
  assert.equal(at("2026-01-01", "x", instant, "UTC"), "First asked 01-01 (x), 10 days");
  assert.equal(at("2026-01-01", "x", instant, "Europe/Warsaw"), "First asked 01-01 (x), 11 days", "23:30 UTC on 01-11 is 01-12 in Warsaw");
  const tz = process.env.TZ;
  try {
    process.env.TZ = "Asia/Tokyo";
    assert.equal(at("2026-01-01", "x", instant, "UTC"), "First asked 01-01 (x), 10 days", "the device zone does not count");
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});
ok("draft: shown when it holds more than spaces; the label defaults to Draft; the text is the field unchanged", () => {
  assert.equal(P.hasDraft(P.coerce("item", { draft: " \n\t" })), false);
  assert.equal(P.hasDraft(P.coerce("item", {})), false);
  assert.equal(P.hasDraft(P.coerce("item", { draft: "x" })), true);
  assert.equal(P.draftLabelOf(P.coerce("item", { draft: "x" })), "Draft");
  assert.equal(P.draftLabelOf(P.coerce("item", { draft: "x", draft_label: "  Reply in the thread " })), "Reply in the thread");
  const s = "Hi Sam,\r\n\n  indented\tTab  \n```\nnot a fence\n```\n<b>x</b> — ✓  ";
  assert.equal(P.draftText(P.coerce("item", { draft: s })), s);
  assert.equal(P.draftText({ draft: 5 }), "");
});
ok("draftWarning: names the label a draft starts with, and nothing for plain text", () => {
  const pairs = [["DRAFT\nHi", "DRAFT"], ["Draft: Hi", "Draft:"], ["[DRAFT] Hi", "[DRAFT]"], ["  Note: send after 5", "Note:"],
    ["**Note:** x", "**Note:"], ["Proposed reply: thanks", "Proposed reply:"], ["```\nHi\n```", "```"],
    ["DRAFT", "DRAFT"], ["Draft\r\nHi", "Draft"], ["Note - send after 5", "Note -"], ["NB:x", "NB:"],
    ["Hi team, note: x", ""], ["Drafting is done.", ""], ["Notes are attached", ""],
    ["Draft agenda for Monday", ""], ["Note-taking is fine", ""], ["Hi", ""], [5, ""]];
  assert.equal(pairs.length, 18);
  pairs.forEach(([t, w]) => assert.equal(P.draftWarning(t), w, JSON.stringify(t)));
});
