# 035 — Unified cell terrain delivery

## Active delivery plan — revised 2026-09-19

This section supersedes the U0–U7 execution order below. The older plan and session log are
retained as history, not another queue. [034](034_cell_planet_map_roadmap.md) contains the
compact checklist; this document owns implementation detail and the current handoff.
New gates use **L0–L6** so old U-gate evidence cannot be mistaken for new acceptance.

**Immediate objective:** camera-driven terrain detail in the real cell-planet views, with
one renderer that supports a flat map, a globe and every intermediate morph value. Deliver
this before expanding the geology catalogue or polishing debug river ribbons.

**Terrain style is independently selectable:** preserve the current blended landscape and
add a Civ-style landscape whose mountain/volcano/mesa/canyon is shaped inside its owning cell.
Both styles use the same gameplay graph, renderer, LOD machinery and projection controls.

### Why the order changed

The earlier plan put all local landforms and detailed waterways before LOD integration.
That delayed the capability the user wants to test. Building separate planar and spherical
renderers before considering morph also risks another integration rewrite. Prove a small
morph-capable LOD slice first, then expand coverage and content on that same path.

Morph adds real requirements: moving projection seams, deformed bounds, screen-space error,
normals and picking must match the current displayed surface. Matching endpoint positions
alone does not solve these. Test them early rather than treating morph as a final shader swap.

### Verified starting point

Source inspection on 2026-09-19; performance statements below are user reports unless measured.

| Component | What exists | What is still missing |
| --- | --- | --- |
| Shared cell world | `CellPlanetWorldService` caches graph, tectonics, ecology, features and base/feature samplers; the four views consume the snapshot | Serializable worker identity, explicit terrain strategy and shared view configuration |
| 2.5D map | Camera-driven clipmap mesh LOD sampling a bounded height bake; Standard bake is 256 × 128, Ultra 1024 × 512 | Sampling additional canonical detail when zooming; the simplification slider is a static baked-mesh preview, not streaming LOD |
| Fixed cell globe | Shared sampler at fixed mesh resolution | Camera-driven local refinement |
| Morph view | Fixed 128 × 64 defaults, shared sampler, GPU reprojection, picking and tracking support | Adaptive patch topology, morph-aware selection/bounds and proven seam coverage |
| Planar streaming lab | Shared `TerrainSurface`, mixed-edge sampling, Meshoptimizer, asynchronous generator; user reports fast and gap-free | Its generator currently samples/builds on the main thread, not in a Worker; real cell-world integration |
| Sphere streaming lab | Same `TerrainSurface` infrastructure with sphere-specific selector/domain and a Worker | User reports holes and lower performance; those are unresolved acceptance failures |
| Volcano | `planet-surface.ts` reuses `sampleVolcano` in a local tangent frame | Complete per-cell strategy, polygon containment checks and fine-LOD retention |

Do not label the whole project “no LOD”, call the labs different complete engines, or call an
async function worker-backed. Reuse the shared terrain machinery; inspect current code because
031 records scheduler experiments and rollbacks, and historical status can lag implementation.

### Architecture and constraints

```text
immutable cell world + feature/path definitions + edit revision
                 |
       terrain style: blended | cell-features
                 |
       canonical surface(direction) + semantic metadata
                 |
       shared chunk sampling / workers / simplification / residency
                 |
       display transform: globe <-> projected map (0..1)
                 |
       shared renderer, picking, water and reference overlays
```

1. **World and surface:** retain `IPlanetSurfaceSampler` as the compatibility boundary and
   adapt it to terrain's `ITerrainField`. Compile a serializable style/settings definition
   once per revision; workers reconstruct it once, not for every patch. Camera/LOD must not
   change canonical height, feature ownership, river routing or cell IDs. Sampling density
   approximates that surface; it does not generate a new landscape at every level.
2. **Two styles:** `blended` reproduces the existing landscape, including the existing optional
   volcano stamp. `cell-features` controls cell interiors and shared transitions explicitly;
   do not implement it by adding a peak on top of the same broad mountain hump. Preserve
   continent/sea structure, define a local base/platform, local feature footprint and edge
   transition, and apply shared ridge corridors and reserved rivers in a documented order.
   Broad mountain blending becomes a style setting. Switching style must not regenerate the
   graph or feature assignments. A cell-owned feature does not require one draw call per cell.
3. **Polygon ownership:** calculate support from actual polygon edges/inside tests. The
   current nearest-corner radius heuristic is not proof of containment in an irregular cell.
   Interior features fade before shared boundaries; intentional cross-cell ridges use a
   shared path. True overhangs/caves are outside this height-surface POC.
4. **Shared display renderer:** make flat and globe modes endpoints of the morph-capable
   renderer. Existing routes become thin hosts with their cameras and relevant controls.
   Keep the current clipmap/fixed globe/fixed morph available for A/B comparison until accepted.
   Keep canvas as the 2D identity reference. A route switch may remount the renderer but must
   retain the world key, selected cell, terrain style, quality and projection.
5. **Patch topology decision:** first try a hierarchical longitude/latitude domain aligned
   with the existing morph mesh and a fixed map cut. It shares samples across both shapes and
   makes the static cut explicit. Reuse `TerrainSurface`, meshing and edge contracts rather
   than copying the labs. Polar distortion/degenerate triangles and transition boundaries
   are mandatory L1/L2 checks. This is a bounded candidate, not an assertion that it wins.
   If it fails those checks or has unacceptable pole cost, record the failing fixture and
   evaluate the existing cube-face domain with explicit projection-seam splitting inside the
   same route. Decide before full route migration; do not maintain two new production paths.
6. **Seams and geometry:** preserve canonical direction/elevation and both endpoint mappings
   through simplification. Lock compatible shared boundaries; border locking alone does not
   make coarse/fine edges match. Retain the proven per-span edge sampling. Duplicate/split at
   the map cut and handle poles explicitly. Dropping every seam-crossing terrain triangle is
   not a gap-free implementation. A flat map's outer boundary is intentional; missing coverage
   inside its valid footprint is a defect.
7. **LOD and morph:** evaluate error, visibility and bounds on the displayed geometry, with
   actual camera projection/viewport and orthographic zoom. Extend the selection context as
   needed: its current camera-position-only contract is insufficient for this claim. Include
   sampling, simplification, curvature and map-projection distortion in the error check.
   Validate at 0, .25, .5, .75, 1 and in motion. Sphere-only horizon culling cannot remain active
   while it would discard visible unrolled terrain. Use conservative bounds first.
