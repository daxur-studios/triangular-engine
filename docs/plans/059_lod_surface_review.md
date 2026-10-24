---
type: Review
title: Plan 059 LOD surface review
description: Three reviewers (Claude, Argon, Astra) give their take on a fresh, WebGPU-only LOD surface core shared by water and low-detail terrain, so the owner can settle the direction before anything is built.
timestamp: 2026-10-24T00:00:00Z
tags: [lod, mesh, quadtree, clipmap, sphere, water, terrain, webgpu, review]
plans: /docs/plans/059_lod_surface_core.md
---

# Plan 059 LOD surface review

**What this is for.** The owner wants a fresh start on meshing: a simple, fast, performance-tested foundation for a
surface whose level of detail follows custom criteria, working on a flat plane and on a sphere, good for low and
lower-detail games. Water would be its first user and low-detail terrain its second. Before anything is built, the
owner wants three independent takes on the direction, then a consensus or a short list of options to choose from.

**How to take part.** Read §Context and §Questions, then [Plan 059](/docs/plans/059_lod_surface_core.md). Form your own
view **before** reading the other reviews. Then fill in **your own section only** (§Reviews). Disagree freely,
including with the plan, the questions and the other reviewers. Say what you would measure to prove yourself wrong.
Keep it to about two pages. Do not edit other sections, the plan, or any code; do not commit; do not name private or
consumer repositories. If you use web sources, cite them; mark anything from general knowledge as such.

**Prompt given to Argon and Astra:**

```text
You are reviewing a design for the triangular-engine repository (an Angular + three.js engine) at
D:\code\triangular-workspace. Your reviewer name is <Argon | Astra>.

1. Read AGENTS.md first and follow it (in particular: do not commit, do not name private or consumer repos).
2. Read docs/plans/059_lod_surface_review.md: "What this is for", "How to take part", "Context" and
   "Questions for every reviewer". Then read the draft plan docs/plans/059_lod_surface_core.md.
3. For history, as needed: docs/runbook/028_planet_terrain_attempt_history.md (earlier terrain attempts),
   docs/plans/057_planet_water_system.md (a large design-only water plan), docs/plans/055_meshing_review.md
   (an earlier review in this same format) and the code they mention. You may read any code for lessons.
4. Form your own view before reading the other reviewers' sections in 059_lod_surface_review.md.
5. Write your take in your own section only ("### Argon" or "### Astra") of docs/plans/059_lod_surface_review.md.
   Start with your preferred design in one or two sentences, then answer each numbered question briefly.
   About two pages.

Constraints on the design: WebGPU only (three.js 0.186 WebGPURenderer, TSL, compute allowed; no WebGL or GLSL).
No code ported, wrapped or imported from the GLSL water/ module or the earlier terrain attempts; Plan 055's lab
and contenders stay untouched. Heightfields only (no caves or overhangs). The goal is a simple, fast foundation
for low and lower-detail games, not a planet engine.

Disagree freely, including with the plan, the questions and the Claude section. For each claim that matters,
say what you would measure to prove yourself wrong. Cite web sources if you use any; mark general knowledge as
such. Do not edit any other section, the plan, or any code. Do not commit.
```

## Context

### What the owner asked for (condensed)

- The Plan 055 terrain POCs are very ambitious and slow to land. Wanted instead: something quick and efficient that is
  good for lower-detail games, starting with meshing that runs very fast on a flat or a sphere shape, since every
  demo so far uses rough terrain.
- The ground work done cleanly and visibly: a grid that gets more detailed as the camera zooms in and coarser as it
  zooms out.
- Level of detail driven by **custom criteria**: camera nearness, feature importance, horizon nearness.
- Terrain is "kind of like frozen water". Water is far more dynamic, so an approach that draws water well may already
  allow terrain modification. Possibly do water first and use it for terrain if it works well.
- **Fresh code, WebGPU only.** The existing GLSL water code is "not good enough" and is not to be reused.

### Targets (from Plan 059, abridged)

L1 visible LOD (debug colours, wireframe) on plane and sphere from 2 m to orbit; L2 zero cracks; L3 bounded popping;
L4 custom criteria (distance, feature, horizon, budget), each a toggle; L5 on an RTX 3080 Laptop GPU at 2560 x 1440:
surface <= 0.5 ms GPU p95, selection <= 0.2 ms main thread p95 with no per-frame allocation, one draw per pass
(working numbers); L6 a low-end profile on the laptop's AMD integrated GPU (60 fps for a lower-detail preset,
working number); L7 no jitter on a 6,371 km sphere at 2 m; L8 heights that change every frame or by edits show on the
next frame without re-meshing; L9 a CPU twin of every height source for buoyancy, colliders and queries.

### What exists and may be used

- **Renderer:** `EngineService` with `preferredRenderer: 'webgpu'`, three.js 0.186.1, TSL node materials, compute.
- **Testing:** `triangular-engine/testing` (suites and cases, saved results read with `npm run test:summary`,
  budgets and baselines, ABAB ablation, GPU time per pass, machine context). See
  `projects/triangular-engine/docs/testing.md`.
- **Data flow:** `triangular-engine/gpu-data-flow` (job scheduler, upload and readback rings, latency window).
- **Physics:** `triangular-engine/jolt`, including a height-field shape component.
- **meshoptimizer** is a dependency.

### What may be read for lessons but not reused

- The GLSL `water/` module (a camera-centred LOD grid, plane, sphere and cylinder domains, Gerstner waves).
- The earlier terrain attempts (CDLOD, clipmap and cell-planet renderers; history in Runbook 028).
- Plan 055's contender B (`planet-shape-lab/contender-b/`): a cube-sphere with canonical lattice keys and a quadtree
  leaf selector with 2:1 balance and coarser-edge masks.

### Ground rules

- WebGPU only, TSL; heightfields only; one lab page (`/lod-surface-lab`, proposed); every addition a measured toggle.
- Timings only from real-GPU `visible-browser` runs; headless runs check correctness, not speed.
- No commits by agents. The engine is public: no private or consumer app names or paths.

## Questions for every reviewer

1. **Structure.** Quadtree of patches (plane roots, cube-sphere faces), camera-centred clipmap rings, or something
   else (for example a GPU-driven bisection tree, or a projected grid for water)? One structure for plane and sphere?
2. **Criteria.** How should camera distance, feature importance, horizon nearness and a budget combine, and in what
   unit (pixel error, target cell size, a priority score)? How does a game declare an important feature (regions,
   points, a texture)?
3. **Transitions.** How do level changes avoid popping when the criterion is not just distance: a per-vertex morph
   from a continuous field, a timed fade, or accepting pops at low detail?
4. **Cracks.** Edge folding in the vertex stage, stitched index variants, skirts, or another way? Can a surface stay at
   one draw per pass?
5. **Where selection runs.** CPU each frame, CPU incremental, or GPU compute with indirect draws? At what leaf count
   does the GPU path pay off?
6. **Live or baked heights.** Evaluate the height per vertex every frame (waves and edits free), or bake per patch or
   per world into textures (expensive terrain noise)? Can one core serve both without overhead?
7. **Water and terrain.** Is "terrain is frozen water" a sound basis for one core? What does water need that terrain
   does not, and the other way round? Where does the analogy break?
8. **Sphere.** Cube-sphere projection, precision at 6,371 km at 2 m eye height, horizon culling, and the view from
   orbit.
9. **Performance foundation.** What to measure from the first milestone, which budgets suit a lower-detail game, and
   how to keep the numbers honest on an integrated GPU.
10. **Water itself.** The simplest good-looking WebGPU water for lower-detail games on this core: wave model, normals
    and far filtering, shading, and the CPU twin for buoyancy.
11. **Biggest risk** of your preferred design, and the cheapest early test that would expose it.
12. **What to cut** from Plan 059 so the first visible result (M1) lands within a few days.

## Reviews

### Claude (Opus 5.5, the session that drafted Plan 059)

**Preferred design: one quadtree-of-patches core for plane and sphere, drawn as a single instanced grid, with heights
read live in the vertex stage and criteria expressed as target cell sizes.** Water and terrain differ only in their
height source and shading.

1. **Structure.** A quadtree per root: one square for a bounded plane, a camera-following tiling of squares for an
   unbounded plane, six cube faces for a sphere. Every leaf draws the same N x N grid (N = 16, 32 or 64 as a measured
   toggle). Clipmap rings are cheaper on the CPU but can only express distance; with only the distance criterion a
   quadtree lays out ring-like levels anyway, and it also handles culling, feature refinement and a sphere seen from
   orbit, where rings centred on the camera stretch towards the horizon. A projected grid swims at the horizon and
   does not suit a sphere from orbit, so not even for water.
