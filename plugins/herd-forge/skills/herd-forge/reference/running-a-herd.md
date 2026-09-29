# Running a herd for hours: turnover, the steward, and the close test

The forge copies this file, `herdr-traps.md` and `liaison.md` into the herd's `common/`
directory, so each sits beside the others there. The steward runs this file. An overseer
reads it before it answers a turnover proposal.

Every number here was measured in one herd of 21 panes, where 12 panes closed and 1 pane
compacted.

## Turnover is the default

When a pane has delivered its unit of work, or climbs toward its context ceiling, retire it
and forge a fresh agent from its handover. This holds for the overseer, the liaison and the
steward too.

A compacted pane runs on prose about prose, and everything the summary dropped is gone. A
fresh pane reads files that say what they mean. One herd turned over four panes past a
70 percent ceiling in about ten minutes, with no compaction.

A current `STATUS.md` is most of a handover. The overseers that turned over fastest were
the ones whose status file was already current.

**Compaction is the fallback**, for a pane that is mid-step and cannot reach a clean
handover. At most twice per pane. The count lives in the agent's row in
`common/IDENTITY.md`. A pane that needs a third compaction turns over instead.

## The steward's sweep

Sweep by reading, never by messaging. A read costs nothing. A message costs that pane a
turn and costs the operator noise.

    herdr agent list
    herdr agent get <name>
    herdr pane read <pane_id> --source recent-unwrapped --lines 40

- **Build the roster from the live list on every sweep.** `common/IDENTITY.md` is the
  durable record, not the roster. In one herd the identity file listed 7 agents while 20
  panes ran. A sweep built on a file inherits that file's drift.
- **Match the herd prefix with its trailing hyphen**, `demo-` and not `demo`. A prefix
  without the hyphen pulled another herd's reporting agent into a roster.
- **Prune holds and routes that point at a closed pane**, on every sweep. Move the retired
  entry to `common/RETIRED.md`, so the history survives.
- **Write the context reading as `ctx NN%`, always with the unit.** A bare `50%` beside a
  transfer at 95.2 percent reads as either one.
- **`ctx` refreshes only when a turn completes.** A `done` or `idle` pane does not grow.
  Mark a non-working pane at the ceiling PARKED, and leave its timing to its overseer. Mark
  a working pane that rises between sweeps CLIMBING. A `working` reading is a lower bound.
- **`ctx ?%` is unknown, not zero.** A new or resumed session shows it until its first turn
  completes. One pane read `?` with 31 assistant turns in its transcript.

Write one line per pane to the sweep file:

    <agent>  <state>  ctx NN%  PARKED|CLIMBING|ok  ask:<overseer of that lane>

## Proposing a turnover

With a candidate in hand, message the overseer of that pane's lane. Name the candidate, the
reason, and the reading. The overseer decides. For the overseer itself, propose to the
overseer. A reviewer answers to the pane its brief reports to, because the herd it reviews
does not hold it.

    FROM <steward name> - turnover proposal.
    Candidate: <agent>. Reason: <delivered its unit | CLIMBING, ctx NN%>.
    On yes I run the close test and forge <successor name>.
    ACK: yes or no.

After a yes, run the close test, then the turnover.

## The close test

Run it in this order before any pane closes, for a turnover and at the end of the herd.

1. **Read the last screen.** Look for a transport failure or a truncated response. A pane
   whose last content is a bare tool result has probably not written its conclusion. A
   written conclusion, an empty input box and a completed turn is a real finish. An error
   marker is an order to read, never a verdict. It stays in scrollback after a recovery,
   and a cut-off can leave no marker at all.
2. **Ask the lane's own overseer.** Never read delivery off `done`. It has at least three
   causes: a clean finish, a park, and a transport failure. One lane read `done` after a
   37-minute analysis was cut off at the moment of writing.
3. **Ask the pane three questions.** Is the unit delivered? Which files hold it? What is in
   your working set and in no file, which a fresh pane does not inherit? The third one
   pays, because the first two ask about files and it asks about what no file holds. It
   caught something in six lanes in one afternoon: an instrument script that lived
   only in a scratchpad, an analysis that lived only in context, and an output file that
   still printed a result the lane had since proved false.
