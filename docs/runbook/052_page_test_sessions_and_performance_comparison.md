---
type: Runbook
title: Page Test Sessions and Performance Comparison
description: Findings, decisions and evidence for page-generic agent+human test sessions, shared scenarios and interactive performance comparison.
timestamp: 2026-10-17T00:00:00Z
tags: [testing, playwright, agent, page-test, performance, telemetry, demo, scenarios]
plans: [/docs/plans/052_page_test_sessions_and_performance_comparison.md]
---

# Runbook 052: Page Test Sessions and Performance Comparison

Plan: [Plan 052](/docs/plans/052_page_test_sessions_and_performance_comparison.md).

## 2026-10-17 — Plan written (code reading only)

Nothing was built, run or measured.

- **Owner's ask:** be able to take a real page (for example `/cell-planet-tsl`) and drive it the way
  a person would — pan, orbit, smooth-zoom from orbit to the surface, click a checkbox and redo the
  same actions — from both a human button and something an agent can invoke, and compare performance
  before/after. Today that requires the owner to do it by hand.
- **What already exists (read while drafting):**
  - [037](/docs/runbook/037_agent_driven_visual_and_performance_testing.md): the full design
    (Playwright operates the browser, a typed in-page adapter supplies control/facts, measurements
    establish performance). Append-only; not edited.
  - [038](/docs/runbook/038_agent_testing_implementation_plan.md): M1 implementation and progress.
    `tests/scene/` (specs, `playwright.config.ts`, typed fixture) and
    `projects/demo-app/src/app/testing/scene-test-adapter/scene-test-adapter.ts` expose
    `discover/reset/focus/orbit/projectToScreen/capture/diagnostics/stability` on
    `window.__sceneTest`.
  - [042](/docs/runbook/042_telemetry_graph_and_agent_perf_export.md) /
    [048](/docs/runbook/048_agent_telemetry_sections.md): the runtime "Copy for Agent" token-efficient
    perf export and page telemetry sections — the human-facing half this plan reuses.
  - `projects/demo-app/src/app/pages/cell-planet-tsl/cell-planet-tsl-page.component.ts:669`: the page
    already sets `window.__cellPlanetTsl = { page, engine, snap }` under `?debug=1`, using
    `projects/demo-app/src/app/shared/overlay-snapshot.ts` (a render-target readback that works in a
    hidden/WebGPU pane). This is the ad-hoc precursor to a page-generic session.
- **The gap:** M1 is hardwired to one fixture (`agent-reference-v1`) on one page
  (`/scene-inspection-lab`). There is no page-generic way to drive a real page's actions, no smooth
  in-app camera path, and no in-page per-frame sampling for percentiles (the M1 `stability` verb only
  checks pose stability). DOM-clicking the panel is brittle and cannot execute smooth motion.
- **Design choice recorded in the plan:** split the existing adapter into a camera/object engine
  (reuse `SceneTestAdapter`) plus a page-generic `PageTestSession` action registry with three
  consumers sharing one contract — agent (`page.evaluate` via the typed fixture), human (dev panel
  button), and CI specs importing the same framework-free scenario data.
- **Performance note:** `FPSController` aggregates at 1 Hz and traverses the scene on the render
  thread, so it cannot give p50/p95/p99 and it perturbs the reading (037 finding C-F3). The plan adds a
  separate low-overhead `FrameSampler` over the render stream, tagged with 042's camera-activity
  classes.
- **Sequencing:** this extends 038's M3 (performance history) and M5 (easier authoring / record-replay)
  and does not reopen M1. Phase 0 keeps the existing 12 M1 specs passing.
- **Open decisions left for implementation:** whether the human "Record" button uses in-app
  `MediaRecorder` (works from a page button) or requires the Playwright path; where exactly the
  `FrameSampler` is exported from the library; and the first scenario's exact camera poses on
  `/cell-planet-tsl`.

