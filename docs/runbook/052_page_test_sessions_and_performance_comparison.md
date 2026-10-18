---
type: Runbook
title: Page Test Sessions and Performance Comparison
description: Findings, decisions and evidence for page-generic agent+human test sessions, shared scenarios and interactive performance comparison.
timestamp: 2026-10-17T00:00:00Z
tags: [testing, playwright, agent, page-test, performance, telemetry, demo, scenarios]
plans: [/docs/plans/052_page_test_sessions_and_performance_comparison.md]
performance:
  - id: cloud-runner-smoke-v1
    url: http://triangular-demo.localhost:4200/cloud-volumes-lab?testSuite=cloud-runner-smoke&testVersion=1&testProfile=human-observed&testAutoStart=1
    status: runnable-functional
  - id: cloud-haze-cost-v1
    url: http://triangular-demo.localhost:4200/cloud-volumes-lab?testSuite=cloud-haze-cost&testVersion=1&testProfile=human-observed&testAutoStart=1
    status: runnable-diagnostic
  - id: morph-streaming-smoke-v1
    url: http://triangular-demo.localhost:4200/cell-planet-morph-streaming?testSuite=morph-streaming-smoke&testVersion=1&testProfile=human-observed&testAutoStart=1
    status: blocked-material-streaming
  - id: morph-streaming-morph-cost-v1
    url: http://triangular-demo.localhost:4200/cell-planet-morph-streaming?testSuite=morph-streaming-morph-cost&testVersion=1&testProfile=human-observed&testAutoStart=1
    status: blocked-material-streaming
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

## 2026-10-18 — U0 unattended cloud-lab feasibility started

- Requirement: agents execute GPU scenes without human clicks, focus or paste-back; the owner may
  use the laptop concurrently. Controlled replay and authoritative idle-machine performance are
  separate claims. This supersedes the previous human-visible-tab prerequisite as the target workflow.
- Scope: isolated headless Playwright experiment on `/cloud-volumes-lab`, explicit dev-only hook,
  actual adapter/timestamp evidence, fixed-step journey, repeated/paused comparisons, injected failures
  and automatic artifacts/cleanup. Plan 052 U0 owns the checklist; Plan 051 owns cloud expectations.
- Preserve concurrent cloud/atmosphere work. No commits, broad runner replacement or agent-instruction
  changes. Hardware/contention/known-slowdown outcomes must be recorded separately; incomplete evidence
  stays inconclusive. Commands and measured findings will be appended after the experiment.

## 2026-10-18 — U0 core feasibility passed

- **Rerun:** `npm run test:cloud-feasibility`. Instructions: [cloud feasibility README](/tests/cloud-feasibility/README.md).
  Evidence: `artifacts/cloud-feasibility/2026-10-18T11-45-47-673Z-23720/report.md` and `report.json`;
  raw frame/state records, PNGs, compiled build/served bundles and source/cleanup manifests retained alongside.
- **Profile:** headless installed Chrome 155, actual WebGPU AMD `gcn-5` integrated adapter, timestamps
  supported, 640x360/DPR 1, one volume/24 march steps. Each journey renders 1,200 steps (20 simulated
  seconds), moving camera/sun/volume and rebaking light; outside/inside/outside is asserted.
- **Passed:** mesh repeat, deliberate wall-clock pauses and same-adapter competing WebGPU compute
  match every normalized frame state; all 21 mesh + 7 proxy checkpoint comparisons have **zero changed
  pixels**. Competing device completed 509 batches, ~1.71 s submission-to-completion wall time, no GPU
  errors. This is bounded contention evidence, not a gaming or saturation test.
- **Passed:** missing cloud changes images; missing render/readiness timeout produce their expected
  errors; fresh-page recovery matches. Normal development page has no hook. One command exits 0,
  closes contexts and releases its dedicated server port. Full harness: 1 passed in ~2.7 min including
  build; TypeScript check and library build pass. No commits made by this session.
- **Findings/fixes:** bundled Chromium 140 device creation fails with `dxil.dll` Windows error 126,
  silently falling back to hardware WebGL2; backend gate caught it. Installed Chrome creates WebGPU.
  Stop Three.js's independent animation clock as well as the engine loop; fix the observed wrapper's
  dimensions. Unexpected-render detection also caught catalog `ScreenshotService` auto-capture;
  seed the normal thumbnail cache in disposable contexts before app boot. Keep the render guard.
- **Identity:** concurrent edits to two atmosphere files and the experiment README were recorded.
  All journeys use one immutable compiled demo; actual served JS and probe inputs are retained, so
  these are results for that build, not an assertion about later working-tree contents.
