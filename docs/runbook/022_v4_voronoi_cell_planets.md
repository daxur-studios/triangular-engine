# 022 — V4: Voronoi cell-graph planets (structure-first worldgen)

## Status

- State: In progress — **M0 (graph core) and M1 (tectonics) implemented**, isolated POC, not integrated with existing terrain/CDLOD; M1 not yet wired into the `/cell-planet-lab` lab page
- Date: 2026-08-26
- Naming note: "V4" is Bruno's label (V1–V3 = the noise-first planet attempts in BSP). Sublibrary name `worldgen` below is a **placeholder, not approved**.

## TL;DR

Planet generation flips from noise-first (V1–V3: hard to control, mushy coastlines, no guaranteed flat land) to structure-first: a spherical Voronoi **cell graph** where continents, mountain ridges, biomes, and rivers are decided as discrete per-cell/per-edge properties, and noise is demoted to small surface detail. Rendering is deliberately an open question — CDLOD is *not* assumed; a cell-native adaptive mesh is the leading candidate because the authored structure lives on the graph, not in a heightfield. Everything is built and tested in isolation (pure sublibrary + dedicated lab page) before any integration.

## Why (V1–V3 post-mortem, condensed)

Four iterations of global 3D noise (fractal baseline → signed continents → domain warping + biome masks → calibrated masks + live sliders) all fought the same root cause: with noise, every gameplay requirement is an *emergent hope*, not a guarantee. Specifically:

- Mountain ridges never form connected walls that block ground movement.
- Coastlines are isolines through a continuous field — never crisp.
- "Flat buildable meadows" require masking hacks that then flatten the mountains too.
- Control knobs are noise frequencies/amplitudes, which don't map to gameplay intent.

## Goals

Unique, fun, controllable planets for physics gameplay (flying/driving vessels, base building):

1. **Mountain ridges as movement blockers** — connected ridge cells, guaranteed by construction (plate boundaries), not by noise luck.
2. **Clear continents & crisp shorelines** — land/water is a per-cell boolean; the coastline is a polyline of cell edges.
3. **Discrete biomes** — climate-driven (desert, tundra/ice caps, jungle/rainforest, taiga, savanna) plus relief-driven (meadow, hills, canyon, mesa, alpine, dunes) as *cell tags* with enforced properties (meadow ⇒ flat ⇒ buildable).
4. **Rivers that always reach the sea** — downhill walks along cell edges.
5. **Planetary scale, shape-agnostic** — sphere first; the same graph algorithms run on a flat/infinite 2D lattice later.
6. **Meaningful knobs** — "plate count", "ridge height", "sea level %", "cell density" instead of octaves and lacunarity.
7. **Deterministic & seed-driven** — same seed ⇒ same planet, pure functions, unit-testable without Three.js.

