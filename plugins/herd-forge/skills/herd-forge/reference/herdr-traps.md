# Herdr traps, measured

Every entry produced a confident wrong reading rather than an error. The entries were
measured on Herdr builds up to 0.9.1.

This file carries only what the help text does not say, and only what `SKILL.md` and
`reference/running-a-herd.md` do not already state.

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

4. `agent prompt --wait` returns one of two errors, and they mean opposite things. Both exit
   with status 1.
   - `agent_prompt_stalled`: the prompt went to a pane that was not working, and the pane
     did not reach `working` or `blocked` within about five seconds. Read the pane before
     you send anything again.
   - `timeout`: the caller timeout expired first. A multi-step task does not settle for
     many minutes. The prompt landed. Do not send it again. Run `herdr agent get`.

5. `unknown` means Herdr sees an agent and cannot classify it. That is neither completion
   nor failure. `herdr agent explain <target>` is the right next command.

6. A prompt sent to an agent already `working` lands, and Herdr processes it inside or
   after the current turn. Ordering is not guaranteed. Send anything order-dependent as
   one message.

7. `herdr agent prompt` takes a pane id as well as a name, so a pane with no agent name is
   still reachable through the agent surface.

8. Bare `herdr` starts the TUI. Never run it for discovery. A command group with no
   subcommand prints help and exits 2, which is normal.

9. `herdr server` is the exception to entry 8. With no subcommand it prints no help. It
   starts the default server, and that server survives the shell that started it. Read
   group help on stderr: `herdr pane 2>&1`, `herdr tab 2>&1`, `herdr agent 2>&1`,
   `herdr session 2>&1`. Run experiments in a named test session, never in the default
   one.

10. `herdr status` shows the client version and the server version. After an update the two
    can differ. Read both before you blame a flag on the documentation.

11. Filter `herdr agent list` by workspace or name before you read it. It returns every
    workspace, interleaved.

12. Use `tab create`, not repeated `pane split`. Repeated splits in one direction give
    unusably narrow columns by about the fourth pane. The new pane id is at
    `.result.root_pane.pane_id`.

13. An agent started by hand carries no Herdr name. `herdr agent rename <pane-id> <name>`
    fixes it.

14. `terminal_title` is a separate field the agent process sets for itself. It reports
    activity, not identity. Never use it as a name.

15. A pane moved inside its workspace keeps its pane id. A pane moved to another workspace
    receives a new one. Read the id from the response.

16. Agent-to-overseer messaging is not uniform. Some panes send cross-session messages
    directly. Others report that they have none and write to `STATUS.md` instead. Never
    design a workflow that depends on an agent reaching you.

17. Cross-session messages arrive as user turns in the receiving agent and interrupt it, so
    an overseer does not control its own turn boundaries.

18. A fork of the overseer is indistinguishable from the overseer. A fork sent four prompts
    to a driver pane and the pane obeyed them, because every message arrives through one
    channel with no source label. So every agent says who it is when it messages another.
    An agent that gets an odd instruction asks its overseer before it acts.

19. `herdr agent prompt` has no `--message` flag. With it, nothing is sent and the pane tail
    shows your own words, which reads exactly like delivery. An inline body that contains a
    double quote is split by the shell. Herdr receives the first fragment only and still
    returns `agent_prompted`. Send every body from a file with `"$(cat file)"`, and print the
    byte count at the sending end. A body file that was never written fails with
    `empty_agent_prompt`, which you see only if you read the returned field.

20. **A model safeguard can stop a pane mid-run, and the pane then reports `done` with
    nothing written.** A brief whose wording named a specialist field was refused by the
    model's own safeguards, after the agent did most of the reading. The wake fired, the
    status read `done`, and the output file did not exist. The work was lost because it
    lived only in the pane.

    Two rules follow. Write briefs in the vocabulary of the work itself rather than of a
    specialist field, because the field word is what the classifier reads and the work is
    usually describable without it. And tell every agent to write partial output to its
    file before it stops, so a refusal costs one section rather than a whole run.

## Compaction, the fallback, in a Claude pane

Compaction is the fallback to a turnover, at most twice per pane.
`reference/running-a-herd.md` says when. These entries say how it fails.

21. A slash command sent with `herdr agent prompt` arrives as a bracketed paste. The client
    collapses a long paste into `[Pasted text #N]` and never reads a paste block as a
    command. A 3548-byte `/compact` sent that way was answered in prose, and nothing
    compacted. Nine panes did the same in another herd while their context rose.

