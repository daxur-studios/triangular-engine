# 038 — Agent testing implementation plan

Status: M1 implementation in progress; core browser slice and acceptance smoke pass.
Updated 2026-09-18. Design context and original reviews: [037](037_agent_driven_visual_and_performance_testing.md).

## Goal and progress

Let a text-only agent write and diagnose ordinary browser tests that can find a 3D
object, frame it, move around it and save trustworthy evidence. Later milestones
add reviewed baselines, performance comparisons and remote review. Generic tooling
provides controls and evidence; each feature still declares its own expectations.

This checklist is the progress source of truth. Check a milestone only when its
exit evidence is linked here; partial progress belongs in the M1 checklist below.

- [ ] **M1 — Working agent test:** discover, focus, orbit, click and capture a simple scene; injected failures are detected.
- [ ] **M2 — Trustworthy visual regressions:** persistent reviewed baselines, environment compatibility, broader camera/bounds cases and a second feature adapter.
- [ ] **M3 — Performance history:** raw samples, fast smoke and repeatable reference runs; detect deliberate slowdowns against accepted baselines.
- [ ] **M4 — Remote review:** exact-build HTML reports, motion recordings and authenticated access that works from a phone.
- [ ] **M5 — Easier authoring:** record/replay actions, multi-view/contact-sheet helpers, parameter sweeps and suite selection.
- [ ] **M6 — Optional agent services:** WebMCP uses the same adapter; local vision reviews saved evidence with measured accuracy. Neither is required to run tests.

Implementation pass in progress. The current vertical slice adds the opt-in
`agent-reference-v1` fixture, stable object handles, typed bridge, real engine
render-completion event, Playwright config/spec and capture attachment. The demo
build passes. The first Playwright run reaches the test but currently exits as a
failed test without a useful terminal diagnostic and leaves the managed dev
server alive; this is retained in `playwright-report/` and `test-results/` for
follow-up. The corrected run now passes the single 960x540 smoke spec in 2.3s;
the report includes the captured PNG attachment. The current suite now passes
four specs: the 960x540 interaction smoke, reload/unknown/duplicate/readiness
failure checks, a 540x960 transformed-box check, and an opt-in/capture
repeatability check. The suite now also asserts 30 completed render frames with
an unchanged camera pose and compares captures from two fresh browser contexts.
The production build passes, and the adapter gate uses Angular dev mode so the
query cannot enable it in production. Render completion is now
emitted only after the actual renderer/pipeline/overlay calls return; the test
adapter waits for that event rather than a browser animation frame.

The passing smoke test also attaches `m1-run-manifest.json` with fixture/run
identity, command, browser/viewport, completed frame and capture metadata,
error sources (`pageerror`, `console.error`, failed resources), and explicit
`baseline: not-created`. Source/build hashes are recorded as unavailable until
the runner gains a build digest step. Reports and test results are retained for
review and may be cleaned after copying them to durable CI storage; no automatic
baseline promotion is performed.

The current implementation evidence is five passing Playwright specs, including
30 rendered-frame pose stability, portrait framing, bounded injected failures,
fresh-context capture equality and production adapter absence. Development and
production demo builds plus the library build pass. M1 remains open until the
structured run manifest/build identity, full failure-source collection and clean
artifact retention policy are implemented and linked. This slice does not claim
performance safety, aesthetic approval or completeness of feature coverage.

## Decisions settled for M1

- Use Playwright TypeScript `*.spec.ts` and a typed `scene` fixture. JSON stores
  inputs, metadata and results, not executable test steps. No custom DSL/runner.
- Start with Chromium, one worker, DPR 1 and static primitive geometry. Record the
  actual browser/backend. Hardware acceleration is not a prerequisite for M1;
  software rendering must be identified and cannot establish GPU performance.
- Extend `/scene-inspection-lab` with an explicitly selected test fixture, rather
  than building a separate renderer or changing its ordinary demonstration.
- Register the owning engine, camera controls and stable object handles explicitly.
  Do not use `EngineService.activeInstance`, runtime UUIDs or name paths as selectors.
- Establish a working capture early, then grow only the types/data needed for M1.
  Full JSON schemas, storage services and general simulation stepping come later.
- No performance gate in M1. Store evidence on disk and use Playwright's report;
  no dashboard, remote deployment, Ollama, WebMCP or baseline acceptance tooling.

No user clarification is required to start M1. Reference hardware, long-term
artifact hosting and product-specific budgets are decisions for later milestones.

## Read first and proposed file ownership

Read root `AGENTS.md`, the library README/agent guide and
`projects/demo-app/src/app/AGENTS.md`. Preserve concurrent work; never commit.
The following are proposed locations, not existing capabilities:

