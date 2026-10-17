---
type: Plan
title: Page Test Sessions and Performance Comparison
description: Generalize the M1 scene-test adapter from one lab fixture to any demo page, so a page registers named actions, camera verbs, views and probes once and the same contract is driven by an agent (Playwright), a human (dev panel) and CI; add in-page frame sampling and a run-record compare tool for interactive performance.
timestamp: 2026-10-17T00:00:00Z
tags: [testing, playwright, agent, page-test, performance, telemetry, demo, scenarios]
runbook: /docs/runbook/052_page_test_sessions_and_performance_comparison.md
---

# Plan 052: Page Test Sessions and Performance Comparison

Status: **proposed**, 2026-10-17. No code written. Synthesized 2026-10-17 against review
`R-20261017-121500-pagetest-a4c9`: all six findings accepted and folded in (see Runbook 052).
Evidence: [Runbook 052](/docs/runbook/052_page_test_sessions_and_performance_comparison.md).

**Goal:** let a text-only coding agent (and a human with one button) take a real demo page, drive it
the way a person would — pan, orbit, smooth-zoom from orbit down to the surface, click a toggle and do
the same thing again — and get back facts and performance numbers that can be compared before and
after a change. M1 proved the machinery on one fixed fixture; this makes it **per page**.

M1 today ([Runbook 038](/docs/runbook/038_agent_testing_implementation_plan.md)) hardwires
`SceneTestAdapter` to `agent-reference-v1` on `/scene-inspection-lab`: `discover()/focus()/orbit()/
projectToScreen()/capture()/diagnostics()` behind `window.__sceneTest`. Nothing lets an agent target
`/cell-planet-tsl`, whose own `?debug=1` hook (`window.__cellPlanetTsl`, `cell-planet-tsl-page.component.ts:669`)
is the ad-hoc precursor to what this plan formalizes. (Line numbers drift: another agent added an
in-page frame benchmark under the page while this plan was drafted — see Runbook 052 review
finding F3.)

**Builds on:** the design and boundaries of [Runbook 037](/docs/runbook/037_agent_driven_visual_and_performance_testing.md);
the M1 implementation and file ownership of [Runbook 038](/docs/runbook/038_agent_testing_implementation_plan.md);
the telemetry model and token-efficient export of [Runbook 042](/docs/runbook/042_telemetry_graph_and_agent_perf_export.md)
and page sections of [Runbook 048](/docs/runbook/048_agent_telemetry_sections.md); the existing
`projects/demo-app/src/app/testing/scene-test-adapter/scene-test-adapter.ts`,
`projects/demo-app/src/app/shared/overlay-snapshot.ts`, and
`projects/demo-app/src/app/pages/cell-planet-tsl/frame-benchmark.ts`. This plan does **not** edit the
append-only Runbook 037; it becomes the new home for the page-generic and performance work that 037
named but did not build.

## Ground rules

- **Browser code has no Playwright imports.** The session and panel live in
  `projects/demo-app/src/app/testing/`. No Playwright, WebMCP or model client in the engine or app.
- **The library gains at most a small sampling primitive**, with intentional export, docs and
  colocated specs. Playwright and scenario data never move into the library.
- **Scenarios are framework-free TypeScript data, not a DSL.** A scenario is `url + segments`; the same
  module is imported by a Playwright spec and by the in-page panel. No JSON action interpreter
  (037 decisions A-F1/B-F3).
- **Camera paths execute inside the app**, not as timed external mouse calls, so motion is
  deterministic and can be measured. Keep a separate real-pointer/wheel test to prove the controls
  themselves still work (037). Smooth zoom is a first-class verb, not `page.mouse.wheel`.
- **A measuring window covers live motion or live action, not the quiet after it.** `measure` wraps the
  motion/action segment it belongs to, so a "smooth zoom" scenario samples the zoom, not an idle
  camera (review F1).
