---
type: EngineeringRecord
title: "Island crowd navigation"
description: "Dated decisions, findings and evidence for Island crowd navigation."
timestamp: 2026-11-07T00:00:00Z
tags: [engineering-records, navigation, crowds, webgpu]
record_id: er-086
scope_history_schema: 1
plans:
  - /docs/plans/086_island-crowd-navigation.md
performance: []
---

# Engineering Record 086: Island crowd navigation

Plan: [PLAN-086](/docs/plans/086_island-crowd-navigation.md).

## 2026-11-07 — Starting

**Goal.** Sector flow-field navigation, crowd movement and rendering for thousands of villagers, platoons and
creatures on an island, in the style of Black & White 2.

**Why fresh.** The existing `triangular-engine/navigation` entry
([ER 012](/docs/engineering-records/012_navigation_sublibrary.md)) has a grid A*, a shared-goal field, a region
graph, a route cache and avoidance experiments. It handles two-way traffic through tight spots poorly and is not
designed for thousands of agents or frequent building edits. It stays as a comparison baseline. Keep from it: the
coordinate contract, the request-queue idea, the step-driven scenario harness pattern and the benchmark shape.
Replace: per-agent grid A* (kept only inside a sector), the goal field, the velocity-obstacle sampler and the
route cache.

**Why not the cell planet.** Cell-planet cells are far too coarse for villagers. The island is a normal
heightfield with a fine grid.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/086_island-crowd-navigation.md).

**Checks.** None yet. Functional, performance and human visual evidence will be recorded separately.

## History

### 2026-11-07 — Design direction (agent proposal, not developer approval)

Recommended architecture: a fine cost grid, sectors with an abstract portal graph (HPA*-style), and lazy flow
fields per (goal, unit class) built only along the corridor's sectors, as in the Supreme Commander 2 "flow field
tiles" approach. Cost grows with distinct destinations, not agents.

Rejected alternatives:

- A* per agent: cost grows with agent count; a gate change would trigger thousands of replans.
- All-pairs next-hop tables: O(n²) memory and invalidated by every edit.
- Navmesh with funnel (Recast style): good for individuals, but crowds still need per-agent queries, and soft
  costs such as roads fit badly. Reconsider later for creatures only.
- Contraction hierarchies: static graphs only.

Representation:

- About 1 m cells; Uint8 layers for terrain/slope, structure, road multiplier, per-faction territory, plus flags.
- A clearance field (distance to the nearest blocked cell). Unit classes are thresholds, not separate grids:
  villager ≥ 1, catapult ≥ 3, creature ≥ 8 (initial values).
- 64×64-cell sectors with edge portals per clearance class.

Goals:

- Multi-source goal fields (one Dijkstra seeded from every tree, storehouse or free house) answer "nearest X" for
  every gatherer at once.
- Rare unique trips use the abstract path plus a small in-sector A*.

Edits: write the cells, rerun clearance in a window grown by the largest clearance, rebuild dirty sectors' portals
and their neighbours', bump sector versions; cached fields rebuild a stale sector lazily when an agent first
samples it. Gates are portal edges with an open/closed flag. Roads change cost only.

Movement: bilinear field sampling plus soft separation from a spatial hash; movement LOD (full steering near the
camera, lower tick rate further away, off-screen agents advanced along portal paths). Tight two-way gaps: lane
bias first, then density feedback into integration costs (Continuum Crowds style), then gate and bridge queues.

Platoons: a virtual anchor follows one string-pulled path; soldiers steer to slots; the anchor moves at the
slowest member's speed; the formation deforms into a column at chokepoints using clearance look-ahead; slots are
reassigned on turns; villagers yield to platoons through asymmetric separation weights.

