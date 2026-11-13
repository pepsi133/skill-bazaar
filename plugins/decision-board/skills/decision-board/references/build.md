# Build a board, change the page

Read this only to build a board or to change or republish the page. `S`, `P1` to `P4` and `URL` are as in `SKILL.md`.

## Build a board

1. Copy `assets/board.html` to `board/`, unchanged.
2. Publish it with `P1`. Record the URL.
3. Read `references/data-model.md`, then write `board/config.json`. Ask the operator for `link_hosts`, the
   hosts card links may point to (every card needs a link to one). `tz` defaults to `Europe/Warsaw`; set `tz` in
   `board/config.json` to change it.
4. Run `node S check` and pass the array. It makes the state, checks the config and the cards, and writes
   `meta/config`. Run it again after every config change.
5. Write the URL into `board/README.md` and give it to the operator (a signed-in claude.ai session).

## Change the page

Database text reaches the page only through `textContent`, `fmtText` or `sanitizeRef`; the fields are in `SCHEMA`,
which the script reads.

1. In a new session, read the artifact first: `Artifact` with `action: "read"` and `url: URL`.
2. Run every test in `../../tests/`; all must pass.
3. Republish with `P1` and `url: URL`, without `icon`. `P1` passes the `capabilities` from
   `references/data-model.md`, which an upgrade from an older page needs.
