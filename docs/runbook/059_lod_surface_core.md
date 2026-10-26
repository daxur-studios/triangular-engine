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

## 2026-10-25 — First baseline run on the RTX 3080: three fixes, suite v2

The owner ran `lod-surface-baseline` v1 in quick mode, visible browser, on the NVIDIA adapter (2538×1308 drawing buffer). Result: 3 valid cases, 21 failed, 1 invalid. Every crack check failed, many windows were capped, and both zoom cases failed their state check.

### Findings

- **Selection CPU in the browser:** median 0.3–0.4 ms and p95 0.4–0.5 ms on the ground poses (cap 1024), 0.1–0.2 ms at orbit. That is about twice the 0.2 ms L5 budget, which the Node bench had met. The selector still needs work (incremental split and merge, or less per-frame work) before L5 passes. GPU scene pass: 0.14–0.27 ms at 32 cells, 0.66–0.92 ms at 64 cells.
- **Large holes on the NVIDIA sphere came from the GPU's `sin`, not the selector.** Sphere-600km eye-2m had 190,661 crack px, and the flat source had 357,490. The same poses on the AMD iGPU (browser pane, same buffer size) had 0–9 px, with identical selection stats (deepest level 19, the same unmet and drawn counts). WGSL only bounds `sin`'s absolute error, and the vertex offset took `sin` of the deep-leaf parameter offset, which is about 1e-6. On NVIDIA that wiped out the offset, so neighbouring leaves no longer met. The evidence matches: the no-warp case (no trig) had 6 px where the warped one had 592, and the plane had 3–6 px.
- **Capped windows:** still cases had `quickMs: 1500`. The settle check needs two passing looks, with the series growing 10% between them, after at least 1 s, so 1.5 s usually ran out first.
- **Zoom state check:** the zoom clears its motion flag when it ends, and the adapter read the settings after that, so it reported `motion: expected zoom, found undefined`.
- **Residual seam pixels (open):** after the sine fix, the AMD pane still shows 1–5 isolated crack pixels per pose, scattered over the surface (near the camera too) and on the plane as well. These look like float seam sparkles: two leaves compute the same edge vertex from different camera-relative origins, and the sums differ in the last bits. The 0 px gate fails on them.

### Built

- `lod-surface-mesh.ts`: `warpDelta` uses `smallSin`, a Taylor polynomial to x^9 (relative accuracy holds down to tiny x), instead of the built-in `sin`.
- `lod-surface-test-adapter.ts`: a zoom case's settings are checked while the zoom still runs.
- `lod-surface-tests.ts`: **suite v2**, the same cases, with still windows no longer capped at 1.5 s in quick mode (the cap is their full 4 s). v1 stays in the history.
- Specs: the polynomial in float steps against `Math.sin` (under 1e-6 relative error, from 1e-7 to 0.85); v2 keeps v1's cases with no short quick cap on still cases; a zoom case passes its state check (fake host). 29 headless specs pass.

### Verified

- In the browser pane (AMD, 3807×1962 after the fix): the surface renders; the sphere poses have 1–5 crack px; the injected-gap control finds 96,549 px and the folding-off control 257 px.
- Not verified: the fix on the NVIDIA adapter, which the pane cannot use. That needs a v2 run there.

### Next

1. Owner reruns v2 on the NVIDIA adapter to confirm the holes are gone.
2. Decide how to close the residual seam pixels: either make seam vertices bit-identical (positions on shared edges from shared data), or a small overlap or skirt.
3. Bring selection p95 under 0.2 ms in the browser.

## 2026-10-25 — Bit-identical seams

Goal: close the 1–5 px "sparkle" cracks that remained after the sine fix by making every shared seam vertex a function of data that is exactly identical for each leaf that draws it.

### Findings

- The sparkles had one cause. A vertex was `leaf origin (camera-relative, per leaf) + offset from the leaf centre (per leaf) + height`, with `warpDelta` also based at the leaf centre. Two leaves sharing an edge vertex took different float paths to the same point, so the results differed in the last bits and the rasterizer left hairline gaps. The old fold also placed an odd edge vertex at the mean of its even neighbours' final positions, which is collinear with the coarse edge only to float rounding (a hair-thin T-junction).
- Nothing per-leaf has to enter the position: the lattice below makes every input global.

### Built

1. **One integer lattice per face** (`lod-lattice.ts`). L = patchCells * 2^maxLevel = 2^24 steps per face side for 16, 32 and 64 cells alike (`maxLevelFor` gives 20, 19, 18). A leaf has step s = 2^(maxLevel − level) per grid cell and origin (i, j) * patchCells * s; vertex (gx, gy) is the lattice point (U, V) = origin + (gx, gy) * s. All values are integers up to 2^24, so float32 arithmetic on them is exact (the shader keeps them in float, so no i32 path is needed). The instance attributes are now only `aLeaf = (U0, V0, s, face)` and `aInfo = (level, mask)`.
2. **Folding by snapping.** An odd vertex on an edge next to a coarser leaf moves one grid cell back along the edge (`foldedGrid` on the CPU, step functions in the shader). That is an even index, a lattice point the coarse leaf also has (its step is 2s and its origin a multiple of 2s because patchCells is even), so the folded vertex equals the coarse vertex exactly, height included. The edge becomes a degenerate fine segment plus the coarse segment itself: no T-junction. Cost: the cells beside a folded edge stretch by up to half a cell, and the folded edge follows the coarse leaf's own vertices (previously the chord midpoint, the same line).
3. **Cube-lattice vector T on the sphere.** T = n L + u (2U − L) + v (2V − L) is an integer vector with one component ±L. It identifies the point, not the face: a seam vertex reached from either face (three at a corner) has the same T, so it gets the same bits without a cross-face table. The cube point is tan(π/4 T_k / L) per component (T_k / L with the warp off).
4. **Camera anchor, per frame (uniforms).** The CPU picks the lattice point nearest to the camera's direction (integer vector `uAnchorT`), its float cube point `cA` and rounding error, `cos(π/4 T_A / L)`, and `uAnchorRel` = (anchor point on the base surface) − camera, subtracted in doubles. This is the brief's "integer part plus fraction": the fraction (including the camera height) lives inside `uAnchorRel`. Deviation: one global anchor on the camera's face; other faces and the far side are handled by the same T arithmetic, which is face-independent.
5. **Vertex path:** `dT = T − T_A` in exact integers; `dc = sin(dT π/4/L) / (cos(T π/4/L) cos(T_A π/4/L)) + error` per component (tan a − tan b = sin(a − b) / (cos a cos b)); then the existing form `R (dc / |c| − cA (dc · (2 cA + dc)) / (|c| |cA| (|c| + |cA|)))` with `c = cA + dc`; position = `uAnchorRel` + that + up * height. The up vector and the height sample point come from `c / |c|`, also a function of T only. `smallSin` is now a Taylor polynomial to x^15 (`SIN_DENOMINATORS`), accurate to about 1e-10 for |x| ≤ π/2, because its argument is no longer a leaf's half width but can span a whole face. The plane is the same with dU, dV and a constant `size / L`.
6. **Controls:** the injected gap shrinks `dT` toward the leaf centre's lattice point by `gap * (T_c − T)`, an additive term that is exactly 0 when the gap is 0. The folding-off control is unchanged (`uFolding` = 0 stops the snap).
7. **CPU cost:** the upload no longer evaluates `tan` or normalises per leaf (two attributes and a few integer products per leaf), so it gets cheaper. The selector is untouched.
8. **Invariance:** TSL does not expose an invariant qualifier on the position output, so none is set. Within one pipeline the same inputs go through the same instructions; there are no per-leaf branches, and the only data-dependent selects (the fold step functions) take the vertex's own grid coordinates. `lod-domain.ts` only gains an `export` on `faceOfDirection`.

