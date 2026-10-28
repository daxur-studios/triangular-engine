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

- Q1 and Q3: see the next two entries (built; the second revises the first after the owner's review).
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
   width and spacing, and the instance spacing and crown were changed to 12 m and 12 m (cover first assumed 0.79; measured 0.65, see the revision entry). That is the
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

## 2026-10-25 (revision) — Spike S1: deterministic placement, matching forms, no hard edge, rocks

The owner reviewed Q1/Q3 and found four problems. Status: **fixed and measured where possible; owner re-judges by eye.**

### Causes found

1. **Trees moved on every zoom.** The scatter grid was anchored to the request window (camera-centred), so each
   recentre re-rolled the lattice. Fix: `scatterCells` runs a hash over a fixed body-fixed 3-D cell lattice
   (cell id to seed; one jittered candidate per cell in the shell above the datum, projected to the ground; kept when
   `density > the cell's own hash`; yaw and size from the same hash). The window only selects which cells to emit, so
   position, rotation and scale depend on the location alone (needed for Jolt colliders). Runtime check: 116 880 of
   121 922 trees reappeared identically after a recentre (the rest left the window). Specs: two centres give identical
   trees in the overlap; window-size and axis independence; one candidate per cell.
2. **Straight/curved hard line.** (a) The buffer truncated along a row (the far edge was cut off in a line); now
   `maxCount` keeps the nearest, so truncation loses the far edge only (and `treesDropped` shows it). (b) The window had
   no fade and its radius did not follow the fade band. Now the radius is `ceil((fadeEnd + 2 x 400) / 100) x 100`
   (3800 m for trees), is re-requested when the band changes, and the edge dissolves over 400 m inside it
   (per-instance alpha hash by distance from the window centre), so the far edge fades and never cuts.
3. **Dark blobs and colour mismatch.** CPU/GPU density parity was fine (`__psd.parity(n)`, max 0.0008, plus a float32
   spec). The real causes: the layer's cover constant was wrong (0.79 assumed, **0.65 measured**: a solid stand of 12 m
   crowns on a 12 m grid; `FOREST_CANOPY_COVER` is now that measured value and a Monte-Carlo spec holds it within
   0.03), and the far form lacked the floor shade the near form has between trunks. The layer now applies an analytic
   first march step (`floorShade`) to the ground it mixes with. Split view (mode 3) puts instances left and layer right
   for a direct comparison.
4. Lesson 1 above is superseded: crown 12 m, cover 0.65.

### Rocks (new object class)

- `rock-field.ts`, `rock-layer.ts`; the same cell hash with its own seed (`ROCK_SEED` 2) and its own density:
  value noise (320 m and 45 m cells) x land mask x (1 - 0.85 x forest density) x runway clearance, one candidate per
  6 m cell, size 1 to 3 m.
- Bands from size (1 px ~ 0.001 x distance, 12 px / 4 px, as for trees): a 2 m rock gives mesh to 167 m, mesh to
  speckle over 167-500 m, speckle to nothing over 1000-2000 m. The speckle is a per-metre grain hash mixed toward the
  rock albedo and roughness by `ROCK_COVER x density`; beyond 2 km there is nothing.
- Panel: show toggle, mesh count, bands shown from the rock size.

### Measured (split view at 250 m over solid forest, left instances vs right layer, mean RGB)

| sun | steps 0 right/left | steps 4 right/left |
|---|---|---|
| 70 | 1.08, 1.06, 1.00 | 0.85, 0.90, 0.81 |
| 25 | 1.09, 1.15, 1.10 | 1.02, 1.13, 1.26 |
| 8 | 0.96, 1.03, 0.88 | 1.00, 1.27, 1.00 |

Mostly within ~10 %. Known residual: at noon with 4 shadow steps the layer is ~15 % darker (the march also shades the
canopy top), and the 8-bit values at low sun are small, so ratios there are noisy.

### Verified / not verified

- Specs 29/29 headless; `ng build demo-app --configuration development` clean. Scatter ~2.4 s in the worker for ~120k trees
  plus ~21k rocks, none dropped.
- **Not verified**: rocks by eye at 30 m / 150 m / 1 km (the browser pane was hidden, so rAF stalled), the window-edge
  dissolve by eye, GPU cost (Q4 open), Q5 open.

### Owner checklist (replaces the earlier one)

Panel: **go to forest**, then the altitude slider. Wait for terrain to settle after each jump.

1. Same trees after zoom: at 300 m note a distinctive tree, zoom to 3 km and back, again after a large pan: same tree
   in the same place with the same size and lean.
2. No hard edge: zoom out slowly from 100 m to 6 km, oblique view: no straight or curved line where trees end; the far
   edge dissolves into the layer.
