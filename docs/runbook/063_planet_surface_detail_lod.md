---
type: Runbook
title: Planet Surface Detail LOD
description: Design notes and evidence for drawing trees, rocks, runways and other surface objects on the cell planet as meshes up close and as part of the surface material far away, lit and hazed by the same atmosphere.
timestamp: 2026-10-25T00:00:00Z
tags: [cell-planet, planet-material, lod, impostor, scatter, atmosphere, tsl, webgpu]
plans: [/docs/plans/063_planet_surface_detail_lod.md]
performance: []
---

# Runbook 063: Planet Surface Detail LOD

Plan: [Plan 063](/docs/plans/063_planet_surface_detail_lod.md).
Builds on [Plan 050](/docs/plans/050_tsl_planet_surface_material.md) (the TSL surface material and its streamed
tiles, shown at `/cell-planet-tsl`) and [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) (the atmosphere
and its froxel aerial perspective on the planet).

## 2026-10-25 — Question and first design notes (code reading only, nothing built)

### Question (owner)

When the camera zooms out from the cell planet, should large surface objects stop being 3D and become part of the
surface material? A tree would go mesh → impostor → colour in the ground texture. A 2 km runway would be drawn by the
material, so the terrain mesh can drop detail without the thin runway mesh going above or under the ground. The same
for small and large rocks. And how does lighting work for the far form: is it only a normal map, and can tall
objects cast fake shadows?

### What exists today

- `triangular-engine/planet-material`: `PlanetSurfaceMaterial` with ordered surface layers. `streamedMaterialLayer`
  reads a sparse two-level page table (32×32 directory, leaf tables, 128-texel pages with a 2-texel gutter, RGBA8
  array texture). This is already a virtual texture, and the place where a far form of objects would live.
- `triangular-engine/atmosphere`: `AtmosphereGpuModel` (`sunTransmittance()`, `groundIrradiance()`) and
  `AtmosphereAerialPerspectiveLut` (froxel in-scatter and transmittance). `cell-planet-tsl` hands the planet and the
  ocean materials to `<planetAtmosphere [surfaces]>`, which installs the lighting and haze stages on them.
- `triangular-engine/scatter`: deterministic placement per cell and `bucketInstancesByLod`.
- `triangular-engine/impostor`: octahedral impostors. The render material is an `onBeforeCompile` patch for the
  classic renderer, so it cannot call the TSL lighting and haze stages yet.
- [Plan 059](/docs/plans/059_lod_surface_core.md): a new LOD surface (one instanced grid, quadtree selection).
  Terrain heights and their LOD come from there or from the existing terrain streaming.

### Assessment: yes, this is the right approach

Large-world renderers (flight simulators, planet engines, globe viewers) all end the LOD chain in the ground
texture. A forest seen from 20 km is not thousands of small impostors; it is a canopy colour, a rougher normal and a
darker shade. Past a few pixels per object, drawing instances costs vertex, overdraw and sorting work for a result
the texture can show for free. The chain per object class:

| Class | Near | Middle | Far | Notes |
|---|---|---|---|---|
| Trees, forests | mesh (instanced) | octahedral impostor | canopy in the material: albedo, coverage, canopy height, aggregate normal | The far form is the forest, not each tree |
| Large rocks, buildings | mesh | impostor or simplified mesh | material: albedo, height/occlusion | Same as trees with fewer, larger items |
| Small rocks, grass, clutter | mesh near the camera only | none | material only, as a "rockiness"/"clutter" channel or plain albedo | Never worth instancing at distance |
| Flat features: runways, roads, fields, scorch marks | material at every distance | — | material | Not a mesh at all, see below |

#### Flat features (runways, roads)

A runway should never be a separate mesh laid over the terrain. Draw it as a surface layer at every distance:

1. **Shape the ground, not a mesh.** Flatten the terrain height under the runway in the height source (a stamp in
   the worldgen or terrain height function). Every terrain LOD then samples the flattened height, so a coarse level
   approximates a flat strip instead of cutting through a floating mesh. This removes the above/under problem.
2. **Paint it in the material.** At far levels the runway is a few texels in the streamed pages, which is correct
   at that distance. Up close a 128-texel page is too coarse for markings, so add an analytic layer: a short list of
   features per page (segments, rectangles, polylines as signed distance fields) evaluated per fragment. That stays
   sharp at any distance and costs a few instructions per feature.
3. Only objects with real height (hangars, lights, towers) remain meshes, placed on the flattened ground.

