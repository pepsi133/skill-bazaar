---
name: herd-rigor
description: >-
  Use when the user asks to make a result defensible, to review or gate a deliverable, to
  check a claim nobody attacked, to keep one worker independent of what another
  believes, or to add rigor to a herd built with herd-forge. Optional discipline for work
  where a wrong answer costs more than a slow one: evidence labels, absence controls, the
  freeze and review gate with its four verdicts, checker independence, and a rule budget
  that stops the method from eating the work.
---

# herd-rigor

This is a set of dials, not a protocol. Turn on what the work needs and leave the rest off.

## Turn it on when being wrong is the expensive failure

Every rule here costs throughput, and rule writing competes with the work for the same
budget. A method built to stop an agent being wrong, applied to a problem whose binding
constraint is not being slow, displaces the work it exists to protect.

So ask first: **which failure costs more here, a wrong answer or a slow one?** Turn these
dials on for the first. Leave them off for the second.

## The four dials

Set them at forge time and write them into `common/config`.

| dial | default | what it costs |
|---|---|---|
| `evidence_labels` | on | A sentence per claim. Cheapest rule here and the one that pays most |
| `absence_control` | on | One extra command per zero you publish |
| `double_check` | key numbers and key absences | One agent. A second party re-measures the load-bearing numbers without being told what to expect |
| `review_gate` | off for one agent, on for a deliverable somebody acts on | A reviewer agent and a freeze cycle per artifact |

## The rules that go into every brief

Six lines. They fit in a paragraph, and each one closed a measured failure.

1. **Label every claim measured or argued, and name the weakest link.** Measured means a
   reader can redo it from the shipped files with the path and the method given. Anything
   located but not read is a location, not a finding, and it supports nothing.

2. **Never publish a zero without a control.** A zero with no control is
   indistinguishable from a sweep that did not run. The numbers that must accompany it, and
   the controls that fail silently, are in **static-analysis-controls**, which is the
   single source of truth for that rule. When no known-present instance exists for a
   control, say so in the claim and label the claim argued.

3. **Record the prediction before the run.** Report a refuted prediction as a result.
   Report a failed trace as a failed trace. Report a run that measured nothing as VOID.
   VOID is neither a negative result nor a reason to retry in silence.

4. **Write the command beside every number.** A number with no command is not
   reproducible, whatever it says.

5. **Record the direction each error leaned**: whether it flattered its author. Only errors
   that flatter tend to survive review, so the direction is the field that predicts
   recurrence.

6. **Treat a confession as a claim.** A false statement against your own interest is still
   a false statement, and no reader checks it, because nobody audits a claim that costs the
   author something. The section of a report most likely to hold an unchecked error is the
   section that admits error.

`references/evidence.md` carries the long form with the incident behind each rule.

## The review gate

Five rules, one per actor and moment. `references/review-gate.md` carries the reviewer's
brief and the checklist.

1. The worker commits the document before it reports the document as ready.
2. The overseer writes `FROZEN` into that worker's directory, with the reason, the time and
   the sections under review.
3. While `FROZEN` exists, the worker does not edit that document. If it believes a
   correction cannot wait, it tells the overseer and waits. The overseer decides.
4. The reviewer names the commit it graded. That is what the commit is for: a verdict must
   name a state somebody can recover.
5. The overseer deletes `FROZEN` when the verdict lands.

The freeze is cooperative, and one herd watched all three target files change under its
reviewer, one growing by three sections mid-read. So a reviewer states what it actually
read, and names any section that changed and the direction of the change.

Verdicts are REFUTED, UNSUPPORTED, NARROWED or SURVIVES, on line one of the file. Give
SURVIVES only to a claim the reviewer tried to break and failed to break. A verdict covers one
item and can split: "confirmed on the conclusion, refuted on the stated reason".

The review arrives whole, not as a drip of findings. The reviewer suggests wording and the
suggestion does not bind. The author owns the artifact and can rewrite all of it on the
strength of the review. That is often the right answer, because a review read whole exposes
structure that a list of line edits hides. Where the author adopts reviewer wording
word for word, mark that version as carrying reviewer text. A gate on your own words is not
a gate.

## Keeping a checker independent

Re-measurement by the author catches staleness only. It cannot catch a formula that is
wrong the same way every time. The checker is not told the expected answer and does not
start from the producing worker's number.

`references/independence.md` carries the no-read list, the levels of `double_check`, and
the rules for a worker whose independence is itself the product.

## The rules the method must obey about itself

These bind the rules, not the work. A herd that skips them accumulates until the method is
the work.

1. **A definition of done, written before any agent starts.** Without it a herd cannot
   terminate itself and spends its remaining capacity on method.
2. **A named primary consumer for the deliverable.** A vendor report, an integration and a
   research record want different artifacts.
3. **A budget in the unit that binds.** One program metered requests, which were never
   the scarce resource.
4. **A rule budget.** Fix the rules file line count at forge time. A new rule enters when
   an old rule leaves, and the author names which one.
5. **Rules are written after the instrument works.** Until the herd holds one clean
   end-to-end measurement, lessons stay in the lane's own file.
6. **Run a new rule against the cases on disk, in both directions, before committing it.**
   One case it must permit, one case it must refuse. A rule that refuses nothing is a
   broken instrument.
7. **A rule only one lane needs is a note in that lane's own file.** A herd-wide clause
   turns a local lesson into everybody's overhead.
8. **Somebody owns the intersections.** When a second rule restricts an activity a first
   rule already restricts, the party issuing the second states the resulting intersection
   in one line. An emergent prohibition has no author to appeal to, and nobody notices when
   it closes a door.
9. **Every control carries the configuration it was taken under, and expires when that
   configuration changes.** When a safety rule removes an instrument's access to something,
   ask at once what that instrument was used to prove.
10. **A habit installs as a callable artifact, never as a sentence.** Ship the exact command
    in `INSTRUMENTS.md`. Writing a rule does not install it, and a rule that costs nothing
    to state and something to follow degrades first in the person who wrote it.
11. **Keep the record of each failure, in the words of whoever paid for it, and make it
    cheaper to re-read than the rules.** The record of a failure is a better detector than a
    rule against it, because whoever re-reads it was just burned by it. The record names the
    mechanism rather than the symptom.

## Reference files

| file | open it when |
|---|---|
| `references/evidence.md` | You write evidence rules, or a claim is in dispute |
| `references/review-gate.md` | You write a reviewer's brief, or you judge a verdict |
| `references/independence.md` | A worker's value depends on not knowing what another already believes, or material is released to another party |

**static-analysis-controls** owns the counting and absence rule in full: which numbers to
print, and which controls fail silently. This skill says that no zero publishes without
one.
