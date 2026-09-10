# Context, handover and closing an agent

`SKILL.md` section 10 holds the core rule: this skill sets no compaction threshold, and
one invariant replaces it. Everything load-bearing sits on disk, so a compaction taken
at any moment loses nothing. This file holds the detail.

History, recorded once so that nobody reinvents it. `wA` and `wB` ran under numeric
thresholds from an earlier operator instruction: 200k hard and 150k advisory. Those
numbers are what two herds did. They are not guidance, and the operator ruled them out
of this skill as a default and as a fallback.

## The `STATUS.md` that a cold reader can resume from

Every agent writes one at every pause, stop and finish. Its first lines say that a
reader who remembers nothing can use it. It carries eight sections:

1. What binds you: the rules file, the remit, the limits.
2. What to read first, and in what order.
3. Every deliverable written, and what each one establishes.
4. Remit items complete.
5. Remit items not complete, each with its next step.
6. What is blocked, and who blocks it.
7. What you read, for contamination accounting.
8. Approaches that already failed, so that nobody repeats them.

A closed worker states its state in capitals on line 2, for example
`COMPLETE. Closed NEGATIVELY. Falsifier MET.` (`wC` held this across six lanes.)

## Compact an agent

1. Send the short single-line prompt, because it is one call:
   `herdr agent prompt <name> "/compact <short single-line prompt>"`.
2. Read the session `.jsonl` and find the `isCompactSummary: true` record. (`wB`.)
3. If step 2 finds no record, use the keystroke recipe below.

Step 2 is not optional. The fast path fails in silence. `w8` measured nine agents that
answered a compaction request in prose while none of them compacted. The pane goes
`working`, then `done`, and the call returns `agent_prompted`.

Never read an unchanged usage figure as a failure. The last usage record reports the
context size of the last request, so it still shows the number from before the
compaction. (`wB`.)

The keystroke recipe, measured by `wB`:

1. Send `send-keys ctrl+u` twice. Escape does not clear a paste placeholder.
2. Send `send-text "/compact"`.
3. Send `send-text " <short instructions>"`. The leading space is load-bearing, because
   Enter with the autocomplete menu open selects the highlighted entry.
4. Send `send-keys enter`.

Keep the text short enough to type rather than paste. About 300 characters worked.
Above roughly 450 characters, even a typed command trips paste detection. (`w8`.)

After a compaction, a queued prompt can sit unsubmitted. It needs an explicit key send.
(`w8`.)

## When to compact, which is a different question from whether

Never force a compaction on an agent that works on a task, and never on the overseer
during a task. An agent compacted a few minutes late loses nothing. An agent compacted
during a trace loses the working set that it assembled, and cannot tell that it did,
because the lost context is what it needs to notice the loss. For an overseer, the loss
covers the state of the whole herd.

An agent counts as mid-task unless two conditions hold together. First, `agent_status`
reports idle or `done`. Second, the agent wrote its handover after its last work item.
`done` and idle are the same state here, so the status alone proves nothing about
whether the work finished.

The artifacts guard is one exception. It compacts often, by design, with a prompt that
re-establishes its rule set each time. Its rules matter and its history does not.

A blind agent is the opposite exception. Do not compact it while its work is open,
because a compaction summary is one more chance to contaminate it (`wA`). Close the
item first.

## Stand an agent down

1. Ask what is load-bearing and not yet on disk. (`w8`: seven load-bearing measurements
   existed only in a session transcript, and the file that rescued them had to disclose
   that nothing in it was re-measured.)
2. Write the close-out before the compaction, never after. The file is the snapshot. It
   carries four sections (`w8`): delivered; established, with the confidence actually
   held; not established, split into examined-but-unsettled and
   never-examined-though-inside-my-remit; and next work, ranked, each item with the
   single measurement that closes it and the herd that must do it.
3. Make sure that every artifact the agent owed exists. (`wA` closed a lane whose
   section of the deliverable was never written. That result now lives only inside the
   findings file of a closed lane.)
4. Compact, and make sure of the result.
5. Close the pane. That ends the process and does not destroy the session.
6. Complete the row in `common/IDENTITY.md` before you close: directory, workspace,
   tab, pane, agent name, session id and model. `herdr agent get` reports this only
   while the agent runs.

## Resume a closed agent

Run `claude --resume <session id>` in the directory of that agent. It takes a new pane
id, and Herdr never reuses the old one. The first instruction tells the agent to
re-read `AGENT-RULES.md`, its own `REMIT.md` and its own `STATUS.md`, because it comes
back compacted. Restore the same model, which is why the model sits in the identity
file.

A resumed agent that worked under a no-read list stays under it. Do not brief it on
what it was kept away from.

## Keep the context of the overseer small

Delegate the reading. A digesting agent reads output and returns short digests. It
separates MEASURED BY ME from RELAYED, and marks anything that it cannot reconstruct
exactly as UNRECOVERABLE (`w8`). Giving the work away needs no justification. Keeping
it does (`wB`).

Scratchpad logs are session-scoped and do not survive the session. Say so in any file
that points at them.
