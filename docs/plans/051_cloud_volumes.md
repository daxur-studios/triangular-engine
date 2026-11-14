---
type: Plan
title: Cloud Volumes
description: Fast, flyable 3D clouds in TSL on WebGPURenderer, using bounded density volumes with baked light and distance fields, lit by the Plan 049 atmosphere, shaped by noise, meshes or GPU particles, plus a cheap planet-scale shell for the far view.
timestamp: 2026-10-17T00:00:00Z
tags: [clouds, volumetric, raymarching, atmosphere, tsl, webgpu, performance, stylized]
record: /docs/engineering-records/051_cloud_volumes.md
---

# Plan 051: Cloud Volumes

Status: **in progress, owner: local Sonnet session** (Phases 0-1 built and checked 2026-10-17; maintainer's timings in the runbook). The review on 2026-10-17 recommends a **conditional go**, settled by the Phase 2a probe; the maintainer confirms. Approach chosen by the owner on 2026-10-17 (see §Decisions).
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
  Skipping a rebake is a saving for still frames, not the thing that makes the clouds fast. In a game where planets
  turn and orbit and the camera never stops, every bake must fit the budget when it runs **every frame**
  (see §Moving planets).
- The engine is public: no consumer app names or paths in code, docs or commit text.

## Goals

| # | Goal |
|---|---|
| G1 | Clouds are 3D: fly up to them, into them and out again with no pop, from inside a volume as well as outside |
| G2 | Lit by the atmosphere: transmitted sun colour, sky ambient, aerial perspective. No white glow at sunset |
| G3 | Any shape: a mesh becomes a cloud of the same shape |
| G4 | Dynamic: animated noise, and density splatted from a GPU particle buffer every frame |
| G5 | Stylized by default (soft toon ramp, crisp edges, silver rim); a softer realistic look from the same renderer later |
| G6 | Budget (GPU, 1440p, maintainer's GPU): **≤ 1.5 ms typical, ≤ 2.5 ms worst case** (camera inside thin, wispy cloud). Status at 2b: typical met at 1-4 volumes (0.2-1.2 ms); worst met at 1, borderline at 4 (2.4-2.6 inside); moving not measured yet; 12 volumes fails and becomes a Phase 6 gate (cost nearly flat as visible volume count grows) unless step 3c fixes it. Phase 6 needs one generic loop over volumes with per-volume params in a uniform/storage buffer, so shared atlases also fix the sampler count |
| G7 | From orbit, planet-wide cloud cover for a fraction of a millisecond, casting shadows on the ground |
| G8 | A few point lights light the cloud from inside: a rocket engine flying through, lightning in a storm. Both shown in the lab (Phase 7) |
| G9 | Clouds render correctly through the planet's globe-to-map morph, day and night as on the globe (proposed 2026-11-11; see §The morph) |

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
| C. Bounded density volumes, baked light, low-res march | ~1–2.5 ms | Seamless | Distance-field bake | Splat into the volume | **Main renderer** |
| D. Whole-planet raymarched layer | 3–6 ms+ | Slow inside | No | Noise only | No (tried, see above) |
| E. Gaussian splats | Varies | Yes | Yes | Yes | Not now: per-frame sort, young WebGPU tooling |

## Architecture

### `CloudVolume`

An oriented box in world space (follows an `Object3D`), holding these volumes, each stored as a 2D slice atlas
(Phase 1 decision, below):

| Volume | Default size | Format | Rebuilt when |
|---|---|---|---|
| Density | 128³ (tier: 64³–160³) | RGBA8, consecutive z slices packed into the four channels | A source changes |
| Occupancy (max density per brick, for skipping empty space) | Dropped from 2b: measured a wash and costs a sampler per volume. Phase 6's brick allocation gives it for free (see runbook 051, Step 6 result) | | |
| Sun optical depth (through the volume toward the sun) | half the density size | RGBA16F, packed the same way | Density changes, or the sun moves past a tolerance (in the volume's frame) |

About 3 MB per volume at the defaults. Optical depth is stored rather than transmittance because it filters
far more smoothly (the same finding as the froxel table in Runbook 049). The stylized curve is applied at
lookup time, so changing the look never needs a rebake.

**Bakes are fragment passes into 2D slice atlases** (decided by Phase 1, Runbook 051). They run on WebGPU and on
the WebGL2 fallback. `RenderTarget3D` and compute are not used; compute stays an optional WebGPU fast path.

**Why the channels are packed** (review of Phase 1): the march is most likely limited by texture bandwidth.
Phase 1 stored one value per RGBA16F texel (8 bytes, 16 MB for 128³) because single-channel half-float targets read back
empty on the WebGL2 backend. Packing four slices per texel makes density 1 byte per voxel (2 MB, cache-sized). The
two slices of a trilinear read then share one fetch most of the time; with a stride of 3 and one slice overlapping,
they always do. Readback stays RGBA, so the Red-format issue no longer matters.

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
   box (measured 5-7 volumes per pass at the 16-sampler limit, or no limit with half-res box proxies, see runbook 051 step 3c), and stop at the opaque scene depth.
   - Start at the box entry, or at the camera when it is inside the box. Blue-noise jitter the start point,
     with a per-frame offset so temporal reuse averages it.
   - Step by length (about one to two density texels), capped by a maximum step count, not by a fixed count per ray.
     A ray that only clips a corner then costs a few steps, not the full count.
   - Take fixed small steps inside cloud. (The occupancy-grid skip was tried and removed; see runbook 051.)
   - Work in the volume's unit frame. The camera position in that frame is computed on the CPU in double precision,
     at draw time (a per-object uniform, so a parent moved late in the frame is still current). The ray direction is the
     interpolated box vertex minus that position. No world-space position reaches the shader.
   - Stop when transmittance drops below ~0.01. A dense cloud therefore ends the march early, and being inside one is cheap.
   - Each step costs one density read, one optical-depth read, and detail noise near edges only.
2. **Lighting per step:**
   - sun colour from `AtmosphereGpuModel.sunTransmittance`, evaluated once per pixel at the entry point (not per step);
   - times the in-volume transmittance from the optical-depth texture;
   - times a phase term (two-lobe Henyey-Greenstein, or the stylized silver rim);
   - plus ambient from `skyIrradiance` at the volume's altitude, scaled by a height gradient inside the volume.
3. **Aerial perspective:** applied once per pixel at the transmittance-weighted mean hit distance, through
   `AtmosphereAerialPerspectiveLut.lookup`.
4. **Temporal reuse (tried and removed in 2b: measured slower, because per-ray steps are not the cost; if it returns it should be checkerboarding, a different design):** reproject last frame's cloud result with the stored hit distance and the motion of the
   camera **relative to each volume**: keep each volume's previous world matrix, so a turning, orbiting planet with
   the camera riding along reprojects correctly. Blend about 0.9 when valid; reject on disocclusion or a depth mismatch. Checkerboarding (a quarter
   of the pixels per frame) is a later tier.
5. **Composite:** a depth-aware upsample to full resolution, then `scene * transmittance + cloud`, inside the HDR
   `RenderPipeline` (Plan 049's output decision), before the AA pass. The scene's depth comes from `pass()`.

### Far shell (option A)

A sphere at cloud altitude with a 2D coverage map (from planet data, for example moisture, or from noise).
It is shaded with a few parallax taps for fake thickness and with the same atmosphere lighting. It cross-fades
with the volumes by camera altitude. The same coverage map does two other jobs:
- it feeds `PlanetSurfaceMaterial.addSunOcclusion` for ground shadows;
- it decides where near-camera volumes are spawned.

### Moving planets and the sun

The game this targets has planets that spin and orbit, a sun that is fixed in space, a camera riding a moving craft,
and time warp. What each table depends on, and so how often it is rebuilt:

| Table | Depends on | Rebuilt in a moving game |
|---|---|---|
| Atmosphere transmittance / multi-scatter / irradiance | The profile only | Never (profile change only) |
| Atmosphere sky-view (192×108) | Camera altitude, sun elevation at the camera | Every few seconds at 1x (the sun climbs as the planet turns); every frame under time warp. Small, so cheap either way |
| Atmosphere froxel aerial perspective (64×36×32) | Camera pose and sun, in the planet frame | **Every frame the camera moves or turns**, by design. Its size is what keeps that cheap |
| Cloud density | Its sources only. Volumes live in the planet's body frame, so spinning and orbiting change nothing | On shape change only; every frame for a points source |
| Cloud occupancy grid | Density only | Same as density |
| Cloud sun optical depth | Density, and the sun direction **in the volume's frame** | When the sun has turned past a tolerance (about 0.5°) in the volume's frame |

- **Spin is slow in a volume's frame.** A 6-hour day turns the sun about 0.017° per second relative to the ground,
  so at 1x a 0.5° tolerance rebakes the light every ~30 s. Orbiting the sun is slower still. Wind animates through
  march offsets and never rebakes.
- **Time warp** makes the light rebake every frame. Two things keep that in budget:
  - the light rebake is **time-sliced** round-robin across volumes and slices on a per-frame budget, with no
    cross-fade (a blend needs a second light texture, so another sampler; a 0.5 degree sun step does not pop). Rebaking every
    volume every frame costs about 0.77 ms per volume (21.26 ms at 12), so under heavy time warp the light lags; that is
    acceptable because the far shell covers that case;
  - its full cost (64³ texels × ~24 steps toward the sun) was estimated at 0.1-0.2 ms. The first Phase 1 reading
    suggests about **1.3 ms unsliced** (Runbook 051, review; not yet confirmed). Slicing is therefore **required**, not
    optional: 8 slices is about 0.16 ms per frame, and packed density should cut the full cost too.
  At very high warp the camera is usually far out, where the far shell (one 2D texture, no light bake) is shown
  instead of volumes.
- **Precision:** volumes are marched in their own local box frame, so a huge world position (or a floating-origin
  shift) never reaches the shader as a large float. The planet-frame inputs to the atmosphere are in metres
  relative to the planet, as Plan 049 already does. The Phase 1 spike does not do this yet: it maps the world
  `cameraPosition` and `positionWorld` through the inverse matrix in float32 on the GPU. That is fine at the lab's
  2 km planet but shimmers at planet scale, so Phase 2 fixes it (§Rendering, step 1).
- **Gate rule:** every timing gate is measured twice, camera still and in the moving worst case
  (camera orbiting, planet turning at high time warp, so every table above rebuilds every frame).

## The morph (G9, added 2026-11-11, proposed)

The planet's morph runs from 0 (globe) to 1 (flat map): one shared uniform set on `<planet>`, every in-between shape a piece
of a sphere of curvature k = curve(morph)/R ([Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) §Morph). Today only
the 2D planet cloud shell bends (`planet-cloud-bend.ts`, which reuses `planetBentSurfaceNodes`). The volume core has no
radius, curvature or up logic, and nothing here plans a morph path. Every item below is **proposed**; the owner has not
chosen it.

**Chosen direction (to be tried first): rigid placement.** A volume keeps its straight box, its baked density and light, and
its unchanged march. Only its transform follows the bent ground:
- its centre goes through the bend function (the CPU twin `bend()` in `atmosphere/bent-planet.ts`; the one function terrain,
  atmosphere and clouds must all use, which has to be confirmed first);
- its frame turns to the bent local up at that point.

**Light stays the globe's.** Day and night is `'real'` ([Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) §Day and
night): a map point is lit as its globe location is. Each volume computes its light at its true globe position, with the sun
direction in the volume's own frame, exactly as today. That frame does not change with the morph, so the morph causes no
light re-bake. The planet material already lights a morphed surface as if it were still on the sphere, and the cloud shell
is lit as on the globe, so the clouds then agree with the ground.

**Found while building the suite (2026-11-11): "no re-bake" needs two per-volume steps.** A volume's light is baked in its
own frame from the world sun and the mesh's world rotation, and the atmosphere lighting reads the mesh's world position.
So a rigid turn to the bent up would, left alone, change the frame-local sun (a re-bake while the morph moves) and light the
volume from its bent position (wrong). The lab (`bent-volume-pose.ts`) fixes both without touching the core: it turns each
volume's sun by the same rotation as the volume (`turn * sun`, so the frame-local sun is unchanged), and runs the
lighting with the meshes put back at their globe positions. The cleaner engine form is a separate light pose on
`CloudVolume` and on `CloudVolumeAtmosphereLighting`; not built.

**Edges (a volume is not drawn rigidly where rigid placement breaks).** A volume fades into the 2D shell near the map
outline, at the cut meridian and the poles, and at any zoom where the owner judges volumes stop reading. The fade window is
chosen by eye. The shell needs Phase 6's far-shell coverage so it matches where the volumes were.

**What this assumes (all unmeasured or unknown):**
- A volume is small next to the planet. Derived, not recorded: a straight box of side s on radius R is off by about
  s²/(8R); at R = 600 km that reaches the shell's 150 m floor near s = 27 km, on a 6 km world near 2.7 km. Volume sizes in
  metres are not in the records.
- Map distortion across one volume is small. A rigid volume keeps its true footprint while the ground under it stretches, so
  neighbours can overlap or gap, most at high latitude. The size of that is not known.
- Haze comes from the bent atmosphere at the volume's bent position. The aerial table cannot carry the map mask, so volumes
  near the outline get slightly wrong haze.

**Options not chosen, and why:**
- *Bend the rays inside the march:* a morph inversion per step, bent proxy bounds and a second code path in the core. Per-step
  cost is not in the records (the 12-volume overhead is per volume and per chunk). Revisit only if a measured volume size
  makes the rigid error visible.
- *No volumes on the map (shell only):* nearly free, but 3D cloud shape stops reading at map scale. It is the edge rule
  above, not the main path. Whether it should be the main path depends on whether map scale needs 3D cloud shape, which the
  game's docs do not say.
- *Re-bake density in bent space:* rejected; the light bake alone had to be spread over frames.

**Measured before it is believed (suite `cloud-volumes-morph`, to be built by the `triangular-engine-testing` skill; RTX
3080 Laptop, visible, GPU timing on; the owner runs it):**

| Case | Reads | Why |
|---|---|---|
| 12 volumes placed, morph 0 / 0.5 / 1, camera still, orbit and ground | GPU pass net of a same-run control; drawn volume count | Does rigid placement hold the sphere-side figures (net 1.0 to 2.5 ms for 12 volumes)? |
| Morph sweep 0 to 1 with 12 volumes | CPU ms per frame for the transforms; light bakes triggered | The morph should trigger none (Phase 3a re-bake rule). |
| 50 and 200 volumes, morph 0.5 | Same, plus CPU ms | The stress case the plan never ran. |
| Bent cloud shell, morph 0 / 0.5 / 1, ground and orbit | GPU pass net of control | No GPU cost for the bent shell is recorded; the 1.54 and 1.70 ms figures came from a build whose bend state is not recorded. |
| Volumes at the outline, cut meridian and a pole | Look suite (by eye): holes, double cover, haze colour | The edge rule. |
| Full stack: terrain, atmosphere, volumes, shell at morph 0 / 0.5 / 1 | One frame's GPU pass | [Plan 059](/docs/plans/059_lod_surface_core.md) §Measurements to add lists it; none exists. |

**Gate (proposed, not confirmed by the owner):** the morph adds no light re-bake; a volume's net cost at morph 0.5 and 1 is no
worse than at morph 0 by more than the noise in a clean run; the look suite passes by the owner's eye; the 12-volume case
stays inside G6's worst case. G6's typical and worst figures are themselves proposals.

**Missing facts** (decide the choice above): volume sizes in metres; the planet radius the game ships; what already triggers
a volume's light re-bake; whether map scale needs 3D cloud shape; whether the three bend implementations (the lab's,
`planetBentSurfaceNodes`, formula P2 in `lod-surface`) are one function; whether the terrain's direct shadows return above
morph 0 (cloud ground shadows depend on that, and they are off today above morph 0).

## Performance budget (G6)

| Pass | When | Expected cost |
|---|---|---|
| Density / distance rebakes | On shape change (points source: every frame) | 0 typical; ≤ 0.3 ms for a per-frame points source |
| Light rebake | Sun turned past tolerance in the volume's frame; time-sliced | ≤ 0.2 ms/frame sliced (Phase 1 hint: ~1.3 ms unsliced, unconfirmed) |
| Low-res march | Every frame, pixels covered by boxes only | 0.5–1.5 ms at half resolution |
| Scene target + upsample + composite | Every frame | Measured ~0.9 ms fixed (not ~0.2). "Net" numbers leave this out, which is fair only if the app already renders through a RenderPipeline/pass(), as Plan 049 assumes |
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
   - **Result** (Runbook 051): both backends work with fragment-pass bakes into 2D atlases. Full-resolution cost is
     2–3 ms from outside and 19–39 ms filling the screen. The review recommends a conditional go, settled by the Phase 2a probe.
2. **Volume core.**
   - **2a. Probe** (an hour or two, lab-only changes). It decides go/no-go and the order of 2b.
     - Fix the GPU timer first: read it in `renderComplete$`, after the frame's main render. Read in `tick$`, it can
       return only the passes already submitted this frame (Runbook 051, review).
     - Add a **render scale** control: `renderer.setPixelRatio(devicePixelRatio × scale)`, with scale 1 or 0.5 per axis.
       This gives a true half-resolution cost without building the Phase 2 pass.
     - Add two debug toggles on the march: **jitter off**, and **no fetch** (an analytic density instead of the atlas reads).
     - Re-run the matrix at s16 / s24 / s32 for scale 1 and 0.5. Then run once at s32, inside, with jitter off and once
       with no fetch. Measure the light bake by itself (toggle on minus toggle off, with the fixed timer).
     - **Go line**, on the cloud cost (render minus "off" at the same scale) at scale 0.5, s24, inside:
       - ≤ 8 ms: go, 2b in the order below;
       - 8–12 ms: build only step 1 of 2b (packed atlases), re-measure, then decide;
       - \> 12 ms: no-go for volumes as the main renderer; switch to option B.
   - **2b. Build**, in this order. Measure after each step and record it in the runbook.
     1. **Packed atlases:** density RGBA8 with four z slices per texel (stride 3 with one slice overlapping, if
        that measures faster), and light RGBA16F packed the same way. Specs read the packed channels back.
     2. **Unit-frame march:** compute the camera position in the volume frame at draw time (§Rendering, step 1). Step by
        length, capped by a maximum count.
     3. **Half-resolution screen pass:** box intersection with the scene depth, a depth-aware upsample, and the composite
        in the `RenderPipeline`. Clouds sit correctly in front of and behind the planet.
     4. **Temporal reuse: tried, removed** (slower; see runbook 051 Step 4 result).
     5. **Time-sliced light rebake**, round-robin, no cross-fade.
     6. **Empty-space skip: tried, removed** (a wash; see runbook 051 Step 6 result).
     3c. **Half-res box proxies (spike):** one back-face box per volume rendered into the half-res target with premultiplied
        over blending, sorted far to near, each ray ending at the full-res scene depth. Removes chunks and the sampler limit.
        Keep only if it beats the screen pass at 4 and 12 volumes.
     7. **Moving lab (built 2026-10-18; measured, by-eye check pending):** the planet spins and orbits a sun, with a time-warp slider (1x to 100 000x).
   - **Gate:** a fly-through by eye with no pop, and GPU ms at the five camera spots within G6, still and in the moving
     worst case.
3. **Atmosphere lighting.** Sun colour, sky ambient and aerial perspective from the atmosphere API (Earth and
   Mars presets) on the lab's planet.
   - **Status 2026-10-20:** 3a built (sun colour and sky ambient per volume on the CPU, `CloudVolumeAtmosphereLighting`, with a fade over the last 4° below the horizon so the colour no longer snaps off). 3b built (per-pixel aerial perspective haze in the march, sky backdrop in the lab). Gate met by eye. Haze costs +0.19 ms on the fly-by, +0.02 inside, 0 at the horizon (discrete GPU), so the fly-by is about 2x the 0.1 ms goal; per-pixel haze kept by decision. A volume straddling the terminator still flips as a whole (optional per-pixel sun colour not built).
   - **Gate:** orange-lit clouds at dusk, blue-hazed far clouds, a dark night side, no white glow.
     Cost added ≤ 0.1 ms.
4. **Stylization.** Light ramp, edge hardness, silver rim, tint and density curve, with presets
   `stylized` (default), `soft` and `storm`.
   - **Gate:** the maintainer picks the default look.
5. **Sources.** Mesh source (a ship mesh baked to a cloud), points source (the demo carries a small built-in
   GPU particle swirl standing in for an app's simulation), animated noise.
   - **Status 2026-10-20:** mesh source built (`CloudVolume.setMeshSource`, CPU band-limited signed distance field in `cloud-volume-mesh-sdf.ts`, ramped and noise-eroded in the density bake; specs pass). Lab has a torus knot source button. Not yet looked at by eye; ship mesh, animated noise and points source not started. Open question: whether the points source may be WebGPU-only (compute) instead of also running on the `forceWebGL` fallback.
   - **Gate:** the ship reads as made of cloud; the particle cloud moves every frame within G6.
   - **Suggested additions (2026-10-18, not yet agreed):** more test shapes, to stress thin and concave features the ship does not:
     - a **torus knot** mesh source (thin tubes, holes, self-overlap): does the distance field and softness ramp keep it readable as a knot made of cloud, with no filled-in holes or broken tubes?
     - a **tornado** from the points source (a funnel of orbiting particles, wide at the top): does it read as a funnel from every side and stay inside the per-frame budget?
     - Gate: both read as their shape from outside and from inside, at the same cost limits as the ship.
6. **Far shell + planet coverage.**
   - coverage map, shell shading and the altitude cross-fade with volumes;
   - ground shadows through `addSunOcclusion` on a `PlanetSurfaceMaterial` globe;
     (the hookup edits the planet material's slot, Plan 050, so it needs the maintainer's go-ahead then; late, performance first);
   - volumes spawned near the camera from coverage.
   - **Gate:** a descent from orbit into a cloud with no visible switch.
   - **Suggested addition (2026-10-18, not yet agreed): full-coverage stress test, ahead of the rest of this phase.** The lab
     tops out at 12 volumes, so nothing yet shows whether a realistically covered planet works. Spawn 50-200 volumes from a
     noise coverage map over the whole globe (a mix of overcast and clear regions) and measure:
     - GPU ms from orbit, mid altitude and the surface, against G6;
     - the per-frame distance sort (the unsorted-overlap issue in Runbook 051), and pop-in as volumes spawn and despawn;
     - how many volumes are needed for believable coverage, and so whether bounded volumes alone suffice or the far shell
       must carry more of the planet than planned.
     - Gate: a stated volume count and GPU cost for full coverage, with no wrong-order compositing visible.
7. **Point lights: rocket engine and lightning.** Up to 4 lights per volume, unshadowed, attenuated by the
   optical depth along a short (2-4 step) march toward each light, so a light deep inside lights a soft ball around it
   instead of the whole cloud. Lights use HDR colour and intensity, so they bloom with the rest of the scene.
   The lab gets two showcase scenes:
   - **Rocket engine fly-through:** a small craft flies a looping path through a cloud bank, its exhaust a warm,
     flickering point light (plus the craft's own emissive plume). Fly-cam or chase-cam. The cloud lights orange
     around the craft as it passes, and the craft is seen in and out of the cloud with correct depth.
   - **Storm with lightning:** the `storm` preset (dark, dense, tall) with lightning flashes: a light that jumps
     to random spots inside the volume, with a flash envelope (a sharp flash, then two or three flickers). An
     optional thin bolt mesh shows below the cloud base. Controls: flash rate, colour, intensity. Seeded, so a
     flash sequence repeats for screenshots.
   - **Gate:** the engine lights the cloud from within as it passes; flashes light the storm from inside, with no
     whole-cloud blink; GPU cost noted per light.
   - **Noise shell (owner's request, 2026-11-05): a planet fully covered by continuous 3D clouds.** This is option D above, which
     this plan rejected on cost, so it has to meet the same rules as the volumes, not sit beside them. The first spike
     (`cloud-noise-shell.ts`, lab only) broke them: procedural noise per step instead of a baked lookup, a hardcoded sun
     colour instead of the atmosphere (no orange at dusk, against G2), and no test suite or GPU timing. Rules from here on:
     - **Same lighting as the volumes (G2):** sun colour and sky light from the atmosphere, same shading formula. Two
       table reads per cloud sample: the shell crosses the terminator, and a single read per ray (tried) lit night
       cloud with the colour of the day side on grazing rays, which showed as a hard dark arc inside the limb.
     - **Bake, then look up:** the density is a tiling noise texture baked once, with wind as a coordinate offset. A second
       read of the same texture adds the fine detail; sun taps skip it.
     - **Measured with `triangular-engine/testing`:** suites `cloud-shell-look` (ground, horizon, mid, orbit at noon, dusk,
       night, for visual review) and `cloud-shell-cost` (A/B against nothing, GPU timestamps).
     - **Baseline, procedural noise, 2026-11-05 (headless, noisy, GPU reported throttled, so read as relative):** net
       10.6 ms ground, 13.4 ms horizon, 2.8 ms mid, 1.4 ms orbit, against G6's 1.5 typical and 2.5 worst.
     - **Baked noise with atmosphere light, 2026-11-05 (same conditions):** net 1.4 ms ground, 1.5 ms horizon, 0.3 ms mid,
       0.2 ms orbit.
     - **Owner's run, visible browser on the RTX 3080 Laptop at 2538x1308, 2026-11-05 (spread ±0.001 ms, summary showed no
       warnings):** net 1.54 ms ground, 1.70 ms horizon, 0.44 ms mid, 0.27 ms orbit. All inside the 2.5 ms worst case; ground
       and horizon are just over the 1.5 ms typical figure. The owner has not yet reviewed the look.
     - **Gate:** ground, horizon, mid and orbit net of the baseline within G6 on a clean run; orange at dusk, dark night side,
       no cutting or double arc, accepted by the owner from the look suite.
8. **Tiers, telemetry, docs:**
   - quality tiers;
   - a `clouds` telemetry section (Plan 048);
   - `projects/triangular-engine/docs/cloud-volumes.md`, a skill section, `CHANGELOG.md`,
     `entry-points.md`, token-map registration.

## Tests

- CPU reference for optical depth through an analytic density (a uniform box, a Gaussian blob) to check
  the bake. Compare to the baked texture read back from the GPU.
- Occupancy grid against a brute-force max over each brick (and the jump-flood distance field against brute force,
  if it is built).
- Packed atlases: a read of the packed channels matches the unpacked reference, including at slice boundaries.
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
| Bakes as fragment passes into 2D slice atlases (both backends), compute as an optional fast path | **Decided** by Phase 1, 2026-10-17 |
| Phase 1 go/no-go: conditional go, settled by the Phase 2a probe's go line | Recommended by the review 2026-10-17; maintainer confirms |
| Atlas formats: density RGBA8 and light RGBA16F, four z slices packed per texel | Proposed (review), measured in Phase 2b step 1 |
| Empty-space skip: tried in 2b and removed; Phase 6 brick allocation covers it | Superseded |
| Budget G6: ≤ 1.5 ms typical, ≤ 2.5 ms worst, measured with GPU timestamps | Proposed |
| Morph (G9): volumes keep their box and march and are placed rigidly on the bent ground; light stays the globe's (`'real'` day and night); fade to the shell at the outline, cut meridian and poles | Proposed 2026-11-11, not chosen by the owner; see §The morph |

## Out of scope for now

The weather simulation itself (the app supplies densities or particles), rain and snow rendering,
lightning visuals beyond the point light, light shafts through clouds, shadows cast between volumes,
clouds on more than one planet at a time.

## Suggestions (not scheduled)

- **Terrain blocking the sun for clouds** (a large mountain shading a cloud at low sun): needs a terrain shadow source (a sun-facing height or shadow map from the planet material) that the light bake can sample. Nothing provides it yet; revisit after Phase 6, only if the cost fits G6.
- **Cloud shadows on mountains / terrain self-shadow** are the same missing piece from the other side.

