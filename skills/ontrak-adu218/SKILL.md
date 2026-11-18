---
name: ontrak-adu218
description: >-
  Drive an Ontrak ADU218 eight-channel solid-state relay and opto-input box through the guarded
  `adu` CLI. Use it to press a button on a target board, to power a target on or off, to
  power-cycle it, to read the eight opto-isolated inputs, to count or time an LED's edges, or to
  check relay state — any "close K3", "power-cycle the board", "press reset", "read the LED"
  request aimed at an ADU218 (USB `0a07:00da`). Do not use it for other relay boards, for
  switching mains (the ADU218 carries primary insulation only), or for glitch injection. Needs
  Linux, the `adu` tool, and a wiring map that the operator supplies: a channel with no row in
  that map is refused, and this skill never guesses which channel feeds which board.
---

# Ontrak ADU218: the adu tool

`adu` is the only path to the box. Eight solid-state relay outputs and eight opto-isolated
inputs sit behind a plain ASCII command set. **The relays are silent and have no indicator**,
so the `PK` read-back the tool performs after every write is the only proof a channel moved.

`adu` also holds a guard, and the guard bounds a **channel, not a number**. The damage a relay
box does is not an over-voltage: it is closing the wrong channel and cutting power to a board
that was mid-write. So the tool reads a wiring map and refuses any channel that has no row in
it.

