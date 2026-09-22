# Searching a binary or a compiled corpus

Open this when the corpus is compiled output rather than text: executables, libraries,
firmware images, bytecode, or anything where a name in the source does not survive into
the artifact.

`SKILL.md` carries the controls that apply to any corpus. These 13 apply on top, and each
one produced a confident wrong answer rather than an error.

1. **An indirect reference defeats a search written for a direct one.** A lookup routed
    through an indirection carries no name to match, so a search for the direct form reports
    a false absence. Compare counts of use per item, not the set of names.

2. **Enumerate the family, never one member.** One census missed a caller because it
    searched `execl` and the caller used `execve`.

3. **Fix the backward search width for the register load that feeds an indirect call by
    measurement, publish the width, then count.** A 40-byte window reported 936 unresolvable
    calls where 256 bytes reported 74. A count without its width means nothing.

4. **A reachability tool that cannot rediscover a path you already know is not trustworthy
    on the paths you do not know.** One walker stopped at every `jr`, failed its known-positive
    control, missed every path through an indexed jump table, and would have reported exactly
    the negative result the program expected.

5. **A census anchored on the wrong side of the operand order reports every target as
    unreachable.** Unreachable is a conclusion, not an empty result, which makes this the most
    dangerous member of the family.

6. **Derive addresses per version.** The shift between versions is not constant, and a wrong
    address is not a small error: it can resolve to an unrelated element, so the citation
    points a reader at content with nothing to do with the claim. It looks valid, it is
    checkable, and it fails the check. Resolve every cited address back to its named element
    before you publish it.

7. **A container named for one kind can hold another.** One package labeled for a single
    variant held 405 items, of which 119 were a different variant, including a whole
    subsystem. Read each item's own type, not the container's label.

8. **Version history is not monotonic.** A later release lacked checks an earlier long-term
    release already had. Measure both.

9. **A partial pass misses parts stored outside the main body**, and the absence it produces
    looks like a finding. One worker read four sources straight through, saw a feature in two,
    and built a divergence claim. A full pass found the feature in all four, in a section held
    apart from the main body. The absence flatters the researcher, so nothing about it feels
    wrong during the writing.

10. **An instruction read out of its structural role yields a self-consistent wrong story.**
    Four instances, three readers, every instruction decoded correctly, and the role wrong
    each time. Only a cross-check from a second structural direction exposed it.

11. **An analysis tool can mislabel one element as part of an unrelated one.** If a reference
    resolves to something structurally implausible, suspect the label before the data.

12. **A raw pattern changes length in silence.** An escape in a byte string became six
    characters instead of three and returned a false absence. The corrected probe reversed the
    finding.

13. **A unique value match is a correlation, not a mechanism.** A single hit in the expected
    place ends the search at the moment the reading is most likely wrong. Ask who reads the
    field, and follow what the object is used for, before you label the claim measured.
