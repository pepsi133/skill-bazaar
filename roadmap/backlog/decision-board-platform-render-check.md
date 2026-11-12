---
type: skill
proposed_by: pepsi133
created: 2026-11-12
---

# Decision board: a manual render check on the real platform

## Problem

The node tests run the page logic and the sanitizer against a small DOM stub, without a browser.
So they prove what the sanitizer keeps, but not what a browser, or the claude.ai artifact frame,
then renders.
The real frame can differ in these ways:

- Its content security policy can block an image, an SVG `use` or a `url()` fill from a host on
  the config list `domains`, although the sanitizer keeps the reference.
- The Copy button, the clipboard and `target="_blank"` links run inside a sandboxed frame.
- The real database calls, the access levels and the `out_dir` dump format are not the stub.
- WebKit, dark mode and a real phone are not covered.

## Proposed approach

A manual test, run before a release, not in CI:

1. Publish a test board from fixtures, with a reference guide that holds one case per rule:
   a `url(#id)` gradient, a listed host, a subdomain, an unlisted host, an `a` link, a wide table.
2. Open it with Playwright (or a similar driver), take a screenshot per guide tab, and record for
   each case whether it rendered and which requests the frame made.
3. Repeat in WebKit and with dark mode, and once on a phone.
4. Compare with what the node sanitizer tests expect, and record every difference as a fact
   about the platform in `references/guides.md`.

## Facts that shape the test

- The artifact frame's content security policy blocks images, stylesheets and fetches from every
  host except the page's own files and `data:` URIs, script CDNs included. So a remote `url()` or
  `use` that the sanitizer keeps for a host on `domains` is expected to load nothing on claude.ai.
  Uploaded assets of the `assets` capability are served from the artifact's own origin.
- `claude.use("db")` returns `null` for a signed-out viewer, so a public link shows an empty board.
  Guide rendering on the platform needs a signed-in viewer or a static page without a database.
- claude.ai answers a headless browser with a bot check, so a logged-out automated browser does
  not reach the page. Do not try to get around the check.

## Approach that works

A static probe page, with no database, that holds the markup the sanitizer keeps and reports
its own results on the page: which images and SVG references loaded, which the frame blocked,
whether a link opened and whether Copy worked. The operator opens it while signed in, in each
browser and theme, and copies the result block. The page needs no public share.

## Done when

The test runs from one script plus written steps for the login part, and `references/guides.md`
states what the real frame loads from a listed host.
