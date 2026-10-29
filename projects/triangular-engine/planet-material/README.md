# triangular-engine/planet-material

The cell-planet surface as one TSL node material, for `WebGPURenderer` (native WebGPU, or its WebGL2 fallback via `forceWebGL`). It replaces the GLSL `onBeforeCompile` patches used by the classic-WebGL cell-planet scenes, and is built so a game can add its own layers (roads, decals, snow), sun occluders (eclipses), emissive light (city lights), a lighting model and an atmosphere without editing the engine.

Status: **preview.** Design and phases: Plan 050. Try it at `/cell-planet-tsl` (the full streaming surface) and `/planet-material-extensions` (a plain sphere with a road, an eclipse and city lights) in the demo app. The classic-WebGL terrain demos keep working unchanged.

Use a `WebGPURenderer`: `EngineService.provide({ preferredRenderer: 'webgpu', webGpuRendererParameters: { forceWebGL: false } })`.

## Stages

One `PlanetSurfaceMaterial` runs six stages. All of them read one shared `IPlanetContext` (sphere normal, lat/lon, morphed and body-fixed positions, camera distance, UV, seam cull, the morph uniforms).

| # | Stage | You can |
|---|---|---|
| 1 | Position: sphere <-> flat-map morph, shading normal, seam cull | Fixed. Drive `material.morph` uniforms (`uMorph`, projection, ...) |
| 2 | Surface layers: an ordered stack that outputs albedo, roughness, metalness | `addSurfaceLayer` / `removeSurfaceLayer` |
| 3 | Sun occlusion: occluders multiply into `sunVisibility` (0 shadowed, 1 lit) | `addSunOcclusion` / `removeSunOcclusion` |
| 4 | Lighting: standard PBR, then an optional replaceable stage on the lit colour. Stock stages take an optional per-pixel `normal` (direct sun only) and `directShadow` (darkens direct sun only) | `lighting` option, `setLightingStage`; `IPlanetLightingInputs` |
| 5 | Emissive: an additive stack | `addEmissive` / `removeEmissive` |
| 6 | Atmosphere: runs last, before fog. Identity by default | `atmosphere` option, `setAtmosphereStage` |

Stock layers sit at `SURFACE_LAYER_ORDER`: base 0 (vertex colour), `streamedMaterial` 100, `cellLookup` 200, `macroVariation` 300, game layers from 1000 up.

## Minimal use

```ts
import { PlanetSurfaceMaterial, SURFACE_LAYER_ORDER, macroVariationLayer } from 'triangular-engine/planet-material';

const material = new PlanetSurfaceMaterial();          // vertex-colour base, plain PBR
const macro = macroVariationLayer({ positionSpace: 'bodyFixed' });
material.addSurfaceLayer({ id: 'macroVariation', order: SURFACE_LAYER_ORDER.macroVariation, layer: macro.layer });

material.morph.uMorph.value = 0.5;                     // uniforms: no recompile
macro.strength.value = 0.5;
```

Geometry needs the attributes the stages read: `aFlatPos` / `aFlatNorm` (the flat-map position and normal), `color` for the base layer, and whatever a layer lists in its `vertexAttributes`. Mesh vertex buffers are limited to 8 on WebGPU, counting only attributes the shader reads.

## Building blocks

