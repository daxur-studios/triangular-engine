---
type: Runbook
title: WebGPURenderer as the Default Renderer
description: Findings, decisions, test results and renderer comparisons for switching triangular-engine's default renderer to WebGPURenderer and removing Takram.
timestamp: 2026-10-19T00:00:00Z
tags: [renderer, webgpu, webgl, tsl, migration, postprocessing, takram, performance, testing, breaking-change]
plans: [/docs/plans/056_webgpu_default_renderer.md]
performance: []
---

# Runbook 056: WebGPURenderer as the Default Renderer

Plan: [Plan 056](/docs/plans/056_webgpu_default_renderer.md).

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
