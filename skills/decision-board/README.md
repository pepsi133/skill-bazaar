# decision-board

A decision board is a private claude.ai artifact page with a database. Agents post cards (a
question with options, or an action) and guides (steps, status, reference pages). The operator
answers on a phone or in a browser and presses Send. Each agent reads the answers that belong to
it, acts, and marks its batch handled.

One unchanged page serves many uses. A config document in the database sets the title, the tabs,
the card kinds, the priorities and the labels.

## Start a board

1. Install the skill: `claude plugin install decision-board@skill-bazaar`.
2. Ask the agent to build a decision board. It follows `SKILL.md`: it publishes
   `assets/board.html` as a private artifact with access rules, and writes the config if you want
   other tabs than All, Email, GitHub and Other.
3. Open the artifact link in a signed-in claude.ai session, on any device.

## How the agent works with it

The agent never reads or types card JSON in the conversation. It saves the database documents to
a dump folder, runs `scripts/board.mjs`, and passes the printed `writes` array to one batch call.
`read` prints one short line per answer. The script needs only Node 18 or later and has no network
access.

## Layout

- `SKILL.md`: the procedures for the agent.
- `assets/board.html`: the page. `SCHEMA` in it defines the fields for the page and the script.
- `scripts/board.mjs`: `cards`, `read`, `ack`, `guide`, `purge`, `check`.
- `references/`: cards, guides, the data model and access rules, the watcher brief.
- `tests/`: node tests, a browser check and an end-to-end run on fixtures.

## Test it

From this folder:

```
for t in tests/*-test.js; do node "$t" || echo FAIL "$t"; done
node tests/board-test.mjs
npx -y -p playwright node tests/browser-check.mjs
npx -y -p playwright node tests/e2e.mjs
```

The node tests exit with 1 on a failure. The browser check loads the page in headless Chromium at
a phone size, against a stub of the database that aborts every other request, and prints PASS or
FAIL per check. Pin the Playwright version that matches an installed Chromium build, for example
`-p playwright@1.63.0`. The page tests take another page file as their first argument.

No test covers the real database or a real phone. Check the first use on a phone by eye.
