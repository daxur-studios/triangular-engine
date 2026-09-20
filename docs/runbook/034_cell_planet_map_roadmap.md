# 034 — Cell planet map roadmap

## Purpose

This is the coordination roadmap for the cell planet map system. It connects the
world-generation work with the two game directions that need to consume it:

1. a Civilization-style map where cells are the gameplay units for cities, movement and
   selection; and
2. a real-scale surface game where terrain is walked, driven over, edited and simulated.

The detailed implementation history remains in [022](022_v4_voronoi_cell_planets.md),
[030](030_cell_planet_25d_map.md), [031](031_shared_planet_terrain_chunks.md),
[032](032_cell_planet_globe_prototype.md) and [033](033_terrain_material_texturing.md).
Those files should record evidence for their own areas. This file records the current
decision, milestone gates and next action.

## Start here — compact delivery checklist

**Destination:** one cell-terrain renderer with dynamic LOD in flat 2.5D, globe and every
intermediate morph state. Choose either today's blended landscape or a Civ-style landscape
with recognisable landforms inside individual irregular cells. Both retain cross-cell ridges,
edge-following rivers and coasts.

**Active execution plan:** [035 — Unified cell terrain delivery](035_unified_cell_terrain_delivery.md).
Its **L0–L6 plan, revised 2026-09-19**, replaces the earlier U0–U7 execution order. P0–P5 below
remain longer-term product goals. Existing work and user confirmations are retained; the
new order brings integrated LOD and morph testing ahead of the remaining geology/water work.

**Gate status (2026-09-20):** the L0–L6 gate table is no longer duplicated here — 035's own
"Current handoff" section is the single live source (two copies of the same gate states will
drift). As of this note: L0 implemented/awaiting user test, L1a next, L1–L6 not started.

**Your review points:** a short visual review at each L gate (and each L4/L5 feature packet).
You serve the app and perform browser checks. Agents first supply a reproducible
route/preset, what changed, what to look for, before/after performance and known issues.
Screenshots establish appearance; a moving camera is required for LOD/streaming acceptance.
“Build passes” does not mean “looks right.”

**Current next action:** L0's minimal versioned surface/style and worker contract, then L1's
coarse/fine volcano integration in the existing morph route. Capture baseline alongside it.
Do not restart completed camera/bookmark work or require all geological types before LOD.
No L gate is accepted yet. Update this table and 035's active handoff after each work session.

## Current decision

Keep one authoritative, deterministic cell world with selectable surface strategies. Build
the terrain views through a shared renderer:

```text
seed/settings
  -> cell graph, plates, elevation, water, climate, biomes, rivers, coastlines, ridges
  -> terrain style (blended / cell-features) + edited canonical surface
  -> shared streamed terrain chunks with LOD
  -> globe <-> projected-map display transform (including intermediate states)
  -> material, overlays, picking and game queries
```

The cell graph remains the gameplay representation. Terrain chunks are rendering and physics
representations and must not replace cell identity. A morphable patch retains compatible
topology and canonical samples for both display shapes. The active plan tests a hierarchical
longitude/latitude domain first, using the existing morph mesh conventions; pole/seam/error
tests determine whether it is suitable before full migration. Cube-face reuse with explicit
projection-cut handling is a fallback, not a second mandatory renderer.

The current clipmap is a working 2.5D baseline. The Meshoptimizer/quadtree path is the shared
candidate for large areas, local edits and the morphing sphere. It is not adopted for the actual
cell maps until it renders the real cell sampler with measured seam, residency and frame-time
evidence.

## Clarified terrain target (2026-09-17)

The intended product is a Civilization-style irregular-cell map whose cells are the gameplay
units, while terrain chunks are only rendering/physics batches. A cell must be able to contain a
recognisable local landform without breaking the larger geography around it:

- **Macro, cross-cell geography:** continental elevation, a mountain ridge that continues across
  adjacent cells, rivers routed along cell edges/corners, and coastlines that remain on the same
  land/water boundaries.
- **Local, within-cell geology:** a volcano, mesa, canyon, crater, terrace or similar feature can
  belong to one cell and be visible as a real surface shape inside that irregular polygon. It is
  not enough for the cell to receive only a colour, icon or a flat elevation offset.
- **Close-up detail bands:** near LOD adds metre/planet-space surface detail, river banks and
  channels, and shoreline/shallows detail from the same deterministic definitions. It may refine
  the shape, but must not reroute a river, move a coastline, or make a feature cross a cell edge
  differently at another LOD or projection.

