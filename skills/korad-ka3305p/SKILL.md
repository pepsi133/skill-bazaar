---
name: korad-ka3305p
description: Drive a Korad KA3305P bench power supply through the korad CLI (daemon, read-back on every write, voltage/current guard). Use it to set a voltage or a current limit, to power a target board, to log V/I to CSV, to set or check the guard (the voltage/current limit for a time window), or for any "turn the supply on/off" request on a KA3305P. Do not use it for other power supply models. Needs Linux and the korad tool from the iot-lab repository.
---

# Korad KA3305P: the korad tool

`korad` is the only path to the supply. A daemon
owns the serial port, and every command is a client of it. The supply itself
reports no errors: it ignores a bad command in silence. So `korad` reads back
every write, and a non-zero exit code is the only failure signal you get.

The tool lives in the [iot-lab repository](https://github.com/pepsi133/iot-lab/blob/main/korad-ka3305p). Design:
[DESIGN.md](https://github.com/pepsi133/iot-lab/blob/main/korad-ka3305p/DESIGN.md). Measured protocol facts:
[README.md](https://github.com/pepsi133/iot-lab/blob/main/korad-ka3305p/README.md), "Protocol behavior".

## Rules (read first)

1. **M1 is the power-up safe slot: 0.00 V / 0.000 A on both channels.**
   Never overwrite it unless it holds anything above 0/0. `korad preset-save 1` enforces this (details under "Measured caveats" below).
   On the front panel, never save into M1. Keep working presets in M2–M5.
2. **Power-up always loads M1** and sets the output to the front panel's
   On/Off state as it was at power-off. USB `out off` does not change that
   state. **A power cycle and a Windows sleep drop the USB/IP attach.** Under
   WSL the daemon re-attaches it by itself (see "Setting it up"); otherwise
   attach again with `usbipd.exe attach --wsl --busid <busid>`. Then check
   `korad status`.
3. **Unattended (the human is away):**
   - Output ON only at 5 V or less and 50 mA or less per channel.
   - ON bursts of 5 s at most, each with a watchdog that turns the output
     off (for example `(sleep 4.5; korad out off) &`).
   - Never a step that can lose control while the output is ON. USB/IP
     detach, `kill -9`, taking the port, and a daemon restart happen only
     while the output is OFF.
   - No step that needs a person.
   - Always end parked: output OFF, 0 V, independent mode, daemon stopped
     (`korad daemon stop`).
   - Anything else waits for the human.
4. **Attended (the human is at the desk):** the human decides the limits.

## Prerequisites

0. `korad` is on `PATH`. If `command -v korad` finds nothing, the tool is
   not installed: point the human at the install steps in the
   [iot-lab README](https://github.com/pepsi133/iot-lab/blob/main/korad-ka3305p/README.md#install). Do not write a replacement
   script, because the guard and the read-back live in the daemon.
1. The supply is on the bus as `0416:5011` (CDC-ACM, `/dev/ttyACM<n>`).
   - WSL: `usbipd.exe attach --wsl --busid <busid>`. Get the busid from
     `usbipd.exe list`.
2. The user is in the `dialout` group. If the group was added in this
   session, prefix device commands with `sg dialout -c '...'`.
3. `python3-serial` is installed. `--fake` needs nothing.
4. You do not need `korad daemon start`: the first command starts the daemon
   and prints `daemon started on first use (pid N): ...` on stderr (a
   warning under `--json`). Read that line: an output that was already ON is
   reported there. Use `korad daemon start --poll max` only for the fastest
   logging. The daemon stops itself after 5 minutes with the supply absent and
   no active guard; the next command starts it again.
5. When the supply is absent, a command that needs it waits up to
   `wait_for_device_s` (default 15 s) and prints what the daemon is doing, one
   line per step, on stderr (in `warnings` under `--json`):

   ```
   [ 0.0 s] waiting for the supply: daemon started on first use; device not attached yet
   [ 0.5 s] usbipd re-attach: looking for 0416:5011 on the Windows host bus ...
   [ 1.0 s] usbipd re-attach: busid 1-2 is shared, attaching to WSL ...
   [ 1.3 s] usbipd re-attach: busid 1-2 attached; waiting for the serial port ...
   [ 3.5 s] opening /dev/ttyACM0 ...
   [ 4.0 s] supply reached
   ```

   Then the command runs. It stops waiting at once, with exit 5, on a cause
   that waiting will not fix. Act on the message:

   | Message says | What to do |
   |---|---|
   | `no 0416:5011 device on the Windows host bus (unplugged or powered off?)` | ask the human to switch the supply on or plug the USB cable in, then retry |
   | `is not shared ... usbipd bind --busid X` | ask the human to run that command once, elevated. You cannot |
   | `is attached to client ...; not taking it` | another machine or VM has it. Ask the human; do not detach it yourself |
   | `several ... devices ...; set usb_serial` | set `usb_serial` in the config (see below) |
   | `port busy` | another program has the port open. Close it (a serial terminal, a probe script) |
   | `fixed port` or `usbipd re-attach is off` | attach the supply by hand, then retry |

   After 15 s without one of these, it gives up with exit 5 and the last step.
   `--no-wait` (any position) answers at once instead. `out off` never waits:
   it tries at once, and a failed OFF stays pending.

## Setting it up for another supply or user

The identity comes from `~/.config/korad/config.toml` (copy
[config.example.toml](https://github.com/pepsi133/iot-lab/blob/main/korad-ka3305p/config.example.toml)):

```toml
usb_id = "0416:5011"      # VID:PID of the supply
usb_serial = "ABC123"     # your supply's USB serial: `usbipd.exe state`, or
                          # cat /sys/class/tty/ttyACM*/device/../serial
```

`korad daemon start --usb-serial ABC123 --usb-id 0416:5011` overrides the file
for one daemon run. With `usb_serial` empty, the daemon uses the only device
with `usb_id`; when several with different serials are connected it refuses
(exit 5) and lists them.

**USB/IP re-attach (WSL).** Under WSL, when `usbipd.exe` is found, the daemon
re-attaches the supply itself after a power cycle, a replug or a Windows
sleep: when the device has been absent for more than 3 s, at most once per
10 s, it finds the device by `usb_id` and `usb_serial` (the busid can change)
and runs `usbipd.exe attach --wsl --busid <busid>`. It never binds and never
elevates:
- device not shared: the daemon logs that a human must run
  `usbipd bind --busid <busid>` once, elevated
- attached to another client: the daemon logs it and does not take it
- `usbipd_reattach = "off"` in the configuration disables this; `--port`
  disables it too
The re-attach does not make the power-up window safe: the output is at M1's
values (0 V) until the daemon reconnects.

## Safe-operation order

Do these steps in this order every time you power something.

1. **Read the guard**: `korad guard`. Compare the printed `now` with the time
   you expect. A wrong clock or zone makes the expiry wrong.
2. **If no guard is active, ask the human what is connected.** Then set a
   guard that covers **both** channels, because `out on` switches CH1 and CH2
   together:
   `korad guard set -v 3.3 -i 0.2 --today --note "ESP32 3V3 on CH2"`.
   With a guard on one channel only, `out on` is refused while the other
   channel is above 0 V, because it has no limit. Set that channel to 0 V
   first (`korad set 1 -v 0`) or add a limit for it.
3. **Set the current limit, then the voltage**: `korad set 2 -i 50mA -v 3.3`.
   The tool writes `ISET` first and prints `(read back)` when both values
   took.
4. **Park the channel that you do not use**: `korad set 1 -v 0`.
5. **Read the state**: `korad status`. Confirm both channels before the next
   step.
6. **Turn the output on**: `korad out on`. The daemon checks the guard again
   against the read-back setpoints.
7. **Turn the output off when you are done**: `korad out off`.
8. **Stop the daemon when the session ends**: `korad daemon stop`. This turns
   the output off and parks both channels at 0.00 V / 0.010 A, independent.

## Commands

| Command | Does |
|---|---|
| `status` / `s` | output, mode, OVP/OCP, set and measured V/I, CV/CC, guard |
| `set <1\|2\|12> [-v V] [-i A]` | setpoint write with read-back. `12` = both channels |
| `out` / `o` `on\|off` | one switch for CH1 and CH2. OFF goes ahead of all queued work |
| `mode` / `m` `independent\|series\|parallel` | see *Series and parallel* |
| `preset` / `p` `1-5`, `preset-save` / `ps` `1-5` | recall / save a memory slot |
| `ovp on\|off`, `ocp on\|off` | supply over-voltage / over-current protection |
| `guard` / `g` `[show\|set\|clear]` | see *Guard* |
| `log` / `l` `-f FILE [--interval 1s\|max] [--duration 10m] [--echo]` | CSV log |
| `monitor` / `mon` `[--csv FILE]` | curses view for a human. Keys: DESIGN.md, "Monitor keys" |
| `daemon` / `d` `start\|stop\|status\|reload [--fake] [--poll N\|max]` | daemon lifecycle |

Values: `3.3`, `3.3V`, `3300mV`, `0.05`, `0.05A`, `50mA`. A plain number is
volts or amps. The tool refuses a value finer than 10 mV or 1 mA, and a form
such as `3v3`, because the supply would ignore it.

`--json` goes **before** the command and prints one line:
`{"ok": true, "command", "data", "warnings"}` or
`{"ok": false, "command", "error": {"code", "message", "detail"}}`.
Warnings also go to stderr and do not block.

## Guard

- A guard holds `max V` and `max A`, for both channels (no `-c`) or for one
  (`-c 1`, `-c 2`), plus an expiry and a note. A channel's own limit overrides
  the global one.
- Expiry: `--for 4h`, `--until 18:00`, or `--today` (the next 10:00 local).
  `--for` needs a unit (`4` is refused, `4h` is valid). A guard must last at
  least 60 s. If `--today` gives less than 1 h, a warning says so.
  Every guard line shows `expires`, `now` and `left`, with zone and offset.
  Read them.
- An expired guard, or no guard, limits nothing. Each command then prints a
  warning. Treat that warning as step 2 of the safe-operation order.
- The guard is checked before each write, on each read-back, before
  `out on`, after a preset recall, and by the poller while the output is ON.
  A front-panel change that breaks the guard turns the output OFF. The poller
  also checks the measured VOUT on every sample, so a knob turn is caught in
  about one sample.
- The expiry follows the wall clock. A `clock` event in `korad status` or the
  log means the clock jumped by more than 60 s. Check the time and the guard.
- **Tightening** (a lower limit, a later expiry) needs no confirmation.
- **Loosening or clearing** needs the new value retyped: interactively, or
  with `--confirm "<words>"`. The retype is for the human. Use `--confirm`
  only when the human asked for that exact looser guard in this
  conversation. A refusal (exit 3) is the guard doing its job: report it to
  the human, and keep the guard.

## Series and parallel

- Series gives up to 62 V across CH1(−) to CH2(+). Parallel gives up to about
  10 A. Both are real risks to a target.
- With a guard, a mode is allowed only when the guard names it:
  `korad guard set -v 48 -i 0.5 --mode series --for 1h`. A series guard needs
  global limits and `max V` above 31 V. In series the guard compares
  2 × VSET2 with `max V`. In parallel it compares 2 × ISET2 with `max A`.
- In series and parallel, CH2 sets both channels. `set 1` is refused.
- A mode change turns the output OFF, and switching to series or parallel
  copies the CH2 setpoints into CH1.

## Logging

- `korad log -f run.csv --interval 1s --duration 10m` samples the daemon's
  cache. Columns: `time_iso, t_rel_s, vset1, iset1, vout1, iout1, vset2,
  iset2, vout2, iout2, output, mode, ch1_cv, ch2_cv, ovp, ocp, event`.
- The `event` column records writes by every client and front-panel changes.
- For the fastest rate, start the daemon with `korad daemon start --poll max`
  and log with `--interval max`. Over USB/IP that gives about 8 samples/s.
  The default poll of 5 Hz caps the log at 5 samples/s.
- Several clients can log and monitor at the same time. They add no serial
  traffic, and they do not block `out off` from another client.

## Measured caveats

- `IOUT` reads about 2–3 mA low at small currents: 7 mA at 10 V and 28 mA at
  30 V into 1 kΩ. Near 0, `IOUT` does not prove that no current flows.
- **At power-up the supply always loads memory slot M1** (also when another
  slot was used last) and sets the output to the front panel's own On/Off
  state as it was at power-off. `OUT0`/`OUT1` over USB do not change that
  state, and this tool cannot set it (measured: output OFF over USB at
  power-off, came up ON). Setpoints set over USB are lost at a power
  cycle unless they are saved into M1.
- **M1 is the safe power-up slot at 0.00 V / 0.000 A, and it stays that
  way.** The human saves it once on the front panel with both outputs OFF,
  and the supply then powers up OFF at 0/0. Save working presets in M2–M5 only.
  The daemon enforces this:
  - `korad preset-save 1` with any setpoint above 0 is refused (exit 3,
    `E_GUARD`). There is no override.
  - With all setpoints at 0 and the output OFF, `korad preset-save 1` reads
    M1 (a recall) and restores the setpoints. It saves only when M1 holds
    anything above 0/0 ("M1 restored to 0/0"); otherwise it answers "M1
    already holds 0/0; not overwritten".
  - With the output ON it is refused (exit 2): turn the output off first.
  The tool cannot set the panel's On/Off state, so only a panel save (with
  the outputs OFF) makes M1 also power up OFF. If M1 ever reads above 0/0,
  tell the human.
- A power cycle also drops the USB/IP attach. Until you attach again, the
  tool cannot see or change the supply; the output can stay ON at M1's
  values for that time (seen: about 40 s at 12.5 V). Run `korad status`
  before `out on`.
- `STATUS?` bit 6 or bit 7 means output ON. When the status says OFF but the
  terminals carry voltage, the daemon counts the output as ON by measurement
  (`output_by_measure`) and logs a warning. Treat that warning as real.
- `RCL` loads any stored value and turns the output OFF. The as-found slots
  hold up to 31 V / 5.1 A.
- The supply keeps its state when the USB link drops. A SIGKILL of the daemon
  or a `usbip detach` skips the safe stop.
- While the device is absent, `korad status` exits 5 and its values are
  stale. The output can still be ON. It also exits 5 when the device shows as
  present but no fresh sample arrives (a hung port). The daemon closes a hung
  port after 5 s and reopens it.
- After Windows sleep, the USB/IP link can die while `/dev/ttyACM*` stays.
  Attach the supply again. If `korad daemon stop` cannot finish the safe stop
  within 10 s, it terminates the daemon and exits 5: then the supply state is
  unknown, so ask the human to check the OUTPUT LED.
- `ISET 0.000` still passes about 2.8 mA into 1 kΩ. The current limit is not
  an off switch: use `korad out off`.
- The last output request wins: an older `out on` is dropped (exit 7) when a
  newer `out off` arrives. Do not retry an exit-7 ON by reflex.
- Only one daemon per supply runs. A second `daemon start` names the first
  one. A raw pyserial script cannot open the port while the daemon runs.

## Exit codes

| Code | Meaning | Next step |
|---|---|---|
| 0 | done, read back | none |
| 1 | internal error | rerun with `--debug`, report the traceback |
| 2 | usage: bad value, unit, precision or command | fix the input. Read the message |
| 3 | guard refusal | report to the human. Do not loosen the guard on your own |
| 4 | read-back mismatch: the supply ignored the write | `korad status`, then retry once |
| 5 | daemon not running (only with `autostart = false`, or from `daemon status`), the supply could not be reached (a cause that waiting will not fix, or `wait_for_device_s` ran out; see prerequisite 5), device absent with `--no-wait`, or the safe stop failed | Read the message: it names the cause and the next step. Otherwise `korad daemon start`. Check the attach and `dialout`. If the message says the output may still be ON, tell the human to press OUTPUT on the front panel. A failed `out off` stays pending: the daemon applies it when the device is back, unless you send a newer `out` request |
| 6 | confirmation missing or wrong | only the human decides to loosen the guard |
| 7 | output ON dropped: a newer output request came first, or it waited more than 2 s | `korad status`. Send `out on` again only if ON is still what you want |
