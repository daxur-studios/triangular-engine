---
type: Runbook
title: Test Results Page and Case Thumbnails
description: Decisions, checks and open items for the saved-run browser page and untimed per-case thumbnails.
timestamp: 2026-10-20T00:00:00Z
tags: [testing, results, thumbnails, receiver, demo-app, tooling]
plans: [/docs/plans/058_test_results_page_and_thumbnails.md]
performance: []
---

# Runbook 058: Test Results Page and Case Thumbnails

Plan: [Plan 058](/docs/plans/058_test_results_page_and_thumbnails.md). Related:
[Plan 052](/docs/plans/052_page_test_sessions_and_performance_comparison.md),
[Plan 055](/docs/plans/055_planet_shape_system.md) (budgets come later, in its Phase 0).

## 2026-10-20 - Work started

### Decisions

- **Hook name** `thumbnail`, not `capture` (`capture` already means the state snapshot).
- **When it runs:** once, after `measure` has returned for an attempt that is kept (also a case with failed checks),
  never in warmup or the window, never for an attempt about to be redone after focus loss. The focus listeners and
  the machine `stop` message are finished first, so the capture cannot add a validity issue, trigger a redo or
  appear in the case's machine block. It gets its own 10 s timeout. An error or timeout becomes a limitation on the
  case; it never fails the case.
- **Transport:** the runner base64-encodes the images into the same POST as the result (`thumbnailUploads`). The
  receiver decodes, checks size and file signature, writes them under
  `<suite>@v<n>/<result-file-stem>/<case>-r<rep>-<i>.<ext>` and puts the names, relative to the
  `artifacts/test-runs/` folder, into each case (`thumbnails`) and into the index line. Anything over 64 KB, or past
  2 MB for the run, is dropped and listed in the reply and in the case's limitations.
- **Read routes** on the sink path: `/runs` (index), `/run?file=` (a result), `/image?file=` (a thumbnail). Each
  `file` is checked per path segment against the receiver's own file-name alphabet and an extension list, then
  resolved and required to stay under the output folder. CORS only for loopback origins.
- **Baseline:** same suite id and version, same mode, matched by scenario id, on the saved case medians. Default is
  the previous matching run. A different GPU adapter is flagged.
- **Motion labs** (fly-bys, sweeps) have no thumbnails: a representative frame needs an extra pass that is not part
  of the timed window. The hook is optional, so they simply omit it.

### Checks (2026-10-20)

- `npm run test:triangular-engine:testing`: 108 passed (session thumbnail cases: order, off, failing hook, abort, limits,
  blur during capture, redone attempt, machine window closed first; runner transport; launch parameter; results model,
  component and thumbnail component).
- `npm run test:triangular-engine:sink`: 16 passed (storage next to the result, per-image and per-run limits, bad
  signature, read routes, traversal attempts, non-loopback origin).
- `npx ng test demo-app ... --include planet-shape-lab, demo-index and test-results specs`: 35 passed.
- `npm run build:triangular-engine` and `npx tsc -p projects/demo-app/tsconfig.app.json --noEmit`: clean.
- Built-in browser pane: ran `planet-shape-baseline` (quick) from `/planet-shape-lab` with the new receiver; the run saved
  8 thumbnails of 0.6-2.6 KB each (240 px WebP, about 20 KB for the whole run). `/tests` listed the runs, a run showed
  its eight thumbnails, the window, redos and the change from the previous quick run, and compare showed two runs side
  by side. Phone width (375 px): no horizontal scroll.
- The pane renders on the AMD iGPU: its timings do not count, and the run is `inconclusive` (wrong GPU, page not
  focused). Its first run stopped after one case because the "GPU timer self-test" check fails without Chrome's WebGPU
  developer flag (timestamps rounded to 65 ms); for the verification run only that check was filtered out of the page's
  adapter from the console, with no change to the code. The old receiver that `ng serve` started was replaced by
  `npm run test:receiver` to pick up the new routes; restart `ng serve` (or the receiver) after pulling this change.
- Found while checking in the pane: index lines written by older receivers lack `failed` and `invalid` for some cases;
  `parseTestRunIndex` now fills them in (a spec covers it). A `<select [value]>` bound before its options exist shows the
  first option, so the options carry `[selected]`.

### Open

- Visual review of the page by the owner (layout, density, colours in the light theme).
- Motion labs (fly-bys, sweeps) have no thumbnails; they would need an extra untimed pass.
- Targets and budgets: the metric cell has a bar row driven by the `targets` input; Plan 055 Phase 0 supplies the values.
- The planet-shape thumbnails are small and mostly flat colour; the empty-frame case is a black box by design.
