---
type: EngineeringRecord
title: "Multi-turn consensus conversations"
description: "Dated decisions, findings and evidence for Multi-turn consensus conversations."
timestamp: 2026-11-14T00:00:00Z
tags: [engineering-records]
record_id: er-087
scope_history_schema: 1
plans:
  - /docs/plans/087_multi-turn-consensus-conversations.md
performance: []
---

# Engineering Record 087: Multi-turn consensus conversations

Plan: [PLAN-087](/docs/plans/087_multi-turn-consensus-conversations.md).

## 2026-11-14 — Starting

**Goal.** Implementation goals and acceptance criteria.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/087_multi-turn-consensus-conversations.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

### 2026-11-14 — Initial coordinator

**[finding]** Separate CLI sessions for Luna, Haiku, DeepSeek and Hydrogen completed a two-round manually coordinated discussion. Hydrogen lost the first message when started in plan mode; a normal session resumed correctly. Provider-reported token usage and billing differ, and even short turns load substantial background context.

**[decision]** Begin with a bounded coordinator and a Claude adapter with built-in tools disabled. Supply explicitly selected source files as bounded context instead of allowing participants to edit the workspace. Further provider adapters must establish enforceable tool restrictions before being enabled. Usage counters reported after a turn are indicators, not advance guarantees of subscription quota or cost.

**[verification]** A live two-round Haiku conversation completed in two separate sessions, saved four attributed turns and reported 43,076 input tokens including cached input; the provider reported an estimated $0.00455. First-round scores exposed an ambiguity in the prompt and are now discarded until other positions are known. The provider's cost estimate is not a subscription charge or remaining quota.

**[finding]** Disabling built-in tools and excluding configured MCP servers is not an OS sandbox; CLI hooks and local provider configuration remain outside this prototype's control. Autonomous repository browsing, mixed-provider execution, per-model budgets and visual replay remain open.

**[verification]** Coordinator Node tests pass and `npm run build:triangular-engine` passes. Repository-wide `triangular docs records check` reports an unrelated stale readiness review in plan 081; the new plan's review was refreshed.

**[decision]** At the owner's direction, participants should be able to investigate code. Enable Claude Read, Glob and Grep, instruct participants never to change files, and record reported tool calls. The tool log is evidence of reported activity, not proof that no other process or hook changed anything.

**[verification]** A live Haiku invocation used Read to inspect this prototype's README. Claude's stream included the tool call, token counts including cached input, and an estimated cost; the stream also showed a startup hook, reinforcing that the CLI is not a complete isolation boundary.

**[verification]** The updated coordinator ran two independent Haiku participants against the README; both Read calls and per-participant totals were saved. Provider totals were 54,473 input tokens (including 37,284 cached), 715 output tokens and an estimated $0.00417; this is not a measured subscription charge. Four coordinator tests passed.

**[decision]** Use one primary directory plus explicitly selected supporting directories, or an empty list for a discussion without repository tools. Æ already associates projects and their workspace folders; use that as future discovery rather than presenting every local repository as context. Repository paths and discovery are local context, not names to copy into public documentation.

**[verification]** A live Claude restricted-mode run read the README in each of two selected repositories; recorded tool calls show both. A second live run with no repositories completed with no file tool calls. Five coordinator tests passed. Automatic Æ project selection and other providers are not yet integrated.

### 2026-11-14 — Shared discussion turns

**[decision]** Keep the independent opening; thereafter deliver new shared turns in order, allow a participant to pass, ask named questions, answer or decline questions addressed to them, and record unresolved questions and latest spoken positions. The final scheduled round requests wrap-up and disallows new questions. Limits may interrupt before everyone has a final turn; readiness does not imply consensus.

**[verification]** Seven coordinator tests pass, including independent openings, sequential visibility, distinct question IDs, unresolved questions, passing, call limits and rejecting another person's question response. Mixed providers, a synthesized outcome and visual replay remain future work.

