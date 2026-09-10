# `common/config`: the template

Copy this file into `<herd>/common/config` at creation and fill it in. It holds every
rule that binds all agents, so the operator changes one line here instead of editing
prompts. The operator owns the file. An overseer edits it only after a clear operator
request, and records that request in `overseer/DIRECTIVES.md`.

Put three settings to the operator at creation: `double_check`, `cross_herd_sharing`
and `tool_install`. Each one states its suggested answer and its cost, so that the
operator chooses rather than guesses. Every other setting has a working default.

```yaml
# ---- identity -------------------------------------------------------------
herd_name:            "<short human name>"
created:              "<date>"
operator_present:     true        # false means that nobody answers a question this hour

# ---- evidence -------------------------------------------------------------
claim_labels:         measured_or_argued
  # measured: a reader can redo it from the shipped files with the path and
  #   method given.
  # Option: evidence_classes, the S0 to S4 scheme of wB, with a citation
  #   standard per class.
  # Cost of the option: a class table in every remit. It earns that cost where
  #   recall can look like evidence.
prediction_required:  true        # one line per run. A refuted prediction is a result
denominator_required: true        # three numbers on every absence claim
control_required:     true        # a non-zero control from the same run, beside every zero
confession_reviewed:  true        # self-critical text carries the same labels and the
                                  # same review as any other claim. Do not turn this off
correction_direction: true        # every correction records whether the error
                                  # flattered the author

# ---- double checking (ASK THE OPERATOR AT CREATION) -----------------------
double_check:         key_numbers_and_key_absences
  # none: nothing is re-measured. Cheapest. No defence against a formula that
  #   is wrong the same way every time.
  # key_numbers_and_key_absences (SUGGESTED ANSWER): before anything leaves the herd, a
  #   second worker re-measures the important numbers and the important absence
  #   claims, and nobody tells it what to expect. Cost: one worker.
  #   The overseer marks which claims are load-bearing. If it marks none, every
  #   number in the summary of the deliverable counts.
  # everything: every published quantity re-derived blind. Cost: about one
  #   worker-day per programme.
  # A change during a programme can need passes to reconfigure what the
  #   overseer and the workers already hold.

full_independent_rediscovery: off
  # off (SUGGESTED ANSWER): one worker answers each question. A checker
  #   re-measures its numbers under double_check above.
  # on: two or more workers derive the same answer from the sources alone,
  #   neither knows that the other exists, and the overseer matches them.
  #   It buys independent convergence, which nobody can manufacture afterwards.
  #   Cost, measured by wB: two workers do deliberately overlapping work and
  #   the overseer drops one at triage. The reference tree of wB held 84,569 of
  #   its 88,635 files. One careless briefing destroys the independence for
  #   good. wB ran it, got two workers that reached the same boundary without
  #   contact, and still says that a smaller herd must take the isolation rules
  #   and the review gate and skip this.
  #   Turn it on only where the question is "which of several candidate sources
  #   is this". See independence.md.
  # When it is on, set independence_no_read_list as well.

# ---- review ---------------------------------------------------------------
reviewer_standing:        true    # the reviewer reads the deliverable and the operator
                                  # artifact on its own initiative.
                                  # Cost: one agent that produces no findings
reviewer_audits_overseer: false   # wB got nine findings from this before any data
                                  # existed. Cost: reviewer context and overseer time
freeze_on_review:         true    # a FROZEN marker and a commit. The verdict names the
                                  # commit. Cost: one file and one commit per review
whole_artifact_review:    true    # one complete review, delivered whole. The wording of
                                  # the reviewer is a suggestion and does not bind

# ---- workers --------------------------------------------------------------
worker_to_worker_data:    true    # data yes, orders never. Turn it off for independent
                                  # workers, because a data channel is also a hint channel
independence_no_read_list: []     # paths that a worker must not read.
                                  # Cooperative and imperfect. See independence.md
leads_capture:            true    # observations recorded, never chased

# ---- context --------------------------------------------------------------
compaction:
  threshold:          none        # no number, by decision. Context size is a cost,
                                  # never an emergency
  handover_before:    true        # write the handover BEFORE the compaction, never after
  verify:             required    # read the compaction record in the session log
  guard_self_compacts: true       # the artifacts guard compacts often, by design

# ---- cross-herd (ASK THE OPERATOR AT CREATION) ----------------------------
cross_herd_sharing:   off         # SUGGESTED ANSWER: no.
  # Cost of off: a worker that needs material from another herd waits for the
  #   operator to release it.
  # When it is on, every release needs three things: gate state on every claim,
  #   the content whitelist below, and a contamination entry written by the
  #   RECEIVER.
  # Nothing that leaves this machine is on this setting. That is disclosure,
  #   and the operator alone decides it.
content_whitelist:
  - findings
  - short reasoning
  - repository-relative file pointers
content_forbidden:
  - hashes, exact locations, verbatim raw extracts
  - decision history, superseded claims
  - anything about panes, orchestration, instruments or other programmes

# ---- permissions and reach ------------------------------------------------
web_research:         off         # on with a named source list, never as blanket permission
network_fetch:        off         # on with an explicit list and the one allowed shape
tool_install:         ask         # SUGGESTED ANSWER: ask. The agent names the tool,
                                  # what it does, what it will use it for, and what is
                                  # already available. Then it waits.
                                  # Cost: one overseer turn per request. Off entirely, a
                                  # worker stops at the first missing tool. On without
                                  # asking, an agent installs from anywhere
unrestricted_permissions: off     # on only when the operator asks clearly. Passed after
                                  # -- at start
git_remote:           none        # a remote only on operator request, and always PRIVATE.
                                  # A repository becomes public only through a manual
                                  # operator action. No agent can ever do it
device_access:        none        # [HW] allocation lives in the ledger of the
                                  # between-herds agent, not here

# ---- models ---------------------------------------------------------------
models:
  overseer:           <capable>
  worker:             <capable>
  reviewer:           <capable>
  checker:            <capable>
  artifacts_guard:    <cheaper>   # rule-following, not judgement
  between_herds:      <capable>
```

## Change a setting after the herd runs

1. The operator states the change. The overseer records it word for word in
   `overseer/DIRECTIVES.md`, which is append-only, because anything not on disk does
   not survive a compaction. `wB` lost directives this way and wrote the ledger
   afterwards.
2. The overseer edits `common/config` and commits.
3. The overseer names the agents that now hold stale rules, and briefs them again. A
   setting changed in a file does not change what an agent already believes.
