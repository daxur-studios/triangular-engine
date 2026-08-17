# 017 — Scatter view culling + multi-shape meadow-lab

Implementation plan for promoting camera-aware scatter culling out of
`meadow-lab` into [`005_scatter_sublibrary.md`](005_scatter_sublibrary.md)'s
shared entry points, and using it to prove the technique on all three terrain
shapes (plane / sphere / inside-cylinder).

## TL;DR

`meadow-lab`'s existing cone-culling and distance-fade were page-local and
flat-world-only (implicit `+Y`-up, XZ-only angle test — confirmed buggy under
camera pitch). This plan moves the cone math into a new
`scatter/core/scatter-view-cull.ts` (pure, framework-free, mirrors
`scatter-distance-fade.ts`), adds a sphere-only horizon-occlusion test for
small-planet curvature, makes both object-size-aware via an angular-radius
widening term, and wires `ScatterStreamingService` to also track camera
*forward* direction (previously position-only). `meadow-lab` then grows a
shape switcher (plane/sphere/cylinder, same pattern as `scatter-lab`) so the
promoted primitives get exercised on curved worlds, not just the flat plane
they were debugged on.

## Ground rules carried from 005

- `scatter/core` stays pure — no three.js, no Angular. The new cull functions
  take plain `readonly [number, number, number]` positions/directions, same
  as `computeScatterDistanceFade01`.
- Scatter placement (`sampleTerrainSurface` → `computeScatterInstanceMatrix`)
  and the wind-gust primitive are already shape-agnostic and need no changes
  — confirmed by direct read, not assumed.
- `generateTerrainScatterInstances`'s composed options (`distanceFade`, now
  `viewCull`) must chain off the *running* `suitability` local variable, not
  re-read `options.suitability` — the existing `distanceFade` block did the
  latter, which is harmless with one composer but silently drops one wrapper
  when two are supplied together (as `meadow-lab` now does).

## Root-cause bug this plan fixes

`meadow-lab`'s original `viewConeSuitability`/`captureCullForwardDirection`
only compared the **XZ projection** of camera-forward and candidate-direction,
ignoring the Y (pitch) component entirely. Looking straight down never
rotated the cone downward (stale horizontal direction kept passing far-away
instances), and directly-below instances collapsed to a near-zero horizontal
vector, producing arbitrary pass/fail. Fix: a full 3D angle test using
`camera.getWorldDirection()` (already unit-length) and full 3D
`dx/dy/dz` to the candidate — no XZ projection, no degenerate case, and
incidentally what makes the primitive shape-agnostic enough to promote.

## Reference formulas (ported from `brunos-space-program`'s `cdlod-terrain-lab`)

Confirmed by direct read of `cdlod-quadtree.ts`
(`selectCdlodNode`/`evaluateDistanceAndAngleToPatch`). Not a true 6-plane
frustum — a cheap conservative angle-to-forward cone, which is what that demo
uses too.

**Cone test** (angle pivoted at the *camera*):

```
reject if angle(viewForward, candidateDir) − objectAngularRadius > coneHalfAngle
```

**Horizon test** (angle pivoted at the *curvature center*, independent of
view direction — two separate tests, both must pass):

```
camDir = normalize(viewpointWorldM - curvatureCenterWorldM)
candidateDir = normalize(candidateWorldPositionM - curvatureCenterWorldM)
centerAngle = acos(dot(camDir, candidateDir))
objectAngularRadius ≈ atan(objectRadiusM / distance(candidateWorldPositionM, curvatureCenterWorldM))
nearestAngle = max(0, centerAngle - objectAngularRadius)
horizonAngle = acos(min(1, curvatureRadiusM / distance(viewpointWorldM, curvatureCenterWorldM)))
behindHorizon = nearestAngle > horizonAngle + marginRad   // CDLOD uses marginRad = 0.12
```

Object-size-awareness for both tests is the same `atan(objectRadiusM /
distance)` widening term, ported from CDLOD's corner-angle-derived patch
angular radius and simplified to a scalar point+radius approximation since
scatter has no per-instance bounding geometry.

## Scope boundaries (explicit, so nothing balloons)

- Horizon occlusion is **sphere-only**. A cylinder's curvature only wraps
  circumferentially, not axially — a sphere-style single-center-point horizon
  test would be wrong there. Cylinder gets the cone test only.
