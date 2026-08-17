# 018 — Scatter exclusion zones (no-grass areas) + ground-interaction design trace

Compact trace of a design discussion about "grass shouldn't grow here" and
its neighbours (trample, scorch, burn-away, shared wind), and the
implementation plan for the one piece of it that had no existing mechanism:
static exclusion zones. Everything else discussed either already has a
proven mechanism (see "Already solved" below) or is deliberately deferred
(see "Deferred" below) — this doc exists so those decisions are written down
once instead of re-derived next time the topic comes up.

## The prompt

Bruno's use cases, compactly:

1. Base building: placing a building should leave no grass under its
   footprint.
2. BSP rocket engines scorch the ground under them — grass should be
   killed, not just visually hidden.
3. Walking over grass should bend it; vehicles might actually kill it.
4. A half-built `trail` sublibrary exists for scorch-mark/tire-track visuals
   — does it relate?
5. Burning grass/trees away over time (not instant) — which layer owns
   that: the game, or the sub-library?
6. Wind should be shared/controllable so other systems (explosions, magic
   shields) can perturb it; grass should react to things rolling over it,
   landing craft, etc.

Not all of these are the same size or the same level of decided-ness. This
runbook scopes down to what's buildable now and records the rest as
deferred, not dropped.

## Survey findings (compact)

- **No exclusion-zone primitive exists.** `scatter/` has no rectangle,
  circle, polygon, or mask type. The only composition mechanism is
  `ScatterSuitabilityFn` (`scatter/core/scatter-placement.ts`), the same
  0..1-multiplier mechanism `distanceFade` and `viewCull` already use inside
  `generateTerrainScatterInstances` (`scatter/terrain/scatter-terrain-instances.ts`).
  The composition-chaining fix from [017](017_scatter_view_culling.md) (both
  blocks now chain off the *running* `suitability` local, not
  `options.suitability`) means a third composed option slots in the same
  way and stacks correctly with the other two.
- **Permanent removal ("kill") already has a real, working proof** —
  `scatter/core/scatter-removal-overlay.ts` (`IScatterRemovalOverlay`, a
  persisted set of removed `ScatterInstanceId`s; games own storage, the
  library only provides pure `with...Removed`/`with...Restored`/
  `filterRemovedScatterInstances`) is fully exercised end-to-end in
  `scatter-physics-lab-page.component.ts`: click-to-pick
  (`pickScatterInstanceId`, `scatter/three/scatter-instance-picking.ts`) or
  a physics projectile removes an instance from both the render batch and
  the Jolt collider (`colliderAdapter.removeInstance`) at once. A rocket
  engine "scorching" grass is the same mechanism at a different trigger —
  no new library code needed for the *mechanism*, only for the *trigger
  shape* (see "Deferred" below).
- **`trail/` is a real, narrow skeleton, not a stub.** `trail-ribbon-geometry.ts`,
  `trail-ribbon-material.ts`, `stamp-decal-geometry.ts` (~374 lines,
  tested). Its own doc comment states the purpose: "ground marks — engine
  scorch, tire tracks, footprints." It only builds the *visual* decal mesh
  today — nothing connects a trail/stamp shape to scatter density or the
  removal overlay yet.
- **`spline/` already earmarks this exact feature**, further out.
  [008_spline_sublibrary.md](008_spline_sublibrary.md) lists "scatter
  density multiplier from a spline mask (keep trees off the road)" as a
  Phase-4 checklist item. `spline/` is still Phase-0A (core curve math
  only) — no surface binding or mask sampling exists yet, so it isn't a
  buildable dependency today.
- **Wind is already a live, controllable primitive**, just page-scoped.
  `GRASS_WIND`'s gust (curl-noise flow on top of per-blade flutter) is
  driven by real-time GPU uniforms (`setGustAmplitude`/`setGustWavelengthM`/
  `setGustDriftSpeedMS`, `enableScatterWindSway`) already, per
  [meadow-lab-page.component.ts](../../projects/demo-app/src/app/pages/meadow-lab/meadow-lab-page.component.ts).
  Generalizing it to a shared field other systems can perturb (explosions,
  shields) is additive to what exists, not a redesign.

## Decisions

