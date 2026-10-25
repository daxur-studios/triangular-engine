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
