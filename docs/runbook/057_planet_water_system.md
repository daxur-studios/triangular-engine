---
type: Runbook
title: Planet Water System
description: Findings, decisions, race results and timings for the planet-scale ocean. Currently design notes only.
timestamp: 2026-10-20T00:00:00Z
tags: [water, ocean, planet, waves, fft, gerstner, shoreline, tsl, webgpu, performance, testing, floating-origin]
plans: [/docs/plans/057_planet_water_system.md]
performance: []
---

# Runbook 057: Planet Water System

Plan: [Plan 057](/docs/plans/057_planet_water_system.md). Terrain counterpart:
[Plan 055](/docs/plans/055_planet_shape_system.md) and [Runbook 055](/docs/runbook/055_planet_shape_system.md),
whose harness water reuses. Renderer switch: [Plan 056](/docs/plans/056_webgpu_default_renderer.md).

## 2026-10-20 — Plan written (design only)

Nothing was built, run or measured. The only files written are Plan 057 and this runbook. Written while Plan 055
Phase 0 was still changing (budgets, quality metrics, verdict, ablation suite), so the water work deliberately
stays on paper until that harness settles. No web research was done for this entry; wave-model and cost remarks
below are general knowledge and are marked as such.

### Ask

A design-only plan and runbook for a planet-scale 3D water system, mirroring Plan 055's harness-first
contender-race structure. Scope as requested: a spherical ocean; waves (FFT, Gerstner, hybrid cascades); near
detail (foam, shoreline, refraction, depth colour, possibly Fresnel and screen-space reflection) and far detail
(horizon, normal and roughness LOD, no tiling); transitions from orbit to the surface; floating-origin
precision; WebGPU first with a stated WebGL fallback stance; candidate contenders with expected cost and risk;
dependencies on Plan 055; a proposed suite; owner decisions as a D-list.

### Findings: what exists in the engine (code reading, file names and the two files below only)

- **`triangular-engine/water`** is GLSL. Surveyed by file name, not read in full: `water/core` has Gerstner,
  domain, LOD grid and patch geometry, far-field, surface-depth, shading and stylize GLSL files, `water-sampling.ts`
  and `wave-presets.ts`; `water/rendering` has a depth prepass, quality presets and the surface renderer;
  `water/jolt` has a buoyancy component; `water/postprocessing` has the underwater effect. Plan 056's inventory
  marks the surface renderer and depth prepass as **port** (its Phase 4) and the underwater effect as **port**
  (its Phase 3). So water on `WebGPURenderer` does not exist today.
- **`planet-material/planet-ocean-material.ts`** (46 lines, read): a `PlanetSurfaceMaterial` with a solid translucent
  colour (default `#146299`, opacity 0.68, roughness 0.18) on the morph's stage 1. It reads `aSpherePos` and
  `aSphereNorm` rather than the geometry `position`. No waves, depth, foam or reflection. This is the baseline
  the water race must beat, and the morph hook water should share.
- **`FloatingOrigin`** (`src/lib/engine/models/floating-origin.model.ts`) has a threshold-based
  `rebaseIfNeeded` and a listener set. Plan 055's lab uses its own split high/low camera position instead (Runbook
  055, 2026-10-19). Which one water uses is a Phase 1 task.
- **Demo pages** `water`, `water-lod-poc`, `water-sphere-poc`, `water-surface-spike` and others exist for the
  GLSL module (listing only).
- No compute shaders, storage buffers or indirect draws are anywhere in the engine (Runbook 055, findings). The
  FFT contenders would be the first compute users; the timer split for compute passes is not built (Runbook 055,
  2026-10-19 timer entry).

### Findings: state of the Plan 055 harness that water would reuse (from Runbook 055, not re-checked)

As of the last Runbook 055 entry (2026-10-19, ninth run):

- **Built and run:** `/planet-shape-lab` skeleton (plain sphere at 64/600/6,371 km, named poses, free camera,
  spin and warp to 1,000,000x, feature registry with only `shadows`); `planet-shape-baseline` v1; per-pass GPU
  timers and their self-test (scene pass, shadow passes, output pass); unquantized timestamps with the Chrome
  WebGPU developer flag; machine context, preflight and noise floor; cheap result reading; the NVIDIA adapter on
  the owner's laptop via the Windows Graphics setting for `chrome.exe`.
- **Built, not wired:** `compareAblation`.
- **Not built:** the morph slider, budgets and baselines (`performanceVerdict` is `unassessed`), quality metrics
  (silhouette, flicker, popping, crack count), the reference renderer, compute-pass timers, any terrain beyond a
  plain sphere, the sea-level/topology contract in code.
