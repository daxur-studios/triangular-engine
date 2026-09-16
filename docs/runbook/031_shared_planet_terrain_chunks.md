# 031 — Shared planet terrain: Meshoptimizer and quadtree chunks

## Status and ownership

- **2026-09-13: design recorded; implementation and acceptance pending.**
- Goal: evaluate irregular, simplified terrain meshes in a quadtree for the 2.5D
  cell map and a later spherical map, including local terrain flattening.
- [022 — Cell planets](022_v4_voronoi_cell_planets.md) owns world generation and
  ridge/river meaning. [030 — 2.5D map](030_cell_planet_25d_map.md) owns the planar
  adapter, controls and map experience. This document owns the shared chunk experiment,
  edit contract, LOD, caching and evidence for adopting or rejecting the approach.
- [028 — Terrain history](028_planet_terrain_attempt_history.md) records earlier
  failures and results. A new quadtree must address its seam, residency, draw-call and
  frame-time findings; fewer triangles alone do not establish an improvement.

## Proposed approach

Keep the world snapshot and deterministic surface sampler authoritative. Apply persistent
terrain edits to that surface, then generate bounded chunks and simplify their indexed
geometry with Meshoptimizer. The quadtree selects large coarse regions at distance and
smaller detailed regions nearby. Rendering chunks are independent of gameplay cells.

Generate coarse coverage first and detailed chunks on demand in workers. Keep a bounded
memory cache; add IndexedDB reuse after generation and invalidation are correct. Do not
require a full-resolution planet bake before the first view. The existing clipmap is the
comparison baseline while this candidate is evaluated, not a required final architecture.

Meshoptimizer supplies simplification, not the scheduler, seam handling or renderer.
Its use here is for runtime terrain; the existing export workflow is separate.

## Shared contracts

- **Surface identity:** world seed/settings and generator version identify the base
  snapshot. Sampling a planet direction with the same detail and edit revisions gives
  the same canonical result regardless of camera, LOD or view.
- **Units and adapters:** keep the dimensionless planet core and convert metres at the
  boundary, including edit widths and error tolerances. Apply visual height exaggeration
  in the display adapter and include it in mesh/error cache identity when baked in.
- **Plane and globe:** share surface data, edits, scheduling concepts and diagnostics.
  Start with planar patches; evaluate six cube-face quadtrees for the globe later.
  Final meshes, bounds and error estimates are adapter-specific: globe curvature matters.
  Handle planar projection footprints/wrapping and cube-face edges explicitly.
- **Chunk result:** identify region, level, source/edit revision and adapter; return indexed
  geometry, bounds, boundary metadata, geometric error and resource-size diagnostics.
  Keep colour modes independent of terrain topology where practical. Preserve discrete
  cell identity through surface queries rather than interpolating cell IDs.
- **Queries:** canonical height and placement queries use the edited sampler. Visible-mesh
  picking may use the resident triangles with a documented approximation error. Skirts
  are visual gap covers and must not become selectable ground or collider walls.

## Terrain edits: first use case

Store a flatten operation as an ID, planet-surface anchor and local orientation, circle
radius or rectangle dimensions, target elevation and blend width. Define deterministic
overlap order and support removing an edit. Persist edits separately from disposable meshes.

For the first fixture, use constant canonical elevation inside the footprint and a smooth
blend outside. On a globe this is a constant-altitude patch, not an exact tangent-plane
foundation; true planar foundations are a later explicit edit mode if needed.

Invalidate chunks intersecting the whole support area, including the blend and normal-sampling
margin, and their coarser ancestors. Publish compatible boundary revisions together; discard
stale worker results. Show a responsive placement preview while replacement meshes build.
Protect pad interiors/boundaries during simplification and verify their final flatness.

Initially reject edits intersecting reserved river corridors; do not silently claim that
mesh regeneration recomputes drainage. River rerouting, ocean reclamation, caves, full
building gameplay and physics/contact resolution are outside the first prototype.

## LOD, seams and resource lifetime

- Select detail by projected geometric error for both orthographic and perspective cameras,
  with hysteresis to avoid repeated switches. Include sampling, simplification and adapter
  curvature error; the simplifier's reported error is not the entire surface error.
- Begin with adjacent levels differing by at most one. Use deterministic shared edge
  samples and protected boundaries. Prototype skirts for mixed-level gaps, then evaluate
  explicit stitching if artifacts remain. Border locking alone does not guarantee a
  parent edge matches two child edges. Check normals and material seams as well as positions.
- Keep a covering parent resident until all replacement children and required neighbours
  are ready. Commit replacements together; avoid holes or overlapping drawn surfaces.
  Do not evict visible coverage or resources needed by an in-flight replacement.
