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

## From space

The table cannot serve a camera above the atmosphere, and there the planet's disc can fill much of the screen, so a per-pixel march is the most expensive case. The backdrop therefore marches the air at a fraction of the screen resolution (`spaceScale`, default 0.5, so a quarter of the pixels) into a small target and upsamples it; the ground, checker and sun disc stay full-resolution. It needs the camera to build the rays:

```ts
engine.tick$.subscribe(() => backdrop.update(engine.renderer as WebGPURenderer, engine.camera));
```

Without the camera argument, or with `backdrop.spaceLowResEnabled.value = 0` or `spaceScale: 0`, every pixel is marched. The pass only runs while the camera is above the top of the atmosphere.

## On the planet material

`PlanetAtmosphereBinding` fills two stages of `PlanetSurfaceMaterial` (see [planet-material.md](planet-material.md)): the lighting stage and the atmosphere stage. The sky and limb glow behind the globe stay with `AtmosphereBackdrop` (set `groundEnabled.value = 0`), which draws behind the mesh.

```ts
// aerialPerspective: true reads the haze from a froxel table (recommended); omit it for one march per fragment
const binding = new PlanetAtmosphereBinding(model, { radiusUnits: 1, aerialPerspective: true }); // radiusUnits: the globe's radius in mesh units
const material = new PlanetSurfaceMaterial({
  lighting: { id: 'atmosphere', stage: binding.lighting() },
  atmosphere: { id: 'atmosphere', stage: binding.perspective() },
});

binding.setSunBody(x, y, z); // sun direction in the planet's body frame
engine.beforeRender$.subscribe(() => { // after the camera controls have settled
  binding.sync(engine.camera, globe, backdrop); // camera altitude, body-frame camera, backdrop frame and sun
  binding.update(renderer); // re-renders the froxel table when the camera or the sun moved
  backdrop.update(renderer, engine.camera);
});
```

- `lighting()` relights the surface as `albedo x (sun transmittance x N.L x sunVisibility + sky irradiance) x sun irradiance / pi x exposure`, using each point's own sun angle. It replaces the PBR result (other scene lights and normal maps do not reach it); the emissive stack is added back. An eclipse occluder darkens only the direct term.
- `perspective()` attenuates the colour along the camera-to-surface ray and adds that ray's in-scattering. With `aerialPerspective` it is one lookup in a froxel table (`AtmosphereAerialPerspectiveLut`: radiance and optical depth for a grid of screen positions and distances, re-rendered by `binding.update(renderer)` only when the camera, the sun or the profile moved); the fragment's real distance is used, so terrain height is included. Without it, one march per fragment on the sphere of the planet's radius (several times the cost on a planet that fills the screen). The table resolves the last texel of the planet's disc poorly, so the very rim can lose some haze. The mid-morph flat map is not modelled yet.
- The planet may sit anywhere and turn any way: the stages work in its body frame, and `sync` points the backdrop's local frame at the camera's radial direction. The mesh's size in metres is the profile's radius, so `radiusUnits` sets the scale; call `binding.refreshScale()` after `model.setProfile` changes the radius.
- `exposure` lives on the binding and is copied to the backdrop by `sync`, so the surface and the sky agree.

Try it at `/atmosphere-planet`.

<!-- doc-section section-id="sec_fa7da7a9cfe9" path="projects/triangular-engine/atmosphere" baseline-tokens="52449" -->
**Why this exists.** One atmosphere model has to look right from the ground to orbit on planets of any size, and stay cheap enough to run beside a streaming terrain. So the expensive part (transmittance, multi-scatter, sky irradiance) is baked once on the CPU into small tables, and the GPU only does lookups and a short march. A float64 CPU reference integrator is kept in the package so the GPU path is tested against known-good numbers rather than against itself.

**Constraints.** Lengths are metres and coefficients are 1/m; `scaleAtmosphereProfile` rescales a profile to another radius so equivalent viewpoints match. Rebaking (`setProfile`) costs 1-2 s, so treat it as setup, not per-frame work. The aerial-perspective table re-renders only when camera, sun or profile moves. Everything is TSL for `WebGPURenderer`; there is no classic-WebGL path.

**Public boundary.** `public-api.ts` exports the profile, presets, scaling, LUT bake, GPU model, backdrop, planet stages and aerial perspective. The reference integrator is exported for tests and comparison, not for rendering.
<!-- /doc-section -->
