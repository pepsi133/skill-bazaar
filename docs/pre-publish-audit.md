# Pre-publish audit — content gate and functional gate

Run this before a push that makes new content public. Two independent runs of the
**content gate** (two fresh agents, or one agent and one separate Claude instance), with the
findings diffed. Then the **functional gate** in a fresh Claude Code session with the plugins
installed from this marketplace. Both must pass before the push.

## How to run it

**The rule for every agent working in this repository: prepare, never publish.** An agent
runs the gate and writes the report. It does not run `git commit` or `git push` for the
publication step. It ends by printing the two snippets in "Hand-off" below, for a person to
read, decide on, and paste. `--no-verify` is never in a snippet an agent prints.

### Step 0 — know what the push would publish

```bash
git fetch origin
git log --oneline origin/main..HEAD          # every commit this push makes public
git diff --stat origin/main..HEAD            # every file
```

If that list is not what you expect, stop here. The rest of the gate audits this set.

### Step 1 — content gate, run twice, independently

The point of two runs is disagreement. One agent that misses a finding is a passed gate; two
that miss the same finding is unlikely. Do not let the second run see the first one's output.

1. Open a **fresh** agent or a separate Claude instance, with no history of this work.
2. Paste the prompt under "Content gate" verbatim, with `<PATH>` replaced by the repository
   root.
3. Save the table it returns to `/tmp/audit-content-1.md`.
4. Repeat in a **second** fresh agent. Save to `/tmp/audit-content-2.md`.
5. Diff them: `diff /tmp/audit-content-1.md /tmp/audit-content-2.md`.

Any line that appears in one report and not the other is unresolved, not a false alarm.
Investigate it by hand until you can say why it is `OK-example` or fix it. A single `BLOCK`
in either report stops the push.

The prompt tells the agent to scan the tracked tree at HEAD, which is wider than the commits
you are about to push. That is deliberate: a file that became public in an earlier push is
still public now.

### Step 2 — functional gate

Start a **new** Claude Code session, so `SessionStart` hooks and the status line load fresh.
Work the numbered table below in order and record PASS or FAIL with the output you actually
saw, not what you expected. A FAIL on rows 2, 7, 9, 12, or 15 blocks the push.

Rows 12b, 12c, 18, 19, and 20 are plain commands and can be run in any shell:

```bash
python3 scripts/validate-skills.py
cd plugins/bobby-statusline && python3 -m unittest discover -s tests -p 'test_*.py'
python3 bin/bobby-statusline.py --selftest
cd ../limit-guard/tests && python3 -m unittest discover -s . -p 'test_*.py'
```

### Step 3 — write the report

Save both content-gate tables, their diff, and the functional table with PASS or FAIL per row
to `roadmap/private/` with the date in the filename. That directory is excluded from git, so
the report stays local. Record the exact commit range audited, because the report is only
valid for that range: one more commit means one more thing nobody read.

### Step 4 — enable the push reminder, once

`.githooks/pre-push` prints what a push would publish and asks for a typed answer. It is
optional and off until you link it, because a hook in a contributor's clone guards nothing.
It is not on `main` yet; it lives on `feat/pre-push-audit-reminder`. Once that lands, enable
it as `.githooks/README.md` and `AGENTS.md` describe:

```bash
ln -s ../../.githooks/pre-push .git/hooks/pre-push
```

The hook scans nothing, replaces no part of this audit, and `git push --no-verify` skips it.
It exists to make the audit a deliberate act rather than an assumption. GitHub push
protection is the enforcement layer, not this.

## Hand-off — what an agent prints instead of pushing

When the gate passes, the agent stops and prints these two snippets, unmodified, and says
which commit range the report covers. The person reads the report, decides, and pastes.

**Snippet 1 — commit the audit fixes, if the gate produced any:**

```bash
git add -A <paths the gate changed>
git commit -m "fix(<area>): <what the audit found>"
```

**Snippet 2 — publish, after you have read the report:**

```bash
git log --oneline origin/main..HEAD     # read this list one more time
git push origin main
```

If the pre-push hook is enabled it will ask; type `audited`. In a non-interactive shell it
refuses and tells you to use `SKILL_BAZAAR_AUDIT_PASSED=1`. Setting that variable is a claim
that you ran this gate. Do not set it to make a hook be quiet.

**If the gate did not pass**, the agent prints no push snippet at all. It prints the findings
and stops.

## Content gate — paste verbatim, replace `<PATH>`

