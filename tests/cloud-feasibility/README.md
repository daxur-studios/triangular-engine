# Unattended cloud-lab feasibility (Plan 052 U0)

Run from the repository root after installing dependencies, with Google Chrome installed:

```powershell
npm run test:cloud-feasibility
```

The command builds an isolated development demo, serves that immutable build on an automatically
selected loopback port, and runs headless installed Chrome. It does not use the running demo server,
take desktop focus, request clipboard access, accept visual baselines or modify agent instructions.
Playwright owns the dedicated server/browser lifecycle; the wrapper verifies the server port is
released. A failure exits nonzero and retains evidence, including startup/build failures.

Default: one cloud volume, 24 march steps, 1,200 rendered steps at 1/60 simulated seconds,
across a 2.4 km approach/entry/turn/exit path.
The sun and volume move and lighting rebakes run through the real lab tick. The probe fixes the
observed canvas wrapper and output to 640x360, steps the existing engine, stops Three.js's independent
animation clock, and explicitly supplies shader time/delta/frame ID. GPU completion is awaited for
each frame. The hook is enabled only in a development build with `?cloudReplay=u0`.
Each disposable browser context starts with a seeded catalog thumbnail, preventing the demo's
independent automatic screenshot from drawing an extra frame during the controlled replay.

Checks: actual WebGPU device identity (software/fallback fails), available GPU timestamps, consecutive
rendered frames, outside/inside/outside volume bounds, identical state and checkpoint images across
fresh runs and wall-clock pauses, a bounded competing WebGPU compute session on the same adapter, missing-cloud image changes,
missing-render/readiness failures and fresh-page recovery. Mesh and proxy draw paths are exercised.
The repeatability comparison starts at exact pixel equality; no tolerance is silently relaxed.

Evidence is under ignored `artifacts/cloud-feasibility/<timestamp>-<pid>/`: `report.md/json`, raw
frame records, PNGs, source hashes/dirty diff, probe inputs, actual served JavaScript, compiled demo,
execution/cleanup metadata and the Playwright HTML report. No git commit is needed. The before/after
source manifest detects concurrent edits; retained browser bundles identify the code actually run.

Each new command also writes `run.json` immediately (`running`) and finalizes it as `passed` or
`failed`, with UTC start/finish times and total `durationMs`, including build, browser startup,
checks and cleanup. `execution.json` includes the same final timing plus detailed cleanup/source
metadata. Individual journey JSON files already include `wallMs` and per-frame CPU/GPU samples;
those cover the replay, not the whole command. The first full pilot took about 2.7 minutes.

For a compact status/history view without launching a test:

```powershell
npm run test:cloud-feasibility:status
```

This reads retained run records and returns JSON: active commands with elapsed time, and the ten
most recent completed commands with paths to their full evidence. All older directories remain
available; there is no automatic pruning or overwrite. These are local files, not a backup; builds
and captures can consume substantial disk space. Older pilot runs predate `run.json` and remain
readable directly in their directories but do not supply total-duration estimates.

Prefer waiting on the test process's completion notification or a long tool wait, then reading the
report once. Do not wake an agent repeatedly just to check status. At launch and in `--status`,
timed history supplies a suggested wait: the nearest-rank p90 of up to 20 recent successful commands
with matching frame count, fresh/reused build mode and CLI arguments, plus 25% headroom. Failures
and shortened runs do not skew the full-run estimate. With no matching history the estimate is
`null`; one sample is just a rough hint. Estimates are wall time for scheduling, not performance
baselines or deadlines: laptop contention and source changes can make the next run slower.
`suggestedCheckAfterMs` is a fallback when completion notifications are unavailable, not an automatic
timer. A hard-killed process can leave a `running` record; status reports owner-process liveness
and warns when the owner has exited, rather than claiming completion. Process liveness alone is
not proof of progress (or of identity if an OS PID is eventually reused).

Each process writes only its own directory, so history has no shared mutable index. This preserves
independent records; it does not coordinate or serialize GPU use across agents.

For a quicker **development check**, shorten the journey (this changes its simulated speed/duration):

```powershell
$env:CLOUD_PROBE_FRAMES = '120'
npm run test:cloud-feasibility
Remove-Item Env:CLOUD_PROBE_FRAMES
```

`CLOUD_PROBE_BUILD_DIR` optionally points at a previous run's `build/browser` for diagnosis without
rebuilding. Such reuse is recorded in `execution.json`; it tests that retained build, not current
working-tree application sources. Leave it unset for final verification.