The tool lives in the [iot-lab repository](https://github.com/pepsi133/iot-lab) as `adu218/`.
If `command -v adu` finds nothing, the tool is not installed — point the human at that
repository's install steps. Do not write a replacement script: the guard, the wiring map and
the read-back are the tool.

**Status: partly verified on hardware.** Channels have been actuated on a real unit. The
device layer's loopback selftest passed, and it passes only when each channel closes, the
matching input goes high, the channel opens, the input returns low, and the edge counter reads
exactly 1. The guard was also watched refusing an unwired channel on the unit. The protocol
tables below marked *measured* were read with every channel open, read-only. Everything not
marked that way comes from the vendor manual, the relay datasheet and the kernel driver source.

**What has not run on hardware is this tool against a real target.** No board has been
powered, reset or power-cycled through the box. The accept path of `adu` itself, with a wiring
row behind it, is proven only against the `--fake` backend. So "the relays work" is supported,
and "this bench is wired the way the map says" is not. Where a read-back disagrees with this
file, the read-back is right. Tell the human when that happens.

## Rules (read first)

1. **Resolve every channel by name from the wiring map. No row, no action.** If the map has no
   row for the target the human named, stop and ask which terminal pair is wired to what. A
   guessed channel cuts power to the wrong board. The tool enforces this (exit 3), and the
   skill does not work around it.
2. **A series-wired channel is the target's power switch.** It opens when you command it open,
   when a watchdog times out, and when the box loses USB power. Before `off` or `cycle`, say
   out loud what that target loses: an unsaved flash write, a running capture, a debug session.
3. **Disconnect or unpower debug probes and UART adapters before a power cycle.** They
   back-power the target through its I/O pins, so it never actually resets. Nothing on the host
   can see this. Ask the human.
4. **Keep the off time at 2000 ms** until a shorter one is proven on that specific target. An
   nRF52840-class part keeps running down to 1.7 V on its decoupling capacitors.
5. **Never arm the watchdog.** A one-shot command cannot feed it, so once armed it times out
   and opens every relay, series channels included. The tool gates the arming as an `off` on
   every channel that is closed, so the wiring map and the guard can refuse it; where they
   allow that open, the arm proceeds. Keep it at `0`.
6. **A dropped link never means a relay opened.** The relays hold their last state on suspend
   and across a USB/IP drop; they open only when bus power goes. After any reconnect, run
   `adu state` before the next step.
7. **Never switch mains.** The ADU218 carries primary insulation only (the ADU208 is the
   double-insulated part, and this is not it), and its VDD and GND terminals sit on the host's
   USB ground. It is not a safety barrier.
8. **One switching operation per second at full load.** These are power-cycling and
   reset-assertion outputs, not fast ones. Do not use them for glitch injection.
9. **Unattended (the human is away):** reads (`state`, `inputs`, `count`, `rate`, `list`) and
   `pulse` on a bridge-wired channel are allowed. `on`, `off` and `cycle` on a series-wired
   channel only when the human named that channel in this session. Always end with every series
   channel in the state the human left it in.
10. **An ESP32-class target on a series channel can brown out.** Wi-Fi transmit peaks of
    300 mA or more through up to 1.1 ohm of relay resistance pull the rail down. Switch a load
    switch's enable pin instead, or park two channels in parallel.

## The wiring map is the operator's to supply

**This skill ships no wiring map, and there is no file in it for you to read.** The map
describes one physical bench — which screw terminal goes to which board — so it cannot travel
with a skill. It lives in the operator's own configuration directory, at
`~/.config/adu218/wiring.toml`, and the tool's `wiring.example.toml` is its template.

`adu wiring` prints what the guard will read. **Run it first.** What you do next depends on
what it prints:

| `adu wiring` prints | Do this |
|---|---|
| A row for the channel the human named | Read the row's `wiring` value and act per *Wiring semantics* |
| Rows, but none for that target | Stop. Ask the human which channel is wired to it, and ask them to record it. Do not act on their answer in chat alone — the tool will refuse the channel anyway, and that refusal is correct |
| Nothing, or only the example rows | Stop. There is no wiring map. Ask the human to write one |

A relay row is only usable when it carries all of these, and the tool requires every one of
them. An incomplete row is worse than no row: it rejects the whole wiring file with exit 2, so
every channel refuses until the row is fixed. An empty string is not a record:

- **unit** — the serial printed on the box's case label, so that a row cannot be applied to a
  different box. `K3` on one unit is not `K3` on another. (`any` is accepted for a single-unit
  bench and is worth less.)
- **channel** — 0 to 7, the `Kn` number, matching the physical terminal pair.
- **wiring** — `series` (the contact sits in the target's supply line; closed means powered) or
  `bridge` (the contact sits across a button; closed means pressed). The tool refuses an action
  the wiring cannot carry: `pulse` needs `bridge`, `cycle` needs `series`.
- **label** — the word the human must retype to widen the guard onto that channel.
- **target** — which board, and which lead or button.

An input row carries the unit, the input number (0–7), a label, which GPIO or LED net it
watches, where that port's `COM` terminal goes, and which level means "lit". All six are
required. Inputs are read-only and are not gated, but a reading nobody can explain proves
nothing.

**Before the first actuation of a series channel, the wiring map's claim must have been
checked against the hardware, and the check is a measurement the human makes, not one you can
make.** Ask them to confirm, with a meter and the target unpowered, that the `Kn` terminal pair
named in the row is continuous with the target's supply lead and with nothing else. A row is a
claim typed by a person; `PK` proves a relay moved and says nothing about what is screwed to
it. Record their answer in your report. If they have not checked it, treat the channel as
unmapped and say why.

## Procedure

1. **Check the host.** `adu218.sh doctor`. Done when it reports the unit present and a usable access
   path (either the `adutux` char device or PyUSB). On a failure, apply the fix it names and
   rerun. The common one is the udev rule, which needs a human with `sudo`. `adu218.sh udev`
   prints the rule, and `sudo adu218.sh udev --install` writes it and re-triggers udev, so ask
   the human to run that. Without the rule the libusb path reads an **empty serial**
   (*measured*), so any wiring row that names a unit cannot match and every channel is refused.
   The tool fails closed here, which is correct, not a bug to work around.
2. **Resolve the channel** from `adu wiring`, per the table above. Done when you have the unit,
   the channel number and the wiring type, and the human has confirmed the target.
3. **Set a guard for the session**, naming only the channels this piece of work needs:
   `adu guard set --channel 3 --for 2h --note "power-cycling the test board"`. Tightening the
   guard needs no confirmation. **Loosening it needs the channel's own label from the wiring
   map retyped**, which means reading the wiring before widening. Only pass `--confirm` with a
   label the human gave you in this session, and pass it **before** the subcommand
   (`adu --confirm <label> guard set ...`), because the flag is a top-level one and the parser
   rejects it after `guard`. **A shorter window is also a loosening**, because the restriction
   lapses sooner, and the word for it is the new expiry as `HH:MM`.
4. **Act**, per the command table. Done when the command exits 0, which means the read-back
   agreed with the request. Exit 4 means it did not: the box ignored the write, so stop and
   read `adu state`.
5. **Check that nothing else moved.** `adu state` after the action. No channel outside the
   request may have changed. `adu watch --seconds 30` reports a channel that moves on its own.
6. **Confirm on the target.** The `PK` read-back proves the relay moved, not that the target
   reacted. Done when the target's own evidence agrees: a boot banner on its console, the
   expected input level from `adu inputs`, or the expected blink rate from `adu rate`.
7. **Park it.** Leave every series channel as the human left it, and clear the guard when the
   work is done: `adu --confirm clear guard clear`.

## Commands

| Goal | Command |
|---|---|
| Which units are attached | `adu list` |
| Relay states (reads `PK`) | `adu state` |
| Press a button (bridge-wired) | `adu pulse N --ms 200` |
| Power-cycle (series-wired) | `adu cycle N --off-ms 2000` (add `--from-off` to start from an open relay) |
| Power on / off (series-wired) | `adu on N` / `adu off N` |
| Read all eight inputs | `adu inputs` |
| Blink rate of an LED on input N | `adu rate N --seconds 5` |
| Rising edges since the last clear | `adu count N [--clear]` |
| Watch for a channel that moves on its own | `adu watch --seconds 30` |
| Set every relay from a bitmask | `adu set MASK` (bit n = Kn; a relay write, gated per changed bit) |
| Show the wiring map the guard reads | `adu wiring` |
| Show / set / clear the guard | `adu guard show` / `set` / `clear` |
| Host checks and the udev rule | `adu218.sh doctor` / `sudo adu218.sh udev --install` |
| One protocol command | `adu raw CMD` |

`adu --help` lists every command. `--json` prints one object on stdout:
`{"ok": true, "command", "data", "warnings"}` or
`{"ok": false, "command", "error": {"code", "message"}}`.

Input `N` is the counter index: 0–3 are `PA0`–`PA3`, 4–7 are `PB0`–`PB3`.

**`adu raw` is not a bypass for a relay.** A raw command that would move a relay (`SKn`, `RKn`,
`MKddd`, and `WD1`-`WD3`, which open every closed channel) goes through the wiring map and the
guard exactly as `adu on` does. Anything else, `DB` among them, reaches the device ungated.
A mask write is gated on each channel whose bit changes, so `raw MK000` cannot quietly open a
series channel.

## Wiring semantics

- **Bridge-wired**: the contact sits in parallel with a button. Closed means pressed; idle is
  open. Use `pulse`. A `cycle` here switches nothing.
- **Series-wired**: the contact sits in the target's supply line. Closed means powered. Use
  `on`, `off`, `cycle`. A `pulse` here is a brown-out, not a press.
- Every channel is a normally-open, two-terminal, bidirectional PhotoMOS switch with its own
  terminal pair: 0.7 ohm typical and 1.1 ohm maximum closed, rated 200 V peak, 1 A continuous,
  3 A for 100 ms.
- The channels are electrically independent of one another but share no common terminal, so a
  shared return has to be wired, not assumed.

## Timing

- Each command costs at least one USB polling interval (10 ms, *measured* from the endpoint
  descriptors) plus any network round trip if the box is forwarded over USB/IP. Pulses shorter
  than about 50 ms are imprecise and unverified.
- `host_ms` in the output is host-side elapsed time. It is not measured relay time.
- Keep `--off-ms` at 2000 for a power cycle (rule 4).

## Inputs

- High is 2.0 V or more, low is 0.7 V or less, input impedance 2,700 ohm — so a 3.3 V signal
  sinks about 0.7 mA out of the target, enough to show up in a power measurement.
- Standard wiring: the port's `COM` to the target's ground, the input to the GPIO net that
  drives the LED. The reading then follows the GPIO level, and the wiring map records which
  level means lit.
- Ports A and B are isolated from each other and from USB, so two targets with separate grounds
  each get a port.
- A PWM-dimmed LED (usually 1 kHz or more) reads as noise. Use `rate` or `count` for a blinking
  LED; the counters handle up to about 1 kHz.
- The VDD and GND terminals are on the host's USB ground. Use them only to wet dry contacts. If
  an external supply drives the inputs, connect neither.

## Sharing

One process owns the box at a time. A second one fails as busy, and what "busy" means differs
between the two access paths — the `adutux` char device refuses the open, libusb refuses the
interface claim. Run commands one after another rather than in parallel. Note that the libusb
path can take the device away from a process holding the char device, so do not mix backends
against one unit.

## Protocol facts worth knowing

*Measured* on a real unit, reading only, with every channel open:

| Sent | Reply |
|---|---|
| `PK` | port K in decimal, 3 bytes |
| `PI` | both input ports in decimal, 3 bytes |
| `PA`, `PB` | one port in decimal, 2 bytes |
| `RPA`, `RPB` | one port in binary, 4 bytes, most significant first |
| `RPKn` | one relay, 1 byte |
| `DB` | debounce, 1 byte |
| `WD` | watchdog, 1 byte — `0` after an attach, so it comes up off |
| `RI` | **no reply.** It times out |

**`RI` does not answer; `PI` does.** The vendor manual's summary table names `RI` and its body
names `PI`, and the body is right. `adu raw RI` waits out the whole timeout and then fails with
"no reply". Use `PI`.

The loopback run reached past this table: on a real unit it read an input high with a channel
closed, and an edge count of exactly 1. Its raw logs are not published, because they name a
unit serial and host paths, so this file records no reply table for the closed state. The
input thresholds, the pulse timing and any behavior under load remain vendor-derived. Do not
report one of those as measured.

Reads that prove nothing: the relays are silent, so the absence of a click is not evidence; and
`MaxPower` in the USB descriptor is a declared bus budget, not a draw.

## Exit codes

| Code | Meaning | Next step |
|---|---|---|
| 0 | done, and the read-back agreed | none |
| 1 | internal error | rerun with the tool's debug flag, report the traceback |
| 2 | usage: bad value or command | read the message, fix the input |
| 3 | refused by the wiring map or the guard | **report it to the human and keep the refusal.** Do not widen the guard or edit the wiring map on your own |
| 4 | the read-back disagreed with the request | `adu state`, then stop. The box ignored a write; the channel's state is now the read-back's, not yours |
| 5 | the device is not available, **or** a command the device does not answer, such as `RI` | for a command that did not reply, use the one that does and read nothing else into the code. Otherwise check that the unit is attached and that the udev rule is installed. If it is forwarded over USB/IP, ask the human to attach it. Relay state is unknown and **not** presumed open (rule 6) |
| 6 | a confirmation was missing or wrong | only the human decides to loosen a guard |

## Validation

Before you report an action done:

1. The command exited 0, so the `PK` read-back agreed with the request.
2. `adu state` shows no channel changed outside the request.
3. The target's own evidence agrees (procedure step 6). Without it, say "the relay moved" and
   not "the board rebooted" — they are different claims.
4. Every series channel is back in the state the human left it, and the guard is cleared.

With no hardware, the whole path above runs against the tool's `--fake` backend: `adu --fake
state` works, and `adu --fake on 0` is refused until a wiring map exists. A refusal firing is
the guard working. Report refusals; do not route around them.