> You are auditing a git repository tree before it is published to a public GitHub remote.
> Repo root: `<PATH>`. Read-only: do not edit, commit, or push. Scope is the tracked tree at
> HEAD only (`git ls-files`); history is out of scope for this gate.
>
> Deterministic pass first, record every hit with `path:line`:
> 1. `git ls-files | xargs grep -nE '/home/[a-z]+|/Users/[A-Za-z]+|C:\\Users|wsl\.localhost'` — absolute local paths.
> 2. `git ls-files | xargs grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}'` — emails; the maintainer's own addresses (the git author identity) are intentionally public and are NOT findings; anything else is.
> 3. `git ls-files | xargs grep -nE 'claude\.ai/code/session_|Claude-Session:'` — session URLs.
> 4. `git ls-files | xargs grep -nEi '(api[_-]?key|secret|token|password|passwd|bearer|private[_-]?key|BEGIN (RSA|OPENSSH|EC) PRIVATE)'` — credential-shaped strings; classify each as example/placeholder vs real.
> 5. `git ls-files | xargs grep -nE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b|[0-9a-f]{2}(:[0-9a-f]{2}){5}|[A-Za-z0-9]{8,}-[A-Za-z0-9]{4,}-serial'` — IPs, MACs, serials (RFC1918 examples in docs are fine if clearly examples).
> 6. `git ls-files | grep -Ei '\.(env|pem|key|p12|pfx|log|sqlite|db|jsonl)$|\.idea/|\.vscode/|node_modules/|__pycache__/'` — files that should not be tracked.
> 7. `git ls-files | xargs grep -nE 'https?://[^ )>"]+' | grep -vE 'github\.com|code\.claude\.com|anthropic\.com|agentskills\.io|json\.schemastore\.org|opensource\.org|apache\.org|fonts\.g' ` — every other URL: is it a docs link, or an endpoint code would call?
> 8. `grep -rnE 'fetch\(|https?\.request|urllib|requests\.|curl |wget |socket\(' --include='*.js' --include='*.py' --include='*.sh' .` — network clients in code. The repo rule: none, except Anthropic through the user's own session/CLI, or endpoints the user configures.
> 9. If `gitleaks` or `trufflehog` is installed, run it in filesystem mode and append its report; if not, say so.
>
> Reading pass second: open every file under `docs/`, `roadmap/`, `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, every `README.md` and `UPSTREAM.md` under `plugins/` and `skills/`, and every hook/script. Look for: internal hostnames, project or client names that are not this repo, device identifiers, people other than the maintainer, private infrastructure descriptions (routers, VLANs, subnets) that go beyond a generic example, anything that reads as pasted from a private chat or ticket, TODOs that mention private context, and license text for vendored code (each vendored subset must carry its upstream LICENSE and a pin).
>
> Output, nothing else: a table `path:line | class (path/email/session/credential/identifier/url/egress/untracked-type/prose) | severity (BLOCK/FIX/OK-example) | one-line why`, then a final line `VERDICT: PUBLISHABLE` or `VERDICT: NOT PUBLISHABLE — <n> BLOCK`. No praise, no summary of what the repo is.


## Functional gate — fresh session, plugins installed from this marketplace

Run in a NEW Claude Code session (hooks and statusline load at session start). Expected
results are what to check, not what to type verbatim.

| # | Plugin | Do | Expect |
|---|---|---|---|
| 1 | all | `claude plugin list` | 6 `@skill-bazaar` entries enabled; no `caveman@caveman` |
| 2 | ste | start a session, ask "which writing rules are active?" | STE prompt injected (SessionStart); caveman NOT active |
| 3 | ste | `/ste status` | reports ste on, caveman off, last mode |
| 4 | ste | `/ste off`, then ask for a paragraph | no STE discipline; `~/.config/ste/state.json` has `"ste": false` |
| 5 | ste | `/ste on` | STE re-injected this turn |
| 6 | caveman | `/caveman` (bare) | one-line hint "default is off; run /caveman <mode>" |
| 7 | caveman | `/caveman full`, ask a question | compressed answer; `~/.config/caveman/config.json` → `"defaultMode": "full"` |
| 8 | both | with caveman on, ask for a destructive-command confirmation | full STE sentences, not caveman fragments (precedence rule) |
| 9 | caveman | `stop caveman` | plain style; config.json → `"off"`; next session starts without caveman |
| 10 | caveman | write "how do I `stop caveman` in docs?" | mode unchanged, config.json unchanged |
| 11 | caveman | `/caveman-help` | loads only on explicit call (user-only skill) |
| 12 | limit-guard | look at the statusline | with limit-guard's own wrapper: `[5h NN%↻…]` badge after the caveman badge. With bobby-statusline installed instead: one row, badges first, then `5h NN% >HH:MM` |
| 12b | bobby-statusline | `bobby-statusline.py demo`, then `--selftest` | rows at six widths; end-to-end p95 under 50ms |
| 12c | bobby-statusline | `python3 -m unittest discover -s tests -p 'test_*.py'` in the plugin | 82 tests pass |
| 13 | limit-guard | `limit-guard status` in Bash | exit 0, one line with window percentages |
| 14 | limit-guard | `limit-guard selftest` | PASS |
| 15 | limit-guard | `limit-guard resume` from the model | DENIED by the PreToolUse hook (only the human may unpause) |
| 16 | mikrotik-routeros | ask a generic networking question | skill NOT auto-loaded (user-only); `/mikrotik-routeros` loads it |
| 17 | agent-delegation | say "delegate this to a subagent: …" | skill triggers (auto); gate/stop-clause language appears |
| 18 | validator | `python3 scripts/validate-skills.py` | all checks passed |
| 19 | vendor-sync | `scripts/vendor-sync.sh plugins/caveman ef6050c5e1848b6880ff47c32ade1a608a64f85e` (network) | no drift |
| 20 | vendor-sync | `scripts/vendor-sync.sh plugins/ste 34855f2ab2101e939618b9fe3151b74a2720d300` | no drift |

Record each row as PASS/FAIL with the observed output; a FAIL on 2, 7, 9, 12 or 15 blocks the
push.

## Known open items that block a publication push

Check these before starting, because either one makes the gate fail work you could have
avoided:

| Item | State | Where |
|---|---|---|
| `ste` does not write `.ste-active` | open, on hold | `roadmap/private/backlog/ste-status-flag.md`. Until it lands, `bobby-statusline`'s `[STE]` badge cannot appear |
| `skills/offline-html-report` has a manifest and no marketplace entry | open | `roadmap/private/backlog/offline-html-report.md`. Not on `main`, so `validate-skills` passes there; it fails on `harness-support-skills` and `test/pre-push-hook` |