- **Open:** authoritative quiet/reference performance + known-slowdown validation, explicit reference
  adapter choice (this run did not use the RTX GPU), shared coordination for independent agents,
  continuous video/all-frame visual coverage, generic physics/streaming/temporal-history clocks.
  Existing private Three.js hooks remain U0-only; no shared-runner migration or agent-instruction update.

## 2026-10-18 — Retained command timing and low-polling status

- Owner asks for historical duration estimates and organized JSON retention, avoiding repeated
  agent wakeups while GPU tests run. Existing journey files already retain `wallMs`; the gap is
  whole-command timing (including build) and an inexpensive active/history view.
- Add per-directory `run.json` with UTC start/finish, monotonic total duration, workload profile and
  terminal status. Final `execution.json` also carries these timings. Startup failures are recorded;
  hard-killed owners can leave unfinished records and status explicitly reports owner liveness.
- `npm run test:cloud-feasibility:status` reads compact JSON without launching the GPU suite.
  Prefer process completion notifications/long waits; estimates are a fallback for timer choice.
  Estimate uses up to 20 recent successful commands matching frames/build mode/arguments, p90 + 25%;
  sample count is explicit, no matching history yields null, no idle-performance claim.
- Existing `artifacts/` ignore covers all evidence. Unique run directories remain indefinitely,
  including failures and old pilots; no pruning and no shared index to race between agents. Old
  pilots lack command timing records and are not retroactively given invented durations. This is
  local retention, not a backup or GPU queue. See the experiment README for limits and usage.
- **Validation:** Node timing/history tests pass (workload/failure filtering, retention, active
  elapsed time and finalization). A deliberate invalid CLI flag exits 1 and retains a failed record
  (`2026-10-18T12-03-22-601Z-20336`, 9,409 ms). Full default GPU suite passes again in retained run
  `2026-10-18T12-02-03-623Z-43756`: wrapper total **217,337 ms**, exit 0, dedicated port released.
  Status lists both records and no active command; the next matching run estimates **271,672 ms**
  including headroom (one sample only). Source-manifest drift correctly records edits to wrapper,
  package, test and README during validation; application build/bundles remain retained and immutable.

## 2026-10-18 — U0P performance validation started

- Owner authorized the next bounded performance experiment before shared-runner migration.
  Add batch-boundary GPU timestamp resolution with no captures/per-frame fences in the measuring
  window; alternate normal and deliberately increased raymarch work on the same real cloud path.
- Select and assert an actual reference GPU; retain measurements, repeatability, profile identity
  and inconclusive reasons. No claim of idle-machine FPS while laptop activity is uncontrolled.
  Keep this isolated from the shared runner and agent instructions.

## 2026-10-18 — U0P adapter selection and positive-control findings

- `node tools/scene-tests/cloud-adapter-survey.mjs` retains
  `artifacts/cloud-adapters/2026-10-18T12-17-15-228Z-15960/survey.json`. Chrome 155 ordinary launch
  selects AMD `gcn-5` for both WebGPU power preferences. The process-only Chromium
  `--force-high-performance-gpu` switch selects NVIDIA `ampere`; both devices initialize without
  software fallback. U0P explicitly asserts the actual NVIDIA vendor; no Windows settings changed.
  Switch source: [Chromium GPU switches](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/config/gpu_switches.cc).
- Initial retained failure `2026-10-18T12-20-36-897Z-8844` correctly rejects duplicate query IDs
  (`TIMESTAMP_QUERY_LOSS`). Stopping Three's animation also requires updating its `info.frame`
  bookkeeping; node/shader frame ID alone is insufficient for batched timestamp identity. The
  probe now mirrors both. Read the complete private pass map, not Three's final-frame return value.
- Completed march-cap pilot `2026-10-18T12-21-48-863Z-45580` (113,979 ms, exit 0, port released):
  24 vs 192 max steps yields only a 1.013x median rendering-cost ratio, **unresolved**. Actual ray
  length and early termination mean a higher cap need not add much work. Harness completion is
  not a successful performance gate; full raw readings are retained.
- Replace that unreliable positive control with eight real redundant scene renders per simulation
  step, without advancing simulation/shader time for extra draws. Require identical final PNGs.
  Measure GPU pass sums per simulation step, record actual render count, and verify every render's
  timestamp. All cases share the first reference's measured path count (no unequal animation spans).
  Compare all six normal/repeat windows against three slow windows, so order drift cannot hide in
  the separate repeat group. Busy/profile/noise/missing-evidence rejection is covered by pure specs.

## 2026-10-18 — U0P redundant-render positive control passed

- `npm run test:cloud-performance`, retained run `2026-10-18T12-26-12-838Z-12068`:
  fresh immutable development build, installed headless Chrome 155, actual NVIDIA `ampere` WebGPU,
  640x360/DPR 1, one mesh volume/24 march steps. No source changes during the run; manifests,
  actual served bundles, raw pass timestamps/CPU/wall batches and final PNGs retained.
