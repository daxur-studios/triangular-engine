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

## 2026-10-25 — Spike S1, Q2: runway (height stamp + SDF layer)

Spike page `/planet-surface-detail-spike` (`projects/demo-app/src/app/planet-surface-detail-spike/`), cloned from the
`/cell-planet-tsl` page. No library change.

### What was built

- `runway-site.ts`: pure placement and stamp. Runway 2000 m × 45 m, plateau = rectangle + 120 m apron, smoothstep
  shoulder 1400 m. `findRunwaySite` scans lat/lon for the flattest dry spot (deterministic). Spec:
  `runway-site.spec.ts` (7 cases, headless, pass).
- Height stamp: the demo-owned worker wraps `handleCellPlanetWorkerMessage` and passes `modifyElevation` when the
  request carries `runwayStamp`. It reaches the mesh path only; material tiles are untouched.
- `runway-layer.ts`: analytic SDF `SurfaceLayer` (order `game`). Rectangle SDF in metres in the tangent plane;
  coverage filtered by `fwidth(d)`, spread by `min(1, W/px)` when sub-pixel; centreline dashes, edge lines and
  threshold bars fade with the pixel footprint. It reads no textures, so the level-0 fetch rule did not apply; the
  `fwidth` calls are unconditional and `select` evaluates both sides.
- Query flag `?runway=on|paint|stamp|off` (default `on` = stamp + paint). The panel has "Reload as" buttons.

### Gotcha

`IPlanetContext.bodyFixedLocal` is relative to the camera-following render anchor, not the body centre. The first
version painted the runway offset from the stamp by a camera-dependent amount. Fix: recover body-fixed metres with
`modelWorldMatrix.mul(vec4(bodyFixedLocal, 1)).xyz.sub(uniforms.uBodyCentreScene)`.

### Evidence

World: medium tier, radius 600 km, maxLod 6 (finest triangle edge ~1.7–2 km at the site). Mesh audit
(`auditTerrainUnderRunway()` on the page): max deviation of the batched terrain mesh from the plateau under the
runway rectangle.

| View | Edge length | stamp + paint | paint only |
| --- | --- | --- | --- |
| 1.5 km | ~1.7 km | 0.54 m | 3.02 m |
| 25 km | ~1.7 km | 0.53 m | — |
| 100 km | ~2.3 km | 1.02 m | 3.44 m |
| 400 km | ~14 km | 7.14 m | — |

Screenshots (built-in browser): [60 m](063_assets/s1-runway-60m.jpg) (sharp dashes and edge lines),
[1.5 km](063_assets/s1-runway-1500m.jpg) (whole runway, threshold bars at the end). Checked at 60 m, 1.5 km,
25 km, 100 km and 400 km with no gap, floating or cut at any of them.

### Verdict

**Q2: pass.** The paint is a material layer evaluated per fragment, so it follows the ground at every LOD by
construction. The stamp keeps the mesh flat to ~1 m at fine LODs.

Caveats:
- At ≥100 km the runway is faint (sub-pixel; expected). At 400 km the stamp leaves 7 m of mesh deviation, invisible
  at that range.
- Terrain triangles at the finest LOD are wider than the runway, so only the material can carry the 45 m feature.
- The site search picks the flattest terrain, so the stamp's benefit is modest here. It would matter on rough sites.
- First site search takes ~30 s in the worker; a hard-coded site or a shared cache would be better for production.
- Material-tile slope/cliff colour is baked from unstamped terrain (minor colour mismatch only).
- Not tested: morph progress > 0.

### Other questions

- Q1 and Q3: see the next entry (built, owner to judge).
- Q4 (GPU cost): **open**; needs the owner's RTX 3080 with `?gpuTiming=1`. Headless timings are not hardware numbers.
- Q5 (impostor under atmosphere): **open**.

## 2026-10-25 — Spike S1, Q1 and Q3: forest density field, instances, canopy layer, height-field shadow

Same page, `/planet-surface-detail-spike`. Status: **built; the owner judges Q1 and Q3 by eye.** My own visual check was cut
short (see "What was and was not verified").

### Design (fields, features, instances)

A forest is a continuous **field**, not a list of trees. Density = body-fixed noise (three octaves: 6 km regions, 1.5 km
stands, 120 m patchy edges) x a land mask (coast to tree line) x runway clearance. Nothing is stored. Instances are
sampled from the same density near the camera; the far form is a material layer evaluated from the same function.

