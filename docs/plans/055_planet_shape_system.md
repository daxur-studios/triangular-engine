---
type: Plan
title: Planet Shape System
description: Terrain attempt 5. A measured, harness-first planet surface for stylized planetary terrain at 160 fps, with real-time edits, overhangs and the sphere-to-map morph, chosen by a gated race between three contenders.
timestamp: 2026-10-19T00:00:00Z
tags: [terrain, planet, lod, raymarching, sdf, tsl, webgpu, performance, testing, morph, cell-planet]
runbook: /docs/runbook/055_planet_shape_system.md
performance: []
---

# Plan 055: Planet Shape System

Status: **planned, nothing built.** Written 2026-10-19 from code reading and research only. D1, D4, D8–D13 were
settled by the owner the same day. Phase 0 is next.
Evidence: [Runbook 055](/docs/runbook/055_planet_shape_system.md).

**Goal:** planetary terrain that holds 150–160 fps, looks stylized (clean silhouettes, broad plains, sharp
mountains and volcanoes), can be edited in real time (base pads, a growing volcano, rivers, roads), can go
past vertical (cliffs, arches, tunnels), and morphs from a globe to a flat map without changing the
simulation. The architecture is **not chosen yet**. It is decided by a measured race on a shared test track.

**Builds on:**
- [Runbook 028](/docs/runbook/028_planet_terrain_attempt_history.md): attempts 1–4 and why they failed.
- The cell planet worldgen (`triangular-engine/worldgen`) as the data model.
- [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) and [Plan 050](/docs/plans/050_tsl_planet_surface_material.md):
  the bent morph (`planetMorphGraph`), the atmosphere binding and `PlanetSurfaceMaterial`.
- [Plan 051](/docs/plans/051_cloud_volumes.md): the process this plan copies (lab page, GPU timer, phases with
  go/no-go lines), and its raymarching experience.
- [Plan 052](/docs/plans/052_page_test_sessions_and_performance_comparison.md): the generic test runner
  (`triangular-engine/testing`), where budgets and baselines belong.
- [Plan 054](/docs/plans/054_stylized_illustrative_rendering.md): the stylized look and the illustrative terrain policy.

## Why a fifth attempt, and what changes

Each of attempts 1–4 picked an architecture, built for weeks, and then found it was slow without being able to
say which part (Runbook 028). None had a frame budget, a fixed scenario set or a measured on/off for each
feature. Draw calls and frame times for attempts 1, 2 and 4 were never captured in the game.

This plan inverts the order:

1. Build the test track first (Phase 0), and measure the platform's own costs before estimating anything.
2. Measure the old attempts on that track (Phase 0b), so "what was slow" finally has an answer.
3. Build the shared core that every architecture needs (Phase 1).
4. Race three architectures through gated rounds (Phase 2). Gates are written before the race starts.
5. Harden the winner (Phases 3–5).

## Targets

| # | Target |
|---|---|
| T1 | **Frame rate:** 150–160 fps on the reference machine (§Frame budget). Terrain stays inside its share, still and moving |
| T2 | **Shape:** stylized mountains and surface features at roughly the detail of a god game, at planetary scale. Silhouettes stay clean from the ground to orbit |
| T3 | **Real-time edits:** flatten a base pad, grow a volcano over seconds, carve a river, lay a road. Visible on the next frame, collidable soon after (§Gates) |
| T4 | **Past vertical:** cliffs that overhang, arches, tunnels and caves. A heightfield alone cannot do these |
| T5 | **Ground to orbit:** fast god-camera zoom in and out, orbit, and time warp up to 1,000,000x with no holes, popping storms or rebuild storms |
| T6 | **Globe to map:** the same terrain morphs from the sphere to a 2.5D flat map with everything pointing up. Visual only: movement, physics and wrap across the map edge stay spherical |
| T7 | **Cell planets stay the data model:** each game decides how cells become shape (one peak per cell, ridges across cells, and so on). The renderer never sees cells |
| T8 | **One truth:** what you see, what you collide with and what gameplay queries return come from one definition of the surface, and a spec proves it |
| T9 | **Scale range:** body radius from 2 km to 6,371 km (the `WORLD_SIZE_TIER_RADIUS_M` tiers), relief up to 12 km |
| T10 | **Fidelity where it matters:** volcanoes stay volcanoes, bases never float or sink, islands and lakes never appear or vanish with zoom (§Fidelity classes) |

## Ground rules

- **Harness first.** No contender code before Phase 0's gate passes.
- **Timed with the GPU, not by frame rate.** The page probably sits at the monitor's refresh cap, so fps hides
  headroom. Every gate quotes GPU and CPU milliseconds.
- **Every addition is a toggle.** Each feature or optimisation registers an on/off switch, and its cost is
  measured both ways in the same run (§Ablation). An addition with no measured on/off is not done.