8. **Simplification:** preserve paired attributes and test the result in both endpoint spaces
   and intermediate display states. A mesh simplified solely against spherical positions can
   lose its flat-map shape. Start the first geometry check unsimplified; add Meshoptimizer
   behind the comparison toggle, accepting a lower reduction when error demands it. Skipping
   simplification temporarily must be explicit and cannot count as accepted optimized LOD.
9. **Streaming:** keep coarse coverage while children and their edge-compatible neighbours
   build. Version jobs/results by world, style, feature/edit revision, domain/chart, patch,
   resolution, boundary topology and simplification policy. Exclude morph progress from
   canonical shape identity; chart/basis belongs in derived geometry keys when it affects
   topology. Pure slider movement should update transforms and selection, not rebuild the world.
   Bound pending work, resident/completed bytes and uploads, including neighbour balancing.
   `maxPatches` before balancing is not a hard final memory/patch cap.
10. **Queries and layers:** distinguish canonical height from a ray hit on the resident
    approximating mesh. Selection/focus must use the displayed transform, including 50% morph.
    Adapt debug river/coast/ridge layers to this transform and keep depth testing enabled.
    They are location aids, not final river water. Their cosmetic polish does not block LOD
    unless it prevents diagnosis. Geometry-only and cell-outline views remain available.

### Milestones and user review points

Each milestone can take several sessions. End each work packet with the visible result,
checks performed, missing evidence and exact next task. Do not promise a session count.

#### L0 — Freeze the shared inputs and comparison conditions

Status: **next**, existing U0/U1 work is reusable; no new L gate accepted.

- Reuse U0 fixture v2, seed 1 / 1500 cells / volcanic profile and its real volcano bookmark;
  record the resolved cell ID, radius, display relief and close/overview camera poses.
  Do not recreate the bookmark UI or repair already accepted camera fixes without a regression.
- Add a versioned surface/style descriptor and worker initialization contract; retain old
  sampler behavior as `blended`. Define `cell-features` composition and add the first minimal
  volcano case. Reuse the geology function, checking polygon support and no double application.
- Centralize comparison state (world key, style, renderer mode, projection, quality, selected
  cell and morph) through the existing service/query helpers. Keep view-specific cameras local.
- Establish diagnostics for frame time, desired/resident levels, queued/running jobs,
  build/refinement latency and tracked bytes. Save a baseline; user measurements may remain
  pending while implementation continues. Do not build a new testing platform for this packet.
- Automated checks: style determinism, unchanged blended samples, stable graph/feature IDs,
  worker/main sample parity, sea datum and explicit unit/axis conversion. 2.5D currently uses
  an XZ plane and a different longitude convention from morph's XY plane; test adapters.

User check: replay the existing volcano and overview; confirm comparison uses the same cell
and current terrain. This is a brief baseline check, not a new camera-design exercise.

#### L1 — First real cell-terrain LOD through the morph slider

Dependency: L0 contracts. **First new visible capability and highest priority.**

- In `/cell-planet-morph-spike`, add a `streamed` comparison mode consuming the real snapshot.
  Keep coarse global coverage; refine a bounded region containing the existing volcano.
- L1a: paired sphere/map patch geometry with fixed projection basis, one coarse and one fine
  band, compatible boundaries, initially unsimplified. Use existing transform conventions.
- L1b: camera-driven switching, shared queue/coverage management, worker-backed cell sampling
  and Meshoptimizer with paired-shape error validation. Do not use the whole-map height bake
  as the close-detail source. Profile sampler lookup/path scans before raising resolution.
- Show LOD colours/wireframe, freeze LOD, simplification on/off and geometry-only mode.
  Refine source samples enough that the volcano rim changes visibly from coarse to fine.
- Test patch boundary agreement in both endpoint spaces and intermediate morph; test
  selection and bounds, stale results and parent retention. Exercise a polar patch and a
  static map-cut patch to choose the domain before committing to broader migration.

User check: overview -> volcano -> overview at 0%, 50%, 100%; scrub the slider while zoomed
close. Expect visibly changing tessellation/detail, the same selected volcano and no openings
within this slice. Compare simplification on/off and record frame time. L1 is a bounded
integration proof, not global seam/performance acceptance.

#### L2 — Whole-world LOD correctness and bounded cost

Dependency: L1 topology decision. Keep working in the same renderer/route.

- Extend refinement everywhere with balanced neighbour transitions, stable merge/split
  hysteresis and bounded workers/cache/uploads. Record limits for the actual final cut.
- Cover the static map seam, poles, patch corners and both projections (Equirectangular and
  Equal Earth). If cube faces were chosen, include all face edges and three-face corners.
- Compute bounds and error for the current morph/camera; verify the surface normals, water
  datum, material coordinates and picking remain aligned. Do not CPU-rewrite the entire
  planet every frame merely to make picking work; restrict work to candidates/on demand.
- Test slow/failed/out-of-order jobs, fast zoom/pan/orbit/teleport, continuous movement,
  style/world changes during builds and disposal. Near patches must eventually sharpen
  while moving, not just after stopping; capture time-to-refine.

User check: repeat near/far travel at 0/25/50/75/100%, cross the map seam and poles, use
delayed generation. Gate: complete coverage, no visible mixed-LOD cracks, no incorrect culling,
bounded work and performance within the recorded test budget. Report pops separately from gaps.

#### L3 — All cell-map routes use the shared renderer

Dependency: L2. This completes the requested LOD integration across the views.

- Wire `/cell-planet-25d-map` to the flat endpoint, `/cell-planet-globe` to the globe endpoint,
  and keep `/cell-planet-morph-spike` as the adjustable view. Reuse the renderer, no copied
  schedulers/material forks. Preserve camera feel, comparison links and old renderer toggles.
- Share terrain/view/debug control groups and marker/selection layer construction. Preserve
  world, selected cell, style and relevant quality/projection state through navigation.
- Add moving meridian/oblique tracking to streamed geometry, with a real seam split/coverage
  policy. Test a tracking basis crossing a patch and map cut. Freeze the basis only as a
  clearly labelled earlier diagnostic, not as silent loss of an existing morph capability.
- Keep colours independent of topology where possible; colour-layer changes must not
  regenerate the world. Track any temporary colour-resolution limit separately from height.

User check: choose the volcano in 2D, visit each terrain view, zoom close/far, return; same
cell and feature, working LOD everywhere. On morph, track a unit across the seam at 50% and
100%. Acceptance requires both projections and tracking modes, or an explicit recorded user
scope change. First milestones may support only the labelled fixed basis.

#### L4 — Two useful terrain styles, then remaining local landforms

