---
type: Runbook
title: "Test Cost Breakdown and Budget View"
description: "Dated decisions, findings and evidence for Test Cost Breakdown and Budget View."
timestamp: 2026-10-26T00:00:00Z
tags: [engineering-records]
record_id: er-067
scope_history_schema: 1
plans:
  - /docs/plans/067_test-cost-breakdown.md
performance: []
---

# Engineering Record 067: Test Cost Breakdown and Budget View

Plan: [PLAN-067](/docs/plans/067_test-cost-breakdown.md).

## 2026-10-26 — Proposal written

**Goal.** Let the owner judge what each spike costs beyond frame time (GPU ms, CPU ms, triangles, draw calls, GPU
memory) and whether terrain, a planet surface material, sky and clouds would fit together. Proposal only; nothing
is built and no baseline is confirmed. Prompted by the LOD surface lab (Plan 059): about 1.57 M triangles in 2 draw
calls and a 0.2 ms scene pass on an RTX 3080, against the step 3b terrain budget proposal (1.5 ms GPU, 0.5 ms CPU,
1 M triangles, 8 draw calls, at least 8 px per triangle, 64 MB of height textures).

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/067_test-cost-breakdown.md):
margin on summed times (Q1), how GPU memory is accounted (Q2), budgets per machine class (Q3), sky and cloud sources (Q4).

**Checks.** Survey only: `npm run test:summary '--' --suite lod-surface-baseline --last 1` and
`... --suite lod-surface-terrain --last 1`, then field names (not values) listed from one saved result of each suite.
No test was run; no code changed.

## Survey: cost fields in saved results (lod suites)

Read 2026-10-26 from the newest saved result of each suite (`lod-surface-baseline` v4 headless-hardware,
`lod-surface-terrain` v2 visible-browser). Values below are examples from the summary, not accepted numbers.

| Resource | Present today | Where it lives | Gap |
| --- | --- | --- | --- |
| GPU ms | `gpuScenePass`, `gpuOutputPass` (ms, median/p95/max); about 0.20 / 0.05 ms in the baseline suite, 0.14 / 0.05 ms in terrain v2 | metrics, so also in the index line | Per pass, not per system: a pass is shared by every mesh in it. `details.gpuWholeRenderMedianMs` and `gpuPassTotalMedianMs` are only in the full JSON. |
| CPU ms | `selectionCpu` (ms), `frameInterval` (ms); `details.cpuMedianMs` / `cpuP95Ms` for the frame | selection and interval are metrics; frame CPU is in `details` | Frame CPU split into submit, selection and upload is not a metric. Selection CPU has a 0.1 ms timer step, so most medians read 0.00. |
| Triangles | `surfaceTriangles` (count), for example 1,576,960 in baseline v4 | metric | `details.rendererTriangles` (what the renderer counted) is only in `details`, so the index line lacks it. |
| Draw calls | `details.drawCalls` | `details` only | Not a metric, so not in the index line or the results page. |
| GPU MB | `textureMB` (MB), terrain suite only: 25.2 MB (v1), 4.2 MB (v2) | metric | Only the baked height textures. No buffer MB (instance, index, vertex), no per-frame upload bytes, no total per system. `uploadMs` and `bakeMs` are times. |
| Whole-process VRAM | The case `machine` block samples `nvidia-smi` GPU readings, `cpuPct` and `freeRamMiB` | `machine` block in the full result | Covers the whole browser and other GPU users, so it cannot split systems; use only as a labelled cross-check. |

Other facts that shape the design:

- The index line keeps `{ n, min, med, p95, max }` per metric and failed checks, not `details`. A resource that is
  not a metric cannot be shown without opening the full JSON, so the `fields` phase promotes `drawCalls` and
  `rendererTriangles` to metrics (or adds them to the index) rather than making the page open every file.
- Most saved runs are `STALE` against the current tree, one baseline run is `inconclusive` (headless hardware not
  independently verified), and terrain v3 failed with "Lab not settled after 60 s: no frames rendered". The view must
  show the run's verdicts, profile, adapter and stale flag next to a segment, and take the newest valid run, not the
  newest run.
- The terrain suite's scene pass (0.14 ms) is lower than the baseline suite's (0.20 ms) at similar triangle counts;
  the two measure different scenes, so this is not a cost of terrain. Per-system GPU time needs the with/without
  comparison the combined suite provides (a scene pass is shared; see the testing guide's "Passes, not meshes").
- Not surveyed: the atmosphere and cloud suites (Q4).

## Design choices behind the proposal

- **Bars with segments, not a pie.** Five different units cannot share one pie; per-resource bars against a budget
  line show both who uses the budget and how much is left.
- **Estimate, labelled.** Counts and memory add almost linearly. GPU time does not, because of shared bandwidth,
  overdraw and occlusion, so the sum is shown as an estimate and compared with the measured combined case.
- **Numbers come from each spike's suite**, named by a committed cost model (suite, version, case, metric, optional
  pinned run). **Budgets are committed owner judgement** in the same file, not test output.
- **Display, not verdict.** Consistent with Plan 058 and the testing guide: the suite's `budgets` and `baseline`
  decide pass or fail; this view only shows cost against a budget.

## History

- 2026-10-26: Plan 067 and this record created as a proposal; fields survey for the lod suites recorded above.
  Awaiting owner review of Q1-Q4. Related: [Plan 058](/docs/plans/058_test_results_page_and_thumbnails.md),
  [Plan 059](/docs/plans/059_lod_surface_core.md).

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
