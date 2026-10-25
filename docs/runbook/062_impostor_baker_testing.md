---
type: Runbook
title: Impostor Baker Testing
description: Planning findings and implementation evidence for reusable tests on the octahedral impostor baker page.
timestamp: 2026-10-25T00:00:00Z
tags: [impostor, testing, performance, demo]
plans: [/docs/plans/062_impostor_baker_testing.md]
performance:
  - id: impostor-baker-cost-v1
    url: http://triangular-demo.localhost:4200/impostor-baker?testSuite=impostor-baker-cost&testVersion=1&testProfile=visible-browser&testRepetitions=1&testAutoStart=1
    status: runnable-diagnostic
    evidence:
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-06-904Z_visible-browser_67634c7c-eac03b00.json
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-09-432Z_visible-browser_67634c7c-eac03b00.json
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-11-833Z_visible-browser_67634c7c-eac03b00.json
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-14-321Z_visible-browser_67634c7c-eac03b00.json
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-16-706Z_visible-browser_67634c7c-eac03b00.json
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-19-445Z_visible-browser_67634c7c-eac03b00.json
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-25-167Z_visible-browser_67634c7c-eac03b00.json
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-30-849Z_visible-browser_67634c7c-eac03b00.json
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-36-560Z_visible-browser_67634c7c-eac03b00.json
      - artifacts/test-runs/impostor-baker-cost@v1/2026-10-25T09-11-39-052Z_visible-browser_67634c7c-eac03b00.json
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

### Resolved during implementation

- Forest placement is seeded by the source tree seed, making repeated layouts reproducible.
- The page requires `WebGLRenderer`; its atlas call does not expose GPU timestamps, so the suite reports wall time and marks atlas GPU time unavailable.
- The initial matrix uses 512–2048 px atlases, 8²–16² views, 500–4,000 instances, one palm source rebuild, one WebP compression case, and a 3-second render window for 500, 2,000, and 4,000 instances.

## 2026-10-25 — Runner integration

### Changes

- Added `TestRunnerComponent` to `/impostor-baker` with separate functional and performance suites, a page-local adapter, dev-only autostart, and the existing same-origin result sink.
- Functional cases cover hemispherical and spherical bakes across tree species and check atlas size/attachments, impostor material texture bindings, instance count, projection selection, and restoration.
- Performance cases report wall-clock timings for source-tree generation, old-resource cleanup, matrix update, all atlas-view rendering, impostor setup, previews, forest transforms, full rebake, and WebP compression. Render cases record display cadence, main-thread render-submit time, draw calls, and triangles at 500, 2,000, and 4,000 instances. GPU timing is explicitly unavailable on this WebGL page.
- The runner locks the control fieldset, orbit input and navigation while active. Scenarios use plain JSON settings; restore rebuilds the captured settings after completion or cancellation.
- Forest transforms now use a seeded generator so repeated runs with the same tree seed produce the same instance layout.
- Corrected the current impostor README and source comments: hemispherical and spherical mappings are both implemented. The older reference library's unfinished spherical path is no longer described as a current limitation.
- Added adapter specs for suite separation, functional checks, metric attribution and restoration/listener cleanup.

### Verification

- `npm run build -- demo-app`: passed. The build reports the existing `demo-index.component.scss` size-budget warning (11.92 kB against 10 kB).
- Specs have not been run. No controlled visible-browser performance capture or human visual review has been recorded yet.

### Remaining

- Run the new adapter spec and execute the functional suite in a visible browser.
- Visually review both projection modes and verify the result sink/summary flow.
- Collect a controlled performance run before adding budgets or accepting a baseline.

## 2026-10-25 — First visible-browser diagnostic sweep

### Results

- The user ran all ten performance scenarios as separate one-case standard-mode visible-browser runs. All ten were valid, automation passed, and no cases failed. The runner marked performance **unassessed** and visual review **pending**.
- The summary reports the GPU vendor/device as unknown and medium GPU load. Treat these numbers as diagnostic only; they do not establish a hardware baseline or budget.
- Bake-stage wall time was dominated by `atlasBakeMs` in the sampled cases. The 16²-view case recorded 14.0 ms, and the 4,000-instance bake case recorded 21.8 ms for atlas bake and 23.4 ms total. These are JavaScript-side wall times around the WebGL API call, not GPU execution times.
- The source-tree rebuild case recorded 0.7 ms for tree generation and 6.9 ms total bake time. WebP compression recorded 73.2 ms wall time. The two attachments were 272,858 bytes as PNG and 209,624 bytes compressed, a reported 23.18% size reduction.
- Render windows reported 6 draw calls at all three counts. At 500 / 2,000 / 4,000 instances, triangle counts were 2,098 / 5,098 / 9,098. Median frame intervals were 6.1 / 6.1 / 6.0 ms; p95 render-submit CPU times were 0.5 / 0.5 / 0.4 ms. Frame intervals are display cadence and do not represent GPU time.

| Scenario | `atlasBakeMs` | Total bake | Other recorded result |
| --- | ---: | ---: | --- |
| Baseline, 512 px / 8² views / 500 instances | 6.70 ms | 7.50 ms | Cleanup 0.20 ms |
| Atlas, 1,024 px | 5.90 ms | 6.40 ms | — |
| Atlas, 2,048 px | 5.70 ms | 6.50 ms | — |
| 16² views | 14.00 ms | 14.60 ms | — |
| Forest, 4,000 instances | 21.80 ms | 23.40 ms | Forest transform generation 0.80 ms |
| Source tree, palm | 6.40 ms | 6.90 ms | Source tree build 0.70 ms |
| Render, 500 instances | — | — | 6 calls, 2,098 triangles; median interval 6.1 ms; p95 CPU submit 0.5 ms |
| Render, 2,000 instances | — | — | 6 calls, 5,098 triangles; median interval 6.1 ms; p95 CPU submit 0.5 ms |
| Render, 4,000 instances | — | — | 6 calls, 9,098 triangles; median interval 6.0 ms; p95 CPU submit 0.4 ms |
| WebP compression | — | — | 73.2 ms; 272,858 PNG bytes → 209,624 compressed bytes (23.18% reduction) |

### Recorded evidence

The ten result JSON files are listed in the `performance` arrays above. [Rerun the suite](http://triangular-demo.localhost:4200/impostor-baker?testSuite=impostor-baker-cost&testVersion=1&testProfile=visible-browser&testRepetitions=1&testAutoStart=1); use the summary command in the suite card to inspect the latest saved cases.

### Remaining

- Run the functional suite and review hemispherical and spherical output visually.
- Capture again with a known GPU adapter and quiet machine before comparing or setting budgets. The existing runs remain historical diagnostics.
