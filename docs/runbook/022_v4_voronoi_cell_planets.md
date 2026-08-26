# 022 — V4: Voronoi cell-graph planets (structure-first worldgen)

## Status

- State: In progress — **M0 (graph core), M1 (tectonics), M2 (climate/biomes/rivers/coastlines), and M3 (debug lab) implemented**, isolated POC, not integrated with existing terrain/CDLOD; `/cell-planet-lab` now has all planned 2D map modes (graph/plates/elevation/land/temperature/moisture/biome/rivers) plus a naive flat-shaded 3D preview mesh. **M4 reshaped 2026-08-26** from a single "rendering spike" into sub-milestones M4a–M4e (see Layer 2 and Milestones below) — next up is M4a, `sampleElevation()`.
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

### Layer 2 — Rendering (reshaped 2026-08-26 — chunked cell-native mesh, NOT CDLOD)

CDLOD (runbook 019) was painful, is in an unfinished state, and was designed for continuous heightfields. V4's source data is a polygonal graph, which suits a different architecture. Three lessons from the V1–V3 and CDLOD attempts drive this shape directly:

- **Draw calls were the actual killer before**, not triangle count — so the unit of rendering is a **chunk** (a merged run of ~100–ish cells baked into one `BufferGeometry`), never one draw call per cell.
- **Camera and physics are decoupled** — you can orbit to see the whole planet while a vessel sits on the surface, so the visual mesh's LOD and the collider's resolution must be free to differ completely. They should never be forced into "one mesh serves both."
- **Terrain is going to be edited at runtime** (base-building flatten/dig), so the height source can't be a one-shot bake — it has to be a live function that both edits and rebuilds can call at any time.

The bridge across all three is a single **canonical elevation function**, `sampleElevation(pointOnSphere) → height`: pure, deterministic, derived from the cell graph (barycentric blend of the 3 corner elevations of whichever cell the point falls in), plus — once base building lands — a sparse **override layer** (player edits stored as save data, checked before the graph value). Everything else reads from this one function instead of agreeing with each other by convention:

- **Visual chunks** displace their vertices by sampling it at whatever density their current LOD level calls for.
- **Colliders** are small, high-resolution mesh patches sampled from the same function, generated only near vessels/the player — independent of what the camera or visual LOD is doing.
- **Terrain edits** (flatten a pad) write into the override layer, then trigger a rebuild of only the affected chunk(s) and any nearby collider patches — nothing else on the planet touches disk or GPU.

LOD is **per-chunk, discrete** (2–4 fixed subdivision levels picked by camera distance to the chunk), not per-cell adaptive scoring. Border stitching only has to agree between whichever two discrete levels are adjacent, not an arbitrary continuum — far simpler than full crack-free adaptive stitching. Per-cell adaptive LOD (view-angle/horizon-weighted scoring, biome-importance budgets) is **deferred**, not abandoned: the chunk architecture doesn't block adding it later if large/medium planets or close orbital flythroughs need it, but it is not built until a real case proves it's needed. Coastline and ridge cell edges stay real mesh geometry either way (crisp by construction — no shader/depth-fade shoreline), because chunks are still built by tessellating the graph, not by rasterizing it into a heightfield.

Water rendering: separate ocean sphere mesh clipped to ocean cells, meeting the coastline polyline exactly; optional signed-distance-to-coast attribute for shore foam/shallows shading.

Because planet size is a player-facing choice (small/medium/large), the architecture must hold up across the whole range even though the near-term focus is small planets — chunking + discrete per-chunk LOD is what makes that scale, not a small-planet-only shortcut.

Exit criteria (rescoped 2026-08-26): not a single fps floor. Measure **frame time in ms for this subsystem alone** (chunk render + any active collider rebuilds) on a rotating small planet, at ground level, low grazing angle, and orbit — crisp coastline, one sharp ridge range, flat meadows, no cracks between chunk LOD levels, no visible seam between a chunk's visual mesh and its collider patch. The ms budget should leave clear headroom for everything else the game will run in the same frame (physics, other rendering, gameplay logic) — a global "60fps" number was never the real target, just a conservative sanity floor.

