---
type: Runbook
title: TSL Planet Surface Material
description: Findings and decisions for porting the cell-planet surface to an extensible TSL material.
timestamp: 2026-10-16T00:00:00Z
tags: [tsl, webgpu, node-material, cell-planet, morph, terrain, materials, extensibility]
plans: [/docs/plans/050_tsl_planet_surface_material.md]
---

# Runbook 050: TSL Planet Surface Material

Plan: [Plan 050](/docs/plans/050_tsl_planet_surface_material.md). Split out of
[Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) so it can be picked up first.

## 2026-10-16 — Split from Plan 049, inventory (cloud session, code reading only)

Nothing was built, run or measured. `node_modules` was not installed, so three's TSL API was not
checked against the pinned version (`three` 0.183.2).

- **Owner decision:** do the port as its own plan, first. The material design (stages, slots,
  building blocks) moved here from Plan 049 so it lives in one place. 049 keeps only what goes into
  the lighting and atmosphere stages.
- **Patch count corrected.** The cell-planet path is 7 `onBeforeCompile` patches and 3 hand-written
  `ShaderMaterial`s, not "about 20".
  - Repo-wide there are 15 `onBeforeCompile` assignments. The other 8 are scatter, impostors, trail
    and CSM, which are not on the cell-planet path.
- **The streaming demo uses:**
  - terrain: `enableTerrainMacroVariation` (`positionSpace: 'viewM'`), `enablePlanetMorphProjection`,
    `enableCellPerPixelLookup` and `enableStreamedTerrainMaterial`, on a `MeshStandardMaterial`
    with `vertexColors`;
  - ocean: `enablePlanetMorphProjection` only;
  - plus `createPlanetBorderMorphMaterial` (cell grid) and `createPlanetMapBorderMaterial` (map frame).
- **Drop-in point exists.** `TerrainSurfaceComponent.createMaterial` and
  `CellPlanetMorphStreamingView.createMaterial` are factory inputs, so the TSL material plugs in
  without editing them. The terrain draws through one shared `BatchedMesh` material.
- **`EngineService`** already supports `preferredRenderer: 'webgpu'`. It creates a `WebGPURenderer`
  and awaits `init()` before the loop starts. Shadows are enabled there too.
- **Traps found while reading:**
  - WGSL derivative uniformity: the seam discard uses `fwidth`.
  - The macro layer's `'viewM'` mode actually samples the morphed local position.
  - Float textures need nearest filtering on WebGPU.
  - The three `ShaderMaterial`s include log-depth chunks by hand.
  - Details in the plan's §Port notes.
- **Model choice for the implementer** (owner asked): Sonnet 5.5 is recommended. Haiku 5.5 is fine
  for well-specified sub-tasks under review (a single layer port with its spec, demo boilerplate)
  but not for the slot API or the parity debugging.

## 2026-10-16 — Claimed by a local Sonnet 5.5 session

Scope for this session: Phase 0 (WebGPU spike, go/no-go), then Phase 1 only on a clear go.
`node_modules` is installed (`three` 0.183.2), so the plan's TSL API names are being checked against
the installed code. Corrections are listed below as they are found.

## 2026-10-16 — Phase 0 spike: `WebGPURenderer` draws the scene (verdict: conditional go, owner to confirm)

Spike page: `projects/demo-app/src/app/pages/tsl-webgpu-spike/` at `/tsl-webgpu-spike?backend=classic|classic-nodeuniform|webgpu|webgl2`
(`&aa=0`, `&log=0`, `&alt=<m>&back=<m>`, `&shadows=1`). Throwaway: delete when `cell-planet-tsl` lands.
It reuses `CellPlanetMorphStreamingViewComponent` + the streaming demo's worker through `createMaterial`.
Material on the WebGPU backends: `MeshStandardNodeMaterial` + `vertexColors` + TSL `positionNode`/`normalNode`.
Machine: AMD GPU, Chrome in the Claude browser pane, WebGPU with `timestamp-query` and `float32-filterable`.

**Caveat on every number:** the user was playing League of Legends on the same GPU, and the browser pane was
hidden for much of the run (rAF stops, canvas stays 1x1). The bench therefore ticks the engine by hand and
renders N frames back to back, then waits for the GPU (`onSubmittedWorkDone` / `readPixels`). Numbers are
indicative. **Re-run on an idle GPU before relying on them.**

