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

**[decision]** Replay participants move at a steady pace using the capsule walk animation, face the direction of travel, and return to idle on arrival. The motion remains a visual approximation of the saved agreement layout.

**[decision]** Replay shows questions as floating cards with their sender, recipient and recorded open, answered or declined status. Rewinding reconstructs the earlier state. An explicitly illustrative fixture exercises these states without additional provider calls; the original mixed-provider transcript raised no questions.

**[verification]** Five headless replay tests passed, and a headless browser checked question appearance, responses and rewind against the illustrative fixture. Visual acceptance remains with the owner.

**[decision]** The illustrative question replay opens from a direct sample URL with the first questions already visible; selecting a file is optional for other transcripts.

### 2026-11-14 — Discussion value and delivery priorities

**[decision]** The primary goal is useful multi-model, multi-provider discussion that reveals blind spots, tests assumptions and preserves meaningful disagreement. Evaluate the discussion and its actionable outcome before investing further in visual polish or voting mechanics.

**[decision]** For future reviews, the owner prefers agents to generate and present a video using the share-media-in-chat skill standards. Replay and visuals support the discussion and are secondary; interactive replay is optional, not the expected delivery path. Automated video delivery for arbitrary conversations remains to be established.

### 2026-11-14 — Four-provider self-review spike

**[verification]** A bounded manual bridge ran independent openings and one continued turn each in separate Luna, Haiku, DeepSeek V4.1 Flash and Hydrogen Low CLI sessions, with eight calls maximum and 90 seconds per call. Each later turn saw the other openings and preceding follow-ups, not future replies. No repository inspection was requested. This used a local spike rather than the production coordinator or structured question/agreement protocol; its transcript is `artifacts/consensus-conversation/self-review-results.json`.

**[finding]** Luna and Haiku challenged DeepSeek's proposed two-of-twelve success threshold; DeepSeek withdrew it. Hydrogen challenged the use of planted errors in half the test questions as insufficient for measuring organic blind spots. These are observable interactions, but this one discussion has no independent-answer-plus-summary control and does not establish an improvement in correctness. The participants proposed a blinded, budget-matched comparison on checkable questions, counting errors caught and introduced and preserving dissent. The appropriate question set and planted-error proportion remain open.

**[verification]** Providers reported approximately 64,910 Luna, 8,398 Haiku, 25,221 DeepSeek and 31,291 Hydrogen input tokens across turns (129,820 total, including cached input where reported). Provider counters and reasoning token treatment differ; costs and subscription usage are not fully known. This spike did not produce a video.

### 2026-11-14 — DeepSeek and Hydrogen coordinator adapters

**[decision]** Integrate OpenCode DeepSeek V4.1 Flash and Antigravity Hydrogen Low into the bounded coordinator. Both resume individual CLI sessions, retain read/search tools, capture available tool events and usage, and apply per-run restrictions to writes and commands. Deny rules and plan mode do not isolate hooks or other processes, and repository paths are not a confidentiality boundary.

**[verification]** In a scratch directory both providers read a test file. Hydrogen attempted `write_file` and received an explicit deny; DeepSeek reported no edit tool available and did not attempt a write. Both files remained unchanged. This probes one route rather than proving complete write prevention. Fourteen coordinator tests and the library build passed.

**[finding]** The first real four-provider coordinator run stopped after six accepted turns when DeepSeek supplied an invalid question response; the coordinator preserved prior turns and counted the rejected call's usage. Prompts now specify which questions may be resolved, and subsequent invalid replies are stored as rejected turns for diagnosis. A subsequent two-provider run with DeepSeek and Hydrogen completed four turns, each resuming its own session; reported input was 50,659 tokens including cached input. A complete four-provider run still requires verification.

**[finding]** The next four-provider run exposed a parser bug: fenced JSON followed by a newline was rejected. A regression test covers the fix. The final four-provider run completed eight turns across two rounds with reported input of 138,348 tokens. Each adapter checked that continuation used the original session. Full transcripts are local under `artifacts/consensus-conversation/`.

**[verification]** Across both scratch-file probes, the completed two-provider run, two failed four-provider attempts and the completed four-provider run, providers reported 402,630 input tokens including cached input; failed or timed-out usage may be missing, and costs remain partial. Fifteen coordinator tests passed after the fixes. These checks demonstrate continuation and protocol behavior, not the quality or value of the models' advice.

### 2026-11-14 — Designing a JSDoc experiment

**[finding]** A four-model discussion considered no comments, ad hoc comments, a purpose/value and update policy, and stale or misleading comments. Follow-ups favored a small first comparison using the same real code, tasks and tests with no JSDoc versus purpose/why comments; independently authored historical rationale and blinded review would reduce bias. Measure task correctness, time, token usage and recovery of non-obvious rationale. Stale comments should be tested explicitly: most suggested a separate stress run, while DeepSeek favored folding the risk into the assessment if budget permits. This is an experiment proposal, not a verified policy or evidence that JSDoc helps.

