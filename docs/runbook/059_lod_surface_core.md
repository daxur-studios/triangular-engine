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

## 2026-10-24 — Round 2 in; comparison written; plan updated (design only)

Argon and Astra wrote their round-2 proposals; Claude wrote the
[comparison](/docs/plans/059_lod_surface_review.md#comparison) and moved the agreed points into Plan 059. Nothing
built or measured.

Facts checked:
- A normalised cube's corner cells are about 5.2 times smaller in area.
- Contender B computes directions in JavaScript doubles.
- 32 x 2^19 = 2^24 (exact in float32).
- `testing.md` leaves metric providers to the host.

Agreed by all three, now in the plan:
- the quadtree and folding base;
- priority splitting under a leaf cap with a pixel floor;
- a wavelength-aware water bound;
- equal-angle warp as the default;
- M0 merged into M1;
- the Earth precision spike (S1) alongside M1;
- a crack probe validated by an injected gap;
- CPU-authoritative first edits and stamp ripples.

Left to measurement:
- transitions (M2 fixture);
- the Earth precision formula (S1);
- Gerstner choppiness (M3);
- grid size (M1 sweep);
- one draw or a stitched fallback.

Owner decisions open: D9 (Earth scale), D6/D7 (iGPU preset and budgets), D10 (park Plan 057), D13 (water visual bar),
D8 (confirm location).

Next: the owner settles those decisions; then M1 and S1.

### Owner decisions

Taken 2026-10-24 after the comparison:
- **D9:** 6,371 km is spike S1 only; it informs scope and is not a gate.
- **D6/D7:** the iGPU preset is 1280 x 720 with the surface at or under 2 ms GPU p95; L5 stays as written.
- **D10:** Plan 057's race is parked until M3.
- **D8:** start in the demo-app lab; promote to an entry point after M2.
- **D13:** sines first; the owner judges Gerstner and transition motion at the M3 review.

Plan 059 has no open owner decisions left; D5 (blending) waits for the M2 fixture. Next: M1 and S1.

## 2026-10-25 — M1 built; specs green; gates not yet measured

### Built

The lab is in the demo app: `projects/demo-app/src/app/pages/lod-surface-lab/`, at the route `/lod-surface-lab`, with index entry 059. It does not import from Plan 055 lab code (D3).

- **Domains (`lod-domain.ts`).**
  - Bounded 100 km plane; spheres of 10 km and 600 km.
  - Cube faces with an equal-angle warp that is exactly ±1 at face edges.
  - Cross-face neighbour lookup by radial projection.
- **Selector (`lod-selector.ts`).**
  - CPU quadtree, rebuilt from the roots every frame with pooled typed arrays.
  - Splits by priority from a max-heap: distance criterion, cell size in pixels with a 2 px floor.
  - Leaf cap, with `CAP_SLACK` 144 for forced balance splits. A fixed-level mode serves as the uniform baseline.
  - 2:1 balance as a restricted quadtree: coarser neighbours are split before a split, across faces too.
  - A 4-bit coarser-edge mask per leaf.
  - Frustum culling on bounding spheres.
  - Deepest level is `min(20, 24 - log2 patchCells)`, so lattice parameters stay exact in float32.
- **Renderer (`lod-surface-mesh.ts`).**
  - One instanced grid, one draw, TSL on `WebGPURenderer`.
  - Each leaf's origin is relative to the camera, computed in doubles.
  - The vertex offset uses the cancellation-free form R·(dc/|c| − cC(dc·(2cC+dc))/(|c||cC|(|c|+|cC|))), with dc from an exact tan-difference.
  - Heights and normals are evaluated at the global lattice parameter, so they are identical across leaves.
  - Static edge folding: an odd vertex on a coarser edge goes to the mean of its two even neighbours.
  - Debug views: LOD colours, shaded, bounds, wireframe, freeze selection.
- **Heights (`lod-height.ts`).** Flat, and static bumps (crossing sines over five scales).
- **Crack probe (`lod-crack-probe.ts` and the page).**
  - A backstop is drawn first, without depth, just inside the surface: a smaller sphere, or a square under the lowest height.
  - The surface is drawn over it into an RGBA8 target.
  - A backstop pixel counts as a crack unless it touches the background.
- **Suite `lod-surface-baseline` v1 (`lod-surface-tests.ts`, `lod-surface-test-adapter.ts`).**
  - Cases: 3 domains × 5 poses with bumps; flat on the plane and sphere-600; cells 16 and 64; no warp; the fixed-level baseline.
  - Two controls, injected gap and folding off, that must find cracks.
  - Two 12 s scripted zooms from a 2 m eye to orbit.
  - Each still case runs its timing window, then the probe outside the window.
  - Checks include one draw, leaves within cap plus slack, zero cracks (or some for the controls), and no selection frame over 8 ms during the zoom.
  - Launch link: in the plan front matter.

### Verified

- **Headless specs.** `lod-surface-lab.spec.ts`, 25 specs, all pass, run with `ng test demo-app --watch=false --browsers=ChromeHeadless --include=…/lod-surface-lab.spec.ts`. They cover:
  - shared cube-edge vertices bit-identical across faces, with and without the warp;
  - symmetric cross-face neighbours;
  - 2:1 balance, whole cover and correct masks on all three domains at three poses;
  - cap behaviour;
  - the deepest-level bound;
  - storage reuse;
  - the shader offset formula against the direct difference, in doubles;
  - height bounds;
  - crack counting;
  - suite shape.
- **Demo-app build.** It failed in HEAD before this work: `triangular-engine/testing/core` was mapped in the root `tsconfig.json` but not in `projects/demo-app/tsconfig.app.json`, whose `paths` override it. Added the mapping, and the build passes.
- **Page.** It mounts and runs a selection: sphere 600 km at the 2 m eye gives 1023 leaves (749 drawn), deepest level 18, cap hit. It was **not seen rendering**: the session window was hidden, so the pane got no animation frames. The screenshot, probe and controls are unchecked.

### Findings

- **Selection CPU is over the L5 budget.** In Node, the 15 baseline poses take 1.6–3.0 ms per select with cap 1024 and 32 cells, and 0.4–0.9 ms at orbit. The budget is ≤ 0.2 ms.
  - The profile shows `addNode` (6 domain points per node, about 4000 nodes per frame) at about 75% of the time, and `neighbourCell` (balance) at 20%.
  - Node geometry does not depend on the camera, so keeping the tree, or at least node geometry, across frames should remove most of this. A persistent tree also helps M2 (blending needs per-node history).
- **The cap binds at 4 px cells.** At 1440p with cap 1024, every non-orbit pose hits the cap, and "unmet" is close to the drawn count. Either the default cell size grows (8 px), or the cap does once GPU cost is measured. The M1 sweep decides.

### Not done

- Seeing the page render, the probe run, and both controls finding cracks (needs the app window in front).
- `lod-surface-baseline` v1 on the NVIDIA and AMD adapters (owner-run, or unattended when the owner says the laptop is free).
- The persistent selector, to meet the CPU budget.
- Spike S1.

### Next

1. Make the selector persistent (geometry cache, then incremental split and merge).
2. Look at the page with the window in front: render, probe, controls.
3. Owner runs the suite on both adapters, and the gates are recorded here.

## 2026-10-25 — Persistent selector; selection at the CPU budget in Node

### Built

- **Persistent node pool** in `lod-selector.ts`. The tree is still re-selected from the roots every frame, in the same priority order, but nodes are no longer recreated:
  - a node keeps its block of four children after it stops being split, with their camera-independent data (centre, normal, bounding radius, longest edge, and the same-level neighbour cell across each edge);
  - `open` marks the nodes split in the current frame, and only culling and priority are recomputed per view;
  - the pool holds four trees by default; when it runs low, blocks that the last tree did not reach go on a free list.
- **Neighbour lookups start from the nearest shared ancestor** (parent pointers) instead of the root, except across cube faces.
- The bench script was a scratch file and is deleted; the numbers are below.

### Verified

- 26 headless specs pass. The new spec checks that a reused selector picks the same cells, masks and drawn flags as a fresh selector over 30 views (5 poses × 3 rotations of the sphere, twice). It uses a two-tree pool, so reclaiming runs, and checks 2:1 balance after every view.

### Findings

- **Selection is now at the L5 budget in Node.** Cap 1024, 32 cells, 4 px cells, culling on, 15 baseline poses: 0.15–0.19 ms per select for a still camera and 0.17–0.21 ms for a camera moving 1% of its altitude per frame. Orbit is 0.03–0.10 ms. Before: 1.6–3.0 ms.
  - The steps: keeping the pool alone gave 0.7–1.3 ms; caching neighbour cells gave 0.22–0.52 ms; climbing from the shared ancestor gave the numbers above.
  - These are Node numbers on the owner's laptop, not browser main-thread p95 on the reference machine. L5 is not yet measured.
  - Profile after the change: neighbour descent and split priority lead; there is no single large cost left. Incremental split and merge (no re-selection from the roots) is the next step if the browser numbers miss.

### Next

1. Look at the page with the window in front: render, probe, controls.
2. Owner runs `lod-surface-baseline` v1 on both adapters, including selection CPU p95, and the gates are recorded here.
3. Spike S1.
