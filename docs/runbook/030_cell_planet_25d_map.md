# 030 — Cell planet 2.5D map

## Status and ownership

- **2026-09-13: M0 implemented; M1 core bake and first demo integration implemented; visual acceptance pending.**
- Goal: a Civilization-style map on a plane, viewed about 45 degrees above the ground,
  with visible mountain crests, river valleys, biome colours and cell selection.
- [022 — Cell planets](022_v4_voronoi_cell_planets.md) owns world generation and shared
  ridge/river topology. This runbook owns the planar terrain adapter and map experience.
- [028 — Terrain attempt history](028_planet_terrain_attempt_history.md) owns rendering
  experiments and their evidence. Its clipmap boundary pass is a fixture result, not
  acceptance of this map, texture-backed heights or whole-planet coverage.
- Keep progress compact: append dated changes, checks, findings and next steps below.

## Reuse decision

Use the GPU-morph clipmap exported by `triangular-engine/terrain` as the rendering
mechanism. Keep the cell graph authoritative for gameplay: rectangular clipmap tiles
are temporary rendering patches, not replacement map cells.

Verified source entry points:

- [Clipmap scene](../../projects/triangular-engine/terrain/clipmap/clipmap-terrain-scene.ts):
  `createClipmapTerrainScene`, diagnostics and lifecycle handle.
- [Clipmap material](../../projects/triangular-engine/terrain/clipmap/clipmap-terrain-material.ts):
  analytic wave/noise height placeholder and GPU morph/border-clamp logic.
- [Reference consumer](../../projects/demo-app/src/app/gpu-morph-lod-spike/gpu-morph-lod-spike.component.ts).
- [Elevation sampler](../../projects/triangular-engine/worldgen/core/sample-elevation.ts):
  continuous cell-fan elevation and coherent nearby-cell lookup.
- [Map projections](../../projects/triangular-engine/worldgen/render/map-projections.ts):
  shared forward/inverse mapping between planet directions and the flat map.

The scene currently fixes four levels through module constants. `buildClipmapTiles`
already takes sizing/level arguments; configuration needs threading through the scene,
geometry and material with validation. Preserve the wave/noise fixtures as defaults.
The current terrain fixture uses one mesh per level; renderer diagnostics count the
whole scene, so water, overlays and additional passes must be measured separately.

## Data and rendering contract

1. Share one world snapshot (graph, tectonics, ecology and generation identity) between
   views. Changing view or LOD must preserve cell IDs, selection and generated geography.
2. Define deterministic detailed surface sampling in worldgen: base cell elevation,
   ridge cross-sections/peaks and river corridors. Blend branching ridge influence without
   summing it into spikes. Protect channels and the established land/water boundary.
   Existing ridge lines alone do not yet raise terrain or carve channels.
3. Bake a bounded height texture from that sampler, plus biome colour and land/water data.
   Keep cell identification discrete (never linearly interpolate cell IDs). Start with
   one bounded map or regional bake; streamed texture tiles/atlases are later work.
4. Feed those textures and map bounds into the generic clipmap material. Sampling at a
   world position must agree between LOD levels, including border morph samples. Define
   texel centres, filtering, height units and wrap behaviour once for CPU and GPU.
5. Use the same cached height data for CPU queries and GPU rendering. CPU queries must
   reproduce filtering; exact visible-surface hits must additionally account for morph
   and triangle interpolation. Keep canonical heights independent of camera LOD.

Worldgen owns geographic meaning; terrain owns generic rendering and texture sampling.
The adapter converts dimensionless planet data into planar distances/heights. The globe
can later use the same detailed source sampler with radial displacement; projection-specific
texture coordinates must not become the authoritative world representation.

### Plane/sphere reuse requirements

- The canonical sampler takes a normalized planet direction, a versioned world snapshot
  and deterministic detail settings. Ridge widths and noise scales use planet-space units,
  not projected pixels. The map projection must not alter the generated mountain shape.