22. The delivery that works:
    1. Read the pane. The input box is empty, and no compaction is running.
    2. Clear the box. `send-keys ctrl+u` clears typed text but not a paste block. One
       `send-keys backspace` removes a paste block whole, because the block is one token.
    3. `send-text "/compact"`, then `send-text " <short text>"`. The leading space is
       load-bearing, because Enter with the autocomplete menu open selects the highlighted
       entry.
    4. Read the box back with `--source recent-unwrapped`. It shows the literal text, not
       `[Pasted text #N]`. `--source visible` truncates a long input line, so a typed
       command looks absent.
    5. `send-keys enter`.

    The working ceiling is about 200 characters. 155 stayed inline and 3548 collapsed. A
    long retention prompt goes first, as an ordinary prompt. The short `/compact` then
    refers to it.

23. A `/compact` queued behind other work never fires. One pane at ctx 82% held it in the
    queue until ctx 85%. Before you type it, read the status line for
    `Press up to edit queued messages`. Forging a replacement does not queue, which is one
    more reason a turnover wins.

24. Verify a compaction in the session transcript, with this exact pattern:

        grep -c '"isCompactSummary"[[:space:]]*:[[:space:]]*true' <transcript>

    The bare string `isCompactSummary` appears in any transcript that discusses compaction.
    One session held 11 bare hits, 0 exact hits, and had never compacted. A finished
    compaction adds one exact hit and one `compact_boundary` whose `preTokens` exceeds its
    `postTokens`. Find the transcript with `find ~/.claude/projects -name '<session-id>.jsonl'`,
    because a subdirectory `--cwd` changes the project slug. A compaction can take about four
    minutes, and one took 235 seconds. Under ten seconds is not a finished compaction. The
    pane's return to `done` and its reply prove nothing. An agent that answers a command in
    prose did not run it.

25. The last usage record reports the context size of the last request, so it still shows
    the figure from before the compaction. An unchanged figure is not evidence of failure.

26. For an exact figure, measure pane context from the transcript, not from the client
    footer. The per-agent figure is the sum of the input and cache token fields of the last
    usage record in the session file.

27. After a compaction, a queued prompt can sit unsubmitted. It needs an explicit key send.

28. Compact an agent only at a turn boundary, after it wrote its handover. An agent compacted
    during a trace loses the working set it assembled, and cannot tell that it did. The lost
    context is what it needs to notice the loss. Anything not on disk does not survive a
    compaction. Seven load-bearing measurements in one herd existed only in a session
    transcript.

29. Closing a pane does not destroy its session. A closed pane resumes with
    `claude --resume <id>` in its own directory, takes a new pane id, and comes back
    compacted. Its first instruction must tell it to re-read its rules, its brief and its
    status file. Record the session id, the session path and the model in
    `common/IDENTITY.md` before you close. Every agent has its own tab, so the close is
    `herdr tab close <tab_id>`, and `herdr pane close <pane_id>` closes a single pane. When
    you start a resumed session by hand, declare it with `herdr pane report-agent`, which
    takes `--agent-session-id` and `--agent-session-path`.

## Account and scheduling

30. The token limit is account-wide and stops every agent at once. Six panes hit the weekly
    limit within about six minutes. Plan for total stoppage, not for one worker stalling.

31. A rate-limited agent never resumes by itself. The window resets and the pane still sits
    idle. Somebody prompts every stalled agent, one at a time. Budget that as manual work.

32. A pane can carry its own usage pause, shown as `PAUSED(manual)` on its status line. In
    one herd 14 of 14 panes carried it at once. No pane completes a turn, and a prompt
    queues while it looks delivered. Read the status line before any wake-up. A compaction
    verified in a paused pane is complete-but-unwoken, not complete. During a pause every
    measurement is a read, never an exchange, and silence is not a decision.

33. A background fork inside a pane fails hard on the rate limit, as an HTTP 429 agent
    failure rather than a retryable condition.

34. A session-scoped scheduler fires only while the session lives. It covers a quota pause,
    where the process waits. It does not cover process death. Build no `setsid` or `nohup`
    timers: they appear in no list the operator checks, and the UI cannot cancel them.

35. A scheduled wake can fire into the session that scheduled it, with full context. A wake
    prompt written in "you have no memory" style is then wrong about its own premise. Tell
    the reader to establish current state from documents.

36. Scratchpad logs are session-scoped and do not survive the session. Say so in any file
    that points at them.

## Subagents inside a Claude pane

37. Agent-tool subagents are blocked from writing report files, inconsistently. One wrote
    52 KB without complaint. Another was refused with "Subagents should return findings as
    text". Use panes for anything durable. Have subagents return text and write it
    yourself.

38. Delegated sub-tasks exceed their scope and race on one file. Two of four sub-tasks
    redid parts of the job in parallel. If you find a concurrent write, read the live state
    and merge. Never overwrite and never discard.

39. Where two agents share a directory, give each its own filenames. Two panes wrote
    `CLOSEOUT.md` in one directory. One read back its own 60 lines, and the commit carried
    the 67 lines of the other.
