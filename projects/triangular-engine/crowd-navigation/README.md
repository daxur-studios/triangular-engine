# Crowd navigation

Worker-safe navigation grid for island crowds (Plan 086). This first phase, `grid-layers`, turns a heightfield into
Uint8 cost layers, a flag layer and a clearance field. Later phases add sectors, portals and flow fields on top of it.

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

## Island generator

`generateIslandHeightfield({ size, cellSize, seed, maxHeight, featureSize, waterLevel })` is a deterministic seeded
fractal value noise with a radial falloff: land in the middle, water at the border. It is for tests and demos.

## Performance

A full build (terrain, flags, composed cost, clearance) of 2,048 x 2,048 cells takes about 0.26 s in headless Chrome on
the development machine; a windowed edit takes about a millisecond. Measured by the spec, not a guarantee.
