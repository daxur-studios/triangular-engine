---
type: Plan
title: WebGPURenderer as the Default Renderer
description: Switch triangular-engine's default renderer from WebGLRenderer to WebGPURenderer, remove the Takram integration, port or retire every WebGL-only module, keep a consumer opt-out, and prove the switch with tests and a GPU-time comparison on both renderers.
timestamp: 2026-10-19T00:00:00Z
tags: [renderer, webgpu, webgl, tsl, migration, postprocessing, takram, performance, testing, breaking-change]
runbook: /docs/runbook/056_webgpu_default_renderer.md
performance: []
---

# Plan 056: WebGPURenderer as the Default Renderer

Status: **draft, nothing built.** Written 2026-10-19 from code reading only. Nothing was run or measured.
Phase 0 is next.
Evidence: [Runbook 056](/docs/runbook/056_webgpu_default_renderer.md).
[Plan 065](/docs/plans/065_composite_cell_planet.md) proposes pulling six Phase 0–1 items forward so one consumer
game route can opt into `WebGPURenderer` before Phase 6.

**Goal:** a new `EngineService` renders with three.js `WebGPURenderer` unless the consumer opts out. TSL is the
one shading path for new engine code. Every module that only works on `WebGLRenderer` is either ported, retired,
or refuses to run with a clear message. Nothing goes black or blank without an error. The switch ships only after
a measured comparison on both renderers.

**Owner decisions behind this plan:**
- [Plan 055](/docs/plans/055_planet_shape_system.md) D3, 2026-10-19: `WebGPURenderer` becomes the engine default.
- 2026-10-19: **Takram is removed** (`triangular-engine/takram` and the `@takram/*` peers). We no longer want it.
  Its replacements are the TSL atmosphere ([Plan 049](/docs/plans/049_morphing_planet_atmosphere.md)) and
  cloud volumes ([Plan 051](/docs/plans/051_cloud_volumes.md)).
- Plan 055 D4, 2026-10-19: the planet shape system targets the WebGPU backend only, with no WebGL2 fallback.
  **This applies to the shape system only.** Whether the engine as a whole keeps a WebGL2 fallback is
  decision D2 below.

**Builds on:**
- [Plan 050](/docs/plans/050_tsl_planet_surface_material.md): `triangular-engine/planet-material`, the TSL
  cell-planet material that replaces `worldgen/render/planet-morph-material.ts`.
- [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) and [Plan 051](/docs/plans/051_cloud_volumes.md):
  TSL atmosphere and clouds, already on `WebGPURenderer` with `forceWebGL` runs.
- [Plan 052](/docs/plans/052_page_test_sessions_and_performance_comparison.md): the shared runner
  (`triangular-engine/testing`), suite entries per backend (`?backend=`), environment profiles, and
  "compare only within a recorded profile".

## Terms