- Define elevation units and the sea-level datum explicitly. Convert to display units and
  apply visual exaggeration in the rendering adapter. A planar vertex uses projected XZ
  plus height; a spherical vertex uses direction times radius plus radial displacement.
- Height textures are derived caches keyed by world revision, detail settings, sampling
  resolution and projection/patch identity. A future sphere can bake different patches
  from the same source. Camera LOD does not change canonical heights or drainage.
- Test equivalent directions across longitude wrapping and near poles, deterministic
  repeated samples, and shared patch boundaries. Projection distortion can change apparent
  slopes and widths; identical projected mountain silhouettes are not required.
- Share terrain definition and queries; spherical meshes, coverage and LOD are future
  consumers, not an obligation to bend this planar clipmap onto a globe now.

## Integration work and constraints

- **Camera/LOD:** begin with orthographic projection and bounded pan/zoom. Current rings
  and shader distance use camera XZ, which differs from the ground focus at an oblique
  angle. Supply a shared ground-focus anchor to layout and morph calculations. Account
  for orthographic zoom/visible footprint; camera height alone does not determine detail.
- **Coverage:** fit the supported viewport within finite clipmap coverage and clip to map
  bounds. Start with the existing equirectangular projection; define longitude seam
  handling and pole limits explicitly. Long horizon/global handoff remains separate.
- **Detail:** texture resolution and coarsest mesh spacing must retain the chosen ridge
  width, islands and river corridors at supported zooms. More vertices cannot recover
  detail absent from the bake. Recheck boundaries using steep real terrain, not only noise.
- **Water/overlays:** sea uses a consistent level; river channels need downstream profiles.
  Surface ribbons, borders and markers must remain attached through LOD morphing. Reusing
  the existing raster as colour requires separating baked icons/ridge strokes from relief.
- **Picking:** ordinary CPU raycasts against the undisplaced grid will be wrong. Intersect
  the ray with the sampled surface (with a documented LOD error bound), or use a GPU picking
  pass matching the displacement. Convert the hit through the inverse projection to the
  original cell graph; a hit selects a world cell, never a clipmap tile.
- **Material/lifecycle:** normals must reflect height scale and the chosen displacement.
  The current shader uses its own lighting; adding scene lights alone will not change it.
  Ensure all owned scene objects are removed on disposal (the current helper adds a light
  that its handle does not remove). Revisit culling only with displacement-aware bounds.

## Milestones and acceptance

| Step | Deliverable | Check before proceeding |
| --- | --- | --- |
| M0 | Planet-space detailed sampler contract and deterministic ridge/valley evaluation | Same direction gives the same height independent of projection/view; explicit units and sea datum; seam and branch/channel fixtures |
| M1 | Shared snapshot, planar bake, texture-fed clipmap, tilted camera | Same seed/cells/colours as 2D; height parity at off-grid samples; bounded coverage through pan/zoom |
| M2 | Tune/display shared ridge relief, peaks, valleys and water | Recognisable shared crest paths; no mountain uplift blocking reserved channels; retained coast/islands |
| M3 | Selection, highlights, markers and 2D/2.5D toggle | Same cell selected across views; overlays stay on terrain during morph; no world regeneration on toggle |
| M4 | Performance and visual acceptance | No visible boundary gaps/popping in ridge, coast and corner fixtures; record terrain vs total draws, bake cost and texture memory; clean repeated mount/dispose |

First deliverable covers the existing biome style, raised ranges, river valleys, sea,
lighting and selection. Buildings, elaborate vegetation/water, erosion simulation,
physics, streamed height atlases and globe renderer integration are later work.

## Implementation handoff

Implement M0–M4 in order, keeping the existing 2D experience functional. Start with the
shared sampler before making a projection-specific height bake. Use the library entry
points; keep the demo responsible for UI/wiring and the reusable implementation in the
appropriate worldgen/terrain entry points. Extend public APIs compatibly and document them.

