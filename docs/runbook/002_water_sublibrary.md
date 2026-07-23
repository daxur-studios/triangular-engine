# 002 — Water sub-library

## Status

- State: Planning
- Target entry points: `triangular-engine/water` (core), `triangular-engine/water/jolt` (physics)
- Initial renderer: WebGL
- Last updated: 2026-07-23 (cylinder domain built, awaiting live verification)

## TL;DR

Add a dedicated, optional water sub-library to triangular-engine: ocean and lake
surfaces with quality tiers, a single analytic wave model shared by CPU and GPU,
enter/leave-water events, an underwater effect with a wave-accurate waterline,
and Jolt buoyancy. Rivers with flow are a later phase. The one load-bearing
decision is that **every consumer of "where is the water surface" samples one
`WaterSurface` model** — rendering, waterline, buoyancy, and events must never
grow divergent copies of the wave function.

## Objective

A production-quality water system usable by any triangular-engine game
(including Bruno's Space Program), covering:

- Nice-looking ocean and lake surfaces with low/medium/high quality presets, so
  the same components serve a low-end stylised game and a high-end realistic one.
- A waterline ("meniscus") effect when the camera straddles the surface, in
  unison with the actual 3D waves.
- An underwater rendering state (fog/tint/distortion) with clean transitions.
- Game-facing events: any tracked object (and the camera) knows when it enters
  or leaves water, and how deep it is.
- Jolt buoyancy so dynamic bodies splash down, float or sink, and align with
  waves — reusing Jolt's `Body.ApplyBuoyancyImpulse`.
- Good composition with the other sub-libraries — in particular water meeting
  3D terrain at a beach must look intentional (depth fade, shore foam), and the
  underwater effect must run on the `triangular-engine/postprocessing` composer.
- Later: spline-based flowing rivers with the same water behaviour, where flow
  velocity feeds both the shader and buoyancy drag.
- Three base shapes, matching `004_multi_surface_terrain.md`'s domain triad:
  infinite plane (BSP's local/flat water), planetary sphere (convex, water
  curves away from the camera), and O'Neill-cylinder interior (concave, water
  curves the opposite way — up and around, not down and away). All three are
  built: plane (Phase 1a), sphere (Phase 1c), cylinder (Phase 1d) — see Phase
  1a's domain note and Phases 1c/1d below.

Intended consumer API (selector names may change after prototyping):

```html
<scene>
  <postprocessing-composer>
    <water-underwater-effect />
  </postprocessing-composer>

  <!-- Infinite/large ocean at a fixed sea level -->
  <water-ocean [seaLevel]="0" [waves]="wavePreset" [quality]="'medium'" />

  <!-- Bounded lake -->
  <water-lake [position]="[200, 42, -80]" [extent]="[120, 90]" [waves]="calmPreset" />

  <!-- Later phase -->
  <water-river [spline]="riverSpline" [width]="14" [flowSpeed]="2.5" />
</scene>
```

Physics (separate nested entry point so core water users do not pull Jolt):

```html
<jolt-physics>
  <jolt-rigid-body [motionType]="2" [position]="[0, 20, 0]">
    <jolt-box-shape [params]="[2, 1, 4]" />
    <water-buoyancy [buoyancy]="1.3" [linearDrag]="0.4" [angularDrag]="0.1" />
    <mesh>...</mesh>
  </jolt-rigid-body>
</jolt-physics>
```

Game-facing queries and events:

```ts
const water = inject(WaterService);
water.sample(position); // → { body, surfaceHeight, depth, flowVelocity, submerged }
water.track(object3D); // → { entered$, exited$, submergedFraction: Signal<number> }
water.cameraState; // Signal<'above' | 'crossing' | 'below'>
```

## The one decision to make now: a single `WaterSurface` model

Five different systems need to know the exact water surface height at a point
and time: the vertex shader displacing the mesh, the waterline effect, the
underwater on/off decision, buoyancy, and enter/leave events. If each computes
it independently they will drift, and the result is a buoy bobbing out of sync
with the visual waves or a waterline that clips at the wrong height. (This is
the same lesson BSP's planning docs record for atmosphere and sea level:
one query, not N copies — see `brunos-space-program/docs/v3-planning/04_north-star-features.md` §6.)

Therefore the foundation of the library is a plain, framework-free class:

```ts
export interface WaterSurface {
  /** Surface height (local Y) at world XZ and time t. */
  getHeight(x: number, z: number, t: number): number;
  /** Surface normal at world XZ and time t. */
  getNormal(x: number, z: number, t: number, out: Vector3): Vector3;
  /** Horizontal flow velocity (zero for oceans/lakes, nonzero for rivers). */
  getFlow(x: number, z: number, t: number, out: Vector3): Vector3;
}
```

The reference implementation is a **sum-of-Gerstner-waves** model:

- Analytic and cheap to evaluate on the CPU (buoyancy, events, waterline).
- The GLSL implementation is generated from / parameterised by the exact same
  wave list (direction, amplitude, wavelength, steepness, speed per wave), so
  CPU and GPU agree by construction. Wave parameters are uploaded as uniforms;
  the GLSL and TS implementations are covered by a unit test comparing sampled
  heights from the TS model against a CPU port of the GLSL math.
- Wave presets (calm lake, ocean swell, storm) ship as data, not code.

FFT/Tessendorf spectra, dynamic ripples, and wake displacement are explicitly
**out of scope for the model contract's first version** — they can be added
later as another `WaterSurface` implementation (with a CPU-readback or
approximation strategy) without touching consumers.

## Architecture

### Entry points and dependency direction

Follow the APF secondary-entry-point pattern used by `jolt/`, `rapier/`,
`pmndrs/`, `postprocessing/`, `takram/`:

```text
projects/triangular-engine/water/
├── ng-package.json
├── public-api.ts
├── index.ts
├── water.module.ts
├── core/
│   ├── water-surface.ts            # WaterSurface contract + Gerstner impl (no Angular)
│   ├── wave-presets.ts
│   └── water.service.ts            # scene-scoped registry, sample(), track(), cameraState
├── bodies/
│   ├── water-body.component.ts     # abstract base: registers with WaterService
│   ├── water-ocean.component.ts
│   ├── water-lake.component.ts
│   └── water-river.component.ts    # later phase
├── rendering/
│   ├── water-material.ts           # tiered ShaderMaterial (onBeforeCompile or raw)
│   ├── water-grid.ts               # camera-following clipmap/quadtree grid mesh
│   └── quality.ts                  # WaterQuality presets: 'low' | 'medium' | 'high'
├── effects/
│   ├── water-underwater-effect.component.ts   # postprocessing Effect
│   └── waterline.ts                           # meniscus band, shares wave uniforms
└── jolt/                            # nested secondary entry point: triangular-engine/water/jolt
    ├── ng-package.json
    ├── public-api.ts
    └── water-buoyancy.component.ts
```

Dependency rules:

- `triangular-engine/water` depends on `three` and core triangular-engine only.
  No physics imports anywhere in it.
- `triangular-engine/water/jolt` depends on `triangular-engine/water`,
  `triangular-engine/jolt`, and the optional `jolt-physics` peer. This keeps
  Jolt out of the bundle for rendering-only consumers, mirroring how
  `postprocessing` stays optional.
- `water-underwater-effect` is a `postprocessing`-package `Effect` registered
  through the existing `PostprocessingComposerComponent` (runbook 001's
  backend). It therefore requires the optional `postprocessing` peer, but only
  when the underwater effect is actually used. If that split proves awkward to
  tree-shake, promote the effect to its own nested entry point
  (`water/postprocessing`) — decide during Phase 2.

No new npm dependencies are expected: waves are our own math, and reference
material (`three/examples/jsm/objects/Water.js`, `Water2.js`, `WaterMesh.js`)
is already bundled with three.js. If a helper package is adopted later it must
follow the optional-peer pattern.