4. **List the deliverables yourself.** Report the measured count, the claimed count, and
   "the file is live". Counts drift while you ask. Every claimed count in one herd differed
   from the measured one, and each difference was writes landing during the exchange. A
   mismatch is not a discrepancy and a match is not a proof.
5. **Ask what the pane is the sole record of.** A lock, a claim, an allocation, a queue
   position. Write it to a file before the pane goes. A held instrument and an idle one
   look the same from outside the pane. When you check that a process is idle, exclude
   your own command from the match. Assert on the bytes it wrote, not on a process count.
6. **Record the session id and the model** in the agent's row in `common/IDENTITY.md`.
   Closing the pane keeps the session, and the id is how it resumes.
7. **For a turnover, the replacement answers first.** It must return `agent_prompted`
   before the outgoing pane closes. `herdr agent prompt` refuses a blocked pane with
   `agent_blocked`. In one herd an outgoing overseer closed while its successor sat on a
   confirmation dialog, and for five minutes no pane took messages for that role.

The test passes when all seven hold. Then close the agent's tab with
`herdr tab close <tab_id>`.

## The turnover

1. **Plan the successor name up front.** Names are unique among live agents, so the
   successor cannot take the outgoing name while that pane runs. Two agents once picked
   the same successor name, and the collision left an empty pane behind.
2. The outgoing agent writes its handover. Its `STATUS.md` is current, and it holds the
   answers to questions 3 and 5 of the close test.
3. Run close test steps 1 to 6 on the outgoing pane.
4. Forge the successor in its own tab. Verify it with `herdr agent get <name>`, not from
   the start return. One `agent start` returned a name and a session id, and a minute
   later the pane did not exist.
5. Brief it from files: its brief, and the path of the handover. Check for
   `agent_prompted`. That is close test step 7.
6. Close the outgoing tab. Update `common/IDENTITY.md`, and bring the three names in step.
7. **Message every agent that holds a dispatched brief naming the closed pane.** Correcting
   the file corrects nobody holding a copy. A message is the only fix.

The steward turns itself over the same way. It forges its successor, and the successor
runs the close test on it.

## Names: three of them, kept in step

A pane carries three different names, and they drift apart unless one agent owns them.

| name | what it is | set it with |
|---|---|---|
| pane label | what the human sees on the screen | `herdr pane rename <pane_id> <label>`, and `herdr tab rename <tab_id> <label>` for the tab |
| Herdr agent name | what `herdr agent prompt` targets | `herdr agent rename <target> <name>` |
| session name, in a Claude pane | what the session list shows when you resume | `/rename <name>`, typed into the pane |

The steward types into another pane only two things: `/rename <name>` and
`/compact <short text>`. Deliver both the way `herdr-traps.md` entry 22 describes.

## A roster is not a scope

Retired panes leave their files in the tree. A review scope cut from `herdr agent list`
undercounts by exactly the retired lanes. One reviewer had reviewed four lanes, and none of
them was on the live roster.

The scope is the tree, enumerated and timestamped. The roster only finds lanes the tree
does not show yet. A tree count is true until the next write. One herd directory went from
339 to 692 files in an afternoon. Re-run every scope count at freeze.

## Compaction, the fallback

Only on the overseer's request, and at most twice per pane. The mechanics and their traps
are in `herdr-traps.md`, section *Compaction, the fallback*.

1. Have the agent write its handover. Have it also write every literal that exists in no
   file, such as an address or a published URL, to a file. Name that file in the retention
   prompt. In one herd a must-keep URL existed in no file anywhere in the tree.
2. Read the pane's status line. Look for queued messages and for a usage pause.
3. Send the retention prompt as an ordinary prompt. Then type a short `/compact` that
   refers to it, and verify it. See traps 21 to 24.
4. Send a wake-up that tells the agent to re-read its brief, its rules and its status file.
   In a paused pane, record the compaction as complete-but-unwoken. See trap 32.
5. Add one to the agent's compaction count in `common/IDENTITY.md`.
