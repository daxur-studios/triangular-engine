# `triangular-engine/worldgen` — Voronoi cell-graph planets

Structure-first planet generation: a spherical Voronoi cell graph where continents, mountain
ridges, biomes, and rivers are per-cell/per-edge data, not noise. Full design history and
rationale lives in [`docs/runbook/022_v4_voronoi_cell_planets.md`](../../../docs/runbook/022_v4_voronoi_cell_planets.md)
(a decision log — read this file instead if you just need to know what data is available and
how to get at it).

Two entry points:

- **`triangular-engine/worldgen`** (`core/`) — pure, framework-free generation + query functions.
  No Three.js, no Angular. Deterministic: same params → same planet.
- **`triangular-engine/worldgen/render`** (`render/`) — the Angular/Three.js rendering layer,
  currently one component: `<planetView>`.

## Generation pipeline (three calls, each layered on the last)

```ts
import {
  buildPlanetGraphCore,
  buildPlanetTectonics,
  buildPlanetEcology,
} from 'triangular-engine/worldgen';

const graph = buildPlanetGraphCore({ cellCount: 1500, seed: 42, relaxationIterations: 2, jitter: 0.15 });
const tectonics = buildPlanetTectonics(graph, { plateCount: 10 });
const ecology = buildPlanetEcology(graph, tectonics);
```

Every value below is **per-cell**, indexed by `cell.id` (`0..graph.cells.length-1`), unless noted
otherwise. Everything is unitless/normalized — there is no metres scale until a consumer picks
one (see "Radius is app-owned" below).

### `graph = buildPlanetGraphCore(...)` → `IPlanetGraphCore`

```ts
{
  seed: number;
  cells: {
    id: number;
    center: IVec3;        // unit-sphere direction
    corners: IVec3[];     // cell polygon corners, unit-sphere, cyclic order
    neighbors: number[];  // adjacent cell ids; neighbors[k] is across corners[k]->corners[k+1]
  }[];
}
```

The graph alone has no elevation/climate/biome — just topology. Everything else is layered on
top of it by id.

### `tectonics = buildPlanetTectonics(graph, { plateCount, ... })` → `IPlanetTectonics`

```ts
{
  seed: number;
  plates: IPlate[];
  plateIdByCell: number[];        // plateIdByCell[cellId] -> plate id
  boundaries: IPlateBoundaryEdge[]; // convergent/divergent/transform classification per edge
  elevation: number[];            // elevation[cellId], arbitrary unitless scale (NOT metres)
  isLand: boolean[];               // isLand[cellId]
  seaLevelElevation: number;       // the elevation threshold used to split land/water
  ridgeCellIds: number[];          // cells on a continent-continent convergent boundary (mountain lines)
}
```

**Elevation is not in metres or any fixed range** — its scale depends on `plateCount`/boundary
params. Always normalize against land relief: `(elevation[i] - seaLevelElevation) / (maxLandElevation - seaLevelElevation)`.

### `ecology = buildPlanetEcology(graph, tectonics, ...)` → `IPlanetEcology`

The climate/biome/river/ridge/water pass. This is what a cloud/weather system and terrain overlay want.

```ts
{
  // climate — direct answer to "where should it be humid/dry/hot/cold"
  temperature: number[];  // ~1 (hot equator) .. ~-1 (frozen poles), latitude minus elevation lapse
  moisture: number[];     // 1 (ocean) decaying inland via BFS-from-water, minus a latitude arid-belt term

  // biomes
  biome: Biome[];         // 'tundra'|'taiga'|'desert'|'savanna'|'meadow'|'jungle'|'rainforest'|
                           // 'glacier'|'ice_cap'|'alpine'|'canyon'|'mesa'|'lake'|'ocean'|... — see biomes.ts
  slope: number[];        // largest elevation delta to any neighbor

  // water
  waterBodyKind: (('ocean' | 'lake') | null)[];  // null for land cells

  // rivers (NOT per-cell — per-path, walking Voronoi corners)
  riverPaths: IVec3[][];      // one array of corner points per river, source -> sea/lake
  riverFlow: number[][];      // parallel to riverPaths: accumulated discharge per point (widens downstream)
  lakeCorners: IVec3[];       // land-locked local-minima corners (lake outlets)

  // coastlines (also corner-point polylines, not per-cell)
  coastlines: IVec3[][];      // closed polylines along every land/water edge

  // mountain ridges
  ridgePaths: IVec3[][];       // detailed open paths anchored at adjacent mountain-cell centres
  ridgePathStrength: number[]; // normalized strength matching ridgePaths
  ridgePeaks: IVec3[];         // isolated/local summit directions
  ridgePeakCellIds: number[];  // stable cell ids matching ridgePeaks
}
```