Dependency: L3. The L0 minimal volcano strategy becomes the full Civ-style implementation.

- First review an adjacent plain/mountain/volcano group in `cell-features` against `blended`.
  A mountain must read as a landform in its cell while the adjacent plain stays usable.
  Connected ridge cells still form an intentional shared range. Freeze that style before
  adding the next shape; “all cells are perfectly flat” is not an assumed requirement.
- Add mesa, then canyon using the existing geology samplers where applicable. Each packet
  includes canonical shape, feature metadata, masks, protected samples/error checks and a
  bookmark in the same world. Avoid a separate POC or a blanket renderer rewrite.
- Test real polygon ownership, shared-boundary continuity, seed determinism and LOD feature
  retention; bound sampling work by local spatial candidates rather than all features/paths.

User checks: (a) mountain/volcano/plain, (b) flat-topped mesa, (c) canyon floor/walls. At each,
inspect cell outlines and neutral shading near/far at globe/50%/map. Toggle styles: existing
blended mountains remain available, and Civ-style terrain reads as individual cells.

#### L5 — Actual river channels and detailed shores

Dependency: L4 style composition. Debug paths remain independently available.

**Shoreline ownership is a blocking prerequisite for this gate.** The generated
world has a discrete `tectonics.isLand[cellId]` classification, and
`ecology.coastlines` is extracted from the boundary between those classified
cells. The current surface sampler separately decides `sample.isLand` from the
sampled/interpolated `baseElevation >= seaLevel`; in `cell` composition mode,
cell-edge blending and local detail can therefore put the rendered water/land
transition somewhere other than the classified cell boundary. Streamed terrain
colouring follows the sample result, so the texture can reinforce that displaced
transition. This matches the reported oversized/undersized land and water cells.
The route also resets the per-cell classification with `deriveIsLand()` before
building ecology, so the classified edge is the post-cleanup graph boundary, not
necessarily every raw elevation threshold crossing.

The first implementation step now exists in `worldgen/core/coastlines.ts`:
`createCoastlineQuery(graph, finalIsLandMask)` exposes cell ownership, nearest
shared-edge segment, and signed angular coast distance. Its input mask remains
the authority; the query does not infer ownership from elevation or select a
sea datum. Coherent samplers can pass the previous `cellId` as a hint. This is
the shared query foundation only: terrain height, streamed materials, river
mouths and water coverage still need to consume it before the shoreline gate
passes.

- Make the post-cleanup per-cell land/water classification and its shared cell
  boundary the authoritative macro shoreline. Surface sampling, streamed
  materials, coast references and water coverage must all use the same ownership
  decision; do not independently reclassify a point from blended terrain height.
- Keep terrain height subordinate to that ownership: land-side terrain must
  meet the water datum at the classified boundary, while water-cell seabed stays
  below it. Specify the exact boundary interpolation and corner rule so adjacent
  patches produce the same shoreline.
- Allow authored shoreline wiggle, beaches and shallow shelves only as bounded
  detail around the classified boundary. They may shape the silhouette/material
  within a documented physical corridor, but may not make a cell appear to
  change its land/water ownership or move the macro coast beyond that corridor.
- Keep `seaLevelElevation` (the water datum) distinct from the land/water cell
  mask and from terrain height. Record how the datum is chosen, how callers may
  change it, whether changing it also regenerates the cell mask, and which
  operation is authoritative in the morph route. Add debug views that show the
  raw cell mask, cleaned mask, sea datum, sampled terrain and resulting water
  coverage together.
- Add a regression fixture with adjacent classified land/water cells. Check
  sample ownership and rendered material on both sides of their shared edge,
  then repeat with cell blending/detail enabled, at chunk boundaries and across
  globe/intermediate/map morph. The texture shoreline and water edge must follow
  the same cell boundary before optional bounded wiggle is enabled.

- Define continuous corridor sampling along segments, shared bend/junction/mouth geometry,
  physical widths/depths and water profiles in canonical coordinates. Current nearest-path-
  point influence is a starting approximation, not acceptance of a continuous riverbed.
- Protect river/shore corridors from conflicting local features and preserve the logical
  edge network. Add banks, shallows and a connected coast/mouth without moving ownership.
- Apply detail through the same chunk pipeline; test coarse/fine retention and update
  geometric error where new narrow features demand it. Add water after the channel can
  be inspected without a water surface hiding it.

User checks: river bend/junction, then mouth/shore; geometry-only and water-on near/far at
globe/50%/map. Gate: connected carved terrain and contained water, aligned with the reference
paths, no LOD cracks and acceptable added cost. River visual effects are follow-on work.

#### L6 — Integrated acceptance and documented consumer path

Dependency: L3–L5 and their review criteria.

- Repeat the same tour for both styles, both projections, endpoint/intermediate morph,
  supported tracking and the small plus agreed larger world presets.
- Verify cold start, warm navigation, regeneration, failed-job recovery and five identical
  mount/dispose cycles. Confirm stable resource counts and no monotonic retained growth.
- Document how a game supplies a world/style and selects flat, sphere or morph mode;
  shared renderer lifecycle, diagnostics, queries and public entry points. Keep optional
  Meshoptimizer isolated. Physics, persistent caching, building edits and more geology
  remain follow-on work unless needed for an explicit failed criterion.
  - Draft ahead of this milestone: [`039_cell_terrain_app_integration_contract.md`](039_cell_terrain_app_integration_contract.md)
    (2026-09-20) — engine-provided vs consumer-supplied, the five footguns, and a
    verification checklist. Fold/correct it here when L6 lands.
- Remove old implementations only in separately scoped cleanup after comparison acceptance.

User check: one short repeatable acceptance tour; record supported scale/zoom/quality and
known limitations. Passing a build or a single screenshot never completes this milestone.

### Performance, reviews and session discipline

- The user serves the app and performs browser verification. Do not open a browser or start
  a server. Run relevant non-browser tests/type-checks/builds; disclose unavailable checks.
- Use the existing fixture and short overview -> volcano -> seam -> overview tour at each
  review. Record machine/browser, viewport/DPR, build mode, world/style/quality and camera.
  Compare the same source and visible quality. The planar lab is a useful responsiveness
  reference, but its synthetic field is not a matched cell-world performance baseline.
- During development, record p50/p95/p99 frame time, >50 ms / >100 ms frames, time-to-refine,
  draws, triangles, desired/resident patches, pending/running jobs and tracked CPU/GPU resource
  bytes where available. Label estimates; do not invent GPU memory figures. A missing capture
  leaves performance acceptance pending; it does not require pausing independent coding.
