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

**Destination:** a Civilization-style irregular-cell world, shown in 2.5D and on a sphere,
with recognisable landforms inside cells, ridges across cells, edge-following carved rivers
and detailed coasts, retaining their identity from close view to distant LOD.

**Active execution plan:** [035 — Unified cell terrain delivery](035_unified_cell_terrain_delivery.md).
Its U0–U7 milestones are the current work order; P0–P5 below remain longer-term product goals.
Existing prototypes are reusable evidence, not acceptance of these integrated milestones.

| Gate | What you should see and test | Status |
| --- | --- | --- |
| U0 — Repeatable baseline | Saved views, cell boundaries, scale reference and performance capture; confirm intended zoom range | In progress |
| U1 — One world in every view | Switch 2D / 2.5D / globe/morph; same selected cell, ridge, river and coast | In progress |
| U2 — Landforms inside cells | A mountain, volcano, mesa and canyon have real shape inside their cells; a ridge still spans cells | Not started |
| U3 — Detailed waterways | Low-angle views show carved river bed/banks, connected mouth and detailed shore, following cell edges | Not started |
| U4 — Planar LOD | Zoom and pan in 2.5D; shapes survive simplification, terrain stays covered, performance meets budget | Not started |
| U5 — Spherical and morph LOD | Repeat on globe and through the morph slider, including intermediate states and cube-face edges/corners | Not started |
| U6 — Readable unified map | Materials, water, selection and borders agree with terrain at close and strategic distances | Not started |
| U7 — Accepted POC | Repeat the tour at agreed world sizes; stable performance and memory, all earlier gates still pass | Not started |

**Your review points:** a short visual review at each U gate. Agents first supply a reproducible
route/preset, what changed, what to look for, before/after performance and known issues.
Screenshots establish appearance; a moving camera is required for LOD/streaming acceptance.
“Build passes” does not mean “looks right.”

**Current next action:** U0 — establish the fixture, camera bookmarks, measurements and numeric
budgets. No U gate is accepted yet. Update this table and the handoff in 035 after each work
session. The next agent resumes the earliest unfinished gate, without starting another POC.

## Current decision

Keep one authoritative, deterministic cell world and surface sampler. Build both views from
that source:

```text
seed/settings
  -> cell graph, plates, elevation, water, climate, biomes, rivers, coastlines, ridges
  -> edited canonical surface
  -> plane adapter or cube-sphere adapter
  -> streamed terrain chunks with LOD
  -> material, overlays, picking and game queries
```

The cell graph remains the gameplay representation. Terrain chunks are rendering and physics
representations and must not replace cell identity. A plane and a sphere may have different
patch boundaries, LOD selection and projection math, but they must query the same world and
surface definitions.

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
The analytic volcano/mesa/crater/canyon samplers still exist, but they are not yet a sub-cell
mesh/detail evaluator; canyon is currently a geological-shape/biome concept, not a per-cell
`Feature` instance. The 2.5D, fixed globe and morph pages now consume a shared demo-world snapshot
and feature-aware sampler, while the 2D map still owns its canvas raster generation. The
Meshoptimizer/quadtree labs prove streaming, simplification and seams against synthetic fields,
not against this cell world.

The separate implementations have not yet proved one shared snapshot, local geology,
edge-following river/coast detail, planar and spherical adapters, and near/far LOD parity
together. The U0–U7 plan in 035 now defines that combined proof and its review checkpoints.

## What is already usable

| Area | Evidence | Limitation |
| --- | --- | --- |
| Cell world | `022`: graph, tectonics, climate, biomes, rivers, coastlines, ridges, canonical elevation and edits | M5 write-up/decision and product integration remain |
| 2D map | Cell map layers and cell-oriented geography | It is the reference view, not the terrain renderer |
| 2.5D map | `030`: shared world, projection, relief and seabed, colour layers, selection, comparison links and current clipmap LOD | Current detailed terrain streaming path is not yet the real cell map renderer |
| Fixed cell globe | `032`: shared sampler displacement, sphere seam/pole checks and material parity | Fixed resolution; not suitable as the final whole-planet renderer |
| Planar chunk streaming | `031` C0/C1 labs: workers, parent fallback, mixed LOD edge handling, no-skirt seam path, batching/diagnostics | Uses fixture terrain; large-scale and real-cell acceptance remain |
| Sphere chunk streaming | `031` sphere lab: cube-face selection, workers, bounded selection, batching and material experiments | It needs real cell data and repeatable seam/performance acceptance |
| Material foundation | `033`: shared semantic material evaluator, palette, macro variation and crisp procedural material prototype | Production tile streaming and full material integration remain |
| Interaction | Planar cell picking exists; 2D/2.5D selection can be preserved | Sphere picking, terrain-accurate queries and game-facing API need consolidation |

## Product milestones

These P milestones describe the broader product destination, not the current execution queue.
Run 035's U0–U7 first. Physics, building pads, unit movement and production API consolidation
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

1. Complete U0, then carry the shared world into the existing morph page while adding the first
   local landform. Use bounded reference meshes to judge the shape before renderer
   simplification.
2. Complete U3, then carry the accepted surface through Meshoptimizer/quadtree LOD in the plane,
   sphere and every supported intermediate morph state, retaining the fixed morph mesh for
   comparison.
3. Complete U6–U7: integrated material/selection readability and measured acceptance.
4. Resume remaining P1/P3/P5 gameplay, physics, edits and public API work. U5 supplies evidence
   for P4, but does not by itself accept P4's edit, physics or full production requirements.

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

Execute this scope incrementally through [035](035_unified_cell_terrain_delivery.md), starting
at U0. This section describes the combined destination; it is not one session-sized task.

Build one bounded vertical slice that is consumed by both the planar and spherical adapters,
rather than adding another independent terrain demo. The fixture should contain an irregular
cell boundary with a coast, a river on/near that edge, a ridge crossing several cells, and
individual cells containing a volcano, mesa and canyon. It should use one immutable snapshot with
one canonical sampler and one versioned detail definition, then exercise:

1. planar `TerrainSurface` generation through the Meshoptimizer/quadtree path;
2. spherical cube-face chunk generation through the corresponding sphere path; and
3. the existing 2D map as the cell-identity/reference view.

The first pass only needs one close-detail band and one coarse band. At both bands, assert that
the same direction returns the same cell id, sea datum, feature ownership, river/coast topology
and canonical height within the documented approximation bound. Near detail must show a real
river channel/bank and local geology inside the owning cell; far detail may simplify it but must
retain the ridge/coast/river edge and feature silhouette. Record seam, feature-retention,
residency, build-latency, draw-call, frame-time and memory evidence in 031, and record the map
selection/comparison result in 030. Keep the current clipmap and fixed globe available as
comparison controls until the unified slice passes.

Do not add caching, more geological types or another standalone POC before this slice has passed
the no-gap, cross-view parity and close-detail checks. If the current single-cell feature stamp
cannot provide the required close shape, promote the smallest framework-free sub-cell feature
contract from runbook 010 and make it part of the shared sampler before tuning renderer LOD.

## Progress log

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
