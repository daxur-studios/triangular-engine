---
type: EngineeringRecord
title: WebGPURenderer as the Default Renderer
description: Findings, decisions, test results and renderer comparisons for switching triangular-engine's default renderer to WebGPURenderer and removing Takram.
timestamp: 2026-10-19T00:00:00Z
tags: [renderer, webgpu, webgl, tsl, migration, postprocessing, takram, performance, testing, breaking-change]
plans: [/docs/plans/056_webgpu_default_renderer.md]
performance: []
---

# Runbook 056: WebGPURenderer as the Default Renderer

Plan: [Plan 056](/docs/plans/056_webgpu_default_renderer.md).

## 2026-11-01 — Phase 1 slice: recreated WebGPU renderers initialize (default unchanged)

Phase 1 work that needs no owner decision (D2, D6, D8 stay open). The default stays `'webgl'`.

- `EngineService.createWebGpuRenderer` now starts `init()` through `ensureWebGpuInit`. One init promise is kept per renderer, and `onComponentInit` reuses it. three 0.186.1 `init()` is idempotent, so this is safe. A failure emits `error$` with phase `'renderer-init'` (phase string unchanged).
- Scene recreation (`logarithmicDepthBuffer`) no longer leaves an uninitialized renderer, which had skipped every frame silently (`engine.service.ts` render guard).
- The `resolution$` subscription is held in one field, replaced on each recreation, and released on destroy. Before, each recreation added another subscription.
- Comment fix: `render-target.component.ts:96` said it builds a fullscreen quad scene; it uses the engine scene.
- Specs: `engine-webgpu-startup.spec.ts` covers init on recreation, no second init on the first load, init failure reaching `error$`, and a single `resolution$` observer after repeated creation.

**Verified:** the narrow headless spec passed (9 of 9) and `npm run build:triangular-engine` succeeded. Not verified: the full suite, and a real GPU or browser run of recreation. Device loss (`D6`) and the dev-mode warnings are still open.

## 2026-11-01 — Flip readiness review (documentation only; no engine code changed)

Scope: read Plan 056 Phase status, grep the library and demo app, and decide whether the default can flip now. Nothing was built, run or measured in a browser. Evidence is file:line from the working tree on this date.

### For the owner, in plain language

1. **Do not flip the default now.** The engine still defaults to classic WebGL (`engine.service.ts:354`), and that is the safe state.
2. **Two engine gaps would hurt a flipped default.** Scene recreation builds a WebGPU renderer without calling `init()`, and a lost GPU device is never handled. Both can leave a blank canvas.
3. **Consumers have no app-wide opt-out yet.** Each page sets its renderer, so one line in `app.config` cannot keep an app on WebGL.
4. **Some code silently draws wrong on WebGPU.** Patches made through `onBeforeCompile` are dropped without any error. Those pages need pinning or porting first.
5. **The safe path is three steps.** First close the engine gaps and add the opt-out. Then get a measured WebGPU versus WebGL comparison. Then flip the default with an automatic fallback and an explicit `'webgl'` opt-out, once you have decided the open questions D2, D6 and D8.

### 1. Phase 6 status and exit criteria

| Phase (Plan 056) | Status on 2026-11-01 | Evidence |
|---|---|---|
| Phase 0: baseline and measurement switches | **Not started.** No `rendererBackend` signal, no classic WebGL GPU timer, no `renderer-comparison` suite, no `engine-renderer-selection.spec.ts`. | `engine.service.ts:762` (the GPU timer only handles WebGPU); no matches for `rendererBackend` or `provideEngineDefaults` in `projects/triangular-engine` |
| Phase 1: engine core readiness | **Partly done.** Explicit `'webgpu'` builds `WebGPURenderer` with no classic fallback shortcut and emits `error$`. Recreation, device loss and the app-wide opt-out are not done. | `engine.service.ts:354-366` (explicit path), `engine.service.ts:330-339` (init error); `engine-webgpu-startup.spec.ts` (6 tests, per the 10-31 entry) |
| Phase 2: remove Takram | **Done** under [Plan 069](/docs/plans/069_remove-takram.md) (status done, 2026-10-28). The Takram folder is gone and `takram-clouds-spike` now routes to a deprecated page. | `app.routes.ts:67-70`; `projects/triangular-engine/takram` absent |
| Phase 3: TSL post-processing | Not started | `postprocessing/components/postprocessing-composer.component.ts:62-68` still requires `WebGLRenderer` |
| Phase 4: port shared WebGL-only modules | Not started | See blockers table |
| Phase 5: demo migration | Not started. The 10 pages that name `'webgpu'` are already on TSL; the rest need pins. | See blast radius |
| Phase 6: flip the default | **Not started and not ready.** | Exit criteria below |
| Phase 7: remove classic WebGL | Not scheduled (D3) | Plan 056 |

