---
type: Review
title: Plan 055 meshing review (contenders A and B)
description: Three reviewers (Claude, Argon, Astra) propose how the mesh-based terrain contenders should work, so the owner can settle on one design or a set of contenders for the race.
timestamp: 2026-10-22T00:00:00Z
tags: [terrain, planet, lod, meshing, surface-nets, review]
plans: /docs/plans/055_planet_shape_system.md
---

# Plan 055 meshing review

**What this is for.** [Plan 055](/docs/plans/055_planet_shape_system.md) picks the planet terrain by a measured race
between contenders. The raymarched one (C) exists and passes its first correctness suite. Before the mesh-based
ones (A and B) are built, the owner wants three independent opinions on how they should work, then a consensus,
or a short list of designs that each enter the race as a contender.

**How to take part.** Read §Context, then fill in **your own section only** (§Reviews). Disagree freely, including
with the questions themselves. Say what you would measure to prove yourself wrong. Keep it under about two pages.
Do not edit other sections, code, or the plan; do not commit. Do not name private or consumer repositories.

## Context

### Goals (plan 055 targets, abridged)

- **T1 Frame rate:** 150–160 fps at 2560 × 1440 on an RTX 3080 Laptop GPU (WebGPU, three.js `WebGPURenderer`,
  TSL shaders). Terrain gets **≤ 2.0 ms GPU p95** including its shadow passes, and **≤ 0.5 ms main-thread CPU p95**
  with no per-frame allocations. Workers are budgeted separately.
- **T2/T5 Scale:** planets from 2 km to 6,371 km radius, relief up to 12 km. Fast god-camera zoom from the ground
  to orbit, time warp up to 1,000,000x, no holes, popping storms or rebuild storms.
- **T3 Real-time edits:** flatten a base pad, grow a volcano over seconds (30 updates/s), carve a river, lay a
  road. Visible on the next frame, collidable within **100 ms**. 10,000 ops on a planet stay inside budget.
- **T4 Past vertical:** overhanging cliffs, arches, tunnels and caves (walked through and collided with).
- **T6 Globe to map morph:** the terrain bends from a sphere to a 2.5D flat map, visual only, applied in the
  vertex stage for mesh contenders.
- **T8 One truth:** what is drawn, what Jolt collides with and what gameplay queries return come from one field
  definition, and a spec proves they agree.
- **T10 Fidelity classes:** silhouette features keep their outline (≤ 1 px), contact edits (smallest: a 2 m
  footpath) have ≤ 1 px gap under placed objects at every LOD, coastlines never change topology with zoom.

### What already exists (usable by every contender)

- **The field.** A density function (negative inside rock) built from a noise height field plus a list of
  **shape ops**: height ops (disc, cone, crater, path, with blends `set`, `add`, `grade`…) and volume ops
  (unions and subtractions such as an arch or a tunnel). It has a CPU version (doubles, for colliders and queries)
  and a GPU version (TSL), and parity specs keep them equal. Each op has bounds, so a region can list the ops
  that touch it. The field is not a distance: it is steep in places (the raymarcher trusts slopes up to 4).
- **A reference renderer.** Contender C's slow march draws the true surface; a browser suite
  (`planet-shape-terrain-quality`) compares any renderer's per-pixel depth against it (pixels off the surface,
  behind it, holes, slivers). Mesh contenders are meant to be judged by the same suite.
- **A data-flow core:** GPU job scheduling, upload and readback rings with a measured latency window.
- **Collider blocks (decision D2, in progress):** a separate test measures filling a 32³ density grid on the GPU
  and reading it back, against sampling it on the CPU (about 390 ms per block single-threaded, unoptimised).
  Small surface-nets blocks near moving bodies become Jolt mesh shapes, whichever contender wins.
- **meshoptimizer** is already a dependency.

### Ground rules for designs

- **D14: no code from the earlier terrain attempts** (a CDLOD renderer, a clipmap renderer, the cell planet
  renderers). Their runbooks may be read for lessons; new code is written per contender in its own folder.
- One lab page, one folder per contender, one shared test harness.
- Gates per race round (proposed): R1 budget and zero cracks; R2 fidelity; R3 morph; R4 edits; R5 past vertical
  (plan 055 §Phase 2).

### The contenders as the plan currently states them

