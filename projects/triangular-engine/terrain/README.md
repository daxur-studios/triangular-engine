# triangular-engine/terrain

Domain-aware terrain sampling, patch generation, LOD streaming, and reusable
plane/sphere terrain primitives.

Import terrain APIs from `triangular-engine/terrain`; do not reach into the
package's internal folders.

The entry point is independent from physics. Add the Jolt adapter from
`triangular-engine/jolt` only when terrain colliders are required.

## Camera-following terrain

`TerrainSurfaceComponent` is the default Angular integration. Give it a field,
a hierarchical domain, and the level-zero roots; it automatically selects,
queues, generates, and retires patches as the active engine camera moves.

```html
<terrainSurface
  [field]="field"
  [domain]="domain"
  [roots]="roots"
/>
```

The defaults provide camera-following LOD, bounded per-frame generation, parent
fallback during asynchronous replacement, and a standard Three.js terrain material.
Visual seam skirts are opt-in rather than enabled by default. Override
`lodPosition` to follow a character or vehicle instead of the camera. The
`maxLod`, `refinementDistance`, `resolution`, `generationBudget`, `skirtDepth`,
`lodHysteresis`, `getKey`, `getLevel`, `createMaterial`, `createColors`,
`colorRevision`, and `freezeLod`
inputs customize the policy and rendering without replacing the streaming
loop. `lodHysteresis` defaults to `0.15`, preventing an already-refined branch
from repeatedly flipping at its distance boundary.

For rectangular hierarchical domains, mixed LOD cuts automatically detect
coarse edges beside finer selected neighbours. Those coarse patches are sampled
at the finest required spacing before an optional mesh simplifier runs. Each
edge is then conformed to its own neighbour spacing: a refined edge retains the
matching fine samples, while the other edges follow their ordinary neighbour's
piecewise boundary. Transition data is exposed through `baseResolution`,
`edgeRefinementMask`, `edgeRefinementLevel`, `edgeRefinementLevels`, and
`edgeRefinementSegments` in the mesh-generation request. This keeps every
shared surface aligned without skirts or seam draw calls.

Mesh generation is synchronous by default because arbitrary JavaScript field
and domain instances cannot be cloned into a Web Worker. Set `meshGenerator`
to an async worker-backed function to offload sampling and typed-array
construction. The component continues to handle selection, cancellation,
patch retention, Three.js geometry creation, and GPU upload.

Framework-free consumers can continue composing
`selectAdaptiveTerrainPatches`, `TerrainGenerationQueue`, and
`generateTerrainPatchMesh` directly.

## Shared material sampling

`evaluateTerrainMaterial` provides a renderer-independent first-pass material
sample from elevation, slope, climate, ridge, river, and wetness signals. It
returns normalized weights for water, sand, grass, rock, and snow, plus feature
masks, including `arid01`, that can later be baked into streamed material tiles
or evaluated in a shader. The contract is independent of mesh topology, so it
can be used by planar chunks and cube-sphere patches at different geometry LODs.

Adapters may also provide explicit `snowIce01` and `arid01` signals for
discrete worldgen results such as ice caps, glaciers, deserts, and steppes.
Those signals let a material remain visually faithful when elevation alone
does not explain the biome.

Use the returned weights as semantic data rather than treating them as final
colours. A renderer may blend authored detail textures, procedural detail, or a
stylized palette from the same sample. `packTerrainMaterialWeights` provides a
stable order for vertex attributes and GPU tile formats.

## Planetary CDLOD (Continuous Distance-Dependent LOD)

The clipmap terrain scene also accepts a bounded `heightSource` and exposes
`setHeightSource(source)` on its returned handle. Consumers can rebuild a
worldgen bake, for example after changing seed or cell count, and replace the
GPU source without rebuilding the clipmap meshes.
The handle also exposes `setVisible(enabled)` so a consumer can temporarily hide
the clipmap while inspecting an alternate runtime surface. This is useful for
experiments such as CPU mesh simplification, but simplified geometry is not a
replacement for the clipmap's crack-free LOD lattice.

Generic Meshoptimizer helpers are available separately from
`triangular-engine/meshoptimizer`. That entry point is optional and does not
become part of the base terrain bundle; install the `meshoptimizer` peer only
when an application opts into those helpers.

For high-speed planetary bodies and large-scale terrains, `CdlodPlanetComponent`
provides GPU vertex geomorphing, roughness-based feature decimation, motion look-ahead,
and multithreaded Web Worker meshing.

```html
<cdlodPlanet
  [body]="body"
  [quality]="'balanced'"
  [cdlodMorphing]="true"
  [featureAdaptive]="true"
  [useWorkers]="true"
/>
```

CDLOD eliminates LOD popping by morphing odd grid vertices towards their coarser parent
locations on the GPU, avoiding geometry skirts and T-junction cracks across LOD boundaries.

Current design and implementation gates are tracked in
[`docs/runbook/004_multi_surface_terrain.md`](../../../docs/runbook/004_multi_surface_terrain.md) and
[`docs/runbook/019_cdlod_celestial_migration.md`](../../../docs/runbook/019_cdlod_celestial_migration.md).
