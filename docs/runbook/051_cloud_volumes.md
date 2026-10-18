---
type: Runbook
title: Cloud Volumes
description: Findings, decisions and timings for fast flyable 3D clouds on WebGPURenderer.
timestamp: 2026-10-17T00:00:00Z
tags: [clouds, volumetric, raymarching, atmosphere, tsl, webgpu, performance, stylized]
plans: [/docs/plans/051_cloud_volumes.md]
---

# Runbook 051: Cloud Volumes

Plan: [Plan 051](/docs/plans/051_cloud_volumes.md).

## 2026-10-17 — Plan written (cloud session, code reading only)

Nothing was built, run or measured.

- **Owner's ask:** performant clouds in the same spirit as the atmosphere. Stylized and 3D, so you can fly into
  them and they take the atmosphere's light. Nice to have: any 3D shape ("a ship made of cloud") and dynamic shapes
  (noise, a particle simulation). Target: stay around 160 fps.
- **Frame-rate caution:** the atmosphere pages read 160-165 fps, and so does `?atmosphere=0`. That is most likely
  the monitor's refresh cap, so the real headroom is unknown. The plan's gates use GPU timestamps
  (`/atmosphere-lab` already reads them inline).
- **Options compared** (2D shell, instanced puffs, bounded volumes, whole-planet raymarch, Gaussian splats);
  table and estimated costs in the plan. **Owner chose** bounded volumes plus a 2D shell for the far view,
  with puffs as the fallback.
- **Why bounded volumes can be fast:** the lighting inside a volume and its distance field are baked into 3D
  textures and rebuilt only on change, the same idea as the atmosphere's tables.
  - A march step is two texture reads.
  - Empty space is skipped.
  - Only pixels covered by a box pay anything.
  - A dense cloud ends the march early.
- **Atmosphere hooks found** in `atmosphere/`:
  - `AtmosphereGpuModel.sunTransmittance(s, r, muSun)` and `skyIrradiance(alt, muSun)`;
  - `AtmosphereAerialPerspectiveLut.lookup(ndc, distance, dirView)`;
  - `PlanetSurfaceMaterial.addSunOcclusion` in `planet-material/` for ground shadows.
- **Risk to settle first (Phase 1):** compute shaders and storage textures do not exist on the WebGL2 fallback.
  The atmosphere writes its tables with fragment passes into render targets. The plan defaults to the same for the
  cloud bakes.
- `triangular-engine/clouds` already exists (the mesh puffs, Runbook 023), so the new entry point is
  `triangular-engine/cloud-volumes`. Earlier cloud work (Runbooks 001, 023, 025) stays as history and is not edited.

## 2026-10-17 — Moving planets, point-light showcase (cloud session, code reading only)

- **Owner's question:** in a game where planets constantly spin and orbit the sun, do the "rebuild on change"
  tables keep rebuilding? Answer recorded in the plan's §Moving planets.
  - The atmosphere's profile tables never rebuild.
  - The sky-view table rebuilds when the sun's elevation moves 0.05° (`sunTolerance`, `atmosphere-sky-view.ts`):
    every few seconds at 1x, every frame under time warp.
  - The froxel table's dirty check (`atmosphere-aerial-perspective.ts`, `isDirty`) compares the camera pose at 1e-5,
    so it rebuilds every frame the camera moves. That is fine by design (it is small), but it means a timing taken with
    a still camera does not include it.
  - The clouds keep their density in the planet's body frame. Only the sun bake follows the sun, and it is time-sliced.
- **Plan changes:**
  - every gate is timed both still and in the moving worst case;
  - temporal reuse reprojects with each volume's previous transform;
  - the lab gets a spinning, orbiting planet with a time-warp slider.
- **Owner's ask:** show custom lights on the example page. Phase 7 now specifies two lab scenes: a rocket-engine
  fly-through, and a storm with seeded lightning flashes.

## 2026-10-17 — Phases 0 and 1 built (local Sonnet session)

Owner: local Sonnet session. Scope was Phase 0 and Phase 1 only; nothing from Phase 2 on was started. Everything
is uncommitted.

### Built

- **Entry point** `triangular-engine/cloud-volumes` (`ng-package.json`, `public-api.ts`, `tsconfig.json` and
  demo `tsconfig.app.json` paths, `test-cloud-volumes` target and a spec glob in the main test target in
  `angular.json`, `npm run test:triangular-engine:cloud-volumes`). Wiring lines only; no existing source edited.
- **Library files** (`projects/triangular-engine/cloud-volumes/`):
  - `cloud-volume-atlas.ts`: `CloudVolumeAtlasLayout`, an `n^3` volume stored as a 2D atlas of `n` slices
    (16 columns, so 128^3 is 2048 x 1024) with a hand-written trilinear read (bilinear in a slice, two slices blended).
  - `cloud-volume.ts`: `CloudVolume`. A 128^3 density atlas, a sun optical-depth atlas at half size (64^3),
    and a box-proxy mesh that marches the density at full resolution with a white sun, a two-lobe HG phase,
    a sky-ish ambient term and an interleaved-gradient jitter. No temporal reuse, no distance field, no scene-depth
    test (the proxy only uses the hardware depth test), no atmosphere.
  - `cloud-volume-reference.ts`: CPU analytic densities (uniform box, Gaussian blob) and optical-depth integral.
- **Demo app** `/cloud-volumes-lab` (route, demo index entry `02j`): a plain sphere planet, fly camera
  (drag, WASD, QE, Shift), presets outside / edge / inside / above / below, clouds on/off, sun sliders and
  animation, a "light rebake every frame" switch (worst case for the light bake), a GPU ms readout and a
  "record this reading" table. `gpu-timer.ts` is the new timer helper (`resolveTimestampsAsync('render')` and
  `('compute')` every 20 frames, rolling average over 30 samples). `atmosphere-lab` is untouched.

### Backend answer (Phase 1 question)

**Fragment-pass bakes into 2D atlas render targets work on WebGPU and on `forceWebGL`.** No compute path was written
and none is needed to proceed.

- Specs run the bakes on the WebGL2 backend (headless Chrome, `forceWebGL`). The lab page loaded and drew the
  baked volume on both WebGPU and `?forceWebGL` in the in-app browser.
- `RenderTarget3D` was **not** tried. The atlas is the same pattern the atmosphere's froxel table uses and it
  needed no extra backend feature, so it stays the default.
- **Finding: single-channel (`RedFormat`) half-float render targets read back empty** (a zero-length array) through
  `readRenderTargetPixelsAsync` on the WebGL2 backend, so both atlases use `RGBAFormat` + `HalfFloatType`
  (4x the memory the plan assumed: the 128^3 density atlas is 16 MB, the 64^3 light atlas 2 MB). The memory is a
  spike cost to revisit in Phase 2 (pack four slices per texel, or use `R8` for density if it samples
  correctly on both backends). Rendering into a `RedFormat` target was not separately ruled out; only the
  readback was.
- Readback rows run bottom-up on this path (atlas row 0 is the last row of the array). Specs account for it.

### Checks (and how)

- `npm run test:triangular-engine:cloud-volumes` (headless): 8 of 8 pass.
  - CPU reference: box optical depth = extinction x exit distance; slanted exit distance; blob peak and falloff;
    blob integral against a 200 000-sample sum.
  - GPU, read back: uniform box optical depth within 2% of analytic at five texels; Gaussian blob within 8% of the
    CPU integral (32^3 density, 16^3 light, 32 light steps).
  - Rebake triggers: three updates with nothing changed give 1 density bake and 1 light bake; a 0.2 degree sun
    move (tolerance 0.5) does not rebake; a 5 degree move rebakes the light only; `invalidateDensity` rebakes both.
  - Noise density bakes into [0, 1] with empty and filled texels.