| | A. Height shell | B. Near volume + shell | C. Raymarched hybrid (built) |
|---|---|---|---|
| **What** | Cube-sphere patches drawn as instanced grids that read heights from a resident page atlas | A's shell beyond a radius; near the camera, small 3D blocks where volume ops exist, meshed with surface nets, cutting a hole in the shell | A coarse mesh bounding the surface, then a march from its depth |
| **Overhangs** | Authored arch/cave mesh kits placed by ops | Native near the camera, height approximation far away | Native |
| **Edits** | Rewrite affected pages | Rewrite pages, remesh affected blocks | Change the op buffer |
| **Main risk** | Overhangs are second class | Shell/block seam; meshing cost under edits | Per-pixel cost at 1440p; morph inversion; shadows |

### Questions for every reviewer

1. **Shell.** Instanced fixed grids reading a height atlas, per-patch meshes, or meshes generated on the GPU
   (compute writing vertex buffers plus indirect draws)? How are LOD levels chosen on a cube-sphere, and how are
   cracks between levels closed (vertex morphing, skirts, stitching)?
2. **Volume.** Surface nets, dual contouring (sharp edges, needs gradients), transvoxel, or something else? Block
   size and resolution; do blocks have LOD; do they exist only where volume ops are, or everywhere near the camera?
3. **Seam.** How do blocks meet the shell without cracks or double surfaces (hole mask, overlap, skirts)?
4. **Where meshing runs.** GPU compute, CPU workers, or GPU fill plus worker meshing? What reaches Jolt, and how
   fast after an edit?
5. **Vertex memory.** Fixed pools of slots, one big buffer with sub-allocation, or per-mesh buffers? How does it
   behave under a fast zoom from orbit to the ground and under 1,000,000x warp?
6. **Contact fidelity.** How does a 2 m footpath stay exact under a coarse LOD?
7. **meshoptimizer.** Worth it anywhere (simplifying block meshes, vertex cache, meshlets), or not?
8. **Contender set.** Should A and B merge (B with blocks off is A)? Is there a different mesh design that
   deserves its own slot, such as a fully volumetric LOD (octree or clipmap of blocks everywhere)?
9. **Biggest risk** of your preferred design, and the cheapest early test that would expose it.

## Reviews

### Claude (Opus 5.5, the session building plan 055)

**Preferred design: merge A into B.** One contender with a shell and optional near blocks; blocks off is A. Building
both separately means writing the same shell twice, and A's overhang fallback (authored mesh kits) works against
the op system that C and B use natively.

1. **Shell:** one fixed N × N grid mesh drawn instanced, one instance per patch of a cube-sphere quadtree chosen by
   screen error on the CPU (a few hundred patches; fits the 0.5 ms main-thread budget). Heights come from a page
   atlas filled by a GPU compute pass evaluating the field per page, so edits only rebake the pages their op bounds
   touch. Cracks are closed by morphing odd vertices toward the coarser neighbour near patch edges, with skirts as
   a fallback at cube-face seams. Morph (T6) in the vertex stage.
2. **Volume:** surface nets on 32³ blocks, only where volume ops exist and only within a radius of the camera (and
   of moving bodies, for colliders). Two block sizes at most, no full volume LOD. Dual contouring would keep arch
   edges sharper but needs the field's gradient, which the steep blends make noisy; worth a later comparison.
3. **Seam:** the page atlas carries a mask of where blocks own the surface; the shell discards there, and blocks
   extend a cell past the mask so the overlap hides small differences. This is the risk I trust least.
4. **Meshing:** GPU fills the density grid (the D2 test), the readback goes to a worker that runs surface nets and
   builds both the render mesh and the Jolt shape. If the readback latency or worker time breaks 100 ms, move
   meshing itself to GPU compute for rendering and keep the worker path for colliders only.
5. **Memory:** shell needs only the shared grid plus a fixed atlas of pages. Blocks use a fixed pool of slots with
   a vertex cap per slot; overflow falls back to the shell height. No allocation during zoom or warp; a page and
   slot budget per frame stops rebuild storms.
6. **Contact:** the page holds the exact op heights; contact ops force their patch to the finest level near the
   camera and snap edge vertices onto the op footprint, measured by the R2 contact gate.
7. **meshoptimizer:** not needed for the shell (fixed grid). Possibly `simplify` on block meshes for colliders if
   Jolt cost is high; measured first, not assumed.
8. **Contender set:** A+B merged as one; C as it is. I don't see a fully volumetric mesh LOD earning a slot at
   planet scale within the budget, but would accept one if a reviewer argues it.
