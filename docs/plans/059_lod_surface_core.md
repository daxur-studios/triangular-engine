---
type: Plan
title: LOD Surface Core for Water and Terrain
description: A fresh, WebGPU-only, performance-tested level-of-detail surface (a height over a plane or a sphere, drawn as one instanced grid whose density follows pluggable criteria), shown first on a flat and a sphere lab page, then used by a new water surface and later by low-detail terrain. Review and owner decisions done. M1 lab built (demo-app `/lod-surface-lab`, suite `lod-surface-baseline` v1, 26 headless specs green) with a persistent selector at about 0.2 ms in Node; its gates are not yet measured in the browser. Spike S1 not started.
timestamp: 2026-10-24T00:00:00Z
tags: [lod, mesh, quadtree, sphere, plane, water, terrain, webgpu, tsl, performance, testing]
runbook: /docs/runbook/059_lod_surface_core.md
performance:
  - id: lod-surface-baseline-v1
    url: http://triangular-demo.localhost:4200/lod-surface-lab?testSuite=lod-surface-baseline&testVersion=1&testProfile=visible-browser&testRepetitions=1&testAutoStart=1
    status: runnable-hardware-unmeasured
---

# Plan 059: LOD Surface Core for Water and Terrain

Status: **M1 in progress (2026-10-25), seams reworked:** shared seam vertices are now bit-identical by construction (one integer lattice per face, folding by snapping, a camera anchor; see the "Bit-identical seams" runbook section); 38 headless specs pass; not yet checked on a GPU. Before that: **M1 in progress:** lab page, selector, renderer, crack probe and suite built and spec-tested; selector made persistent, about 0.2 ms per select in Node; first RTX 3080 run (suite v1): selection p95 0.4–0.5 ms in the browser; an NVIDIA `sin` precision hole fixed; 1–5 px seam sparkles left open; suite v2 waits on a rerun (see [Runbook 059](/docs/runbook/059_lod_surface_core.md)). Earlier status: **draft, nothing built.** Written 2026-10-24 after an owner discussion. Before anything is built, the
direction is reviewed by three agents: [LOD surface review](/docs/plans/059_lod_surface_review.md). The
architecture below is Claude's proposal and may change with the review.
Evidence: [Runbook 059](/docs/runbook/059_lod_surface_core.md).

**Why this plan.** The terrain work in [Plan 055](/docs/plans/055_planet_shape_system.md) aims at a very large
planet engine (caves, Earth-sized bodies, 1,000,000x warp, 100 ms collidable edits, the globe-to-map morph) and is
slow to land. None of the demos shows the basic thing: a grid that gets denser near the camera and coarser as you
zoom out, on a flat plane and on a sphere, with its cost measured. The owner wants that foundation first, built
cleanly and fast, good enough for low and lower-detail games.

**The idea behind it.** For drawing, terrain is "frozen water": both are a height over a plane or a sphere, drawn on
a grid whose density follows the camera. Water changes every frame, so a surface that draws water well already
shows height changes (such as terrain edits) on the next frame without re-meshing. So the order is: **the LOD
surface first, then water as its first user, then low-detail terrain as its second.**

**Goal.** One small core that draws a height surface over a plane or a sphere, crack-free, with its level of detail
chosen by pluggable criteria (camera nearness, feature importance, horizon nearness, a budget), measured on the
reference GPU from the first milestone.

**Owner decisions behind this plan (2026-10-24):**
- **Fresh code.** Nothing is ported, wrapped or imported from the GLSL `water/` module (`water-lod-grid.ts`,
  `water-domain.ts` and the rest) or from the earlier terrain attempts. They are "not good enough". Their runbooks
  may be read for lessons.
- **WebGPU only.** three.js `WebGPURenderer` (0.186), TSL, compute allowed. No WebGL or GLSL path.
- **Several agents review the direction first** (Claude, Argon, Astra), then the owner settles the D-list.

**Owner direction, to confirm (D3):** Plan 055's lab and contenders are left untouched. This is a separate,
lower-detail track that neither blocks nor depends on Plan 055.

**Related plans:**
- [Plan 055](/docs/plans/055_planet_shape_system.md): separate track. Shared only through the test runner
  (`triangular-engine/testing`), which is not terrain code. If this core proves out, adopting it in 055 is a later
  owner call.
