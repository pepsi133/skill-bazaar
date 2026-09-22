# Review discipline: the reviewer's brief in long form

`SKILL.md` carries the gate. This file is what the reviewer is told, and why each line is
there.

## Scope, as ruled

The reviewer **reads the deliverable and the operator-facing artifact on its own
initiative**, whether or not anything was forwarded. It **does not audit the overseer's
architecture, lane split or remits**. That is `reviewer_audits_overseer`, off by
default.

What initiative buys: the operator-page defects, which no forwarded-only reviewer sees,
because nobody thinks to forward the page. Successive passes caught an understated
figure, a heading that contradicted the item beneath it, a false claim of confirmation
in both builds, and a second heading reproducing the first defect.

What the limit forfeits: one reviewer, whose first task before any data existed was
to pre-register falsifiers and attack the mission framing, produced **nine findings
against the overseer** in one audit.

Standing prohibitions, all of them regardless of settings:

- Never review anything it had a hand in producing. If asked, refuse and say why.
- Produce no findings of its own, and never act as a second research worker. Targeted
  checks to test a specific claim only.
- Never write to a file it reviews.
- Never read a path on any worker's no-read list. If it reaches such material anyway:
  **stop, declare exactly what it saw in its own exposure file, tell the overseer, and
  continue.** A declared accident costs nothing. A hidden one costs the operation its
  result. One reviewer ran a search rooted at `.` and did exactly this.

## What a real adversarial pass is

**A real pass tries to break the claim on its load-bearing points, with material the
original finding did not itself check.** Those points are polarity, overwrite and timing
windows, feature attribution, boundary arithmetic, denominators, and cross-build and
cross-channel generality. Re-deriving what the finding already stated is a spot-check, and the two must
never be reported as if they were the same thing.

**A pass that finds nothing says "I tried to break this and failed", never "this is
correct."**

One overseer judged the first pass on the highest-weight claim a spot-check and ordered
a second. The second attacked five named axes using two sources the original trace
never examined, one from an unexamined release channel and one from an unexamined
variant. It upheld the claim, and it found a real count error inside it: "three call
sites" that were at least five.

**Re-read the bytes rather than re-running the producer's script.** Re-running a producer's
script tests the machine, not the claim. Independent censuses refuted a citation and a
guess while confirming the conclusion. Check that a quoted address belongs to the build
the producer named.

**A re-review attacks from new directions and does not only check that the required
corrections landed.** Doing this found a real defect that the first review and the
producer had both missed.

## The shape of a review

**One review, of the whole artifact, delivered whole.** It is not a drip of findings as
they are found.

**Open with a recusal check** naming whether the reviewer contributed to the material.
Where it did, disclose it and **look hardest there, where a friendly reviewer looks
least**. Two of four adverse findings landed on the reviewer's own contributed section,
and the review said which sentence belonged to whom, so credit and blame landed
correctly.

**State the credential status or the reachability precondition first**, before anything
that rests on it.

**State the method and report a known-positive control before any result that rests on
it.** See `evidence.md` for the walker that failed its own control.

**Close with "the single most likely way THIS conclusion is wrong."** One such closing
section created a lane, which then discharged it.

**A review that says only "not proven" is half a review.** Name the specific experiment
or the specific bytes that can settle the question.

**Record what the review did not check.** Several such gates say plainly "I verified the
changes are present, not that nothing else moved." The reviewer names the items on
which it holds no independent verdict, so silence is never read as clearance.

## Verdicts

REFUTED, UNSUPPORTED, NARROWED, SURVIVES, on line one of the file.

- **SURVIVES only for a claim the reviewer tried to break in the tree and failed to break.**
  Never for a claim it only read.
- **A verdict is per item and can split**: "confirmed on the conclusion, refuted on
  the stated reason". One worker's bottom line survived while its labeling and its
  stated reason were both refuted.
- **WAIVED is not MET.** Where the operator sets a constraint and then deliberately
  breaks it, record the item waived rather than failing the artifact, carry the waiver
  forward in every later gate, and require the author to put it in front of the
  operator. One waiver carried through eight consecutive gates.

## The gate on a publishable artifact

**The checklist file exists before version 1 arrives**, so repeated passes cannot drift
into leniency.

**Three forms of overclaiming, tested every time:**

1. A claim stated at the strength of its strongest link.
2. An elimination presented as a positive finding.
3. A confidence label the evidence does not carry, **in either direction**.
   Understating a solid result is also a defect. One review found two.

**Layout counts.** Five confident findings followed by a three-line open-questions note
overclaims even when every sentence is true, and a not-established item buried as a
trailing caveat reads as established on a skim.

**Self-critical content is checked like anything else.** A confession is a claim. See
`evidence.md`. The section admitting error is the section nobody audits.

**Nothing publishes without a PASS, or a PASS WITH CHANGES whose changes are listed
verbatim.** The live version keeps its previous content and its known defect until the
new version passes.

**The reviewer suggests wording. The suggestion does not bind, and the author owns the
artifact** and can rewrite the whole thing on the strength of the full review. Where
the author adopts reviewer wording verbatim, mark that version as carrying reviewer
text, because a gate on your own words is not a gate. 

**A reviewer who is one of two parties to a disagreement declares the conflict rather
than deciding it.**

## Around the review

**Freeze and commit.** `FROZEN` in the worker's directory with the reason, the time and
the sections under review. The document is committed before the review starts and after
any change, and **the verdict names the commit it graded**. The freeze is cooperative, and
one herd observed it silently not in effect: three target files changed under one
reviewer, one growing by three sections mid-read. So the reviewer states what it
actually read and names any section that changed and in which direction.

**Rewrite the review summary in place on every addition.** An append-only review grows
a stale summary, and the summary is the part the overseer quotes. One review went on
listing two corrections as outstanding after the worker applied them, and the overseer
nearly reported completed corrections as still open. Detailed sections get an
inline RESOLVED, SUPERSEDED or UPDATED note pointing at the summary.

**Corrections go back to the worker that produced the work**, which re-verifies
independently rather than copying the reviewer's numbers. Say which corrections are
substantive and which are cosmetic, and mark process notes "for future work rather than
a fix" so they are not mistaken for corrections. **Every correction records the
direction the error leaned.**

**The reviewer audits its own published claims when a new rule lands**, and reports the
hits as results. One such audit found a positional claim the reviewer had repeated
from a worker without reading the code, retracted specifically.

**Reviews and gates are two series and never merge**: `reviews/NNN-<slug>.md` for
producer claims, `gates/NNN-<artifact>-vN.md` for one publishable artifact version by
version.
