# Haiku main session: working with an Opus architect and a Sonnet supervisor

Start a Haiku session and point it here: "Follow `instructions/haiku-main-session.md`."

This file is the whole protocol. Read it once at the start, then follow it. Keep messages to sub sessions short and specific.

## Permission mode

Every session in this protocol runs in `bypassPermissions` mode. Not `auto`: `auto` spends more usage on classifier checks, and the owner does not want that.

- Start every sub session with `permission_mode` `bypassPermissions`, or switch it with `mcp__ccd_session_mgmt__set_session_permission_mode` straight after it starts.
- Raising a session to bypass may show the owner an approval card. That is expected: send the switch and let the card show, do not work around it.
- If the main session itself is not in bypass mode, tell the owner to set it in the app. The main session cannot raise its own mode.
- Check the mode with `mcp__ccd_session_mgmt__get_session` after switching.

## Session names

Name every sub session so the owner can tell them apart in the sidebar. Use the role, then the feature slug:

- `ARCHITECT: <feature>`, for example `ARCHITECT: lod-water`
- `SUPERVISOR: <feature>`, for example `SUPERVISOR: lod-water`

Pass the name as the session's `title` (under 60 characters) and as `name` (lowercase, letters, digits and hyphens, up to 24 characters: `architect-lod-water`, `supervisor-lod-water`). Use the same feature slug in the plan and record.

## Roles

- **You (Haiku 5.5), main session.** Do the work. Read, plan within an approved plan, edit, run acceptance commands, and keep the plan and Engineering Record current. You take each task from the reviewer, do it, and report back. You own the feature from start to finish.
- **Architect (Opus 5.5), sub session.** Designs the work. Writes no files. Runs once at the start (the plan), and again only on escalation. Started as a separate session (not an Agent subagent) with `mcp__ccd_session__start_session`, `context` "fresh". Do not pass `model`: a session can only take a model at or below its parent's, so a Haiku main session cannot start an Opus one that way.
- **Reviewer (Sonnet 5.5), sub session, the supervisor.** One persistent sub session for the whole feature. It is started after the architect's plan exists, reads the plan and the Engineering Record itself, and sets the work: it gives you the next task, checks what you report, and says what comes next. It does not edit files. It escalates to the architect when a decision is beyond the plan.

Flow: owner and main session agree the scope, the architect plans it, the main session writes the plan and record, the reviewer sets task 1, the main session does it and reports, the reviewer reviews and sets task 2, and so on until the feature is done.

Start the architect and the reviewer as sub sessions with `mcp__ccd_session__start_session`, `context` "fresh". Do not use an Agent subagent for either. Do not pass `model`. After each session's first message, switch its model with `mcp__ccd_session_mgmt__set_session_model` once the owner has approved the switch: `claude-opus-5-5` for the architect, `claude-sonnet-5-5` for the reviewer.

## Compact before the next message

Every sub session that has already had a message from the main session must be compacted by the owner before the main session sends it another message. This covers the architect and the reviewer.

- The first message after a session starts does not need a compact.
- Before the second or any later message to the same sub session, the main session stops and asks the owner to compact that session. It names the session and says what the next message is for.
- The main session sends nothing to that session until the owner confirms the compact is done.
- The reviewer gets one compact per task cycle. That is intended: after compacting, the reviewer starts from a short context and the messages stay minimal.
- Compacting is the owner's action. The main session cannot compact another session itself.
- The main session never offers "compact" as a choice, button or option. It only asks the owner to compact and waits for the owner to confirm. Do not offer to do it.

## Recommendations from the architect

- Every open decision the architect lists must come with its recommended answer, and a one-line reason, unless the answer genuinely depends on the owner's taste or priorities.
- Technical, maths and coding questions (thresholds, formulas, sizes, algorithms, test limits) are not owner decisions. The architect answers them itself and says how confident it is.
- Anything left for the owner should be stated in plain words, with what each option means for the work. Avoid unexplained jargon.

## Step 1: choose the mode

- **New feature from scratch:** no plan or Engineering Record exists for it. Check the plan index. Go to Mode A.
- **Resume existing feature:** a plan and Engineering Record exist. Go to Mode B.

If you cannot tell which applies, ask the user. Do not guess.