### Results

| Check | Result |
|---|---|
| Terrain `BatchedMesh` renders on WebGPU and on `forceWebGL` | Yes. Same picture, 32 patches (orbit) / 80 (near) / 122 (high altitude) |
| Per-instance visibility | Works on WebGPU: hiding every other instance went 33 → 17 draws and 90 489 → 49 239 triangles, restored on unhide |
| Draw count | classic WebGL: 1 (multi-draw). WebGPU: 1 per visible instance (33 / 81 / 75). WebGPURenderer on `forceWebGL`: 2 (multi-draw works) |
| Log depth | `WebGPURenderer({ logarithmicDepthBuffer: true })` honoured; clean at near 0.5 m / far 1e7 m, from 1.56e6 m orbit to 60 km altitude. With `log=0` the near view breaks (only 6 patches resident, smeared depth) |
| Shadows with custom `positionNode` | Works on WebGPU: shadows on vs off changed 35 168 of 518 400 pixels (6.8%), mean luminance −2.6 with shadows on. Three's shadow pass uses `material.castShadowPositionNode ?? positionNode` (`Renderer.js` ~3200) |
| `UniformNode` as `IUniform<T>` | Compile time: assigning `uniform(0)`, `uniform(new Vector3())` to `IDynamicProjectionUniforms` type-checks. Runtime: the GLSL `enablePlanetMorphProjection` driven by `UniformNode`s morphs correctly (`classic-nodeuniform`, morph 0.6). One set of objects can drive both materials |
| Flat map (morph 1) on WebGPU | Renders correctly with the delta `positionNode` below |

Frame cost, ms per frame, 1280x720 at pixel ratio 1, median of 5 x 150 frames, GPU-synced:

| Backend | orbit | surface | flat | draws |
|---|---|---|---|---|
| classic `WebGLRenderer` (GLSL, MSAA on) | 0.63 | 1.78 | 1.40 | 1 |
| `WebGPURenderer` WebGPU (MSAA on) | 1.78 | 2.96 | 2.86 | 33 / 81 / 75 |
| `WebGPURenderer` `forceWebGL` (MSAA on) | 2.13 | 3.77 | 3.19 | 2 |
| classic, `aa=0` | 0.455 | | | 1 |
| `WebGPURenderer` WebGPU, `aa=0` | 0.69 | 0.83 | | |

CPU submit time on WebGPU is 0.2 ms for 33–81 draws, so draw count is not the bottleneck. The forceWebGL path has
2 draws and is as slow, so the gap is not `BatchedMesh` emulation. With MSAA off the WebGPU orbit view is
0.69 vs 0.455 ms (1.5x, sub-millisecond). With MSAA on it is 2.8x. Most of the gap looks like MSAA
resolve/shading cost in `WebGPURenderer`, not the batch. Not yet isolated further (no `MeshBasicNodeMaterial`
control, no idle GPU).

### Corrections to Plan 050 (installed three 0.183.2 wins)

1. **Batching vs `positionNode`.** `NodeMaterial.setupPosition` runs `batch(object)` first, which writes
   `batchingMatrix * positionLocal` into `positionLocal`; `positionNode` then **replaces** `positionLocal`.
   The batching matrix is a local inside `BatchNode.setup`, so it cannot be read. The terrain's batch matrices are
   translation-only (`setBatchInstanceMatrix` uses `makeTranslation`), so the spike uses
   `mix(aSpherePos, aFlatPos, morph) + (positionLocal - positionGeometry)`. That is exact only for translation-only matrices.
   For general matrices Phase 1 must re-implement the matrix fetch from `batchMesh._matricesTexture` / `_indirectTexture`.
   The plan's "build the position from `positionGeometry` with the batching transform explicitly" stays right, but
   the transform has to be re-fetched, not reused.
2. **Normals.** `normalNode` takes a view-space normal: wrap with `transformNormalToView(...)`.
   `BatchNode` also rewrites `normalLocal`, which `normalNode` bypasses; fine for translation-only batches.
