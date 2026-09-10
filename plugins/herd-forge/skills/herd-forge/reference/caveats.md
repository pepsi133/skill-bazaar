# Caveats: measured defects, not assumptions

Every entry below produced a confident wrong reading, not an error. A tool that fails
loudly costs you minutes. A tool that lies costs the operation its credibility. (`w8`,
`wB`.)

Four herds ran on one host in September 2026 and produced this list: `wA` (static, probe
run), `w8` (owner of the only device), `wB` (static, independent workers), `wC`
(youngest, field notes, unreviewed as documents). That is the whole sample. Read
"always" and "never" as always and never inside that sample. Expect a second programme
on different hardware to add entries, not to confirm these. Each entry names the herd
that paid for it.

`[HW]` marks an entry that needs a device.

## 1. Herdr CLI and panes

1. Herdr refuses an agent name while a live agent holds it, and releases the name when
   that agent exits. `herdr agent start critic` failed with `agent_name_taken`, because
   an unrelated workspace already ran an agent called `critic`. The namespace covers
   the Herdr session and spans every workspace in it, so it reaches other herds. Prefix
   every name with the herd. (`wA` and `wC` collided on their own. An earlier version
   of this entry said "host-wide", which is measured only while one session runs. See
   `herdr-facts.md`.)

2. `herdr tab create --cwd DIR` lands in the home directory when `DIR` does not exist,
   and reports no error. The agent then hangs in `blocked during startup` forever.
   Create the directory first, then the tab, in separate steps. (`wC`.)

3. `agent prompt --wait` returns a `timeout` error on any long task. The prompt landed.
   `--wait` waits only for the next settled state, which a multi-step task does not
   reach for many minutes. Exit status is 1 and the JSON says
   `{"error":{"code":"timeout"}}`. Do not send the prompt again. Run
   `herdr agent get <name>` and look for `working`. (`wA`.)

4. `herdr agent prompt` takes a pane id as the target, not only a name. That is the
   only way to reach a pane that carries no agent name. (`wC`.)

5. A prompt sent to an agent that is already `working` lands. Herdr processes it inside
   or after the current turn. Ordering is not guaranteed. Send anything
   order-dependent as one message. (`wA`.)

6. `agent_status: done` never means finished. A completed agent, an idle agent, an
   agent blocked on a dialog, and an agent that died on the account token limit all
   report the same value: the process does not run now. This caused a wrong
   instruction. An overseer read rate-limit lines in a transcript, concluded that a
   background fork died, and told a worker to redo work that had finished. The worker
   caught it. Treat status as a hint, never as a conclusion. (All four herds, on their
   own.)

7. A pane can report `done` and write nothing. One lane finished its required reading
   and stopped. Read the files. (`wC`.)

8. Bare `herdr` starts the TUI. Never run it for discovery. A command group with no
   subcommand prints help and exits 2, which is normal there. (`wA`.)

9. `herdr agent list` returns every workspace, interleaved. Filter it. Do not read it
   by eye. (`wA`.)

10. Use `tab create`, not repeated `pane split`. Repeated splits in one direction give
    unusably narrow columns by about the fourth pane. The new pane id is at
    `.result.root_pane.pane_id`. (`wA`.)

11. An agent started by hand carries no Herdr name and is not addressable by name.
    `herdr agent rename <pane-id> <name>` fixes it. (`wA`.)

12. Native agent arguments go after `--`. `herdr agent start standby --kind claude
    --pane wA:p8 -- --model opus` gives `argv: ["claude","--model","opus"]`. (`wA`.)

13. Read transcripts with `--source recent-unwrapped`, which joins soft wraps. Rows
    that left the alternate screen never enter host scrollback, so a larger `--lines`
    cannot recover them. Ask the agent to write a file instead. (`wA`.) The same
    wrap-joining defeats a completion marker split across a wrap, so a driver reports
    failure after the command succeeded. (`wB`.)

14. The read window is a denominator. A 60-line pane read returned zero hits. The same
    search at 400 lines returned one hit, and the overseer nearly reported a message as
    undelivered. A digesting agent re-read at 400, 420 and 500 lines. (`wB`, `w8`.)

