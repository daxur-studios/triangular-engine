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

Browser runs can save themselves to disk so an agent can read them. Opt in with
`[resultSink]="true"` on `<tri-test-runner>`; each finished run, and each visual
review of it, is POSTed to the same-origin `/__triangular-test-sink` (or the URL you
pass). Production builds never post. If the receiver is unreachable the panel says
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
not real hardware numbers; use visible-tab runs on the target machine for performance.

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