- **Suspend `FPSController`'s 1 Hz traversal inside a measuring window**, or record its overhead
  explicitly. `showFPS: false` hides the HUD but does not stop the per-second scene traversal
  (038:295-300), which perturbs p95/p99 (037 C-F3; review F1).
- **Readiness is an explicit page contract**, never `networkidle` or a sleep. A page declares
  queue-drain and settle predicates (streaming `queued === 0`, worker promises resolved); camera and
  action verbs resolve only after those hold and the pose is stable across two completed renders
  (review F2).
- **In-page scenarios are single-load.** A step that reloads or swaps the renderer (for example a
  `backend=webgl2` switch) belongs to the Playwright/`compare-runs` path, not the panel, and
  **recording is mutually exclusive with a measuring window** (review F4; 037:344).
- **Performance is only compared within a recorded environment profile.** Software rendering can
  provide smoke evidence, never GPU performance (037/038). GPU timestamps are a separate metric.
- The engine is public: no consumer-app names or paths in code, docs or runbook text.
- Never create commits; leave everything in the working tree.

## Goals

| # | Goal |
|---|---|
| G1 | A page registers its actions, camera verbs, named views and probes **once**, in a few lines, with no Playwright knowledge |
| G2 | The **same contract** is driven by three consumers: an agent via `page.evaluate` (typed fixture), a human via a dev-only panel button, and CI specs |
| G3 | Scenarios are shared framework-free data: an agent authors one, a human runs the same one from the browser, CI records it |
| G4 | Camera verbs: `focus`, `view`, `orbit`, `pan`, `dolly/zoom`, and a **smooth in-app path**; each resolves only after the intended pose reaches a completed render |
| G5 | UI actions: named semantic actions that call the **same methods the DOM handlers call**; a separate thin real-DOM interaction test still proves the wiring |
| G6 | Interactive performance: a low-overhead in-page `FrameSampler` (per-frame intervals, p50/p95/p99, hitch counts, camera-activity tags) independent of `FPSController`, sampled **during** motion with the 1 Hz traversal suspended |
| G7 | Run records on disk and a thin `compare-runs` tool: A/B settings and before/after code, reporting deltas, never auto-passing a mismatched profile |
| G8 | A human can run and record the same scenario from the page and copy a token-efficient report (reusing 042/048) |
| G9 | The existing in-page `runFrameBenchmark` on `/cell-planet-tsl` folds into `FrameSampler` + `PageTestSession`; no second benchmark runner survives (review F3) |

## Architecture

```text
browser page (demo app)                         test / CI side
  PageTestSession  <-- one registration per page  scenarios/*.ts (framework-free data)
    actions[]                                        |
    views[]                                          v
    probes[]                                   Playwright spec -> typed `pageTest` fixture
    camera (SceneTestAdapter verbs)                  |            -> page.evaluate
    FrameSampler (per-frame intervals)          tools/scene-tests/compare-runs.mjs
        ^                                            ^
        |                                            |
  <page-test-panel> (dev only)   ---------------- run records  artifacts/scene-tests/<run-id>/
   Run scenario | Record | Copy for agent | Copy recipe
```

### `PageTestSession` (browser, demo app)

The registry half; `SceneTestAdapter` stays the camera/object engine and is reused unchanged where a
page has objects. A page constructs one session, registers, and installs it under a gated flag.

```ts
const session = createPageTestSession({ id: 'cell-planet-tsl', camera: controller });
session.action('morph.set', (v: number) => page.morphProgress.set(v));      // same call as the slider
session.action('ocean.toggle', (on: boolean) => page.setOcean(asInput(on))); // same call as the checkbox
session.action('cells.toggle', (on) => page.setCells(asInput(on)), { drain: () => tileStats().queued === 0 });
session.view('front', () => page.viewFront());
session.camera({ focus: 'globe', padding: 1.2 });
session.probe('perf', () => ({ fps: sampler.last(), drawCalls: page.drawCalls(), tiles: page.tileStats() }));
session.probe('renderer', () => ({ backend: page.backend, tiles, macro, aa }));
session.install(); // window.__pageTest, dev/test only; removed on destroy
```

