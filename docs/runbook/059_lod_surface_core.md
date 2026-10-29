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

## 2026-10-26 — Biome mix, terrain v4 (headless, noisy)

Built `biome-mix` for the plane and 10 km sphere, through the worker and the existing texture and min/max pyramid. A strip places meadow, hills, ridged mountains, a cratered cone and a winding canyon side by side; a traversal moves across the strip on each domain. Terrain v4 adds the five baseline poses, a mountain and canyon pose, the traversal on each domain, and four alternating 2/4 px mountain cases. Earlier suite definitions remain. The pixel metric is canvas device pixels divided by drawn surface triangles, an upper bound; draw calls are also a metric.

The selector's `cellPixels` floor clamps the target **projected cell-edge length**, not triangle area: `max(cellPixels, 2) * pixelAngle` enters the distance criterion. The ABAB cases compare target values 2 and 4 at the same view, not two different global constants. All four hit the 1,024-leaf cap, drew exactly the same 1,626,112 triangles and gave 1.659 canvas pixels per triangle. The experiment cannot isolate the floor under that cap; repeat at a view or cap where both settings are not budget-limited.

The prescribed headless hardware, standard, noisy launches ran one per case on NVIDIA WebGPU. All 20 automated checks passed; all performance verdicts are inconclusive because headless hardware/power was not independently verified. Some cases warned GPU throttling; do not treat noisy timings as a clean hardware baseline. These numbers are from fingerprint `0efa22a9-910c6ac7` before subsequent spec and case-registry-only changes. Drawn counts and pixels per triangle are the last measured frame; traversal GPU and CPU timings cover its full window. The crack probe runs after motion returns to the named pose, so traversal crack counts do not check the whole path.

| Case | Crack px | Triangles | Draws | Canvas px / triangle upper bound | Texture MB | GPU scene med / p95 ms | Selection CPU p95 ms | Bake ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| floor-2-1 | 0 | 1626112 | 2 | 1.659 | 4.203 | 0.242 / 0.245 | 0.1 | 493.2 |
| plane-100km-eye-2m | 0 | 1519616 | 2 | 1.775 | 4.203 | 0.158 / 0.165 | 0.1 | 379 |
| plane-100km-low-200m | 0 | 1533952 | 2 | 1.759 | 4.203 | 0.213 / 0.217 | 0.1 | 393.4 |
| plane-100km-mid-5km | 0 | 1370112 | 2 | 1.969 | 4.203 | 0.204 / 0.207 | 0.1 | 373.4 |
| plane-100km-horizon | 0 | 1474560 | 2 | 1.83 | 4.203 | 0.197 / 0.2 | 0.1 | 424 |
| plane-100km-orbit | 0 | 131072 | 2 | 20.583 | 4.203 | 0.033 / 0.034 | 0.1 | 385.3 |
| plane-100km-biome-mountain | 0 | 1626112 | 2 | 1.659 | 4.203 | 0.241 / 0.244 | 0.1 | 465.2 |
| plane-100km-biome-canyon | 0 | 991232 | 2 | 2.722 | 4.203 | 0.172 / 0.181 | 0.1 | 386.1 |
| plane-100km-traverse | 0 | 894976 | 2 | 3.014 | 4.203 | 0.233 / 0.251 | 0.5 | 428 |
| sphere-10km-eye-2m | 0 | 1423360 | 2 | 1.895 | 25.215 | 0.18 / 0.187 | 0.1 | 3700.1 |
| sphere-10km-low-200m | 0 | 1503232 | 2 | 1.795 | 25.215 | 0.187 / 0.195 | 0.1 | 3693.6 |
| sphere-10km-mid-5km | 0 | 315392 | 2 | 8.554 | 25.215 | 0.032 / 0.034 | 0.1 | 3596.5 |
| sphere-10km-horizon | 0 | 1472512 | 2 | 1.832 | 25.215 | 0.177 / 0.184 | 0.1 | 3748.1 |
| sphere-10km-orbit | 0 | 466944 | 2 | 5.778 | 25.215 | 0.066 / 0.068 | 0.1 | 3190.4 |
| sphere-10km-biome-mountain | 0 | 1638400 | 2 | 1.647 | 25.215 | 0.199 / 0.202 | 0.1 | 3123.2 |
| sphere-10km-biome-canyon | 0 | 1615872 | 2 | 1.67 | 25.215 | 0.219 / 0.225 | 0.1 | 3095.5 |
| sphere-10km-traverse | 0 | 1585152 | 2 | 1.702 | 25.215 | 0.219 / 0.236 | 0.5 | 3088.4 |
| floor-4-2 | 0 | 1626112 | 2 | 1.659 | 4.203 | 0.248 / 0.252 | 0.1 | 497.8 |
| floor-2-3 | 0 | 1626112 | 2 | 1.659 | 4.203 | 0.248 / 0.252 | 0.1 | 457.8 |
| floor-4-4 | 0 | 1626112 | 2 | 1.659 | 4.203 | 0.242 / 0.244 | 0.1 | 468.1 |

The floor thumbnails are visually alike: ridges show as narrow, jagged pale bands. The plane canyon thumbnail looks almost flat and does not clearly show the winding cut. Zero crack pixels do not establish that the crests and canyon look right or that no triangles are inverted. The 100 km plane's roughly 98 m texels may limit steep detail; this has not been visually separated from the camera and simple shading. Visual review, a better canyon view and an uncapped floor comparison remain open.

Verification: 142 lab specs before, 149 after, all green with the prescribed headless command; `npm run build:triangular-engine` passed. No GPU height readback or visual acceptance was performed.

## 2026-10-27 — Biome terrain follow-up: budget, lighting and traversal

Terrain v5 replaces the cap-masked 2/4 px floor cases with two plane-mountain ABAB comparisons. The lab already shaded height gradients with a sun; it now exposes a lighting toggle, defaults it on in biome cases, and uses a lower side light for the canyon view. The plane canyon camera looks down over the winding path. Traversals replay the route after the timing window and probe five positions (0, 0.25, 0.5, 0.75, 1), advancing between positions; this does not measure every point of the original timed traversal. Selection timing is split into selector/frustum and instance packing/anchor time.

