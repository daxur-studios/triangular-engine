# 040 — Streamed terrain material tiles and game paint layers

Status: staged implementation in progress, 2026-09-21. The fixed-geometry
material tile prototype is implemented; planetary tile streaming remains ahead.

## Outcome

Build reusable terrain appearance infrastructure that stays detailed as the
camera approaches, without tying colour detail to mesh density or repeatedly
evaluating the world generator in the fragment shader.

The engine owns tile selection, generation scheduling, caching, GPU residency,
filtering and overlays. Games supply terrain data, material rules and paint.
The first integration is the existing `cell-planet-morph-streaming` demo, using
the same world in globe, flat and intermediate morph views.

Required outcomes:

- Rivers and shorelines can have finer detail than broad biome coverage.
- Desert–grass and snow–grass transitions have distinct configurable rules.
- Local slope contributes cliff/rock coverage.
- Existing macro variation remains stable across zoom, projection and tile LOD.
- Texture refinement works while mesh topology is held fixed.
- Frequent territory recolouring does not rebake the ground material.
- Arbitrary game paint survives tile eviction and affects only relevant regions.
- Work, memory and shader cost remain bounded, including terrain filling the screen.

This is the next implementation plan for the concepts in
[033 — Terrain material texturing](033_terrain_material_texturing.md).
For this first delivery, cache **evaluated base colour**, rather than evaluating
every material layer in the live fragment shader. Semantic weights remain
available to the baker and diagnostic tools. Authored fine normal/roughness
textures can follow after measurements justify their cost.

Read [039 — App integration](039_cell_terrain_app_integration_contract.md) for
current renderer constraints and [035 — Unified delivery](035_unified_cell_terrain_delivery.md)
for the wider integration effort. Do not rewrite unrelated terrain systems.

## Working constraints

- Follow repository AGENTS.md. Preserve staged and unstaged work; do not commit.
- Work in `D:\code\triangular-workspace`. A BSP integration is a later consumer
  task, not part of this implementation's cross-repository changes.
- The user operates the browser. Do not open/control it, capture screenshots,
  or launch browser-based performance/visual automation. Provide demo controls
  and measurements the user can run. Browser-hosted tests need a separate
  handoff; report them as unrun when applicable.
- Build and run suitable non-browser checks. Never label builds as visual or
  GPU-performance validation.
- Keep existing comparison modes available. Do not silently replace an
  incomplete tile path with vertex colours and call it complete.
- Implement milestones in order. Continue independent implementation while
  browser evidence is pending, but do not claim a performance gate passed.

## Starting point and files to inspect

Paths below are relative to the repository root.

| Existing code | Role / constraint |
| --- | --- |
| `projects/triangular-engine/terrain/core/terrain-patch.ts` | Transferable mesh contract already includes UVs. Appearance should have its own lifecycle. |
| `projects/triangular-engine/terrain/domains/terrain-surface-domain.ts` | Generic mapping and hierarchy contracts. Reuse rather than assume every terrain is a cell planet. |
| `projects/triangular-engine/terrain/domains/lat-lon-terrain-domain.ts` | First integration's address space; longitude wraps, latitude has poles. |
| `projects/triangular-engine/terrain/streaming/terrain-generation-queue.ts` | Reusable priority queue, but not a complete in-flight job/cache manager. |
| `projects/triangular-engine/terrain/components/terrain-surface.component.ts` | Owns mesh residency and optional shared-material `BatchedMesh`. Preserve batching. |
| `projects/triangular-engine/terrain/materials/terrain-material.ts` | Existing weights, palette and macro reference functions. Extend intentionally. |
| `projects/triangular-engine/terrain/materials/terrain-macro-variation-material.ts` | Existing macro shader hook; avoid applying variation twice. |
| `projects/triangular-engine/worldgen/core/planet-surface.ts` | Canonical terrain sampling, including relief and features. |
| `projects/triangular-engine/worldgen/core/sample-elevation.ts` | Contains `findCellNear` and `sampleElevationNear`; reuse coherent sampling. |
| `projects/triangular-engine/worldgen/render/cell-per-pixel-material.ts` | Current fixed cell-ID atlas and cell-colour table; diagnostics only, not the final visual tile system. |
| `projects/demo-app/src/app/pages/cell-planet-morph-streaming/` | Worker, page and controls for the first integration and A/B comparison. |

