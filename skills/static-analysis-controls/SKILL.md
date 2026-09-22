---
name: static-analysis-controls
description: >-
  Use before publishing a count, a zero, a coverage figure or a reachability result, when a
  search over a tree or a set of binaries returns nothing, or when validating a scanner,
  walker, classifier or scorer. Controls that stop a sweep which did not run from reading
  as a clean zero: denominators that symlinks inflate, a grep that is a shell function,
  positive and discrimination controls, indirect references that defeat a direct search,
  the backward window for a register load, and addresses that shift between versions.
---

# static-analysis-controls

Every entry here produced a confident wrong answer rather than an error. That is the point
of the file. A tool that fails loudly costs you minutes. A tool that returns a plausible
number costs you the result, and nothing in the output says which one you are holding.

Use it in two moments: **before you trust an instrument**, and **before you publish a
number**.

## The shape of the problem

A zero has three possible causes and they look identical in the output:

1. The thing is absent.
2. The search did not read what you think it read.
3. The instrument cannot find the thing at all.

Cause 1 is the finding. Causes 2 and 3 are defects, and the only way to tell them apart is
a control run in the same pass.

## The four numbers on every absence claim

Publish all four. Three of them are cheap.

| number | what it rules out |
|---|---|
| **Canonical count** for the tree, with the command that derived it | A denominator that quietly excludes what you are looking for |
| **What the search actually read**, printed by the search itself | A sweep honest about the tree and dishonest about its own coverage |
| **A positive control from the same run**: something known to be present that the search found | An instrument that cannot find anything |
| **A discrimination control**: two inputs that must disagree, and do | A scorer, grader or classifier that returns the same answer for every input |

The fourth is the one people leave out. A positive control proves the instrument can find
something. It does not prove the instrument can tell two things apart, and a classifier
without that second property is worthless. One tool passed its own smoke test three times
while returning the same triple for every input.

**Where the instrument is noisy, measure its floor before you judge its output.** Repeat one
input five times for the jitter floor, then compare the spread across unlike inputs against
it. One measurement gave a standard deviation of 0.005 against a range of 0.6, two orders of
magnitude apart, and three parties published three wrong versions of that test before
anybody measured the floor. Publish the separation beside the scores. It is not a pass mark.
It is the scale every score in the run must be read on.

**Match the control to the target.** A control must be the same kind of needle: same case,
same word count, same line topology, same payload genre. A one-word uppercase control
standing in for a lowercase multi-word needle cannot fail on either defect.

**A control built from the same list as the search cannot detect that the list is
incomplete.** This is the hardest one to see, because everything about the run looks
correct. Measured on one sweep: it searched nine British spellings and two
narrow present-perfect forms, passed a control written from those same eleven patterns, and
reported a clean zero on both rules. A second party swept the same files with a
forty-word list and a wider pattern and found five and sixteen. The first instrument was
not broken. It found every instance of what it looked for, and it looked for too little.
The control confirmed the pattern, and nobody tested the list. When a rule names a
class rather than a string, write the control from an independent statement of the class,
or have a second party build the list without seeing yours.

**A control run later is a different pass and does not validate the earlier one.**

## Denominators

1. **Symlinks inflate a file count.** `os.walk` with `os.path.isfile()` follows symlinks and
   `find -type f` does not. One census published "590 of 590" for a tree holding 557 regular
   files. In another tree, 80 of 962 symlinks resolved outside it to host absolute paths, so
   a walk that follows them reads the host's files and does not say so. No walk follows
   symlinks.

2. **A file count and a distinct-artifact count are different quantities.** Every census
   states which one it reports.

3. **A denominator goes stale while you use it.** One worker counted 582 files, made a
   correct absence claim, and later found 1126, because another worker's extraction still
   ran. Make sure the tree stopped changing before you publish an absence claim.

4. **Know what your denominator excludes.** Between 19.8 and 26.8 percent of one archive set
   never reached extraction, and that region held valid entries. Every negative result at
   that checkpoint fell at once.

5. **State the scoping rule with every count.** Three counts of one thing differed by scope
   and reconciled only because one of them stated its rule.

6. **`count(newline) + 1` overcounts by exactly one** on any file ending in a newline. It is
   always wrong, by one, on almost every file, and never wrong enough to look wrong. Use
   `wc -l` semantics and say so.

## The shell is an instrument too

7. **`grep` can be a shell function rather than a program.** Run `type grep` before you trust
   a count. Where it is a function, it can rewrite every call with binary-skipping,
   gitignore-obeying and directory-excluding flags, and every filter then exits 1 with empty
   output, which is byte-for-byte a real no-match. One measurement read 66 of 557 files in a
   tree without the override. `-a` alone does not disable the ignore file. For a published
   count use `/usr/bin/grep` by absolute path, or Python with `bytes in data`.