15. Agent-to-overseer messaging is not uniform. Some panes sent cross-session messages
    directly. Another pane reported that it had no direct messaging and wrote to
    `STATUS.md` instead. Never design a workflow that depends on an agent reaching you.
    (`wA`.)

16. Cross-session messages arrive as user-role turns in the overseer and interrupt it,
    so the overseer does not control its own turn boundaries. (`wA`.)

17. Agent-tool subagents are blocked from writing report files, inconsistently. One
    wrote 52 KB without complaint. Another was refused with "Subagents should return
    findings as text". Use panes for anything durable. Have subagents return text and
    write it yourself. (`wC`.)

18. The Write tool refuses the literal filename `FINDINGS.md` here, as a disallowed
    report-pattern name. A Bash heredoc has no such restriction. (`wC`.)

19. Delegated sub-tasks exceed their scope and race on one file. If you find a
    concurrent write, read the live state and merge. Never overwrite and never discard.
    (`wC`: two of four sub-tasks redid parts of the job in parallel.)

20. A fork of the overseer is indistinguishable from the overseer. A fork sent four
    prompts to the device pane and the pane obeyed them, because every message arrives
    through one channel with no source label. The marker rule exists for this reason,
    and this is also why the marker cannot authenticate. (`w8`.)

## 2. Compaction and slash commands

21. A slash command sent to a pane becomes ordinary text, through two mechanisms.
    Bracketed paste turns text above a length threshold into `[Pasted text #N]`, and
    the client never reads a paste block as a command. A typed command works, and then
    trips paste detection above roughly 450 characters. The call returns
    `agent_prompted`, the pane goes `working` then `done`, and nothing compacts. Nine
    panes answered a compaction request in prose and none compacted, while the counter
    stayed at zero and the context figure rose. (`w8`, `wB`.) `wA` measured that a
    short argument through `herdr agent prompt` did compact correctly, and that a
    1500-character argument vanished in silence. The two readings disagree, so use
    entry 22, which works under both.

22. The delivery method that works: `send-keys ctrl+u` twice, because escape does not
    clear a paste placeholder. Then `send-text "/compact"`. Then `send-text " <short
    instructions>"`, where the leading space is load-bearing, because Enter with the
    autocomplete menu open selects the highlighted entry. Then `send-keys enter`. Keep
    the text short enough to type rather than paste. About 300 characters worked.
    (`wB`.)

23. Make sure of a compaction through the `isCompactSummary: true` record in the
    session `.jsonl`. Do not use the return of the pane to `done`, and do not use its
    reply. An agent that answers a command in prose did not run it. (`wB`, `w8`.)

24. The last usage record reports the context size of the last request, so it still
    shows the figure from before the compaction. An unchanged figure is not evidence of
    a failed compaction. (`wB`.)

25. Measure pane context from the transcript, not from the client footer, which rotates
    and lies. The per-agent figure is the sum of the input and cache token fields of
    the last usage record in the session file. (`w8`.)

26. After a compaction, a queued prompt can sit unsubmitted in the pane. It needs an
    explicit key send. (`w8`.)

27. Never force a compaction on an agent that works on a task, and never on the
    overseer during a task. An agent counts as mid-task unless two conditions hold
    together: `agent_status` reports idle or `done`, and the agent wrote its handover
    after its last work item. An agent compacted a few minutes late loses nothing. An
    agent compacted during a trace loses the working set that it assembled, and cannot
    tell that it did, because the lost context is what it needs to notice the loss. For
    an overseer, the loss covers the state of the whole herd. (Operator rule, held by
    `wA`, `wB` and `w8`.)

28. Anything that is not on disk does not survive a compaction. One herd wrote its
    operator directives to a ledger for this reason. In another herd, seven
    load-bearing measurements existed only in a session transcript. (`wB`, `w8`.)

29. Closing a pane does not destroy its session. A closed pane resumes with
    `claude --resume <id>` in its own directory, takes a new pane id, and comes back
    compacted. The first instruction must tell it to re-read its rules, its remit and
    its status file. Record the session id and the model before you close. (`wA`,
    `wB`.)