- `npm run build:triangular-engine`: passes.
- Demo app: `ng serve demo-app` compiles with no errors; `/cloud-volumes-lab` and `/cloud-volumes-lab?forceWebGL`
  load and draw the planet and clouds.

### Not measured, limits found

- **No GPU numbers recorded.** The in-app browser here is not the maintainer's GPU, so its timings
  (about 19 ms render, inside the cloud, WebGPU) mean nothing; `forceWebGL` returned no timestamp there ("n/a").
  Phase 1 timings are left for the maintainer on their own machine (recipe in the session hand-off).
- The WebGPU headless path is not covered by specs: only the WebGL2 backend runs under Karma.
- The march ignores scene depth, so a planet in front of the box can still be painted over where the proxy's far face
  passes the depth test; that is a Phase 2 item.
- A WebGPU validation error about a zero-size swapchain appeared once while the in-app browser pane was hidden at
  load. It is from the hidden pane's 0x0 canvas, not from the cloud passes, and did not recur once the pane was shown.
- Light bake is one pass over 64^3 x 24 steps, unsliced. Its cost per frame is what "light rebake every frame" in the
  lab measures; the plan's time-slicing is Phase 2+.
- **Go / no-go: not decided.** Waiting for the maintainer's timings at outside / edge / inside.

## 2026-10-17 — Phase 1 timings (maintainer's GPU, WebGPU)

Canvas 2560x1308 (dpr 1.5, about 3.3 MP), 128^3 density, 64^3 light, lab matrix button. GPU render ms, average of 6 readings.

| camera | off | s64 | s32 | s16 |
|---|---|---|---|---|
| outside | 0.95 | 3.91 | 2.86 | 2.11 |
| edge | 0.80 | 37.72 | 26.67 | 20.13 |
| inside | 0.72 | 39.86 | 27.55 | 20.28 |
| above | 1.76 | 19.85 | 12.26 | 8.97 |
| below | 0.52 | 29.49 | 19.91 | 14.40 |

- Clouds off costs 0.5-1.8 ms, so the volume itself costs 1-3 ms from far and 19-39 ms (64 steps) once it fills the screen.
- Cost is not proportional to steps: edge falls 37.7 -> 26.7 -> 20.1 for 64 -> 32 -> 16, which is about 0.35 ms per step plus
  a fixed part of roughly 14 ms that does not shrink with steps. Cause not yet identified.
- The "inside s32 with light rebaked every frame" line (1.30 ms) is **not trustworthy**: it is below the same view's s32 figure (27.55),
  so that reading did not include the march. The light bake cost is still unmeasured; measure it by hand with the lab's rebake toggle.
- Go / no-go: not recorded. Naive Phase 1 is 20-40x over G6 at full resolution; whether Phase 2's savings close that is the open question.

## 2026-10-17 — Phase 1 review (cloud session, code reading only)

Reviewed the Phase 0-1 code and the maintainer's timings. Nothing was run here. Plan 051 is updated to match (status,
§`CloudVolume`, §Rendering step 1, §Moving planets, budget, Phase 2 split into a 2a probe and a 2b build order,
tests, decisions).

### The "light rebaked every frame: 1.30 ms" line is a timer bug, and it probably is the light bake's cost

- In three 0.186, `resolveTimestampsAsync('render')` takes a snapshot of the queries recorded so far, synchronously, and
  returns the sum for the **newest frame** among them (`WebGPUTimestampQueryPool._resolveQueries`, "total duration
  of the last frame").
- The lab calls `GpuTimer.tick` in `tick$`, after `volume.update`. With the rebake on, this frame's bake pass is
  already recorded but its main render is not. The "newest frame" then holds only the bake, so the reading is the
  bake alone. With the rebake off, nothing of the current frame is recorded yet and the previous, complete frame is
  returned, so the matrix's other cells are valid.
- So the light bake (64³ texels × 24 steps, reading the 16 MB RGBA16F density) probably costs **about 1.3 ms
  unsliced**, not the 0.1-0.2 ms the plan estimated. Confirm with the fixed timer.
- **Fix:** read the timer in `renderComplete$` (or first thing in `tick$`). Phase 2's time-sliced bakes run in
  `tick$` every frame, so every reading would be wrong without this.

### Is the stacked estimate fair? (inside, full resolution, 40 ms at s64)

| Lever | Assumed | Assessment |
|---|---|---|
| Fewer steps (16-24) | 2x | Measured: s16 is 20.3 ms. Fair |
| Half resolution | 4x | Slightly optimistic: about 3.5x after the upsample and composite pass (~0.2-0.3 ms at 1440p). The 2a probe measures it directly |
| Temporal reuse | 2x | Only through fewer steps per frame or checkerboarding; it saves nothing by itself. Steps scale sub-linearly here, so 1.3-1.5x is safer unless checkerboarding |
| Distance field / early exit | Unknown | Early exit already exists but rarely fires: at extinction 0.02/m and moderate density, reaching T < 0.01 needs a few hundred metres, about the box size. Empty-space skip helps edge and below more than inside |
| **Missing: packed density format** | Not counted | Likely the biggest unknown win: 8 bytes per voxel to 1, and one fetch instead of two per step most of the time |

Overall the 2.5 ms worst case is a fair centre. Without the format gain it is slightly optimistic; the honest range is
about 1.5-5 ms. Typical views (from outside, partial coverage) cost 2-3 ms at full resolution today and should land
well inside 1.5 ms. Recommendation: a **conditional go**, settled by the Phase 2a probe's go line (Plan 051, Phase 2).

### Where the ~14 ms that doesn't shrink with steps may come from

Per-pixel fixed work (box intersection, phase `pow`, two matrix products, one HDR blend) is well under 1 ms at 3.3 MP,
so it is not that. Ranked guesses, each testable with one 2a toggle:

1. **Fetch cost rises as steps get longer.** The interleaved-gradient jitter offsets neighbouring pixels by up to one
   step. At 16 steps that is 4-8 texels, and adjacent z slices sit 128 px apart in the atlas, on a 16 MB texture
   larger than most L2 caches. As steps drop, each fetch misses the cache more often. Test: **jitter off**.
2. **Memory-bound march in general**: every step pays two atlas fetches plus uv maths, even in empty space. Test:
   **no fetch** (analytic density). If s64 falls from ~38 ms to a few ms, packing is lever number one.
3. **Warp divergence**: a warp runs as long as its longest ray. This is mostly proportional to steps, so it is a
   weak candidate.

It is worth testing before Phase 2 only because the test is cheap (two toggles, one run) and decides whether packing
or half resolution comes first.

### Code review against the design

Correct:
- The march maths. `dir` is the world direction through the inverse matrix, so `t` and `dt` stay in world metres
  and `sigma × dt` is right. The slab test, `tNear` clamped to 0 for an inside camera, and back-face proxy are right.
- The integration `T × (1 - e^(-σ dt)) × S` (energy-conserving for albedo 1), the premultiplied output with
  `premultipliedAlpha`, and the early exit.
- The light bake: the sun in the volume's metres frame (rotation only), the slab exit, and reading density in the
  unit frame.
- The rebake tolerance compares the sun in the volume's frame, so a spinning parent triggers it. Specs cover it.
- The atlas read clamps x and y to half a texel, so nothing bleeds between slices.

To fix (in the Phase 2 order; none blocks the 2a probe except the timer):
1. **Timer read mid-frame** (above).
2. **Precision** goes against the plan's rule: `uInverse × cameraPosition` and `positionWorld - cameraPosition` are
   float32 world maths on the GPU. Fine at the lab's 2 km planet, shimmering at planet scale (float32 spacing is
   about 0.5 m at 6 400 km). Fix: camera position in the unit frame from the CPU, direction = `positionLocal` minus it.
