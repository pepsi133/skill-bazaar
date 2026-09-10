# Evidence discipline — the long form

`SKILL.md` section 8 carries the rules that every worker remit needs. This file is
the rest, with the incident behind each one. A rule with a named incident is
load-bearing on evidence; a rule without one is load-bearing on argument, and this file
says which is which.

## Labels

**Measured or argued, on every claim, with the weakest link named.** *Measured* means
it can be redone from the shipped files using the path and the method given, without
reference to the author's notes. *Argued* means reasoned from real evidence that does
not close the question, and an argued claim names what would settle it. (`wC`: a
mapping was labelled argued with "no primary source rendered", against the herd's own
naming.)

**Anything located but not read is a location, not a finding**, and supports nothing.
A bare location is not a finding. Say it in the same sentence as the location, because a
receiving reader will otherwise treat it as confirmed (`wA` released one this way,
twice labelled).

**Confidence is per item and is defended.** A measurement of one sample is not high
confidence, and a high-confidence label beside an untraced step fails the gate (`w8`).

**The five-class option.** `wB` ran S0–S4 with a citation standard: every S1–S3 claim
cites the source, its path, a content hash of it, the exact location within it, and
the method used to read it, and **a claim that cannot be re-derived is S4 regardless of
how convincing it reads**. Recall is S4, named as the known hallucination vector. It earns
its cost where the question is "which of several candidate sources is this". (`wB`: a
cited strong-class value was not at the cited location; the claim dropped to the
weakest class and the real source of it nearby turned out to be the better finding.)

## Absence

**Three numbers, always: the canonical count, what the search read, and a same-run
control.** The three failures behind them:

- `wA` published **590 of 590** for a tree holding **557** regular files, because
  `os.walk` with `os.path.isfile()` follows symlinks and `find -type f` does not.
  Symlink inflation corrupted a published count four times in that herd, and in `wB`
  **80 of 962 symlinks resolved outside the tree to host absolute paths**, so a walk
  that follows them reads the host's own files and does not say so.
- `wB` enumerated **2 of 5** target files while printing a true denominator of 1391 of
  1391 — honest about the tree, dishonest about the search.
- `wC`'s own reviewer ran a reachability walker that stopped at every `jr`, failed its
  mandatory known-positive control, missed every path through an indexed jump table,
  and **would have reported exactly the negative the programme expected**. A
  reachability tool that cannot rediscover a path you already know exists is not
  trustworthy on the paths you do not know.

**A canonical count goes stale.** `wB` counted 582 files, made a correct absence claim,
and later found 1126, because another worker's extraction was still running. Re-check
that the tree has stopped changing, and keep the derivation command and the tree state
in `common/DENOMINATORS.md` so a reader can tell a stale count from a current one.

**A control run later is a different pass and does not validate the earlier one.** Both
of `w8`'s field instances of this rule caught the rule's own holder.

**If no known-present instance exists, no control is possible.** Say so in the claim
and label the claim argued. Never publish that zero as measured.

**Never conclude absence from a truncated or narrowed view.** Truncation is for
orientation. (`w8`: four instances in one day, in three sessions, including the
overseer.)

**An absence produced by a partial pass is not established until the whole of the
thing searched is accounted for**, including parts held outside its main body. Note the direction: **the absence flatters the
researcher**, so nothing about it feels wrong while it is being written. (`wA`: a
divergence claim across four sources was a measurement artefact; an independent
full pass found the feature present in all four.)

**An absence of FORMS needs a completeness check that an absence of ITEMS does not.**
Before concluding that none of the known forms occurs, ask whether the list of forms is
complete; the cheap test is to measure the thing directly rather than enumerate its
categories (`w8`).

**Enumerate the family, never one member.** (`w8`: a census missed a caller because it
searched `execl` and the caller used `execve`.)

## Numbers and citations

**State the scoping rule with every count.** (`w8`: three counts of one thing differed
by scope and reconciled only because one stated its rule.)

**Report count, hash and mtime together, and write the command beside the number.**
Only the mtime lets two readers order their readings and tell a race from a mistake.
(`w8`: one released file passed through five real states in a few minutes and two
readers each reported the truth while appearing to contradict each other.)

**Publish the full 64-character hash, or label a prefix as a prefix.** (`w8`: a
truncated value read as an MD5 produced a false mismatch across a programme boundary
and cost both sides effort.)

**A file count and a distinct-source count are different quantities**, and every census
says which it reports (`wA`).

