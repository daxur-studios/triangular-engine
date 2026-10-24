---
type: Plan
title: LOD Surface Core for Water and Terrain
description: A fresh, WebGPU-only, performance-tested level-of-detail surface (a height over a plane or a sphere, drawn as one instanced grid whose density follows pluggable criteria), shown first on a flat and a sphere lab page, then used by a new water surface and later by low-detail terrain. Draft for review; nothing built.
timestamp: 2026-10-24T00:00:00Z
tags: [lod, mesh, quadtree, sphere, plane, water, terrain, webgpu, tsl, performance, testing]
runbook: /docs/runbook/059_lod_surface_core.md
performance: []
---

# Plan 059: LOD Surface Core for Water and Terrain

Status: **draft, nothing built.** Written 2026-10-24 after an owner discussion. Before anything is built, the
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
| L6 | **Low-end profile.** The same suite runs on the laptop's AMD integrated GPU and is reported separately. Working number: a lower-detail preset holds 60 fps there |
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
   ("2 m cells on the road, 50 m at the horizon"). The budget scales all targets up until the leaf count fits.
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
- Live analytic waves: a small set of directional waves with an exact CPU twin; selection uses the wave amplitude as
  its roughness bound, so calm water draws a coarse grid.
- Normal detail that fades with distance (filtered, so the horizon does not shimmer); a simple lit look: sky
  reflection by Fresnel, a depth tint, sun glint.
- Later, a camera-local writable height texture updated by a compute wave equation for ripples, wakes and splashes:
  the same kind of source terrain edits use.

**Low-detail terrain (second):** a height texture baked by compute from a noise function, edits as compute stamps into
the same texture (visible next frame), and a small CPU height-field collider near moving bodies from the CPU twin
(the engine has a Jolt height-field shape component).

## Milestones

Each milestone ends with a gate measured on the reference machine and recorded in the runbook.

| # | Milestone | Gate |
|---|---|---|
| M0 | **Lab and harness, no LOD yet.** `/lod-surface-lab` in the demo app, WebGPU only. Plane and sphere, a uniform grid, debug views, counters, GPU pass timers. Suite `lod-surface-baseline` v1 (§Suite) | The suite runs and saves results on the NVIDIA adapter and on the iGPU |
| M1 | **Quadtree LOD,** distance criterion only, edge folding, LOD colours, on plane and sphere (10 km, 600 km, 6,371 km) | Zero crack pixels; L5 cost; ground-to-orbit zoom with no rebuild storm; L7 jitter check |
| M2 | **Blending and the other criteria** (feature regions, horizon, budget), each a toggle measured ABAB | Popping score; each criterion shows its effect and its cost |
| M3 | **Water v0:** live analytic waves on plane and sphere, CPU twin, amplitude-aware selection, the simple lit look | L5 cost; parity spec; owner visual review |
| M4 | **Writable height texture source,** shared by water ripples (compute wave equation) and terrain stamps | Next-frame visibility; cost of an update |
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
| D4 | LOD structure: quadtree of patches, clipmap rings, or another | Open (proposal: quadtree; review Q1) |
| D5 | Level blending: per-vertex morph, timed fade, or accept pops at low detail | Open (review Q3) |
| D6 | Machines: NVIDIA reference (Plan 055 D1) plus the AMD iGPU as a low-end profile | Open (proposal: both) |
| D7 | Budgets L5 and L6 | Open (working numbers) |
| D8 | Where the code lives first and the entry-point names | Open (proposal: demo-app lab, promote after M2) |
| D9 | Scale range tested in v1 | Open (proposal: plane to 100 km; spheres 10 km and 600 km; 6,371 km for precision only) |
| D10 | Plan 057: park its race until this plan's M3, keeping W1-W17 as the long-term list | Open |
| D11 | Globe-to-map morph | Open (proposal: out of v1; the vertex stage leaves room for it) |
