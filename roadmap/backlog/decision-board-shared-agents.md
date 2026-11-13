---
type: plugin
proposed_by: pepsi133
created: 2026-11-13
---

# Decision board: agents with their own identity, and agents of other users

## Status

Parked. The board has one agent, and that agent runs in the session of the operator (see
`decision-board-single-agent`). Only the owner writes to the board. Build this only when a
second writer is real.

## Problem

Two cases do not fit the single-agent model:

- An agent that runs under its own claude.ai identity, not in the session of the operator.
- A team board, where the agents of several users post cards and each user answers.

## How it could be done

- Access rules: open `cards`, `guides` and the batch status to the `interact` level. Then
  any signed-in viewer with that level can also mark an answer handled. So a team board
  needs a rule per user path, for example `cards/{self}`, in place of one shared document.
- Identity: the page learns who the viewer is from the platform. The config cannot name
  `me` in the board file, because the board file is the same for every user. `me` goes in
  the user config file of each user, together with the team members.
- Data model: one cards document per writer again, a `for` field on each batch, and a
  card key that names the writer. Git history holds the earlier code for this.
- Assign: the list of people comes from the team members in the user config.

## Open questions

- Whether one user may answer a card that the agent of another user posted.
- Whether the platform can restrict a batch so that only the agent it is for can mark it
  handled.