1. **Two distinct mechanisms stay distinct, not unified**: a **static
   exclusion zone** (generation-time, `suitability = 0` in a shape — for
   things that don't change often: building footprints, road corridors) and
   the existing **dynamic removal overlay** (persisted per-instance kill —
   for things that happen at runtime and should stick: scorch, destruction).
   Collapsing these into one mechanism was considered and rejected — a
   building footprint has no natural "instance ID" to remove (it excludes
   whatever candidates would have generated there, including future
   density/seed changes), while a scorch mark is inherently about specific,
   already-existing instances.
2. **v1 exclusion zones are circles in world space** (`centerWorldM`,
   `radiusM`, optional `featherM` for a soft edge), not rectangles. Bruno's
   phrasing suggested a rectangle; circles were chosen instead because a
   world-space 3D distance test is shape-agnostic by construction — it
   works unmodified on the plane, sphere, and cylinder, the same reason
   `computeScatterHorizonFade01` in [017](017_scatter_view_culling.md) is a
   center-distance test rather than an axis-aligned one. A rectangle needs
   a surface-local basis (which axes are "along" and "across" the footprint
   on a curved surface), which is a real per-shape problem, not a v1
   concern. A circle over-covers a rectangular building's corners slightly
   — acceptable for a first slice; polygon/OBB zones are future work if
   that slop matters later.
3. **Multiple overlapping zones compose via minimum, not product.** Each
   zone independently suppresses toward 0 near its center and ramps to 1
   over `featherM`; combining zones by taking the *minimum* fade (not
   multiplying every zone's fade together) means overlapping feather rings
   don't compound into extra suppression — the most-restrictive zone wins,
   same intuition as "this point is inside zone A's exclusion, it doesn't
   matter that it's also near zone B's edge."
4. **`scatter-exclusion.ts` lives in `scatter/core`**, pure/framework-free,
   mirroring `scatter-view-cull.ts`'s style exactly (same file shape, same
   `TerrainVector3` inputs, same "returns a 0..1 fade" contract).
5. **meadow-lab proves it interactively**: click-to-place a zone on the
   ground (reusing the `engine.click$` + `Raycaster` pattern already
   established in `flora-affordance-lab`/`scatter-physics-lab`), with a
   translucent marker mesh so the excluded footprint is visible, not just
   inferred from missing grass. This is the most direct proof of "place a
   building, no grass under it."

## Scope boundaries (explicit)

In scope this slice:
- `scatter/core/scatter-exclusion.ts` + spec.
- `exclusion` option on `generateTerrainScatterInstances`, composed
  correctly with `distanceFade`/`viewCull`.
- meadow-lab: click-to-place circular no-grass zones with a visible marker,
  clear-zones control, zones reset on shape/sphere-radius rebuilds (their
  world positions don't carry meaning across a shape switch).

Explicitly **not** this slice (recorded, not dropped):
- **Rectangle/polygon zones.** Circle only, see Decision 2.
- **Trample/squish bending** (footsteps, vehicles, rovers, landing craft).
  This is a *visual, reversible* effect — the natural home is generalizing
  the existing gust mechanism into a small capped array of local impulse
  sources (position, radius, strength, decay), not a new subsystem. Same
  primitive would serve an explosion shockwave or a magic shield at larger
  radius/strength. Not built here; the exclusion-zone marker mesh added
  this slice is a useful visual reference for "a shape at a world point"
  but the impulse system itself is separate future work.
- **Burn-away visual transition** (shrink/darken/blow away before a scorch
  finalizes). Ownership decision recorded: the library's job stops at (a)
  immediate suppression via a zone or the removal overlay, and (b)
  optionally exposing a per-instance/per-cell "scorch 01" shader uniform in
  the same style as the gust amplitude uniform. The *timing*, trigger, and
  particle FX (embers, ash) stay game-side — consistent with how this
  codebase already splits flora/parts ("consumers own what deploying a part
  *does*"). Not built here.
- **Shared/externally-perturbable wind field.** Promoting `GRASS_WIND`'s
  gust out of meadow-lab into something an explosion or shield can inject
  into is a natural follow-up to both this slice and the trample impulse
  idea above (likely the same underlying impulse-source mechanism). Not
  built here.
- **Trail → scatter bridge.** `trail/`'s scorch-decal geometry and this
  slice's exclusion zones are the same *shape* concept (a footprint) built
  twice, once for visuals and once for density. Wiring them together (or
  routing both through a shared footprint type) is real future work, not
  attempted here — this slice's zones are meadow-lab-local, not sourced
  from `trail/`.
- **Spline-based exclusion masks** (keep-out zones along a road/spline).
  Blocked on `spline/` reaching its surface-binding/mask-sampling phase
  (currently Phase-0A). [008](008_spline_sublibrary.md)'s Phase-4 checklist
  item is the eventual proper version of this.
- **Broad-phase spatial index for zones, at high zone counts.**
  `computeScatterExclusionFade01` is a linear scan over every zone for every
  candidate point, called per candidate inside
  `generateTerrainScatterInstances` — `O(zones × candidatesPerCell)` per
  streaming-cell (re)generation. Fine at demo scale (a handful of zones).
  At production scale (hundreds/thousands of invisibly-placed zones — e.g.
  one per base-building footprint across a large world), most zones are
  nowhere near the cell being generated, so that's wasted work. Note this
  is a *different* problem than grass's view-culling: zones are static
  world-space geometry, so they don't need re-evaluating every frame the
  way camera-relative culling does — they only need a cheap lookup at
  cell-generation time, which is already an infrequent, amortized event.
  The fix, when needed: a simple grid-bucket spatial index over zones,
  queried once per cell's bounds to get the small set of overlapping zones
  before running the per-candidate distance test against only those — not
  a per-frame system. Not built here; revisit if/when a game actually
  exercises zone counts past the low tens per streaming cell.

## Implementation

### Step 1 — `scatter/core/scatter-exclusion.ts`

```ts
export interface IScatterExclusionZone {
  readonly centerWorldM: TerrainVector3;
  readonly radiusM: number;
  /** Soft-edge ramp width beyond radiusM before returning to full suitability (0 = hard edge). */
  readonly featherM?: number;
}

export function computeScatterExclusionFade01(
  candidateWorldPositionM: TerrainVector3,
  zones: readonly IScatterExclusionZone[],
): number; // 1 outside every zone, 0 inside a zone's core, minimum across zones in feather bands
```

Tests (`scatter-exclusion.spec.ts`): no zones → 1; inside radius → 0; outside
radius+feather → 1; linear ramp inside the feather band; two overlapping
zones compose via minimum, not product; zero-radius zone excludes only its
exact center; never throws on a zero-distance candidate.

### Step 2 — `scatter/terrain/scatter-terrain-instances.ts`

Add `exclusion?: readonly IScatterExclusionZone[]` to
`IGenerateTerrainScatterInstancesOptions`, chained off the running
`suitability` local the same way `distanceFade`/`viewCull` are (per the
017-established composition fix). Export `scatter-exclusion.ts` from
`scatter/public-api.ts` alongside `scatter-view-cull.ts`.

### Step 3 — meadow-lab click-to-place zones

- `placingZone = signal(false)`, toggled by a checkbox ("Place no-grass
  zones — click the ground").
- `engine.click$` subscription (mirroring `flora-affordance-lab`'s
  NDC-from-`event.offsetX/offsetY` + `Raycaster` pattern), active only
  while `placingZone()` is true, raycasting against `this.groundMeshes`.
- Each placed zone: pushed into a local `IScatterExclusionZone[]`, passed as
  `exclusion` into `generateTerrainScatterInstances` in `rebuildGrass()`,
  and given a translucent flat marker mesh (shared geometry/material,
  radius = the zone's `radiusM`) oriented to the shape-appropriate surface
  "up" at that point (plane: `+Y`; sphere: direction from the sphere
  center; cylinder: radial direction from the X axis) so it reads correctly
  on all three shapes.
- A "clear zones" control disposes the markers and empties the zone list.
- Zones (and their markers) are cleared in `teardownTerrain()` — the same
  place cell addresses are cleared — since a zone's world position only
  means anything relative to the shape it was placed on; switching shape or
  changing the sphere radius invalidates it.

### Step 4 — docs

- Bump the class doc comment / header `<small>` to "slice 6".
- Add a blurb explaining the zone mechanism, the circle-not-rectangle
  choice, and pointing at `scatter-physics-lab` for the dynamic-removal
  ("kill") mechanism this slice deliberately doesn't duplicate.

## Verification

- `npx tsc -p projects/demo-app/tsconfig.app.json --noEmit` and
  `npx tsc -p projects/triangular-engine/tsconfig.lib.json --noEmit`.
- New `scatter-exclusion.spec.ts` plus the existing scatter/procedural
  suites green.
- Manual: place a zone, confirm grass thins out (soft edge) and vanishes
  (zone core) in that footprint on all three shapes; clear zones restores
  full density; switching shape/sphere-radius clears zones without leaving
  stale markers in the scene.

## Change log

### 2026-08-17: initial design trace + exclusion-zone scope

Written after a design discussion covering no-grass zones, trample/kill
distinctions, `trail`'s current state, burn-away ownership, and shared wind.
Scoped to the one piece with no existing mechanism (static exclusion
zones); everything else recorded as either already-solved (removal overlay
+ `scatter-physics-lab`) or deferred with a named future owner.

### 2026-08-17: performance-at-scale question, recorded as deferred

Confirmed meadow-lab's exclusion zones work correctly in-browser. Follow-up
question: does zone count need culling the way grass does, at production
scale (thousands of invisibly-placed zones)? Answer traced and recorded
above under "Broad-phase spatial index for zones, at high zone counts" —
current linear scan is fine at demo scale, would need a grid-bucket spatial
index at high zone counts, and it's a generation-time lookup problem, not a
per-frame culling problem like grass's view cull. Not built; no code
changed this entry.
