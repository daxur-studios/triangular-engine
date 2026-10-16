---
type: Plan
title: TSL Planet Surface Material
description: Port the cell-planet surface from GLSL onBeforeCompile patches to an extensible TSL PlanetSurfaceMaterial that runs on WebGPURenderer (WebGPU and its WebGL2 fallback) and that games can add layers, occluders and emissives to.
timestamp: 2026-10-16T00:00:00Z
tags: [tsl, webgpu, node-material, cell-planet, morph, terrain, materials, extensibility]
runbook: /docs/runbook/050_tsl_planet_surface_material.md
---

# Plan 050: TSL Planet Surface Material

Status: **planned, owner: unclaimed. Do this first:** [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md)
(atmosphere) builds on it. Written in a cloud session from code reading only. Nothing has been
built or measured yet. Evidence: [Runbook 050](/docs/runbook/050_tsl_planet_surface_material.md).

**Goal:** the `/cell-planet-morph-streaming` surface, rebuilt as one TSL `NodeMaterial` with a stable
extension API, rendering the same picture on `WebGPURenderer` (WebGPU and `forceWebGL`).

This plan owns the material design: the stages, the extension API and the port. Plan 049 owns
what goes into the lighting and atmosphere stages.

## Ground rules

- **New files only.** The GLSL patches, their demos and their specs stay as they are and keep
  working on the classic `WebGLRenderer`. Changes to existing files are limited to additive exports,
  new demo routes, docs and the plan/runbook indexes.
- **Reuse CPU-side code as-is.** Only the shader halves are new. These are reused unchanged:
  - the geometry and its attributes (`aSpherePos`, `aFlatPos`, `aSphereNorm`, `aFlatNorm`, `aOtherDir1/2`,
    `terrainMacroLandFactor`, `uv`);
  - `buildCellPerPixelLookupPayload`;
  - `TerrainMaterialTileGpu` (its textures and page tables);
  - the projection maths in `map-projections.ts` / `antimeridian-seam.ts`;
  - the CPU raycast.
- **Plug into existing components.** `TerrainSurfaceComponent` and `CellPlanetMorphStreamingView`
  already take a `createMaterial` factory, so the TSL material drops in without editing either.
- **Parity before features.** Each port must match its GLSL patch to within a small pixel tolerance
  in the same scene before anything new is added on top.

## What gets ported

The cell-planet path today is 7 `onBeforeCompile` patches and 3 hand-written `ShaderMaterial`s.
(Plan 049 first said "about 20"; that was wrong.)

