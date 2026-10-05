# ontrak-adu218

An agent skill for driving an Ontrak ADU218 relay and opto-input box through the `adu` CLI. The
skill itself is [`SKILL.md`](SKILL.md), written for the agent. This file is for the human: what
the skill does, how to install it, why it says what it says, and what it refuses to do. The
agent loads `SKILL.md` alone, and nothing in it points here, so this file costs no context at
use time.

## What it does

The ADU218 is eight solid-state relay outputs and eight opto-isolated inputs on a USB box
(`0a07:00da`). On a bench it is the thing that presses a button, cuts a board's power, and reads
an LED. The skill teaches an agent to do those three things without doing them to the wrong
board.

Two properties of the hardware shape every rule in it:

1. **The relays are silent and have no indicator.** Nothing in the room tells you a channel
   moved. The only evidence is the `PK` read-back, which the tool performs after every write.
2. **A relay box's failure mode is not an over-voltage.** It is closing the right-looking
   channel on the wrong terminal pair and cutting power to a board that was mid-write. So the
   unit of safety is the *channel*, not the number: a number is always valid and tells you
   nothing.

The skill is a client of the `adu` tool, which lives in the
[iot-lab repository](https://github.com/pepsi133/iot-lab). The tool holds the enforcement — the
wiring map, the guard, the read-back. The skill holds the parts a tool cannot check: that a
debug probe is unplugged before a power cycle, that the human has actually metered the terminal
pair, and that a `PK` read-back is not a claim about the board.

## Install

As a Claude Code plugin, from the marketplace:

```bash
claude plugin marketplace add pepsi133/skill-bazaar
claude plugin install ontrak-adu218@skill-bazaar
```

Or by clone and symlink, which any SKILL.md-compatible tool can consume:

```bash
git clone https://github.com/pepsi133/skill-bazaar.git
ln -s "$(pwd)/skill-bazaar/skills/ontrak-adu218" ~/.claude/skills/ontrak-adu218
```

Other tools and paths are in [`docs/install/`](../../docs/install/).

The skill needs the `adu` tool on `PATH`, Linux, and either the in-kernel `adutux` driver or
PyUSB. It also needs a wiring map, and that one is yours to write — see below.

## Contents

| Path | What it is |
|---|---|
| `SKILL.md` | The skill. Tool-agnostic: it drives a CLI and assumes no particular agent harness. |
| `README.md` | This file. Not loaded by the agent. |
| `.claude-plugin/plugin.json` | Packages the folder as a one-skill plugin. |

There is no `references/` directory, and that is deliberate. See the next section.

## The wiring map, and why it is not in here

`SKILL.md` step 2 is "resolve the channel". A skill that tells an agent to switch a board's
power on the strength of a wiring file it ships itself is worse than a skill with no safety
step, because an empty file makes the step read as satisfied.

So the shipped skill carries no wiring map and points at no file inside itself. A wiring map
describes one physical bench — which screw terminal goes to which board — which means it cannot
travel with a skill and must not be committed to a public repository, because it names your
hardware. It lives in your own configuration directory at `~/.config/adu218/wiring.toml`, from
the `wiring.example.toml` template the tool ships.

What the skill does instead:

- It names what a usable row must contain (unit serial, channel, wiring type, label, target).
  The tool requires all five, and an incomplete row rejects the whole file, so every channel
  refuses until it is fixed.
- It gives the agent an explicit branch on what `adu wiring` prints, including "nothing" and
  "only the example rows", and in both of those the instruction is to stop and ask you.
- It requires that, before the first actuation of a series-wired channel, **you** have metered
  the terminal pair against the target's supply lead with the target unpowered, and it has the
  agent ask you whether you have. A wiring row is a claim a person typed; `PK` proves a relay
  moved and says nothing about what is screwed to it. No measurement the host can take closes
  that gap.

The tool backs this up: a channel with no row is refused with exit 3, `adu raw MKddd` is gated
per changed bit, and `adu raw WD1` to `WD3` is gated as an `off` on every closed channel, so
`raw` is not a way around it.

**Checked against `iot-lab` commit `b34c3a7`.** The tool and the skill live in two
repositories, and nothing makes them move together, so the claims in `SKILL.md` are claims
about one commit of `adu`. When you change the tool, re-read the skill against it and move this
line.

## Verification status

**The skill is unverified on hardware.** The protocol facts marked *measured* in `SKILL.md` were
read back from a real unit, read-only, with every channel open. Everything else — every reply
with a channel closed, the counter formats, the input thresholds, the pulse timing — is derived
from the vendor manual, the PhotoMOS datasheet and the kernel driver source. **No channel has
been actuated on a real unit**; the accept path is proven only against the tool's `--fake`
backend.

`SKILL.md` says this in its own first lines, and tells the agent that where a read-back
disagrees with the file, the read-back wins and the human is told. Keep it that way: the next
person to read the skill should learn what is proven from the skill, not from this file.

## Design rationale

**The refusal is the feature.** The CLI's exit 3 is the guard working, and an agent's instinct
on a refusal is to find a way through it. The skill therefore says, in the rules, in the
procedure and again in the exit-code table, that a refusal is reported to the human and kept —
and that the agent does not widen a guard or edit a wiring map on its own. Widening the guard in
the tool requires retyping the channel's label from the wiring map, which is a human-shaped act
on purpose.

**"The relay moved" and "the board rebooted" are different claims.** The validation section
makes the agent state the one it has evidence for. `PK` is a fact about the box. A boot banner
is a fact about the target. Conflating them is how a failed power cycle gets reported as a
success.

**A dropped link does not open a relay.** The relays hold their last state on suspend and across
a forwarded-USB drop; they open only when bus power goes. The intuitive assumption is the unsafe
one here, so the skill states the fact and requires `adu state` after any reconnect.

**Failing closed can look like a bug.** Without the udev rule, the libusb path reads an empty
serial, so a wiring row that names a unit cannot match and every channel is refused. That is
correct behaviour and it looks like a broken tool, so the skill says which it is — otherwise the
fix an agent reaches for is a row that names no unit.

**Not a mains barrier.** The ADU218 carries primary insulation only; the double-insulated part
is the ADU208, and this is not it. Its VDD and GND terminals sit on the host's USB ground. The
skill refuses mains switching outright rather than qualifying it.

## Related

- [`korad-ka3305p`](../korad-ka3305p) in this repository: the same shape for a bench power
  supply — guard first, read-back on every write, exit codes that name the next step. If you are
  switching a board's power, consider whether the supply is the better place to do it.
