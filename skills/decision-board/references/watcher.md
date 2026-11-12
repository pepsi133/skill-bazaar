# Watcher brief

Read this when you start a watcher. Copy the brief below into the prompt of a cheap background
agent, fill in the five values in angle brackets, and append the calls of your platform from
"Platform execution notes".

```text
You watch a decision board for new batches. Values: board URL <URL>, agent name <NAME or
"default">, script <path of scripts/board.mjs>, wait script <path of board/wait.sh>, poll limit <N>.

Work only in board/watch-dump. Never touch board/dump: it belongs to the session that owns the board.
Keep your state in board/watch-state.txt as one line: the poll count, a space, SINCE. Example:
3 2026-01-01T10:00:00.000Z
If the file exists, continue from it. Else set the count to 0 and SINCE to the output of:
date -u +%Y-%m-%dT%H:%M:%S.000Z
Write board/watch-state.txt after every step. Set the count to 0 when you report.

Loop:
1. Run rm -rf board/watch-dump. Then call W1 once.
2. If W1 found no document, add 1 to the poll count. If the count reached the poll limit,
   report "no batch, poll limit reached" and stop. Else run <wait script> 480 in the foreground
   and go to step 1. Never end your turn while no new batch exists and the limit is not reached.
3. Else set SINCE to the newest "created" of the batches found. Call W2 for each of the
   collections meta, items, acks, responses and notes. Run
   node <script> read --dump board/watch-dump, adding --agent <NAME> unless NAME is "default".
4. If read prints "no new batches", the batches belong to another agent or are handled: count
   the poll, wait and continue as in step 2. Else report, for every batch that it printed, the
   batch id, the item ids and the note ids. Take all batches of this round in one report. Do not
   report answers or notes, and do not act on them. Stop.
```

The session that owns the board then reads the batches itself ("Read and handle the answers" in
`SKILL.md`). The watcher's report only says where to look.

## Platform execution notes

Claude Code with the claude.ai `ArtifactData` tool. Append this to the brief:

```text
Load ArtifactData once with ToolSearch("select:ArtifactData").
W1: ArtifactData {"action": "query", "url": "<URL>", "collection": "batches", "out_dir":
"board/watch-dump", "query": {"where": [["created", ">", "<SINCE>"]], "limit": 50}}.
W2: ArtifactData {"action": "list", "url": "<URL>", "collection": "<name>", "out_dir":
"board/watch-dump", "query": {"limit": 1000}}. If the result carries a next_cursor, call again
with "query": {"limit": 1000, "cursor": <next_cursor>} until none.
Run the wait script with a Bash timeout of 600000 ms.
```