2. **Criteria.** Each criterion maps a node's bounds to a target cell size in metres; a node splits while its cell size
   is above the smallest target, with 10-20% hysteresis so it does not flicker. Camera: distance x pixel angle x
   allowed pixel error, relaxed where the height source's roughness bound says the area is flat. Feature: a short list
   of regions (disc, box, polyline with a radius), each with a target cell size and a fade distance, in a small spatial
   index on the CPU. Horizon: near the silhouette the allowed pixel error shrinks, since outline errors read worse than
   interior ones. Budget: if the leaf count passes a cap, scale every target up by one factor. One readable unit, and
   each criterion can be switched off on its own.
3. **Transitions.** A per-vertex morph by camera distance (continuous by construction) for the camera criterion, and a
   short timed fade (about 0.25 s) of the morph factor when a feature, horizon or budget change splits or merges a
   leaf. I would accept that a fade is visible on still terrain at low detail, and let the popping score decide.
4. **Cracks.** Odd edge vertices next to a coarser neighbour fold onto that neighbour's edge, from a 4-bit mask per
   leaf. One index buffer, one draw per pass. No skirts: they show at grazing angles and cost fill. The 2:1 balance
   keeps the fold to one level.
5. **Selection.** On the CPU, incremental from last frame's tree, with pooled nodes and no allocation. A few hundred
   leaves are expected, well inside 0.2 ms. Per-leaf data (camera-relative origin, size, level, edge mask, morph) is
   written to one storage buffer. GPU culling and indirect draws only if the CPU number says so.
6. **Live or baked.** Live by default. "Baked" is just a height source whose TSL function samples a texture that the
   source fills by compute when it is dirty. The core does not know the difference, so there is no overhead for the
   live case. One texture is enough for small worlds; paging is out of v1.
7. **Water and terrain.** Sound for geometry and LOD. It breaks in five places: popping shows on still terrain, so
   blending matters more there; terrain height is expensive to evaluate, so it bakes; water moves vertices sideways
   (Gerstner) and terrain does not; water's height bound is small and global, terrain's varies, so terrain needs a
   min/max pyramid per texture; and shading, transparency and depth are entirely separate. "Edits for free" is true
   for drawing only. Bounds, colliders and queries still have to see the edit.
8. **Sphere.** Cube-sphere with an equal-angle warp so cells stay even. Precision is the trap: normalising a cube
   point in float32 and scaling by 6,371 km is off by about half a metre (general knowledge: float32 relative
   precision is about 6e-8). So each leaf gets its centre relative to the camera in doubles on the CPU, and the vertex
   stage adds a small local offset (tangent plane plus a curvature term), never a full-radius position. Wave phases
   at Earth scale have the same problem and get the same fix: the phase at a camera-relative origin is computed in
   doubles on the CPU. Horizon culling uses the source's max height on each node.
9. **Performance.** From M0: GPU ms per pass, selection ms, leaves, triangles, draws, pixels per triangle, crack
   pixels. Run every suite on both adapters; never quote headless or SwiftShader timings. Pixels per triangle is the
   number that says whether "low detail" is actually low.
10. **Water.** Four to eight directional Gerstner waves in the vertex stage with steepness capped (no loops), and the
    same sum on the CPU for buoyancy. Normals from the same waves plus one or two detail layers that fade with
    distance, while roughness rises with distance to keep the sun glint and horizon stable. Shading: Fresnel to a sky
    colour, a depth tint once a depth source exists, a sun glint. On a sphere the waves are defined in 3D (plane waves
    through space sampled on the surface), which avoids a tangent-frame singularity at the poles.
11. **Risk.** Precision and the horizon on the 6,371 km sphere, and whether timed fades look acceptable on terrain.
    Cheapest test: M1's sphere cases at 2 m and in orbit with the crack probe, plus a jitter check: a camera moving
    1 m per frame over a flat sphere, measuring vertex movement on screen.
12. **Cut.** Terrain entirely until water v0 (M3) stands; the budget criterion and anything beyond disc and box
    feature regions; blending until after M1 (pops are fine on a debug view). M1 is plane plus sphere, distance only,
    colours and the crack probe.

### Argon

**Preferred design: one zero-allocation CPU priority-queue quadtree over a unified domain interface (1 root for bounded
plane, $2\times 2$ camera-snapped roots for unbounded plane, 6 equal-angle cube-sphere roots), drawn in a single
instanced $32 \times 32$ grid call per pass with canonical integer-lattice `hi/lo` vertex positioning and live TSL
height/displacement evaluation.** Water and low-detail terrain share the domain, selector, crack-free instanced mesh,
and height-source contract, while keeping shading, transparency, and physics adapters separate.

*(Independent view formed before reading Claude's and Astra's sections. Uncited rendering and numerical statements below
are **general knowledge**; repository lessons cite [Runbook 028](/docs/runbook/028_planet_terrain_attempt_history.md)
and Plan 055/057 docs without reusing their code.)*

1. **Structure.** One 2:1-balanced quadtree of patches for both plane and sphere, rendered as a **single instanced
   $N \times N$ grid** ($N = 32$ default, $16/32/64$ as a measured toggle) reading per-leaf instance data from a TSL
   storage/instanced buffer. A bounded plane uses 1 root; an unbounded plane uses a $2 \times 2$ grid of coarse roots
   whose origin snaps in integer steps of the root size; a sphere uses 6 equal-angle cube roots. Reject camera-centred
   clipmap rings (cannot refine off-nadir feature regions or cover a full sphere from orbit without pole/horizon
   singularities), screen-space projected grids (horizon swimming and no world-space feature pinning; general
   knowledge, Johanson 2004), and GPU Concurrent Binary Trees (compute dispatch and reduction barriers cost more than
   selecting $\le 400$ leaves on the CPU). **Falsifier:** ABAB compare `N = 16, 32, 64` across ground and orbit poses;
   if quadtree selection + 2:1 balancing exceeds `0.2 ms` CPU p95 at $\le 500$ leaves while a distance-only ring grid
   stays under `0.05 ms` with equal visual quality, split the plane/water fast path.

2. **Criteria.** Combine criteria via a **dimensionless split priority** $\rho(\text{node}) = s_{\text{node}} / s_{\text{target}}(\text{node})$
   (split while $\rho > 1$, with 15% merge hysteresis), where each criterion outputs a desired world cell size $s_i$ (m)
   and the combined target is clamped by a **minimum screen-space footprint floor** $s_{\text{minPx}}(d) = d \cdot \text{pixelAngle} \cdot p_{\min}$ ($p_{\min} \approx 2\text{ px}$):
   $$s_{\text{target}} = \max\!\big(s_{\text{minPx}}(d),\; \min(s_{\text{camera}},\, s_{\text{horizon}},\, s_{\text{feature}})\big)$$
   **Where I disagree with Plan 059 and Claude:** Unconditionally taking $\min(s_i)$ in metres means a `2 m` feature
   region (a harbour or road) forces subdivision down to `2 m` even when viewed from $500\text{ km}$ orbit, creating
   $< 0.01\text{ px}$ sub-pixel triangles and exhausting the leaf budget; clamping by $s_{\text{minPx}}(d)$ prevents
   sub-pixel refinement from space. Second, enforcing the budget by globally scaling all targets up (Claude) lets a
   distant dense feature steal detail from right under the camera. Instead, expand the quadtree using a **bounded
   max-heap keyed by $\rho$**: greedily split the highest-$\rho$ leaf (along with any coarser neighbours required by
   2:1 balance) until `leafCount <= maxLeaves` or $\max\rho \le 1$. Declare features via a flat CPU array of analytic
   primitives (`disc`, `capsule`/`polyline` corridor, `obb`, up to 64 active with `{ bounds, targetCellM, falloffM }`),
   plus an optional coarse per-root min/max/roughness mip pyramid ($64 \times 64$ floats) for baked terrain.
   **Falsifier:** Place ten `2 m` feature discs on a $600\text{ km}$ sphere and zoom from $2\text{ m}$ to orbit under a
   256-leaf cap; compare `pixelsPerTriangle`, camera-nadir cell size, and `selectionMs` between un-clamped global
   scaling and screen-clamped max-heap selection.