8. **The audit command that checks for entry 7 can produce a false retraction**, because the
   fix flags belong to different programs, and a rejected flag prints nothing and exits
   non-zero. Read the exit status of every audit command before you believe its result.

9. **`find` can be wrapped the same way.** Check it the same way, and cross-check any
   publishable count with an absolute path or with Python.

10. **The interactive shell is not always bash.** Check with `echo $0`. Under zsh, unquoted
    `set -- $var` does not word-split, so a path built from it does not exist, and `os.walk`
    on a path that does not exist yields a clean "0 files, 0 errors" that reads as success.
    zsh arrays start at 1. Make every walker refuse a root that does not exist.

11. **`${VAR:-default}` substitutes on an empty value as well as an unset one.** An explicit
    empty value becomes the default in silence.

12. **A gate that greps its own output file matches the requirements printed in its own
    header, and runs green.** Prove a gate can fail before you trust it.

13. **`2>&1` glues stderr into a number, and a trailing `|| echo` swallows an exit status.**
    Read exit status and stderr separately. A correct number once arrived attached to a
    warning and was accepted as the number.

14. **A stdout-only capture reports an empty list for a tool that prints to stderr, and
    the `--help` form of the same command can print something different.** Measured on one
    command-line tool: the bare subcommand printed a list of twenty-two values on stderr
    and exited 2, the same subcommand with `--help` printed that list on neither stream
    and exited 0, and a stdout-only capture of either returned nothing. Three readings,
    one true list, and two of the three show nothing. Before you report that a tool lists
    nothing, run it with `2>&1`, run the bare form as well as `--help`, and print the exit
    status beside each.

15. **Never search a multi-word phrase to establish an absence.** `grep` is line-based and
    prose is hard-wrapped, so a phrase crossing a newline cannot match, and the zero is
    indistinguishable from the phrase being absent. Search a single distinctive token, case
    insensitively.

16. **Extracted-tree mtimes are image timestamps the unpacker preserved**, and they run ahead
    of the host clock. Never read them as evidence of when something touched a tree.

## Searching a binary or a compiled corpus

A compiled artifact defeats a search written for source: a name can vanish into an
indirection, an address can move between versions, and a container can be labeled for one
kind and hold another. `references/compiled-corpus.md` carries the 13 controls for that
case. Open it when the corpus is executables, libraries, firmware, or bytecode.

## Editing and reporting

17. **A string sweep where one pattern is a substring of another half-edits the document and
    reports success.** Order patterns most specific first. Assert that every pattern matches.
    Report the count before, after, and deliberately left, with a reason for each one left.

18. **A completion marker proves acceptance, never effect.** One delta reported 12 of 12
    markers green while a step that never ran left no row. Count the rows afterwards.

19. **A batch runner prints its retry count, not only its failure count.** A runner that
    retries silently and reports zero failures describes its own persistence and not the
    channel.

20. **A sweep that reports a number and not a list cannot be audited by the person it just
    reassured.** Print the list of files the run read.

21. **A guard lost in a rewrite is silent.** When you rewrite a rule or a script, carry its
    internal guards across on purpose. One lost guard made a scanner overstate its hits
    tenfold.

22. **Validate the instrument against a case you can see.** One scanner's first pass flagged
    1010 of 1545 files against a corrected 29 of 490, and four of its high-confidence hits
    were defects in the scanner.

23. **A defect in a worked example is worse than a defect in a rule.** A reader weighs a rule.
    A reader pastes an example, and it spreads by imitation. Audit examples before rules.

24. **Test the boring explanation first.** A rich catalog of failure families makes
    diagnosis worse as well as better. Two experienced readers filed a plain formula error
    under two sophisticated families they had each been burned by, and both were wrong. One command settled
    it and neither ran it.

## Reference files

| file | open it when |
|---|---|
| `references/compiled-corpus.md` | The corpus is executables, libraries, firmware or bytecode |

## The checklist before you publish a number

- [ ] `type grep`, `type find`, `echo $0` run, and the result stated
- [ ] The denominator command printed beside the denominator
- [ ] What the search read printed by the search itself
- [ ] A positive control in the same pass, and it passed
- [ ] A discrimination control where the instrument scores, grades or classifies
- [ ] The tree confirmed static since the denominator was derived
- [ ] Exit status read separately from output
- [ ] Every quantity stated twice in the document checked against itself