30. Scratchpad logs are session-scoped. They do not survive the session. Say so in the
    file that points at them. (`w8`.)

## 3. Account, quota and scheduling

31. The token limit is account-wide and stops every agent at once. Six panes hit the
    weekly limit within about six minutes. Plan for total stoppage, not for one worker
    stalling. (`wA`.)

32. A rate-limited agent never resumes by itself. The window resets and the pane still
    sits idle. Somebody must prompt every stalled agent one at a time. Budget for that
    as manual work. (`wA`.)

33. A background fork inside a pane fails hard on the rate limit. It surfaces as an
    agent failure with an HTTP 429, not as a retryable condition. (`wA`.)

34. `CronCreate` is session-only and fires only while the REPL is idle. It covers a
    quota pause, where the process lives and waits. It does not cover process death,
    because nothing reaches disk and the job dies with the session. (`wA`.)

35. A scheduled wake-up can fire into the session that scheduled it, with full context.
    A wake prompt written in "you have no memory" style is then wrong about its own
    premise. Tell the reader to establish current state from documents, rather than to
    assume either memory or amnesia. (`wA`.)

36. Do not build `setsid` or `nohup` timers. They appear in no list that the operator
    checks, and the UI cannot cancel them. A staggered-retry design is hard to stop.
    Use the visible scheduler even though it is weaker. If the visible tool cannot
    cover the case, say so and let the operator decide. (`wA`.)

## 4. Shell, filesystem and environment

37. `grep` is a shell function here, not a program. It rewrites every call with
    binary-skipping, gitignore-obeying and directory-excluding flags. Every filter
    exits 1 with empty output, which is byte-for-byte a real no-match. Measured: 66 of
    557 files read in one tree without the override. `-a` alone does not disable the
    ignore file. For any count that you publish, use Python `os.walk` with
    `bytes in data`, or `/usr/bin/grep` by absolute path. (`w8`, `wB`, `wA`.)

38. The audit command that checks for entry 37 can produce a false retraction, because
    the fix flags belong to different programs, and a rejected flag prints nothing and
    exits non-zero. Read the exit status of every audit command before you believe its
    result. (`wB`, `w8`.)

39. `find` is also a shell function here. It agrees with the real binary today. It
    belongs to the same family, and the next agent must not assume that it stays
    honest. Cross-check any publishable count with an absolute path or with Python.
    (`wB`.)

40. The interactive shell is zsh, not bash. Unquoted `set -- $var` does not word-split,
    so a path built from it did not exist, and `os.walk` on a path that does not exist
    yields a clean "0 files, 0 errors" that reads as success. zsh arrays start at 1, so
    a bash-style loop used the wrong elements in silence. Make every walker refuse a
    root that does not exist. (`wB`.)

41. `${VAR:-default}` substitutes on an empty value as well as an unset one. An
    explicit empty value became the default in silence. In one case an empty vendor
    password became a real one and a reset never ran. (`wB`, `w8`.)

42. A gate that greps its own output file matches the requirements printed in its own
    header, and runs green. Prove that a gate can fail before you trust it. (`wB`,
    `w8`.)

43. `2>&1` glues stderr into a number, and a trailing `|| echo` swallows an exit
    status. Read exit status and stderr separately. A correct number once arrived
    attached to a warning and was accepted as the number. (`wC`, `w8`, `wB`.)

44. Backticks in an unquoted shell context delete text from the artefact that you
    write. The shell substitutes the empty output of the failed command in place of
    your words. It bites inter-pane prompts and heredocs alike. The sender sees a stray
    error line that scrolls away, and the recipient cannot tell a mangled report from a
    complete one. Detection works on residue and cannot prove absence. (`w8`.)

45. Long prompts through shell quoting are fragile. Write the remit to a file and pass
    `"$(cat file)"`. Avoid apostrophes and shell metacharacters in remit text. That
    also pushes the writing toward plain sentences. (`wA`.)

46. Extracted-tree mtimes are image timestamps that the unpacker preserved, and they
    run ahead of the host clock. Never read them as evidence of when an agent touched a
    tree. (`wB`.)

