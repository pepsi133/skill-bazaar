# Keeping a worker independent

Open this when one worker's value depends on not knowing what another worker, another
herd, or the overseer already believes.

## The mechanism, as ruled: a list of paths not to read

A worker that must stay independent is given **an explicit list of directories and
files it must not read**, written into its remit and into `common/config` under
`independence_no_read_list`.

**This is cooperative and imperfect, and the skill says so plainly.** Nothing enforces
it. `wB` audited its own tree and found **0 of 88,635 files unreadable to any agent** —
directory modes 775, file modes 664, no access control anywhere. The workers are the
control, and a claim of independence can only be checked afterwards, from what each
pane actually ran.

It is good enough for the cases that actually occur. Where it is genuinely not — and
that is very unlikely — operating-system user separation is the real seal, and it lives
in `sealing-os-users.md`, deliberately outside the default read path.

Three things make the list work better:

- **Ban listing and searching, not only reading.** One `ls` of a candidate directory
  would have handed any worker the whole candidate set without opening a file (`wB`).
- **Root every search at an explicit path**, never at `.` or at the tree root. (`wB`'s
  own reviewer broke this rule, reached material it was not meant to see, and declared
  it.)
- **Carve out the worker's own directory explicitly.** A rule written for other workers
  will hit the worker it was meant to exempt. (`wB`: one lane found the isolation rule
  appearing to forbid it its own directory, which would have made it unable to
  function. It stated the ask with a yes-branch and a no-branch and kept working.)

## How much re-checking: the `double_check` setting

Asked at creation. Default: **before anything leaves the herd, a second worker re-does
the important numbers and the important "we found nothing" claims, without being told
what to expect.**

Why a second worker rather than the same one: **re-measurement by the author catches
staleness only. It cannot catch a formula that is wrong the same way every time.** Two
figures that were internally consistent and wrong were caught only by an outside party
with different tooling (`w8`, `wC`), and a line-counting formula error survived several
reports until an outside herd disagreed.

Levels:

- **none.** Nothing is re-done. No defence against the failure above.
- **key numbers and key absences** (default). Cost: one worker. (`wA` ran a blind
  instrument over 38 published quantities: 36 agreed, two disagreed, and **both
  disagreements were real errors**.)
- **everything.** Every published quantity re-derived blind. Cost: roughly a worker-day
  per programme.

Whatever the level, the checker is **not told the expected answer** and does not start
from the producing worker's number. A re-measurement that read a prior answer first
**declares which items it was anchored on** and marks those items anchored (`w8`).

## Full independent rediscovery, if you ever want it

The setting is `full_independent_rediscovery` in `common/config`, and it is off by
default. Turn on `independence_no_read_list` with it.

Two or more workers deriving the same answer from the sources alone, with the overseer
matching them afterwards. `wB` ran it and got two workers reaching the same boundary
without contact. `wB` also says, in its own words, that **a smaller herd should take
the isolation rules and the review gate and skip the rest**. The cost is two workers
doing deliberately overlapping work, one of which is dropped at triage.

Rules that hold whenever any worker is being kept independent:

- **Independence is destroyed permanently by one careless briefing** and is not
  recoverable. A worker that has seen external material can still do useful work but
  can never again produce independent convergence, and everything it produces
  afterwards is labelled accordingly rather than merged into existing convergence
  claims (`wB`).
- **An example list in a remit steers by emphasis, and a supplied vocabulary
  manufactures agreement**, because two sides answering from the same menu appear to
  converge. (`wB` struck a three-item example list from its remit rather than balance
  it, accepting that the answers became harder to tabulate: an untabulatable
  description a worker derived is worth more than a clean category it was handed.)
- **Never make a worker the adjudicator of its own continuation.** (`wB` asked each
  independent worker to score how cleanly its own architecture decoded, and told it the
  overseer drops one architecture on that answer. Naming the incentive does not remove
  it; the self-score was replaced by measured counts.)
- **An exchange between independent workers transmits results, never a hypothesis
  space.** (`wB`: a 35-name list crossed legitimately as a count with a denominator and
  the receiving worker adopted it verbatim, so two zeros read as agreement when they
  were one hypothesis space checked twice.)
- **An agreement is convergence only if both sides chose their own inputs.** Tag every
  agreement with which side chose the input.

## Telling a worker that a seal exists

Two shapes, and the test between them is **whether the worker's independence is the
product**.

- **The result is the convergence** — tell the worker nothing, including that a peer
  programme exists. Knowing a result is already corroborated is itself a steer (`wB`,
  written as a standing constraint for whoever runs the herd next).
- **The worker is re-deriving something already known**, and the seal exists only to
  stop the overseer leaking the answer — **tell it a sealed answer exists and not what
  it says**. "A worker that knows it is sealed behaves better than one that suspects
  the overseer is hiding something" (`wC`).

Keep the seal **outside the project tree**, in a directory the worker cannot read.

Across herds, the same shape works as a pre-registered prediction: one herd registers a
written prediction for another herd's experiment, and the herd running it does not show
that file to the pane doing the run (`wC` and `w8`, on a run that had not resolved when
these notes were taken).
