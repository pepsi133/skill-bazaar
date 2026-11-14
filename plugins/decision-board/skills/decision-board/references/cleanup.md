# Clean up

Read this only when the operator asks for a clean up. `S`, `P2` and `P3` are as in `SKILL.md`.

1. Dump `responses` and `batches` with versions.
2. Run `node S purge --closed-before <date 30 days ago> --dump .board/dump` (or `--ids <id>...`, which takes the named
   cards off even when open) and pass each array. It first copies every card and row to `.board/purged/`; the cards
   stay in the state until `adopt` sees them gone.
3. If a purge write is refused or its reply lost, do what the `if refused:` or `if the reply is lost:` lines under
   that array say, in order: the purge first, then `cards`. If adopt stops and names a card, the operator changed
   its answer since the dump; the card stays on the board. Run the purge again later.
