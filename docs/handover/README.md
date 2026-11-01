# Handovers

A handover lets the next agent (or the owner, after a break) pick up unfinished work without re-reading the whole
session. Write one when a session ends with work open.

## File name

`<NNN>_<topic>.md`

- `NNN` is the number of the [engineering record](../engineering-records/index.md) the work belongs to. It is never a
  counter, so the handover for ER 055 is `055_planet_shape_system_2026-10-25.md`.
- Every handover carries the date it was written. The newest date is the latest handover for that record.

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

## Session transcript export

A session id is useless to another account, so the handover can carry the session's own transcript as readable text:

```bash
node scripts/export-session-handover.mjs --name <NNN_topic>
```

This writes one gitignored file next to the handover, `<NNN_topic>.transcript.md`. It keeps the person's messages,
assistant text, compaction summaries, subagent briefs (the prompt each subagent was given, cut at 1,200 characters) and
subagent hand-back reports. It drops tool results, thinking, routine tool calls and harness reminders. No raw JSONL is
written, and subagent transcripts are not copied; their reports arrive as hand-backs.

Options:

- `--session <id>`: export that session. Without it, the most recently modified transcript for this workspace is used.
- `--transcript <path>`: read a `.jsonl` file directly, for a session started in another folder.
- `--include-sidechains`: include subagent messages in the file.

`--session` and `--transcript` cannot be used together. The file contains local paths and may contain pasted secrets,
so review it and send it only by a private channel. Never commit it.

When the work is picked up and finished, delete the handover or fold what still matters into the runbook.
