# Handovers

A handover lets the next agent (or the owner, after a break) pick up unfinished work without re-reading the whole
session. Write one when a session ends with work open.

## File name

`<NNN>_<topic>.md`

- `NNN_topic` is the stem of the [runbook](../runbook/index.md) entry the work belongs to, e.g.
  `055_planet_shape_system.md`. A shorter topic is fine when the session covered one part of it.
- A second handover on the same topic adds a date: `055_planet_shape_system_2026-10-25.md`.

## Not committed

Numbered handovers (`<NNN>_*.md`) are gitignored (`/docs/handover/[0-9]*.md` in `.gitignore`) because they contain
local file paths, session ids and transcript paths. They live only in the working tree of the machine that wrote
them. Only this README is tracked, so anything that must survive beyond the working tree goes into the runbook, not
the handover.

## Contents (keep it to one screen where you can)

1. **Header:** date, agent and model, and the session's local id and transcript path, plus the sessions and subagents it
   started, so the next agent can search a transcript for detail.
2. **Goal:** what the owner asked for, in one or two lines.
3. **State:** what is done and verified, and how (commands run, results).
4. **Open:** what is not done, known failures, and decisions waiting on the owner.
5. **Next steps:** in order, and who does each (owner, agent).
6. **Files:** what was changed, and whether it is committed, staged, unstaged or untracked.

Facts only; link to code, docs, plans and runbooks rather than repeating them. This is a public repo: the
[AGENTS.md](../../AGENTS.md) rules apply, so no private or consumer app names or paths (write "a consumer app") and no
process names from result files.

When the work is picked up and finished, delete the handover or fold what still matters into the runbook.