3. **Transitions.** Drive continuous per-vertex geomorphing from the leaf's **combined priority ratio** $\rho$ over the
   outer transition window $\rho \in [0.75, 1.0]$ rather than camera distance alone, paired with a short **150 ms
   temporal ramp** only when $\rho$ jumps discontinuously (budget clamp or feature toggle). **Where I disagree with
   Claude and Astra:** Computing morph from radial distance (Claude) hard-pops whenever a patch splits due to horizon
   grazing, wave-amplitude change, or a feature fade outside that level's nominal distance ring. Conversely, storing
   parent heights per vertex to match parent triangles (Astra) doubles vertex bandwidth and breaks live height evaluation;
   instead, morph the vertex's grid coordinate $(u, v) \to \text{mix}((u, v), (u_{\text{even}}, v_{\text{even}}), m)$
   *before* sampling the height source, and blend the odd vertex's height toward the average of its two adjacent even
   vertices only in the final morph band. **Falsifier:** Run the scripted zoom and a stationary feature-toggle test with
   morphing `off`, `distance-only`, and `priority-ratio + 150 ms ramp`; measure the frame-to-frame depth-delta popping
   score and GPU vertex time.

4. **Cracks.** Close 2:1 level boundaries in the vertex stage with a **4-bit `coarserEdges` mask per leaf** and **1
   shared index buffer** (1 instanced draw call per pass, zero skirts). When an odd vertex sits on an edge whose bit is
   set in `coarserEdges`, fold its integer grid index onto the preceding even vertex index (`a & ~1`) *before* domain
   and height evaluation. That collapses the two odd-touching triangles into zero-area degenerates and leaves the
   exact straight segment between even vertices $(a, a+2)$—matching the coarse neighbour's piecewise-linear edge with
   **1 height evaluation per vertex**, no parent height lookups, and no double-drawn translucent water skirts.
   **Where I disagree with Claude's Q8/Q4 interaction:** Folding UV coordinates alone still cracks by 1–2 ULPs across
   patch and cube-face edges if each leaf evaluates positions relative to its own float32 patch centre (see Q8).
   **Falsifier:** Render the contrasting backstop crack probe across all 16 `coarserEdges` masks, a 3-face cube corner,
   and a 2:1 boundary with height waves active at grazing angles; any `crackPixels > 0` or `drawCalls > 1` falsifies the
   vertex fold.

5. **Where selection runs.** **CPU each frame** using a flat preallocated typed-array node pool (`Int32Array` indices
   and Morton/lattice keys, zero `Map`/`Set` or string allocations per frame) writing a single contiguous
   `Float32Array` instance buffer (`16 floats/leaf`, $\le 32\text{ KB}$ for 512 leaves) uploaded via one buffer write.
   *Lesson from Plan 055 contender B:* `leaf-select.ts` currently allocates `Map`s, string keys (`leafId`), and calls
   `Math.tan`/`Math.atan` inside neighbour-probe loops every call—avoid that in 059 by precomputing face-edge
   orientation tables and bitwise integer neighbour lookups. GPU compute selection + `drawIndexedIndirect` only pays off
   above **~2,500–4,000 leaves**; at 100–500 leaves, compute dispatch + indirect barrier overhead (`~0.08–0.20 ms` on
   the iGPU) exceeds the entire `~0.05 ms` CPU traversal while starving CPU systems (colliders, stats) of the leaf
   list. **Falsifier:** Benchmark the flat-array CPU selector from 64 to 4,096 leaves; only spike GPU selection if CPU
   `selectionMs` p95 exceeds `0.2 ms` below 512 leaves.

6. **Live or baked heights.** **Live vertex-stage evaluation is the universal primitive**; a baked height texture is
   simply a `HeightSource` whose TSL function performs one bilinear `textureSampleLevel` fetch from a GPU texture updated
   by compute only when dirty. At $N = 32$ and $300$ leaves, the entire surface has **$326{,}700$ vertices**—fewer than a
   single $600 \times 600$ image—so live vertex evaluation of 4–6 Gerstner waves or a texture lookup takes $< 0.10\text{ ms}$
   on the RTX 3080 Laptop GPU. Better still, sources **compose additively** (`CompositeHeightSource(bakedTerrainOrSea,
   liveWavesOrStamps)`), letting expensive procedural noise bake once into a resident texture while edits and ripples
   evaluate live on the next frame with zero re-meshing. **Falsifier:** ABAB compare live analytic evaluation vs. a
   pre-baked texture height source at 300 leaves on both GPUs; if vertex evaluation exceeds `0.15 ms` on the dGPU, cut
   vertex grid density or move wave evaluation to a per-frame $512^2$ cascade texture.

7. **Water and terrain.** "Terrain is frozen water" is **sound for the geometric core** (domain, quadtree selector,
   crack-free instanced mesh, and `HeightSource` displacement/normal contract) and **false above it**. Four structural
   differences must stay outside the shared core in separate adapters:
   - *Displacement vector:* Gerstner water displaces vertices laterally $(\Delta u, \Delta v, \Delta h)$; heightfield
     terrain displaces radially $(\Delta h)$. The core `HeightSource` should return a 3D displacement `vec3f` (zero
     overhead when $\Delta u = \Delta v = 0$).
   - *Bounds and culling:* Water waves oscillate within global bounds $\pm A_{\max}$ (no spatial pyramid needed);
     terrain has persistent kilometer-scale relief that requires a per-node `[minH, maxH, roughness]` mip table to
     prevent Attempt 1's `S1` uniform-subdivision bug ([Runbook 028](/docs/runbook/028_planet_terrain_attempt_history.md)).
   - *Pass state & two-sidedness:* Terrain is opaque (`depthWrite: true`) and occludes the horizon; water is
     translucent, reads scene depth for shore absorption/foam, and must render cleanly from below the waterline.
   - *Physics Twin:* Buoyancy samples 4–16 discrete hull points per tick ($\mathcal{O}(1)$ analytic CPU math); terrain
     requires a local continuous `Jolt.HeightFieldShape` grid around moving bodies.
   **Falsifier:** Drive both a Gerstner ocean and a stamped height-texture terrain through the identical `LodSurface`
   mesh class with zero `if (isWater)` branches inside `domain`, `selector`, or `renderer`.

8. **Sphere.** Use the **equal-angle cube-sphere warp** (`cube = tan(s * PI / 4)`, general knowledge): contra Astra,
   standard gnomonic projection (`normalize(1, u, v)`) shrinks corner cell areas by $3^{-3/2} \approx 5.2\times$ and
   linear edges by $2.6\times$, wasting over half the triangle budget at cube corners. **Where I disagree with Claude on
   L7 precision:** Having each leaf add a float32 tangent-plane + curvature offset to its own camera-relative centre
   fails in two ways: (1) at coarse orbital levels (levels 0–3), a polynomial tangent expansion diverges from the
   sphere and from neighbouring patches of different levels by kilometres; (2) at $2\text{ m}$ eye height on a
   $6{,}371\text{ km}$ sphere, two adjacent leaves have different centres $\mathbf{O}_A \neq \mathbf{O}_B$, so
   $\mathbf{O}_A + \Delta\mathbf{p}_A \neq \mathbf{O}_B + \Delta\mathbf{p}_B$ by 1–2 float32 ULPs along shared edges,
   reopening cracks!
   **The exact fix:** Give every vertex a **canonical integer cube-lattice coordinate** $\mathbf{q} = (q_x, q_y, q_z) \in [-L_{\max}, +L_{\max}]^3$ ($L_{\max} = 32 \times 2^{19} = 16{,}777{,}216 < 2^{24}$, exact in `i32`/`f32`, as proven in `contender-b/cube-sphere.ts`). After folding any `coarserEdges` odd index (`a & ~1`), compute the unit sphere direction $\mathbf{d}(\mathbf{q})$ and evaluate $(\mathbf{d} \cdot R - \mathbf{C}_{\text{cam}}) + \mathbf{d} \cdot h$ in the vertex stage using a **double-single (`hi/lo` float32 pair)** for the camera position and radius (~15 `fma` instructions). Because the formula depends *only* on the canonical integer lattice point $\mathbf{q}$ and global camera uniforms—never on which patch owns the vertex—shared edge and cube-corner vertices across any two patches or faces are **bit-for-bit identical** from $2\text{ m}$ to orbit, with $48\text{-bit}$ ($\approx 0.02\text{ mm}$) Earth precision. Apply the same camera-relative `hi/lo` offset to 3D wave phase coordinates $\mathbf{k}_i \cdot (\mathbf{p} - \mathbf{C}_{\text{cam}}) + \phi_{i,\text{cam}}$ (where $\phi_{i,\text{cam}} = (\mathbf{k}_i \cdot \mathbf{C}_{\text{cam}} - \omega_i t) \bmod 2\pi$ is computed in CPU Float64). **Falsifier:** At $R = 6{,}371\text{ km}$ and $2\text{ m}$ eye height right on a 3-face cube corner, move the camera $1\text{ mm/frame}$ for 300 frames; fail if `crackPixels > 0` or max screen-space vertex jitter vs. a CPU Float64 reference exceeds `0.05 px`.

