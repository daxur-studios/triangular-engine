# Terrain material texturing

Status: shared material contract, 2.5D coverage, globe material parity and first
macro variation prototype are in place; real cell terrain integration and streamed
material tiles are next. The overall product order is in [034 — Cell planet map
roadmap](034_cell_planet_map_roadmap.md).

The staged implementation handoff for streamed colour tiles, independent texture
LOD and game paint layers is now
[040 — Streamed terrain material tiles](040_streamed_terrain_material_tiles.md).
It starts with cached evaluated base colour and keeps additional live material
sampling subject to performance measurements. Its milestones are planned, not
completed capabilities.

This runbook tracks the shared surface appearance system for the 2.5D Cell
Planet map and the later cube-sphere planet. Geometry LOD, Meshoptimizer,
quadtree residency, and worker scheduling remain tracked in
[031_shared_planet_terrain_chunks.md](031_shared_planet_terrain_chunks.md).

## Goal

Make terrain remain crisp from planet overview to a regional Civ-style camera.
Biomes should blend into surface materials with readable transitions, while
rivers, ridges, shorelines, seabed, snow, cliffs, and future building edits can
contribute explicit masks. The same semantic source must work on a plane and on
the six faces of a sphere.

## Direction

Use three appearance scales:

- broad semantic coverage from the canonical planet sampler;
- streamed or baked macro material weights per terrain patch;
- procedural or authored high-frequency colour, normal, and roughness detail
  in the shader, anchored to planet-space coordinates.

Add a shared macro-variation mask between coverage and fine detail. It is a
low-frequency, irregular grayscale signal sampled in planet space and used to
vary hue, value, roughness, and detail strength inside a material layer. It
should be sampled at more than one physical scale, with a small amount of
rotation or coordinate offset where the mapping allows it, so tiled grass,
sand, rock, and snow do not reveal a repeating pattern at regional or planet
scale. Macro variation changes appearance; it must not move biome boundaries or
replace the semantic material weights.

Macro variation is material-aware: snow stays clean and cold, desert sand gets
dry colour variation, and grass can vary between greener and drier patches. Use
the same masks for foliage density later, so visible grass and spawned grass
agree. Keep the first shader pass to one shared macro lookup plus inexpensive
procedural detail; measure additional per-layer samples before adding them.

Material data stays independent of mesh topology. Geometry simplification and
LOD replacement must not destroy material detail. Plane renderers may use patch
UVs, while sphere renderers use cube-face UVs or a planet-direction mapping;
global equirectangular detail textures are unsuitable near the poles.

Continuous weights are used for visible blending. Discrete cell IDs and biome
names remain available separately for gameplay, selection, and diagnostics.
Texture tiles need mip levels, border gutters, and stable cache identity once
streaming begins. A tile is derived from world/generator/edit revision, face or
region, level, material version, and sampling format.

## Current implementation

`projects/triangular-engine/terrain/materials/terrain-material.ts` now defines:

- stable semantic layers: water, sand, grass, rock, and snow;
- `ITerrainMaterialQuery` inputs shared by planar and spherical adapters;
- `ITerrainMaterialSample` with normalized weights and wetness, ridge, river,
  snow, shore, and seabed masks;
- a pure `evaluateTerrainMaterial` reference evaluator;
- `packTerrainMaterialWeights` for a stable GPU/tile upload order.

This is a library contract and reference evaluator. It is not yet connected to
the CDLOD v3 shader or to a streamed texture provider.

## Next steps

1. Add a material lab using the existing fixed patch meshes. Show current palette
   versus blended weights, macro variation, and procedural detail at overview,
   regional, and close camera distances. Include ridge/river/coast/seabed and
   flattened-pad cases.
2. Prototype one shared planet-space macro mask with strength and scale controls.
   Compare it disabled, single-scale, and multi-scale, checking that the pattern
   stays fixed while the camera and geometry LOD change.
