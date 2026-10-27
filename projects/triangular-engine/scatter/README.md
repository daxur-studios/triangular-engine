# triangular-engine/scatter

Deterministic, streamed environment scattering for terrain vegetation, rocks,
billboards, and other repeated scene objects.

Import scatter APIs from `triangular-engine/scatter`; do not reach into the
package's internal folders.

Scatter is renderer- and physics-optional. Consumers provide layer
definitions, suitability rules, and assets; the library keeps placement
deterministic as cells stream and LODs change.

## Camera-linked streaming

Provide `ScatterStreamingService` beside the scene's `EngineService`. It follows
the active camera in world space by default and exposes convenience methods for
fixed-level cell selection and LOD bucketing:

```ts
providers: [...EngineService.provide(), ScatterStreamingService];
```

```ts
const streaming = inject(ScatterStreamingService);

streaming.viewpointWorldM$.subscribe(() => {
  const cells = streaming.selectFixedLevelCells(domain, cellOptions);
  const lods = streaming.bucketInstancesByLod(lodOptions);
});
```

Camera movement is coalesced to one-metre steps by default. Use
`setMovementThresholdM()` to tune it. Render streaming can follow a player or
editor viewpoint instead:

```ts
streaming.setViewpointOverride(() => player.worldPositionM);
// Return to the active camera:
streaming.setViewpointOverride(undefined);
```

Physics residency remains independently player/vehicle-driven and should not
share the render-streaming viewpoint.

## Planet scatter

On a cell planet, use the planet shell lattice instead of terrain quadtree
cells. Its cells are metres, the same everywhere on the sphere, and the ground
comes from a height callback (typically the planet's sampler in a worker):

```ts
import {
  computeScatterPixelFadeBand,
  computeScatterWindowRadiusM,
  evaluateScatterDensityField,
  scatterPlanetLattice,
  scatterPlanetLatticeTransferables,
  type IScatterDensityFieldDefinition,
  type IScatterPlanetLayerDefinition,
} from 'triangular-engine/scatter';

const forest: IScatterDensityFieldDefinition = {
  octaves: [
    { cellM: 6000, weight: 0.55 },
    { cellM: 1500, weight: 0.3 },
    { cellM: 120, weight: 0.15 },
  ],
  edge: [0.45, 0.62],
  heightBandM: { rise: [5, 40], fall: [1800, 2600] }, // coast to tree line
};

const trees: IScatterPlanetLayerDefinition = {
  id: 'trees',
  generatorVersion: 1,
  seed: 1, // rocks would use another seed, cell size, size range and field
  cellSizeM: 12, // at most one tree per 12 m cell
  sizeRange: [0.75, 1.25],
  density: ([x, y, z], heightM) => evaluateScatterDensityField(forest, x, y, z, heightM),
};

// The band from the crown size; the window from the band and the recentre step.
const band = computeScatterPixelFadeBand(12);
const windowRadiusM = computeScatterWindowRadiusM(band.endM, 400);

// In the worker:
const result = scatterPlanetLattice(trees, {
  centre: cameraDirection, // unit, body-fixed
  radiusM: planetRadiusM,
  windowRadiusM,
  maxCount: 300_000, // keeps the nearest, so a short buffer loses the far edge
  heightAt: (direction) => groundHeightOrNull(direction),
});
postMessage(result, scatterPlanetLatticeTransferables(result));
```

Instance `i` stands at `originM + offsetsM[3i..3i+2]` (body-fixed metres),
turned `yaw01[i]` of a full turn about the radial up and scaled by
`scale[i]`. The same place always holds the same instance, whatever the window
centre or size; `composeScatterPlanetInstanceId(trees, worldSeed, ...cell)`
gives its stable id for removal overlays and colliders.

The far form draws the same field: `scatterDensityFieldNode(forest, p, heightM)`
from [`triangular-engine/scatter/tsl`](tsl/README.md) is the TSL twin of
`evaluateScatterDensityField`. Derive its canopy cover from the scatter with
`measureScatterPlanetCover` on a solid stand (density 1): jittered crowns
overlap, so 12 m crowns on a 12 m lattice cover about 0.65, not the 0.79 of the
summed discs.

Current API decisions and implementation status are tracked in
`docs/runbook/005_scatter_sublibrary.md`.
