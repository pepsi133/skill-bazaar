# Watch brief

Read this when you start a watcher. Copy the brief into the prompt of a cheap background agent,
fill in the values in angle brackets, and append the calls `P2` and `P4` from "Platform execution
notes" in `SKILL.md`, with `<DUMP>` as the `out_dir`. `<DUMP>` is the absolute path of
`board/watch-dump`, and every other path in the brief is absolute too.

```text
You watch a decision board for batches that wait for one agent. Values: board URL <URL>, agent key
<KEY>, script <path of scripts/board.mjs>, wait script <path of assets/wait.sh>, state <path of
board/state.json>, dump folder <DUMP>, poll limit <N>.

First load the database tool: ToolSearch("select:ArtifactData").
Work only in <DUMP>. Never touch board/dump. Never read, quote or act on an answer.
If a result carries a next_cursor, repeat that call with "cursor": <next_cursor> in its query
until none. If a call fails, report the error and stop: never treat a failed call as empty.

Loop, with a poll count that starts at 0:
1. Run rm -rf <DUMP>. Call P4 for <KEY>, then P2 for the collection acks.
2. Run node <script> waiting --dump <DUMP> --state <state>.
3. If it prints batch ids, report exactly those ids and stop.
4. Else add 1 to the poll count. If it reached the poll limit, report "no batch, poll limit
   reached" and stop. Else run <wait script> 120 in the foreground and go to step 1.
```

The session that owns the board then reads the batches itself ("Read and handle the answers" in
`SKILL.md`). The watcher's report only says where to look.