- **Quality is gated as hard as speed.** Speed bought by dropping detail fails the fidelity gates.
- **Timing is never a spec.** Specs run headless and check correctness. Timings come only from the real-GPU
  profile and go in the runbook (Plan 051's rule).
- **Gates are fixed before the race.** A gate may be changed only by the owner, with the change recorded in the
  runbook before the round runs.
- **`WebGPURenderer` and TSL.** The owner decided on 2026-10-19 that `WebGPURenderer` becomes the engine default.
  That switch is its own plan (not yet written), because the engine still defaults to `WebGLRenderer` and the
  postprocessing composer and the takram atmosphere and clouds require WebGL. This plan's code is TSL on
  `WebGPURenderer` from the start, and it targets the WebGPU backend only (D4): compute, storage buffers and
  indirect draws may be used freely. On a browser without WebGPU the shape system reports itself unavailable;
  it does not fall back to WebGL2.
- **New entry points, new files.** Proposed: `triangular-engine/planet-shape` (shape ops, evaluator, renderers)
  and `triangular-engine/gpu-data-flow` (§Data-flow core). Existing `terrain/`, `worldgen/` and `planet-material/`
  are used through their public exports. Changes elsewhere are limited to entry-point wiring, demo routes and indexes.
- **Old attempts are not deleted.** `terrain/cdlod`, `terrain/clipmap`, the cell planet renderers and the
  material tiles stay as they are until the winner replaces them in a later plan.
- The engine is public: no consumer app names or paths in code, docs or commit text.

## Frame budget

At 160 fps the whole frame has **6.25 ms**. Proposed split, to be confirmed by Phase 0's measurements:

| Pass | Proposed budget (GPU) | Source |
|---|---|---|
| Terrain, including its shadow passes | **≤ 2.0 ms p95** | this plan |
| Atmosphere (bent, during morph) | ~0.8–2.0 ms | measured in Runbook 049 (0.79 / 1.18 / 1.97 ms at morph 0 / 0.5 / 1); **Phase 0: ≤ 0.4 ms** (below) |
| Clouds | ≤ 1.5 ms typical | Plan 051, G6; **Phase 0: 0.10–0.37 ms** (below) |
| Water, objects, vessels, post, UI | the rest (~1 ms) | unmeasured |

Main-thread CPU for terrain: **≤ 0.5 ms p95**, with no allocations per frame in steady state. Worker time is
budgeted separately (§Gates).

This table is already tight. Phase 0 measures the fixed costs (an empty frame, atmosphere on/off, clouds on/off).
**Measured 2026-10-21** (quiet unattended standard runs, RTX 3080, full screen 2538 × 1440, Runbook 055): empty frame
0.05 ms; atmosphere on its default path (`auto`) adds 0.03–0.37 ms over the same view without it (worst at low orbit);
clouds (12 volumes, haze on) add 0.10 / 0.37 / 0.17 ms outside / inside / at the horizon. Together ≤ ~0.8 ms, against
the ~2.3–3.5 ms the table set aside. The full-resolution march path of the atmosphere (`march`, kept for timings) costs
0.6–7.3 ms and is not a default. Whether to move D8 is the owner's call.
The terrain share (D8) was accepted by the owner on 2026-10-19 as a working number: if Phase 0 shows the other
passes need more or less, the owner may move it, recorded in the runbook before the race starts.

In plain terms: 2.0 ms is about a third of each 160 fps frame. Terrain alone at 2.0 ms would run near 500 fps;
the rest of the frame is left for atmosphere, clouds, water, objects and UI.

**Reference machine (decision D1, decided 2026-10-19):** the owner's laptop, RTX 3080 Laptop GPU (16 GB), on AC
power, with a **2560 × 1440 drawing buffer**. The built-in screen is 2560 × 1440 at 165 Hz with Windows scaling at
150 %, so the browser reports DPR 1.5 and a full-screen canvas reaches 1440p at that DPR. Gates are stated in
drawing-buffer pixels, never in DPR. "High-performance power mode" is proposed as part of D1.

The screen is driven by the integrated AMD GPU (hybrid graphics), so the browser may hand WebGPU the integrated
adapter. Every run records the adapter it got (`GPUAdapter.info`), and a timing case on any adapter other than the
NVIDIA one is invalid. Phase 0 checks which adapter headless and visible Chrome each get. That may explain the
slow headless runs (runbook, 2026-10-19).
Phase 0 records adapter, driver, canvas size and DPR in every result automatically.

## Architecture: the shared core

These layers are the same for every contender. Only the **surface representation** differs.

```
cell graph (worldgen)  ─▶  shape program (per game)  ─▶  shape ops  ◀─  player edits (op log)
                                                             │
                                                   field evaluator (CPU and TSL)
                                                             │
                     surface representation (contender A / B / C)  ─▶  render · collide · query
                                                             │
                                                  morph (visual only, vertex or ray stage)
```

### Shape ops

A shape op is a bounded shape placed in the body-fixed frame:

- **Height ops** (2.5D): cone, crater, ridge along a spline, flatten to a plane, carve a channel along a spline,
  terrace, noise layer.
- **Volume ops** (3D): subtract a capsule along a spline (tunnel), add or subtract a signed-distance primitive
  (arch, overhang, cave room).

Every op carries:
- a bounding volume, so evaluation only visits ops that touch a sample;
- a **minimum visible size**: at a LOD whose sample spacing is larger, the op is skipped or replaced by a cheaper
  stand-in. This keeps orbit-level cost flat however many roads exist;
- a **fidelity class** (§Fidelity classes);
- a blend mode (add, max, min, smooth union, set).

**Shape programs** turn the cell graph into ops. The engine ships two examples so the interface is tested from
both sides: one peak or volcano inside a cell (the illustrative policy of Plan 054), and ridges built across
neighbouring cell heights. A game can write its own.

**Edits are ops too.** Base pads, volcano growth, rivers and roads are appended to an op log over the procedural
base. Save files store the log, undo removes entries, and replaying the log is deterministic. Edits are no longer
limited by the one-cell resolution floor of attempt 4: a 20 m pad can sit on a 50 km cell.

### Fidelity classes

Not every place needs the same accuracy. Each op or region declares a class. LOD selection reads it, and the
test suite generates checks from it.

| Class | Examples | What every LOD must keep | Metric |
|---|---|---|---|
| **Silhouette** | volcano, signature peak, cliff, arch | outline and peak height until the feature is below a few pixels | outline error in px against the reference; peak-height error % |
| **Contact** | base pad, landing site, road | the surface exactly under a placed object | gap or overlap in px between the object's footprint and the terrain |
| **Topology** | coastline, island, lake, river | the sign of (height − sea level), and so which points are land | land/water overlap (IoU) with the reference; island and lake counts stay constant |
| **Relaxed** | open plains, distant noise | only the normal screen-error budget | screen error in px |

**Smallest contact edit (D11):** a 2 m footpath. Edits are building-scale and up: a footpath or road, a landing
pad, a runway, a hangar footprint, a whole base (about 2 km across). Footprints, vehicle tracks and snow
deformation are a separate system for later (§Out of scope).

For contact, a coarse LOD's vertices span the pad and its surroundings, so even an exact flatten op gets blended
away. Each contender must say how it keeps contact: snapping vertices to the footprint at every LOD, a skirt or
depth bias on the object, or proof that the gap stays below a pixel.

### Field evaluator and one truth

- The **CPU evaluator** (TypeScript, in workers) is the reference. Gameplay queries and colliders use it.
  Collider meshes are built from the same data the GPU draws wherever the contender allows it.
- A **TSL twin** evaluates the same ops on the GPU where a contender needs it (contender C always does).
- Every function that exists in both languages passes a **parity spec**: render the TSL version to a texture
  headlessly, read it back, compare it with the TypeScript version within a tolerance. The existing
  `evaluateOnGpu` helper (`planet-material/gpu-eval.testing.ts`) already does this for material code.
- With overhangs, "height at a direction" is no longer enough. The query API gains a **surface query**: ray hit
  and closest point. Existing height consumers keep working through a compatibility shim that returns the
  outermost surface.

### Data-flow core

A GPU prototype in another project (a gravity simulation) was hurt by CPU/GPU data flow: about 42–55 ms of
readback latency through a three-slot ring, a page that awaited the GPU and then a worker in lockstep, and buffers
that grew past the 128 MiB binding limit. Its working rules carry over, and the transport and scheduling parts are
reusable even though what lives where is decided case by case.

**Rules:**
1. Bulk state lives where it is used most. Terrain pages and meshes live on the GPU. The op log and the CPU
   reference live on the CPU.
2. The CPU never awaits the GPU in a frame. Results the CPU needs (picking, a GPU-generated collider patch, counters)
   arrive through a scheduled readback with a known, measured latency, tagged with the frame they belong to.
3. CPU-needed results are small and fixed in size. Big results stay on the GPU.
4. Uploads have a per-frame byte budget. Excess waits in a queue, and the queue depth is a metric.
5. Every buffer has a capacity checked against the device limits (`maxStorageBufferBindingSize` and so on) before it
   grows, with a clear error rather than a lost device.
6. Round trips are measured whole (submit to usable on the CPU), not only the copy.

**Reusable module (`triangular-engine/gpu-data-flow`, name proposed):** an upload ring with a byte budget, a
readback ring with frame tags and latency statistics, double-buffered storage buffers, a job scheduler with
per-frame budgets for GPU work and for worker work, capacity guards, and telemetry counters (Plan 048 section).
Terrain is its first consumer. Clouds' points source and a gravity simulation are the next likely ones.

**Who needs what, how soon** (to be filled per contender in Phase 1):

| Data | Produced by | Needed by | Latency allowed |
|---|---|---|---|
| Op log | CPU (game, edits) | CPU evaluator, GPU | next frame |
| Height pages / meshes | CPU workers or GPU compute (spike D2) | GPU render | a few frames for streaming, next frame for an edit in view |
| Collider patches | CPU evaluator, or GPU readback | physics | ≤ 100 ms after an edit |
| Height / surface queries | CPU evaluator | gameplay | synchronous |
| Visibility and LOD counters | GPU | harness, LOD selection | 1–3 frames |

### Morph contract (T6)

- Terrain data is body-fixed and spherical. The morph is a visual transform only, applied by the existing TSL
  `planetMorphGraph` with the default `'bend'` shape (`planet-material/planet-morph-nodes.ts`). Movement, physics,
  queries and wrap across the map edge never see it.
- Raster contenders apply the morph in the vertex stage, as the cell planet does today.
- **The shadow pass must morph too.** Today it does not, so a morphed planet should not cast (CHANGELOG). Each
  contender either morphs its shadow geometry or turns shadows off during the morph, and says which.
- **Bounds and culling are bent.** The cell planet's patch bounds still use the straight mix
  (`cell-planet-morph-patch-bounds.ts`), which can cull visible patches mid-morph. The new terrain's culling uses
  the bent transform, and the crack test (magenta clear) checks it.
- **LOD error is measured in morphed screen space.** Caches stay keyed in body space, so a morph never forces a rebuild.
- **Contender C must invert the morph per ray step:** a straight ray in morphed space maps to a curved path in body
  space. The atmosphere already solved a version of this (`BentAtmosphere`, `bend`, `rayAtAltitude` in
  `atmosphere/`). Its inverse for Equal Earth may need iteration. This is contender C's main risk.
- The atmosphere is Plan 049's job. Terrain provides correct depth and the planet-frame position Plan 049 needs.
- **Open (D7):** at morph 1, should the flat map tile sideways so a unit crossing the edge stays in view?

### TSL utilities

A small shared library, built as each contender needs it, not in advance:

- cube-sphere and body-frame mapping, camera-relative positions;
- page-atlas sampling (`textureLoad`-based where it saves samplers: Plan 051 hit the 16-samplers-per-stage limit);
- triplanar mapping for cave walls and overhangs;
- antialiased lines and edges via `fwidth`, as Plan 054 needs;
- the shape-op evaluator in TSL (the twin above), with SDF primitives and noise;
- debug views: LOD level, screen error heatmap, fidelity class, op bounds, cell IDs;
- a sampler-count check per pass (a spec).

Known TSL trap from Runbook 049: a value used inside an `If` and outside it must be a `toVar()`.

### Shared field core (raymarching)

Clouds already integrate density through bounded volumes. A raymarched planet surface traces a signed distance
field to a hard surface. Fur, grass and fuzzy detail could later use either one, or shell rendering. What can be
shared is the **field library** (ops, SDF primitives, noise in TSL) and the **ray machinery** (ray setup in the body
frame, step budgets, bounds from a coarse mesh, depth output so raster and marched pixels sort, morph inversion).
Two kernels sit on top: a surface tracer (contender C) and a volume integrator (clouds). This plan builds the
field library and the surface tracer. Fur and plants are out of scope, but nothing here should rule them out.

## The contenders

| | A. Height shell | B. Near volume + shell | C. Raymarched hybrid |
|---|---|---|---|
| **What** | Cube-sphere patches drawn as instanced grids that read heights from a resident page atlas. A camera-centred clipmap is a selection-policy toggle inside A, not a separate contender | A's shell beyond a radius. Near the camera, small 3D blocks where volume ops exist, meshed with surface nets, cutting a hole in the shell | A coarse raster mesh that bounds the surface from outside, then a sphere-traced march from that mesh's depth for the last stretch of detail |
| **Overhangs** | Fallback: authored arch and cave mesh kits placed by ops | Native near the camera; height approximation far away | Native |
| **Edits** | Rewrite affected pages | Rewrite pages; remesh affected blocks | Change the op buffer, nothing to rebuild (plus the bounding mesh if an edit raises the surface) |
| **Morph** | Vertex stage | Vertex stage for both | Inverse morph per ray step (risk) |
| **Collider** | From the same pages | From the same pages and block meshes | From the CPU evaluator (no mesh on the GPU to share) |
| **Main risk** | Overhangs are second-class | The seam between shell and block meshes; meshing cost under edits | Per-pixel cost at 1440p; morph inversion; shadows |
| **Draw calls** | A few, independent of patch count | A few, plus one per resident block batch | A few |

**No code from the earlier terrain attempts** (D14): not `terrain/cdlod` (including `CdlodV3InstancedRenderer`),
`terrain/clipmap`, the cell planet renderers or their morph selector. Each contender writes its own selection, grids
and LOD in its folder. Lessons from those attempts may be read in their runbooks; their code is not imported or
copied. Shared engine infrastructure that is not a terrain attempt stays usable: the GPU timer, the 055 shape-op
field and its twins, the data-flow core, and libraries such as meshoptimizer.

Contender C is also the slow **reference renderer** in Phase 0: at maximum steps and full precision it shows the
true shape with no mesh in between.

## Race rules

- Phase 1b must be finished before the race rounds, so every contender is judged with the same harness, op system
  and evaluator (contender C's first version comes earlier, in Phase 1).
- **One folder per contender, in one checkout** (owner, 2026-10-19). Each contender lives in its own folder
  (`planet-shape/contender-a`, `-b`, `-c`) with its own test adapter, and the lab page switches between them, so all
  three share one harness and one build. Parallel sessions may work at once if each touches only its own
  contender's folder; changes to shared files go through one session at a time. No worktrees, since agents never commit.
- **Timing runs go one at a time** through a single queue, because two GPU runs at once spoil each other's
  numbers. Building and headless correctness suites may run in parallel.
- Rounds are timeboxed (proposed: five working days per round per contender, owner may change before a round).
- **When a contender fails a gate, it pauses and the owner reviews it.** The runbook records the numbers and
  screenshots, and the owner picks one:
  - **Stop:** the contender ends. The runbook records why.
  - **Push:** one more timebox, with one stated hypothesis ("instancing the shadow pass will bring it under 2 ms").
    A second failure of the same gate needs an explicit owner decision to continue.
  - **Harvest:** the contender ends, but a named technique moves into another contender.
- A contender that passes all rounds is a finalist. If two finish, the owner picks with both sets of numbers side by side.

## Phases

Each phase ends with a check in `/planet-shape-lab` (proposed route) and recorded numbers.

### Phase 0. Test track and platform ceiling

**Lab page** `/planet-shape-lab` (skeleton built 2026-10-19: plain sphere, poses, spin, feature registry,
`planet-shape-baseline` v1; per-pass timers and timer self-test built and passing on the reference GPU 2026-10-19; quick/standard/soak modes and the `planet-shape-shadows-ab` v1 A/B suite built 2026-10-20 and run on the owner's machine the same day (quick and standard runs saved, agreeing within about 2%; see [Runbook 055](/docs/runbook/055_planet_shape_system.md), 2026-10-20 A/B entry; morph slider and the `planet-shape-morph` v1 suite built 2026-10-20, see [Runbook 055](/docs/runbook/055_planet_shape_system.md), 2026-10-20 morph entry; its baseline recorded 2026-10-21 with the unattended `npm run test:run`): a body-fixed planet with fixed seeds at three sizes (64 km, 600 km, 6,371 km),
the same camera rig across contenders, a spinning planet with a time-warp slider, and the morph slider.

**Measurement** (extends `triangular-engine/testing`, Plan 052's runner and `FrameSampler`):
- GPU time **per pass** (terrain, terrain shadows, everything else), not one render total. The perf profile enables
  Chrome's WebGPU Developer Features flag, since timestamps are otherwise rounded to 100 µs.
- A **timer self-test** that proves each sample belongs to the frame it claims (Plan 051's timer once read mid-frame).
- CPU main-thread ms, worker job ms (p50/p95), long frames (> 8 ms, > 16 ms), allocations per frame, pipeline
  compile hitches.
- Draw calls and triangles including shadow passes, resident and visible patches or blocks, upload bytes per frame,
  readback latency, queue depth, time to full detail after a teleport.
- Percentiles with sample counts, and histograms for fly-bys. One p95 definition shared by the runner and the
  lab (Plan 051's two disagreed). **Done 2026-10-19:** nearest rank everywhere (`nearestRankPercentile` in
  `triangular-engine/testing`, `FrameSampler`, the summary bin); this lab uses it rather than its own helper.
- **Cheap reading** (done 2026-10-19): every metric carries a `summary`, each `index.jsonl` line carries per-scenario
  summaries and failed checks, and `npm run test:summary` reads only the index. Agents read the summary, and open
  a full result only for a failure.

**Machine context** (why a number might be wrong, beyond the page's own view). **Built 2026-10-19, run end to end
and thresholds set 2026-10-21** (runbook): adapter per run, `expectedGpuVendor`, receiver sampling and preflight
warnings; `gpuBusyPct` 60 (fallback only; the page alone reads 40-48 %) and `gpuHotC` 85 (readings 38-52 C; warning only).
- The local receiver (the Node process that already saves results) samples the machine between "measuring
  started" and "measuring stopped" messages from the page: GPU busy %, VRAM, clocks, temperature and power draw,
  CPU load, free RAM, AC or battery, power mode, and the few heaviest other processes by GPU and CPU. The result
  gets a short `machine` block per case. The sources depend on the OS and GPU vendor (survey in the runbook): on
  the reference machine, `nvidia-smi` in loop mode plus `os.cpus()` deltas during measurement, and a slower
  one-off preflight for power, idle and processes.
- **Preflight gate:** before each timing case, the run waits or is marked invalid if another process holds the
  GPU, the machine is on battery, or the GPU is above a temperature limit. Thresholds are set in Phase 0 from
  measured idle readings.
- **Noise floor:** an empty-frame probe before and after each timing suite. A large difference marks the run.
- Correctness suites record the context but do not gate on it.
- Process names stay in local result files (`artifacts/` is gitignored). They never go into committed baselines,
  docs or the runbook.

**Quality metrics** (computed in the lab against the reference renderer at the same pose). **Built 2026-10-21 for the
plain sphere** (`planet-shape-quality` v1, functional; runbook): until contender C exists the reference is the exact
sphere, ray-traced on the CPU in doubles. Silhouette, depth, cracks and flicker are measured; popping, fidelity classes
and collider parity wait for terrain and a collider.
- silhouette error in px, compared column by column along the horizon, and depth error per pixel;
- crack count: clear to magenta, count magenta pixels inside the planet's outline;
- flicker: two frames at a still pose must match; popping: frame-to-frame change during a slow zoom stays smooth;
- per fidelity class: peak height, contact gap, land/water IoU and island/lake counts;
- collider parity: a grid of raycasts against the render surface, the collider and the CPU evaluator.

**Ablation:** a feature registry. A suite runs baseline against feature-on in alternating rounds (ABAB, as
Plan 051's U0P probe did), rejects runs whose spread exceeds 15 %, and reports the difference with its noise band.

**Scaling curves:** cost against patch count, op count, edit count and body radius.

**Budgets and baselines:** a budget file per scenario and a committed baseline JSON, so the runner's
`performanceVerdict` is computed rather than "unassessed" (Plan 052). **Done 2026-10-20:** `TestScenario.budgets` and `TestSuite.baseline`; the baseline suite has a committed baseline from
the owner's quiet standard NVIDIA run (2026-10-20 21:57) and a `gpuPassTotal` p95 budget. Still open: budgets for the
shape suites (Runbook 055, 2026-10-20).

**Real GPU:** a Playwright profile like `playwright.cloud-feasibility.config.ts` (real adapter, no SwiftShader,
adapter and canvas recorded, GPU telemetry). Headless SwiftShader runs stay functional only. Existing stored runs
show the `headless-hardware` profile far slower than `visible-browser` for the same suite (runbook, 2026-10-19), so
**timings come from `visible-browser` runs** until Phase 0 shows a headless profile that matches them. Correctness
suites stay headless.

**Platform ceiling microbenchmarks** (**parked** by the owner 2026-10-21: the race measures the same limits on real
terrain; run one only when a contender hits a wall it would explain) (no terrain): draw calls × triangles per draw on `WebGPURenderer`; instanced
against merged geometry; heights read from a texture in the vertex stage; upload throughput; worker evaluator
throughput; one full-screen sphere-trace at 8, 32 and 128 steps; readback round-trip latency.

**Gate:** the owner sees per-pass GPU ms, the quality metrics and an ablation report on a plain sphere; the timer
self-test passes; the frame budget table is confirmed with measured fixed costs. **Closed 2026-10-21** (owner): all
of these are in the runbook; the microbenchmarks are parked.

**Reordered 2026-10-21 (owner).** Too long had passed without any terrain. Phase 0b is parked, and the next phase
is the first raymarched terrain (Phase 1 below). The shape-op system, workers and data-flow core (now Phase 1b) are
built when a renderer needs them, not ahead of it.

### Phase 0b. Measure the old attempts (parked 2026-10-21)

Parked by the owner: the old attempts already failed, and where they spent their time would not change what is built.
Adapters for the CDLOD planet (v2 and v3), the cell planet TSL path and the clipmap, run on the Phase 0 scenarios
that apply. No fixes. **Gate:** a table in the runbook of where each one spent its time.

### Phase 1. First raymarched terrain (contender C, minimal)

Real terrain in the lab as soon as possible, measured by the Phase 0 harness:

- A bounding shell (the sphere at radius `R + H`, back faces) rasterised camera-relative; each of its pixels sphere-traces
  a height field from the shell to the surface and writes its own depth, so raster and marched pixels sort.
- One fixed height function in TSL (fractal noise over the body-frame direction, `0..H`), no ops yet.
- Body-relative altitude along the ray from doubles computed on the CPU, so a 6,371 km body does not lose the ground
  to float32.
- Lit by the lab's sun; no shadows and no morph yet (the lab shows the plain sphere for those).
- A `planet-shape-raymarch` v1 timing suite on every pose and size, and the step count as a toggle.
- **Gate:** the owner sees the terrain and its per-pass GPU ms at every pose and size; the owner then picks the next
  step (more of C, or A and B to race against it).

### Phase 1 finish line: the foundation (set 2026-10-21)

The raymarch v2 (a 3D density field with canyons and overhangs) replaced the height map. Before more biomes or polish,
one terrain recipe has to be fast, editable and tested. Phase 1 is done when all five hold:

1. **Fast enough to build on.** v2 at the ground pose is at most 16 ms scene pass on the 3080 at full screen,
   recorded in a `planet-shape-raymarch` v2 suite. This is a working milestone, not the budget: D8 gives terrain
   2.0 ms p95, and v1 already took about 40 ms near the ground (2026-10-21). Closing that gap is the race's job
   (Phase 2); the finish line only has to show the levers work. First levers: march at a reduced resolution with a depth-aware upscale, then a
   cheaper march (coarse pre-pass, fewer octaves in the march, detail only in shading). v1 (the height map) stays in
   the suite as the cost reference and a possible far-distance version.
2. **One definition of the terrain:** base field, then biome parameters, then edits. The TSL field lives in its own
   module with a TypeScript twin; a parity spec (`evaluateOnGpu`) compares them. The CPU twin answers "is this point
   solid", "ground height here" and "flat enough to build". This is the start of Phase 1b's evaluator.
3. **Edits:** a short list of flatten / smooth / carve ops (a flatten disc with a soft edge to a set height) replaces
   the hard-coded pad, evaluated the same on GPU and CPU, so a base sits exactly on the drawn ground. These are the
   first Phase 1b shape ops.
4. **Two contrasting biomes, blended** (canyons and rolling hills) by a low-frequency mask that blends field
   parameters, not separate fields, so cost stays flat. More biomes after this are content.
5. **Tests:** timing per biome, edit site and pose; the parity spec; visual-review poses on each biome and on a
   flattened base site.

Out until after the finish line: more biomes, materials, lighting polish, water, planet-scale LOD, morph.

Status 2026-10-22: all five items met (the owner checked the blend and edits in the lab); Phase 1 is done. The numbers are in the runbook. Near the ground the scene pass is 7–9 ms, so the 2 ms D8 budget remains the
Phase 2 race.

### Phase 1b. Shape ops, evaluator and data-flow core

- Op types, bounds, minimum visible size, fidelity class, blend modes, op log with deterministic replay.
- The two example shape programs on a cell planet.
- The CPU evaluator in workers and its TSL twin, with parity specs.
- The data-flow core module with its specs.
- **Spike D2 (data flow):** generate height pages in CPU workers against GPU compute with a scheduled readback for
  colliders. Measure pages per second, latency and main-thread cost. Contenders use the winner, or both as a toggle.
- **Gate:** parity specs pass; replaying an op log gives identical hashes; the op-count cost curve is recorded; D2 is decided.

Status 2026-10-22: op types, bounds, fidelity, blend modes, op log and op index done on the CPU; the TSL twin
(`shape-ops/shape-ops-gpu.ts`, per-tile op lists in float textures) replaces terrain v2's 8-edit list, with parity specs
against the CPU and the `landforms` preset (mountain, crater, ridge, road, overhang, arch, tunnel). Open: the shape-op
timing run (`planet-shape-ops` v1), per-tile march bands, wiring the cell bake into the field, workers, D2's decision.

### Phase 2. The race

Proposed gates, to be confirmed by the owner after Phase 0 and before round 1:

| Round | Scenarios | Gate (proposed) |
|---|---|---|
| R1 Budget | whole planet from orbit, low flyover, descent from orbit, god-zoom sweep, cold teleport, 1,000,000x warp in orbit, three body sizes | terrain GPU ≤ 2.0 ms p95 still and moving; main thread ≤ 0.5 ms p95; no frame > 16 ms after the first 2 s of a descent; zero cracks; zero flicker |
| R2 Fidelity | silhouette against reference; volcano zoom sweep; base on a pad over a zoom sweep; base on a small island; coastline and river sweep | silhouette class ≤ 1 px p95, relaxed ≤ 3 px; volcano rim kept until under 4 px on screen; contact gap ≤ 1 px; zero topology changes for the topology class; land/water IoU ≥ 0.99 |
| R3 Morph | morph 0 → 0.5 → 1 at orbit and low altitude, with a dusk sun | within R1 budget + 0.3 ms; silhouette against the morphed reference ≤ 1 px; zero culled-visible patches; shadows correct or off |
| R4 Edits | volcano growing at 30 updates/s while zooming; pad, runway and whole-base flatten; 2 m footpath, road and river splines; 10,000-op stress | edit visible on the next frame; ≤ 0.5 ms extra GPU per frame during growth; edit to collider ≤ 100 ms; 10,000 ops inside R1 budget |
| R5 Past vertical | arch, overhanging cliff, dug tunnel walked through | visible and collidable, inside R1 budget, R2 gates still pass |

Every round also runs: grazing horizon, cube-face seams and poles, low sun with mountain shadows, and landing-leg
contact (render surface against collider under a vessel).

### Phase 3. Winner hardening: colliders and queries

Collider streaming through Jolt (`TerrainJoltColliderAdapter` pattern), the surface query API and its
compatibility shim, floating-origin rebase, budgets for collider builds per frame.

### Phase 4. Look, water and scatter

Plan 054's stylized material on the winner, water and shoreline coupling (rivers below the water surface at every
LOD), scatter placement and its invalidation after edits.

### Phase 5. Tiers, telemetry, docs

Quality tiers, a terrain telemetry section (Plan 048), consumer docs under `projects/triangular-engine/docs/`,
`CHANGELOG.md`, `entry-points.md`, token-map registration, and a migration note for consumers of the old paths.

## Tests (headless specs)

- Shape ops: bounds contain the op's effect; minimum-visible-size skipping changes results only below the stated size.
- Op log: replay determinism (hash), undo restores the previous hash.
- CPU and TSL evaluator parity at random points, seams, poles and op boundaries.
- Morph: body-space positions survive a morph round trip; bent bounds contain the bent surface.
- Data-flow core: readback results carry the right frame tag; capacity guards trip before device limits; the upload
  budget is respected.
- Fidelity: contact snapping keeps footprint vertices on the op at every LOD (contender-specific).
- Sampler count per pass stays under the device limit.
- Timer self-test logic (sample-to-frame attribution) against a fake renderer.

## Design notes (2026-10-22, owner questions after Phase 1)

Not decisions yet; each names the phase that settles it.

- **Floating rock.** The v2 field adds 3D noise to altitude, so a dip in the noise above the ground makes a solid
  blob with no support; a field read at one point cannot know about connectivity. Mostly a look problem (render,
  collide and "ground height" all handle it). Fixes, cheapest first: (1) displace a 2D height surface sideways by 3D
  noise instead of adding density — with a warp gradient below 1 the surface stays one connected sheet, so no
  floaters or stray holes, overhangs kept, about the same cost; arches and caves then come only from volume ops;
  (2) fade the 3D noise with height above a 2D base (rarer, not gone); (3) flood-fill each page in a worker and mask
  unconnected pieces (exact, needs Phase 1b paging). Proposed: (1) as a per-biome "grounded / wild" switch.
  **Implemented 2026-10-22** (fix 1, per-biome `grounded`, hills grounded and canyons wild; runbook 055, same date).
- **Cell planet as the source.** Field = smooth base height from the cells + shape-program ops + detail noise with
  biome parameters from the cells + player edits. Per-cell data (base height, biome weights, maximum height) is baked
  into a cube-map texture so the march and the CPU twin sample it cheaply; no Voronoi search per step. Cell edges
  are interpolated smoothly and biome borders noise-warped, so no polygons show. Phase 1b.
- **Shape programs only compose engine ops.** Every op needs a TSL twin and a parity spec, so a game builds
  mountains from the op set (single-cell cone, ridges through several cell centres…) and adds new op shapes to the
  engine rather than writing free-form code. Phase 1b.
- **Op lookup must scale.** Phase 1's loop over at most 8 edits with a per-ray mask does not scale to hundreds of
  ops; ops are bucketed per cell or tile and a ray visits only the buckets it crosses. Phase 1b.
- **Per-region height bounds.** With each cell's maximum height baked in, the march band is thin over plains and
  tall only in mountain cells, which should help the ground-pose cost. Phase 1b, measured in Phase 2.
- **Cell mesh and march must agree.** The cell planet mesh is the natural far level and contender C's bounding
  mesh (pushed up by each cell's maximum relief), so it must be built from the same field evaluator, not its own
  height function, or the switch pops and colliders disagree with what is drawn. Phase 1b / Phase 2.
- **Colliders with overhangs.** Jolt's heightfield shape has no overhangs, so it is only a far fallback. Near each
  moving body, small 3D blocks (tens of metres) are sampled from the field, meshed (surface nets) and handed to Jolt
  as mesh shapes; edits rebuild only the blocks they touch. Phase 3, with the D2 spike choosing who samples.
- **Who samples collider blocks (D2 input).** The unoptimised CPU twin costs about 12 µs per sample in Node on the
  reference laptop: about 390 ms for a 32³ block on one thread. Typed-array, allocation-free code may gain several
  times, still tens of ms per block. A GPU compute pass fills the same 32³ grid in a small fraction of a
  millisecond; a fixed-size density grid (128 KiB as float32) fits data-flow rule 3, arrives after the measured
  readback latency (inside the 100 ms edit-to-collider target), and a worker then meshes it and builds the Jolt
  shape. The CPU path stays for synchronous queries, for physics without a GPU frame (loading, headless) and as the
  reference. Proposed: GPU density + worker meshing, CPU fallback; the D2 spike measures both.
- **Scatter (Phase 4).** Deterministic per cell from the CPU field; candidates come from the surface query (ray hit
  and normal), so ledges and ground under overhangs work; filtered by slope, up-facing, biome, altitude and the
  material masks; edits invalidate only inside their bounds; drawn as instances or impostors, which mix with the
  march because it writes depth.
- **Expected race outcome.** A hybrid: a height shell or the cell mesh beyond a few km, true 3D near the camera
  (C's march or B's blocks). Phase 1 numbers point there (orbit and flyover 1–3 ms, ground 7–9 ms). Overhangs are not
  lost: R5 requires an arch, an overhanging cliff and a tunnel, visible and collidable, from every finalist; far
  away they are sub-pixel and may be approximated.

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Reference machine: owner's laptop (RTX 3080 Laptop GPU), on AC, 2560 × 1440 drawing buffer (DPR 1.5 at 150 % scaling), NVIDIA adapter only | **Decided** 2026-10-19 (owner); "high-performance power mode" proposed |
| D2 | Data flow for page generation: CPU workers or GPU compute | Decided by Phase 1 spike |
| D3 | `WebGPURenderer` becomes the engine default | **Decided** 2026-10-19 (owner); own plan, not yet written |
| D4 | WebGPU backend only; no WebGL2 fallback for the shape system | **Decided** 2026-10-19 (owner) |
| D5 | Contender C (raymarched hybrid) is in the race | **Decided** 2026-10-19 (owner) |
| D6 | Gate failure pauses a contender for owner review: stop, push or harvest | **Decided** 2026-10-19 (owner) |
| D7 | Flat map tiles sideways at morph 1 | Open |
| D8 | Terrain budget ≤ 2.0 ms GPU p95 including shadows, ≤ 0.5 ms main thread | **Accepted** 2026-10-19 (owner) as a working number; may be moved after Phase 0, before the race |
| D9 | Cell graph stays the data model; shape programs are per game; edits are ops | **Decided** 2026-10-19 (owner) |
| D10 | Three contenders (A, B, C); clipmap as a toggle inside A | **Decided** 2026-10-19 (owner) |
| D11 | Target is 1440p only, no 4K tier. Smallest contact edit is a 2 m footpath; edits are building-scale up to a whole base (§Fidelity classes) | **Decided** 2026-10-19 (owner; 2 m is a working number) |
| D12 | Lava is a surface material over a height op (volcano), not a separate surface. Rivers carve a channel op; their water surface is Phase 4 | **Decided** 2026-10-19 (owner: "whatever runs well") |
| D13 | Caves below sea level are flooded (below sea level is water). At morph 1 the map shows the outermost surface; tunnels and caves are not drawn | **Decided** 2026-10-19 (owner left it to the plan) |
| D14 | No code reused from the earlier terrain attempts (CDLOD, clipmap, cell planet renderers); contenders write their own LOD and grids (§The contenders) | **Decided** 2026-10-22 (owner) |

## Out of scope for now

Fur, grass and plant rendering (the shared field core should allow it later), weather and erosion simulation,
multiplayer edit sync, terrain on more than one body at full detail at once (distant bodies use a coarse mesh or
impostor), replacing the atmosphere or cloud renderers. Small-scale deformation (footprints, vehicle tracks,
snow). Lava or water as separately flowing surfaces. Dry air pockets in caves below sea level. Showing
tunnels on the flat map (a game overlay can).

## Open questions

- D7: does the flat map tile sideways at morph 1?
- Answered 2026-10-19 by D11–D13: target resolution, smallest edit, lava, caves below sea level, the map over a
  tunnel.
