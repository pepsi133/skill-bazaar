# herd-rigor

Optional evidence and review discipline, for work where a wrong answer costs more than a
slow one.

## Why it is optional

Every rule here costs throughput, and rule writing competes with the work for the same
budget. A method built to stop an agent being wrong displaces the work it protects, when
the problem's binding constraint is not slowness.

So this is a set of dials, not a protocol. Turn on what the work needs.

## What it holds

- Measured-or-argued labels, and the weakest link named.
- Three numbers and a control on every absence claim.
- The prediction recorded before the run, and VOID as a real outcome.
- The freeze and review gate, with four verdicts.
- Checker independence, and the no-read list that keeps a worker unanchored.
- The rules the method must obey about itself: a definition of done, a named consumer, a
  rule budget, and rules written only after the instrument works.

## Layout

| path | holds |
|---|---|
| `SKILL.md` | the dials, the six rules that go into a brief, and the gate |
| `references/evidence.md` | the long form, with the incident behind each rule |
| `references/review-gate.md` | the reviewer's brief and the publication checklist |
| `references/independence.md` | keeping a worker independent of what others believe |

## Install

```
claude plugin marketplace add /path/to/skill-bazaar
claude plugin install herd-rigor@skill-bazaar
```

Pairs with **herd-forge**, which builds the herd, and **static-analysis-controls**, which
covers the instrument defects behind a count.