**[verification]** The coordinator stopped after two accepted openings when DeepSeek returned malformed JSON; its original rejected answer was retained. A local recovery corrected one misplaced JSON escape and used five further calls, giving eight calls total and 116,263 reported input tokens including cached input. Hydrogen's follow-up resumed its session; the other three used fresh sessions supplied with their own and their peers' openings, so this was not an uninterrupted native coordinator run. The local records are `artifacts/consensus-conversation/jsdoc-experiment.json` and `artifacts/consensus-conversation/jsdoc-experiment-recovered.json`. Per-model billing and total costs remain unavailable.

### 2026-11-14 — Future one-time guest input

**[decision]** Park an optional guest role until the core discussion is reliable. A guest is a role independent of model tier: one or more configurable models can each receive the question, relevant evidence and conversation context and contribute once, without repository tools or further back-and-forth. Main participants may consider the input in their normal remaining turns. Configure separate guest usage limits; identify missing evidence and avoid presenting unverified claims as repository facts. Relative model tiers and availability depend on the chosen conversation and provider, not a fixed hierarchy. Do not test expensive guests yet.

### 2026-11-14 — Bounded response correction

**[action]** Save invalid participant replies and request one correction in the same provider session. Corrections share the existing call, elapsed-time and reported token limits; rejected replies remain separate from accepted model turns. An exhausted limit stops the run, and a second invalid reply fails with the partial discussion preserved.

**[verification]** Coordinator tests exercise session reuse, rejected-output persistence, usage accounting and call/token limits with simulated providers; real CLI correction is not yet verified.

### 2026-11-14 — Response quality visibility

**[action]** Added a minimal response-format example and a per-model response-quality summary to saved runs and the CLI. Rejected replies, correction calls and corrected turns are counted separately, including when a limit prevents a retry. Original invalid responses and validation errors remain available for prompt review.

**[verification]** Coordinator tests cover example validity, correction accounting, repeated failures and limits using simulated providers. The example's effect on live model reliability has not been measured.

### 2026-11-14 — CLI schema output experiment

**[action]** Added opt-in participant response schemas for Codex, Claude and Antigravity, retaining semantic validation and bounded corrections. OpenCode's run CLI has no schema flag; its existing prompt-based output remains unchanged. Facilitator output is unchanged. Provider-internal schema retries are not visible in coordinator correction counts.

**[verification]** One bounded live run completed two turns each for Luna, Haiku and Hydrogen using resumed sessions with no coordinator rejections. It reported 118,755 input and 2,182 output tokens; the 100,000 input threshold was exceeded by the last in-flight call. The mixed cost is incomplete. One run does not measure reliability improvement; OpenCode schema output was not tested. Coordinator tests and the library build passed.

### 2026-11-15 — CLI session compaction spike

**[verification]** A small live session per provider tested compaction followed by a same-session recall question. Codex app-server `thread/compact/start` emitted a completed `contextCompaction` item; Claude `-p /compact` emitted `compact_result: success` and a manual `compact_boundary`; OpenCode 1.19.5's local `POST /session/{id}/summarize` returned success and its session export contained a compaction marker and generated summary. Antigravity `-p /compact` with slash expansion enabled reported the expanded system command and a completed checkpoint; this is indirect evidence of applied compaction, not an inspected summary. All four then recalled the two seeded facts. The OpenCode `run --command compact` attempt timed out and is not verified. These are short-session checks, not evidence of faithful preservation of a research discussion.

**[finding]** The coordinator does not yet invoke or account for compaction. In particular, Claude's compaction result had zero top-level usage while its per-model usage recorded compaction tokens and cost; usage limits need provider-specific treatment. Antigravity currently disables slash expansion in coordinator turns, so a dedicated compaction path would be needed. Local spike output is under `artifacts/consensus-conversation/` and can contain session details.

### 2026-11-15 — Native Claude compaction setting and visibility

**[action]** Added optional `claudeAutoCompactWindowTokens` for Claude's native `--autocompact` window setting on every participant invocation. A completed `compact_boundary` from that session is saved in the transcript, including its trigger and reported before/after sizes; a start status is not treated as success. The shared transcript remains intact. Other providers' context-size reporting and coordinator control remain unverified and were not inferred from aggregate input usage.

**[verification]** Coordinator tests cover event parsing, session matching, recording across a rejected reply, option propagation and configuration limits. A short live Haiku invocation accepted the setting but was too small to trigger automatic compaction. The earlier manual-compaction spike verified Claude's real boundary event; automatic triggering through the coordinator and compaction usage accounting remain unverified.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