- Retain the earlier provisional ceilings (warm p95 <=33.3 ms, p99 <=50 ms; investigate p95
  regression >max(2 ms, 10%)). These are proposals, not measured or user-approved targets.
  Preserve the user's expectation of the fast planar lab; obtain matched measurements before
  calling a slower renderer accepted. L0 records baseline; L1 records initial hard resource
  caps; L2 verifies them after balancing and during replacement. No silent budget increases.
- For final performance acceptance: 10-second warm-up, three repetitions of a fixed 60-second
  tour; report median run and spread. Five lifecycle cycles belong to L6, not every small fix.
- States: `next`, `in progress`, `implemented; awaiting user test`, `needs revision`, `accepted`.
  Record implementation, automated checks, user visual verdict and performance separately.
  Pending reviews allow independent preparation, never assumed acceptance of dependent style.
- Report to the user in a few lines: `L# / packet; visible change; open/preset; three test
  actions and expected result; checks/metrics or pending; known issue; next packet`.
  If work drifts to icons/ribbons/UI polish, explain which L acceptance criterion requires it.

### Current handoff — 2026-09-19 L0 style packet

- Active work: **L0 style contract implemented; L1a is next**.
- Accepted L gates: none. Do not erase prior user confirmations: 2D/2.5D bookmark focus,
  overlay alignment and the visible volcano were confirmed in this conversation. Complete
  cross-view, streaming and quantitative performance acceptance is still missing.
- L0 result: added a versioned `blended` / `cell-features` descriptor and shared sampler
  resolver in `cell-planet-terrain-style.ts`; added the `terrainStyle` comparison query;
  exposed the selector in 2.5D, globe and morph. Blended preserves the authored relief while
  cell-features now resolves to a shared single-owning-cell feature sampler, so the selector
  has a visible terrain effect. Added a colocated descriptor/routing test.
- Validation: `npx ng build demo-app --optimization=false` passes. `git diff --check` passes.
  Browser review and performance capture remain pending; the user serves the app.
- Next coding packet: expose a coarse/fine volcano region in the morph page's streamed
  comparison mode. Deliver an actual 0/50/100% review before expanding the feature catalogue.
  Baseline capture can proceed alongside this packet.
- Code entry points: `projects/demo-app/src/app/pages/cell-planet-world.service.ts`,
  `cell-planet-view-query.ts`, `cell-planet-u0-fixture.ts` in the same directory;
  `projects/triangular-engine/worldgen/core/planet-surface.ts`, `geological-shapes.ts`;
  `projects/triangular-engine/terrain/components/terrain-surface.component.ts`,
  `terrain/domains/terrain-surface-domain.ts`, `terrain/meshing/terrain-patch-mesher.ts`,
  `terrain/streaming/terrain-surface-patch-selector.ts` under `projects/triangular-engine`;
  `projects/triangular-engine/worldgen/render/planet-morph-geometry.ts`,
  `planet-morph-material.ts`, `components/cell-planet-morph-view.component.ts` in that entry point.
- Primary risks to resolve in L1/L2: pole/map-cut topology, morph-aware simplification and
  bounds, coarse/fine residency edge compatibility, cell sampler cost and projection axes.
  These are engineering checks with fixtures, not reasons to restart another open-ended POC.

Resume prompt:

> Continue the active L0–L6 plan at the top of docs/runbook/035_unified_cell_terrain_delivery.md.
> Read its current handoff and 034's compact checklist. Work on the recorded next packet,
> reuse the existing cell world and streaming infrastructure, and demonstrate progress in
> the morph route before expanding content. I serve the app and do browser checks. Give me
> a short review card and update the handoff, including unresolved evidence. Do not follow
> the superseded U0–U7 queue in the historical section below.

---

## Historical U0–U7 plan and session records — superseded 2026-09-19

Everything below preserves the earlier decisions and evidence. Its “current”, “next”,
dependencies and resume instructions are historical; the active L plan above takes precedence.

### Former purpose and authority

Deliver the terrain experience described in [034](034_cell_planet_map_roadmap.md) through
small, inspectable increments. This is the coding agent execution plan. The compact checklist
and live milestone summary are at the top of 034. This document owns the U gates, acceptance
protocol and current handoff; older milestones are not a competing work queue.

Status at plan creation, 2026-09-17: **U0 in progress; U1–U7 not started; no U gate accepted.**
These are integration statuses, not a claim that the existing code is absent. U1 is now in
progress because the existing morph route is being connected to the shared cell feature sampler.

Read the repository AGENTS.md, package README and agent conventions first. Preserve existing
worktree changes. Inspect current implementation and reuse it before creating new abstractions.
Relevant evidence remains in [010 — geology](010_geological_terrain_features.md),
[022 — worldgen](022_v4_voronoi_cell_planets.md), [030 — planar map](030_cell_planet_25d_map.md),
[031 — chunks](031_shared_planet_terrain_chunks.md), [032 — fixed globe](032_cell_planet_globe_prototype.md)
and [033 — materials](033_terrain_material_texturing.md). Record subsystem findings there and
link them from this plan; do not maintain several independent copies of gate status.

## Outcome and limits

One deterministic world supplies cell identity, terrain geometry, water, materials and queries.
Individual irregular cells can contain a local mountain, volcano, mesa or canyon. Ridges can
continue across cells. Rivers and coasts follow the cell boundary network while gaining
detail within a defined corridor. These relationships survive projection and LOD changes.

The first deliverable is a visually accepted, measured POC in the existing map/globe pages.
It is not full production acceptance. Building mechanics, walking/driving physics, erosion
simulation, eruptions, vegetation, roads, disk caching, a new morph renderer and an expanded
geology catalogue are follow-on work. Preserve existing edit contracts; edit UI/colliders do
not gate this POC. Add a separate experiment only to resolve a named failing U gate, and feed
the result back into the same world and demo routes.

LOD chooses how accurately to represent an existing surface. Meshoptimizer simplifies the
input geometry; it cannot invent missing volcano rims, channels or shoreline detail. Shape
sampling and enough source geometry must exist before simplification can preserve them.

## Working agreement for every coding session

1. Read the handoff below and 034's status table. Inspect the earliest unfinished U gate and
   its evidence. Select one bounded work packet with an observable result and acceptance check.
2. State the active gate, expected on-screen change and validation before implementation.
   Do not equate completion of a helper, test or separate lab with completion of the gate.
3. Implement and run the narrow relevant tests, library build and demo build for rendering
   changes. Follow repository public API/docs/changelog rules when applicable. Inspect the
   demo when tooling permits, then run the matched performance capture.
