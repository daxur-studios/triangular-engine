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
3. Optional `thumbnail(scenario, context)` takes the case's picture once `measure` has returned for an attempt that
   is kept (see [Case thumbnails](#case-thumbnails)).
4. `restore(snapshot, context)` executes even after failure/cancel, using a fresh
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
same counts and lines for a host's own UI. When a run finishes (completed, failed or inconclusive, not cancelled) and its
save has settled, the runner also copies that text once by itself, so it names the saved file; this needs a focused tab,
otherwise the card says "Not copied (tab not focused); press Copy for agent". It is not repeated after a visual review.
`[copyOnFinish]="false"` turns it off for a page, and the **Copy for agent when done** checkbox under More options is
the viewer's own choice, remembered in `localStorage`.

## Launch links

```text
/your-page?testSuite=feature-check&testVersion=1&testProfile=human-observed&testRepetitions=1&testAutoStart=1
```

`testSuite=latest` follows append order and omits `testVersion`; the result's rerun
link always pins an exact ID/version and the mode. `testMode` is `quick`, `standard`
(when omitted, as in links made before modes) or `soak`. `testThumbnails=0` turns the
[case thumbnails](#case-thumbnails) off (on when omitted; the link builder only writes it when off). The profile is `visible-browser`,
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

`ng serve` then starts the dependency-free receiver itself (loopback only, port 4723,
stopped with the server) and forwards the sink path to it. Optional repo-root
`triangular-test.config.json`: `{ "port": 4723, "outputDir": "artifacts/test-runs",
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

**Read routes (same origin as the sink, local dev only).** `GET <sink>/runs?limit=N` returns
`{ runs, total }` (the newest N index lines, default 300), `GET <sink>/run?file=<suite>@v<n>/<result>.json` one result and
`GET <sink>/image?file=<suite>@v<n>/<result-stem>/<name>.webp` one thumbnail. A `file` is accepted only if every path
segment is in the alphabet the receiver itself writes (no leading dot, separators or drive letters), the extension is
`.json` (run) or an image type (image), and the real path stays under the output folder; anything else is a 400. A request
with an `Origin` that is not a loopback host gets a 403, and loopback origins get a matching
`access-control-allow-origin`, so the page can read a receiver on another port while an arbitrary website cannot.

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

## Case thumbnails

A thumbnail is a small picture of what a case looks at, so the [results page](#results-page) can show it next to the
numbers. It is a helper for the reader, not evidence, and it never enters a timing window.

```ts
const adapter: TestRunAdapter<Settings, Settings> = {
  // capture, apply, ready, measure, restore ...
  thumbnail: async (scenario, context) => {
    if (context.repetition > 1) return undefined;            // later repetitions look at the same thing
    return [await screenshots.capture({ format: 'image/webp', quality: 0.6,
      compress: { maxWidthOrHeight: 240, fileType: 'image/webp', quality: 0.6 } })];
  },
};
```

- **Name.** `thumbnail`, not `capture` (`capture` is the state snapshot). The testing entry has no renderer: the page takes
  the picture itself, for example with the engine's `ScreenshotService` on its fast path (no `resolution`, `multiplier`
  or `samples`, so the renderer is not resized) and the opt-in `triangular-engine/image-compression` adapter
  (`provideBrowserImageCompression()` in the page's providers).
- **When.** `TestSession` calls it once per kept case, after `measure` has returned. Never in warmup or the window, and
  never for an attempt that is about to be redone after focus loss. Before it runs, the focus listeners and the machine
  `stop` message are finished, so the capture adds no validity issue, no redo and no load to the case's machine block.
  A case with failed checks is kept and gets its picture.
- **Abort and failure.** The hook gets the run's abort signal and `THUMBNAIL_TIMEOUT_MS` (10 s). A rejection or timeout
  becomes a limitation on the case (`Thumbnail not taken: ...`); it never fails the case.
- **Several images** (a looped view) are allowed, at most `MAX_CASE_THUMBNAILS` (4). Return `undefined` or `[]` for none.
- **Limits.** `MAX_THUMBNAIL_BYTES` (64 KB) per image and `MAX_RUN_THUMBNAIL_BYTES` (2 MB) per run. Over either, the
  image is dropped and a limitation says so; the receiver enforces the same limits (`maxImageBytes`, `maxRunImageBytes`
  in `triangular-test.config.json`) and also checks the file signature (WebP, PNG or JPEG). Aim for 5-10 KB each.
- **On by default**, taken only when the result sink is on. `TestRunOptions.thumbnails: false`, the runner's
  **Case thumbnails** checkbox (More options) and `testThumbnails=0` in a launch link turn them off. A host calling
  `TestSession.run` itself passes `onThumbnails` to receive the images (`TestCaseThumbnails`); the result has no pixels.
- **Transport and storage.** The runner adds the images to the POST as base64 `thumbnailUploads` (never in the JSON it
  shows, copies or downloads). The receiver writes `artifacts/test-runs/<suite>@v<n>/<result-file-stem>/<case>-r<rep>-<i>.webp`,
  and the stored result and index line keep only the file names (`thumbnails`, relative to `artifacts/test-runs/`). The
  reply lists `thumbnails` and `dropped`, which the runner shows under the result card.
- **Motion labs.** A fly-by or sweep has no single view, and a representative frame needs an extra pass that is not
  part of the timed window. Such adapters simply omit the hook.

## Results page

`TestResultsComponent` (`<tri-test-results>`, same entry, no engine or router dependency) browses the runs the receiver saved.
A host page only places it; the demo app has one at `/tests`.

```html
<tri-test-results [receiver]="'/__triangular-test-sink'" [targets]="{}" [autoplay]="false" />
```

- **Receiver.** An input that defaults to the runner's sink path; the page also has an editable URL field, so a receiver
  on another loopback port works. It reads the [read routes](#saved-results-dev-only).
- **Runs.** Newest first: `suite@version`, mode, GPU adapter, date, commit, the four verdicts, machine warnings and
  scenario counts (valid, invalid, failed). Filter by suite, mode and GPU. Tick two runs to compare them.
- **A run.** Its digest (`digestTestRun`: A/B outcomes and problems, from the full result) and one row per case: the
  thumbnail, the window (`settled`, `max` or `fixed`, seconds), redos, failed checks and validity issues, and a cell per
  metric with median / p95 and the change of the median from a baseline. The first four metrics show; tick **All
  metrics** or filter by name.
- **Baseline.** The same suite id and version in the same mode, matched by scenario id and metric. The default is the
  previous such run; any other matching run can be chosen, or none. A baseline on another GPU adapter is flagged. A
  time (`ms`) more than 5 % above the baseline reads as worse and more than 5 % below as better; other units only read
  as changed. This page only shows change; the verdict comes from the suite's budgets and baseline (see
  [Budgets and baselines](#budgets-and-baselines)). A failed budget or baseline check is listed on its case as
  `FAIL PERF ...`.
- **Targets.** The metric cell has a row for a target bar. Pass `[targets]` (metric key `name (unit)` to a value in that
  unit) and a bar appears; nothing is built in.
- **Compare.** Two runs side by side on one metric: both thumbnails and median (p95) per scenario id, and the change of B
  (the newer run) against A.
- **Thumbnails.** One image is a still. Several images (the first repetition's) loop on hover or focus, and a tap pins the
  loop on a phone. `[autoplay]` loops them without hover. With `prefers-reduced-motion` nothing moves by itself and a
  click steps to the next frame.
- **Reading it from code.** `parseTestRunIndex`, `defaultBaseline`, `compareToBaseline`, `filterRuns` and the other pure
  helpers are exported for a host's own view.

## Budgets and baselines

A performance suite can judge its own numbers, so `performanceVerdict` is `pass` or `fail` and not only `unassessed`.
`assessPerformance` (used by `TestSession`) does it; both inputs are plain data in the suite.

```ts
import baseline from './my-suite.baseline.json';

const suite: TestSuite<Settings> = {
  id: 'my-suite', version: 1, purpose: 'performance', expectedGpuVendor: 'nvidia',
  baseline: baseline as TestBaseline,                      // committed numbers of an accepted run
  scenarios: [{ id: 'orbit', label: 'Orbit', durationMs: 5000, settings,
    budgets: { gpuPassTotal: { p95: 1.0 } } }],             // limits in the metric's own unit
};
```

- **Budget.** `TestScenario.budgets`, keyed by metric name: `{ p95?, median? }`. A case passes when its summary
  statistic is at or below the limit.
- **Baseline.** `TestSuite.baseline`: `{ runId, recordedAt, mode, gpu?, cases: { scenarioId: { metric: { median, p95 } } } }`.
  Only metrics listed there are compared, for both median and p95. A value regresses only when it is above
  `base * (1 + maxRegression)` **and** above `base + minRegression`: GPU passes here take about 0.1 ms, where a
  percentage alone is noise. Defaults: `maxRegression` 0.10, `minRegression` 0.05 (the metric's unit, ms here); set
  either on the baseline. Getting faster never fails.
- **Same mode only.** A baseline is compared only with a run of its own `mode`. Otherwise it is skipped, with a note in
  `performanceNotes` (budgets still apply). A run on a different GPU description than `baseline.gpu` also gets a note.
- **Why.** Every case with checks has `performanceChecks`: `{ metric, statistic, kind: 'budget' | 'baseline', limit,
  actual, base?, passed }`. `limit` is the largest value that passes. The receiver adds failed checks to the case's
  `failed` list, so `npm run test:summary` prints `FAIL PERF gpuPassTotal p95 1.2 > 1 (budget)` and the results page shows it.
- **Verdict**, in this order: functional suite `not-run`; failed or cancelled run, or any case with a validity issue
  `inconclusive`; a budgeted or baselined metric with no summary (and not `optional`) `inconclusive`, since missing
  evidence is not a pass; no budget and no applicable baseline `unassessed`; any failed check `fail`; else `pass`.
  An `optional` metric without samples is skipped.
- **Making a baseline.** Run the suite in `standard` mode on the intended machine, check it is valid and quiet
  (`npm run test:summary`), then:

  ```powershell
  npm run test:baseline '--' artifacts/test-runs/<suite>@v<n>/<result>.json --metrics gpuPassTotal > src/.../my-suite.baseline.json
  ```

  Without `--metrics` every metric with a summary is kept; leave out noisy CPU timers. Cases with a validity issue are
  dropped; repetitions are combined by median. `baselineFromRun(result, { metrics? })` is the same function in code.
- **Versions.** Budgets and baselines are judgement, not the experiment: adding or changing them keeps the suite version.
  Changing what a scenario does, or its settings or durations, is a new version, and the old baseline no longer fits it.

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
`gpu-throttled` (power-cap, slowdown or thermal clock reasons during a case), `preflight-overlapped-measurement`,
`other-app-measuring` (another app's timed case held the machine; see [Several apps at once](#several-apps-at-once-dev-only)), and
`gpu-adapter-unrecorded`. These thresholds are placeholders to be set in Phase 0 of Plan 055 from measured idle
readings; they mark a run and never change its verdict. The index line also carries `gpu` and `gpuBackend` (from
`environment`) and a tiny `machine` summary (`warnings`, `cases`, and the highest per-case median CPU and GPU load and
GPU temperature), so `npm run test:summary` prints one `machine:` line per run without opening the result.

Not included: an empty-frame noise-floor probe before and after a suite needs the page's renderer, so it belongs to
a lab page, not this entry. The receiver sampling is injectable (`createReceiver(root, config, { monitor })`,
`createMachineMonitor({ sampler, probe })`) for tests on machines without `nvidia-smi`.

## Several apps at once (dev only)

Several apps on one machine can each run a receiver. Three guards keep their results and timings apart.

**Identity.** `GET /__triangular-test-sink` answers `{ "ok": true, "receiver": "triangular-test", "root": "<12 hex>" }`.
`root` is the first 12 hex characters of the SHA-256 of the receiver's resolved output folder, so two receivers for the
same folder share it. `ok` stays for health checks.

**Port ownership.** When the port is already taken, the receiver probes that identity route. The same `root` means a
receiver for this folder: it reuses it and exits 0. Anything else (no answer, a non-JSON answer, another server, or a
receiver for another folder) prints the port and what answered, and exits 1, so results never land in another app's
folder. The `ng serve` proxy prints a banner when its receiver exits with an error, but it still forwards the sink to
that port: change the port instead of ignoring the banner. Each app sets its own `port` in `triangular-test.config.json`;
the default is 4723, outside the 42xx range dev servers use. Keep it different from every other app's port.

**Under a router.** A local router that runs one receiver per app sets `DAXUR_TEST_SINK=1` on the `ng serve` it spawns.
The proxy then starts no receiver and only returns the forwarding mapping. Only a router that runs the receiver itself
should set it.

**Timing lock.** Timed cases from different apps must not overlap, or they see each other's GPU load. While a receiver
holds the lock, a single file in the OS temp folder says who it is, `triangular-test-measuring.json`:

```json
{ "root": "3f9c1a2b7d04", "runId": "…", "scenarioId": "…", "repetition": 1, "pid": 12345, "expiresAt": 1760000000000 }
```

- A receiver takes the lock on a machine `start` and releases it on `stop` or `finish`. While held, a heartbeat
  extends `expiresAt` every 2 s; the time-to-live is 10 s.
- A lock is stale when `expiresAt` has passed or its `pid` is gone. A stale lock is taken over.
- `prepare` waits while another root holds a live lock, within the existing preflight bound (the receiver answers
  after 8 s, the page waits 10 s). If the lock is still held then, `prepare` answers `preflight: 'pending'` and the
  first case starts anyway.
- A case that cannot take the lock still measures, and its `machine` block gets `warnings: ["other-app-measuring"]`.
  The run's `machine.warnings` lists it too, so `npm run test:summary` prints `WARN … other-app-measuring`. The
  receiver whose case began during another app's measurement carries the warning.
- The lock is best effort. Two receivers that find the same stale lock at the same instant can both take it; that is
  rare on a dev machine, and the case is marked, never failed.
- Runs without machine sampling (`machineSampling: false`) never take or wait for the lock.

## Unattended runs (dev only)

`triangular-test-run` runs one suite with no one at the keyboard, for agents and for a machine left alone to measure.
Run it from the app's repo root, with the dev server and its receiver up:

```bash
npx triangular-test-run --url http://my-app.localhost:4200/lab --suite my-suite --version 1
```

Inside this repository use `npm run test:run -- …`. In order, it:

1. **Checks the receiver.** `GET <page origin>/__triangular-test-sink` must answer with this repo's `root`, or the run
   would be saved somewhere else. A `*.localhost` host is reached on 127.0.0.1 with its name in the `Host` header.
2. **Queues.** Each launcher writes a ticket into `triangular-test-queue/` in the OS temp folder, named
   `<ms>-<pid>.json`, holding the suite, version, repo and URL. The oldest ticket whose pid is alive runs, so launchers
   from any app on the machine take turns. Dead tickets are removed by whoever looks, so a crashed launcher never
   blocks the queue. The ticket is removed on exit.
3. **Waits for a quiet machine.** Over `--quiet-window-s` (10 s) the median GPU load must be at most `--quiet-pct`
   (10 %), and no process may be on the GPU except browsers and the Windows compositor (`dwm.exe`, which `nvidia-smi`
   lists as `[Insufficient Permissions]`). A game or another heavy app holds the run back. It checks again every 30 s
   and gives up after `--quiet-wait-min` (120 min). Without `nvidia-smi` it skips this check and says so.
4. **Opens a dedicated Chrome.** It uses a throwaway profile in the OS temp folder, full screen, with
   `--enable-webgpu-developer-features`: a fresh profile does not carry `chrome://flags`, and without that flag GPU
   timestamps are rounded and the timer self-test fails. The URL is the suite's autostart link (see "Launch links").
   On a hybrid-GPU laptop, `chrome.exe` uses the GPU set for it in the Windows graphics settings.
5. **Waits for the result.** It finishes when `index.jsonl` gains this suite and version with a `startedAt` after
   the launch, when `--timeout-min` (30) passes, or when that Chrome closes.
6. **Cleans up.** It closes that Chrome (unless `--keep-open`), deletes the profile and prints
   `triangular-test-summary --suite <id> --last 1`.

Exit codes: 0 saved and passed, 1 saved but not passed, 2 no result (timeout or Chrome closed), 3 never quiet,
4 setup error. Other options: `--profile`, `--mode`, `--repetitions`, `--no-thumbnails`, `--chrome <path>`.

For agents: start it in the background and wait for the process to exit. Do not poll. One launcher per run; queue
several suites by starting several launchers. If a launcher is killed, its Chrome window stays open; close it.

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
needed to answer it. Without budgets or an applicable baseline the available numbers stay
**unassessed**, not a performance pass (see [Budgets and baselines](#budgets-and-baselines)). `visualReview` starts **pending** when the suite sets
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

The planet shape lab takes one still per scenario (first repetition) with `ScreenshotService`; the other labs have no
thumbnails yet.

Maintainer checks: `npm run test:triangular-engine:testing`, `npm run test:triangular-engine:sink`, a headless demo test with
`--include='**/gpu-timer.spec.ts'`, and
`npx playwright test -c playwright.runner.config.ts`. The latter uses the existing
application host; set `TRIANGULAR_TEST_BASE_URL` to target another served build. Its
`**/*runner.spec.ts` pattern includes new runner integrations without a config edit;
pass a filename to Playwright to select one integration. Software-rendered browser
checks establish functional integration only.