At plan creation, material mode uses CPU-generated vertex colours; the
1024×512 nearest-filtered cell atlas is bypassed in that mode. Material colour
uses the continuous surface height, but slope still comes from a cell-level
ecology estimate. Preserve the recently fixed atlas north/south orientation.

## Architecture decisions

### Shared engine and game adapter

Add framework-independent contracts and scheduling under `terrain`, with the
Three.js upload/material adapter isolated from pure logic. Suggested modules:

```text
terrain/materials/tiles/
  terrain-material-tile.ts          # identity, payload, provider, configuration
  terrain-material-tile-baker.ts    # pure pixel sampling / filtering
  terrain-material-tile-cache.ts    # byte accounting, ownership, pinning, eviction
  terrain-material-tile-selector.ts # independent texture LOD and priorities
  terrain-material-tile-stream.ts   # requests, revisions, cancellation, completion
  terrain-material-tile-gpu.ts      # physical storage, mapping, bounded uploads
  terrain-material-tile-material.ts # bounded shader sampling and composition
terrain/materials/overlays/
  terrain-paint-layer.ts            # persistent paint contract and dirty regions
worldgen/render/
  cell-planet-material-source.ts    # worldgen-specific adapter
```

Names are proposed, not existing APIs. Adjust to local conventions without
changing responsibilities. Worker execution belongs in the host's worker
adapter; providers must not require cloning JavaScript callbacks into workers.
Use serializable style configuration and a registered evaluator in each worker.

Define contracts for:

- Tile address: domain/root or face, level, x, y.
- Identity: world ID/seed and generation revision, address, style revision,
  relevant local edit revision, layer, format and sampling version.
- Payload: interior size, gutters, explicit mip buffers, colour space, byte
  count, optional feature channels and generation timings; transferable arrays.
- Source: sample canonical terrain/material inputs, query local feature bounds,
  and evaluate the game's material recipe independently of mesh generation.
- Runtime: update view, set style, invalidate region, receive completions,
  resolve resident/fallback pages, update overlays, report stats and dispose.

A per-region edit must not change the key of every planet tile. Keep global
style/world changes distinct from regional revisions. Cache entries are derived
data, never the authoritative storage of game edits.

### Rendering and coordinate contract

Start with one RGBA8 colour tile format and explicit colour-space handling;
retain the existing lighting. The final shader samples cached colour. It must
not loop through cells, rivers, biomes or the entire ancestor chain.

Use shared physical texture storage plus bounded page-table indirection for
independent texture LOD. A texture array is the preferred first storage option
if the installed renderer supports the needed partial layer/mip uploads.
Otherwise use a padded atlas with correctly managed mip placement. Inspect the
local renderer API before choosing; avoid unsupported renderer internals.

Page-table entries resolve to the best resident ancestor on the CPU. Use a
bounded sparse mapping (for example, two-level indirection); do not allocate a
dense table at maximum planet resolution. Document exact addressing, maximum
supported depth, byte accounting and shader lookup count before implementing
this module. Target at most two mapping reads plus one base-colour read in
steady state; explicitly count any extra reads for LOD transitions or overlays.

Keep `BatchedMesh` compatible: common textures/material, with stable domain
coordinates or compact patch metadata. Avoid one unique material and draw call
per tile. A direct tile binding is acceptable in the isolated M2 fixture only.

Use domain coordinates mapped to canonical planet positions. Tile colour must
stay attached during flat/globe morphing and floating-origin rebasing. Avoid
reconstructing fine coordinates from imprecise large world-space floats; use
patch-local coordinates plus address metadata. Test the retained UV mapping
after mesh simplification. Never bake camera-space shading into colour tiles.

The first adapter may use the existing lat/lon domain. Handle longitude wrapping,
pole sampling and latitude distortion explicitly; this is not a giant global
equirectangular detail texture. Keep core storage/scheduling domain-independent
so cube-face and plane adapters can be supplied later.

### Sampling, filtering and feature detail

Tile texels are sampled directly from the shared terrain source, not interpolated
from the current mesh's vertex colours. Extend the full surface sampler with a
coherent/batch path if profiling requires it; preserve relief, river carving,
volcanoes and other contributions. Optimizing only the base elevation lookup
must not substitute a different terrain definition.

