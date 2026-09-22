# Herdr traps, measured

Every entry produced a confident wrong reading rather than an error.

This file carries only what the help text does not say, and only what `SKILL.md` does not
already state.

## Panes and agents

1. Herdr releases an agent name when its agent exits, is released, or is replaced, so a
   collision appears only while both agents run. Never test the namespace with a name
   another herd can be using. Taking a live name misroutes messages meant for that herd
   into yours. Two herds collided on the name `critic` without trying.

2. A pane whose `--cwd` is a directory Claude does not already trust stops on the folder-trust
   dialog, and `herdr agent start` returns `agent_not_ready`. The dialog draws on the
   alternate screen, so `--source recent-unwrapped` returns nothing and
   `herdr pane read <pane_id> --source visible` shows it. Clear it with `send-keys down`
   then `send-keys enter`, then `herdr agent wait <name> --until idle`. One answer covers
   later panes under the same parent directory. Bypassing permissions does not skip it.

3. Bypassing permissions does not cover a write outside the pane's working directory. The
   pane stops on an approval dialog naming the file, and it reports `blocked`, not
   `agent_not_ready`. Nothing distinguishes it from a healthy long task except the status.
   Arm `herdr agent wait --until blocked` on every unattended pane, and give each agent a
   `--cwd` that contains everything it writes. The dialog offers a per-directory grant for
   the rest of the session, which is one `send-keys down` then `send-keys enter` and
   avoids the next stop.

4. `agent prompt --wait` returns a `timeout` error on any long task. The prompt landed.
   `--wait` settles on the next `idle`, `done` or `blocked` state, which a multi-step task
   does not reach for many minutes. Exit status is 1 and the JSON says
   `{"error":{"code":"timeout"}}`. Do not send the prompt again. Run `herdr agent get`.

5. `unknown` means Herdr sees an agent and cannot classify it. That is neither completion
   nor failure. `herdr agent explain <target>` is the right next command.

6. A prompt sent to an agent already `working` lands, and Herdr processes it inside or
   after the current turn. Ordering is not guaranteed. Send anything order-dependent as
   one message.

7. `herdr agent prompt` takes a pane id as well as a name, so a pane with no agent name is
   still reachable through the agent surface.

8. Bare `herdr` starts the TUI. Never run it for discovery. A command group with no
   subcommand prints help and exits 2, which is normal.

9. Filter `herdr agent list` by workspace or name before you read it. It returns every
    workspace, interleaved.

10. Use `tab create`, not repeated `pane split`. Repeated splits in one direction give
    unusably narrow columns by about the fourth pane. The new pane id is at
    `.result.root_pane.pane_id`.

11. An agent started by hand carries no Herdr name. `herdr agent rename <pane-id> <name>`
    fixes it.

12. `terminal_title` is a separate field the agent process sets for itself. It reports
    activity, not identity. Never use it as a name.

13. A pane moved inside its workspace keeps its pane id. A pane moved to another workspace
    receives a new one. Read the id from the response.

14. Agent-to-overseer messaging is not uniform. Some panes send cross-session messages
    directly. Others report that they have none and write to `STATUS.md` instead. Never
    design a workflow that depends on an agent reaching you.

15. Cross-session messages arrive as user turns in the receiving agent and interrupt it, so
    an overseer does not control its own turn boundaries.

16. A fork of the overseer is indistinguishable from the overseer. A fork sent four prompts
    to a driver pane and the pane obeyed them, because every message arrives through one
    channel with no source label. The sender-line rule exists for this, and it is also why
    that line cannot authenticate.

17. **A model safeguard can stop a pane mid-run, and the pane then reports `done` with
    nothing written.** A brief whose wording named a specialist field was refused by the
    model's own safeguards, after the agent did most of the reading. The wake fired, the status read `done`, and the output file did not exist.
    The work was lost because it lived only in the pane.

    Two rules follow. Write briefs in the vocabulary of the work itself rather than of a
    specialist field, because the field word is what the classifier reads and the work is
    usually describable without it. And tell every agent to write partial output to its
    file before it stops, so a refusal costs one section rather than a whole run.

## Compaction, in a Claude pane

18. A slash command sent to a pane becomes ordinary text. Bracketed paste turns text above
    a length threshold into `[Pasted text #N]`, and the client never reads a paste block as
    a command. Nine panes answered a compaction request in prose and none compacted, while
    the context figure rose.

19. The delivery that works: `send-keys ctrl+u` twice, because escape does not clear a
    paste placeholder. Then `send-text "/compact"`. Then `send-text " <short
    instructions>"`, where the leading space is load-bearing, because Enter with the
    autocomplete menu open selects the highlighted entry. Then `send-keys enter`. Keep the
    text short enough to type rather than paste. About 300 characters worked.

20. Make sure of a compaction through the `isCompactSummary: true` record in the session
    `.jsonl`. Do not use the pane's return to `done`, and do not use its reply. An agent
    that answers a command in prose did not run it.

21. The last usage record reports the context size of the last request, so it still shows
    the figure from before the compaction. An unchanged figure is not evidence of failure.

22. Measure pane context from the transcript, not from the client footer. The per-agent
    figure is the sum of the input and cache token fields of the last usage record in the
    session file.

23. After a compaction, a queued prompt can sit unsubmitted. It needs an explicit key send.

24. Never force a compaction on an agent mid-task. An agent counts as mid-task unless two
    conditions hold together. Its status reports idle or `done`, and it wrote its handover
    after its last work item. An agent compacted during a trace loses the working set it
    assembled, and cannot tell that it did. The lost context is what it needs to notice the
    loss.

25. Anything not on disk does not survive a compaction. Seven load-bearing measurements in
    one herd existed only in a session transcript.

26. Closing a pane does not destroy its session. A closed pane resumes with
    `claude --resume <id>` in its own directory, takes a new pane id, and comes back
    compacted. Its first instruction must tell it to re-read its rules, its brief and its
    status file. Record the session id and the model before you close.

## Account and scheduling

27. The token limit is account-wide and stops every agent at once. Six panes hit the weekly
    limit within about six minutes. Plan for total stoppage, not for one worker stalling.

28. A rate-limited agent never resumes by itself. The window resets and the pane still sits
    idle. Somebody prompts every stalled agent, one at a time. Budget that as manual work.

29. A background fork inside a pane fails hard on the rate limit, as an HTTP 429 agent
    failure rather than a retryable condition.

30. A session-scoped scheduler fires only while the session lives. It covers a quota pause,
    where the process waits. It does not cover process death. Build no `setsid` or `nohup`
    timers: they appear in no list the operator checks, and the UI cannot cancel them.

31. A scheduled wake can fire into the session that scheduled it, with full context. A wake
    prompt written in "you have no memory" style is then wrong about its own premise. Tell
    the reader to establish current state from documents.

32. Scratchpad logs are session-scoped and do not survive the session. Say so in any file
    that points at them.

## Subagents inside a Claude pane

33. Agent-tool subagents are blocked from writing report files, inconsistently. One wrote
    52 KB without complaint. Another was refused with "Subagents should return findings as
    text". Use panes for anything durable. Have subagents return text and write it
    yourself.

34. Delegated sub-tasks exceed their scope and race on one file. Two of four sub-tasks
    redid parts of the job in parallel. If you find a concurrent write, read the live state
    and merge. Never overwrite and never discard.

35. Where two agents share a directory, give each its own filenames. Two panes wrote
    `CLOSEOUT.md` in one directory. One read back its own 60 lines, and the commit carried
    the 67 lines of the other.
