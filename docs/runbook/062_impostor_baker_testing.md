---
type: Runbook
title: Impostor Baker Testing
description: Planning findings and implementation evidence for reusable tests on the octahedral impostor baker page.
timestamp: 2026-10-25T00:00:00Z
tags: [impostor, testing, performance, demo]
plans: [/docs/plans/062_impostor_baker_testing.md]
performance: []
---

# Runbook 062: Impostor Baker Testing

Plan: [Plan 062](/docs/plans/062_impostor_baker_testing.md).

## 2026-10-25 — Planning inspection

### Findings

- The demo page already owns the real actions needed for scenarios: `rebake`, projection and atlas-size setters, forest count/spread setters, compression controls, and public renderer/engine state.
- The page currently creates the source tree and performs a bake in its constructor. `bake()` synchronously calls `createOctahedralImpostorAtlas`, creates the impostor and previews, and rebuilds the forest. `compressAtlas()` is asynchronous and its result includes compression duration and size statistics.
- The test entry provides a standalone runner, scenario/result contracts, URL helpers, named CPU spans, and page-owned adapter hooks. It does not measure a page's renderer or divide an API call into internal stages automatically.
- The demo already has a test proxy configuration and multiple `<tri-test-runner>` integrations to use as local examples.
- The page's forest placement uses `Math.random()`, so exact placement is not repeatable today. Tests that compare appearance or transforms need a deterministic forest seed or must assert only stable aggregate properties.
- `projects/triangular-engine/impostor/README.md` says only hemispherical projection is implemented, while the demo exposes spherical mode and the atlas implementation has a spherical direction branch. Verify intended behavior and reconcile the public docs as part of implementation.
- The repository has unrelated pre-existing working-tree changes, including edits under `projects/triangular-engine/testing/`; preserve them while implementing this plan.

### Decisions

- Integrate the reusable runner in the existing page rather than creating a separate test page.
- Keep scenarios and adapter code in page-local test files, with settings represented as plain serializable data and calls delegated to the page's real action methods.
- Start with coarse, attributable page-stage timings and functional checks. Internal per-view GPU timings would require an additional renderer/query instrumentation design and are outside the first slice.
- Keep performance conclusions diagnostic until a controlled visible run, same-mode baseline or explicit budgets are available.

### Open

- Decide whether the first release should include deterministic forest seeding, or whether initial checks should avoid asserting forest placement.
- Confirm the renderer's available GPU timing support on this page. The current page requests the default engine renderer and has no explicit GPU timing option.
- Choose the smallest useful default scenario matrix before adding the most expensive atlas and instance counts.