| Location | Responsibility |
| --- | --- |
| `playwright.config.ts`, `tests/scene/tsconfig.json` | Isolated browser test configuration/types; do not mix Playwright tests into Karma discovery. |
| `tests/scene/fixtures/scene.fixture.ts` | Typed Playwright fixture, browser bridge, lifecycle and attachments. |
| `tests/scene/specs/object-inspection.spec.ts` | The example agent-authored test and acceptance cases. |
| `projects/demo-app/src/app/testing/scene-test-adapter/` | Small typed protocol, explicit registration, object registry and host-side commands. No Playwright imports in browser code. |
| Existing `pages/scene-inspection-lab/` | Opt-in `agent-reference-v1` fixture and deterministic fault hooks. |
| `projects/triangular-engine/src/lib/engine/` | Only necessary reusable primitives, e.g. render-completion notification; colocated unit tests and intentional exports. |
| `artifacts/scene-tests/<run-id>/` | Ignored run manifest, structured checkpoints, PNGs/diffs, errors and Playwright report. |
| `tests/scene/README.md` | Exact setup/run/rerun commands, supported helpers, authoring example and limitations. |

Inspect these current implementations before editing: `engine.service.ts`,
`screenshot.service.ts`, `inspection/scene-inspection.ts`, `fps.controller.ts`,
`orbit-controls.component.ts`, the inspection lab and `angular.json`/`tsconfig.json`.
Demo imports currently resolve to library source via path mappings. Verify the
actual build path; `npm start` does not serve the demo. Reuse normal app rendering.

## M1 implementation sequence

### 1. Boot, capture, retain evidence

Add `@playwright/test` as a development dependency with the lockfile update and
isolated test configuration. Provide `npm run test:scene -- ...` as a thin wrapper
around Playwright, plus documented browser installation and headed-debug commands.
Use a test build configuration with explicit adapter enablement; the adapter must
be absent/disabled in normal production sessions, even if a query flag is supplied.
Bind any test server to loopback. A test query selects the fixture, not authorization.

For the first capture, start the real lab through Playwright's managed server.
Use a static test build without live reload for M1 completion evidence; a dev server
may be used during iteration if labelled accordingly. Verify the source/lock hashes
before/after building and retain a build digest so concurrent changes cannot silently
relabel the run. Reuse an existing server only when its build identity is verified.

Create `agent-reference-v1`: a radius-5 sphere and a side-0.5 box at distinct,
non-overlapping positions, plus a translated/rotated parent for a box variant.
Use fixed materials, lights, background, settings and no external assets, physics,
workers or animation. Publish the actual transforms/digest. Register IDs
`large-sphere`, `small-box` and `transformed-box`; human-readable labels are separate.
Keep the ordinary lab UI/fixture intact outside test mode.

Produce one nonblank normal-quality canvas PNG and initial JSON metadata before
expanding the API. This is a checkpoint, not M1 completion.

### 2. Small typed adapter and reliable completion

Expose one versioned bridge in enabled sessions. Keep browser serialization inside
the fixture so specs never reach into Angular internals or use raw `page.evaluate`.
Every call specifies the scene ID (`inspection-reference`); the bridge binds it to
the host's injected engine. One in-flight mutating command per scene; reject or
serialize overlap consistently. Remove registrations/subscriptions on destruction.

Implement this bounded contract; document exact exported signatures in the README:

| Helper | M1 contract |
| --- | --- |
| `discover()` | Version, scene/fixture identity, supported capabilities, stable IDs/labels, bounds and bounds provenance. Cap lists and report truncation. |
| `reset()` / `ready()` | Restore fixture, camera and controls; wait for registered objects, valid camera/canvas dimensions and a successful rendered frame. |
| `camera.focus(...)` | Stable target ID, named view or azimuth/elevation, padding; return actual pose, world/projected bounds, clipping/fit status and rendered frame ID. |
| `camera.orbit(...)` | Static target, fixed conservative radius, sweep and elevation; in-app path execution with resolved poses and checkpoint frame IDs. |
| `projectToScreen(...)` | Target centre and projected bounds, canvas-local CSS coordinates and page viewport CSS coordinates, in-frustum flag; occlusion `unknown` unless measured. |
| `capture(checkpoint)` | Normal-quality PNG plus checkpoint state/frame metadata and accumulated errors. Node fixture writes the returned image as an artifact. |
| `diagnostics()` | Bounded errors/events with source, phase, request/checkpoint and timestamp; no image understanding claim. |