9. **Performance foundation.** Measure from day one in `lod-surface-baseline`: per-pass hardware WebGPU timestamps
   (`surfaceGpuMs` p50/p95), `selectionMs` p50/p95, steady-state heap allocation count (assert `0`), `drawnLeaves`,
   `triangles`, `drawCalls` (assert `=== 1` per pass), `pixelsPerTriangle`, `crackPixels` (assert `=== 0`), and
   `poppingScore`. **Keeping iGPU numbers honest (L6):** At $2560 \times 1440$, full-screen bandwidth alone on an
   integrated AMD GPU consumes $\sim 0.8\text{ ms}$ per pass; define the L6 low-end profile explicitly at **$1920 \times
   1080$ (or $0.67\times$ render scale), $N = 16$, `cellPixels >= 6`, `maxLeaves = 192`, with a surface GPU gate of
   `<= 1.8 ms p95`** inside the $16.67\text{ ms}$ (60 fps) frame. Always assert `adapterInfo` in saved JSON artifacts
   to reject headless/SwiftShader numbers, and record an empty-pass baseline in M0 to separate three.js submission
   overhead from surface cost. **Falsifier:** Validate the backstop crack probe by intentionally disabling `coarserEdges`
   masking on one edge and asserting `crackPixels > 50` before trusting a `0` reading.

10. **Water itself.** **Contra Astra, do not start with vertical-only sine waves:** 4 to 6 directional **Gerstner
    (trochoidal) waves** in the vertex stage cost only two extra `fma` ops per wave, sharpen crests realistically, are
    guaranteed non-self-intersecting when $\sum Q_i k_i A_i < 1$, and evaluate in 3D world directions $\mathbf{k}_i$
    projected onto the local surface tangent frame so spheres have zero pole singularities. Pair vertex waves with 1–2
    analytic high-frequency fragment-normal octaves. **Far filtering:** Analytically attenuate wave normal slopes when
    wavelength $2\pi / k_i$ approaches the pixel footprint $\Delta x$, transferring the filtered slope variance
    $\sigma^2 = \sum (k_i A_i)^2 (1 - e^{-(k_i \Delta x)^2})$ directly into GGX specular roughness
    $\alpha_{\text{eff}} = \sqrt{\alpha_0^2 + \sigma^2}$ (LEAN/Toksvig variance mapping, general knowledge) so the
    horizon never shimmers. **Shading:** Schlick Fresnel ($F_0 = 0.02$) mixing sky reflection + GGX sun glint with a
    Beer-Lambert depth-absorption ramp (using scene depth minus water vertex depth, fading alpha and adding a shoreline
    foam band over the last $0.3\text{ m}$—no scene-colour refraction copy needed in M3). **CPU twin:** Identical
    TypeScript Gerstner evaluation in Float64, using **2 fixed-point iterations** ($\mathbf{p}_{k+1} = \mathbf{x} -
    \Delta\mathbf{x}_\perp(\mathbf{p}_k, t)$) to invert horizontal Gerstner displacement at Jolt buoyancy sample points to
    $< 1\text{ cm}$ accuracy. **Falsifier:** Headless parity spec asserting GPU vs. CPU height/normal agreement within
    `1e-3 m` across 1,000 random sphere points, plus a horizon camera pan checking specular pixel variance.

11. **Biggest risk and cheapest early test.**
    - **Biggest risk:** The interaction between **Earth-scale camera-relative precision, canonical cube-face seams, and
      vertex-folded 2:1 edges** during morphing on the $6{,}371\text{ km}$ sphere at $2\text{ m}$ eye height.
    - **Cheapest early test (M1 day-1 spike, $< 150$ LOC):** Place the camera at $2\text{ m}$ eye height over a 3-face
      cube corner of a $6{,}371\text{ km}$ sphere with a forced 2:1 LOD edge across the seam, an analytic wave height
      source, and the magenta backstop sphere $0.5\text{ m}$ below. Sweep `morph` from $0 \to 1$ while translating the
      camera $1\text{ mm/frame}$. **Falsifier:** Any `crackPixels > 0` or screen-space vertex jitter $> 0.05\text{ px}$
      immediately falsifies the vertex positioning/folding math before a single water shader or criterion is written.

12. **What to cut from Plan 059 so M1 lands within a few days.**
    - **Collapse M0 into M1:** Do not build a throwaway uniform-grid renderer for M0; the instanced quadtree renderer
      with `maxLevel = 0` *is* the M0 uniform baseline.
    - **Defer the unbounded sliding plane and fine-reference popping pass to M2:** Ship M1 with the 1-root bounded plane
      and 6-root sphere (10 km, 600 km, 6,371 km), distance criterion only, canonical `hi/lo` vertex positioning, 4-bit
      edge folding, debug colours/wireframe, GPU pass timers, and the backstop crack probe.
    - **Cut the PDE compute wave-equation solver from M4:** Solving a 2D hyperbolic wave PDE on a moving grid brings CFL
      instability and boundary reflection bugs. Replace it with **decaying analytic ring/wake stamps** accumulated into
      the writable height texture—sharing 100% of the compute-stamp code path with terrain edits.
    - **Park Plan 057's 4-contender race (D10):** M3's Gerstner + filtered-normal surface *is* Plan 057 Contender A;
      build it cleanly here first.

### Astra

**Preferred design: a bounded, CPU-selected 2:1 quadtree, with one reusable instanced grid and separate plane and
cube-sphere mappings, implemented fresh in TSL for WebGPURenderer 0.186.** Share surface sampling and rendering
between water and terrain; do not make simulation, collision or Earth-scale precision prerequisites for the first demo.

I formed this view before reading Claude's section. These are design hypotheses, not measured results. Uncited
mathematical/rendering principles below are **general knowledge**; budgets and implementation choices are proposals.

1. **Structure.** Use the same patch topology for a finite plane and six sphere faces; initially try 16 x 16 cells.
   Keep domain mapping separate from selection. I disagree with "clipmaps can only express distance": their regular
   nested layout favors camera-local detail, but that is not a proof that other criteria are impossible. The
   [original GPU clipmap description](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry)
   supplies useful architectural context, not modern performance evidence. Quadtree flexibility seems worth its
   bookkeeping here. **Falsifier:** at matched image error, sweep sparse feature regions and ground-to-orbit views;
   reconsider if balancing/selection consumes the CPU allowance. Do not build a competing renderer before that happens.

2. **Criteria.** Separate geometric error, requested detail and priority. Project a conservative world-space
   approximation error into pixels; include sphere curvature and height residual, not just amplitude. Equal-amplitude
   waves with different wavelengths need different sampling. Begin with disc/box regions carrying target cell size
   and priority; horizon importance tightens a silhouette tolerance. A budget is a constraint: admit a split only if
   its balancing and transition costs fit, otherwise retain valid coarse coverage and report unmet requests. Global
   scaling of every target can erase the feature the player cares about. **Falsifier:** compare both policies under
   overload; measure worst feature error, total error, leaf churn and selection time, including narrow ridges and
   short waves that fall between sample points.

3. **Transitions.** Use a short, reversible timed *geometry morph* for all split causes, with hysteresis for
   selection. New children begin on the parent's actual piecewise-linear triangles, including its displacement;
   resampling the height function at a new point does not reproduce that triangle. Publish four children together;
   merge only after they converge. Shared boundary morph states must be coordinated, and conflicting topology
   changes deferred. Avoid alpha crossfades and overlapping parent/child surfaces. **Falsifier:** freeze camera and
   wave time, toggle a feature repeatedly, and reverse mid-transition; measure boundary separation, depth jumps and
   transition occupancy. Distance-only zooms cannot validate this rule.

4. **Cracks.** Try edge collapse with one index buffer, but specify equality of the **final displaced 3D boundary**,
   not merely matching UVs. Nonlinear sphere projection, height filtering and unequal morph states can defeat a
   seemingly correct fold. Define canonical face-edge/corner coordinates and one shared boundary evaluation; test
   all 16 coarser-edge masks, face orientations and transition phases. Normals need seam checks too. One draw is a
   useful hypothesis, not an acceptance requirement: permit a few stitched-index batches if demonstrably simpler
   and within budget. **Falsifier:** exhaustive small boundary fixtures plus grazing raster views; compare their
   cost with folding before selecting a fallback. Skirts should not conceal failed continuity.

5. **Selection.** Start with CPU traversal of a bounded tree using pooled arrays; count visited nodes, not only
   output leaves. Add incremental scheduling if the measurements justify its invalidation complexity. Keep parents
   drawable while work is deferred; bound split/balance work during teleports and feature changes. There is no
   defensible universal leaf count at which compute wins. **Falsifier:** sweep hundreds through thousands of leaves
   on both adapters, including rapid motion; measure selection, balancing, buffer uploads and total frame time.
   Consider GPU selection only after a repeatable CPU bottleneck, accounting for dispatch and synchronization cost.