| Term | Meaning |
|---|---|
| **WebGPU** | `WebGPURenderer` on its native WebGPU backend |
| **WebGL2 fallback** | `WebGPURenderer` on its WebGL2 backend (`forceWebGL: true`, or three's own fallback when no adapter is found). Runs TSL, not GLSL |
| **classic WebGL** | `WebGLRenderer`, today's default. Runs GLSL `ShaderMaterial` and `onBeforeCompile`, not TSL node materials |

## Current state (code reading, three.js 0.186.1)

`projects/triangular-engine/src/lib/engine/services/engine.service.ts`:

- `initRenderer` (line 342) reads `preferredRenderer ?? 'webgl'`. With `'webgpu'` it builds `WebGPURenderer`
  only if `navigator.gpu` exists. Otherwise it builds **classic WebGL**, not the WebGL2 fallback. A page that
  opted into TSL therefore falls back to a renderer that cannot draw TSL.
- three's own constructor already wires a WebGL2 fallback backend (`WebGPURenderer.js:57-69`, `getFallback`).
  The engine's `isWebGPUSupported()` check bypasses it.
- `onComponentInit` calls `renderer.init()` and, **on failure too**, `startLoop()`. `render()` returns early while
  `!renderer.initialized` (line 717), and three sets `_initialized` only on success (`Renderer.js:843`). An init
  failure is therefore a permanently blank canvas with no error. Not run; from source.
- `createWebGpuRenderer` can be called again at runtime (`scene.component.ts:217-226` does so when
  `logarithmicDepthBuffer` changes) but never calls `init()` on the new renderer. That is likely the same blank
  canvas. Both `create*Renderer` methods also add a new `resolution$` subscription on every call. Unconfirmed.
- Context loss is handled only through `webglcontextlost`/`webglcontextrestored`. Those events never fire for
  WebGPU. `WebGPURenderer.onDeviceLost` is not hooked.
- `gpuTiming` uses `resolveTimestampsAsync` and works on WebGPU, and on the WebGL2 fallback only when
  `EXT_disjoint_timer_query_webgl2` is exposed. **Classic WebGL has no GPU timing in the engine.**
- Options arrive through `EngineService.provide({...})` → `provideEngineOptions` → `ENGINE_OPTIONS`, per page.
  There is no app-wide default. `forceWebGL` rides inside `webGpuRendererParameters`.
- Telemetry already handles both renderers' `info.render` (`fps.controller.ts:234`). `three/webgpu` is already a
  value import of the engine root (`engine.model.ts:17`, `engine.service.ts:32`), so the WebGPU bundle is already
  paid for by every consumer.

## Inventory: what needs WebGL today

How three.js 0.186.1 behaves (source reading):
- GLSL `ShaderMaterial`/`RawShaderMaterial`: `NodeLibrary` has no mapping. `NodeBuilder` logs
  `Material "ShaderMaterial" is not compatible` and draws an empty `NodeMaterial`. This holds **on both
  WebGPURenderer backends**: the WebGL2 fallback also builds from node materials.
- `onBeforeCompile` is read only by `WebGLRenderer`. On `WebGPURenderer` a built-in material is converted to its
  node twin, and **the patch is silently dropped**: no error, wrong picture.
- `WebGPURenderer` has no `capabilities`, no sync `readRenderTargetPixels` (`readRenderTargetPixelsAsync` instead),
  and `getContext()` returns the backend's context, not a `WebGL2RenderingContext`.
- `WebGLRenderTarget` and `ShaderMaterial` still import from `three/webgpu`. The failure is at runtime, not at
  compile time.

Verdict key: **port** (write TSL), **replace** (use an existing TSL module), **retire** (deprecate, stays on
classic WebGL until removed), **remove** (deleted by this plan), **fix** (small engine change), **ok** (works).

| Module | WebGL-only part | WebGPU | WebGL2 fallback | Verdict |
|---|---|---|---|---|
| `triangular-engine/takram` (atmosphere, aerial perspective, sun/sky lights, clouds, cylinder shell) | pmndrs `postprocessing` effects, `PrecomputedTexturesGenerator(WebGLRenderer)`, GLSL string patches; throws unless `WebGLRenderer` + WebGL2 | no | no | **remove** (owner, 2026-10-19). Replaced by `atmosphere` (049) and `cloud-volumes` (051). Takram's own `/webgpu` subpaths are not adopted |
| `postprocessing/` `<postprocessing-composer>`, `toneMappingEffect`, `vignetteEffect` | pmndrs `EffectComposer`; throws unless `WebGLRenderer` + WebGL2 | no | no | **port** to a TSL `RenderPipeline` composer (Phase 3); old one **retire** |
| Engine `<effect-composer>` + passes (`effect-composer.component.ts`, `passes/*`: Glitch, Output, Shader, SMAA, UnrealBloom) | three/examples `EffectComposer`; returns silently on WebGPU | no | no | **retire** (no demo uses it; `docs/components.md:83` only). Bloom/SMAA/FXAA covered by the Phase 3 composer |
| `water/postprocessing/water-underwater-effect.component.ts` | pmndrs `Effect` with GLSL | no | no | **port** (Phase 3) |
| Engine core `engine.service.ts` | fallback, init failure, recreate, context loss, no classic GPU timer | partial | partial | **fix** (Phases 0–1) |
| `scene.component.ts` `logarithmicDepthBuffer` renderer recreation | recreation without `init()` | likely blank | likely blank | **fix** (Phase 1) |
| `render-target.component.ts` | throws on classic WebGL (comment says both) | ok | ok | **ok**; fix the comment |
| `multi-viewport.service.ts` | assumes a bottom-left viewport origin (comment, line 96) | unconfirmed | unconfirmed | **verify** with a pixel spec (Phase 1) |
| `components/light/csm/engine-csm.ts` (cascaded shadows) | `onBeforeCompile` chain on `MeshStandardMaterial` | silently no CSM | silently no CSM | **replace** with three's `CSMShadowNode` (Phase 4) |
| `<shaderMaterial>`, `<rawShaderMaterial>` (`material.component.ts:239-262`), public | GLSL by definition | no | no | **retire**: dev-mode error on `WebGPURenderer`; document TSL `NodeMaterial` instead |
| Particles / VFX (`particle-shader.ts`, `vfx.service.ts`) | `ShaderMaterial` | no | no | **port** (Phase 4) |
| Sky box (`sky-box-material.component.ts`, `SkyBoxShader.ts`) | `ShaderMaterial` | no | no | **port** (Phase 4); sky part could use `atmosphere-backdrop`, stars need TSL |
| `trail/core/trail-ribbon-material.ts` | `onBeforeCompile` | silently wrong | silently wrong | **port** (Phase 4) |
| `scatter/three/` wind, billboard, dither materials | `onBeforeCompile` | silently wrong | silently wrong | **port** (Phase 4) |
| `impostor/` atlas bake + `octahedral-impostor-material.ts` | `WebGLRenderTarget`, sync `readRenderTargetPixels`, `ShaderMaterial`, `onBeforeCompile` | no | no | **port** (Phase 4); readback becomes async (API change) |
| `water/` surface renderer, depth prepass, `water/core/*-glsl.ts` | `ShaderMaterial`, `captureDepth(WebGLRenderer)` | no | no | **port** (Phase 4). `planet-material/planet-ocean-material.ts` covers cell planets only |
| `worldgen/render/flow-path.ts` (rivers, lava) | `ShaderMaterial` | no | no | **port** (Phase 4) |
| `worldgen/render/planet-morph-material.ts` (morph, lighting, day/night, overlays) | `onBeforeCompile` + `ShaderMaterial` | no | no | **replace** with `planet-material` (050); GLSL file **retire** |
| `worldgen/render/cell-per-pixel-material.ts` | `onBeforeCompile` | silently wrong | silently wrong | **replace** with `planet-material/cell-lookup-layer.ts` |
| `terrain/materials/terrain-macro-variation-material.ts`, `terrain/materials/tiles/*` | `onBeforeCompile` | silently wrong | silently wrong | **replace** with `planet-material` macro/streamed layers where used by cell planets; otherwise **retire** with the legacy terrain |
| `terrain/clipmap/*` (material, `clipmap-probe.ts` readback) | `ShaderMaterial`, `WebGLRenderTarget`, sync readback | no | no | **retire**: superseded by Plan 055 |
| `terrain/cdlod/*`, `terrain/cdlod/v3/*`, `celestial/surfaces/cdlod/*` (terrain + ocean) | `ShaderMaterial` | no | no | **retire**: superseded by Plan 055 |
| `clouds/three/*` (puff, layered, cirrus, contour, atmosphere layer) | `ShaderMaterial` | no | no | **retire**: superseded by Plan 051 |
| `planet-material/`, `atmosphere/`, `cloud-volumes/` | none (TSL) | ok | ok (`cloud-volume-screen-pass.ts:37` reads `backend.device.limits`, WebGPU-only; check its WebGL2 path) | **ok** |
| `CSS2DRenderer`, `CSS3DRenderer`, telemetry `info.render`, shadows (`PCFShadowMap`) | none / both handled | ok (shadows unconfirmed) | ok (shadows unconfirmed) | **ok**; shadow parity checked in Phase 1 |

**Consumer-visible facts that change:** `engine.renderer` becomes a `WebGPURenderer` by default. Code that casts it
to `WebGLRenderer`, calls `getContext()`, `capabilities` or sync `readRenderTargetPixels`, or uses
`ShaderMaterial`/`onBeforeCompile`, breaks or draws wrong. The first frame waits for an async `init()`.
`canvas.toDataURL` can return a blank image on WebGPU (noted in Plan 052), which affects screenshots and thumbnails.

## Demo routes affected

From `projects/demo-app/src/app/app.routes.ts` (75 routes). With the default flipped and no other change:

| Route(s) | Breaks because | Plan |
|---|---|---|
| `/takram-clouds`, `/takram-mini-planet`, `/takram-cylinder-clouds`, `/takram-clouds-spike` | Takram | **deleted** in Phase 2, with `shared/takram-cloud-controls/` and the demo-index cards |
| `/engine-demo` | GLSL sky box; pmndrs composer with vignette | Phases 3–4 |
| `/water`, `/river-lab`, `/water-material-poc`, `/water-lod-poc`, `/water-surface-spike`, `/water-sphere-poc`, `/water-cylinder-poc` | GLSL water; pmndrs composer on `/water`; `instanceof WebGLRenderer` guards | Phases 3–4 |
| `/scatter-lab`, `/flora-lab`, `/flora-scatter-lab`, `/flora-affordance-lab`, `/meadow-lab`, `/photo-mode-lab` | scatter `onBeforeCompile` (silently wrong, not an error); impostor atlas on `/scatter-lab` | Phase 4 |
| `/impostor-baker` | impostor bake, `instanceof WebGLRenderer` | Phase 4 |
| `/cell-planet-morph-spike`, `/cell-planet-morph-streaming`, `/cell-planet-globe`, `/planet-terrain-sphere-lab` | GLSL morph material, page-level `onBeforeCompile` | Phase 5: move to `planet-material`, or pin to classic WebGL |
| `/illustrative-cell-planet` | `renderer.getContext()` WebGL extension probe in `environment()` (test adapter depends on it) | Phase 5: read adapter info per backend |
| `/cdlod-planet-lab`, `/terrain-lab`, `/terrain-composer-lab`, `/animals-terrain-world-lab`, `/clipmap-far-coverage-spike` | legacy terrain GLSL | Phase 5: pin to `preferredRenderer: 'webgl'`, labelled legacy |
| `/tsl-webgpu-spike` | already sets both renderers explicitly | none |
| `/atmosphere-lab`, `/atmosphere-planet`, `/cell-planet-tsl`, `/planet-material-extensions`, `/cloud-volumes-lab` | already `'webgpu'` | none |

Pages that set `webGLRendererParameters` (`/water`, `/scatter-lab`, `/cdlod-planet-lab`, `/river-lab`,
`/animals-terrain-world-lab`) lose those parameters silently after the flip. Phase 1 adds a dev-mode warning.

## Design

### Renderer selection (after Phase 6)

```ts
preferredRenderer?: 'webgpu' | 'webgl';   // default becomes 'webgpu'
```

- `'webgpu'` (default): always `WebGPURenderer`. If no WebGPU adapter is available, three's own fallback runs it on
  the WebGL2 backend (D2). `forceWebGL` in `webGpuRendererParameters` still forces the WebGL2 backend.
- `'webgl'`: classic `WebGLRenderer`. This is **the consumer opt-out**, kept for a deprecation window (D3).
- Init failure on WebGPU falls back once, to the WebGL2 backend, then to classic WebGL if
  `allowClassicWebGLFallback` is set (D2). Every fallback logs one warning naming the cause. If nothing
  initializes, `error$` emits `{ phase: 'rendererInit' }` and the canvas shows nothing, but it is no longer silent.

**App-wide opt-out.** Today options are per page. Add `provideEngineDefaults(options)`, an app-level
`ENGINE_DEFAULT_OPTIONS` token merged under each page's `EngineService.provide(...)`. A consumer stays on classic
WebGL with one line in `app.config.ts`:

```ts
provideEngineDefaults({ preferredRenderer: 'webgl' })
```

**What is running.** `EngineService.rendererBackend` (signal): `'webgpu' | 'webgl2-fallback' | 'webgl' | 'pending'`.
Set after `init()`. Read by telemetry ("Copy for Agent"), test adapters' `environment()`, and the dev errors below.

**Fail loudly, not silently.** Each WebGL-only component (`<postprocessing-composer>`, `<effect-composer>`,
`<shaderMaterial>`, `<rawShaderMaterial>`, retired terrain and cloud components, CSM until ported) checks
`rendererBackend` and, on `WebGPURenderer`, emits a dev-mode error that names the component and the opt-out.
The `onBeforeCompile` users are the dangerous ones, because three gives no error. Phase 1 adds a dev-mode scan that
warns once per material when a material with `onBeforeCompile` set is drawn by `WebGPURenderer`.

### Post-processing (Phase 3)

A TSL composer on three's `RenderPipeline` (`three/webgpu`; `PostProcessing` is its deprecated alias since r183).
It registers through the existing `engine.registerRenderPipeline`. Rename the engine's `EngineRenderPipeline`
interface, or document the name clash. First effects: tone mapping (output node), vignette, bloom
(`three/addons/tsl/display/BloomNode`), FXAA/SMAA nodes, the water underwater effect. Where it lives is D5.

### GPU timing on classic WebGL (Phase 0)

Without it the comparison has no GPU column for the current default. Add an
`EXT_disjoint_timer_query_webgl2` timer around `renderer.render` on classic WebGL behind the existing `gpuTiming`
option. Use the same one-in-flight readback, reject disjoint results, and report `n/a` when the extension is
missing. Native WebGPU timestamps are quantized to 100 µs unless Chrome's WebGPU Developer Features flag is on
(Runbook 055); the profile records which one applied.

## Phases

Every phase lists its headless spec(s) (`npm test`, `ChromeHeadless`, `--watch=false`) and its shared-runner suite.
Headless Karma has no WebGPU adapter (no flag in `angular.json`), so **specs cover the WebGL2 fallback** through
`forceWebGL` (the existing `gpu-eval.testing.ts` / `gpu-renderer.testing.ts` pattern). Native WebGPU is covered by
the runner suites in a real browser and by the cloud-feasibility Playwright config, which already asserts a
`webgpu` backend. Software rendering (SwiftShader) is smoke evidence only, never performance (Plan 052).

### Phase 0. Baseline and measurement switches (no behaviour change)

- `rendererBackend` signal; the classic WebGL GPU timer; telemetry prints the backend.
- A `?renderer=webgl|webgpu|webgl2` query helper for demo pages (the `?backend=` pattern from `/cell-planet-tsl`,
  generalized), only on the comparison pages.
- Suite `renderer-comparison` v1 on the shared runner (D7 picks the pages): for each page and each of the three
  renderers, a suite entry (a page load, since the renderer cannot switch live), static and moving scenarios.
  Metrics: GPU ms/frame (median, p95), CPU frame ms, render submit ms, draw calls, triangles, first-frame ms,
  backend actually used, adapter. Classic WebGL is the baseline. Pages that cannot yet run on `WebGPURenderer`
  record `blocked-<reason>`, not a number.
- **Tests:** `engine-renderer-selection.spec.ts`, a table of `preferredRenderer` × `navigator.gpu` present/absent ×
  `forceWebGL` → expected renderer class and backend (fakes, like `engine-webgpu-startup.spec.ts`). A
  `fps.controller` spec that prints the backend. A classic WebGL timer spec: extension missing → `n/a`, disjoint
  sample dropped.
- **Done when:** the comparison suite runs on its pages for classic WebGL, and wherever possible for both
  `WebGPURenderer` backends, with a result recorded in the runbook and in `performance:`.

### Phase 1. Engine core readiness (default unchanged)

- `initRenderer`: `'webgpu'` always constructs `WebGPURenderer` and lets three's fallback pick the backend. The
  `navigator.gpu` shortcut to classic WebGL is gone. Init failure is handled per §Renderer selection.
- Renderer recreation (`logarithmicDepthBuffer`) awaits `init()` before rendering. The `resolution$` subscription
  is made once.
- `onDeviceLost` → `isContextLost` + `stopLoop` + `error$`. A device cannot be restored in place: document a
  reload, or recreate the renderer (D6).
- `provideEngineDefaults` / `ENGINE_DEFAULT_OPTIONS`.
- Dev-mode errors from WebGL-only components, the `onBeforeCompile` scan, and the
  `webGLRendererParameters`-ignored warning.
- Fix the `render-target.component.ts` comment. Verify `multi-viewport.service.ts` and shadow parity.
- **Tests:** an init-failure spec (`init()` rejects → `error$` emits, the fallback is attempted once, no silent
  blank). A recreation spec (render resumes after recreate). An options-merge spec (defaults < page options). A
  dev-error spec for `<postprocessing-composer>` on a faked `WebGPURenderer`. A multi-viewport pixel spec on
  `forceWebGL` (quadrant colours land in the right corners). A shadow spec: shadowed vs lit pixel on `forceWebGL`.
- **Runner:** `renderer-comparison` v1 again, to confirm no regression on classic WebGL.

### Phase 2. Remove Takram (owner decision, 2026-10-19)

- Delete `projects/triangular-engine/takram/` (entry point, `takram.module.ts`, README), `src/takram-adapter.spec.ts`,
  the `triangular-engine/takram` path in `tsconfig.json`, the `@takram/three-clouds` asset glob in `angular.json`,
  and the `@takram/*` peer and dev dependencies (root and library `package.json`, `peerDependenciesMeta`).
- Delete demo routes `/takram-clouds`, `/takram-mini-planet`, `/takram-cylinder-clouds`, `/takram-clouds-spike`,
  their page folders, `shared/takram-cloud-controls/`, the demo-index entries, and their mentions in the demo
  `AGENTS.md` and `pages/README.md`.
- Docs: the Takram sections of the package `README.md` (entry-point tables, "Takram cloud textures",
  "Takram atmosphere lights"), `docs/entry-points.md`, the engine skill. Old runbooks stay as history.
- CHANGELOG: **breaking**. `triangular-engine/takram` is removed. Point users to `triangular-engine/atmosphere` and
  `triangular-engine/cloud-volumes`, and say plainly that they are not drop-in replacements.
- Search for Takram-only option fields outside `takram/` (Plan 049 lists `ICelestialBody.atmosphere.visual`; a
  2026-10-19 grep of `celestial/` found no Takram reference) and remove or deprecate any found.
- **Tests:** `npm test` and the library build pass; `rg -i takram projects/ --glob '!*.md'` finds nothing; the packed
  package has no `takram` directory and no `@takram` peer; `npx ng build demo-app` passes.
- Independent of Phases 0–1. Can run in parallel with them.

### Phase 3. TSL post-processing

- The TSL composer (§Post-processing), the tone-mapping, vignette, bloom and AA effects, and the underwater effect
  port. The pmndrs `<postprocessing-composer>` and the engine `<effect-composer>` are deprecated and stay
  classic-WebGL-only.
- Move `/engine-demo` and `/water` to the new composer.
- **Tests:** a spec per effect on `forceWebGL` (a known input texture through the pipeline, sampled output
  pixels within tolerance; vignette darkens corners; tone mapping matches `ACESFilmic`/`AgX` reference values). A
  registration spec (single owner, resize forwarded).
- **Runner:** `renderer-comparison` adds `/engine-demo` and `/water` on both `WebGPURenderer` backends.

### Phase 4. Port the shared WebGL-only modules

Order by consumer reach and size: particles/VFX → sky box → trail ribbon → scatter (wind, billboard, dither) →
CSM (`CSMShadowNode`) → flow path → water surface and depth prepass → impostor material and bake (async readback;
the bake API becomes `Promise`-returning, a CHANGELOG entry).

- Each port keeps the GLSL version reachable on classic WebGL until Phase 7, selected by `rendererBackend`. It
  ships as one change, with docs and CHANGELOG.
- **Tests:** per module, a `forceWebGL` spec comparing the TSL output with known values: sampled pixels or the
  `gpu-eval` pattern for vertex maths. Wind displacement at fixed time and seed, billboard facing, dither
  threshold, flow UV scroll, water depth fade, impostor octahedral mapping round trip. Where the GLSL version is a
  reference, the spec renders both and compares within tolerance.
- **Runner:** add the ported pages' suites. Scatter and meadow pages are the draw-call-heavy cases, where
  `WebGPURenderer`'s CPU submit cost is the open risk (§Performance comparison).

### Phase 5. Demo migration

- Cell-planet GLSL pages (`/cell-planet-morph-spike`, `/cell-planet-morph-streaming`, `/cell-planet-globe`,
  `/planet-terrain-sphere-lab`) move to `planet-material` where Plan 050 already covers them. Otherwise they are
  pinned with `preferredRenderer: 'webgl'`.
- Legacy terrain and legacy cloud pages are pinned to `'webgl'` and labelled legacy in the demo index (D4).
- `/illustrative-cell-planet` `environment()` reads adapter info per backend (WebGPU adapter info, or
  `WEBGL_debug_renderer_info` only on classic WebGL).
- Screenshot and thumbnail paths (`catalog-thumbnail.service.ts`, `scene-test-adapter.ts`,
  `scene-saver.component.ts`) use an async readback on `WebGPURenderer` instead of `toDataURL`.
- **Tests:** a demo-app spec that every route either declares `preferredRenderer` or is on the
  `WebGPURenderer`-clean list (a static table that fails when a new WebGL-only page omits the opt-out). A smoke run
  of the scene walkthrough Playwright spec.

### Phase 6. Flip the default

- `preferredRenderer` default `'webgpu'`. Update `engine.model.ts` doc comments, the package `README.md` (a
  "Renderer" section with the opt-out), `docs/components.md`, `docs/entry-points.md`, `postprocessing/README.md`,
  the engine skill (`.agents/skills/triangular-engine/SKILL.md`: the options default, "post-processing requires
  `'webgl'`"), and the `ng add` / `scene-page` schematic output if it sets renderer options.
- CHANGELOG: **breaking**. It states the new default, the opt-out
  (`provideEngineDefaults({ preferredRenderer: 'webgl' })` or per page), what stops working on `WebGPURenderer`
  (GLSL materials, `onBeforeCompile`, sync readback, `getContext()`, the pmndrs composer), and the async first
  frame. Bump the minor version (pre-1.0).
- **Gate (go/no-go):** `renderer-comparison` final run on the reference machine. Thresholds are set by the owner
  before the run (D8). Proposed: on every comparison page, WebGPU GPU ms p50 ≤ classic WebGL × 1.10 and CPU frame ms
  p50 ≤ classic WebGL × 1.15. No page blank or missing features under visual review. First-frame time is reported,
  not gated.
- **Tests:** `engine-renderer-selection.spec.ts` updated for the new default; the full `npm test`; library build;
  the cloud-feasibility WebGPU suite.

### Phase 7. Remove classic WebGL (later; owner decision D3)

Removes `'webgl'`, the pmndrs `postprocessing` peer, the engine `<effect-composer>`, the retired GLSL modules and
the GLSL twins kept by Phase 4. Not scheduled. It needs its own go/no-go after the deprecation window.

## Performance comparison

- **Renderers:** classic WebGL (baseline), WebGPU, WebGL2 fallback. Same page, same scenario, same profile.
- **Pages (proposed, D7):** `/engine-demo` (light scene; fixed overhead), `/meadow-lab` (many instanced draws;
  CPU submit), `/cell-planet-tsl` (already runs TSL on both backends and GLSL; heavy fragment), `/water`
  (post-processing + depth prepass). Each page enters the suite only once it runs on all three renderers. Until
  then its entry is recorded as blocked.
- **Metrics:** GPU ms/frame p50/p95 (timestamp source recorded: WebGPU timestamp, quantized or not;
  `EXT_disjoint_timer_query_webgl2`; or `n/a`), CPU frame ms, render submit ms (`performance.now()` around
  `renderer.render`), draw calls, triangles, first-frame ms, shader/pipeline compile hitches over the first 300
  frames.
- **Rules (Plan 052):** a reference machine and environment profile; three rounds, interleaved; spread shown; no
  pass/fail on absolute fps; software rendering never counts.
- Results go into Runbook 056 and this plan's `performance:` array once a scenario and launch link exist.

## Tests summary

| Phase | Headless specs (`npm test`) | Runner / browser |
|---|---|---|
| 0 | renderer selection table, backend telemetry, classic GPU timer | `renderer-comparison` v1 baseline |
| 1 | init failure, recreation, options merge, dev errors, multi-viewport pixels, shadows | `renderer-comparison` regression |
| 2 | build + test pass, no Takram left in sources or package | demo build |
| 3 | per-effect pixel specs, pipeline registration | `/engine-demo`, `/water` entries |
| 4 | per-module TSL vs reference specs | ported pages' suites |
| 5 | route renderer-declaration table | scene walkthrough smoke |
| 6 | selection spec on the new default, full suite | final comparison (gate), cloud WebGPU suite |

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | `WebGPURenderer` becomes the engine default | **Decided** 2026-10-19 (owner; Plan 055 D3) |
| D2 | When native WebGPU is unavailable, use the WebGL2 fallback (recommended: TSL stays the only shading path) or classic WebGL. The shape system is WebGPU-only either way (Plan 055 D4) | Open |
| D3 | How long classic WebGL stays as the opt-out before Phase 7 (proposed: one minor release after Phase 6, then reviewed) | Open |
| D4 | Legacy terrain (`clipmap`, `cdlod`, `celestial` CDLOD) and legacy `clouds/three`: retire on classic WebGL (proposed) or port | Open |
| D5 | The TSL composer goes into the existing `triangular-engine/postprocessing` entry beside the deprecated pmndrs components (proposed), or into a new entry | Open |
| D6 | On WebGPU device loss: recreate the renderer automatically or require a page reload | Open |
| D7 | Comparison pages and the reference machine (reuse Plan 055 D1 if decided) | Open |
| D8 | Phase 6 go/no-go thresholds | Open |
| D9 | Takram removed, not ported | **Decided** 2026-10-19 (owner) |

## Out of scope

- New features in the TSL post-processing beyond parity with today's effects.
- Porting the legacy terrain and cloud modules (unless D4 says otherwise).
- The planet shape system itself (Plan 055).
- Raising the three.js version (pinned 0.186.1).

## Open questions

- Does `navigator.gpu` exist in the Karma ChromeHeadless used by `npm test`? If it does, an adapter request may
  still fail. Specs keep `forceWebGL` either way.
- Is `EXT_disjoint_timer_query_webgl2` exposed by default in Chrome on the reference machine? If not, the classic
  WebGL GPU column needs a flag recorded in the profile.
- `cloud-volume-screen-pass.ts:37` reads `backend.device.limits`. What does it do on the WebGL2 fallback?