9. **Risk and test:** the shell/block seam under a moving camera. Cheapest test: one arch, one block, the shell
   with a hole, and the `planet-shape-terrain-quality` suite counting holes and slivers at the seam while orbiting.

### Argon

**Preferred design: merge A into B as a single curvilinear patch-prism architecture ("B-Curvilinear").** A is simply B
with near-volume blocks toggled off (giving a free ablation switch). However, I disagree with **how the prompt frames
B**, with **Claude's seam and worker-render path**, and with **Astra's full-planet Cartesian voxel octree (D)**:

- **Where the question framing is wrong:** The prompt assumes (1) overhangs only exist inside discrete `volume` ops, and
  (2) volume blocks are Cartesian $(x,y,z)$ boxes cutting holes in a $(u,v)$ shell. Both are false in this codebase.
  First, Phase 1's `CANYON_BIOME` (`grounded = 0`, wild 3D noise with vertical stretch, Runbook 055) produces overhanging
  ledges in the base procedural field with zero volume ops, whereas `HILLS_BIOME` (`grounded = 1`) uses a bijective
  tangential warp $\mathbf{q} = \mathbf{p} + \mathbf{w}(\mathbf{p})$ (`||Dw|| <= 0.604`) that produces leaning walls on a
  single 2D topological sheet. Second, cutting Cartesian boxes out of a cubed-sphere UV quadtree creates a self-inflicted
  seam mismatch that vanishes if volume blocks are defined as curvilinear $(u,v,r)$ prisms over the quadtree's own tiles.
- **Where I disagree with Claude:** Atlas hole-masks plus 1-cell overlap (Q3) fail `planet-shape-terrain-quality` (bilinear
  shell triangles and trilinear Surface Nets do not coincide, causing step cracks from one angle and double-surface
  shadow acne from another); cube-face skirts (Q1) cast false shadows and fail depth checks at grazing angles; worker
  render meshing (Q4) cannot meet R4's **next-frame visual edit** gate; and falling back to the height shell on slot
  overflow (Q5) silently buries tunnels and traps the player in rock.
- **Where I disagree with Astra:** A full-planet Cartesian octree of Marching Cubes + Transvoxel (D) slices a spherical
  surface diagonally across all non-polar faces: a $16^3$ block evaluates $17^3 = 4,913$ 3D field samples to extract a
  diagonal 2D sheet that a $17^2 = 289$ shell page captures with **17× fewer field evaluations** and zero dynamic stream
  compaction. Worse, Astra's Q6 mandate to force spatial triangle refinement down to 2 m footprints and coastal channels
  until $< 1\text{ px}$ error at all distances triggers the exact 2:1 balancing explosion across 10,000 ops (R4) that
  Astra admits in Q9 will blow the 2.0 ms GPU / 0.5 ms CPU budgets.