Precision (sphere-600km, eye 2 m):

- Lattice spacing is R π/2 / 2^24 ≈ 0.056 m at a face centre, so a 32-cell leaf at level 19 is about 1.8 m wide.
- `dT` is exact (integers). `dT * (π/4/L)` has relative error about 1e-7 of `dT`, i.e. of the distance to the anchor, not of R: 0.1 mm at 1 km. The polynomial error is about 1e-10. The built-in `cos` only enters as a divisor in [0.7, 1]; if its relative error were as large as 1e-6 that is 1 mm at 1 km, 0.1 mm at 100 m.
- The `cubeError` term restores the anchor's float rounding (about 3e-8 * R = 0.02 m, a visible constant shift if left out).
- `uAnchorRel` is at most the anchor-to-camera distance (a fraction of a lattice step plus the camera height), so its rounding is about 1e-7 m. Far vertices carry 1e-7 relative error (0.06 m at 600 km, under a pixel there).
- Heights are sampled at `up * R` in absolute floats: the sine phase error is about 0.06 m / wavelength * amplitude, at most 0.005 m (31 m scale). Unchanged.
- The headless spec mirrors the shader in `Math.fround` (`sphereVertexF32`) and compares with the double position: within 2 mm + 2e-6 * distance from 0.5 m to 5 km around an eye-2m camera. The mirror uses `Math.cos`; the GPU's `cos` is the one term not mirrored exactly.

### Verified

- 38 headless specs pass (`ng test demo-app --browsers=ChromeHeadless --watch=false --include="**/lod-surface-lab/**/*.spec.ts"`; 29 before, 9 added, the sine spec widened in place to π/2): same-level neighbours and fine-beside-coarse (folded) leaves give identical lattice points and identical float positions on the sphere (with and without warp) and the plane; folding lands on the coarse leaf's lattice points; every cube-edge vertex has one T from each face that contains it, so one float position; the float mirror stays within millimetres of doubles near an eye-2m camera on the sphere and the plane; the gap term is exactly 0 when off; the mesh builds its vertex graph and uploads lattice attributes for the sphere and plane. `tsc -p projects/demo-app/tsconfig.app.json --noEmit` and the spec config type-check.
- In the browser pane (AMD iGPU, WebGPU, 1896×1080 probe buffer), the shader compiles and renders with no console errors. `crackProbe()` read **0 px** in all of these cases:
  - plane-100km, sphere-10km and sphere-600km, at all five poses;
  - plane-100km and sphere-600km over flat ground, at all five poses;
  - no warp at 5 km;
  - 16 and 64 cells at eye-2m.

  Both controls still find cracks: an injected gap of 0.01 at low-200m gives 26,273 px, and folding off over bumps gives 56 px. Before this change, the same poses showed 1–5 px.
- Not yet measured on the NVIDIA adapter.
- Suite not bumped: `lod-surface-baseline` v2 keeps its ids, settings and durations; only the renderer changed.

### Next

1. Rerun v2 on the NVIDIA adapter. It covers both the sine fix and this one. In the pane, every case already reads 0 px.
2. Watch for sub-millimetre jitter at eye-2m; the GPU `cos` is the one non-polynomial term (a polynomial cosine would remove it).
3. If sparkles remain, the shared remaining operation is the clip transform, and the main and probe materials must render the same position bits (they share one node graph).
4. Selection p95 under 0.2 ms in the browser (still open).

## 2026-10-25 — v2 on the RTX 3080: no cracks

The owner ran `lod-surface-baseline` v2 in quick mode, visible browser, on the NVIDIA adapter (2538×1308 drawing buffer), at commit 79d8c66 with a clean tree, so with both the sine fix and the bit-identical seams.

### Verified

- All 25 cases valid and passing; every still window settled (1.0–3.1 s), none capped. Both zoom cases pass their state check.
- `crackPixels` is **0** in all 21 ordinary still cases (v1 on this adapter: every crack check failed).
- Both controls still find cracks: injected gap 42,042 px, folding off 105 px.
- GPU scene pass p95 0.04–0.27 ms at 32 cells (0.61 ms at 64 cells, 6.3 M triangles), inside the L5 0.5 ms at this buffer size for the default grid. The buffer is 2538×1308, not the 2560×1440 L5 names.
- Frame interval median 6.0–6.1 ms (the display rate) everywhere.

### Findings

- Selection CPU p95 is 0.4–0.6 ms in every capped-leaf case (0.1–0.2 ms where fewer than 400 leaves are selected), so 2–3× the L5 0.2 ms. The 1,024-leaf cap is hit at every ground and horizon pose.
- Jitter not checked: the suite measures still frames only.

### Next

1. Selection p95 under 0.2 ms in the browser (the remaining M1 gate).
2. Watch for sub-millimetre jitter at eye-2m in motion; a polynomial cosine is the fix if it shows.
3. Spike S1.

## 2026-10-25 — Cliff detail: design note (nothing built)

The owner asked whether a tall cliff (200 m, now one stretched face from bottom to top) could get subdivided,
LOD'd detail going inward and outward, and how that works with overhangs and Jolt. Written up as the plan's
§Cliff detail, milestone M6 and decision D14. The owner accepted D14 the same day: cliffs by vector displacement are M6.

### Findings

- A height along the base normal cannot subdivide a vertical face: grid density is spaced over the ground, so more
  levels add vertices only at the face's top and bottom. A slope term in the error measure helps steep slopes only.
- Vector displacement (a 3D offset per lattice point) moves vertices up the face. It keeps the bit-identical seams
  of the 2026-10-25 lattice work, because the offset is a function of the same integer lattice coordinate.
- The main risk is the sheet folding through itself; sideways offset needs a bound (positive Jacobian or a grounded
  clamp).
- Jolt's height-field shape cannot hold vertical faces or overhangs; near bodies the collider becomes a small
  `MeshShape` patch from the CPU twin, and the twin needs a ray-hit query.

### Next

1. The slope criterion goes into M2.
2. M6 (cliffs) after M5.

## 2026-10-25 — Selection CPU: Node p95 0.10 ms moving, 0.001 ms still (browser not rerun)

Goal: selection p95 at or under 0.2 ms in the browser on the reference laptop. The browser has run about 2.5 times slower than Node, so the aim in Node was p95 of 0.08 ms at cap 1024, still and moving.

### Built

