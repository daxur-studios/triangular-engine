---
name: triangular-engine-testing
description: Add or extend repeatable functional, visual-review, and diagnostic performance tests in Angular games using triangular-engine/testing, including scenario history, camera paths, test launch URLs, and result handoff.
---

# Browser tests for games

Use the public `triangular-engine/testing` entry to turn a request such as “watch
the camera move while toggling clouds” into a runnable, repeatable test. Keep
game-specific actions, cameras and measurement providers in the game. The entry
supplies the standalone panel, DTOs, executor and URL helpers; it has no renderer,
router, shared UI or automation-client dependency.

## Integrate with an existing game

1. Inspect the installed `testing/index.d.ts` and the game's real action/controller
   methods before wiring an adapter. Import from `triangular-engine/testing`, never
   from internal engine source paths. Use the game's existing dev/test route and
   application host where practical.
2. Define fully resolved, JSON-compatible scenario settings: include the relevant
   seed, initial camera pose, path, toggles, quality and simulation state. Camera
   vectors must be plain data, not Three.js instances. Use finite numbers; omit
   functions, signals and cyclic objects from settings.
3. Implement `TestRunAdapter<Settings, Snapshot>` using the application's normal
   action methods. Read [the adapter recipe](references/game-adapter.md) for the
   lifecycle and a minimal factory. Capture and restore all state the test changes,
   including camera/control state. Await rendered readiness, not an arbitrary sleep.
   `ready(context, scenario)` receives the applied scenario explicitly.
4. Add `TestRunnerComponent` to the host's standalone imports. Bind the suite
   history, adapter, actual readiness and any competing workload. Let
   `progressChange` show the active settings and prevent conflicting manual input.
   The panel uses Angular reactive forms; connect game form controls through their
   existing reactive-form/controller path rather than editing DOM elements.

```html
<tri-test-runner [suites]="testHistory" [adapter]="testAdapter"
  [available]="sceneReady()" [externalBusy]="otherWorkRunning()"
  [allowAutoStart]="testModeEnabled"
  (progressChange)="onTestProgress($event)"
  (completed)="retainTestResult($event)" />
```

These host members are integration points to implement in the game. Autostart
requires explicit application opt-in; a query parameter alone does not enable it.
The host owns control locking, including canvas/pointer/keyboard input and other
test actions. A disabled form fieldset only covers its native form controls.

## Author and retain scenarios

Store a `readonly TestSuite<Settings>[]` oldest-first. The final entry is **Run
latest test**; append a new suite or version when an experiment changes. Preserve
the meaning of already shared IDs/versions. Use `purpose: 'functional'` for checks,
`'performance'` for timing experiments, and `requiresVisualReview: true` when an
observer must assess appearance.

Represent teleport, pan, zoom, orbit and path traversal as game-owned settings and
adapter actions. They are not built-in engine commands or an executable JSON DSL.
Execute motion inside `measure`, over `scenario.durationMs`, so the observations
cover the action rather than the idle period after it. Use actual completed frames
and the game's existing clock; honor `context.signal` and remove subscriptions on
completion or abort. Use `context.wait(ms)` only for abortable timed waits.

Keep settings feedback visible while running. Capture is read-only; restore must
work after partial application or cancellation. The default run timeout is 180
seconds; restoration receives a fresh signal with a separate five-second timeout.
Do not start uncancellable background work from an adapter.

## Give the user a runnable link

Create a concrete launch link instead of only saying “visit this page and test it
visually.” Use `buildTestLaunchUrl(baseUrl, suite, profile, repetitions)` or the
panel's **Copy launch link** for an exact version:

```text
/game-test?testSuite=camera-toggle&testVersion=1&testProfile=human-observed&testRepetitions=1&testAutoStart=1
```

`testSuite=latest` follows the final history entry and omits `testVersion`. Exact
versions are preferable for evidence and reruns. Other application query parameters
are preserved by the URL helper. Supported profiles are `visible-browser`,
`human-observed`, and `headless-hardware`; repetitions are 1–5. Unknown versions or
invalid launch options fail visibly rather than silently substituting a test.

When updating a spike, plan or runbook, append the runnable experiment to its
`performance` array and provide a Markdown launch link for the latest item. Keep
prior entries as history. Describe whether a link runs functional checks or
diagnostic measurements; a runnable link is not an accepted baseline.

## Interpret and hand off evidence

- Return `TestObservation` with real checks and provider metrics. Label each
  metric's unit, source, unavailable reason and attribution limits. Do not invent
  GPU timings from frame cadence. Include build/backend/device/viewport information
  through the adapter's `environment()` where available; label unknown values.
  Use `optional: true` for an additional metric the page cannot provide and give
  its `unavailableReason`. Performance cases still need at least one required
  metric with samples; empty required or non-finite samples invalidate evidence.
- Keep automated completion, `automatedVerdict`, `performanceVerdict`, and
  `visualReview` distinct. A completed run does not prove visual correctness.
  Visible profiles record focus/visibility loss; visibility alone does not prove
  an unthrottled GPU. The current runner leaves usable performance numbers
  `unassessed`, and marks missing evidence or unverified headless performance
  `inconclusive`. It does not compare budgets or baselines.
  `visualReview` starts `pending` when `requiresVisualReview: true` or the profile
  is `human-observed`; otherwise it is `not-required`, regardless of suite purpose.
  Set the flag explicitly for functional tests that need appearance review.
- Use the panel's JSON copy/download or host `(completed)` output to retain the
  exact suite, settings, environment and results. Include the exact-version rerun
  link in the handoff. Human acceptance is explicit; never accept it for the user.
  Save full JSON as an artifact when possible. Report verdicts, failed checks,
  key measurements, limitations, rerun link and artifact path first; inspect raw
  samples on demand. Retain failed-run evidence too.
- `(completed)` is an in-page Angular output. For durable handoff add
  `[resultSink]="true"` to the panel (dev only). Recipe: set the `serve` option
  `"proxyConfig": "proxy.conf.cjs"` in `angular.json` and make that file
  `module.exports = require('triangular-engine/bin/triangular-test-proxy.cjs')();`.
  `ng serve` then starts the receiver and every run (and review) is saved to
  `artifacts/test-runs/<suite>@v<version>/<timestamp>_<profile>_<hash>.json` plus a
  line in `artifacts/test-runs/index.jsonl`. Optional repo-root
  `triangular-test.config.json` sets `fingerprintPaths` (the engine and the page
  folder), `port`, `outputDir`. If the panel says "Result not saved", use Download JSON.
- **Read results cheaply:** run `npx triangular-test-summary [--suite id] [--last N]`
  first. It shows date, profile, fingerprint, `STALE` vs the current tree, the three
  verdicts, median/p95/max per scenario and failed checks only. Open a full JSON
  (path printed per run) only for a failing case. Stale runs stay as history; do not
  compare timings across fingerprints without saying so.
- **Do not trust headless/SwiftShader GPU timings** as hardware numbers. Ask for a
  visible-tab run on the target machine for performance questions; agent-run headless
  runs establish functional integration only.
- Without a receiver, JSON copy/paste is the fallback handoff. No queue or
  idle-agent wakeup exists.

Verify the adapter's meaningful checks, cancellation and restoration with the
game's narrow existing tests. Keep automated browser checks headless and
non-watching; software-rendered checks establish functional integration, not GPU
performance acceptance. A separately requested human-observed run uses the visible
game page. Report what actually ran and which reviews or measurements remain open.
