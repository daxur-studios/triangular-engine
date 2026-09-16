# 030 — Cell planet 2.5D map

## Status and ownership

- **2026-09-13: M0 and M1 implemented; M2+ visual acceptance pending.**
- Goal: a Civilization-style map on a plane, viewed about 45 degrees above the ground,
  with visible mountain crests, river valleys, biome colours and cell selection.
- [022 — Cell planets](022_v4_voronoi_cell_planets.md) owns world generation and shared
  ridge/river topology. This runbook owns the planar terrain adapter and map experience.
- [028 — Terrain attempt history](028_planet_terrain_attempt_history.md) owns rendering
  experiments and their evidence. Its clipmap boundary pass is a fixture result, not
  acceptance of this map, texture-backed heights or whole-planet coverage.
- Keep progress compact: append dated changes, checks, findings and next steps below.

## Reuse decision

The GPU-morph clipmap exported by `triangular-engine/terrain` is the current rendering
baseline. [031 — Shared planet terrain chunks](031_shared_planet_terrain_chunks.md)
tracks the proposed Meshoptimizer + quadtree alternative for this map and a later globe,
including flattening edits, seams, LOD and caching. It is an unvalidated experiment;
this runbook retains ownership of the planar adapter and map experience. The clipmap
contracts below describe the current implementation, not requirements for that candidate.

Keep the cell graph authoritative for gameplay: rectangular clipmap tiles
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

The scene now accepts optional level count, tile size, block radius, grid resolution,
switch distance, height scale, ground-focus and texture-source settings; module
constants remain the defaults for existing consumers. The 2.5D quality presets use
these options to rebuild only when mesh resolution/LOD topology changes, and replace
the bounded height/colour source in place for ordinary data-layer changes. Preserve
the wave/noise fixtures as defaults. The current terrain fixture uses one mesh per
level; renderer diagnostics count the whole scene, so water, overlays and additional
passes must be measured separately.

The 2.5D adapter now has a real display-space body radius using the shared
`WORLD_SIZE_TIER_RADIUS_M` tiers. Its planar footprint is derived in metres from the
full equirectangular circumference (`2πR × πR`), and the same bounds drive the height
source, ocean, selection, simplified preview and Blender export. The page also enables
the scene's `[logarithmicDepthBuffer]` input and scales camera framing/clipping to the
selected body. The current clipmap supports full-origin coverage through its sixteen
explicit shader levels for the medium tier; larger tiers are intentionally local-view
previews until the quadtree terrain path owns horizon-scale coverage. This fixes the
adapter's unit scale, but does not make the low-resolution bake a close-up detail source:
streamed material/height tiles remain the next step.