- Reference numbers on the target GPU: empty frame about 0.046 ms; plain sphere scene pass 0.04-0.05 ms from orbit and
  0.09 ms from the ground; output pass a constant 0.04-0.05 ms. Any water cost must be read against those.

### Design: key points taken into the plan

1. **Reuse, do not rebuild, the harness.** Water is a feature set and scenario set on the 055 lab and runner. A
   second rig would give water and terrain numbers that cannot be compared.
2. **One definition of the sea.** Water, the terrain's land/water test (055 topology fidelity class) and the
   buoyancy sampler must share one sea-level number; otherwise coastlines flood or crack at coarse LODs. A spec
   enforces it.
3. **Gameplay waves stay analytic (proposal D7).** FFT output is a texture on the GPU. A vessel needs the same height
   on the CPU. The cheap way to get one truth is a Gerstner layer that exists on both sides and an FFT layer that
   is visual-only. The alternative (readback through the data-flow core) is allowed to compete, with its measured
   latency.
4. **Precision by construction (W8).** At 6,371 km a float32 position cannot hold sub-metre phase, so cascade phases
   are computed on the CPU in double precision, relative to the camera, and uploaded small. Wave time is wrapped or
   split. Wave time is decoupled from spin time warp (D6), otherwise a 1,000,000x warp makes the sea a blur.
5. **Sphere waves need a tiling story.** FFT cascades are periodic in a flat tile. On a sphere the plan assumes a
   camera-local tangent-plane mapping with a non-periodic long-wave layer; the alternatives (cube-face UVs, triplanar
   blends) are Phase 1 comparisons, not decisions. This is the single biggest risk for contenders B and C.
6. **Far detail is filtering, not geometry.** Beyond the vertex density, normal and roughness come from slope
   variance filtering (mips or an analytic variance), which is also what keeps the horizon and sun glint stable.
   Every contender needs it; contender D gets it per pixel and still aliases at grazing angles.
7. **Sky reflection from the atmosphere, not a planar mirror.** A curved ocean cannot use planar reflection.
   Plan 049's atmosphere supplies the sky along the reflected ray; SSR is an optional near-field add-on.
8. **Look is separate from surface.** Plan 054 P3 (bathymetric colour ramp, shoreline foam band, stylized glint) is
   the shading layer for any surface that wins; contenders are compared with the same shading stack.
9. **Morph.** Water uses the same stage-1 `'bend'` as terrain. The ray contender must invert it per step (the same
   risk Plan 055 records for its contender C).

### Background (general knowledge, unverified here)

- Ocean FFT displacement (Tessendorf-style) is typically run as a few spectral cascades at different tile
  sizes so that long and short wavelengths do not repeat together; foam is derived from the displacement field's
  Jacobian. These are well-known techniques, but cost on this engine's WebGPU path is unmeasured and the numbers in
  Plan 057's contender table are estimates to be replaced by Phase 0.
- Gerstner (trochoidal) waves are cheap and have a closed form on both CPU and GPU, which is what makes them
  attractive for gameplay parity; their weakness is regularity and horizon aliasing.
- Shoreline wave damping with depth and foam at contact are common techniques; none is claimed to be a fit here
  until Phase 2 measures them.

### Dependencies list (what must exist in Plan 055 before water can be measured)

Tracked in Plan 057 §Dependencies. In short: ablation wired into the lab and receiver; budgets and baselines; the
morph slider; a compute-pass timer split (if any contender uses compute); stable quality-metric machinery (flicker,
popping) that water can extend; and, for real shorelines, a terrain with the sea-level contract. Until terrain
exists, shoreline scenarios use a labelled stand-in seabed and are never used as a final gate.

### Decisions

None taken by the owner in this entry. Plan 057's D-list (D2-D14) is all open; D1 is inherited from Plan 055.
Inherited background decisions: Plan 055 D1 (reference machine), D3/Plan 056 (WebGPURenderer default), Plan 055
D4 (WebGPU-only for the shape system), D6 (stop / push / harvest on a failed gate).

### Not done

- No code read in depth (the old water module was only listed), no code written, no run, no measurement.
- No web research; wave-model remarks above are from general knowledge.
- Plan and runbook indexes (`docs/plans/index.md`, `docs/runbook/index.md`) were **not** updated: this task was limited
  to the two new files. The convention says both indexes include new pairs, so they need one row each.
- Plan 055 and Plan 056 were read, not edited. Plan 055 mentions water only in its frame budget, D12/D13 and Phase 4
  (shoreline coupling); it does not yet name Plan 057 as a consumer of its harness and sea-level contract. A
  one-line cross-reference there would help.