**Phase 6 exit criteria, from Plan 056** (all must hold):
- `preferredRenderer` defaults to `'webgpu'`; the engine model docs, README, components docs, the engine skill and the schematic output are updated.
- CHANGELOG entry marked breaking, with the opt-out shown.
- The `renderer-comparison` gate passes on the reference machine. Proposed thresholds (D8, not yet set by the owner): WebGPU GPU ms p50 ≤ classic WebGL × 1.10 and CPU frame ms p50 ≤ classic WebGL × 1.15. No page blank or missing features on visual review. Requires Phase 0 first, which is not done.
- `engine-renderer-selection.spec.ts` updated for the new default; full `npm test` and the library build pass; cloud WebGPU suite passes.
- Decisions D2, D3, D4, D5, D6, D7 and D8 are still **open** in Plan 056. Only D1 and D9 are decided.

**Plan 065 link.** Plan 065 asks for five Phase 0–1 items to be pulled forward so one consumer route can opt into WebGPU early. Item 2 (explicit `'webgpu'` picks `WebGPURenderer`) is done as of 10-31. Item 1 (`rendererBackend` signal) and item 5 (`onDeviceLost` → `error$`) are absent from the code. Items 3–4 were not checked in detail in this review.

### 2. Remaining blockers

Severity: **High** = blank or silently wrong output for a default consumer after the flip. **Medium** = breaks a feature or blocks measurement. **Low** = documentation or comment only.

