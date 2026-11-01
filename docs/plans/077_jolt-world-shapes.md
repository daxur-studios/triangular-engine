---
type: Plan
title: "Jolt physics for flat, sphere and cylinder worlds"
description: "Implementation goals and acceptance criteria."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/077_jolt-world-shapes.md
map_schema: 1
document_id: plan-077
initiative_id: "jolt-world-shapes"
performance: []
---

# Plan 077: Jolt physics for flat, sphere and cylinder worlds

Status: **planned**. Evidence and decisions: [ER 077](/docs/engineering-records/077_jolt-world-shapes.md).

<!-- tri:scope -->

## Intended outcome

The Jolt entry point (`triangular-engine/jolt`) runs correctly and performantly in three world shapes: a flat infinite world, a 3D sphere, and the inside of a cylinder. Physics is simulated only near the vessels. Jolt stays single precision (jolt-physics 1.0.1); correctness at large distance comes from rebasing the world origin, not from a different build.

Out of scope: changing any consumer app; a double-precision build (open question Q9); the vehicles' gravity path (open question Q7).

## Phases and acceptance

- **measure** — Measure precision and cost with the `jolt-perf` browser suite (demo-app `/jolt-perf`, suite `jolt-perf` v1, 6 cases). Acceptance: a clean `headless-hardware` run with the GPU adapter recorded; budgets are set only after that run; no baseline is recorded without the developer's confirmation.
- **rebase-helper** — Add `float32UlpAt` and `JoltFloatingOrigin` in `jolt/origin/`, shifting every registered body on a core `FloatingOrigin` rebase. Acceptance: a body at 1e5 + 0.0625 reads back 0.0625 after a rebase; specs and the library build pass.
  - **Done (2026-11-01).** Evidence: origin specs 10 of 10 pass; all Jolt specs 20 of 20 pass; library build exit 0 (agent-reported); spec typecheck 0 errors. The `angular.json` `triangular-engine` test target gained `"externalDependencies": ["module", "node:module"]` because no Jolt spec could bundle without it.
- **gravity-fields** — Add the pure `sphereGravityField` and `cylinderGravityField` functions and the `JoltGravityField` type, then `JoltPerBodyGravity` with an additive optional `gravityFactor` input on `JoltRigidBodyComponent` (default 1). Acceptance: a box in a sphere field falls within 5% of t^2/2 over 120 substeps; the flat default is unchanged.
- **distance-bubble** — Add `JoltDistanceBubble` in deactivate mode, only if the measure phase shows a cost. Acceptance: decided after measuring 1,000 dynamic boxes; built only if that measurement shows a cost.
- **docs-drift** — Correct three documentation drifts: the Jolt skill's section 7 names `contactAdded$`, which does not exist; the Jolt skill's section 4 prints a `typeof` check that proves nothing about precision; the Jolt README line 3 says "high-precision" for a single-precision build. Acceptance: those three lines are corrected. Starts only after the developer's go-ahead.

## Relationships

- **related-to**: [Plan 075: Claude-specific coding approach](/docs/plans/075_claude-coding-approach.md)
- **related-to**: [Jolt entry point README](/projects/triangular-engine/jolt/README.md)

<!-- /tri:scope -->

## Current phase status

| Phase           | State       |
| --------------- | ----------- |
| measure         | in_progress |
| rebase-helper   | done        |
| gravity-fields  | blocked     |
| distance-bubble | planned     |
| docs-drift      | planned     |

<!-- tri:review version="1" scope-hash="ed3cbbbfebb32097dbf24678463e5b0d00adbe28ba6ff0a8302762b622a979a6" reviewed="2026-11-01" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="gravity-fields" blocks="gravity-fields" state="open" -->

