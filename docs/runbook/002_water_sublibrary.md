# 002 — Water sub-library

## Status

- State: Planning
- Target entry points: `triangular-engine/water` (core), `triangular-engine/water/jolt` (physics)
- Initial renderer: WebGL
- Last updated: 2026-07-22

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

### Phase 1 — Ocean and lake, low + medium tiers

- [ ] Water material: scrolling detail normals, fresnel, absorption colour,
      depth-texture shoreline fade and depth tint.
- [ ] Shore foam band (medium tier) from depth delta.
- [ ] Camera-following clipmap grid for `water-ocean` (grid-snapped, ring LODs,
      horizon skirt); bounded mesh for `water-lake`.
- [ ] `water-ocean` / `water-lake` components + `WaterService` registry with
      `sample()`.
- [ ] Quality presets (`low`/`medium`) switchable at runtime; wave presets as
      data.
- [ ] Demo: ocean + separate lake against sloped opaque "terrain" geometry;
      verify the beach transition.

Exit gate: a good-looking medium-tier ocean and lake against a beach slope,
no visible grid seams or swimming vertices while the camera moves, runtime
quality switch works.

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
| Renderer            | WebGL success; WebGPU explicit rejection; logarithmic depth buffer on     |
| Packaging           | core-only install; water-only; water+jolt; clean consumer build           |

## Open questions

- Does the depth-texture requirement (shoreline fade) work in the plain
  forward path without the postprocessing composer, or does `low`/`medium`
  water already require a depth prepass helper in core? Resolve in Phase 1.
- Planar reflection with the `postprocessing` composer active: render-order and
  RT interaction need a spike before committing Phase 4's design.
- Logarithmic depth buffer: runbook 001 showed effect materials silently
  mis-reconstructing log depth. Water's depth-based shading must be tested with
  `logarithmicDepthBuffer: true` early (Phase 1), since BSP planet scenes use it.
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
| Infinite water + LOD clipmap | Covered — Phase 1 |
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
