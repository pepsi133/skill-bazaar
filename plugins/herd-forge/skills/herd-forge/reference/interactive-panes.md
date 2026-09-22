# Driving an interactive program from a pane

`SKILL.md` section 3 says why a pane and not a pipe. This file is the driving loop and the
traps.

Reach for a pane for a language REPL, an `ssh` or `sudo` password prompt, `docker attach`,
a TUI installer, `git rebase -i`, or a database shell. It covers a test runner that
prompts, a package manager that waits on a yes, a migration tool that asks before it
writes, a debugger, a serial console, and anything with a menu or a pager.

A pane has a second property no expect-style library gives you: a human can watch it while
an agent drives it.

## The loop

One pane, one program, one driver agent. Every other agent asks that agent.

    herdr pane split --current --direction right --cwd "$PWD" --no-focus
    herdr pane run <pane_id> "<command>"
    herdr pane wait-output <pane_id> --match "<prompt text>" --timeout 120000
    herdr pane read <pane_id> --source recent-unwrapped --lines 200
    herdr pane send-text <pane_id> "<input>"
    herdr pane send-keys <pane_id> enter

`pane run` sends the command text and Enter atomically. `wait-output` searches the current
snapshot immediately, so output that already exists matches. `--regex` takes a Rust regular
expression, and `--source` plus `--lines` set which window it searches, with the same
meanings they have on `pane read`.

Declare the occupant when the program is long-lived, so it shows as a managed agent. Both
calls take the same `--source` and `--agent` values:

    herdr pane report-agent <pane_id> --source <id> --agent "<label>" --state working
    herdr pane release-agent <pane_id> --source <id> --agent "<label>"

## Five traps, each measured

**1. Wait on output, never on a sleep.** A sleep races the echo of your own command. A wait
on the prompt string can match that echo rather than the program's answer. Match on
something only the program prints, or send a marker command whose output is unmistakable.

**2. A console wraps at terminal width and splits your marker.** Read with
`--source recent-unwrapped`, which joins soft wraps. The same wrap joining then defeats a
marker that a wrap split, so a driver reports failure after the command succeeded. Choose a
marker shorter than the pane width.

**3. The read window is a denominator.** A 60-line read returned zero hits. The same search
at 400 lines returned one hit, and the overseer nearly reported a message as undelivered.
When a read comes back empty, raise `--lines` before you conclude anything.

**4. Rows that leave the alternate screen are gone.** A full-screen program draws on the
alternate screen, and those rows never enter host scrollback, so a larger `--lines` cannot
recover them. Ask the program, or the agent driving it, to write a file instead.

**5. A login that looks like a failure can still succeed.** Some remote shells probe
the terminal and wait for an answer before they draw a prompt. A driver that ignores the
probe times out and reports a failed login while the far side records a successful session.
Check the far side before you retry, because the retry opens a second session.

## When the program discards its own records

This section and the next cover a program whose state outlives your session and is not
fully in your logs. That covers a device or appliance console, an embedded target, a
long-lived VM, a test bench, and a build machine other people also use. Skip both for an
ordinary local process.

Some programs write results into a volatile buffer and only sometimes into a persistent
store. A device that logs to RAM and flushes to flash on its own schedule is the common
case. A burst larger than the buffer loses records, and the output cannot distinguish that
loss from a run that produced nothing.

Four rules, and each one closes a measured failure:

- Read the inventory before the run as well as after, and fetch every record the run
  produced. A reboot between the run and the fetch loses the live log.
- Repeat the input rather than trusting one result. Four identical inputs produced four
  confirmed effects and three records. The missing record had a benign cause, and the
  instrument found that out because it repeated.
- Generate every timestamp. Never reuse one. Four filenames carried timestamps 31 minutes
  early because an agent hardcoded a stamp.
- Know which of two views of the same data is current, and read that one. An agent read
  only the lagging view and would have reported four false negatives.

## State traps on a long-lived machine

A machine you drive across a herd carries state your logs do not contain.

- A reset loses the clock, and a stale clock produces a failure message unlike the ones an
  operator expects. Validity is checked before anything else.
- A quantity that another process moves is not a fixed ceiling. One overseer read the same
  system value twice, got two answers with nothing done in between, and concluded that an
  operator change did not take effect. Both readings were accurate.
- An instrument shared with a human has an actor your logs do not contain. An observed
  change is not evidence that your input caused it.

Pass every such trap to any agent that borrows the pane. A trap that makes their results
wrong matters more than one that makes their run fail.