1. **Shell.** One fixed $32 \times 32$ grid mesh drawn in a **single `drawIndexed` instanced call** (plus one shadow
   call), reading from a GPU page atlas baked by a TSL compute pass. Crucially, each page texel stores **patch-local 3D
   displacement** `(heightM, dU, dV, packedNormal)` rather than scalar radial height alone: this lets the 2D sheet
   natively represent `grounded` tangential noise warp (leaning cliffs with zero floaters) and horizontal vertex snapping
   onto contact/coastline edges (Q6). LOD is a 2:1 balanced cubed-sphere quadtree selected incrementally on the CPU
   ($\le 0.3\text{ ms}$ for ~300 visible patches) using prebaked per-tile relief/op bounds (`cell-bake.ts` +
   `op-index.ts`, avoiding Attempt 1's S1 global-elevation bug) and horizon culling (`acos(R/camDist) + margin`).
   Close cracks with **16 prebuilt stitched index buffers** (4-bit coarser-neighbour mask, using canonical shared edge
   parameterization across cube-face seams) plus **interior CDLOD geomorphing** over the outer 20% of each LOD range.
   No skirts anywhere.

2. **Volume.** **Dual-Grid Surface Nets with 1-step gradient-projected vertex placement** inside **curvilinear $(u,v,r)$
   patch prisms** ($32 \times 32$ cells horizontally in $(u,v)$ matching a fine quadtree leaf, by $32$ cells radially
   in $r$, stacked 1–3 high across that tile's active altitude band `bandAt` from `op-index.ts`). Within 2 km of the
   camera on a $\ge 2\text{ km}$ planet, a $32\text{ m}$ $(u,v,r)$ prism is locally orthogonal to within $< 1.5\%$
   ($< 0.005\%$ on Earth) while aligning 1:1 with quadtree leaves. Blocks exist only within the near radius (~1–2 km) on
   quadtree leaves that either intersect a `volume` op **or** have `grounded < 1` (wild canyons), at two LOD tiers
   (fine leaf and $2\times$ parent). Reject regular Marching Cubes (Astra): its sliver triangles degrade stylized
   normals, shadow bias, and Jolt contact stability.

3. **Seam.** **Whole-leaf replacement with shared vertical-root boundary locking—no hole mask, no overlap, no
   triangulated collar.** A fine quadtree leaf is drawn *either* as a 2D shell instance *or* by its $(u,v,r)$ volume
   prism stack, never both. The 1-ring of leaves where a volume zone meets the shell is pinned to 1:1 LOD parity and
   placed where the field is single-valued (outside volume-op caps where `shape-op.ts` is bit-for-bit identity beyond
   $2k$, and across a 2-cell border where `grounded` blends to $1$ around wild canyons). On that shared vertical prism
   face $(u_i, v_j, r)$, every column has exactly one radial sign change. Both the shell page bake and the Surface Nets
   boundary kernel resolve that **same 1D vertical root $r^*(u_i, v_j)$** (4-step bisection between sign-change corners)
   and emit boundary vertices at $(u_i, v_j, r^*)$ relative to the shared double-precision patch-pair anchor. The block's
   outer boundary polyline is therefore **vertex-for-vertex identical** to the adjacent shell patch edge.

4. **Where meshing runs.** Split render and physics to satisfy both **next-frame visual edits** and **$\le 100\text{ ms}$
   colliders**:
   - **Render (100% GPU compute + indirect draw, zero readback):** When an edit lands, dirty shell pages and dirty
     $(u,v,r)$ volume blocks dispatch in GPU compute *before* the scene pass on the same frame ($\le 0.3\text{ ms}$ for
     2–4 touched blocks). GPU Surface Nets writes vertices/indices into a pooled GPU storage buffer using an atomic
     triangle counter, rendered in one `drawIndexedIndirect` call. (Claude's worker-first render path cannot show edits
     on the next frame.)
   - **Colliders (GPU density fill $\to$ `ReadbackRing` $\to$ worker Surface Nets $\to$ budgeted Jolt install):**
     Runbook 055's D2 measurements (2026-10-22) already proved that a $33^3$ block takes **0.15 ms CPU submit** + ~6 ms
     readback on SwiftShader, **1.5–2.0 ms** for worker `surface-nets.ts` (~4,300 tris), and **62–77 ms** for the pure
     CPU worker fallback. Agree with Astra that Jolt `MeshShape` cooking and body installation must be budgeted on the
     physics thread: install at most **1 block per frame** ($\le 0.25\text{ ms}$ main thread) using Attempt 1's
     build-new-before-destroy-old `TerrainColliderStreamer` policy, and coalesce 30 Hz edits per block with a 50 ms
     max-age flush so continuous volcano growth refreshes colliders every ~35–60 ms without starving physics.

5. **Vertex memory.** Fixed-capacity GPU pools guarded by `CapacityGuard` (`triangular-engine/gpu-data-flow`): one
   static $33 \times 33$ shell grid, one fixed page-atlas texture array (e.g. 512 pages $\times 33^2$, ~9 MiB), and a
   fixed slab pool of 256 volume block slots in one vertex + one index storage buffer. All vertices are stored in
   f32 relative to patch/block origins split into `hi/lo` floats from CPU doubles (fixing the 0.25 m Earth rounding
   noted in `gpu-density-block.ts`). Follow Runbook 028 Rule 2: a parent leaf stays displayed until all children are
   baked; if the block pool saturates during a fast descent, **halt further subdivision** and retain the coarse resident
   cover—never substitute the height shell over an active tunnel (contra Claude). Under 1,000,000× warp, body-fixed
   pages and blocks do not rebuild at all; only the body-to-camera transform and sun direction rotate.

6. **Contact fidelity.** Neither Claude's near-only refinement nor Astra's global $< 1\text{ px}$ triangle refinement
   works at scale. Instead, decouple **geometric feature snapping** from **quadtree subdivision**:
   - **Tangential + radial vertex snapping in the page bake:** Because shell pages store $(\Delta u, \Delta v, h)$, the
     GPU page-bake kernel checks each texel's cell against `contact` (2 m footpath, pad) and `topology` (coastline
     $h = 0$) ops in `op-index`. Grid vertices adjacent to a contact footprint edge or coastline snap tangentially
     ($\le 0.4\times$ cell spacing, clamped to preserve triangle winding) onto the feature boundary and take the exact
     contact height. A coarse patch thus preserves exact pad heights, sharp road crowns, and island land/water sign
     without subdividing to 2 m from orbit.
   - **Pinning horizon & foundation skirts:** `contact` and `topology` ops pin local quadtree refinement only while the
     feature's horizontal footprint projects to $\ge 2\text{ px}$ on screen; below $2\text{ px}$, placed objects carry a
     1.5 m foundation apron that absorbs sub-pixel chord sag while the material's `fwidth` antialiasing draws sub-pixel
     paths and coastlines.

7. **meshoptimizer.** Keep it off the GPU render path (fixed shell grid; GPU-emitted volume blocks) and off the urgent
   first collider build after an edit. Use `meshopt_simplify` (with locked boundary vertices and $\le 0.05\text{ m}$
   geometric error) in the collider worker as a background pass on settled blocks to cut ~4,300 raw Surface-Nets
   triangles to ~1,000–1,500 before Jolt `MeshShape` cooking. Skip `meshopt_buildMeshlets`: three.js `WebGPURenderer`
   0.186.1 has no mesh shaders and lacks unflagged `multiDrawIndexedIndirect`.

8. **Contender set.** **Race two contenders: B-Curvilinear (with `volumeBlocks` on/off as the A/B ablation toggle) vs.
   C (Raymarched hybrid). Reject D.** B-Curvilinear captures D's key structural advantage (patch-aligned volume blocks
   with a deterministic shared-grid boundary and no hole mask) while keeping the 17× cheaper instanced 2D shell over
   the 99% of the planet that is a single-valued sheet. I agree with Astra on two framing fixes to Phase 2:
   - **Move one arch/seam + 30 Hz edit check into R1:** C currently takes 5.4–9.1 ms near the ground in Phase 1
     (Runbook 055, 3–4× over the 2.0 ms budget), and B's defining risk is the shell/block seam. Waiting until R5 to
     test overhangs risks spending four rounds on an architecture that fails its core constraint.
   - **Tighten R3 shadow rules:** The lab currently disables shadows whenever `morph > 0` (`shadowsActive`, Runbook 055).
     R3 should require morphed shadow cascades for mesh contenders (where vertex-stage morph in the shadow pass is nearly
     free: +0.10 ms in `planet-shape-shadows-ab`) rather than letting "shadows off" mask broken shadow morphing.