The terrain spike is being developed concurrently in this workspace. Re-read its current
exports and inspect `git status` before edits: the source observations above describe the
initial inspection, not a frozen API. Preserve staged and unstaged work, do not copy spike
implementations, and keep shared clipmap edits small and reviewable.

For each milestone, add a compact dated result here. Add meaningful colocated tests for
surface behaviour and adapters, run relevant tests and the library/demo builds, and record
visual checks separately from automated results. A compiled shader or successful build
alone does not establish visual acceptance. Record unresolved test-environment failures.

## Progress

- **2026-09-13 — Design recorded:** inspected the promoted library implementation and
  existing map sampler/projections. Selected reuse through `triangular-engine/terrain`;
  identified texture input, focus/zoom, GPU-height picking and feature preservation as
  integration requirements. No rendering code changed. Next: M1 texture-backed map fixture.
- **2026-09-13 — M0 implemented:** added `createPlanetSurfaceSampler()` and colocated tests.
  It samples normalized planet directions, combines base elevation with deterministic ridge
  and summit relief, and carves land river corridors while preserving the sea datum. The
  sampler is exported from `triangular-engine/worldgen`; it is the source for future planar
  and spherical bakes. Next: M1 bounded planar bake and clipmap texture input.
- **2026-09-13 — M1 core implemented:** added `buildPlanetSurfaceBake()` with separate
  elevation and discrete cell-id arrays, plus an optional texture-backed height source for
  `createClipmapTerrainScene()`. The clipmap keeps its analytic fixture when no source is
  supplied. Library/UI integration, camera focus and visual checks remain next.
- **2026-09-13 — M1 demo slice implemented:** added `/cell-planet-25d-map`, which builds one
  shared cell world, bakes a bounded equirectangular height/color source, and renders it through
  the promoted clipmap with a fixed oblique orthographic camera. Added `lodFocus` so rings follow
  the ground target instead of the elevated camera X/Z position. Browser visual review remains.
- **2026-09-13 — Runtime check:** browser smoke test reached the new route and rendered the
  texture-backed relief with five bounded clipmap levels (64, 48, 48, 48, 48 instances).
  The first shader compile emitted an uninitialized-value warning; initialized the analytic
  fallback before the texture branch. The terrain shape is visibly mountainous, but the POC
  still needs camera/pan/zoom controls, attached river/ridge overlays, and visual tuning.
- **2026-09-13 — Debug camera:** added a temporary active orbit camera for terrain inspection
  (rotate/zoom/pan) while retaining the inactive orthographic camera as the future Civ-style
  map view. This is diagnostic wiring, not the production camera contract.
- **2026-09-13 — Controls slice:** added functional cell-count, seed, relaxation and world-profile
  controls. Changes rebuild the shared graph → tectonics → ecology → surface bake chain and use
  `setHeightSource()` to replace textures without rebuilding clipmap meshes. The 2D-only icon,
  cell-edge and overlay controls remain intentionally deferred until equivalent 2.5D layers exist.
- **2026-09-13 — Projection control:** added the same two-option projection selector as the 2D map
  (Equirectangular and Equal Earth). The selected projection now drives the planar bake; invalid
  Equal Earth corner texels are sea datum rather than sampled terrain. The planet-space sampler
  remains projection-independent for future spherical rendering.
- **2026-09-13 — Bathymetry and comparison switch:** preserved below-sea elevations in the shared
  surface sampler so the 2.5D clipmap renders seabed relief, while land river channels remain
  above the shoreline datum. Added reciprocal 2D map / 2.5D terrain switches that carry the
  current world and 2D display settings through query parameters, so comparison does not reset
  the generated data.
- **2026-09-13 — Handoff refined:** added explicit planet-space units, cache identity and
  plane/sphere reuse requirements. M0 now precedes planar baking; M2 consumes and tunes
  that shared relief. Next: M0 shared sampler, then M1–M4. Concurrent clipmap work must be
  inspected before integration; this document does not certify its latest revision.