1. **What the browser metric times.** The page times `frustumNormals`, `selector.select` and `mesh.upload` together. The old `frustumNormals` allocated four arrays per frame and `upload` repacked and re-uploaded every frame even when nothing had changed. Both are now allocation-free, and `upload` skips the pack and the GPU write when the selector and its `version` are unchanged (`lod-leaf-pack.ts` holds the pack; the attribute update ranges are reused objects).
2. **Unchanged-view memo.** `select` compares a 16-double key (camera, frustum planes, pixel angle) and returns early on a match. `version` counts rebuilds.
3. **Neighbour pointers and stamps.** Each pool node holds the pool index of the same-level cell across each edge (`nb`), linked when the later block is created, with two stand-in nodes for "not made yet" and "plane border". A node is in the current tree when `stamp[node] === frame`. The 2:1 balance check and the edge masks are now stamp reads, not tree descents. The descend-based `coveringNeighbour`, `findCovering` and `edgeMask` stay as the reference path for the specs.
4. **Cheaper per-node work.** One hot array (centre, radius, edge length) per node, one loop for culling and priority per new block, the division skipped for nodes that cannot ask for a split, and `priority[]` kept only for queued nodes (0 otherwise; it was the raw value before). Leaves and masks come out of one branch-free pass.
5. Not done: incremental split and merge from the last frame's tree. It cannot promise the same leaves as a rebuild from the roots under the cap, so the tree is still rebuilt from the roots every changed frame.

### Verified

- 62 headless specs pass (`ng test demo-app --browsers=ChromeHeadless --watch=false --include="**/lod-surface-lab/**/*.spec.ts"`; 38 before, 24 added). The new ones compare the selector with a plain reference (cells by key, search-based balance and masks, the original binary heap) for exact leaves, masks, order and stats: plane and sphere 600 km, caps 64, 300 and 1024 plus fixed level 4 at cap 700, cull on and off, five poses with a moving camera, and a small pool that reclaims. They also check every `nb` pointer against `neighbourCell`, the memo and the upload skip, the pack contents, and the new `frustumNormals` against the old formula bit for bit.
- A scratch comparison of the original and the new selector over 5400 views (three domains, caps 64, 300 and 1024, cull on and off, five poses, 60 moving frames each): 0 mismatches in leaves, masks, order and stats.
- **Node timings, 15 baseline poses, cap 1024, frustumNormals + select + pack + anchor, min of three runs, noisy laptop:**

| Node, ms | before p50 | before p95 | after p50 | after p95 |
|---|---|---|---|---|
| still camera | 0.178 | 0.251 | 0.001 | 0.001 |
| jitter (view changes every frame) | 0.191 | 0.292 | 0.045 | 0.072 |
| moving, 1% altitude per frame | 0.192 | 0.258 | 0.064 | 0.100 |
| moving, cap-hit poses only | 0.255 | 0.330 | 0.088 | 0.130 |

- **Browser numbers are not measured.** The owner needs to rerun `lod-surface-baseline` v2.

### Findings

- Moving at the cap is still about 0.10 to 0.13 ms in Node, above the 0.08 aim. Profile: culling and priority about 35 percent, collecting leaves and popping the heap about 35, splitting about 10. The remainder looks like branch misprediction and heap work.
- Chrome rounds `performance.now()` to 0.1 ms unless the page is cross-origin isolated. A sub-0.2 ms p95 is only readable to within that step.
- Node timing on this laptop moves by tens of percent between runs, so only A/B alternation and min-of-three were trusted.

### Next

1. Owner reruns `lod-surface-baseline` v2 on the NVIDIA adapter and reads `npm run test:summary`.
2. If moving at the cap is still over 0.2 ms in the browser, the remaining cost is the heap and the per-node cull; a coarser first pass or reusing last frame's culling by frustum margin would be the next candidates, each needing the same equivalence spec.

## 2026-10-25 — Water: lessons from Minamo (study only, nothing built)

Read the public, MIT-licensed Minamo WebGPU water demo for ideas for M3. No code was copied; credit the approaches if they are adopted. Its assets are CC0, but its `docs/brand/` folder is not MIT.

### Worth adopting (ranked)

1. Slope-variance roughness: each sine adds (A·k)²/2 to the surface's slope variance, which feeds the specular roughness, so distant waves turn into gloss instead of aliasing.
2. Each wave fades out as its wavelength nears about four vertex spacings of the grid it is drawn on. This fits our per-leaf spacing directly.
3. Sun glint: GGX alpha floored at the sun's angular radius, exact Fresnel, and the sky mip chosen by roughness.
4. Closed-form RGB depth absorption. This needs a depth copy, and on a sphere "up" is the local normal.
5. Foam from the Jacobian of Gerstner waves.
6. One wave function shared by the mesh, the CPU and the waterline. Ours is already exact on the CPU twin; Minamo reads back from the GPU a frame late.
7. A near-plane waterline texture (deferred).
8. Filtering texture heights in exact f32. This also applies to chunk B's terrain texture.
9. Check its GPU timer approach against ours; the sky fixes are minor.

### Not a fit

- The polar disc grid (plane only).
- FFT cascades.
- Periodic textures without a floating origin.
- Underwater and lens effects.
- 1.25× supersampling.
- Its raw WGSL post stack.

### Next

These go into M3 after M6 (D15).

## 2026-10-25 — RTX rerun after the selector rework: selection at budget

The owner ran `lod-surface-baseline` v2 on the RTX 3080 Laptop (NVIDIA adapter, visible browser, quick mode, one case per run, fingerprint `ec202a60-e3b0c442`). Every run logged `WARN other-app-measuring`.

| | before (v2) | after |
|---|---|---|
| selection CPU p95, still poses | 0.4–0.5 ms | 0.1 ms (median 0.0) |
| selection CPU p95, `zoom-sphere-600km` | 0.6 ms | 0.2 ms (max 0.4) |
| selection CPU p95, `zoom-plane-100km` | 0.5 ms | 0.2 ms (max 1.1) |
| crack px, ordinary cases | 0 | 0 |
| controls (injected gap / folding off) | found | 42,042 / 105 px |
| GPU scene pass p95 | ≤ 0.27 ms (cells64 0.67) | ≤ 0.27 ms (cells64 0.61) |

### Findings

- On still poses, the unchanged-view memo skips selection entirely, so their selection metric now measures upload and anchor work, not selection. The zoom cases are the real selection measurement.
- The zoom p95 sits exactly on the 0.2 ms budget. Chrome's timer steps by 0.1 ms here, so this pass has no margin. The 1.1 ms maximum on the plane is a single frame.
- `sphere-600km-mid-5km-nowarp` and `control-injected-gap` hit the 4 s window cap without settling. Both rendered correctly (0 px and 42,042 px). The settle rule did not converge, probably on the 0.0/0.1 ms flicker of the quantised timer; the surface itself is not affected.

### Next

1. Rerun with nothing else measuring, and judge M1 on the zoom cases' p95.
2. If the margin matters, the suite could time selection over N repetitions per frame, or the page could be cross-origin isolated for a finer timer. Either changes the measurement, so the suite version goes to v3.

## 2026-10-25 — Chunk B: baked texture height source (specs only, no browser run)

Plan 059 order step 2 ([plan](/docs/plans/059_lod_surface_core.md), "Steps 2 and 3 in detail"). Built in `projects/demo-app/src/app/pages/lod-surface-lab/`; only headless specs and the demo build have run. The `lod-surface-baseline` suite is untouched (no case uses the new sources, so it stays v2); the terrain suite is the next chunk.

