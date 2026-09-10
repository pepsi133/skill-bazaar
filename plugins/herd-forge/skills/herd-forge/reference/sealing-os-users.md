# Sealing by operating-system user

**Do not read this file unless the operator has pointed you at it.** It is outside the
default read path by operator ruling: sealing by operating-system user is kept out of
the skill's standard context.

**The ordinary mechanism is a list of paths a worker must not read** — cooperative,
imperfect, and good enough for the cases that actually occur. It is in
`independence.md`, and it is what you should be using. This file describes the real
seal, for the very unlikely case where cooperation is not enough.

## When it is warranted

Only when **all** of these hold:

1. A result's entire value is that one agent could not have seen something.
2. That result will be published or relied on outside the herd.
3. The cost of a silent breach is higher than the cost of the machinery below — and
   the machinery is substantial and permanent for the life of the herd.

If you are unsure, you do not need it. `wB` ran a full independent-rediscovery
programme without it and its own verdict was that a smaller herd should skip even the
cheaper parts.

## The mechanism

Run the sealed agent as a **separate operating-system user** that has no read access to
the sealed directory. The seal is then enforced by file permissions rather than by the
agent's cooperation, and a breach is an error rather than a silent success.

Sketch, to be adapted with the operator, who must run every step that needs root:

1. The operator creates a user for the sealed agent, and a group owning the sealed
   material.
2. The sealed directory is owned by that group, mode `0750` or tighter, and the sealed
   agent's user is **not** in the group. Its parent directories must not be traversable
   in a way that defeats this.
3. The sealed agent's own working directory is owned by its own user and is writable
   only by it.
4. Herdr starts the agent's pane as that user. Everything after `--` and every `--env`
   passed at pane level applies as normal; nothing about the herd protocol changes.
5. The overseer, which can read both sides, does the matching. It never copies sealed
   content into the sealed agent's directory, and that instruction is written into its
   own brief.

## What it costs, stated so the decision is honest

- **A second account and a permissions layout the operator maintains.** Every step that
  needs root is the operator's, and no agent may attempt it.
- **Shared files stop working.** `common/`, the artifacts directory and the herd's git
  repositories are readable by one side and not the other unless each is given explicit
  group access, and every one of those grants is a hole in the seal that somebody must
  reason about.
- **Git gets awkward.** Two users committing into one repository produce ownership and
  `safe.directory` problems, so the sealed agent normally needs its own repository, and
  its history then lives apart from the herd's.
- **Recovery is harder.** A sealed agent that dies cannot be resumed by the ordinary
  path unless the operator resumes it as the right user.
- **It seals reading, not inference.** An agent that is told what to look for is
  steered whatever it can read. The remit, the example lists and the vocabulary you
  hand it still leak (`wB` measured all three), and this machinery does nothing about
  any of them.

## The honest summary

The seal removes one failure mode — a worker reading what it should not — and leaves
every other route by which independence is lost. It is not measured here: no herd in
this merge ran it. What was measured is the cheaper mechanism failing gracefully and
the expensive one never being needed.