### Rendering approach (per quality tier)

One material, tier-gated features via shader defines. Unreal's water is the
design reference (water body components + shared wave data + one water zone /
registry + buoyancy probes), adapted to what WebGL/three.js does well:

| Feature                           | low                          | medium                                   | high                                            |
| --------------------------------- | ---------------------------- | ---------------------------------------- | ----------------------------------------------- |
| Wave displacement                 | normal maps only (flat mesh) | Gerstner vertex displacement (2-3 waves) | Gerstner (2-3 waves)                            |
| Fine chop                         | —                            | scrolling detail normal maps             | scrolling detail normal maps, tighter tiling    |
| Reflection                        | environment map / sky colour | environment map + fresnel                | screen-space reflection, falling back to planar |
| Refraction / below-surface colour | flat absorption colour       | scene-colour distortion via screen copy  | scene-colour distortion via screen copy         |
| Depth-based colour + shore fade   | ✓ (needs depth texture)      | ✓                                        | ✓                                               |
| Foam                              | shore band only              | shore band + ambient surface foam        | + whitecap/breaking foam at crests              |
| Caustics                          | —                            | —                                        | fake projected caustics (stretch goal)          |

**Phase 0 finding, binding for every later phase:** fine chop must come from a
_texture_ (scrolling detail normal maps, later optionally an FFT height/normal
field), never from adding more short-wavelength Gerstner waves to the vertex
grid. A Phase 0 spike tried the latter — layering 5-6 short waves onto an
80m/220-segment plane — and it read as a faceted diagonal grid, not water,
because a vertex grid can't resolve wavelengths near its sample spacing
without visible aliasing; reverted, see the 2026-07-22 log entry. Keep
Gerstner to 2-4 long, smooth swell waves and put everything higher-frequency
in shader/texture space instead.

Notes:

- **Depth texture** is the workhorse for terrain integration: soft shoreline
  fade, foam band, and depth-tinting all come from comparing water fragment
  depth against scene depth. This is what makes water meet the 3D terrain at a
  beach without a hard intersection line — no terrain-specific coupling needed,
  it works against any opaque geometry including the worlds-library patches.
- **Planar reflection** is one extra scene render per water plane per frame —
  acceptable for one ocean/lake at `high`, never enabled by default, and
  explicitly not supported for multiple simultaneously-visible bodies at first.
- **Mesh/LOD**: oceans use a camera-following concentric grid (clipmap-style,
  grid-snapped to avoid vertex swimming) with dense rings near the camera and
  coarse rings to the horizon, plus a far skirt to the horizon line. Lakes and
  rivers use bounded meshes with distance-based segment density. Planet-scale
  spherical oceans are **not** solved in the engine initially — see BSP
  integration below — but the material and `WaterSurface` model must not assume
  a flat infinite plane in their interfaces (they take positions, not UVs), so
  a cubesphere patch mesh can adopt them later.

### Waterline and underwater

- `WaterService` samples the surface at the camera each frame → a
  `cameraState` signal: `above`, `crossing` (near-plane straddles the surface),
  `below`. Hysteresis prevents flickering at the boundary.
- The **waterline** renders in the underwater effect's fragment shader: for
  pixels near the surface's screen-space intersection, evaluate the same
  Gerstner uniforms along the camera near plane and draw the meniscus band
  (slight thickening, brightening, and refraction offset) exactly where the
  analytic surface crosses the near plane. Because it evaluates the same wave
  uniforms as the displaced mesh, the line tracks the visual waves by
  construction.
- **Underwater** (fully below): depth-driven fog/tint using the water body's
  absorption colour, optional screen-space distortion, reduced far visibility.
  Sky/atmosphere effects above the surface are the consumer's concern; the
  effect only needs to not fight them (documented ordering with other effects
  in the composer).
- The water surface mesh renders double-sided so the underside is visible from
  below.

### Events and queries

`WaterService` is scene-scoped (provided with the engine like other engine
services), holds all registered water bodies, and answers point queries by
delegating to the containing body's `WaterSurface`:

- `sample(position)` → surface height, depth (negative above water), flow,
  containing body. Bodies have horizontal extents (infinite for ocean, bounds
  for lake, spline corridor for river); the first containing body wins, with a
  documented priority (river > lake > ocean) for overlaps like river mouths.
- `track(object)` → enter/exit observables + submerged-fraction signal,
  evaluated on the engine tick with a configurable interval for cheap bulk
  tracking. This is the physics-agnostic path games use for gameplay triggers,
  audio, and particle hooks (splash VFX themselves are out of scope; the event
  payload carries position and relative velocity so games can spawn their own).

### Jolt buoyancy (`triangular-engine/water/jolt`)

`WaterBuoyancyComponent` attaches to a parent `JoltRigidBodyComponent`
(same DI pattern as the shape components) and, on each physics tick before the
step:

1. Sample the `WaterSurface` at the body position → surface point + normal
   (a local plane approximation of the wave surface, refreshed every tick).
2. If the body is at or below the surface, call
   `body.ApplyBuoyancyImpulse(surfacePosition, surfaceNormal, buoyancy,
linearDrag, angularDrag, fluidVelocity, gravity, deltaTime)` — Jolt computes
   submerged volume from the body's own shape against that plane, which is
   exactly the pattern in `JoltPhysics.js/Examples/buoyancy.html`.
3. `fluidVelocity` comes from `getFlow(...)` — zero for oceans/lakes, the flow
   field for rivers, which makes "drifting downstream" fall out of the same
   call.
4. Feed enter/leave transitions into the same event stream as `track()`, so
   physics and non-physics consumers see one event vocabulary.

Design constraints:

- Detection is by surface sampling, not Jolt sensor volumes. Sensors suit
  fixed boxed volumes (as in the Jolt example); sampled height handles waves,
  bounded lakes, and rivers uniformly and avoids duplicate "am I in water"
  logic. Sensor-based detection can be added later if profiling demands it.
- The local-plane approximation is per body per tick. Very long bodies (ships)
  spanning multiple wave crests will need multi-probe support (several sample
  points averaged into the plane, or per-probe impulses) — designed as an
  optional `probePoints` input, implemented only when a real consumer needs it.
- The component wakes sleeping bodies on water entry (`ActivateBody`), and
  respects the adapter/integrator boundary: BSP-style games consume this
  through their own physics adapter layer, so the component must also expose
  its per-tick sampling as a plain function usable outside Angular.
- BSP runs the **double-precision Jolt fork** (`_external/JoltPhysics.js`) with
  floating-origin rebasing; the stock npm `jolt-physics` is the engine's peer.
  `ApplyBuoyancyImpulse` exists in both, but the component must take positions
  in the physics world's local frame (post-rebase), never assume world == render
  coordinates. Verify against the f64 fork's typings during Phase 3.

### Rivers (later, but designed for now)

- `water-river` takes a centreline spline + width (optionally per-point) and
  builds a swept ribbon mesh with UVs parameterised along the spline.
- Flow: direction follows the spline tangent; the shader uses the standard
  flow-map ping-pong technique (two phase-offset samples blended) so normal
  maps advect downstream without stretching artifacts — same approach as
  three.js `Water2`.
- `getFlow` returns tangent × flowSpeed for points inside the river corridor;
  `getHeight` interpolates the spline's height profile (rivers can descend) plus
  small-amplitude waves. This means buoyant bodies automatically drift and
  descend with the river with **zero river-specific physics code**.
- Out of scope even for the river phase: waterfalls, rapids/whitewater
  simulation, river-carving of terrain (rivers are placed over terrain by the
  consumer; shoreline blending comes from the same depth-fade as lakes).

### BSP / planetary integration (tracked in BSP, not here)