- [ ] Q1. Cylinder gravity direction: (a) toward the wall, radially outward (proposed), or (b) toward the axis?
  - Why it matters: the two readings pull bodies in opposite directions inside the cylinder, so the field function and every test built on it depend on the answer.
  - Next action: the developer decides. The `gravity-fields` phase is blocked until this is answered.
    <!-- /tri:item -->
    <!-- tri:item id="Q2" kind="intent" applies-to="gravity-fields" blocks="gravity-fields" state="open" -->

- [ ] Q2. Sphere worlds: (a) outside the sphere only (proposed), or (b) also inside a hollow sphere?
  - Why it matters: the inside of a hollow sphere needs a different field function from the outside, so option (b) adds scope to `sphereGravityField`.
  - Next action: the developer decides. The `gravity-fields` phase is blocked until this is answered.
    <!-- /tri:item -->
    <!-- tri:item id="Q3" kind="intent" applies-to="distance-bubble" blocks="distance-bubble" state="open" -->

- [ ] Q3. Bubble mechanism: (a) deactivate only, (b) remove and re-add, or (c) a non-colliding object layer?
  - Why it matters: each option costs something different when a body leaves and re-enters the bubble, and each keeps or loses body state in a different way.
  - Next action: the developer decides, using the measure phase results where available.
    <!-- /tri:item -->
    <!-- tri:item id="Q4" kind="intent" applies-to="distance-bubble" blocks="distance-bubble" state="open" -->

- [ ] Q4. Bubble scope: (a) dynamic bodies only, or (b) also static terrain and scatter residency?
  - Why it matters: option (b) changes which systems the bubble must coordinate with, and the cost it can save.
  - Next action: the developer decides.
    <!-- /tri:item -->
    <!-- tri:item id="Q5" kind="intent" applies-to="distance-bubble" blocks="distance-bubble" state="open" -->

- [ ] Q5. One Jolt world with activation, or one Jolt world per bubble?
  - Why it matters: a single world keeps one broadphase and simple cross-bubble contacts; separate worlds isolate cost but make interaction between bubbles harder.
  - Next action: the developer decides.
    <!-- /tri:item -->
    <!-- tri:item id="Q6" kind="intent" applies-to="rebase-helper" blocks="none" state="open" -->

- [ ] Q6. Rebase threshold: (a) 10,000 m, float32 spacing 0.98 mm (proposed); (b) 1,000 m, spacing 0.061 mm; or (c) 100,000 m, spacing 7.8 mm, which is not advised.
  - Why it matters: a lower threshold keeps precision finer but rebases more often; a higher one rebases less but loses millimetres of precision.
  - Next action: the developer decides. The proposed value is used only as the default constant.
    <!-- /tri:item -->
    <!-- tri:item id="Q7" kind="intent" applies-to="gravity-fields" blocks="none" state="open" -->

- [ ] Q7. Vehicles: (a) keep `OverrideGravity` on the app path, or (b) route vehicles through the new gravity hook?
  - Why it matters: option (b) gives one gravity path for all bodies, but changes how the vehicle code is driven.
  - Next action: the developer decides.
    <!-- /tri:item -->
    <!-- tri:item id="Q8" kind="intent" applies-to="rebase-helper" blocks="none" state="resolved" -->

- [x] Q8. Sequencing: rebase helper first, or measure first?
  - Why it matters: the order decides whether the cost of the bubble is known before the helper is written.
  - Next action: none; the developer has chosen.
  - Resolution: the developer chose the rebase helper first on 2026-11-01. The measuring pass follows in the order of work in the Engineering Record.
    <!-- /tri:item -->
    <!-- tri:item id="Q9" kind="intent" applies-to="measure,rebase-helper" blocks="none" state="open" -->

- [ ] Q9. Build precision: (a) accept single precision with rebasing (proposed), or (b) test a double-precision build (`DOUBLE_PRECISION=ON`)?
  - Why it matters: a double-precision build could remove much of the rebasing work; its speed and memory cost is not measured here.
  - Next action: the developer decides. Option (b) would require a measuring run before any decision.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