Compute physical slope from local height gradients with spacing in metres,
relative to the domain's local up direction. Use a documented sampling scale
so slope does not visibly change whenever texture LOD changes. Do not treat a
coarse cell slope or display height exaggeration as the canonical physical slope.

Start at 128 or 256 interior texels per tile, configurable for measurement.
Generate border support from the same world sampler. Gutters and mip support
must cover the actual filter footprint at each level; a small base-level gutter
alone does not guarantee seam-free mipmaps. Filter colour in linear space and
use the correct output encoding. Never bilinearly filter encoded cell IDs.

Source feature bounds prioritize visible coast/river tiles, while smooth regions
may accept coarser resolution. Refinement remains subject to the screen-space
error and memory budgets. Resolve narrow features using paths/masks and adequate
sampling; a distance mask does not recover a river omitted by the generator.
At overview, prefilter subpixel features instead of forcing them all to remain
one pixel wide or shimmer.

Biome edge breakup is a separate rule from existing macro colour variation.
Use deterministic noise in physical coordinates and transition widths in metres.
Do not randomly move physical coastlines away from the shared sea-level contour.
Water surfaces, river-bed geometry and silhouette accuracy remain geometry
responsibilities; colour cannot repair insufficient geometry resolution.

## Milestones

### M1 — Baseline, instrumentation and contracts

- [ ] Add comparison modes: existing vertex material, current cell diagnostics,
  and new cached visual material. Preserve the same mesh/lighting/view settings.
- [ ] Add a geometry-freeze control, texture-LOD/debug view, and repeatable
  overview/regional/close-up bookmarks. Include a coast, river and steep slope.
- [ ] Expose CPU selection time, queued/in-flight jobs, tile generation time,
  upload bytes/time, estimated CPU/GPU bytes, cache misses and fallback use.
- [ ] Add optional asynchronous GPU timing where supported. Reject disjoint
  samples; do not stall for query results. Label unavailable GPU timing honestly.
- [ ] Define pure contracts, lifecycle and initial budgets. Tests cover cache
  identity, stale results, cancellation and ownership before GPU integration.

Exit: the user can collect matched baselines; contracts distinguish texture
resolution from geometry and define bounded work. No performance claims yet.

### M2 — Detailed static tiles on fixed geometry

- [ ] Implement an independently sampled colour baker and worldgen adapter.
- [ ] Profile generation. Use coherent cell lookup / spatial feature indexing
  instead of a full graph or river scan for every texel. Test optimized full
  surface samples against the canonical sampler across borders and features.
- [ ] Implement distinct desert–grass and snow–grass blend rules plus local
  slope-driven rock. Make their parameters game configuration.
- [ ] Integrate macro variation exactly once. Bake static macro colour and
  masks initially; changing macro settings invalidates style tiles. Preserve
  enabled/strength/scale semantics and compare with the existing reference.
- [ ] Produce an adjacent-tile fixture with mips, gutters and known landmarks;
  show it on fixed coarse geometry, using direct bindings if helpful.
- [ ] Verify colour is independent of mesh resolution and coordinate orientation
  is correct. Record baker throughput and payload size for 128/256 tile sizes.

Exit: a static coast/biome/slope scene is sharper than vertex colour while
keeping the geometry fixed. This milestone is a proof, not planetary streaming.

### M3 — Independent texture LOD and bounded planetary residency

- [ ] Implement shared GPU storage and the documented bounded mapping scheme.
  Verify actual partial uploads; do not re-upload the entire pool per dirty tile.
- [ ] Select texture tiles from projected texel size, view/projection and feature
  need, with hysteresis. Reuse domain addressing but select independently from
  the geometry quadtree. Multiple texture children must cover one unchanged mesh.
- [ ] Maintain coarse root coverage. A missing child resolves to a resident
  ancestor with the correct UV scale/offset; never display holes or uninitialized
  memory. Pin fallback pages while needed.
- [ ] Add independent, bounded worker requests and uploads. Avoid allowing a
  large texture bake to block geometry work indefinitely; chunk work or allocate
  a bounded dedicated worker. Count replicated world data in memory estimates.
- [ ] Deduplicate in-flight requests, reject stale revisions, and cancel or
  discard obsolete work. Account for CPU completed queues as well as GPU pages.
- [ ] Implement LRU eviction, safe slot reuse and disposal. Make a new page
  visible only after its payload is uploaded; redirect mappings before reuse.