- Three alternating rounds, each baseline/slow/repeat (reverse A labels in round two). Each case
  warms a complete 1,200-step path, then measures four paths (4,800 simulation steps), identical
  across cases. Baseline/repeat: 4,800 renders each; slow: 38,400 renders each, all timestamped.
  The redundant renders leave every final checkpoint PNG byte-identical to the reference.
- All six reference windows: median GPU render cost **0.18046 ms/simulation step**, min 0.16959,
  max 0.18775, range/median **10.06%**. Three slow windows: median **0.45819 ms/step**, min 0.44306,
  max 0.46584, spread **4.97%**. **2.539x**, nonoverlapping ranges: `slowdown-detected` under the
  provisional >25%/<=15%-spread policy. Baseline vs repeat median ratio 1.039 is unresolved.
- Known competing same-adapter compute is explicitly rejected as `inconclusive(known-contention,
  insufficient-rounds)` even when its observed timing looks ordinary. This does not demonstrate
  automatic detection of arbitrary external activity; unknown contention still cannot be excluded.
- Both Playwright specs pass (deterministic analysis fault cases + real GPU experiment), wrapper
  **175,325 ms**, exit 0, all contexts closed and dedicated server port released. Duration history
  separates this positive-control workload from earlier march-cap and correctness runs.
- **Boundary:** positive control and rejection machinery proven; authoritative quiet baseline,
  smaller-regression sensitivity and real-time presentation remain open. No performance gate,
  shared runner migration or agent-instruction change adopted. Shared machine coordination is
  still required before independent agents benchmark together.

## 2026-10-18 — U0P final regression verification

- Full default `npm run test:cloud-feasibility` passes again after the shared frame-bookkeeping
  change: `2026-10-18T12-29-14-912Z-21332`, **157,713 ms**, exit 0, port released, no source drift.
  Actual WebGPU AMD profile remains the correctness default; NVIDIA selection is U0P-only.
  Mesh/proxy state and exact checkpoint comparisons, wall pauses, same-adapter compute, missing
  cloud/render, readiness timeout and fresh-page recovery all pass. Continuous video remains open.
- Correctness and positive-control runs share source hash
  `85692d05d3d463e6ab18dc0b852cf0d4b8547215102b1759584aadfa67cfb473` and retain their own builds/bundles.
- `npx tsc -p tests/cloud-feasibility/tsconfig.json`, `npm run build:triangular-engine`, Node
  history/timing tests and syntax checks pass. `git diff --check` passes. Compact status shows
  no active commands and preserves all successful/failed records. No commits executed by this session.

## 2026-10-18 — Independent review of U0/U0P code and retained artifacts

Reviewed independently against the code, `three@0.186.1` WebGPU internals, and the retained artifacts
under `artifacts/cloud-adapters/2026-10-18T12-17-15-228Z-15960/` and
`artifacts/cloud-feasibility/{2026-10-18T12-20-36-897Z-8844,2026-10-18T12-21-48-863Z-45580,2026-10-18T12-26-12-838Z-12068,2026-10-18T12-29-14-912Z-21332}/`
(synthesizing both a cloud-container code review and a local review with direct inspection of the
gitignored artifact files).

### Offline pass-context decomposition of the retained U0P runs

Each query UID in `batch.render` has the form `r:<frameCall>:<renderContextId>:f<frame>`
(`three.webgpu.js:69294`). Grouping the raw `batches` in `2026-10-18T12-26-12-838Z-12068` and
`2026-10-18T12-21-48-863Z-45580` by `renderContextId` resolved the open questions from both pilots:

1. **Why `gpuComputeMsPerFrame` is `0` and `gpuRenderMsPerFrame` is 71% light baking:**
   `CloudVolume` (`cloud-volume.ts:250-309`) bakes density and sun optical depth via fragment passes
   (`QuadMesh.render(renderer)`) into 2D atlas `RenderTarget`s, not compute shaders. In
   `2026-10-18T12-26-12-838Z-12068/baseline-1.json` (`4,800` simulation steps):
   - **Context `3` (`lightTarget` 4-band light rebakes in `tick$`):** `3,848` passes (`962` rebakes × `4`
     bands), totaling **`604.64 ms` (`0.1260 ms/step` = 71.2% of `gpuRenderMsPerFrame`)**.
   - **Context `1` (`frameBufferTarget` scene + cloud raymarch pass):** `4,800` passes, totaling
     **`200.67 ms` (`0.0418 ms/step` = 23.6%)**.
   - **Context `5` (`_renderOutput` tone-map / sRGB blit into `outputRenderTarget`):** `4,800` passes,
     totaling **`44.50 ms` (`0.0093 ms/step` = 5.2%)**.