- `forest-field.ts`: the density on the CPU, the scatter (`scatterForest`) and every constant the GPU twin repeats.
  The noise is an integer-hash value noise (`imul`, xor-shift), so the CPU and TSL versions agree bit-for-bit on the
  lattice; no `sin` hash (GPU `sin` differs from the CPU's).
- `forest-layer.ts`: the TSL twin. Surface layer: `mix(ground, tree albedo, density x cover x weight)`. Sun occlusion:
  a 0/2/4-step march toward the sun over canopy height (`density x 22 m`), added with `addSunOcclusion`.
- `forest-instances.ts`: one `InstancedMesh` (cone and trunk placeholder). Its material is a `MeshBasicNodeMaterial`
  that runs `binding.lighting()` and `binding.perspective()`, the planet's own lighting and haze stages, on the same
  tree albedo. It dissolves out over the fade band with an alpha hash while the layer fades in.
- Worker: `forestScatter` (trees at the sampler's ground height, with the runway stamp) and `forestSpot` (nearest solid
  forest to the runway, for the camera presets).
- Fade band from tree size: 1 px ~ 0.001 x distance. A tree is individual while its crown is >= 12 px and gone at 4 px:
  12 m crown gives 1000 m to 3000 m (`forestFadeBand`, unit-tested). The sliders default to it.

### Lessons

1. **The aggregate must come from the instance parameters.** My first version gave the layer a fixed 94 % canopy
   cover while instances (8 m crowns on a 14 m grid) covered only ~26 %. Result: light ground with dissolving trees
   next to dark canopy, a clear brightness step across the band (screenshot `s1-forest-1500m-band-prefix.jpg`, the
   "before"). The layer's cover is now `FOREST_CANOPY_COVER` = crown area / cell area (capped 0.9), derived from crown
   width and spacing, and the instance spacing and crown were changed to 12 m and 12 m (cover 0.79). That is the
   answer to "bake the aggregate from the instances?": no bake is needed while the parameters are shared.
2. **The atmosphere lighting stage ignores `normalTS` and the scene's lights.** It reads `sphereNormal` only
   (`albedo x (sunT x N.L + sky) x sunVisibility`). So a canopy normal from the density gradient cannot reach the lit
   colour without a library change. The only canopy lighting term is the sun occlusion (the march). A library
   follow-up could add a normal input to the lighting stage; recorded, not done.
3. **Occlusion also dims the sky term.** `sunVisibility` multiplies direct and sky light in the stage, so a shadow of 0
   would be black. The occluder returns `mix(1, 0.32, shade)` (the floor stands in for skylight); a lighting stage
   that took shadow separately would be better.
4. **Shadow start height.** The march starts at the canopy top the pixel shows (far, layer weight 1) and at the ground
   near (weight 0), so the floor between near trees is shaded and a far canopy top is lit unless a taller neighbour
   shades it. The instances themselves are not shadowed (no shadow maps in the spike).
5. **Instances need the same stages to match.** A standard material lit by scene lights would never match the terrain.
   `binding.lighting()` and `binding.perspective()` are public, so the near form can reuse them with a fake
   context (`sphereNormal`, `radialDirection`, `cameraDistance`). This also starts to answer Q5's mesh half.
6. **After a camera jump far from the last place, wait for streaming.** Terrain patches take several frames to stream
   in; until then the trees stand over the backdrop (blue). The page's `__psd.step` waits; a jump button does not.
7. **Worker-side scatter works**: ~54 000 trees in 3 km at 12 to 14 m spacing, one request, no stalls seen. Ground
   height comes from the sampler (not the simplified mesh), so trees may float or sink by the mesh's error.

### What was and was not verified

- Unit: `forest-field.spec.ts` (hash range and determinism, continuity, coverage share, coast and tree line, fade band
  from tree size, canopy cover from spacing, runway clearance, scatter determinism, scatter follows the field, density
  scale, water and runway exclusion). Spike specs 18/18, headless. `ng build demo-app --configuration development`
  clean.
- Seen in the built-in browser (before the cover fix): forest at 300 m with instances and shadow blotches on the ground
  (`s1-forest-300m-noon.jpg`); at 1.5 km the band with dissolving instances and the dark far canopy (the step in
  lesson 1).
- **Not seen after the fix**: the claude window was minimised, so the page ran at ~1 fps and streaming stalled. Q1
  and Q3 are therefore not asserted as passed. GPU cost was not measured (the page was throttled; `?gpuTiming=1` was
  not read). Shadow steps 0/2/4 are a uniform branch, so the owner can compare them live.

### Owner checklist (Q1, Q3)

Use the panel: **go to forest** (waits ~10 s for the search), then the altitude slider (log). Wait for terrain to settle
after each jump.

1. Q1, noon (sun **noon** button, elevation 70): oblique view, slider from 100 m to 6 km slowly. Look at 1 to 3 km (the
   band): no pop of trees, no brightness step in the ground. Try **instances only** and **layer only** at 1.5 km to see
   each form alone; their average colour should match.
2. Q1, low sun (**low sun**, elevation 8): the same slow zoom. Instances are lit by the planet stages, so the sunny side
   brightens as the sun lowers; check the band again.
3. Q1 sliders: **fade starts** / **fade width** (or reset to the tree-size band), **density scale** (0.5 and 1.5 move the
   scatter and the layer together).
4. Q3 from altitude: 6 km and 25 km, **low sun**, shadow steps **0** vs **2** vs **4**, and sun azimuth around the circle.
   Pass if forest edges show directional shadows that rotate with the sun and vanish at 0 steps.
5. Q3 at noon: shadows should shrink to the stand's own shade (a dark forest floor), not long streaks.
6. Runway clearing: **back to runway**, 300 m and 1.5 km: no trees on the runway or apron.

### Open

- Q4 cost: the layer evaluates the density about 6 times per pixel (layer, own canopy, up to 4 march samples), each 3 octaves
  x 8 hashes. Cheaper options if needed: 2 octaves in the march, a 2-D noise on a cube face, or a baked coarse density page.
- Q5, impostor band (skipped), and instance shadows on trees remain open.
- Not tested: morph progress > 0 (the density uses body-fixed coordinates, so it should stay welded).
