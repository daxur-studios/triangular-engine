---
type: Plan
title: Planet Water System
description: A measured, harness-first planet water system at 150-160 fps (ocean waves, beaches and shoreline, far-field detail, orbit-to-surface transitions, wakes, splashes and floating bodies, swappable styles, rivers, weather and ice hooks), chosen by a gated race between four surface contenders on the Plan 055 test track. Design only; nothing built.
timestamp: 2026-10-20T00:00:00Z
tags: [water, ocean, planet, waves, fft, gerstner, shoreline, beach, interaction, wake, buoyancy, styles, weather, ice, tsl, webgpu, performance, testing, floating-origin]
runbook: /docs/runbook/057_planet_water_system.md
performance: []
---

# Plan 057: Planet Water System

Status: **design only, nothing built, nothing measured.** Written 2026-10-20 from code reading and prior plans.

**Parked 2026-10-24 (owner, Plan 059 D10):** the contender race waits until Plan 059's M3 (water v0 on the new LOD
surface core). W1-W17 stay the long-term target list.
No decision below has been made by the owner except those inherited from Plans 055 and 056 (marked as such).
Phase 0 is **blocked on Plan 055 Phase 0** (§Dependencies on Plan 055).
Evidence: [Runbook 057](/docs/runbook/057_planet_water_system.md).

**Goal:** a spherical ocean on a planet that holds its share of 150-160 fps, looks right from orbit down to a
2 m eye height and below the surface, shares one definition of "where the sea is" with the terrain, and can be
trusted because every claim about speed or quality comes from a fixed test track. The architecture is **not
chosen yet**. Like terrain in Plan 055, it is decided by a measured race between contenders, with the gates
written before the race.

**Builds on:**
- [Plan 055](/docs/plans/055_planet_shape_system.md): the harness (the `/planet-shape-lab` pattern, the testing
  entry, per-pass GPU timers, ablation, machine context), the sea-level/terrain contract, the shared LOD and camera
  rig, and the fidelity classes. **This plan reuses that harness and does not build a second one.**
- [Plan 056](/docs/plans/056_webgpu_default_renderer.md): `WebGPURenderer` becomes the default; the existing
  GLSL `water/` module is on its port-or-retire list (Phase 4 there).
- [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md): the atmosphere, which supplies the sky that the sea
  reflects and the aerial perspective that fades distant water.
- [Plan 050](/docs/plans/050_tsl_planet_surface_material.md): the bent morph (`planetMorphGraph`) and
  `planetOceanMaterial`, today's constant-colour ocean shell, which is the baseline to beat.
- [Plan 051](/docs/plans/051_cloud_volumes.md): the lab/gate/timer process this plan copies, and cloud shadows
  that fall on water.
- [Plan 052](/docs/plans/052_page_test_sessions_and_performance_comparison.md): the runner and budget/baseline store.
- [Plan 054](/docs/plans/054_stylized_illustrative_rendering.md): the look. Its P3 (bathymetric colour ramp,
  shoreline foam band, stylized glint) is a **shading layer on top of whatever surface wins here**, not a
  separate renderer.

## What exists today (code reading, not run)

- `triangular-engine/water`: GLSL (`ShaderMaterial`) water for plane, sphere and cylinder domains: Gerstner
  waves, a camera-centred LOD grid, a far-field shader, a depth prepass, a Jolt buoyancy adapter and a
  pmndrs underwater effect. Per Plan 056 it cannot draw on `WebGPURenderer` and is on the port list.
  Contents were surveyed by file name only; reading it properly is a Phase 1 task.
- `planet-material/planet-ocean-material.ts`: a constant translucent colour on the cell-planet ocean shell, with
  the morph (stage 1). No waves, depth colour or foam.
- `FloatingOrigin` (`src/lib/engine/models/floating-origin.model.ts`) exists. The planet lab uses a split
  high/low float position for the camera instead.
- Demo pages `water/`, `water-lod-poc/`, `water-sphere-poc/`, `water-surface-spike/` and others are
  diagnostic fixtures for the GLSL module.

## Targets

| # | Target |
|---|---|
| W1 | **Frame rate:** water stays inside its share of the 160 fps frame (§Frame budget), still and moving, at 1440p on the Plan 055 reference machine |
| W2 | **Sphere:** a closed ocean around bodies from 2 km to 6,371 km radius, no seams at cube-face edges or poles, no jitter at the largest size |
| W3 | **Waves:** believable open-ocean motion at the eye (swell, chop, whitecaps), driven by one parameter set, with a calm-lake to storm range |
| W4 | **No tiling and no shimmer:** no visible repeat of the wave pattern from any altitude; no sparkling or crawling on the far water and the horizon |
| W5 | **Near detail:** shoreline contact, depth colour, refraction, foam where waves break and where water meets land. Fresnel and screen-space reflection are measured toggles, not assumed |
| W6 | **Far detail:** the horizon stays clean; normal and roughness detail fades with distance by filtering, not by popping; the sun glint stays stable |
| W7 | **Orbit to surface and below:** continuous descent from orbit to the waterline with no pop at any LOD or cascade switch, and a camera crossing the surface without a flash or a hole |
| W8 | **Precision:** waves stay phase-stable at 6,371 km radius with a moving camera and at time warp (§Precision) |
| W9 | **One truth:** the sea level the water draws, the terrain's land/water test (Plan 055 topology class), and the height a vessel floats at come from one definition, and a spec proves it |
| W10 | **Morph:** the ocean morphs from globe to map with the terrain. Visual only (Plan 055 T6) |
| W11 | **WebGPU first:** all features target `WebGPURenderer`; the fallback stance is below |
| W12 | **Interaction:** boat wakes, bodies falling in with splashes, and Jolt floating bodies, through one shared interaction layer; visible height matches what the physics floats on |
| W13 | **Beaches:** waves shoal, break into foam and run up a slope as a thin swash sheet that leaves wet sand. No tall "crescent" of water climbing the land, no hard intersection line, no flooding or dry gaps from a coarse terrain LOD |
| W14 | **Camera waterline:** the camera crossing the surface, half-submerged views and the underwater look are continuous; the CPU and the renderer agree which side the camera is on |
| W15 | **Styles:** the same surface can be drawn in different looks (realistic, bathymetric stylized, wavey Voronoi cells for a cell planet) by swapping a shading function, with a measured cost per style |
| W16 | **Water bodies:** rivers and lakes at their own levels and flow, meeting the sea without a step. Staged: not required for the first race (D13) |
| W17 | **Weather and ice hooks:** wind, storm and rain drive wave presets and surface detail; a freeze state (ice, shore ice) swaps the surface. Staged: the hooks are designed in the core, the full features come later (D17) |