Relief uses the original miniature map's proportions: `heightScaleM = verticalScale ×
(2πR / 256)`. Both surface elevations and the ocean datum use that conversion, including
picking, the simplified preview and export through the shared bake. This is stylized,
radius-proportional relief, not a physically calibrated mountain-height model. The existing
`terrainHeightScale` query/slider retains its previous visual meaning.

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
  The scene handle removes its owned light, meshes, geometries and material on disposal;
  retain repeated mount/dispose checks as a regression. Revisit culling only with
  displacement-aware bounds.

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

- **2026-09-13 — Alternative renderer scoped:** created
  [031](031_shared_planet_terrain_chunks.md) for shared optimised terrain chunks.
  Start with mixed-LOD ridge/river and flattening fixtures; integrate a comparison here
  after those checks. No renderer replacement or dependency installation in this step.

### 2026-09-13 — 2D/2.5D generation parity

- Fixed a comparison bug where the 2D raster and 2.5D terrain used different hidden world inputs: the 2D renderer's `jitter = 0.35` and `plateCount = 14` are now shared with the 2.5D bake, alongside the query-preserved cell count, seed, profile, projection, and relaxation passes. Fresh page loads also use the same `1500` cells / seed `1` defaults.
- Added the relaxation control to the 2D page and preserved it in the comparison query, so changing it intentionally changes both views rather than silently reverting to the 2D default.
- Applied the shared water-level land/ocean threshold to the 2.5D bake as well; the comparison switch no longer drops a 2D sea-level adjustment.
- Replaced the fixed 2.5D display bake scale (`14`) with a `0–14` vertical-scale control, defaulting to `4`; this changes only rendered relief, so the canonical terrain and future sphere path remain unchanged.
- Added a 2.5D `Data layer` selector for the shared `biome`, `elevation`, `plates`, `temperature`, `moisture` and `land` colour modes. The modes reuse the same exported colour ramps and per-cell world data as the 2D renderer; changing a mode swaps only the colour texture and preserves the current height/LOD state. `fillMode` is carried through the comparison query.
- Added a 2.5D terrain-quality selector: Preview, Standard, High and Ultra change both the planar bake resolution and clipmap grid resolution. Standard preserves the previous default; higher presets rebuild the clipmap mesh and source texture for more visible relief detail. `terrainQuality` is query-preserved.
- Added a Blender handoff button that exports the current baked terrain as an OBJ plus matching MTL. Geometry follows the selected projection footprint, skips invalid projection texels, and quantizes the active data-layer colours into Blender materials; keep the two downloaded files together when importing the OBJ.
- Kept the shared values in `projects/demo-app/src/app/pages/cell-planet-generation-config.ts` so future renderer changes do not drift.

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
- **2026-09-13 — Clipmap integration hardening:** threaded configurable LOD count, tile size,
  block radius, grid resolution, switch distance, height scale and ground focus through the
  reusable scene. Added deterministic benchmark fixtures/probes for retention, seam/gap and
  popping checks. Replaced shader dynamic uniform-array indexing with constant-index branches
  for WebGL compatibility, and made the height function return one initialized value on every
  path; library and demo builds pass. These checks validate the reusable clipmap, not yet the
  2.5D map's visual acceptance.
- **2026-09-13 — Simplification experiment:** added a runtime-only 0–95% triangle-reduction
  slider through the optional `triangular-engine/meshoptimizer` entry point. At 0% the normal
  clipmap remains active; above 0% the clipmap is hidden and the current indexed baked surface
  is simplified into a standalone inspection mesh with border locking. This deliberately does
  not modify the canonical sampler or clipmap lattice, because arbitrary decimation would
  invalidate crack-free LOD morphing. The Blender OBJ export remains unchanged. Validate Ultra
  cost and feature retention before considering a feature-aware decimator or production use.
- **2026-09-13 — Handoff refined:** added explicit planet-space units, cache identity and
  plane/sphere reuse requirements. M0 now precedes planar baking; M2 consumes and tunes
  that shared relief. Next: M2 relief/river/ridge visual tuning, then M3 selection and
  production camera/2D comparison polish, followed by M4 performance and acceptance.

### 2026-09-13 — M3 selection slice

- Added reusable planar picking in `triangular-engine/worldgen/render`
  (`planet-map-picking.ts`): `intersectPlanarHeightField()` clips a camera ray to the bake
  bounds, ray-marches the *baked* height grid with bisection, and
  `mapXZToPlanetDirection()` inverse-projects the hit to a canonical graph cell via
  `findCellAt()`. Picking uses the fine bake only — it does not evaluate clipmap LOD morph
  or ring-border blend, so a distant hit can differ from the coarser rendered surface by that
  level's interpolation error. Near-camera hits match the rendered surface. A ray starting
  below the sampled surface returns `null`.
- Added demo selection wiring in new focused files: `cell-planet-terrain-selection.ts`
  (camera-ray pick, drag-vs-click threshold, canonical cell data, ring + vertical-pin
  indicator anchored at the sampled surface height) and
  `cell-planet-selection-panel.component.ts` (readout). The shared 2.5D page change is
  limited to injecting the controller, applying the route selection, and rendering the panel.
- Selection is keyed by canonical world cell id and survives 2D↔2.5D via the `selectedCell`
  query key (added to `CELL_PLANET_QUERY_KEYS`, written by both pages). Projection, height
  scale, water level, terrain quality and fill-mode changes keep the cell and refresh its
  values/position; changing cell count, seed, relaxation or world profile clears it.
- Checks: 12 new `planet-map-picking.spec.ts` cases pass (flat/sloped hits, misses, start
  below surface, equirectangular round trip, Equal Earth lens rejection). Library and demo
  builds pass. Interactive browser verification (drag rejection, both projections, height
  scales, simplified preview) was **not** run because the standing instruction forbids
  starting a dev server; that remains the M3 visual-acceptance gate.
- Known test-environment failures: the default `triangular-engine:test-worldgen-render`
  compilation includes every spec and fails in `worldgen/core/planet-surface-bake.spec.ts`
  (`toHaveLength` missing on the typed-array matcher type); with a render-only include the
  suite runs and has one pre-existing `planet-view.component.spec.ts` failure (`toBe` used
  for deep equality). Neither is caused by this change.
- Unsupported parity: the 2.5D page still ignores the 2D `climate`/`season` restyle inputs,
  so selected-cell biome/temperature can differ between views for a non-default climate.
  Equal Earth is exercised only by unit tests here, not visually.

- **2026-09-15 — Real-scale planar adapter:** added a shared planet-size selector to the
  2.5D page (default `medium`, radius `600 km`) and derived the planar bounds from that
  radius instead of the previous `256 × 128` miniature footprint (about `40.7 m` radius).
  Height-source bounds, ocean surface, picking context, simplified runtime mesh and OBJ
  export now use the same physical bounds. Enabled `[logarithmicDepthBuffer]` and scaled
  camera framing/clipping. The clipmap's finest tile and morph distance now scale with the
  map width, preserving the old `256 × 128` ring proportions instead of leaving the real-size
  planet in ultra-coarse outer rings. `worldSize` is preserved in comparison query parameters.
- **2026-09-15 — Restore relief after the unit migration:** horizontal extent had grown
  while vertical offsets remained in miniature units. Scale baked elevation by the same
  circumference-to-256 ratio to restore mountain/seabed proportions at every size tier.
  Scale the ocean datum by the bake conversion and resize an existing water plane when
  changing size. Added regression checks for relative relief across tiers, negative seabed
  elevation and the zero/adjustable relief control. Visual acceptance remains pending.

- **2026-09-15 — Real-scale depth path:** the visible overlap/flicker persisted with the
  optional ocean layer disabled, so the terrain clipmap was the active suspect. Added
  Three.js logarithmic-depth shader chunks to the custom clipmap material's vertex and
  fragment paths, including the early flat-debug return. The renderer-level logarithmic
  depth setting now applies consistently to this ShaderMaterial as well as built-in scene
  materials. The existing clipmap layout tests continue to cover tile interior exclusion
  and boundary alignment; browser visual confirmation remains pending.

- **2026-09-15 — Legacy display comparison:** added a `Display scale` selector to the 2.5D page.
  `Planet scale (real metres)` remains the default and uses the selected body radius; `Legacy
  preview (old compact units)` restores the pre-real-scale `256 × 128` display bounds, direct
  relief units, camera framing and clipmap ring count. Both modes consume the same generated
  graph, elevations, ecology, colours and ocean mask, and the choice is preserved in the
  comparison query as `displayScale`.

- **2026-09-15 — Surface-focused debug camera:** replaced the plain `orbitControls` with the
  shared `raycastOrbitControls` used by `cdlod-planet-lab`. Its focus resolver intersects the
  CPU-baked planar height field (matching cell picking and GPU displacement), prefers the nearer
  visible ocean plane over seabed when applicable, and falls back to scene geometry before the
  first bake. Wheel zoom and rotate gestures therefore move toward the surface under the cursor;
  this remains temporary inspection navigation, separate from the future Civ-style camera.

- **2026-09-16 — Restore 0% clipmap detail at planet scale:** fixed the physical-scale terrain
  regression where the runtime clipmap still used a fixed `16 m` finest tile. At the default
  real-size footprint, that caused almost the whole visible map to render through very coarse
  far rings; the runtime simplification preview appeared to fix it only because it switches to
  the full baked surface. The 0% clipmap now derives its finest tile and morph distance from the
  map footprint, retaining the legacy fine/coarse coverage ratio while keeping the same quality
  preset grid resolution. The simplified preview also decodes the sRGB bake into linear vertex
  colours and explicitly uses opaque depth-writing material settings, reducing tint/brightness
  changes when toggling the preview.

- **2026-09-16 — Real-scale tile seam fix:** close inspection exposed a regular grid of dark
  lines after the tile footprint was scaled to planetary metres. Neighbouring instances were
  reconstructing a shared edge from separate large world-space float expressions, which can
  round to slightly different positions at real scale. Clipmap instances now carry their tile
  centre in tile-grid units; the shader adds the shared local coordinate first and multiplies by
  tile size once. This keeps same-level tile edges coincident while retaining the existing LOD
  layout and bounded draw count.
- **2026-09-16 — Scale-aware terrain normals:** the regular pattern remained in close planetary
  views because the custom material estimated slope with a fixed `0.5 m` height sample. The
  clipmap now derives that sample distance from the physical size of the baked height texel,
  sampling across roughly two texels to prevent the bake's cell boundaries becoming visible
  normal bands when the same bake covers a real-world planet footprint.

- **2026-09-16 — Procedural material baseline accepted; compression parity is next:** the current
  world-space macro noise variation is satisfactory for the stylized terrain direction, with
  adjustable strength and scale. A higher-priority issue remains in the runtime compressed /
  simplified terrain path: enabling mesh compression or simplification changes the visible
  material, removes the procedural noise overlay and makes the surface appear more opaque. The
  next investigation must make the compressed path preserve the same colour-space handling,
  material uniforms, blending and opacity as the normal clipmap before adding more texture detail.
