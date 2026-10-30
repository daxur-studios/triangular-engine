# 037 — Agent-driven visual and performance testing

Status: proposed design; implementation has not started. Updated 2026-09-18.

Implementation order and progress now live in
[038 — Implementation plan](038_agent_testing_implementation_plan.md).
Its bounded M1 handoff supersedes the original P0/P1 ordering and specifies which
capabilities to implement first. This document retains the broader design and reviews.

## Purpose and decision history

Make changes reviewable remotely, with repeatable behaviour, visual evidence and
performance comparisons. The system must be usable by text-only coding agents
to create, run, diagnose and maintain tests. Terrain is one demanding example;
the infrastructure must also support animation, physics, materials and ordinary UI.

The discussion reached these decisions:

1. Unit tests alone do not establish that an interactive scene still works,
   looks right and runs well during camera movement.
2. Build generic verification infrastructure with feature-specific expectations.
   No generic tool can infer every intended behaviour or prove visual quality.
3. Playwright operates the browser; a Three.js/engine adapter supplies precise
   control and facts; measurements establish performance. These are complementary.
4. WebMCP is a later transport for agent access. Local vision is a later reviewer,
   requiring separate model/runtime setup, potentially Ollama.
5. Store reproducible inputs, immutable run evidence and deliberately accepted
   baselines. Today's measurement alone cannot establish improvement or regression.

## Starting point and ownership

Verified in this repository at drafting time:

- [Scene inspection](../../projects/triangular-engine/src/lib/engine/inspection/scene-inspection.ts)
  already returns bounded object, camera, renderer and warning data.
- [ScreenshotService documentation](../../projects/triangular-engine/docs/services.md)
  describes frame capture; normal regression captures must preserve runtime quality.
- [Terrain fixture/bookmarks](../../projects/demo-app/src/app/pages/cell-planet-u0-fixture.ts)
  demonstrate reproducible setup and camera anchors, not a generic test runner.
- [Package scripts](../../package.json) include Karma tests and some non-rendering
  scenario runners, but no Playwright dependency or established browser test command.
- The existing `performanceMonitor` component is a shell, not a benchmark recorder.

Reuse [021 — scene vision](021_agent_scene_vision_feedback.md) for inspection/capture
boundaries. [035 — terrain delivery](035_unified_cell_terrain_delivery.md) remains
the authority for terrain-specific acceptance. This runbook owns shared test
infrastructure; it does not replace either feature requirements or unit tests.

Keep browser automation, report generation and artifact storage in repository test
tooling. Keep scene registration in the host app. Reusable engine inspection/control
primitives may live in the library with intentional public exports, docs and tests.
Playwright, WebMCP, Ollama and model clients must not become core engine dependencies.

## Architecture and tools

```text
text-only agent / human
  -> scenario files + CLI / typed test helpers
  -> Playwright runner
  -> versioned scene adapter in the real application
  -> engine controls, diagnostics and measurements
  -> JSON results + captures + comparison report

later: WebMCP -> same adapter; vision service -> saved captures -> advisory findings
```