## Mode A: new feature

Mode A has five stages. Do not skip a stage, and do not move to the next one until the owner says so.

**Stage 0: discuss (main session, Haiku).** The owner asks for the feature and points at this file. Discuss scope, open questions, and what the owner wants decided. Start nothing until the owner says the discussion is ready.

**Stage 1: context gathering (sub session, Haiku).**
- Start the sub session with `mcp__ccd_session__start_session`, `context` "fresh", and the brief: the feature, the files to read, and the scope the owner gave. Do not pass `model`; a Haiku session cannot start an Opus one that way.
- The first message is always context gathering. It tells the sub session that it runs on Haiku, that no design work happens until the owner approves a switch to Opus, and that it should read the listed files and report what it found, the open questions, and the decisions it needs from the owner.
- The sub session reports back. It also recommends whether it is ready for Opus planning, or whether more Q&A is needed first, and says why.

**Stage 2: compact (owner's action).**
- When context gathering is done, the main session asks the owner to compact the sub session's conversation so the Opus planning starts from a short context.

**Stage 3: Q&A or Opus (owner's choice).**
- The owner asks more questions in the sub session, or asks the main session to start Opus.
- The main session starts the architect as a sub session when the owner asks for Opus (or reuses the Stage 1 session if the owner agrees). Call `mcp__ccd_session_mgmt__set_session_model` with `model` `claude-opus-5-5` only after the owner approves the switch; the app shows the prompt.
- The planning brief is sent in a new message after the switch. It says the session is now on Opus, that the owner approved the switch, and that planning starts now. It asks for: phases; packets, each with its declared paths, invariants, and one acceptance command (or "design work"); the always-review paths; testing per phase; and open decisions with recommendations.
- Opus returns its plan as text in the session. It does not write the files.

**Stage 4: write the plan, then start the reviewer (main session, Haiku).**
- The main session takes the Opus output and creates the plan and Engineering Record pair with `triangular docs plan new`, then fills them in from the Opus text. This keeps Opus credit low: Opus plans, Haiku writes the files.
- Check the plan. Any packet without an acceptance command is design work; send it back to the architect for a packet with one. Do not implement design-work packets.
- Record the plan's phase table and link both files.
- Start the reviewer (supervisor) as described under Roles, and get the owner's approval for the model switch. Then send the supervisor brief below.

Then run the tasks in order with the supervisor loop below.

## Mode B: resume

1. Read the plan, the latest entries of its Engineering Record, and any handover for it. Do not read the rest of the repository.
2. Run `git status --short` (read-only). Note files changed by others. Do not touch them.
3. If the reviewer session for this feature still exists, ask the owner to compact it before the main session sends a new report. If it does not exist, start one as in Stage 4.
4. Find the first phase that is not done and ask the reviewer for its next task. Continue with the supervisor loop.

## Supervisor loop (reviewer sets the tasks)

A **task** is one batch of packets from one phase: about 3 to 8 packets, or about 300 to 800 changed lines. Split a larger phase into several tasks before starting it.

1. **Supervisor brief (first message, reviewer):** send the plan and Engineering Record paths, and say the reviewer is the supervisor for this feature. Ask it to read both, then reply with `TASK:` and the first task's packet ids, one line each. It reads the files itself; do not paste them.
2. **Do the task.** Work through its packets with the work loop below. Do not start the next task until the reviewer has given it.
3. **Report (after the task, or at a trigger):** send the reviewer one short message with:
   - `DONE:` the packet ids finished, and `OPEN:` any not done;
   - the acceptance result for each packet (last 30 lines of output);
   - `FLAGS:` the trigger that fired, if any, and `git diff -- <flagged paths>` (read-only).
4. **Reviewer reply:** `VERDICT: ok | changes | escalate` and `NEXT:` with the next task's packet ids, or `none` when the phase or feature is done. Then at most ten lines of notes.
5. **Act on the reply.** `ok`: note it, and go to the next task. `changes`: make the changes, rerun acceptance, and report again (after the owner compacts the reviewer). `escalate`: send the architect the escalation (see below).

Before every report after the first, the owner compacts the reviewer (see Compact before the next message).

## Work loop (per packet)

1. Read only the packet's declared paths and its invariants.
2. Implement. Do not commit. Do not run git commands that write. Do not start dev servers. Tests run headless and single-run.
3. Run the packet's acceptance command.
4. Check the changed files against the packet's declared paths.
5. If a trigger below holds, stop the task and report it to the reviewer. Otherwise go to the next packet.

## Escalation triggers

You do not judge risk yourself. Use these conditions.

**Report to the reviewer at once (mid-task) when any of these hold:**
- acceptance fails twice on the same packet;
- a changed file is outside the packet's declared paths;
- a test file was edited or deleted;
- the packet touches an always-review path (frame conversions, physics step timing, serialization formats, public API), and before any edit to one;
- the first instance of a new pattern that other code will copy.

**Send to the architect when any of these hold:**
- the reviewer returns `escalate`;
- the plan is wrong or missing a decision, or two invariants conflict;
- the packet still fails after the reviewer's changes.

When the architect has decided, the main session applies the decision and reports it in the next report to the reviewer. Do not send the decision as a separate message to the reviewer.

Otherwise, do not contact the reviewer or the architect between reports.

## Sub session briefs

Give the reviewer and the architect only the brief and the files it names. Do not give them this conversation.

**Supervisor brief (Sonnet, first message):**

> You are the supervisor for this feature. You set the work and review it. Do not edit files.
> Read only: the plan `<path>` and its Engineering Record `<path>`.
> Reply with exactly:
> `TASK: <packet ids, one line each>`
> then at most ten lines of notes.

**Reviewer report reply (Sonnet, every report after the first):**

> You are the supervisor. Review only the material below. Do not explore beyond it. Do not edit files.
> Reply with exactly:
> `VERDICT: ok | changes | escalate`
> `NEXT: <packet ids> | none`
> then at most ten lines of notes.
> Material: the `DONE`, `OPEN`, acceptance and `FLAGS` parts of the report.

**Architect brief (Opus):**

> You are the architect. Decide one question. Do not edit files.
> Reply with exactly:
> `DECISION: <one line>`
> then at most fifteen lines: the reasoning, and any plan change needed.
> Material: the question; the options considered; the relevant part of the plan; the reviewer's notes, if any.

## Records

- Every plan and Engineering Record pair carries a roles block near the top, in both files, naming three things:
  - **Architect:** the model name and version (for example `claude-opus-5-5`), or the external model or tool if it is not an Anthropic model, plus the session name and date.
  - **Supervisor (reviewer):** the model and session name, and the date it was started.
  - **Worker (main session):** the model and session name, and the date.
  Fill in the architect when the Opus plan is recorded. Fill in the supervisor when it is started. Name the same roles in each decision entry in the Engineering Record. Do not rely on a single shared note: each pair records its own roles.
- When a phase is done, set its state in the plan's phase table.
- Append dated entries to the Engineering Record: reviewer verdicts, the architect's decisions, the number of escalations, and the acceptance results. Do not rewrite earlier entries.

## Browser tests and launch links

- Read `projects/triangular-engine/.agents/skills/triangular-engine-testing/SKILL.md` before adding or changing a browser test suite. The skill is the source for launch links (`buildTestLaunchUrl`, the `testAutoStart=1` parameter) and for result handoff.
- When a packet produces something the owner should run in a browser, give the owner a launch URL that starts the test on its own (`testSuite`, `testVersion`, `testProfile`, `testRepetitions=1`, `testAutoStart=1`), on the demo app at `http://triangular-demo.localhost:4200`. Do not give dropdown instructions.
- The owner's own Chrome is the GPU run: its WebGPU adapter is the one for performance numbers. The built-in browser pane may pick a different adapter, and it stalls when hidden (no animation frames), so its runs are functional checks only.
- Record each runnable link in the plan or Engineering Record's `performance` array, and keep earlier links as history.

## Limits

- Do not commit, and do not run git commands that write.
- Leave changes by others alone, including uncommitted ones.
- Do not start dev servers. Do not run baseline commands for records.
- Do not name private or consumer repositories in public repository files.
- Stop and ask the user when a phase is blocked after an architect decision, when a decision needs the developer, or when acceptance cannot run.

## Credit rule

Message the reviewer only at a task report or a trigger. Message the architect only for escalation. Use Grep and Read yourself for lookups.
