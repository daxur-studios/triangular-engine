---
type: Runbook
title: LOD Surface Core for Water and Terrain
description: Findings, decisions, gates and timings for the shared LOD surface (plane and sphere) and its first users, water and low-detail terrain. Currently design notes only.
timestamp: 2026-10-24T00:00:00Z
tags: [lod, mesh, quadtree, sphere, plane, water, terrain, webgpu, tsl, performance, testing]
plans: [/docs/plans/059_lod_surface_core.md]
performance: []
---

# Runbook 059: LOD Surface Core for Water and Terrain

Plan: [Plan 059](/docs/plans/059_lod_surface_core.md). Review: [LOD surface review](/docs/plans/059_lod_surface_review.md).

## 2026-10-24 — Plan drafted after owner discussion (design only)

Nothing built, run or measured. Files written: Plan 059, this runbook, the review page, and one row in each index.

### Ask (owner's words, condensed)

- Terrain is "stuck": the POCs are very ambitious and take too long. Wanted: something quick and good for low and
  lower-detail games, or at least meshing that runs very fast on a flat or sphere shape, since every POC and demo
  so far is on rough terrain.
- The ground work done more cleanly, e.g. a grid visibly getting more or less detailed as the camera zooms.
- Could water and terrain share one approach? Terrain is "kind of like frozen water", and water is far more dynamic,
  which may already allow terrain modification. Perhaps leave the terrain POCs alone and do water first.
- An earlier session proposed reusing the existing water code. **Rejected:** that code is not good enough; the owner
  wants a new approach, WebGPU only, as a performance-tested foundation for meshes whose level of detail follows
  custom criteria (camera nearness, feature importance, horizon nearness).
- Discuss the direction with several agents (Argon, Astra) before building.

### Findings (code and docs read this session)

- **Plan 057** (planet water) is design only and blocked on Plan 055 Phase 0. It sets 17 targets and a race between
  four contenders (Gerstner shell, FFT cascades, a hybrid, a traced surface). Two of its contenders assume "a sphere
  shell drawn as an LOD mesh" that does not exist yet.
- **The GLSL `water/` module** has a camera-centred LOD grid and plane, sphere and cylinder domains, but it is
  `ShaderMaterial` code and cannot draw on `WebGPURenderer` (Plan 056's inventory). Excluded by the owner (Plan 059 D1).
- **Plan 055 contender B** (`planet-shape-lab/contender-b/`, 2026-10-23) has a cube-sphere with canonical lattice
  keys, a quadtree leaf selector (screen cell size, view and horizon culling, 2:1 balance, coarser-edge masks) and a
  shell that folds odd edge vertices next to a coarser leaf. A build takes 2-5 s on the iGPU (compute column scans
  for overhangs about 3 s, CPU assembly about 3 s, per Runbook 055); no timing on the reference GPU yet. It is the closest existing work to this
  plan's selector, but it is a terrain contender; Plan 059 D3 proposes reading it for lessons only.
- **Runbook 028** records that the camera-centred clipmap spike for terrain was proposed and never run, and that its
  blocker (no GPU version of the terrain generator) was about a height source, not about the grid.
- **Usable infrastructure:** `triangular-engine/testing` (suites, saved results, budgets and baselines, ABAB ablation,
  GPU time per pass, machine context), `triangular-engine/gpu-data-flow` (job scheduler, upload and readback rings),
  `EngineService` with `preferredRenderer: 'webgpu'`, a Jolt height-field shape component, three.js 0.186.1.

### Decisions

- **D1 (owner):** fresh code; nothing ported, wrapped or imported from the GLSL `water/` module or the earlier
  terrain attempts.
- **D2 (owner):** WebGPU only.
- D3 (leave Plan 055 untouched, no imports from its lab code) is the owner's stated direction, recorded as "to
  confirm". D4-D11 are open.

### Not done

- No code, no measurement, no web research. The architecture in Plan 059 is Claude's proposal and is under review.
- Plan 057 was not edited; parking its race is D10.

### Owner review

The owner approved the direction (LOD surface first, then water, then terrain) and confirmed D3. The prompt in the
review page was sent to Argon and Astra. D4-D11 stay open until the consensus.

### Next

1. Argon and Astra fill in their sections of the [review](/docs/plans/059_lod_surface_review.md).
2. Claude writes the consensus; the owner settles D3-D11.
3. M0: the lab page and `lod-surface-baseline` v1.

## 2026-10-24 — Round-1 reviews in; round 2 opened (design only)

Argon and Astra wrote their reviews. At the owner's request, round 2 asks each reviewer for its own consensus, so the
owner can compare three instead of reading one written by Claude. The review page gained "Consensus proposals
(round 2)" with the prompt, Claude's proposal, and empty subsections for Argon and Astra; the single "Consensus"
section became "Comparison", to be written after all three.

Claims checked for Claude's proposal: contender B's `leaf-select.ts` builds string-keyed `Map`s per call and reaches
`Math.atan` through `leafAt` in neighbour probes; `cube-sphere.ts` has `LEAF_CELLS = 32` and `MAX_LEVEL = 19`, a lattice
of ±2^24 (exact in float32).

Round 1 in short: all three chose a CPU-selected 2:1 quadtree drawn as one instanced grid, edge folding without skirts,
and live heights. Disputed: level transitions, how to reach Earth-scale precision, the cube warp, sideways
displacement for water, grid size and the iGPU preset. Claude conceded the global budget scaling, the missing pixel
floor, its per-leaf precision scheme, the wave-equation ripples, and a separate M0.

Next: Argon and Astra write their round-2 proposals; then the comparison and the owner's decisions go into Plan 059.
