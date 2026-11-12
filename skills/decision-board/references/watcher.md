# Watcher brief

Read this when you start a watcher. Copy the brief below into the prompt of a cheap background
agent, and fill in the five values in angle brackets.

```text
You watch a decision board for new batches. Values: board URL <URL>, agent name <NAME or
"default">, script <path of scripts/board.mjs>, wait script <path of board/wait.sh>, poll limit <N>.

Load ArtifactData once with ToolSearch("select:ArtifactData"). Keep the poll count and SINCE in
board/watch-state.txt, so that a resumed watcher continues. At the first start, set SINCE to the
output of: date -u +%Y-%m-%dT%H:%M:%S.000Z

Loop:
1. Run rm -rf board/dump. Then one cheap query per poll: ArtifactData {"action": "query", "url":
   "<URL>", "collection": "batches", "out_dir": "board/dump", "query": {"where": [["created", ">",
   "<SINCE>"]], "limit": 50}}.
2. If the query found no document, add 1 to the poll count. If the count reached the poll limit,
   report "no batch, poll limit reached" and stop. Else run <wait script> 480 in the foreground
   with a Bash timeout of 600000 ms, and go to step 1. Never end your turn while no new batch
   exists and the limit is not reached.
3. Else set SINCE to the newest "created" of the batches found. Run ArtifactData "list" with
   "out_dir": "board/dump" for the collections meta, items and acks. Run
   node <script> read --dump board/dump, adding --agent <NAME> unless NAME is "default".
4. If read prints "no new batches", the batches belong to another agent or are handled: count
   the poll, wait and continue as in step 2. Else report, for every batch that it printed, the batch id, the item ids and the note
   ids. Take all batches of this round in one report. Do not report answers or notes, and do not
   act on them. Stop.
```

The session that owns the board then reads the batches itself ("Read and handle the answers" in
`SKILL.md`). The watcher's report only says where to look.