Combat: targeting per platoon first; engagement steering with surround slots; a coarse per-faction threat map
updated a few times per second (never fed into fine fields per tick); flee fields built by inverting a goal field
(Brogue's Dijkstra-map trick); siege classes see breakable walls and closed gates as high finite cost; line of
sight is a coarse heightfield march.

Rendering (WebGPU, TSL):

- The simulation stays on the CPU in a worker; GPU readback would stall gameplay logic. The GPU interpolates
  between ticks from a storage buffer of previous and current positions and a tick-alpha uniform.
- Animated crowds need GPU animation (baked animation textures or procedural TSL limbs) rather than per-character
  CPU skinning.
- Far crowds as dots: compare a TSL terrain-material layer against instanced points (plan item I1).
- Shadows: blob shadows for the crowd, real shadows only in the near LOD.
- Picking uses a CPU ray against the spatial hash.

### 2026-11-07 — Context: capsule humans and shader map layers (read-only survey)

Capsule humans (`triangular-engine/procedural`, `CapsuleCharacterActor` in
`procedural/characters/capsule/capsule-character-actor.ts`; rig math in `triangular-engine/characters`):

- About a dozen `Mesh` objects per actor: a capsule body, four rubber-hose limb tubes (18 × 12 segments), hands,
  boots, face rig, hair and gear. Each body gets its own material.
- No skeleton or skinning. `update(dt)` samples locomotion into quadratic Bézier control points per limb and
  rewrites every tube vertex and normal in JS each frame.
- The body material is a `MeshStandardMaterial` patched with GLSL through `onBeforeCompile`, not TSL (plan I3).
- No instancing path. The sandbox (Plan 079) tops out at 48 actors; no measured frame times yet.
- Consequence: full actors are a near tier only. Thousands need an instanced variant; Bézier limbs suit a vertex
  stage, which keeps the procedural look without baked animation textures (plan I2).

Shader map layers (`triangular-engine/planet-material`, `PlanetSurfaceMaterial.addSurfaceLayer`):

- `flatFeatureLayer` draws roads, runways and taxiways from two `DataTexture`s: a feature table and a page table
  with up to 8 features per page, each an SDF in metres. This page-binned pattern is the closest model for a crowd
  layer.
- Trees, tree shadows and buildings live in the demo spike `/planet-surface-detail-spike`, not the engine. Trees
  are hashed procedurally per fragment (no buffers), with sun-cast ellipse shadows; buildings are a 64-entry
  `uniformArray` looped per fragment and fade out as the pixel footprint grows.
- Agents are not procedural, so a crowd layer cannot hash them the way trees are hashed. It needs binned data: a
  sector-aligned occupancy texture updated for changed sectors, or a page table like the flat features.
- The engine has no runtime use of TSL storage buffers or compute for moving instances; only CPU-driven
  `InstancedMesh` helpers. A storage-buffer crowd path is new work.

Assessment of "villagers as dots in the terrain material": efficient for the far tier, and possibly the best
option there. The cost is a fixed few fetches per terrain pixel rather than per agent, the dots get the terrain's
lighting, fog and atmosphere, and the layer can average into a density tint where dots are sub-pixel instead of
flickering. It is not the best option up close: dots cannot show animation or height, and per-fragment lookups
grow with the dots per bin. Mid and near tiers should be instanced geometry. The plan's I1 spike measures the
crossover.

### 2026-11-07 — North star: statistical populations (deferred)

The developer raised a later goal: about 1,000,000 villagers, by turning distant or off-screen villagers into
statistics instead of agents. Not in the current scope.

How the current design leaves room for it:

- A fourth movement tier beyond off-screen agents: per-sector or per-settlement population counts, with flows
  between sectors along the portal graph and job or resource rates in place of individual trips.
- Promotion and demotion: as the camera approaches, counts spawn concrete agents placed consistently with the
  flows; as it leaves, agents fold back into counts.
- Rendering already fits: the far terrain-layer tier can draw a density tint from counts as easily as from agents.
- What to keep in mind now: keep agent state indexed by sector, keep goals as shared fields or jobs rather than
  per-agent paths, and keep simulation rates separable from agent counts, so demotion stays possible later.

Memory estimate for 4,096² cells: about 80 MB of layers; 8 KB per sector field (Uint16 integration); about
1.2 MB per field covering 150 sectors; a 64-field LRU cache of about 80 MB. A 2,048² island is about a quarter
of that. 10,000 agents need under 1 MB of state.

### 2026-11-07 — Decisions before grid-layers (developer agreed)

- Grid size is a parameter. The demo island is 2,048² cells at 1 m; 4,096² is kept as a benchmark size (plan Q1
  resolved).
- The code lives in a new worker-safe secondary entry point, `triangular-engine/crowd-navigation`, with no
  Angular imports in its core. `triangular-engine/navigation` stays untouched.
- Work proceeds one phase per Sonnet subagent run, reviewed here before the next phase starts. The scope baseline
  stays unconfirmed.

### 2026-11-07 — grid-layers: navigation grid, flags and clearance (implementation, awaiting review)

Built in the new worker-safe entry `triangular-engine/crowd-navigation` (`projects/triangular-engine/crowd-navigation/`,
no Angular or three.js imports; `triangular-engine/navigation` untouched).

Files:

- `core/nav-types.ts`, `core/nav-flags.ts` (flag bits, cost constants, unit-class thresholds), `core/nav-clearance.ts`
  (`computeClearanceWindow`), `core/nav-grid.ts` (`NavGrid`), `core/island-heightfield.ts`
  (`generateIslandHeightfield`), `public-api.ts`, `ng-package.json`, `README.md`.
- Specs: `core/nav-grid.spec.ts`, `core/nav-clearance.spec.ts`, `core/island-heightfield.spec.ts`.
- Wiring: `tsconfig.json` and `projects/demo-app/tsconfig.app.json` paths, `angular.json` (`test-crowd-navigation`, and
  the entry added to the default `test` include list), `package.json` script `test:triangular-engine:crowd-navigation`.
- Docs: package README index, `docs/entry-points.md`, `CHANGELOG.md`.
- Demo: `/crowd-navigation-grid` (`projects/demo-app/src/app/pages/crowd-navigation-grid/`), route in `app.routes.ts`,
  card 086 in the demo index.

Design as built:

- Layers (Uint8): `terrain` (flat 16, `16 + round(238 * (slope / 0.7)^2)`, water and steep 255), `structure`
  (0 or 255), `road` (factor 1 down to 0.4), `territory` (owner id; per-faction cost applied at query time by
  `traversalCost`, hostile factor 1.5, so one composed `cost` serves every faction), `flags`, composed `cost`
  (255 impassable, else `clamp(round(terrain * roadFactor), 1, 254)`) and `clearance`.
- Flags: BLOCKED 1, WATER 2, STEEP 4, STRUCTURE 8, ROAD 16, GATE 32, TERRITORY 64, bit 128 reserved.
- Clearance: exact Euclidean distance (column sweep plus Felzenszwalb row pass), floored, capped at `maxClearance`
  (default 16, input option). The cap is what makes a windowed recompute exact: the window is grown by the cap and
  the transform reads blocked cells up to the cap beyond it. Unit classes are thresholds: villager 1, catapult 3,
  creature 8. Outside the grid counts as free for clearance but not passable for `isPassable`.
- Gates are structure cells with a GATE flag; open = structure 0. Footprints take an optional mask.
- Edit methods return the dirty rectangle (grown by the cap) for later sector rebuilds.

Results:

- Tests: `npm run test:triangular-engine:crowd-navigation` (headless, single run): 22 of 22 passed. They cover slope
  cost (flat, steep, too steep, water by level and mask), clearance against a brute-force transform, the 2-cell gap
  (villager passes, catapult and creature do not), windowed recompute equal to a full recompute (random edits and a
  direct window check), layer composition (road, structure, gate, territory, flags) and generator determinism.
- Library build: `npm run build:triangular-engine` succeeded, including the new entry (ng-packagr built `triangular-engine/crowd-navigation`).
- Timing, headless Chrome on the development machine (software GL not involved): 2,048 x 2,048 generate 460 to 610 ms,
  full build (terrain, flags, cost, clearance) 257 to 259 ms, one windowed structure edit 0.4 to 0.9 ms. 4,096 x 4,096
  was not measured.
- Demo: the page renders a 512 x 512 island at 1 m (not 2,048, to keep the mesh at 262k vertices) with switchable
  overlays (terrain, slope cost, structure, road, composed cost, clearance by class, flags), example buildings, a wall
  with a 2-cell gap and a closed gate, a road and two territories, and a gate toggle that edits and redraws. Checked in
  the browser pane at `http://triangular-demo.localhost:4200/crowd-navigation-grid`: the dev build was clean, the page
  rendered, the terrain, clearance and flags overlays were seen (structure, road, slope and cost overlays were not
  opened one by one), and no console errors came from the page after the rebuild. This is not a human visual review.

Deviations and notes:

- The overlay is a `DataTexture` on a `MeshLambertMaterial` (works under both renderers); no custom shader was needed.
- The generated island is smooth with few steep cells; slope overlays show only small steep patches near the centre.
- `generateIslandHeightfield` lives in the core entry as a test/demo utility.

### 2026-11-08 — grid-layers accepted (developer)

Agent review: specs rerun headless (22 of 22), clearance code read, the built bundle for the entry has no Angular
declarations, and the entry was added to the worker-safe list in `projects/triangular-engine/AGENTS.md`. A narrated
walkthrough of the demo (`tools/scene-tests/crowd-navigation-grid.video.mjs`, Stop Motion UI with Gemini speech) and
stills of the clearance, composed-cost and flags overlays were sent to the developer, who accepted the phase on
2026-11-08 and asked to start sectors-portals. Known limits carried forward: the smooth island makes the slope overlay
sparse, and cells outside the grid count as free for clearance.

### 2026-11-08 — sectors-portals: sectors, portals and abstract query (implementation, awaiting review)

Built in `triangular-engine/crowd-navigation` (still worker-safe: no Angular, three.js or engine-root imports).

Files:

- `core/nav-sectors.ts` (`NavSectorGraph`, `NavPortal`, `NavPortalLink`, `NavAbstractPath`, `NavAbstractFailure`,
  `NavSectorOptions`, `NAV_UNIT_CLASSES`), `core/nav-heap.ts` (internal typed-array binary heap, not exported),
  `core/nav-sectors.spec.ts`, `public-api.ts`, entry `README.md` (new section), package README row,
  `docs/entry-points.md` row and `CHANGELOG.md`.
- Demo `/crowd-navigation-grid`: `nav-sector-overlay.ts` (new), `crowd-navigation-grid-page.component.ts/.html`.

Design as built:

- Sectors are `sectorSize` (default 64) squares indexed row-major; edge sectors are clipped. Per unit class the graph
  keeps a portal pool (structure of arrays, ids recycled), the portals of each sector's east and south edge, and per
  sector the nodes (`portalId * 2 + side`, one cell in each sector of a portal) with an n x n Float32 intra-cost matrix.
- Portal: a maximal run of cell pairs along a shared edge where both cells are passable for the class
  (`isPassable` rule: not BLOCKED and clearance at or above the threshold); one portal at the run's centre pair. A
  portal is two nodes joined by a crossing edge that costs the entered cell.
- Intra-sector links: bounded Dijkstra from each node over the composed `cost`, 8-neighbour, diagonals cost sqrt 2,
  no corner cutting, restricted to the sector. A flood fill labels connected regions first so each search stops when
  every node of its region is settled. Costs are directed (stepping into a cell costs its `cost`); the goal side of a
  query uses a reverse search so the cost is exact for that direction.
- Query: `findAbstractPath(startX, startY, goalX, goalY, unitClass)`. Start (forward) and goal (reverse) are connected
  to the portal nodes of their sectors by one local search each; a same-sector direct cost is a candidate. A
  connected-component id per node (recomputed after every rebuild with union-find) rejects unreachable goals before
  the A*. The A* uses an octile heuristic scaled by `floor(16 * roadMinFactor)` (6 by default), which is admissible.
  Returns `{ found, cost, sectors, portals }` plus `failure` (`start-blocked`, `goal-blocked`, `disconnected`).
- Rebuild: `rebuildSectors(dirtyRect)` recomputes the four edges of every touched sector for every class. Touched
  sectors always rebuild their links; a neighbour rebuilds only if the portals on the shared edge changed. Versions
  (`Uint32Array`, 1 after a full build) bump for exactly the returned sectors.

Results:

- Tests: `npm run test:triangular-engine:crowd-navigation` (headless, single run): 37 of 37 passed (22 earlier plus 15
  new). New specs: portal extraction (one gap, wall, 2-cell gap villager only, run splitting); villagers through a gap
  that catapults and creatures cannot pass; creatures routed the long way when a wide opening exists; straight-line
  cost; single sector; blocked and disconnected failures; partial edge sectors (70 x 50 with 32-cell sectors); a
  2,048 x 2,048 island corridor (non-empty, ends in the start and goal sectors, consecutive sectors are neighbours);
  interior edit rebuilds exactly one sector; a border edit bumps only the changed sectors; 25 random edits equal a
  full rebuild (portals, links and query costs); a gate opening and closing makes a creature route appear and vanish.
- Library build: `npm run build:triangular-engine` succeeded.
- Timings, 2,048 x 2,048 island (seed 7, maxHeight 45, featureSize 170), headless Chrome on the development machine:
  grid build 0.85 s in this run (0.27 s in the grid-layers spec; the first run in a spec file is slower), sector graph
  build 3.9 s for 1,024 sectors, abstract query 2.2 to 2.4 ms (24-sector corridor, 23 portals), warm repeat the same.
  The 3.9 s build is dominated by one bounded Dijkstra per portal node per sector; it is a one-off and belongs in the
  worker, but it is the number to beat if start-up matters.
- Portal counts: 2,048 island 1,161 villager, 1,158 catapult, 1,135 creature. Demo island (512 x 512, 64 sectors, wall
  across the island, gate closed): 89 villager, 89 catapult, 88 creature; the sector graph builds in about 230 to 240
  ms there. A gate toggle rebuilds 2 of 64 sectors in 15 to 32 ms.
- Demo checked in headless Chromium at the served URL after the rebuild: no console errors across the sequence below.
  Screenshots in `artifacts/crowd-navigation/`: `sectors-villager.png`, `sectors-creature-closed.png`,
  `sectors-creature.png`, `corridor-villager.png`, `corridor-creature-closed.png` (no route), `corridor-creature.png`
  (route through the opened gate). This is not a human visual review.

Deviations and open points:

- The demo wall now runs across the whole island and the gate is 17 cells tall (was a 56-cell wall and a 3-cell gate),
  because otherwise units walk around the wall and a gate could never be the only wide route. Opening the gate makes
  the creature (and catapult) corridor appear; closing removes it. The 2-cell gap stays villager only.
- Portals are one per run, even for a 64-cell open edge. Long open edges might want two portals (HPA* style) for
  better corridors; kept simple until sector-fields shows whether it matters.
- Path cost is approximate (paths stay inside a sector between portals) and `sectors` removes only consecutive
  duplicates, so a corridor may in principle list a sector twice. Territory and faction cost are not applied.
- Neighbour sectors are rebuilt (and versioned) only when their shared edge portals change; a touched sector always
  rebuilds. The rectangle must be the one `NavGrid` edits return (it includes the clearance halo).
- Open for the developer: whether a 4 s build at 2,048 x 2,048 is acceptable until the worker phase, or whether to
  speed it up now (for example, one Dijkstra per region with shared targets, or bucket queues).

### 2026-11-08 — sectors-portals accepted (developer)

Agent review: specs rerun headless (37 of 37), the query, edge-update, intra-link, local-search and component code
read with no defects found (the scaled octile heuristic stays admissible), and the built entry bundle still has no
Angular or three.js imports. Screenshots of the villager portals and of the creature corridor with the gate closed
and open were sent to the developer, who accepted the phase on 2026-11-08 and asked to start sector-fields. The 3.9 s
build at 2,048 x 2,048 is accepted for now and revisited in worker-scale; a cheap halving is known (the reverse
intra-sector cost follows from the forward one, cost(j→i) = cost(i→j) − cost[j] + cost[i]). Carried forward: one
portal per open run, approximate corridor cost.

### 2026-11-08 — sector-fields: lazy flow fields, cache and crowd simulation (implementation, awaiting review)

Built in `triangular-engine/crowd-navigation` (still worker-safe: no Angular, three.js or engine-root imports; the
built bundle `dist/triangular-engine/fesm2022/triangular-engine-crowd-navigation.mjs` has no imports at all).

Files:

- `core/nav-flow.ts` (`NavFlowCache`, `NavFlowField`, `NavSectorField`, `NavFlowDirection`, `NavFlowStats`,
  `NavFlowBuildRecord`, `NavFlowCacheOptions`, `NavFlowEnsureResult`), `core/nav-crowd.ts` (`NavCrowd`,
  `NavCrowdOptions`, `NavCrowdStats`, `NavAgentState`), `core/nav-flow.spec.ts`, `core/nav-crowd.spec.ts`,
  `public-api.ts`, entry `README.md` (new section), package README row, `docs/entry-points.md` row and `CHANGELOG.md`.
- Demo `/crowd-navigation-grid`: `nav-flow-overlay.ts` (new: built-sector tint and arrow line vertices),
  `crowd-navigation-grid-page.component.ts/.html/.scss` (Crowd panel in the `topCenter` portal lane).

Design as built:

- Field layout: per (goal cell, unit class) a `NavFlowField` holds a sparse array of per-sector `NavSectorField`s.
  A sector field is a `Float32Array` cost-to-goal (sum of entered cell costs, diagonals times sqrt 2; `Infinity`
  where unreached) and an `Int8Array` direction pair per cell (-127..127). The direction is the downhill gradient
  over the passable neighbours (`sum of gain / len^2 * step`, normalised), which reads neighbour values across the
  shared edge from the downstream field; blocked, unreached and goal cells have `0, 0`.
- Build: `ensure(field, x, y, maxBuilds)` runs `findAbstractPath` from the agent's cell and walks the corridor from
  the goal end back, building sectors that have no field. Each build is a multi-source Dijkstra over the composed
  `cost`, same move rules as the sector graph (8-neighbour, no corner cutting, passability by clearance for the
  class). Seeds: the goal cell in the goal sector; for every other sector the **whole shared edge**, each edge cell
  taking `min(downstream cost + cost of the entered downstream cell * step)` over its passable neighbours in the
  downstream sector. This avoids funnelling to the single portal of an open run (a spec checks that cells far from the
  portal row still head straight east).
- Re-entry: a sector is built once per field with the first corridor's downstream neighbour. If the corridor leaves and
  re-enters a sector (a wall splits it and the opening is in the next sector), or the start cell is unreached in an
  existing sector whose downstream differs, that sector is rebuilt seeded from both neighbours (`downstreams`).
- Cache: one `Map` of (goal cell * 3 + class) to `NavFlowField` handles plus one `Set` of sector entries. Each entry
  stores the `NavSectorGraph.versions[sector]` it was built from, a build id, its downstream sectors, build time and a
  `lastUsed` clock. `sync()` (cheap compare of `versions`) marks entries stale on a version mismatch, propagates
  staleness to entries seeded from stale ones, drops them and clears the unreachable-start memo. `ensure` calls it, as
  does every crowd step. LRU: `maxSectorFields` (default 512, about 24 KB per 64 x 64 sector); eviction scans for the
  smallest `lastUsed` (never the entry just built); `touch(field)` refreshes a field, which the crowd does per step.
  Stats: requests, hits, builds, invalidations, evictions, total/last/max build ms, cached count, plus a ring log
  (`recentBuilds`, 256) of (sector, ms, goal, class).
- Sampling: `NavFlowField.sample(x, y, out)` blends the four surrounding cell centres bilinearly; cells with no
  direction are skipped and the remaining weights renormalised, so blending never leans into a wall.
- Crowd: structure of arrays (`posX/posY/velX/velY` Float32, `goalId` Int32, `unitClass`/`state` Uint8), units are
  cells and cells per second. `step(dt)` (fixed 0.05 s by default; `advance(seconds)` accumulates fixed steps):
  sync, arrival test (straight distance within `arrivalRadius` 3), sample or `ensure` (budget `maxBuildsPerStep`),
  spatial hash rebuilt per step by counting sort (bucket max(4, separationRadius) cells, 3 x 3 buckets queried),
  velocity pass reading start-of-step positions, then an integration pass (per-axis moves tested with
  `grid.isPassable`, displacement clamped to 0.9 cell). Separation: linear falloff push from neighbours closer than
  `separationRadius` (1), summed, capped at length 1, weighted `separationStrength` 0.6 of top speed 4 cells/s, accel
  limit 16. Arrived agents are frozen and not in the hash. Spawn uses a seeded mulberry32; no `Math.random`.
- Demo: Crowd panel (Run/Pause, Respawn, Flow arrows, x1/x4/x16, three goal presets, double-click on the terrain to set
  a goal) and HUD (arrived, moving, waiting, step ms, sim seconds, cached sector fields, builds, last and total build
  ms). Crowd: one `InstancedMesh` of capsules coloured by state. Overlay: sectors with a built field are tinted green
  in the data texture, and a `LineSegments` draws one arrow per 5 cells in built sectors (three segments per arrow),
  rebuilt only when the cache stats change. The simulation runs on the main thread.

Results:

- Tests: `npm run test:triangular-engine:crowd-navigation` (headless, single run): 55 of 55 passed (37 earlier plus 18
  new). New specs, flow (11): every reached cell's direction points downhill and blocked cells have none; classes
  route through the gap they fit (villager through the 2-cell gap, catapult through the 11-cell opening, creature
  unreachable); whole-edge seeding; only corridor sectors built with a per-sector build record; wall-split sector
  re-entry; bilinear sampling (centre, midpoint, quarter point, renormalising over a dropped cell, outside grid);
  version invalidation after a `rebuildSectors` edit (the middle sector and, transitively, the sector seeded from it
  drop, the goal sector stays; lazy rebuild with the new version); hits; build budget; LRU eviction order with
  `touch`; rebuild after eviction. Crowd (7): one agent around a building; spawn refusal; separation; unreachable
  state then arrival after a gap is opened (sync); determinism (two runs, 300 agents, 400 steps, identical typed arrays;
  a different seed differs); the 1,000-villager scenario; per-step build budget.
- 1,000-villager scenario: the demo island (512 x 512, seed 7, maxHeight 45, featureSize 170) with a 2-cell-thick
  wall across the whole island and a 9-cell opening, villagers spawned in a 28 x 28 area west of the wall, one goal
  east of it (corridor of 7 sectors). All 1,000 arrived in 1,920 steps (96 s simulated), no agent ever in a blocked
  cell (checked every 10 steps and at the end). 11 sector fields built in 13.9 ms total, per sector 1.2 to 1.4 ms (min /
  median / max). Step time 0.75 ms mean, 18.8 ms max (the max is the step that built the fields). Headless Chrome on the
  development machine, software rendering not involved (unit specs); a second run of the same spec with a closer
  goal (3-sector corridor): 867 steps, 0.71 ms mean, 6 fields in 11.1 ms.
- Library build: `npm run build:triangular-engine` succeeded; the crowd-navigation bundle has no `@angular`,
  `ɵɵngDeclare` or `three` imports.
- Demo checked in headless Chromium (SwiftShader, so slower than hardware) at the served URL after the rebuild
  (`daxur app status` ok): no console errors or warnings through Run, zoom, x16 and arrival. At x4 with rendering:
  5 sector fields built in 39 to 64 ms total (last 2.2 to 7.4 ms), step 1.5 to 3.2 ms, all 1,000 arrived after 56 s
  simulated. Screenshots in `artifacts/crowd-navigation/`: `crowd-start.png`, `crowd-mid.png`, `fields-arrows.png`,
  `crowd-arrived.png`. This is not a human visual review; the arrows screenshot is zoomed close to the goal.

Deviations and open points:

- Fields are per sector per goal with a single (or re-entry double) downstream, so agents whose cell cannot reach that
  downstream within their own sector are marked unreachable even if a route exists through other neighbours of the
  sector. No such case arose in the specs or the demo; fixing it needs a second field variant per sector.
- Arrived agents are frozen and left out of the hash, so 1,000 villagers stack inside the arrival radius. Arrival uses the
  straight distance (a goal right behind a thin wall is reachable from the other side).
- Agents standing in a cell that an edit later blocks are not moved out; the specs only edit empty cells.
- Territory and faction cost are still not applied (fields use `grid.cost`).
- Open for the developer: unit scale (cells per second; default top speed 4), whether arrival should leave agents
  spread (queue or ring around the goal), whether the double-click goal gesture is acceptable, and whether the next
  phase should add the worker wrapper before multi-source fields.

### 2026-11-08 — sector-fields accepted (developer)

Agent review: specs rerun headless (55 of 55), the library build succeeded and the crowd-navigation bundle still has
no Angular or three.js imports; `NavCrowd.step` (arrival, sampling with lazy `ensure`, counting-sort hash, separation,
per-axis integration) read with no defects found. Screenshots of the start, mid-route, flow arrows and arrival were
sent to the developer, who accepted the phase on 2026-11-08 and asked to start goals-edits. Decisions carried into
goals-edits: keep the plan's order (worker after goals-edits); arrival spreading around the goal (no stacking) and
moving agents out of newly blocked cells are part of goals-edits; one portal per open run, the single-downstream
sector field, unit scale (cells, top speed 4) and the double-click goal gesture stay as they are for now.

### 2026-11-08 — goals-edits: multi-source goals, roads, incremental edits, displacement and arrival spreading (implementation, awaiting review)

Built in `triangular-engine/crowd-navigation` (still worker-safe: no Angular, three.js or engine-root imports; the built
bundle `triangular-engine-crowd-navigation.mjs` has no `@angular`, `ɵɵngDeclare` or `three` import).

Files:

- New: `core/nav-goals.ts` (`NavGoalSet`), `core/nav-world.ts` (`NavWorld`, `NavEditResult`, `NavWorldStats`),
  `core/nav-edits.spec.ts` (19 specs).
- Changed: `core/nav-sectors.ts` (`findAbstractPathToAny`, goal sides, `revision`, live road `minCost`),
  `core/nav-grid.ts` (`setRoadMinFactor`), `core/nav-flow.ts` (fields over goal sets, goal stamps, neighbour seeding),
  `core/nav-crowd.ts` (goal sets, `arrivedCell`, displacement, arrival spreading), `public-api.ts`, entry `README.md`
  (goal sets, roads, `NavWorld`, displacement and arrival sections), `CHANGELOG.md`, package README row and
  `docs/entry-points.md` row.
- Demo `/crowd-navigation-grid`: `.component.ts/.html` (edit-mode toggle, gate through `NavWorld`, four-storehouse preset
  with remove/restore, HUD counters), all inside the existing `topCenter` portal lane.

Design as built:

- Goal sets: `NavGoalSet` has a bitset for membership and a per-sector source list. Adding a source bumps the stamps of
  the 3 x 3 sector ring around it; removing one bumps its own sector. A sector field stores the stamp it was built with,
  `sync()` marks entries stale when the sector version or the stamp differs and then propagates staleness to entries
  seeded from a stale one. A single-cell goal is a one-source set, so the old API still works (`goalX/goalY/goalCell` are
  getters on the primary source).
- Search: `searchAbstract` is shared by `findAbstractPath` (octile heuristic) and `findAbstractPathToAny`, which uses a
  per-sector "goal side" (cost from each portal node to the nearest source, a reverse multi-source local search, cached per
  class and keyed by sector version and the set's stamp). With more than one source the heuristic is 0.
- Sector fields: every passable source in the sector is a cost 0 seed. For multi-source fields a new sector is also seeded
  from built neighbours that do not depend on it, which keeps the dependency graph acyclic. Without it, agents near the
  border between two sources went to the second nearest (254 of 300 matched the nearest source; with it 298 of 300).
- Roads: the road layer already composed into cost as `round(terrain * factor)`; the factor is now tunable
  (`setRoadMinFactor`, 0.05 to 1) and the A* minimum cost follows it. Global by design (the cost layer is shared).
- Edits: `NavWorld` applies one grid edit, calls `rebuildSectors(dirty)` and returns the dirty sectors and timings. The
  graph `revision` increases when any sector is rebuilt.
- Displacement: when the revision changes, `NavCrowd.step` scans square rings up to `displaceRadius` (32) and puts an
  agent that stands in a cell its class cannot use on the nearest passable cell (centre distance, ties by scan order),
  velocity zeroed. Agents with no such cell are counted as `stranded`.
- Arrival spreading: arrived agents stay in the spatial hash with zero flow, so separation spreads them; a moving or
  waiting agent that touches an arrived agent of its goal set arrives by contact. Chosen because it needs no slot
  allocation and is deterministic; the blob grows toward the approach side.

Results (headless Chrome, development machine, not guarantees):

- `npm run test:triangular-engine:crowd-navigation`: 74 of 74 specs pass (55 earlier plus 19 new).
- Building dropped on the active route (generated island, 1,000 villagers): 1000 of 1000 arrived in 1,643 steps, step
  1.1 ms mean and 15 to 28 ms max; the edit rebuilt 4 of 64 sectors in about 30 ms (grid update 0.1 to 0.2 ms), invalidated
  5 fields, 2 of them rebuilt in the next step, 340 agents moved out; 13 field builds in total, 16 to 26 ms of field building.
- Gate closing mid-route (256 x 128 plain, 400 agents, a second opening): 400 of 400 arrived in 904 steps, step 0.4 to
  0.5 ms mean and 3.6 to 5.5 ms max; 243 agents were within 28 cells of the gate when it closed; 4 of 32 sectors rebuilt in
  3.7 to 6 ms; 8 fields invalidated, 9 rebuilt in the next step, 19 builds in total. A sealed gate makes agents on the
  wrong side unreachable and they arrive after it reopens.
- Four storehouses (island, 600 villagers, one removed at step 60): 600 of 600 arrived in 265 steps; arrivals per source
  212 / 84 / 105 / 199; step 0.41 ms mean and 11.7 ms max; removing one source invalidated 4 of 4 cached sector fields (the
  neighbour seeding widens dependencies); 8 builds in 13.3 ms. On open ground 298 of 300 agents ended at the nearest of 3
  sources.
- Road spec: with factor 0.4 a flat cell costs 6 instead of 16 and agents take a detour over the road (and go straight with
  factor 1).
- No agent was inside a blocked cell at any check (every few steps) in the three scenarios.
- Observation: about 7 ms per rebuilt sector, dominated by the graph rebuild for all classes.
- Demo check: `/crowd-navigation-grid` builds without errors (`daxur app status`); placing a building mid-run showed
  "2 of 64 sectors rebuilt in 8.1 ms, 4 sector fields invalidated", the gate toggle "2 of 64 sectors in 13.8 ms", and the
  storehouse preset arrived 1000 of 1000 after one storehouse was removed (991 / 9 at the remaining two). The console shows
  only 503 responses from the period when the dev build restarted. Screenshots: `artifacts/crowd-navigation/edits-building.png`,
  `edits-gate.png`, `edits-multisource.png`.

Deviations and limits:

- Adding a source refreshes only its sector ring and dependants; fields elsewhere stay valid but can be suboptimal.
  Opening a gate or building a road does not make fields outside the dependent chain reroute (`touchAll()` is the exact
  refresh).
- Agents wait while their sector field is rebuilt after an edit (they slow down until the next `ensure`).
- One global road multiplier. Neighbour seeding makes a removal invalidate more fields than strictly needed.
- The demo storehouse positions are fixed offsets from the spawn point; the split between them is uneven (most villagers
  prefer one) because of the terrain; the count is shown per source.
- Not verified: hardware GPU timings; worker use.

Open questions for the developer:

1. Q4 (desire paths) remains open and untouched.
2. Is contact-joining (the blob grows toward the approach side) acceptable, or do you want ring slots around the goal?
3. Should adding a source or opening a gate trigger a wider or exact refresh (`touchAll`) by default, at the cost of more rebuilds?
4. Per-class or per-faction road multipliers instead of one global factor?
5. Is neighbour seeding worth the wider invalidation?

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