3. **Uniform freshness:** `uInverse` and `uSunLocal` are set in `update()` from `tick$`. If a parent planet's
   transform is written later in the frame, the march uses last frame's matrix and the cloud slides inside its box by one
   frame of motion. Fix: a per-object uniform updated at draw time (`uniform(...).onObjectUpdate`, the same pattern as
   three's `modelWorldMatrixInverse`). The rebake decision can stay in `update()`, since one frame late is harmless there.
4. **Fixed step count per ray:** a ray that clips a corner pays all 64 steps, and long rays undersample. Step by
   length with a cap.
5. **Static jitter:** no per-frame offset yet; temporal reuse needs one.
6. **Light bake undersampling:** 24 steps over up to ~630 m is ~26 m per step against 4.7 m density texels, with
   no jitter, so low-sun self-shadow will band. Scale the step count with path length, capped.
7. Minor:
   - `setExtinction` calls `invalidateDensity`, which rebakes the 4-octave noise. Extinction only affects the
     light; add `invalidateLight()`.
   - `uSize` is fixed at construction, but the march uses the mesh's matrix. If anyone changes `mesh.scale`, the
     two disagree; derive `uSize` from the decomposed scale.
   - `frustumCulled = false` is not needed (the scaled box culls correctly). With up to 8 volumes, culling is free
     savings.
   - The phase is scaled by π (`phase × 4π × 0.25`), an art factor. Phase 3 must use sun radiance × phase, or the
     clouds will be off by π against the sky.
   - `GpuTimer.reset()` does not drop a read already in flight, so the first sample after a preset change can come
     from the old view. The matrix's 800 ms wait hides it; add a generation counter.

### Red-format targets

Not worth chasing before Phase 2. Packing four slices per RGBA8 texel costs the same 1 byte per voxel as R8, returns both slices of a trilinear read
in one fetch most of the time, and keeps the RGBA readback that already works. The cause (likely a gap in the WebGL backend's readback for single-channel
half-float targets) can be a footnote.

## 2026-10-17: Phase 2a probe tooling built (not yet run)

- **GPU timer** now ticks from `renderComplete$` (after the frame's main render) instead of `tick$`, so a sample covers the bakes and the march of one frame.
- **Lab controls:** render scale 1x / 0.5x (`renderer.setPixelRatio(engine.pixelRatio × scale)`), `jitter off` (`CloudVolume.uJitter`), and `no fetch` (`CloudVolume.uFetch`, an analytic blob replaces the density and light atlas reads).
- **Matrix button** now runs scale 1 and 0.5 × five cameras × off / 16 / 24 / 32 steps (cloud columns are net of "off" at the same scale), then inside s32 at scale 1 with jitter off, no fetch and rebake every frame, and prints the go-line verdict (net cost at 0.5x, s24, inside: ≤ 8 go, 8-12 pack first, > 12 no-go).
- **Checked:** 8/8 specs, library build, `tsc` of the demo app. **Not checked:** the new shader and matrix in a visible browser (the pane was hidden, canvas 0 px). The maintainer's run is the first real test; the results go in a new entry here.

### Correction, same day: the first Phase 2a matrix run is invalid

The first build of the `no fetch` switch wrapped the density read in a uniform `If`/`Else` writing a `toVar`. On WebGPU that branch returned no density, so **no clouds were drawn** and every number from that run (including the 5.21 ms "go" figure) measured an empty march. The switch is now a separate shader variant (`CloudVolume.setFetchEnabled`), with the default path back to plain atlas reads. Checked by eye in the lab on WebGPU: clouds visible from the edge preset with fetch on, and a soft blob with fetch off. The matrix must be re-run on this build before the go line is read.

## 2026-10-17: Phase 2a probe result (maintainer's GPU, WebGPU, clouds verified visible)

Run on the fixed build (`CloudVolume.setFetchEnabled` variant, GPU timer read after the main render). Canvas 2560x1308 at scale 1, 1280x654 at scale 0.5, density 128, light 64. GPU render ms, cloud columns net of "off" at the same scale.

| scale 1 | off | net16 | net24 | net32 |
|---|---|---|---|---|
| outside | 0.90 | 0.68 | 0.91 | 1.09 |
| edge | 0.88 | 15.29 | 19.15 | 21.75 |
| inside | 0.69 | 16.70 | 20.24 | 23.29 |
| above | 1.80 | 6.49 | 8.16 | 9.83 |
| below | 0.55 | 13.35 | 16.25 | 18.98 |

| scale 0.5 | off | net16 | net24 | net32 |
|---|---|---|---|---|
| outside | 0.29 | 0.20 | 0.30 | 0.37 |
| edge | 0.25 | 4.05 | 5.00 | 5.89 |
| inside | 0.21 | 4.22 | 5.20 | 5.96 |
| above | 0.50 | 1.82 | 2.25 | 2.78 |
| below | 0.14 | 3.52 | 4.35 | 5.10 |

Inside, s32, scale 1, total ms: base 23.94, jitter off 12.71, no fetch 12.10, light rebaked every frame 24.85.

**Go line:** net cloud cost at scale 0.5, s24, inside = 5.20 ms. That is under the 8 ms line, so the plan's rule gives **go, 2b in the order given**. The go itself is the maintainer's to record; Phase 2b is not started.

Readings (measured, not yet explained):
- Cost scales with pixel count, not steps: scale 0.5 is about a quarter of scale 1 (20.24 -> 5.20), and steps are roughly linear on top of a base (s16 -> s32 is 16.7 -> 23.3 inside).
- The fixed cost seen in Phase 1 (~14 ms that did not shrink with steps) is not the bakes: the light rebake adds only about 0.9 ms per frame (24.85 vs 23.94), and "off" is under 1 ms at every view. It sits inside the march per pixel.
- Jitter off nearly halves the frame (23.94 -> 12.71). Likely jitter breaks texture-cache coherence between neighbouring pixels, so the dense atlas reads miss the cache. Worth trying a cheaper jitter (blue-noise or per-tile) in 2b.
- No fetch (analytic blob instead of atlas reads) gives 12.10, similar to jitter off. Atlas reads are about half the cost, which supports packing the atlases (2b step 1).
- The "no fetch" row recompiles the shader, so it is a lower bound on non-fetch work.
- Scale 0.5 may look soft on cloud edges; not judged here.

## 2026-10-17: Phase 2b step 1 built, packed atlases (not yet measured)

The maintainer recorded the go on the Phase 2a probe (5.20 ms net at scale 0.5, s24, inside).

### Built
- `CloudVolumeAtlasLayout` is now packed: each atlas cell holds four consecutive z slices in R, G, B, A, and groups advance by three slices, so slice `3g + 3` is stored in two groups. Any neighbouring slice pair `(z, z + 1)` sits in one texel of one group, so a trilinear read is one hardware-bilinear fetch plus a channel blend (weights from `z0 mod 3` and the fraction). Before it was two fetches. `sample` clamps `z0` to `size - 2` so `z1` never leaves the volume.
- Density 128 is 43 groups in 8 columns: a 1024x768 RGBA8 target (was 2048x1024 RGBA16F). Light 64 is 21 groups: 512x192 RGBA16F (was 1024x256). Density is a 0..1 fraction, so 8 bits is enough; light optical depth is unbounded and stays half float.
- Bakes write four slices per fragment (four noise evaluations, or four sun rays). Total bake work is about 4/3 of before because the overlapped slices are computed twice.
- Specs read back through `layout.slotOf(z)` for the channel; density readback now handles `Uint8Array`.

### Checked
- `npm run test:triangular-engine:cloud-volumes` 8/8 (the light bake reads the packed density through the new sample path, so it covers it on the WebGL2 backend); `tsc` for the demo app clean.
- By eye on WebGPU in the lab (edge preset): soft cumulus-like clouds with the same shading as before; no console errors from the cloud passes (the only errors were from a zero-size canvas at page load).
- Not measured: the pane canvas is small, so its 9.4 ms is not comparable. The matrix must be re-run at full size and compared with the Phase 2a table (inside, s32, scale 1: base 23.94 ms; scale 0.5 s24 net 5.20 ms).

### 2b step 1 measured (maintainer's GPU, WebGPU, same canvas sizes as Phase 2a)

GPU render ms, cloud columns net of "off" at the same scale.

| scale 1 | off | net16 | net24 | net32 |
|---|---|---|---|---|
| outside | 1.30 | 0.24 | 0.34 | 0.44 |
| edge | 1.31 | 4.75 | 6.43 | 8.59 |
| inside | 1.13 | 5.87 | 7.80 | 10.13 |
| above | 2.04 | 2.83 | 4.22 | 5.37 |
| below | 0.89 | 5.50 | 7.60 | 9.90 |

| scale 0.5 | off | net16 | net24 | net32 |
|---|---|---|---|---|
| outside | 0.27 | 0.11 | 0.12 | 0.14 |
| edge | 0.24 | 1.12 | 1.62 | 2.13 |
| inside | 0.17 | 1.48 | 2.13 | 2.67 |
| above | 0.55 | 0.69 | 0.98 | 1.33 |
| below | 0.16 | 1.40 | 2.01 | 2.52 |

Inside, s32, scale 1, total ms: base 10.87, jitter off 10.56, no fetch 12.05, light rebaked every frame 11.63.

- Packing roughly halves the cost: inside s24 net at scale 1 went 20.24 -> 7.80 ms, at scale 0.5 5.20 -> 2.13 ms; inside s32 total went 23.94 -> 10.87 ms. Even full resolution now fits the 8 ms line at s24.
- Jitter off no longer matters (10.87 -> 10.56, was 23.94 -> 12.71). That fits the reading that the cost was cache misses on scattered atlas reads; the smaller RGBA8 atlas and single fetch stay in cache.
- The "no fetch" run (12.05) is now slower than the base, so it is no longer a usable lower bound: the analytic blob costs more ALU than the packed read. Drop that switch from the matrix reading; keep it only as a debug view.
- Light rebake every frame adds about 0.76 ms (11.63 vs 10.87), so step 5 (time-sliced rebake) is low priority.
- "off" is 0.2-2 ms and varies between runs (inside 0.69 before, 1.13 now); read it as timer noise of about 0.5 ms.
- The first-pass go line is 2.13 ms at scale 0.5 (was 5.20). Next: step 2 (unit-frame march).

## 2026-10-17: Phase 2b step 2 built, unit-frame march (not yet measured)

### Built
- The march no longer maps the world `cameraPosition` and `positionWorld` through an inverse matrix in float32. A per-object uniform `uCameraLocal` (`onObjectUpdate`) holds the camera in the box's unit frame, computed on the CPU in double precision at draw time. The ray direction is the interpolated box vertex (`positionLocal`) minus that position. No world-space position reaches the shader any more; `uInverse` and `uSunWorld` are gone.
- `t` is now a fraction of the camera-to-vertex segment. `dirLength` (the segment in metres) converts it for extinction, so `dt` metres = `dt * dirLength`. The phase function uses the ray direction in the volume frame against `uSunLocal` (the sun in the same frame).
- Steps are by length: `count = clamp(ceil(segmentMetres / (uStepTexels * texelMetres)), 1, uMarchSteps)`, with `uStepTexels` = 1.5 density texels. `uMarchSteps` is now a cap, so a ray that only clips a corner takes a few steps. Long rays still hit the cap, so the full-crossing cost is unchanged.

### Checked
- Specs 8/8 and demo-app `tsc` clean. By eye on WebGPU: clouds draw from outside, at the edge and inside, no console errors. Not tested at planet scale (the lab planet is 2 km, where float32 was already fine), so the shimmer fix is by construction, not observed.
- Not measured: re-run the matrix. Expect a lower cost at outside / edge views (short rays), and about the same inside. The 8 ms packed-atlas figures are the baseline.

### 2b step 2 measured (maintainer's GPU, WebGPU)

GPU render ms, cloud columns net of "off" at the same scale.

| scale 1 | off | net16 | net24 | net32 |
|---|---|---|---|---|
| outside | 0.92 | 0.24 | 0.23 | 0.37 |
| edge | 0.94 | 4.46 | 6.47 | 8.19 |
| inside | 0.66 | 5.84 | 8.41 | 10.59 |
| above | 1.73 | 2.58 | 3.56 | 4.28 |
| below | 0.51 | 5.74 | 8.05 | 10.42 |

| scale 0.5 | off | net16 | net24 | net32 |
|---|---|---|---|---|
| outside | 0.26 | 0.08 | 0.10 | 0.08 |
| edge | 0.21 | 1.19 | 1.68 | 2.11 |
| inside | 0.20 | 1.47 | 2.08 | 2.68 |
| above | 0.48 | 0.67 | 0.92 | 1.10 |
| below | 0.13 | 1.46 | 2.05 | 2.64 |

Inside, s32, scale 1, total ms: base 11.22, jitter off 10.85, no fetch 13.87, light rebaked every frame 11.94.

- As expected, no change where rays cross the whole box: inside s32 stays about 10.6 net (step 1: 10.13), within run noise. The line-of-sight cap is hit, so the step count is the same.
- Only the short-ray view gained: above s24 went 4.22 -> 3.56 ms. Outside stays about 0.3 ms.
- The point of step 2 is shimmer at planet scale, which this lab (2 km planet) cannot show. It stays unverified until the moving planet lab (step 7) or a larger test scene.
- Go line at scale 0.5: 2.08 ms (step 1: 2.13).

## 2026-10-17: Phase 2b step 3 built, half-resolution screen pass (not yet measured)

### Built
- `CloudVolumeScreenPass` (`cloud-volumes/cloud-volume-screen-pass.ts`, exported): a three `RenderPipeline` that draws the scene with `pass(scene, camera)` (colour + depth), marches every volume once per low-resolution pixel into an `rtt` target (`resolutionScale`, default 0.5 per axis, so a quarter of the pixels), and composites. Each ray stops at the scene surface (distance from the depth texture and the inverse projection), so clouds sit in front of and behind other geometry, including a planet poking into the box. The box-proxy mesh is not used in this mode.
- Upsample: depth-aware bilinear. Four low-resolution taps, each weighted by bilinear weight times `exp(-relativeDepthDifference * sharpness)` (default 40), then normalised; the depth for each tap comes from the full-resolution depth at that tap's centre, the same place the march read it. Composite is `scene * (1 - cloud.a) + cloud.rgb`, and the output alpha is the over-operator, not the scene alpha (first try used the scene alpha and showed no clouds over the sky).
- `CloudVolume`: `buildMarchNode(origin, dir, limitMetres)` is now shared between the box mesh (`buildBoxMarchNode`) and the screen pass (`buildScreenMarchNode`); `setView(camera)` sets the camera in the volume frame (double precision) and the world-to-volume direction matrix; `onMarchRebuilt` lets the pass rebuild after the `no fetch` toggle.
- Lab: `clouds drawn as` buttons (box mesh, screen pass x0.5, screen pass x1) and the matrix now runs three blocks: box mesh at canvas x1, box mesh at canvas x0.5, screen pass x0.5 at canvas x1. "off" for the pass block is the pass with no volume, so it includes the scene render target and the composite; cloud columns stay net of that.
- A `debugView` on the pass (`clouds`, `surface`, `depth`, `ray`) for the next steps.

### Found
- The `camera*` TSL nodes (`cameraNear`, `cameraProjectionMatrixInverse`, `cameraWorldMatrix`) resolve to the full-screen quad's camera inside an `rtt` and in the pipeline's output, not the scene camera. The pass mirrors the scene camera into its own uniforms each frame. Anything built on the pipeline later has to do the same.

### Checked
- Specs 8/8, `tsc` clean, `npm run build:triangular-engine` passes. By eye on WebGPU (edge preset): clouds look like the box mesh version at the same camera; no console errors.
- Not checked: a view where the planet crosses the cloud box, the x1 pass mode, or silhouette halos at the planet's edge (the sharpness 40 is a first value, not tuned). Not measured: the lab matrix has to be re-run for the new block.

### 2b step 3 measured (maintainer's GPU, WebGPU, canvas 2560x1308)

GPU render ms; cloud columns net of "off" in the same block. For the pass block, "off" is the pass with no volume.

| box mesh, canvas x1 | off | net16 | net24 | net32 |
|---|---|---|---|---|
| outside | 0.95 | 0.17 | 0.21 | 0.30 |
| edge | 0.86 | 4.51 | 6.48 | 8.26 |
| inside | 0.65 | 5.95 | 8.32 | 10.59 |
| above | 1.68 | 2.71 | 3.65 | 4.34 |
| below | 0.54 | 5.73 | 8.10 | 10.47 |

| screen pass x0.5, canvas x1 | off | net16 | net24 | net32 |
|---|---|---|---|---|
| outside | 1.75 | 0.15 | 0.17 | 0.23 |
| edge | 1.63 | 1.14 | 1.59 | 2.04 |
| inside | 1.52 | 1.42 | 1.97 | 2.59 |
| above | 2.57 | 0.69 | 0.94 | 1.13 |
| below | 1.38 | 1.38 | 1.96 | 2.54 |

(The box mesh x0.5 block matches step 2 within noise; inside s32 x1 total 11.27 ms.)

- The pass at canvas x1 costs what the box mesh costs at canvas x0.5: inside s24 net 1.97 ms against 8.32 ms for the mesh, about 4.2x less. Full-resolution output, quarter-resolution cost.
- The pass adds a fixed cost: "off" rises by about 0.9 ms (inside 1.52 against 0.65; outside 1.75 against 0.95), the scene render target plus the composite. It is paid whether or not a cloud is on screen.
- Totals, inside s24: pass 1.52 + 1.97 = 3.5 ms against mesh 0.65 + 8.32 = 9.0 ms. Outside, the mesh is cheaper (0.95 + 0.21 = 1.2 ms against 1.75 + 0.17 = 1.9 ms); the pass wins whenever the cloud covers many pixels.
- Not yet looked at: silhouette halos at the planet edge, a planet crossing the box, and the x1 pass setting (a full-resolution pass would show whether the fixed cost drops when the cloud is cheap).

## 2026-10-17: Lab additions before step 4 (many volumes, ground and horizon views, fly-by)

The maintainer pointed out that every test so far used one cloud box floating over a plain planet, with five camera spots and no motion. Step 4 (temporal reuse) can only be judged in motion and Phase 6 needs many volumes, so the lab gained, before any step 4 work:

- **Volume count 1 / 4 / 12.** Extra volumes sit on the great circle through the main one, 700 m apart, at alternating heights (centre 250 m, or 60 m so their bottoms cross the ground), each turned to the local up, each with its own noise seed and light bake. Settings (steps, extinction, jitter, fetch, rebake) apply to all.
- **`horizon` and `ground` camera presets** (looking along that circle at 200 m and 45 m altitude). They show clouds against the planet and boxes the planet crosses. They are also part of the matrix, so a matrix run now has seven rows.
- **Fly-by test (2 x 20 s).** A scripted camera pass along the circle at 250 m, 2.4 km at 120 m/s, once with box meshes and once with the half-resolution pass, reporting average, 95th percentile and worst GPU sample (one sample per 10 frames). It uses the current volume count and settings. The matrix header now also prints the volume count.

### Found
- **Texture-binding limit.** Marching 12 volumes in one shader needs 25 sampled textures (two atlases each plus depth), and a WebGPU fragment stage allows 16 by default (this adapter reports 48 as a higher limit, which has to be requested at device creation, and other GPUs will differ). The first try rendered nothing. `CloudVolumeScreenPass` now marches at most 6 volumes per cloud target (13 textures) and composites the chunks far to near; 12 volumes give two targets. This is a stop-gap that costs one more half-resolution target and one more upsample per chunk. It also means per-volume atlases do not scale to a planet covered in clouds: Phase 6 needs shared atlases (one density and one light texture holding many volumes' bricks) or a different path for far clouds, whichever the plan picks.
- **No ordering between volumes** inside a chunk or across chunks (list order = far to near). The lab list is not sorted by distance, so overlapping boxes can composite in the wrong order when the camera moves. Real coverage needs a per-frame sort.
- By eye, 12 volumes at the horizon preset draw correctly in both modes; box mesh 5.4 ms, pass 3.6 ms in the (small) preview pane, not comparable with the maintainer's canvas. The maintainer's matrix and fly-by runs are still to come.

### Lab additions measured, one volume (maintainer's GPU, WebGPU, canvas 2560x1308)

Matrix with the new `horizon` and `ground` rows (other rows match steps 1-3 within noise: inside s24 net 8.23 ms mesh, 2.03 ms pass). GPU render ms, cloud columns net of "off":

| view | block | off | net16 | net24 | net32 |
|---|---|---|---|---|---|
| horizon | box mesh x1 | 0.79 | 0.14 | 0.21 | 0.24 |
| horizon | screen pass x0.5 | 1.71 | 0.12 | 0.16 | 0.14 |
| ground | box mesh x1 | 1.02 | 1.71 | 2.38 | 3.00 |
| ground | box mesh, canvas x0.5 | 0.31 | 0.49 | 0.60 | 0.75 |
| ground | screen pass x0.5 | 1.87 | 0.54 | 0.76 | 0.88 |

Fly-by, 1 volume, **64 steps**, 2.4 km at 120 m/s, 250 m altitude, whole frame (clouds on, nothing subtracted), one sample per 10 frames:

| mode | avg | p95 | max | samples |
|---|---|---|---|---|
| box mesh | 3.05 | 13.83 | 16.45 | 273 |
| screen pass x0.5 | 2.49 | 5.11 | 6.03 | 320 |

- The new views are cheap for one volume: horizon is about 0.2 ms net either way, ground about 2.4 ms (mesh) and 0.8 ms (pass) at s24. The box that the planet crosses is not a cost problem for one volume.
- The fly-by shows what the five still views hid: the mesh averages 3.05 ms but spikes to 13.8 (p95) and 16.5 (max) when the camera is inside or at the edge; the pass spikes to 5.1 and 6.0, about 2.7x lower at the same 64 steps, with a lower average too (2.49) despite its fixed cost of about 0.9 ms. The pass's worst frame is the more important number for the G6 worst-case budget.
- Not comparable with G6 yet: the fly-by is whole-frame and at 64 steps, while the matrix tables are cloud-only at 24. Rerun at 24 steps (the setting G6 is judged at) and at 4 and 12 volumes.
- Not yet run: 4 and 12 volumes (matrix and fly-by).

### Fly-by, 12 volumes, 64 steps (maintainer's GPU, WebGPU)

| mode | avg | p95 | max | samples |
|---|---|---|---|---|
| box mesh | 9.40 | 18.55 | 24.18 | 167 |
| screen pass x0.5 (2 cloud targets) | 5.03 | 7.14 | 7.86 | 269 |

- Against one volume (3.05 / 13.83 / 16.45 mesh; 2.49 / 5.11 / 6.03 pass): the mesh average triples (every overlapping box is marched at full resolution), the pass average doubles (+2.5 ms for 11 more volumes, about 0.23 ms each) and its worst frame rises only from 6.0 to 7.9 ms. The pass scales much better, but is still whole-frame at 64 steps, so not yet comparable with G6.
- Only the fly-by at 64 steps was reported; the 24-step runs and the 4-volume runs are still open.

### Multi-volume results at 24 steps (1, 4 and 12 volumes), and a quick re-test button

Run with "run everything" (about 15 minutes), WebGPU, dpr 1.5, canvas 2560x1308. Fly-by is whole frame, 2.4 km at 120 m/s, 250 m altitude.

| volumes, steps | box mesh avg / p95 / max | screen pass avg / p95 / max |
|---|---|---|
| 1, 24 | 2.44 / 8.06 / 8.52 | 2.19 / 3.41 / 3.54 |
| 1, 64 | 3.05 / 13.89 / 16.71 | 2.53 / 5.24 / 5.57 |
| 4, 24 | 5.98 / 11.47 / 13.17 | 3.23 / 4.52 / 4.78 |
| 4, 64 | 9.23 / 18.55 / 23.59 | 4.24 / 6.55 / 7.34 |
| 12, 24 | 6.16 / 11.93 / 13.70 | 4.15 / 5.37 / 5.64 |
| 12, 64 | 9.46 / 18.74 / 24.38 | 5.06 / 7.27 / 7.93 |

Screen pass net cloud cost (over its own "off"), 24 steps, canvas x1 / cloud x0.5:

| camera | 1 volume | 4 volumes | 12 volumes |
|---|---|---|---|
| inside | 2.03 | 2.41 | 3.34 |
| edge | 1.65 | 1.82 | 2.65 |
| below | 1.99 | 2.24 | 2.98 |
| above | 0.88 | 1.26 | 2.12 |
| ground | 0.73 | 1.75 | 2.48 |
| horizon | 0.18 | 0.65 | 2.16 |
| outside | 0.24 | 0.79 | 1.66 |

Reading:
- The pass wins everywhere in motion: 12 volumes at 24 steps is 4.15 ms average, 5.64 ms worst, against 6.16 / 13.70 for the mesh. Its p95 stays close to its average (no spikes).
- Against G6 (<= 1.5 typical, <= 2.5 worst, cloud only): one volume inside is 2.03 (under the worst-case line, over the typical line); 12 volumes inside is 3.34, over. With 12 volumes the pass is clearly over budget even at 24 steps, so step 4 (temporal reuse) and step 6 (empty-space skip) are needed, not optional.
- Horizon and outside at 12 volumes cost 2.16 / 1.66 ms in the pass although few or no volumes are near: every low-res pixel still runs every volume's box test and loop set-up (the mesh path pays 0.88 at horizon because rasterisation culls). Fix candidates: cull volumes on the CPU by frustum and rebuild the chunks when the visible set changes, or a per-volume early-out before the loop.
- Rebake every frame (the moving-sun case) at 12 volumes: 21.61 vs 12.69 ms. Step 5 (time-sliced rebake) matters for the moving worst case.
- Fixed cost of the pass: its "off" column is about 0.8 ms above the mesh's; part of the gap against the budget.

Lab: a "quick re-test" button now runs only the screen pass at 24 steps for 1, 4 and 12 volumes (a 12 s fly-by and four camera spots each, about 2 minutes). "run everything" stays for full records.

### Step 3b: per-volume frustum visibility (not yet measured)

`CloudVolume.setView` now also tests the box against the camera frustum (`inView`). A volume outside the frustum ends every screen-pass ray at once through a uniform (`uScreenVisible`), so there is no shader recompile when the camera turns. The box-mesh path is unchanged (the GPU already culls it). The saving only applies to volumes truly out of view: if the horizon spot has all 12 volumes in the frustum, its 2.16 ms will not move. Re-test with the quick re-test button and compare against the 24-step table above.

Result of step 3b (quick re-test, screen pass, 24 steps): no measurable change. Net inside / above / horizon / ground, 1 volume: 2.04 / 0.99 / 0.14 / 0.72; 4 volumes: 2.55 / 1.42 / 0.75 / 1.80; 12 volumes: 3.46 / 2.22 / 2.19 / 2.62 (before: 3.34 / - / 2.16 / -). Fly-by at 12 volumes avg 4.22, max 5.51 ms. Reading: the volumes are inside the frustum at these spots, so the visibility check has nothing to cull, and the per-volume cost is real marching, not wasted rays. The remaining levers are fewer marched samples (step 4 temporal reuse, step 6 empty-space skip), not culling. The frustum check stays: it is free and helps when the camera turns away.

### Step 4: temporal reuse (built, not yet measured on the target canvas)

What it does (`CloudVolumeScreenPass`, option `temporal`, default on; lab button "temporal reuse"):

- Each march takes `temporalStepScale` (0.5) of the step cap, and the start jitter gains a per-frame golden-ratio offset, so successive frames sample different depths.
- A second RTT per chunk blends this frame with last frame's result at 0.85 when valid. The history position is found by projecting the middle of the nearest volume's span inside the box with last frame's `projection x view x box` matrix (`CloudVolume.buildScreenReprojectionNode`, kept in double on the CPU, so a turning or orbiting box reprojects with its own motion). The history is clamped to the min/max of this frame's 3x3 neighbourhood (rejects ghosts and disocclusions), and a resize or a rebuild drops the blend for a frame.
- History is a per-chunk half-float target filled by `renderer.copyTextureToTexture` after each frame.

Checked in the browser pane (WebGPU, small canvas): no validation errors, the pass renders clean on and off, and a sideways move shows no visible ghosting. Timings in that small canvas are fixed-cost dominated (about 4.0 ms on, 4.1 ms off at 64 steps), so they say nothing about the 2560x1308 target: re-run the quick re-test with temporal on (its header now says so) and compare with the 24-step tables. Known limits: the reprojection depth is the span midpoint, not the true hit distance, so thin clouds in front of thick ones can smear slightly under fast motion; a reprojection spec covers the matrix maths only.

#### Step 4 result: measured slower, default is now off

Quick re-test at 2538x1308, 24 steps, temporal on, against the earlier off numbers:

| volumes | fly-by avg (off to on) | net inside / above / horizon / ground (off) | net (on) |
|---|---|---|---|
| 1 | 2.23 to 2.41 | 2.04 / 0.99 / 0.14 / 0.72 | 1.66 / 1.06 / 0.63 / 0.82 |
| 4 | 3.31 to 3.20 | 2.55 / 1.42 / 0.75 / 1.80 | 2.10 / 1.41 / 0.92 / 1.87 |
| 12 | 4.22 to 4.94 | 3.46 / 2.22 / 2.19 / 2.62 | 3.78 / 3.15 / 3.10 / 3.62 |

Halving the steps does not pay for the extra accumulate pass, history copy and second full-res read. The march is not step-count bound, so the remaining lever is doing less work per ray: the empty-space skip (step 6) and the rebake cost (step 5). The code stays behind `temporal` (default false) and can be revisited once step 6 shrinks the march enough for fixed pass cost to matter less.

### Step 6: empty-space skip (built, not yet measured)

- `CloudVolume.occupancyTarget` is a coarse grid (density size / 8, capped at 16^3, same packed atlas layout) holding, per cell, the largest density in the cell grown by 1.5 texels each way. It is baked right after the density atlas (one-off: about 12^3 reads per channel per cell at 128^3).
- The march reads it before every density fetch. A trilinear read of the grid is exactly zero only when every density texel that can reach that point is zero, so on a zero the ray leaps one cell (`max(dt, cell)`) without touching the density or light atlas. The loop budget now bounds sampled steps, so a ray spends it on cloud, not on air.
- Cost: one more sampled texture per volume (3 each), so the screen pass marches 5 volumes per cloud target instead of 6.
- Lab: "empty-space skip: on/off" button (`CloudVolume.uSkipEmpty`, no recompile); the matrix and fly-by headers print `skip on/off`.
- Spec: occupancy is zero only where the density atlas is zero across the cell and its margin, and the grid is neither all empty nor all full.
- Checked: type-check, library build, 10 cloud-volumes specs, lab loads and draws in the in-app browser with no new console errors (the 25-texture `RTT_60` error is unchanged and appears with 1 volume, so it is not from the volume chunking). Gain not yet measured: run the quick re-test with skip on, then off.

### Step 6 result: skip is a wash; chunk count is the real cost

Same-build A/B, skip on vs off (GPU ms, 2560x1308):

| volumes | fly-by on / off | net inside on / off | above | horizon | ground |
|---|---|---|---|---|---|
| 1 | 2.06 / 2.18 | 2.29 / 2.01 | 0.80 / 1.05 | 0.17 / 0.19 | 0.56 / 0.69 |
| 4 | 3.04 / 3.14 | 2.64 / 2.40 | 1.19 / 1.23 | 0.53 / 0.47 | 1.14 / 1.22 |
| 12 | 4.60 / 4.75 | 4.30 / 4.04 | 2.79 / 2.85 | 2.54 / 2.51 | 2.73 / 2.85 |

- The skip gains at most about 0.15 ms on the fly-by and loses about 0.25 ms inside a cloud, so `uSkipEmpty` now defaults to 0 (the toggle stays).
- The occupancy sampler made each volume read three textures, which cut a chunk from 6 volumes to 5 and made 12 volumes render as 3 chunks. That regressed the 12-volume fly-by from 4.22 to 4.75 ms: each extra chunk costs about 0.5-0.8 ms of half-res target write plus composite taps even when its rays miss.
- Tried: derive the chunk size from the device limits and request 48 sampled textures per stage in the lab. It does not work: the adapter supports 48 sampled textures but only 16 samplers per stage, and every sampled texture takes a sampler slot. Requesting 48 samplers fails device creation and the lab silently falls back to WebGL2 (a warning in the console), so those numbers are not comparable. The lab no longer requests limits; the chunk size is `min(textures, samplers)` from the device, which is 5 volumes per chunk here.
- Open: to get more volumes per chunk, a volume must use fewer samplers (read the occupancy grid and, in Phase 6, shared atlases, with `textureLoad`, which needs no sampler), or share one sampler between textures. Not done.

### Steps 4 and 6 removed (review, after the Step 6 result)

- Both were removed from the code. Temporal reuse lives in commit 72839e0 and the empty-space skip with its occupancy grid in dd9890e, if a later phase wants them. The frustum visibility uniform from Step 3b stays.
- Why: both cut steps per ray, and the 8 vs 24 step runs show the cost is not in the steps. At 12 volumes it is a fixed cost per pixel, per volume and per chunk. The skip also cost a sampler per volume even when off, and its gain was inside noise.
- With occupancy gone a volume reads two textures, so a chunk holds 7 volumes (`min(textures, samplers) - 1` over two, from the device limit; the adapter allows only 16 samplers, so raising limits was never an option).
- The 12-volume case is not a 2b requirement (it was a lab stress preset). G6 status is recorded in Plan 051. If step 3c (half-res box proxies) does not bring 12 volumes under budget, the many-volume case becomes its own Phase 6 gate.
- Measurement from now on: per change, record inside net at 4 volumes (worst), horizon net at 4 volumes (typical) and fly-by p95. Ignore differences under about 0.3 ms unless it is the median of 3 runs. Run the full matrix only when closing a phase.
- Next, in order: isolating run (12 volumes with `uScreenVisible` forced to 0 vs 0 volumes), the 25-sampled-textures error (timeboxed), the step 3c spike, step 5 (round-robin rebake, no cross-fade), step 7.

### 4b result: isolating run (hidden vs visible volumes)

Lab "isolating run", screen pass x0.5, horizon preset, 24 steps, whole-frame GPU ms at 2538x1308 (WebGPU, confirmed by the header label):

| volumes | hidden (no marching) | visible | marching part | hidden cost over clouds-off |
|---|---|---|---|---|
| 0 (clouds off) | 1.85 | - | - | - |
| 1 | 1.76 | 2.15 | 0.39 | -0.09 (noise) |
| 4 | 2.26 | 2.39 | 0.13 | 0.41 |
| 12 | 3.48 | 4.18 | 0.70 | 1.63 |

- With every volume outside the frustum and no ray marching at all, 12 volumes still add 1.63 of the 2.33 ms over clouds-off (about 70%), and 4 volumes add 0.41 of 0.54. The march itself is 0.1-0.7 ms.
- So the cost is structural per-volume and per-chunk shader overhead (code that runs per pixel whether or not the ray hits, plus the extra half-res target and composite taps per chunk), not ray steps. This agrees with the 8 vs 24 step runs.
- Consequence for step 3c: box proxies help only if they remove that per-pixel work for pixels the volume does not cover. A screen pass that runs every volume at every pixel cannot be fixed by tuning the march. 1 and 4 volumes already meet G6 as measured; the many-volume case is the one 3c has to fix, otherwise it becomes a Phase 6 gate (one generic loop over volumes with per-volume parameters in a buffer).
- The 1-volume hidden figure is below clouds-off by 0.09 ms; that is inside the 0.3 ms noise floor and not a real gain.

Second isolating run, same build, smaller canvas (1608x1308, dpr 1.5, DevTools docked), whole-frame GPU ms:

| volumes | hidden | visible | marching part | hidden cost over clouds-off |
|---|---|---|---|---|
| 0 (clouds off) | 1.09 | - | - | - |
| 1 | 1.13 | 1.25 | 0.12 | 0.04 |
| 4 | 1.26 | 1.60 | 0.34 | 0.17 |
| 12 | 1.90 | 2.72 | 0.82 | 0.81 |

- Both runs agree that the cost grows with volume count even when nothing is marched, but the split depends on pixel count: at 1608 px wide the fixed part is about half of the 12-volume cost (0.81 of 1.63), at 2538 px about 70%. Treat "mostly fixed overhead" as holding for 12 volumes only; at 4 volumes the marching part is the larger one at the smaller canvas. Canvas sizes differ between the runs, so do not compare absolute numbers across them.

### 4c result: the 25-sampled-textures error is gone

- With the current build (no occupancy texture, chunk size from the device limits, WebGPU confirmed in the header) the lab console shows no pipeline error on load, only the dev-mode and three.js "requestAnimationFrame handler took N ms" violations during first-frame shader compilation. The error was last seen before the occupancy and temporal removal and before the real-backend label, so it most likely came from the earlier unchunked or three-texture builds. Not reproduced, so not investigated further; closed. Reopen if it reappears.

### Step 3c spike (4d): half-res box proxies, built, not yet measured

- `CloudVolumeScreenPass` takes `proxies: true`. It renders each volume's box mesh in one half-resolution `pass()` over a separate box scene, blended by the renderer's far-to-near transparent sort, so only pixels a box covers run that volume's shader and there is no chunking by sampler count (each box is its own draw with two textures). Rays stop at the scene depth: the box material gets a limit node (`CloudVolume.setBoxLimit`, scene distance from the scene pass depth at the fragment). A volume outside the frustum has `mesh.visible = false` and is not drawn.
- Ordering: the box pass reads the scene pass depth, so the screen pass wraps both `updateBefore` calls so the scene pass draws first, once per frame. The box target is cleared to transparent around the pass.
- Lab: "box proxies x0.5 (spike)" button; the quick re-test and run-everything include it. Checked: type-check, 8 specs, lab draws clouds in the in-app browser (two transient size-0 swapchain errors at load or mode switch, not per frame). Not checked: depth correctness against geometry, halo and silhouette, and the numbers.
- Judge by the 3-number check against the screen pass: inside net at 4 volumes, horizon net at 4 volumes, fly-by p95; also 12 volumes.

### 4d result: box proxies vs screen pass (1, 4, 12 volumes)

Fly-by (whole frame GPU ms, 24 steps, screen pass x0.5 vs box proxies x0.5):

| volumes | screen pass avg / p95 | box proxies avg / p95 |
|---|---|---|
| 1 | 2.14 / 3.34 | 2.05 / 3.41 |
| 4 | 3.26 / 4.52 | 3.05 / 4.39 |
| 12 | 4.32 / 5.57 | 3.15 / 4.46 |

- Static matrix: the proxy rows' `off` baselines (4.1-4.4 ms) are wrong and their nets negative. Cause: volumes dropped from the pass list (clouds off, or fewer volumes) stayed in the box scene and kept drawing, so "off" still drew clouds. Fixed afterwards with `boxScene.clear()` in `buildProxies`; re-measure the static matrix before trusting its nets. The absolute "clouds on" totals (off + net, with the screen-pass `off` of about 1.5 as the real baseline) are still usable:

| volumes | camera | screen pass total | proxies total |
|---|---|---|---|
| 4 | inside / above / horizon / ground | 3.90 / 3.76 / 2.13 / 3.62 | 3.80 / 3.62 / 2.14 / 3.57 |
| 12 | inside / above / horizon / ground | 4.95 / 4.80 / 3.90 / 4.53 | 3.84 / 3.63 / 2.65 / 3.49 |

- Reading: at 1 and 4 volumes proxies equal the screen pass (differences under 0.3 ms). At 12 volumes they save about 1.1-1.3 ms in every camera position and about 1.1 ms on the fly-by p95, which brings 12-volume worst (inside) to about 2.3 ms net over clouds-off, under the 2.5 ms bound; horizon net is about 1.0 ms, under 1.5. So 3c fixes the many-volume case without hurting few volumes.
- Not yet checked: depth correctness against geometry, silhouette halos, and the proxy mode's static nets after the fix.

## Step 5: budgeted round-robin rebake (built, not yet measured)

- `CloudVolume` splits a bake into `bakeBands` (default 4) horizontal bands of its atlas, drawn with a render-target scissor and `autoClear` off. `prepare()` queues a job (density, then light, when invalidated or the sun turned past the tolerance), `bakeStep(renderer)` draws one band, and `update()` is still prepare plus all steps, so existing callers behave as before.
- `CloudVolumeBakeScheduler.update(renderer, volumes)` queues every volume, then draws at most `bandsPerFrame` bands, taking turns across volumes. A volume keeps marching its old atlas until its bake finishes. There is no cross-fade, so one frame can show the new light in some bands beside the old.
- Specs (10 pass, WebGL2 headless): a banded bake matches the one-shot bake; the scheduler honours the budget, finishes all volumes and then reports 0 bands drawn.
- Lab: `bake budget` button cycles all at once / 1 / 2 / 4 bands per frame.
- To measure: 12 volumes, animate sun on, compare fly-by p95 and the worst frame between "all at once" and 1 or 2 bands per frame. The light bake is about 0.77 ms per volume, so 1 band of 4 should be about 0.2 ms per frame.

### 4d re-run after the stale-mesh fix (net at 24 steps, canvas x1)

Fly-by avg / p95, screen pass vs proxies: 1 volume 2.15 / 3.34 vs 2.05 / 3.47; 4 volumes 3.30 / 4.52 vs 3.11 / 4.39; 12 volumes 4.35 / 5.70 vs 3.17 / 4.52.

| volumes | mode | inside | above | horizon | ground |
|---|---|---|---|---|---|
| 1 | screen pass | 2.05 | 1.01 | 0.16 | 0.67 |
| 1 | proxies | 2.13 | 0.94 | 0.11 | 0.64 |
| 4 | screen pass | 2.35 | 1.22 | 0.64 | 1.81 |
| 4 | proxies | 2.32 | 1.14 | 0.37 | 1.69 |
| 12 | screen pass | 3.47 | 2.28 | 2.22 | 2.58 |
| 12 | proxies | 2.48 | 1.06 | 1.07 | 1.74 |

The proxy baselines are sane now (off 1.4-2.6 ms, no negative nets). Gate G6 at 12 volumes: proxies meet it (inside 2.48 against 2.5 worst, horizon 1.07 against 1.5 typical, with little margin on inside); the screen pass does not (3.47 and 2.22). At 1 and 4 volumes the two modes are within noise. Still unchecked: proxy visuals (halos, depth against geometry).

### Step 5 result: bake budget, 12 volumes, proxies, sun animating (6 deg/s, worst case)

| budget | fly-by avg / p95 / max (ms) | inside avg (ms) |
|---|---|---|
| all at once | 7.46 / 39.58 / 41.03 | 13.11 |
| 1 band/frame | 3.91 / 5.31 / 5.57 | 4.67 |
| 2 bands/frame | 4.65 / 6.09 / 6.23 | 5.39 |
| 4 bands/frame | 6.10 / 7.60 / 7.86 | 6.97 |

Baking every stale volume in one frame spikes to about 40 ms. One band per frame removes the spikes: p95 5.31 ms, about 0.8 ms over the no-rebake fly-by (3.17 avg, 4.52 p95). A bigger budget only adds cost. Trade-off: with 12 volumes and 4 bands each, a full light refresh takes 48 frames.
