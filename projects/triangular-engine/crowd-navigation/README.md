# Crowd navigation

Worker-safe navigation grid for island crowds (Plan 086). Phase `grid-layers` turns a heightfield into Uint8 cost
layers, a flag layer and a clearance field. Phase `sectors-portals` adds 64-cell sectors with portals per unit class and
an abstract path query on top (see [Sectors, portals and the abstract query](#sectors-portals-and-the-abstract-query)).
Phase `sector-fields` adds lazy per-sector flow fields and a crowd simulation (see
[Flow fields and the crowd](#flow-fields-and-the-crowd)).

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

## Flow fields and the crowd

`NavFlowCache` builds flow fields lazily on a `NavSectorGraph`, and `NavCrowd` moves agents along them.

```ts
import { NavCrowd, NavFlowCache } from 'triangular-engine/crowd-navigation';

const crowd = new NavCrowd(sectors, { capacity: 1000, seed: 7 });
const goal = crowd.addGoal(1800, 1500);
crowd.spawnRandom(1000, { x: 100, y: 100, width: 40, height: 40 }, goal); // seeded, passable cells only
crowd.step(); // or crowd.advance(frameSeconds): fixed steps, remainder carried
crowd.posX[i]; crowd.posY[i]; crowd.state[i]; // typed arrays in cells; NavAgentState
crowd.cache.stats; // builds, hits, evictions, totalBuildMs, lastBuildMs, maxBuildMs
crowd.cache.recentBuilds; // per-sector build times of the latest builds

// Without the crowd:
const cache = new NavFlowCache(sectors, { maxSectorFields: 512 });
const field = cache.field(1800, 1500, 'villager'); // one field per (goal cell, class)
cache.ensure(field, startX, startY); // builds the missing corridor sectors, goal end first
field.sample(x + 0.5, y + 0.5, out); // bilinear direction at a position in cells
```

- **Lazy, per sector.** `ensure(field, x, y)` runs `findAbstractPath` from the start cell and builds the sectors of
  the corridor that have no field yet, starting at the goal sector and walking back. Nothing outside the corridor is
  built. `maxBuilds` caps a call so a frame stays short; the next call continues.
- **Per-sector field.** A multi-source Dijkstra over the composed `cost` (8-neighbour, diagonals cost sqrt 2, no corner
  cutting, passability by clearance for the class). The goal sector is seeded at the goal cell. Every other sector is
  seeded from the **whole shared edge** of its downstream sector's field (each edge cell takes the cheapest
  `downstream cost + entered cost`), so agents spread along an open edge instead of funnelling to its single portal.
  Each sector stores a `Float32` cost-to-goal and an `Int8` direction pair per cell: the downhill gradient over the
  passable neighbours, quantised to -127..127. Blocked, unreached and goal cells have no direction.
- **Cache key and versions.** Fields are keyed by (goal cell, unit class) and stored per sector with the
  `NavSectorGraph.versions` entry they were built from. `sync()` (called by `ensure` and by every crowd step) drops
  fields whose sector was rebuilt, and fields that were seeded from a dropped one; they are rebuilt lazily on the next
  access. A global LRU (`maxSectorFields`, default 512, about 24 KB per 64 x 64 sector) evicts the least recently used
  sector fields across all goals; `touch(field)` marks a field used (the crowd does this every step).
- **Re-entry.** A sector is built once per field, from the downstream neighbour of the first corridor that needed it.
  When a corridor leaves a sector and re-enters it (a wall splits the sector and the opening is in the next one), the
  sector is rebuilt seeded from both neighbours.
- **Sampling.** `field.sample(x, y, out)` blends the four surrounding cell-centre directions bilinearly; cells without a
  direction (blocked, unreached, unbuilt) are left out and the weights renormalised, so the result never leans into a
  wall. Positions are continuous cell coordinates (cell `i` covers `[i, i + 1)`).
- **Crowd step.** Per fixed step: `sync()`; agents without a direction ask `ensure` for their corridor (up to
  `maxBuildsPerStep`); a uniform spatial hash is rebuilt with a counting sort into typed arrays; each moving agent
  takes the bilinear flow direction plus a soft separation push from agents closer than `separationRadius` (capped at
  `separationStrength` of top speed, so the flow always wins), changes velocity within `maxAccel`, and moves one axis at
  a time. A move into a cell the class cannot stand in is cancelled on that axis, so agents slide along walls and never
  end inside a blocked cell. Agents within `arrivalRadius` of the goal centre are marked arrived, frozen and left out of
  the hash. States: `NavAgentState.Moving`, `Arrived`, `Waiting` (no field yet) and `Unreachable` (retried when sector
  versions change).
- **Determinism.** Spawning uses a seeded PRNG (`seed`); the step uses no `Math.random`. The same seed and step sequence
  give identical positions (the spec compares two runs).
- **Limits.** There is one field per sector per goal, so an agent whose cell cannot reach the sector's downstream
  neighbour (a walled-in pocket) is marked unreachable. Arrival uses the straight distance (for a goal set, the nearest
  source cell within the arrival radius), so a goal right behind a thin wall can be reached from the other side.
  Territory cost is not applied. There is no worker wrapper yet; the simulation is plain typed-array code and runs
  wherever it is called.

Measured by the specs in headless Chrome on the development machine: one 64 x 64 sector field builds in about 1.2 to
1.6 ms, and 1,000 villagers cross the generated 512 x 512 island (a wall with a 9-cell opening between them, 11 sector
fields built) in about 1,900 steps of 0.05 s with a mean step of 0.7 ms. These are not guarantees.

## Goal sets (several sources)

A goal can be a set of cells. `new NavGoalSet(graph)` holds the sources (`add`, `addCell`, `remove`, `removeCell`, `has`,
`size`, `forEachCell`); `crowd.addGoalSet(set)` registers it as a goal id and `cache.fieldForGoals(set, unitClass)` gives
the field. Every cell leads to its nearest source by path cost: the abstract search ends at the cheapest reachable source
(`findAbstractPathToAny`), each sector field is seeded with every source inside it, and a newly built sector of a
multi-source field is also seeded from built neighbours that do not depend on it. Agents arrive at the nearest source
cell within `arrivalRadius`; `crowd.arrivedCell[i]` says which one (single goals report their one cell).

Adding or removing a source bumps only the stamps of the sectors that can change: the 3 x 3 ring around the source's
sector when adding, the source's own sector when removing. The cached sector fields of those sectors, and the fields
seeded from them, rebuild lazily on the next `ensure`; the rest keep their data. Limits: fields elsewhere stay valid but
can be suboptimal after an add (an agent may head for a source that is no longer the nearest); `touchAll()` forces an
exact refresh. Removing a source also invalidates fields that were seeded from neighbours of its sector.

`crowd.retargetAgent(i, goalId)` moves one agent to another goal.

## Roads

A road's cost factor is applied when the cost layer is composed: `cost = round(terrain * factor)` (clamped 1..254), the
factor going from 1 (no road) to `roadMinFactor` for a full road; a road `value` below 255 gives a weaker preference.
`grid.setRoadMinFactor(f)` (0.05 to 1, default 0.4) retunes it; it recomposes the whole grid, so rebuild the graph after
it (`NavWorld.setRoadPreference` does both). The preference is global because the composed cost layer is shared by all
classes and goals. The sector search heuristic follows the factor, so roads never break A* admissibility.

## One edit API: `NavWorld`

`NavWorld.fromHeightfield(heightfield)` (or `new NavWorld(graph)`) wraps the grid and graph. `placeBuilding`,
`removeBuilding`, `placeGate`, `setGateOpen`, `paintRoad`, `paintRoadLine`, `editTerrain(rect, fn)`, `updateTerrain` and
`setRoadPreference` update the grid in a local window, call `rebuildSectors(dirty)` and return a `NavEditResult`
(`dirty`, the rebuilt `sectors`, `gridMs`, `sectorMs`). Untouched sectors keep their `versions`; flow fields repair
lazily through the versions (see above); `world.stats` totals edits and rebuilt sectors.

## Blocked cells and arrival spreading

When the graph changes, `NavCrowd.step` moves every agent standing in a cell its class can no longer stand in to the
nearest passable cell (a bounded square-ring search, `displaceRadius`, default 32; ties resolve in scan order;
velocity is zeroed). The count is `stats.displaced`; agents with no passable cell nearby are counted in `stats.stranded`
and left alone. `crowd.displaceBlocked()` runs the pass on demand.

Arrived agents do not stack on the goal cell: they stay in the spatial hash with zero flow and settle only through the
separation force, and a moving agent that touches an arrived agent of its own goal set joins it (arrives by contact).
The blob therefore grows from the goal toward the approach side. This is deliberately simple; ring slots or a
formation system can replace it later.

## Island generator

`generateIslandHeightfield({ size, cellSize, seed, maxHeight, featureSize, waterLevel })` is a deterministic seeded
fractal value noise with a radial falloff: land in the middle, water at the border. It is for tests and demos.

## Performance

A full build (terrain, flags, composed cost, clearance) of 2,048 x 2,048 cells takes about 0.26 s in headless Chrome on
the development machine; a windowed edit takes about a millisecond. Measured by the spec, not a guarantee.