3. Split view (**split: instances | layer**) at 250 m and 1.5 km, noon and low sun, steps 0 and 4: colour and
   brightness of the two halves agree; no dark blobs in the layer where instances are sparse.
4. Rocks at 30 m, 150 m and 1 km (show rocks on): mesh up close, mesh to speckle fade around 167-500 m, a faint grain
   at 1 km, nothing past 2 km. Try the three view modes.
5. Low sun and the sliders (fade band, density scale) as before; shadows at 6 km / 25 km with steps 0/2/4.
6. Runway clearance: no trees or rocks on the runway or apron.

### Owner verdict on Q3 (2026-10-25): failed

Q3 **failed by owner judgement**: the forest looks better with shadow steps at 0. The height-field shadow march
produces dark areas the owner does not want (dark blobs). Scope item 4 (height-field sun shadow in the far-form layer)
is **rejected**. Shadow steps now default to 0 (layer uniform and panel). The march stays behind the existing 0/2/4
toggle because it costs nothing to keep; it is not tuned further and is not part of the forest work. The checklist's
shadow items (5 and the 6 km / 25 km shadow check) no longer apply.

## 2026-10-27 — Library: per-pixel normal and direct-shadow inputs to the planet lighting stages

The spike found two gaps (2026-10-25 entries): the atmosphere lighting stage read only `context.sphereNormal`, so a
canopy or roof normal could not reach the lit colour, and the only shadow input was `sunVisibility`, which also dims the
sky term (and `sunVisibilityLighting` keeps only `mix(0.15, 1, ...)`), so the spike baked shade into its colour with
`mix(1, 0.32, shade)`. Status: **library change done, specs and build pass; not seen in a page.**

### API

Both inputs are optional factory arguments, each `(context, input) => TSL node`, so a page or a layer decides per
material what feeds them (a function can read a field a layer put on `input.surface`). Pages keep storing unlit data
(albedo, normal, shade); every form is lit by the same stage.

- `triangular-engine/atmosphere`: `PlanetAtmosphereBinding.lighting(inputs?: IAtmosphereLightingInputs)`.
  `normal` (`vec3`, body frame, normalised for you) replaces the sphere normal in the direct `N.L` only.
  `directShadow` (`float`, clamped to 0..1) multiplies the direct term only. Formula:
  `albedo x (sunT(mu_sphere) x max(N.L, 0) x directShadow + skyIrradiance(mu_sphere)) x sunVisibility x sunIrradiance / pi x exposure`.
  `sunVisibility` (occluders x `binding.sunVisibility`) still dims both terms: it is the eclipse input.
- `triangular-engine/planet-material`: `IPlanetLightingInputs { normal?, directShadow? }`.
  `simpleDayNightLighting(uniforms, options?: ISimpleDayNightLightingOptions)` takes both plus `skyShare` (default
  0.35): with an input the day factor becomes `mix(direct, daySphere, skyShare)`, where `direct` is the smoothstep of the
  normal's own sun angle times `sunVisibility x directShadow`, and the golden-hour glow is scaled by
  `mix(directShadow, 1, skyShare)`. `sunVisibilityLighting({ floor?, directShadow? })` takes `directShadow` only (it
  has no sun direction; the PBR before it already used the geometric normal) and multiplies it into `sunVisibility`,
  keeping `floor`.
- Without the inputs every stage builds the same TSL graph as before (the new nodes are added only when an input is
  given), so existing pages are unchanged.

### Sky-term approximation

The sky (and, in the day/night stage, the sky share) keeps the **sphere normal**, as does the sun's transmittance
through the air. No sky-view factor such as `(1 + dot(n, up)) / 2` is applied. Reasons: the far form in the surface
material has no per-object normal, so a normal-dependent sky term would make the mesh and the far form disagree in the
fade band; for canopy and roof normals within 40 degrees of up that factor would be 0.88 or more; and it keeps the
"tilted normal changes only the direct term" contract simple to test. If a later page needs darker steep faces, add the
factor as an opt-in, not a default.

### Verified

- `npm run test:triangular-engine:planet-material` 78/78 and `npm run test:triangular-engine:atmosphere` 203/203,
  headless. New GPU-evaluated cases (`evaluateOnGpu`, stages called directly):
  - `planet-lighting.spec.ts`: no-input output matches the CPU formula and equals neutral inputs; a tilted normal
    changes only the direct share (N.L -0.5, 0, 0.05 against the closed form); a direct shadow of 0 keeps the sky share
    (and `skyShare` sets it); `sunVisibilityLighting` with and without `directShadow`.
  - `atmosphere-planet-stages.spec.ts`: no inputs equals neutral inputs; shadow 0 keeps the sky light (above 2 % and
    below 90 % of full sun, equal to a normal turned from the sun), a half shadow is the midpoint, a planet-wide
    `sunVisibility` of 0 still gives black; a tilted normal is `sky + max(N.L, 0) x (full - sky)`, and with the sun low
    on the sphere a normal facing the sun gets `1 / 0.3` times the direct term through the same air.