## Ground rules

Inherited from Plan 055 without change:

- **Harness first.** No contender code before the water harness gate passes.
- **Timed with the GPU, not by frame rate**, per pass, p95, from `visible-browser` runs on the NVIDIA adapter.
- **Every addition is a toggle**, measured on and off in the same run (ABAB, `compareAblation`).
- **Quality is gated as hard as speed.** Speed bought by dropping detail fails the fidelity gates.
- **Timing is never a spec.** Specs run headless and check correctness; timings come only from the real-GPU profile.
- **Gates are fixed before the race.** Only the owner changes a gate, recorded in the runbook first.
- **A failed gate pauses a contender:** stop, push or harvest (Plan 055 D6).
- **One folder per contender in one checkout, timing runs one at a time** through a single queue.
- No commits by agents; the engine is public, so no consumer app names or paths anywhere.

Specific to water:

- **Water owns no terrain data.** It reads sea level and terrain depth through Plan 055's interfaces. If a
  contender needs terrain data that 055 does not offer, that is a request to 055, recorded in both runbooks.
- **New code is TSL.** The GLSL `water/` module is not extended. Reusable ideas (Gerstner presets, the domain
  interface, the sampling contract, buoyancy) are ported or reimplemented, not wrapped.
- **Fallback stance.** See §WebGPU-first and the WebGL stance.

## Frame budget

Plan 055 reserves "water, objects, vessels, post, UI" a combined **~1 ms** of the 6.25 ms frame (D8 there, a
working number). Water therefore cannot take that whole slice.

| Pass | Proposed budget (GPU) | Source |
|---|---|---|
| Water surface, all passes (wave compute, shell, foam, shading) | **working number: <= 0.5 ms p95** | open (D4) |
| Of which wave compute (if any) | <= 0.2 ms | open |
| Interaction layer (idle / 10 emitters / 100 splashes) | <= 0.05 / 0.1 / 0.2 ms, inside the water total | open (D4) |
| Shoreline + beach (wetness, swash, foam) | <= 0.1 ms where a shore is in view, inside the water total | open (D4) |
| Main thread for water | <= 0.2 ms p95, no per-frame allocation | open (D4) |

Both numbers are guesses to be replaced by Phase 0 measurements of the fixed costs and of 055's terrain. If the
race shows no contender fits, the owner decides whether to move the number or cut features (D4).

**Reference machine:** Plan 055 D1 (the owner's laptop, RTX 3080 Laptop GPU on AC, 2560 x 1440 drawing buffer,
NVIDIA adapter only, WebGPU developer features on for unquantized timestamps). Inherited, not re-decided.

## WebGPU-first and the WebGL stance

- **Proposed stance (D3):** the water system is built and gated on the WebGPU backend, as the shape system is
  (Plan 055 D4). Compute shaders and storage textures may be used freely by any contender.
- **No GLSL.** Classic `WebGLRenderer` cannot draw TSL node materials (Plan 056). The existing GLSL `water/`
  module stays on classic WebGL until Plan 056 retires or ports it; this plan does not touch it.
- **Open: a reduced fallback tier.** Plan 056 D2 decides whether the engine keeps `WebGPURenderer`'s WebGL2 backend
  as a fallback. If it does, a cheap tier is conceivable that needs no compute: contender A's vertex-stage
  Gerstner shell plus filtered normals. That tier would be gated separately and is **not a Phase 0-2 target**. If
  Plan 056 drops the fallback, there is none.
- Browsers without WebGPU: the water system reports itself unavailable with a clear message and draws nothing.
  It never silently draws a blank or wrong surface (Plan 056's rule).

## Architecture: the shared core

These layers are the same for every contender. Only the **wave and surface representation** differs.

```
sea level field ──┐                              interaction layer (wakes, splashes, bodies)
water bodies  ────┤                                          │ adds height / velocity / foam
terrain depth  ───┼─▶ surface representation (A / B / C / D) ┴─▶ style layer ─▶ composite
(Plan 055)        │        ▲                                      (realistic, bathymetric,
wave parameters ──┤        │                                       Voronoi cells, ...)
weather / freeze ─┘   wave sampler (CPU twin)                     over a shared shading stack
                           │                                      (foam, depth colour, wetness,
                  gameplay: buoyancy, queries, underwater test      refraction, Fresnel, sky reflection)
                                morph (visual only, vertex or ray stage)
```

The three new boxes (interaction layer, style layer, weather/freeze state) and the water-bodies input are shared
core, not part of any contender. Contenders differ only in how they draw the base wave surface.

### Sea level field

- Body-fixed. Default: a sphere at `radius + seaLevel` where `seaLevel` is a per-body constant, the same number
  Plan 055's topology class uses to decide land from water.
- One exported function answers "water surface radius at this direction and time" for the mean level (no waves);
  waves add to it. Tides, a per-body level that changes with time, and lakes at other heights are **not in v1**
  (D8, D13).
- A spec asserts that the sea level used by the renderer, the CPU sampler and Plan 055's topology test are the
  same number.

### Wave parameters and the CPU wave sampler

- One parameter set: wind speed and direction, fetch/swell, choppiness, a small number of named presets (calm
  lake, ocean swell, storm; the existing `wave-presets.ts` is the starting point).
- **The CPU sampler is the reference for gameplay** (buoyancy, vessel placement, "is the camera underwater").
  Only waves that the CPU can reproduce cheaply and exactly (a Gerstner set, or a Gerstner set plus a
  statistically matched visual-only layer) are allowed to move a vessel. See D7 for the alternative (GPU readback).
- A **parity spec** for every wave function in both languages: evaluate the TSL version headlessly, read it back
  and compare with the TypeScript version (the `evaluateOnGpu` helper pattern from Plan 055).

### Terrain depth and the shoreline contract

Water needs "how deep is the water here" for depth colour, refraction strength, foam and wave damping. Two sources:

1. **Screen-space:** the opaque depth buffer and a scene-colour copy. Works for any terrain contender and for
   objects (vessels, piers), but only for what is on screen and in front.
2. **Analytic:** a query of Plan 055's surface (a height-page atlas for contenders A/B there; the CPU evaluator
   for anything not in view; contender C there has no height texture and would need one baked for water).