6. **Live or baked heights.** Support analytic and texture-backed material variants; avoid evaluating unused source
   branches. Live evaluation is not free: include parent samples, normals and every render pass. For first edits,
   prefer one small CPU-authoritative height array uploaded when dirty; defer compute simulation. Specify coordinate
   conventions, interpolation, border samples, time and data version. CPU/GPU function parity does not prove parity
   with rasterized triangles or a separately sampled collider. **Falsifier:** compare live/baked cost at equal error,
   and separately measure source parity, rendered-surface error and edit latency. GPU-owned updates require a mirror
   or versioned asynchronous readback; they cannot simply promise an immediate synchronous CPU twin.

7. **Water and terrain.** "Frozen water" describes a reusable heightfield renderer, not a reusable world system.
   Water additionally needs temporal filtering, reflection and possibly transparency; terrain needs persistent edits,
   stable contact geometry and local error bounds. Terrain also exposes transition motion that waves can hide.
   Share domain, patch topology and source contracts, leaving those policies outside. Keep v0 displacement strictly
   normal to the base surface; sideways waves add inversion and folding concerns. **Falsifier:** put an edited ridge
   and a time-varying wave through the same renderer, comparing stationary silhouettes and query error. If one source
   needs branches throughout selection, shrink the shared contract.