- [ ] Add filtered LOD transitions and cross-tile/ancestor seam handling. Limit
  extra transition reads to documented cases and include them in benchmarks.
- [ ] Verify batching, morph projection, simplification, antimeridian and poles.

Suggested initial tuning values, not promises: 256 interior texels, a 64 MiB
GPU material budget including mappings/mips/overlays, a separate 64 MiB CPU tile
budget excluding explicitly reported world data, at most two tile jobs in flight,
and a configurable 1 MiB upload allowance per frame. Include gutters and mips
when calculating real capacity. Reduce work when measured costs exceed budgets.

Exit: freezing the mesh does not freeze texture refinement; zooming/panning
converges to detailed tiles with bounded memory and preserved draw-call batching.

### M4 — Rivers, shores and material feature composition

- [ ] Add spatially indexed feature inputs for river paths/widths/banks and
  shoreline masks from the shared height/sea-level source.
- [ ] Compose water/seabed, shore, biome, rock/snow and feature overrides in an
  explicit documented order. Preserve access to semantic masks for diagnostics.
- [ ] Add a volcano/other-colour override example to prove the game can extend
  the recipe without editing the streaming engine.
- [ ] Refine tiles containing visible thin features sooner than smooth interiors
  within the same hard budgets; test narrow-feature filtering at overview.
- [ ] Show stable transitions across texture LODs. Coarser geometry may still
  approximate a detailed shoreline; expose the geometry comparison rather than
  disguising the mismatch with extra water colour.

Exit: rivers and shores are controlled features; slope and biome blending are
independently configurable, and detail remains stable during movement.

### M5 — Fast game paint layers

Implement two distinct mutation paths, with configurable order and opacity:

1. **Territory/cell overlay:** tiled nearest-sampled cell IDs plus a compact
   cell-ID-to-RGBA table. A cell recolour updates the table, not material tiles
   or geometry. Keep IDs independent of visual biome blending. Generate accurate
   cell masks from the graph at requested tile resolution; do not upscale the
   old 1024×512 ID atlas and call it detailed. Define categorical minification
   separately from continuous colour filtering. Allow one active territory
   overlay initially, and no overlay sampling when disabled.
2. **Arbitrary colour paint:** a persistent game-owned edit source plus sparse
   overlay tiles. Brush edits use canonical domain positions and physical sizes;
   dirty only intersecting tiles and filtering margins, including coarse
   ancestors/mips so the edit also appears from orbit. Keep affected parents
   pinned/updateable until their visible descendants are ready.

- [ ] Public mutation contract supports batched cell recolours and regional
  paint invalidation without global style invalidation.
- [ ] First paint modes: alpha-over colour and multiplicative tint. Document
  whether overlays appear before or after lighting; default to lit surface paint.
- [ ] Provide a bounded temporary preview for interactive strokes while baked
  overlay tiles catch up. Limit preview work to the brush region, and retire it
  on matching revision completion. Never accumulate every stroke in the shader.
- [ ] Persist edits independently from resident tiles; eviction/reload and
  repainting during in-flight generation must preserve the newest result.
- [ ] Add a demo territory palette and a simple paint/erase brush. Prove two
  style configurations use the same runtime without engine changes.

Exit: territory recolouring needs no rebake; brush paint remains responsive,
survives eviction and is visible at coarse and fine LODs. Runtime layer count
and additional texture samples are explicitly bounded.

### M6 — Reusable API, verification and delivery

- [ ] Export intentional APIs through `terrain/public-api.ts`; keep cell-specific
  adapters in `worldgen/render/public-api.ts` and framework-free world sampling
  in worldgen core. Do not couple the generic cache to ecology or Angular state.
- [ ] Add a minimal plane fixture as a second domain consumer. Test the generic
  provider/cache with synthetic game data, not only the planet demo.
- [ ] Document consumer setup, worker registration, coordinate conventions,
  ownership/disposal, budgets, style changes, painting and cache invalidation.
- [ ] Update terrain README, relevant API docs and CHANGELOG. Cross-link this
  runbook with 033 and 039 as capabilities actually land, not prospectively.
- [ ] Check the architecture token map when expanding library coverage.
- [ ] Finish narrow tests, the library build, demo build and `git diff --check`.
  Leave all work uncommitted and preserve unrelated edits.

## Verification and performance gates