### Next

1. Add the two index rows (below), when file edits outside the two docs are allowed.
2. Owner review of Plan 057's D-list, in particular D2 (race set), D3 (fallback stance), D4 (budget), D7
   (gameplay waves) and D14 (entry point).
3. Wait for Plan 055's Phase 0 gate (ablation wiring, budgets, morph slider, compute timers) before starting
   Plan 057 Phase 0; read the old `water/` code during Phase 1.

Index rows to add:

- Plans: `| [Planet Water System](/docs/plans/057_planet_water_system.md) | design only (blocked on Plan 055 Phase 0) | [Evidence](/docs/runbook/057_planet_water_system.md) |`
- Runbooks: `| [Planet Water System](/docs/runbook/057_planet_water_system.md) | [Implementation plan](/docs/plans/057_planet_water_system.md) |`

## 2026-10-20 — Scope widened after owner discussion (design only)

Documentation only; nothing built, run or measured. Plan 057 was revised in place; this entry records why.

### Owner's additions (from discussion, in the owner's words, condensed)

- Interaction: a boat producing waves, Jolt floating bodies, bodies falling in with splashes.
- Rivers; the waterline for the camera.
- Stylized looks for different games, e.g. a cell planet where the water is "wavey Voronoi cells".
- Beaches, water at shorelines and near objects, and the unwanted case where a 3D wave intersects the shoreline and
  leaves a "crescent" of water climbing the land.
- Weather, ice and other states.
- A question: is a ray-marched approach feasible at all, or never done?

### What changed in the plan

- Targets W12-W17 added: interaction, beaches, camera waterline, styles, water bodies, weather and ice hooks.
- Shared core grew by four layers, none of them part of a contender: an **interaction layer** (camera-local window plus
  emitter windows, wake/splash/wading/rain emitters, eviction, capacity guards), a **style layer** (a swappable shading
  function from surface outputs; realistic, bathymetric, wavey Voronoi, toon), a **shoreline and beach** section
  (shoaling damping, precise-terrain clipping, depth-faded alpha and foam, wetness mask, swash) and **water bodies**
  (level, flow, outline interface reserved; rivers staged).
- The "crescent" is split into four causes with a fix and a check each: full-height waves at zero depth (shoaling),
  coarse terrain LOD (clip against precise height, Plan 055 topology contract), a hard intersection line (alpha and foam
  gradient), and true plunging breakers (not renderable by a heightfield; steepen then foam and spray).
- Rounds R3 (shore and beach), R5 (transitions and camera waterline) and R6 (interaction) were widened; R7 (styles) and
  R8 (water bodies, staged) added. Suite gained beach, object-contact, camera-waterline, wake, splash-storm,
  floating-bodies, rain-weather, style-matrix, river and ice scenarios; ablations and quality checks were extended
  (no-crescent, edge continuity, waterline LOD stability, foam onset, swash timing, wetness, wake and splash, window
  stability, camera waterline, style swap, weather blend, determinism, time robustness).
- Phase 0 microbenchmarks gained the interaction window (wave equation vs stamps, 0/10/100 emitters), a wetness-mask
  update and a Voronoi cell lookup per pixel. Frame budget gained provisional sub-budgets for the interaction layer
  and the shoreline, inside the same 0.5 ms water number.
- D-list: D9, D12 and D13 reworded; D15 (floating-body source), D16 (breaking waves and swash) and D17 (weather and ice)
  added. All still open.

### The ray-marched question

Recorded answer, from general knowledge and not verified with sources in this entry: ray-marched heightfield oceans
are common in demos and shader galleries, and sphere tracing a bounded analytic field is cheap per step, so it is
not exotic. The engine-specific problems are cost at 1440p within a ~0.5 ms budget, wave terms per step, correct depth
output for shoreline and objects, interaction-layer height inside the march, and morph inversion per step. Plan 057
keeps it in the race as contender D for two reasons: it is the quality reference, and it is the only candidate with no
tiling. The Phase 0 full-screen trace benchmark gives the first number; if even the far field does not fit, D is
demoted to a reference renderer only (D2).

### Not done

- No code, no measurement, no web research. The index rows noted in the previous entry are still not added.
- The old `water/` and Jolt buoyancy code have not been read beyond file names.
- Thresholds for all new quality checks are open; they are to be set from known-bad controls once the harness exists.

### Next

Owner review of D2-D17, especially D12 (is the interaction layer a race criterion), D13 (rivers staged), D16 (3D
breakers out of the race) and D17 (ice and weather as hooks first).
