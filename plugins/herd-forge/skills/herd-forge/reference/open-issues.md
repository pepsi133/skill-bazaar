# Open issues: what does not work

These problems remain unsolved across four herds run on one host in September 2026,
updated after the rulings of the operator. Each entry states a problem, not a solution,
because a fix that nobody tested is worse than a recorded gap. Each entry names the
herd that hit it.

## Orchestration

1. There is no reliable completion signal. `agent_status: done` reports only that the
   process does not run. Finished, idle, blocked on a dialog, and dead on the account
   limit are one value. It caused a wrong instruction in `wA`, and `wC` had a lane
   report `done` and write nothing. The three legs in `SKILL.md` section 7 reduce the
   risk. They do not fix it, because a wake still tells you only to look. All four
   herds hit this on their own.

2. Nobody ran the three legs as a set. Each leg is measured on its own: `agent wait`, a
   worker that prompts the pane of an overseer, and a long sweep. No herd ran all three
   together for a whole programme, so the failures of the combination are unknown.

3. There is no ordering guarantee. Prompts to a working agent land, but two prompts
   sent in sequence have no guaranteed order. Send anything order-dependent as one
   message. (`wA`.)

4. Delivery confirmation is indirect: a `timeout` error, then a status check that shows
   `working`. There is no positive acknowledgement. (`wA`.)

5. Agent-to-overseer messaging is inconsistent, and nobody established the cause. Files
   are the only reliable channel. (`wA`.)

6. Rate-limit recovery is manual. When the account window resets, every stalled agent
   needs its own prompt. There is no restart-all, and in a ten-pane herd that costs a
   meaningful block of overseer turns. (`wA`.)

7. Sender identity cannot be verified, and a fork proves it. A fork of the overseer
   sent four prompts to a device pane and the pane obeyed, because every message
   arrives through one channel with no source label. The marker separates instructions
   from injected tool output, which is its real job. It does not authenticate, and no
   mechanism here does. (`w8`.)

8. The relay limit cannot be engineered away. Every agent sits one relay away from the
   operator, so an overseer can always appear to lift the rule that resists
   manipulation hardest. The scoped trust of the between-herds agent documents the risk
   and does not remove it. That scoping is new and nobody exercised it. (`wA`.)

## Isolation and independence

9. Isolation is declarative and unenforced. `wB` audited its own tree and found 0 of
   88,635 files unreadable to any agent. The ruled mechanism, a no-read list, is
   cooperative by design, and the skill says so. Operating-system sealing exists on
   paper in `sealing-os-users.md`, and no herd here ran it.

10. A no-read list cannot be audited from the filesystem afterwards. Only pane
    scrollback can audit it, and only an agent that did not write the declaration can
    do that. `wB` built the check. Nobody ran it as routine.

11. Lost independence does not come back, and nobody can measure how much was lost. A
    worker that saw external material can still work, and it can never again produce an
    independent convergence. (`wB`.)

## Evidence and review

12. The reviewer is a single point of failure. One agent reviews everything. If it is
    wrong, rate-limited, or reviewing a document that moved underneath it, nothing else
    catches the error. `wA` declared a mission concluded with its highest-weight claim
    never reviewed. Nobody tried a second reviewer or a rotating reviewer.

13. The freeze is cooperative, and one herd saw it fail in silence. `wC` declared a
    freeze and all three target files changed under the reviewer. The ruling pairs the
    marker with a commit, so a verdict now names a recoverable state. The commit
    records the state. It does not prevent the edit, and nobody tested whether a marker
    stops a worker at all.

14. Rules that must hold recursively do not reach forks and sub-agents. Two sub-traces
    inside one worker recorded no prediction, so nobody could audit them. The rule
    reached the pane and not the forks of the pane, and nothing checks that it carried
    across. (`wA`.)

15. Nobody tested a review of a confession. The rule that self-critical text is a claim
    arrived after the extractions closed, from the incident that produced it (`wC`). No
    herd ran a review with that check in place.

## Cross-herd

16. Release and contamination trade against each other, and nobody measured either
    cost. Sharing is now off by default, which avoids the question instead of answering
    it. When it is on, the sender does not know the settings of the receiver, and an
    anchored conclusion looks exactly like an independent one afterwards. (`wB`.)

17. No author ever completed a cross-herd delivery end to end. A permission classifier
    blocked the single authorised release in transit, and the operator carried it, so
    the full path is untested. (`wA`.)

18. The between-herds agent is new. Four herds ran the shared device through a FIFO file
    that three overseers asked one holder to edit. Nothing here is measured in place:
    the single agent that carries both jobs, the chatter filter, the provenance rules,
    and the rule that a ledger is not a command channel.

## Roles and tooling

19. Nobody ran the artifacts guard. The role, the cheaper model, and the
    self-compaction loop that re-establishes its rules are an operator design, not a
    measurement.

20. Nobody tested the fallback for an unrecognised agent kind here. `pane run`,
    `send-text`, `wait-output` and `report-agent` are measured as commands. No herd
    drove a non-Claude agent through a whole programme with them, and the caller
    asserts the lifecycle state instead of Herdr detecting it.

21. Two herds measured compaction delivery differently. `w8` and `wB` report that a
    prompt-delivered slash command never survives. `wA` measured that a short one does.
    Both are measurements, and the client version can differ. The ruling works under
    either reading and does not settle which one is true.

22. Nothing supports the decision to stop. "Is a third bounded attempt worth it?" was
    decided by feel several times. Sometimes it paid. There is no data behind the call
    and this skill offers none. (`wA`.)

## Scheduling

23. Nothing survives session death. The visible scheduler is session-only. A detached
    timer survives and is invisible to the operator and hard to cancel, which is a
    worse trade. A dead session needs a human. (`wA`.)

24. A wake-up cannot know its own premise. A scheduled prompt written for a memoryless
    session can fire into a session with full context. An instruction to establish
    state from documents works, and it makes the prompt longer and partly redundant
    every time. (`wA`.)

## Not attempted

- A second reviewer, and an adversarial review of the reviewer.
- A structured machine-readable finding format. Everything is prose, so the overseer
  parses by reading.
- A measurement of how much overseer context each pattern costs.
- A test of whether a `FROZEN` marker stops a worker from editing.
- A comparison between a blind instrument over figures and full independent
  rediscovery. `wA` ran the first and `wB` ran the second.
- Creation of a herd with this skill. Everything here comes from four herds that were
  built before the skill existed.