Add colocated tests for actual failure modes:

- Stable coordinates and orientation, antimeridian/pole handling, border samples.
- Optimized sampler equivalence, physical slope and deterministic material rules.
- Texture LOD changing while geometry is fixed; parent fallback UV transforms.
- Mip/gutter construction and filtered boundaries using synthetic known signals.
- Byte limits, pinned fallback eviction, stale completion and slot reuse races.
- Rapid style changes, cancellation, disposal and repeated world replacement.
- Regional paint revisions, ancestor updates, persistence after eviction, and
  territory recolouring causing no base tile jobs.
- Shader composition with morph, macro and lighting; batching attributes intact.

Use existing test targets where appropriate. The repository's default Karma
targets launch ChromeHeadless: do not silently run these under the user's current
browser restriction. Use an existing non-browser runner where available or
provide the exact narrow test handoff. Do not build an unrelated test platform.

Build commands:

```powershell
npm run build:triangular-engine
npx ng build demo-app
git diff --check
```

Give the user A/B controls and an exportable measurement report. Fix camera,
viewport, device pixel ratio, geometry, lighting, macro settings and rendering
options. Measure overview, regional, terrain-fills-screen, grazing coast,
continuous travel, rapid zoom/teleport, morphing and paint while streaming.
Record warm-cache and cold-cache results separately, median and p95 frame times,
GPU time when supported, generation throughput, upload spikes, memory and draws.
Report vsync/frame-cap limitations; a displayed 165 FPS is not proof of GPU headroom.

Provisional acceptance targets on the user's machine at the recorded resolution:

- Cached visual material adds no more than about 1 ms median GPU time over the
  matched vertex-colour baseline with terrain filling the screen and overlays off.
- Main-thread texture management/upload submission targets under 1 ms p95;
  also measure GPU upload costs and overall frame tails separately.
- No persistent growth beyond configured cache/queue limits after travel/edits.
- No steady-state per-frame rebakes; static camera/world settles to no tile jobs.
- No material-induced increase in mesh triangles and no per-tile draw-call explosion.
- Sharpness increases with texture refinement; no obvious seams, inversion,
  swimming noise, lost paint, or recurrent severe frame-rate drop.

These are proposed budgets to test, not guaranteed results. Measure overlay cost
separately. If a gate fails, isolate sampler, upload, mapping, macro, overlay and
lighting costs before adding features. Do not lower viewport resolution, disable
lighting, or inflate geometry to make the comparison appear successful.

## Delivery checkpoints and non-goals

Each milestone ends with a short record of implemented files, checks actually
run, user-visible controls, known limits and next work. Keep this checklist
updated. Missing user-run visual/GPU evidence stays explicitly pending.

The first reviewable delivery is **M1 + M2**. The first planetary streaming
delivery is **M3**. Completion of the requested reusable system includes **M4–M6**;
the early fixture must not be presented as that finished system.

Defer authored PBR texture libraries, unbounded material layers, all terrain
backends, disk-cache formats, multiplayer paint synchronization, animated river
water and geometry editing tools. Provide extension boundaries for them without
implementing speculative systems. No new browser automation infrastructure.

## Progress

### M3 bounded array implementation contract (2026-09-21)

The next slice replaces the demo's four-region atlas, not its mesh LOD.
Use 128-texel interiors with two sampled gutter texels, 128 RGBA8 array layers
(8.51 MiB each CPU/GPU), and levels 0–10 of a unit-square quadtree. A 32×32
RGBA32F directory maps directly to resident ancestors or to one of 128 sparse
32×32 RGBA32F leaf tables (2 MiB each CPU/GPU). No dense level-10 table.
Directory entries encode `(slot, level, x, y)`; a negative slot encodes a leaf
table index. The CPU resolves ancestors. The shader performs one or two nearest
mapping reads and one bilinear colour read, with no cell or ancestor search.
The installed Three.js DataArrayTexture.addLayerUpdate path uploads individual
layers through texSubImage3D; do not set needsUpdate without marking layers.

Selection has an independent screen-space target, hysteresis, bounded traversal,
and a bounded desired set including ancestors. One material request is in flight
at a time. Root coverage is pinned; unused pages are LRU-evicted. World revisions
discard stale completions; camera/geometry changes never invalidate material data.
The slider controls screen-space detail, not an entire-world bake resolution.
Initial array sampling deliberately uses level zero with bilinear filtering:
this removes atlas/gutter derivative jumps, but filtered minification and smooth
cross-LOD transitions remain an explicit M3 follow-up, not a completed seam gate.