3. Add debug modes for each weight and mask, macro coordinates, cube-face seams,
   patch borders, texture coordinates, and material mip selection.
4. Define a `TerrainMaterialTileProvider` only after the lab identifies the
   required sampling density and shader cost. Use cube-face tiles for the globe
   and a projection adapter for the 2.5D view.
5. Integrate material tiles with the active LOD scheduler using independent
   material LOD and coarse-parent fallback. Invalidate tiles for the same edit
   support and blend margin as terrain chunks.
6. Add authored detail textures, normal/roughness channels, texture arrays or
   atlases, and optional compressed GPU formats after measuring the target
   browser path.

## Acceptance evidence

Record visual captures and measurements for matched plane/sphere locations:

- material transitions remain stable while geometry LOD changes;
- no visible cube-face seam or tile gutter seam;
- rivers and ridges can override or blend with biome materials;
- close detail does not become blurry when the camera moves;
- overview detail does not shimmer or repeat obviously;
- material generation, upload time, GPU memory, and frame time stay bounded;
- a local flatten edit updates both geometry and its material masks.

## Progress

- **2026-09-14 — Contract slice:** added the renderer-independent material
  query/sample model and a deterministic first-pass evaluator. Added normalized
  water/sand/grass/rock/snow weights plus separate wetness, ridge, river, snow,
  shore, and seabed masks. Exported it through `triangular-engine/terrain` and
  added unit coverage. Next: build the visual material lab before choosing a
  tile or texture-array implementation.
- **2026-09-14 — 2.5D debug view:** added `material` to `/cell-planet-25d-map`'s
  existing data-layer selector. The view blends the shared material palette per
  source cell using elevation, slope, moisture, temperature, ridge-cell, and
  nearby-river signals. It is intentionally a CPU-baked comparison mode, not
  yet the final streamed shader material.
- **2026-09-14 — Material calibration:** added explicit snow/ice and arid biome
  signals to the shared evaluator. The 2.5D adapter now maps ice caps/glaciers,
  tundra, deserts, steppes, and savanna into those signals; cold climate can
  produce snow below the altitude snowline, shoreline sand is narrower, and the
  debug palette is less saturated.
- **2026-09-14 — 2.5D ocean surface:** added a toggleable translucent sea-level
  surface to `/cell-planet-25d-map`. It uses the bake's land mask as an alpha
  mask, so the surface follows the generated coastline and leaves seabed relief
  visible when disabled. The existing `showOcean` comparison query parameter
  now preserves the setting across the 2D/2.5D view links.
- **2026-09-14 — Ocean alignment:** corrected the horizontal plane's V mapping
  to match the bake and clipmap world-Z convention. The ocean mask now overlays
  the same north/south land and water locations as the terrain colour map.
- **2026-09-14 — Dry-land coverage:** adjusted the shared evaluator so arid
  signals displace grass as well as adding sand. Full deserts now resolve mostly
  to dry ground, while steppe and savanna retain partial grass coverage. The
  2.5D material palette also uses the returned arid mask for a warmer desert
  tint. Next: compare these weights against a close-up detail treatment.
- **2026-09-15 — Macro variation direction:** recorded a planet-space,
  material-aware macro mask as the next detail prototype. It will break up
  repeated grass, sand, rock, and snow tiling across regional views while leaving
  semantic coverage and geometry unchanged. The first version should expose
  strength and scale controls and be tested across camera distances and geometry
  LOD changes before material streaming is designed.
- **2026-09-15 — Macro variation prototype:** added the first world-space shader
  breakup layer to the clipmap handle and 2.5D material view. It combines two
  rotated value-noise samples, exposes enabled/strength/scale controls, and
  persists those controls in comparison query parameters. It is restricted to
  the material view and conservatively suppresses variation over water and snow.
  This is still a visual prototype; packed material weights and streamed detail
  tiles remain future work.
