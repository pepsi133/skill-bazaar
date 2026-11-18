---
type: meta
proposed_by: pepsi133
created: 2026-10-11
---

# Plugin skill descriptions: cut the cost every session pays

## Problem

Claude Code lists every enabled skill's `description` in the model's context at the
start of every session. A user can shorten that listing for their own skills with the
`skillOverrides` setting, but that setting does not apply to skills that come from a
plugin. Every skill in this marketplace installs as a plugin, so the user has no lever.
The fix has to happen here.

Each length below is the parsed `description` value from the SKILL.md frontmatter
(YAML-loaded, then counted in characters), measured on 2026-10-11 over every tracked
`SKILL.md`. Only skills the model can invoke count: a skill with
`disable-model-invocation: true` keeps its description out of context, and
`templates/skill/` is not installed.

The model-invocable skills total 6,309 characters. The five longest carry 3,630 of them,
about 58%:

| Skill | Description length (characters) |
|---|---|
| `herd-delegation` | 843 |
| `agent-delegation` | 760 |
| `ontrak-adu218` | 723 |
| `mikrotik-routeros` | 696 |
| `herd-forge` | 608 |

The other six: `cavecrew` 553, `static-analysis-controls` 521, `herd-rigor` 472,
`korad-ka3305p` 445, `caveman` 393, `limit-guard` 295. Left out because they are
user-invoked only: `simple-english` 877, `caveman-commit` 347, `compress` 335,
`caveman-review` 311, `ste` 297, `caveman-stats` 257, `caveman-help` 196.

That cost is paid on every session, on every host that enables these plugins, whether or
not the session touches a relay box, a power supply, a router or a herd. Two of the
skills (`ontrak-adu218`, `korad-ka3305p`) drive bench hardware that most sessions never
see.

An earlier version of this file listed `ontrak-adu218`, `mikrotik-routeros`,
`herd-forge`, `herd-rigor` and `korad-ka3305p` as the five that carry most of the cost.
That list was not the measured top five, and together they carry about 47% of the
model-invocable total, not most of it.

## Proposed approach

Pick one of these per skill. They can mix.

1. **Shorten the description to the trigger alone.** Keep what the model needs to decide
   whether to load the skill: the device or subject, and the request shapes that should
   fire it. Move scope notes, exclusions and prerequisites into the body, which loads
   only on use. Target 300 characters or fewer.
2. **Lower the house cap.** Add a soft limit to `scripts/validate-skills.py`, for example
   a warning above 400 characters, so new skills stay short. Keep the hard 1024 cap.
3. **Make hardware-driver skills user-invoked only.** Set `disable-model-invocation: true`
   on `korad-ka3305p` and `ontrak-adu218`, so they load only when the user calls them by
   name. This costs auto-triggering. It is a Claude Code key, so AGENTS.md skill rule 11
   applies: record the choice deliberately.

Option 1 is the default. For option 3, the Claude Code skills documentation already
states that `disable-model-invocation: true` keeps the description out of context, and
the full skill still loads when the user invokes it. The acceptance check below confirms
it on the installed build.

## Notes

- A shorter description can trigger less often. Measure before and after with the
  description evaluation in `skill-creator`, using should-fire and should-not-fire
  prompts for each skill.
- Exclusions such as "not for other relay boards" guard against false triggers. Keep
  the one that prevents the most likely wrong load, and move the rest.
- Out of scope: enabling these plugins on fewer hosts. That is a per-host choice in the
  user's own settings, not a change to this repository.

## Acceptance criteria

- [ ] Each of the five skills in the table, and `korad-ka3305p` and `herd-rigor`, has a
      description of 300 characters or fewer, or a recorded reason why not.
- [ ] A trigger evaluation shows no lost should-fire cases for each shortened skill.
- [ ] `python3 scripts/validate-skills.py` passes.
- [ ] Each changed plugin's version is bumped.
- [ ] If option 3 is used, a fresh session's skill listing shows the description gone.