3. **Shadow pass** needs no extra work for the position: it reuses `positionNode`. Use `castShadowPositionNode` only if shadows should differ.
4. **Typing:** `attribute('aSpherePos', 'vec3')` is typed `AttributeNode<string>` and does not satisfy `mix`; write `'vec3' as const`.
5. **`EngineService` renderer selection:** `forceWebGL` is not an engine option. It passes through
   `webGpuRendererParameters`, but only when `navigator.gpu` exists. Without it the engine falls back to the
   classic `WebGLRenderer`, which cannot run a node material. A TSL page needs `WebGPURenderer` with `forceWebGL` in that case: a small `EngineService` change (not made).
6. **`<scene [logarithmicDepthBuffer]>`** re-creates the renderer via `createWebGpuRenderer` without calling
   `init()` (code reading, not run). Pass `logarithmicDepthBuffer` through `webGpuRendererParameters` instead, as the spike does.
7. **Antialiasing** is a first-order perf knob on `WebGPURenderer` (see above). Decide it before comparing frame times.

### Verdict and stop

Everything the plan listed works: batch, visibility, log depth, shadows, flat map, `UniformNode`/`IUniform`.
The frame-cost gap is ambiguous (1.5x–2.8x on a bare material, small absolute numbers, noisy machine), so per the
session brief **Phase 1 was not started**. Options are in the session report.

## 2026-10-16 — Phase 0 re-run on an idle GPU: **GO**

Ran the spike's "run all benchmarks" button (8 page loads) in a visible Chrome window, GPU otherwise idle (AMD).
1280x720 at pixel ratio 1, ms per frame `[orbit, surface, flat]`, GPU-synced median of 5 x 150 frames.
Run-to-run noise is about +-0.2 ms (classic MSAA-on orbit read 0.63 earlier, 0.84 here).

| Backend / material | MSAA | orbit | surface | flat | draws |
|---|---|---|---|---|---|
| classic WebGL, GLSL | on | 0.84 | 1.76 | 1.48 | 1 |
| classic WebGL, GLSL | off | 0.45 | 1.03 | 0.72 | 1 |
| WebGPU, `MeshStandardNodeMaterial` | on | 1.84 | 2.71 | 2.32 | 33/81/69 |
| WebGPU, `MeshStandardNodeMaterial` | off | 0.88 | 1.39 | 1.14 | 33/81/69 |
| WebGPURenderer `forceWebGL`, standard | on | 2.82 | 4.10 | 3.81 | 2 |
| WebGPURenderer `forceWebGL`, standard | off | 0.62 | 1.09 | 0.89 | 2 |
| WebGPU, `MeshBasicNodeMaterial` (control, unlit) | off | 0.51 | 0.70 | 0.64 | 33/81/69 |
| WebGPU, `MeshBasicNodeMaterial` (control, unlit) | on | 1.61 | 2.15 | 1.90 | 33/81/69 |

What the gap is made of:
- **Not the batch.** The unlit WebGPU material with 33-81 draws and the custom `positionNode` costs 0.51/0.70/0.64 ms,
  the same as classic GLSL with MSAA off (0.45/1.03/0.72). Position + batching + per-instance draws are free at this scale.
- **MSAA.** Going MSAA on costs WebGPU +0.96/+1.32/+1.18 ms (standard) versus +0.39/+0.73/+0.76 ms on classic. On the
  `forceWebGL` backend it is the worst (+2.2/+3.0/+2.9 ms). With MSAA off, `forceWebGL` is within 1.05-1.4x of classic.
- **Node PBR shading.** Standard vs unlit, MSAA off: +0.37/+0.69/+0.50 ms.

Verdict: **go.** Worst realistic case is 2.7 ms at 720p with MSAA on (4.1 ms on the WebGL2 fallback), and the
overhead is MSAA plus the lit shader, neither of which the planet material design changes. Decision recorded for Phase 1:
**the demo's default is MSAA off on `WebGPURenderer`** (`antialias: false`); a shader-based AA (TSL FXAA/SMAA)
is the follow-up if edges need it. Per-instance draws on WebGPU (no multi-draw) are a cost to re-check at
`maxPatches` ~1000 in Phase 5; at 81 draws it is noise.

## 2026-10-16 — Phase 1 built: `triangular-engine/planet-material`, `cell-planet-tsl` demo