Noisy headless NVIDIA WebGPU, standard mode, one launcher per case; all eight ABAB cases passed automated checks, with zero crack pixels. Performance is inconclusive because the headless hardware/power profile was not independently verified. Canvas device pixels per triangle is an upper bound. GPU scene times are median / p95 milliseconds.

| Comparison and round | triangles | canvas px / triangle upper bound | GPU scene ms med / p95 | crack px |
| --- | ---: | ---: | ---: | ---: |
| cap 1024 A1 | 1,626,112 | 1.659 | 0.253 / 0.265 | 0 |
| cap 512 B1 | 759,808 | 3.551 | 0.145 / 0.155 | 0 |
| cap 1024 A2 | 1,626,112 | 1.659 | 0.257 / 0.267 | 0 |
| cap 512 B2 | 759,808 | 3.551 | 0.142 / 0.151 | 0 |
| cells 32 A1 | 1,626,112 | 1.659 | 0.249 / 0.253 | 0 |
| cells 16 B1 | 406,528 | 6.636 | 0.104 / 0.112 | 0 |
| cells 32 A2 | 1,626,112 | 1.659 | 0.249 / 0.254 | 0 |
| cells 16 B2 | 406,528 | 6.636 | 0.106 / 0.115 | 0 |

The crests remain narrow and jagged in the 240 px thumbnails; these do not establish full-resolution quality. Plane traversal selection p95 was 0.3 ms, selector/frustum 0.3 and instance upload 0.1; sphere was 0.4, 0.3 and 0.1 ms, respectively. The 0.1 ms browser clock resolution limits attribution; selector work dominates, but no internal selector phase was profiled. Still views return early for the same view while movement rebuilds the tree. Each traversal had five zero-crack samples.

The initial revised canyon case was pale, and a later run timed out reading GPU timestamps while specs were running; it was rerun after the specs. The final overhead camera and lower side light passed the probe (0 px), but the winding cut remains too faint in the 240 px thumbnail; readable canyon appearance and visual acceptance remain open. The last successful canyon case drew 675,840 triangles. The earlier biome floor comparison remains in historical v4 only.

Verification: 149 specs before and 151 after, all green under the prescribed headless command; `npm run docs:records:check` passed.

## 2026-10-27 — Canyon rework: a cut, not a ramp (terrain v6)

Diagnosis. The v5 canyon was `amplitude * 0.23 * smooth(0.015, 0.037, distance)` with a 2,000 m amplitude on the 100 km plane: a 460 m step spread over walls about 2.2 km wide (about 12 degrees), a 3 km floor, and a camera looking straight down from 6 km at a nearly straight stretch (bends are about 26 km apart). Seen from above, with slopes that gentle, it was a faint grey diagonal. The texture (about 98 m per texel) was not the cause: the walls were 20 or more texels wide.

New shape (`lod-canyon.ts`, shared by the sampler and the pose). Depth is `0.45 * amplitude` (900 m on the plane, 270 m on the 10 km sphere, whose amplitude is 600 m). Floor half-width stays 0.015 strip units (3 km on the plane); the wall is `smooth(0.015, 0.019)`, 0.004 units: 400 m on the plane (about 4 texels, about 66 degrees), 72 m on the sphere. A broken terrace term, `wall * amplitude * 0.025 * (1 + noise(40u, 40v))`, rides the plateau (up to 100 m on the plane), so the rim is not a ruler line; the plateau tops out near 1,000 m, inside the bake's bound (the texture source takes its bound from the baked min/max). The sphere keeps the latitude and longitude fades, so it is continuous at the strip ends. Terrain v6 (a new suite version) records that the canyon cases now measure a different surface.

Pose. The plane pose now sits on the centreline at u = 0.37 (past the blend at 0.34), 1,500 m above the floor (600 m above the rim), heading along the centreline tangent at that point, pitched -30 degrees; the bend at u = 0.458 is ahead and the one at 0.327 behind. The sphere pose uses the same u and centreline, 500 m up, pitched -30 degrees, and now looks along the cut too. The canyon sun comes from the camera's right at low elevation so one wall is lit and the other shaded.

Result (headless-hardware, noisy, inconclusive by design, load line in the summary). Plane canyon: 1,507,328 triangles, 736 of 1,024 leaves drawn, 0 crack px, GPU scene p95 0.23 ms, selector p95 0.1 ms. Sphere canyon: 1,490,944 triangles, 0 crack px, GPU scene p95 0.21 ms. Automated checks passed on both. Thumbnails: `artifacts/test-runs/lod-surface-terrain@v6/2026-10-27T14-13-11-050Z_headless-hardware_42a9d2f1-f8ba5a90/biome-mix-plane-100km-biome-canyon-r1-0.webp` and the `...14-13-38-869Z...` sibling for the sphere. Both read as a canyon: a lit wall, a shaded wall, a floor, and the cut bending away. Counts rose against v5 (675,840 triangles) because the new walls are seen at an oblique angle; timings are not comparable with v5. Visual acceptance remains the owner's; the mountain crest review and the inverted-triangle check remain open. The 154 lab specs pass.

## 2026-10-27 — Cliff detail reopened, then parked (nothing built, no decision)

The owner froze the LOD near a canyon wall at 16 patch cells (accepted as the visual default; not yet made the
default in code) and zoomed out. Two problems were visible:

1. **A hotspot.** Where the camera had been close, the wall was split to great depth in every direction. A
   suspected cause, not confirmed: distance is measured to a bounding sphere that the height range inflates, so a
   camera near a tall wall is "inside" spheres whose surface is farther away, and those nodes split to the
   maximum level.
2. **One quad up the face.** Each wall strip is one cell wide along the wall (right) but one quad tall. The owner
   expected rows up the face, about one per cell of height, at any distance.

Options discussed:

- **Slope term in the split test** (the M2 slope criterion, effective cell = flat cell × sqrt(1 + slope²)). Dropped
  for this: quadtree splits are isotropic, so rows up the face also bring columns along it (about 100× the
  triangles for 10 rows), which spreads the hotspot along the wall.