### Layer 3 — Physics & gameplay hooks (later, but shapes decisions now)

- Ground colliders (Jolt static mesh, streamed by proximity to vessels) are sampled from the *same* `sampleElevation()` function as the visual chunks, not literally the same mesh — see Layer 2. This is what lets the camera orbit out to see the whole planet while a vessel's collider stays high-resolution locally.
- Gameplay queries answered from the graph, not the mesh: `biomeAt(dir)`, `isBuildable(cell)`, `distanceToCoast(cell)`, `ridgeBetween(cellA, cellB)`.

## Isolation & placement

- Lives as a new pure sublibrary (working name `triangular-engine/worldgen` — **name TBD**) with its own `public-api.ts`, mirroring `scatter`/`terrain`/`procedural` conventions: deterministic core, no Angular/Three coupling, adapters at the edge.
- **No integration** with `triangular-engine/terrain` (CDLOD), `celestial` surfaces, or BSP until the POC proves out. No changes to existing planet code.
- Dedicated demo-app lab page (e.g. `/cell-planet-lab`) with live regeneration: seed, cell count, plate count, sea level, ridge height, relaxation iterations.
- 2D debug views matter as much as 3D: flat map projections of plates / elevation / biomes / rivers (Amit-style) are the fastest way to judge generation quality without touching rendering.

## Milestones

- **M0 — Graph core — done**: `triangular-engine/worldgen` sublibrary (`projects/triangular-engine/worldgen/core/`). Fibonacci points (with seeded jitter), Lloyd relaxation, convex-hull spherical Voronoi (the hull's outward face normals *are* the dual's Voronoi vertices — see the module docs on `dual-cells.ts`), neighbor graph. 18/18 unit tests passing: cell count, ≥3 neighbors per cell, symmetric adjacency, dual/Euler consistency (`Σdegree == 2·(3N−6)`), area-variance bounds, seed determinism. Run via `npm run test:triangular-engine:worldgen`.
  - Early lab page `/cell-planet-lab` (demo-app) visualizes the M0 graph with real per-cell camera-facing culling (dot-product of cell center dir vs. camera dir each tick, dynamic `BufferAttribute` + `setDrawRange`, no occluder mesh). **Known limitation**: the cull threshold is a flat dot-product cutoff, so it's only correct for a camera far from the surface (near-orthographic horizon). Up close — camera near/inside the cell radius — the true horizon is much tighter than a fixed-angle cutoff accounts for, so cells well behind the actual horizon still pass the test and get drawn. Needs a proper horizon test derived from camera altitude (e.g. threshold = f(camera distance from planet center, planet radius), or an actual horizon-plane/tangent-line check) before this generalizes past "orbit view." Ties into the M4 rendering spike's horizon/view-angle LOD weighting (line above), but that's mesh LOD, not this visibility cull — worth revisiting both together.