Deliberately irregular cells (relaxed Voronoi, per Amit Patel's *Polygonal Map Generation*), **not** a hex grid — irregularity hides the tiling, avoids the icosahedron's 12 pentagons, and gives more variety.

## Architecture

### Layer 1 — Cell graph (pure, framework-free)

```
(seed, params) → PlanetGraph {
  cells,       // spherical Voronoi cells: center, polygon corners, neighbor ids
  edges,       // shared boundaries with left/right cell ids
  plates,      // plate id per cell, plate motion vectors
  elevation,   // per-cell (+ per-corner interpolated) elevation
  water,       // per-cell boolean + lake detection
  biomes,      // per-cell biome tag
  rivers,      // edge chains from source cells to coast
  coastlines,  // extracted closed polylines of land/water edges
}
```

Pipeline stages (each pure, independently testable):

1. **Point distribution** — Fibonacci spiral on the sphere → N seed points (params: cell count, optionally density variation later).
2. **Lloyd relaxation** — k iterations of move-to-centroid + reproject, to turn clumpy into nicely irregular.
3. **Spherical Voronoi** — 3D convex hull of the points *is* the Delaunay triangulation; Voronoi cells are its dual (corners = triangle circumcenters projected to sphere). No spherical-geometry special cases.
4. **Plates** — seed P plates, flood-fill cells, assign each plate a random motion vector. Edge classification: convergent / divergent / transform from relative motion.
5. **Land/water** — plate type (continental/oceanic) + a low-frequency perturbation ⇒ per-cell boolean, targeting a sea-level % param. Small islands/lakes emerge from the perturbation.
6. **Elevation** — combined from: convergent boundary uplift (ridge cells, decaying with graph distance from the boundary), BFS distance-from-coast for continent interior swell, and per-biome amplitude. Elevation is authored per cell, with corner values blended from adjacent cells so slopes are controllable.
7. **Climate** — two derived per-cell scalars, computed before biome rules:
   - **Temperature** — from latitude (pole-to-equator falloff) minus elevation lapse (higher = colder). Poles get ice caps *by construction*, not by noise luck.
   - **Moisture** — BFS distance-from-ocean/river (closer = wetter), optionally biased by a simple prevailing-wind direction per plate/latitude band (windward coasts wetter, leeward interiors drier — enough to justify deserts forming in continental interiors/rain-shadows without a full atmospheric sim).
8. **Biomes** — a Whittaker-style lookup over (temperature, moisture, elevation, slope), Red-Blob-Games style:

   | | dry | medium | wet |
   |---|---|---|---|
   | **cold** (poles/high alpine) | tundra | taiga/snow | glacier/ice cap |
   | **temperate** | steppe/dunes | meadow / hills | jungle/temperate forest |
   | **hot** (equatorial) | desert | savanna | rainforest/jungle |

   Plus elevation/slope overrides independent of climate: **alpine** (high elevation, any climate), **canyon** (high slope + low moisture history), **mesa** (stepped elevation + dry). Each biome carries its *detail recipe* (noise amplitude/character used only within that cell, e.g. meadow ≈ 0, dunes = rolling low-frequency, canyon = carved steps). Ice-cap cells at the poles are also flagged as water-equivalent for rendering (frozen ocean) vs. land ice (glacier) so shorelines stay meaningful near poles.
9. **Rivers** — pick high-moisture/high-elevation source cells, walk strictly downhill along cell corners/edges to the sea; widen by accumulated flow; carve elevation along the path; contribute back into the moisture pass (river-adjacent cells get a moisture bonus, which is what lets jungle hug a river through an otherwise drier belt).
10. **Coastline extraction** — walk land/water edges into closed polylines (needed for crisp-shore rendering and shoreline gameplay queries).

### Layer 2 — Rendering (open question — architecture spike, NOT CDLOD by default)

CDLOD (runbook 019) was painful, is in an unfinished state, and was designed for continuous heightfields. V4's source data is a polygonal graph, which may suit a different architecture. The spike compares options against these criteria, in priority order:

- **Crisp waterline** — shoreline should be actual geometry (coastline polyline as mesh edges), not a depth-tested fade or shader threshold.
- **Mountain definition** — ridge/alpine cells need more triangles and sharper displacement than meadows; LOD budget should follow *biome importance*, not just camera distance.
- **Silhouette/horizon quality** — cells near the planet's limb (grazing view angle) are where low tessellation is most visible; LOD selection should weight view angle & horizon membership, not distance alone.
- Zero cracks between LOD levels; performant at planetary scale; plays nicely with Jolt colliders for ground vehicles.

Candidates:

| Option | Idea | Notes |
|---|---|---|
| **A. Cell-native adaptive mesh** (leading) | Triangulate the graph directly; each cell subdivides independently (fan → loop-subdivide + displace) based on LOD score = f(distance, view angle, biome, horizon) | Coastline & ridge edges are real mesh edges ⇒ crisp by construction. Per-cell granularity matches per-cell authoring. Needs crack-stitching at cell borders (edge subdivision agreed per-edge, T-junction free). |
| B. CDLOD over a graph-rasterized heightmap | Reuse runbook 019 pipeline; graph splats into a heightfield | Known tech, but inherits every CDLOD pain point, blurs coastlines back into isolines, and detail placement is distance-only. Fallback, not default. |
| C. Chunked quadtree cube-sphere w/ skirts | Classic planet renderer sampling graph-derived heightfield | Same coastline blurring as B; simpler than CDLOD but same category. |
| D. Hybrid | A for near/ground gameplay, a cheap baked coarse mesh (whole graph at corner resolution) for far/orbit view | Likely where A ends up anyway — the coarse graph mesh *is* a great far-LOD. |

Water rendering: separate ocean sphere mesh clipped to ocean cells, meeting the coastline polyline exactly; optional signed-distance-to-coast attribute for shore foam/shallows shading.

Spike exit criteria: a rotating planet at 60fps with visible crisp coastline, one sharp ridge range, flat meadows, and no cracks — judged from ground level, low grazing angle, and orbit.

### Layer 3 — Physics & gameplay hooks (later, but shapes decisions now)

- Ground colliders from the same mesh source as visuals (Jolt static mesh per region, streamed by proximity) so vessels drive on what they see.
- Gameplay queries answered from the graph, not the mesh: `biomeAt(dir)`, `isBuildable(cell)`, `distanceToCoast(cell)`, `ridgeBetween(cellA, cellB)`.

## Isolation & placement

- Lives as a new pure sublibrary (working name `triangular-engine/worldgen` — **name TBD**) with its own `public-api.ts`, mirroring `scatter`/`terrain`/`procedural` conventions: deterministic core, no Angular/Three coupling, adapters at the edge.
- **No integration** with `triangular-engine/terrain` (CDLOD), `celestial` surfaces, or BSP until the POC proves out. No changes to existing planet code.
- Dedicated demo-app lab page (e.g. `/cell-planet-lab`) with live regeneration: seed, cell count, plate count, sea level, ridge height, relaxation iterations.
- 2D debug views matter as much as 3D: flat map projections of plates / elevation / biomes / rivers (Amit-style) are the fastest way to judge generation quality without touching rendering.

## Milestones

- **M0 — Graph core — done**: `triangular-engine/worldgen` sublibrary (`projects/triangular-engine/worldgen/core/`). Fibonacci points (with seeded jitter), Lloyd relaxation, convex-hull spherical Voronoi (the hull's outward face normals *are* the dual's Voronoi vertices — see the module docs on `dual-cells.ts`), neighbor graph. 18/18 unit tests passing: cell count, ≥3 neighbors per cell, symmetric adjacency, dual/Euler consistency (`Σdegree == 2·(3N−6)`), area-variance bounds, seed determinism. Run via `npm run test:triangular-engine:worldgen`.
  - Early lab page `/cell-planet-lab` (demo-app) visualizes the M0 graph with real per-cell camera-facing culling (dot-product of cell center dir vs. camera dir each tick, dynamic `BufferAttribute` + `setDrawRange`, no occluder mesh). **Known limitation**: the cull threshold is a flat dot-product cutoff, so it's only correct for a camera far from the surface (near-orthographic horizon). Up close — camera near/inside the cell radius — the true horizon is much tighter than a fixed-angle cutoff accounts for, so cells well behind the actual horizon still pass the test and get drawn. Needs a proper horizon test derived from camera altitude (e.g. threshold = f(camera distance from planet center, planet radius), or an actual horizon-plane/tangent-line check) before this generalizes past "orbit view." Ties into the M4 rendering spike's horizon/view-angle LOD weighting (line above), but that's mesh LOD, not this visibility cull — worth revisiting both together.
- **M1 — Tectonics & continents — done**: `plate-tectonics.ts` (randomized multi-source flood-fill plate assignment + per-plate type/tangent-movement), `plate-boundaries.ts` (convergent/divergent/transform classification from relative plate motion vs. boundary normal), `elevation.ts` (plate-type base elevation + per-boundary-type shaping that decays outward over a few graph hops + percentile-based sea level), combined in `tectonics.ts` (`buildPlanetTectonics()`). 14/14 unit tests passing: land fraction within tolerance of `targetLandFraction`, ridge cells (continent-continent convergent boundaries) never isolated (each has ≥1 ridge neighbor), continental mean elevation > oceanic, full determinism per seed, distinct seeds diverge. Not yet wired into the `/cell-planet-lab` page (still M0-only) or the 2D unwrap view.
- **M2 — Climate, biomes & rivers**: temperature/moisture fields, Whittaker biome lookup (incl. desert, tundra/ice caps, jungle/rainforest), river tracing, coastline extraction. Tests: poles are ice/tundra at any seed; every river terminates at ocean/lake; meadow cells have zero macro relief; deserts favor rain-shadow/interior cells over coastal ones; coastlines are closed loops.
- **M3 — Debug lab**: `/cell-planet-lab` with 2D map modes (plates/elevation/biome/moisture/rivers) + naive 3D preview (flat-shaded cell mesh, one triangle fan per cell — ugly is fine).
- **M4 — Rendering spike**: prototype option A (cell-native adaptive mesh + crack-free stitching + separate ocean mesh); compare against B only if A fails. Judge with the spike exit criteria above.
- **M5 — Write-up & decision**: record what won, then scope integration (BSP, colliders, scatter, far-LOD) as a follow-up doc.

## Non-goals (for this POC)

- No integration with CDLOD, `celestial`, scatter, or BSP gameplay.
- No texture/material polish beyond biome flat colors + basic lighting.
- No infinite-2D variant yet (the graph layer is designed to allow it; not built now).
- No erosion simulation — plate uplift + rivers carving is the ceiling for now.

## References

- Amit Patel, *Polygonal Map Generation for Games* (Red Blob Games) — cell-graph elevation, moisture, biomes, rivers; V4 is this on a sphere with plates added.
- Runbook [019_cdlod_celestial_migration.md](019_cdlod_celestial_migration.md) — the CDLOD pipeline V4 deliberately does not assume.
- Runbook [004_multi_surface_terrain.md](004_multi_surface_terrain.md) — shape-agnostic surface domains (relevant for the later flat/infinite variant).