### What was built

| File | Role |
|---|---|
| `lod-height-bake.ts` | Pure bake: layout, texel positions, `bakeHeights(layout, sampler)`, min/max pyramid, `pyramidRange` |
| `lod-height-noise.ts` | Samplers: `noise` (value-noise fBm, 300 m peak) and a texel-aware copy of the static bumps (`bumps-baked`) |
| `lod-height-texture.ts` | `createTextureHeightSource`: `DataArrayTexture`, CPU twin (`latticeHeightF32`), TSL lattice height and slope nodes |
| `lod-height-bake.worker.ts`, `lod-height-bake-client.ts` | Worker (same `new Worker(new URL(...))` pattern as the other demo workers) and its promise client; inline fallback without `Worker` |
| `lod-height.ts` | New ids, optional `lattice` and `nodeRange` on `HeightSource` (`flat` and `bumps` unchanged) |
| `lod-selector.ts` | Optional `heightRanges` in the settings, used when a node is initialised |
| `lod-surface-mesh.ts` | Vertex stage reads a lattice source by `(face, lattice)`; gradient from lattice slopes |
| page, test adapter | Source picker (baked noise, bumps baked, 1025² / 2049²), HUD bake line, bake metrics, `heightSourceReady` |

### Design choices

- **Texture layout.** One `r32float` array texture, one layer per cube face (one for the plane), (2^k + 1)² texels, nearest filter, no mipmaps. k = 10 (1025², 25.2 MB for six faces) by default; k = 11 (2049², 100.7 MB) is a button. An atlas would pass 8192 px high at k = 11 (6 x 2049), so a layer array it is. Texel i is lattice coordinate i · 2^(24 − k), an integer, so a texel centre is a lattice point.
- **How the vertex stage gets face and (u, v).** It already has both: the leaf attribute carries the face, and the vertex's lattice point `leaf.xy + g · step` is exact in float32. A source that defines `lattice` is called with `(face, lattice)` instead of the base position. The lattice used is the vertex's own, without the injected-gap shift (as before, the gap moves only the position), and for a folded vertex it is the folded grid point, a coarser lattice point. The lookup is a function of `(face, U, V)` only, so folded and same-level neighbours on one face agree by construction.
- **Canonical edges.** A texel's sampler position comes from its cube-lattice integer vector T (`cubeLattice`, then `cubeComponent`, as the vertex stage does), not from `(face, u, v)`. T is the same integer vector for every face that has the point, so a texel on an edge or corner gets a bit-identical position and therefore value from each face. The spec groups all boundary texels by exact position: 12 · (2^k − 1) pairs and 8 triples, all equal.
- **Bilinear in float32 by hand.** `gx = U / 2^(24−k)` is exact (power of two); cell = min(floor(gx), 2^k − 1); fraction = gx − cell, exact. Weights are exact dyadic fractions. Blend: `lerp(p, q, w)` returns p at 0 and q at 1; otherwise `lo + (hi − lo) · t` with lo/hi the smaller/larger of p, q and t = w or 1 − w toward hi. That makes `lerp(p, q, w)` and `lerp(q, p, 1 − w)` the same bits, so a vertex on a cube edge gets the same height from both faces even though the edge runs in opposite directions in them, and cannot depend on whether the GPU fuses multiply-add (same code, same inputs). The CPU twin rounds every step with `Math.fround`. Hardware filtering is not used.
- **Normals.** Analytic slope of the bilinear patch per lattice step (hU, hV), turned into a surface gradient with the tangents of one lattice step (plane: the face axes; sphere: from the cube point and the warp's slope) and the metric (E, F, G). Not seam-critical.
- **Pyramid.** Level 0 is the min and max of each texel cell's four corner texels (a bilinear patch cannot leave them); coarser levels reduce 2 x 2. A node at level ≤ k maps to exactly one pyramid cell; a node below the texel size uses the containing cell. Ranges are padded outward by 1e-6 relative plus 1e-6 m so a float32 lerp that overshoots by an ulp stays inside.
- **Selector.** `SelectorSettings.heightRanges` (optional; `heightBoundM` stays the fallback for analytic sources). In `initNode` (not the per-frame loop, nodes persist) the bounding sphere is centred at the middle of the node's range along the node's normal, with radius = corner radius · (1 + |mid| / R) + half the range. The `1 + |mid| / R` term bounds the tilt between normals across a node on a sphere. With a stub range of ±bound the selection equals the plain reference selector's exactly. The hot loop is unchanged and allocation-free.
- **Worker.** `bakeHeights` is a pure function; the worker only maps a source id to its sampler (functions do not cross `postMessage`), bakes, and transfers the texel and pyramid buffers. The page caches two bakes (CPU arrays and GPU textures) so switching back does not bake again; while a bake runs the previous surface stays drawn and `heightSourceReady()` is false so the test adapter does not settle on a stale surface.
- **Recorded.** Bake ms per face (worker), pyramid ms, main-thread round trip, `initTexture` ms (CPU side of the upload only), texture MB. Shown in the HUD and, for baked sources, as optional metrics (`bakeMsPerFace`, `bakeMs`, `uploadMs`, `textureMB`) in the test adapter.
- **Sampler interface.** `(x, y, z) => metres` on the base-surface position (domain frame). `createPlanetSurfaceSampler` from `triangular-engine/worldgen` can be adapted to it in the next chunk; the worker will need to build it from a plain description since it cannot receive functions.

### Specs

92 headless specs pass (62 before; +30): 22 in the new `lod-height-texture.spec.ts` (layout and determinism, bilinear against a double reference and exact texel hits, symmetry of the blend, slope against finite differences, canonical edges for both warps, shared-edge vertex heights for same-level neighbours across cube faces and for 2:1 folded edges on the plane and the 10 km sphere, pyramid against brute force, node range containing every vertex of its leaf grid at levels on both sides of the texel size, the vertex graph building for a texture source) and 8 appended to `lod-surface-lab.spec.ts` (valid 2:1 tree with ranges on three domains, equality with the plain reference when every range is the global bound, bounding sphere containing displaced vertices, tighter radii). `npx ng build demo-app` passes.

### Not measured

- Bake ms per face, round trip and upload ms on the RTX 3080 (headless runs say nothing about them); 2049² cost.
- No browser run: the TSL graph builds (a spec constructs it) but has not been compiled to WGSL on a GPU. Not yet seen: whether Tint accepts `textureLoad` on the array layer with the int node, the crack probe on a baked source, and the visual result.
- CPU twin against GPU heights (L9) is proved CPU-side only (twin against a double reference); a read-back comparison belongs to the terrain suite's probe points.
- GPU fused multiply-add: the symmetric blend is designed not to depend on it, but only the crack probe on the RTX and the AMD iGPU can confirm face-edge bit equality.
- `noise` amplitude (300 m on the 600 km and 10 km spheres, 300 m on the plane) is a first guess; texel size caps detail (about 1.2 km on the 600 km sphere at 1025²).

## 2026-10-25 — Chunk B review and a first browser look (AMD iGPU, not timing)

Reviewed the chunk B code (texture source, bake, pyramid, selector ranges, mesh gradient) and reran the lab specs: 92
pass headless. Then a functional look in the in-app browser, which ran on the **AMD iGPU** (`amd / gcn-5`, 1512×1152),
so the numbers below are not RTX evidence and the bake times are CPU times on that laptop.

- **WGSL compiles and draws.** Baked noise renders with relief on the 10 km sphere (lumpy silhouette and shading at
  orbit); no console errors. `textureLoad` on the array layer is accepted.
- **Crack probe on baked noise: 0 px** on the 10 km sphere at orbit (all six faces and their edges in view) and at
  2 m eye (1023 leaves, cap hit), and on the 600 km sphere at 5 km. The injected-gap control on the same source finds
  14,983 px. This is first evidence that the symmetric blend keeps cube-edge seams bit-identical on a real GPU; the
  RTX run is still owed.
- **Review notes, no defects found:** the node bounding sphere (radius · (1 + |mid|/R) + half range, centred at mid
  along the normal) is a correct bound, since |n_p − n_c| = |p − c| / R; the sphere tangents use the right warp slopes
  (equal-angle da/dU = (1 + a²) π / 2L, none 2/L); the pyramid's 4-corner cell range bounds a bilinear patch.
- **Bake is slow:** about 800 ms per face at 1025² (4.9 s round trip for six faces); at 2049² expect about 20 s. The
  value noise allocates two closures per call and runs up to 10 octaves per texel. Fine for a lab, not for edits or the
  cell planet: optimise (inline the corner hashes, no closures) before chunk C measures bake time.
- **Upload ms** (2.2–2.7 ms) is the CPU side of `initTexture` only, as recorded above.

## 2026-10-25 — Bake speed-up and chunk C: terrain suite (specs only, no browser run)

Two jobs: make the bake fast enough to measure, then build the terrain suite. Everything below is checked by headless
specs (117 pass) and `ng build demo-app`. **No browser suite was run**, so nothing here is hardware evidence.

**Bake speed-up.** Value noise no longer allocates per call: the corner hashes and the blend are inline, the hash is
`Math.imul`, and octave constants are precomputed. `texelPoint` reuses a per-`k` component table, and `buildPyramid`
uses plain min/max. Values are bit-identical to the old closure form. The canonical cube-edge texel and f32 rules are
unchanged, so seams stay identical. A spec bakes one face and checks only time-independent properties.

Per face at k=10 (1025² texels), headless node, indicative only:

| Source | Before, ms | After, ms |
| --- | --- | --- |
| noise, sphere | 1350–1470 | 370–490 |
| noise, plane | about 1080 | 350–440 |
| cell planet | not built | about 920, plus a world build of about 195 |

**New sources.** Each is a `BakedSourceId`, rebuilt by id in the worker.

- `cell-planet`: the worldgen cell planet, built in the worker from a small serialisable description (seed 3, 1000
  cells). The world build is timed apart as `worldBuildMs`. Height comes from `sampler.sampleNear` with a cell hint, so
  there is no full cell scan per texel. Sphere only; `sourceSupports` hides it on the plane.
- `cliff`: a synthetic step fixture, for testing seams and ranges against a known edge.
- `noise`: unchanged design, now in the suite.

**Twin error.** `twinVsSamplerErrorM` compares the CPU twin of the baked texture with the source sampler at probe
points. The worker samples the probes, so the main thread needs no world. A GPU read-back (`gpuVsTwinErrorM`) was not
built: it cannot be checked headless.

**Suite `lod-surface-terrain` v1.** 36 cases: sources by the domains they suit, at the five poses, plus one injected-gap
control. Cases are ordered so each source and domain is one run, which the two-entry bake cache turns into one bake per
group. Each case waits for `heightSourceReady` (timeout now 60 s). Repetitions re-bake. Baseline v2 is untouched, and the
history has three entries.

**Not done.**
- No browser run, so no timings, no crack-probe result on the new sources, and no WGSL check of them.
- No GPU read-back metric.
- Height scales of the new sources are first guesses.

**For review.** The cell planet seed and cell count were chosen so the poses stand on land; check this on a real run.
Check that the cache comment in the page matches the ordering above.

## 2026-10-25 — Chunk C review and a first browser look (AMD iGPU, not timing)

Reviewed the bake speed-up and the terrain sources and suite, then reran the lab specs (117 pass) and `ng build
demo-app` (passes). No defects found.

- **Cell planet seams.** The hinted cell walk (`findCellNear`) is a greedy walk over the cell neighbours, which ends at
  the nearest cell whatever the hint, so a texel shared by two faces gets one value. It could differ only on an exact
  tie between two cell centres. The spec "bakes seam-identical faces with the cell planet sampler" covers this.
- **Several suites in one history.** The testing entry allows this (append suites or versions, oldest first). "Run
  latest test" now starts `lod-surface-terrain` v1. The baseline is run by its exact version link.
- **Bake metrics per case.** Cases that reuse a cached bake report the same bake figures as the first case of their
  group. Read bake numbers from one case per group.

First look in the browser pane on the AMD iGPU, functional only:

- **Draws.** The cell planet and the cliff compile, bake, upload and draw with no console errors. The cliff shows as a
  stretched 200 m wall ahead of the 2 m eye, as intended.
- **Bake, 10 km sphere, 1025² x 6.** Cell planet: world build 131 ms, then 803–1005 ms per face, 5.8 s round trip.
  Cliff: 185–253 ms per face, 1.5 s round trip.
- **Twin vs source.** Cell planet: max 0.11 m, p95 0.04 m. Cliff: 0.00 m at the probes (the 20 m ramp is about one texel
  here and the probes missed it).
- **Crack probe: no valid result.** The pane's page stopped drawing frames: the HUD and repeated probes did not change.
  The unchanged static-bumps source, 0 px on the RTX, also read 837,089 px. So the high counts (515k to 837k px) are
  stale frames, not cracks. Recheck on the RTX run.

**Open:** the RTX run of `lod-surface-terrain` v1 (timings, crack probe, poses on land); a GPU read-back of heights.

## 2026-10-25 — Terrain suite v1 on the RTX 3080

The owner ran `lod-surface-terrain` v1 on the RTX 3080 Laptop: NVIDIA WebGPU adapter, visible browser, standard
mode, one repetition, 36 valid cases in 200 s. The run logged `WARN other-app-measuring, gpu-throttled` at medium
load, so the timings are indicative, not a clean measurement. Visual review is still pending.

| | result |
|---|---|
| crack px, 35 ordinary cases | 0 |
| `control-injected-gap` | 27,838 px (probe works) |
| GPU scene pass p95 | 0.04–0.27 ms |
| frame interval median | 6.0–6.1 ms (display-paced) |
| selection CPU p95 | 0.0–0.1 ms (still poses, memo; not a selection measurement) |

Bake, one case per group (worker on the laptop CPU):

| source, domain | per face median / p95 | total | upload | texture |
|---|---|---|---|---|
| cell planet, 10 km sphere | 543 / 646 ms | 3.5 s | 10.8 ms | 25.2 MB |
| cell planet, 600 km sphere | 565 / 641 ms | 3.6 s | 2.3 ms | 25.2 MB |
| noise, 100 km plane | 254 ms | 0.30 s | 0.5 ms | 4.2 MB |
| noise, 600 km sphere | 306 / 342 ms | 2.0 s | 2.5 ms | 25.2 MB |
| noise, 10 km sphere | 304 / 337 ms | 2.0 s | 2.2 ms | 25.2 MB |
| cliff, 100 km plane | 63 ms | 0.08 s | 0.7 ms | 4.2 MB |
| cliff, 10 km sphere | 112 / 136 ms | 0.77 s | 2.9 ms | 25.2 MB |

The cell-planet world build took 96 ms.

CPU twin vs sampler at the 64 probes (max / p95):
- cell planet 10 km: 0.11 / 0.04 m;
- cell planet 600 km: 0.86 / 0.31 m, against a ±1200 m height range;
- noise: 0.09–0.12 / 0.07–0.09 m;
- cliff: 0.00 m, because the probes miss the ramp.

### Findings

- **Seams hold on real terrain.** There are 0 crack px on every source, domain and pose, including the cliff and the
  cell planet. The bit-identical seam rule carries over to baked textures.
- **Drawing is cheap.** The GPU cost is the same as on the baseline suite. Height texture fetches add nothing visible
  at this scale.
- **The bake is the cost.** A cell-planet sphere takes about 3.5 s, mostly in the cell lookup. Noise takes about 2 s.
  This is fine for a lab, but too slow for edits (M5) or a page load. The likely next step is to bake faces in
  parallel workers, or to bake coarse first and refine.
- **The 600 km cell-planet twin error is larger.** Its 0.86 m max is 0.07% of its height range. That is an
  interpolation error between texels on steep cell borders, not a seam error, and it should drop at a finer texel.

**Open:** a visual review of the shaded cases, including whether the cell-planet poses stand on land; a clean rerun
without other apps measuring; the jitter look; a GPU read-back of heights. (The AMD run was dropped; see below.)

## 2026-10-25 — Terrain suite v1, case by case in quick mode (RTX 3080)

The owner then ran the 36 cases one at a time in quick mode, visible browser, about 4–8 s each, likely while looking
at each pose. Every run logged `WARN other-app-measuring`, and laptop CPU load rose from about 20% to 50–73% during
the batch.

- **28 cases settled and 8 hit the 4 s cap**: `cell-planet-sphere-10km-orbit`, `noise-sphere-600km-horizon`,
  `noise-sphere-10km-horizon`, `noise-sphere-10km-orbit`, `control-injected-gap`, `cliff-plane-100km-low-200m`,
  `cliff-sphere-10km-mid-5km` and `cliff-sphere-10km-horizon`. All 36 settled in the standard run.
- **The caps come from frame hitches, not the surface.** Every capped case has a frame interval max of 12–58 ms and a
  p95 of 6.6–8.3 ms, against a 6.7–7.8 ms max on the settled cases. A few hitches in a 4 s window keep the two halves
  from agreeing on p95 within 10%. On those cases the GPU scene pass stays at 0.06–0.22 ms and selection p95 at
  0.1 ms. The hitches fall on the busiest stretch of CPU load, which suggests the browser or another app, not the lab.
- **The checks match the standard run.** There are 0 crack px in all 35 ordinary cases, and the control again finds
  27,838 px.
- **The bake is 2–30% slower under the extra load**: cell planet 587 / 695 ms per face (3.8 s), noise 600 km sphere
  312 ms (2.0 s), noise 10 km sphere 383 ms (2.4 s), noise plane 271 ms, cliff plane 76 ms and cliff 10 km sphere
  146 ms (1.0 s). The twin errors are unchanged.

Nothing here changes the findings above. A capped quick case is inconclusive on timing, not a failure; rerun it, or use
standard mode, with the laptop otherwise idle.

## 2026-10-25 — Owner notes: AMD run dropped; hysteresis missing

- **The AMD iGPU run is dropped** (owner). The M1 close no longer waits on it. The agent's browser looks on the iGPU
  for chunks B and C count as functional evidence only (it draws, 0 crack px, the control finds cracks), not timing.
- **The owner saw blocks switch back and forth between levels while rotating the camera by hand.** This is expected
  in M1: the selector rebuilds the tree every frame with a single split threshold and no hysteresis (the suite labels
  this as a limitation). A node right at the threshold splits and merges as its distance wobbles. Hysteresis is in
  the selector design (§Architecture, and the selector specs) but no step of the D15 order schedules it. The automated
  cases do not catch it, because their poses are still and the one scripted zoom moves one way.

## 2026-10-25 — Split/merge hysteresis and the sweep camera (specs only, no browser run)

Built by a Sonnet 5.5 agent and reviewed. All the code is in `projects/demo-app/src/app/pages/lod-surface-lab/`.

- **The rule (`lod-selector.ts`, setting `hysteresis`, lab default 0.15, distance mode only).** A leaf splits when
  `edge / target > 1`, as before. A node that was split in the last tree stays split while `edge / target > 1 / (1 +
  h)`. Hysteresis 0 gives exactly the old trees; a spec compares them with the reference selector.
  - A kept node is queued with its own value, at most 1. It therefore sorts after every real request.
  - When the leaf cap or the node pool stops splitting, a kept node is dropped quietly. It counts as neither
    `capHit` nor `unmet`.
  - Balance splits are never kept.
- **History.** `wasOpen` and `wasVisible` are copied from the last tree while its flags are cleared. They count only
  when `stamp === frame - 1`, so a node outside the last tree (merged away, or freed and remade) reads 0. A repeated
  view returns early, keeping the history and reporting no changes. No spec forces an actual reclaim, so that path
  rests on the stamp check.
- **Counting changes.**
  - `newSplits` and `merges` are the raw counts.
  - `visibleNewSplits` and `visibleMerges` count only nodes visible in both frames.
  - The raw count was useless with culling on. On a plane sweep it was 5,760 against 5,724, almost all nodes crossing
    the frustum edge, where a level change is invisible.
  - The HUD shows both counts.
- **Sweep camera (`sweepPathView` in `lod-camera.ts`).** The camera holds a pose and swings its heading by ±30° and
  its altitude by ±2% on a 2 s period. Turning alone only changes culling, so the altitude swing is what crosses the
  distance thresholds. The adapter drives it by wall-clock time and runs the crack probe at the end, back on the pose.
- **Metrics.** `levelChanges` is the on-screen count per frame, as a series. `levelChangesPerSecond` is its rate,
  and `levelChangesAll` is the raw rate.
- **Suites.** Old versions keep their meaning and are pinned to hysteresis 0.
  - `lod-surface-baseline` v3 turns hysteresis on in every case. It adds `sweep-sphere-600km-eye-2m` (a control: the
    tree is at its deepest level there, so nothing crosses a threshold), `sweep-plane-100km-low-200m` and
    `sweep-sphere-600km-mid-5km`, each of the last two with a `-nohyst` A/B partner.
  - `lod-surface-terrain` v2 turns hysteresis on and adds `sweep-cell-planet-sphere-10km-low-200m` and
    `sweep-cliff-plane-100km-low-200m`.
- **Headless calibration** (culling on, 60 fps, on-screen changes in the first period / the next three):

| sweep | h = 0 | h = 0.15 |
|---|---|---|
| plane low-200m | 20 / 60 | 8 / 12 |
| sphere 600 km eye-2m | 0 / 0 | 0 / 0 |
| sphere 600 km low-200m | 10 / 30 | 2 / 0 |
| sphere 600 km mid-5km | 12 / 36 | 1 / 0 |

- **Specs.** 138 lab specs pass, up from 117. The demo-app build succeeds. The full demo-app run has 3 failures
  outside this lab: the test-history specs for two other pages (morph streaming and planet material) and a timing
  flake in the atmosphere-lab adapter.

**Open.**
- The RTX run of baseline v3 and terrain v2: the A/B rates, and an owner check by hand that rotating no longer flips
  blocks.
- The residual 12 changes on the plane at h = 0.15. That pose fills the 1,024-leaf cap, so which requests get served
  shifts with the view, and kept nodes are dropped first. A larger cap, or ranking kept nodes above new requests, would
  test this.

## 2026-10-25 — Sweep cases on the RTX 3080: hysteresis has no effect at the 1,024-leaf cap

The owner ran the seven sweep cases as one batch from a `testCases` launch link (standard mode, `visible-browser`,
one repetition each; added to `triangular-engine/testing` this session). All seven pass the automation checks, with
0 crack px.

| case | leaves | on-screen changes/s | all changes/s |
|---|---|---|---|
| baseline v3 `sweep-sphere-600km-eye-2m` (control) | 1,023 | 0 | 0 |
| baseline v3 `sweep-plane-100km-low-200m` | 1,024 | 111.5 | 380.5 |
| baseline v3 `sweep-plane-100km-low-200m-nohyst` | 1,024 | 107.5 | 375.2 |
| baseline v3 `sweep-sphere-600km-mid-5km` | 1,023 | 104.1 | 364.1 |
| baseline v3 `sweep-sphere-600km-mid-5km-nohyst` | 1,023 | 107.2 | 366.2 |
| terrain v2 `sweep-cell-planet-sphere-10km-low-200m` | 1,023 | 104.7 | 349.3 |
| terrain v2 `sweep-cliff-plane-100km-low-200m` | 1,024 | 149.4 | 256.6 |

### Findings

- **Hysteresis on and off give the same rate**, about 105–110 on-screen changes a second. It removes nothing in
  the browser.
- **Every sweep case except the control sits at the leaf cap.** The suites use `leafCap: 1024`, but the headless
  calibration spec ran with `leafCap: 20_000` (`lod-selector-hysteresis.spec.ts`), so it never met the cap. At the cap,
  which nodes get split depends on how requests rank, and that ranking shifts every frame as the camera turns. Kept
  nodes rank after every real request and are the first dropped, so the budget decides the tree and hysteresis never
  takes part. This is likely what the owner sees when rotating by hand at the default cap.
- **Correction to the previous entry.** The plane residual (8 / 12) was blamed on the cap, but that calibration ran at
  20,000 leaves and never reached it, so its cause is still unknown.
- The page parameter `hysteresis` does reach the selector (`lod-surface-lab-page.component.ts`), so this is not a
  wiring fault.

### Next

- Make the budget itself hysteretic. Options to compare in a spec at `leafCap: 1024`: rank a kept node with a bonus
  over new requests, so a new split must beat it by a margin; or let a split in the last tree hold its place until a
  request beats it by `1 + h`. Then rerun the seven cases.
- Calibrate at the suite's own cap, not 20,000.
- Investigate the plane residual separately.

## 2026-10-25 — A hysteretic leaf budget (specs only, no browser run)

**Rule.** A node split in the last tree now competes for the leaf budget with its value times `1 + h`; every other
node competes with its plain value. A new request takes a kept split's place in the budget only by beating it by the
margin. Same `hysteresis` setting, no new one; with h = 0 the tree is identical to before (a spec checks absent and 0).

**Design choices.**

- The heap key is boosted; `priority` still holds the raw value, and "a real request" is still `value > 1`, never the
  key. `unmet` and `capHit` count real requests only.
- A retention (kept, value in `(1/(1+h), 1]`) competes with its boosted key, so a kept node at 0.95 (key 1.09) beats a
  new request at 1.05. It is the consistent rule; the 2:1 balance, cover, mask and cap checks still pass at caps 200 and
  4,096. A retention that does not fit is still dropped silently.
- A boosted retention can now reach the cap while real requests are still queued behind it, so `capHit` is also set
  when `unmet > 0`.
- The loop still stops at the first node that does not fit; balance splits are unchanged.
- Suites bumped because the measurement changed: `lod-surface-baseline` v4 and `lod-surface-terrain` v3, the same cases
  as v3 and v2. The older versions stay addressable, but they now run the new selector.

**Headless calibration at the suites' 1,024 cap** (`lod-selector-hysteresis.spec.ts`, on-screen split + merge in the
three later periods of four, 60 fps; every case sits at the cap on all 480 frames):