- Every call carries `sessionId`, returns a typed result or a typed error and never selects an engine
  implicitly. One in-flight mutating command per session.
- An action must **await its own async work** — a worker request (`setCells`/`setGrid`), a streaming
  drain, a view recreation (`setBatching`) — and may declare a **queue-drain predicate** the session
  waits on before resolving. A DOM handler that returns before the worker replies is not a completed
  action (review F2).
- Actions are registered explicitly; unknown names fail. IDs are stable across reloads (037 C-F1).
- `discover()` reports capabilities, actions, views, probes and metric definitions, bounded.
- Gated the same way M1 is (`isDevMode()` + explicit test/dev flag); absent in production.

### `SceneTestAdapter` (camera/object engine, reuse)

- Reused for `focus`, `orbit`, `projectToScreen`, `capture`, `stability`.
- Add the missing camera verbs for real page cameras (`RaycastOrbitControls`, `OrbitControls`):
  `pan`, `dolly/zoom`, and a **path** verb that interpolates pose inside the app and resolves after
  the pose is stable across two completed renders (037 C-F4; not a single `requestAnimationFrame`).
- A real page camera may steer itself: `RaycastOrbitControlsComponent`'s `#initZoomAnchorCompensation`
  moves pivot and camera when the distance to target changes and `zoomToCursor`/`#cursorPositionM`
  are set (`raycast-orbit-controls.component.ts:260-286`). The path verb therefore needs a
  **programmatic pose hook on the control component that bypasses cursor compensation**; a direct
  camera write the next tick overwrites is not a completed action (review F2).
- `capture` keeps normal quality. On WebGPU / hidden panes, `canvas.toDataURL` can be blank; the
  proven readback path is `shared/overlay-snapshot.ts`. Use it as an explicit diagnostic capture, not
  the baseline capture (review F5 — spike before relying on it).

### Scenarios (framework-free data)

```ts
export const zoomSweep: Scenario = {
  id: 'tsl-zoom-sweep',
  url: '/cell-planet-tsl?backend=webgpu',
  segments: [
    { wait: 'ready' },
    // The measuring window wraps the motion, not the quiet after it.
    { measure: { profile: 'interactive' }, steps: [
      { camera: { path: { from: 'orbit', to: 'surface', durationMs: 6000 } } },
    ] },
    { measure: { profile: 'action', windowMs: 4000 }, steps: [
      { action: 'ocean.toggle', args: [false] },
      { action: 'ocean.toggle', args: [true] },
    ] },
  ],
};
```

- Steps are `wait | camera | action | view`; `measure` is a **wrapper** that samples whatever runs
  inside it, so motion/action is measured live (review F1). No expressions, no parser.
- A scenario is a linear sequence of segments, not a general control-flow language.
- The panel imports the same modules; the Playwright fixture imports the same modules.
- Single-load for the panel: reload/backend-pair scenarios run only under Playwright/`compare-runs`
  (Ground rules; review F4).

### `FrameSampler` (library primitive)

- Records **per-frame wall-clock intervals** from a render/tick stream; computes p50/p95/p99, min/max,
  count of frames above declared hitch thresholds, and total runtime. `O(1)` per frame, preallocated.
- Deliberately separate from `FPSController`, which aggregates at 1 Hz and traverses the scene, so it
  cannot give percentiles and perturbs the reading (037 C-F3). The 1 Hz traversal is suspended, or its
  overhead recorded, for the duration of a measuring window (review F1).