The engine library deliberately stops at "flat-ish local water". BSP's
planetary needs — per-body sea-level datum (`radius + seaLevelAltitude`),
cubesphere ocean patches sharing LOD machinery with the terrain patch mesher,
floating-origin/scaled-space handling per `docs/PLANETARY-SCALE-PHYSICS.md` —
belong in a BSP plan doc (`docs/v3-planning/plans/`) linked from doc 04 §6 when
that work is scheduled. The contract this runbook must honour for that future:
`WaterSurface` and the water material take world positions and an "up" frame,
so a spherical implementation can substitute its own datum and geometry without
forking the shading or the buoyancy component.

## Implementation plan

### Phase 0 — Surface model + entry-point spike

- [x] Scaffold `projects/triangular-engine/water/` (ng-package.json,
      public-api.ts) and confirm the package builds with the new entry point.
      `water.module.ts` and the nested `water/jolt` entry-point stub are
      deferred — no components exist yet to put in a module, and Jolt wiring
      is Phase 3's job; both are trivial to add when needed.
- [x] Implement `GerstnerSurface` (`WaterSurface` impl) in plain TS with unit
      tests: height/normal continuity, periodicity, flow = 0.
- [x] Implement the matching GLSL (vertex displacement from the same wave
      uniform layout) and a test comparing TS heights against a TS port of the
      GLSL math for a grid of sample points.
- [x] Demo page: displaced plane + a marker "buoy" object whose Y and tilt come
      from CPU `getHeight`/`getNormal` each frame. Shipped as
      `/water-surface-spike` in demo-app with 5 buoys and a 3-preset switcher.

Exit gate: the buoy visibly rides the GPU-displaced waves with no offset —
proving the single-surface-model premise before anything else is built.
**Met and user-verified 2026-07-22** — see investigation log.

### Phase 1a — Large-scale LOD proof (CDLOD-style morphing clipmap)

Large-scale water is the actual point of this library for BSP, not a
polish pass — this phase proves it before any material work lands on top.
Terrain's `patch-mesher.ts` uses independent quadtree patches stitched with
skirts (a hidden-seam workaround, not seam-free by construction); water's
grid deliberately does not repeat that. See `004_multi_surface_terrain.md`
for the parallel, independently-authorised terrain rewrite — it is heading
toward a clipmap for its plane domain too, and both docs agree water stays
decoupled from terrain generation, so this phase does not touch terrain code.

- [x] Concentric-ring clipmap grid: one shared regular vertex raster, not
      independent tiles, grid-snapped to the camera so rings never drift out
      of alignment with each other.
- [x] Continuous CDLOD-style vertex morphing between ring resolutions — each
      vertex interpolates toward its coarser-ring position as it nears the
      ring boundary, so the LOD switch is invisible and no skirt geometry is
      needed.
- [x] Wireframe debug toggle to see the morph live and confirm there is no
      popping, no T-junctions, and no crack at any ring boundary.
- [x] POC demo page: flat shaded water, large radius, camera flythrough at
      speed, wireframe toggle, perf overlay.

Exit gate: continuous coverage at a large radius (document the tested
radius/ring-count and frame cost), zero visible seams/cracks/popping in
either wireframe or shaded view at any camera speed, user-verified.
**Met and user-verified 2026-07-22** — 5 levels (core + 4 rings,
`coreSizePatches: 16`, `baseCellSize: 4`), outer edge at 512m from camera —
see the two investigation log entries below for the overlap and corner-void
fixes that got it there.

