# decision-board

A decision board is a private claude.ai artifact page with a database. An agent posts cards (a
question with options, or an action) and guides (steps, status, reference pages). The operator
answers on a phone or in a browser and presses Send. The agent reads the answers, acts, and marks
the batch handled.

One unchanged page serves many uses. A config, kept in `.board/config.json` and optional layers
around it, merged by `check` and written to the database, sets the title, the tabs, the groups and
their order, the priorities and the tags. Cards due today show in a strip at the top.

## Start a board

1. Install the skill: `claude plugin install decision-board@skill-bazaar`.
2. Ask the agent to build a decision board. It follows `skills/decision-board/SKILL.md`: it
   publishes `skills/decision-board/assets/board.html` as a private artifact with access rules, and writes the config:
   the hosts that card links may point to, and the tabs if you want more than All. Private settings that
   hold for all your boards on one machine (time zone, hosts, tags) live in a user file outside any
   repository, `~/.config/decision-board/config.json` (see `references/data-model.md`).
3. Open the artifact link in a signed-in claude.ai session, on any device.

## How the agent works with it

The agent never reads or types card JSON in the conversation. Its cards live in a local state file,
`.board/state.json` (`.board` is a hidden folder; `ls -a` shows it). `skills/decision-board/scripts/board.mjs sync`
applies a card file to it and prints one write: the whole card list as one document, `cards/main`,
pinned to the version that the state keeps. Answers come back as batches. A watcher queries only the batches whose status is
`sent`, and `read` prints one short line per answer. Every time is written with the offset of the
config `tz`. The script has no network access. The operator's standing judgments live in
`.board/rules.md`; every new rule reaches it through a card the operator answers, and `check` posts the
file as the Rules tab.

Quick controls on a card (assign, snooze, dismiss, close in the source, done, tags) are off until
the config turns them on. A tap acts on the page at once; the change goes out in the next batch
with the answers, `read` prints one `control` line per changed control with the step to take, and
`ack` applies the ones that only move a card. Only a `close` control or an assign to the agent
lets the agent write to a source, and only in that one item.

The agent says what it does with `status`: one small write that the page shows as a strip at the top,
greyed when it is old. `ack --result` puts one line under a card, saying what the agent did with the
answer. A dot marks a card the agent changed since you last marked it seen.

## Wake modes

`wake.mode` in the config sets how the agent learns of a Send; `skills/decision-board/scripts/board.mjs watch` reads it and says what to do.

| Mode | How | Cost while idle | Cost per Send |
|---|---|---|---|
| `comment` | Send posts a short comment to Claude, which wakes the session that watches the board; if the page cannot post it, a Wake the agent button shows | none | one full read in the owning session |
| `poll` (300 s, 24 polls) | a background watcher on a cheap model | 3 watcher tool calls per poll, 36 an hour, for at most 2 hours | the watcher's report, then one full read |
| `both` (default; 900 s, 32 polls) | a comment, and a slow poll that catches a missed one | 4 watcher tool calls per poll (the 900 s wait is two calls), 16 an hour, for at most 8 hours | one full read; a poll that sees the same batch adds a read that finds nothing |
| `off` | you tell the agent to read the board | none | one full read |

Each watcher tool call is a model turn, and the watcher's context grows over its run. The figures count calls,
not measured tokens. When a watcher reaches its poll limit it stops, and no new watcher starts until you ask the
agent to watch again; the status strip then shows that the window ended. The strip shows the window of the
last watcher the agent started; it does not prove that the watcher still runs. A page published before version
0.9.0 cannot post comments: the agent republishes it ("Change the page" in `references/build.md`).

## Layout

The agent needs only `skills/` while it runs a board:

- `skills/decision-board/SKILL.md`: the procedures for the agent.
- `skills/decision-board/assets/board.html`: the page. `SCHEMA` in it defines the fields for the
  page and the script.
- `skills/decision-board/scripts/board.mjs`: `check`, `sync`, `close`, `read`, `waiting`, `ack`,
  `status`, `watch`, `guide`, `purge`, `adopt`, `push`.
- `skills/decision-board/assets/wait.sh`: the pause of a watcher between two polls.
- `skills/decision-board/assets/config.example.json`: an example config with example checks.
- `skills/decision-board/references/`: cards, guides, the data model and access rules, the watch
  brief, building a board and changing the page, and the clean up.
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
  the cards document, the groups and the sort order, what Send takes and the batch it
  writes, and the text formatter. `render-test.js` runs the links, tags and age line of a card,
  the reference sanitizer, and the list of places that write HTML against a small DOM stub.
  `cuts-test.js` checks that removed features stay removed. `due-test.js` covers the due dates,
  the week start and the Due today strip, `groups-test.js` the groups and the sort.
  `controls-test.js` covers the quick controls. `tests/time-test.js` covers the time stamps, the
  zone and DST. They take another page file as their first argument.
- `tests/board-test.mjs` runs every command of the script against the fixture state and dump in
  `tests/fixtures/` and applies the printed writes to a stand-in database (`tests/fakedb.mjs`),
  which refuses a write pinned to the wrong version as the real one does.
- `tests/loss-test.mjs` covers the cases where a write could drop a card, a close or an answer
  without a message: two state files in one folder, a refused purge or ack.
- `tests/refresh-test.mjs` tests the `board-refresh` skill and its output against `sync`.

No test renders the page in a browser, and no test covers the real database or a real phone.
Check the first use on a phone by eye.