## Agent review inbox — append only

This section collects independent design reviews, following the format and rules of
[037's review inbox](/docs/runbook/037_agent_driven_visual_and_performance_testing.md#agent-review-inbox--append-only).
Entries are proposals, not accepted changes to the plan. Reviewers must not edit the plan,
implementation, other reviews or baseline policies. Read repository instructions and preserve
unrelated working-tree changes. Do not create commits.

Review independently before reading previous reviews, then avoid duplicating findings: reference an
existing finding ID when supporting or disagreeing with it. Focus on concrete failure modes, missing
decisions and ways to simplify implementation. No minimum finding count; do not invent concerns.
Append one entry of at most ~400 words with at most six findings, using a unique ID such as
`R-20261017-121500-pagetest-a4c9`. A later, explicitly requested synthesis pass reconciles findings
and updates the plan once, recording accepted/deferred/rejected finding IDs; original reviews stay
intact. Leave existing entries untouched.

### R-20261017-121500-pagetest-a4c9 | Antigravity / Gemini 4 Argon | 2026-10-17
Scope: Architecture, three-consumer contract, camera/readiness, FrameSampler, phase ordering, harness tests; Evidence: Plan/Runbook 052, Runbooks 037/038/042/048, scene-test-adapter.ts, cell-planet-tsl-page.component.ts, frame-benchmark.ts, overlay-snapshot.ts, raycast-orbit-controls.component.ts, fps.controller.ts, engine.service.ts, tests/scene/**.
Verdict: revise first
- R-20261017-121500-pagetest-a4c9-F1 [blocking] Scenarios / FrameSampler: In `Plan 052:116-131`, `{ measure }` is a sequential step after `{ camera: { path } }`, sampling 5s of idle camera after motion finishes instead of the interactive zoom sweep. Also, `FPSController.recordFrame` (`engine.service.ts:631`, `fps.controller.ts:212-224`) traverses the entire scene at 1 Hz regardless of `showFPS`, perturbing `FrameSampler` p95/p99.
  -> Attach `measure` to active motion steps and suspend `FPSController` 1 Hz traversal during sampling windows. Validate: `tsl-zoom-sweep` records `zoom`/`orbit` tags and zero 1 Hz traversal spikes.
  Basis: verified; `engine.service.ts:631`, `fps.controller.ts:212`, `037` C-F3.
- R-20261017-121500-pagetest-a4c9-F2 [blocking] SceneTestAdapter / Readiness: `SceneTestAdapter` (`scene-test-adapter.ts:89-120`) frames static `SceneTestObject` boxes, whereas `/cell-planet-tsl` streams patches, sets views via signals (`cell-planet-tsl-page.component.ts:1092-1108`), and uses `RaycastOrbitControlsComponent` (`raycast-orbit-controls.component.ts:260-285`), which steers target/camera on distance deltas when `#cursorPositionM` is set. Two-render pose settle (`Plan 052:109`) also ignores async worker actions (`setGrid`/`setCells`, lines `920,1068`) and streaming queues (`stats().queued`, `tileStats().queued`).
  -> Add a programmatic pose/path hook on `RaycastOrbitControlsComponent` bypassing cursor compensation, and require readiness/actions to await returned promises plus page-declared queue-drain predicates. Validate: zoom + `cells.toggle` resolves only after `queued === 0`.
  Basis: verified; `raycast-orbit-controls.component.ts:276-285`, `cell-planet-tsl-page.component.ts:654,920,1068`.
- R-20261017-121500-pagetest-a4c9-F3 [important] Architecture: Plan 052 overlooks `frame-benchmark.ts` (`cell-planet-tsl-page.component.ts:980-1053`), which already runs warmup, queue-settle (`isSettled`), rAF percentile sampling, and markdown export on `/cell-planet-tsl`.
  -> Replace `frame-benchmark.ts` with `FrameSampler` + `PageTestSession` rather than maintaining two in-page benchmark runners. Validate: existing TSL benchmark cases run via `PageTestSession` and `frame-benchmark.ts` is removed.
  Basis: verified; `frame-benchmark.ts:1-125`.
- R-20261017-121500-pagetest-a4c9-F4 [important] Three-consumer contract / Panel: `Plan 052:130,182` defines scenarios as interpreted step arrays and registers backend switches that reload via `location.assign` (`cell-planet-tsl-page.component.ts:1110-1114`), destroying `<page-test-panel>` state mid-run. Running `MediaRecorder` during `measure` also violates `037:344`.
  -> Restrict in-page scenarios to single-load executions (keep reload/backend pairs in Playwright/`compare-runs`) and make `MediaRecorder` mutually exclusive with `measure`. Validate: panel rejects reload steps and disables recording during `measure`.
  Basis: verified; `037` A-F1/B-F3, `cell-planet-tsl-page.component.ts:1110`.
- R-20261017-121500-pagetest-a4c9-F5 [important] Phases / Capture: `Plan 052:110-112` assumes `canvas.toDataURL` works on `WebGPURenderer` and puts `PageTestSession` extraction (Phase 0) before testing WebGPU capture/sampling.
  -> Spike `/cell-planet-tsl` WebGPU capture + path sampling before Phase 0 extraction. Validate: non-blank PNG and repeatable intervals on `webgpu` and `webgl2`.
  Basis: untested assumption; `overlay-snapshot.ts:5-10`, `037` B-F4.
- R-20261017-121500-pagetest-a4c9-F6 [important] Tests / Boundaries: `Plan 052:201-210` omits automated fault-injection specs for perf/session (injected hitch, hidden-tab throttling, worker timeout; `037:383-386`, `038:290`), and `tests/scene/specs/defect-gallery.spec.ts:30-31` hardcodes external repo paths.
  -> Add injected-hitch, throttled-tab, and timeout specs; remove external paths in `tests/scene/`. Validate: injected 50ms stall fails `compare-runs` in automated tests.
  Basis: verified; `defect-gallery.spec.ts:30-31`, `037:383-386`.
Agreement/disagreement: Agrees with `R-20260918-130613-agent-exec-b4f8-F1`, `R-20260918-131016-agent-infra-c9d4-F4`, `R-20260918-130935-evidence-c3e1-F3/F4`.
First useful experiment: In a throwaway Playwright spec on `/cell-planet-tsl?debug=1&backend=webgpu`, interpolate `cameraPosition` over 120 `renderComplete$` frames with `FPSController` traversal disabled, comparing `canvas.toDataURL()` against `snapshotToOverlay()` for non-blank repeatability.

### S-20261017-140000-pagetest-synthesis | opencode / deepseek-v4.1-flash | 2026-10-17

User-requested synthesis of `R-20261017-121500-pagetest-a4c9` into [Plan 052](/docs/plans/052_page_test_sessions_and_performance_comparison.md).
Each finding was independently checked against the current working tree before acceptance. The plan was
updated once; the original review above is intact. All six findings accepted.

| Finding | Decision and reason |
|---|---|
| F1 | **Accepted.** The plan's `measure` was a trailing step and would have sampled idle time. `measure` is now a wrapper around the motion/action segment, and the plan requires `FPSController`'s 1 Hz traversal to be suspended (or its overhead recorded) inside a window. Verified: `fps.controller.ts:212` traverses the whole scene at the 1 s boundary regardless of `showFPS`; `038:295-300` says hiding the HUD does not stop it. |
| F2 | **Accepted.** Added a programmatic pose hook on the control component (bypassing `#initZoomAnchorCompensation`, `raycast-orbit-controls.component.ts:260-286`), and made actions await their async work plus a page-declared queue-drain predicate. Verified: `setCells`/`setGrid` await a worker; `setBatching` recreates the view; views are signal writes. |
| F3 | **Accepted.** The plan now folds the pre-existing `frame-benchmark.ts` (warm-up, `isSettled`, rAF percentiles, markdown) into `FrameSampler` + `PageTestSession` and removes it, so only one in-page benchmark runner survives. Verified: `frame-benchmark.ts` exists and `runBenchmark` uses it at `cell-planet-tsl-page.component.ts:1017`. This file was added by concurrent work after the plan was drafted. |
| F4 | **Accepted.** In-page scenarios are now single-load (reload/backend pairs run only under Playwright/`compare-runs`), and recording is mutually exclusive with a measuring window. Verified: `switchBackend` reloads via `location.assign` (`:1110-1113`); 037:344 forbids recording during a benchmark. |
| F5 | **Accepted.** Phase 0 is now the WebGPU capture + sampling spike with an explicit no-go; adapter extraction moved to Phase 1. The canvas-vs-readback behaviour is an untested assumption (`overlay-snapshot.ts` exists because the canvas path can read blank). |
| F6 | **Accepted.** Added automated harness fault specs (injected hitch fails `compare-runs`, throttled tab is inconclusive, worker/action timeout is a typed error) and a rule that `tests/scene/` references no external/private path. The hardcoded external paths at `defect-gallery.spec.ts:30-31` are fixed separately in this pass (see next entry); that is a pre-existing public-repo rule violation, not introduced by Plan 052. |

## 2026-10-17 — Fixed external repo paths in `tests/scene/` (review F6 follow-up)

`tests/scene/specs/defect-gallery.spec.ts` wrote captures into three absolute paths under
`D:/code/Daxur-Daemon/...`, which violates the root AGENTS rule against naming private/consumer
repositories or their paths in this public repo. The external directories were removed; defect captures
now go only to the repo-local, ignored `artifacts/scene-defects/`. No other test behaviour changed.


## 2026-10-17 — Plan 050 added more users of `frame-benchmark.ts` (note for the Plan 052 implementer)

Written by the Plan 050 session after reading this runbook and the plan. Nothing in Plan 052 was edited.

- `cell-planet-tsl/frame-benchmark.ts` now has a second consumer: the GLSL page
  `/cell-planet-morph-streaming` imports it for its own "run benchmark + copy" (morph 0 / 0.5 / 1).
  Plan 052 phase 1 deletes the file, so that import has to move to `FrameSampler` + `PageTestSession` too.
- Both pages also have a "run ALL" button backed by `cell-planet-tsl/benchmark-suite.ts`. It chains TSL webgl2,
  TSL webgpu and GLSL, three rounds, across **page reloads**, keeping its queue and reports in `sessionStorage`
  (the backend is a query parameter, so one click cannot do it without reloads). This is the "reload/backend
  pairs" case that Plan 052 (review F4) assigns to Playwright / `compare-runs`; it exists only because the
  owner needed paste-back numbers for Plan 050 before 052 is built. When 052 lands, replace it with the
  `compare-runs` path and delete `benchmark-suite.ts`.
- Neither benchmark suspends `FPSController`'s 1 Hz scene traversal (review F1), and both measure rAF deltas
  (display-capped, 165 Hz on the owner's machine). Numbers from them are comparable to each other only.
- Measured so far (Runbook 050): two runs of the same TSL WebGL2 page differed 2x on the same machine, which is
  evidence for 052's "compare only within a recorded environment profile" rule and for repeated, alternating runs.

## 2026-10-17 — Plan revised: one-action suite and token-efficient report (owner decision)

Docs only; nothing built or measured. Earlier sections, the review inbox and the synthesis are unchanged.

- **Owner's requirement:** "run all" testing is the central approach. For a valid performance run the owner closes
  everything else and keeps the tab visible and focused so rAF/GPU is not throttled, so a test pass must be one button
  (human) or one command (agent), and must come back to a coding agent token-efficiently (paste or a file it reads).
- **What changed in the plan:**
  - Ground rule F4 narrowed: a **scenario** is single-load, a **suite** spans loads (pages and `?backend=` values). One
    framework-free suite definition (`entries x rounds x order`) is expanded by a pure `expandSuite` and run either by the
    browser `SuiteRunner` (the `sessionStorage` chain, formalized) or by a headless Playwright `npm run perf:suite`.
  - `PageTestSession.runLoad(entry)` is the only executor; both drivers call it, so there are not two competing runners.
    Pages lose their own suite code; `install()` resumes an active suite.
  - Runner state machine: versioned schema and suite hash, navigate-away pauses (not drops), hidden/blurred window =>
    `inconclusive` + one retry, per-load watchdog, 30 min stale expiry, Abort keeps partial results.
  - New dev-only `/page-test` launcher: printed "before you press the button" checklist, live preflight, Run ALL, and on
    return Copy report / Save raw JSON / baseline. Panel gains Run ALL.
  - Validity gates in every run: visibility, focus, blur/pagehide events, rAF cadence (throttle floor), refresh-rate
    estimate and quantization note, long tasks, canvas/DPR, adapter, backend actually used, battery where exposed, build hash.
  - Report `triangular-perf-suite v1` (042 rules, 048 sections for draws/tris/tiles): header block, one row per load x
    scenario as median of rounds with min-max spread, optional same-profile delta, verdict `ok / noisy /
    inconclusive / smoke / needs-review`; target < 2 KB, spec ceiling 4 KB; raw samples to files/console only.
    Playwright writes `artifacts/scene-tests/<run-id>/report.md` and `artifacts/scene-tests/latest/report.md`.
  - Statistics policy: 3 rotated rounds, >= 2 valid rounds per row, 15 % spread => `noisy`, per-round drift factor
    > 1.3 => `drift`, deltas only within one profile key and only above spread and one refresh period.
  - `FrameSampler` also records in-tick CPU ms (not display-quantized). Moved to Phase 1; the suite runner and
    report are Phase 2, the agent command and `compare-runs` Phase 3; camera, actions, interactive perf, recording and
    docs follow (phases renumbered 0-8). Goals G7-G9 added (one-action suite, gates, report).
  - `frame-benchmark.ts` is deleted in Phase 1 and `benchmark-suite.ts` in Phase 2, each in the same change that
    moves both planet pages over, so both pages keep working in the interim.
- **Evidence from Plan 050** ([Runbook 050](/docs/runbook/050_tsl_planet_surface_material.md)): the same TSL WebGL2
  page measured 10.1 ms then 20.6 ms (2x, every scenario shifted) => rounds, rotation, spread and drift flags; p50s on
  multiples of ~6.06 ms at 165 Hz => refresh estimate and `~` for sub-period deltas; a hidden pane ran at ~1 fps =>
  visibility/cadence gates; first frame GLSL 305 ms vs TSL 924-1641 ms => discarded warm-up and a separate first-frame line.
- **Superseded:** "In-page scenarios are single-load; reload/backend pairs belong only to Playwright/compare-runs"
  (review F4 as synthesized). Reason: the owner needs authoritative GPU numbers from a visible, focused tab with one
  click, and tests here run headless, so the Playwright-only rule would leave the human path without backend pairs.
  F4's real failure (a reload destroying panel state mid-run) is handled by persisting runner state across loads.
  Recording stays mutually exclusive with measuring.
- **Open decisions for implementation:** the noise and drift thresholds (15 %, 1.3x) and the 3-round default, tuned on
  the first Phase 2 runs; whether the build hash can be injected into the dev build cheaply; whether Chrome's
  focused-document clipboard write works without a click on the launcher (the button stays either way); and whether a
  headless run on this machine gets a hardware adapter at all (if not, the agent command is smoke-only and the
  human button is the only GPU path).