Width check: a 45 m wide runway on a 6,371 km planet is about 1/888,000 of the circumference. It needs a page level
whose texel is at most ~10–20 m to show as more than a smudge. The SDF layer avoids depending on that level.

#### Transition without popping

- The far form must already be in the material under the near forms. The layer fades the baked contribution in
  with distance (a smoothstep over the same distance band where instances fade out), and the instances fade out with
  a dithered alpha. Without the fade the ground under a near tree would be darkened twice.
- The baked colour must match the aggregate look of the instances: the average of trunks, canopy, gaps and the
  ground between them seen from above, including self-shadow. Bake it from the same meshes (render the impostor atlas
  from the top view, average) rather than picking a hand-tuned green.
- Placement must be deterministic so the bake and the instances agree. Scatter already is.

#### Store albedo, light at runtime

The baked pages must hold unlit data: albedo, coverage, canopy height, a normal. Lighting, sun transmittance, sky
irradiance and aerial perspective are applied at runtime by the same stages that light the bare ground. Baking lit
colour breaks day/night, the morph and the atmosphere profiles.

### Lighting the far form: normal map plus a cheap shadow term

A normal map only changes how much light a slope receives. It does not cast shadows. For the far form there are
three levels, cheapest first:

1. **Baked occlusion.** Darken by coverage (canopy gaps and the ground under trees). Independent of the sun. Correct
   at high sun, too bright at low sun.
2. **Sun-dependent aggregate shadow.** For sub-pixel trees the shadowed fraction depends on coverage, height to
   spacing and sun elevation. A small analytic function (or a 2D lookup over coverage × sun elevation) makes forests
   darken and lose contrast at low sun, which is the main visible effect from altitude.
3. **Height-field shadow in the material.** Store canopy or object height in a channel; per fragment take 2–4 steps
   toward the sun in the page (`uv + sunDirTangent * step`) and compare heights. This gives directional shadows
   (forest edges, buildings, a lone tree's shadow on a field) at the distance where one object is a few texels.
   Bounded cost, no shadow map, works on both backends.

Real shadow maps only cover the near ring, where the meshes are. The far form handles the rest.

### How the atmosphere affects the ground and these objects

- The ground already gets sun transmittance (reddened at low sun), sky irradiance and froxel aerial perspective from
  Plan 049. These must be applied to every form of an object: mesh, impostor and material. If the impostor uses a
  different lighting model, the transition band shows as a colour step, most visible at sunset and at haze distance.
- The impostor material therefore needs a TSL form that calls the planet lighting and haze stages. That is a
  prerequisite for the middle step on `WebGPURenderer`.
- At distance, aerial perspective dominates: past a few tens of km the in-scatter hides most of the detail. This
  sets the far end of the useful detail budget; detail beyond it is wasted work. Measure where the haze makes the
  baked detail invisible and stop baking finer pages there.
- Night: the far form can carry emission (city lights, runway lights) as a channel, so lights remain visible after
  the meshes are gone.

### Cost and memory

- Baking scales with resident pages, not with object count. Bake a page when it streams in: a GPU pass that splats
  the page's objects (from deterministic scatter, plus a placed-feature list) into the page. Edits (a cleared forest,
  a new building) invalidate the pages they touch.
- Extra channels cost memory: one more RGBA8 page array (coverage, canopy height, occlusion, emission) doubles the
  page memory. A cheaper alternative for natural cover is procedural: derive tree coverage from the biome and noise
  in the shader, with no storage. Placed features (runways, towns, landmarks) still need the page bake or the SDF
  list.
- WGSL needs explicit-level fetches in non-uniform control flow (see `streamedMaterialLayer`); the new layers follow
  the same rule.

### Risks and open questions

- Mismatch between the baked aggregate and the instances across the fade band (colour, brightness, shadow).
- Page texel density near the camera is too low for crisp features; the SDF layer covers flat features, tall
  objects stay meshes.
- The morph (globe ↔ map) moves fragments; page reads are already in body-fixed coordinates, so the layer should
  follow, but the height-field shadow's sun direction must use the morphed tangent frame.
- Whether procedural coverage looks good enough for forests, or a baked page is needed.
- Scale: Plan 050's planet sizes (`WORLD_SIZE_TIER_RADIUS_M`) decide which page levels are in use near the camera.

### Proposed next step

A falsifiable spike on `/cell-planet-tsl` (or a cloned spike page), kept out of the library until the gates pass:
see the plan's spike section.