- Bound worker concurrency, queued work, CPU/GPU bytes and uploads per frame. Version jobs,
  drop obsolete results and dispose resources on replacement/unmount. Initially measure
  ordinary chunk draws; choose batching only after evidence, accounting for all passes.
- Cache by world/generator identity, local edit dependencies, region/level, adapter,
  sampling/simplification settings and cache format version. Unaffected chunks should
  remain reusable after a local edit. IndexedDB failures/eviction fall back to generation;
  persistent cache storage is not the only copy of world edits.

## Milestones and acceptance

| Step | Deliverable | Evidence required |
| --- | --- | --- |
| C0 — Small fixture | Adjacent planar chunks at two levels; mountain ridge, river and circle/rotated-rectangle pad; unsimplified and Meshoptimizer views | Deterministic sampling; pad and protected-feature error; boundary checks including corners; triangle/vertex counts, worker time and bytes before/after |
| C1 — Dynamic coverage | Quadtree selection, background generation, parent fallback and edit replacement | Camera pan/zoom/teleport and delayed/failed jobs cause no coverage holes; stale results rejected; hysteresis stable; bounded residency and upload work |
| C2 — 2.5D integration | Compare candidate and clipmap with identical world/settings; colour modes, projection and height scale retained | Standard/Ultra captures at matched visible error; terrain and total draws, frame-time percentiles, build latency and peak memory; ridge, coast and seabed retention |
| C3 — Cache | Bounded memory reuse and versioned IndexedDB chunks | Cold/warm revisit timings; local edits/settings invalidate correct entries; eviction/quota failure recovery; persistent edit reload |
| C4 — Globe fixture | Coarse global coverage and local refinement on sphere | Cube-face edge/corner and mixed-LOD seams; orbital-to-near transitions; curvature error, precision and edit parity across views |

Before each benchmark, record hardware/browser, viewport, world radius/seed, quality,
camera path and numeric error/frame-time/memory budgets. Distinguish targets from measured
results. For C0, sweep requested simplification ratios and error tolerances; report achieved
reduction since protected features may prevent reaching the target. Validate error against
dense reference samples and feature fixtures, not only Meshoptimizer's estimate.

Adoption requires preserved geography and edits, acceptable transitions, bounded resources
and a measured benefit at matched visual quality. A planar fixture does not establish
whole-planet acceptance. Smooth irregular-mesh morphing and clustered/Nanite-like rendering
are later options, not prerequisites for the first experiment.

## Implementation handoff and progress

Inspect current `worldgen` surface sampling and `terrain` chunk/LOD implementations before
adding mechanisms; reuse suitable code and explain departures from 028. Keep reusable
implementation behind intended library entry points and demo code focused on controls and
fixtures. Verify the installed Meshoptimizer API and declare an intentional dependency when
implementation begins. Preserve concurrent staged/unstaged work; do not start a dev server
unless the user changes their standing instruction.

For each step append a short dated entry: change, automated checks, visual evidence, measured
result and next action. Update 030 for map integration and 028 for substantive experiment
findings. Do not duplicate the full progress log across documents.

- **2026-09-13 — Plan created:** selected Meshoptimizer + quadtree chunks for evaluation,
  with a shared edited surface, explicit mixed-LOD boundary tests and staged caching/globe
  work. Added the optional `triangular-engine/meshoptimizer` entry point and switched the
  2.5D runtime inspection slider to its indexed simplifier; the base terrain entry point
  remains dependency-free. Next: C0 fixture and measured simplification/feature-preservation
  results.
- **2026-09-13 — C0 fixture implemented:** added the browser route
  `/terrain-chunk-optimizer-lab` with four adjacent planar chunks sampled from one
  deterministic ridge/river field. Each chunk is simplified independently with a different
  reduction level. `LockBorder` protects topological chunk boundaries, while the optional
  `lockedVertices` mask protects semantic ridge/river samples. The fixture reports source and
  achieved triangle counts plus missing referenced boundary vertices, and exposes toggles for
  both protection layers. Library and demo builds pass; visual seam checks and measured
  simplification/feature-error results are still pending. Next: run the C0 visual matrix,
  then add explicit mixed-resolution stitching if border locking alone leaves T-junctions.
- **2026-09-13 — C0 visual check passed:** manually tested the fixture with boundary locking
  on/off and feature protection on/off. Locked borders showed no holes; unlocked borders
  exposed the expected seam/hole risk. Higher reduction produced visibly more decimated
  chunks, while protection kept the ridge/river detail available. Same-level boundary
  protection is therefore behaving as intended. Next: test a mixed-resolution parent/child
  boundary, because `LockBorder` does not by itself stitch one coarse edge to two finer edges.