- Only the sphere gets a radius slider ("smaller spheres" was the specific
  ask). Cylinder keeps fixed radius/length constants, same spirit as the
  plane's fixed patch size.
- No dramatic "giant tree" landmark object. `objectRadiusM` is proven with a
  small, realistic, always-on constant for grass's own footprint (~0.35 m). A
  large object surviving a boundary test near a tiny planet is a natural
  `flora-scatter-lab` follow-up, not built here.
- Shadow-casting vs. cone/horizon culling interaction stays a documented
  caveat, not solved — grass has `castShadow: false`, so it's moot for this
  slice.
- No new field on `ScatterSpeciesDefinition` (would be a breaking,
  engine-wide schema change for something no other species needs yet).
  `objectRadiusM` is a scalar on the cull options themselves, same pattern as
  `distanceFade`'s call-site-only options.

## Step 1 — `scatter/core/scatter-view-cull.ts`

New file, pure, mirrors `scatter-distance-fade.ts`'s style.

```ts
export function computeScatterViewConeFade01(
  candidateWorldPositionM: readonly [number, number, number],
  viewpointWorldM: readonly [number, number, number],
  viewForwardM: readonly [number, number, number],
  coneHalfAngleRad: number,
  objectRadiusM = 0,
): number; // full 3D angle-at-camera test, 0 or 1

export function computeScatterHorizonFade01(
  candidateWorldPositionM: readonly [number, number, number],
  viewpointWorldM: readonly [number, number, number],
  curvatureCenterWorldM: readonly [number, number, number],
  curvatureRadiusM: number,
  objectRadiusM = 0,
  marginRad = 0.12,
): number; // angle-at-center horizon test, 0 or 1
```

Export both from `scatter/public-api.ts` alongside the other `core/` exports
(wildcard re-exports are listed explicitly there, not auto-discovered — add
`export * from './core/scatter-view-cull';`).

Tests (`scatter-view-cull.spec.ts`): cone accepts straight ahead, rejects
directly behind, boundary at exactly `coneHalfAngleRad`; a wider
`objectRadiusM` recovers a candidate just past the boundary; horizon accepts
a nearby candidate and rejects one past the curvature radius's horizon angle;
degenerate zero-distance candidate doesn't throw/NaN.

## Step 2 — `scatter/terrain/scatter-terrain-instances.ts`

Add:

```ts
export interface IScatterViewCullOptions {
  readonly viewpointWorldM: TerrainVector3;
  readonly viewForwardM: TerrainVector3;
  readonly coneHalfAngleRad: number;
  readonly objectRadiusM?: number;
  readonly horizon?: {
    readonly curvatureCenterWorldM: TerrainVector3;
    readonly curvatureRadiusM: number;
    readonly marginRad?: number;
  };
}
```

Add `viewCull?: IScatterViewCullOptions` to
`IGenerateTerrainScatterInstancesOptions`. Fix the composition so both
`distanceFade` and `viewCull` chain off the running `suitability` local
variable (not `options.suitability`), so they compose correctly when both are
supplied — required now that `meadow-lab` supplies both.

## Step 3 — `scatter/engine/scatter-streaming.service.ts`

Add a `viewForwardM$`/`viewForwardM` observable+getter pair, populated via
`camera.getWorldDirection()` in the same `update()`/movement-threshold cycle
already used for `viewpointWorldM$`. Documented simplification: forward-
direction freshness is gated by the same positional movement threshold, not a
separate rotation threshold — acceptable for orbit-controls-driven scenes
where the two move together; revisit if a consumer needs pure look-rotation
to trigger a re-cull with the camera stationary.

## Step 4 — `meadow-lab` world-shape switching

Follow `scatter-lab-page.component.ts`'s proven pattern (`shape` signal,
`getFixture(shape)`, `setCameraForShape(shape)`, teardown/rebuild) rather than
inventing a new one.

- `type MeadowLabShape = 'plane' | 'sphere' | 'cylinder'`,
  `shape = signal<MeadowLabShape>('plane')`.
- `GRASS_SPHERE_RADIUS_{DEFAULT,MIN,MAX}_M = 25 / 10 / 150` (slider,
  sphere-only); fixed `GRASS_CYLINDER_RADIUS_M`/`GRASS_CYLINDER_LENGTH_M`
  constants (no slider — see scope boundaries).
