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

Keep history oldest-first. Append suites or new versions; the final entry is
**Run latest test**. The history selector and **Run selected** retain earlier tests.
Do not change the meaning of an existing ID/version after sharing it. Inputs must be
structured-cloneable, JSON-compatible data with finite numbers. Paths and actions are
registered application code, not executable JSON instructions.

## Adapter lifecycle

The same `TestSession` drives button and URL launches:

1. `capture(context)` returns a read-only snapshot, including camera/control state.
2. For each repetition/scenario, `apply` uses the page's real action methods,
   `ready(context, scenario)` awaits completed renders and that scenario's explicit
   page conditions without caching the last applied scenario, then optional
   `warmupMs` elapses and `measure` runs the action for `durationMs`.
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

## Launch links

```text
/your-page?testSuite=feature-check&testVersion=1&testProfile=human-observed&testRepetitions=1&testAutoStart=1
```

`testSuite=latest` follows append order and omits `testVersion`; the result's rerun
link always pins an exact ID/version. The profile is `visible-browser`,
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
in dev builds) sends fire-and-forget messages with a one-second timeout; a missing, slow or failing receiver never
blocks or fails a run. All are `POST <sink>/machine/<kind>` with a `text/plain` JSON body:

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
first measurement; if it is still running when the first case starts the run is marked
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
