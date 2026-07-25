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

The defaults provide camera-following LOD, bounded per-frame generation, mixed
LOD seam skirts, and a standard Three.js terrain material. Override
`lodPosition` to follow a character or vehicle instead of the camera. The
`maxLod`, `refinementDistance`, `resolution`, `generationBudget`, `skirtDepth`,
`getKey`, `getLevel`, `createMaterial`, and `createColors` inputs customize the
policy and rendering without replacing the streaming loop.

Framework-free consumers can continue composing
`selectAdaptiveTerrainPatches`, `TerrainGenerationQueue`, and
`generateTerrainPatchMesh` directly.

Current design and implementation gates are tracked in
[`docs/runbook/004_multi_surface_terrain.md`](../../../docs/runbook/004_multi_surface_terrain.md).
