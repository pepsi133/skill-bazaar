# Writes: pass, confirm, recover

Read this when a write was refused, a reply was lost, or a command refused with `Not confirmed`. `S`, `P2` to `P4` and
`URL` are as in `SKILL.md`.

Every array goes to one `P3` call, once, in order. After the call succeeded, `--confirmed` on the next write command or
`node S confirm` tells the script that every array so far is in the database. Never confirm an array you did not
pass or whose call failed. A write command refuses while an array is unconfirmed, writes nothing, and prints the ways out:

1. Every array passed: run `node S confirm`, or run the command again with `--confirmed`.
2. A `P3` call was refused: run the `if refused:` line under that array. It names a dump **with versions** as
   `SKILL.md` defines it, then an `adopt` command. If `adopt` prints an array, pass it and confirm; if it says the board
   holds the write, nothing is left to pass.
3. The reply was lost, or you do not know whether you passed the array: run the `if the reply is lost:` line,
   `node S push <key>`. It prints the same array again. Pass it, then confirm. If the board refuses it because it
   already holds the write, take way 2.

A refusal names every unconfirmed key. Do the steps for each key, then run the command again.