**Domain note**: this phase implements the plane domain only —
`computeWaterLodLevels` places patches directly in world XZ, which only
makes sense where "flat and infinite" is the right model. Sphere (planetary)
and cylinder-interior (O'Neill hab, opposite curvature to a planet) are
required shapes for this library, not stretch goals, but they are not this
phase's job: 004's `ITerrainSurfaceDomain<TAddress>` contract
(`getPatchBounds`/`getFieldPosition`/`getSurfacePosition`/`getGeometricErrorM`)
is the right shape for water's own domain adapters later, since both systems
need the same plane/sphere/cylinder parametrisations. The CDLOD morph
*technique* (snap toward a coarser grid, blend by distance) is domain-
agnostic; `computeWaterLodLevels`'s placement math is not, and should not be
mistaken for shape-agnostic infrastructure when sphere/cylinder work starts.
Water should follow, not lead, 004's sphere/cylinder domains rather than
inventing a second version — track as a new phase once 004 has them.

**Revision (2026-07-22, Phase 1c)**: 004's `SphereTerrainDomain` shipped, but
adopting `ITerrainSurfaceDomain<TAddress>` literally turned out to be the
wrong fit after all — that contract is shaped around terrain's discrete
quadtree patches + skirts, the exact seam-prone pattern this phase's opening
paragraph already rejected for water. It also only carries a scalar
elevation (`getSurfacePosition(address, u, v, elevationM: number)`), not
enough for Gerstner's horizontal + vertical displacement. Phase 1c instead
built a small water-only `WaterSurfaceDomain` abstraction (continuously
recentring local tangent frame, not patch addresses) — see Phase 1c below
for the design and why it still keeps water and terrain decoupled.

### Phase 1b — Ocean and lake material, low + medium tiers

- [x] Water material: scrolling detail normals, fresnel, absorption colour,
      depth-texture shoreline fade and depth tint, built on the Phase 1a grid.
      Shipped as `/water-material-poc`; user-verified 2026-07-22 including
      under `logarithmicDepthBuffer: true` — see investigation log.
- [ ] Shore foam band (medium tier) from depth delta.
- [ ] Bounded mesh (distance-based segment density, no clipmap needed) for
      `water-lake`.
- [ ] `water-ocean` / `water-lake` components + `WaterService` registry with
      `sample()`.
- [ ] Quality presets (`low`/`medium`) switchable at runtime; wave presets as
      data.
- [ ] Demo: ocean + separate lake against sloped opaque "terrain" geometry;
      verify the beach transition.

Exit gate: a good-looking medium-tier ocean and lake against a beach slope,
no visible grid seams or swimming vertices while the camera moves, runtime
quality switch works.

### Phase 1c — Sphere domain (curved local tangent-plane grid)

Curves the unchanged Phase 1a/1b flat CDLOD grid onto a sphere instead of
adopting terrain's discrete-patch domain model — see the Phase 1a revision
note above for why.

- [x] `WaterSurfaceDomain` interface (`getLocalFrame(referencePosition)`,
      `composeWorldPosition(frame, localX, localZ, heightAlongNormal)`) plus
      `PlaneWaterDomain` and `SphereWaterDomain` implementations in
      `water/core/water-domain.ts`, unit tested (frame correctness at the
      equator/poles/arbitrary points, exact radius round-trip, plane
      reproduces the pre-Phase-1c formula exactly).
- [x] `water-domain-glsl.ts`: domain uniforms, `waterComposeWorldPosition`
      (plane path plus an `#ifdef WATER_DOMAIN_SPHERE` renormalize branch,
      same compile-time-`#ifdef` pattern as the log-depth chunks), and a
      separate `waterComposeWorldNormal` — composing the normal to world
      space is domain-agnostic, but must happen *after* the detail-normal
      texture perturbs it in local space, since that perturbation assumes a
      near-vertical base normal (true in world space only for the plane;
      only true in the *local* frame for a sphere away from directly
      "north" of the camera).
- [x] `/water-sphere-poc` demo: same grid/material/Gerstner/shading
      infrastructure as `/water-material-poc`, `SphereWaterDomain` instead of
      raw world XZ, a bumpy `SphereGeometry` "ground" with 3 raised islands
      feeding `WaterDepthPrepass` for shore-fade, camera framing and
      `orbitControls`' `upVector` both derived from the domain's own frame at
      start (not hand-picked), ring-count capped lower than the plane demo to
      keep the ring radius a safe margin under a quarter of the sphere's
      circumference (chord-vs-arc error is negligible at this margin —
      `patchRadius² / (2·bodyRadius)`).

Exit gate: continuous, seam/pop/swim-free coverage while orbiting the whole
sphere including near both poles, user-verified in `/water-sphere-poc`.
**Met and user-verified 2026-07-23.**

Out of scope for this phase (deferred, not forgotten): CPU
`WaterSurface.getHeight`/`getNormal` queries on a sphere (needs a
world-position → local-frame inversion; no buoyancy consumer exists yet to
need it), floating-origin/scaled-space integration with BSP's actual planet
placement, the cylinder-interior domain (opposite-facing normal, same
technique — its own phase), shore foam and the other still-open Phase 1b
items.

### Phase 1d — Cylinder domain (interior wall, opposite-facing normal)

Curves the same unchanged flat CDLOD grid onto the *inside* of a cylinder
wall (O'Neill habitat), the concave counterpart to Phase 1c's convex sphere:
water rises up and around the camera at distance instead of falling away
toward a horizon.

- [x] `CylinderWaterDomain` (`radiusM`, `axis`, `center`) in
      `water/core/water-domain.ts`: `normal` points inward toward the axis
      (matching centrifugal "gravity" pushing outward against the wall, so
      "up" is toward the centerline — the opposite sign from
      `SphereWaterDomain`); `tangentU` is the cylinder axis itself (zero
      curvature along the tube's length); `composeWorldPosition` renormalizes
      only the component *perpendicular* to the axis, carrying the axial
      coordinate through unchanged. Unit tested (frame correctness off-axis,
      on-axis fallback, exact radius round-trip from the axis line — not
      from `center` — and exact axial-coordinate preservation through
      `composeWorldPosition`).
- [x] `water-domain-glsl.ts`: additive `uCylinderAxis`/`uCylinderCenter`/
      `uCylinderRadius` uniforms and a `WATER_DOMAIN_CYLINDER` branch in
      `waterComposeWorldPosition`, mirroring the TS formula exactly.
      `waterComposeWorldNormal` needed no changes — already domain-agnostic.
- [x] `/water-cylinder-poc` demo: same grid/material/Gerstner/shading
      infrastructure as `/water-sphere-poc`, `CylinderWaterDomain` (axis
      `+Y`, radius 500m, matching the sphere demo's scale so the same
      ring-count-cap margin applies) instead of a sphere, an open-ended
      bumpy `CylinderGeometry` "ground" wall (bumps decrease radius —
      "up" toward the axis, opposite sign from the sphere ground's islands)
      feeding `WaterDepthPrepass`, camera framing and `upVector` derived
      from the domain's own frame at a bump, same as Phase 1c.

Exit gate: continuous, seam/pop/swim-free coverage while orbiting around the
circumference and flying along the tube's length, user-verified in
`/water-cylinder-poc`.

Out of scope for this phase (deferred, not forgotten): same list as Phase
1c's out-of-scope bullets, plus end-cap geometry (the domain itself is an
infinite tube; the demo's ground mesh is just finite for visual framing).

### Phase 2 — Events, underwater, waterline

- [ ] `track()` API + camera state signal with hysteresis.
- [ ] `water-underwater-effect` on the `postprocessing` composer: depth fog,
      tint, optional distortion.
- [ ] Waterline meniscus band evaluating the shared wave uniforms at the near
      plane; double-sided surface rendering.
- [ ] Decide (and record here) whether the effect stays in `water` or moves to
      a `water/postprocessing` nested entry point, based on tree-shaking
      verification in a clean consumer build.
- [ ] Demo: fly the camera through the surface repeatedly; show enter/exit
      events and depth readout in the UI.

Exit gate: crossing the surface shows a stable, wave-accurate waterline and a
convincing underwater state; events fire exactly once per crossing.

### Phase 3 — Jolt buoyancy

- [ ] `WaterBuoyancyComponent` in `water/jolt`: per-tick surface sampling →
      `ApplyBuoyancyImpulse`, body activation on entry, enter/leave events into
      the shared stream.
- [ ] Expose the sampling→impulse step as a plain function (adapter-friendly,
      no Angular required) and verify the call signature against the f64 fork's
      typings (`_external/JoltPhysics.js`).
- [ ] Demo: dropped boxes/capsules of varying density splash down, bob in sync
      with the visual waves, float or sink; a "dead stage" style capsule
      stabilises floating on its side.

Exit gate: a dropped dynamic body visibly floats **on** the rendered waves
(not on an invisible flat plane), and the demo shows tunable
buoyancy/drag producing float vs. sink.

### Phase 4 — High tier

- [ ] Planar reflection render target for the active body, high preset wiring,
      distance-blended detail normals, wave-crest foam.
- [ ] Screen-colour refraction/distortion pass if not already done in Phase 1.
- [ ] Performance pass: measure all three tiers, document costs and preset
      guidance (like takram's quality presets), high-DPI check.

Exit gate: high tier is visually clearly better than medium, low tier runs
cheaply, and the costs are documented.

### Phase 5 — Rivers

- [ ] Spline ribbon mesh + along-spline UVs and height profile.
- [ ] Flow-map ping-pong advection in the material; `getFlow` implementing the
      corridor query; body priority (river > lake > ocean).
- [ ] Buoyancy demo: object dropped in the river drifts downstream and out into
      a lake, transitioning bodies without event glitches.

Exit gate: a flowing river that looks continuous with a lake at its mouth, and
physics objects that ride it downstream using only the existing buoyancy
component.

### Phase 5b — Wakes (later, optional)

Added after a feature-coverage crosswalk against a broader ocean-rendering
feature list (2026-07-22 log entry) — a moving-body wake was the one gap that
matters for BSP's actual ask ("rocket moving with 3D water").

- [ ] `water-wake` directive/component attaches to any Object3D; each frame it
      reads the body's world velocity (already available — Jolt bodies expose
      it, non-physics objects can supply it directly) and stamps a displacement + foam contribution into a scrolling trail texture behind the body.
- [ ] The wake texture is sampled by the water material as an additive height
      and foam-coverage term — it does not change `WaterSurface`'s contract or
      buoyancy, since a wake is a rendering-only perturbation on top of the
      shared wave model, not a new physics input.
- [ ] Multiple simultaneous wakes (e.g. two vessels) composite into the same
      trail texture without a full-screen cost per wake source.

Exit gate: a body moving across the water leaves a visible, foamy trail that
fades out behind it and looks continuous with the underlying swell.

### Phase 6 — Productise

- [ ] Docs page (`projects/triangular-engine/docs/water.md`) + skill update so
      agents know the selectors.
- [ ] Unit tests for lifecycle, registry, tier switching; screenshot regression
      where practical.
- [ ] Clean external consumer test: core-only install must not require
      `jolt-physics` or `postprocessing`; tree-shaking verified.
- [ ] BSP follow-up: open the BSP plan doc for planetary oceans referencing
      this runbook (done in the BSP repo, not here).

Exit gate: documented, independently installable, safe to publish.

## Minimum test matrix

| Area                | Cases                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Surface model       | TS vs GLSL height agreement; normals; flow; preset switching              |
| Bodies              | ocean only; lake only; overlapping river/lake/ocean priority              |
| LOD grid            | camera fly-through at speed; no seams/swimming; horizon skirt             |
| Terrain integration | beach slope; steep cliff; water deeper than far plane                     |
| Camera              | above/crossing/below transitions; rapid oscillation (hysteresis)          |
| Events              | single object; many tracked objects; tracked object destroyed             |
| Buoyancy            | float; sink; neutral; long body; sleeping body entering water; flow drift |
| Quality tiers       | runtime switch low↔medium↔high; reflection on/off                         |
| Renderer            | WebGL success; WebGPU explicit rejection; logarithmic depth buffer on ✓  |
| Packaging           | core-only install; water-only; water+jolt; clean consumer build           |

## Open questions

- ~~Does the depth-texture requirement (shoreline fade) work in the plain
  forward path without the postprocessing composer, or does `low`/`medium`
  water already require a depth prepass helper in core?~~ **Resolved**: yes,
  in the plain forward path — `WaterDepthPrepass` (`rendering/`) is a small
  core helper (`scene.overrideMaterial = MeshDepthMaterial` into an offscreen
  `WebGLRenderTarget` with a `DepthTexture`), called from
  `EngineService.postTick$`, no `postprocessing` composer involved.
- Planar reflection with the `postprocessing` composer active: render-order and
  RT interaction need a spike before committing Phase 4's design.
- ~~Logarithmic depth buffer: runbook 001 showed effect materials silently
  mis-reconstructing log depth. Water's depth-based shading must be tested with
  `logarithmicDepthBuffer: true` early (Phase 1), since BSP planet scenes use it.~~
  **Resolved 2026-07-22**, see investigation log — `WATER_DEPTH_UNPACK_GLSL`
  branches on three.js's auto-injected `USE_LOGARITHMIC_DEPTH_BUFFER` define,
  and four new `WATER_LOGDEPTH_*_GLSL` passthrough chunks wire the water
  material's own vertex/fragment shaders into three's log-depth encoding so
  its hardware depth test matches built-in materials. User-verified in-browser.
- Rapier buoyancy parity: out of scope; is a `water/rapier` entry ever wanted,
  or is Jolt-only acceptable long-term?
- Should wave presets/quality presets be JSON-serialisable data the consumer
  can persist (settings menus)? Leaning yes — keep them plain objects.
- Water masking (hide the surface inside a hull/cave interior by registering
  mask meshes) — worth adding, likely Phase 4/6; not yet scoped in detail.
- SSR vs. planar reflection for the high tier: SSR is cheaper (no second scene
  render) but loses off-screen/occluded reflections; planar is exact but
  double-renders the scene. Spike both before committing Phase 4's design —
  SSR as primary with planar (or plain fresnel) as the off-screen fallback is
  the likely answer.
- Should `WATER_WAVE_PRESETS` grow into full "environment presets" (wave list
  + colour + foam coverage + fog distance bundled together, switchable at
  runtime, e.g. named tropical/stormy/moonlit presets)? Natural fit once
  Phase 1's material inputs exist; revisit then rather than guessing the
  shape now.

## Risks

- Transparency sorting: water is a large transparent surface; interaction with
  other transparent objects and with post effects is a classic artifact source.
- Planar reflections double scene cost; must stay opt-in and single-body.
- The waterline effect is screen-space and analytic; extreme wave steepness at
  grazing angles may expose mismatch with the displaced mesh silhouette —
  acceptable within tested wave-preset ranges, documented limits otherwise.
- CPU sampling cost if games track hundreds of objects — the tick interval and
  bulk sampling design must keep this linear and cheap.
- Gerstner self-intersection when a preset's summed displacement gradient
  (Σ steepness·k·amplitude, not raw steepness) approaches 1;
  `GerstnerSurface` warns when this happens.
- Same three.js-version sensitivity as every shader-heavy entry point.

## Feature coverage crosswalk

Checked our phased plan against a broader ocean-rendering feature list to spot gaps early.

| Feature | Status |
| --- | --- |
| Depth colour, refraction, reflection | Covered — Phase 1 depth-tint/shore-fade, Phase 4 screen-colour refraction + reflection |
| FFT wind waves + Gerstner swell | Gerstner-only, shared by rendering and physics. FFT detail is a possible Phase 4+ rendering-only add-on, not a replacement — see the chop-must-be-textured finding above |
| Three-layer foam | Phase 4 retitled to cover shoreline + ambient + whitecap explicitly |
| Buoyancy, multi-point sampling | Covered — Phase 3, `probePoints` stretch input for long bodies |
| Underwater fog/distortion + waterline | Covered — Phase 2, this plan's cornerstone feature |
| Caustics | Existing stretch goal, unscoped beyond that |
| Boat wake | Gap — added as Phase 5b; the visible signature of "object moving through water" |
| Infinite water + LOD clipmap | Covered — Phase 1a, CDLOD-style morphing clipmap, seam-free by construction |
| Environment presets | Only wave presets exist today; bundling colour/foam/fog into full presets is now an open question |
| Compile-time quality stripping | Matches intent — shader `#define`-gated tiers, disabled code excluded, not just branched at runtime |
| Multiplayer determinism | Already true by construction — `WaterSurface` is a pure function of (position, time), so synced clients compute identical waves with no extra sync code |
| Water masking (hulls/caves) | Gap — added as an open question, likely Phase 4/6 |
| WebGPU with fallback | WebGL-first throughout, matching the rest of triangular-engine; WebGPU is a reasonable later renderer target |

Net effect: no phase numbers changed except adding Phase 5b (wake) and two
open questions (masking, SSR-vs-planar); the core architecture — one shared
analytic `WaterSurface`, texture-space chop, not geometry-space — holds up
well against a much broader feature list precisely because physics/events/
waterline never depended on the expensive rendering-only detail layer.

## References

- Jolt buoyancy example: `d:\code\_external\JoltPhysics.js\Examples\buoyancy.html`
  (`ApplyBuoyancyImpulse` usage pattern)
- three.js reference material: `three/examples/jsm/objects/Water.js` (planar
  reflection), `Water2.js` / `WaterMesh.js` (flow maps, Gerstner)
- Unreal Engine Water system (design reference: water body types, shared wave
  data asset, buoyancy probe pontoons)
- BSP water design note: `brunos-space-program/docs/v3-planning/04_north-star-features.md` §6
  (sea level as per-body datum — the one-query lesson this runbook generalises)
- BSP planetary constraints: `brunos-space-program/docs/PLANETARY-SCALE-PHYSICS.md`
  (floating origin, scaled space, f64 fork)
- Existing placeholder to replace:
  `projects/triangular-engine/src/lib/engine/features/environment/components/ocean.component.ts`
- Runbook 001 (`001_add_takram_three_clouds.md`) — entry-point, optional-peer,
  and postprocessing-composer patterns this runbook reuses
- Runbook 004 (`004_multi_surface_terrain.md`) — parallel, independently
  authorised terrain rewrite; its plane domain is also heading toward a
  clipmap, and it explicitly keeps water decoupled from terrain generation
  (see Phase 1a). Worth checking before generalising water's clipmap into a
  shared primitive.
- Losasso & Hoppe, "Geometry Clipmaps" and Strugar's CDLOD — the vertex
  raster + continuous-morph technique Phase 1a implements; chosen because it
  is seam-free by construction, unlike terrain's current skirt-based
  quadtree patches.

## Investigation log

### 2026-07-22 — Initial plan

- Context gathered across BSP planning docs, the existing toy `ocean`
  component, Jolt's buoyancy example, three.js bundled water shaders, and the
  takram/jolt entry-point patterns; plan drafted.
- Chose `triangular-engine/water` + nested `water/jolt` as the entry-point
  split, a single analytic `WaterSurface` (Gerstner) model as the cornerstone,
  surface-sampling (not Jolt sensors) for water detection, and depth-texture
  shading for terrain/beach integration.
- Deferred to later phases/repos: rivers (Phase 5), FFT ocean, wakes/ripples,
  caustics (stretch), WebGPU, and BSP's planetary spherical oceans (BSP plan
  doc to be opened when scheduled).

### 2026-07-22 — Phase 0 spike built and verified

- Scaffolded `projects/triangular-engine/water/` (ng-package.json,
  public-api.ts, index.ts) plus `core/water-surface.ts` (`WaterSurface`
  interface, `GerstnerSurface`, `resolveGerstnerWave(s)`) and
  `core/wave-presets.ts` (calm-lake, ocean-swell, storm).
- Added `core/gerstner-glsl.ts`: GLSL displacement/normal chunks plus
  `createGerstnerUniforms`/`updateGerstnerUniforms`, both built from the same
  `resolveGerstnerWaves` the TS surface uses — the single-source-of-truth
  guarantee the plan calls for is enforced by sharing that one function, not
  by convention.
- Unit tests (`water-surface.spec.ts`, 10 cases) cover: TS `displace()`
  matching a plain-number port of the GLSL formula for random samples,
  `getHeight` correctly inverting horizontal displacement back to a requested
  world XZ, normal unit-length/flat-case correctness, wavelength periodicity,
  zero flow for still water, and constructor validation. Registered via
  `angular.json`'s `test.options.include` (karma's default `**/*.spec.ts`
  glob is resolved relative to the project's `sourceRoot`, i.e. `src/`, not
  the project root as the schema text implies — secondary entry points need
  an explicit `../<entry>/**/*.spec.ts` include or their specs never run).
- Found and fixed a real bug during testing: the constructor's
  self-intersection warning checked raw summed `steepness` (0..1 per wave)
  against a `> 1` threshold, but steepness alone doesn't predict folding — the
  actual risk is the summed _displacement gradient_
  (Σ steepness·k·amplitude). The old heuristic false-positived on a
  perfectly well-behaved preset; fixed to use the gradient sum.
- Added `/water-surface-spike` to demo-app: a GPU-displaced plane
  (`gerstnerDisplace`/`gerstnerNormal` in a hand-written `ShaderMaterial`) plus
  five buoy meshes positioned/oriented on the CPU each frame from
  `GerstnerSurface.getHeight`/`getNormal` at fixed world-XZ anchors, using the
  same elapsed time as the GPU uniform. Preset switcher (calm lake / ocean
  swell / storm) rebuilds the CPU surface and calls
  `updateGerstnerUniforms` on the same uniform objects bound to the material.
- **User-verified in-browser**: all three presets render, buoys sit exactly on
  the displaced surface with no visible offset — the Phase 0 exit gate (CPU/GPU
  parity) is confirmed, not just unit-tested.
- **Regression and revert**: tried adding several short-wavelength "chop"
  waves on top of the swell to address feedback that the surface read "more
  mountainy than wavy." Result was worse — a visibly faceted diagonal grid,
  less watery than the original. Root cause: the 220-segment/80m plane can't
  resolve short wavelengths without aliasing into visible geometric facets:
  fine chop has to live in shader/texture space (scrolling detail normal
  maps, per the existing Phase 1 plan), not as more Gerstner waves on a
  fixed-resolution vertex grid. Reverted `wave-presets.ts` to the original
  values; recorded as a binding finding in the rendering-approach table above
  so Phase 1 doesn't repeat the mistake.
- Ran a feature-coverage crosswalk against a broader ocean-rendering feature
  list at the user's request; added the crosswalk table above. Net new scope:
  Phase 5b (boat wake) and two open questions (water masking, SSR-vs-planar
  reflection). Confirmed the architecture holds up: the one-shared-model
  design is _already_ multiplayer-deterministic by construction, and the
  chop-aliasing finding independently reproduces why real ocean renderers
  never put fine chop in geometry.
- `npm run agent:verify-work`-equivalent checks run for this workspace:
  `ng test triangular-engine` (34/34 pass, includes the 10 new water specs)
  and `ng build demo-app --configuration development` (clean, water spike
  page bundles as its own lazy chunk).

### 2026-07-22 — Phase 1 restructured around large-scale LOD first

- User flagged that large-scale/planetary water — not a small demo rectangle —
  is the most important part of this plan and was under-scoped: Phase 1's
  clipmap was a bullet point, and true planet curvature was explicitly punted
  to a not-yet-written BSP doc.
- Checked `patch-mesher.ts`: terrain's current LOD is independent quadtree
  patches stitched with skirts — confirmed this hides seams rather than
  avoiding them by construction, matching the user's report of ongoing seam
  trouble there "even after a lot of effort."
- User asked for a from-scratch POC of a better LOD technique, referencing an
  Unreal Engine effect where vertices visibly slide out of pre-existing
  positions in wireframe. Identified this as CDLOD-style continuous vertex
  morphing on a shared concentric-ring raster (geometry clipmap) — seam-free
  because neighbouring rings share one grid and vertices morph continuously
  into their coarser-LOD position before the LOD switch, rather than popping.
- Split Phase 1 into 1a (large-scale LOD proof: morphing clipmap, wireframe
  debug, flythrough POC page, no material work) and 1b (the original
  material/tier work, now built on top of 1a's grid instead of a placeholder
  plane).
- Discovered `004_multi_surface_terrain.md` mid-discussion (opened by the
  user): a parallel, independently-authorised terrain rewrite (Phase 0 only,
  not touching the live cylinder) whose plane domain is also heading toward a
  clipmap, and which already states terrain mesh output must support water
  without coupling terrain generation to water rendering. No conflict — added
  a cross-reference in both directions rather than merging the efforts.
  Spherical/planetary curvature remains out of scope for this runbook's
  Phase 1a (flat clipmap only); revisit once 1a proves out and 004 has a
  sphere adapter to compare against.

### 2026-07-22 — Ring-boundary overlap fixed via fragment discard

- User reported, with the level-tint debug toggle, that the three innermost
  ring boundaries (levels 1↔2, 2↔3, 3↔4) visibly double-rendered — patches of
  one level bleeding into another — while the outermost boundary (4↔5) looked
  correct. Confirmed this was two literally-overlapping `InstancedMesh`
  levels z-fighting, not a shading artifact: `computeWaterLodLevels` shrinks
  each ring's inner hole by one whole patch as a safety margin (documented in
  its own header comment), which was previously assumed "harmless" — true
  only where nothing distinguishes the two layers, false here because
  neighbouring levels have different tessellation density over the same
  world area, so the overlap is visible in the sea material.
- Considered three options with the user: (1) tighten the existing approach
  to be geometrically non-overlapping, (2) a true single-buffer geometry
  clipmap (Losasso-Hoppe style), (3) leave/mask it. Initially leaned toward
  (2), then corrected that framing before implementing: real CDLOD (Strugar,
  Unreal terrain) does **not** use one combined vertex buffer either — it
  keeps per-level draw calls and gets seamlessness from non-overlapping
  footprint selection plus boundary-only vertex morphing. Put the corrected
  choice to the user via `AskUserQuestion`; user picked "Proper CDLOD
  (non-overlapping rings)" over a true single-buffer clipmap.
- While deriving the non-overlapping footprint math, found that exact
  non-overlap is actually impossible: each level snaps its own centre to the
  camera independently (`round(camera / patchWorldSize)`), so a fixed hole
  size that avoids overlap in the worst-case drift leaves a gap in the
  best-case drift, and vice versa — there is no single hole size that is
  simultaneously gap-free and overlap-free under independent snapping.
- Resolved by keeping the geometry overlapping (as it already was) but adding
  a hard **fragment-discard ownership rule**: each level's fragment shader
  discards any fragment outside the exact world-space annulus it owns, via
  a new `computeWaterLodBoundaryRadius(level, options)` (`water-lod-grid.ts`)
  and `WATER_LOD_CULL_GLSL` (`water-lod-glsl.ts`). The boundary radius is the
  midpoint between the finer level's worst-case-guaranteed solid radius and
  the coarser level's worst-case-guaranteed hole radius, so both sides keep
  a safety margin and exactly one level ever shades any given world point.
  Morph end distance was changed to match each level's own outer cull
  radius (rather than its raw geometric edge), so the last fragment a level
  draws is already phase-aligned with whoever takes over from there.
- Added 3 unit tests for `computeWaterLodBoundaryRadius` (rejects `level < 1`;
  radius doubles per level; sits strictly between the finer level's true edge
  and the coarser level's hole edge). `ng test triangular-engine`: 61/61 pass.

### 2026-07-22 — Ring-corner black voids fixed via Chebyshev distance

- User reported black voids at the four corners where ring boundaries should
  stitch together, immediately after the overlap fix above landed.
- Root cause: `computeWaterLodLevels` places axis-aligned **square** ring
  holes/footprints (independent `|dx| < threshold` and `|dz| < threshold`
  checks), but `waterLodMorph`/`waterLodCull` tested against
  `computeWaterLodBoundaryRadius` using Euclidean `distance()` — a circle.
  Along the diagonals a square's true edge sits up to √2× farther from
  centre than along an axis, so the circular cull radius (sized correctly
  for the axis-aligned worst case) discarded the finer level's fragments at
  the corners before the coarser level's square hole actually had geometry
  there, leaving an uncovered gap.
- Fixed by switching both GLSL functions (`water-lod-glsl.ts`) and the demo
  page's duplicate `vMorph` debug-varying calculation
  (`water-lod-poc-page.component.ts`) from Euclidean to Chebyshev
  (L-infinity, `max(|dx|, |dz|)`) distance, matching the square shape
  exactly in every direction. No change was needed to
  `computeWaterLodBoundaryRadius`'s numeric formula — its bounds were already
  derived per-axis and become exact/tight under the Chebyshev metric; only
  the JSDoc was updated to state the required metric explicitly. Caught and
  removed a broken, unused leftover GLSL constant from a false-start during
  this edit before it landed. `ng test triangular-engine`: 63/63 pass (+2 for
  the boundary-radius tests added in the previous entry).
- **User-verified in-browser 2026-07-22**: "works like a charm!" — both fixes
  confirmed to resolve the reported artifacts; Phase 1a exit gate met.

### 2026-07-22 — Phase 1b material spike built, four bugs fixed, log depth resolved

- Built `/water-material-poc`: `WATER_DETAIL_NORMAL_GLSL` (dual-scroll
  procedural normal map chop), `WATER_FRESNEL_GLSL`, `WATER_DEPTH_UNPACK_GLSL`
  + `WATER_DEPTH_FADE_GLSL` (shore fade / absorption tint against a
  `WaterDepthPrepass` capture), layered on the Phase 1a LOD grid against a
  static sloped "shore" `PlaneGeometry`. `WaterDepthPrepass` renders the opaque
  scene depth (water hidden, via `scene.overrideMaterial = MeshDepthMaterial`)
  into an offscreen `WebGLRenderTarget`/`DepthTexture` each frame from
  `EngineService.postTick$` — answers the "does depth-texture shading need the
  postprocessing composer" open question: no.
- User reported four distinct visual bugs in sequence, each root-caused by
  reading actual source (three.js internals, not guessed) rather than trial
  and error:
  1. **Resolution/UV mismatch** ("water plane moves weirdly vs. the shore,
     alignment changes with camera"): `uResolution` was set from
     `engine.width`/`height` (CSS logical pixels) but `gl_FragCoord.xy` is
     always physical framebuffer pixels — broke `screenUV` whenever
     `devicePixelRatio > 1`. Fixed via `renderer.getDrawingBufferSize()`.
  2. **Absorption/colour saturation** ("water is too black"):
     `absorptionDistance: 5` was too small and `colorDeep: '#04283f'` too
     close to the scene background after the diffuse term halved it, so deep
     water visually vanished. Fixed: `absorptionDistance` → 40, `colorDeep` →
     `'#146090'`, later nudged darker to `'#0e4a73'` per user feedback ("less
     black now, tune it back just a tiniest bit").
  3. **Far clip-plane float-precision collapse** ("water only visible through
     the terrain, invisible everywhere else"): `<orbitControls>` defaults
     `far` to `Number.MAX_SAFE_INTEGER`; the demo only set `[near]="0.1"`.
     Packing `near=0.1`/`far≈9e15` into the 32-bit float
     `waterPerspectiveDepthToViewZ` formula catastrophically cancelled,
     producing garbage `sceneViewZ` almost everywhere. Fixed with an explicit
     `[far]="5000"` on the template.
  4. **Logarithmic depth buffer incompatibility** ("i need it to work with
     this — the games im making all have this on"): user enabled
     `webGLRendererParameters: { logarithmicDepthBuffer: true }`. Confirmed by
     reading `WebGLProgram.js`/`WebGLCapabilities.js`/`WebGLPrograms.js` that
     three.js auto-injects `#define USE_LOGARITHMIC_DEPTH_BUFFER` into every
     compiled material — including a raw `ShaderMaterial` — whenever the
     renderer capability is on; it is not material-gated. Two sub-bugs
     followed from that: (a) the manual `uSceneDepthTexture` sample (captured
     via `MeshDepthMaterial`, which log-encodes automatically) needed a
     log-aware inverse, derived from three's own `logdepthbuf_fragment` chunk
     (`winZ = log2(1.0 - viewZ) * logDepthBufFC * 0.5` inverted); (b) the
     water material's own hardware depth write also needed log-encoding via
     three's `#include <logdepthbuf_*>` chunks, or its depth test against
     built-in (auto-log-encoded) materials like the shore mesh would be
     essentially arbitrary at real distances. Fixed in
     `core/water-shading-glsl.ts`: `WATER_DEPTH_UNPACK_GLSL` now branches on
     `USE_LOGARITHMIC_DEPTH_BUFFER`; four new exported passthrough constants
     (`WATER_LOGDEPTH_PARS_VERTEX_GLSL`, `WATER_LOGDEPTH_VERTEX_GLSL`,
     `WATER_LOGDEPTH_PARS_FRAGMENT_GLSL`, `WATER_LOGDEPTH_FRAGMENT_GLSL`)
     wrap three's own chunks and are spliced into any consumer's shader
     strings (done for the demo). No extra uniforms needed —
     `USE_LOGARITHMIC_DEPTH_BUFFER` and `logDepthBufFC` are both auto-injected
     by three.js, and the chunks no-op when log depth is off, so this is a
     library-level fix that benefits every `triangular-engine/water` consumer,
     not just this demo.
- Added a wireframe toggle (checkbox in the demo panel) mirroring the existing
  detail-chop/shore-fade toggles: sets `ShaderMaterial.wireframe` on all LOD
  level materials plus the shore mesh's `MeshStandardMaterial`, and is applied
  at construction time so it survives ring-count rebuilds.
- **User-verified in-browser 2026-07-22**: "ok it works" (far-plane fix), "log
  depth works" (log-depth fix) — both confirmed live, not just build-checked.
  This resolves both the "depth-texture without composer" and "logarithmic
  depth buffer" open questions above.

### 2026-07-23 — Phase 1c sphere domain built and verified

- Investigated reusing 004's `ITerrainSurfaceDomain<TAddress>` per Phase 1a's
  domain note as originally written; found it conflicts with Phase 1a's own
  no-skirts decision (terrain's contract is shaped around discrete
  quadtree+skirt patches) and can't carry Gerstner's horizontal displacement
  (only a scalar elevation). Recorded the revision in Phase 1a's domain note
  and built a lightweight water-only `WaterSurfaceDomain` instead — see
  Phase 1c above for the design (continuously-recentring local tangent frame;
  camera always projects to local `(0, 0)`, so the existing
  `computeWaterLodLevels` ring-placement math needed zero changes).
- Added `water/core/water-domain.ts` (`PlaneWaterDomain`, `SphereWaterDomain`)
  and `water/core/water-domain-glsl.ts` (`waterComposeWorldPosition`,
  `waterComposeWorldNormal`), both exported from `public-api.ts`.
- Caught one correctness bug during design, before it ever ran: the detail-
  normal chop (`WATER_DETAIL_NORMAL_GLSL`) assumes a near-vertical base
  normal, which only holds in world space for the plane domain. For the
  sphere it only holds in the *local* tangent frame away from the "north"
  point. Fixed by keeping the Gerstner normal in local space through the
  fragment shader (`vLocalNormal`/`vLocalXZ` varyings), perturbing it there,
  and composing to world space via `waterComposeWorldNormal` only as the
  final step.
- Built `/water-sphere-poc`: 500m demo sphere, 3-island bumpy ground feeding
  `WaterDepthPrepass`, ring-count capped at 4 (vs. the plane demo's 7) to
  keep the tangent-plane approximation's margin safe relative to the
  sphere's circumference.
- User caught a real UX bug in the first pass: initial camera
  position/target were hand-picked approximate tuples, and `<orbitControls>`
  had no `[upVector]` binding at all — meaningless on a sphere, where "up"
  varies by location and orbit controls default to world +Y. Fixed by
  deriving `initialCameraPosition`/`initialTarget`/`initialUpVector` from
  `SphereWaterDomain.getLocalFrame()` at the first island's surface point,
  and binding `upVector` on the template.
- **User-verified in-browser 2026-07-23**: "i tested it works ok" — confirmed
  live after the camera-framing/upVector fix.

### 2026-07-23 — Phase 1d cylinder domain built; navigation/rendering issues reported, not yet resolved

Built `CylinderWaterDomain` (`water/core/water-domain.ts`), the
`WATER_DOMAIN_CYLINDER` branch in `water-domain-glsl.ts`, unit tests, and the
`/water-cylinder-poc` demo, following the same pattern as Phase 1c (see the
Phase 1d checklist above). `npm run build:triangular-engine` and
`ng build demo-app` both succeeded cleanly after the initial build. Unit
tests were written but never executed in this session (see below) — a
standalone Node script (not karma) was used partway through to numerically
check the domain math instead.

User then tested `/water-cylinder-poc` live and reported a sequence of
distinct navigation/rendering problems. Trace of what was reported, what was
investigated, and what was actually changed, in order:

1. **"camera rotatiin is moving things around weirdly. potentially same
   issue we've had with the water material demo page with the ground and the
   water not aligned."** Investigated `EngineService.tick()`'s event order
   (`tick$` → `postTick$` → `render()`) against `OrbitControlsComponent`'s
   `orbit.update()` call (subscribed on `postTick$`, applied via a
   later-constructed child component). Concluded water's per-frame domain-
   frame/grid-instance update, subscribed on `tick$`, reads `camera.position`
   one frame stale relative to `orbit.update()`'s result for that frame, and
   that moving the subscription to `postTick$` would not reliably fix it
   (RxJS `Subject` calls subscribers in subscription order; the page
   component's own constructor — and its `postTick$` subscription — runs
   before Angular instantiates the `<orbitControls>` child). Identified that
   fixing this properly would need a new `EngineService` hook (e.g.
   `beforeRender$`, fired after `postTick$.next()` and before `render()`).
   **No code was changed for this.** Asked the user whether this matched
   what they meant via `AskUserQuestion`; they answered "Water slides
   relative to ground."
2. User clarified further: **"its like when i zoom out and rotate, the
   water goes all the way through the cilinder, instead fo being inside it
   fixed, it goes in and out of it as i rotate the camera, kinda in opposite
   direction. also the cilinder needs to be double sided the mesh."**
   Re-examined the ground mesh: the camera sits *inside* the concave tube,
   so for the default single-sided (`FrontSide`) `MeshStandardMaterial` on a
   standard-winding `CylinderGeometry`, every visible wall face is a
   backface (the camera is always on the axis-side of every wall point,
   universally, not just nearby — confirmed by a dot-product check by hand).
   **Fix applied**: added `side: DoubleSide` to the ground mesh's
   `MeshStandardMaterial` (the water `ShaderMaterial` already had
   `DoubleSide`, carried over correctly from the Phase 1c demo).
   `ng build demo-app` succeeded after this change. This fix is believed
   correct and necessary but has not been independently confirmed by the
   user as sufficient on its own, since further issues were reported before
   isolated confirmation.
3. User reported a third, distinct symptom: **"the water is always moving
   on the inner axis through the cylinder, like a nut and a bolt. but it
   moves fast as i rotate the camera, either going all the way out one end
   of the other."** Diagnosed as a consequence of `CYLINDER_AXIS` being
   vertical (`(0, 1, 0)`): for a vertical-axis cylinder, the local "up"
   (radially inward) has exactly zero world-Y component at *every* point on
   the wall, with no exceptions (a mathematical property of the
   configuration, not a location-dependent edge case). `AdvancedOrbitControls
   .setUpVector` (`third-person-controls.model.ts`) makes azimuthal drag
   rotate the camera around whatever `upVector` it is given, so a purely
   horizontal up vector makes ordinary horizontal dragging sweep the camera
   through the tube's full axial length. **Fix attempted**: reoriented
   `CYLINDER_AXIS` to horizontal (`(1, 0, 0)`), added a `GROUND_ROTATION_RAD
   = -Math.PI / 2` bake-in rotation (`geometry.rotateZ(...)`) so the ground
   `CylinderGeometry`'s native Y-axis orientation lands along world +X, a
   `nativeCylinderPointToWorld()` helper to keep the initial camera-framing
   reference point consistent with that same rotation, and moved the first
   bump to `angleRad: 0` (the tube's "bottom" after rotation, giving a
   near-`(0,1,0)` starting up vector). **This change was written to
   `water-cylinder-poc-page.component.ts` but the follow-up `ng build
   demo-app` to verify it compiles was interrupted/rejected by the user
   before running — this fix is UNVERIFIED, not confirmed to build or to
   resolve the reported symptom.**
4. User then reported a fourth symptom, explicitly from a different camera
   regime: **"if im looking at the cylinder from far away, and move from
   center to the left, the water moves to the left, and it moves quick. on
   the same inner axis aligned with the tube. coming out of the tube on the
   left. same story about turning the camera the other direction."**
   Re-derived the domain math by hand once more: `CylinderWaterDomain`'s
   frame origin has an axial coordinate equal to `dot(camera - center,
   axis)` — an exact, unamplified 1:1 linear function of the camera's own
   position, confirmed via the same reasoning used in the Phase 1d
   `composeWorldPosition` unit tests. Formed a hypothesis (not independently
   confirmed against the running demo) that the reported behavior is an
   inherent consequence of two things each individually working as designed:
   the water grid is a small local patch (≤ ~512m radius) that recenters
   exactly on the camera every frame — the same technique Phase 1a/1c use,
   neither of which render a full ocean/planet either — combined with
   `orbitControls`' pan speed scaling with distance from target, so far from
   the tube a small drag pans the camera (and therefore the patch) by very
   large world distances. **No code was changed in response to this report.**
   Proposed three options via `AskUserQuestion` (clamp max orbit distance;
   document as an out-of-scope limitation; treat far-away viewing as a real
   requirement needing a different approach). The user did not select an
   option and instead directed that this log entry be written and that no
   further solutions be proposed in this turn.

**Current state, factually, as of this entry**: `CylinderWaterDomain`'s core
math (frame + compose) has been verified by hand and via a standalone
numeric script, not via the karma unit tests (never executed this session).
The ground mesh's `DoubleSide` fix is applied and build-verified. The
horizontal-axis reorientation (`CYLINDER_AXIS`, `GROUND_ROTATION_RAD`,
`nativeCylinderPointToWorld`) is applied to the source file but **not
build-verified**. None of the four reported navigation/rendering symptoms
have been confirmed fixed by the user in-browser. The one-frame-lag
hypothesis from report 1 and the far-away-panning hypothesis from report 4
are both unconfirmed against the actual running demo — they are reasoned
explanations, not verified root causes. Phase 1d's exit gate (continuous,
seam/pop/swim-free coverage, user-verified) is **not met**.
