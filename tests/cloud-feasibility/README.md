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
