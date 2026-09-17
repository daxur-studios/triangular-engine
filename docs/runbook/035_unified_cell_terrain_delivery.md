# 035 — Unified cell terrain delivery

## Purpose and authority

Deliver the terrain experience described in [034](034_cell_planet_map_roadmap.md) through
small, inspectable increments. This is the coding agent execution plan. The compact checklist
and live milestone summary are at the top of 034. This document owns the U gates, acceptance
protocol and current handoff; older milestones are not a competing work queue.

Status at plan creation, 2026-09-17: **U0 in progress; U1–U7 not started; no U gate accepted.**
These are integration statuses, not a claim that the existing code is absent.

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

## U5 — Spherical Meshoptimizer/quadtree integration

Dependency: U4. Goal: the same accepted world works from globe to close terrain.

- Feed the identical definitions through cube-face domain adapters and the existing spherical
  selector/worker path, exposed in the cell globe page with the fixed globe reference retained.
- Keep feature coordinates independent of cube-face UVs. Include curvature in error selection,
  bounded whole-planet coverage, horizon handling and precision appropriate to the fixed radius.
- Test face edges, three-face corners, poles, mixed LOD, rapid orbit/zoom and delayed/failed
  builds. Keep river/coast/feature geometry, normals and material masks aligned across faces.
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

## Current handoff — update at every session end

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
- Next packet: user retest of 2.5D click selection and bookmark selection, then capture U0 baseline on the reference machine/browser, including canvas/DPR/build mode,
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
  targets, deferred input propagation and superseded selection. Latest demo build is blocked by
  separate `cell-planet-morph-view.component.ts` errors (private inherited engineService, missing
  override modifiers and object3d versus object3D). No browser or app server was opened for this fix.
  The U0 controls and route persistence were visually exercised earlier in the dev server on
  `/cell-planet-map`, `/cell-planet-25d-map` and `/cell-planet-globe`; no U gate is accepted from
  that check alone.
- Blocking decisions: none for continuing U0. User visual review is pending baseline capture.
- Evidence records: browser check completed, but no saved capture/metrics record yet.

## Resume instruction

Copy into a future coding session if useful:

> Continue the unified cell terrain plan in docs/runbook/035_unified_cell_terrain_delivery.md.
> Read its current handoff and the compact checklist in 034, inspect existing code, and work
> on the earliest unfinished U gate. Reuse the existing map/globe pages and shared fixture.
> Verify each packet and update both progress records. When a U gate is reviewable, give me
> exact visual test steps and before/after performance; keep user acceptance separate from
> agent verification. Continue independent work while a review is pending. Do not start a
> separate terrain POC or mark unmeasured/visually unreviewed criteria as accepted.