- Tags each window with the camera activity (042's `idle/rot/zoom/move/orbit` model) so a drop can be
  attributed to a motion class.
- **Consolidates the existing `runFrameBenchmark`** (`cell-planet-tsl/frame-benchmark.ts`: warm-up,
  queue-settle via `isSettled`, rAF percentiles, markdown export). Once its scenarios run through
  `PageTestSession` + `FrameSampler`, that file is removed and the page keeps only page-specific
  scenario data (review F3).
- Unit-tested against synthetic interval sequences; no browser needed.

### Panel and recording

- `<page-test-panel>` (dev-only Angular component): scenario dropdown, **Run**, **Record of the same
  run** (in-app `MediaRecorder` on the canvas for the human path; Playwright video/trace for the CI
  path), **Copy for agent** (reuse 042's exporter + 048 sections), and **Copy recipe** (the exact
  `npm run test:scene -- --grep <id>` command).
- The panel **rejects a scenario that reloads or swaps the renderer** (those run under Playwright), and
  **disables recording while a measuring window is active** — recording during a benchmark violates
  037:344 (review F4).
- The panel calls the identical registry the agent uses, so a human run and an agent run are the same
  code path. Panel presence/render is excluded from all captures and measurements.

### Evidence and comparison

```text
tests/scene/            specs, fixtures, scenarios/*.ts, data contracts
tools/scene-tests/      thin compare-runs glue only (no second runner)
artifacts/scene-tests/<run-id>/  manifest, raw samples, camera-activity tags, PNGs, video, report
```

- A run record holds: scenario id/hash, build/source hash and dirty diff (no commit required), browser
  and backend, viewport/DPR, effective settings, raw frame intervals, page telemetry sections, and
  capture references (037 record tables).
- `compare-runs a.json b.json` prints p50/p95/p99 deltas, hitch deltas and probe deltas, and marks a
  profile mismatch as `needs-review`, never `pass` (037 B-F5). Baseline acceptance stays a deliberate
  human action.

## Phases

0. **WebGPU capture + sampling spike (kill criterion) — do first.** One throwaway Playwright spec on
   `/cell-planet-tsl?debug=1&backend=webgpu`: interpolate `cameraPosition` over ~120 `renderComplete$`
   frames with `FPSController` traversal disabled, and compare `canvas.toDataURL()` against
   `snapshotToOverlay()` for non-blank, repeatable images; record intervals on `webgpu` and `webgl2`.
   - **Gate:** a non-blank PNG and bounded, repeatable intervals on **both** backends. No-go stops the
     build and revisits the capture/sampling approach before any extraction (review F5).
1. **Generic session, first two consumers.**
   - Extract `PageTestSession` so `/scene-inspection-lab` (M1 compatibility) and `/cell-planet-tsl`
     both register and `install()`. Keep `window.__sceneTest` working for existing specs.
   - Fold `cell-planet-tsl`'s `runFrameBenchmark` scenarios onto the session and delete
     `frame-benchmark.ts` (review F3).
   - **Gate:** both pages answer `discover()`; the lab's 12 M1 specs still pass; the TSL benchmark cases
     run through the session.
2. **Camera verbs + programmatic pose hook for a real page camera.**
   - Add `pan`, `dolly/zoom`, `view` and the smooth `path` verb against `RaycastOrbitControls`; add the
     pose hook that bypasses zoom-to-cursor compensation (review F2); reuse the settle-to-two-renders
     rule.
   - **Gate:** an agent smooth-zooms `/cell-planet-tsl` from orbit to surface and captures at both ends
     with no torn/stale frame; a real pointer drag still proves the control works.
3. **Action registry and page actions.**
   - Register `cell-planet-tsl` actions: `morph.set`, `projection.set`, `ocean.toggle`, `cells.toggle`,
     `grid.toggle`, `batching.toggle`, `macro.toggle`, `border.cycle`, views `front/seam/mapEdge`; each
     async action awaits its worker/drain (review F2).
   - Backend switch is a Playwright/`compare-runs` scenario that **reloads** (a renderer cannot be
     swapped live; not a panel scenario — review F4).
   - **Gate:** an agent toggles a UI state, asserts the matching probe, re-runs the sequence and gets
     identical structured state after `queued === 0`.
4. **`FrameSampler` and the first perf scenario.**
   - Library sampler + specs; `perf` probe; the `tsl-zoom-sweep` scenario measuring a 5-second
     interactive zoom during motion, with `FPSController`'s 1 Hz traversal suspended (review F1).
   - **Gate:** two same-build runs report bounded p50/p95/p99 and a recorded environment profile.
5. **Human panel and recording.**
   - `<page-test-panel>` runs and records the same scenario; **Copy for agent** and **Copy recipe**;
     recording disabled during `measure` (review F4).
   - **Gate:** a human press produces the same structured result as the agent run, plus a WebM.
6. **Run records and `compare-runs`.**
   - Write run records; the compare tool; A/B settings and before/after code.
   - **Gate:** a deliberately slowed change shows a real delta; a browser/backend mismatch yields
     `needs-review`.
7. **Authoring docs and harness fault specs.**
   - `tests/scene/README.md` authoring example for a new page; update the library
     `projects/triangular-engine/docs/ai-agents.md` testing section to point here; `CHANGELOG.md` if
     any public symbol is exported.
   - Add the automated harness fault specs from §Tests (review F6).

## Tests

- `PageTestSession`: registration, duplicate/unknown ids, one-in-flight mutation, async action awaiting
  and queue-drain predicates, install/uninstall, dev gating, serialization round-trip.
- `FrameSampler`: percentiles and hitch counts against synthetic sequences; empty/short windows.
- Scenario data: schema validation; every step name resolves to a registered action/view/probe per
  page (static check, no browser).
- Harness fault injection (037:383-386, 038:290): an injected hitch/stall must fail a `compare-runs`
  assertion; a throttled/hidden tab must be detected and marked inconclusive; a worker/action timeout
  must surface as a typed error. Expected-failure harness specs stay green (review F6).
- Specs on both consumers: lab M1 regression, `cell-planet-tsl` zoom/toggle scenario. `tests/scene/`
  must not reference any external/private repository path (review F6).
- Timing is never a spec (specs run headless); timings and GPU numbers go in the runbook.

## Decisions

| Decision | Status |
|---|---|
| Generalize the adapter into a page-generic `PageTestSession` in the demo app; library gets only the sampler | Decided 2026-10-17 (synthesis) |
| Scenarios are framework-free TS data shared by agent, panel and CI | Decided 2026-10-17 |
| `measure` wraps a motion/action segment, not a trailing idle step | **Decided** (review F1) |
| Suspend `FPSController`'s 1 Hz traversal inside a measuring window | **Decided** (review F1; 037 C-F3) |
| Camera paths execute in-app; one real-input test per camera type retained | Decided 2026-10-17 |
| Programmatic pose hook on the control component bypasses cursor compensation | **Decided** (review F2) |
| Actions await async work and page-declared queue-drain predicates | **Decided** (review F2) |
| Consolidate `runFrameBenchmark` into `FrameSampler` + `PageTestSession`; remove the old runner | **Decided** (review F3) |
| In-page scenarios are single-load; recording is mutually exclusive with measuring | **Decided** (review F4) |
| WebGPU capture + sampling spike precedes adapter extraction and is a kill criterion | **Decided** (review F5) |
| Add automated harness fault-injection specs (hitch, throttling, timeout) | **Decided** (review F6) |
| Perf sampled off the render stream, separate from `FPSController`; compared only within a profile | Decided 2026-10-17 |
| Human recording via in-app `MediaRecorder`; agent/CI recording via Playwright video/trace | Proposed, settle in Phase 5 |
| Extend M3/M5 of 038 rather than edit append-only Runbook 037 | Decided 2026-10-17 |

## Out of scope

WebMCP transport, local vision review, remote/authenticated report hosting, automatic baseline
acceptance, GPU timestamp capture (a separate metric), and a multi-browser/GPU matrix. No dashboard,
database or model orchestration.
