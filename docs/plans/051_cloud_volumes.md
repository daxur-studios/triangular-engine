---
type: Plan
title: Cloud Volumes
description: Fast, flyable 3D clouds in TSL on WebGPURenderer, using bounded density volumes with baked light and distance fields, lit by the Plan 049 atmosphere, shaped by noise, meshes or GPU particles, plus a cheap planet-scale shell for the far view.
timestamp: 2026-10-17T00:00:00Z
tags: [clouds, volumetric, raymarching, atmosphere, tsl, webgpu, performance, stylized]
runbook: /docs/runbook/051_cloud_volumes.md
---

# Plan 051: Cloud Volumes

Status: **not started, owner: unclaimed.** Approach chosen by the owner on 2026-10-17 (see §Decisions).
Evidence: [Runbook 051](/docs/runbook/051_cloud_volumes.md).

**Goal:** 3D clouds you can fly into and through, lit by the atmosphere (orange at dusk, hazed with
distance), shaped by noise, by any mesh ("a ship made of cloud") or by a GPU particle simulation,
costing little enough that a page running near its vsync cap stays there.

**Builds on:** the atmosphere's public API from [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md)
(`AtmosphereGpuModel`, `AtmosphereAerialPerspectiveLut`, `PlanetAtmosphereBinding`) and the sun-occlusion
slot of [Plan 050](/docs/plans/050_tsl_planet_surface_material.md) (`PlanetSurfaceMaterial.addSunOcclusion`).
Both exist today, so no phase here waits on those plans. This plan delivers the cloud side of Plan 049's
"clouds take aerial perspective and transmitted sun" item.

## Ground rules

- **New entry point, new files only:** `triangular-engine/cloud-volumes`. Do not edit `clouds/` (the mesh
  puffs of Runbook 023), `takram/`, `atmosphere/` or `planet-material/`. Use their public exports only.
  Changes to existing files are limited to the entry-point wiring (`tsconfig.json` paths, `angular.json` test
  target and spec glob, `package.json` test script, demo routes and index) and the plan/runbook indexes.
- **TSL on `WebGPURenderer` only**, like Plans 049 and 050. Every pass must also run on the WebGL2 fallback
  (`forceWebGL`), possibly at a lower tier (see Phase 1).
- **Timed with the GPU, not by frame rate.** 160-165 fps on the maintainer's pages is probably the monitor's
  refresh cap, so "still 160 fps" proves nothing about headroom. Every gate quotes GPU milliseconds.
- **Bake, then look up.** Anything that does not change every frame (lighting inside a volume, the distance
  field) is baked into a texture and rebuilt only when its inputs move, the same way as the atmosphere's tables.
- The engine is public: no consumer app names or paths in code, docs or commit text.

## Goals