2. **Why the 8× redundant-render positive control (`2026-10-18T12-26-12-838Z-12068`) produced `2.539x`:**
   In `submitStep()` (`cloud-replay-probe.ts:90-98`), `engine.tick()` runs **once** per simulation step
   (running Context `3` light bakes 1×), while `engine.render()` runs **7 extra times** (repeating only
   Context `1` + Context `5` 8×). In `slow-1.json`, Context `1 + 5` scaled by **`6.85x`**
   (`0.0511 -> 0.3500 ms/step`), while unrepeated Context `3` ran 1× (`0.1260 -> 0.1082 ms/step`),
   yielding $(0.3500 + 0.1082) / (0.0511 + 0.1260) = 2.588\times$ (`2.539x` median across rounds).
3. **Correction to the `24 vs 192` march-cap diagnosis (`2026-10-18T12-21-48-863Z-45580`):**
   The earlier entry above attributed the `1.013x` (`unresolved`) ratio to short ray length and early
   termination. Per-context analysis of `2026-10-18T12-21-48-863Z-45580/*.json` disproves that:
   - **Context `1` (the cloud raymarch pass) slowed down by `1.725x` (+72.5%)**, from median
     **`0.0375 ms/step`** (range `[0.0347, 0.0403]`, 6 reference windows at 24 steps) to
     **`0.0646 ms/step`** (range `[0.0644, 0.0655]`, 3 slow windows at 192 steps, `1.7%` spread,
     completely nonoverlapping ranges).
   - That +72.5% raymarch regression was masked in the flat `gpuRenderMsPerFrame` sum because:
     (a) Context `3` light bakes use fixed `lightSteps = 24` (`cloud-volume.ts:185`), not `uMarchSteps`,
     and make up ~71% of the sum; and
     (b) the heavier 192-step march pass caused the RTX 3080 to boost its graphics clock from
     `1,395-1,620 MHz` up to `1,830-1,845 MHz` (recorded in the retained `nvidia-smi` telemetry),
     speeding up the unchanged Context `3` light-bake passes from `0.1196 ms/step` to `0.0992 ms/step`
     (`-0.0204 ms/step`) and canceling out the `+0.0271 ms/step` increase in Context `1`.

### Additional verified findings

- **Second-half trajectory faces away from the cloud; U0P `finalCapture` contains zero cloud pixels:**
  `move(fraction)` (`cloud-volumes-lab-page.component.ts:503-509`) flies from `s = -1200` to `s = +1200`
  looking forward (`pitch = -a`). The camera enters the volume at `frame 463` and exits at `frame 771`.
  In `2026-10-18T12-29-14-912Z-21332/report.json:323-358`, `missingCloudDiffs` has **`changedPixels: 0`
  at checkpoints `659`, `899`, and `1199`**. Consequently, U0P's only image check (`finalCapture` at
  `frame 1199`, `baseline-1.png` / `slow-1.png`) shows only the green planet horizon and blank sky, and
  `mesh-reference-1199.png` is byte-identical to `mesh-missing-cloud-1199.png`.
- **Dawn 65.536 µs ($2^{16}\text{ ns}$) timestamp quantization and `0 -> null` conflation:**
  Without `--enable-dawn-features=disallow_unsafe_apis`, Chromium/Dawn quantizes WebGPU timestamps to
  multiples of `0.065536 ms`. In `baseline-1.json`, 100% of pass durations are exact multiples of
  `0.065536 ms`, and `48.4%` (`2,322 / 4,800`) of Context `1` passes and `85.9%` (`4,121 / 4,800`) of
  Context `5` passes resolve to `0`. `cloud-replay-probe.ts:112` and `gpu-timer.ts:60` use
  `gpuMs > 0 ? gpuMs : null`, turning valid `0` durations into `null`. On the RTX 3080, `34.2%` of
  frames have total GPU time `0`, which would fail `cloud-replay.spec.ts:185` (`> 90%` non-null) if U0
  were run on the NVIDIA adapter.
- **Mid-frame `renderer.info.reset()` inside `EngineService.render()` (`engine.service.ts:725`):**
  `submitStep` resets `info.reset()` before `engine.tick()`. After `tick$` runs the 4 light-bake bands
  (`frameCalls = 1..4`), `EngineService.render()` calls `this.renderer.info.reset()` again, resetting
  `frameCalls` to `0` so the main render reuses `frameCalls = 1, 2`. This avoided `TIMESTAMP_QUERY_LOSS`
  only because `lightTarget` (`id = 3`) and the main render (`id = 1, 5`) have different
  `RenderContext` IDs; any pre-render and in-render passes sharing a context or `ComputeNode` ID will
  collide in `pool.queryOffsets`.
