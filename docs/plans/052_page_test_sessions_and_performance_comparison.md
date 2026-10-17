---
type: Plan
title: Page Test Sessions and Performance Comparison
description: Generalize the M1 scene-test adapter from one lab fixture to any demo page, so a page registers named actions, camera verbs, views and probes once and the same contract is driven by an agent (Playwright), a human (dev panel) and CI; make a one-action "Run ALL" suite across page loads and backends the central way to test performance, with built-in validity gates and a compact report an agent can read.
timestamp: 2026-10-17T00:00:00Z
tags: [testing, playwright, agent, page-test, performance, telemetry, demo, scenarios, suite]
runbook: /docs/runbook/052_page_test_sessions_and_performance_comparison.md
---

# Plan 052: Page Test Sessions and Performance Comparison

Status: **proposed**, 2026-10-17. No code written. Synthesized 2026-10-17 against review
`R-20261017-121500-pagetest-a4c9` (all six findings accepted). **Revised 2026-10-17 by owner
decision:** the one-action "Run ALL" suite across page loads is the central performance path, with
validity gates and a token-efficient report; ground rule F4 is narrowed (see Ground rules and
Decisions). Evidence: [Runbook 052](/docs/runbook/052_page_test_sessions_and_performance_comparison.md).

**Goal:** let a text-only coding agent (and a human with one button) take a real demo page, drive it
the way a person would — pan, orbit, smooth-zoom from orbit down to the surface, click a toggle and do
the same thing again — and get back facts and performance numbers that can be compared before and
after a change. For performance, the human's whole job is: close other work, open one page, press
**Run ALL**, keep the tab visible, paste the report back. M1 proved the machinery on one fixed
fixture; this makes it **per page** and **per suite**.

M1 today ([Runbook 038](/docs/runbook/038_agent_testing_implementation_plan.md)) hardwires
`SceneTestAdapter` to `agent-reference-v1` on `/scene-inspection-lab`: `discover()/focus()/orbit()/
projectToScreen()/capture()/diagnostics()` behind `window.__sceneTest`. Nothing lets an agent target
`/cell-planet-tsl`, whose own `?debug=1` hook (`window.__cellPlanetTsl` in
`cell-planet-tsl-page.component.ts`) is the ad-hoc precursor to what this plan formalizes. Plan 050
added two more precursors that this plan absorbs: `frame-benchmark.ts` (one-page benchmark) and
`benchmark-suite.ts` (a `sessionStorage` chain that runs TSL webgl2, TSL webgpu and GLSL in three
rounds across reloads), both used by `/cell-planet-tsl` and `/cell-planet-morph-streaming`.

**Builds on:** the design and boundaries of [Runbook 037](/docs/runbook/037_agent_driven_visual_and_performance_testing.md);
the M1 implementation and file ownership of [Runbook 038](/docs/runbook/038_agent_testing_implementation_plan.md);
the telemetry model and token-efficient export of [Runbook 042](/docs/runbook/042_telemetry_graph_and_agent_perf_export.md)
and page sections of [Runbook 048](/docs/runbook/048_agent_telemetry_sections.md); the measured noise,
quantization and throttling findings of [Runbook 050](/docs/runbook/050_tsl_planet_surface_material.md)
("Phase 5 numbers", "Rerun and GLSL comparison", "Run-all suite"); the existing
`projects/demo-app/src/app/testing/scene-test-adapter/scene-test-adapter.ts`,
`projects/demo-app/src/app/shared/overlay-snapshot.ts`, and `cell-planet-tsl/{frame-benchmark,benchmark-suite}.ts`.
This plan does **not** edit the append-only Runbook 037.

## Ground rules

- **Browser code has no Playwright imports.** Session, suite runner and panel live in
  `projects/demo-app/src/app/testing/`. No Playwright, WebMCP or model client in the engine or app.
- **The library gains at most a small sampling primitive** (`FrameSampler`), with intentional export,
  docs and colocated specs. Playwright, scenario and suite data never move into the library.
- **Scenarios and suites are framework-free TypeScript data, not a DSL.** The same modules are
  imported by the in-page runner and by the Playwright driver. No JSON action interpreter
  (037 decisions A-F1/B-F3).