4. Update the handoff and compact table even if the session ends mid-gate. Record commands,
   failures, evidence paths, settings and the exact next code task. Never mark an unperformed
   check as passed. Distinguish test-environment failures from product failures.
5. At a reviewable gate, give the user the review card below. Record their verdict explicitly;
   agent screenshots and passing tests do not stand in for the user's visual acceptance.

Gate states: `not started` → `in progress` → `ready for visual review` → `accepted`.
Use `needs revision` after a failed review and record the failing criterion. A gate is ready
only when implementation, automated checks, agent visual checks (or disclosed limitations)
and performance evidence are recorded. Unknown measurements remain unknown, not zero.

User review is needed at the named U gates, not for every implementation decision. While a
review is pending, continue reversible work that does not assume the pending shape/scale/style
decision was accepted. Keep the reviewed revision/preset reproducible; do not silently change
it. A dependent gate cannot be accepted until its prerequisites are accepted. Stop and request
the specific missing decision only when useful independent work is exhausted.

## Shared fixture and evidence

Create a small deterministic fixture using the real cell graph and canonical sampler. Seeded
placement overrides may ensure the landmarks occur; label overrides and version them. Synthetic
height fields alone do not qualify. Use the same snapshot/feature definitions in every view.

The fixture must include:

- named cells containing a local mountain, volcano with rim/depression, flat-topped mesa and
  canyon with floor/walls; smooth bounded transitions inside their owning irregular polygons;
- a ridge through several adjacent cells, distinguishable from those local landforms;
- an edge-following river with a bend, junction and mouth, plus a coast and shallow seabed;
- chunk-boundary crossings and a spherical face-edge/corner placement variant. Change domain
  orientation or use a recorded second fixture to exercise face boundaries without inventing
  different geography for each adapter.

U0 chooses and records seed, graph size, radius, physical relief, exaggeration, generator and
detail versions, feature parameters and stable cell/path IDs. Landmarks can initially be
planned locations for features implemented in U2/U3. Avoid searching for a new good seed at
each gate. Keep a small acceptance fixture and a separately named larger scale-test preset.

Implement stable camera bookmarks: `overview`, `local-mountain`, `volcano`, `mesa`, `canyon`,
`ridge-crossing`, `river-bend`, `river-junction`, `river-mouth`, `shore`, `chunk-seam`,
`sphere-face-edge`, `sphere-face-corner`. Record coordinates/target, not only screenshots. U0
provides the selectors and resolves the anchors that already exist in the generator; U2/U3 must
make the remaining named landforms and fine river/coast geometry visible in every renderer.
Each resolved bookmark also carries the exact fixture `cellId`. Selecting one automatically aligns
the page with the fixture inputs, then selects or highlights that cell in the active view, so a
camera landing over an ordinary area is diagnosable as a terrain/feature problem rather than being
confused with a camera problem.

The initial U0 implementation now resolves `volcano`, `mesa`, `ridge-crossing`, river and shore
bookmarks from the frozen generator snapshot. Those anchors identify the existing generated cell
tags or paths, but the planar and spherical renderers still do not apply true within-cell volcano,
mesa or canyon geometry. `canyon` remains an explicit U2 placeholder. An ordinary-looking result
at that anchor is therefore still possible until the renderer consumes the shared feature
definitions; the UI must label this clearly so it is not mistaken for a failed terrain lookup.

Use existing routes: `/cell-planet-map` as identity reference, `/cell-planet-25d-map` as planar
consumer, and `/cell-planet-globe` as spherical consumer. Preserve comparison access to the
clipmap/fixed globe. Existing streaming labs may aid diagnosis but cannot be the sole evidence.
Provide a shared preset/export or equivalent reproducible links; avoid manual slider matching.

For every review retain a preset, revision identifier (commit plus dirty diff/artifact if
needed), labelled before/after captures, camera tour and measurements. Link evidence from the
gate record. For large captures use the project's artifact location, not unbounded repo blobs.

## Performance and geometry gates

U0 establishes a baseline on the user's reference machine/browser, with canvas pixel size,
device pixel ratio, quality, world size, camera, lighting, overlays and build mode fixed.
Agent hardware measurements are useful but must not be presented as that user's baseline.
Record cold generation separately from warm navigation. Compare at matched visible quality;
reducing detail or hiding water to increase FPS is a changed test, not an improvement.

Default measurement protocol: 10 seconds warm-up, then three repetitions of the same 60-second
camera tour. Report the median run's p50/p95/p99 frame times and the range across runs; separately
count frames above 50 ms and 100 ms. Record total/terrain draw calls, triangles, resident and
pending patches, queue/build latency, first useful coverage time, tracked geometry/texture
bytes and peak heap if available. Label estimated memory; do not invent GPU memory measurements.
Use motion capture for popping/holes; stationary screenshots cannot prove streaming stability.

Proposed initial budgets below are planning defaults, **not measured results or user-approved
hardware guarantees**. U0 must record concrete budgets and supported camera range before U1
can be accepted. If the baseline already fails, record a performance debt and repair it in
the relevant integration gate; never quietly redefine failure as the new baseline.

| Measure | Initial gate policy |
| --- | --- |
| Interactive navigation | Warm p95 ≤ 33.3 ms and p99 ≤ 50 ms on reference hardware; 60 FPS is a stretch target |
| Regression against last accepted gate | Flag a p95 increase greater than max(2 ms, 10%) or tracked resident bytes greater than 10%; investigate and remeasure before accepting |
| Added detail cost | Any intentional budget increase needs an explicit recorded user tradeoff; no silent baseline reset |
| Residency / workers | U0 freezes numeric patch, in-flight job and byte caps from the existing implementation; U4/U5 demonstrate they hold during motion |
| Build / first coverage | U0 records baseline and freezes numeric latency targets separately for cold load and warm refinement |
| Resource lifecycle | Five identical navigation/mount/dispose cycles; owned resources return to baseline and warm residency plateaus, with no monotonic retained growth |
| Coverage / topology | Zero missing-terrain regions, disconnected river junctions, rerouted paths or changed feature ownership |
| Geometric error | U0 freezes metre tolerances for canonical samples/seams and projected pixel tolerances for supported views; initial target ≤ 1 px near / 2 px far versus reference |

Memory/draw/triangle counts are explanatory metrics, not proof of speed. Frame-time percentiles
from requestAnimationFrame are presentation timing, not GPU timings. Record instrumentation
and limitations. Failure to access the browser or reference machine leaves that gate awaiting
measurement; it does not prevent preparing the implementation and a reproducible test card.