| Sweep | h = 0 (and the old h = 0.15) | h = 0.15 now |
| --- | ---: | ---: |
| plane low-200m, unculled | 48 | 0 |
| sphere low-200m, unculled | 12 | 0 |
| sphere mid-5km, unculled | 12 | 0 |
| plane low-200m, culled | 696 | 531 |
| sphere low-200m, culled | 756 | 558 |
| sphere mid-5km, culled | 630 | 456 |
| sphere eye-2m | 0 | 0 |

Setting the boost to 1 made h = 0.15 match h = 0 exactly, which confirms the browser finding: the old hysteresis did
nothing at this cap. The 20,000-leaf calibration is unchanged (the cap never binds there).

**Open.** The suites cull (`cull: true`), and culled churn falls only 24–28%. The likely reason is that the heading sweep
brings nodes into the frustum, and they outrank kept splits by more than the margin, which is real change, not flicker.
An "at the leaf cap" spec shows the margin holds for 5–30 m camera moves and gives way at 60 m, where every new request
that took budget beat every lost kept split by the margin (3.612 against 3.544). The RTX rerun of the seven sweep cases
(baseline v4, terrain v3) is next. 142 lab specs pass headless.

## 2026-10-26 — Sweep cases on the RTX 3080 with the hysteretic budget

