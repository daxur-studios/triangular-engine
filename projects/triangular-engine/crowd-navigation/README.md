# Crowd navigation

Worker-safe navigation grid for island crowds (Plan 086). Phase `grid-layers` turns a heightfield into Uint8 cost
layers, a flag layer and a clearance field. Phase `sectors-portals` adds 64-cell sectors with portals per unit class and
an abstract path query on top (see [Sectors, portals and the abstract query](#sectors-portals-and-the-abstract-query)).
Later phases add flow fields.

```ts
import {
  NavGrid,
  generateIslandHeightfield,
  NAV_CLEARANCE_THRESHOLDS,
} from 'triangular-engine/crowd-navigation';

const field = generateIslandHeightfield({ size: 2048, cellSize: 1, seed: 7 });
const grid = NavGrid.fromHeightfield(field);

grid.stampStructure({ x: 100, y: 100, width: 12, height: 8 }); // a building
grid.paintRoadLine(20, 20, 200, 90, 1); // a road, brush radius 1 cell
grid.isPassable(50, 50, 'catapult'); // clearance >= 3 and not blocked
```

## Worker safety

The entry has no Angular or three.js imports. State lives in typed arrays (`grid.cost`, `grid.clearance`, ...), so a
grid can be built and edited in a web worker and its layers transferred. Drawing helpers belong to the consumer; the
demo page `/crowd-navigation-grid` draws each layer as a data texture on a terrain mesh.

## Grid and layers

Grid size is a parameter: `width x height` cells of `cellSize` metres (default 1 m). The demo island is 2,048 x 2,048;
4,096 x 4,096 is a benchmark size. Layers are row-major (`index = y * width + x`), one byte per cell.

| Layer       | Meaning                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `terrain`   | Slope cost. Flat = 16, rising with the square of the slope to 254; water and too steep = 255. |
| `structure` | 0 free, 255 solid (buildings, walls, closed gates). Stamp and clear footprints.               |
| `road`      | 0 none, 255 full road. Cost factor falls linearly from 1 to `roadMinFactor` (default 0.4).    |
| `territory` | Owner faction id, 0 = unowned. A per-faction cost applied at query time (see below).          |
| `flags`     | Bits, below.                                                                                  |
| `cost`      | Composed traversal cost, 255 = impassable.                                                    |
| `clearance` | Cells to the nearest blocked cell, floored, saturating at `maxClearance` (default 16).        |

Slope is `hypot(dh/dx, dh/dy)` (rise over run) from central differences with clamped borders. A cell is steep when it
is at or above `maxWalkableSlope` (default 0.7, about 35 degrees). Terrain cost is
`16 + round(238 * (slope / maxWalkableSlope)^2)`.

Territory is one Uint8 owner layer, not a cost layer, so one composed `cost` serves every faction.
`grid.traversalCost(index, faction)` returns `cost`, times `hostileTerritoryFactor` (default 1.5, clamped to 254) when
the cell is owned by another faction. Faction 0 ignores territory.

### Flag bits (`NavFlag`)

| Bit | Value | Name        | Set when                                                                |
| --- | ----- | ----------- | ----------------------------------------------------------------------- |
| 0   | 1     | `BLOCKED`   | `WATER`, `STEEP` or `STRUCTURE` (derived)                                |
| 1   | 2     | `WATER`     | height at or below `waterLevel`, or the water mask is set               |
| 2   | 4     | `STEEP`     | slope at or above `maxWalkableSlope`                                    |
| 3   | 8     | `STRUCTURE` | structure layer non-zero                                                |
| 4   | 16    | `ROAD`      | road layer non-zero                                                     |
| 5   | 32    | `GATE`      | the cell belongs to a gate (open or closed); kept until `clearStructure` |
| 6   | 64    | `TERRITORY` | territory layer non-zero                                                |
| 7   | 128   | reserved    |                                                                         |

### Composed cost

```
cost = 255                                                     if BLOCKED
cost = clamp(round(terrain * roadFactor(road)), 1, 254)        otherwise
roadFactor(r) = 1 - (r / 255) * (1 - roadMinFactor)
```

Flat ground costs 16; a full road on it costs 6 (16 x 0.4 rounded). A later flow-field phase reads `cost` (and
`traversalCost` for a faction).

## Clearance and unit classes

`clearance` is the exact Euclidean distance (cell centres) to the nearest blocked cell, floored and capped. It is
computed with a column sweep and a Felzenszwalb row pass, O(cells). Cells outside the grid count as free. Unit classes
are thresholds on it, not separate grids:

| Class      | `NAV_CLEARANCE_THRESHOLDS` |
| ---------- | -------------------------- |
| `villager` | 1                          |
| `catapult` | 3                          |
| `creature` | 8                          |

`grid.isPassable(x, y, unitClass)` is true when the cell is not `BLOCKED` and its clearance reaches the threshold. A
2-cell-wide gap has clearance 1: villagers pass, catapults and creatures do not.

## Edits

`stampStructure`, `clearStructure`, `stampGate`, `setGateOpen`, `paintRoad`, `paintRoadLine`, `paintTerritory` and
`updateTerrain` (after changing `heights`) take a rectangle or a footprint (rectangle plus an optional mask). Each
refreshes flags and cost for the touched cells and, when blocking changes, recomputes clearance only in the touched
rectangle grown by `maxClearance` and returns that rectangle (the dirty region for later sector rebuilds). Because
clearance is capped, a windowed recompute equals a full recompute; the specs check this.

## Sectors, portals and the abstract query

`NavSectorGraph` cuts a grid into square sectors (`sectorSize`, default 64; sectors are indexed row-major and edge
sectors may be smaller) and builds, for each unit class, the portals between neighbouring sectors and the cheapest
costs between the portals of one sector. An abstract query then runs A* over this small graph instead of the cells.

```ts
import { NavSectorGraph } from 'triangular-engine/crowd-navigation';

const sectors = NavSectorGraph.build(grid); // or { sectorSize: 32 }
const route = sectors.findAbstractPath(120, 300, 1800, 1500, 'villager');
if (route.found) route.sectors; // ordered corridor of sector indices, neighbours in a row
route.portals; // the portals crossed

const dirty = grid.setGateOpen(gate, true); // any NavGrid edit returns the dirty rectangle
sectors.rebuildSectors(dirty); // rebuilds touched sectors only; returns their indices
sectors.versions[s]; // per-sector counter, bumped on rebuild
```

- **Portal:** along each shared sector edge, a maximal run of cell pairs where both cells are passable for the class
  (not `BLOCKED` and clearance at or above the threshold) is one portal, represented by its centre pair. A 2-cell gap
  gives a villager portal and no catapult or creature portal; a wall gives none. Each portal is two nodes (one cell in
  each sector) joined by a crossing edge costing the entered cell.
- **Intra-sector links:** nodes that can reach each other inside a sector are joined by the cheapest path over the
  composed `cost` layer, searched inside the sector only (8-neighbour, diagonals cost sqrt 2 and need both orthogonal
  cells passable, no corner cutting). Regions are flood-filled first so the search stops once every reachable node is
  settled.
- **Query:** `findAbstractPath(startX, startY, goalX, goalY, unitClass)` connects the start and goal to the portals of
  their own sectors for that query only, then runs A* with an octile heuristic scaled by the cheapest possible cell
  cost. It returns `{ found, cost, sectors, portals }` (plus `failure`: `'start-blocked'`, `'goal-blocked'` or
  `'disconnected'` when not found). Connected components of the portal graph prove most unreachable goals without
  searching. `sectors` removes consecutive duplicates only; a path that leaves and later re-enters a sector lists it
  twice. The cost is the base composed cost (no territory or faction cost yet) and is approximate: it assumes paths
  stay inside each sector between portals.
- **Rebuild:** `rebuildSectors(rect)` takes the rectangle an edit returned (it already includes the clearance halo),
  recomputes portals on the touched sectors' four edges and the links of the touched sectors, and also rebuilds a
  neighbour only when the portals on its shared edge changed. The result equals a full build; the specs check this over
  random edits. `versions` is 1 for every sector after the build and increases by one per rebuild.
- **Inspection:** `getPortals`, `getEdgePortals`, `getLinks`, `portalCount`, `sectorOf`, `sectorRect` and
  `sectorsTouching` expose the data for overlays and tests. The demo draws sector borders, portals and the corridor.

Measured by the spec in headless Chrome on the development machine, on the 2,048 x 2,048 generated island (1,024
sectors, about 1,160 portals per class): the build takes about 4 s (one-off; run it in a worker), an abstract query
about 2 ms, and a rebuild after a windowed edit tens of milliseconds. These are not guarantees.

## Island generator

`generateIslandHeightfield({ size, cellSize, seed, maxHeight, featureSize, waterLevel })` is a deterministic seeded
fractal value noise with a radial falloff: land in the middle, water at the border. It is for tests and demos.

## Performance

A full build (terrain, flags, composed cost, clearance) of 2,048 x 2,048 cells takes about 0.26 s in headless Chrome on
the development machine; a windowed edit takes about a millisecond. Measured by the spec, not a guarantee.