Use a consistent serializable result/error shape with protocol version, request ID,
scene ID and effective state. Required failures reject/fail the Playwright test with
that diagnostic payload. Minimum codes: `TARGET_NOT_FOUND`, `DUPLICATE_ID`,
`INVALID_BOUNDS`, `UNSUPPORTED`, `FRAMING_FAILED`, `TIMEOUT`, `RUNTIME_ERROR`.
Default command timeout: 10 seconds; default test timeout: 60 seconds. Include
pending conditions and last known state on timeout; do not hide errors with retries.

**Render completion is the critical integration point.** `tick$`, `postTick$` and
`beforeRender$` currently fire before rendering; a tick can also skip rendering.
Add a minimal notification/counter at the successful end of the engine's actual
render path, including pipeline/overlay work. Missing renderer/camera, skipped,
failed or context-lost frames must not advance it. Reuse it for forced renders too.
This means CPU-side render completion, not measured GPU execution or compositor
presentation. Capture must independently demonstrate it contains the intended state.

Synchronize camera position/quaternion, controls target and projection. Suspend
auto-rotate/follow and drain/reset pending damping through supported controls APIs;
simply disabling input does not stop updates. Verify the requested pose across two
successfully rendered frames within documented tolerances. If controls cannot be
coordinated, return `UNSUPPORTED`/`FRAMING_FAILED`, not apparent success. Restore
temporary controls settings and prior state in `finally`, including timeout/failure.

Collect Playwright `pageerror`, browser `console.error`, failed required resources
and the engine's `error$`; shader/render errors may be logged rather than thrown.
Deduplicate while retaining sources. RxJS subscriber errors may surface asynchronously,
so do not assume `safeEmit` catches them all. Listen before navigation and through
the final checkpoint/teardown, not just while a helper is awaiting a promise.

### 3. Focus, orbit and real input

M1 supports static meshes/groups and perspective cameras only. Declare orthographic,
skinned/instanced/displaced bounds, moving targets and arbitrary simulation stepping
unsupported until M2 or a later explicit extension.

Use world +Y as up; azimuth 0 views from +Z toward the bounds centre, positive
azimuth moves toward +X; elevation is positive toward +Y. Named
`front-right-above` is azimuth 45 degrees/elevation 30 degrees. Support `front`,
`right` and numeric angles; reject poles outside the supported controls range.
Padding defaults to 1.2, must be at least 1, and multiplies required framing extents.
Do not silently change FOV, near/far or control limits.

Update world matrices and compute finite, nonempty bounds for the selected target
and descendants. Fit both viewport axes and check all eight bounding-box corners
against the actual camera's projection and clipping planes. A conservative enclosing
sphere is sufficient for the first orbit: choose one radius that fits the entire
path and keep it fixed. Other objects must not affect the selected target's fit.
Extract pure math with meaningful unit tests; avoid premature public API expansion.

Support a deterministic orbit at 30-degree checkpoints through 360 degrees, looking
at a frozen target centre. Advance inside the app, wait for render completion and
retain each checkpoint. This is a stepped inspection orbit, not a real-time motion
or performance experiment. Real-time interpolation/recording belongs to M4.

Map projection to both canvas CSS pixels and Playwright viewport CSS pixels using
the current canvas rectangle; distinguish those from drawing-buffer pixels/DPR.
Reject behind-camera projections. Do not claim the projected centre is unobstructed.
For the unobstructed reference box, dispatch a real Playwright click at the returned
position and assert a fixture-owned pointer/raycast hit event identifies `small-box`.
The expected hit cannot be supplied by the projection helper itself.

### 4. Evidence, failure tests and authoring handoff

Use PNG capture with the actual pipeline, unchanged dimensions/DPR/quality and no
accumulation/LOD elevation. Default to canvas capture after confirmed stable state;
if using `ScreenshotService`, explicitly pass the registered engine, `samples: 1`,
`multiplier: 1` and no preparation hook. Account for its extra forced render in
metadata. Document excluded DOM overlays; add page captures only for UI tests.
Check pixels as well as scene facts: bounds and draw counts cannot detect blank PNGs.

Save run/fixture/build/dependency identities, test source hash, browser/backend,
viewport/DPR, effective camera/controls/settings, frame IDs, checks, errors and PNG
references. Attach the JSON and images to Playwright's HTML report and save a compact
machine-readable summary with exact rerun command. M1 needs no custom HTML renderer.
Capture source diff/relevant untracked test inputs or an immutable source snapshot;
build/run evidence must not require a commit. Record unavailable environment fields.