| # | Blocker | Evidence (file:line) | Severity | Owner decision needed? |
|---|---|---|---|---|
| B1 | Default still `'webgl'` | `engine.service.ts:354` | n/a (the flip itself) | **Yes**: the timing of the flip, after B2–B9 |
| B2 | No app-wide opt-out (`provideEngineDefaults` / `ENGINE_DEFAULT_OPTIONS` absent); options are per page only | `engine.service.ts` `provide` path; grep finds none | High | No (design in Plan 056 §Renderer selection) |
| B3 | Scene recreation (`logarithmicDepthBuffer`) builds a new `WebGPURenderer` but never calls `init()`; `resolution$` is subscribed again on each call | `scene.component.ts:217-226`; `engine.service.ts:435-462` (no `init()` in `createWebGpuRenderer`; `resolution$.subscribe` at ~line 456) | High (likely blank; not run) | No |
| B4 | Lost GPU device is never handled. Only the WebGL `webglcontextlost`/`restored` events are hooked; WebGPU never fires them | `engine.service.ts:247-257` (handlers), `:277-278` (listeners) | High for WebGPU | **Yes** (D6: recreate or require reload) |
| B5 | Init failure on the WebGPU path does not fall back to the WebGL2 backend or classic WebGL; it emits `error$` and stops | `engine.service.ts:330-339` | Medium | **Yes** (D2: WebGL2 fallback or classic WebGL) |
| B6 | `onBeforeCompile` patches are silently dropped on `WebGPURenderer` (wrong picture, no error): CSM, trail ribbon, scatter wind/billboard/dither, terrain macro, cell-per-pixel, planet morph | `light/csm/engine-csm.ts:10-16`; `trail/core/trail-ribbon-material.ts`; `scatter/three/scatter-{wind,billboard,dither}-material.ts`; `worldgen/render/planet-morph-material.ts`; `worldgen/render/cell-per-pixel-material.ts` | High | No (port per Phase 4); a dev-mode scan is in Phase 1 |
| B7 | `<shaderMaterial>` / `<rawShaderMaterial>` are GLSL by definition and draw empty on WebGPU (public API) | `components/materials/material.component.ts:236-262` | High | No (proposed retire, D4 covers legacy) |
| B8 | Post-processing: pmndrs `<postprocessing-composer>` throws on WebGPU; engine `<effect-composer>` returns silently; underwater effect uses GLSL | `postprocessing/components/postprocessing-composer.component.ts:62-68`; `components/postprocessing/effect-composer/effect-composer.component.ts:71`; `water/postprocessing/water-underwater-effect.component.ts` | High | **Yes** (D5: where the TSL composer lives) |
| B9 | GLSL-only library modules still in tree: impostor bake/material, water surface and depth prepass, flow path, clipmap, CDLOD (two copies), legacy `clouds/three`, terrain macro/tiles | Plan 056 §Inventory; `impostor/three/create-octahedral-impostor-atlas.ts`, `water/rendering/water-surface-renderer.ts:2`, `worldgen/render/flow-path.ts:2`, `terrain/clipmap/clipmap-probe.ts:3`, `clouds/three/*` | High (blank or wrong) | **Yes** for legacy retire vs port (D4); the others are Phase 4 work |
| B10 | `render-target.component.ts` throws on classic WebGL (the comment says both work); the comment needs fixing | `components/render/render-target/render-target.component.ts:102-105` | Low (comment); behaviour is correct on WebGPU | No |
| B11 | Sync readback and `getContext()` / `capabilities` do not exist on `WebGPURenderer`. Impostor atlas and clipmap probe use sync readback; `cloud-volume-screen-pass.ts:37` reads WebGPU-only `backend.device.limits` (WebGL2 path unchecked) | `impostor/three/create-octahedral-impostor-atlas.ts` (6 hits); `terrain/clipmap/clipmap-probe.ts:3`; `cloud-volumes/cloud-volume-screen-pass.ts:37-39` | Medium | No (async API change, Phase 4 CHANGELOG) |
| B12 | Screenshots and thumbnails use `toDataURL`, which can return blank on WebGPU | `catalog-thumbnail.service.ts`, `scene-test-adapter.ts`, `scene-saver.component.ts`, `cloud-replay-probe.ts` (per 10-19 survey) | Medium | No |
| B13 | No GPU timer on classic WebGL, so the comparison has no GPU column for today's default | `engine.service.ts:762-774` (`resolveTimestampsAsync` is WebGPU-only); Plan 056 Phase 0 | Medium (blocks the gate) | No |
| B14 | WebGL2 fallback is unverified: headless Karma has no WebGPU adapter; cloud suite is WebGPU-only | `angular.json` (ChromeHeadless, no WebGPU flag); Plan 056 Open questions | Medium | **Yes** (D2 decides whether it is the supported fallback) |
| B15 | Demo pages set `webGLRendererParameters` that are silently ignored on WebGPU | See blast radius (9 pages) | Medium | No (Phase 1 dev warning) |
| B16 | Comparison pages, reference machine and gate thresholds not chosen | Plan 056 D7, D8 | Blocks the gate | **Yes** |

Plus the open 10-31 items: the `error$` phase string is `'renderer-init'` in code, but Plan 056 §Renderer selection writes `'rendererInit'`. Pick one and update the plan's text. Low severity, no behaviour change.

### 3. Blast radius of the flip

**Library consumers.** Anyone who does not set `preferredRenderer` gets `WebGPURenderer` after the flip. Those who cast `engine.renderer` to `WebGLRenderer`, call `getContext()`, read `capabilities`, use sync readback, or ship `ShaderMaterial` or `onBeforeCompile` will break or draw wrong. The first frame also waits for an async `init()`.