9. **Biggest risk and cheapest early test.**
   - **Biggest risk:** Seam and normal continuity along the shared $(u,v,r)$ border between a 3D Surface-Nets volume
     leaf and an adjacent 2D displaced shell leaf—especially where an arch or wild-canyon overhang approaches the leaf
     boundary during a camera sweep or globe-to-map morph ($T6$).
   - **Cheapest early falsifier (1–2 days, before any planet streamer):** Build a **4-leaf mini-patch test** on the
     600 km `landforms` preset at the `arch-road` and `horizon-grazing` poses: two $32 \times 32$ displaced shell
     leaves meeting two $32^3$ $(u,v,r)$ GPU Surface-Nets volume leaves across the canyon arch and graded road, with one
     2:1 LOD edge, a 30 Hz animated carve/flatten edit, and morph swept through $0 / 0.5 / 1$. Run the existing
     `planet-shape-terrain-quality` reference depth suite and per-pass GPU timers on the RTX 3080. **Falsification
     criteria:** any magenta crack pixel at the shell/block border, $> 0.5\%$ pixels off-surface ($> 4$ footprints vs.
     the slow reference march), $> 2.0\text{ ms}$ GPU p95 (compute + scene + shadow), $> 1$ frame edit visibility delay,
     or $> 100\text{ ms}$ collider update immediately falsifies the design.

### Astra

**Preference: admit D, sparse volumetric surface blocks, to a cheap elimination spike.** Use one meshing
representation from ground to orbit, retaining only blocks that can intersect the surface. This removes B's
shell/volume interface; it does not establish that D is fast enough. Claude's review is present; Argon's is
still blank. All proposals below retain the 1440p/160 fps limits: terrain **2.0 ms GPU p95 including shadows
and terrain compute, 0.5 ms main-thread p95**, and **100 ms edit-to-active-collider**.