## 5. Counting, denominators and absence

47. Symlinks inflate file-count denominators. `os.walk` with `os.path.isfile()` follows
    symlinks. `find -type f` does not. One agent published "590 of 590" for a tree
    whose real count is 557 regular files, of which 555 are non-empty, and the reviewer
    caught it. Of the 34 symlinks in that tree, 19 had absolute targets outside it. In
    another herd, 80 of 962 symlinks resolved outside the tree to host absolute paths,
    so a walk that follows them reads the files of the host and does not say so. No
    walk follows symlinks. (`wA`, `wB`.)

48. A file count and a distinct-binary count are different quantities. Every census
    states which one it reports. Symlink inflation corrupted a published count four
    times in one herd. (`wA`.)

49. A denominator goes stale while you use it. One worker counted 582 files, made a
    correct absence claim, and later found 1126, because the extraction of another
    worker still ran. Re-run the count. Make sure that the tree stopped changing before
    you publish an absence claim. (`wB`.)

50. A denominator can be honest about the tree and dishonest about the search. A needle
    sweep enumerated 2 of 5 target files while it printed a full denominator of 1391 of
    1391. Print what the search read. (`wB`.)

51. Every published zero carries a live positive control from the same pass, in the
    same command, over the same file set. A control run later is a different pass and
    does not validate the earlier one. Both field instances of this rule caught the
    holder of the rule. (`w8`, `wB`, `wC`.)

52. A reachability tool that cannot rediscover a path that you already know is not
    trustworthy on the paths that you do not know. The walker of one reviewer stopped
    at every `jr`, failed its mandatory known-positive control, missed every path
    through an indexed jump table, and would have reported exactly the negative result
    that the programme expected. (`wC`. The strongest entry in this file.)

53. A census anchored on the wrong side of the operand order reports every target as
    unreachable. Unreachable is a conclusion, not an empty result, which makes this the
    most dangerous member of the family. Prove that the census can find something
    before you trust it to find nothing. (`w8`.)

54. `count(newline) + 1` overcounts by exactly one on any file that ends in a newline.
    It is always wrong, by one, on almost every file, and never wrong enough to look
    wrong. It survived several reports until an outside herd disagreed. Use `wc -l`
    semantics and say so. (`wC`, `w8`.)

55. Fix the backward search width for the register load that feeds an indirect call by
    measurement. Publish the width, then count. A 40-byte window reported 936
    unresolvable calls where 256 bytes reported 74. A count without its width means
    nothing. (`wB`.)

56. The first pass of one scanner flagged 1010 of 1545 files against a corrected 29 of
    490, and four of its high-confidence hits were defects in the scanner. Validate the
    instrument against a case that you can see before you trust its census. (`w8`.)

57. Between 19.8% and 26.8% of every input archive never reached extraction, and
    that region held valid entries. Every denominator in that operation understated
    M, so every negative result at that checkpoint fell at once. Know what your
    denominator excludes. (`wB`.)

## 6. Analysis instruments

58. An indirect reference defeats a search written for a direct one. A lookup routed
    through an indirection carries no name to match, so a search for the direct form
    reports a false absence. Compare counts of use per item, not the set of names.
    (`wA`, `wC`.)

59. An instrument that returns an empty result may report a tool error, not a true
    negative. A mapper pointed at the wrong kind of input finds nothing, and every
    item then looks absent. (`w8`.)

60. A raw pattern in a probe changes length in silence. An escape in a byte string
    became six characters instead of three and returned a false absence. The corrected
    probe reversed the finding. (`wC`.)

61. An analysis tool can mislabel one element as part of an unrelated one. If a
    reference resolves to something structurally implausible, suspect the label
    before the data. (`wA`.)

62. The shift in locations between versions is not constant, and a wrong location is
    not a small error. A claim cited one location for two versions. In the second
    version the location resolved to an unrelated element, so the citation pointed a
    reader at content with nothing to do with the claim. It looks valid, it is
    checkable, and it fails the check. Derive locations per version. Resolve every
    cited location back to its named element before you publish it. (`wA`.)

