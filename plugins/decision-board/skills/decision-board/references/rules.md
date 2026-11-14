# Operator rules

Read this only when a line names it: `check` prints `rules: no .board/rules.md`, or `read` flags a line `[rule]`
or `[standing]`. `S` and `P3` are as in `SKILL.md`.

`.board/rules.md` is guide Markdown: `# Rules`, then one `## <topic>` section per topic, in plain sentences
(which alerts matter, who owns what, what is noise). Only you write it, and only as below. `check` posts it as the
board's Rules tab after each change; never post it with `guide`.

## Start the rules

1. Ask the operator three to five short questions about standing judgments, or draft rules from what you
   already know.
2. Post each proposed rule as a rule card (below). Do not write `.board/rules.md` yet.
3. If the operator declines, write `.board/rules.md` with the line `# Rules` only, then run `node S check` and
   pass its array.

## A rule card

Write the cards as a JSON list to `.board/rules-cards.json`, run `node S sync .board/rules-cards.json` (no
`--source`) and pass the array. Each card: `id` `rule-<topic>` (lower case, words joined by `-`), `source`
`rules`, `kind` `decision`, `title` `Add this rule?`, `options` `["Add it", "Add it with my change, see note",
"Leave it out"]`, `first_asked` `{"date": "<today, YYYY-MM-DD>", "who": "operator"}`, the section name in
`summary`, and the exact rule text in `draft` with `draft_label` `Rule for .board/rules.md`. A rule card needs no
link.

## A `[rule]` line

- `Add it`: add the card's `draft` (the rule text) to the `## <topic>` section of `.board/rules.md` that its
  `summary` names; make the section when it is missing.
- `Add it with my change, see note`: the same, with the note's text as the rule text.
- `Leave it out`: change nothing in `.board/rules.md`.

Then add `--close <id>` to the ack of that batch. After you passed the ack's array, run `node S check` and pass
its array: it posts the file.

## A `[standing]` line

The answer note or the free note states a standing preference. Do what the line asks as usual, then post a rule
card that proposes the preference as a rule.