- **2026-09-13 — C0 mixed fixture added:** extended the lab with a mixed layout containing one
  level-zero chunk beside two level-one children, an optional visual skirt, and a toggle for
  same-level versus mixed-level coverage. Added a deterministic circle/rectangle flattening
  edit with a blend band and a maximum pad-error diagnostic. The panel now reports source and
  referenced vertices, mixed seam samples, pad error, and the existing triangle/boundary/
  feature results. Library and demo builds plus `git diff --check` pass. Next: visually inspect
  the mixed layout with skirts off/on and record whether explicit transition stitching is
  required; then add a dense-reference error comparison before moving to quadtree streaming.
- **2026-09-13 — C0 mixed visual check passed:** browser smoke-tested the existing demo route
  without starting a server. Mixed LOD with borders locked reported `0` missing seam samples;
  flattening reported `0.00m` maximum pad error for both circle and rectangle modes. With
  borders unlocked and skirts off, the fixture reported `37` missing seam samples, confirming
  the diagnostic failure path. The next seam question is now visual T-junction and shading
  quality, rather than basic coverage holes. Next: add dense-reference height/feature error
  measurements and decide whether explicit transition triangles are needed beyond skirts.
- **2026-09-14 — C0 seam fixture corrected:** removed skirts from the optimizer lab render path
  because they added a second draw per chunk and extruded along terrain normals, producing
  sideways protrusions on steep mountains. The mixed layout now covers the same 1,024m square
  as the same-level layout: one coarse half plus four fine children. The coarse boundary uses
  the fine child sample spacing, with `LockBorder` retaining the shared samples, so the seam
  remains in the surface mesh. The diagnostic now compares referenced world-space edge samples
  and reports missing samples plus maximum height delta. Library and demo builds pass. This is
  still a bounded C0 fixture; camera-driven quadtree residency, worker scheduling and larger
  area stress evidence remain outstanding.
- **2026-09-14 — mixed footprint corrected:** the mixed fixture now keeps three level-zero root
  chunks and replaces the fourth root with its four level-one children. This gives the same
  footprint as the four-root reference, keeps the ridge, river and flattening area visible, and
  exercises coarse/fine joins on both axes. Added a separate coverage diagnostic for missing and
  overlapping cells; seam validation now checks every shared fine/coarse edge.
- **2026-09-14 — C0 fixture clarified:** fixed reduction assignment for all seven mixed-layout
  chunks, added per-level source/rendered triangle counts, and colour-coded coarse L0 versus fine
  L1 boundaries. Added a compact in-panel explanation and suggested test order so the fixture's
  purpose is explicit: it validates footprint coverage, parent/child seams, simplification and
  feature/edit preservation before camera-driven quadtree streaming. Next: add a camera-driven
  selection fixture only after this controlled lab's measurements are understood.
- **2026-09-14 — C0 quality comparison added:** the fixture now applies one selected reduction
  target to every chunk, keeps source and simplified meshes available for a same-camera swap,
  supports neutral shading, reports dense-sample overall and feature-region surface error, counts semantic locked vertices,
  and can show those locked points. Added deterministic ridge/river, volcano/crater, mesa and
  branching-channel presets so protection can be evaluated against sharper geological features.
  Library and demo builds pass; visual comparison across presets is the next evidence to record.
- **2026-09-14 — reduction range aligned:** raised the C0 fixture's maximum reduction slider from
  90% to 95%, matching the optional Meshoptimizer entry point's documented and enforced limit.
- **2026-09-14 — C1 streaming slice started:** the shared terrain surface now establishes a complete
  coarse root cover before camera refinement and commits a replacement cut atomically, keeping the
  previous resident cut visible until every selected patch is ready. Default visual skirts are now
  disabled; they remain an explicit opt-in for consumers that need them. Added
  `/terrain-chunk-streaming-lab`, a 16 km planar fixture with 16 roots, up to five LOD levels,
  asynchronous Meshoptimizer simplification/vertex compaction, quality presets, LOD colouring,
  wireframe inspection, configurable build delay and live desired/resident/queue/draw/triangle/byte
  diagnostics. This is an initial C1
  coverage and residency experiment; worker execution, exact transition stitching, bounded eviction
  and spherical coverage remain outstanding. Next: validate camera movement and delayed replacement,
  then add focused tests for atomic commits and stale-result rejection.
### 2026-09-14 — Mixed LOD edge sampling wired into C1 streaming

