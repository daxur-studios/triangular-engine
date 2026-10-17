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
