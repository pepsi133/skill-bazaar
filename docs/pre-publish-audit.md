# Pre-publish audit — content gate and functional gate

Run this before a push that makes new content public. Two independent runs of the
**content gate** (two fresh agents, or one agent and one separate Claude instance), with the
findings diffed. Then the **functional gate** in a fresh Claude Code session with the plugins
installed from this marketplace. Both must pass before the push.

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
| 1 | all | `claude plugin list` | 5 `@skill-bazaar` entries enabled; no `caveman@caveman` |
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
| 12 | limit-guard | look at the statusline | `[5h NN%↻…]` badge after the caveman badge |
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