- **Replay configuration gaps:**
  `configure()` forces `bakeBudget = 0` (`cloud-volumes-lab-page.component.ts:496`), so `pendingBake`
  is `false` on all 1,200 frames and `CloudVolumeBakeScheduler` (`bakeBudget = 1` default) is never
  tested. U0P calls `prepare()` with default `mode = 'mesh'` (the legacy box-mesh path) at `640x360`
  rather than `proxy` or `pass`.
- **Statistical, verdict, and contention-gate gaps:**
  - `cloud-performance.spec.ts:166` does not assert `knownSlowdown.verdict === 'slowdown-detected'`, so
    an `unresolved` or `inconclusive` control still exits `0` and writes `status: "passed"` in `run.json`
    (as happened in `2026-10-18T12-21-48-863Z-45580`), polluting `estimateDuration()`.
  - `profileKey` (`cloud-performance.spec.ts:86, 145`) includes `environment.power.level`, so a 1%
    battery charge change between windows triggers a false `profile-mismatch`.
  - `slow` is always run in the middle slot of every round (`['baseline', 'slow', 'repeat']` /
    `['repeat', 'slow', 'baseline']`); retained `nvidia-smi` logs show the GPU downclocks to
    `540-675 MHz` right after `slow`, making the reading immediately after `slow` systematically the
    slowest reference window.
  - `knownContention` only rejects the caller-supplied `competing` flag (and `n = 1`
    `insufficient-rounds`). Observed GPU render time during `known-contention` was `0.1837 ms/step` in
    `12-26-12` (within baseline range) and `0.1459 ms/step` in `12-21-48` (`0.862x`, faster than all
    baselines because the competing compute loop kept clocks boosted at `1,755 MHz`). Raw `nvidia-smi`
    strings are saved but never parsed or gated on (`210 MHz` to `1,845 MHz` across windows).
- **Multi-agent concurrency, port race, cancellation, and disk usage:**
  - No cross-process lock serializes concurrent `ng build demo-app` runs (sharing `.angular/cache`) or
    concurrent GPU access across agents.
  - `run-cloud-feasibility.mjs:47-50` binds port `0` and closes it ~40 s before `cloud-probe-server.mjs`
    finishes `ng build` and listens on that port (TOCTOU race).
  - `run-cloud-feasibility.mjs` lacks `SIGINT`/`SIGTERM` handlers to kill its Windows process tree and
    finalize `run.json`, and `run-cloud-feasibility.mjs:65` does not detect untracked source files
    created mid-run.
  - Retaining both `build/browser` (~17 MB) and duplicate `bundles/*.js` (~16 MB) plus 5 MB raw JSONs
    per window consumed **477.5 MB across 14 runs**.

### Claim support summary and U0/U0P completion gate

| Claim | Status | Basis and remaining gap |
|---|---|---|
| 1. Deterministic scene correctness | **Partly supported** (self-consistency & fault liveness proven) | Fixed-step replay is invariant to wall pauses and bounded same-adapter compute on AMD iGPU (usable while gaming on NVIDIA dGPU). Needs `bakeBudget = 1` coverage, cloud-visible checkpoints for the second half of the journey, and an accepted baseline comparison. |
| 2. Rendering cost | **Weakly supported** (query plumbing proven; attribution defective) | Hardware timestamps resolve without loss, and `Context 1` raymarch cost in `12-21-48` cleanly separated `24` vs `192` steps (`1.725x`), but the flat pass sum hid it behind `Context 3` light bakes (71%) and clock boost. Needs per-pass attribution, unquantized Dawn timestamps, `proxy` mode, cloud-visible capture, and parsed telemetry gates. |
| 3a. Real-time smoothness | **Not measured** | Offscreen `RenderTarget`, `bakeBudget = 0`, and 16-frame queue fences bypass `rAF` cadence, swapchain presentation, and hitch sampling. |
| 3b. Idle-machine performance | **Not established** | External load and P-state clocks (`210-1,845 MHz`) are uncontrolled; `knownContention` is a harness flag, not an observed-idle proof. |

**Decision (2026-10-18 review):** keep the Phase 1–8 architecture, but complete four bounded U0/U0P
fixes before extracting shared runner code:
1. Split GPU pass attribution (`scene/march` vs `bake` vs `output`), stop mid-frame `info.reset()`
   collisions, treat `gpuMs === 0` as valid `0` (not `null`), enable unquantized Dawn timestamps in the
   isolated U0P Chrome args, capture U0P's verification PNG inside the cloud (`frame 540`), drop
   `power.level` from `profileKey`, rotate `slow` across all three round slots, and fail the CLI exit
   code / `run.json` status when a required positive control is not detected.
2. Re-run the `24 vs 192` march-step (or `proxy` mode) sensitivity experiment on the GPU (after asking
   the owner) to confirm `slowdown-detected` on the separated raymarch pass metric with unquantized
   timestamps and parsed `nvidia-smi` telemetry.