**Demo app (measured by grep, 2026-11-01):**
- About 65 page files call `EngineService.provide` or `provideEngineOptions`. **56 of them name no `preferredRenderer`**, so they rely on the default and flip with it.
- **11 files name `preferredRenderer`**. Ten set `'webgpu'` and are unaffected: `lod-surface-morph-spike`, `atmosphere-lab`, `atmosphere-planet`, `cell-planet-tsl`, `cloud-volumes-lab`, `lod-surface-lab`, `planet-material-extensions`, `planet-scene`, `planet-shape-lab`, `planet-surface-detail-spike`.
- **One page sets `'webgl'` explicitly:** `tsl-webgpu-spike` (`tsl-webgpu-spike-page.component.ts:126`). It sits in the classic branch of a switch and is unaffected by the flip. Its other branch sets `'webgpu'` (`:135`).
- **Pages that set `webGLRendererParameters`** lose those options silently after the flip (Phase 1 adds a warning): `animals-terrain-world-lab-page.component.ts:175`, `camera-floating-origin-page.component.ts:46` (antialias only), `cdlod-planet-lab-page.component.ts:61`, `river-lab-page.component.ts:65`, `scatter-lab-page.component.ts:327`, `scatter-physics-lab-page.component.ts:203`, `terrain-composer-lab-page.component.ts:70`, `terrain-lab-page.component.ts:208`.
- **Routes that depend on a WebGL-only module** (Plan 056 §Demo routes, 29 routes counted there): `/engine-demo`, the water routes, the scatter and flora routes, `/impostor-baker`, the cell-planet GLSL routes, `/illustrative-cell-planet` (WebGL extension probe), the legacy terrain and clipmap routes. The `takram-clouds-spike` route now loads a deprecated page (`app.routes.ts:67-70`); the other Takram routes were not checked. Route-level counts were taken from Plan 056 and not re-derived here.
- Pages that already support a WebGL2 switch by query (`?backend=webgl2`, `?forceWebGL`): `atmosphere-lab`, `atmosphere-planet`, `cell-planet-tsl`, `cloud-volumes-lab`, `planet-material-extensions`, `tsl-webgpu-spike`. Those are the pages where the fallback can be checked by hand.

**Not changed by a flip:** `impostor-baker` carries a `'scene.backend': 'webgl'` value (`impostor-baker-page.component.ts:871`). It appears to be a telemetry label and not a renderer option; it was not traced further.

### 4. Recommendation

**Keep it opt-in now. Do not flip.** Flip later, in this order:

1. **Close the engine gaps (B2, B3, B4, B5 fallback decision).** Add `provideEngineDefaults`, call `init()` on recreation and subscribe `resolution$` once, and hook WebGPU device loss to `error$` (per D6). Add the dev-mode `onBeforeCompile` scan. Each change needs a colocated spec, as in Plan 056 Phase 1.
2. **Get a measured baseline (B13, B16).** Add the classic WebGL GPU timer and the `renderer-comparison` suite, and record D7 and D8. Without it the Phase 6 gate cannot be run.
3. **Pin the WebGL-only demo pages (B15 and blast radius).** Set `preferredRenderer: 'webgl'` on the routes that depend on GLSL, labelled legacy, so the flip does not break the demo. Port the rest over Phases 3–4.
4. **Flip the default with a safe rollout.** Make `'webgpu'` the default with three safeguards: (a) an automatic one-time fallback to the WebGL2 backend, then to classic WebGL if `allowClassicWebGLFallback` is set (D2), with one warning naming the cause; (b) the explicit `preferredRenderer: 'webgl'` opt-out, both per page and app-wide via `provideEngineDefaults`; (c) a breaking CHANGELOG entry and a minor version bump. Run the Phase 6 gate before merging the flip.

Do not flip before steps 1–3 are done. Doing it earlier would make a consumer's first frame blank or silently wrong, and the opt-out would not exist yet to recover them.

### Decisions still needed from the owner

