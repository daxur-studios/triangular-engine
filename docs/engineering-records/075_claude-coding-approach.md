---
type: EngineeringRecord
title: "Claude-specific coding approach: Haiku builds, Opus decides"
description: "Dated decisions, findings and evidence for Claude-specific coding approach: Haiku builds, Opus decides."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record_id: er-075
scope_history_schema: 1
plans:
  - /docs/plans/075_claude-coding-approach.md
performance: []
---

# Engineering Record 075: Claude-specific coding approach: Haiku builds, Opus decides

Plan: [PLAN-075](/docs/plans/075_claude-coding-approach.md).

## 2026-10-31: The approach, as first used on Plan 059 (G6)

**Goal.** Build large features at a usage cost that fits the developer's limits, without losing quality on the parts that need it.

**Roles.**
- **Haiku 5.5, one agent per unit.** Implements and runs headless tests and perf runs. Does not design, choose between options, or edit docs.
- **Main session.** Plans the units, writes the briefs, reviews once per wave (diff of the critical files, the test tables, the build), writes the docs.
- **Opus 5.5, one-shot subagent.** Receives a packet, answers, ends. It is told not to use tools; that is an instruction, not a block. It never searches files.

**What "tight brief" means: precise, not short.** A brief is as long as it needs to be so that the agent has nothing to decide. The cap applies to the report coming back (about 30 lines), not to the brief. A one-line "do this complex thing" brief makes the agent invent design, and the review then finds the invented parts.

A brief states:
1. The goal, and why (one paragraph), with the plan or record section it implements.
2. The decisions already made, as rules, and the options that are rejected, with the reason.
3. The exact files and symbols to touch, and the files and areas that are off limits.
4. Public signatures that must not change.
5. Numeric acceptance (for example packs at most 80 of 835 frames; median under 2 ms) and the exact commands that measure it.
6. How to treat a missed target: report the measured numbers; never loosen an assertion, or change a policy, accuracy or visibility setting, to make it pass.
7. A stop rule: if a choice is not covered, stop and report it as a question with the options; do not pick one.
8. Standing constraints: no commits, no git index changes, headless non-watching tests only, no dev server, no doc edits.
9. The report format: a before/after table, the deviations from the brief (each flagged), and what is unsure.

**Opus gates.** (1) Before a family of units: define the critical parts and what "correct" means for each. (2) After a wave: judge the evidence tables and chosen excerpts, not the code. (3) A design fork where Haiku or the main session would be guessing. Packet: the question, the constraints, the evidence and chosen excerpts, about 3k tokens. Answer: about 40 lines, as decisions with reasons. Decisions go in a decision log; the next call starts cold from the log.

**Review rules and cost levers.**
- The main session reads the critical files of a wave, not every diff; Haiku produces the summaries and tables.
- Start a fresh session at wave boundaries, with a short handover, instead of letting one session grow and compact.
- Sub-sessions are not used for Opus: they are persistent and re-read their growing context each turn.
- Prefer a measuring unit before a fixing unit when the cause is a guess.

**Lessons from the first use (Plan 059, G6d to G6i).**
- Haiku delivered well-scoped units (pole fan, metric, material, components, tests). Review caught a false statement in test-page wording, a compile error caused by the main session, and a wrong planet radius in a brief.
- A diagnosis written into a brief can be wrong. G6h found the camera was only part of the cause of the per-frame repack. State a diagnosis as a hypothesis and let the agent measure.
- An agent that cannot meet a target must say so. G6h left two assertions failing and reported the numbers; that is the behaviour to keep.
- Test traps worth listing in a brief: read a mesh back through `fragmentNode`, not `colorNode`; give the first GPU draw a long timeout.

**Open decisions and assumptions.** See the scoped review in [the plan](/docs/plans/075_claude-coding-approach.md).

**Checks.** `npm run triangular -- docs records check` after editing. No product code changed.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