- **A scenario is single-load; a suite may span loads** (narrows review F4, owner decision
  2026-10-17). Steps inside a scenario never reload or swap the renderer. Anything that needs a load —
  another page, another `?backend=` (the TSL renderer cannot switch live) — is a **suite entry**, and
  one suite definition is run either from the browser by one click or by Playwright.
- **Recording is mutually exclusive with a measuring window** (037:344; review F4, unchanged).
- **Every performance run carries its own validity gates** (visible, focused, rAF cadence, backend
  actually used). A window that fails a gate is `inconclusive`, never a number to compare.
- **Camera paths execute inside the app**, not as timed external mouse calls. Keep a separate
  real-pointer/wheel test to prove the controls still work (037). Smooth zoom is a first-class verb.
- **A measuring window covers live motion or live action, not the quiet after it** (review F1).
- **Suspend `FPSController`'s 1 Hz traversal inside a measuring window**, or record its overhead.
  `showFPS: false` hides the HUD but does not stop the traversal (038:295-300; 037 C-F3; review F1).
- **Readiness is an explicit page contract**, never `networkidle` or a sleep: queue-drain and settle
  predicates, and pose stable across two completed renders (review F2).
- **Performance is only compared within a recorded environment profile.** Software rendering is smoke
  evidence, never GPU performance (037/038). No pass/fail on absolute fps. GPU timestamps are separate.
- Tests run headless and non-watching (repo rule). Authoritative GPU numbers therefore come from the
  human one-click path on a visible tab; the headless agent/CI path gives the same report format and
  counts as GPU evidence only when its profile shows a hardware adapter.
- The engine is public: no consumer-app names or paths in code, docs or runbook text.
- Never create commits; leave everything in the working tree.

## Goals

| # | Goal |
|---|---|
| G1 | A page registers its actions, camera verbs, named views and probes **once**, in a few lines, with no Playwright knowledge |
| G2 | The **same contract** is driven by three consumers: an agent via `page.evaluate` (typed fixture), a human via a dev-only panel button, and CI specs |
| G3 | Scenarios and suites are shared framework-free data: an agent authors one, a human runs the same one from the browser, CI records it |
| G4 | Camera verbs: `focus`, `view`, `orbit`, `pan`, `dolly/zoom`, and a **smooth in-app path**; each resolves only after the intended pose reaches a completed render |
| G5 | UI actions: named semantic actions that call the **same methods the DOM handlers call**; a separate thin real-DOM interaction test still proves the wiring |
| G6 | Interactive performance: a low-overhead in-page `FrameSampler` (per-frame intervals, p50/p95/p99, hitch counts, camera-activity tags) independent of `FPSController`, sampled **during** motion with the 1 Hz traversal suspended |
| G7 | **One-action suite:** one click (human) or one command (agent/CI) runs a whole suite — several pages and backends, alternating rounds, across reloads — from one shared definition |
| G8 | **Validity gates in every run:** visibility, focus, throttling, refresh-rate quantization, backend actually used and the environment profile are measured and printed, and failing windows are marked `inconclusive` |
| G9 | **Token-efficient report:** a versioned, stable, compact block (target < 2 KB for a full suite) an agent can read from a paste or a file, with spread, deltas vs a baseline and a verdict per row; reuses 042's rules and 048's sections |
| G10 | Run records on disk and a thin `compare-runs`: A/B settings and before/after code, never auto-passing a mismatched profile |
| G11 | `frame-benchmark.ts` and `benchmark-suite.ts` fold into `FrameSampler` + `PageTestSession` + the suite runner; no second runner survives (review F3) |

## Architecture

```text
shared data (framework-free)            testing/page-test/data/
  scenarios/*.ts   one page load each      suites/*.ts   entries x rounds x order

browser (demo app, dev only)                       agent / CI (Playwright, headless)
  PageTestSession  <- one registration per page      perf-suite spec: expandSuite(suite)
    actions / views / probes / camera                  for each load: page.goto(url)
    runLoad(entry) -> LoadResult  <------------------ page.evaluate(__pageTest.runLoad)
    FrameSampler + gates (visible/focus/cadence)         |
  SuiteRunner (sessionStorage chain)                     v
    expandSuite(suite) -> plan; navigate; resume     artifacts/scene-tests/<run-id>/
    collects LoadResult[]                              report.md  report.json  samples.json
  /page-test launcher: checklist, preflight,         artifacts/scene-tests/latest/report.md
    Run ALL, Copy report, Save raw, baseline         tools/scene-tests/compare-runs.mjs
        \__________ formatReport(results, baseline?) (same pure function) _________/
```