- `getFixture(shape)` returns the right `PlaneTerrainDomain`/
  `SphereTerrainDomain`/`CylinderTerrainDomain`, its `ITerrainField`, root
  addresses, and cell-key function.
- `setCameraForShape(shape)` uses **near-surface standing points that keep
  the default `+Y` up-vector**, unlike scatter-lab's bird's-eye framing:
  - Sphere is centered at the world origin, so the `+Y` pole `[0, R, 0]` is a
    surface point whose local up already equals global `+Y`.
  - Cylinder's axis runs along world X (`getSurfacePosition` →
    `[axialM, cos(angle)*r, sin(angle)*r]`); the point at `angle = π` sits at
    local `(x, -R, 0)` with "up" (toward the axis) pointing `+Y`.

  This avoids adding a custom `upVector` template binding, and matters
  because a walking-height viewpoint (not a survey angle) is what makes
  wind/culling/horizon read as "standing in a field" and makes a small
  planet's horizon actually visible.
- `selectShape(shape)`: no-op if unchanged; else set the signal, teardown old
  terrain meshes/geometries + clear `cells`, `setCameraForShape`, rebuild
  terrain from the new fixture, `rebuildGrass`. Grass clump variant
  geometries are shape-independent and are not rebuilt.
- `setSphereRadius(...)` rebuilds the sphere fixture + re-derives the camera
  (radius affects standing height) whenever `shape() === 'sphere'`.

## Step 5 — Wire `meadow-lab` onto the promoted primitives

Delete the page-local `viewConeSuitability`/`captureCullForwardDirection`/
`cullForward`/`scratchDirection`. Read `scatterStreaming.viewForwardM`
(new getter) alongside the existing `viewpointWorldM` inside the same
`viewpointWorldM$` subscription. In `rebuildGrass()`:

```ts
viewCull: this.cullBehindCamera()
  ? {
      viewpointWorldM: this.viewpointWorldM,
      viewForwardM: this.scatterStreaming.viewForwardM,
      coneHalfAngleRad: GRASS_VIEW_CONE_HALF_ANGLE_RAD,
      objectRadiusM: GRASS_OBJECT_RADIUS_M, // ~0.35m, grass's own footprint
      horizon: this.shape() === 'sphere'
        ? { curvatureCenterWorldM: [0, 0, 0], curvatureRadiusM: this.sphereRadiusM() }
        : undefined,
    }
  : undefined,
```

passed alongside the existing `distanceFade` option — both now composed by
scatter. `GRASS_VIEW_CONE_HALF_ANGLE_RAD` and `GRASS_OBJECT_RADIUS_M` stay
demo-tunable `meadow-lab` constants; only the math moved into `scatter/`.

## Step 6 — UI + docs

- Three shape buttons ("Flat plane" / "Sphere" / "Inside cylinder") calling
  `selectShape(...)`.
- "Planet radius" slider, visible only when `shape() === 'sphere'`.
- Bump class doc comment + header `<small>` to "slice 5"; update the culling
  blurb to mention shape-switching, horizon occlusion, and why cylinder
  doesn't get a horizon test.

## Verification

- `npx tsc -p projects/demo-app/tsconfig.app.json --noEmit` and
  `npx tsc -p projects/triangular-engine/tsconfig.lib.json --noEmit` after
  each step (the pre-existing unrelated `jolt-leg.component.ts` TS1003 error
  is not this plan's concern).
- Manual numeric sanity check of the horizon formula: `R=25, altitude=4` →
  `horizonAngle ≈ acos(25/29) ≈ 30°`, arc distance ≈ 13 m — confirms the
  default sphere radius makes the horizon cut well inside the default
  view-distance fade, so it reads as the dominant, visible effect.
- Visual confirmation is manual (grass wraps correctly on sphere/cylinder;
  horizon line looks right when frozen + zoomed out on a small planet; cone
  still respects pitch on curved worlds) — call out exactly what to check per
  shape when the change lands.

## Explicitly out of scope for this slice

- Cylinder horizon occlusion (directionally wrong for a single-center-point
  test — would need a per-axial-slice formulation, not attempted here).
- A cylinder radius/length slider.
- A large landmark object demonstrating object-size-aware culling
  dramatically — deferred to a future `flora-scatter-lab` slice.
- Shadow-casting-aware culling gating (documented caveat only; moot while
  grass has `castShadow: false`).
- LOD billboards/impostors for far grass, and applying these primitives to
  flora/trees — both separate, later work.