- `npm run build:triangular-engine` passes. Not checked by eye: `/cell-planet-tsl`,
  `/planet-material-extensions`, `/atmosphere-planet` and the spike page (the owner's server serves the main checkout);
  their output should not change, since none of them passes the new inputs.

### Switching the spike from colour-baked shading

1. Forest layer (`forest-layer.ts`): drop `mix(1, 0.32, shade)` from the albedo; keep the unlit albedo and write the
   shade (0 shadowed, 1 lit) to a field the lighting can read, for example a `canopyShade` on the returned surface
   sample, or a uniform-free node the page closes over. Build the surface material's stage with
   `binding.lighting({ directShadow: (_c, input) => input.surface.canopyShade })` instead of `binding.lighting()`. The
   0.32 floor goes: the sky light is the floor now. If a canopy normal from the density gradient is wanted, pass it as
   `normal` the same way (body frame).
2. Instances (`forest-instances.ts`): pass the radial direction as `sphereNormal` and the leaned crown normal
   (`normalize(radial x 0.7 + normalWorld x 0.3)`, in the body frame) as `normal`, so the sky light on the crowns equals
   the far form's. Instance self-shadow, if added, goes to `directShadow`.
3. Re-run the split view (mode 3) at 250 m and 1.5 km, noon and low sun: the two halves should agree at least as well
   as the 2026-10-25 table, and shaded floor should no longer look black at low sun.
4. `PlanetAtmosphere.withAtmosphere(surface)` (the component path) still uses `binding.lighting()` without inputs; a
   per-surface `lighting inputs` option there is a follow-up if a page needs it through the component.

## 2026-10-27 — Scatter gap check: spike scatter against `triangular-engine/scatter`

Read-only comparison of the spike's scatter (`forest-field.ts`, `rock-field.ts`, the worker, `forest-instances.ts`)
with `scatter/core` and `scatter/terrain`, before moving the spike onto the library.

| # | Point | Spike | Library today | Verdict |
|---|---|---|---|---|
| 1 | Lattice and domain | Fixed 3-D body-fixed lattice of `spacingM` cells; only cells whose jittered point lies in the one-cell shell `[R, R + S)` above the datum count, so there is about one candidate per `S²` of surface on any part of the sphere, with no face seams. Cell size is in metres. | `selectFixedLevelScatterCells` walks an `IHierarchicalTerrainSurfaceDomain` quadtree to a fixed level. Cell size is a level, not metres, and on a cube-sphere the cells change size across a face. Assumes the terrain entry's domains. | **Lacks.** Add a second domain beside the quadtree one: a planet shell lattice with a cell size in metres. The quadtree path stays as is. |
| 2 | Hash and candidate | 32-bit integer hash of `(ix, iy, iz, salt)`; one candidate per cell; draws for jitter x/y/z, keep, and one shared draw for yaw and scale. GPU-friendly (no strings). | `generateScatterCandidates`: FNV-1a over a composed string plus mulberry32, a pool of `candidatePoolSize` candidates in a 2-D `[0,1)²` patch square. Stable ids via `composeScatterInstanceId`. | **Needs an extension.** Keep the id format (so the removal overlay and colliders work), add an integer lattice hash and a one-candidate-per-cell draw with a third jitter axis. Strings only for accepted instances. |
| 3 | Density input, CPU and TSL parity | Value noise (trilinear, smoothstep fade, integer hash) summed over octaves, smoothstep edge, height band; CPU function plus a hand-written TSL twin; parity checked on the page (`__psd.parity`, max 0.0008). | `baseDensity01 × suitability(sample)` on the CPU only. No noise, no TSL, no parity contract. | **Lacks.** Add a density-field definition (octaves, edge, height band) with one CPU evaluator and one TSL builder, and a headless parity spec. |
| 4 | Placement on sphere terrain from a height worker | `heightAt(direction)` callback from the worldgen sampler in the worker; ground point = direction × (R + height); up is radial; no slope test. | `generateTerrainScatterInstances` samples an `ITerrainField` through `sampleTerrainSurface` (normal and slope by finite differences). The cell-planet height is a worldgen sampler, not an `ITerrainField`. | **Needs an extension.** The shell lattice takes a `heightAt(direction)` callback (`null` = water or ice). Normal is radial for now; slope rules are not applied on this path (noted in TSDoc). |
| 5 | Distance fade and window | Fade band from object size by a pixel rule (12 px to 4 px at 1 px = 0.001 × distance); the window radius follows the band (`ceil((fadeEnd + 2 × recentre) / 100) × 100`); the window only selects cells, never moves them; alpha dissolve over 400 m inside the window edge (TSL, spike). | `computeScatterDistanceFade01` thins density with distance (grass with no far LOD). That is camera-dependent placement, the opposite of what the planet path needs. No band-from-size or window radius helper. | **Lacks** the band and window helpers: add them to core (pure). The window-edge dissolve is a material concern tied to the atmosphere stages; it stays in the spike until the impostor material (Plan 063 scope 5). |
| 6 | Nearest-instance selection | `maxCount`: keeps the nearest by arc when the window holds more, so a short buffer loses the far edge, never a row; reports `accepted`. | None: cell selection by radius only, no capacity cap. | **Lacks.** Built into the shell lattice scatter. |
| 7 | Physics residency | None in the spike. | `computeScatterPhysicsAnchor` and `diffScatterPhysicsResidency` keyed by cell key and centre; `buildScatterColliderDescriptors` takes `ITerrainScatterInstance`s with an f64 anchor; Jolt adapter adds compound bodies per cell. | **Covered**, with one gap for chunk 7: shell cells are 6–12 m, far too small to be residency cells; group them by a coarser key (for example `floor(index / k)`), give each group an f64 body-fixed anchor, and convert placements to `ITerrainScatterInstance` (radial normal and up). The adapter itself needs nothing new. |

**Where the density noise belongs: `scatter`.** The noise is the placement contract: the same field decides where an
instance stands and how dense the far form is, so it lives with the scatter and its identity rules. `procedural` builds
geometry and has no TSL. The CPU half goes in `scatter/core`. The TSL half goes in a new secondary entry
`triangular-engine/scatter/tsl`, so the main scatter entry does not import `three/tsl` (and with it the WebGPU build)
for WebGL-only consumers.

**Size:** step 2 (the shell lattice domain) is one file plus helpers, not a rewrite, so the move proceeds in this
session.

## 2026-10-27 — Spike scatter moved onto `triangular-engine/scatter`

Follows the gap check above. Status: **library extended, spike moved; specs and builds pass; not seen by eye.**

### Library additions

- `scatter/core/scatter-lattice-hash.ts`: `hashScatterLattice01` (noise) and `hashScatterLatticeCell01` (per-cell draws
  with a salt). The spike's two hashes, unchanged, so the spike's tree and rock positions are unchanged.
- `scatter/core/scatter-density-field.ts`: `IScatterDensityFieldDefinition` (octaves, `octaveOffset`, `edge`,
  `heightBandM`), `evaluateScatterDensityField` and its parts.
- `scatter/core/scatter-fade-band.ts`: `computeScatterPixelFadeBand` (the pixel rule) and `computeScatterWindowRadiusM`.
- `scatter/terrain/scatter-planet-lattice.ts`: `scatterPlanetLattice` (the shell lattice, one candidate per cell,
  nearest-first `maxCount`), `IScatterPlanetLayerDefinition` (own `seed`, `cellSizeM`, `sizeRange`, `density`),
  transferable result, `composeScatterPlanetInstanceId`, `measureScatterPlanetCover`.
- New entry `triangular-engine/scatter/tsl`: `scatterDensityFieldNode` and parts, the TSL twin.

One change of behaviour against the spike: yaw and size now use separate draws (salts 4 and 5); the spike used one draw
for both. Positions and the keep test are the same.

### Spike

- `forest-field.ts` and `rock-field.ts` define `FOREST_FIELD` / `ROCK_FIELD` as library definitions and
  `treeScatterLayer` / `rockScatterLayer` as planet layers; `scatterForest` and `scatterRocks` call
  `scatterPlanetLattice`. Their own lattice code, `cellHash` and `SCATTER_STRIDE` are gone. Constants that
  `forest-layer.ts` and `rock-layer.ts` import are kept, so neither file changed (another session owns the shading).
- The worker posts the library result with its transferables; `SurfaceInstances.setInstances(result)` reads
  `originM`, `offsetsM`, `yaw01`, `scale`. The window radius comes from `computeScatterWindowRadiusM`.
- `forest-field.spec.ts` keeps the spike's checks (field, coast, clearance, cover, rocks); the generic placement checks
  moved to `scatter-planet-lattice.spec.ts`.

### Verified

- `ng test triangular-engine --include=../scatter/**/*.spec.ts`: 161/161 headless, including the planet lattice specs
  (stable between two window centres, independent of window size, one candidate per cell on six centres all over the
  sphere, nearest kept, seeds independent), cover (0.65 within 0.03 for 12 m crowns on a 12 m lattice) and the CPU/TSL
  parity spec (forest and rock fields, 256 points at 600 km, maximum difference under 0.01, `forceWebGL` backend).
- `ng test demo-app` on the spike folder: 23/23 headless.
- `npm run build:triangular-engine` (builds `scatter` and `scatter/tsl` as separate entries) and
  `ng build demo-app --configuration development`: both clean.
- **Not verified:** anything by eye. The owner's server serves the main checkout, not this worktree.

### Owner checklist (after merging this worktree)

On `/planet-surface-detail-spike`, **go to forest**, then the altitude slider; wait for terrain after each jump.

1. Same trees after zoom: at 300 m pick a distinctive tree, zoom to 3 km and back, then pan far and back: same tree,
   same place, size and turn. (Turn and size differ from before this change: one draw became two.)
2. No row cut and the edge fade: zoom out slowly from 100 m to 6 km, oblique: no straight or curved line where trees
   end; the far edge dissolves.
3. Window size: change the fade band slider (the window grows and shrinks): trees inside both windows stay put.
4. Split view at 250 m: the two halves match as before (the cover constant is unchanged, 0.65).
5. Rocks on: meshes up close, sizes 1 to 3 m, gone into the speckle by about 500 m.
6. `__psd.parity()` in the console: maximum difference as before (about 0.001).

### For later

- `forest-layer.ts` and `rock-layer.ts` still carry hand-written TSL twins (`hashNode`, `noiseNode`,
  `fieldDensityNode`). Switch them to `scatterDensityFieldNode(FOREST_FIELD, ...)` and
  `scatterDensityFieldNode(ROCK_FIELD, ...)` once the shading session has landed; parity is then by construction.
- **Chunk 7 (Jolt colliders), what the adapter needs:** `ScatterJoltColliderAdapter` takes
  `IScatterCellColliderDescriptors` (cell key, f64 `anchorWorldM`, anchor-relative descriptors) and needs nothing new.
  Missing in between: (a) a residency cell coarser than the 6–12 m lattice cell, for example the lattice cell index
  divided by a whole factor, with its body-fixed f64 anchor; (b) planet instances as `ITerrainScatterInstance`
  (`instanceId` from `composeScatterPlanetInstanceId`, `worldPositionM` body-fixed, `normal` and `surfaceUp` radial, the
  yaw and scale draws) so `buildScatterColliderDescriptors` can be reused, which today draws scale from
  `scaleSeed01` and a `ScatterScaleRange` rather than taking a scale; (c) `collider` on a species definition for trees
  (capsule or cylinder trunk) and rocks (sphere or hull, hull not supported yet); (d) residency anchored on the player
  through `computeScatterPhysicsAnchor`, not the render window. Bodies must live in the physics frame (body-fixed or
  the floating origin's), not the render anchor.

## 2026-10-27 — Scope 1–2 in the library: flat features (height stamp, per-page lists, material layer)

Q2 passed with one hand-placed runway in the spike. This moves the stamp and the SDF paint into the library as a
general flat-feature system and switches the spike to it (runway plus a small airfield and road network).

### Design

- **One feature set for height and paint.** `FlatFeatureSet` (`worldgen/render/core`, framework-free, worker-safe)
  holds resolved features: segments (great-circle arcs ≤ 45°, round ends) and rectangles (centre, heading, length,
  width), each with a tangent frame (`along`, `across`) at its centre. Local coordinates are `a = dot(dir, along)·R`,
  `b = dot(dir, across)·R`; the across axis is exact to the great circle, and the far hemisphere
  (`dot(dir, centre) ≤ 0`) returns +∞. SDFs: box `length(max(q, 0)) + min(max(qx, qy), 0)`, capsule
  `length(max(|a| − hl, 0), b) − hw`.
- **Height stamp.** `heightStamp()` is the worker pipeline's `modifyElevation` hook; `stampElevation()` is the CPU
  twin. Inside `width/2 + apronM` the height is the feature's (a segment interpolates its two end heights), then a
  Hermite blend over `shoulderM`. It depends on the body-frame direction only (it ignores the radius the pipeline
  passes), so every LOD, patch and edge vertex at the same direction gets the same height.
- **Priority rule.** Features apply in ascending priority (then list order): `h += (target − h)·w`. Each step is
  continuous, and the last (highest-priority) feature holds its height where it overlaps others. The material uses
  the same priority for the markings; the body colour is the union.
- **Per-page lists.** `FlatFeaturePageWindow`: an equirectangular grid at level L (2^(L+1) × 2^L pages) and a W×W
  window (default 32) around the camera. The page height targets `max(400 m, altitude × ratio)` with 0.75–2.5×
  hysteresis. Pages select features as they enter the window (lists are cached while they stay in it),
  conservatively: a feature is listed when its SDF at the page centre is within the page's bounding-cap radius plus
  2 m (the SDF is 1-Lipschitz); at most `maxPerPage` (default 8), highest priority first, then distance; overflow is
  counted in `stats`. Two RGBA float textures: a feature table (capacity × 3 rows) and page slots
  (`featureIndex + 1`).
- **Layer.** `flatFeatureLayer` (`planet-material`) takes the window structurally (no `worldgen` import). Per pixel:
  page from `context.latLon`, an unrolled walk of `maxPerPage` slots, every read at `.level(0)`, empty slots masked.
  Pixel footprint `max(|dFdx(pos)|, |dFdy(pos)|, 1 cm)`, computed unconditionally; a feature narrower than a pixel
  is spread at its area weight (`min(1, 2·hw / px)`). The winner key is `d − priority·10⁶` inside a feature, so the
  highest priority owns the markings. Markings: runway (centreline dashes, edge lines, threshold bars), taxiway
  (yellow centreline), road (dashed centre, edge lines).
- **Clearance query** for scatter: `isInClearance(dir, margin)` (within `clearanceM`, default `apronM`, of the edge)
  and `nearest(dir)`. Not wired into scatter (another session owns it).
- **`roadLayer` decision: not a user of the list.** Its road is a planet-spanning great circle with an angular width
  and no height. It exceeds the 45° segment limit and would sit in nearly every page list; its value is as a short
  teaching example of a layer. It stays as is; placed roads use flat features. Recorded in the `planet-material`
  README.

### Spike switched to the library

- `airfield-features.ts`: runway (priority 10), parallel taxiway and three stubs (5), concrete apron (4), a main road
  (2) and an access road (1) that cross near (1200, 2350) in the runway frame. Roads are split into segments of at
  most 600 m whose end heights follow the ground with the airfield already stamped (3-tap smoothed); over water a
  road is paint-only. The worker builds the set once per world, uses it for the stamp and for ground height, and
  returns the plain list to the page (`flatFeatures` message), which feeds a `FlatFeaturePageWindow`
  (`pageAltitudeRatio` 0.5).
- `runway-layer.ts` deleted; `runway-site.ts` keeps the site search, the frame and `runwayDistanceM` (forest
  clearance). `?runway=on|paint|stamp|off` now covers the whole network. The panel shows the page level, page size,
  pages listed, the longest list and whether any list was full. New `10 km` view preset.

### Verified

- Specs, headless (`ChromeHeadless`, `--watch=false`): `worldgen/render/core` `flat-features.spec.ts` and
  `flat-feature-pages.spec.ts` 28/28 (SDF and frame maths; stamp plateau, shoulder and segment interpolation;
  crossing priority in both orders with continuity at 1 m steps; clearance; page bounds; selection including clipped
  edges and overflow; antimeridian wrap; streaming; **LOD continuity**: a level-0 patch and its four level-1
  children through `handleCellPlanetMeshWorkerRequest` agree within 0.05 m at shared directions and sit on the
  plateau). `planet-material` `flat-feature-layer.spec.ts` 4/4 on the GPU (paint, gaps, edge lines, outside;
  crossing priority; outside the window, disabled, cleared; sub-pixel spread). Demo spike specs 30/30 (including
  `airfield-features.spec.ts`).
- `npm run build:triangular-engine` and `ng build demo-app --configuration development` pass.

### Not verified

- No visual check: the owner's server serves the main checkout, not this worktree.
- No GPU timing of the layer (Q4 is still open).

### Known limits

- Float32 unit directions on the GPU: markings step at about 0.5 m on an Earth-size planet (fine on the spike's
  smaller planet).
- Equirectangular pages narrow in longitude near the poles; the window covers less ground there.
- Features beyond the window are not drawn; a full page drops its lowest-priority features. At 10 km with the spike's
  ratio a page is about 5 km, so the airfield page can overflow and drop road segments (`full` in the panel).
- Material tiles (slope, cliff colour) are baked from the unstamped terrain.
- The stamp scans features linearly (with a reach pre-test): fine for hundreds of features.

### Owner checklist

Route `/planet-surface-detail-spike`, after this branch's changes reach the served checkout. Use the view presets.

1. **300 m.** Runway markings sharp (centreline dashes, edge lines, threshold bars); taxiway yellow centrelines;
   concrete apron lighter than asphalt. Where the taxiway stubs meet the runway, the runway markings win; where the
   two roads cross, the main road's markings win. No terrain poking through, no gap or cut along any edge; roads
   blend into the ground on their shoulders.
2. **1.5 km.** The whole airfield and the nearby roads visible and on the ground while zooming in and out (terrain
   LOD changes must not move the paint off the flat ground). `?runway=paint` shows the paint on natural terrain,
   `?runway=stamp` the flat ground alone, `?runway=off` neither.
3. **10 km.** The runway is still visible; roads fade to faint lines rather than vanishing abruptly or growing wide.
   The panel may show a full list (expected; low-priority road segments drop first). No flicker when the page level
   changes while zooming between 6 km and 25 km.

## 2026-10-27 — Spike S1: per-tree far shading replaces the shadow march; test buildings

Follows the owner's Q3 verdict above. The height-field march is gone from the layer, its uniforms and the panel (the
0/2/4 toggle and the `forestShadow` sun occlusion). In its place the far form draws the same trees the instances are
scattered from.

### What changed

- **Per-tree lookup** (`forest-shading.ts`, CPU twin; `forest-layer.ts`, TSL). Each pixel finds the scatter's trees
  from the cell hash alone: in the dominant axis's frame, 3 × 3 lattice columns around the point lifted to the shell's
  middle, 5 cells per column. Exact for every tree within `LOOKUP_RADIUS_M` = S(1 − √½/2) ≈ 7.76 m; crowns and shadows
  fade to nothing at that radius, so nothing ends in a line. 2 × 2 columns missed trees on faces tilted against the
  lattice (a candidate half a cell off the shell's middle sits up to 4 m sideways).
- **Tone:** a new draw `cellHash(seed·8 + 5)`, now the 5th float of the scatter (`SCATTER_STRIDE` = 5): brightness
  ±12 %, slight red/blue hue shift, mean 1. The instances read the same draw through a per-instance colour attribute.
- **Crown:** a disc of the tree's crown radius with a pixel-wide soft edge, lit as a dome by N·L. The dome normal
  leans by `CROWN_NORMAL_LEAN` (0.3) to the up axis, the same lean the instances' shading normal now uses.
- **Crown shadow:** a soft ellipse per tree (across 0.85 × crown radius; along crown radius + 0.35 × crown length /
  tan(elevation), capped at 7.25 m), centred `0.56 H / tan(elevation)` away from the sun (the mean tree's crown centre),
  found by a second lookup at the point moved that far toward the sun. tan(elevation) is floored at 0.035 (about 2°).
- **Fade:** from 3 px to 2 px a crown (4–6 km for the 12 m crown) the pattern blends into `forestAverage`, a function of
  sun height and density fitted to the pattern's own Monte Carlo mean (cover `0.668 d − 0.054 d²`; crown light
  `0.989 + 0.249 exp(−s / 0.093)`; ground shade `0.467 d · smoothstep(0, 9.85 m, shadow offset)`; max fit errors 0.006,
  0.008, 0.04). Beyond 6 km only the average runs.
- **Temporary, documented in the code:** all shading is baked into the albedo against a fixed sky share of 0.25, because
  the planet lighting stage reads only the sphere normal and its `sunVisibility` also dims the sky term. Move it to a
  normal and a direct-shadow input when the library has them.
- **Test buildings** (`building-field.ts`, `building-layer.ts`): up to 60 seeded candidates in a 500–3200 m ring
  around the runway, 50–200 m footprints and heights, axis-aligned with the runway, at least 150 m off the apron and
  40 m apart, none over water; trees and rocks keep 8 m off every footprint (worker `clearanceAt`). Meshes (sunk 10 m,
  walls lit by their face normal) dissolve over 3–4 km into the far form: the roof footprint in the roof tone, and a
  flat ground shadow, the convex hull of the footprint and the footprint moved away from the sun by
  `height / tan(elevation)`, as plane distances; no march. The shadow draws at every distance (the meshes cast none).
  Each building's far form fades out from 2 px to 1 px of its smallest side. Panel: show buildings toggle and count.

Known limits: the building far form has no walls (visible in oblique views around 4 km); its shadow assumes flat
ground and does not fall on other roofs; the forest far form still draws in the 8 m margin around a footprint where the
instances leave a gap. Cost: within 6 km two lookups × 45 cells per pixel, about 300 hashes, plus one loop over the
building list; not measured (Q4).

### What was verified

- `ng build demo-app --configuration development`: clean.
- Spike specs headless (`--browsers=ChromeHeadless --watch=false`, `--include` the spike folder): 50/50. New:
  `forest-shading.spec.ts` (crown shadow offset, shadow factor, tone mean and spread, crown light sides, the lookup
  against the scatter on four tilted faces with matching tone draws, the 4–6 km band, the average against the pattern's
  Monte Carlo mean within 0.03 at three sun/density cases) and `building-field.spec.ts` (placement constraints and
  determinism, records round trip, trees and rocks off footprints, bands, footprint shadow offset and hull distance).
- **Not verified:** nothing was seen by eye. The owner's server serves the main checkout, not this worktree, and no dev
  server was started. GPU cost (Q4) and Q5 not touched.

### Owner checklist (per-tree shading, buildings)

Panel: **go to forest**, then the presets; wait for terrain to settle. Sun buttons **noon** (70°) and **low sun** (8°).

1. 250 m, noon then low sun: instances carry visible per-tree tone; crowns brighter on the sun side; shadows short at
   noon, long and pointing away from the sun at low sun.
2. Split view (**split: instances | layer**) at 250 m and 1.5 km, noon and low sun: the layer half shows the same trees
   (same places, tones, shadow directions) as the instance half; brightness of the halves agrees; no dark blobs.
3. 1.5 km, noon and low sun: no seam where the instances dissolve into the layer (fade band 1–3 km).
4. 6 km, noon and low sun: no brightness step while the pattern blends into the average (4–6 km); slow zoom 3 → 8 km.
5. 25 km, noon and low sun: an even forest tone, darker at low sun only through the average; no pattern or banding.
6. Buildings, **back to runway**: at 250 m and 1.5 km boxes stand on the ground with lit and dark walls and a ground
   shadow on the side away from the sun; no trees or rocks inside them. At 6 km and 25 km roof footprints and swept
   shadows, no pop around 3–4 km; at low sun the shadows are long but stay on the ground. Try the three view modes.

## 2026-10-27 — Combining the four parts in the main checkout

The lighting inputs, planet scatter, flat features and per-tree shading with buildings were built in four parallel
worktrees from the same base. This entry records how they were joined (uncommitted, in the main checkout) and what the
combination changed on the spike page.

### Conflicts and how they were resolved

- **Docs.** Runbook 063, `CHANGELOG.md` and Plan 063 hold every session's dated section, in the order lighting, scatter,
  flat features, shading. The Plan status line and the Scope table (rows 3 and 4) name all four parts.
- **`forest-field.ts`, `rock-field.ts`.** The shading session's own lattice (`scatterCells`) is gone; trees and rocks come
  from `scatterPlanetLattice`. The building clearance moved into the layer definitions (`treeScatterLayer` and
  `rockScatterLayer` take an optional `clearanceAt`), so the buildings keep trees and rocks off their footprints through
  the library lattice. `cellHash` stays as an alias of `hashScatterLatticeCell01` (bit-identical to the old function), so
  `forest-layer.ts` and `forest-shading.ts` still find the same trees as the instances. `PIXEL_PER_DISTANCE` is re-exported
  from the library's default fade rule.
- **Draw salts.** The library lattice spends salt 4 on the yaw and 5 on the size; the shading session used 4 for the size
  and 5 for the tone. The far form now reads the size at salt 5 (`TREE_SCALE_DRAW`) and the tone at salt 6
  (`TREE_TONE_SALT`, the first free one); the instances compute the same tone from the result's `cells`.
- **`forest-instances.ts`.** `SurfaceInstances.setInstances` takes an `IInstanceBatch` (the lattice result, or the same
  shape built by `buildingBatch` for the buildings, with per-instance size and tone). The shading session's interleaved
  record format is gone for trees and rocks; the buildings keep their worker record and are converted on the page.
- **Worker and page.** One worker handles both the `flatFeatures` request and the `buildings` request. Building ground
  height uses the flat-feature stamp (`groundHeight`), so the boxes stand on the airfield plateau the paint is drawn on.
  The page requests the flat features and sets the building site when the runway site arrives.
- **Specs.** `forest-shading.spec.ts` and `building-field.spec.ts` build their scatter with `scatterPlanetLattice`.

### Left as written

- The shading is still baked into the albedo (a fixed sky share). Switching the forest layer and the instances to the
  library's `normal` and `directShadow` inputs is a follow-up; the steps are in the "Switching the spike from colour-baked
  shading" section above.
- `forest-layer.ts` and `rock-layer.ts` still evaluate the density with their own hash and noise nodes. Switching them
  to `scatterDensityFieldNode` (see the scatter entry) is a follow-up.
- The buildings keep their own placement and clearance; they do not use the flat-feature list.

### Owner checklist

Open `http://triangular-demo.localhost:4200/planet-surface-detail-spike` and run, in order, the checklists of the
lighting, scatter, flat-feature and per-tree shading and buildings entries above. In addition: trees stay off the
buildings and the airfield; building meshes sit on the flat ground; the far-form tree tones match the mesh trees.
