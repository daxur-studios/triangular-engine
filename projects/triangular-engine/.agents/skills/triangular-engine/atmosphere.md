# Atmosphere on a planet (skill fragment, in progress)

Referenced from the main `triangular-engine` skill. Full guide: `docs/atmosphere.md`. Entry point `triangular-engine/atmosphere`, used with `triangular-engine/planet-material` (`PlanetSurfaceMaterial`), `WebGPURenderer` only. The API is still moving (Plan 049): check `atmosphere/public-api.ts` before relying on a detail.

## Add it to a planet

1. Profile: `createAtmospherePreset('earth' | 'mars' | 'none', { radiusM, thickness })`. `radiusM` is the planet's radius in metres, `thickness` the air's height as a fraction of it. Narrow with `profile.kind === 'physical'`.
2. Build once: `model = new AtmosphereGpuModel(profile)`, `skyView = new AtmosphereSkyViewLut(model)`, `backdrop = new AtmosphereBackdrop(model, { skyView })`, `binding = new PlanetAtmosphereBinding(model, { radiusUnits, aerialPerspective: true })`. `radiusUnits` is the planet mesh's radius in world units; the planet must have unit scale.
3. Wire the surface (and the sea, if it has its own material): `material.setLightingStage({ id: 'atmosphere', stage: binding.lighting() })` and `material.setAtmosphereStage({ id: 'atmosphere', stage: binding.perspective() })`. Do this at setup, since stages are part of the shader cache key. Add `backdrop.mesh` to the scene. Set `backdrop.groundEnabled.value = 0` so the backdrop draws no ground of its own (the planet mesh is the ground).
4. Every frame, after the camera has settled (`beforeRender$`, not before the orbit controls update):
   ```ts
   binding.setSunBody(x, y, z);          // sun direction in the planet's body frame
   binding.exposure.value = 8;
   binding.morph.value = morph;          // 0 globe .. 1 flat map; omit for a plain sphere
   binding.sync(camera, planetObject, backdrop);
   binding.update(renderer);             // froxel table, outside a render pass
   backdrop.update(renderer, camera);
   ```
5. Changed the profile size? `model.setProfile(newProfile); binding.refreshScale();`.

## Rules

- Lengths in the atmosphere are metres; the mesh's are world units. `binding` converts; do not scale the planet.
- Fade `backdrop.opacity` and `backdrop.mesh.visible` yourself if you want the sky gone far from the planet (the cell page fades it by camera height above the air, `binding.skyAltitude`).
- Morphing planets: write morph state in `tick$`/`postTick$`, read the settled camera in `beforeRender$`. If you also use `CellPlanetMorphCameraRig`, call it in `postTick$` and set the material's `uMorph` in the same step, or the camera and surface disagree for a frame and flicker.
- Cost: the froxel table (`aerialPerspective`) is the cheap haze path; without it the haze is a ray march per fragment.

## Known gaps (in progress)

- On the flat map the haze is per-surface-fragment and the sky is a dome behind the map. There is no visible air layer above the map's edges yet (the view reads as global, not local).
- Terrain relief is ignored by the morph camera rig's height.
- Not tuned on every GPU; expect the look to change.