The shared `TerrainSurfaceComponent` now compares the selected rectangular
patch bounds each update. A coarse patch beside finer selected neighbours gets a
generation key containing its edge mask and level delta, and is generated at
matching edge sample spacing (`resolution * 2^delta`). `LockBorder` then keeps
those shared samples during independent Meshoptimizer simplification. This
removes the streaming lab's mixed LOD seam gaps without skirts or seam draw
calls. The first implementation uses a uniform higher-resolution grid for the
affected coarse patch; edge-only transition topology remains a later memory
optimization.

### 2026-09-14 — Streaming seam and LOD colour diagnostics corrected

The streaming material now enables vertex colours and a colour revision rebuilds
resident chunks when the LOD-colour toggle changes. Transition chunks temporarily
retain their full matching-edge topology while the mixed-LOD seam is validated;
ordinary chunks continue using the selected Meshoptimizer reduction. This keeps
the seam test free of skirt geometry and extra draw calls while isolating any
remaining gap from interior simplification.

### 2026-09-14 — Streaming transition boundary correction

The first C1 transition pass raised an affected coarse chunk's whole grid to its
finest neighbouring spacing. That fixed its coarse/fine side but also curved its
other edges more densely than same-level neighbours, creating new cracks. Patch
generation now records the level and normalized span of every finer neighbour
along each edge, then conforms each section to its required piecewise boundary.
This also handles one edge bordering different neighbour levels. `LockBorder` can therefore
preserve matching topology while all chunks use their configured Meshoptimizer
reduction. Added a `freezeLod` surface input and streaming-lab toggle for fixed-cut
inspection. Automated mesher coverage compares both a refined coarse/fine edge
and an ordinary edge on the same transition chunk. Next: visually verify frozen
overview and close-detail cuts, then measure transition geometry overhead.

### 2026-09-15 — C1 seam fix verified

The frozen overview and close-detail cuts now render without the reported black
openings, including mixed LOD cuts around the ridge and river test features. The
LOD-colour mode is now flat and unlit so dark feature shading cannot be confused
with a missing surface. The freeze control is retained as a repeatable inspection
tool. The main lesson is that `LockBorder` only preserves vertices that already
belong to a compatible boundary; it cannot repair mismatched sampling by itself.
The streaming implementation must keep coverage, per-span boundary sampling,
and simplification as separate checks. Library build, demo type-check and diff
validation pass; the full terrain test command remains blocked by the unrelated
existing `planet-surface-bake.spec.ts` `toHaveLength` type errors. Next: measure
transition geometry overhead and test worker-backed generation at larger coverage.

### 2026-09-15 — C1 coverage comparison added

The streaming lab now has an explicit Coverage control for the original 16 km
root footprint and a 32 km footprint made from 64 level-zero roots. Both use
the same deterministic ridge, river and volcano field, while the overview
preset scales with the selected footprint. This makes larger-area residency,
parent fallback and generation-queue behaviour observable without changing
the terrain source or the seam algorithm. The 16 km view remains the default
for quick inspection. The panel also reports the last and peak mesh-build time
so coverage and quality comparisons have a direct timing signal. Next: record
resident-chunk, generation-time and memory measurements while moving between
the two coverage sizes, then move generation work into workers.

### 2026-09-15 — whole-sphere scale fixture added

Added `/planet-terrain-sphere-lab` as the next C1-scale test. It covers all six
cube faces with `SphereTerrainDomain` and the production sphere quadtree selector,
using one deterministic `PlanetTerrainField` sampled from unit-sphere directions.
The fixture deliberately includes several continent masses, two long mountain
belts plus an island belt, volcanic peaks, a mesa, a crater, and river-valley
channels, so whole-planet, regional and close-detail views exercise more than a
single flat planar feature. It has standard/high/ultra resolution presets,
whole/region/close camera presets, freeze LOD, wireframe, LOD/elevation/geology
colour modes, and live residency/triangle/geometry/LOD diagnostics. Skirts are
disabled. The field is currently demo-owned and main-thread generated; it is a
shared-sampler candidate for the 2.5D cell map after its geography is accepted,
not yet the production cell-planet worldgen source.

Verification: `npx ng build demo-app` passes. The field has colocated deterministic,
batch-sampling and feature-channel tests; visual acceptance and performance
measurements still require the user's existing local demo session. Next: inspect
whole/region/close sphere coverage, then move patch generation to a worker and
measure globe residency before adapting the same field to the 2.5D view.

### 2026-09-15 — sphere lab frame-time correction

