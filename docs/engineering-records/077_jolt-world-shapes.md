---
type: EngineeringRecord
title: "Jolt physics for flat, sphere and cylinder worlds"
description: "Dated decisions, findings and evidence for Jolt physics for flat, sphere and cylinder worlds."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record_id: er-077
scope_history_schema: 1
plans:
  - /docs/plans/077_jolt-world-shapes.md
performance: []
---

# Engineering Record 077: Jolt physics for flat, sphere and cylinder worlds

Plan: [PLAN-077](/docs/plans/077_jolt-world-shapes.md).

## 2026-11-01: Findings, decisions and open questions

**Goal.** Run the Jolt entry point correctly and performantly in a flat infinite world, a 3D sphere and the inside of a cylinder, simulating physics only near the vessels. Jolt stays single precision (jolt-physics 1.0.1); correctness at distance comes from rebasing. The approach follows [Plan 075](/docs/plans/075_claude-coding-approach.md). The plan's scoped review holds the open questions.

**Findings.**
1. **Precision.** Saved run `artifacts/test-runs/jolt-perf@v1/2026-11-01T11-24-07-910Z_visible-browser_455b356b-e3b0c442.json` has `precisionVerdict: "single"`. The static probe at 1e7 + 0.125 reads back with an error of -0.125 m. Float32 spacing at 1e7 is 1 m; at planet radius (6.371e6 m) it is 0.5 m. The summary's "0.00 m" is a median over five probes and hid this error.
2. **Cost (indicative only).** One repetition, GPU adapter unrecorded, readings quantised to 0.05 to 0.1 ms. Physics per frame, median: 1 box 0.00 ms; 10 boxes 0.10 ms; 100 boxes 0.20 ms (0.30 ms in the earlier run). Frame about 6.1 ms. A static 64x64 mesh patch, create plus destroy, took 11.1 ms in the later run and 17.4 ms in the earlier run, against a 6 ms frame. Investigate before streaming cylinder walls.
3. **Existing code facts.** Gravity is one world value on `JoltPhysicsComponent`. `JoltRigidBodyComponent` owns and removes its body and has no gravity input. The core `FloatingOrigin` exists, but Jolt had no helper that shifts bodies. Sleeping bodies ignore `AddForce`.

**Decisions.**
- The rebase helper comes first. The developer chose it on 2026-11-01 (plan question Q8, resolved).
- Every other choice is an open question in the plan's scoped review (Q1 to Q7 and Q9). None is decided here.

**Order of work.**
1. `float32UlpAt` and the pure gravity field functions.
2. The three documentation drifts, after the developer's go-ahead.
3. `JoltFloatingOrigin`.
4. The measuring pass: 1,000 dynamic boxes; 100 boxes with gravity; far rebase at 1e5 and 1e6 m; `headless-hardware` profile with the GPU recorded.
5. `JoltPerBodyGravity`.
6. `JoltDistanceBubble`, only if step 4 shows a cost.

Note on step 1: the pure gravity field functions sit in a phase whose status is `blocked` until Q1 and Q2 are answered. Whether the pure functions may proceed before those answers is not yet decided; it is a sequencing question for the developer.

**Risks.**
- Silent wrong positions without rebasing: a body far from the origin reads back with metre-scale error and no warning.
- Sleep versus forces: sleeping bodies ignore `AddForce`, so a per-body gravity change may not reach a sleeping body.
- Two gravity paths (world gravity and per-body gravity) must agree.
- Streamed cylinder walls cost 11 to 17 ms per patch in the measurements above, which would exceed the frame budget.

**Checks.** `npm run triangular -- docs records check`: first run failed (plan review stale; relation lines had trailing text). After the plan's relation lines were fixed and `docs records review docs/plans/077_jolt-world-shapes.md --reviewer agent` refreshed the scope fingerprint, the check passed: "OK: 13 mapped and 22 legacy plan(s)". The refresh records the agent's review, not developer approval. No code, README, CHANGELOG or skill was changed.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## 2026-11-01: Rebase helper (`rebase-helper`) done

**Result.** `float32UlpAt`, `JoltFloatingOrigin` and `IJoltOriginOptions` are in `projects/triangular-engine/jolt/origin/` and exported from `triangular-engine/jolt`. Evidence: origin specs 10 of 10 pass; all Jolt specs 20 of 20 pass; library build exit 0 (agent-reported); spec typecheck 0 errors.

**Test configuration.** The `angular.json` `triangular-engine` test target gained `"externalDependencies": ["module", "node:module"]`, because no Jolt spec could bundle without it.

**Caveats.**
1. Callers must `track` bodies that are not in `JoltPhysicsService.bodies$` (for example static terrain colliders). Untracked bodies are not shifted by a rebase.
2. The `bodies.includes` check that skips tracked bodies already in `bodies$` is linear per tracked body. It is unmeasured at 1,000 or more bodies, and belongs to the measuring pass.

**Follow-up.** `projects/demo-app/src/app/pages/jolt-perf/jolt-perf-math.ts` keeps its own duplicate `float32Ulp`. Re-point it to `float32UlpAt` in a later change.

**Still open.** The measuring pass (step 4 of the order of work), the `gravity-fields` phase (blocked on Q1 and Q2) and Q6 (rebase threshold) are unchanged. The 10,000 m default is the core `FloatingOrigin` default and is not a decision on Q6.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