3. Add `bakeBudget = 1` (`CloudVolumeBakeScheduler`) and cloud-visible checkpoints to U0 replay.
4. Add a machine-wide lockfile, process-tree cleanup on `SIGINT`/`SIGTERM`, port-binding fix, and
   `build/` vs `bundles/` deduplication before multi-agent use.


## 2026-10-18 — Owner-authorized reusable cloud runner extraction

The owner requested implementation of the reusable test component. Work begins in an
opt-in `triangular-engine/testing` secondary entry point, with typed reactive forms,
versioned test history, exact-version launch URLs, a stable Run latest button, visible
scenario/settings feedback, cancellation/cleanup and structured diagnostic results.
Concrete cloud settings, camera movement and timing providers remain in the demo.
This bounded ownership revision supersedes the earlier demo-only restriction for the
component/contracts; the U0P validity gaps remain open and no new accepted baseline is
claimed. Preserve the separate replay experiment and unrelated working-tree changes.

### Implemented bounded component and cloud integration

- Added the opt-in `triangular-engine/testing` public entry: standalone reactive-form panel,
  generic scenario/suite/result DTOs, a shared adapter executor, bounded URL selection,
  cancellation/timeouts and restoration. No renderer, router, Playwright or UI library
  dependency enters this optional entry or the engine root through it.
- Cloud scenarios now have stable IDs/versions and explicit effective settings. History
  is oldest-first: the short static/moving-camera smoke, then the existing haze-cost
  suite. Run latest selects the final entry; exact-version links retain earlier tests.
- Preserved active scene-control feedback, prevented conflicting manual input, added
  phase/settings progress, copied/downloaded JSON and explicit observer review. A cancelled
  or failed run cannot be visually accepted through the panel.
- Reused the existing FrameSampler for CPU/cadence summaries and suspended the stats
  scene traversal during measurement. Fixed old GPU timestamp replies crossing a reset;
  retained source/attribution limitations rather than calling batched readings frame costs.
- Built and locally installed shared UI 0.0.1 with its newly available reactive-form
  contract. SHA-256 snapshot: 41ceb06e0f3e9a6e966850e21c2ab5dead93c53dea396bdff3e715ac629a58bc.
  The owner then standardized tarball storage: the artifact and its dependency/lock paths
  now live under ignored `ignore/packages/`; no tarball is intended for Git.

Verification: `npm run test:triangular-engine:testing` passed 16 specs;
`npx ng test demo-app --include='**/gpu-timer.spec.ts' --watch=false --browsers=ChromeHeadless`
passed one spec; `npx playwright test -c playwright.runner.config.ts` passed four tests
against the existing app host. These exercised URL autostart, static/moving scenarios,
button equivalence, exact-version retention, stale-version rejection, latest selection,
cancellation/restoration and real shared-slider keyboard/form wiring. Initial browser
assertions targeted collapsed controls; corrected them and opened quality settings
while running. A Sass namespace collision was corrected before the passing run.

Library packaging and the demo host compiled successfully, including the final library
rebuild after documentation and archive-path updates. Local smoke evidence is
`artifacts/test-runner/cloud-smoke.json`; UI screenshot `artifacts/test-runner/cloud-runner.png`.
The browser used software WebGL2 for functional checks: this is not GPU performance
acceptance. No controlled-machine baseline, full haze-cost performance acceptance,
aerodynamic consumer adapter, queue, or idle-agent wakeup was completed.

performance:

```json
[
  {"id":"cloud-runner-smoke-v1","url":"http://triangular-demo.localhost:4200/cloud-volumes-lab?testSuite=cloud-runner-smoke&testVersion=1&testProfile=human-observed&testAutoStart=1","status":"runnable-functional"},
  {"id":"cloud-haze-cost-v1","url":"http://triangular-demo.localhost:4200/cloud-volumes-lab?testSuite=cloud-haze-cost&testVersion=1&testProfile=human-observed&testAutoStart=1","status":"runnable-diagnostic"}
]
```