Which one wins is a measured question (D10). Whatever the choice, the **topology contract** from Plan 055 holds:
the rendered coastline must keep the sign of (terrain height - sea level) at every LOD. Water must not flood
land that a coarse terrain LOD smoothed below sea level, and must not leave dry gaps where a coarse LOD lifted
terrain above it. A shoreline fidelity class (§Quality) makes this measurable.

### Shading stack

Shared by every contender so the race compares surfaces, not looks. Each layer is a registered toggle:

| Layer | Needs | Notes |
|---|---|---|
| Depth colour (shallows to deep) | water depth | Plan 054 P3 supplies the stylized ramp |
| Fresnel | normal, view | cheap; baseline for reflection mix |
| Sky reflection | atmosphere (Plan 049) | evaluate the reflected ray in the atmosphere tables; planar reflection is not possible on a sphere |
| Sun glint | filtered roughness | the main aliasing risk on the far water |
| Refraction | scene-colour copy | cost of the copy measured on its own (a Phase 0 microbenchmark) |
| Screen-space reflection (SSR) | depth + colour | optional; only for near objects and terrain; falls back to sky |
| Foam | wave Jacobian or crest test, plus shoreline contact | persistence over time is a separate toggle |
| Caustics on the seabed | depth, sun | optional, probably out of v1 |
| Terrain and cloud shadows on water | shadow maps (Plan 055/051) | the shadow pass must also morph (Plan 055 morph contract) |
| Wetness and swash on sand | wetness mask, depth | beach darkening with decay (§Shoreline and beach) |
| Wake / splash foam | interaction layer | foam value from emitters |
| Underwater | camera below surface | fog/attenuation, surface seen from below (D11) |

### Shoreline and beach (W13)

Heightfield water cannot make an overturning wave: it has one height per point. The plan accepts that and gets the
beach from the following, most of them shading or parameter work in the shared core.

The tall "crescent" or tongue of water climbing up a slope has separate causes, each with its own fix and check:

| Cause | Fix | Caught by |
|---|---|---|
| Waves keep full height while the depth goes to zero, so the surface slices the slope at a steep angle | **Shoaling and damping:** wave amplitude fades with depth, so displacement reaches zero at the waterline | water-edge band check |
| A coarse terrain LOD is smoother than the beach, so sea level cuts it in the wrong place | Clip or blend the water against the **precise terrain height** at the shoreline (analytic depth, D10), not the LOD mesh; the Plan 055 topology contract holds | shoreline gap, water-over-land px |
| A hard geometric intersection line | Fade alpha and add foam over the last centimetres of depth, so the edge is a gradient | edge continuity check |
| A real plunging or spilling breaker | **Not rendered as geometry.** Waves steepen with depth, then convert to foam and spray past a breaking criterion (slope or Jacobian). Authored 3D breaker meshes for hero spots are an optional later kit (D16) | foam onset check |

Beach features, as registered toggles:
- **Swash and backwash:** a thin sheet of water that runs up the slope and recedes. Two candidates, measured:
  a cheap per-pixel waterline offset that moves with the wave phase within a band, or a camera-local wet/dry
  shallow-water grid that lives in the interaction layer. The cheap one is the baseline (D16).
- **Wet sand:** a persistent wetness mask darkens and glosses sand behind the receding waterline and decays over
  time. It is a texture with a memory and update cost, so it is budgeted and ablated.
- **Foam persistence:** foam lines left on the water and sand that fade over time.
- **Slope-aware breaking:** gentle slopes give long spilling breaks, steep slopes and cliffs give reflected splash.
- **Object contact:** the same depth fade and contact foam around piers, rocks, hulls and landing legs.
- **Tide readiness:** the shoreline reads sea level from the one function in §Sea level field, so tides can be added
  later without touching the shoreline code.

### Interaction layer (W12)

Wakes, splashes, ripples and floating bodies all need a small dynamic field added to the base waves. The plan
makes it one shared module, not a per-contender feature:

- A **camera-local window** (proposed ~256-512 m, resolution to be measured) plus optional windows around active
  emitters, holding height offset, a velocity or slope term and a foam value. It advances by either a wave
  equation step or decaying stamps (Phase 0 microbenchmark picks one). It is body-fixed and survives floating-origin
  rebases.
- **Emitters:** boat hulls (a wake from speed, draft and heading), bodies hitting the surface (impact energy to a
  splash ring plus spray), rain, wading characters. Emitter count and per-emitter cost are scaling-curve axes.
- **Spray particles** are a separate budget (a capped pool, no allocation per splash). Whether spray is in the
  first version is D12.
- **Jolt floating bodies:** a buoyancy sampler returns surface height, normal and flow at body sample points from
  the CPU wave sampler plus the interaction layer. A CPU-side interaction field (a coarse mirror) or a GPU
  readback supplies the interaction height (D7). The `water/jolt` buoyancy adapter is the starting point.
