# decision-board

A decision board is a private claude.ai artifact page with a database. Agents post cards (a
question with options, or an action) and guides (steps, status, reference pages). The operator
answers on a phone or in a browser and presses Send. Each agent reads the answers that belong to
it, acts, and marks its batch handled.

One unchanged page serves many uses. A config, kept in `board/config.json` and written to the
database, sets the title, the tabs, the priorities and the tags.

## Start a board

1. Install the skill: `claude plugin install decision-board@skill-bazaar`.
2. Ask the agent to build a decision board. It follows `skills/decision-board/SKILL.md`: it
   publishes `skills/decision-board/assets/board.html` as a private artifact with access rules, and writes the config:
   the hosts that card links may point to, and the tabs if you want more than All.
3. Open the artifact link in a signed-in claude.ai session, on any device.

## How the agent works with it

The agent never reads or types card JSON in the conversation. Its cards live in a local state file,
`board/state.json`. `skills/decision-board/scripts/board.mjs sync` applies a card file to it and
prints one write: the agent's whole card list as one document, `cards/<agent>`, pinned to the
version that the state keeps. The page merges the agents' documents. Answers come back as batches,
which the agent dumps and reads with `read`, one short line per answer. The script has no network
access.

## Layout

The agent needs only `skills/` while it runs a board:

- `skills/decision-board/SKILL.md`: the procedures for the agent.
- `skills/decision-board/assets/board.html`: the page. `SCHEMA` in it defines the fields for the
  page and the script.
- `skills/decision-board/scripts/board.mjs`: `check`, `sync`, `close`, `read`, `waiting`, `ack`,
  `guide`, `purge`, `adopt`, `push`.
- `skills/decision-board/assets/wait.sh`: the pause of a watcher between two polls.
- `skills/decision-board/references/`: cards, guides, the data model and access rules, the watch
  brief.
- `docs/how-it-works.html`: how the parts fit together.
- `tests/`: node tests of the page logic and the script, on fixtures.

## Refresh from sources (optional)

The second skill, `skills/board-refresh/`, feeds a board from outside sources. The agent fetches
the rows of a source with the operator's own tools and saves them as JSON;
`skills/board-refresh/scripts/refresh.mjs map` turns them into a card file by a map file that the
operator keeps, and `xref` lists keys that two sources share. The core `sync` then posts the card
file. The adapter has no network access and writes card files only.

## Test it

From the plugin root (this folder):

```
for t in tests/*-test.js tests/*-test.mjs; do node "$t" > /dev/null || echo FAIL "$t"; done
```

The tests need only Node 18 or later, no packages. Each exits with 1 when a check fails.

- `tests/*-test.js` run the part of the page between "pure: start" and "pure: end" in a Node
  sandbox, through `tests/_page.js`: the schema checks, the config, tabs and guides, card states,
  the merge of the agents' card documents, the Done section, what Send takes and the batch it
  writes, and the text formatter. `render-test.js` runs the links, tags and age line of a card,
  the reference sanitizer, and the list of places that write HTML against a small DOM stub.
  `cuts-test.js` checks that removed features stay removed. They take another page file as their
  first argument.
- `tests/board-test.mjs` runs every command of the script against the fixture state and dump in
  `tests/fixtures/` and applies the printed writes to a stand-in database (`tests/fakedb.mjs`),
  which refuses a write pinned to the wrong version as the real one does.
- `tests/loss-test.mjs` covers the cases where a write could drop a card, a close or an answer
  without a message: two state files of one agent, a refused purge or ack, and agent keys.
- `tests/refresh-test.mjs` tests the `board-refresh` skill and its output against `sync`.

No test renders the page in a browser, and no test covers the real database or a real phone.
Check the first use on a phone by eye.
