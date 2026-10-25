# triangular-engine/atmosphere

A physically based, lookup-table-driven planet atmosphere: sky colour, sunsets, aerial perspective, sun disc and limb glow, for planets from about 60 km to Earth-sized. It runs on `WebGPURenderer` (WebGPU, or its WebGL2 fallback) as TSL.

Status: **preview.** The atmosphere is drawn on a plain sphere (`AtmosphereBackdrop`). It is not yet part of the cell-planet material, and it is not yet cached per frame (see Cost). Design and phases: Plan 049. Try it at `/atmosphere-lab` in the demo app.

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

## Adding it to a game's planet

`<planetAtmosphere>` (or the `PlanetAtmosphere` class behind it) does all of the wiring below: it builds the model, the sky-view table, the sky behind the planet and the binding, puts the lighting and haze stages on your surfaces, and updates once per frame. The scene needs `preferredRenderer: 'webgpu'`.

```ts
import { PlanetAtmosphereComponent } from 'triangular-engine/atmosphere';
```

```html
<planetAtmosphere
  preset="earth"
  [radius]="600_000"
  [radiusUnits]="1"
  [planet]="planetGroup"
  [surfaces]="[surface, ocean.material]"
  [sunDirection]="sunBody"
  [morph]="surface.morph.uMorph"
/>
```