- **D2**: WebGL2 backend or classic WebGL as the fallback when WebGPU is missing (recommended: WebGL2, because TSL stays the only shading path).
- **D6**: recreate the WebGPU renderer on device loss, or require a reload (recommended: recreate, with a reload as the fallback).
- **D8**: the Phase 6 gate thresholds (the proposed values above).
- **D7**: comparison pages and the reference machine.
- **D3, D4, D5**: opt-out window length, legacy terrain and cloud retire-or-port, and where the TSL composer lives.

Plan 056's decisions table is not edited in this entry, and its scope is unchanged.

## 2026-10-31 — Explicit WebGPU selection and startup errors

An explicit `preferredRenderer: 'webgpu'` now constructs `WebGPURenderer` without the `navigator.gpu` shortcut to classic WebGL. Three's renderer chooses its own backend. An initialization rejection emits `error$` with phase `renderer-init` and does not start a blank loop. Focused headless startup specs passed (6 tests), and the package built. The default is still classic WebGL. A native WebGPU consumer ran on an NVIDIA adapter; the WebGL2 fallback, device loss, renderer recreation and full migration remain unverified.

## 2026-10-19 — Plan written (code reading only)

Nothing was built, run or measured. Line numbers are from the working tree on this date, with three.js 0.186.1.

### Owner's decisions

- `WebGPURenderer` becomes the engine default ([Plan 055](/docs/plans/055_planet_shape_system.md) D3). This plan is
  the "own plan" that D3 asked for.
- **Takram is removed**, not ported: the `triangular-engine/takram` entry and the `@takram/three-atmosphere`,
  `@takram/three-clouds` and `@takram/three-geospatial` peers. "We no longer want it." Plan 056 D9.
- Plan 055 D4: the planet shape system is WebGPU-only (compute, storage buffers, indirect draws), with no WebGL2
  fallback. The owner scoped this to the shape system. The engine-wide fallback stays open as Plan 056 D2.

### Findings: engine core (`engine.service.ts`)

- `initRenderer` (342): the default is `'webgl'`. `'webgpu'` is honoured only when `navigator.gpu` exists;
  otherwise it builds `WebGLRenderer`. three's `WebGPURenderer` constructor already installs a WebGL2 backend
  fallback (`WebGPURenderer.js:57-69`), which the engine never reaches. A TSL page on a browser without
  `navigator.gpu` gets a renderer that cannot draw TSL.
- `onComponentInit` (318-329): `init().catch(() => this.startLoop())`. three sets `_initialized` only on success
  (`Renderer.js:843`), and `render()` returns while `!initialized` (717). An init failure is therefore a blank
  canvas with no error. From source; not reproduced.
- `scene.component.ts:217-226` recreates the renderer when `logarithmicDepthBuffer` changes. `createWebGpuRenderer`
  does not call `init()`, so the same early return probably applies. Each `create*Renderer` call also subscribes to
  `resolution$` again. Unconfirmed.
- Context loss: only `webglcontextlost`/`webglcontextrestored` listeners (269-270). `WebGPURenderer.onDeviceLost`
  (`Renderer.js:595`) is not hooked.
- GPU timing (`gpuTiming`, 751-784): `resolveTimestampsAsync`. `WebGLBackend` supports it through
  `EXT_disjoint_timer_query_webgl2` (`WebGLBackend.js:272`). Classic `WebGLRenderer` has no GPU timer anywhere in
  the repo, so today there is no GPU-ms number for the current default.
- `engine.model.ts:17` imports `three/webgpu` as a value, and `engine.service.ts:32` imports `WebGPURenderer`. The
  WebGPU build is already in every consumer bundle.
- Telemetry already reads `info.render.drawCalls ?? info.render.calls` (`fps.controller.ts:234`), with specs for
  both.
- Options: `EngineService.provide()` → `provideEngineOptions` → `ENGINE_OPTIONS`, per page only. There is no
  app-wide default to opt out with.

### Findings: three.js 0.186.1 behaviour (source)