- [Plan 057](/docs/plans/057_planet_water_system.md): the planet ocean race. Design only, blocked on Plan 055, and it
  assumes an LOD shell exists (its contenders A and C are "a sphere shell drawn as an LOD mesh"). This plan builds
  that shell first. 057's targets (W1-W17: waves, beaches, wakes, buoyancy, styles, rivers, weather, ice) stay a
  useful long-term list; whether its race is parked is D10.
- [Plan 056](/docs/plans/056_webgpu_default_renderer.md): `WebGPURenderer` as the default. The old `water/` module is
  on its port-or-retire list; this plan does not port it.
- [Runbook 028](/docs/runbook/028_planet_terrain_attempt_history.md): terrain attempt history. Lessons taken: keep
  near and far LOD as separate problems, and get far detail from normals, not triangles. The camera-centred
  clipmap spike it proposed was never run.

## Scope

**In:**
- **Heightfield surfaces:** one height per point of a base surface, displaced along its normal. Water may also move
  points sideways (Gerstner-style).
- **Base domains:** a bounded flat square, a camera-following unbounded plane, and a sphere (cube-sphere).
- **LOD selection with pluggable criteria** (§Targets L4).
- **Height sources:** flat, analytic (a function of position and time, evaluated live), and a writable height
  texture (terrain bakes and edits, water ripples and wakes).
- **Instruments from day one:** LOD-level colours, wireframe, patch bounds, counters, GPU pass timers, a crack probe.