Playwright supplies navigation, real input events, console/network error collection,
screenshots, video and traces. Use a typed wrapper around
[`page.evaluate`](https://playwright.dev/docs/evaluating) to call the adapter and
return serializable results. Keep page execution details out of individual tests.
DOM selectors address UI; semantic scene IDs address objects inside the canvas.

[Unreal automation](https://dev.epicgames.com/documentation/unreal-engine/automation-test-framework-in-unreal-engine)
combines functional tests and screenshot comparisons;
[Unity testing](https://docs.unity.com/en-us/engine/6000.6/manual/scripting/test-framework-introduction)
also supports runtime and performance testing. Adopt that layered pattern rather
than expecting an image-understanding model to replace the test infrastructure.

## Contract for agent-accessible capabilities

The following are proposed capability groups, not existing API names. Start with
TypeScript types, units, examples and error codes from one contract; extract JSON
schemas as persistent data contracts mature after the first working test.
Agents must discover supported capabilities instead of guessing methods.

| Capability | Required behaviour / structured output |
| --- | --- |
| Discover | List scenes, stable object IDs, fixture IDs, camera bookmarks, settings, commands, probes and metric definitions. Include schema versions and limitations. |
| Reset/setup | Load a versioned fixture, seed and settings; reset app-owned random state, workers and simulation state. Return effective inputs and fixture digest. |
| Readiness | Await named conditions such as assets loaded, pending work drained and a rendered frame after setup. Return timeout diagnostics and queue counts. |
| Camera | Set pose/projection, focus bounds, orbit, pan, dolly, change zoom, and play timestamped paths. Declare coordinate space, units, up axis and interpolation. |
| Time | Pause/step a supported simulation for deterministic checks; run real time for motion and performance. Report unsupported controls explicitly. |
| Inspect/probe | Return bounded scene facts, settings, bounds, projected positions, warnings and registered domain checks with tolerances and units. |
| Capture | Capture the actual render pipeline at a named checkpoint, with camera, frame ID, time and settings attached. Return artifact references. |
| Measure | Start/stop in-page sampling, report metric source, samples, validity and environment. Avoid a browser round trip for every frame. |
| Record/replay | Later, record camera state and semantic actions with fixture/settings so useful manual investigations become scenarios. |

Every request targets an explicit scene/viewport ID; never select the most recently
created engine implicitly. Results include request ID, scene ID, protocol version,
effective state and typed errors. Bound object lists and report truncation.
Use stable application IDs, not Three.js runtime UUIDs, as cross-run selectors.
Register IDs explicitly against live objects; name paths are diagnostic labels, not
inherently stable identities. Reject duplicate registrations. Projection helpers
return both canvas-local and page viewport CSS coordinates, separate from framebuffer
pixels, so agents can dispatch real clicks without doing camera mathematics.

Camera commands must coordinate with active controls, damping and follow behaviour;
a direct position write that the next tick overwrites is not a completed action.
Commands complete after the intended state reaches a rendered frame, or fail with
actual versus requested state. Paths execute inside the app, not as timed external
mouse calls. Retain separate pointer/wheel/touch tests to validate real controls.
An engine tick is not render completion: notify only after a successful actual render,
and verify settled controls. Collect engine errors as well as browser exceptions,
console errors and required-resource failures; not every rendering error is thrown.

Readiness is an explicit app contract: network idle or an arbitrary sleep does not
prove shader compilation, streaming or simulation readiness. Continuous scenes
declare a bounded initial readiness condition. During a streaming stress journey,
do not wait for every queue to drain and accidentally hide transient failures.

Expose the adapter only in explicitly enabled test/development sessions. Register
typed actions rather than an arbitrary remote JavaScript execution command.
The adapter must exercise production rendering and behaviour, not a replacement
renderer that can pass while the application fails.

### Object framing and inspection helpers

Agents should be able to request "look at the small box from above" without
calculating coordinates or guessing distances. M1 in [038](038_agent_testing_implementation_plan.md)
starts with static perspective focus and stepped orbit; the broader cases below
follow in M2/M4/M5, before WebMCP or vision is required.
Proposed calls below are illustrative, not implemented APIs:

```ts
await scene.camera.focus({ target: 'small-box', view: 'front-right-above', padding: 1.2 });
await scene.camera.focus({ target: 'large-sphere', azimuthDeg: 45, elevationDeg: 20 });
await scene.camera.orbit({ target: 'small-box', sweepDeg: 360, durationMs: 8000,
  elevationDeg: 25, framing: 'fit-whole-path', checkpointsDeg: [0, 90, 180, 270] });
await scene.camera.inspectViews({ target: 'small-box',
  views: ['front', 'back', 'left', 'right', 'above', 'front-right-above'] });
```

- **Find:** discover objects by stable ID, label, type or tag, with size and bounds
  summaries. Ambiguous names return candidates, never an arbitrary selection.
- **Focus/frame:** resolve the selected object's current world-space bounds,
  including the chosen descendants and transforms. Frame that target independently
  of other scene objects: a large sphere must not determine the small box's zoom.
  Support a group or explicit region as a target and a documented padding ratio.
- **Choose angle:** expose named views and azimuth/elevation relative to a declared
  world or object frame. Define front/right/up, angle direction and behaviour at
  the poles. Record the resolved world pose so the view can be reproduced exactly.
- **Fit:** account for both canvas axes, aspect ratio and camera projection. Resolve
  perspective distance or orthographic zoom from the bounds and padding. Validate
  projected bounds after rendering. Check near/far clipping and control limits;
  any allowed adjustment must be explicit and recorded, otherwise return a typed
  framing failure. Do not silently change FOV or rendering quality to make it fit.
- **Orbit:** keep looking at the target while following a deterministic path.
  Default to a conservative fixed distance/zoom that fits the full path, avoiding
  unrequested zoom pumping. Offer explicit tight-fit or fixed-distance modes, and
  frozen-centre versus moving-target tracking. Save resolved path and checkpoints.
- **Inspect views:** compose focus, readiness, capture and scene facts for a small
  named angle set. Return a labelled contact sheet plus per-view structured results.
  Store/restore the prior camera and controls when requested, including on failure.

Bounds providers must declare their accuracy and freshness. Animated/skinned meshes,
instances and shader displacement may require a feature-supplied bounds provider;
stale CPU geometry bounds must not be reported as exact rendered extents. Missing,
empty or degenerate bounds need explicit diagnostics or a declared fallback size.
Selecting one instance must be distinguishable from selecting the whole batch.

Framing is not proof of visibility: another object can occlude the target, or the
camera may land inside geometry. Report geometric fit separately from occlusion
(`unknown` unless a suitable probe ran). An optional alternative-view search can
sample bounded candidate angles using declared probes; it must report its coverage
and unresolved cases. Never hide other objects automatically. An explicit isolation
view is diagnostic evidence and must not replace normal-scene acceptance captures.

Acceptance fixture: a large sphere and a much smaller box, plus translated/rotated
groups. Verify independent framing, reproducible angles and full-orbit fit across
portrait/landscape viewports and perspective/orthographic cameras. Include occluded,
invalid-bounds and moving-target cases; the text report must distinguish each outcome.

## Reusable test pattern

Each scenario follows **setup -> readiness -> act -> observe -> assert -> cleanup**.
Write ordinary Playwright TypeScript specs with a typed `scene` fixture and registered
domain probes. JSON holds fixture data, metadata and results, not an action interpreter.
Use Playwright's runner, filtering, reports and attachments; add only thin glue for
scene capabilities and persistent evidence.

Every scenario defines:

- Stable ID, schema version, purpose, tags, required capabilities and expected result.
- Fixture/data references, seed, effective settings and reset/cache policy.
- Semantic actions or camera path; observation checkpoints and continuous checks.
- Assertions, their rationale and tolerances; visual regions and review criteria.
- Measurement profile, absolute budgets and permitted regression thresholds.
- Timeouts, cleanup and required evidence. Missing required capabilities cannot pass.

Illustrative spec shape; helper signatures are not yet implemented:

```ts
test('small box can be inspected', async ({ scene }) => {
  await scene.reset();
  await scene.ready();
  const view = await scene.camera.focus({
    target: 'small-box', view: 'front-right-above', padding: 1.2,
  });
  expect(view.fit).toBe(true);
  await scene.capture('box-front');
  await scene.camera.orbit({ target: 'small-box', sweepDeg: 360 });
  expect((await scene.diagnostics()).errors).toEqual([]);
});
```

Separate three execution modes: fixed-time visual/structural checks, real-time
motion evidence, and unrecorded real-time performance sampling. They share inputs
and path definitions, but must not pretend to be the same timing experiment.
Fixed stepping must explicitly coordinate supported engine/worker clocks; freezing
browser timers alone does not guarantee deterministic Three.js behaviour.

Test layers are browser smoke, integration/invariants, visual comparison, motion,
performance and human acceptance. A generic suite provides basic smoke coverage;
feature-specific probes establish stronger properties such as seam continuity or
correct animation state. Passing generic checks does not imply those properties.

## Text-only agent workflow

Provide a short authoring guide linked from the existing agent guide, working
examples and a capability catalog. Use standard Playwright commands plus a thin
`test:scene` package script and structured result attachments. No parallel CLI command
framework or scaffolder is needed initially. Baseline proposal/acceptance tooling is
a later milestone; the package script and fixture are not available yet.

1. Discover the scene's capabilities and related scenarios. State the new expected
   behaviour and choose the layer that can actually establish it.
2. Copy a typed example; use stable IDs, explicit settings and named probes.
   Type-check tests and validate static inputs before launch; discover runtime
   capabilities in the browser and fail clearly if required ones are missing.
3. Run against the unchanged version where possible. For a bug fix, retain evidence
   that the scenario detects the bug; otherwise document why that is unavailable.
4. Implement/update the behaviour and run the relevant suite. Read the structured
   failure report, inspect state, and replay the exact failing step/checkpoint.
5. Add a focused probe or checkpoint when evidence is insufficient. Preserve the
   original failure and changed test semantics; never loosen a tolerance merely to pass.
6. Report automated results separately from visual judgments. Propose intentional
   baseline changes with before/after evidence and a reason for human acceptance.

A text-only agent can compare numeric image-difference results, scene facts and
performance deltas. It cannot truthfully claim to have visually inspected an image.
Expose changed-region bounds, pixel counts, checkpoint IDs and artifact links;
the agent can locate a suspect object and capture another angle without seeing it.
Projected bounds/frustum checks are useful facts but do not prove unoccluded pixels
or aesthetic quality. Optional depth/object-ID diagnostics must be labelled as
diagnostic renders, and kept outside normal visual/performance measurements.

Use per-check statuses `pass`, `fail`, `needs-review`, `inconclusive`, `unsupported`
and `not-run`. Required unsupported checks block acceptance. Overall automated
success and human visual acceptance are separate fields. An unseen image, missing
baseline, unavailable metric, flaky retry or incompatible environment is not a pass.

Each failure includes expected/actual values, units, tolerance, step, frame/time,
scene/camera state, relevant warnings, artifact links and an exact rerun recipe.
Suggested follow-up commands may guide diagnosis; they must not assert a root cause
without evidence. Keep stdout concise and detailed data in referenced files.

## Data, evidence and baseline lifecycle

Start with files, not a database. Proposed layout:

```text
tests/scene/                 TypeScript specs, fixtures, paths, helpers, data contracts
tests/scene/baselines/       reviewed baseline manifests and small reference images
tools/scene-tests/           optional thin artifact/comparison glue (no second runner)
<artifact-root>/<run-id>/    manifest, results, raw samples, events, images, video, trace
```

Implementation must configure and ignore the artifact root. Large fixtures and
videos use a configurable artifact store with content hashes and durable references.
Do not put unbounded recordings into Git. Keep accepted baseline evidence and open
failure evidence pinned; prune disposable successful runs under an explicit retention
policy. Promotion must not leave a baseline referencing files scheduled for deletion.

| Record | Minimum contents |
| --- | --- |
| Inputs | Scenario/schema version and hash, fixture/asset hashes, seed, generator version, settings, path, clock mode and cache policy. |
| Code | Revision, dirty diff plus relevant untracked inputs or immutable source snapshot, dependency lock hash and built artifact digest. Never require an agent to commit. |
| Environment | Runner ID, OS, CPU/GPU and driver when available, renderer backend, browser/version/flags, headless/headed mode, viewport/DPR, build mode and power profile. |
| Evidence | Check results, effective state, raw timestamped metrics/events, image differences, media, errors and artifact checksums. |
| Baseline | Accepted run, compatibility profile, reviewer/date/reason, budgets, comparison policy and previous baseline reference. |

A seed is sufficient only with reproducible generator, assets and inputs. Persist
actual fixture snapshots when replay is unreliable or data can change externally.
Allow both frozen-input renderer tests and generator tests: regenerating fixtures
on every renderer change would mix two causes. Store source/settings at run start;
isolate a stable build and detect concurrent edits rather than mislabel live-reload output.

Baseline states: `candidate -> accepted -> superseded`. Agents may produce candidates;
acceptance is a deliberate maintainer action. Routine tests cannot overwrite accepted
baselines. Preserve history. No-baseline runs gather evidence and need initial review.

Match scenario/fixture semantics, render settings and environment profile before
comparison. Record application revisions as the variable being tested, not a reason
to reject every comparison. A changed browser, scenario or fixture needs explicit
compatibility review; use a paired old/new run on the new environment where possible.
Compare against the last accepted baseline and show previous comparable runs for trend.

## Visual and performance comparison rules

Use [Playwright image comparisons](https://playwright.dev/docs/test-snapshots) with
fixed canvas dimensions, DPR, quality, lighting, simulation time and readiness.
Version tolerances and masks; do not mask the feature under test. Capture through
the actual post-processing pipeline, without ScreenshotService quality elevation.
Pixel differences flag change, not correctness. Small thin defects may need local
regions or geometric probes rather than a permissive whole-image threshold.

Capture real motion with [video](https://playwright.dev/docs/videos), named events
and checkpoint images. A [Playwright trace](https://playwright.dev/docs/trace-viewer)
helps diagnose browser actions; DOM snapshots alone do not reconstruct WebGL frames.
Transient coverage checks and targeted frame captures complement compressed video.

Performance policy:

- Run serially on an identified hardware profile, with fixed visible quality and
  pixel dimensions. Software-rendered CI can provide smoke evidence but cannot
  establish performance on the user's GPU.
- Separate a short (~5-second) performance smoke for iteration from reference
  measurements; smoke cannot approve a performance baseline. Record actual total
  runtime; a sub-15-second warm inner loop is a goal, not a guaranteed startup time.
- Reference protocol proposal: 10 seconds warm-up, three repetitions of a 60-second
  path; scenarios may declare another duration. Separate cold setup/loading from
  warm navigation. Save raw samples, each run's p50/p95/p99 frame intervals, counts
  above declared hitch thresholds, and variation between runs.
- Measure in-page with real time and record sample boundaries/path position.
  Frame intervals are not GPU execution time. GPU timers, when supported, are
  separate metrics; invalid/disjoint results must be discarded and labelled.
- Do not derive percentiles from the FPS display's averages. Its periodic scene
  traversal still runs with `showFPS: false`; explicitly record/control telemetry
  overhead and use bounded low-overhead raw sampling.
- Collect renderer calls/triangles over the whole frame including multiple passes,
  resource counts and feature counters. Three.js resource counts are not GPU byte
  usage; label estimated bytes and unavailable memory metrics explicitly. See
  [WebGLRenderer statistics](https://threejs.org/docs/pages/WebGLRenderer.html).
- Disable video, heavy tracing, screenshot readback and local model inference during
  the benchmark. Record whether the page was hidden, throttled or interrupted and
  invalidate affected runs. Release model GPU allocations before reference runs.
- Use scenario-specific absolute budgets plus relative-and-absolute regression
  tolerances. Establish thresholds from baseline variance; there is no universal
  FPS or percentage target. Noisy results are inconclusive and require remeasurement.
  Retries and all repetitions remain visible; never choose only the fastest run.

## Remote review and later integrations

Generate a portable HTML report plus JSON summary: check status, before/after/diff,
motion clip with checkpoints, timing changes, environment and reproduction recipe.
Publish/access it through an authenticated artifact channel; local paths alone are
not a remote workflow. Bind the report and optional preview to the exact tested build.
Interactive preview performance describes the viewing device, while recorded host
metrics describe the test machine. Do not infer benchmark results from streamed video.

Later WebMCP work exposes the same discovery/actions/inspection contract rather
than a second implementation. Check browser support at implementation time; keep
the CLI/Playwright path independent. See [WebMCP overview](https://developer.chrome.com/blog/webmcp-epp).

Later local vision work accepts selected saved images/crops or explicitly sampled
video frames, intent and scene facts. Return checkpoint-linked findings, uncertainty
and requested follow-up views. Record model/version, prompt, latency and evidence.
The user's tested local model (described as Gemma4 12B) is a candidate, not a required
dependency or verified quality claim. Evaluate candidates on known defects and clean
examples, recording misses and false alarms. Vision cannot waive numeric failures,
infer performance from pictures or silently accept a new baseline. Ollama/model
availability must not affect the core suite; text-only agents can consume advisory
findings while clearly attributing them to that model.

## Delivery milestones and acceptance

The accepted review synthesis replaces the original schema-first P0–P5 sequence.
Use the single [M1–M6 checklist in 038](038_agent_testing_implementation_plan.md#goal-and-progress)
for status: working agent test, visual baselines, performance history, remote review,
authoring improvements, then optional services. Implement only the detailed M1 packet
first; extract broader contracts from proven use rather than designing them all upfront.

Validate the harness itself with controlled failures: wrong camera/scene, missing
object/asset, shader/runtime error, stale frame, deliberate frame delay, missing
baseline and incompatible GPU profile. Include timeout, cleanup and interrupted-run
tests. A suite that passes an intentionally broken fixture is not ready to trust.

Choose the reference machine, first two scene fixtures, artifact location and initial
budgets during implementation. Start with one browser/backend; expand the matrix
deliberately. Do not build a dashboard service, database or model orchestration
platform before the local runner/report workflow has demonstrated value.

## Handoff

Discussion, requirements and review synthesis are recorded. Implementation remains
unstarted; see [038](038_agent_testing_implementation_plan.md) for Luna's bounded M1
work packet, decisions, acceptance checks and pasteable handoff.
Inspect current implementations before choosing exports. Follow repository test,
build and documentation rules; preserve unrelated working-tree changes and never
create commits. This planning task implements no runner or new public API.

## Agent review inbox — append only

This section collects independent design reviews. Entries are proposals, not
accepted changes to the plan. Reviewers must not edit the plan, implementation,
other reviews or baseline policies. Read repository instructions and preserve
unrelated working-tree changes. Do not create commits.

Review the design independently before reading previous reviews, then avoid
duplicating findings: reference an existing finding ID when supporting or
disagreeing with it. Focus on concrete failure modes, missing decisions and ways
to simplify implementation. No minimum finding count; do not invent concerns.

Append one entry of at most 300 words with at most five findings. Use a unique ID
such as `R-20260918-143205-camera-a7f2` (UTC timestamp, focus, random suffix).
Identify the actual agent/model only if known; otherwise use a session label.
Reference section names and inspected files or primary sources when relevant.
Distinguish verified facts from design suggestions and untested assumptions.

```text
### <review-id> | <agent/session> | <UTC date>
Scope: <review focus>; Evidence: <what was actually read or checked>
Verdict: ready for prototype / revise first / needs investigation
- <review-id>-F1 [blocking|important|optional] <section>: <specific issue>
  -> <smallest proposed change>; Validate: <how to establish it works>.
  Basis: verified / design judgment / untested assumption; <reference if needed>.
Agreement/disagreement: <existing finding IDs, only if useful>
First useful experiment: <one bounded experiment>
```

Immediately before writing, re-read the file tail and append only the new entry
with an append operation; do not regenerate or replace the document from an older
copy. Verify the complete entry and preservation of other entries afterward.
Concurrent writes are not guaranteed safe: if contention is detected, preserve the
review in a separate `037-review-<review-id>.md` file alongside this runbook and
report its path for later integration. Agents without filesystem access should
return the same block in chat for the user to append.

A later, explicitly requested synthesis pass should reconcile findings and update
the plan once, recording accepted/deferred/rejected finding IDs and reasons in a
new entry. Leave original reviews intact so disagreements and decisions remain
traceable. Review prompts do not authorize starting the implementation handoff.

### R-20260918-130613-agent-exec-b4f8 | Antigravity / Gemini 3.8 Flash | 2026-09-18
Scope: Remote agent usability, test architecture, execution speed; Evidence: runbook 037, package.json, scene-inspection.ts, ai-agents.md.
Verdict: ready for prototype
- R-20260918-130613-agent-exec-b4f8-F1 [important] Reusable test pattern: Custom JSON scenario DSL is redundant; text-only LLMs already write reliable TypeScript.
  -> Use standard Playwright `*.spec.ts` with a typed `test.extend({ scene })` fixture instead of a custom JSON interpreter. Validate: Author a test in TS without writing a DSL parser.
  Basis: design judgment.
- R-20260918-130613-agent-exec-b4f8-F2 [important] Delivery phases: P0 schema-first waterfall delays discovering browser/WebGL integration risks.
  -> Invert P0/P1: spike a minimal 2-object test first, then extract schemas and storage conventions. Validate: First green screenshot before completing schema specs.
  Basis: design judgment.
- R-20260918-130613-agent-exec-b4f8-F3 [important] Contract / Inspection: Text-only agents cannot click or drag 3D objects without 2D coordinates.
  -> Add `scene.projectToScreen(targetId)` returning canvas `{x, y}` for Playwright mouse events. Validate: Agent clicks a mesh without manual coordinate calculations.
  Basis: verified Three.js capability (`Vector3.project`).
- R-20260918-130613-agent-exec-b4f8-F4 [important] Comparison rules: 3.5-minute performance benchmark is too slow for agent inner loops.
  -> Define a 5-second smoke profile for agent iteration; reserve the 3x60s protocol for baseline promotion. Validate: Measure smoke execution time under 15s total.
  Basis: design judgment.
- R-20260918-130613-agent-exec-b4f8-F5 [blocking] Contract / Readiness: Camera changes via `page.evaluate` race with Three.js render loop.
  -> Expose an explicit `await scene.waitForNextFrame()` tied to `EngineService.tick$`. Validate: Zero torn or stale frame captures during rapid camera focus calls.
  Basis: verified engine tick lifecycle.
Agreement/disagreement: none (first review).
First useful experiment: Install `@playwright/test`, mount large sphere + small box fixture, verify `scene.camera.focus('small-box')` screenshot in headless Chrome.

### R-20260918-131016-agent-infra-c9d4 | opencode / deepseek-v4.1-flash | 2026-09-18
Scope: existing infra reuse, stable identity, phase gating; Evidence: 037, scene-inspection.ts, clipmap-benchmark.ts, clipmap-probe.ts, run-navigation-scenarios.mjs, package.json.
Verdict: revise first
- R-20260918-131016-agent-infra-c9d4-F1 [important] Starting point: plan cites only the terrain fixture, ignoring working probe/benchmark code in the library — `clipmap-benchmark.ts` (injectable probes, calibration, observed draw calls) and `clipmap-probe.ts` (render-target seam/leak detection). -> Make `clipmap-probe` the first feature adapter; reuse its result/textReport conventions instead of rebuilding probe plumbing. Validate: one existing seam probe behind the generic adapter with identical textReport. Basis: verified.
- R-20260918-131016-agent-infra-c9d4-F2 [important] Contract: mandates stable application IDs (L95) but `inspectScene` returns `object.uuid` (scene-inspection.ts:164); F3's `projectToScreen` needs the same handle. -> Discover must resolve stable IDs; ban UUIDs in assertions. Validate: same ID across two reloads. Basis: verified. Agreement: R-20260918-130613-agent-exec-b4f8-F3.
- R-20260918-131016-agent-infra-c9d4-F3 [important] Reusable pattern: repo convention is a library scenario sweep plus a thin `tools/*.mjs` entrypoint; the JSON manifests and seven CLI verbs duplicate Playwright's runner/reporter/snapshot commands. -> Extend the existing pattern and Playwright's own CLI. Validate: author a scenario with no new parser. Basis: verified. Agreement: R-20260918-130613-agent-exec-b4f8-F1.
- R-20260918-131016-agent-infra-c9d4-F4 [blocking] Delivery phases: no go/no-go. Riskiest unknowns (non-blank deterministic WebGL capture, worker/postprocessing readiness, adapter reach to `EngineService.activeInstance`) are assumed before P0 schema work. -> Add a P1 kill criterion: two same-build runs within declared noise, else stop. Validate: sphere+box captured twice with bounded diff. Basis: design judgment. Agreement: R-20260918-130613-agent-exec-b4f8-F2/F5.
- R-20260918-131016-agent-infra-c9d4-F5 [optional] Visual rules: Playwright snapshots key by name/platform, not GPU/driver, so baselines thrash across machines. -> Store a comparison-profile key and tolerance in the baseline record; mismatch yields needs-review, never pass. Validate: a driver-flag change cannot auto-pass. Basis: verified Playwright behavior.
First useful experiment: one throwaway Playwright spec against the demo app exposing only readiness/focus/inspect/measure for the large-sphere/small-box scene; run twice, report blank-frame and diff noise before writing schemas.

### R-20260918-130935-evidence-c3e1 | Claude Code / Claude Fable 5.1 | 2026-09-18
Scope: evidence validity, agent addressability, existing engine reuse; Evidence: runbooks 037/021, AGENTS.md, package.json, inspection, screenshot, fps.controller, orbit-controls, inspection-lab sources.
Verdict: ready for prototype; fix F2 in P1
- R-20260918-130935-evidence-c3e1-F1 [important] Contract: stable IDs do not exist; `inspectScene` keys and filters by `object.uuid`; duplicate names only warn.
  -> Decide the selector now: name path (`cargo-rack/cargo-3`); ambiguity is a typed error. Validate: lab duplicate-name toggle fails `find`.
  Basis: verified; scene-inspection.ts:84,164.
- R-20260918-130935-evidence-c3e1-F2 [blocking] Text-only workflow: `EngineService.tick` swallows tick/render exceptions into `console.error` and `error$`; Playwright `pageerror` never sees them.
  -> Adapter subscribes to `error$` and console, reports counts per checkpoint. Validate: a throwing `tick$` subscriber fails the scenario.
  Basis: verified; engine.service.ts:544-593.
- R-20260918-130935-evidence-c3e1-F3 [important] Performance policy: `FPSController` aggregates once per second and traverses the whole scene at 1 Hz on the render thread; no per-frame samples for p95/p99, and it perturbs the measurement.
  -> Sample per-frame intervals from `tick$` into a preallocated array with `showFPS` off; `stopLoop()` plus public `tick(time)` already gives fixed stepping. Validate: same-build repeats show no 1 Hz spike.
  Basis: verified; fps.controller.ts:56-119, engine.service.ts:528-541.
- R-20260918-130935-evidence-c3e1-F4 [important] Camera commands: OrbitControls default `enableDamping = true`; later frames keep interpolating, so one `waitForNextFrame` (R-20260918-130613-agent-exec-b4f8-F5) is insufficient.
  -> Write camera and `controls.target` together, bypass damping, resolve when pose is stable for two frames, return actual pose. Validate: captures at focus and thirty frames later match.
  Basis: verified; orbit-controls.component.ts:244,458.
- R-20260918-130935-evidence-c3e1-F5 [optional] Simplify: put framing/orbit/fit math in pure engine functions with Karma ChromeHeadless specs; Playwright owns navigation, input, media, baselines. Capture via `ScreenshotService.capture({ samples: 1 })`, not `page.screenshot`: the lab's `showFPS` HUD changes every second.
  Basis: design judgment; package.json scripts, lab component line 33.
Agreement/disagreement: supports R-20260918-130613-agent-exec-b4f8-F1/F2/F5 (F5 with F4 caveat).
First useful experiment: Playwright spec on `/scene-inspection-lab`: `focus('cargo-rack/cargo-3')`, assert projected bounds inside viewport, snapshot in-page capture headless and headed, confirm an injected `tick$` throw fails.

### S-20260918-astra-m1 | Codex / Astra | 2026-09-18

User-requested synthesis and implementation handoff; original reviews remain intact.
Implementation authority: [038](038_agent_testing_implementation_plan.md), M1 only.
Aliases below resolve to the complete finding IDs in the three reviews above:
**A** = `R-20260918-130613-agent-exec-b4f8`,
**B** = `R-20260918-131016-agent-infra-c9d4`,
**C** = `R-20260918-130935-evidence-c3e1`.

| Findings | Decision and reason |
| --- | --- |
| A-F1, A-F2, B-F3 | Accepted: standard TypeScript specs and a working capture before broad schemas; reuse Playwright tooling. |
| A-F3, B-F2 | Accepted: registered stable IDs plus CSS-coordinate projection for real input. |
| A-F4 | Accepted for M3: short smoke versus reference measurements; runtime target is measured, not guaranteed. |
| A-F5, C-F4 | Accepted with correction: require successful render completion and settled controls; `tick$` occurs before rendering and can accompany a skipped render. |
| B-F1 | Partially accepted/deferred to M2: reuse existing terrain probes; reject terrain-first as the generic foundation. M1 uses primitive objects. |
| B-F4 | Accepted repeatability gate; reject immediate abandonment after noisy repeats and implicit `activeInstance` access. Diagnose and retain inconclusive evidence. |
| B-F5 | Accepted for M2: explicit environment profiles; mismatch cannot automatically pass. |
| C-F1 | Accepted identity problem; reject name paths as stable selectors. Explicit IDs survive renames/reloads; duplicates fail. |
| C-F2 | Accepted with correction: collect engine and browser/console channels, test asynchronous subscriber faults; not every RxJS error is caught by `safeEmit`. |
| C-F3 | Accepted raw sampling for M3; reject the assumption that hiding FPS disables its collector or manual ticks synchronize all clocks. |
| C-F5 | Accepted math/browser separation; capture backend must preserve normal quality and identify the captured frame. No mandatory backend replacement without evidence. |

Verified against local engine, controls, inspection, screenshot, FPS and terrain probe
sources. No runner implemented or browser verification claimed during this synthesis.