| GLSL today | File | Used by the streaming demo | TSL equivalent |
|---|---|---|---|
| `enablePlanetMorphProjection` | `worldgen/render/planet-morph-material.ts` | yes, terrain + ocean | Stage 1, position: `planetMorphPosition`, `planetMorphNormal`, seam cull/discard |
| `enablePlanetMorphLighting` | same | no (morph-spike, library views) | Option on stage 1's shading normal (`lightingTurn` matrix) |
| `enablePlanetDayNightLighting` | same | no (`createPlanetMorphMaterial`) | `simpleDayNightLighting`: a stand-in lighting stage until Plan 049's `atmosphereLighting` exists |
| `enableTerrainMacroVariation` | `terrain/materials/terrain-macro-variation-material.ts` | yes | Surface layer `macroVariationLayer` (`positionSpace: 'morphed' \| 'bodyFixed'`) |
| `enableCellPerPixelLookup` | `worldgen/render/cell-per-pixel-material.ts` | yes | Surface layer `cellLookupLayer` |
| `enableStreamedTerrainMaterial` | `terrain/materials/tiles/terrain-material-tile-gpu.ts` | yes | Surface layer `streamedMaterialLayer` (reads `TerrainMaterialTileGpu`'s textures) |
| `enableTerrainMaterialTileLookup` | `terrain/materials/tiles/terrain-material-tile-material.ts` | no (older single-atlas path) | Surface layer `materialTileLayer`, only if a caller needs it |
| `createPlanetBorderMorphMaterial` (`ShaderMaterial`, lines) | `planet-morph-material.ts` | yes, cell grid | `LineBasicNodeMaterial` + `planetMorphPosition` + edge-seam cull |
| `createPlanetMapBorderMaterial` (`ShaderMaterial`) | same | yes, map frame | `MeshBasicNodeMaterial` + morph position + style/fade nodes |
| `createPlanetCellOverlayMaterial` (`ShaderMaterial`) | same | no (`cell-planet-morph-view`) | Same pattern. Port only when the TSL view needs it |

Out of scope (separate plans if wanted):
- other `onBeforeCompile` users: scatter (3), impostors (2), trail ribbon, CSM;
- other `ShaderMaterial`s: CDLOD, clipmap, flow paths;
- clouds and water.

None of them are on the cell-planet streaming path.

## Material design

### Why not keep `onBeforeCompile`

`onBeforeCompile` is the only way to extend three's built-in materials on WebGL, and
`WebGPURenderer` ignores it. It is also fragile:
- It's string replacement on shader chunk names, so it breaks on three upgrades.
- It depends on order: `enablePlanetMorphLighting` has to warn if it's applied before the projection patch.
- Each patch has to know about the others: shared `#ifndef V_SPHERE_NORM_DECLARED` guards, and hooks
  picked so that patches don't step on each other.

TSL `NodeMaterial` exposes graph slots (`positionNode`, `normalNode`, `colorNode`, `emissiveNode`,
`outputNode`, custom lighting models). Every piece is a typed `Fn` you can call, wrap or replace.

### `PlanetSurfaceMaterial`

The material is built from named, ordered stages. All stages share one **planet context**, built
once per material:
- sphere position and normal
- flat position
- morph factor
- intrinsic height
- lat/lon
- cell id
- uv
- distance to the camera

| # | Stage | Stock content | Game extension example | Plan |
|---|---|---|---|---|
| 1 | Position | Morph sphere ↔ flat, seam cull, shading normal | (rarely extended) | 050 |
| 2 | Surface layers (stack) | Vertex colour → streamed tiles / cell lookup → macro variation | Roads, decals, snow cover, scorch marks, territory tint | 050 |
| 3 | Sun occlusion (product) | Shadow map | **Solar eclipse**, cloud shadows, ring shadows | 050 slot, 049 uses it |
| 4 | Lighting | Standard PBR, or `simpleDayNightLighting` | Toon or other custom lighting model | 050 slot, 049 fills it with `atmosphereLighting` |
| 5 | Emissive | none | City lights on the night side, lava, bioluminescence | 050 |
| 6 | Atmosphere | identity (pass-through) | Always last, so game layers are hazed too | 050 slot, 049 fills it with `atmospherePerspective` |

```ts
const material = new PlanetSurfaceMaterial({ morph, surface: { vertexColors: true } });
material.addSurfaceLayer({ id: 'roads', order: 100, layer: roadsLayer });       // (ctx, below) => SurfaceSample
material.addSunOcclusion({ id: 'eclipse', occlusion: moonEclipseOcclusion });  // (ctx) => float 0..1
material.addEmissive({ id: 'cityLights', emissive: cityLightsEmissive });
```

The stock layer order matches today's patch order. Vertex colour is the base. Streamed tiles and the
cell lookup replace or blend it. Macro variation runs after them.

Two levels of extension:

- **Slots** on the stock material, as above, for most games.
- **Building blocks.** Every stage and stock layer is also exported as a standalone `Fn`
  (`planetMorphPosition`, `macroVariationLayer`, `cellLookupLayer`, `streamedMaterialLayer`, …), so a
  game can assemble its own `NodeMaterial` from scratch.

Rules:

- Stages are pure functions of the context. No string editing.
- Order comes from `order` numbers. Layer ids, in order, form the shader cache key.
- Uniforms are nodes, so changing values never recompiles. Adding or removing layers does, so do it
  at setup, and warm up with `renderer.compileAsync`.
- `SurfaceSample` holds at least `{ albedo, roughness, metalness, normalTS? }`, so layers like roads
  can change more than colour.

### Uniforms

- The TSL side uses uniform nodes. A `UniformNode` has a `.value`, so it may structurally satisfy
  `IUniform<T>`. If it does (Phase 0 checks), one set of objects can drive both the GLSL and the TSL
  material, and the morph controller code needs no changes.
- If it doesn't, a small `syncPlanetMorphUniforms(from, to)` copies the values once per frame.

### Location

- New secondary entry point `triangular-engine/planet-material`: three-only, importing
  `three/webgpu` and `three/tsl`.
- It is kept apart so that importing `worldgen/render` never pulls in node materials.
- Thin Angular helpers go in it later only if needed. Follow Runbook 024's sublibrary boundaries, and
  check `daxur tokens map status` after adding it.

## Port notes and traps

- **Morph position.** `positionNode = mix(spherePos, flatPos, morph)`. In dynamic mode, `flatPos` is
  computed in the shader: equirect / Equal Earth from the projected lon/lat, as in the GLSL. Port
  `SEAM_GLSL_FUNCTIONS` to TSL `Fn`s. Keep the CPU `antimeridian-seam.ts` as the reference in specs.
- **Normals.** GLSL replaces `objectNormal` in the vertex shader. In TSL, compute the morphed (or
  lighting-turned) normal in the vertex stage and feed it to `normalNode` through a varying in view
  space. Check that the shadow pass and the normal used for lighting agree.
- **Seam cull.** GLSL moves seam-crossing vertices off-screen and discards fragments where
  `fwidth(vProjLon) > 2.8`.
  - **WGSL only allows derivatives in uniform control flow.** Compute `fwidth` unconditionally, then
    branch on the result.
  - Keep the vertex-side cull as a varying plus `Discard()` unless `vertexNode` turns out simpler.
- **Batching.** The terrain is a `BatchedMesh`. The macro layer's body-fixed mode needs
  `modelMatrix × batchingMatrix × position` of the *unmorphed* position. In TSL, `positionWorld`
  already includes batching but comes after `positionNode`, so build the position from
  `positionGeometry` with the batching transform explicitly. Check against the GLSL output.
- **The macro layer's `'viewM'` mode** actually samples the *morphed* local position (`transformed`).
  The TSL option is named `'morphed'` to say what it does. The GLSL name stays as is.
- **Texture arrays.** The streamed pages and leaves are `DataArrayTexture`s:
  `texture(pages, uv).depth(layer).level(0)`.
  - `FloatType` textures with `LinearFilter` need the `float32-filterable` feature on WebGPU. The
    tile directory/leaves use `NearestFilter`, so they are fine.
  - Any new float texture must be nearest-filtered, or `HalfFloatType`.
- **Cell ids.** Decode from RGBA8 exactly as the GLSL does (`r + g × 256`), with nearest sampling.
  Watch sRGB: the id texture must stay `NoColorSpace`.
- **Log depth.** The demo uses `logarithmicDepthBuffer`. `WebGPURenderer` has its own option
  (`logarithmicDepthBuffer`, or reversed depth). Node materials get it automatically, so the three
  hand-written `ShaderMaterial`s' `logdepthbuf_*` chunks just go away.
- **Vertex colours.** `vertexColors: true` works on `MeshStandardNodeMaterial`. Check colour space.
- **Engine.** `EngineService` already creates a `WebGPURenderer` for `preferredRenderer: 'webgpu'`
  and awaits `init()`. The demo has no composer, so `EffectComposer` (WebGL-only) isn't a blocker here.

## Phases

Each phase ends with a visible check and a timing number, recorded in the runbook.

0. **Spike: can `WebGPURenderer` draw this scene at all?** In a throwaway route, check on WebGPU and
   on `forceWebGL`:
   - the terrain `BatchedMesh` (per-instance visibility, draw count, frame time vs classic WebGL);
   - log depth at planet scale;
   - `MeshStandardNodeMaterial` with `vertexColors`;
   - shadows;
   - whether `UniformNode` satisfies `IUniform`.

   **Gate:** go/no-go written in the runbook. If `BatchedMesh` is slow or broken on WebGPU, stop and
   decide (fall back to per-patch meshes, or fix upstream) before Phase 1.
1. **Skeleton + morph.**
   - The `planet-material` entry point and `PlanetSurfaceMaterial` with the stage/slot API.
   - Stage 1 (morph position, normals, seam cull, static + dynamic projection, equirect + Equal Earth).
   - Vertex-colour base layer.
   - New demo `cell-planet-tsl`: the streaming page's setup with `preferredRenderer: 'webgpu'`, a
     WebGPU / `forceWebGL` toggle, and the TSL `createMaterial`.

   **Gate:** morph scrub with no seam tears, in both projections, on both backends.
2. **Surface layers.** `cellLookupLayer`, `streamedMaterialLayer` (+ its debug view) and
   `macroVariationLayer` (both position spaces).

   **Gate:** pixel diff against the GLSL demo at the same seed, camera and morph values (globe,
   mid-morph, flat), within tolerance.
3. **Lines, frame and ocean.**
   - TSL cell-grid lines and map border.
   - Ocean as `MeshStandardNodeMaterial` + stage 1.

   **Gate:** `cell-planet-tsl` shows everything the GLSL demo's default settings show.
4. **Extension slots + reference demo.**
   - Sun-occlusion product, emissive stack, replaceable lighting stage (`simpleDayNightLighting`,
     `lightingTurn`), identity atmosphere stage.
   - New demo `planet-material-extensions`: a road layer plus a moon-eclipse occluder, covered by
     specs.
5. **Perf + docs.**
   - Frame time and first-compile time vs the GLSL demo, on WebGPU and `forceWebGL`. The WebGL2
     fallback is expected to be somewhat slower than classic WebGL; record by how much.
   - User doc `projects/triangular-engine/docs/planet-material.md`: stages, slots, building blocks, a
     "writing a layer" example.
   - A section in `.agent/skills/triangular-engine/SKILL.md`.
   - `CHANGELOG.md`.

After Phase 4, Plan 049 Phase 2 can start. Phase 5 can run alongside it.

## Tests

- Specs per stock layer and the seam `Fn`s. Evaluate the TSL maths on the CPU where practical
  (the same formulas as `map-projections.ts`, `antimeridian-seam.ts` and the macro noise) against the
  existing CPU references.
- Spec for the slot API: ordering, cache key from layer ids, add/remove, and that changing a uniform
  value doesn't change the cache key.
- Pixel-parity screenshots (Plans 037/038 tooling) for Phase 2 and 3 gates, on both backends where CI
  allows.

## Decisions

| Decision | Status |
|---|---|
| TSL only for new planet rendering, on `WebGPURenderer`. GLSL patches stay for classic-WebGL scenes | **Decided** 2026-10-16 (in Plan 049) |
| Material must stay extendable: slots + standalone building blocks | **Decided** 2026-10-16 |
| Port lives in a new `triangular-engine/planet-material` entry point | Proposed |
| Port only the streaming-demo path first (see table). Other `onBeforeCompile` users later, if ever | Proposed |
| `simpleDayNightLighting` as a stand-in lighting stage until Plan 049 replaces it | Proposed |