- **One-direction splits.** Workable for walls aligned with the grid, not for walls at 45°.
- **A: move vertices, not add them** (bunch grid lines toward steep ground at 16 cells). Rows without more
  triangles; clean for aligned walls, partial at 45°. Still one height per ground point: no overhangs.
- **B: hybrid volume regions.** The height map stays the base; arches, overhangs, eroded towers (thin base, wide
  top) and tunnel mouths come from a 3D density function (as in the raymarch PoC), meshed once per region and level
  (marching cubes or dual contouring) instead of raymarched each frame; the height map cuts holes where a region
  takes over. Seen as the only option here that gives all three of the owner's wanted shapes; §Cliff detail option
  3 had set it aside over seams.
- **C: cap slope-driven depth.** Removes the overkill; no rows.

Owner notes: overhangs, thin-base towers and tunnels are nice to have, but they affect the architecture, so they
should be thought through early. Rows on a flat height-map face change nothing visible on their own, so texturing
(triplanar on steep ground) and normals from the height data matter more than rows for the current terrain.

Architecture points that keep B open: height-map cells that can be holes; one shared height/density function so
regions meet the height map without seams; a feature layer with its own bounds and LOD beside the quadtree;
materials and lighting independent of the triangle layout.

**Status: parked, no preferred solution.** D14 (vector displacement, M6) stands as written until this is decided;
the owner may run a multi-agent consensus review first. The hotspot and the 16-cell default were handled the same day (next entry).

## 2026-10-27 — 16 cells default; split distance to the node's box (baseline v5, terrain v7)

The owner asked for the over-splitting near cliffs to be removed rather than investigated. There was no
cliff-specific split code: the cause was the split distance itself. It was "distance to the centre minus the bounding
radius", and with per-node height ranges that radius adds half the range in every direction. On a wall several hundred
metres tall, a camera beside it was "inside" the spheres of nodes whose surface was far off, so they split to the
deepest level: the hotspot.

### Built

- `lod-selector.ts`: the distance criterion measures to each node's split box (a cylinder: ground radius across, the
  height range along the normal) via `boxGap`; `LodSelector.gap(node, camera)` exposes it. The bounding sphere is
  unchanged and still used for culling. No extra per-frame work beyond a dot product.