The first sphere lab build exposed a frame-time problem: its generic rectangular
edge-mask pass ran on every frame and could compare unrelated cube faces because
their UV bounds overlap. The sphere domain now supplies exact same-level
neighbours, so sphere edge refinement uses topology-aware lookup and direct child
checks. TerrainSurface also caches edge masks and skips selection when the camera
and LOD inputs are unchanged. The sphere lab's patch generation now runs through
a worker, with typed-array buffers transferred back to the renderer; colour-mode
changes increment the colour revision so resident patches refresh correctly.

Measured in a local Node fixture with the previous whole/region/close camera
positions: sphere edge-mask work fell from about 23/23/61 ms to about 6/8/18 ms
for the tested cuts. `npx ng build demo-app` passes. Browser FPS and worker
residency still need visual confirmation in the user's existing demo session.

### 2026-09-15 — sphere detail budget and planet scale controls

The first close-surface test still allowed the sphere selector to expand toward
the configured maximum level, producing thousands of desired patches and an
8,000-job queue. Sphere selection now refines the highest screen-error leaf
first and enforces an explicit patch budget before seam balancing. The sphere
lab uses 48, 96 and 96 selected-patch caps for standard, high and ultra; this
keeps the initial experiment bounded while leaving the maximum LOD available
for later tests. A regression test verifies the selector stays within a
configured budget.

The lab also adds small (5 km radius), Moon-scale and Earth-scale presets. View
camera positions scale with the selected radius, worker domain construction
uses the selected radius, and the scene enables logarithmic depth buffering.
These controls test planetary scale and depth precision separately from terrain
detail. Each patch still has its own render mesh, so batching remains the next
draw-call reduction step after this bounded-selection pass. The follow-up now
uses an optional shared Three.js `BatchedMesh` in `TerrainSurfaceComponent`;
the sphere lab enables it by default and exposes a comparison toggle. The
resident patch meshes remain independently generated, but same-material
surfaces share one render batch. Skirt geometry is still excluded from this
batch path.

### 2026-09-16 — progressive worker-backed LOD commits

The sphere lab could remain visually unchanged while the camera moved because
TerrainSurface waited for every patch in the next complete cut before replacing
the current cut. A moving camera could therefore keep invalidating a large
replacement before the slowest worker result arrived. Completed worker patches
are now retained across selection changes and excluded from duplicate queue
work. Replacement commits are progressive but coverage-safe: all desired
children replacing one resident parent must be ready together, while a ready
parent can replace its resident children as one group. This keeps parent/child
seams covered while allowing independent nearby regions to sharpen during
continuous movement. `npx ng build demo-app` and
`npm run build:triangular-engine` pass. The full library test command remains
blocked by the existing `planet-surface-bake.spec.ts` `toHaveLength` typing
errors.

The follow-up review found two boundary cases in the first progressive version:
an early root result could trigger refinement before all sphere faces had coarse
coverage, and a fine replacement could commit before its neighbouring
edge-conforming patch. The renderer now keeps every level-zero root selected
until all roots are resident, and merges replacement groups across shared
mixed-LOD edges. Focused regression tests were added for both cases; the
complete library test command remains blocked by the same unrelated matcher
typing errors.

The coarse coverage state is latched after bootstrap. Refining a resident root
therefore cannot cause the renderer to request that old root again, which
prevents a repeated coarse/detail flicker during camera movement. The latch is
cleared only when the terrain selection is reset by a field, domain, root, or
other terrain configuration change.

### 2026-09-16 — progressive LOD experiment paused

The follow-up latch and edge-group changes were rolled back after continuous
camera movement remained difficult to verify and showed possible LOD regression.
Keep the previous chunk streaming path while broader planet and terrain work
continues; revisit this only with a reproducible motion test.

### 2026-09-16 — camera movement reprioritizes waiting detail

The movement test identified a smaller scheduler issue: the surface recomputed
patch distances on every camera update, but only reconciled the generation queue
when the selected patch keys changed. A lake could therefore remain selected
while waiting behind work ordered for an earlier camera position. Queue
reconciliation now runs on every update, preserves still-wanted pending jobs,
and applies their latest priorities. Running jobs and completed compatible
results remain governed by the existing epoch and replacement checks.

### 2026-09-16 — sphere parity and seam correction

The sphere lab was slower and showed gaps because it exercised the harder
six-face path while also bypassing the plane lab's Meshoptimizer pass. Sphere
edge-mask lookup used `top, right, bottom, left` against mesh slots ordered by
minimum-V, east, maximum-V, west; the first and third slots were reversed. The
lookup now maps `bottom, right, top, left`, with a regression test for the
minimum-V seam. Sphere worker patches now use the same border-locked
Meshoptimizer reduction policy and compact their attributes before transfer.
The demo and library builds pass; visual confirmation of sphere seams remains
the next manual check.