- **One truth:** the height a vessel floats on and the height drawn agree within a tolerance, including the wake.
- **Eviction:** windows and stamps are evicted by distance and age, so a busy harbour does not grow memory
  without bound; a capacity guard errors before device limits (Plan 055's data-flow rules).

### Style layer (W15)

Surface and look are separate. The surface (any contender) supplies height, normal, slope variance, flow, depth,
foam, wetness and the cell id of the cell planet. A **style** is a swappable TSL function from those inputs to colour,
roughness and emission. Styles to specify:

| Style | Input it leans on | Notes |
|---|---|---|
| **Realistic** | depth, Fresnel, sky reflection, glint | the default and the quality reference |
| **Bathymetric stylized** | depth ramp, foam band | Plan 054 P3 |
| **Wavey Voronoi cells** | cell id and cell-edge distance of a cell planet | cell borders ripple with the waves, cell colour comes from depth or cell data, foam follows the cell edge. Costs a cell lookup per pixel, so the sampler and texture count are checked |
| **Toon / flat** | quantized depth and light | a cheap tier |

Each style has its own cost and ablation in the suite, so a look cannot silently eat the budget (cost matrix:
surface contender x style). The style API is public only after the race; during the race styles are internal.

### Water bodies (W16)

The sea is one body at one level. Rivers and lakes need their own level, flow and shoreline:

- A **water body** has a level (constant, or following a river spline), a flow field and an outline derived from
  terrain (Plan 055 D12: rivers carve a channel op, the water surface is Phase 4 there).
- Meeting rule: a river mouth meets sea level without a step; this is a test (R8), not a promise.
- Flow drives normal-map scrolling, foam streaks and buoyancy drift (a floating body is carried by the current).
- Not part of the first race (D13). The core only reserves the interface (level, flow, outline) so rivers do not
  force a rewrite.

### Camera waterline and underwater (W14)

- A CPU **side-of-surface** test (the camera and any sample point) from the same wave sampler, with the interaction
  layer's height. The renderer's choice of above or below must use the same answer, one frame consistent.
- Crossing: a wide-angle camera can sit half above and half below the surface at a crest or trough; the surface
  is drawn from both sides with a smooth fog and colour change, and a meniscus line at the camera plane.
- Underwater look: attenuation by depth, a bright surface seen from below, god-ray style sun shafts optional.
  Caustics stay out of v1 (D11).

### Weather and ice hooks (W17)

- **Weather:** wind speed and direction, a storm preset, rain intensity, and cloud shadow on water (Plan 051)
  enter as parameters of the wave presets and the interaction layer (rain adds ripples). Transitions between
  presets blend over time without a wave pop (a test).
- **Ice and freezing:** a per-region **freeze fraction** (0 = open water, 1 = solid ice) replaces open-water
  waves with ice shading and a damped, non-moving surface; shore ice and floes are later work. The surface switch
  must not change sea level or buoyancy answers without saying so (a sampler returns "frozen, walkable" distinctly).
  Only the hook (a parameter and a style) is specified in v1; behaviour and look are D17.
- **Other liquids:** lava or other liquids are a style plus level on a water body (Plan 055 D12 treats lava as a
  surface material); no separate renderer.

### Morph contract (W10)

- The sea is body-fixed and spherical; the morph is a visual transform only, applied by the same
  `planetMorphGraph` stage-1 `'bend'` the terrain uses (Plan 050), so water and terrain cannot drift apart.
- Raster contenders morph in the vertex stage. **Contender D must invert the morph per ray step** (Plan 055's
  contender C risk, inherited).
- Waves are defined in body space and morphed with the surface. LOD error is measured in morphed screen space.
- The shadow pass morphs or is off during the morph, and the contender says which.
- At morph 1 the sea shows its surface; whether the map tiles sideways is Plan 055 D7.

### Precision and floating origin (W8)

- A wave phase is `k . x - w t`. At 6,371 km radius, `k . x` in float32 loses whole radians at any
  reasonable `k`. So phases are computed **camera-relative**: the CPU computes, in double precision, each
  cascade's phase offset and wrapped origin for the current camera position and time, and uploads small values.
  The shader only ever sees positions within a few kilometres of the camera.
- Wave **time** must stay small and continuous. Uploading `t` as a double-split pair (high/low) or wrapping it
  per cascade period is the default; the contender must state which.
- Time warp up to 1,000,000x spins the body (Plan 055). Waves must **not** speed up with warp; wave time is
  decoupled from the spin time warp (D6). Wave patterns are body-fixed in direction (wind) but move in
  real time.
- Floating-origin rebases (`FloatingOrigin`) must not move or flash the waves: a spec rebases mid-fly-by and
  compares the surface height before and after at the same world point.
- The camera never sits in the same float frame as the 6,371 km body centre (Plan 055's split high/low position
  already does this; water reuses that frame).

## The contenders

Four contenders. B and C are expected to be strongest; A is the cheap baseline and a fallback tier; D mirrors
Plan 055's raymarched contender and doubles as the slow reference renderer. Cost figures are **estimates from
general knowledge, unmeasured**; Phase 0 replaces them.

| | A. Gerstner shell | B. FFT cascades + analytic far | C. Hybrid (swell + near FFT + filtered far) | D. Traced analytic surface |
|---|---|---|---|---|
| **What** | A sphere shell drawn as an LOD mesh (instanced grid patches or a clipmap). The vertex stage sums N Gerstner waves, tangent-plane per direction | Compute-generated FFT cascades (displacement, normal, foam), tiled by the tangent plane near the camera; analytic or normal-map-only beyond | A: a few long Gerstner swells at planet scale for the silhouette and gameplay parity. B's: 1-2 FFT cascades only inside a camera radius for chop and whitecaps. Far: no displacement, filtered normal/roughness | Bound the sea with a coarse shell, then sphere-trace an analytic wave height field per pixel from the shell's depth. No wave mesh |
| **Compute** | none | yes (FFT per cascade per frame) | yes, less than B | none (fragment cost) |
| **Gameplay parity** | exact (same Gerstner on CPU) | hard: needs readback or a visual-only rule (D7) | exact for the swell layer; FFT layer visual-only | exact if the traced field is Gerstner |
| **No tiling (W4)** | weak: few waves repeat or look regular | tile period visible without breaking it up | swell non-periodic; FFT hidden by distance blend and a rotated/offset second cascade | strongest: no tiles at all |
| **Far water** | vertex density runs out at the horizon; needs a filtered-normal fallback anyway | analytic or mip normal-maps | filtered normals, mips of the FFT slope variance | per-pixel, but aliasing at grazing angles |
| **Morph** | vertex stage | vertex stage | vertex stage | inverse morph per ray step (risk) |
| **Estimated cost** | low vertex-bound cost; scales with patch count and N | compute of a few hundred microseconds on high-end GPUs (guess) plus shell and shading | between A and B | high at 1440p; scales with trace steps and wave count |
| **Main risk** | looks synthetic; shimmer at horizon | tiling; compute cost; no CPU twin | complexity of two wave layers meeting without a visible seam | per-pixel cost; shadows; morph inversion; depth output for the shoreline |
| **Existing pieces** | GLSL Gerstner and LOD grid ideas (`water/core`) | none in the engine (no compute/storage buffers anywhere yet, per Runbook 055) | A's and B's | Plan 055 contender C's ray machinery |

**Is the traced contender (D) feasible at all?** Proposed answer: feasible as a **reference renderer and for the far
field**, uncertain as the shipped near-field surface. Ray-marched heightfield oceans are common in demos and
shader galleries (general knowledge, not checked here), and sphere tracing a bounded analytic field is cheap per step.
The problems are specific to this engine: per-pixel cost at 1440p with 160 fps and a ~0.5 ms budget; wave
detail that needs many wave terms per step; correct depth output so terrain, vessels and the shoreline sort and
intersect with the water; interaction-layer height inside the march; and inverting the morph per step. It is the
only contender that cannot tile and needs no mesh, so it stays in the race (it is also the quality reference).
The Phase 0 full-screen trace microbenchmark (8, 32, 128 steps) gives the first real number. If it
cannot fit even the far field, D is demoted to reference only, which the D-list allows (D2).

Notes:
- The shell mesh and LOD may reuse Plan 055's selection and camera. If the winning terrain is a raymarched hybrid,
  a shared ray setup (Plan 055 §Shared field core) is an option for D.
- Whitecap foam in A has no Jacobian; it uses a crest/steepness test and is judged on the same foam metric.
- Contender D at maximum steps is the water **reference renderer**: the "true" surface the others are compared with.
  Its analytic field is what A and C's swell layer must match.

## Dependencies on Plan 055

Plan 055's status at the time of writing (from Runbook 055): planned; Phase 0 partly built; Phase 1 and the
race not started.

### What water reuses unchanged

- The `/planet-shape-lab` pattern: a body-fixed planet at fixed seeds and three sizes (64 km, 600 km, 6,371 km),
  named camera poses (`orbit`, `low-flyover`, `ground`, `horizon-grazing`), the free camera, sun spin and time warp,
  the feature registry, and the "WebGPU required" overlay. Water is a **feature set and scenario set on that lab**
  (or a sibling route sharing its modules), not a second page with its own rig. Route and layout: D12.
- `triangular-engine/testing`: `TestSuite`/`TestScenario`/`TestRunAdapter`, `FrameSampler`, `nearestRankPercentile`,
  the receiver, `npm run test:summary`, `expectedGpuVendor: 'nvidia'`, machine context with preflight and noise
  floor.
- Per-pass GPU timers with the self-test (`gpuTiming`, `gpuPasses`): water needs its own pass labels.
- `compareAblation` for ABAB feature tests.
- The `visible-browser` real-GPU profile and the rule that timings come from it.

### Phase 0 pieces water needs before it can be measured

| Needed | 055 state (Runbook 055, 2026-10-19) | Water use |
|---|---|---|
| Lab skeleton, poses, spin, time warp, feature registry | **built** | scenarios and toggles |
| Per-pass GPU timers + self-test | **built**, passing on the reference GPU; compute passes **not split** | water pass labels; wave compute passes need splitting if any contender uses compute |
| Timestamps unquantized (developer flags) | **done** on the owner's machine | needed to read sub-0.1 ms water costs |
| Machine context, preflight, noise floor | built; thresholds partly tuned | all timing runs |
| Cheap result reading (`test:summary`) | **done** | all runs |
| `compareAblation` | built, specced, **not wired** into the lab/runner/receiver | every feature ablation |
| Morph slider on the lab | **TODO** | R4 morph round |
| Budgets and committed baselines (`performanceVerdict`) | **TODO** | water verdicts stay "unassessed" until done |
| Quality metrics (silhouette, flicker, popping, crack count) and the reference renderer | **TODO** | water adds its own metrics but reuses the still-pose flicker and slow-zoom popping machinery |
| Terrain beyond a plain sphere | **not built** (Phase 1-2) | shoreline scenarios cannot run on real terrain yet |
| Terrain sea-level / topology contract | defined in the plan (topology class, D13), no code | the shared sea-level number and the coastline gate |
| Surface query API (height, closest point) | Phase 3 | depth queries; buoyancy over terrain |

### Interim stand-ins

- Until 055 has terrain, shoreline scenarios use a **stand-in seabed** in the water lab: a small analytic height
  field (an island and a shelf at a known depth) with the same sea-level number. They are marked as stand-in in
  their result, are never used for a final race gate, and are replaced by the 055 winner's terrain as soon as it
  exists. A cheap harness can still rank contenders on open ocean, horizon and transitions meanwhile.
- Water races should **not start** until the 055 Phase 0 gate has passed (per-pass timers, ablation wiring and
  budgets), or water would measure on moving pieces.

## Phases

Each phase ends with a check in the water lab and recorded numbers.

### Phase 0. Water test track and platform ceiling (blocked on Plan 055 Phase 0)

- Water feature set and pass labels on the Plan 055 lab: a plain sphere + sea level, water on/off.
- **Platform microbenchmarks (no wave design yet):**
  - FFT of one 256 x 256 and one 512 x 512 cascade per frame, 1, 2 and 3 cascades, on `WebGPURenderer`;
  - N-term Gerstner vertex sum (N = 4, 8, 16, 32) at three patch densities;
  - a scene-colour and depth copy for refraction;
  - an SSR-style depth march at 8, 16 and 32 steps;
  - a full-screen analytic trace at 8, 32 and 128 steps (D's ceiling);
  - a texture read of a baked terrain depth at full screen;
  - the interaction layer: a 256 and 512 m window at 256^2 and 512^2, wave-equation step vs decaying stamps, with 0,
    10 and 100 emitters;
  - a wetness-mask update along a long beach;
  - a Voronoi cell lookup per pixel (sampler and bandwidth cost) for the cell style;
  - readback round trip for a small sampled-height buffer (for D7).
- Compute-pass timer split, if the engine does not yet provide it (a request to Plan 055 Phase 0).
- **Gate:** the owner sees per-pass GPU ms for these, the ablation report on a plain sphere with a flat
  constant-colour ocean (the `planetOceanMaterial` baseline), and the water budget table confirmed.

### Phase 0b. Measure the existing water

The GLSL `water/` demo and `planetOceanMaterial` on their pages, measured on the Phase 0 scenarios that apply.
No fixes. Classic WebGL has no GPU timer in the engine (Plan 056), so the old water may only get CPU and frame
interval numbers unless Plan 056 Phase 0 adds one. **Gate:** a table in the runbook of where the old water
spent its time, with "not measured" where it cannot be.

### Phase 1. Shared core

- Sea level field, wave parameters and presets, CPU wave sampler with its TSL twin and parity specs.
- Precision scheme: camera-relative phase, time splitting, rebase spec.
- Depth source interface (screen-space and analytic implementations behind one API).
- Shading stack as registered toggles on a placeholder surface.
- **Interaction layer** (window, emitters, eviction, capacity guards), with a Phase 0 microbenchmark choice between a
  wave-equation step and decaying stamps, and its CPU mirror or readback for buoyancy (D7).
- **Style layer** interface with three styles (realistic, bathymetric, Voronoi cell) on the placeholder surface.
- Wetness mask and shoreline damping on the stand-in seabed.
- Weather and freeze parameters as inputs (no behaviour yet beyond preset blending).
- Read the old `water/` code and record what is reusable (including the Jolt buoyancy adapter).
- **Gate:** parity specs pass; sea-level agreement spec passes; precision spec passes at 6,371 km; each shading
  layer, interaction path and style has a measured on/off.

### Phase 2. The race

Proposed rounds, to be confirmed by the owner after Phase 0 and before round 1 (budgets are placeholders, D4):

| Round | Scenarios | Gate (proposed) |
|---|---|---|
| R1 Budget | open ocean from orbit, mid altitude, low flyover, eye height, grazing horizon; three body sizes; wave presets calm/swell/storm; time warp 1,000,000x | water GPU <= budget p95 still and moving; main thread within budget; no frame > 16 ms after the first 2 s of a descent |
| R2 Fidelity | tiling probe, horizon aliasing, shimmer (frozen and moving), sun glint stability, far-normal energy, LOD/cascade pop during a slow zoom | quality metrics inside their thresholds (§Quality metrics) |
| R3 Shore and beach | gentle beach, steep beach, cliff coast, island, shelf, a pier or rock at the waterline; stand-in seabed until 055 terrain exists | zero dry gaps and zero water-over-land px; no water tongue beyond the swash band; edge alpha and foam continuous over the last cm of depth; foam begins at the breaking criterion; wetness rises and decays at the set rate; depth colour continuous across LOD |
| R4 Morph | morph 0 to 0.5 to 1 at orbit and low altitude, dusk sun | within R1 budget + 0.2 ms; water/terrain contact still correct; shadow correct or off |
| R5 Transitions and camera waterline | descent orbit to waterline; dive through the surface and back; surface crossing at wave crests and troughs; a half-submerged view; underwater look | no pop, flash, hole or one-frame flicker; CPU side-of-surface test agrees with the rendered side on every frame; smooth fog and colour change |
| R6 Interaction | idle; one boat at speed; 10 and 100 splashes; a body dropped from height; a Jolt floating box, hull and a stack; a character wading; heavy rain | wake and splash cost inside their budgets; floating-body height within a tolerance of the rendered surface including the wake; no jitter at 6,371 km; no allocation per splash; windows evicted at the cap |
| R7 Styles | each style on each surviving contender at orbit, eye height and a beach; a cell planet for the Voronoi style | cost matrix recorded; no style breaks the budget or the quality checks; style swap causes no pop |
| R8 Water bodies (optional, after 055 rivers) | river mouth into sea, a lake at another level, flow-carried floating body | no step at the mouth; flow direction matches the carved channel; drift matches the flow |

Every round also runs: cube-face seams and poles, the largest body at a moving camera, a floating-origin rebase
mid-run, and a low sun.

### Phase 3. Winner hardening

Buoyancy and Jolt adapter on the CPU sampler plus the interaction layer, a one-call water query API (depth, surface
height and normal, flow, side-of-surface, frozen state) shared by buoyancy, sound and AI, underwater rendering and
post-process, surface/terrain depth queries through 055's API, floating-origin rebase policy, readback paths (D7)
if chosen, the winner's shoreline and swash choice (D16).

### Phase 4. Look and optional features

Plan 054 P3 stylized bathymetric ramp and shoreline foam band as a style; the Voronoi cell style for cell planets; toon
tier; caustics; spray particles; rivers and lakes (needs Plan 055 Phase 4; R8); weather behaviour (storm, rain
ripples, preset blending, cloud shadows on water); ice and freeze behaviour (D17); optional hero breaker mesh kit (D16);
cloud and terrain shadows on water.

### Phase 5. Tiers, telemetry, docs

Quality tiers (including the optional reduced fallback tier of D3 and a no-compute calm-lake tier for games that do
not need an ocean), a water telemetry section (Plan 048), docs under `projects/triangular-engine/docs/`,
`CHANGELOG.md`, `entry-points.md`, token-map registration, and a migration note from the GLSL `water/` module.

## Proposed suite: `planet-water-baseline` v1

Runs on the Plan 055 lab (or its sibling route, D12), `purpose: 'performance'`, `expectedGpuVendor: 'nvidia'`.
Fixed seed, three body sizes (64, 600, 6,371 km). Nothing here exists yet; the scenarios below are a proposal.

**Scenarios** (each warm-up 1.5 s, then 5 s, as the 055 baseline):

| Scenario | Pose and state | Why |
|---|---|---|
| `empty-frame` / `empty-frame-after` | nothing drawn | noise floor, as 055 |
| `plain-sphere-*` | 055 plain sphere, no water | the floor to subtract |
| `ocean-flat-*` | water on, waves off, shading minimal | cost of the shell and depth path |
| `ocean-orbit-*` | orbit, waves on | far silhouette, glint |
| `ocean-mid-*` | ~10 km altitude | LOD and cascade transitions |
| `ocean-low-*` | ~200 m flyover | peak near detail |
| `ocean-eye-*` | 2 m above the surface | the longest view of waves |
| `ocean-horizon-*` | horizon-grazing | aliasing and shimmer worst case |
| `ocean-underwater-*` | below the surface | transition rendering and fog |
| `shore-standin-*` | island and shelf stand-in (marked stand-in) | shoreline cost until 055 terrain |
| `beach-gentle` / `beach-steep` / `beach-cliff` | stand-in slopes, eye height and 20 m | crescent/tongue check, swash, wetness, foam onset |
| `object-contact` | pier, rock and hull at the waterline | contact foam and depth fade |
| `camera-waterline` | scripted surface crossing at crest and trough, half-submerged view | side-of-surface parity, fog continuity |
| `wake-boat` | one boat at speed, 0 and 10 and 100 emitters | wake cost and decay |
| `splash-storm` | 100 bodies dropped in 1 s | splash cost, spray cap, no allocation |
| `floating-bodies` | Jolt box, hull, stack, wading character | buoyancy parity, jitter at 6,371 km |
| `rain-weather` | rain on, storm preset, preset blend | ripple cost, no wave pop |
| `style-matrix-*` | each style on each surface at orbit, eye height, beach; Voronoi on a cell planet | cost matrix |
| `descent-*` | scripted orbit-to-waterline path | popping and rebuild hitches |
| `warp-orbit-600km` | 1,000,000x spin | phase stability and cost under warp |
| `river-mouth-*` (later) | river into sea, lake at another level | no step at the mouth, flow parity |
| `ice-standin-*` (later, D17) | freeze fraction 0, 0.5, 1 | surface switch, walkable answer, no pop |

**Metrics (all per scenario, nearest-rank p50/p95, GPU from the machine's NVIDIA adapter):**
- GPU ms per pass: water surface, wave compute (if any), foam, refraction copy, and the rest of the frame; the
  scene pass split from 055 is reused.
- CPU main-thread ms for water, allocations per frame, pipeline compile hitches, long frames.
- Draw calls and triangles for the water shell, wave compute dispatches, resident cascade memory, texture
  sampler count per pass (the 16-per-stage limit applies, per Runbook 055).
- Quality checks (§Quality metrics).

**Ablations** (ABAB, `compareAblation`, the 15 % spread rule): waves on/off; swell layer only; FFT near layer on/off;
cascade count 1/2/3; far normals on/off; foam on/off; foam persistence on/off; refraction on/off; Fresnel on/off;
SSR on/off; sky reflection on/off; glint filtering on/off; shadows on water on/off; depth source screen-space vs
analytic; shoaling damping on/off; swash on/off and cheap vs simulated; wetness on/off; interaction layer on/off,
wave-equation vs stamps; spray on/off; rain ripples on/off; each style on/off. Each toggle also records compile time, since toggling can recompile shaders (Runbook 055's caveat).

**Budgets:** open questions (D4). The suite records numbers and reports `unassessed` until budgets and committed
baselines exist (the same state as the 055 baseline).

## Quality metrics

Computed in the lab, against the contender D reference at the same pose and time where a reference exists.

| Check | Method | Threshold |
|---|---|---|
| **Tiling** | at a nadir-like pose over open ocean, autocorrelate the rendered height or luminance field; a peak at a lag equal to a tile period, relative to the noise level, fails; a second probe flies a straight line and looks for repeated features | open (D5: set from a known-tiling control) |
| **Horizon aliasing** | still pose with waves frozen, two frames of the horizon rows: per-column luminance difference must be near zero; with waves moving, the horizon-row luminance variance must stay below a threshold | open |
| **Shimmer** | frame-to-frame difference of the far-water region during a slow camera hold and a slow dolly; compare with the reference's difference | open |
| **Sun glint stability** | glint area and peak luminance over time at a fixed low sun; no per-frame sparkle beyond the reference | open |
| **LOD/cascade pop** | frame-to-frame change over a slow zoom through every LOD and cascade boundary; any frame with a jump above the smooth trend is a pop | open |
| **Far-normal energy** | mean luminance and slope variance across a zoom sweep must stay continuous (no brightening or darkening at a LOD switch) | open |
| **Shoreline gap** | rendered water-covered px vs the CPU land/water test at the shoreline: dry gaps and water-over-land px | 0 px beyond a 1 px band (open) |
| **Contact foam** | foam present along the shoreline contact line and wave-damping with depth | present / absent per pose |
| **No crescent / tongue** | on a gentle and a steep beach, compare the rendered water edge with the CPU waterline; fail if water extends beyond the expected swash band | open |
| **Edge continuity** | alpha and foam must be monotonic over the last N cm of depth, with no hard intersection line | open |
| **Waterline LOD stability** | the waterline position over a slow zoom must not jump or crawl | open |
| **Foam onset** | foam begins at the breaking criterion and not before; wave energy across the break is smooth | open |
| **Swash timing** | the swash line stays inside its amplitude band, is periodic, and is the same at 600 and 6,371 km | open |
| **Wetness** | wetness rises at wave contact and decays at the set rate; memory and update cost against the beach length | open |
| **Object contact** | foam and depth fade at a pier, hull and rock; no gap at the object's footprint | 0 px gap (open) |
| **Wake and splash** | wake length and decay, splash timing against impact, spray count at the cap, no allocation per splash, cost spike at 100 simultaneous splashes | open |
| **Window stability** | the interaction window and wake stay attached across a floating-origin rebase; eviction at the cap | exact |
| **Camera waterline** | side-of-surface CPU flag vs rendered side; no flash or hole at a crest and trough; smooth fog | 0 mismatching frames |
| **Style swap** | swapping a style at runtime causes no pop and keeps the surface unchanged | exact surface, open look |
| **Weather blend** | a preset change blends without a wave pop | open |
| **Determinism** | the same seed and time give the same CPU surface height | exact |
| **Time robustness** | an hour of wave time, pause/resume and a background tab resumed give no phase jump | within a tolerance |
| **Surface parity** | rendered surface height vs the CPU sampler at a grid of points (including a vessel footprint) | within a tolerance, open |
| **Underwater crossing** | CPU "camera below surface" flag vs the rendered side over a scripted dive | zero mismatching frames |
| **Phase stability** | surface height at a fixed world point at 600 and 6,371 km, before and after a rebase and over 1 hour of wave time | within a tolerance, open |
| **Cracks and seams** | magenta clear inside the sea outline at cube-face edges and poles | 0 px |
| **Flicker** | two frames at a still pose with waves frozen must match | exact |

Correctness specs (headless, small, SwiftShader fine): wave parity, sea-level agreement, precision split,
rebase, topology-contract helper maths, texture-count check. Timing never runs there.

## Tests (headless specs)

- Wave functions: TSL vs TypeScript parity at random points, seams, poles.
- Sea-level agreement: renderer, CPU sampler and Plan 055's topology test use one number.
- Precision: phase offset maths keeps error under a bound at 6,371 km; rebase leaves the surface height unchanged.
- Time handling: wave time wrap / double-split is continuous and unaffected by spin warp.
- Morph: body-space positions survive the morph round trip; bent bounds contain the bent sea surface.
- Depth source: screen-space and analytic depth agree on a known seabed (stand-in).
- Sampler count per water pass stays under the device limit.
- Data flow: any readback carries the right frame tag and respects capacity guards (if D7 uses them).
- Timer self-test labels for water passes against a fake renderer.
- Interaction layer: window advance is deterministic; eviction at the cap; emitters add no allocation per frame;
  the window stays attached across a rebase; a stamp or wave step conserves the stated energy within a tolerance.
- Shoreline: depth damping reaches zero at zero depth; the waterline helper agrees with the topology test; the
  wetness mask decays at the configured rate.
- Style layer: every style compiles, samplers per pass stay under the limit, and swapping a style leaves the
  surface outputs unchanged.
- Water query API: side-of-surface, depth and flow answers agree with the rendered quantities on a known scene.
- Weather and freeze: preset blend is continuous; freeze fraction 0 matches open water exactly.

## Decisions

All open unless marked inherited. Inherited decisions are the owner's, from Plans 055 and 056, and are not
re-decided here.

| # | Decision | Status |
|---|---|---|
| D1 | Reference machine, adapter and resolution | **Inherited** from Plan 055 D1 |
| D2 | Race set: contenders A (Gerstner shell), B (FFT cascades), C (hybrid), D (traced analytic surface). D may be demoted to a reference renderer if the Phase 0 trace benchmark cannot fit even the far field | Open (proposal: all four, D last) |
| D3 | Fallback stance: WebGPU only (as Plan 055 D4), or also a no-compute reduced tier on the WebGL2 backend if Plan 056 D2 keeps it | Open (proposal: WebGPU only for the race; reduced tier decided after Plan 056 D2) |
| D4 | Water budget: working number <= 0.5 ms GPU p95 and <= 0.2 ms main thread, inside Plan 055's ~1 ms "everything else" | Open |
| D5 | Quality thresholds (tiling, horizon, shimmer, pop, shoreline, parity) set after Phase 0 from a known-bad control | Open |
| D6 | Wave time is decoupled from spin time warp (waves run in real time even at 1,000,000x) | Open (proposal: decoupled) |
| D7 | Gameplay-visible waves: analytic Gerstner on both CPU and GPU (exact), FFT visual-only; or GPU readback of the real surface via the data-flow core | Open (proposal: analytic gameplay waves, FFT visual-only) |
| D8 | Sea level model for v1: one constant per body. Tides and per-region levels later | Open (proposal: constant) |
| D9 | Styles for v1: realistic, Plan 054 bathymetric stylized, wavey Voronoi cells for cell planets, toon tier. Style API public only after the race | Open (proposal: all four as internal styles during the race) |
| D10 | Depth source for shoreline and refraction: screen-space, analytic from Plan 055's surface, or both | Open (decided by a measured microbenchmark) |
| D11 | Underwater camera in v1: fog/attenuation and a surface seen from below | Open (proposal: in scope at a basic level; caustics out) |
| D12 | Lab layout: water scenarios live on `/planet-shape-lab`, or a sibling route sharing its modules. Is the interaction layer (wakes, splashes, floating bodies) a **race criterion** (R6) or a post-race feature? Is spray in v1? | Open (proposal: interaction layer is core and in R6; spray after the race) |
| D13 | Rivers, lakes and other water bodies at non-sea-level heights: in the first race, or staged (the core only reserves the level/flow/outline interface; R8 after Plan 055 rivers) | Open (proposal: staged) |
| D14 | Entry point: a new `triangular-engine/planet-water` replacing the planet use of the GLSL `water/`, or a TSL rewrite inside `water/`. Migration path for the existing public `<waterSurface>` | Open |
| D15 | Floating bodies: Jolt buoyancy reads the CPU wave sampler plus a CPU mirror of the interaction layer, or a tagged GPU readback; tolerance between rendered and physical height | Open (decided with D7) |
| D16 | Breaking waves and swash: heightfield water only (steepen, then foam and spray), cheap per-pixel swash as baseline vs a camera-local wet/dry simulation, authored 3D breaker meshes as an optional later hero kit | Open (proposal: heightfield + cheap swash; 3D breakers out of the race) |
| D17 | Weather and ice: hooks only in v1 (parameters, freeze fraction, style switch), behaviour in Phase 4; what "walkable ice" means for the query API | Open (proposal: hooks in the core, behaviour later) |

## Out of scope for now

Full fluid simulation (2D/3D Navier-Stokes), true 3D overturning breaking waves as geometry (D16: an optional
authored kit later), caustics in v1, tides and variable sea level (the shoreline reads sea level from one function so
they can be added), underwater terrain rendering beyond what Plan 055 already draws, ocean life, weather
simulation that moves storms with cloud systems (only wind, rain and preset hooks are in), full ice-sheet and floe
simulation (only the freeze hook, D17), planar and cylinder domains of the current `water/` module (they keep their
own path under Plan 056), multiplayer sync of the wave and interaction state. Spray, rivers and lakes are staged,
not excluded (D12, D13).

## Open questions

- All of D2-D17.
- Whether the water pass sorts before or after the cloud and atmosphere composites, and how aerial perspective
  fades distant water without double-darkening it (Plans 049 and 051 own those passes).
- Whether three.js 0.186 exposes a scene-colour and depth copy for refraction in a form that does not add a full
  extra pass (the copy's cost is a Phase 0 microbenchmark; the API is unverified).
- Whether Plan 055's winning terrain exposes a depth texture that water can read, or must provide one.
