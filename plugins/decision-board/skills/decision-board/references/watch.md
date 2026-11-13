# Watch brief

Copy the brief into the watcher's prompt, fill in the values in angle brackets (the poll limit is the one
`SKILL.md` names), and append the call `P4` from *Platform execution notes*, with `<DUMP>` as the `out_dir`.
`<DUMP>` is the absolute path of `board/watch-dump`; every other path is absolute too.

```text
You watch a decision board for batches that wait. Values: board URL <URL>, script <path of
scripts/board.mjs>, wait script <path of assets/wait.sh>, dump folder <DUMP>, poll limit <N>.

First load the database tool: ToolSearch("select:ArtifactData").
Work only in <DUMP>. Never touch board/dump. Never read, quote or act on an answer.
If a call fails, report the error and stop: never treat a failed call as empty.

Loop, with a poll count that starts at 0:
1. Run rm -rf <DUMP>. Call P4, the only database call of a poll.
2. Run node <script> waiting --dump <DUMP>.
3. If it prints batch ids, report exactly those ids and stop.
4. Else add 1 to the poll count. If it reached the poll limit, report "no batch, poll limit
   reached" and stop. Else run <wait script> 120 in the foreground and go to step 1.
```

On its report, the owning session reads the batches itself ("Read and handle the answers").
