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