### `PageTestSession` (browser, one page load)

The registry half; `SceneTestAdapter` stays the camera/object engine and is reused unchanged where a
page has objects. A page constructs one session, registers, and installs it under a gated flag.

```ts
const session = createPageTestSession({ id: 'cell-planet-tsl', camera: controller });
session.action('morph.set', (v: number) => page.morphProgress.set(v));      // same call as the slider
session.action('cells.toggle', (on) => page.setCells(asInput(on)), { drain: () => tileStats().queued === 0 });
session.view('front', () => page.viewFront());
session.ready(() => page.firstFrameRendered() && page.tileStats().queued === 0);
session.probe('renderer', () => ({ backend: page.actualBackend(), aa, dpr }));
session.install(); // window.__pageTest, dev/test only; removed on destroy
```

- Every call carries `sessionId`, returns a typed result or error, never selects an engine
  implicitly. One in-flight mutating command per session. Unknown names fail; IDs stable (037 C-F1).
- An action **awaits its own async work** (worker reply, streaming drain, view recreation) and may
  declare a queue-drain predicate; a DOM handler returning early is not a completed action (review F2).
- `runLoad(entry)` executes one suite entry's scenarios on this load — discarded warm-up, settle, then
  each `measure` window through `FrameSampler` and the gates — and returns a `LoadResult` (summary
  stats per window, gate outcomes, first-frame ms, the page's 048 telemetry section). It is the
  **only** executor; both suite drivers call it.
- Pages no longer carry suite code: `install()` checks for an active suite and resumes it.
- `discover()` reports capabilities, actions, views, probes and metric definitions, bounded.
- Gated like M1 (`isDevMode()` + explicit flag; a valid suite state counts as the flag in dev).

### Suites and the cross-load runner

```ts
export const planetBackends: Suite = {
  id: 'planet-backends', schema: 1,
  rounds: 3, order: 'rotate',               // ABC, BCA, CAB: drift and position hit every entry alike
  entries: [
    { id: 'tsl-webgl2', url: '/cell-planet-tsl?backend=webgl2', scenarios: ['planet-static-sweep'] },
    { id: 'tsl-webgpu', url: '/cell-planet-tsl?backend=webgpu', scenarios: ['planet-static-sweep'] },
    { id: 'glsl',       url: '/cell-planet-morph-streaming',    scenarios: ['planet-morph-sweep'] },
  ],
};
```

- `expandSuite(suite)` is pure and deterministic: it yields the ordered list of loads. Both drivers
  use it, so the browser and Playwright run the **same plan** and emit the same `LoadResult`s.
- **Browser driver, `SuiteRunner`** (formalizes `benchmark-suite.ts`). State in `sessionStorage` under
  one key, versioned: `{ schema, runId, suiteId, suiteHash, plan, cursor, attempts, results, status,
  startedAt, updatedAt }`, with `status` one of `running | paused | aborted | done`.
  - On each load the session's `install()` asks the runner for the current entry; if the URL matches,
    it waits for `ready`, runs `runLoad`, appends the result and navigates to the next load.
  - **Navigated away** (URL does not match the cursor): the suite is **paused, not dropped**; the
    launcher and panel show *Resume / Abort* with the partial results kept.
  - **Hidden or blurred mid-window:** that window is `inconclusive(hidden)`; the runner waits for the
    tab to be visible and focused again, then retries that load **once**, then moves on flagged.
  - **Hung or crashed load:** a per-load watchdog (default 180 s) marks `timeout` and moves on; a
    reload that finds `updatedAt` older than the watchdog does the same.
  - **Stale state:** a state idle for more than 30 min, or with a different `schema`/`suiteHash`, is
    discarded with a visible notice, never silently resumed.
  - **Abort:** a small static overlay pill (excluded from measurement) and `Esc` abort; partial
    results are kept and reported as `aborted`.
  - The last load navigates back to the launcher, which shows the report.
- **Agent/CI driver:** `npm run perf:suite -- planet-backends [--baseline <report.json>]` runs a
  Playwright spec (headless, single run) that `page.goto`s each load from `expandSuite` and calls
  `__pageTest.runLoad`; it writes the run record and `report.md` (below). Same data, same formatter.

### Launcher and preflight (`/page-test`, dev only)

One page is the human's start and end point: suite dropdown, the checklist, live preflight results,
**Run ALL**, and on return the report with **Copy report**, **Save raw JSON** and an optional baseline.

Shown before the button (cannot be detected, so it is printed):

1. Close other browser tabs and windows, other dev previews (including an IDE's embedded browser pane),
   video and games. Prefer a browser profile without extensions.
2. Plug in; use a high-performance power plan. Do not let the dev server rebuild during the run.
3. Do not resize or move the window between monitors. Keep this tab visible and focused and do not
   touch mouse or keyboard until the report appears (the page shows the expected duration).

Measured, printed in the report header, and re-checked per window:

- `visibilityState`, `document.hasFocus()`, and `visibilitychange` / `blur` / `pagehide` events
  during a window (any event => `inconclusive`).
- **rAF cadence:** a 1 s idle probe estimates the refresh period (median delta). Median > 50 ms or
  < 5 fps => throttled, blocked at preflight and `inconclusive` per window (050: a hidden pane ran
  at ~1 fps). The report prints the refresh rate and a **quantization note**: rAF deltas snap to
  multiples of the refresh period (050: p50s on multiples of ~6.06 ms at 165 Hz), so differences
  under one period are marked `~` (unresolved), and `FrameSampler` also records non-quantized
  in-tick CPU ms.
- Long tasks (`PerformanceObserver('longtask')`) counted per window.
- Canvas size, `devicePixelRatio`, viewport; browser and OS; GPU adapter string (WebGPU adapter info
  or WebGL unmasked renderer, coarse); **backend actually used** (native WebGPU vs WebGL2 fallback)
  — a mismatch with the requested backend flags the entry `backend-mismatch`.
- `navigator.getBattery()` where exposed (on battery => warning), `hardwareConcurrency`.
- Build id: git short hash plus a dirty-tree hash when available from the dev build, else `unknown`.

### Report (`triangular-perf-suite v1`)

The same pure `formatReport` serves the paste, the console and `report.md`. It follows 042's rules
(one fenced typed block, pipe-joined header lines, 1-decimal rounding, metric suffixes) and takes its
per-load counters (draws, tris, tiles) from the page's **048 telemetry section** rather than a
page-specific `describe()`. 042's live "Copy for Agent" stays the snapshot export; this is its suite
counterpart.

````text
```triangular-perf-suite v1
suite: planet-backends#a1b2 | run: 20261017-1412 | 3 rounds rotate | status: done 9/9, retried 1
env: Chrome 155 Win | gpu: hw ANGLE-D3D11 | 165Hz (6.06ms, quantized) | 2560x1308@1.5 | ac | build: 55c6d7dd+d3f9e
gates: hidden 0 | blur 0 | throttled 0 | longtasks 2 | backend ok | baseline: 20261016-2210 (same profile)
first-frame ms (median, min-max): tsl-webgl2 1338 (1290-1402) | tsl-webgpu 924 (901-960) | glsl 305 (298-322)
| load | scenario | n | mean | p50 | p95 | p99 | hitch | fps | draws | tris | tiles | mean min-max | d p50 | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tsl-webgl2 | morph0 bat-on | 3x495 | 10.1 | 9.1 | 12.1 | 18.2 | 0 | 99 | 7 | 1.2M | 115 | 9.8-10.6 | +0.4 ~ | ok |
| tsl-webgl2 | morph0.5 bat-on | 3x480 | 18.5 | 18.2 | 24.2 | 30.3 | 2 | 54 | 6 | 1.1M | 115 | 8.6-20.6 | - | noisy |
```
````

- One header block, then one row per (load, scenario) with **median of rounds**; `mean min-max`
  shows the per-round spread so noise is visible; `d p50` appears only with a same-profile baseline.
- `verdict`: `ok` | `noisy` | `inconclusive(<reason>)` | `smoke` (software adapter) | `needs-review`
  (profile mismatch with the baseline). Never pass/fail on absolute fps.
- **Size:** target < 2 KB (~600 tokens) for the reference suite (3 loads x ~8 scenarios x 3 rounds);
  a spec enforces a 4 KB ceiling. Left out of the paste: raw intervals, per-round rows, camera-tag
  timelines, full adapter strings — they go to `samples.json` / **Save raw JSON** and the console.
- **Paste-back:** the launcher tries to copy on arrival and always shows a **Copy report** button
  (the clipboard may need a click, which a navigation chain has lost); the report is also printed to
  the console with the fence as a marker. Under Playwright the agent reads
  `artifacts/scene-tests/<run-id>/report.md`, and `artifacts/scene-tests/latest/report.md` is a copy
  of the newest one.
- **Baseline:** the launcher keeps the last 5 reports per suite in `localStorage` (a convenience;
  defaults to the newest same-profile one) and accepts a pasted v1 report (parsed back); Playwright
  takes `--baseline`.

### Statistics policy

- Default 3 rounds, rotated order; a row needs **at least 2 valid rounds** or it is `inconclusive`.
- Per load: one discarded warm-up scenario (shader compile and first installs land there), settle on
  the page's drain predicate, then each window samples >= 3 s and >= 120 frames.
- `noisy` when the per-round mean spread `(max - min) / median > 15 %`. **Drift:** per round, the
  median ratio of that load's scenario means to their cross-round medians; a factor > 1.3 flags the
  whole round `drift` (050's same-page 2x shift would show here, not as a scenario effect).
- Hitch = interval > 2 refresh periods and > 50 ms; counted, not averaged away.
- Deltas only within one profile key (browser major, OS, adapter, actual backend, refresh rate,
  canvas size, DPR, power state). A delta is reported as real only if it exceeds both runs' spreads
  and, for rAF metrics, one refresh period; otherwise `~`.

### `SceneTestAdapter` (camera/object engine, reuse)

- Reused for `focus`, `orbit`, `projectToScreen`, `capture`, `stability`.
- Add `pan`, `dolly/zoom` and a **path** verb that interpolates pose inside the app and resolves after
  the pose is stable across two completed renders (037 C-F4).
- `RaycastOrbitControlsComponent` steers pivot and camera when distance changes with zoom-to-cursor
  set (`#initZoomAnchorCompensation`); the path verb needs a **programmatic pose hook that bypasses
  cursor compensation** (review F2).
- `capture` keeps normal quality; on WebGPU / hidden panes `canvas.toDataURL` can be blank, so
  `shared/overlay-snapshot.ts` is the explicit diagnostic capture (review F5; spike first).

### Scenarios (framework-free data, one load)

```ts
export const zoomSweep: Scenario = {
  id: 'tsl-zoom-sweep',
  segments: [
    { wait: 'ready' },
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

- Steps are `wait | camera | action | view`; `measure` wraps what runs inside it (review F1). A
  scenario has no URL and no reload step: the suite entry owns the URL. A linear sequence, no parser.
- The Plan 050 static benchmarks become scenarios (`planet-static-sweep`: morph 0 / 0.5 / 1 x batching,
  projection in shader, atmosphere off; `planet-morph-sweep` for the GLSL page).

### `FrameSampler` (library primitive)

- Per-frame wall-clock intervals from the render/tick stream, plus in-tick CPU ms; p50/p95/p99,
  min/max, hitch counts, runtime. `O(1)` per frame, preallocated. Unit-tested on synthetic sequences.
- Separate from `FPSController` (1 Hz, traverses the scene; 037 C-F3); the traversal is suspended
  inside a window (review F1). Windows are tagged with 042's `idle/rot/zoom/move/orbit` activity.

### Panel and recording

- `<page-test-panel>` (dev only, every registered page): scenario dropdown, **Run**, **Run ALL**
  (starts a suite containing this page, via the launcher flow), **Record** (in-app `MediaRecorder`
  for the human path; Playwright video/trace for CI), **Copy for agent** (042 + 048), **Copy recipe**
  (the exact `npm run perf:suite` / `test:scene` command).
- Recording is disabled while a measuring window is active (review F4). Panel and pill are excluded
  from captures and measurements.

### Evidence and comparison

```text
projects/demo-app/src/app/testing/page-test/   session, suite runner, launcher, data/{scenarios,suites}
tests/scene/                                   specs, fixtures, perf-suite driver spec
tools/scene-tests/                             thin compare-runs glue only (no second runner)
artifacts/scene-tests/<run-id>/                manifest, report.md/json, samples.json, PNGs, video
```

- A run record holds suite/scenario ids and hashes, build hash and dirty diff, the environment profile,
  gate outcomes, raw intervals, page telemetry sections and capture references (037 record tables).
- `compare-runs a.json b.json` prints the same table with deltas; a profile mismatch is `needs-review`,
  never `pass` (037 B-F5). Baseline acceptance stays a deliberate human action.

## Phases

0. **Spike (kill criterion) — do first.** One throwaway Playwright spec on
   `/cell-planet-tsl?debug=1&backend=webgpu`: interpolate `cameraPosition` over ~120 `renderComplete$`
   frames with `FPSController` traversal disabled; compare `canvas.toDataURL()` with
   `snapshotToOverlay()` for non-blank, repeatable images; record intervals on `webgpu` and `webgl2`.
   Also check by hand that the cadence probe and visibility/blur events detect a hidden pane.
   - **Gate:** non-blank PNG and bounded, repeatable intervals on **both** backends; a hidden pane is
     detected as throttled. No-go revisits capture/sampling before any extraction (review F5).
1. **`FrameSampler` + `PageTestSession` on three pages.**
   - Library sampler + specs. Extract the session; register `/scene-inspection-lab` (M1 compatibility,
     `window.__sceneTest` kept), `/cell-planet-tsl` and `/cell-planet-morph-streaming`; port the
     Plan 050 benchmarks to scenario data with the 1 Hz traversal suspended; delete `frame-benchmark.ts`.
   - **Gate:** all pages answer `discover()`; the lab's 12 M1 specs pass; both planet pages run their
     scenarios through `runLoad`.
2. **Suite runner, gates, report, launcher (the human one-click path).**
   - `expandSuite`, `SuiteRunner` state machine, preflight/gates, `formatReport` v1 and parser,
     `/page-test` launcher, panel **Run ALL**; the `planet-backends` suite reproduces today's chain.
     Delete `benchmark-suite.ts` and both pages' suite code in the same change.
   - **Gate:** one click runs `planet-backends` (9 loads) to a report under 2 KB; hiding the tab mid-run
     gives `inconclusive(hidden)` and one auto-retry; navigating away pauses with Resume; Abort keeps
     partial results; stale or mismatched state is discarded with a notice.
3. **Agent/CI command on the same suite + `compare-runs`.**
   - `npm run perf:suite`, run records, `latest/report.md`, `--baseline`, `compare-runs`.
   - **Gate:** the command and the browser button emit the same report format for the same suite; a
     software adapter yields `smoke`; a deliberately slowed change shows a real delta; a profile
     mismatch yields `needs-review`.
4. **Camera verbs + programmatic pose hook** for `RaycastOrbitControls` (`pan`, `dolly/zoom`, `view`,
   `path`; review F2).
   - **Gate:** an agent smooth-zooms `/cell-planet-tsl` orbit-to-surface and captures both ends with no
     torn/stale frame; a real pointer drag still proves the control works.
5. **Action registry and page actions** (`morph.set`, `projection.set`, `ocean.toggle`, `cells.toggle`,
   `grid.toggle`, `batching.toggle`, `macro.toggle`, `border.cycle`, views `front/seam/mapEdge`; each
   awaits its drain). Backend is a suite entry, not an action.
   - **Gate:** toggling a state asserts the matching probe; re-running gives identical state after
     `queued === 0`.
6. **Interactive perf scenario.** `tsl-zoom-sweep` measured during motion, added to a suite.
   - **Gate:** two same-build suite runs give `ok` rows with `zoom`/`orbit` tags and no 1 Hz spikes.
7. **Recording and panel extras** (Record, Copy recipe; recording disabled during `measure`).
   - **Gate:** a human press produces the same structured result as the agent run, plus a WebM.
8. **Authoring docs and harness fault specs.** `tests/scene/README.md` (new page, new suite);
   `projects/triangular-engine/docs/ai-agents.md` testing section; `CHANGELOG.md` for the exported
   sampler; the fault specs from §Tests (review F6).

## Tests

- `PageTestSession`: registration, duplicate/unknown ids, one-in-flight mutation, async action awaiting
  and drain predicates, `runLoad` result shape, install/uninstall, dev gating.
- `FrameSampler`: percentiles, hitch counts, CPU ms against synthetic sequences; empty/short windows.
- Suite: `expandSuite` order and rotation; runner state machine with fake storage and location
  (resume, navigate-away pause, hidden retry-once, watchdog timeout, stale/schema/hash discard, abort).
- Gates: fake visibility/focus events and rAF sequences => `inconclusive`; refresh estimate and
  quantization flag from 6.06 ms-quantized input; backend mismatch.
- Statistics: median-of-rounds, spread => `noisy`, drift flag from a 2x-shifted round, `~` deltas
  below one refresh period, profile mismatch => `needs-review`.
- Report: golden output for a reference result set; **size under 2 KB, ceiling 4 KB**; parse
  round-trip of a pasted v1 report.
- Data: every scenario step and suite entry resolves to a registered page/action/view/probe (static).
- Harness faults (037:383-386, 038:290): injected hitch fails a `compare-runs` assertion; a throttled
  tab is `inconclusive`; an action timeout is a typed error. Expected-failure specs stay green
  (review F6). `tests/scene/` references no external/private path.
- Timing is never a spec (specs run headless); measured numbers go in the runbook.

## Decisions

| Decision | Status |
|---|---|
| Page-generic `PageTestSession` in the demo app; library gets only the sampler | Decided 2026-10-17 (synthesis) |
| Scenarios and suites are framework-free TS data shared by browser runner and Playwright | Decided 2026-10-17 |
| `measure` wraps a motion/action segment, not a trailing idle step | **Decided** (review F1) |
| Suspend `FPSController`'s 1 Hz traversal inside a measuring window | **Decided** (review F1; 037 C-F3) |
| Camera paths execute in-app; one real-input test per camera type retained | Decided 2026-10-17 |
| Programmatic pose hook on the control component bypasses cursor compensation | **Decided** (review F2) |
| Actions await async work and page-declared queue-drain predicates | **Decided** (review F2) |
| Fold `frame-benchmark.ts` and `benchmark-suite.ts` into sampler + session + suite runner | **Decided** (review F3; extended 2026-10-17) |
| ~~In-page scenarios are single-load~~ **Superseded:** scenarios are single-load, suites span loads and run from one click in the browser or one command under Playwright, from one definition; `runLoad` is the only executor | **Decided** 2026-10-17 (owner decision; narrows review F4) |
| Recording is mutually exclusive with measuring | **Decided** (review F4, kept) |
| Every run carries validity gates; failing windows are `inconclusive` | **Decided** 2026-10-17 (owner decision; 050 evidence) |
| Report `triangular-perf-suite v1`: median of rounds, spread, verdict, < 2 KB; raw data to files | **Decided** 2026-10-17 |
| Default 3 rotated rounds, >= 2 valid rounds per row, 15 % noise and 1.3x drift thresholds | Proposed; tune after the first Phase 2 runs |
| Authoritative GPU numbers come from the human one-click path; headless runs are GPU evidence only on a hardware adapter | **Decided** 2026-10-17 |
| WebGPU capture + sampling spike precedes extraction and is a kill criterion | **Decided** (review F5) |
| Automated harness fault-injection specs (hitch, throttling, timeout) | **Decided** (review F6) |
| Human recording via in-app `MediaRecorder`; agent/CI via Playwright video/trace | Proposed, settle in Phase 7 |
| Extend M3/M5 of 038 rather than edit append-only Runbook 037 | Decided 2026-10-17 |

## Out of scope

WebMCP transport, local vision review, remote/authenticated report hosting or a dev-server endpoint
that receives human reports, automatic baseline acceptance, GPU timestamp capture (a separate metric),
a multi-browser/GPU matrix, headed Playwright perf runs (repo rule: headless), and detecting other
tabs, apps or extensions (printed checklist only). No dashboard, database or model orchestration.