**Out for now:** caves, arches and overhangs (Plan 055 owns them); the globe-to-map morph (D11); FFT and ray-marched
water; beaches, swash, rivers, weather and ice (Plan 057's list); materials beyond a debug look and a basic lit look;
paging for large terrain textures; Earth-scale precision of height sources (the mesh itself must be precise at
any radius, §L7).

## Targets

| # | Target |
|---|---|
| L1 | **Visible LOD.** A debug view colours each patch by level, with wireframe and bounds. Zooming in and out shows the grid refine and coarsen, on the plane and on the sphere, from 2 m eye height to orbit |
| L2 | **No cracks.** No hole pixels at any level boundary, cube-face edge or cube corner, counted by a crack probe in every suite case |
| L3 | **Bounded popping.** Level changes are blended or bounded; a popping score during a scripted zoom stays under a threshold set from a known-bad control (blending off) |
| L4 | **Custom criteria.** Camera distance (screen-space error), feature importance (regions with a target detail), horizon nearness (silhouette) and a global budget. They combine by one stated rule, and each is a toggle measured on and off |
| L5 | **Cost on the reference machine** (RTX 3080 Laptop, 2560 x 1440, Plan 055 D1), working numbers: surface <= 0.5 ms GPU p95 with flat or analytic-wave heights; selection <= 0.2 ms main thread p95 with no per-frame allocation; one draw per pass per surface |
| L6 | **Low-end profile.** The same suite runs on the laptop's AMD integrated GPU and is reported separately. Preset (D6/D7): 1280 x 720, surface <= 2 ms GPU p95 |
| L7 | **Precision.** No vertex jitter on a 6,371 km sphere at 2 m eye height. Patches are placed relative to the camera from double-precision CPU positions |
| L8 | **Dynamic heights.** A height that changes every frame (waves) or by an edit (a stamp into the height texture) shows on the next frame with no re-meshing |
| L9 | **CPU twin.** Every height source has a CPU sampler returning the same height within a stated tolerance, for buoyancy, colliders and gameplay queries. A spec proves it |

## Architecture (proposal, open to the review)

```
Domain        patch (root, u, v) -> base position, normal, tangent frame.
              Doubles on the CPU; camera-relative floats on the GPU.
Selector      quadtree per root; split/merge by the criteria; 2:1 balance; hysteresis; budget.
              Output: leaves, each with a camera-relative origin, size, level, edge mask, blend data.
Criteria      each maps a node's bounds to a target cell size (metres); the smallest target wins.
HeightSource  TSL height (and normal) for the vertex stage; CPU twin; conservative min/max height
              (and a roughness bound) for a node's bounds, used for culling, horizon and error.
Renderer      one shared N x N grid geometry drawn instanced; per-leaf data in a storage buffer.
              Vertex stage: domain -> height -> blend -> fold edges next to a coarser neighbour.
Instruments   LOD colours, wireframe, bounds, counters (leaves, triangles, draws, pixels per triangle),
              GPU pass timers, crack probe, popping score.
```

Proposed choices, each an open question in the review:

1. **A quadtree of patches, not clipmap rings.** Rings are the cheapest when detail depends on distance alone, but
   feature and horizon criteria and orbit views of a sphere need a decision per patch. A quadtree with only the
   distance criterion lays out ring-like levels anyway.
2. **Criteria as target cell sizes, smallest wins.** A unit every criterion can produce and a person can read
   ("2 m cells on the road, 50 m at the horizon"). A pixel floor (about 2 px) limits ordinary requests. Under the
   leaf cap, splits go by priority (node size over target size), coarse cover stays valid, and unmet requests are
   reported. (Review round 2 replaced global target scaling.)
3. **Cracks closed in the vertex stage:** odd edge vertices next to a coarser neighbour fold onto that neighbour's
   edge (a 4-bit mask per leaf). One index buffer, one draw. No skirts.
4. **Heights read live in the vertex stage by default.** That is what makes waves and edits show on the next frame.
   A source whose height is expensive (terrain noise) bakes into a texture by compute when dirty and is then read
   live like any other.
5. **Normals from the height source, not from the mesh**, so lighting does not change with the level.
6. **Selection on the CPU first.** A few hundred leaves are expected; GPU culling and indirect draws come only if the
   CPU misses L5.

## First users

**Water (first).** Written new, in TSL:
- Live analytic waves: a small set of directional waves with an exact CPU twin; selection uses a wavelength-aware
  bound (chord sag), so calm water and long swell draw a coarse grid. One shader with choppiness Q as a toggle;
  Q = 0 (vertical sines) first, Gerstner judged later.
- Normal detail that fades with distance (filtered, so the horizon does not shimmer); a simple lit look: sky
  reflection by Fresnel, a depth tint, sun glint.
- Later, a camera-local writable height texture for ripples, wakes and splashes, written as decaying stamps (no wave
  equation solver at first): the same kind of source terrain edits use. First edits are CPU-authoritative and
  uploaded when dirty.

**Low-detail terrain (second):** a height texture baked by compute from a noise function, edits as compute stamps into
the same texture (visible next frame), and a small CPU height-field collider near moving bodies from the CPU twin
(the engine has a Jolt height-field shape component).

## Milestones

Each milestone ends with a gate measured on the reference machine and recorded in the runbook.

| # | Milestone | Gate |
|---|---|---|
| M1 | **Lab, harness and quadtree LOD** (M0 merged in). `/lod-surface-lab`, suite `lod-surface-baseline` v1 (§Suite). Bounded 100 km plane, spheres 10 km and 600 km; flat and static-bump sources; distance criterion with pixel floor, leaf cap, fixed-level toggle as the uniform baseline; equal-angle warp and `patchCells` 16/32/64 toggles; static edge folding; LOD colours, wireframe, bounds, counters, GPU pass timers; validated crack probe; one scripted zoom. Pops allowed and labelled | Zero crack pixels (probe validated by an injected gap); L5 cost; ground-to-orbit zoom with no rebuild storm; runs on both adapters |
| S1 | **Precision spike, alongside M1** (disposable): three-face cube corner with a 2:1 seam, all 16 masks, 10 km and 6,371 km, 2 m eye, 1 mm per frame, float64 reference | No crack pixels; jitter <= 0.05 px; decides the Earth-scale formula and informs D9 |
| M2 | **Blending and the other criteria** (feature regions, horizon, priority budget), each a toggle measured ABAB. Transition fixture first (diagonal ridge, live edit, unequal neighbours, reversed toggle) | Popping score; 3D boundary equality during morphs; each criterion shows its effect and its cost |
| M3 | **Water v0:** live analytic waves on plane and sphere, CPU twin, amplitude-aware selection, the simple lit look | L5 cost; parity spec; owner visual review |
| M4 | **Writable height texture source,** shared by water ripples (decaying stamps) and terrain stamps; CPU-authoritative first | Next-frame visibility; cost of an update |
| M5 | **Low-detail terrain v0:** baked noise height texture, edits, collider patch | L5 cost (with its own working number), parity, crack probe |

After M5 the owner decides how water and terrain grow from here, and whether Plans 055 and 057 adopt the core.

## Suite (proposed): `lod-surface-baseline` v1

- **Cases:** domain {plane, sphere 10 km, sphere 600 km, sphere 6,371 km} x pose {2 m eye, 200 m, 5 km, orbit,
  horizon grazing} x height {flat, waves}, trimmed so a standard run stays short.
- **Metrics:** surface GPU ms p95 (per pass), selection main-thread ms p95, leaves, triangles, draws, pixels per
  triangle, crack pixels, and the popping score on a scripted zoom.
- **Profiles:** `visible-browser` on the NVIDIA adapter (reference) and on the AMD iGPU (low end). Headless runs check
  correctness only; their timings are not hardware numbers.

**Crack probe (proposal):** a contrasting backstop surface drawn just inside the real one; every backstop pixel on
screen is a crack. **Popping score (proposal):** the largest frame-to-frame change in per-pixel depth error against a
fine reference during a slow scripted zoom. Both are open to the review.

## Tests (headless specs)

- Domain: shared edge and corner vertices across cube faces map to the same position.
- Selector: 2:1 balance, edge masks, hysteresis, budget, criteria composition, no allocation in steady state.
- Height sources: CPU and GPU agree within tolerance (as the existing GPU shape-op specs do).

## Entry points (proposal)

- Start in `projects/demo-app/src/app/pages/lod-surface-lab/`. Promote the core to a new secondary entry point
  (name open, for example `triangular-engine/lod-surface`) once M2 passes, so its public API is deliberate.
- Water gets its own new entry point later (name open). The old `water/` module is retired or kept on WebGL under
  Plan 056; this plan does not touch it.

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Fresh code: nothing ported, wrapped or imported from the GLSL `water/` module or the earlier terrain attempts | **Decided** 2026-10-24 (owner) |
| D2 | WebGPU only (`WebGPURenderer`, TSL, compute allowed) | **Decided** 2026-10-24 (owner) |
| D3 | Plan 055's lab and contenders untouched; no imports from 055 lab code (it may be read for lessons) | **Decided** 2026-10-24 (owner approved the direction) |
| D4 | LOD structure and budget | **Agreed in review** 2026-10-24: 2:1 quadtree, one instanced grid, CPU selection, edge folding without skirts, priority splitting under a leaf cap with a pixel floor |
| D5 | Level blending | Open: settled by the M2 transition fixture (ratio-driven morph vs timed parent-triangle morph); pops accepted in M1 |
| D6 | Machines: NVIDIA reference (Plan 055 D1) plus the AMD iGPU as a low-end profile | **Decided** 2026-10-24 (owner): both; the iGPU preset is 1280 x 720 with the surface <= 2 ms GPU p95 (scene named in M1) |
| D7 | Budgets L5 and L6 | **Decided** 2026-10-24 (owner): L5 as written (<= 0.5 ms GPU, <= 0.2 ms CPU p95 at 2560 x 1440); L6 = the 720p / 2 ms iGPU preset |
| D8 | Where the code lives first and the entry-point names | **Decided** 2026-10-24 (owner): `projects/demo-app/src/app/pages/lod-surface-lab/`, promoted to an entry point (name such as `triangular-engine/lod-surface`) after M2 |
| D9 | Scale range tested in v1 | **Decided** 2026-10-24 (owner): plane to 100 km, spheres 10 km and 600 km; 6,371 km is spike S1 only and informs scope, not a gate |
| D10 | Plan 057: park its race until this plan's M3, keeping W1-W17 as the long-term list | **Decided** 2026-10-24 (owner): parked |
| D11 | Globe-to-map morph | Agreed in review: out of v1 |
| D12 | Cube warp | Agreed in review: equal-angle default, toggle kept; value checked by measurement |
| D13 | Water v0 look and motion bar (sines or Gerstner; acceptable transition motion) | **Decided** 2026-10-24 (owner): sines (Q = 0) first; the owner judges Gerstner and transition motion by eye at the M3 review; pops are fine until then |
