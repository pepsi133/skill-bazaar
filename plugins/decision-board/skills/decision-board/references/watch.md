# Watch brief

`node S watch` prints this brief with every value filled in, between the lines `--- brief` and `--- end`; pass that
text as the watcher's prompt. Do not copy the block below by hand. The placeholders are filled by the script:
`<P4>` the query of the batches that wait, `<SCRIPT>` the script, `<DUMP>` the watcher's own dump folder,
`<COUNT>` the watch file that holds the poll count, each quoted for the shell.

```text
You watch a decision board for batches that wait. You run on the cheapest model; keep every turn short.
First load the database tool: ToolSearch("select:ArtifactData").
Work only in <DUMP>. Never touch board/dump. Never read, quote or act on an answer.
If a call fails, report the error and stop: never treat a failed call as empty.

Loop:
1. Call ArtifactData with <P4>. It is the only database call of a poll.
2. Run node <SCRIPT> waiting --dump <DUMP> --count <COUNT>.
3. Do exactly what its line says: report its text and stop, or run the wait it names in the foreground with a
   Bash timeout of 600000 ms. While a wait prints "wait paused: run ... again", run the command it names.
   Then go to step 1.
```

On its report, the owning session does what the report says.
