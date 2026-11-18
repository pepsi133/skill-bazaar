# Build a board, change the page

Read this only to build a board or to change or republish the page. `S`, `P1` to `P4` and `URL` are as in `SKILL.md`.

## Build a board

1. Read `references/data-model.md`, then write `.board/config.json`. `title` is required: the board's own name, never
   "Decision Board". `link_hosts` are the hosts of the links your cards carry (a card needs no link; a link it carries
   must point to one of them); leave it out when there are none. `tz` defaults to `UTC`; set `tz` to change it.
   Private values that hold for all the operator's boards on this machine (`tz`, `week_start`, `link_hosts`, `tags`,
   `checks`, `people`) go in the user file instead, outside every repository: its path is on the `config layers:`
   line of `check` (data-model.md, "The config"). All quick controls (`controls`) are off by default; turn on only
   what the operator asked for.
2. Run `node S page`. It writes `.board/board.html` titled `<title> [DB]` and refuses a missing or generic title.
3. Publish it with `P1`, passing the title the script printed. Record the URL.
4. Run `node S check --url URL` and pass the array. It makes the state, merges the config layers and prints the layer of
   each key, checks the config and the cards, and writes `meta/config`. Run it again after every config change.
5. Write the URL into `.board/README.md` and give it to the operator (a signed-in claude.ai session).
6. If `check` printed a `rules:` line, do what it says.

## Change the page

Database text reaches the page only through `textContent`, `fmtText` or `sanitizeRef`; the fields are in `SCHEMA`,
which the script reads.

1. In a new session, read the artifact first: `Artifact` with `action: "read"` and `url: URL`.
2. From the plugin root (`../..` from the skill folder) run `for t in tests/*-test.*; do node "$t" || break; done`; all must pass.
3. Run `node S page`, then republish with `P1` and `url: URL`, without `icon`. `P1` passes the `capabilities` from
   `references/data-model.md`, which an upgrade from an older page needs.