[Run latest diagnostic test](http://triangular-demo.localhost:4200/cloud-volumes-lab?testSuite=cloud-haze-cost&testVersion=1&testProfile=human-observed&testAutoStart=1).

Final library rebuild passed after the DTO/panel changes; demo host build also passed.
A final cloud-adapter review made planet spin angle explicit in resolved inputs, so a
manual pre-run spin cannot silently alter the fixture. All four browser integration
tests passed again after that bounded adapter change. Package-storage audit found all
archives under ignored `ignore/packages/`, with active dependency paths resolving and migrated hashes
preserved; producer verification outputs are retained separately from old snapshots.

## 2026-10-18 — Consumer testing skill

Added `triangular-engine-testing` alongside the existing package skills, with a
game-owned adapter recipe. The existing asset rule ships both under
`skills/triangular-engine-testing/`. Linked it from the main engine skill, package
README, testing guide and agent guide. The instructions distinguish functional
checks, diagnostic timing and human acceptance, and describe direct file use or
copying the folder into a consumer's `.agents/skills/` directory for discovery.
Verification: the skill-creator validator passed, the adapter example type-checked
against the built public testing declarations, and six local documentation links
resolved. `npm run build:triangular-engine` passed. `npm pack --dry-run --json`
confirmed both skill files are included; their built hashes match the source.
No runtime code changed and no new tarball was created for this documentation work.

## 2026-10-18 — Morph integration feedback review

The second integration adds game-owned morph settings, a host/adapter boundary,
static states 0 / 0.5 / 1, a 0 → 1 → 0 sweep, functional smoke history, cancellation
and restoration. The owner's pasted feedback is sufficient to review the work;
this section records the decisions without requiring another handover document.

Accepted shared changes from the integration:

- `ready(context, scenario)` receives the applied scenario. Earlier adapters that
  only use context remain valid TypeScript implementations. Updated the packaged
  skill's game driver recipe to inspect expected settings in readiness and restore.
- `TestMetric.optional` can describe additional unavailable measurements with an
  `unavailableReason`. A performance case still needs a required metric, and empty
  required or non-finite samples remain invalid. Optional must not excuse missing
  measurements central to the experiment. The current morph adapter reports real
  cadence/backlog metrics and explains its missing GPU query in limitations.
- The panel displays individual check outcomes/details and case/run errors.
- Browser discovery uses `**/*runner.spec.ts`, covering both integrations and later
  runner specs without growing an explicit filename list.

Documentation clarifications and deferred design:

- Visual review depends on `requiresVisualReview` or the `human-observed` profile,
  independently of functional/performance purpose. Keep the current explicit
  semantics; add regression coverage and document them rather than changing defaults.
- Control locking belongs to the host, which knows its forms, canvas controls,
  keyboard input and competing actions. A disabled fieldset alone cannot lock all
  these inputs. The runner should not mutate arbitrary page controls.
- Async error subscriptions are a useful next API candidate. Define registration,
  per-run unsubscription, failure versus cancellation, and cleanup-phase errors
  before adding one. Until then hosts must forward engine/worker errors to adapters;
  there is no shared hook or global error interception.
- Settling and sweep helpers need a small clock/subscription contract with abort,
  stall detection and rendered keyframe guarantees. Keep the current page helpers
  until that contract is designed; streaming stability predicates stay game-owned.
- Keep full JSON outside agent conversation context, including failures. Report a
  short verdict/check/metric/limitation summary with the artifact path and exact
  rerun link, then read raw samples on demand. This does not add durable transport.

### Streaming blocker and retained evidence

`artifacts/test-runner/morph-diagnostic.json` already contains a failed run from
2026-10-18T18:45:23.541Z with automation `fail`, performance `inconclusive` and
pending visual review. Its error is `Texture stream: Error: Material page table
needs a resident root.` The assertion originates in
`projects/triangular-engine/terrain/materials/tiles/terrain-material-tile-gpu.ts`.
This corrects the feedback's claim that no result was retained: there is failed
evidence, but no successful browser/performance acceptance. The integration agent
also reported the error on a plain load; this review has not independently proved
its history or root cause. Do not label it a confirmed race without that evidence.

The next terrain task should reproduce on a plain page load, retain the call stack,
identify whether root residency is lost during initial load or invalidation, add a
focused regression and rerun both morph browser suites. Terrain runtime code is
unchanged by this feedback review. Broader edge/altitude/horizon scenarios follow
successful basic integration.

[Launch latest morph diagnostic (currently blocked by material streaming)](http://triangular-demo.localhost:4200/cell-planet-morph-streaming?testSuite=morph-streaming-morph-cost&testVersion=1&testProfile=human-observed&testAutoStart=1).

Review verification: the testing entry passed 20 headless unit specs, the morph
adapter passed 12 headless specs, and Playwright listed six tests across the two
runner integrations using the new glob. All four cloud browser regression checks
passed against the existing host (47.6 seconds). The full library build passed;
the updated adapter recipe type-checked against the packaged public declarations.
The skill validator passed and both built skill files match their sources by hash.
No successful morph browser run or GPU performance acceptance is claimed. No
terrain runtime edits, commits, publishing, new tarballs or daemon transport were
part of this review.

## 2026-10-18 — Documentation ownership and evidence standard consolidated

The reusable API remains defined by `projects/triangular-engine/docs/testing.md`,
its packaged skill and this plan/runbook pair. Early runner/DTO/cloud-extraction
proposals are historical context, not a second API or executor specification.
Generic experiment-history requirements now live in `docs/plans-and-runbooks.md`:
literal append-only performance arrays on new/touched documents, actual latest
and exact-version links, explicit blockers, and separate automated/performance/
human verdicts. No broad history backfill or manifest-viewer implementation was
performed. Full result artifacts plus compact summaries remain the current
token-efficient handoff; queues, persistent completion delivery and idle-agent
wakeups are still deferred. This documentation update did not rerun benchmarks or
change the runner's behavior.

## 2026-10-18 — Durable result transport: design and brief

Trigger: the atmosphere-lab suites (Runbook 049) were run in a visible browser tab,
but nothing reached disk, so an agent could not read them. The skill only covers
launch and verdicts, not where results live or how to read a large JSON cheaply.
Owner expectations: browser runs save to the machine automatically, repeat runs of the
same suite persist, results carry a code hash so stale runs are recognisable, and the
mechanism is reusable by at least two other games without per-app code.

Design (proposed, not implemented):

- **Receiver.** A dependency-free Node script shipped as a bin in the package. It
  listens on localhost, accepts POSTed results and writes
  `artifacts/test-runs/<suite>@v<version>/<timestamp>_<profile>_<hash>.json` plus one
  summary line per run in `artifacts/test-runs/index.jsonl`.
- **Starting it without a manual step.** Spike first: a `proxy.conf.js` for `ng serve`
  is Node code run at server start; it may launch the receiver and forward
  `/__triangular-test-sink` same-origin (no CORS). If that does not hold, fall back to
  one npm script that starts the dev server and the receiver together.
- **Runner.** Opt-in sink (input and/or URL param), default same-origin path, dev only.
  If the receiver is unreachable the panel says "result not saved, use Download JSON"
  and never fails silently. Needs a changelog entry and spec; owner approves the public
  input before it lands.
- **Fingerprint.** Computed by the receiver (the browser cannot read source): git
  `HEAD` plus a hash of the working-tree diff limited to configured paths (engine and
  the page folder, from one small repo-root config file). Stamped on every run; old
  runs are marked stale in summaries, not excluded, so before/after history stays.
  Deliberately coarse: any edit under those paths changes it.
- **Reading.** A summary bin prints a compact table from `index.jsonl` (date, profile,
  hash and stale flag, three verdicts, median/p95/max per scenario, failed checks
  only). Agents read the table first and the full JSON only on failure.
- **Per-app cost.** Adapters stay per game. A game adds a two-line proxy setup and an
  optional config file; the skill carries the copyable recipe. No private repo names.
- **Rejected.** File System Access API (Chromium only, per-session click, no hash);
  agent-run Playwright only (headless GPU timings are not meaningful hardware numbers).

Done when: a visible-tab run of an atmosphere-lab suite appears under
`artifacts/test-runs/` with no manual step, repeat runs accumulate, the summary bin
shows them with fingerprint and stale state, the skill and `docs/testing.md` say where
results live and how to read them, and specs cover receiver, runner sink and summary.
Not done: all of it. Nothing was committed.

## 2026-10-18 — Durable result transport: implementation

Spike result: `ng serve demo-app` with `proxyConfig` pointing at `projects/demo-app/proxy.conf.cjs`
loads that Node file at server start; it spawns the receiver and forwards the
same-origin `/__triangular-test-sink` to it. A POST through port 4222 was written under
`artifacts/test-runs/` and indexed, and the receiver exited when the dev server was
stopped. Angular loads the config more than once, so the receiver treats `EADDRINUSE` as
"already running" and exits quietly. No npm-script fallback was needed.

Built: `projects/triangular-engine/bin/` with `triangular-test-receiver.mjs` (also
computes the fingerprint), `triangular-test-summary.mjs`, `triangular-test-proxy.cjs`
and a Node spec (`npm run test:triangular-engine:sink`); repo-root
`triangular-test.config.json`; the runner's opt-in `resultSink` input and
`DEFAULT_TEST_SINK_PATH` export (specs in `test-runner.component.spec.ts`); docs, skill
and changelog; the atmosphere lab passes `[resultSink]="true"`. The `resultSink` input is
a new public API; the owner approved it explicitly on 2026-10-18.
Choices: reviews re-post the same run, so an accepted review produces a second file and
index line with the same `runId`; fingerprint covers untracked files too. Not verified
here: a real visible-tab atmosphere-lab run end to end (needs the owner's browser).

## 2026-10-18 — Durable result transport: visible-tab verification

The owner ran both atmosphere-lab suites in a visible tab: `POST /__triangular-test-sink`
returned 200, run files and `index.jsonl` landed under `artifacts/test-runs/`, and the
summary showed current and `STALE` fingerprints correctly. Gap found: `npx
triangular-test-summary` returns an npm 404 inside this repository because the bin only
resolves from an installed package. Added root scripts `npm run test:summary -- <args>`
and `npm run test:receiver`; docs and skill now name the in-repo versus consumer command.

