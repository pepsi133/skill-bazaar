# static-analysis-controls

Controls for counting and for absence claims across a corpus of files or binaries.

## Why it exists

A zero has three possible causes and they look identical in the output: the thing is
absent, the search did not read what you think it read, or the instrument cannot find the
thing at all. Only a control run in the same pass tells them apart.

Every entry in this skill produced a confident wrong answer rather than an error. One
census published "590 of 590" for a tree holding 557 regular files, because `os.walk` with
`os.path.isfile()` follows symlinks. One `grep` was a shell function that read 66 of 557
files and returned a clean empty result. One reachability walker failed its own control and
would have reported exactly the negative result the program expected.

## What it holds

- The four numbers on an absence claim, and the discrimination control that most
  instruments never get.
- Denominators: symlinks, staleness, scope, and what the count excludes.
- The shell as an instrument: `grep` and `find` as functions, `${VAR:-default}` on an empty
  value, exit status glued into a number.
- Search over a compiled corpus: indirect references, backward window width, per-version
  address shift, container labels, partial passes.
- A checklist to run before publishing any number.

## Install

```
claude plugin marketplace add /path/to/skill-bazaar
claude plugin install static-analysis-controls@skill-bazaar
```

Pairs with **herd-rigor**, which says to print the control. This skill says which controls
fail silently.
