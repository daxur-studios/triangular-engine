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
