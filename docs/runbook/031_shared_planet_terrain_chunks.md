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