- `NodeLibrary.fromMaterial` maps only built-in material types (`StandardNodeLibrary.js:64-76`). A GLSL
  `ShaderMaterial` reaches `NodeBuilder`'s "Material ... is not compatible" error (`NodeBuilder.js:3162`) and draws
  as an empty node material. The WebGL2 fallback uses the same node path, so GLSL fails there too. Not run.
- `onBeforeCompile` is read only by `WebGLRenderer.js`. On `WebGPURenderer` the patched material is copied into its
  node twin and **the patch is silently lost**. This is the riskiest class: it produces no error.
- `PostProcessing` is deprecated since r183 in favour of `RenderPipeline` (`PostProcessing.js:5`). `BloomNode`,
  `FXAANode`, `SMAANode` (`examples/jsm/tsl/display/`) and `CSMShadowNode` (`examples/jsm/csm/`) exist in 0.186.1.

### Findings: inventory (survey by a Haiku subagent, spot-checked)

The full per-module table is in Plan 056 §Inventory. In summary:

- Hard WebGL-only (throws or `ShaderMaterial`): Takram (all), the pmndrs composer and its effects, the
  three/examples `<effect-composer>` and passes (no demo uses it), the water underwater effect, particles/VFX, the
  sky box, water surface and depth prepass, flow paths, impostor bake and material, clipmap, CDLOD (three copies),
  legacy `clouds/three`, `worldgen/render/planet-morph-material.ts` overlays, and the public
  `<shaderMaterial>`/`<rawShaderMaterial>`.
- Silently wrong (`onBeforeCompile`): CSM, scatter wind/billboard/dither, the trail ribbon, terrain macro
  variation and tiles, `cell-per-pixel-material.ts`, the planet morph and day/night patches.
- Already TSL: `planet-material`, `atmosphere`, `cloud-volumes`. `cloud-volume-screen-pass.ts:37` reads
  `backend.device.limits`, which is WebGPU-only. Its WebGL2 path is unchecked.
- Takram's `/webgpu` subpaths (three-atmosphere, three-geospatial) are installed but unused. They are moot after
  D9.
- Spot-checked by hand: the `NodeBuilder` incompatibility error, `scene.component.ts` recreation,
  `render-target.component.ts:102-105` throwing on classic WebGL, and the takram file list.

### Findings: demo app and tests

- 75 routes. 29 depend on a WebGL-only module, 4 of them Takram (Plan 056 §Demo routes). Five pages already opt into
  `'webgpu'`. `/tsl-webgpu-spike` sets both renderers explicitly.
- Six pages already switch backend by query (`?backend=webgl2`, `?forceWebGL`). `/cell-planet-tsl`'s
  `benchmark-suite.ts` already compares TSL webgpu, TSL webgl2 and GLSL. Plan 052 recorded first-frame medians of
  924 ms (TSL webgpu), 1338 ms (TSL webgl2) and 305 ms (GLSL) on one profile. That is a reason to report first-frame
  time in the comparison.
- Karma: `@angular/build:karma`, `ChromeHeadless`, with no WebGPU flag. WebGPU specs already use `forceWebGL`
  (`gpu-eval.testing.ts`, `gpu-renderer.testing.ts`) or fakes (`engine-webgpu-startup.spec.ts`). Real WebGPU runs
  only in the cloud-feasibility Playwright config.
- `toDataURL` callers that may go blank on WebGPU: `catalog-thumbnail.service.ts`, `scene-test-adapter.ts`,
  `scene-saver.component.ts`, `cloud-replay-probe.ts`, `tsl-webgpu-spike`.

### Decisions recorded

D1 and D9 decided (above). D2–D8 open; see Plan 056 §Decisions.

### Next

Owner review of D2 (WebGL2 fallback vs classic WebGL when WebGPU is missing), D4 (retire legacy terrain and
clouds), D7 (comparison pages) and D8 (gate thresholds). Then Phase 0 (baseline) and Phase 2 (Takram removal). They
are independent and can run in parallel.