1. **Shell.** For A/B, use instanced fixed grids and an atlas, with a balanced cube-face quadtree, projected
   geometric error, hysteresis and fidelity constraints. Share canonical edge samples across faces; stitch
   indices for 2:1 neighbours and morph interiors toward the parent. Heights alone do not make boundaries
   equal. I reject Claude's cube-face skirts as a correctness solution: they can hide cracks while adding
   false surfaces and shadows. CPU selection fitting 0.5 ms is a hypothesis, including uploads and submission.
   D instead uses a body-fixed Cartesian octree of surface blocks, 2:1 balanced, selected by projected surface
   error. Store vertices relative to double-precision block origins; never subtract Earth-scale float positions.

2. **Volume.** D starts with Marching Cubes using the regular-cell rules compatible with
   [Transvoxel's 2:1 transition cells](https://transvoxel.org/). Transvoxel is a transition scheme, not a
   drop-in seam for arbitrary surface nets. Start with **16³ cells / 17³ samples**, then compare 32³ cells;
   this deliberately differs from D2's 32³-sample grid. Blocks span every relevant surface, including ordinary
   ground, with multiple spatial LODs. Conservative radial relief/op bounds reject empty space; equal corner
   signs alone cannot reject an enclosed island or cave. Uncertain bounds force refinement. Sharp features
   need refinement initially; dual contouring is an alternative if that cost fails, not automatically invalid
   because the field is steep. Resolution follows error, not a universal metres-per-voxel setting.

3. **Seam.** D has no shell seam. Neighbours share sample identities, root interpolation and field revision;
   each transition has one owner. Publish a replacement neighbourhood together, including its transitions,
   retaining the old complete cover until ready. For B, require an explicit common boundary loop and a
   triangulated collar in a region where the field is single-valued, with identical boundary vertices on both
   sides. Reject Claude's mask-plus-overlap: neither watertightness nor absence of double surfaces follows.
   A distant height replacement must also preserve an arch's visible opening. Apply the same vertex morph to
   shared boundaries, handle the map cut explicitly, and recompute conservative visibility bounds during morph.

4. **Meshing location.** GPU density fill and GPU extraction into pooled vertex/index buffers, followed by
   indirect rendering; no render readback. Dispatch dirty blocks and their boundary dependencies before drawing
   so resident edits can appear next frame. Collider density readback feeds worker surface nets under D2,
   with an explicit render/collider error check. Budget the whole path: queue, fill, transfer, extraction,
   Jolt cooking and physics-step installation. GPU render meshing does **not** rescue a late collider, contrary
   to the implication in Claude's fallback. Worker-generated triangles are not a transferable live Jolt shape;
   verify cooking/installation in the physics owner fits 0.5 ms, or move that ownership off-thread.
   Revision tags reject stale results, but coalescing must not starve collision during 30 Hz edits: measure
   the age of the active collider against the continuing edit stream.

5. **Memory.** Fixed pools of block slots and buffer slabs, with explicit capacities for samples, triangles,
   transitions and simultaneous old/new revisions. Compact output within reserved slabs; test worst-case
   extraction capacity. Overflow fails the gate, rather than substituting Claude's height shell and filling
   a tunnel. Keep a resident coarse cover, prioritize visible/body-near refinement, cancel obsolete jobs and
   bound outstanding work. Pool exhaustion must be reported as a fidelity failure if retained coarse geometry
   exceeds error limits. Warp alone changes transforms, not body-fixed geometry; never replay a million
   intermediate states. Actual rapid shape evolution still consumes edit budget.

6. **Contact fidelity.** Exact atlas samples do not imply exact triangles. Keep contact footprints and their
   transition rings refined independently of ordinary distance LOD, until projected error is below 1 px;
   derive collider tolerance separately in world units. Include the footpath's edges and interior in error
   checks. Claude's near-camera-only refinement cannot guarantee contact at every LOD; snapping vertices can
   invert triangles. Likewise, pin coastline topology through refinement and reject coarsening that merges
   islands or closes channels. The framing needs a minimum protected feature scale and an explicit topology
   metric: pixel IoU cannot prove topology, and finite pixels cannot display arbitrarily small islands.
   Field parity alone also does not prove mesh or collider fidelity. Do not silently relax these gates.

7. **meshoptimizer.** Keep it out of the edit-critical path. Consider cache/fetch optimisation for settled
   meshes and constrained simplification for distant blocks only after profiling. Lock boundaries and protected
   features, and recheck geometry/topology after simplification. Meshlets earn nothing merely by existing;
   they require a measured rendering/culling path. Collider simplification must respect contact error too.

8. **Contenders and framing.** Merge A into B as an ablation, agreeing with Claude; mesh kits are not an
   equivalent implementation of arbitrary volume ops. Keep C and give D a bounded spike: sparse surface
   storage scales with retained surface detail, rather than filling the planet's volume, so planet radius
   alone is not grounds to dismiss it. Conversely, sparsity does not guarantee the budget. Move one editing
   cave/seam case into R1; postponing the defining difficulty until R5 risks selecting the wrong architecture.
   Specify dirty volume per update, local overlapping-op count and camera jump envelope. “10,000 ops” gives
   no bound on work if all overlap; spatial indexing preserves op order but cannot eliminate that case.
   Unbounded edits cannot be promised next-frame completion under a fixed budget. These are missing workload
   definitions, not permission to delay accepted edits or increase the timing limits.

9. **Biggest risk and cheapest falsifier.** D's risk is refinement amplification: contact/topology constraints
   and 2:1 balancing create too many sampled cells and triangles for 2.0 ms. Before a planet streamer, build
   one curved, Earth-radius test sector containing a 2 m path, a thin coastal channel and an arch crossing a
   block/LOD corner. Use two LODs, edit at 30 Hz, sweep the camera across the threshold, and morph through
   0/0.5/1. Count cracks, depth error, topology changes, next-frame edit visibility and collider revision age;
   time compute, main/shadow draws, CPU submission and actual Jolt installation on the reference NVIDIA GPU.
   Increase the active block count to the sector's required fidelity. Any required case exceeding 2.0/0.5 ms
   p95 or 100 ms collision latency falsifies this configuration immediately. Passing only earns a whole-planet
   zoom/warp and 10,000-op trial; this cheap test can reject D, not certify it.

## Consensus

Written by Claude on 2026-10-22 after both reviews. The files and numbers the reviewers cite were checked against
the repository (`cell-bake.ts`, `op-index.ts`, `collider-blocks/surface-nets.ts`, `gpu-density-block.ts`,
`shadowsActive`, the runbook's 5.4–9.2 ms for C near the ground). The D2 test has since run on the RTX 3080: a GPU
density block takes 4.0–4.2 ms alone and 0.8–1.0 ms each when pipelined, about 15–20× faster than four CPU workers.

### Agreed by all three

Claude's review changes on five points, conceded to the other two: no skirts; render meshing on the GPU, not in a
worker; blocks as patch prisms, not Cartesian boxes; no height-shell fallback when the block pool is full; and the
seam must have identical boundary vertices on both sides, not a mask with an overlap.

1. **One mesh contender, "B".** A is B with its volume blocks off, as an ablation switch. Authored mesh kits for
   overhangs are dropped. C stays in the race.
2. **Shell.** One fixed grid mesh drawn instanced (one call, plus one for shadows), reading a page atlas baked by a
   GPU compute pass from the shape-op field. The cube-sphere quadtree is balanced 2:1 and selected on the CPU by
   projected error with hysteresis. Cracks are closed by stitched index buffers for coarser neighbours plus interior
   geomorphing, with canonical shared edge samples across cube faces. **No skirts.**
3. **Volume blocks.** Surface nets. Blocks exist near the camera (and near moving bodies, for colliders) wherever
   the field can be multi-valued: inside volume-op bounds **and wherever `grounded < 1`**, since the canyon biome
   overhangs with no ops at all. Blocks are aligned with quadtree leaves as curvilinear `(u, v, r)` prisms.
4. **Render meshing on the GPU, colliders in a worker.** Dirty pages and blocks are rebuilt by compute before the
   scene pass on the same frame and drawn indirectly, with no readback, so edits show on the next frame. Colliders
   take the D2 path: GPU density fill, readback, worker surface nets, then Jolt installation budgeted on the
   physics owner. Measure the age of the active collider during a 30 Hz edit stream; coalescing must not starve it.
5. **Memory.** Fixed pools: one grid, a fixed page atlas, fixed block slots in shared vertex and index buffers.
   Positions are relative to block or patch origins kept in doubles on the CPU. A parent stays drawn until its
   children are ready. If the pool is full, refinement halts and the coarse cover stays, reported as a fidelity
   failure. **Never the height shell over a tunnel.** Time warp moves transforms only; body-fixed geometry does
   not rebuild.
6. **meshoptimizer.** Off the render path and off the first collider build after an edit. Allowed later: simplify
   settled collider blocks with locked boundaries and a world-space error bound, then recheck. No meshlets
   (no mesh shaders in `WebGPURenderer`).
7. **Gate changes to plan 055 (owner to approve):**
   - R1 gains one arch/seam case with a 30 Hz edit, so the defining risk of each design is met first, not in R5.
   - R3 requires morphed shadows from mesh contenders instead of "shadows off" (the lab now turns shadows off
     whenever morph > 0).
   - R4 states its workload: dirty volume per update, how many ops may overlap one place, and how far the camera
     may jump. "10,000 ops" alone bounds nothing.
   - The topology gate states a smallest protected feature size and counts islands and channels directly, since
     pixel IoU cannot prove topology.

**Names used here:** A = height shell only; B = height shell far away plus meshed 3D blocks near the camera (A is
B with blocks off); C = the raymarcher (built); D = meshed 3D blocks everywhere, no shell (Astra's proposal).

### Open for the owner

1. **A third design, D (Astra: admit as a bounded spike; Argon: reject).** D is a sparse octree of surface blocks
   (marching cubes with Transvoxel transitions) from ground to orbit, with no shell and so no seam. Argon's case
   against it: over the single-valued 99% of the planet a block samples about 17× more field points than a shell
   page, and contact/topology refinement with 2:1 balancing may explode the cell count (Astra names the same risk).
   **Claude's view:** run B's seam spike first; admit D only if that spike fails on the seam, since the seam is
   the one problem D removes.
2. **Seam construction.** Argon: whole-leaf replacement (a leaf is either shell or prisms, never both), with
   boundary vertices from the same radial root on both sides, in a 1-leaf ring where the field is single-valued.
   Astra: a common boundary loop and a triangulated collar in a single-valued region. Both require identical
   vertices on both sides. Argon's is the more specific; the spike can try it first.
3. **Contact at coarse LOD.** Argon: pages store a small tangential offset as well as height, so the bake snaps grid
   vertices onto pad, road and coastline edges at any LOD (clamped against inverting triangles). Refinement is
   pinned only while a feature is at least 2 px on screen; below that, objects carry a 1.5 m foundation apron.
   Astra: refine contact rings until the error is under 1 px, and do not relax the gate; snapping can invert
   triangles. **The apron is a gate change** (the plan says contact gap ≤ 1 px at every LOD), so it is the owner's
   call. The apron is extra base geometry on a placed object, not on the terrain, and only for a contact op under
   2 px on screen. A 2 km runway is a different case: it is long enough to stay over 2 px until high orbit, so its
   edges are snapped (Argon) or refined (Astra) and its surface is exact; only its width (tens of metres) drops
   under a pixel early, and anything parked on it is then sub-pixel too.
4. **C's cost.** Not a meshing question, but the reviews raise it: C draws 5.4–9.2 ms near the ground against a
   2.0 ms budget. That is the strongest reason to build B now.

### First tests

1. **B seam spike** (Argon's four-leaf test with Astra's additions, 1–2 days, in `contender-b/`). On the 600 km
   `landforms` preset at the `arch-road` and `horizon-grazing` views: two shell leaves meeting two volume-prism
   leaves across the arch and the graded road, one 2:1 LOD edge, a 30 Hz carve/flatten edit, morph 0 / 0.5 / 1,
   and the same sector on a 6,371 km body to check precision.
   - **Measured:** the `planet-shape-terrain-quality` suite against the reference march, GPU per-pass timers on the
     RTX 3080, next-frame edit visibility, collider age during the edit stream.
   - **Fails if:** any crack pixel at the seam; over 0.5% wrong pixels; over 2.0 ms GPU or 0.5 ms main thread p95;
     an edit not visible on the next frame; a collider older than 100 ms.
2. **Before it:** the lab page gets a per-contender host so B lives in its own folder, and B writes the same
   depth-probe channels as C so the terrain-quality suite can judge it.
3. **D spike** (Astra's curved Earth-radius sector with a 2 m path, a thin channel and an arch across a block
   corner): only if the owner admits D.