| # | Goal |
|---|---|
| G1 | Clouds are 3D: fly up to them, into them and out again with no pop, from inside a volume as well as outside |
| G2 | Lit by the atmosphere: transmitted sun colour, sky ambient, aerial perspective. No white glow at sunset |
| G3 | Any shape: a mesh becomes a cloud of the same shape |
| G4 | Dynamic: animated noise, and density splatted from a GPU particle buffer every frame |
| G5 | Stylized by default (soft toon ramp, crisp edges, silver rim); a softer realistic look from the same renderer later |
| G6 | Budget (GPU, 1440p, maintainer's GPU): **≤ 1.5 ms typical, ≤ 2.5 ms worst case** (camera inside thin, wispy cloud) |
| G7 | From orbit, planet-wide cloud cover for a fraction of a millisecond, casting shadows on the ground |
| G8 | Later: a few point lights (engine flare, lightning) light the cloud from inside |

## What was tried before, and the lesson

| Earlier attempt | Lesson |
|---|---|
| Takram volumetric clouds (Runbook 001): one whole-sky raymarched layer, post effect | Too expensive close up and inside; tied to Takram's pipeline. Here, rays only march inside bounded boxes, and lighting is a texture read |
| Raymarched cloud banks driven by particles | Rejected: expensive close up, and the blended volume hid the moving balls. Here, the stylized defaults keep crisp edges, and particle size and motion stay readable |
| Mesh puff clouds (Runbook 023, `clouds/`) | Crisp, cheap and controllable, but never lit by an atmosphere or placed by planet data. Kept as the fallback technique (option B below) |
| Planet-driven placement (Runbook 025) | Never built. Covered by Phase 6 here |

## Technique options

The costs are estimates for a desktop GPU at 1440p and have not been measured.

| Option | Rough cost | G1 fly-in | G3 shape | G4 dynamic | Verdict |
|---|---|---|---|---|---|
| A. 2D cloud shell around the planet | ~0.2 ms | No | No | Texture only | **Far level of detail** (Phase 6) |
| B. Instanced puffs / soft sprites | 0.3–1 ms | With near fade | Points over the shape | Directly | Fallback if C misses the budget |
| C. Bounded density volumes, baked light + distance field, low-res march with temporal reuse | ~1–2.5 ms | Seamless | Distance-field bake | Splat into the volume | **Main renderer** |
| D. Whole-planet raymarched layer | 3–6 ms+ | Slow inside | No | Noise only | No (tried, see above) |
| E. Gaussian splats | Varies | Yes | Yes | Yes | Not now: per-frame sort, young WebGPU tooling |

## Architecture

### `CloudVolume`

An oriented box in world space (follows an `Object3D`), holding three 3D textures:

| Texture | Default size | Format | Rebuilt when |
|---|---|---|---|
| Density | 128³ (tier: 64³–160³) | R8 (R16F if banding shows) | A source changes |
| Distance (to the nearest voxel above the density threshold) | half the density size | R8, in voxels | Density changes |
| Sun optical depth (through the volume toward the sun) | half the density size | R16F | Density changes, or the sun moves past a tolerance (in the volume's frame) |

About 3 MB per volume at the defaults. Optical depth is stored rather than transmittance because it filters
far more smoothly (the same finding as the froxel table in Runbook 049). The stylized curve is applied at
lookup time, so changing the look never needs a rebake.

**How the bakes are written is decided in Phase 1.** Compute shaders and storage textures do not exist on
the WebGL2 fallback. The atmosphere writes its tables with fragment passes into render targets, which works on
both backends. The default here is the same: fragment passes into a `RenderTarget3D` (or into slices laid side by
side in a 2D target), with compute only as an optional WebGPU fast path.

### Density sources

A volume combines one or more sources (max or add, per source):

- **Noise:** a Worley-Perlin base baked into the density, plus detail noise and a domain-warp offset applied
  *in the march* near edges. Wind and billowing animate through the offset uniforms at no rebake cost; the base is
  rebaked only when the shape changes.
- **Mesh:** the mesh becomes a signed distance field. A static mesh is baked once (CPU in a worker is
  fine); an animated mesh needs a GPU path later. Density comes from the distance through a softness ramp, with
  noise eroding the edges so the shape reads as cloud, not as a foggy solid.
- **Points:** positions (and optional radii) from a GPU buffer, for example an app's particle simulation, splatted
  into the density each frame. The splat method (atomic scatter vs. per-voxel gather with a neighbour grid) is
  chosen by measurement in Phase 5. Target: 4k particles in ≤ 0.3 ms including the distance-field and light rebakes.

### Rendering

1. **Low-res march** (default half resolution, a tier knob). Per pixel: intersect the ray with each volume's
   box (≤ 8 volumes per pass), and stop at the opaque scene depth.
   - Start at the box entry, or at the camera when it is inside the box. Blue-noise jitter the start point.
   - Use the distance field to skip empty space, and take fixed small steps inside cloud.
   - Stop when transmittance drops below ~0.01. A dense cloud therefore ends the march early, and being inside one is cheap.
   - Each step costs one density read, one optical-depth read, and detail noise near edges only.
2. **Lighting per step:**
   - sun colour from `AtmosphereGpuModel.sunTransmittance`, evaluated once per pixel at the entry point (not per step);
   - times the in-volume transmittance from the optical-depth texture;
   - times a phase term (two-lobe Henyey-Greenstein, or the stylized silver rim);
   - plus ambient from `skyIrradiance` at the volume's altitude, scaled by a height gradient inside the volume.
3. **Aerial perspective:** applied once per pixel at the transmittance-weighted mean hit distance, through
   `AtmosphereAerialPerspectiveLut.lookup`.
4. **Temporal reuse:** reproject last frame's cloud result with the camera motion and the stored hit
   distance. Blend about 0.9 when valid; reject on disocclusion or a depth mismatch. Checkerboarding (a quarter
   of the pixels per frame) is a later tier.
5. **Composite:** a depth-aware upsample to full resolution, then `scene * transmittance + cloud`, inside the HDR
   `RenderPipeline` (Plan 049's output decision), before the AA pass. The scene's depth comes from `pass()`.

### Far shell (option A)

A sphere at cloud altitude with a 2D coverage map (from planet data, for example moisture, or from noise).
It is shaded with a few parallax taps for fake thickness and with the same atmosphere lighting. It cross-fades
with the volumes by camera altitude. The same coverage map does two other jobs:
- it feeds `PlanetSurfaceMaterial.addSunOcclusion` for ground shadows;
- it decides where near-camera volumes are spawned.

## Performance budget (G6)

| Pass | When | Expected cost |
|---|---|---|
| Density / distance / light rebakes | On change only (points source: every frame) | 0 typical; ≤ 0.3 ms for a per-frame points source |
| Low-res march | Every frame, pixels covered by boxes only | 0.5–1.5 ms at half resolution |
| Temporal reuse + upsample + composite | Every frame | ~0.2 ms |
| Far shell | Pixels it covers | ~0.1–0.2 ms |

Quality tiers change only: volume size, march resolution, maximum steps, detail noise on or off,
and the number of point lights.

## Phases

Each phase ends with a visible check in the `cloud-volumes-lab` demo and a GPU time. Nothing waits on another
plan: Phases 0–2 need only `WebGPURenderer`, Phase 3 reads the atmosphere's existing public API, and Phase 6 uses
Plan 050's existing occlusion slot.

0. **GPU timer + lab page.**
   - A demo-app helper that reads `renderer.resolveTimestampsAsync('render')` and `('compute')` every N frames.
     `/atmosphere-lab` already does this inline; copy the pattern into a new file and leave the lab untouched.
   - A new `/cloud-volumes-lab` page with a plain sphere planet, an orbit/fly camera, and preset camera spots:
     outside, edge, inside, above, below.
   - **Gate:** the page shows GPU ms with clouds off.
1. **Spike (go / no-go).** One 128³ noise volume. Full-resolution march on a box proxy with the baked
   optical-depth texture, a white sun, and no temporal reuse.
   - Answer: do `RenderTarget3D` (or a 2D slice atlas) and the bakes work on WebGPU **and** `forceWebGL`?
     Fragment-pass bakes, or compute with a fallback?
   - Measure the camera at outside / edge / inside.
   - **Gate:** a recorded go/no-go in the runbook. No-go means switch to option B and rewrite Phases 2–5.
2. **Volume core.**
   - Jump-flood distance field, half-resolution screen pass with box intersection and scene depth;
   - blue-noise jitter, temporal reuse, depth-aware upsample, composite in the `RenderPipeline`;
   - flying in and out with no pop, and clouds correctly in front of and behind the planet.
   - **Gate:** a fly-through by eye, and GPU ms at the five camera spots within G6.
3. **Atmosphere lighting.** Sun colour, sky ambient and aerial perspective from the atmosphere API (Earth and
   Mars presets) on the lab's planet.
   - **Gate:** orange-lit clouds at dusk, blue-hazed far clouds, a dark night side, no white glow.
     Cost added ≤ 0.1 ms.
4. **Stylization.** Light ramp, edge hardness, silver rim, tint and density curve, with presets
   `stylized` (default), `soft` and `storm`.
   - **Gate:** the maintainer picks the default look.
5. **Sources.** Mesh source (a ship mesh baked to a cloud), points source (the demo carries a small built-in
   GPU particle swirl standing in for an app's simulation), animated noise.
   - **Gate:** the ship reads as made of cloud; the particle cloud moves every frame within G6.
6. **Far shell + planet coverage.**
   - coverage map, shell shading and the altitude cross-fade with volumes;
   - ground shadows through `addSunOcclusion` on a `PlanetSurfaceMaterial` globe;
   - volumes spawned near the camera from coverage.
   - **Gate:** a descent from orbit into a cloud with no visible switch.
7. **Point lights.** Up to 4, unshadowed, attenuated by local density.
   - **Gate:** an engine flare inside a cloud lights it from within; cost noted per light.
8. **Tiers, telemetry, docs:**
   - quality tiers;
   - a `clouds` telemetry section (Plan 048);
   - `projects/triangular-engine/docs/cloud-volumes.md`, a skill section, `CHANGELOG.md`,
     `entry-points.md`, token-map registration.

## Tests

- CPU reference for optical depth through an analytic density (a uniform box, a Gaussian blob) to check
  the bake. Compare to the baked texture read back from the GPU.
- Jump-flood distance field against brute force on a small grid.
- The march against a CPU reference march for a few rays (outside, inside, crossing the planet's depth),
  following the `render-eval.testing.ts` pattern from `planet-material/`.
- Reprojection maths (a static scene under camera motion reprojects to itself).
- Rebake triggers: no rebake while the sun and the density are still; one rebake after a move.
- Timing is never a spec: specs run headless. Timings go in the runbook.

## Decisions

| Decision | Status |
|---|---|
| Main renderer: bounded density volumes (option C), with a 2D shell for the far view (option A); puffs (B) as the fallback | **Decided** 2026-10-17 (owner) |
| TSL only, on `WebGPURenderer`, own entry point `triangular-engine/cloud-volumes`; existing `clouds/` and `takram/` left untouched | **Decided** 2026-10-17 |
| Stylized look by default, realistic as a preset of the same renderer | Proposed |
| Bakes as fragment passes (both backends), compute as an optional fast path | Proposed, settled by Phase 1 |
| Budget G6: ≤ 1.5 ms typical, ≤ 2.5 ms worst, measured with GPU timestamps | Proposed |

## Out of scope for now

The weather simulation itself (the app supplies densities or particles), rain and snow rendering,
lightning visuals beyond the point light, light shafts through clouds, shadows cast between volumes,
clouds on more than one planet at a time.