New files: `projects/triangular-engine/planet-material/` (entry point; `ordered-slots`, `projection-nodes`,
`planet-morph-nodes`, `planet-context`, `planet-surface-layers`, `planet-surface-material`, specs, `gpu-eval.testing`);
demo `/cell-planet-tsl` (`?backend=webgpu|webgl2`, `?aa=1`, `?mesh=seam`, `?debug=1`); `shared/overlay-snapshot.ts`;
tsconfig paths in `tsconfig.json` and `demo-app/tsconfig.app.json`; an `angular.json` test target and
`npm run test:triangular-engine:planet-material`. The Phase 0 spike page `/tsl-webgpu-spike` is still there (delete later).

Checks: `npm run build:triangular-engine` passes (the entry point is packaged); the planet-material specs pass (20).
They include TSL `Fn`s evaluated on a real backend (WebGPURenderer `forceWebGL`, headless Chrome) against
`map-projections.ts` / `antimeridian-seam.ts`, and a render of a seam-straddling triangle through the real
material: culled with the mask, drawn without it.

### More corrections to Plan 050

- **WebGPU allows 8 vertex buffers.** The first material read 9 (position, normal, color, aSpherePos, aFlatPos,
  aSphereNorm, aFlatNorm, aOtherDir1/2) and every draw failed with a pipeline validation error that showed up only
  in the console, as a black frame. Fix: read the sphere position/normal from the geometry's own `position`/`normal`
  (the streaming pipeline writes them identical to `aSpherePos`/`aSphereNorm`) and make `aOtherDir1/2` opt-in
  (`seamCullAttributes`). Stage 1 now uses 4 attributes (+ color); Phase 2 adds uv and the macro factor, which fits (7 of 8).
  `IPlanetMorphGraph.vertexAttributes` and a spec guard the budget. Layers must count their own attributes.
- **`maskNode`** works as the discard hook (`false` = discard). `fwidth` is computed once, outside any branch.
- The vertex-side cull needs real `aOtherDir1/2`; the streaming pipeline writes zeros there, so in dynamic projection mode
  on streaming geometry only the `fwidth` cull applies (same as the GLSL path), which cannot catch large triangles.
  Static projection (baked flat positions, the demo default) needs no seam handling: patches split at the antimeridian.