**Derive locations per version, and resolve every cited location back to its named
element before publishing.** The shift in locations between versions is not constant,
and a wrong location can name a different element entirely: the citation looks valid, it is checkable, and it
fails the check (`wA`).

**Before any document is called ready, list every quantity it states more than once and
confirm the occurrences agree.** Internal contradiction is the one error class that
needs no access to the underlying evidence, and every hit is real. (`wA`: one document
held two values for one quantity through two separate reviews, because each review
checked a section against its own evidence and none checked sections against each
other.)

## Inference

**The measurement can be sound and the role assigned to it wrong.** For every claim
resting on a measurement ask three questions separately: is the measurement right; does
it bear the weight; and **what else would produce this same measurement**. If something
would, the claim is consistent with the conclusion rather than establishing it. (`wC`:
four instances in one day, one of which cost four crash records permanently.)

**Inherited assumptions are the recurring failure, not bad measurement.** Version
ordering, a type a package's name implies, and a consumer list taken from a prior
report were each correct as measurements and wrong as models. Flag the dependency
wherever a claim rests on what a name or a version implies (`wA`).

**Test the boring explanation first.** A rich catalogue of failure families makes
diagnosis worse as well as better. Include "somebody simply got it wrong" as a
first-class candidate, because it is the cheapest to test. (`w8` and `wC`, the same
day: two experienced readers filed a plain formula error under two sophisticated
families they had each been burned by. One command settled it and neither ran it.)

**A unique match is a correlation, not a mechanism.** A single hit in the place you
expected terminates the search at the moment the reading is most likely to be wrong.
Ask who reads the field before labelling the claim measured (`wA`, `w8`).

**Establish that a mechanism operated before attributing an effect to it.** (`wB`: this
was the overseer's most common failure and a worker caught it both times. `wB` again: a
memory-kill warning was propagated to two other programmes before anyone checked the
kernel log, which showed zero events.)

**Before inferring from any system quantity, establish whether something else can move
it.** (`wA`: two accurate readings of `MemTotal` differed with nothing done in between,
because the host balloons guest memory. The instrument did not lie and no number was
wrong; the assumption of fixedness was the whole defect. Recording each reading with
its command and timestamp is what made it recoverable.)

## Confessions and corrections

**A confession is a claim.** A false statement against your own interest is still a
false statement, and it is uncheckable by any reader, because nobody audits a claim
that costs the author something. Self-critical text — a corrections file, a bias
ledger, a "how this is most likely wrong" section, a gate statement — carries the same
label as any other claim and goes through the same review. **The section of a report
most likely to hold an unchecked error is the section admitting error.** (`wC`: a page
carried a wrong gate statement, and the false statement sat inside the very section
whose purpose was to show the herd hides nothing.)

This skill proves the rule on itself. Its author audited its own propagation failure,
reported three gaps, and the reviewer then found a fourth. The self-report understated
the failure by one. The true count is five of seven fixes that reached only one of the
three files that state a rule.

**Every correction records which direction the error leaned** — whether it flattered
the author. Only errors that flatter tend to survive review, so the direction is the
field that predicts recurrence. (`wC` published the direction of its own error
unprompted; `wA`'s false divergence claim leaned the same way.)

**A retraction names which part fell.** A blanket withdrawal offered as fairness
destroys a correct finding alongside an incorrect one. (`wC`: the neighbouring herd
declined half a retraction, on the grounds that accepting an undeserved one corrupts
both records.)

**A correct claim held for a bad reason is still a bad claim.** Record the retraction;
do not silently substitute a better warrant (`wC`).

**Record the correction in the document that carried the error**, with the scoping rule
that would have prevented it (`w8`).

## Independence of a result

**An agreement is convergence only if both sides chose their own inputs.** Tag every
cross-worker agreement with which side chose the input. (`wB`: an exchange between two
independent workers transmitted a hypothesis **space** — a 35-name list that the
receiving worker adopted verbatim, same names, same order, same case variants — so two
zeros read as two workers agreeing when they were one hypothesis space checked twice.
Neither worker broke a rule; the gap was in the rules.)

**A hypothesis that came from outside is labelled externally prompted.** The evidence
may be yours; the hypothesis is not, so the result is not independent convergence with
the document that prompted it (`wB`).

**A "not established" value may never be quietly resolved into "closed."** A wrong
"closed" costs the operator a vulnerability they believe is shut. (`wB`: the report did
exactly this and the reviewer blocked publication.)

**State what you did not test as prominently as what you did.** A finding that survives
its own limits section is one somebody else can build on (`w8`).