River-bed colouring belongs to M4's canonical river path/width/bank layer.
Actual carved beds must use the same river definition in the height sampler;
arbitrary interactive river authoring/carving is not implied by a colour overlay.
User reports the random cell recolour stress test updates quickly; this is useful
manual feedback, not a measured GPU performance gate.

- **2026-09-20 — M1/M2 core slice:** added serializable tile identity and payload
  contracts, a linear-RGB RGBA8 baker with sampled gutters and CPU-generated
  mip levels, a byte-bounded pinned LRU cache, and a single-tile Three.js
  material adapter. These are exported from `triangular-engine/terrain` and
  are ready for a fixed-geometry harness. The production page-table storage
  and streaming worker integration remain M3 work. `npm run
  build:triangular-engine` and `npx ng build demo-app` pass for this slice;
  browser/GPU evidence is still pending.
- **2026-09-20 — Fixed-geometry demo prototype:** material mode in
  `cell-planet-morph-streaming` now receives one worker-baked 256×256 global
  colour tile with gutters and mips, and samples it through the shared material
  while the mesh remains unchanged. The tile is generated once per world/style
  revision and macro variation remains a separate shader layer. This proves the
  independent texture path; it is intentionally not the final close-up solution.
- **2026-09-21 — Detail comparison control:** the demo now exposes a 64–1024
  material-tile resolution slider. It invalidates the material prototype's
  material request revision after a short debounce, requests the selected
  resolution independently, and leaves mesh resolution unchanged. This is a
  measurement control for choosing a default; it is not yet independent
  planetary tile LOD.
- **2026-09-21 — M3 first vertical slice:** material baking now uses a dedicated
  worker request path and worker instance, so mesh generation can return without
  waiting for the material image. The page requests a 128×128 coarse tile first,
  keeps the current resident tile bound, then refines to the selected resolution
  with stale-result protection. Moving the detail slider no longer rebuilds the
  terrain mesh. The material mode also has a small faction overlay proof: a
  geographic cell-ID atlas is requested separately and a cell-to-colour palette
  can be replaced in place without rebaking base material tiles or geometry.
  This remains a fixed global tile prototype: page-table indirection, local
  planetary tiles, visible-region selection and bounded GPU residency are still
  unfinished M3 work. Browser/GPU timing evidence remains pending.
- **2026-09-21 — M3 regional refinement slice:** material mode now assembles a
  fixed 2×2 regional atlas. Four small fallback pages are generated before the
  atlas becomes visible; selected-resolution pages then update one region at a
  time while the previous resident atlas remains bound. The worker samples each
  region directly from the canonical surface rather than cropping the old global
  image. This is still a demonstrator: camera-driven selection, arbitrary tile
  depth, page-table indirection and bounded eviction remain unfinished.
- **2026-09-21 — Dynamic cell edit harness:** the demo now includes a seeded
  random cell-colour stress control with an edits-per-second slider. It batches
  palette entries into one DataTexture invalidation per tick and reports edit
  count, elapsed time and CPU update time. This verifies the fast categorical
  palette path; arbitrary paint tiles and regional feature invalidation remain
  later work.
- **2026-09-21 — Regional atlas upload correction:** fixed incorrectly sized
  mip buffers that compressed visible colour into a strip and left most of the
  atlas empty. Regional atlases now upload their complete base image and let
  the GPU generate correctly sized mip levels; independently halved guttered
  pages cannot always be packed into a valid atlas mip. The single-tile adapter
  now includes level zero in Three.js's explicit DataTexture mip array. Regional
  UVs also use both atlas dimensions and match the baker's texel-centre convention.
  Node-run regression tests cover full atlas coverage and explicit mip layout;
  browser visual confirmation remains with the user.
- **2026-09-21 — Geographic fallback during atlas resize:** replaced the first
  arriving tile's duplication across all four pages with resampling of each
  existing page into the resized atlas. Resampling preserves local geographic
  coordinates and gutters; only the arriving region receives new detail.
  Regression tests cover growth, shrinkage, out-of-order arrivals, and changing
  gutter sizes. Initial coarse coverage is still assembled before display.