63. A partial pass misses parts stored outside the main body, and the absence that it
    produces looks like a finding. A worker read four sources straight through, saw a
    feature in two of them, and built a divergence claim. An independent full pass
    found the feature in all four, in a section held apart from the main body. The
    absence flatters the researcher, so nothing about it feels wrong during the
    writing. (`wA`.)

64. A container named for one kind can hold another. A package labelled for one variant
    held 405 items, of which 119 were a different variant, including a whole subsystem.
    Read each item's own type, not the container's label. (`wA`.)

65. Version history is not monotonic. A later release lacked checks that an earlier
    long-term release already had. Measure both. (`wA`.)

66. Check a claim against the exact source that the claim is about. A conclusion drawn
    from real evidence taken from the wrong file was wrong. (`wA`.)

67. A unique value match is a correlation, not a mechanism. A single hit in the
    expected place ends the search at the moment when the reading is most likely wrong.
    Ask who reads the field, and follow what the object is used for, before you label
    the claim measured. (`wA`, `w8`.)

68. An instruction read out of its structural role yields a self-consistent wrong
    story. Four instances, three readers, and every instruction decoded correctly. The
    role was wrong each time. Only a cross-check from a second structural direction
    exposed it. (`w8`.)

69. A string sweep in which one pattern is a substring of another half-edits the
    document and reports success. Order patterns most specific first. Assert that every
    pattern matches. Report the count before, after, and deliberately left, with a
    reason for each one left. (`w8`.)

70. A completion marker proves acceptance, never effect. A delta reported 12 of 12
    markers green while a step that never ran left no row. Count the rows afterwards.
    (`w8`, `wA`.)

71. `MemTotal` is not a ceiling on a ballooning guest. An overseer read it twice, got
    two different values with nothing done in between, and concluded that an operator
    change had not taken effect. Both readings were accurate and the quantity was
    dynamic. The instrument did not lie and the number was not wrong, so none of the
    usual checks on tool behaviour would have caught it. Before you infer from any
    system quantity, establish whether something else can move it. Record every reading
    with its command and its timestamp. (`wA`, `wB`.)

72. A memory-kill warning reached two other programmes and cost real re-measurement
    before anybody checked whether the mechanism operated. The kernel log showed zero
    OOM events. Direct evidence that an event occurred beats an inference that it can
    have occurred. (`wB`.)

## 7. Documents, gates and cross-boundary work

73. A gate applies to a version, not to a name. A review gated a 330-line file that is
    now 533 lines, with 203 lines appended after the gate. The same document reached
    676 lines while the receiving herd still heard that it was reviewed. Three herds
    were caught by this in one day. The ruled mechanism is the commit: commit the
    document before the review and after any change, and name the commit in the
    verdict. (`wC`, `w8`, `wA`.)

74. If a herd does not commit, a whole-file hash on an artefact under active
    multi-party revision fires on every revision and carries no information. Hash the
    range that you read instead. This is the fallback before git. The commit is the
    rule. (`w8`.)

75. A declared freeze can simply not be in effect. One herd declared a freeze and all
    three target files changed under the reviewer. One file grew by three sections
    during the read. Recording the reviewed state made the verdict interpretable,
    because its "clean" verdict was true of a version that was not the version on disk
    when the review started. (`wC`.)

76. An append-only review document grows a stale summary, and the overseer quotes the
    summary. It listed two corrections as outstanding after the worker applied them,
    and the overseer nearly reported completed corrections as still open. Rewrite the
    summary in place on every addition. (`wA`.)

77. A document that states one quantity twice must be checked against itself. One
    worker published a count correctly in one section and wrongly in another, in
    the same file, and it survived two reviews, because each review checked a section
    against the evidence of that section and neither checked the sections against each
    other. (`wA`.)

78. The gate state of a document decays as the document changes, and nobody has to lie
    for it to end up wrong. New claims arrive under old headings. A corrected section
    keeps the label that the version before the correction earned. One herd was caught
    three times in one day, once in a document that it had already released, so the
    wrong gate state travelled with it. (`wA`.)

