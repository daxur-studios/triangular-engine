# Haiku main session: working with a Sonnet reviewer and an Opus architect

Start a Haiku session and point it here: "Follow `instructions/haiku-main-session.md`."

This file is the whole protocol. Read it once at the start, then follow it. Keep messages to subagents short and specific.

## Roles

- **You (Haiku 5.5), main session.** Do the work. Read, plan within an approved plan, edit, run acceptance commands, and keep the plan and Engineering Record current. You own the feature from start to finish.
- **Reviewer (Sonnet 5.5), subagent.** Spawned only when an escalation trigger fires or at phase end. Reviews the material you send and returns one verdict. Does not edit files.
- **Architect (Opus 5.5), subagent.** Spawned only when a decision is beyond the plan or the reviewer escalates. Returns one decision. Does not edit files.
- The reviewer can escalate to the architect. You can also go straight to the architect when a trigger below says so.

Spawn subagents with the Agent tool, setting `model` to `sonnet` or `opus`.

## Step 1: choose the mode

- **New feature from scratch:** no plan or Engineering Record exists for it. Check the plan index. Go to Mode A.
- **Resume existing feature:** a plan and Engineering Record exist. Go to Mode B.

If you cannot tell which applies, ask the user. Do not guess.

## Mode A: new feature

1. **Architect once.** Spawn the architect with the brief below, asking for: phases; packets, each with its declared paths, the invariants it must keep, and one acceptance command; the always-review paths; and open decisions. Create the plan and Engineering Record pair with the repository's plan tooling. Record the architect's output in the plan.
2. **Check the plan.** Any packet without an acceptance command is design work. Send it back to the architect. Do not implement it.
3. Run the phases in order with the work loop below.

## Mode B: resume

1. Read the plan, the latest entries of its Engineering Record, and any handover for it. Do not read the rest of the repository.
2. Run `git status --short` (read-only). Note files changed by others. Do not touch them.
3. Find the first phase that is not done. Continue with the work loop.

## Work loop (per packet)

1. Read only the packet's declared paths and its invariants.
2. Implement. Do not commit. Do not run git commands that write. Do not start dev servers. Tests run headless and single-run.
3. Run the packet's acceptance command.
4. Check the changed files against the packet's declared paths.
5. If a trigger below holds, stop and send the packet as described. Otherwise go to the next packet.

## Escalation triggers

You do not judge risk yourself. Use these conditions.

**Send to the reviewer (Sonnet) when any of these hold:**
- acceptance fails twice on the same packet;
- a changed file is outside the packet's declared paths;
- a test file was edited or deleted;
- the packet touches an always-review path (frame conversions, physics step timing, serialization formats, public API), and before any edit to one;
- the first instance of a new pattern that other code will copy.

**Send to the architect (Opus) when any of these hold:**
- the reviewer returns `escalate`;
- the plan is wrong or missing a decision, or two invariants conflict;
- the packet still fails after the reviewer's changes.

Otherwise, do not contact the reviewer or the architect.

## Subagent briefs

Give subagents only the brief and the files it names. Do not give them this conversation.

**Reviewer brief (Sonnet):**

> You are the reviewer. Review only the material below. Do not explore beyond it. Do not edit files.
> Reply with exactly:
> `VERDICT: ok | changes | escalate`
> then at most ten lines of notes.
> Material: packet id and its declared paths; the invariants; the trigger that fired; the acceptance command and its last 30 lines of output; `git diff -- <flagged paths>` (read-only).

**Architect brief (Opus):**

> You are the architect. Decide one question. Do not edit files.
> Reply with exactly:
> `DECISION: <one line>`
> then at most fifteen lines: the reasoning, and any plan change needed.
> Material: the question; the options considered; the relevant part of the plan; the reviewer's notes, if any.

## Phase end

When every packet in a phase is done, send the reviewer one request for the whole phase diff. A good batch is 3 to 8 packets or about 300 to 800 changed lines. Split a larger phase before review.

## Records

- When a phase is done, set its state in the plan's phase table.
- Append dated entries to the Engineering Record: reviewer and architect verdicts, the number of escalations, and the acceptance results. Do not rewrite earlier entries.

## Limits

- Do not commit, and do not run git commands that write.
- Leave changes by others alone, including uncommitted ones.
- Do not start dev servers. Do not run baseline commands for records.
- Do not name private or consumer repositories in public repository files.
- Stop and ask the user when a phase is blocked after an architect decision, when a decision needs the developer, or when acceptance cannot run.

## Credit rule

Spawn a subagent only at a trigger or phase end. Use Grep and Read yourself for lookups. Spawn the architect only for escalation.
