# Writes: pass, confirm, recover

Read this when a write was refused, a reply was lost, or a command refused with `Not confirmed`. `S`, `P2` to `P4` and
`URL` are as in `SKILL.md`.

Every array goes to one `P3` call, once, in order. After the call succeeded, `--confirmed` on the next write command
confirms the arrays of the last command that printed one, and `node S confirm` confirms every array so far.
Never confirm an array you did not pass or whose call failed. A write command refuses while an array is unconfirmed,
writes nothing, and prints the ways out. `--confirmed` also refuses, and names the keys, when an older array than
the last printed one is unconfirmed:

1. Every array passed: run `node S confirm`, or run the command again with `--confirmed`.
2. A `P3` call was refused: run the `if refused:` line under that array. It names a dump **with versions** as
   `SKILL.md` defines it, then an `adopt` command that ends with `--reply -`. Run it with the text of the `P2` replies on
   its standard input: `... --reply - <<'EOF'`, the reply text as returned, then `EOF` (several replies: one after the
   other; a file of them works as `--reply <file>`). Only the document lines of the reply count. If `adopt` prints an
   array, pass it and confirm; if it says the board holds the write, nothing is left to pass.
3. The reply was lost, or you do not know whether you passed the array: run the `if the reply is lost:` line,
   `node S push <key>`. It prints the same array again. Pass it, then confirm. If the board refuses it because it
   already holds the write, take way 2.

A refusal names every unconfirmed key. Do the steps for each key, then run the command again.