## U0 — Reproducible baseline and review harness

Dependency: none. Goal: every future comparison can be repeated without another long briefing.

- Inventory what the existing routes actually render. Preserve baseline clipmap/fixed globe.
- Establish the shared fixture manifest, named landmarks and initial camera bookmarks. Add
  missing seed/preset replay and diagnostics using existing controls where possible.
- Record the supported strategic, regional and close camera ranges with a cell outline and
  a metre reference. State physical sizes versus any display exaggeration. Close distance
  must be meaningful for the requested rivers and local features, not just a larger cell view.
- Measure the baseline and fill the budget fields in the handoff. Identify any measurement
  unavailable on agent hardware and give the user an exact way to collect it.

User visual test: open the three existing views, replay overview and a close landmark, confirm
cell scale and desired zoom range. The terrain can still look unfinished. This review fixes
the test conditions, not the final art style. Gate: replay works and baseline/budgets are recorded.

## U1 — One world and one surface contract

Dependency: U0. Goal: changing view does not change the geography.

- Consolidate immutable snapshot identity and serializable sampler inputs; carry generator,
  feature/detail and edit revisions into worker/job identity. Avoid independent regeneration
  with subtly different settings in each page.
- Define unit-explicit canonical sample composition and shared cell/feature/material metadata.
  Separate planet coordinates, display projection and height exaggeration. Keep framework-free
  math in the appropriate library entry point and optional simplification isolated.
- Feed bounded reference meshes in planar and spherical views from that sampler, including
  shared cell selection/reference overlays. Use enough resolution for upcoming shape tests;
  limit extent and label this reference mode so it is not mistaken for scalable rendering.
- Test determinism, worker/main parity, coordinate conversion, cell identity and sea datum
  using sample points at interiors, shared edges, poles and wrap boundaries. Document boundary
  tie-breaking and height tolerances before asserting parity.

User visual test: select a landmark, switch between 2D, planar and globe, then inspect the same
ridge/river/coast. Gate: same world and IDs; aligned geometry and overlays within recorded
tolerance. 2D need not display a detailed mesh; it must report the same identities and metadata.

## U2 — Real landforms inside irregular cells

Dependency: U1. Goal: local geology is visible as terrain geometry in both reference views.

- Reuse the analytic geology functions after checking their current quality. Define the
  smallest seeded, serializable feature instance: owner cell, planet-local frame, footprint,
  dimensions, composition/falloff and surface masks. Canyon must have an actual instance/path
  contract rather than being only a biome label.
- Start with one volcano as a small work packet, then add local mountain, mesa and canyon.
  Compose them with macro elevation/ridges without double-applying the old cell delta.
- Bound local footprints using the irregular polygon with a smooth interior falloff. Do not
  hard-clip heights at an edge. Cross-cell ridges retain a shared definition; a later cross-cell
  canyon must also use a shared path, not independently generated patch fragments.
- Test samples inside/outside footprints, continuity at boundaries, deterministic frames and
  feature masks. Demonstrate shape in neutral shaded geometry with overlays/materials off.

User visual test: in planar and globe reference views orbit each local feature, show cell
outlines, inspect rim/floor/flat top and adjacent cells; follow the larger ridge across cells.
Gate: all four local forms are recognisable within their owners, while macro ridges remain
continuous. Run the performance comparison even though these are bounded reference meshes.

## U3 — Carved edge rivers and close shoreline

Dependency: U2. Goal: detailed water boundaries remain tied to gameplay geography.

- Promote shared river/coast paths into deterministic fine geometry definitions in planet
  coordinates, with physical widths/depths and a bounded edge corridor. Define the distinction
  between the logical cell edge and the fine bank/shore shape; freeze corridor tolerance.
- Sample channel bed, banks, junctions and mouth into the canonical surface. Give water a
  coherent level/profile and shared width definition so it sits in the channel, not above a
  painted line. Respect downstream flow; record the policy for lakes/steep drops if encountered.
- Add shoreline, shallows and seabed transition without changing land/water cell ownership.
  Resolve composition precedence with local geology/ridges, including a river beside a mesa
  and a river crossing a chunk boundary. Near detail must not alter the route's connectivity.
- Test river sections, junction continuity, water/bed ordering, coast classification and
  cross-view sample parity. Shader ripples/foam alone do not satisfy the geometry gate.

User visual test: low-angle river bend, junction, mouth and shore; toggle water/materials to
see the actual cut; zoom out with cell edges on. Gate: readable bed/banks and shore detail,
connected mouth, water contained appropriately, same edge network in both reference views.

## U4 — Planar Meshoptimizer/quadtree integration

Dependency: U3. Goal: accepted shapes survive streamed 2.5D rendering.

- Feed real snapshot/sampler data into the planar TerrainSurface worker path and expose it in
  the existing 2.5D page. Reuse streaming-lab machinery rather than duplicating the scheduler.
- Begin with one fine and one coarse band. Source sampling must resolve the smallest accepted
  rim/channel; use geometric/semantic constraints where simplification erases these features.
- Preserve borders, parent coverage, bounded queues and eviction. Reject stale worker results
  by snapshot/revision. Validate normals/material alignment as well as positional seams.
- Test mixed LOD at every fixture feature and corner. Delay/fail builds deliberately to verify
  coverage and recovery. Compare reference, clipmap and candidate at matched camera/quality.

User visual test: repeat near/far zooms and pans across each feature and seam, including fast
movement and delayed refinement. Gate: no holes, objectionable pops, lost channels or changed
feature identity; error and performance budgets pass. If they fail, repair U4 and record the
cause instead of treating successful compilation or fewer triangles as renderer adoption.

## U5 — Spherical and morph Meshoptimizer/quadtree integration

Dependency: U4. Goal: the same accepted world works from globe to close terrain and through the
full morph slider, including intermediate states.

- Feed the identical definitions through cube-face domain adapters and the existing spherical
  selector/worker path, then expose the accepted surface through the morph page with the fixed
  morph mesh retained as a reference.
- Keep feature coordinates independent of cube-face UVs. Include curvature in error selection,
  bounded whole-planet coverage, horizon handling and precision appropriate to the fixed radius.
- Test face edges, three-face corners, poles, mixed LOD, rapid orbit/zoom, slider positions from
  0% through 100%, and delayed/failed builds. Keep river/coast/feature geometry, normals and
  material masks aligned across faces and intermediate morph states.
- Run numeric plane/sphere parity at the same world sample points and record projection-specific
  approximation errors separately from canonical sampler differences.