- **M1 — Tectonics & continents — done**: `plate-tectonics.ts` (randomized multi-source flood-fill plate assignment + per-plate type/tangent-movement), `plate-boundaries.ts` (convergent/divergent/transform classification from relative plate motion vs. boundary normal), `elevation.ts` (plate-type base elevation + per-boundary-type shaping that decays outward over a few graph hops + percentile-based sea level), combined in `tectonics.ts` (`buildPlanetTectonics()`). 14/14 unit tests passing: land fraction within tolerance of `targetLandFraction`, ridge cells (continent-continent convergent boundaries) never isolated (each has ≥1 ridge neighbor), continental mean elevation > oceanic, full determinism per seed, distinct seeds diverge. Wired into the `/cell-planet-lab` page's 2D unwrap view as three color modes (plates/elevation/land-water), plus a `plates` slider, as an early visual sanity check — full 3D preview and biome/river modes are still M3.
- **M2 — Climate, biomes & rivers — done**: `climate.ts` (latitude-driven temperature with an elevation lapse + BFS-from-ocean moisture), `biomes.ts` (Whittaker-style temperature/moisture lookup plus alpine/canyon relief overrides), `rivers.ts` (downhill cell-walk from high-moisture/high-elevation sources to ocean or a local-minimum lake), `coastlines.ts` (land/water edges chained into closed polylines via corner-triple canonicalization — see the module doc comment for why every coastline vertex has exactly 0 or 2 incident edges), combined in `ecology.ts` (`buildPlanetEcology()`). Elevation/slope/source-elevation cutoffs are all normalized as *fractions of land relief* (seaLevel..max land elevation), not absolute values, since tectonics elevation is an arbitrary unitless scale whose range varies with plate/boundary params — an early attempt at fixed absolute thresholds produced zero meadow and zero desert cells for some seeds until this was fixed. 14/14 new unit tests passing (46/46 total with M0+M1): poles are always a cold biome (tundra/taiga/glacier/ice_cap) at any seed; meadow cells have zero macro relief (slope < 8% of land relief); desert cells never touch the coast (coastal cells always exceed the dry-moisture cutoff by construction); every river strictly descends in elevation and terminates at ocean or a lake; coastlines are closed loops (geometric closure check on the wraparound edge). Wired into the `/cell-planet-lab` page's 2D unwrap view as `temperature`/`moisture`/`biome` color modes, alongside M1's — river paths and coastline polylines are not drawn yet (that's the rest of M3's map-mode set).
- **M3 — Debug lab — done**: added a `rivers` 2D unwrap mode (land/water base + traced river paths as blue polylines + coastline loops as white polylines, both walking corner points with the same ±180°-seam segment guard as the existing edge overlay) and a naive 3D preview mesh — one flat-shaded triangle fan per cell (center → corner k → corner k+1), non-indexed geometry, `MeshStandardMaterial({ vertexColors: true, flatShading: true, side: DoubleSide })` so winding direction doesn't matter for visibility, colored via a new `resolveCellColor()` helper shared with the 2D fill so both views always agree and follow whichever map mode is selected. Geometry rebuilds on `regenerate()`; only vertex colors re-touch on a mode switch. No elevation displacement or crack-free stitching — deliberately ugly, that's the M4 rendering spike's job.
- **Rivers reworked to follow cell edges, not cell centers**: the initial `traceRivers` walked cell-center to cell-center by steepest elevation descent, with no notion of a channel direction — that produced arbitrary straight chords across a landmass (looked like a canal) and rivers that cut through a coastal cell instead of stopping at the coast. Fixed by adding `corner-graph.ts` (`buildCornerGraph()`): a dual graph over the cell graph's Voronoi corners (same corner-triple canonicalization `coastlines.ts` uses), with corner-to-corner adjacency along shared cell-polygon edges. `traceRivers` now walks this corner graph — corner elevation/moisture are the average of the 3 cells meeting there — terminating at a corner that touches water (an exact coastline vertex, a natural river mouth) or a land-locked local minimum (a lake). `IPlanetRivers.riverPaths` is now `IVec3[][]` (point chains, ready to draw) instead of cell-id chains, and `lakeCellIds` is now `lakeCorners: IVec3[]`. Rivers/ecology specs updated to verify elevation-descent and coast/lake termination against corner data instead of cell data. 46/46 tests still pass (no new tests added — same guarantees, re-expressed against corner points).
- **M4 — Rendering (reshaped 2026-08-26, see Layer 2)**: split into small, independently-useful steps instead of one big spike — each is a day-ish bite, and nothing later throws away earlier work.
  - **M4a — Canonical elevation function — done**: `sample-elevation.ts` (`sampleElevation()`, `findCellAt()`, `cellCornerElevation()`) in `worldgen` — pure, barycentric-blended from the containing cell's own elevation and the 2 corner elevations of whichever fan wedge the query point falls in (corner elevation = average of the 3 cells meeting there, same formula `rivers.ts` already used internally). `findCellAt()` is nearest-site-by-dot-product, which is exactly Voronoi cell membership for these graphs — brute-force O(cellCount), fine for arbitrary/occasional queries (future collider patches) but too slow to call per mesh vertex at high cell counts. `cellCornerElevation()` is exported separately as the O(1) path for callers (mesh/chunk builders) who already know which cell/corner they're touching. 5/5 new unit tests passing (56/56 total): exact at cell centers, matches the corner-average exactly at corners (continuity across cell borders), `findCellAt` round-trips a cell's own center, deterministic, stays within the local min/max elevation. The `/cell-planet-lab` 3D preview mesh now displaces every vertex via the O(1) direct lookup (not `sampleElevation()`'s search) and exposes the exaggeration factor as a live "elevation ×" slider (0–15%, default 2%) instead of a fixed constant — a flat-shaded low-poly mesh reads as a lumpy asteroid well before the terrain reads as "tall", so this needed to be tunable, not guessed once. Cell-count slider raised 500 → 3000 now that per-vertex elevation lookup is O(1) instead of O(cellCount). No chunking/LOD/collider wiring yet — that's M4b onward.
    - **Follow-up fix (same day)**: displaced vertices are now clamped to sea level from their owning cell's land/water side (`isLand[cellId] ? max(e, seaLevel) : min(e, seaLevel)`) — without it, a corner's raw value is a plain 3-cell average (`cellCornerElevation()`), so an ocean cell next to a mountain got one corner dragged above the elevation of unrelated flatter land cells elsewhere, i.e. water rendering visibly higher than land. This is a placeholder (land/water still share one blended mesh) — the real fix is a separate flat ocean shell, which is M4b/e territory, not done here. Also swapped `<orbitControls>` for `<raycastOrbitControls>` (pivots wheel-zoom/rotate on the actual displaced surface under the pointer, not a flat distance guess), set `near` to `0.001` (was the default `0.1`, ~10% of planet radius — clipped when orbiting close to the surface), and added a "surface-up camera" toggle that re-levels the orbit camera's up vector to the current radial direction every tick instead of a fixed world-Y up (avoids the pole gimbal when orbiting at high latitude).
  - **M4b — Chunking**: merge cells into ~100-ish-cell chunks, one `BufferGeometry`/draw call each, cells still addressable by index range within a chunk. Fixes the high-draw-call regression from prior POCs.
  - **M4c — Per-chunk discrete LOD**: 2–4 fixed subdivision levels per chunk selected by camera distance, with border stitching only between adjacent discrete levels. Proves out medium/large planets without adaptive per-cell scoring.
  - **M4d — Local collider patches**: high-res Jolt mesh patches sampled from `sampleElevation()` near vessels, independent of visual LOD/camera. Proves the camera/physics decoupling.
  - **M4e — Terrain-edit rebuild path**: sparse override layer on top of `sampleElevation()` (player edits as save data) + rebuild-affected-chunk(s)-only on edit. Proves flatten/dig is affordable before base building is built on top of it.
  - Deferred, not scheduled: per-cell adaptive LOD scoring (view-angle/horizon weighting, biome-importance budgets) — only revisit if a real case (large planets, close orbital flythroughs) proves discrete per-chunk LOD insufficient.
- **M5 — Write-up & decision**: record what M4a–e proved (and whether the deferred adaptive-LOD item is actually needed), then scope integration (BSP, scatter, save format for terrain edits) as a follow-up doc.

## Non-goals (for this POC)

- No integration with CDLOD, `celestial`, scatter, or BSP gameplay.
- No texture/material polish beyond biome flat colors + basic lighting.
- No infinite-2D variant yet (the graph layer is designed to allow it; not built now).
- No erosion simulation — plate uplift + rivers carving is the ceiling for now.

## References

- Amit Patel, *Polygonal Map Generation for Games* (Red Blob Games) — cell-graph elevation, moisture, biomes, rivers; V4 is this on a sphere with plates added.
- Runbook [019_cdlod_celestial_migration.md](019_cdlod_celestial_migration.md) — the CDLOD pipeline V4 deliberately does not assume.
- Runbook [004_multi_surface_terrain.md](004_multi_surface_terrain.md) — shape-agnostic surface domains (relevant for the later flat/infinite variant).
