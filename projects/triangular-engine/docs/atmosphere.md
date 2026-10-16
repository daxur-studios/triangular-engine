# Atmosphere (`triangular-engine/atmosphere`)

A physically based, lookup-table-driven planet atmosphere: sky colour, sunsets, aerial perspective, sun disc and limb glow, for planets from about 60 km to Earth-sized. It runs on `WebGPURenderer` (WebGPU, or its WebGL2 fallback) as TSL.

Status: **preview.** The atmosphere is drawn on a plain sphere (`AtmosphereBackdrop`). It is not yet part of the cell-planet material, and it is not yet cached per frame (see Cost). Design and phases: [Plan 049](../../../docs/plans/049_morphing_planet_atmosphere.md). Try it at `/atmosphere-lab` in the demo app.

## Pieces

| Piece | What it is |
|---|---|
| `PhysicalAtmosphereProfile`, `createAtmospherePreset('earth' \| 'mars' \| 'none')` | The data: Rayleigh/Mie/absorber layers, phase asymmetry, sun, ground albedo. Lengths in metres, coefficients in 1/m. |
| `scaleAtmosphereProfile(profile, { radiusM, thickness?, hazeAtHorizon?, ... })` | Moves a profile to another planet radius so every equivalent viewpoint looks the same (lengths x k, coefficients / k), plus art knobs. |
| `bakeAtmosphereLuts(profile)` | CPU bake of the transmittance, multi-scatter and sky-irradiance tables (about 1-2 s). |
| `AtmosphereGpuModel` | Uploads the tables as textures and the profile as uniforms. `march(...)` builds the TSL for one view ray. `setProfile(...)` rebakes in place. |
| `AtmosphereBackdrop` | A full-screen mesh that draws the sky and an analytic ground sphere from the model. |
| `integrateRadiance`, `sunTransmittance`, ... | The float64 CPU reference the GPU path is tested against. |

## Minimal use

```ts
import { AtmosphereBackdrop, AtmosphereGpuModel, createAtmospherePreset } from 'triangular-engine/atmosphere';

const profile = createAtmospherePreset('earth', { radiusM: 600_000 });
if (profile.kind !== 'physical') throw new Error('expected a physical profile');

const model = new AtmosphereGpuModel(profile);
const backdrop = new AtmosphereBackdrop(model);
engine.scene.add(backdrop.mesh);

backdrop.setAltitude(2); // metres above the ground at the origin
model.setSunDirection(0.3, 0.05, 0.95); // local frame, y up
backdrop.exposure.value = 14; // radiance is relative to the sun, so exposure is large
```

The scene camera supplies only orientation and field of view. Keep it at the origin; the camera's altitude is `backdrop.altitude`, kept as a number because float32 positions lose metres at Earth scale. Use a `WebGPURenderer` (`preferredRenderer: 'webgpu'`).

## Cost

`march` is a fixed-count per-pixel loop (32 samples by default), the reference path. The sky-view table (below) replaces it for the sky inside the atmosphere. Neither has been timed on a real GPU yet (Plan 049, Phase 2c gate). Profile changes take one synchronous bake, about 1-2 s at the default sizes.

## Limits

- One absorber layer (ozone-like) per profile.
- Multiple scattering is Hillaire's isotropic approximation, not a full solution.
- No clouds, stars, ocean reflection or cell-planet integration yet.

## Sky-view table

`AtmosphereSkyViewLut` caches the sky for the camera's altitude and the sun's elevation in a small render target, so the sky is one texture fetch per pixel instead of a ray march. Pass it to the backdrop and call `backdrop.update(renderer)` once per frame, outside any render pass:

```ts
const skyView = new AtmosphereSkyViewLut(model);
const backdrop = new AtmosphereBackdrop(model, { skyView });
engine.tick$.subscribe(() => backdrop.update(engine.renderer as WebGPURenderer));
```

The table is re-rendered only when the altitude or the sun's elevation moves past a tolerance (or the profile changes). It is used while the camera is inside the atmosphere; above it, only the pixels that cross the air are marched. `backdrop.skyViewEnabled.value = 0` switches back to the per-pixel march for comparison.