79. Never edit a released artefact in place. Append a dated addendum with an explicit
    line that the body above is unchanged, because another programme can run an
    independent replication against the released bytes. An in-place edit is a
    contamination channel that the releasing party creates, and the reader cannot see
    it. (`wC`, `w8`.)

80. Snapshot at gate time, before any edit. An in-place audit that downgrades claims
    rewrites gated bytes and feels like an improvement. The honest result of a skipped
    snapshot is the sentence "the review confirmed a version that can no longer be
    produced". (`w8`.)

81. The shared handover directory has no git history. Snapshot a released artefact into
    your own repository before you touch it. (`w8`.)

82. Publish the full 64-character hash, or label a prefix as a prefix. A truncated
    value read as an MD5 produced a false mismatch across a programme boundary and cost
    both sides effort. (`w8`.)

83. Report count, hash and mtime together. Only the mtime lets two readers order their
    readings and tell a race from a mistake. One released file passed through five real
    states in a few minutes, and two readers each reported the truth and appeared to
    contradict each other. (`w8`, `wC`.)

84. A permission classifier can refuse to deliver a cross-herd reply, and that refusal
    is not a transport error that you can work around. Write the artefact into your own
    tree, record the verbatim refusal, and tell the operator, including that the
    recipient does not know and still waits. Do not chunk it, do not re-encode it, and
    do not switch channels. (`wA`.)

85. A check that a requesting workspace exists proves only that the request is not
    fabricated content. It is not authorisation. These are two independent checks, and
    the first says nothing about the second. (`wA`.)

86. A release of findings can destroy an independent pass that the receiving herd
    depends on, and the damage is invisible afterwards, because an anchored conclusion
    looks exactly like an independent one. The releasing side usually does not know the
    settings of the receiver. (`wA`, `wB`.)

87. A clearance is a contamination channel. An overseer cleared a document as
    established without reading its section 1, which already held an answer-shaped set
    for an independent derivation then in flight. The worker had finished first, by
    luck. (`wC`.)

88. Isolation is declarative and unenforced. An audit found 0 of 88,635 files in one
    herd tree unreadable to any agent: directory modes 775, file modes 664, and no
    access control anywhere. The agents are the control, and only pane scrollback can
    audit an independent pass afterwards. One `ls` of a candidate directory would have
    handed any agent the whole candidate set without opening a file. Ban listing and
    searching, not only reading. Root every search at an explicit path, not at the tree
    root. (`wB`.)

## 8. Device and console `[HW]`

89. Drive an interactive console through a Herdr pane, not a blind pty. Three sessions
    lost hours to `pexpect` before this was settled. `pane run` with a pipe breaks an
    interactive program, because a piped command has no controlling terminal. A human
    watches a shared pane, and a watched console caught a factory reset that a blind
    driver reported as successful. Use `herdr pane wait-output`, which searches real
    output instead of racing an echo. (`w8`, `wB`.)

90. Console traps produce a false negative and a real session at once. The line editor
    probes and waits, so a client that ignores the probe concludes that login failed
    while the device logs an administrative session. The console wraps at terminal
    width and splits a completion marker. A wait on the prompt matches the echo of your
    own command line. (`wC`, measured by the herd that owns the device.)

91. Crash records land first in a volatile ring and reach the persistent store only
    sometimes. Bursts larger than about two payloads lose records, and the output
    cannot distinguish that loss from a payload that does not crash. The cost of one
    campaign moved from about 8 s to about 27 s per payload after the capture
    discipline was corrected. (`wC`.)

92. A single silent result proves nothing, so the instrument enforces repetition
    instead of leaving it to memory. Four identical payloads produced four confirmed
    deaths and three records, and the missing record had a benign cause. (`w8`.)

93. Know which of two views of the same data is current, and read that one. An agent
    read only the section of an archive that lags, and would have reported four false
    negatives. (`w8`.)

94. Never reuse a timestamp. Generate it. Four raw filenames carry timestamps 31
    minutes early, because an agent hardcoded a stamp. A reused timestamp is a derived
    quantity. (`w8`.)