The current implementation is not yet at that unified state. The 2D map and
`cell-planet-lab` exercise per-cell feature tags, feature elevation and lava/profile display;
`worldgen/core/features.ts` currently narrows those features to a single-cell elevation stamp.
The analytic volcano/mesa/crater/canyon samplers still exist. The shared surface now evaluates
the volcano inside its cell; equivalent mesa/canyon integration remains outstanding, and
canyon is currently a geological-shape/biome concept, not a per-cell `Feature` instance.
The 2.5D, fixed globe and morph pages now consume a shared demo-world snapshot
and feature-aware sampler, and the 2D canvas now consumes the same shared graph/tectonics/ecology/
feature snapshot through an adapter while retaining its own raster generation. The
Meshoptimizer/quadtree labs prove streaming, simplification and seams against synthetic fields,
not against this cell world. The current sampler already reuses the geology-lab volcano shape;
the complete selectable Civ-style strategy and remaining landforms are outstanding.

The separate implementations have not yet proved one shared snapshot, local geology,
edge-following river/coast detail, planar and spherical adapters, and near/far LOD parity
together. The active L0–L6 plan in 035 defines that combined proof and its review checkpoints.

## What is already usable

| Area | Evidence | Limitation |
| --- | --- | --- |
| Cell world | `022`: graph, tectonics, climate, biomes, rivers, coastlines, ridges, canonical elevation and edits | M5 write-up/decision and product integration remain |
| 2D map | Cell map layers and cell-oriented geography | It is the reference view, not the terrain renderer |
| 2.5D map | `030`: shared world, projection, relief and seabed, colour layers, selection, comparison links and current clipmap LOD | Current detailed terrain streaming path is not yet the real cell map renderer |
| Fixed cell globe | `032`: shared sampler displacement, sphere seam/pole checks and material parity | Fixed resolution; not suitable as the final whole-planet renderer |
| Planar chunk streaming | `031` C0/C1 labs: parent fallback, mixed LOD edge handling, no-skirt seam path, diagnostics and shared renderer | The inspected planar generator builds on the main thread despite its async signature; uses fixture terrain; real-cell acceptance remains |
| Sphere chunk streaming | `031` sphere lab: cube-face selection, workers, bounded selection, batching and material experiments | It needs real cell data and repeatable seam/performance acceptance |
| Material foundation | `033`: shared semantic material evaluator, palette, macro variation and crisp procedural material prototype | Production tile streaming and full material integration remain |
| Interaction | Planar cell picking exists; 2D/2.5D selection can be preserved | Sphere picking, terrain-accurate queries and game-facing API need consolidation |

## Product milestones

These P milestones describe the broader product destination, not the current execution queue.
Run 035's active L0–L6 first. Physics, building pads, unit movement and production API consolidation
remain follow-on work unless needed to close a specific U gate.

### P0 — Freeze the shared world contract

**Goal:** both products can request the same world and receive stable geography.

Required contract:

- immutable world snapshot identity: seed, generation settings, generator version;
- planet-space surface sample: elevation, sea datum, land/water, cell id and feature masks;
- deterministic rivers, coastlines and ridge paths independent of projection and camera;
- persistent terrain edits with revision and affected-region invalidation;
- separate canonical units from display exaggeration and camera scale.

Gate: the same direction/cell gives the same result in the 2D, 2.5D and globe adapters, and
an edit changes only its affected surface region.

### P1 — Make the Civ map a usable vertical slice

**Goal:** deliver the first game-consumable map path.

- 2D and 2.5D use the same snapshot, cell IDs, colours and selection.
- The 2.5D view has bounded pan/zoom LOD with no gaps or visible LOD holes.
- Rivers, coastlines and mountain ridges remain attached to the same cell world and are
  readable at the supported camera range.
- Cell selection, hover, highlight, movement and city placement resolve to cell IDs.
- Height queries return surface height for a cell and a local point.
- The current 2.5D clipmap may remain the renderer while these behaviours are completed.

Gate: a small game-style scenario can select cells, place a city, move a unit and switch
between 2D and 2.5D without regenerating or losing the world.

### P2 — Replace the 2.5D fixture with real streamed cell terrain

**Goal:** test the shared chunk architecture against actual cell geography.

- Feed the canonical cell sampler into the planar `TerrainSurface` worker.
- Preserve cell-aware material masks and terrain-attached river/ridge/coast data.
- Keep parent coverage while children build; use bounded worker concurrency and eviction.
- Validate same-level and mixed-level seams on coast, ridge, river and edit fixtures.
- Compare it with the current clipmap at matched visible error, including total and terrain
  draw calls, frame time, build latency, memory and visible detail.

Gate: adopt the chunk path only if it preserves geography and edits with no gaps and a
measured benefit or a necessary capability such as local terrain editing.

### P3 — Real-scale surface game foundation

**Goal:** support walking/driving, physics terrain and base-building edits.

- Use the same streamed chunks and sampler with a real metre-scale plane or local planetary
  frame.
- Add terrain-accurate ray queries and collider patch generation at an independent resolution.
- Make flattening a canonical edit with preview, blend band, invalidation and persistence.
- Keep buildings and gameplay anchored to world coordinates/cell IDs, not disposable mesh
  vertices.