Installed Chrome is deliberate: the first bundled Chromium 140 run on this laptop failed device
creation with `dxil.dll` Windows error 126 and silently used hardware WebGL2 instead. Installed
Chrome 155 successfully created the WebGPU device. This is an environment finding, not a general
claim that bundled Chromium cannot run WebGPU. Browser version and actual adapter are retained.

## Interpretation

These are **replay correctness** checks. CPU/GPU times are diagnostic: per-frame fences/readback
change pacing, and other laptop activity is uncontrolled. They cannot establish idle-machine FPS,
real-time smoothness or a before/after performance verdict. The injected load is bounded synthetic
GPU activity; it does not establish gaming behaviour, cross-agent locking or VRAM-pressure safety.
All frame states/renders are checked, with seven image checkpoints per journey; a brief visual
defect between checkpoints can still escape detection. Continuous video/all-frame image checks
would extend coverage.

This prototype uses pinned Three.js internals in one isolated file to test feasibility. Generic
engine stepping, physics/streaming clocks, temporal-history effects, performance baselines, a shared
machine queue and a complete replay video remain separate work. Follow the U0 checklist in Plan 052
and append measured evidence to Runbook 052 before generalizing the adapter.

## Isolated rendering-cost experiment (U0P)

```powershell
node tools/scene-tests/cloud-adapter-survey.mjs
npm run test:cloud-performance
```

The adapter survey retains JSON under `artifacts/cloud-adapters/<timestamp>-<pid>/`, comparing normal
Chrome launch with `--force-high-performance-gpu`. On this laptop, ordinary WebGPU selected AMD
even with a high-performance preference; the Chrome flag selected NVIDIA Ampere. It changes only
the disposable browser process, not Windows graphics settings. Chromium defines the switch in
[gpu_switches.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/config/gpu_switches.cc).
U0P uses that flag and asserts the actual renderer vendor is `nvidia` (override explicitly with
`CLOUD_PROBE_EXPECT_VENDOR` on another machine). A preference/flag is never proof of the GPU used.

This command shares the ignored run archive, timing/status command and automatic server cleanup.
Its workload/measurement/expected-adapter profile keeps duration history separate from correctness
runs. A fresh build is the default. Do not run these performance experiments concurrently with
other GPU tests; machine-wide coordination is still pending.

Three alternating rounds each include a baseline, a same-build repeat and a positive slowdown
control. All use the same real mesh cloud scene, 24 march steps, fixed simulated clock and complete
path. The control redundantly renders the real scene **eight times per simulation step**, without
advancing scene/shader time for the extra draws. Final PNGs must match the reference exactly.
Raising the march cap alone was not a reliable positive control in the first pilot: short-ray
sampling and early termination can prevent extra work.

The first reference chooses up to ten complete measured paths to reach four seconds; all later
cases use that **same path count**, with a three-second minimum validity gate. Each case first warms
the full path. Up to 16 simulation steps are submitted per batch, with a GPU fence and timestamp
resolution only at batch boundaries. All render/compute pass queries are retained; Three's public
resolve return value covers only its final frame, so this U0-only probe checks and reads the private
query pool instead. Missing/duplicate/stale query evidence fails the harness. Every actual render
must have timestamp evidence. Screenshots and NVIDIA telemetry snapshots happen outside measurement.

Reported GPU render/compute and wall costs are **per simulation step**, so the eight extra renders
remain visible as extra cost. Render-pass durations exclude compute passes, CPU encoding, queue
waits and presentation; compute costs and batch CPU/wall times are separate. These measurements
cannot establish interactive FPS or hitch-free presentation. The final-image check covers only
the last checkpoint; use the correctness command for intermediate visual/state checks.

The provisional comparison requires at least three measurements per group, matching browser,
actual adapter/backend, dimensions, clock/path and power profiles, valid timestamp/window evidence,
and at most 15% range/median spread. A slowdown is resolved only above 25% and with nonoverlapping
ranges. All six normal/repeat readings gate the positive-control comparison, exposing order drift.
A bounded same-adapter competing compute device is also exercised and **must** be inconclusive.
Deterministic analysis specs check noisy, missing, mismatched and busy rejection paths.

Exit zero means the experiment/harness completed, **not** that a performance gate passed. Read
`report.json`: `knownSlowdown`, `sameBuildRepeat`, `referenceSpread`, and `knownContention` carry the
measured verdicts and reasons. Even a stable slowdown signal leaves `idleMachinePerformance`
inconclusive: snapshots, repeated rounds and known-load flags cannot prove absence of external
activity or control thermal/power state. No baseline is accepted and no shared runner is migrated.
