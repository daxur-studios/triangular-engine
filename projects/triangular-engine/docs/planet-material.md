# Planet surface material (`triangular-engine/planet-material`)

The cell-planet surface as one TSL node material, for `WebGPURenderer` (native WebGPU, or its WebGL2 fallback via `forceWebGL`). It replaces the GLSL `onBeforeCompile` patches used by the classic-WebGL cell-planet scenes, and is built so a game can add its own layers (roads, decals, snow), sun occluders (eclipses), emissive light (city lights), a lighting model and an atmosphere without editing the engine.

Status: **preview.** Design and phases: [Plan 050](../../../docs/plans/050_tsl_planet_surface_material.md). Try it at `/cell-planet-tsl` (the full streaming surface) and `/planet-material-extensions` (a plain sphere with a road, an eclipse and city lights) in the demo app. The classic-WebGL terrain demos keep working unchanged.

Use a `WebGPURenderer`: `EngineService.provide({ preferredRenderer: 'webgpu', webGpuRendererParameters: { forceWebGL: false } })`.

## Stages

One `PlanetSurfaceMaterial` runs six stages. All of them read one shared `IPlanetContext` (sphere normal, lat/lon, morphed and body-fixed positions, camera distance, UV, seam cull, the morph uniforms).

| # | Stage | You can |
|---|---|---|
| 1 | Position: sphere <-> flat-map morph, shading normal, seam cull | Fixed. Drive `material.morph` uniforms (`uMorph`, projection, ...) |
| 2 | Surface layers: an ordered stack that outputs albedo, roughness, metalness | `addSurfaceLayer` / `removeSurfaceLayer` |
| 3 | Sun occlusion: occluders multiply into `sunVisibility` (0 shadowed, 1 lit) | `addSunOcclusion` / `removeSunOcclusion` |
| 4 | Lighting: standard PBR, then an optional replaceable stage on the lit colour | `lighting` option, `setLightingStage` |
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
| `planetOceanMaterial` | The ocean shell: `MeshStandardNodeMaterial` + stage 1 |
| `planetBorderMaterial`, `planetMapBorderMaterial` | Cell-grid lines and the flat-map frame |
| `simpleDayNightLighting`, `sunVisibilityLighting` | Lighting stages |
| `roadLayer`, `moonEclipseOcclusion`, `nightLightsEmissive` | Working examples of a layer, an occluder and an emissive. Use or copy them |
| `createPlanetMorphUniforms`, `planetMorphGraph`, `createPlanetContext` | Stage 1 pieces, to build a different material from the same graph |
| `equirectangularFlat`, `equalEarthFlat`, `seam*` | The projection and seam `Fn`s |

## Writing a layer

A layer is a pure function from the context and the sample below it to a new sample. Expose live values as `uniform(...)` nodes and return them alongside the layer, so a game changes `.value` without recompiling.

```ts
import { Color } from 'three';
import { abs, asin, dot, float, mix, smoothstep, uniform, vec3 } from 'three/tsl';
import type { SurfaceLayer } from 'triangular-engine/planet-material';

const axis = uniform(new Vector3(0, 1, 0));
const halfWidth = uniform(0.02);

export const equatorRoad: SurfaceLayer = (context, below) => {
  const distance = abs(asin(dot(context.sphereNormal, axis)));        // angle from a great circle
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
- **`lightingTurn`** (`createPlanetMorphLightingUniforms().uMorphLightingTurn`, a `mat3`) makes the shading normal `normalize(turn * sphereNormal)` instead of the morphed normal, so lighting follows the globe while the geometry morphs.

## Projecting in the shader (dynamic mode)

By default the flat map is the baked `aFlatPos`. To re-centre the map on a point, for example a tracked unit, call `setPlanetProjectionCentre(material.morph, { lonDeg, latDeg })`. It writes the whole projection basis and turns `uProjMode` on. Pass `null` to go back to the baked map. Setting `uProjMode` on its own is not enough: without a basis the map is projected from the default frame and tears. The seam that moves with the centre is culled in the fragment stage, so it works on indexed streaming tiles with no extra vertex attributes. Optional `seamCullAttributes` adds an exact per-triangle cull for geometry that carries `aOtherDir1/2`, at the cost of two vertex buffers.

## Backends and batching

The same graph runs on native WebGPU and on `forceWebGL`. On the WebGL2 backend three batches a `BatchedMesh` into multi-draws. On native WebGPU it issues one draw per visible instance, so batching saves memory-per-draw but not draw calls there; it only preallocates geometry (capacity is `maxPatches`). Known issue: in `cell-planet-tsl`, turning batching on halves the WebGL frame rate. See the runbook (Runbook 050, "Open issue").

## Testing a stage

Specs evaluate TSL on a real backend through `WebGPURenderer({ forceWebGL: true })` (`gpu-eval.testing.ts`, `render-eval.testing.ts`). They are test-only helpers and not exported. See the `*.spec.ts` files next to each layer for patterns: build a small triangle, render to a few pixels, read them back, change only a uniform and assert the pixel moved without a recompile.