Run the unchanged built fixture twice in fresh browser contexts and report image
difference measurements. For this static M1 fixture, try exact pixel equality first;
any relaxation must document measured noise and still detect the visual fault below.
Do not auto-update snapshots or call the first image an accepted baseline. Keep a
run-local reference for repeatability only. Report structural results separately
from visual approval (`needs-review` until reviewed). Formal baseline policy is M2.

Add deterministic test-only fault hooks: hide/change the box, skip rendering after
a camera request, throw during the registered render pipeline, and throw in a tick
subscriber. Each must cause the appropriate check to fail; expected-failure harness
tests assert that diagnosis and remain green themselves. Restore hooks in `finally`.
Run no-fault smoke afterward to prove cleanup. Do not change real renderer behavior
to manufacture passing tests or suppress console errors wholesale.

Document one short complete example: import the fixture, discover, focus, project/
click, orbit, capture, assert facts/errors and read the summary. A text-only agent
should be able to copy/adapt it without computing camera coordinates or inspecting
images. Record known limitations and update the library agent guide with real commands.

## M1 completion checklist

- [ ] **M1.1 Boot:** one documented command runs Chromium against the real test build and saves a nonblank capture; normal production has no usable adapter.
- [ ] **M1.2 Address/control:** IDs survive reload; unknown/duplicate IDs fail clearly; focus and projection work for both object sizes and transformed groups.
- [ ] **M1.3 Camera/input:** focus stays stable 30 rendered frames later; a 360-degree orbit fits the target at every checkpoint in 960x540 and 540x960 canvases; a real click hits the box.
- [ ] **M1.4 Evidence:** two same-build runs retain JSON, images and difference results; rerun/build identity is recorded; no accepted baseline is silently created.
- [ ] **M1.5 Failure detection:** visual mutation, stale render, render error, asynchronous subscriber error and readiness timeout are diagnosed; teardown restores clean operation.
- [ ] **M1.6 Handoff:** isolated browser tests and relevant unit tests pass; library/demo builds pass; authoring guide and measured limitations are linked here.

Run the narrow unit tests for changed engine helpers, then the browser acceptance
suite and library/demo builds per repository rules. Verify browser specs are excluded
from Karma and application compilation. Do not claim success for checks that cannot
run. Record unrelated pre-existing build failures separately. Repeat broader checks
only if new changes/failures justify it.

If same-build captures are noisy, diagnose clocks, controls, build drift, capture and
renderer backend first. Preserve failing evidence and mark repeatability inconclusive.
Do not abandon the architecture after two differing images or loosen tests merely
to mark M1 done. Stop at M1 completion and report evidence; do not begin M2 implicitly.

## Later milestone boundaries

| Milestone | Exit evidence / decisions needed then |
| --- | --- |
| M2 | Versioned baseline manifests with deliberate maintainer acceptance, pinned artifacts, profile compatibility and no-baseline handling. Orthographic/framing edge cases and a second adapter work without changing the runner. Reuse terrain seam probes here where useful; feature probes retain their semantics. |
| M3 | Choose the reference machine and budgets from real variance. Store raw intervals, p50/p95/p99, hitches, metric sources and all repeats. Separate ~5-second smoke from proposed 10-second warm-up + 3x60-second reference runs. An injected slowdown fails; environment mismatch/noise cannot pass. No recordings/inference during benchmarking. |
| M4 | Smooth real-time orbit/pan/zoom, checkpointed video and real-input coverage. Authenticated report opens on a phone, identifies the exact build and separates viewing-device performance from host measurements. Choose hosting/access then. |
| M5 | A manually recorded investigation becomes a reproducible test; multi-view reports, sweeps and relevant-suite selection simplify authoring without a custom language. |
| M6 | WebMCP transport passes the same contract tests. Optional Ollama/vision setup is evaluated on known defects/clean cases; findings cite evidence and never waive failures or promote baselines. |

For M3, `showFPS: false` hides UI but currently does **not** stop
`FPSController.recordFrame` or its periodic traversal. Decide explicitly whether to
measure the production telemetry overhead or introduce a supported instrumentation
switch; record the choice equally for reference/candidate runs. Sample low-overhead
real wall-clock intervals separately from CPU render duration. Do not infer GPU time
from either, or claim that `tick(time)` alone synchronizes every subsystem clock.

## Pasteable Luna handoff

> Implement M1 only from `docs/runbook/038_agent_testing_implementation_plan.md`.
> Read its linked design context and repository instructions first. Use ordinary
> Playwright TypeScript tests and the real engine. Complete the M1 checklist with
> measured evidence, keeping later milestones deferred. Preserve concurrent changes
> and never commit. Update checklist items only after verification and link the run
> summary, exact commands and limitations. If blocked, retain partial evidence and
> identify the specific missing capability; do not silently weaken acceptance.
