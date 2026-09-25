# Performance tests (M3 slice)

Playwright-driven performance tests for engine systems, plus an append-only
JSON log so changes can be tracked over time. Design context:
[037](../../docs/runbook/037_agent_driven_visual_and_performance_testing.md) ·
milestones: [038](../../docs/runbook/038_agent_testing_implementation_plan.md) (M3).

```powershell
npm run test:perf                 # ~5 s smoke per scenario, compares with history, never writes it
npm run test:perf -- -g instanced # any Playwright args pass through
npm run test:perf:record          # same, and append valid results to the history log
npm run test:perf:reference       # 5 s warm-up + 3 x 10 s repeats, recorded (use for baselines)
npm run perf:report               # trend tables from the history log
npm run perf:report -- --metric custom.scatterBuildMs.p50 --html perf.html
npm run test:perf:report          # Playwright HTML report with raw samples attached
npm run test:perf:unit            # unit tests for the stats/history tooling (no browser)
```

`node tools/run-perf.mjs` takes `--record`, `--reference`, `--gate` (fail on a
timing regression), `--headed` (real GPU on most desktops) and `--vsync` (keep the
browser frame cap). Environment variables with the same effect: `PERF_RECORD=1`,
`PERF_PROTOCOL=reference`, `PERF_GATE=1`, `PERF_HEADED=1`, `PERF_UNCAPPED=0`,
plus `PERF_HISTORY_FILE` and `PERF_CHROMIUM_ARGS`.

The suite reuses a dev server on `127.0.0.1:4222` (shared with `test:scene`) or starts
`ng serve demo-app` itself.

## What a test checks

Each test loads one scenario on `/perf-lab?perfTest=1` and:

1. **Functional checks, always enforced.** Draw calls, triangles and instance counts
   must match exactly (after subtracting the empty scene's own draw calls). These
   don't depend on hardware, so they catch an engine change that breaks a system
   even when timing is noisy.
2. **Timings.** Real frames are sampled while the normal animation loop runs:
   - `frameIntervalMs`: wall time between completed renders (throughput);
   - `cpuFrameMs`: the whole `engine.tick()` (tick$ subscribers, render submission, telemetry);
   - `renderCpuMs`: `engine.render()` only;
   - `custom.*`: scenario-specific timings, e.g. `custom.scenarioUpdateMs`, `custom.scatterBuildMs`.

   These are CPU main-thread timings. None of them is GPU execution time.
3. **Validity.** A hidden page, runtime/page errors or missing samples make the run
   invalid. The test fails and the run is not recorded.
4. **Comparison.** The run is compared with the median of the last 5 valid entries
   for the same machine profile, scenario version, params and protocol. A metric
   regresses only when it is worse by more than both the relative and the absolute
   tolerance (smoke: 25 % and 0.5 ms; reference: 10 % and 0.25 ms). When the
   repeats vary too much (CV > 0.15), a regression is reported as `inconclusive`.
   The verdict appears in the console, as a `perf` annotation in the HTML report,
   and fails the test only with `--gate`.

Raw samples, the environment, and the comparison are written to
`artifacts/perf/<run-id>/<scenario>-<params-hash>.json` (git-ignored) and attached
to the Playwright report.

## Scenarios

| id | What it measures |
| --- | --- |
| `empty` | Engine loop with nothing to draw: the fixed per-frame overhead |
| `instanced-static` | One `InstancedMesh` of boxes, matrices written once (1k / 20k / 100k series) |
| `instanced-dynamic` | Every instance matrix rewritten each frame plus buffer upload |
| `instanced-component` | The engine's `<instancedMesh>` component mounted through signals, with `onDataChanged` called every frame |
| `meshes-individual` | N separate meshes: draw-call bound. Compared with instancing in one test |
| `scatter-lod-rebuild` | `triangular-engine/scatter` LOD bucketing plus per-tier instanced rebuild while the viewpoint moves |

Open `/perf-lab` without the query to watch any scenario live.

## The history log

`tests/perf/history/perf-history.jsonl` is committed. It holds one JSON object per
line (`perf-history-v1`), one line per scenario per recorded run:

```jsonc
{
  "schema": "perf-history-v1",
  "recordedAt": "2026-09-24T12:00:00.000Z",
  "runId": "2026-09-24T11-59-02-113Z",
  "git": { "commit": "…", "branch": "main", "dirty": false },
  "engineVersion": "…",
  "profile": { "id": "3f9c…", "label": "win32-x64 16c · chromium 140 · ANGLE (NVIDIA …)", "softwareRendering": false },
  "scenario": { "id": "instanced-static", "version": 1, "params": { "count": 20000, "spacing": 1.5 }, "paramsHash": "…" },
  "protocol": { "name": "reference", "warmupMs": 5000, "durationMs": 10000, "repeats": 3 },
  "metrics": { "cpuFrameMs.p50": 1.9, "cpuFrameMs.p95": 2.6, "renderCpuMs.p50": 0.4, "frameIntervalMs.p95": 7.1,
               "fps": 160.2, "drawCalls": 1, "triangles": 240000, "setupMs": 12.4, "firstFrameMs": 38.0,
               "hitches.over50ms": 0, "custom.scenarioUpdateMs.p50": 0.8, "…": 0 },
  "repeatP50": { "cpuFrameMs": [1.9, 1.88, 1.93] },
  "checks": { "passed": true, "failed": [] },
  "valid": true,
  "invalidReasons": []
}
```

The **profile id** hashes the OS, CPU model and count, the browser major version,
headless/headed mode, frame-rate cap, GPU renderer string and viewport. The
application revision is excluded on purpose: it is the variable being measured.
Timings from different machines are never compared, so recording from both a laptop
and CI is safe. `perf:report` shows each profile as its own series.

Record baselines with `npm run test:perf:reference` from a clean tree on the machine
you want to track, then commit the updated log with the change it measures. Entries
recorded from a dirty tree are marked `"dirty": true`.

Headless Chromium usually renders with SwiftShader (software GL), and the profile
labels this `software-gl`. That is useful for CPU-side trends and functional checks.
It does not show performance on a real GPU; for that, record with `--headed` on a
desktop.

## Adding a system

1. Add a `PerfScenarioDefinition` to
   `projects/demo-app/src/app/testing/perf-harness/perf-scenarios.ts`: deterministic
   setup, optional per-frame `update`, exact `checks`, and `recordSample()` for the
   system's own hot path. Bump `version` whenever the workload changes meaning, so
   old history is not compared against the new workload.
2. Add a test in `tests/perf/specs/*.perf.spec.ts` that calls
   `perf.run({ scenario, params })` and asserts anything scenario-specific.
3. Extend `perf-harness.spec.ts` if the scenario needs new harness behaviour.

## Known limitations

- The bridge only exists in dev builds (`isDevMode()`), so the suite measures
  `ng serve --configuration development` output. Dev-mode checks are part of every
  measurement, which is consistent between runs but not what production costs.
- `cpuFrameMs`/`renderCpuMs` come from test-only wrappers installed on the engine
  *instance* (never the prototype) and removed on teardown. The engine's
  `FPSController` keeps running because it is part of the production frame cost.
- Frame-rate uncapping (`--disable-frame-rate-limit --disable-gpu-vsync`) is on by
  default. If a platform ignores those flags, frame intervals stay at vsync
  (about 16.7 ms), while CPU timings stay meaningful.
- Video and trace are off: 037 keeps recordings out of benchmarks. The WebM walkthrough
  lives in the visual suite (`npm run test:scene:walkthrough`).