Ridge paths include a deterministic local Voronoi-style detail route between their exact cell-centre
anchors. Tune it through `buildPlanetEcology(..., { ridges: { ridgeDetail: { ... } } })`; the shared
unit-sphere points are consumed by both the 2D map and 3D globe overlays. Ridge links are selected
from elevation crest relief plus convergent plate strength, and ecology removes links that touch a
river corridor. Pass `ridges: { riverClearance: 0.16 }` to tune that river margin.

`temperature`/`moisture`/`biome`/`slope` are the fields relevant to **cloud/weather placement**
(coverage, storm intensity, rain-shadow) — everything else here is terrain/hydrology.

## Querying a direction, not a cell id

If you have a world-space point (e.g. a cloud puff's position projected onto the planet, or a
vessel's ground track) rather than a cell id, resolve it first:

```ts
import { findCellAt, findCellNear, sampleElevation, sampleElevationNear } from 'triangular-engine/worldgen';

const cell = findCellAt(graph, direction);       // brute-force O(cellCount) — fine for occasional/one-off queries
const cell2 = findCellNear(graph, direction, hintCellId); // O(1)-ish walk from a known-nearby cell — use this for dense/per-frame/per-vertex queries, seeding hintCellId from the previous query
```

`cell.id` then indexes straight into `tectonics.elevation`, `ecology.moisture`,
`ecology.temperature`, `ecology.biome`, etc. There is no `moistureAt(direction)` helper (yet) —
resolve the cell, then index. `findCellNear` needs a starting hint; for a moving query point
(camera, vessel, drifting cloud), reuse the previous frame's resolved cell id as the next
frame's hint — that is what makes it O(1) instead of O(cellCount) each call.

For actual surface height (not the raw per-cell scalar), use `sampleElevation`/`sampleElevationNear`
— they barycentric-blend the containing cell + its 2 nearest corners rather than returning the
flat per-cell value, so a displaced mesh doesn't facet.

For detailed generated geology, pass the result of `computeFeatures()` as `features` in
`createPlanetSurfaceSampler()`'s optional params. Volcano instances then reuse the authored
`sampleVolcano()` shape from `geological-shapes.ts` in a bounded tangent frame inside their
owning irregular cell. The sampler keeps this relief separate from the raw per-cell elevation
array, so the same surface query can feed a planar bake and a spherical mesh.
`buildFeatureElevation()` remains available for cell-resolution consumers.

## Radius is app-owned

Nothing in `worldgen/core` knows about metres. The convention every consumer follows (lab page,
`PlanetViewComponent`) is:

```ts
radius = 1 + elevation * elevationScale   // unit sphere, elevation pre-normalized, scale ~0.01-0.05
worldPosition = direction.multiplyScalar(radius * planetRadiusM)
```

Pick your own `planetRadiusM` at the call site (see runbook 024 — `worldgen/core` stays
dimensionless on purpose).

## Rendering: `<planetView>` (`triangular-engine/worldgen/render`)

Declarative wrapper that runs the full pipeline above and renders a chunked, 2-level-LOD mesh +
ocean shell + optional river/coastline overlays. See
[`docs/runbook/022_v4_voronoi_cell_planets.md`](../../../docs/runbook/022_v4_voronoi_cell_planets.md)'s
Layer 2 for *why* it's chunked instead of one mesh.

```html
<planetView
  [scale]="55"
  [cellCount]="700" [seed]="7" [relaxationIterations]="2" [jitter]="0.15" [plateCount]="10"
  [elevationScale]="0.02" [renderMode]="'elevation'"
  [showOcean]="true" [showRivers]="false" [showRidges]="false" [showCoastlines]="false"
  #planet
/>
```

| Input | Default | Notes |
|---|---|---|
| `cellCount` | 1500 | regenerate-triggering |
| `seed` | 42 | regenerate-triggering |
| `relaxationIterations` | 2 | regenerate-triggering |
| `jitter` | 0.15 | real 0..1 fraction (not a 0-100 slider value) — regenerate-triggering |
| `plateCount` | 10 | regenerate-triggering |
| `elevationScale` | 0.02 | cheap reposition, no resample |
| `renderMode` | `'elevation'` | `'elevation'\|'plates'\|'biome'\|'temperature'\|'moisture'\|'land'` |
| `showOcean`/`showRivers`/`showRidges`/`showCoastlines` | `true`/`false`/`false`/`false` | visibility toggles only |
| `usePinning` | `true` | silhouette-preserving LOD1 (peaks/coastline/islands never flatten away) |
| `lodNearDistance` | 2 | camera distance (planet-radii) below which a chunk shows LOD0 |
| `frozen` | `false` | pauses the per-frame LOD/cull pass |
| `useSurfaceUp` | `false` | writes `upVector` from camera position each tick (pairs with a surface-relative orbit camera) |

Public state, for a consumer that wants cell-level data (gameplay, weather, colliders) alongside
the mesh — read via the template ref (`#planet` above) or a `viewChild()`:

```ts
planet.graph()      // IPlanetGraphCore | null
planet.tectonics()  // IPlanetTectonics | null
planet.ecology()    // IPlanetEcology | null  <- temperature/moisture/biome live here
planet.buildMs()     // number | null, last regenerate() wall time
planet.upVector()    // Vector3Tuple, only live when useSurfaceUp is true
planet.raycastFocusResolver  // RaycastFocusResolver, wire into <raycastOrbitControls [raycastFocusResolver]>
```

These signals go non-null only after the first regenerate effect runs (same tick the component
initializes) — guard with `if (!ecology) return;` rather than assuming synchronous availability
from the constructor.

`color-ramps.ts` (same entry point) exports the six color functions used internally
(`plateColor`, `elevationColor`, `temperatureColor`, `moistureColor`, `biomeColor`,
`BIOME_COLORS`) in case a consumer wants matching colors for its own UI (a legend, a 2D map).

## Planar (2.5D) picking

An undisplaced clipmap lattice is not the rendered surface, so the 2.5D map picks against the
baked height field instead. `planet-map-picking.ts` (same entry point) provides:

- `samplePlanarHeight(field, x, z)` — bilinear sample matching the height texture's
  `LinearFilter`/`ClampToEdge` lookup; `0` outside the map footprint.
- `intersectPlanarHeightField(field, ray)` — clips the ray to the field AABB, ray-marches the
  sampled surface with bisection, and returns the world-space hit.
- `mapXZToPlanetDirection()` / `mapPlanetDirectionToMapXZ()` — the bake's planar ↔ planet
  direction round trip through an `IMapProjection`.

`IPlanarHeightField` wraps a `buildPlanetSurfaceBake()` result (`width`, `height`,
`elevations`, `bounds`, `minY`, `maxY`). Resolve the hit's world XZ to a cell with
`findCellAt(graph, direction)`. The intersection uses the fine bake only, so at distances where
the clipmap morphs to a coarser level the visible hit can differ by that level's interpolation
error.

## Fixed-resolution globe geometry

`globe-geometry.ts` (same entry point) turns the canonical surface sampler into a plain,
fixed-resolution displaced sphere — no LOD, streaming, simplification or caching (those belong
to runbook 031):

- `buildPlanetGlobeGeometry({ sampler, cellIdAt?, radius?, heightScale?, longitudeSegments?, latitudeRings? })`
  — samples each latitude/longitude grid vertex direction once and positions it at
  `direction * (radius + elevation * heightScale)`. Returns typed arrays (`positions`,
  `normals`, `directions`, `elevations`, `landMask`, `cellIds`, `indices`) plus metadata.
  `directions`/`elevations` can be re-displaced without resampling.
- `writePlanetGlobePositions(out, directions, elevations, radius, heightScale)` and
  `writePlanetGlobeNormals(out, positions, indices)` — the displacement/normalization helpers
  behind a display height-exaggeration control.
- `cellIdAt` records discrete cell identity per vertex (`findCellAt(graph, direction).id`);
  colour modes stay independent of mesh topology.

The grid starts at longitude `-PI`, so the antimeridian is one shared column (no seam crack);
each pole is a single fan vertex (no degenerate triangles); winding is outward.

## What's NOT in the render layer

Ported deliberately narrower than `/cell-planet-lab`'s 1620-line debug harness — see the plan
this component was built from (`docs/runbook/022...` M4 milestones) for what stayed lab-only:

- No 2D map projection view.
- No chunk-boundary/pin-highlight debug coloring.
- No collider-patch (M4d) overlay — call `buildColliderPatch()` from `triangular-engine/worldgen`
  directly against `planet.graph()`/`planet.tectonics()` if you need one.
- No stat strip / generation-time UI (read `planet.buildMs()` yourself if you want one).

`/cell-planet-lab` itself has not been migrated onto `<planetView>` — it still has its own inline
rendering code (its color functions now import from this package, nothing else changed).