95. Read the inventory before a run as well as after, and fetch every archive in the
    run that produced it. A device rebooted overnight and the live log of three
    experiments was lost. (`w8`.)

96. A factory reset loses the clock, and a stale clock produces a failure message
    unlike the ones that an experimenter expects, because validity is checked before
    the anchor and the signature. Pass device-state traps like this to any herd that
    borrows the device. A trap that makes their results wrong matters more than one that
    makes their run fail. (`wA`, relaying the herd that owns the device.)

## 9. The shape of the family

97. A rich catalogue of failure families makes diagnosis worse as well as better. Two
    experienced readers filed a plain formula error under two sophisticated families
    that had each burned them, on the same day, and both were wrong. Include "somebody
    simply got it wrong" as a first-class candidate and test it first, because it is
    the cheapest. One command settled it, and neither party ran it. (`w8`, `wC`, `wB`.)

98. The measurement can be sound and the role assigned to it wrong. Ask three questions
    separately: is the measurement right, does it bear the weight, and what else would
    produce this same measurement. If something else would, the claim is consistent
    with the conclusion and does not establish it. Four instances in one day, one of
    which cost four crash records permanently. (`wC`.)

99. Inherited assumptions are the recurring failure, not bad measurement. Version
    ordering, a type a package's name implies, and a consumer list taken from a
    prior report were each correct as measurements and wrong as models. (`wA`.)

100. The picture that an orchestrator holds of any artefact is at least one message old.
     The risk is not that it is wrong. The risk is that it is precise. A claim about the
     state of an artefact carries the reading that supports it, with a timestamp.
     (`w8`.)

101. A defect in a worked example is worse than a defect in a rule. A reader reads and
     weighs a rule. A reader pastes an example, and it spreads by imitation. Audit
     examples before rules. (`w8`.)

102. When you rewrite a rule, its internal guards go with it only if you carry them
     across on purpose. A guard lost in a rewrite made a scanner overstate its hits
     tenfold. (`w8`.)

103. When a safety check fires on an edit that you know about, enumerate what it caught.
     Do not override it. That is the failure mode of every safety check ever written,
     and the next firing is the real one. (`w8`.)

104. A rule that you teach is not a rule that you are immune to. The owner of a document
     enforced the gate rule on two other herds on the day when it broke its own gate,
     and the edit that broke it was an integrity improvement. (`w8`.)

105. An 800-line synthesis never used the vocabulary of its own domain, and an outside
     party corrected it in one sentence. Ask what shape you assume the subject has, and
     who would know if it were wrong. A document that never uses a word from its own
     domain is evidence that the domain is bigger than the document. (`w8`.)

106. A measured instrument defect that has not reached the shared instruments file has
     not reached anybody. One sat in the note of a worker for a day. The worker was
     right to flag it instead of editing shared material, so the overseer owns the
     propagation. (`wB`, `w8`.)

107. The overseer contaminates the documents that prevent contamination. Three of the
     four high-severity findings in the first audit of one reviewer were the work of the
     overseer, inside the bias-control files. (`wB`.)

108. Rules go stale against practice in silence. A remit said that the overseer
     publishes the report. The reporting agent had published it for days, and nobody
     noticed until it mattered. (`wB`.)

109. A central ledger that agents do not write to is not a ledger. A root question ledger
     held one row that read "none yet" while one worker alone raised thirteen questions
     in its own file. (`wB`.)

110. A false statement against your own interest is still a false statement, and no
     reader can check it, because nobody audits a claim that costs the author something.
     A herd published a page with a wrong gate statement, and then made a false statement
     against its own interest inside the section whose purpose was to show that it hides
     nothing. A reviewer reads a self-criticism with approval and moves on, because a
     price paid reads as sincerity. Sincerity is not accuracy. The section of a report
     most likely to hold an unchecked error is the section that admits error. (`wC`,
     after the extractions closed.)

111. Record the direction that an error leaned. An error that flattered its author is a
     different animal from one that did not, and only the first kind tends to survive
     review. (`wC` published the direction of its own error without being asked. The
     false divergence claim of `wA` leaned the same way.)