User visual test: orbit-to-ground tour, river across a face edge, local feature at a face corner,
then return to orbit and compare with the planar landmark. Gate: U2/U3 shapes retained, complete
coverage, no face seams or coordinate jitter, budgets met. This is the first streamed two-view
terrain proof; production physics/edit acceptance remains outside this gate.

## U6 — Integrated map readability and interaction

Dependency: U5. Goal: the terrain reads as the intended Civ-style cell map at all supported scales.

- Apply the shared semantic materials from 033 to the accepted terrain and water. Keep material
  detail in world coordinates; provide geometry-only, cell-outline and normal/material debug views.
- Align hover, selection and borders with the real surface and stable cell IDs in both views.
  Retain selection when switching views. Query height/feature identity from the shared contract.
- Tune strategic readability and close detail using U0's fixed scale/exaggeration conventions.
  Keep local landforms visible without turning all mountain cells into one indistinct mound.
- Verify overlays do not float, flicker, leak across boundaries or dominate draw costs. Re-run
  earlier shape/seam checks with final materials, water and overlays enabled.

User visual test: normal gameplay-style view, choose a cell, inspect its feature, zoom close,
then switch projection and zoom out. Gate: shape, material, water and selection agree and are
readable; the full scene stays within budget. This review accepts the POC's visual direction.

## U7 — Repeatable POC acceptance and handoff

Dependency: U6. Goal: demonstrate the result is stable and state its supported envelope honestly.

- Run the complete bookmarked tour on small and agreed larger presets with fixed quality.
  Repeat cold start, warm traversal and five mount/dispose cycles. Check queue/worker failure
  recovery and every previous visual landmark. Record world sizes and unsupported ranges.
- Run relevant regression suites, library and demo builds; check public imports/docs and token
  map status if architecture was expanded. Document test-environment limitations explicitly.
- Consolidate the usable shared code and documentation. Keep reference controls until the user
  has accepted the candidate; retire duplicate paths only in separately scoped cleanup.
- Record renderer decision, metrics, screenshots/tour, remaining limitations and next P-level
  product milestone. Do not claim production readiness or all-planet scalability from one fixture.

User visual test: one complete tour in both renderers with diagnostics visible, followed by a
normal view without diagnostics. Gate: all U gates accepted, no unresolved correctness/budget
failures, reproducible supported settings and follow-on backlog. This completes the unified POC.

## Review card and progress report templates

At each review, send this compact card with real values rather than asking the user to explore:

```text
U# / work packet / state:
Visible change:
Open: actual running URL + preset + revision
Try: 3–5 exact actions/bookmarks
Expected: concrete visible result for each action
Performance: baseline -> current p95/p99, peak tracked bytes, budget pass/fail
Agent checks: tests/builds/visuals performed; limitations
Known issues:
Please report: accepted, or bookmark + what looks wrong (screenshot optional).
Next: exact implementation task; whether it depends on this review
```

Between gates use: `U# [state] — completed X; checking Y; next Z; review needed yes/no`.
Avoid estimated completion percentages; report accepted gates and remaining criteria.

For each gate append evidence under a dated record with implementation revision, fixture version,
automated results, capture/metrics links, user verdict/date and open issues. A failed earlier gate
reopens that gate and any affected dependent acceptance; preserve prior evidence for comparison.

## Historical U-plan handoff — retained as prior evidence

- Updated: 2026-09-17, U0 harness packet.
- Active gate: U0, in progress; fixture and bookmark controls are implemented, baseline capture and
  user review are still outstanding.
- Accepted gates: none. Existing labs have not been re-evaluated against this plan.
- Latest completed packet: shared fixture manifest v2 using the volcanic profile, with deterministic
  anchors resolved from generated volcano/mesa cells, ridge/river paths and a coastline; bookmark
  selection now carries the exact cell ID into the 2D highlight, 2.5D selection indicator and
  globe colour highlight; baseline action and selectors are wired into all three routes.
- Latest user review: the volcano cell is selected correctly in 2D, but the view centres on ocean.
  The bookmark adapter incorrectly treated target coordinates as map translation and omitted zoom.
  It now projects the anchor through the map's current projection/basis after inputs settle and
  uses `pan = -projectedTarget * zoom`. Baseline application also preserves the subsequent selection
  across the generation-change effect. User visual confirmation of this correction is pending.
- Renderer recommendation (proposed, not a migration commitment): use native Three.js geometry for
  the unified terrain, with top-down orthographic, tilted planar and globe views sharing world and
  feature identity. The current 2D renderer already uses Three.js but displays one CanvasTexture,
  capped at 6144 pixels wide; increasing zoom eventually magnifies that bitmap. Keep it as a reference
  during delivery. SVG remains an option for overlays/export rather than another terrain renderer.
  Flat and spherical projection/camera adapters remain necessary even with a common renderer.
- Latest 2.5D selection packet: the selection controller already raycasts the baked height field,
  but its visual ring was capped at 30 m. On the physical medium planet that made a correct
  selection appear missing. The ring and pin now scale from the selected cell footprint, with a
  bounded fraction of the map span for safety. `npm run build:triangular-engine` passes.
- Latest 2.5D camera packet (2026-09-17): user rejected the previous surface-height adjustment;
  bookmark jumps still left the camera looking outside the map. Reproduced the actual control bug:
  `RaycastOrbitControlsComponent` compared the bookmark's new camera distance with the previous
  frame's distance, treated it as a cursor dolly, and shifted both camera and target toward the
  stale cursor. Returning to overview could extrapolate far beyond that cursor. Camera/target
  input changes now invalidate the cached cursor and distance and cancel pending rotate handoffs.
  The page also uses the selection marker's exact projected XYZ for its bookmark pivot, including
  river/shore cells whose centre differs from the feature anchor. No new public API is needed.
  An isolated Node regression exercised the real component source with mocked Angular scheduling
  and base controls: original code fails; corrected close/overview jumps remain fixed for 20 ticks;
  pending rotation is cancelled; fresh cursor zoom still works. Colocated Angular regression specs
  cover these cases but were not browser-run (user owns browser verification).
  The new spec and its imports type-check; library and demo builds pass; `git diff --check` passes.
  User visual confirmation remains pending; do not mark this gate accepted from a build.