**[verification]** A bounded live test with two independent Haiku sessions completed four turns without repository access. Both participants asked and answered a named question; the final positions retained a small disagreement. The provider reported 16,268 input tokens, 1,372 output tokens and an estimated $0.00225, which is not a measured subscription charge. The local transcript is `artifacts/consensus-conversation/slice1-live.json`.

**[decision]** Support names-only and model-disclosed participant prompts, recording the chosen mode. Names-only avoids injecting peer model labels; it cannot guarantee anonymity because models, CLI environment, participant names and discussion content can reveal identity. Mixed-model comparisons require additional provider adapters.

**[decision]** Add a separate non-voting facilitator session to summarize common ground, dissent and possible next steps. It shares the discussion's call, elapsed-time and input-token limits, records its own usage, has no repository tools, and leaves the underlying positions intact if skipped or unsuccessful. Its summary is an interpretation, not a developer decision or proof of consensus.

**[verification]** Ten coordinator tests pass. Two small no-repository Haiku discussions, one per identity mode, each completed two independent openings and a separate facilitator summary. The names-only run reported 10,287 input and 2,002 output tokens; the model-disclosed run reported 10,747 input and 1,724 output tokens. All four participants used the same model, so these runs validate the settings, not whether model identity changes a mixed-model discussion.

**[decision]** Use model names alone as the default participant labels, adding a number for duplicate instances of a model. Named mode instead uses only the selected names. Comparing outcomes between identity modes is not a planned test.

**[decision]** For duplicate model instances, replace numeric suffixes with configured aliases in parentheses, such as `gpt-6-luna (Ada)`; unique models retain only their model name. Names-only mode remains available. Add an optional minimum round count so readiness cannot end a run before participants have heard one another, subject to hard limits.

**[verification]** A mixed Codex Luna and Claude Haiku run completed two independent openings and two continued turns in separate sessions, with a four-call limit and no facilitator. It recorded 80,657 input tokens (including cached input) and 1,850 output tokens. Haiku reported an estimated $0.00094384; Codex supplied no cost, so this is a partial figure and not the total charge. Both participants reported agreement (10 and 9); no questions were raised. Transcript: `artifacts/consensus-conversation/mixed-live-2.json` (local, regenerable). This was a short protocol test, not the full research conversation.

**[finding]** Codex uses the CLI's read-only sandbox and permits commands for inspection; its selected repository paths are not a read-confidentiality boundary. The mixed live test did not exercise file access or verify write prevention, and no-repository mode remains unavailable for Codex. Per-model limits, rankings and scene replay remain open.

### 2026-11-14 — Manual capsule replay

**[decision]** The existing debrief scene has an opt-in manual replay mode. A local transcript is selected in the browser and replayed one turn at a time. Pairwise spacing approximates the mean of the available directional agreement scores; the panel separately shows each direction so asymmetry is not hidden. In larger groups, geometry is approximate and cannot guarantee every desired pairwise distance.

**[finding]** Questions and their status appear in the replay panel as their turns are reached. The initial mixed-model test did not raise questions. Floating question cards, live playback, voting, and a final decision workflow remain open; readiness is a participant state, not consensus.

**[verification]** Three headless replay state tests passed, including question reconstruction when stepping backwards and agreement-driven spacing. The library build passed. A browser initially displayed the replay file picker; the demo server restarted during the subsequent library build, so loading a transcript through that page still needs verification if it does not return in this session.

**[verification]** The local mixed-provider transcript was loaded through the browser file picker and the first turn displayed with both capsule participants. The empty replay now explains that a saved JSON must be selected. This test does not establish that the planned live conversation, voting, or floating questions are implemented.

**[finding]** The pre-existing debrief page already drives the engine's viseme and expression controller from recorded audio envelopes. Manual replay previously bypassed it and the initial replay video was silent. Replay now offers optional browser speech using the same engine viseme controller and text-estimated timing; this is approximate and is separate from the recorded-audio video path. Replay participants turn partly toward the camera and each other, and active-speaker enlargement is reduced to seven percent. Spoken audio and visual synchronization still require human review.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