| Input | Meaning |
|---|---|
| `preset`, `profile` | `'earth'` (default) or `'mars'`, or a custom `PhysicalAtmosphereProfile` scaled to `radius` like a preset. |
| `radius` (required), `thickness` | Planet radius in metres; air height / radius (default: the preset's). Changing either, or the preset, rebakes the tables (about 1-2 s). |
| `radiusUnits` | The planet mesh's radius in world units. Default `radius` (one unit is a metre). |
| `planet` | The planet's root object; its transform is the body frame. Default: the scene, with the planet at its origin. |
| `surfaces`, `lighting`, `haze` | Surfaces to light (stage 4) and haze (stage 6): any `PlanetSurfaceMaterial`, planet or ocean. Removing one from the array restores its default stages. |
| `sunDirection` | Direction to the sun in the body frame (`Vector3` or `[x, y, z]`). |
| `morph` | Pass the material's `morph.uMorph` to share one value (read at start), or a number. |
| `exposure`, `enabled`, `sky` | Exposure (default 8); `enabled = false` skips the atmosphere on the surfaces without a recompile and hides the sky; `sky = false` hides only the sky. |
| `stars` | Star brightness, 0 (default) for none. See [Sky objects](#sky-objects). |

The component's `atmosphere()` signal gives the `PlanetAtmosphere` for anything else (its `binding`, `model`, `backdrop`).

**Frame order.** The component updates in the engine's `beforeRender$`, after the camera controls settle in `lateUpdate$`, and reads its inputs at that moment. Write the morph and the planet's transform by `lateUpdate$`, and don't move the camera in `beforeRender$`.

Without Angular, or to call the update yourself:

```ts
const atmosphere = new PlanetAtmosphere({ preset: 'earth', radiusM: 600_000, radiusUnits: 1, planet, morph: surface.morph.uMorph });
atmosphere.withAtmosphere(surface).withAtmosphere(ocean.material); // { lighting?, haze? } per surface
scene.add(atmosphere.object); // a group: the sky and any sky bodies
atmosphere.sunDirection.set(x, y, z);
engine.beforeRender$.subscribe(() => atmosphere.update(renderer, engine.camera));
atmosphere.configure({ thickness: 0.05 }); // rebakes only when the air or the size changed
atmosphere.dispose(); // takes the stages off, removes the sky, frees the GPU resources
```

Surfaces are taken structurally (`IAtmosphereSurface`: `setLightingStage` and `setAtmosphereStage`), so this entry point does not import `triangular-engine/planet-material`. Other materials (`withAtmosphere(nodeMaterial)`) and haze on non-planet objects are not covered yet (Plan 049, Phase 4).

## Sky objects

Stars, moons and other bodies are seen through the same air as the sky behind them: the haze covers them near the horizon, the long path there reddens them, and a bright day sky hides them.

```ts
atmosphere.stars = 1; // or <planetAtmosphere [stars]="1">
atmosphere.starRotation.setFromAxisAngle(axis, angle); // the stars in the body frame; turn them with the sun for a day
const moon = atmosphere.addSkyBody({ direction: [0.9, 0.2, 0.3], angularRadiusDeg: 0.26, albedo: new Color(0.14, 0.14, 0.14) });
moon.direction.set(x, y, z); // body frame, like sunDirection; read in update()
atmosphere.removeSkyBody(moon);
```

- **Stars** are drawn by the backdrop, procedurally (`starField(dir, pixelAngle)`: cube-face cells, at most one star per cell, placed by an integer hash, three layers from a few bright to many faint). A star is a Gaussian about half a pixel wide at any field of view; a layer fades out once its cells are under 3-6 pixels across. They are display-referred (added after exposure), multiplied by the air's transmittance, and fade out as the sky behind them brightens (linear luminance 0.003 to 0.04, `STAR_FADE_LUMA_START`/`END`), so they show at night and in late twilight and never in the day. They are part of the sky: `sky = false` hides them. `starFieldAt(dir, pixelAngle)` is the CPU twin.
- **Sky bodies** (`AtmosphereSkyBody`, or `PlanetAtmosphere.addSkyBody`) are a disc at infinity, lit by the sun as a sphere (so they show phases), plus an optional `emission`. They are drawn after the sky and before the scene (render order -999, no depth test), so the planet and every scene object cover them. Their rim blends into the sky colour behind, so they stay opaque. A body does not light the air or the ground. With the sky off they stay, seen through no air.
- **Your own sky objects:** in a TSL material drawn after the backdrop, `backdrop.atmosphereSky(worldDir)` returns `{ inscatter, transmittance }` (display units, exposure applied), and `backdrop.skyObject(radiance, worldDir)` is `radiance x exposure x transmittance + inscatter`.
- On the flat map (`morph > 0`) the sky's sun is moved to keep the sun angle under the camera; bodies and stars keep their true directions.

## On the planet material

`PlanetAtmosphereBinding` fills two stages of `PlanetSurfaceMaterial` (see the [planet material guide](../planet-material/README.md)): the lighting stage and the atmosphere stage. The sky and limb glow behind the globe stay with `AtmosphereBackdrop` (set `groundEnabled.value = 0`), which draws behind the mesh.

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
- The planet may sit anywhere and turn any way: the stages work in its body frame, and `sync` points the backdrop's local frame at the camera's radial direction. The mesh's size in metres is the profile's radius, so `radiusUnits` sets the scale; call `binding.refreshScale()` after `model.setProfile` changes the radius (or `refreshScale(radiusUnits)` when the mesh's size changes). `options.morph` takes the material's morph uniform instead of the binding owning one.
- `exposure` lives on the binding and is copied to the backdrop by `sync`, so the surface and the sky agree.

Try it at `/atmosphere-planet`.

<!-- doc-section section-id="sec_fa7da7a9cfe9" path="projects/triangular-engine/atmosphere" baseline-tokens="52449" -->
**Why this exists.** One atmosphere model has to look right from the ground to orbit on planets of any size, and stay cheap enough to run beside a streaming terrain. So the expensive part (transmittance, multi-scatter, sky irradiance) is baked once on the CPU into small tables, and the GPU only does lookups and a short march. A float64 CPU reference integrator is kept in the package so the GPU path is tested against known-good numbers rather than against itself.

**Constraints.** Lengths are metres and coefficients are 1/m; `scaleAtmosphereProfile` rescales a profile to another radius so equivalent viewpoints match. Rebaking (`setProfile`) costs 1-2 s, so treat it as setup, not per-frame work. The aerial-perspective table re-renders only when camera, sun or profile moves. Everything is TSL for `WebGPURenderer`; there is no classic-WebGL path.

**Public boundary.** `public-api.ts` exports the profile, presets, scaling, LUT bake, GPU model, backdrop, planet stages, aerial perspective, and `PlanetAtmosphere` with its `<planetAtmosphere>` component. The reference integrator is exported for tests and comparison, not for rendering.
<!-- /doc-section -->

### Flat map and the morph

Set `binding.morph.value` (0 globe, 1 flat map) each frame, with the planet material's morph. `perspective()` then blends the spherical haze with a flat slab of air over each surface point's own plane (`AtmosphereGpuModel.slab`), and `lighting()` already reads each point's own sun angle, so dusk crosses the map where it should. The backdrop (the sky behind a sphere) has no flat counterpart yet: hide it as the map unrolls. The slab ignores the ozone-like absorber and the fragment's own height.
