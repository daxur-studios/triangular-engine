# Reusable browser test runner

For agent-guided integration into a game, use the
[triangular-engine-testing skill](../.agents/skills/triangular-engine-testing/SKILL.md).
The installed package includes it at
`node_modules/triangular-engine/skills/triangular-engine-testing/SKILL.md`, with a
game adapter recipe. Ask an agent to read that file and add a runnable test to your
game; no separate skill installation is required for direct file use. For skill
discovery, copy that skill folder into the game's `.agents/skills/` directory.

Import the opt-in `triangular-engine/testing` entry. It provides `TestRunnerComponent`,
`TestSession`, serializable suite/scenario/result contracts, and URL helpers. It has
no renderer, Playwright, router, or shared UI package dependency. Do not import it
from a worker or add it to a normal production scene unless intended.

```ts
import { TestRunnerComponent, TestRunAdapter, TestSuite } from 'triangular-engine/testing';

interface Settings { enabled: boolean }
const history: readonly TestSuite<Settings>[] = [{
  id: 'feature-check', version: 1, title: 'Feature check', purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [{ id: 'enabled', label: 'Enabled', settings: { enabled: true }, durationMs: 1000 }],
}];

// Add TestRunnerComponent to the host component's standalone imports.
// The page supplies adapter: TestRunAdapter<Settings, YourSnapshot>.
```

```html
<tri-test-runner [suites]="history" [adapter]="adapter" [available]="ready()"
  [allowAutoStart]="testModeEnabled" (progressChange)="showProgress($event)"
  (completed)="retainResult($event)" />
```

Keep history oldest-first. Append suites or new versions; the runner selects the final
entry, and **Run** starts the selected test (earlier ones stay in the selector; **More
options** has the profile, repetitions and **Run latest test**).
Do not change the meaning of an existing ID/version after sharing it. Inputs must be
structured-cloneable, JSON-compatible data with finite numbers. Paths and actions are
registered application code, not executable JSON instructions.

## Adapter lifecycle

The same `TestSession` drives button and URL launches:

1. `capture(context)` returns a read-only snapshot, including camera/control state.
2. For each repetition/scenario, `apply` uses the page's real action methods,
   `ready(context, scenario)` awaits completed renders and that scenario's explicit
   page conditions without caching the last applied scenario, then optional
   `warmupMs` elapses and `measure` runs the action for `durationMs` (or for the
   mode's window, see [Modes](#modes-quick-standard-soak)).
3. `restore(snapshot, context)` executes even after failure/cancel, using a fresh
   signal with a five-second cleanup timeout. Make restoration safe after partial setup.

Every asynchronous adapter must honor `context.signal`; use `context.wait(ms)` for
abortable waits. The default whole-run timeout is 180 seconds. `TestSession.run`
accepts `timeoutMs` for non-panel callers. Abort cannot stop arbitrary application
code that ignores its signal, so do not leave background mutations running after a
promise rejects. Cancel before disposing page resources; restoration may be a no-op
when the entire scene has already been disposed.

`measure` returns raw metrics with units/source, explicit checks, and limitations.
The host keeps domain-specific settings, camera paths, rendered-frame readiness and
metric providers. The generic runner does not infer GPU timing, step renderer clocks,
or declare that a screenshot looks correct. Use `progressChange` to show effective
settings in the page and prevent conflicting manual actions; it fires at phase/case
boundaries, not every frame. The panel's selection/profile/repetitions use typed
Angular reactive forms. A separate input test should exercise actual scene controls.
The host owns all control locking. A disabled fieldset covers native form controls,
but canvas pointer/keyboard controls, links and programmatic actions need their own
guards. Worker/engine errors outside an awaited adapter promise must be forwarded
by the host into adapter failure/checks; the runner has no async error subscription
hook. A page-local error sink is currently one way to do this.

## Modes: quick, standard, soak

A run has a mode, picked in the runner or with `testMode` in a launch link. Quick and soak change only the
measurement window, so they need an adapter that times its window with `context.measureWindow(scenario, series?)`
and declares `windowModes: true`. Other adapters (a fly-by or sweep whose `durationMs` drives the motion) run
`standard` only, and the runner offers nothing else.

| Mode | Warmup | Window | For |
|---|---|---|---|
| `quick` (the runner's default where offered) | at most `QUICK_WARMUP_MS` (0.5 s) | stops once every watched series has settled: at least `QUICK_MIN_WINDOW_MS` (1 s) and `QUICK_MIN_SAMPLES` (60) per series, at most `durationMs`; without series, `QUICK_WINDOW_MS` (2 s) | checking work as you go |
| `standard` | `warmupMs` | `durationMs` | results that count: baselines, final comparisons |
| `soak` | `warmupMs` | at least `SOAK_WINDOW_MS` (60 s); reports each series' drift | behaviour over time: throttling, leaks, creeping cost |

```ts
measure: async (scenario, context) => {
  const frames: number[] = [];
  // ... collect frames while the window runs ...
  await context.measureWindow(scenario, [{ name: 'frameMs', samples: () => frames, resolution: 0.1 }]);
  return { metrics: [{ name: 'frameMs', unit: 'ms', source: '...', samples: frames }] };
},
```

A series has settled when the first and second half of its samples agree on the median within 5% and on the p95
within 10%, or within its `resolution` (its timer step; a 0.1 ms timer cannot settle a 0.3 ms median to 5%). Soak
reports `drift`: the change of each series' median from the first to the last quarter. The case keeps the window
(`TestCaseResult.window`: `stoppedBy` `settled`, `max` or `fixed`, `elapsedMs`, sample counts, `drift`), the
result keeps `mode`, and `npm run test:summary` prints both. Compare a quick run only with quick runs. Soak raises
the default run timeout by the soak windows.

## Page focus

On the visible profiles a run watches the page from warmup to the end of each measurement. If the page is
hidden or loses focus, the case stops, the run pauses (phase `paused`, run timeout stopped) until the page is
visible and focused again, and the case is redone from `apply`. After `MAX_FOCUS_RETRIES` (2) redos the loss is
recorded as a validity issue instead, as is a loss on a page that was never visible and focused in this run (a
background or headless run is not waited for). The case keeps `retries`. A pause gives up after
`FOCUS_RESUME_TIMEOUT_MS` (10 minutes). Navigating away is recorded, never redone.

## Result card and agent hand-off

When a run ends the runner shows one card: status, mode, duration, counts of valid, invalid and failed cases,
the saved file, A/B outcomes, and up to eight problem lines (failed checks, validity issues, redos, unsettled
windows, drift). Per-case metrics, checks, the JSON and the rerun link are under **Details**. **Copy for agent**
copies the few lines an agent needs to find the run (`testRunAgentText(run, savedFile)`): suite, mode, profile,
verdicts, counts, the saved file, the `test:summary` command and every problem. `digestTestRun(run)` gives the
same counts and lines for a host's own UI.

## Launch links

```text
/your-page?testSuite=feature-check&testVersion=1&testProfile=human-observed&testRepetitions=1&testAutoStart=1
```

`testSuite=latest` follows append order and omits `testVersion`; the result's rerun
link always pins an exact ID/version and the mode. `testMode` is `quick`, `standard`
(when omitted, as in links made before modes) or `soak`. The profile is `visible-browser`,
`human-observed`, or `headless-hardware`. Repetitions are bounded to 1–5. Unknown
versions/invalid options fail visibly and do not autostart a replacement test.
Backend and other application query parameters are preserved in copied links.

Autostart requires both `[allowAutoStart]="true"` and `[available]="true"`. It starts
once per component initialization, and waits while `externalBusy` is true. Applications
must decide whether their dev/test mode permits autostart; a query parameter alone
does not enable hidden production tooling. Button execution uses the same input checks.

## Saved results (dev only)

Browser runs save themselves to disk so an agent can read them. This is on by default
in dev builds: each finished run, and each visual review of it, is POSTed to the
same-origin `/__triangular-test-sink`, or the URL passed as `[resultSink]`.
`[resultSink]="false"` opts out. Production builds never post. If the receiver is unreachable the panel says
"Result not saved ... use Download JSON"; it never fails silently.

**Setup per game (two lines plus an optional file).** In `angular.json`, set the
`serve` option `"proxyConfig": "proxy.conf.cjs"` and create that file:

```js
module.exports = require('triangular-engine/bin/triangular-test-proxy.cjs')();
```

`ng serve` then starts the dependency-free receiver itself (loopback only, port 4223,
stopped with the server) and forwards the sink path to it. Optional repo-root
`triangular-test.config.json`: `{ "port": 4223, "outputDir": "artifacts/test-runs",
"fingerprintPaths": ["projects/my-game", "node_modules/triangular-engine"] }`. Without
a proxy, run `npx triangular-test-receiver` (in this repository: `npm run test:receiver`) and pass the receiver URL as `resultSink`.
Keep `artifacts/` gitignored.

**Where results live.** `artifacts/test-runs/<suite>@v<version>/<timestamp>_<profile>_<hash>.json`
(full result plus `fingerprint`) and one line per run in `artifacts/test-runs/index.jsonl`.
Runs accumulate; nothing is overwritten. Stored samples are rounded to 3 decimals and
numeric arrays sit on one line, which makes a file roughly a third of its former size.
Each index line also carries `errors` and `cases`: per scenario, across repetitions,
`{ n, min, med, p95, max }` for every metric plus the failed checks.

`TestSession` adds a `summary` (`count`, `min`, `median`, `p95`, `max`) to every metric
with finite samples. All percentiles are nearest rank (`nearestRankPercentile`,
`summarizeTestSamples`), the same rule `FrameSampler` and the summary bin use.

**Fingerprint.** Computed by the receiver as git `HEAD` plus a hash of the working-tree
diff and untracked files under `fingerprintPaths`. It is deliberately coarse: any edit
there changes it. Older runs are flagged `STALE` in summaries, not removed.

**Reading cheaply.** Run the summary first (`npx triangular-test-summary [--suite id] [--last N]` in a consumer app, where the bin is installed; inside this repository use `npm run test:summary -- [--suite id] [--last N]`, since `npx` cannot resolve the bin here): date,
profile, fingerprint and stale flag, the three verdicts, median/p95/max per scenario
metric (a constant metric such as a draw count prints once as `= value`) and failed
checks only. `--metric text` keeps only metrics whose name contains `text`. The summary
reads only `index.jsonl`; it opens a result file just for lines written before case
summaries existed. Open a full JSON only for a failing case.

**Caveat.** Headless or software-rendered (SwiftShader) runs give GPU timings that are
not real hardware numbers; use visible-tab runs on the target machine for performance. See
[Machine context](#machine-context-dev-only) for the recorded adapter and machine state.

## Machine context (dev only)

A timing number is only as good as the machine state behind it. With the result sink on, a **performance** suite
also records what the computer was doing while each case measured. Correctness suites send nothing.

**GPU adapter per run.** Put the adapter the renderer really uses into the adapter's `environment()`:

```ts
import { describeRendererGpu } from 'triangular-engine/testing';
environment: () => ({ ...describeRendererGpu(renderer), build: 'dev' }),
// or, with adapter info in hand: describeGpuAdapter(device.adapterInfo)
```

This adds `gpu.backend` (`webgpu`, `webgl`, `unknown`), `gpu.vendor`, `gpu.architecture`, `gpu.device` and
`gpu.description`; browsers may blank fields, which read `unknown`. Three.js 0.186 does not keep the `GPUAdapter`, so
`describeRendererGpu` reads `renderer.backend.device.adapterInfo` (WebGL fallback: the unmasked vendor and renderer
strings). Never call `navigator.gpu.requestAdapter()` just to describe the GPU: on a machine with two GPUs it can
return a different one than the renderer. **A performance run with no adapter info, or on an adapter other than the
expected one, is not a hardware number.** A suite can say which GPU it is for with `expectedGpuVendor: 'nvidia'`
(case-insensitive substring of `gpu.vendor`); a timing case on another vendor, or with no recorded adapter, gets a
validity issue and the run is `inconclusive`. The summary prints the vendor and backend per run.

**What the receiver records.** `TestSession` (option `machineSink`, which `<tri-test-runner>` sets from `resultSink`
in dev builds) sends `start` and `stop` fire-and-forget with a one-second timeout, and awaits `prepare` (see
Preflight); a missing, slow or failing receiver never fails a run. All are `POST <sink>/machine/<kind>` with a `text/plain` JSON body:

| kind | when | body |
| --- | --- | --- |
| `prepare` | run start, before capture | `{ runId, suiteId, suiteVersion }` |
| `start` | just before `measure` | `{ runId, suiteId, suiteVersion, scenarioId, repetition }` |
| `stop` | after `measure` ends or fails | same as `start` |

Between `start` and `stop` the receiver samples every 500 ms: CPU load (`os.cpus()` deltas) and free RAM
(`os.freemem()`), plus, when `nvidia-smi` exists, GPU utilisation, VRAM, temperature, power, SM clock, P-state and
the clock-throttle reason mask (`nvidia-smi ... -lms 500`, for the GPU index in `triangular-test.config.json` `gpuIndex`, default 0). Without `nvidia-smi` the block says
`gpu: 'unavailable'` plus a reason. Each case in the saved result gets a `machine` block with `n`, `min`, `med`,
`p95`, `max` per field (nearest rank, the same helper as the case summaries). A `start` whose `stop` was lost is
finished when the result arrives, or after five minutes.

**Preflight** runs once per run on `prepare`, so its slow calls (about 3 s on Windows) fall in setup, not inside the
first measurement. The receiver answers `prepare` only once the preflight has finished (after at most 8 s, with
`preflight: 'pending'`), and the session waits for that answer (at most `MACHINE_PREPARE_TIMEOUT_MS`, 10 s) before the
first case; a missing or slow receiver costs only that wait and never fails the run. If the preflight is still running
when the first case starts anyway (an older receiver, or a timed-out wait), the run is marked
`preflight-overlapped-measurement`. It records GPU idle load for about a second, and on Windows AC or battery
(`Win32_Battery`), the active power scheme (`powercfg`), and the five processes using the most CPU over one second;
with `nvidia-smi` also the processes holding GPU memory. Other systems skip the power and process checks. **Process
names are stored only in the result file under `artifacts/` (gitignored). Never copy them into docs, plans or
committed baselines.**

**Warnings, not failures.** The run gets `machine.warnings` in its result and index line: `on-battery`,
`gpu-busy-before-start` (a non-browser process holds GPU memory before the run; the page under test already renders
during preflight, so its own load does not count. Without an `nvidia-smi` process list it falls back to median GPU
utilisation above 20%), `gpu-hot-before-start` (at least 80 C),
`gpu-throttled` (power-cap, slowdown or thermal clock reasons during a case), `preflight-overlapped-measurement`, and
`gpu-adapter-unrecorded`. These thresholds are placeholders to be set in Phase 0 of Plan 055 from measured idle
readings; they mark a run and never change its verdict. The index line also carries `gpu` and `gpuBackend` (from
`environment`) and a tiny `machine` summary (`warnings`, `cases`, and the highest per-case median CPU and GPU load and
GPU temperature), so `npm run test:summary` prints one `machine:` line per run without opening the result.

Not included: an empty-frame noise-floor probe before and after a suite needs the page's renderer, so it belongs to
a lab page, not this entry. The receiver sampling is injectable (`createReceiver(root, config, { monitor })`,
`createMachineMonitor({ sampler, probe })`) for tests on machines without `nvidia-smi`.

## Ablation (ABAB)

`compareAblation(rounds, { maxSpread?, statistic? })` compares a baseline (arm `A`) with a feature (arm `B`) from
rounds that ran alternately, A B A B ...: slow drift (thermals, clocks, background load) then hits both arms
alike instead of looking like an effect. It is pure and has no Angular, renderer or receiver dependency; it does
not run anything, it only judges the numbers a page already collected.

```ts
import { compareAblation } from 'triangular-engine/testing';
const result = compareAblation([
  { arm: 'A', samples: gpuMsRound1 }, { arm: 'B', samples: gpuMsRound2 },
  { arm: 'A', samples: gpuMsRound3 }, { arm: 'B', samples: gpuMsRound4 },
], { statistic: 'median' });
// result.verdict, result.difference, result.relative, result.noiseBand, result.reasons
```

- Each round is reduced to one number, its `median` (default) or `p95` (nearest rank, the same helper as the case
  summaries). An arm's value is the median of its round numbers. Lower is better (a time).
- `difference` is B minus A; `relative` is `difference / A`. Negative means B is faster.
- `spread` per arm is `(max - min) / median` of its round numbers. Above `maxSpread` (default `0.15`) the verdict
  is `rejected`: the machine moved too much to trust any gap. The numbers are still returned.
- `noiseBand` is `sqrt(halfRangeA^2 + halfRangeB^2)`, where `halfRange` is half of `max - min` of an arm's round
  numbers. B is `faster` or `slower` only when `|difference|` is larger than the band, otherwise `no-difference`.
  With two rounds per arm the band is crude (it is just how far the two rounds disagreed), so prefer four or more.
- `invalid` (with `reasons`, numbers `NaN`): fewer than two rounds in an arm, two neighbouring rounds from the same
  arm, a round with no finite samples or with non-finite samples, or an unusable `maxSpread`.

### A/B suites

A suite can run the rounds itself. Give it `ablation: { feature, metrics, statistic?, maxSpread? }` and give each
round scenario `ablation: { group, arm }`, in the order A, B, A, B per group. `TestSession` then calls
`compareAblation` per group and metric over the rounds' samples, in run order, and stores the outcomes in
`TestRunResult.ablations` (with `invalidRounds`, the rounds that had a validity issue). The runner card, the
agent text and `npm run test:summary` print one `A/B` line each. Repetitions keep alternating, so two repetitions
double the rounds.

```ts
ablation: { feature: 'shadows', metrics: ['gpuPassTotal'] },
scenarios: [
  { id: 'off-1', label: 'Off, round 1', durationMs: 5000, settings: off, ablation: { group: 'orbit', arm: 'A' } },
  { id: 'on-1', label: 'On, round 1', durationMs: 5000, settings: on, ablation: { group: 'orbit', arm: 'B' } },
  // ... three or more rounds per arm
],
```

## GPU time per pass

With the engine option `gpuTiming: true` on `WebGPURenderer`, a `FrameSampler` window also splits GPU time by
render pass. The engine reads this from the timestamps Three.js already writes for every pass, so it adds no
query of its own.

```ts
const sampler = engine.fpsController.frameSampler;
sampler.start();
// ... let the scenario run ...
const { gpuPasses } = sampler.stop();
// gpuPasses?.byKind.scene / .shadow / .output / .fullscreen: { count, medianMs, p95Ms, samples }
// gpuPasses?.byLabel['Shadow Map [ sun ]'], gpuPasses?.total, gpuPasses?.resolution, gpuPasses?.selfTest
```

- **Kinds.**
  - `shadow`: a shadow-map pass. Three.js names it `Shadow Map [ <light> ]`.
  - `output`: the renderer's tone-mapping and colour-space pass.
  - `fullscreen`: any other `QuadMesh` pass, such as post-processing.
  - `scene`: everything else.
- **Passes, not meshes.** Two meshes drawn in one pass share one number. To see an object's own cost, give it its
  own pass, or compare the scene with it and without it (see [Ablation](#ablation-abab)). A scene pass includes its
  clear, so compare it against an empty frame.
- **Whole frames only.** A frame counts only when every pass the renderer began for it has a timestamp. A readback
  that lands mid-frame, or a timestamp pool that overflowed, drops that frame; it never under-counts it.
- **Timer self-test** (`selfTest.passed`, with `issues`). It fails when:
  - a timestamp belongs to no recorded pass;
  - a frame is missing a pass;
  - a batch repeats frames already counted (a stale readback);
  - a frame's passes do not add up to the Three.js total;
  - fewer than 8 nonzero durations were seen;
  - the timestamps are rounded.
- **Rounding.** `resolution.resolutionNs` is the largest step that every duration is a whole multiple of.
  - Chrome without `chrome://flags/#enable-webgpu-developer-features` rounds to tens of microseconds, which reads
    as `quantized`.
  - With the flag on, the step is about 1 µs.
- Compute passes are not split yet.

## Evidence and limitations

When adding or substantially updating a spike, plan or runbook, append verified
experiments to its `performance` array and keep prior versions as history. Empty
arrays indicate planned work with no executable case. Keep paired document entries
consistent; there is no shared-manifest resolver or automatic Markdown run button.
The host page exposes **Run latest test**; documents provide its corresponding
launch link and exact-version rerun. A blocked latest experiment keeps its blocker.
See the repository's `docs/plans-and-runbooks.md` for this authoring convention.

Results include the exact suite/settings, repetitions, environment, per-case checks,
raw metrics, validity issues, errors, and a pinned rerun URL. Use **Copy result** or
**Download JSON**; `(completed)` lets a host retain results or add another transport.
No queue, idle-agent wakeup, baseline store, or cross-page suite chain is implemented.
Keep the full JSON as an artifact, including failed runs. Give agents a compact
summary with verdicts, failed checks, key measurements, limitations, exact rerun
link and artifact path; read raw case samples only when needed.

Visible/observer profiles record focus/visibility loss during measurements. Headless
performance is marked inconclusive without independently verified hardware/profile
support. Performance cases require at least one non-optional metric. Empty required
metrics and non-finite samples in any metric invalidate performance evidence. An
additional unavailable metric can use `optional: true` with an `unavailableReason`;
its empty samples do not invalidate the available required measurements. Choose
optional status based on the experiment's question, never to hide missing evidence
needed to answer it. There is no
generic budget/baseline comparison: available numbers remain **unassessed**, not a
performance pass. `visualReview` starts **pending** when the suite sets
`requiresVisualReview: true` or the profile is `human-observed`. Otherwise it is
**not-required**, for both functional and performance suites. Functional checks
that need appearance review must set the flag explicitly. Pending review changes
only when an observer explicitly accepts or rejects it. Automated completion and
observer acceptance are separate fields. The panel lists individual checks and
their details, case errors, and run-level errors.

The cloud lab adapter reports diagnostic batched whole-render GPU timestamps,
including bake passes, with explicit limitations. It is not proof of isolated cloud
pass cost or controlled-machine performance. The separate replay experiment remains
unchanged. See repository Plan/Runbook 052 for the outstanding measurement work.

The demo reuses the existing `FrameSampler` for completed-frame CPU/cadence summaries
and to suspend the stats controller's scene traversal inside a measuring window.
Provider timestamp readbacks started before a reset are discarded. The shared UI
slider is installed from an identifiable archive under ignored `ignore/packages/`;
it is a demo dependency, not a dependency of this optional library entry.

Maintainer checks: `npm run test:triangular-engine:testing`, a headless demo test with
`--include='**/gpu-timer.spec.ts'`, and
`npx playwright test -c playwright.runner.config.ts`. The latter uses the existing
application host; set `TRIANGULAR_TEST_BASE_URL` to target another served build. Its
`**/*runner.spec.ts` pattern includes new runner integrations without a config edit;
pass a filename to Playwright to select one integration. Software-rendered browser
checks establish functional integration only.