- Latest 2.5D geography debug packet (2026-09-18): the planar clipmap now has independent
  `Debug river paths` and `Debug coastlines` toggles. Both are generated from the shared
  `ecology.riverPaths`/`riverFlow` and `ecology.coastlines` data, projected with the same map
  projection and world bounds as the terrain, and rendered as lightweight physical-width ribbon
  overlays. Coastline loops close; antimeridian segments are omitted rather than stretched across
  the map. This is a location/reference layer only: it does not carve terrain or change water
  ownership. A pure geometry spec covers closed loops and seam rejection. A follow-up alignment
  correction keeps the direction-to-longitude inverse paired with the 2.5D bake (`lon =
  atan2(direction.z, direction.x)`); the previous X/Z-reversed inverse caused a horizontal
  rotation/shift of the overlays against the terrain. Library and demo builds pass; browser review
  is still required.
- Latest 2.5D ridge/debug-clearance packet (2026-09-19): the planar debug layer now also exposes
  `Debug mountain ridges`, built from the shared `ecology.ridgePaths` and `ridgePathStrength` data.
  River and ridge ribbons use the sampled terrain height plus a larger debug-only clearance so
  they remain visibly above the clipmap in both physical planet and compact legacy scales. This
  is still a reference overlay, not carved river/ridge geometry; browser review should confirm
  visibility and alignment before the later U3/U2 terrain work.
- Latest river overlay robustness packet (2026-09-19): river debug ribbons now clamp sampled
  heights to sea level at underwater mouths and adaptively subdivide segments when midpoint
  relief rises above the interpolated endpoint height, up to two levels. The reusable 3D
  `PlanetView` river lines now use the same midpoint refinement plus sagitta clearance and
  `minClearance + heightScale * 0.025` displacement. This addresses overlay clipping only; it
  does not yet create carved riverbeds or bank geometry.
- Latest 2.5D volcano marker packet (2026-09-18): the page now computes the current world's
  generated feature instances and displays the first volcano as a lightweight billboard icon. It
  uses the same planar projection and CPU surface sampler as the debug geography layer, has an
  independent `Debug volcano marker` toggle/query value, and is intentionally presentation-only;
  it does not yet carve or model a volcano-shaped cell. Demo build passes; browser review is still
  required.
- Latest volcano terrain packet (2026-09-19): the shared surface sampler now accepts the generated
  feature set and reuses the existing `sampleVolcano()` geology-lab shape in a bounded tangent
  frame inside each volcano site's irregular cell. This preserves the POC's cone, crater rim and
  erosion detail while adapting its footprint to the cell. The 2.5D page passes the same feature set into its sampler,
  so the baked height field, marker height and future spherical consumers share the definition.
  The page also exposes an independent `Volcano terrain stamp` toggle so the user can compare the
  same selected cell with the sampled relief enabled and disabled.
  The stamp is precomputed once per sampler and checks only generated volcano instances while
  sampling; it does not add a full graph search per bake pixel. The current packet covers volcanoes
  only; mesa/canyon shapes, spherical wiring and LOD preservation remain outstanding. Library and
  demo builds pass. Worldgen browser tests built successfully but ChromeHeadless could not start on
  the reference machine because its GPU process exited; user browser review is required.
- Latest morph integration packet (2026-09-19): `/cell-planet-morph-spike` is now connected to
  the same U0 fixture defaults and runs `computeFeatures()` before creating its shared surface
  sampler. Its default profile is the U0 volcanic profile, and it exposes a `World profile`
  selector plus an independent `Volcano terrain stamp` toggle. This means the fixed morph mesh
  now samples the same cell-owned volcano relief as the 2.5D page; the route still uses fixed
  resolution geometry, so streamed LOD and intermediate-morph patching remain outstanding.
  Library/demo build verification passed; browser review must compare the same seed/profile and
  inspect the volcano at 0%, 50% and 100% morph.
- Latest shared-world packet (2026-09-19): `cell-planet-world.service.ts` now owns the common
  graph → tectonics → ecology → features pipeline for the 2.5D, fixed globe and morph pages.
  It caches snapshots by generation inputs, exposes base and feature-aware surface samplers, and
  applies the same U0 volcanic default/profile and water-level adjustment to each terrain view.
  The globe now receives the same feature-aware sampler as 2.5D and morph. Morph navigation now
  carries the shared generation/projection query state into the other routes, and the 2D canvas
  consumes the same snapshot through an optional `worldData` input while retaining its own
  raster/pan/zoom renderer. Library and demo builds pass; browser review should confirm the same
  bookmark/cell and volcano relief remain aligned across all four routes.
- Next packet: user visual review of the shared world across all four routes, then capture U0 baseline on the reference machine/browser, including canvas/DPR/build mode,
  cold and warm timings, frame-time percentiles, draw/triangle counts, residency and memory fields.
- First user review: U0 cell scale, close/strategic zoom range and baseline conditions.
- Reference hardware/browser/canvas/DPR/build mode: not yet recorded.
- Fixture seed/cell count/radius/relief/version/IDs: fixture manifest frozen at v2; volcano/mesa
  cell and path anchors plus their selected cell IDs are derived deterministically from the
  manifest's generator snapshot. Exact numeric IDs can be recorded in the evidence record after
  the user's baseline capture.
- Numeric caps to freeze in U0: resident patches, worker jobs, tracked bytes, cold coverage,
  warm build latency, canonical metre error, seam error and near/far pixel error.
- Performance evidence: no U0 performance capture yet; defaults above are proposals only.
- Agent verification: earlier `npm run build:triangular-engine` and `npx ng build demo-app` passed.
  Latest bookmark correction: isolated checks of the actual handler passed for three projected
  targets, deferred input propagation and superseded selection. The latest library and demo builds
  pass after the concurrent morph/border work was included. No browser or app server was opened for
  this fix.
  The U0 controls and route persistence were visually exercised earlier in the dev server on
  `/cell-planet-map`, `/cell-planet-25d-map` and `/cell-planet-globe`; no U gate is accepted from
  that check alone.
- Blocking decisions: none for continuing U0. User visual review is pending baseline capture.
- Evidence records: browser check completed, but no saved capture/metrics record yet.

## Historical resume instruction — use the active L-plan prompt above instead

Copy into a future coding session if useful:

> Continue the unified cell terrain plan in docs/runbook/035_unified_cell_terrain_delivery.md.
> Read its current handoff and the compact checklist in 034, inspect existing code, and work
> on the earliest unfinished U gate. Reuse the existing map/globe pages and shared fixture.
> Verify each packet and update both progress records. When a U gate is reviewable, give me
> exact visual test steps and before/after performance; keep user acceptance separate from
> agent verification. Continue independent work while a review is pending. Do not start a
> separate terrain POC or mark unmeasured/visually unreviewed criteria as accepted.