| Export | What it is |
|---|---|
| `PlanetSurfaceMaterial` | The material, with the stage/slot API above |
| `vertexColorLayer`, `solidColorLayer` | Base layers |
| `cellLookupLayer`, `streamedMaterialLayer`, `macroVariationLayer` | Stock surface layers (ports of the GLSL patches) |
| `cellVoronoiLayer` | `cellLookupLayer` with exact cell edges at any zoom ([below](#exact-cell-edges-at-any-zoom)) |
| `flatFeatureLayer` | Runways, taxiways, aprons and roads from a per-page feature list, with markings ([below](#flat-features-runways-roads)) |
| `checkerDebugLayer` | A debug checkerboard as a layer: geography (`latLon`) or map-UV cells, `fwidth`-filtered, live-toggled |
| `planetOceanMaterial` | The ocean shell: `MeshStandardNodeMaterial` + stage 1 |
| `planetBorderMaterial`, `planetMapBorderMaterial` | Cell-grid lines and the flat-map frame |
| `simpleDayNightLighting`, `sunVisibilityLighting` | Lighting stages; `IPlanetLightingInputs`, `ISimpleDayNightLightingOptions`, `ISunVisibilityLightingOptions` are their options |
| `roadLayer`, `moonEclipseOcclusion`, `nightLightsEmissive` | Working examples of a layer, an occluder and an emissive. Use or copy them |
| `createPlanetMorphUniforms`, `planetMorphGraph`, `createPlanetContext` | Stage 1 pieces, to build a different material from the same graph |
| `IPlanetStageOverride`, `PlanetSurfaceMaterial.setStageOverride` | Supply stage 1 for a mesh that is not the morph globe ([below](#using-the-material-on-another-mesh)) |
| `equirectangularFlat`, `equalEarthFlat`, `seam*` | The projection and seam `Fn`s |

## Using the material on another mesh

Stage 1 reads the morph globe's attributes (`position`, `normal`, `aFlatPos`, `aFlatNorm`). A mesh without them (the LOD terrain) draws black unless it supplies stage 1 itself: `setStageOverride` takes the context fields, the shading normal and the fragment mask, and rebuilds every stack against them.

```ts
material.positionNode = myMesh.positionNode;        // yours: the override does not carry the position
material.setStageOverride({
  id: 'myMesh',                                     // part of the shader cache key: one id per distinct graph
  context: { radialDirection, sphereNormal, uv, latLon, bodyFixedLocal, morphedPosition, morphedBatchedLocal },
  shadingNormal: normalNode,                        // body frame; the material turns it into view space
  maskNode: null,                                   // null removes the globe's seam mask, which reads missing attributes
  maskShadowNode: null,
});
material.setStageOverride(null);                    // back to the globe's stage 1
```

Fields you leave out keep the globe's, and `material.context` returns the merged context, so layers built afterwards see it. With no override set (the default) the context, normal, masks and cache key are exactly the globe material's, so the globe scenes are unchanged. `TerrainPlanetMaterial` in [`triangular-engine/lod-surface`](../lod-surface/README.md#planet-material) is the worked example, including how to draw its sea level against the globe's.

## Exact cell edges at any zoom

`cellLookupLayer` reads a nearest-filtered cell-id atlas, so a cell edge is a staircase of atlas texels up close. `cellVoronoiLayer()` has the same controls (`enabled`, `opacity`, `updatePalette`, `dispose`) but its `setLookup` also takes each cell's centre and up to eight neighbour ids (`ICellVoronoiPayload`; `buildCellPlanetLookup` in `lod-surface/core` makes one from a `triangular-engine/worldgen` world). The atlas only finds a nearby cell; the shader then picks the cell whose centre has the largest dot product with the direction among that cell and its neighbours, which is the planet's own nearest-cell rule, so the edge is straight at any zoom. The atlas texel only needs to be smaller than a cell. Cost: 12 texture fetches per fragment (one atlas, two neighbour, nine centre) against two for the plain layer; memory: 64 B per cell on top of the atlas.

## Flat features (runways, roads)

`flatFeatureLayer(pages, options?)` paints placed flat features: asphalt or concrete with runway, taxiway or road markings. The features and their per-page lists come from a `FlatFeaturePageWindow` (`triangular-engine/worldgen/render/core`, see [Flat features](../worldgen/render/README.md#6-flat-features-runways-roads)); the layer only reads its two textures and uniforms, so this entry does not import `worldgen`. The same feature set flattens the terrain in the mesh worker, so the paint and the flat ground always agree.

```ts
import { flatFeatureLayer, SURFACE_LAYER_ORDER } from 'triangular-engine/planet-material';
import { FlatFeaturePageWindow, FlatFeatureSet } from 'triangular-engine/worldgen/render/core';

const pages = new FlatFeaturePageWindow(new FlatFeatureSet(features, radiusM));
const flat = flatFeatureLayer(pages, { concrete: '#8f8a80' });
material.addSurfaceLayer({ id: 'flatFeatures', order: SURFACE_LAYER_ORDER.game, layer: flat.layer });

// each frame, before rendering: camera direction from the planet centre and altitude in metres
pages.update(cameraDirection, altitudeM);
```

- Per pixel the layer finds its page from `context.latLon`, walks that page's short list (at most `maxPerPage`, default 8, unrolled), and takes the signed distance of each feature: a box for rectangles, a round-ended capsule for segments. All texture reads use an explicit level, like `streamedMaterialLayer`.
- **Crossings.** Where features overlap, the one with the highest `priority` owns the markings; the body colour is the union. Between equal priorities the pixel goes to the feature it is deeper inside.
- **Far away.** A feature narrower than a pixel is spread over the pixel at its area weight instead of vanishing or widening, so a road fades to a faint line from altitude.
- `enabled` (uniform) toggles it live; the colour options (`asphalt`, `concrete`, `paint`, `taxiwayPaint`) are linear RGB triplets or CSS colours and are live uniforms too.

**Why `roadLayer` is not built on it.** `roadLayer` stays a standalone example of writing a layer: its road is a planet-spanning great circle with an angular width and no height. That shape is longer than the 45° a flat-feature segment may span and would sit in nearly every page list. Use `flatFeatureLayer` for placed roads, runways and airfields, and `roadLayer` as a template for your own analytic layer.

## Debug checkerboard

`checkerDebugLayer` is the reusable form of the atmosphere lab's ground checker and graticule: a debug material you can drop on the planet to read scale, stretching and UVs at a glance. It reads only the planet context (no vertex attributes), so it stays within the 8-buffer budget, and it is anti-aliased with `fwidth` (a sub-pixel cell fades to grey), which reads cleanly at every zoom on both backends.

```ts
import { PlanetSurfaceMaterial, SURFACE_LAYER_ORDER, checkerDebugLayer } from 'triangular-engine/planet-material';

const material = new PlanetSurfaceMaterial();
const checker = checkerDebugLayer({ space: 'latLon', cellSize: Math.PI / 16, lines: true });
material.addSurfaceLayer({ id: 'checkerDebug', order: SURFACE_LAYER_ORDER.game, layer: checker.layer });
checker.enabled.value = 0;        // live toggle: no recompile
checker.cellSize.value = 0.05;    // live
```

`space: 'latLon'` keeps cells welded to geography as the view morphs (they narrow toward the poles); `space: 'uv'` matches the map/tile UVs. `lines` draws a pixel-wide graticule on the cell edges. In `cell-planet-tsl`, `?checker=1` adds it and the panel toggles it live.

## Writing a layer

A layer is a pure function from the context and the sample below it to a new sample. Expose live values as `uniform(...)` nodes and return them alongside the layer, so a game changes `.value` without recompiling.

```ts
import { Color } from 'three';
import { abs, asin, dot, float, mix, smoothstep, uniform, vec3 } from 'three/tsl';
import type { SurfaceLayer } from 'triangular-engine/planet-material';

const axis = uniform(new Vector3(0, 1, 0));
const halfWidth = uniform(0.02);

export const equatorRoad: SurfaceLayer = (context, below) => {
  const distance = abs(asin(dot(context.radialDirection, axis)));     // angle from a great circle (radialDirection, not the relief-tilted sphereNormal)
  const on = float(1).sub(smoothstep(halfWidth.mul(0.6), halfWidth, distance));
  return {
    albedo: mix(below.albedo, vec3(new Color('#f2c14e')), on),
    roughness: mix(below.roughness, float(0.95), on),
    metalness: mix(below.metalness, float(0), on),
  };
};

material.addSurfaceLayer({ id: 'road', order: SURFACE_LAYER_ORDER.game, layer: equatorRoad });
```

A sun occluder is `(context) => number node` (1 = lit), an emissive is `(context, surface) => vec3 node`, a lighting stage is `(context, { color, sunVisibility, surface, emissive }) => vec3 node` (`emissive` is the emissive stack's sum, already in `color`, or null), an atmosphere stage is `(context, color) => vec3 node`.

## Rules that keep it fast

- **The stack is the shader cache key.** The ids, in run order, make `material.stackKey`. Changing a uniform value never recompiles; adding, removing or reordering a layer, or setting a lighting or atmosphere stage, does. Edit the stacks at setup and warm up with `renderer.compileAsync(scene, camera)`. Use a new `id` when a layer's graph changes shape.
- **Do the per-pixel work once.** Layers run for every fragment. Prefer a varying (vertex stage) for anything smooth across a triangle.
- **`fwidth` and other derivatives** must be evaluated unconditionally (WGSL), not inside a branch.
- **Prefer `mix` over `select`** when blending vec3 values from `outputNode.rgb`: a `select` there returned 0 on the false branch in the day/night stage and was not root-caused.
- **The lighting stage runs on the final lit colour**, as the GLSL day/night patch does. With occluders and no custom stage, `sunVisibilityLighting` scales the colour by `mix(0.15, 1, sunVisibility)`, exact for a sun-only scene and approximate otherwise.
- **Occluders dim the sky too; a direct shadow does not.** `sunVisibility` (the occluders' product) stands for an eclipse: it dims direct and sky light. For a cast shadow (a canopy, a building, a cloud's shadow on one surface) pass `directShadow` (0 shadowed, 1 lit) to the lighting stage instead, and for a canopy or roof normal pass `normal` (body frame, the frame of `context.sphereNormal`). Both are `(context, input) => node`, so they can read a field a layer put on `input.surface`. The sky or ambient term keeps the sphere normal, so a mesh, its impostor and its far form in the surface material get the same sky light. Without either input a stage builds the same graph as before.

  ```ts
  const stage = simpleDayNightLighting(dayNight, {
    normal: (_context, input) => (input.surface as any).canopyNormal, // vec3, body frame
    directShadow: (_context, input) => (input.surface as any).canopyShade, // float, 0..1
    skyShare: 0.35, // the share of day light that is sky light (default)
  });
  ```

  `simpleDayNightLighting` has no sky model, so with inputs it splits its day factor: `skyShare` (default 0.35) stays on the sphere normal, the rest follows the normal's own sun angle and the shadow (the golden-hour glow's direct share too). `sunVisibilityLighting` takes `directShadow` only (it knows no sun direction; it multiplies into `sunVisibility` and keeps `floor`). The atmosphere's `binding.lighting(inputs)` takes both; see the [atmosphere guide](../atmosphere/README.md#on-the-planet-material).
- **`lightingTurn`** (`createPlanetMorphLightingUniforms().uMorphLightingTurn`, a `mat3`) makes the shading normal `normalize(turn * sphereNormal)` instead of the morphed normal, so lighting follows the globe while the geometry morphs.
- **The morphed normal is a vertex-stage varying (`vMorphedNormal`)**, so it stays correct when a material replaces `positionNode` with its own (for example a camera-relative position) and in batched terrain. It is computed from the batch offset in the vertex stage, where `positionLocal` is still the batched, unmorphed position. A `normalNode` expression that reads `positionLocal` itself still sees the replaced position in the fragment stage; keep per-vertex values in varyings. The varying costs one inter-stage slot (16 max) and is not created under `lightingTurn`.

## Projecting in the shader (dynamic mode)

By default the flat map is the baked `aFlatPos`. To re-centre the map on a point, for example a tracked unit, call `setPlanetProjectionCentre(material.morph, { lonDeg, latDeg })`. It writes the whole projection basis and turns `uProjMode` on. Pass `null` to go back to the baked map. Setting `uProjMode` on its own is not enough: without a basis the map is projected from the default frame and tears. The seam that moves with the centre is culled in the fragment stage, so it works on indexed streaming tiles with no extra vertex attributes. Optional `seamCullAttributes` adds an exact per-triangle cull for geometry that carries `aOtherDir1/2`, at the cost of two vertex buffers.

Streamed terrain is drawn from a `BatchedMesh` whose anchor follows the camera, so the dynamic projection lifts each patch's offset through `modelWorldMatrix` and subtracts `material.morph.uBodyCentreScene` (the planet's centre in scene space, default the origin). Set it when the planet is not at the scene origin, for example under a floating origin; it assumes the patch group is not rotated.

## Backends and batching

The same graph runs on native WebGPU and on `forceWebGL`. On the WebGL2 backend three batches a `BatchedMesh` into multi-draws. On native WebGPU it issues one draw per visible instance, so batching saves memory-per-draw but not draw calls there; it only preallocates geometry (capacity is `maxPatches`). Known issue: in `cell-planet-tsl`, turning batching on halves the WebGL frame rate. See the runbook (Runbook 050, "Open issue").

## Testing a stage

Specs evaluate TSL on a real backend through `WebGPURenderer({ forceWebGL: true })` (`gpu-eval.testing.ts`, `render-eval.testing.ts`). They are test-only helpers and not exported. See the `*.spec.ts` files next to each layer for patterns: build a small triangle, render to a few pixels, read them back, change only a uniform and assert the pixel moved without a recompile.

<!-- doc-section section-id="sec_0a7475c4e30d" path="projects/triangular-engine/planet-material" baseline-tokens="37819" -->
**Why this exists.** The classic cell-planet material is a stack of GLSL `onBeforeCompile` patches that each page re-wires by hand, which made it fragile (a page that missed one uniform or attribute silently broke). This entry point turns the same behaviour into one TSL graph with six fixed stages and named slots, so a game adds a layer, an occluder, an emissive, a lighting model or an atmosphere with one call and never edits the engine.

**Constraints.** The ordered stacks are the shader cache key, so change them at setup and use uniforms for anything live. WebGPU allows 16 vertex-to-fragment varyings and 8 vertex buffers, which is why the seam cull is done in the fragment stage with no extra attributes. Streamed terrain is drawn from a `BatchedMesh` whose anchor follows the camera, so dynamic projection must lift patch offsets through `modelWorldMatrix` and subtract `uBodyCentreScene`; in TSL the batch offset must be the first read in `positionNode`, or it evaluates as zero. It assumes an unrotated patch group.

**Public boundary.** Exported: the material, stock layers, lighting stages, the stage-1 graph pieces and projection `Fn`s. The `*.testing.ts` GPU-evaluation helpers are test-only and not exported.
<!-- /doc-section -->