The seven sweep cases, standard mode, one batch run by the owner (baseline v4, terrain v3, fingerprint
`8e65d264-18bfd933`). The machine line warns `gpu-busy-before-start` and `other-app-measuring` (one case also
`gpu-throttled`). Those affect the timings, not the level-change counts, which come from the selector.

| Case | On-screen changes/s, v3 / terrain v2 | Now | All changes/s now |
| --- | ---: | ---: | ---: |
| sphere-600km eye-2m (control) | 0 | 0 | 0 |
| plane-100km low-200m | 111.5 | 82.6 | 332 |
| plane-100km low-200m, no hysteresis | 107.5 | 110.4 | 379 |
| sphere-600km mid-5km | 104.1 | 85.8 | 330 |
| sphere-600km mid-5km, no hysteresis | 107.2 | 109.0 | 368 |
| cell-planet sphere-10km low-200m | 104.7 | 84.1 | 314 |
| cliff plane-100km low-200m | 149.4 | 101.6 | 191 |

All cases: 0 crack px, automation pass, GPU scene pass p95 at most 0.22 ms.

### Findings

- **Budget hysteresis works in the browser.** Against its own no-hysteresis partner, the plane falls 25% (110.4 to
  82.6) and the sphere 21% (109.0 to 85.8). Against the v2 numbers, the cell planet falls 20% and the cliff 32%. The
  headless calibration predicted 24–28% for culled sweeps.