- **Dynamic projection needs a tracked basis.** `uProjMode = 1` alone projects from the default frame (`uProjForward` +Z,
  `uProjUp` +Y, `uProjRight` +X), which tears the map into shards on baked flat positions. The GLSL views set the basis together
  with the mode (`CellPlanetMorphView.updateTracking`); `/cell-planet-morph-streaming` pins `uProjMode` to 0, so no shipped
  streaming demo or game exercised dynamic mode on streamed tiles (`/cell-planet-morph-spike` does, on its full un-indexed
  geometry, which carries real `aOtherDir1/2`). The `cell-planet-tsl` "projection in shader" toggle now sets the basis from
  centre lon/lat sliders (not from the camera). **Checked visually:** on the synthetic seam globe (the "synthetic seam
  globe" button, `?mesh=seam`) dynamic mode renders cleanly, so the TSL morph is correct. On streamed tiles it still tears:
  the tiles are indexed, so `aOtherDir1/2` (per triangle) is a zero array and only the `fwidth` cull applied.
  **Why not un-index the tiles (the worldgen change):** it triples the vertices (about 5x vertex-buffer memory and 3-6x vertex
  work), and the two extra attributes push the TSL stack to 9 vertex buffers, over WebGPU's limit of 8. So the seam check
  is attribute-free instead: stage 1 compares the interpolated `vProjLon` with the longitude of the interpolated sphere
  direction and discards fragments off by more than 0.5 rad (the polar cap, `|dot(dir, up)| > 0.99`, is exempt). It runs
  only in dynamic mode, costs one `atan` per fragment, and needs no pipeline change. **Not yet verified visually** on
  streamed tiles; the threshold and the polar exemption may need tuning. The GLSL path is unchanged (its streaming
  view has no dynamic mode).
- **Root cause of the shards at the default centre:** dynamic mode projected `aSphereNorm`, which on streamed terrain tiles
  is the surface normal (it tilts with relief), not the radial direction. It now projects the normalised body-fixed
  position (no extra varying: WebGPU allows 16). The GLSL material still projects `aSphereNorm`, which is probably why its
  dynamic mode is also wrong on terrain (not changed: the GLSL patches are out of scope).
- **Root cause of the thin, camera-following band:** streamed tiles are batched; the batch matrix holds
  `centerWorldM - batchAnchor` and the anchor (re-follows the camera every 500 m) lives in `modelWorldMatrix`, so
  `positionLocal - positionGeometry` is anchor-relative. The patch's body-fixed offset is
  `modelWorldMatrix * (offset, 1) - uBodyCentreScene`. Lifting it fixed the projection. TSL build order matters: `batchOffset`
  must be the first read of `positionLocal` (`positionNode: batchOffset.add(morphedLocal)`); reading it earlier gives a
  wrong value and the batched macro-variation spec fails. A spec renders a batched patch at two anchors
  (`planet-morph-graph.spec.ts`). Verified in the demo: full map coverage at morph 1, and the centre-longitude slider
  scrolls it. A stale dev build once looked like the same bug; reload after rebuilding the library.
- **Missing relief shading in dynamic mode (fixed, user-confirmed 2026-10-17):** the TSL stage forced the flat normal to
  `(0,0,1)` when `uProjMode` was on, so the map at morph 1 had no terrain lighting. The GLSL material keeps the baked
  `aFlatNorm` there. The map axes (east, north, up) do not depend on the projection centre, so the baked normal stays
  valid when re-centred. `planetMorphGraph` now always uses `aFlatNorm`.
- **Token map (2026-10-17):** `atmosphere` and `planet-material` are registered and acknowledged against
  `docs/atmosphere.md` and `docs/planet-material.md` (the doc-section stubs hold the why and constraints).
- `setPlanetProjectionCentre(morph, { lonDeg, latDeg } | null)` writes the whole basis and the mode, so a page does not
  build the vectors itself (a spec covers it).
- The sun-occlusion and emissive stacks exist in the API but sun occlusion is not yet wired into lighting (Phase 4).

### Gate status

- Morph at 0, 0.6 and 1, equirect and Equal Earth, static and dynamic projection: render correctly on WebGPU (visually).
- **Not verified:** the same on the `forceWebGL` backend in the demo, and a full morph scrub with the dynamic basis rotated on
  streaming geometry (a hidden browser pane could not present frames reliably; see the caveat in the Phase 0 entry).
  The `forceWebGL` path is covered only by the specs. Needs a visible-browser pass: open `/cell-planet-tsl?backend=webgl2`
  and `?backend=webgpu`, click "scrub morph", toggle the projection.

## 2026-10-16 — three 0.186.1: `DirectRenderPipeline` re-run of the Phase 0 benchmark

Workspace upgraded 0.183.2 -> **0.186.1** (see `docs/upgrades/01_threejs_0.183_to_0.186.md`). r186 adds
`DirectRenderPipeline` (`three/webgpu`): tone mapping and output colour space run inside the material shaders, so the
intermediate framebuffer and output pass of the default `WebGPURenderer` pipeline are skipped. The spike page has a
new `?pipeline=direct|default` flag (webgpu and webgl2 backends only; the page registers the pipeline with
`EngineService.registerRenderPipeline`). The "run all benchmarks" button now also runs four `pipeline=direct` configs.

Same method as the entries above: 1280x720 at pixel ratio 1, ms per frame `[orbit, surface, flat]`, GPU-synced median of
5 x 150 frames, visible Chrome pane (AMD). **The machine was not idle** (dev builds and a test run just before), and
numbers are noisier than the earlier table (`forceWebGL` MSAA-on read 4.8 vs 2.8 earlier). Read gaps of ~0.3 ms as noise.

| Backend / pipeline | MSAA | orbit | surface | flat |
|---|---|---|---|---|
| classic WebGL, GLSL | on | 0.92 | 1.43 | 1.02 |
| classic WebGL, GLSL | off | 0.50 | 0.95 | 0.66 |
| WebGPU, default pipeline | on | 2.40 | 3.39 | 2.95 |
| WebGPU, default pipeline | off | 1.06 | 1.51 | 1.28 |
| WebGPU, **direct** | on | 1.70 | 2.16 | 1.68 |
| WebGPU, **direct** | off | 1.04 | 1.57 | 1.22 |
| `forceWebGL`, default pipeline | on | 4.77 | 8.44 | 5.72 |
| `forceWebGL`, default pipeline | off | 2.17 | 5.46 | 3.15 |
| `forceWebGL`, **direct** | on | 1.88 | 5.11 | 2.75 |
| `forceWebGL`, **direct** | off | 1.82 | 5.20 | 2.78 |

Draw calls: WebGPU 32/80/62 direct vs 33/81/63 default (the background draw is gone); `forceWebGL` 1 vs 2.
Not measured: per-pass `trackTimestamp` split (the single `gpuMsLastFrame` the spike reports covers the whole render).

Conclusion: **direct removes the MSAA surcharge, not the gap.** With MSAA on it saves 29-43% (2.40 -> 1.70 orbit) but
is still 1.5-1.8x classic; with MSAA off it is identical to the default pipeline (1.04 vs 1.06), still ~2x classic.
So the output pass is not what the remaining WebGPU-vs-classic difference is made of; node PBR shading and per-instance
draws are. Direct is **not within ~10% of classic**, so the demo pages stay on the default pipeline (MSAA off, Phase 1 decision).
`pipeline=direct` stays available as an opt-in on the spike page.

Caveats for anyone enabling direct later: blending happens after tone mapping, and materials that sample the
framebuffer (transmission / refraction) do not work. Plan 049's atmosphere needs an HDR `RenderPipeline` for bloom and
exposure, which `DirectRenderPipeline` cannot provide, so Plan 049 should not depend on it.

Spike note: the diagnostic `rt=1` rows (classic, half-float target + tone-map quad) are no longer valid on r186. Its `ShaderMaterial`
fails to compile (`toneMappingExposure` redefinition: the quad's `#include <tonemapping_pars_fragment>` now duplicates what
three injects), so those rows measured a failed pass. The 0.183 numbers above are unaffected.

## Phase 2: surface layers (2026-10-16)

Built (new files in `planet-material/`): `macro-variation-layer.ts`, `cell-lookup-layer.ts`, `streamed-material-layer.ts`,
exported from the entry point. Demo: `cell-planet-tsl` now stacks streamed tiles -> cell lookup -> macro variation
(`?tiles=0`, `?macro=off|bodyFixed|morphed`), with a demo-local `material-streaming.ts` (worker pool + the existing
`TerrainMaterialTileRuntime` and `selectCellPlanetMaterialTiles`).

Decisions and traps found:
- **Batch offset.** Stage 1 now snapshots `positionLocal - positionGeometry` once (`toVar`) and exposes
  `bodyFixedLocal` / `morphedBatchedLocal` varyings on the context. A GPU spec renders the same triangle through a
  translated `Mesh` and a translated `BatchedMesh` and requires identical pixels, and that a different translation differs.
- **Noise parity is not byte parity.** `fract(sin(dot) * 43758.5453)` amplifies float32 rounding (~1e-5 in the dot) to ~0.4,
  so the GPU hash cannot equal the float64 CPU hash (the GLSL patch has the same property). Specs pin the hash range, that the
  noise interpolates the GPU's own lattice hashes like the CPU scheme, and the offset/scale transform; not the hash values.
- **Texture reads.** Every layer read is an explicit `.level(0)`; the directory-vs-leaf branch is a `select` over two reads
  (no fetch inside control flow). Layer textures sit in texture nodes, so uploads/swaps never recompile.
- Layers take their GPU data structurally (`IStreamedMaterialGpu`, `ICellLookupPayload`), so the entry point does not import
  `terrain` or `worldgen/render`. `streamedMaterialLayer` mirrors `gpu.enabled` / `gpu.debug` with `onFrameUpdate`.
- `positionSpace: 'viewM'` is `'morphed'` in TSL (it samples the morphed local position).

Verification: planet-material specs 34/34 (headless, `forceWebGL`), library build ok, demo build 0 errors. No fresh
WebGPU pipeline errors on `/cell-planet-tsl`; the 7 vertex attributes fit the 8-buffer limit.
**Not done:** the Phase 2 gate (pixel diff against the GLSL demo at globe / mid-morph / flat) and any visual check, since the
automated pane is hidden (1 FPS, blank canvas). Needs a visible window.

## Phase 3: lines, map frame, ocean (2026-10-16)

Built (new files in `planet-material/`): `planet-line-materials.ts` (`planetBorderMaterial`, `planetMapBorderMaterial`),
`planet-ocean-material.ts` (`planetOceanMaterial`). `PlanetSurfaceMaterial` gained a `base` option and a `solidColorLayer`
helper (additive) so the ocean is stage 1 over a constant translucent colour (opacity 0.68, roughness 0.18, as the GLSL demo).
`cell-planet-tsl` now shows the ocean, the cartographic map frame (fades in between morph 0.15 and 0.35, as in the GLSL page) and
the cell-grid lines, with toggles and a frame-style button. The cell-overlay ShaderMaterial is not ported (no TSL view needs it).

Decisions and traps:
- **Seam cull on lines.** The GLSL moves the vertex off-screen. The TSL discards the whole primitive in the fragment stage from a
  per-vertex `vBorderSeamCull` varying plus the `fwidth` test; both vertices of an edge agree on whether it crosses, so the result
  matches. `fwidth` is evaluated unconditionally (WGSL).
- **Line vs ribbon.** `ribbonWidth` 0 gives a `LineBasicNodeMaterial` for `LineSegments`; above 0 a `MeshBasicNodeMaterial` for a triangle
  ribbon (the sideways offset is in the flat map, as in the GLSL). Specs render the ribbon: 1-px lines are not readable back reliably.
- **Frame style is a uniform** (`style.value` 0/1/2), so switching style never recompiles.
- **Vertex buffers.** Lines read 4-5 attributes, the frame 5, the ocean 6 (`sphereFromGeometry: false`), all under WebGPU's 8.
- WebGPU lines are always 1 px wide; the GLSL grid is too, so no change.

Verification: planet-material specs 44/44 (10 new: seam cull on/off and its guard, frame fade and the three styles, ocean opacity
and colour-as-uniform), library build ok, demo build 0 errors. **Not verified visually** (the automated pane is hidden). The
Phase 3 gate ("shows everything the GLSL demo's default settings show") is open and needs a visible window.

## Open issue: batching toggle halves WebGL frame rate (2026-10-16, not a blocker)

Observed in `cell-planet-tsl` (user screenshots, same camera, MSAA off):

| Backend | Batching | Draw calls | FPS |
|---|---|---|---|
| WebGPU | off | 162 | 111 |
| WebGPU | on | 162 | 103 |
| forceWebGL | off | 147 | 126 |
| forceWebGL | on | 5 | 64 |

Findings:
- WebGPU: three 0.186's backend issues one `drawIndexed` per `BatchedMesh` instance (no multi-draw), so batching cannot reduce calls there. It only preallocates geometry (28 MB off, 625 MB on at the default 1024-patch capacity).
- WebGL: batching cuts calls to 5 but halves FPS with a 0.9 ms CPU frame, so the cost looks GPU-side.
- The GLSL `/cell-planet-morph-streaming` page does not show it. It passes `maxPatches` 80-220, `maxInstallsPerFrame` 8, `lodPositionToleranceM` 1, `lodViewToleranceRadians` 0.005; the TSL demo now passes the same, and the gap persisted.

Hypothesis (unconfirmed): a batch has `sortObjects = false` when `frustumCulled` is false, so patches draw unsorted and the heavier TSL fragment stage (tiles, macro, cell lookup) overdraws. Test: `?tiles=0&macro=off&backend=webgl2`, batching on vs off. Also unknown: whether the GLSL page runs the classic `WebGLRenderer`.

Possible fixes touch `TerrainSurfaceComponent` / the view defaults (off-limits for this plan), so they need a separate approved diff. Revisit in Phase 5 (perf).

## Phase 4: extension slots + reference demo (2026-10-16)

Built (new files in `planet-material/`): `planet-lighting.ts` (the lighting and atmosphere stage types,
`simpleDayNightLighting`, `sunVisibilityLighting`, `identityAtmosphere`, the day/night and lighting-turn uniform
factories) and `planet-extension-examples.ts` (`roadLayer`, `moonEclipseOcclusion`, `nightLightsEmissive`, real code a
game can use or copy). Additive edits: `PlanetSurfaceMaterial` gained the `lighting` / `atmosphere` options,
`setLightingStage` / `setAtmosphereStage` and a `setupOutput` override; `planetMorphGraph` gained a `lightingTurn` option.
Demo: `/planet-material-extensions` (a plain sphere; toggles add or remove each slot, sliders write uniforms).

How the stages attach:
- **Sun occlusion.** Occluders multiply into `sunVisibility`. With no custom lighting stage, the default
  `sunVisibilityLighting` scales the lit colour by `mix(floor 0.15, 1, sunVisibility)`. That is exact for a sun-only scene
  and approximate otherwise (it also dims ambient). A lighting stage that models the sun itself reads `sunVisibility`
  directly; `simpleDayNightLighting` multiplies it into its day factor.
- **Lighting stage** runs on the final lit colour (the GLSL does the same, after `dithering_fragment`), implemented by
  overriding `NodeMaterial.setupOutput`. With no stage and no occluder the output is untouched and the stack key is
  unchanged (`;lighting:<id>` and `;atmosphere:<id>` are appended only when set).
- **Atmosphere stage** runs last, after lighting, before fog. Identity by default, so Plan 049 can fill it.
- **Lighting turn.** `lightingTurn` (a `mat3` uniform, `createPlanetMorphLightingUniforms().uMorphLightingTurn`) makes the
  shading normal `normalize(turn * sphereNormal)` instead of the morphed normal, as in the GLSL. It adds `/turn` to the key.
- **Emissive stack** was already built in Phase 1; it now has a GPU spec through `nightLightsEmissive`.

Traps:
- **`select(cond, vec3, vec3)` returned 0 on the false branch** in the day/night stage (disabled gave black, enabled was
  right), where the same shape works in the macro layer. Not root-caused. The stage now blends with
  `mix(1, lightMod, clamp(enabled, 0, 1))`, which is also continuous. If a later stage sees a similar black, suspect `select`
  on an `outputNode.rgb` operand first.
- A surface normal pointing away from the camera rendered black under ambient light in the spec; specs vary the sun
  direction, not the normal, to test night.
- Occluder maths is in angles, not metres: the umbra and penumbra of a moon at 3 radii are narrow (about 0.03 rad of
  surface arc), so a slider needs fine steps to show the penumbra.

Verification: planet-material specs 61/61 (17 new: day/night, occluder product, lighting/atmosphere order, run-time stage
swap, lighting turn, road, eclipse umbra to penumbra, night lights), library build ok once the unrelated
`atmosphere/atmosphere-backdrop.ts` error from another session cleared. **Not verified visually.** The gate for Plan 049
Phase 2 ("slots exist and are spec'd") is met by the specs; the demo needs a visible window.

## Phase 5: docs (2026-10-16)

User visual check of `/planet-material-extensions` and the Phase 2-4 demos: looks right. The "perf not ideal" report (31 FPS, 2 draw calls, 3 triangles) came from the atmosphere page (Plan 049), not from a Plan 050 demo. It is the per-pixel `march` cost documented in `docs/atmosphere.md` ("Cost"), not terrain or batching. Plan 050 perf numbers are still unrecorded.

Written: `projects/triangular-engine/docs/planet-material.md` (stages, slots, building blocks, "writing a layer", cache-key and TSL rules, backend/batching note), a `planet-material` row in `docs/entry-points.md`, a section and entry-point line in `.agents/skills/triangular-engine/SKILL.md`, and a `CHANGELOG.md` entry.

Not done:
- **Perf numbers** (frame time and first-compile time vs the GLSL demo, WebGPU and `forceWebGL`). They need a visible window: the in-app pane runs at 1 FPS when hidden. Measure with the batching toggle in `/cell-planet-tsl` and the stats panel, at an idle machine, and record them here.
- **`daxur tokens map` registration** of `planet-material` (and `atmosphere`): `tokens map status` lists neither as a tracked section; register them with the maintainer, not from this session (Plan 049 shares the manifest).
- Delete the throwaway `/tsl-webgpu-spike` page once the benchmark re-run is final.