- `lod-surface-tests.ts`: `DEFAULT_SETTINGS.patchCells` is 16 (owner's visual check). Earlier versions keep 32 cells
  through `CELLS_32`. New `lod-surface-baseline` v5 and `lod-surface-terrain` v7 run the same case ids at 16 cells with
  the box distance; their numbers are not comparable with v4 / v6.
- Specs: `lod-selector-gap.spec.ts` (a camera inside a 1 km range gets the flat-ground tree; above the range it splits
  like the same height over flat ground; the sphere distance would have split more). The plain reference selector in
  `lod-surface-lab.spec.ts` uses the box distance; the hysteresis "below the margin" moves stop at 20 m (30 m now
  re-ranks a few nodes past 15%); version specs cover v5 and v7.

### Verified

158 of 158 lab specs pass (`ChromeHeadless --watch=false`). No browser run yet; v5 and v7 have no saved results.

### Not done / next

- The owner's visual check of a cliff close up at 16 cells with the box distance.
- Height-map resolution is the main visual limit close up: k = 10 gives 1,025 texels per face, about 98 m per texel on
  the 100 km plane (about 920 m on the 600 km sphere, 15 m on the 10 km sphere). The bilinear blend between texels
  makes flat facets that large however many vertices draw them, and normals come from the same texels. Options, in
  order of cost: detail noise in the vertex stage below the texel size (a function of the lattice point, so seams
  stay exact; the CPU twin adds the same term); a smoother (bicubic) blend; a larger k (16x memory per +2); tiles
  baked at higher resolution around the camera (a clipmap). Not decided.
- Water (M3) is ordered after M6 by D15; with cliffs parked, the owner may move it forward.

## 2026-10-28: detail noise below the texel size

The height texture is 1,025 texels per face side (about 98 m on the plane, 920 m on the 600 km sphere), read with a
bilinear blend, so close up the ground is a flat facet per texel and the lighting normals (from the same texels) are
blocky too. This adds a few octaves of noise to the height after the texture read, on the GPU and the CPU twin.

### Built

- `lod-detail-noise.ts`: 4 octaves of 3D value noise (quintic interpolation, 24-bit integer hash, analytic derivative),
  first wavelength one texel, each octave half the wavelength and half the amplitude. Amplitude is the setting
  `detailNoise`, a share of the texel size in metres (default 0.04: about 4 m on the plane, 37 m on the 600 km sphere);
  the offset never exceeds `share * texel * 1.875`. The noise coordinate is the vertex's lattice point (plane: U, V) or
  cube-lattice vector T (sphere), so every leaf that draws a vertex, and both faces of a cube edge, get the same bits.
  Fade: octave `o` is weighted by `smoothstep(2, 4, wavelength / vertex spacing)`, where the vertex spacing is the
  vertex's camera distance times the cell angle (cell pixels times pixel angle). The distance is a function of the
  point and the per-frame anchor, not of the leaf's level, so a fine and a coarse leaf agree on a shared (folded)
  vertex and no crack opens; the cost is that octaves fade in and out as the camera moves.
- `lod-surface-mesh.ts`: the optional `detail` mesh option adds the noise to the height in `surfacePoint` and its
  slopes (per lattice step, converted through the same metric as the texture's slopes) to the shading gradient, so the
  lighting shows the detail. `setDetailNoise` and `setDetailFade` are uniforms; without the option no noise nodes exist.
  2026-10-28: the noise is now built once per vertex (in `surfacePoint`, at the folded, gapped point) and its slope is
  reused for the shading normal; folded vertices use the coarse vertex's detail slope. Base slopes are unchanged.
- CPU twin: `withDetailNoise` wraps a height source: `heightAt` adds the full-detail noise (no fade), `boundM` and every
  `nodeRange` are widened by the noise bound, so culling and the split box (`hot[h+5]`, `hot[h+6]`) stay conservative.
  The page wraps its source before building the selector; the camera and the backstop read the wrapped source.
- `lod-surface-tests.ts`: `detailNoise` setting, `DEFAULT_SETTINGS.detailNoise` = 0.04 (on). `CELLS_32` and the new
  `CELLS_16` (baseline v5, terrain v7) keep it 0, so every saved version (baseline v1-v5, terrain v1-v7) runs with the
  noise off. New `lod-surface-terrain` v8 runs v7's cases with the default; numbers are not comparable with v7. The lab
  has a "detail noise" slider.
- Specs: `lod-detail-noise.spec.ts` (deterministic and bounded, analytic gradient against finite differences, fade
  rule, off equals the plain source, heights within the bound, widened node ranges, shared plane edge, coarse/fine
  shared vertices, shared cube-edge vertices from both faces, suite versions); history lists updated for v8.

### Verified

171 of 171 lab specs pass (`ChromeHeadless --watch=false`; 158 before, 13 new). The vertex-stage nodes are not run by
the specs (no WebGPU in the unit run): the CPU function is tested, its TSL twin was written line by line from it.

### Not done / next

- The owner's visual check close up on the plane and the sphere (facets gone? normals? fade-in of octaves while moving).
- The cost of the noise in the vertex stage (32 hashes per vertex, twice for the shading normal) is not measured in the
  browser; terrain v8 has no saved results.
- The GPU hash and the CPU twin are not compared by read-back; the CPU height has no fade, so on far vertices it differs
  from the GPU by the faded octaves (at most the bound).


## 2026-10-28: patches flicker on a pure turn (baseline v6 turn cases)

The owner sees patches flicker between split and merged while the camera only turns in place. The position does not
change, so no distance changes and the hysteresis of the distance criterion cannot see the turn. Two suspects, both
about what the frustum culls: (a) the leaf budget (cap 1,024) is re-ranked as culled patches leave and enter the view,
so a node can lose its place to one that just came in; (b) the balance rule (neighbours at most one level apart) sees a
different set of nodes as culled patches drop out, which can force or release splits. The sweep cases (+-30 degrees
with a 2 % altitude swing) mix a turn with an altitude change, so none of them isolates this.

### Built

- `lod-camera.ts`: `turnPathView(domain, pose, t)` holds the pose's position, altitude and pitch exactly and swings only
  the heading, `TURN_YAW_RAD` = 90 degrees either side, once every `TURN_PERIOD_S` = 4 s (peak about 140 degrees/s). The
  swing is wide on purpose: patches really leave and enter the view.
- Motion `turn` is wired like `sweep`: `LodSurfaceTestSettings.motion`, the host's `setTurnTime`, the adapter's `turn()`
  on its own clock (`restore` clears it), the page's `turnTime` and `currentView`. It reports the same level churn
  metrics as the sweep (`levelChanges`, `levelChangesPerSecond`, `levelChangesAll`), where `levelChanges` is the visible
  new splits plus visible merges per frame.
- `lod-surface-tests.ts`: `lod-surface-baseline` v6 = v5's cases unchanged (16 cells, detail noise 0, hysteresis 0.15)
  plus six turn cases, 8 s (quick 4 s, one period), at the two sweep poses:
  `turn-plane-100km-low-200m` and `turn-sphere-600km-mid-5km`, each with `-cap16k` (leaf cap 16,384, so the cap never
  binds) and `-nocull` (culling off). The lab's leaf-cap buttons gain 16,384 so the A/B can be reproduced by hand.
- Specs: the turn path (pose at t = 0, position/altitude/pitch fixed, heading +-`TURN_YAW_RAD`), the six case ids and
  that each variant differs from its default case only in the cap or the culling, the adapter run on the turn clock,
  and the history lists. 176 of 176 lab specs pass.

### How to read them

Compare the three variants of one pose on `levelChangesPerSecond` (and the visible-splits-plus-merges series).
Each case also reports `levelChangesAll`, which counts the frustum entries and exits too and so is expected to be nonzero when culling is on.

- Default quiet, so no flicker on a pure turn in this pose: the cause is elsewhere (or needs motion that changes distance).
- Default busy, `-cap16k` quiet: the leaf budget reshuffle is the cause; the hysteretic ranking is not enough at a
  1,024 cap, which is the number to raise or the ranking to change.
- Default busy, `-nocull` quiet: culling is the cause through the balance rule (and the budget it frees); the cap-16k
  variant being busy too points at the balance rule, not the budget.
- All three busy: neither suspect explains it; look at the balance rule over the whole tree and the split distance.
- `-nocull` is not a candidate fix (it draws everything); it is the control that removes the view dependence entirely,
  so it should read 0 if the turn holds the distance fixed.

### Not done / next

- No saved results yet: the owner runs `lod-surface-baseline` v6 (the turn cases only are enough).
- 16,384 as "the cap never binds" is assumed; a case that reports `capHit` true would invalidate its `-cap16k` reading.
- The sweep cases at v5 and the turn cases share settings otherwise, so a quiet turn with a busy sweep means the altitude
  swing, not the heading, drives the sweep's churn.


## 2026-10-28: view-independent selection (baseline v7, terrain v9)

### Measured (baseline v6 turn cases)

During a pure camera turn at a fixed position, with the default 1,024 leaf cap and the frustum culling inside selection,
the visible level changes were about 91-99 per second (flicker). With culling off: 0. With cap 16,384 and culling:
0 visible changes but about 4,500 per second off-screen (`levelChangesAll`) and about 8,000 visible leaves. So the cause
was that culling was part of selection: a culled node asked for no split and left the budget and balance competition, so
the set the 1,024 leaves were ranked over changed with the heading. The hysteresis cannot see a turn (distance is fixed).

### Changed

- `lod-selector.ts`: split requests, the 2:1 balance and the leaf-budget ranking no longer depend on the frustum or the
  heading by default. The frustum is evaluated for every node and only sets its `visible` flag, which decides which
  selected leaves are drawn (`stats.drawn`, a subset of `stats.leaves`, the selected tree). The old behaviour stays as
  `SelectorSettings.cullInSelection: true` (with `cull` on) for A/B. Hysteresis is unchanged.
- Metrics: `stats.leaves` is the selected tree and `stats.drawn` the in-frustum subset (reported as `leaves` and
  `drawnLeaves`); `levelChanges` (`visibleNewSplits + visibleMerges`) still counts changes among drawn patches only, and
  `levelChangesAll` counts every node. With the new default a pure turn must read 0 on both.
- Lab: the page has a "Legacy: cull inside selection" checkbox and an 8,192 leaf-cap button; `LodSurfaceTestSettings`
  gains optional `cullInSelection` (absent = default; set only by the legacy case).
- Suites: `lod-surface-baseline` v7 = v5's cases unchanged plus eight turn cases (8 s, quick 4 s) in the new default
  mode: per pose (`plane-100km` low-200m, `sphere-600km` mid-5km) `turn-<domain>-<pose>`, `-cap4k`, `-cap8k` and
  `-legacycull` (cap 1,024, `cullInSelection`). v6's `-cap16k` and `-nocull` controls are not repeated. `lod-surface-terrain`
  v9 = v8's cases unchanged, measured under the new selection (so its leaf counts and costs can differ from v8); it is
  the latest entry. Numbers of the earlier cases are not comparable across v6 and v7.
- Specs (colocated): a pure turn at caps 1,024 / 4,096 / 8,192 makes no level change and selects the same leaves in both
  poses; drawn leaves are a subset of selected ones; the legacy option still culls in selection (tree follows the heading,
  fewer leaves); culling on or off selects the same tree by default. The reference selector spec covers both modes. The
  hysteresis sweep-churn specs run in legacy selection, which is what their bounds were measured with. 189 of 189 lab specs pass.

### Measured (baseline v7, turn cases)

Quick runs in a visible browser with other apps also measuring, so the timings are rough. Level changes during a pure turn:
0 at leaf caps 1,024, 4,096 and 8,192 (`levelChangesPerSecond` and `levelChangesAll`), against 94 and 97 per second for the
legacy `-legacycull` reference (culling inside selection). Selection p95 about 0.2 / 0.7 / 1.2 ms and `gpuScenePass` about
0.07 / 0.10-0.12 / 0.16-0.18 ms at 1,024 / 4,096 / 8,192.

### Decision: default leaf cap 4,096

With selection independent of the view the budget is spent partly off-screen, so the old 1,024 cap leaves less detail on
screen than before. The owner chose 4,096 as the default (the 1,024 button stays for A/B): it keeps 0 level changes at
about 0.7 ms selection p95 and 0.10-0.12 ms GPU scene pass. `DEFAULT_SETTINGS.leafCap` (`DEFAULT_LEAF_CAP`) is 4,096 and
the lab page starts there. Terrain v9 has not been run, so it changed in place: it runs terrain v8's cases at the 4,096 cap
(the cells A/B too; the cap A/B keeps its own 1,024 and 512 caps). Terrain v8 and older, and baseline v7 and older, are
pinned to the 1,024 cap they were measured at, so their definitions and numbers are unchanged.

### Not done / next

- No saved results for terrain v9: the owner runs it and compares it with v8 (4,096 against 1,024 cap, view-independent
  selection against frustum selection).
- Selection ignoring the frustum means more leaves are selected than drawn when looking away; the cost of the unseen
  leaves is only the CPU selection, not the draw, but the budget is now spent partly off-screen. Whether to bias the
  budget toward the view (without making it heading-dependent frame to frame) is open.

## 2026-10-29: terrain for games (plan step 3c, D16)

### Decided

- The owner chose to make the terrain usable by other games before the slope criterion and M2, for example a game on
  a cell planet that needs 3D ground, then to measure it together with the planet material, atmosphere and clouds.
- Components (D16): `<planet>` as a parent that provides radius, centre, sun and camera origin; `<planetTerrain>` and
  `<flatTerrain>` for the ground; `<planetAtmosphere>` and clouds as siblings. Entry `triangular-engine/lod-surface`.
  Promotion moves ahead of M2, which changes D8's timing.
- Steps G1–G5 are in the plan (§Milestones, step 3c): promote, cell-planet heights, planet material, gameplay
  queries, combined scene and suite.

### Found

- Correction (same day): a `triangular-engine/cloud-volumes` entry exists, with code but no component; G5 needs a
  `<planetClouds>` wrapper over it, with a labelled placeholder until then.
- `PlanetSurfaceMaterial` was built for the cell-planet globe; whether it accepts this terrain's displaced positions
  and normals is unchecked, so G3 starts with a short spike.

### Not done / next

- Nothing built. Terrain v9 is still unrun.
- G1 (promotion) and G2 (cell-planet heights) go first.

## 2026-10-29: G1, promotion to `triangular-engine/lod-surface`

### Done

- **Moved** from the lab into `lod-surface/core` (plain filesystem moves, behaviour unchanged): lod-domain, lod-lattice,
  lod-selector, lod-leaf-pack, lod-height, lod-canyon, lod-height-bake, lod-height-noise, lod-height-terrain,
  lod-detail-noise, lod-height-texture and lod-surface-mesh.
- **Changed while moving:** the cliff fixture's ground point and heading are now `FIXTURE_GROUND` and
  `FIXTURE_HEADING_RAD` in the library, so the core no longer imports the lab camera; `LodSurfaceMesh` takes an optional
  `material` (the caller disposes it) and no longer owns the sky colour; `groundFrame` and `frustumNormals` (new
  `lod-view.ts`) are shared with the lab camera.
- **New in core:** `lod-height-bake-client.ts` (`createBakeClient`, `serveBakeRequests`, `answerBakeRequest`; the app keeps a
  one-line worker file), `lod-terrain-body.ts` (`LodTerrainBody`, `TERRAIN_DEFAULTS`, `LodTerrainSettings`) and its spec.
- **New components:** `<planetTerrain>` and `<flatTerrain>` with an `attachLodTerrain` helper (effect builds or configures
  the body, `beforeRender$` selects and publishes stats; hidden on a non-WebGPU renderer). Specs cover creation, inputs
  reaching the selector settings, defaults, camera-following and a supplied material.
- **Stayed in the lab:** the page, camera poses, adapter, tests, the worker file, and the specs that exercise the lab
  (they import from `triangular-engine/lod-surface/core`). `planet-surface-detail-spike/` and the older
  `triangular-engine/terrain` entry are untouched. No suite version changed.
- **Config:** `tsconfig.json` and the demo app's `tsconfig.app.json` paths, and `angular.json` includes the library specs.
- **Docs:** `lod-surface/README.md`, the package README index, `docs/entry-points.md`, `CHANGELOG.md`, the skill's entry
  list, and TSDoc on the public exports.

### Public API

- `triangular-engine/lod-surface`: `PlanetTerrainComponent`, `FlatTerrainComponent`.
- `triangular-engine/lod-surface/core`: everything exported by the moved files plus `lod-view`, `lod-height-bake-client` and
  `lod-terrain-body` (a deliberately wide surface for a preview; narrowing is open).

### Results

- Library specs (`../lod-surface/**/*.spec.ts`, ChromeHeadless): 12 of 12.
- Lab specs (`**/lod-surface-lab/**/*.spec.ts`, ChromeHeadless): 189 of 189, as before the move.
- `npm run build:triangular-engine` and `npx ng build demo-app` pass; the worker bundle holds no Angular declarations.

### Not done / next

- Terrain v9 is still unrun; G2 (cell-planet heights) is next.
- Whether `core` should export less than every moved file is open.

### Measured (terrain v9 after G1, 2026-10-29)

Quick visible-browser run on the RTX 3080, after the move into `triangular-engine/lod-surface`, compared with the last
v8 run (1,024 cap, selection inside the frustum):

- 61 of 62 cases valid, 0 failed; `biome-cells-32-1` hit its window cap without settling (its partner `-3` settled).
  0 crack px everywhere; the injected-gap control still finds 27,725 px. The move broke nothing visible to the suite.
- Drawn leaves rise in almost every case (for example 600 km eye-2m 760 to 2,087; plane eye-2m 743 to 1,203), so the
  4,096 cap more than restores on-screen detail. Exceptions: the 10 km spheres at mid-5km draw fewer (about 700 to
  450), because the budget now covers the far side; the `biome-cap-1024/512` A/B draws about half its v8 count, as
  expected under view-independent selection.
- GPU scene pass median: mean over the cases 0.12 to 0.17 ms; highest 0.43 ms (32-cell patches). Inside the 1.5 ms
  terrain proposal.
- Selection CPU p95 stays 0.1 ms on static poses but rises on moving cases: sweeps 0.3 to 0.7 ms, traversals 0.5 to
  1.1 ms, over the L5 0.2 ms target. Open: cheaper selection when moving (incremental updates, or selecting every
  other frame).

## 2026-10-29: G2: cell-planet heights (2026-10-29)

### What changed

- New public `cellPlanetHeights(bake, options): Promise<TextureHeightSource>` in
  `triangular-engine/lod-surface/core`. `options` = `{ seed, cellCount, relaxationIterations? (default 2), heightScaleM, radius, warp?, bakeK? }`.
  It validates with `parseCellPlanet`, bakes `'cell-planet'` through the app's `createBakeClient` worker (the existing
  `serveBakeRequests` path; the description crosses `postMessage`, the worker rebuilds the world) and wraps the result with
  `createTextureHeightSource`. TSDoc says the parameters must match the game's `buildCellPlanetWorld`, and that only
  seed, cell count and relaxation are described (not `jitter`, `plateCount`, `worldProfileKind`, `terrain`).
- Why a promise and not a value for `[heights]`: baked heights exist only after the worker bake, and the `heights` input
  takes a ready `HeightSource`. A game awaits the call and binds the result (README example). A "pass a prebuilt world"
  variant was skipped: a world object does not cross `postMessage`, so the worker would rebuild it anyway.
- Plane misuse: `LodTerrainBody.configure` throws "Cell-planet heights are a sphere source: use <planetTerrain>, not
  <flatTerrain>" when the source id is `cell-planet` on a plane. The bake path already threw for a plane layout, and a
  radius/warp mismatch already threw.
- Lab page not changed: its cell-planet path needs the bake's `probes`, `worldBuildMs` and `roundTripMs` for the suite
  metrics, which the public function (source only) drops; a swap would change measured output, so it stays on `bakeInWorker`.

### Files

`lod-surface/core/lod-cell-planet-heights.ts` (+ `.spec.ts`), `core/public-api.ts`, `core/lod-terrain-body.ts`,
`components/flat-terrain.component.spec.ts`, `lod-surface/README.md`, `CHANGELOG.md`.

### Verified

- Library specs (`../lod-surface/**/*.spec.ts`, ChromeHeadless): 18 of 18.
- Lab specs (`**/lod-surface-lab/**/*.spec.ts`, ChromeHeadless): 189 of 189, unchanged.
- `npm run build:triangular-engine` passes; `npm run docs:records:check` OK.

### Finding: does the terrain ground line up with the globe from orbit? (for G3)

- Terrain: height = `(sample.elevation - sample.seaLevel) * heightScaleM` above `radius`, so the sea sits exactly at `radius`.
- `<planetView>` (`worldgen/render`, `planet-view.component.ts`): vertex radius = `1 + elevation * elevationScale` with the raw
  tectonic cell elevation (not sea-relative) in a unit-radius world; `elevationScale` is a fraction of the radius.
- Morph globe (`planet-morph-geometry.ts`, used by `planet-material`'s morph nodes): `radius + sample.elevation * heightScale`,
  with the same `createPlanetSurfaceSampler` samples as the terrain; raw elevation, and with `seabedRelief: false`
  non-land cells are clamped to `seaLevelElevation`.
- So the globe's sea level is at `radius + seaLevelElevation * heightScale`, while the terrain's is at `radius`.
  `seaLevelElevation` is a quantile of the cell elevations (`elevation.ts`), not zero. The two meet only if the globe is
  drawn at radius `R - seaLevelElevation * heightScale` (equivalently, the terrain adds `seaLevel * heightScaleM`), with
  `heightScaleM` equal to the globe's `heightScale` in the same units. Relief shape matches (same sampler, same scale),
  but the offset does not unless G3 compensates. The planet-view cell elevation differs from the sampler's detailed
  elevation by the sampler's sub-cell detail. Neither side was changed.

## 2026-10-29: G3 spike: planet material (2026-10-29)

Question: can `<planetTerrain>` draw with `PlanetSurfaceMaterial` (`triangular-engine/planet-material`), so the ground looks like the cell-planet globe from orbit?

**Verdict: works with changes.** The material's layer, occluder, emissive, lighting and atmosphere stacks work unchanged. Only its stage 1 (the globe-only context) has to be replaced. Two small, additive, internal changes were enough; `planet-material`'s public API is untouched.

### What the material reads, and what the terrain has

| Material needs | Terrain has | Resolution in the spike |
|---|---|---|
| geometry `position` as sphere position | grid `(x, y, 0)` | replaced by the terrain's `positionNode` |
| geometry `normal` | absent | `nodes.normal`, the height-gradient shading normal |
| `aFlatPos`, `aFlatNorm` | absent | not needed: the terrain is always morph 0 |
| `color` (vertex-colour base layer) | absent | solid-colour base layer (`TerrainPlanetMaterial` default) |
| `uv` | absent | `cellAtlasUv(radialDirection)` |
| radial direction, lat/lon | derivable | `nodes.up` varying (exact, no height in it) |
| body-fixed / morphed position | derivable | `nodes.position`, camera-relative; lifting by `modelWorldMatrix` is right for `LodTerrainBody` (mesh at the camera) but not for the lab (mesh at the origin) |
| fragment mask (seam cull) | reads the missing attributes | set to null |
| lights | not in the mesh | scene `DirectionalLight` plus `AmbientLight` |

Control: the plain `PlanetSurfaceMaterial` on the terrain draws black (centre pixel below 0.01) and logs three missing-attribute warnings.

### Changes (all additive)

- `lod-surface/core/lod-surface-mesh.ts`: new exported `LodSurfaceNodes` (`up`, `normal`, `position`, `level` varyings) and `LodSurfaceNodesConsumer` (`bindLodSurfaceNodes`). `LodSurfaceMesh.nodes` exposes them. A supplied material that implements the hook is called after the nodes exist; the mesh still sets only `positionNode` on a supplied material. This solves the circular construction (the material must exist before the mesh's nodes).
- `lod-surface/terrain-planet-material.ts` (new, exported): `TerrainPlanetMaterial extends PlanetSurfaceMaterial`. On bind it rebuilds the `IPlanetContext` from the nodes, sets `normalNode`, clears the masks and rebuilds the stacks. Spike shortcut: it assigns the readonly `context` through a cast and calls the private `rebuild()`.
- Lab: `?material=planet` or the panel's "Surface material (G3 spike)" buttons. On the cell-planet sphere it paints biome colours by direction through `cellLookupLayer` (2048x1024 cell-id atlas) with a scene sun. `LodSurfaceTestSettings` and the suites are unchanged, so no suite version moves. Saved runs carry the environment label `surface.material`.
- Docs: `lod-surface/README.md` and `CHANGELOG.md`.

### Sea level

For the lab's cell-planet seed `seaLevelElevation` is 0.3232 (a quantile of cell elevations, not zero). The terrain puts sea at `radius` (height is `(elev - seaLevel) * heightScaleM`); the globe puts it at `radius + elev * heightScale`. At the lab's scales the globe's sea sits about 48.5 m above the terrain's on the 10 km sphere and about 388 m on the 600 km sphere. Recommendation: shift the globe, not the terrain. The terrain's zero-at-sea contract is what gameplay and the camera rely on, so draw the globe at radius `R - seaLevelElevation * heightScale` (same `heightScale` units). Expose `seaLevelElevation` from the world or the bake so callers need not recompute it. Neither side was changed in the spike.

### Recommended G3 design

1. Keep `bindLodSurfaceNodes` and its types as the supported path.
2. Give `PlanetSurfaceMaterial` an official way to take a context or stage-1 override. That replaces the readonly cast and the private `rebuild()` call. It is a `planet-material` API change and needs owner approval.
3. `<planetTerrain>` accepts or creates the terrain flavour itself (default `TerrainPlanetMaterial`, or a `surface` input).
4. The cell lookup must come from the same world the globe uses. The spike coloured cells from the terrain's own `buildCellPlanetWorld` world with biome colours, not the render-core "material" colours.
5. Use a higher-resolution or analytic cell lookup. The atlas is nearest-filtered, so cell edges step at ground level.
6. Add the sea-level helper above and offset the globe.
7. A `<planet>` parent supplies the sun light and direction.
8. The macro layer lifts position through `modelWorldMatrix`, so it works only while the mesh sits at the camera (`LodTerrainBody` does).
9. A resolved-world palette (biome and ice) should replace the spike's local `cellBiomeColours`.

### Verification

- `lod-surface` library specs: 22 of 22 pass (18 before, 4 new in `terrain-planet-material.spec.ts`).
- Lab specs: 189 of 189 pass.
- `npm run build:triangular-engine` passes; `tsc -p projects/demo-app/tsconfig.app.json --noEmit` is clean.
- Caveats: the new drawing spec uses the WebGL2 backend headless (native WebGPU was not checked); the owner has not yet looked at the lab visually; the biome palette and atlas are spike shortcuts.

## 2026-10-29: G3: planet material (2026-10-29)

Turns the G3 spike into the supported path: `<planetTerrain [material]="new TerrainPlanetMaterial({ cellPlanet: world })">` draws the ground in the globe's colours for the same cell planet, with exact cell edges up close. The owner approved an additive `planet-material` API change for step 1.

### What changed

1. **`PlanetSurfaceMaterial.setStageOverride(override | null)`** (`planet-material/planet-surface-material.ts`, new `IPlanetStageOverride`). The override carries an `id` (part of the shader cache key), partial `context` fields, a body-frame `shadingNormal` (the material turns it into view space) and `maskNode` / `maskShadowNode` (`null` removes, omitted keeps the globe's). `context` is now a getter over the globe's context or the merged one. The spike's readonly cast and private `rebuild()` call are gone. Default path unchanged: with no override the context object, `normalNode`, masks and cache key are the globe material's (specs assert identity against `morphGraph`, and every existing planet-material spec passes untouched).
2. **`TerrainPlanetMaterial`** uses it from `bindLodSurfaceNodes` (id `lodTerrain`), no casts or private access. `bindLodSurfaceNodes` stays the link between mesh and material.
3. **`<planetTerrain>` API: the `material` input, nothing new.** The mesh already hands a supplied material its nodes, so the smallest clean surface is one object: `new TerrainPlanetMaterial({ cellPlanet })` in `[material]`. A new input or component would have had to own a material it does not create and dispose. `sunDirection` now reaches the material too (new `LodSurfaceSunConsumer.setSunDirection`, called by `LodSurfaceMesh.setSun` for a supplied material).
4. **Colours from the same world.** `cellPlanet` takes the built `ICellPlanetWorld` or the `cellPlanetHeights` description (`resolveCellPlanetWorld`, built on the calling thread through the cached `cellPlanetWorld`). `cellPlanetCellColours` paints land and ice by biome and the sea by the ocean colour (lava for lava worlds): the globe's `natural` colours for that world (the old spike used `world.tectonics.isLand`; this uses the sampler's `isLand || isIce` like `buildCellColourData`). Main thread kept; see the cost below.
5. **Exact cell lookup.** New `cellVoronoiLayer` (planet-material) and `buildCellPlanetLookup` (lod-surface/core). See below.
6. **Sea level.** `seaAlignedGlobeRadius(radius, world | seaLevelElevation, heightScaleM)` = `radius - seaLevelElevation * heightScaleM`. Neither default moved; a game gives the globe that radius and keeps the terrain's `radius`. Documented in both READMEs. 0.3232 * 150 = 48.5 m on the 10 km sphere. The `<planet>` parent will apply it.
7. **Sun.** `TerrainPlanetMaterial.dayNight` (`IPlanetDayNightUniforms`) and `setSunDirection(dir)`: the place a parent's day/night lighting stage reads. The PBR path still uses scene lights; the parent moves those. Nothing else was built.

### Cell lookup choice and cost

Options weighed: a bigger equirect atlas (8192 x 4096 = 128 MB, texel still 0.5 km at a 10 km radius so steps remain at 2 cm), a per-face cube atlas (same trade, 6 x 1024^2 = 24 MB), or the nearest-cell search itself. Chosen: **coarse atlas to find a nearby cell, then the exact Voronoi rule in the shader** (largest centre dot among the atlas cell and its eight neighbour slots). It is exact wherever an atlas texel is smaller than a cell, so the atlas shrank from the spike's 2048 x 1024 (8 MB) to 1024 x 512 (2 MB), growing past about 20,000 cells.

- Memory (1,000 cells): 2.0 MB atlas + 64 KB tables (16 B colour, 16 B centre, 32 B neighbours per cell), about 2.09 MB in all (the spike's atlas alone was 8 MB).
- Shader: 12 texture fetches per fragment (atlas 1, neighbours 2, centres 9, colour 1) against 2 for `cellLookupLayer`, plus nine dot products and selects. All explicit-level nearest fetches into tiny tables; not measured on the RTX (no browser run). Expect it to be small next to the vertex and lighting work, but it is the first thing to look at if a ground-level frame time moves.
- Build, measured headless (Chrome, CPU): world for 1,000 cells 99 ms; colours + 1024 x 512 atlas + tables **46 ms**, main thread. Not worth a worker.
- Verified on the GPU backend (WebGL2 via `forceWebGL`): on a deliberately coarse 32 x 16 atlas of a 150-cell world, 400 directions all match `findCellAt`'s colour with the exact layer and more than five do not with the plain layer (control), so the fix is what removes the steps.

### Files

`planet-material/planet-surface-material.ts` (+ spec), `planet-material/cell-voronoi-layer.ts` (+ spec), `planet-material/public-api.ts`, `planet-material/README.md`; `lod-surface/terrain-planet-material.ts` (+ spec), `lod-surface/cell-planet-ground.spec.ts`, `lod-surface/core/lod-cell-planet-lookup.ts` (+ spec), `lod-surface/core/lod-surface-mesh.ts`, `lod-surface/core/public-api.ts`, `lod-surface/components/planet-terrain.component.ts` (+ spec), `lod-surface/README.md`, `CHANGELOG.md`; lab: `lod-surface-lab-page.component.ts` (`?material=planet` now builds `new TerrainPlanetMaterial({ cellPlanet })`; the local biome colour and atlas code is gone).

### Verified

- `lod-surface` library specs (ChromeHeadless): 37 of 37 (22 before).
- `planet-material` library specs: 91 of 91.
- Lab specs (`**/lod-surface-lab/**/*.spec.ts`): 189 of 189, unchanged. The default debug material path was not touched (only `setSun` gained a supplied-material branch), so lab measurements with it are unchanged.
- `planet-material-extensions` page specs: 16 of 17. The failure (`builds and parses exact-version and latest launch links`) expects a launch link without `testMode=standard`; `testing/test-launch.ts` (untouched here) now adds it. It is not caused by this change.
- `npm run build:triangular-engine` passes; `npx tsc -p projects/demo-app/tsconfig.app.json --noEmit` is clean.
- Caveats: GPU specs use the WebGL2 backend headless; the owner has not yet looked at the result on WebGPU; the shader cost is not measured on hardware.

### What's left

- The `<planet>` parent: apply `seaAlignedGlobeRadius`, move the scene light with the sun, share the world between globe, heights and ground.
- Colours are the biome (`natural`) palette. The globe's `material` colour mode (rivers, slope, snow line) needs the render-core world and is not reproduced; ice and biome are.
- A world with a non-default `jitter`, `plateCount`, `worldProfileKind` or `terrain` must be passed built (the description path rebuilds the default world, like `cellPlanetHeights`).
- Cells with more than eight neighbours keep the eight nearest (rare; an edge beside a ninth could pick a slightly wrong cell).
- Macro layer and other `modelWorldMatrix` layers still need the mesh at the camera; vertex-attribute layers do not work on the terrain.
- Atmosphere on the terrain, gameplay height queries and a hardware timing of the new lookup remain.