- An earlier unattended run of the plane case the same evening gave 79.4, so the number repeats.
- **About 80 changes a second remain.** The headless specs point at the heading sweep bringing nodes into the frustum,
  where they outrank kept splits by more than 15%. That may be real change rather than flicker. Not yet shown either way.
- **The unattended launcher failed for this rerun.** Five of seven runs saved nothing. The test Chrome most likely opened
  behind other windows and stopped drawing. Each run then hit the 30-minute limit, and the launcher reported it as
  "Chrome closed" because it closes Chrome before printing the message. Not fixed yet; the owner ran the batch by hand.

### Next

- Tell flicker from real change: count only changes of nodes that were on screen in both frames and whose value
  stayed within the margin, or run the sweep without culling in the browser.
- Fix the launcher: keep a covered window drawing, and report a timeout as a timeout.

## 2026-10-26 — Noise matrix: headless runs while the owner uses the laptop

The owner wants to iterate on noisy runs while they work, and keep idle runs for the end of a day or phase. The
launcher gained a headless mode on the real GPU (`--profile headless-hardware`, same 2560×1308 device pixels as the
headed runs) and a `--noisy` flag (no quiet-GPU wait; every run records machine load in `<result>.load.json`); see the
[testing guide](/projects/triangular-engine/testing/README.md#unattended-runs-dev-only). This section measures what
load changes. Case `sweep-plane-100km-low-200m`, baseline v4, standard mode, RTX 3080, fingerprint
`0efa22a9-582eb6ed`. Three runs per headless condition; the headed column is the single 2026-10-26 run above.

| Metric | Headed, idle | Headless, game running | Headless, game client only | Headless, clean |
| --- | ---: | ---: | ---: | ---: |
| GPU scene pass med / p95 (ms) | 0.20 / 0.21 | 0.20 / 0.20–0.21 | 0.20 / 0.20 | 0.20–0.23 / 0.20–0.25 |
| Frame interval med / p95 (ms) | 6.1 / 6.6 | 12.5 / 13.4–14.0 | 6.1 / 6.4–6.6 | 6.1 / 6.4 |
| Selection CPU p95 (ms) | 0.2 | 0.3 | 0.3 | 0.2 |
| On-screen changes/s | 82.6 | 75.2–76.9 | 73.8–78.2 | 73.3–75.1 |
| All changes/s | 332 | 312–313 | 310–315 | 310–313 |
| Drawn leaves | 752 | 769–770 | 768–771 | 769–770 |
| Machine CPU median | n/a | 33–40% | 40–44% | 21–23% |

"Game running" is a League of Legends match; "client only" is its launcher left open; editors and agents ran in all
three headless conditions. Every run: automation pass, 0 crack px, NVIDIA adapter. Headless runs are inconclusive by
the validity rule, as expected. The machine GPU figure (about 40–50% in every headless row) includes the test itself,
so it does not measure background load.

### Findings

- **Load does not move the selector's counts.** Changes per second, all changes and drawn leaves match between noisy
  and clean headless runs, with or without a game.
- **Headless differs from headed by itself:** about 10% fewer on-screen changes and 2% more drawn leaves, under every
  load. Most likely the effective viewport or framing differs slightly. Compare counts only within one mode.
- **A running game doubles the frame interval** (6.1 to 12.5 ms). Without a game, headless pacing matches headed.
- **Selection CPU p95 rises by one 0.1 ms timer step under load.** A weak contention signal, below the timer's
  resolution for a sharper reading.
- **GPU pass timings hold under every condition.**

### What can be read under load

| Condition | Safe to judge | Needs a clean or headed run |
| --- | --- | --- |
| Editors, agents, a game client | Everything within headless, including headless baselines | Comparison with headed runs |
| A game running | Pass/fail, crack px, GPU pass timings, change counts, same-run A/B | Frame interval; selection CPU at the 0.1 ms level |
| Idle, end of day or phase | Headed runs: frame time against headed baselines, final check | — |

Idle runs are not needed after each change. One case and one GPU so far; heavier cases (CPU-bound bakes, worker
pipelines) may react to load differently.

### Next

- Find why headless shows fewer changes than headed (compare the recorded canvas size and camera framing).
- Repeat the matrix on a CPU-heavy case before trusting CPU timings from noisy runs.

## 2026-10-26 — Owner notes: no jitter seen; a biome source; a triangle budget

- **No jitter seen.** The owner tested by hand and zoomed as close as the lab allows: no jitter anywhere. Recorded as
  an owner observation. The measured gate (at most 0.05 px at eye-2m in motion, from S1) has no number yet; the owner's
  look is enough to stop it blocking terrain work.
- **A mixed-biome source.** The owner wants to see different kinds of terrain together, like concept art of meadows,
  hills, sharp chiselled mountains, a volcano and canyons, and to know they run fast. It is a new source in the terrain
  suite, which is how terrains are meant to be added, and a better test bed for the slope criterion than the current
  sources. Planned as step 3b of the plan. True overhangs stay in M6; snow, grass, trees and rocks belong to the surface
  material ([Plan 050](/docs/plans/050_tsl_planet_surface_material.md)) and scatter work, not to this core.
- **Triangles per pixel.** The latest headless sweep run (`sweep-plane-100km-low-200m`, baseline v4) draws 1,574,913
  triangles in 2 draw calls (769 leaves × 32² cells × 2) on a 2560×1308 canvas: about 2 device pixels per triangle,
  which is what the pixel floor of about 2 px per cell asks for. The scene pass costs 0.2 ms only because the lab
  shading is trivial. GPUs shade in 2×2 pixel blocks, so a real material pays several times over for triangles this
  small. Common practice aims at about 8–16 pixels per triangle or more. Raising the floor or using fewer cells per
  patch is the cheap fix, measured ABAB in step 3b.
- **Budget per system, not just frame time.** Frame time on the RTX 3080 hides how much room is left for the material,
  scatter, sky, clouds and the game. Step 3b records counts that do not depend on the machine (triangles, pixels per
  triangle, draw calls, texture MB) next to the timings, against a proposed terrain budget.
- **The AMD iGPU as an early warning (proposal).** Dropped 2026-10-25 as a gate. The owner would take it back as long
  as it does not block them. A headless run on the iGPU takes no screen, so it can run while the owner works. It needs
  a second Chrome install (for example Chrome for Testing), set to power saving in Windows graphics settings and passed
  with `--chrome <path>`. The graphics preference is per executable, so the main Chrome stays on the RTX. Not tried yet:
  the first run checks that headless WebGPU picks that adapter.
- **A cost-breakdown view (idea).** The owner asked for a view of each test's cost by area (draw calls, memory, GPU and
  CPU time), and a combined view for terrain plus material, clouds and sky. Not part of this plan; it needs its own record.
