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

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