8. **Sphere.** Start with normalized cube coordinates; an equal-angle warp needs evidence of improved error per
   triangle. Camera-relative patch origins alone do not fix cancellation inside GPU sphere evaluation. WGSL uses
   [IEEE binary32 for f32](https://www.w3.org/TR/WGSL/#floating-point-types); my calculation gives 0.5 m spacing near
   6,371,000 m. Require a stable patch-local evaluation, checked against a double-precision reference, rather than
   assuming a tangent-plus-curvature approximation is adequate at every patch size. Horizon culling must use a
   conservative inner occluder and displaced patch bounds. **Falsifier:** sub-centimetre camera moves, rebases, all
   face corners and orbit silhouettes; compare culling on/off. Make Earth precision a small separate spike, not M1's gate.

9. **Performance foundation.** Keep 0.2 ms CPU and 0.5 ms GPU p95 as provisional reference budgets. For an explicitly
   specified 1280 x 720 iGPU preset, propose <= 2 ms surface GPU p95, alongside the whole-scene 16.7 ms target; an
   empty demo reaching 60 fps proves little. Record p50/p95/p99, cold compilation, uploads, allocations, memory,
   transitions, per-pass costs, adapter/browser, resolution and power conditions. Use warmed visible-browser runs,
   paired ABAB comparisons and a sustained run; headless checks correctness only. Missing GPU timestamps mean
   "unmeasured", not zero. The [test runner](../../projects/triangular-engine/docs/testing.md) requires host-supplied
   metrics. **Falsifier:** test these budgets with representative scene load. Validate crack probes using injected
   gaps and valid silhouettes; a backstop can leak at legitimate boundaries. Measure pops with frozen waves and
   reprojection/reference coverage so camera motion is not counted as LOD instability.

10. **Water.** Begin with four long sine waves displacing only along the base normal, analytical derivative normals,
    Fresnel sky reflection, rough sun glint and a constant body tint. Add depth tint only when a depth source is
    budgeted. Remove unresolved wave detail according to geometric/pixel footprint, with residual roughness for
    distant highlights. Use the same parameters and time on CPU for buoyancy, with stated numerical and rendered
    approximation tolerances. For spheres, test a smooth global scalar field before inventing local tangent wave
    charts. **Falsifier:** slow horizon pans, crest silhouettes, face-edge crossings and floating probes. Add Gerstner
    only if visual review demands it; its displaced horizontal coordinates require inversion for world-position queries,
    not just the same forward sum on CPU.

11. **Biggest risk.** Seam coordination across balancing, morphing and nonlinear domain mapping could turn this
    "small core" into another long terrain project. Cheapest early test: two unequal neighbors and a three-face
    corner, with a ridge crossing the boundary, reversed morphs and an edit during transition. Sweep phases against
    a double-precision geometric reference and inspect actual WebGPU raster coverage. **Falsifier:** any unexplained
    hole or boundary jump blocks expansion; simplify the transition rule or test stitched batches before adding water
    effects. Runbook 028's [history](../runbook/028_planet_terrain_attempt_history.md) makes seams, coordinate consistency
    and measured cost the relevant lessons; none of its code is a dependency.

12. **Cut.** M1 should be a bounded plane and one 10 km sphere, distance-driven cell density, fixed patch cap, static
    crack closure, colors/wireframe, basic timings and one scripted zoom. Clearly label pops and defer their gate.
    Cut unbounded-plane streaming, the full radius/pose matrix, production entry points, horizon refinement,
    feature textures, compute ripples and colliders from that delivery. Keep a separate tiny transition fixture
    before M2, and a simple static height bump before polished water. Leave Plan 055 untouched and park 057's race.
    **Falsifier:** if this cannot show correct visible refinement within a few days, the scope or seam design is still
    too large; do not answer by adding another renderer or a broader framework.

## Consensus proposals (round 2)

**What this round is for.** Instead of one consensus written by Claude, each reviewer writes its own consensus
from all three reviews above. The owner then compares the three. Write **before** reading the other round-2
proposals, in your own subsection only, about one page.

**Prompt given to Argon and Astra (round 2):**

```text
Round 2 of the review in D:\code\triangular-workspace\docs\plans\059_lod_surface_review.md.
Your reviewer name is <Argon | Astra>. Follow AGENTS.md (do not commit, do not name private or consumer repos).

1. Read all three round-1 reviews in that file (Claude, Argon, Astra), including your own.
2. Do NOT read the other reviewers' round-2 subsections under "Consensus proposals (round 2)" before you have
   written yours.
3. Write your consensus proposal in your own subsection only ("### Argon (round 2)" or "### Astra (round 2)" under
   "Consensus proposals (round 2)"), about one page, with these parts:
   a. Agreed: the points all three reviews support, as decisions the plan can take.
   b. Changed my mind: where another review convinced you, and why.
   c. Still disputed: each remaining disagreement, the options, your recommendation, and the measurement
      that would settle it.
   d. Revised first steps: what M1 contains, and the first spike to run before or alongside it.
   e. Owner decisions: the short list only the owner should settle.
4. Check facts you rely on against the code or docs (you may read any code). Cite web sources if you use any;
   mark general knowledge as such.
Do not edit any other section, the plan, or any code. Do not commit.
```

### Claude (round 2)

Written before reading the other round-2 proposals. Facts checked: contender B's `leaf-select.ts` does build `Map`s
keyed by string ids every call and reaches `Math.atan` through `leafAt` inside neighbour probes; `cube-sphere.ts` has
`LEAF_CELLS = 32`, `MAX_LEVEL = 19`, so its lattice spans ±2^24, still exact in float32.

**a. Agreed (all three).**
1. One 2:1-balanced quadtree for plane and sphere (1 root for a bounded plane, 6 cube faces), drawn as one shared
   instanced grid with per-leaf data in one buffer. No clipmap renderer, no projected grid, no GPU-driven trees.
2. Selection on the CPU over a pooled, typed-array tree with no per-frame allocation. GPU selection only after a
   repeatable CPU bottleneck is measured on both adapters.
3. Cracks closed by folding odd edge vertices next to a coarser neighbour, one index buffer, **no skirts**. The test
   is equality of the final displaced 3D positions, not of UVs, across all 16 masks, cube edges and corners.
4. Live height evaluation is the primitive; a baked texture is just another source. Shading, transparency, physics
   and edit policy stay outside the core.
5. The crack probe is trusted only after it reports a deliberately injected gap.
6. Every suite runs on both adapters; headless and SwiftShader numbers are never timings.
7. Plan 055 untouched; Plan 057's race parked (D10).

**b. Changed my mind.**
- **Budget:** globally scaling every target can starve the ground under the camera (Argon, Astra). Replace it with
  greedy splitting by priority under a leaf cap, keeping valid coarse coverage and reporting unmet requests.
- **Pixel floor:** a 2 m feature seen from orbit must not refine below a pixel or two (Argon). The target cell size
  is clamped from below by distance x pixel angle x about 2 px.
- **Precision:** my "tangent plane plus curvature offset from each leaf's centre" is wrong. Different leaf centres
  round differently, so shared edges can crack (Argon), and a fixed expansion is not adequate at every patch size
  (Astra). Positions must come from canonical lattice coordinates and global camera uniforms only.
- **Water ripples:** no wave-equation solver; decaying analytic stamps into the writable height texture (Argon),
  which shares the terrain-edit path.
- **First edits:** a small CPU-authoritative height array uploaded when dirty (Astra), so the CPU twin is exact.
- **M0** merges into M1 (Argon): the instanced renderer at max level 0 is the uniform baseline.

**c. Still disputed.**

| Topic | Options | My recommendation | Settled by |
|---|---|---|---|
| Transitions | Distance morph + fade (Claude); morph from priority ratio + 150 ms ramp on jumps (Argon); timed morph for every split, children start on the parent's triangles (Astra) | Argon's, with Astra's requirement met by moving odd vertices to the average of their even neighbours' heights at the morph end, so a new child starts exactly on the parent triangles. Not in M1 | Astra's transition fixture: frozen camera and time, toggle a feature, reverse mid-way; boundary separation and depth jumps |
| Earth precision | hi/lo camera and radius over lattice directions (Argon); separate spike, not an M1 gate (Astra) | A separate spike alongside M1. Note a gap in the hi/lo proposal: a float32 unit direction is itself off by about 6e-8, i.e. ~0.4 m at 6,371 km, which no camera split fixes; the direction (or a patch-local delta of it) needs extended precision too | The corner spike below against a float64 reference |
| Cube warp | Equal-angle (Argon, Claude); plain normalised until shown better (Astra) | A toggle from day one; it is one line | Spread of pixels per triangle and cell area across a face |
| Displacement | vec3 in the contract (Argon); normal-only in v0 (Astra) | vec3 in the contract (no cost when sideways is zero), normal-only waves first; Gerstner a toggle judged by owner review, with CPU inversion for queries | Visual review plus the buoyancy parity spec |
| Grid size | 16 (Astra), 32 (Argon) | Toggle 16/32/64; default from measurement | Pixels per triangle and surface ms on both adapters |
| iGPU preset | 1080p, ≤ 1.8 ms (Argon); 720p, ≤ 2 ms (Astra) | Owner call; both are runnable profiles | Whole-scene frame time on the iGPU |

**d. Revised first steps.**
- **M1 (a few days):** `/lod-surface-lab`, a bounded plane and a 10 km and a 600 km sphere, distance criterion with the
  pixel floor, a leaf cap, edge folding, LOD colours and wireframe, GPU pass timers, counters (leaves, triangles,
  draws, pixels per triangle, selection ms), the validated crack probe and one scripted zoom. Pops allowed and
  labelled. Out: unbounded plane, features, horizon, blending, water, terrain, colliders, entry points.
- **Spike alongside M1:** Argon's three-face cube corner at 2 m on a 6,371 km sphere with a forced 2:1 edge across
  the seam and a wave source; camera moving 1 mm per frame; fail on any crack pixel or more than 0.05 px jitter
  against a float64 reference.
- **Then M2:** priority selection under the cap, features, horizon, and the transition fixture before transitions.

**e. Owner decisions.** The iGPU preset (resolution and budget); whether Earth-scale precision is a requirement of
this track or only a spike (the first users may never need it); sines or Gerstner for water v0 if the visual review
is split.

### Argon (round 2)

#### a. Agreed (decisions Plan 059 can lock in now)

- **Fresh WebGPU-only TSL track (`D1`–`D3`, `D8`, `D10`, `D11`):** Build fresh in `projects/demo-app/src/app/pages/lod-surface-lab/` first (promote to a library entry point only after M2 passes); leave Plan 055 untouched; park Plan 057's 4-contender race until M3 stands; keep the globe-to-map morph out of v1.
- **One 2:1-balanced patch quadtree drawn as one instanced grid (`D4`, Q1):** Use the same quadtree selector and reusable $N \times N$ patch grid ($N \in \{16, 32, 64\}$ as a measured toggle) for both plane and 6-face cube-sphere. Reject clipmap rings, screen-space projected grids, and GPU CBT for v1.
- **CPU selection with pooled flat arrays and zero steady-state allocations (Q5):** Keep selection on the CPU (`<= 0.2 ms` main-thread p95 target), writing per-leaf data into one contiguous instance/storage buffer. Defer GPU compute selection and indirect draws unless measured CPU time misses budget.
- **Vertex-stage edge folding, zero skirts (Q4):** Close 2:1 LOD boundaries in the vertex stage from a 4-bit `coarserEdges` mask per leaf with one shared index buffer (1 draw call per pass) and canonical shared-edge evaluation. Never use skirts.
- **Strict boundary on "terrain is frozen water" (Q6, Q7):** Share only the geometric LOD core (domain, selector, crack-free instanced mesh, and the `HeightSource` displacement/normal/bounds interface supporting both live analytic and dirty-updated texture sources). Keep water shading/transparency, terrain relief pyramids, persistent edits, and Jolt colliders/buoyancy outside the shared core.
- **Water v0 before terrain, with filtered far normals (Q10, Q12):** Build water first; filter unresolved distant wave slopes into GGX specular roughness so the horizon stays stable; strip M1 down to distance-only refinement, debug views, hardware timers, and static crack closure.
- **Dual-GPU harness discipline (Q9):** Gate on both the RTX 3080 Laptop GPU (`2560 x 1440`) and an explicitly lower-detail AMD iGPU profile in `visible-browser` runs; reject headless/SwiftShader timings; validate the crack probe with injected gaps before trusting `0`.

#### b. Changed my mind (where Claude and Astra convinced me)

1. **Wave curvature/wavelength in the split metric, not amplitude alone (Astra Q2):** In round 1, Claude and I treated water's vertical bound as a single amplitude number $\pm A_{\max}$. Astra rightly noted that equal-amplitude waves of different wavelengths need different tessellation: geometric chord sag across a cell of width $s$ scales with $\sum_i A_i \min(1, (k_i s)^2 / 8)$ (general knowledge). Using wavelength-aware chord sag lets long ocean swells stay coarse while short chop refines.
2. **Coordinated 4-sibling transitions and boundary morph locking (Astra Q3, Q4):** Astra convinced me that independent per-leaf morphing and resampling a nonlinear height source at morphed UVs can separate shared boundaries or jump off the parent's piecewise-linear triangle at the split instant. We do not need duplicate per-vertex parent height buffers to fix this: promote/demote the 4 children of a parent as a unit, lock `edgeMorph = 1` on `coarserEdges`, and in the M2 transition fixture test blending the odd vertex toward the midpoint of its two even grid neighbours (evaluated in the same vertex shader) vs. UV-only morphing.
3. **Crack-probe silhouette hygiene and separating the `6,371 km` spike from M1's initial delivery (Astra Q8, Q9, Q12):** Astra pointed out that an inner backstop sphere can leak false-positive pixels at grazing silhouettes or deep wave troughs, and that `6,371 km` Earth precision should not delay M1's `10 km` sphere visual check. The crack probe should mask out silhouette limb pixels and verify sensitivity via an injected gap, and `6,371 km` precision should run as a focused day-1 spike alongside M1.
4. **CPU-uploaded height texture before GPU compute stamps (Astra Q6):** Starting M4 with a small CPU-authoritative `Float32Array` uploaded via `writeTexture` when dirty gives an immediate synchronous CPU twin for colliders and queries before adding GPU compute stamps.

#### c. Still disputed (options, recommendation, and deciding measurement)

| # | Disputed point | Options | Recommendation & measurement to settle |
|---|---|---|---|
| 1 | **Sphere precision & shared-edge math at 6,371 km (Q4, Q8)** | **A (Claude):** CPU Float64 leaf centre + GPU f32 tangent+curvature offset.<br>**B (Argon):** Canonical integer lattice key $\mathbf{q} \in [-L_{\max}, L_{\max}]^3$ + GPU `hi/lo` f32 camera-relative evaluation.<br>**C (Astra):** Patch-local f32 from CPU Float64 anchors, Earth spike deferred. | **Recommend B.** Option A is patch-centre-dependent (diverging at coarse levels and differing by 1–2 ULPs between adjacent leaf centres at $2\text{ m}$ eye height). **Measurement:** 100-line 3-face corner + 2:1 seam fixture at $R = 6{,}371\text{ km}$, $2\text{ m}$ eye height, $1\text{ mm/frame}$ pan; compare `crackPixels`, screen-space jitter vs. Float64 reference, and vertex GPU `ms` between A and B. |
| 2 | **Cube-sphere warp (Q8)** | **A (Claude, Argon):** Equal-angle (`tan(s * PI / 4)`).<br>**B (Astra):** Normalized gnomonic cube (`normalize(1, u, v)`). | **Recommend A** (gnomonic shrinks corner cell area $5.2\times$, general knowledge; equal-angle is already proven in [cube-sphere.ts](file:///d:/code/triangular-workspace/projects/demo-app/src/app/pages/planet-shape-lab/contender-b/cube-sphere.ts#L54-L69)). **Measurement:** ABAB toggle on the $10\text{ km}$ sphere at fixed `cellPixels`; compare triangle count, max chord error (px), and GPU `ms`. |
| 3 | **Budget overload & feature clamping (Q2)** | **A (Claude):** Scale all target cell sizes up by one factor.<br>**B (Argon):** Clamp features by a $\ge 2\text{ px}$ screen floor + expand a max-heap by priority $\rho$.<br>**C (Astra):** Priority admission that holds coarse cover and reports unmet requests. | **Recommend merging B + C** (priority-heap expansion with a $2\text{ px}$ floor and an `unmetSplits` counter). Global scaling (A) lets distant features degrade camera-nadir detail. **Measurement:** Ten `2 m` feature discs on a $600\text{ km}$ sphere during a ground-to-orbit zoom under a 256-leaf cap; compare nadir cell size, worst feature error, leaf churn, and `selectionMs`. |
| 4 | **Water v0 wave displacement (Q7, Q10)** | **A (Claude, Argon):** 4–6 3D Gerstner waves with lateral displacement $(\Delta u, \Delta v, \Delta h)$ and 2-step CPU inversion.<br>**B (Astra):** Normal-only sine waves ($\Delta h$ only) in v0. | **Recommend A with `choppiness` $Q \in [0, 1]$ as an ABAB uniform.** $Q = 0$ *is* Astra's normal-only sine wave, so one shader tests both. **Measurement:** In M3, compare $Q = 0$ vs. $Q = 0.7$ on GPU `ms`, CPU buoyancy inversion error ($< 1\text{ cm}$), and owner visual sign-off. |
| 5 | **Default grid resolution $N$ (Q1)** | $N = 16$ (Astra), $N = 32$ (Argon), or $\{16, 32, 64\}$ toggle (Claude). | **Recommend exposing `patchCells: 16 | 32 | 64`** in M1 (`32` default on dGPU, `16` on iGPU). **Measurement:** M1 sweep at matched screen cell size; lock the $N$ with lowest `surfaceGpuMs + selectionMs`. |

#### d. Revised first steps (spike + M1)

1. **Day-1 Seam & Precision Spike (`< 150` LOC, before/alongside M1):** A minimal 4-patch fixture at a 3-face cube corner with one 2:1 edge, testing all 16 `coarserEdges` masks and comparing Option A (leaf-centre tangent+curvature) vs. Option B (canonical lattice + `hi/lo` camera-relative evaluation) at $R = 10\text{ km}$ and $R = 6{,}371\text{ km}$, using an injected-gap control and interior backstop crack counter.
2. **M1 (`2–3` days, folding M0 into M1 as the `maxLevel = 0` toggle):**
   - `/lod-surface-lab` and `lod-surface-baseline` v1 recording empty-pass baseline, `surfaceGpuMs` p50/p95, `selectionMs` p50/p95, `drawnLeaves`, `triangles`, `drawCalls` (`=== 1`), `pixelsPerTriangle`, and `crackPixels` (`=== 0`) on both the RTX 3080 Laptop GPU and the AMD iGPU.
   - Zero-allocation pooled-array CPU quadtree selector with 2:1 balance, wavelength/sag-aware distance criterion, and fixed `maxLeaves` cap (`maxLevel = 0` uniform baseline vs. adaptive LOD).
   - 1-root bounded plane (`100 km`) and 6-root sphere (`10 km` and `600 km`, plus `6,371 km` from the day-1 spike), static `coarserEdges` vertex folding, and debug LOD colours/wireframe/bounds. Defer morphing/popping gates, feature/horizon criteria, and unbounded-plane streaming to M2.

#### e. Owner decisions needed

1. **D4 / Budget policy (Disputed #3):** Under leaf-budget overload, should the selector priority-fill the highest-error leaves (reporting `unmetSplits`) or scale all target cell sizes up uniformly?
2. **D6 / D7 (iGPU low-end preset):** Confirm the RTX 3080 reference budget (`<= 0.5 ms` GPU / `<= 0.2 ms` CPU p95 at `2560 x 1440`) and choose the AMD iGPU low-end target (`1280 x 720` vs. `1920 x 1080`, `N = 16`, `maxLeaves = 192`, `<= 1.8–2.0 ms` surface GPU p95).
3. **D8 (Location & entry-point names):** Confirm building in `projects/demo-app/src/app/pages/lod-surface-lab/` through M2, then promoting to `triangular-engine/lod-surface`.
4. **D9 (`6,371 km` sphere gate timing):** Gate `6,371 km` precision in M1 (using the day-1 `hi/lo` lattice spike) or in M2 after `10 km` / `600 km` pass?
5. **D10 (Plan 057 race):** Confirm parking Plan 057's 4-contender race until M3 (Gerstner water v0 on this core) is evaluated.

### Astra (round 2)

**Agreed.** Adopt a fresh WebGPU/TSL CPU-selected 2:1 quadtree, one bounded plane root and six sphere roots,
shared instanced patch geometry, and edge folding as the first crack-closure candidate without skirts. Share domain,
selection and height sampling; keep water shading, simulation and physics outside. Analytic and texture-backed
sources both fit. Begin with distance-only refinement, debug colours and instrumentation; defer blending beyond
M1. Measure both adapters on real hardware; headless runs establish correctness. These are shared directions,
not agreement on every implementation or budget.

**Changed my mind.** Claude and Argon persuade me to start with an equal-angle cube mapping: reducing face-wide
variation is a worthwhile default, while matched-error measurements still decide its value. I do not adopt
Argon's inference that corner distortion necessarily wastes over half the total budget. The inspected
[domain implementation](../../projects/demo-app/src/app/pages/planet-shape-lab/contender-b/cube-sphere.ts)
confirms the mapping and canonical-coordinate lesson; it is reading material only, with no code reuse.
I also adopt Argon's combined M0/M1: the same renderer at fixed level supplies a uniform baseline, removing a
separate delivery. A fixed level can be above zero when useful for comparisons.

**Still disputed.** The following are proposals, not measured results. Numerical and geometric reasoning here is
**general knowledge**; no new web sources were used.

- **Criteria and budget:** Claude's global target scaling versus Argon's ratio-ranked splits versus explicit
  feature priorities. Recommend target cell sizes for requests, separate geometric-error bounds and importance,
  and atomic split admission including balance/transition costs. A screen-footprint floor is useful for ordinary
  requests, but must not silently override a required silhouette/error tolerance. Report unmet requests.
  Compare worst feature/silhouette error, churn and CPU p95 under an overloaded fixed cap; distance alone is
  insufficient evidence.
- **Transitions and draws:** distance/ratio-driven coordinate folding versus timed parent-triangle morphing;
  mandatory one draw versus a small stitched fallback. Keep my reversible timed morph and coordinated boundaries.
  Matching a parent triangle does **not** require stored parent heights: its vertices can be sampled at the current
  time and interpolated, with a cost to measure. Argon's two-neighbour height average is insufficient evidence for
  interior parent triangles or nonlinear sphere positions. Test a diagonal ridge, live edits, unequal neighbours
  and reversed feature toggles through all edge masks; compare final 3D boundary equality, depth jumps and GPU
  p95. Try one-draw folding first; allow stitched batches if they pass these checks more simply within budget.
- **Earth precision:** patch-local evaluation versus canonical hi/lo evaluation. Canonical identity is necessary
  for the proposed shared evaluation, but does not establish absolute accuracy. In the linked code,
  `32 * 2^19 = 2^24`, not less; the endpoints remain exactly representable. Its direction calculation uses
  JavaScript numbers, not proof of a GPU double-single pipeline. Hi/lo radius and camera cannot recover error
  already introduced by float32 direction normalization/warping. Recommend an end-to-end numerical spike before
  choosing either formula: shared-edge equality and screen error against a CPU double reference, at ground and
  orbit, with millimetre camera steps. Keep Earth precision outside M1's acceptance gate pending owner scope.
- **Water and height authority:** normal-only sine waves versus lateral Gerstner; CPU-owned edits versus compute
  updates. Retain a scalar source first; compare Gerstner later on crest quality, GPU cost and world-position query
  residual, not arithmetic count alone. Two inversion iterations cannot guarantee centimetre accuracy without
  amplitude/contraction bounds. Require explicit source time/version and query tolerance; begin texture edits
  CPU-authoritatively, or budget a versioned mirror for GPU ownership. Measure next-frame visibility and query lag
  separately. Defer the wave PDE; analytic wake stamps can be a later option. Neither a min/max hierarchy nor a
  collider adapter belongs in the first mesh delivery.
- **Cost and scheduling:** full pooled traversal versus incremental traversal, 16 versus 32 cells, and competing
  iGPU presets remain experiments. Start at 16 cells with bounded CPU work; compare 32 at matched image error.
  Add incremental selection only if total selection/balancing/upload cost warrants it. No universal GPU crossover,
  wave-evaluation time or bandwidth floor follows from the round-1 evidence. Sweep leaf counts and teleports;
  compare p95 and sustained whole-scene frame time on both adapters. Keep L5 provisional; choose between
  720p/2 ms and 1080p/1.8 ms only with an explicit scene/profile. The
  [testing contract](../../projects/triangular-engine/docs/testing.md) leaves metric providers to the host;
  instrumentation is real M1 work, not an automatic runner feature.

**Revised first steps.** M1 combines harness and distance LOD: bounded plane, 10 km sphere, fixed patch cap,
static edge closure, colours/wireframe, flat and simple static-bump sources, scripted zoom, draw/leaf counts and
CPU/GPU timings. Label popping; defer unbounded streaming, other criteria, polished water, colliders and public API
promotion. Before or alongside it, run one disposable unequal-neighbour/three-face-corner fixture: sweep morphs
and camera motion at 10 km and Earth radius, including a ridge and edit. Validate the crack probe with an injected
gap **and** a valid silhouette; record boundary error separately from raster holes. Stop expansion if seams fail.
A failed Earth case informs scope without delaying a correct small-sphere demo.

**Owner decisions.** Set the supported v1 scale and whether Earth precision blocks delivery; select the iGPU
resolution/scene and CPU/GPU allowances; decide the visual bar for first water and acceptable transition motion;
confirm whether to park Plan 057's race. Keep Plan 055 untouched. Grid size, projection arithmetic and queue
implementation should follow evidence, without another owner vote for each detail.

## Comparison

Written by Claude after all three round-2 proposals were in. Facts the proposals rely on were checked:
- A normalised cube's corner cells are 3^1.5 ≈ 5.2 times smaller than its centre cells (Argon; general knowledge).
- `cube-sphere.ts` evaluates directions in JavaScript doubles (`Math.tan`, `Math.hypot`).
- 32 x 2^19 = 2^24, so the lattice endpoints are exactly representable in float32 (Astra).
- `testing.md` leaves metric providers to the host page (Astra).
- Argon's L5 numbers match Plan 059.

Argon's link to `cube-sphere.ts` is an absolute `file:///` path; it is left as written because this section does not
edit the others.

### Agreed by all three

1. **Base.** Fresh WebGPU/TSL code. Build it in a demo-app lab first. Plan 055 stays untouched.
2. **Structure.** One 2:1-balanced quadtree: 1 root for a bounded plane, 6 for the cube-sphere. It is drawn as one
   shared instanced N x N grid with per-leaf data in one buffer. No clipmap rings, no projected grid, no GPU-built
   tree.
3. **Selection.** On the CPU, over pooled typed arrays, with no per-frame allocation. GPU selection only after a
   measured CPU bottleneck.
4. **Cracks.** Odd edge vertices fold onto a coarser neighbour, using a 4-bit mask. One index buffer, no skirts. The
   test is equality of the final 3D positions.
5. **Budget.** Split by priority under a leaf cap, keep valid coarse cover, and report unmet requests. Global target
   scaling is dropped. A pixel floor (about 2 px) limits ordinary requests. Astra's limit: the floor must not
   override a required silhouette or error tolerance.
6. **Roughness bound.** Water uses a wavelength-aware bound (chord sag), not amplitude alone. Long swells stay
   coarse; short chop refines.
7. **Cube warp.** Equal-angle by default; Astra changed its mind. Keep a toggle, and settle the value by measurement
   at matched error.
8. **Milestones.** M0 merges into M1, and a fixed level is the uniform baseline. M1 uses the distance criterion
   only, and pops are allowed and labelled.
9. **Earth precision.** A spike runs alongside M1. A small sphere must not wait for it.
10. **Crack probe.** Trusted only after it reports an injected gap. Silhouette pixels are masked.
11. **Measurement.** Both adapters, in a visible browser. Headless runs check correctness only.
12. **What the core shares.** Domain, selection and height sampling; analytic and texture sources both fit. Shading,
    simulation, edits policy and physics stay outside.
13. **Edits and ripples.** First edits are CPU-authoritative, uploaded when dirty. No wave-equation solver at first;
    ripples later use decaying stamps.
14. **Splits.** The four children of a parent split and merge together, and edges next to a coarser leaf stay fully
    folded.

### Still different, and what settles it

| Topic | Where each stands | Settled by | When |
|---|---|---|---|
| Transitions | Claude and Argon: a morph driven by the priority ratio, with each odd vertex moving to the average of two even neighbours. Astra: a reversible timed morph onto the parent's triangles. Astra says a two-neighbour average is not enough for interior vertices or for curved sphere positions | Astra's fixture: diagonal ridge, live edit, unequal neighbours, a feature toggled and reversed, all edge masks. It measures 3D boundary equality, depth jumps and GPU p95 | M2 |
| Earth precision formula | Argon: lattice keys plus hi/lo camera evaluation. Claude and Astra: hi/lo cannot repair error already in a float32 direction (about 0.4 m at 6,371 km), so test before choosing | The corner spike against a float64 reference: crack pixels, jitter (fail above 0.05 px), vertex ms | Alongside M1 |
| Water waves | Converging. Argon: Gerstner with choppiness Q as a toggle (Q = 0 is the sine wave). Astra: a scalar source first; two inversion steps do not guarantee 1 cm without bounds. Claude: vec3 in the contract, normal-only first | Q toggle on one shader, Q = 0 first. Then GPU ms, query residual against a float64 solve, and owner visual review | M3 |
| Grid size N | 16 (Astra), 32 (Argon); all agree on a toggle | Sweep at matched screen error: surface GPU ms + selection ms on both adapters | M1 |
| One draw or a fallback | Claude and Argon: one draw is required. Astra: try one draw first, and allow small stitched batches if they pass more simply | The same transition fixture | M2 |

Claude's own round-1 precision scheme (offset from each leaf's centre) was withdrawn in round 2. The spike therefore
compares lattice + hi/lo with and without extended-precision directions, not Claude's scheme against Argon's.

### Owner decisions (merged)

All three name the first two.

1. **Earth scale (D9).** Is 6,371 km precision a requirement of this track, or only a spike that informs scope?
   - Claude and Astra: a spike only, not an M1 gate.
   - Argon: gate it in M1 if the spike passes.
2. **iGPU preset (D6, D7).** 720p within 2 ms, or 1080p within 1.8 ms, with a named scene. Plus the reference budget,
   proposed at ≤ 0.5 ms GPU and ≤ 0.2 ms CPU p95 at 2560 x 1440.
3. **Plan 057 (D10).** Park its four-contender race until M3.
4. **The visual bar.** What counts as good enough for the first water, and how much transition motion is acceptable.
   This includes sines or Gerstner if they look different enough to matter.
5. **Location (D8).** Build in the demo-app lab through M2, then promote to an entry point such as
   `triangular-engine/lod-surface`. All three already assume this, so a yes is enough.

Argon's budget question (D4 in its list) is no longer open: all three now propose priority splitting. Grid size, warp
arithmetic and queue details follow measurement, with no owner vote needed.

### Merged first steps

- **M1** (a few days):
  - `/lod-surface-lab` and suite `lod-surface-baseline` v1.
  - Shapes: a bounded 100 km plane and 10 km and 600 km spheres.
  - Height sources: flat and a static bump.
  - Selection: distance criterion with the pixel floor, a leaf cap, and a fixed-level toggle as the uniform baseline.
  - Toggles: equal-angle warp and `patchCells` 16/32/64.
  - Static edge folding.
  - Debug views: LOD colours, wireframe and bounds.
  - Counters: leaves, triangles, draws, pixels per triangle, selection ms.
  - GPU pass timers and the validated crack probe.
  - One scripted ground-to-orbit zoom, run on both adapters.
- **Spike alongside M1.** It lives in its own folder and is disposable.
  - A three-face cube corner with a 2:1 edge across the seam, covering all 16 masks.
  - Radii 10 km and 6,371 km, a 2 m eye height, and the camera moving 1 mm per frame.
  - A float64 reference and an injected-gap control.
  - Boundary error is recorded separately from raster holes. If seams fail, stop expanding.
- **Out of M1:** blending, feature and horizon criteria, the unbounded plane, water, terrain, colliders and entry
  points.