- Add water level, river channels and coast collision/query rules.

Gate: place and remove a flattened building pad, rebuild only affected chunks/colliders, and
move a physics body across an unchanged and edited surface without a seam or height mismatch.

### P4 — Spherical whole-planet terrain

**Goal:** carry the same surface into a navigable globe.

- Use six cube-face quadtrees with bounded global coverage and local refinement.
- Handle face edges/corners, curvature error, horizon culling and floating-origin precision.
- Reuse the same cell/surface/material queries; use sphere-specific patch coordinates.
- Preserve cell selection, surface queries, edits and material detail across face boundaries.
- Validate orbital, regional and near-surface camera paths with delayed and failed builds.

Gate: whole-planet to close-surface navigation remains covered, stable and measurable on the
target hardware, with no face seams or missing terrain.

### P5 — Production map API and content scale

**Goal:** make the system consumable by the games.

- Publish framework-free world, surface, selection, query and edit contracts.
- Publish renderer adapters with lifecycle, streaming diagnostics and resource ownership.
- Add persistence/cache policy only after invalidation is correct.
- Add authored material layers, vegetation/scatter, roads and gameplay overlays against the
  same masks and cell IDs.
- Record supported world sizes, camera ranges, quality presets and performance budgets.

Gate: the game pages use the public contracts rather than private demo helpers, and a new
consumer can load a world, render a view, select a cell, query height and apply an edit.

## Recommended order from here

1. L0–L1: reuse the real cell world and volcano; prove two LOD bands in the morph route at
   globe, halfway and flat. Retain fixed geometry for comparison.
2. L2–L3: complete coverage, morph-aware selection, seams and resource limits; use the same
   renderer in the standalone 2.5D/globe routes and restore supported moving projection tracking.
3. L4–L5: accept the two terrain styles, expand local geology one feature at a time, then
   detailed carved waterways and shores on the working LOD path.
4. L6: measured acceptance and game-facing documentation. Resume remaining P-level physics,
   edits and production work afterwards; L acceptance does not imply production physics acceptance.

Do not treat another isolated demo feature as progress unless it closes one of these gates or
produces a measured result that changes the renderer decision.

## POC ownership

- `/cell-planet-map`: 2D cell-world reference and gameplay geography.
- `/cell-planet-25d-map`: Civ-style planar terrain adapter and comparison view.
- `/cell-planet-globe`: fixed-resolution cell globe adapter and parity check.
- `/terrain-chunk-optimizer-lab`: controlled simplification, feature and seam evidence.
- `/terrain-chunk-streaming-lab`: planar quadtree residency, workers and mixed LOD.
- `/planet-terrain-sphere-lab`: sphere chunk selection, scale and performance fixture.
- `/cell-planet-morph-spike`: primary integration target for the shared plane/sphere surface and
  morph slider. Its existing geometry is the transition reference; streaming LOD must eventually
  work at both endpoints and at intermediate morph values.

## Current next action — unified cell-terrain POC

Follow L0, then L1 in [035](035_unified_cell_terrain_delivery.md). The first new visible
deliverable is coarse/fine terrain around the existing volcano in the morph page at 0%, 50%
and 100%, sampled from the real cell world. It does not require mesas, canyons or finished
rivers. Preserve the existing renderer comparison and canvas reference. Reuse `TerrainSurface`
and its compatible-edge machinery, testing both displayed shapes before expanding coverage.
Record actual seam, responsiveness and feature-retention evidence, then proceed through L2–L6.

## Progress log

- **2026-09-19 — LOD-first delivery revision:** replaced the U execution order with L0–L6
  in 035. Both blended and Civ-style terrain are explicit supported strategies. Morph enters
  the first LOD integration slice; remaining geology and river detail follow working streamed
  terrain. Corrected the planar-lab worker claim after source inspection. Existing user
  confirmations and older U history remain recorded; no L gate is marked accepted.

- **2026-09-16 — Roadmap consolidated:** added this document after reviewing the current map,
  terrain, globe and material runbooks. The project now has explicit Civ-map and surface-game
  tracks, shared gates, POC ownership and one next action: connect planar streamed terrain to
  the real cell-planet sampler.
- **2026-09-17 — Unified target clarified:** the goal is not merely a shared displaced heightfield.
  It is macro cross-cell geography plus real local geology inside individual irregular cells,
  with close river/channel/shore detail and parity across the 2D, planar 2.5D and spherical
  adapters. The next slice is therefore one shared planar+sphere cell-terrain fixture; synthetic
  Meshoptimizer fields and isolated fixed-resolution globe output remain evidence only.
- **2026-09-17 — Delivery gates added:** U0–U7 in 035 now own the immediate execution order,
  visual review points, performance protocol and session handoff. P0–P5 remain the longer-term
  product roadmap. All U gates start unaccepted; prior lab progress must be demonstrated in
  the shared fixture before it counts toward them.
