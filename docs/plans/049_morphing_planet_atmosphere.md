---
type: Plan
title: Morphing Planet Atmosphere
description: A new, fast, LUT-driven atmosphere (scattering, sky, aerial perspective, sky objects, limb glow) for the cell planet in globe, flat-map and mid-morph states, from 100 km to Earth-sized planets, written once in TSL on an extensible TSL planet material.
timestamp: 2026-10-16T00:00:00Z
tags: [atmosphere, scattering, sky, cell-planet, morph, rendering, performance, webgpu, tsl]
runbook: /docs/runbook/049_morphing_planet_atmosphere.md
---

# Plan 049: Morphing Planet Atmosphere

Status: **planned, owner: unclaimed.** Nothing here has been built yet. Phases 0-1 are CPU-only and can
start now, alongside Plan 050. Evidence: [Runbook 049](/docs/runbook/049_morphing_planet_atmosphere.md).

Target: the cell planet as shown in `/cell-planet-morph-streaming`.

**Prerequisite:** [Plan 050](/docs/plans/050_tsl_planet_surface_material.md) (TSL planet surface
material) through its Phase 4. Plan 050 owns the material design and the port; this plan owns what
goes into its lighting and atmosphere stages.

**Decided (2026-10-16):** Hillaire-style LUTs + stylized ramps. TSL only, one version, on a new
extensible TSL planet material. Small planets must look good. See §Decisions.

## Clean start

This is a **new implementation**. The earlier atmosphere work is treated as unwanted and is
neither modified, extended nor depended on:

- `takram/atmosphere/*` (Takram/Bruneton adapter, aerial perspective, sun/sky lights)
- `takram/atmosphere/takram-cylinder-atmosphere.component.ts`
- `ICelestialBody.atmosphere.visual` and the commented-out `sky-sphere.component.ts`

New code goes in new files only. Changes to existing files are limited to additive exports
(`public-api.ts`), new demo routes, docs, and the plan/runbook indexes. The current GLSL planet
materials and the morph-streaming demo stay as they are (Plan 050 adds the TSL versions as new files).

The new work **reads** these existing conventions without changing them: the morph attributes
(`aSphereNorm`, `aSpherePos`, `aFlatPos`) and projections (equirect, Equal Earth), the body-frame sun
from `computeSunDirectionFromTime`, and the world-size tiers in `celestial/bodies/world-size-presets.ts`.

## Goals

| # | Want | What it means technically |
|---|---|---|
| G1 | Distant mountains look different | Aerial perspective: surface colour × transmittance + in-scattered light, along the camera→fragment path |
| G2 | Stars, moon and other sky objects hidden or tinted by the air | Sky objects get the same transmittance + in-scatter as the sky behind them |
| G3 | Earth, Mars, Venus, maybe gas giants | Data-driven atmosphere profile; lookup tables (LUTs) cheap enough to re-bake on profile change |
| G4 | Very cheap, and no slower inside the atmosphere | Every per-pixel cost is a few texture fetches. No per-pixel ray-march inside the atmosphere. Fixed-size LUTs mean the cost doesn't depend on altitude |
| G5 | Good dusk and dawn, from space and on the surface | Multiple scattering, sun transmittance driving the light colour, terminator across the flat map |
| G6 | Backlit limb glow (planet in front of the sun) | Strong forward Mie phase + long limb paths, evaluated from outside the shell |
| G7 | Realistic or stylized per game | One LUT interface, two producers: physical integration or artist ramps |
| G8 | Runs on WebGL and WebGPU | One TSL implementation on `WebGPURenderer` (WebGPU, falling back to WebGL2) |
| G9 | Mini to Earth-sized planets all look good | Scale-invariant profiles (§Planet sizes) |
| G10 | Games can extend the planet material and get atmosphere on their own objects | Extensible TSL planet material ([Plan 050](/docs/plans/050_tsl_planet_surface_material.md)) and automatic coverage (§Applying the atmosphere) |

## Feasibility

**Feasible.** G1–G6 are what Hillaire's 2020 LUT sky (the model behind Unreal's SkyAtmosphere)
and Bruneton's precomputed scattering already do in shipped engines, and both cost well under a
millisecond per frame. G7 falls out if the rest of the renderer only ever reads LUTs.

The morph is the only part without a published recipe, and it is easier than it looks:

> Every scattering lookup depends only on **local** quantities: altitude `h`, view-zenith cosine
> `μ`, sun-zenith cosine `μs` and view-sun cosine `ν`. None of them needs the planet to be a
> sphere. They only need a local "up", an altitude and a sun direction at each point.

The morph geometry already carries all three per vertex: `aSphereNorm` (the point's up on the
globe), terrain height, and the body-frame sun angle. So on the flat map a point at local dusk gets
dusk-coloured air, and the terminator crosses the map where it should. The globe can't show that
whole picture at once, so it's something extra the flat view gives you.

Risk areas (each is a phase gate below):

- **Mid-morph sky** (no surface under the pixel): the morphed sea level has no closed-form inverse.
  It's a transition state, so a continuous, plausible blend is enough (§Morph).
- **Venus-thick atmospheres:** the multiple-scattering approximation gets worse as optical depth
  grows. Plan on an art-directed thick-haze profile plus an opaque cloud deck, not exact physics.
- **Small planets:** real physics makes them look airless (§Planet sizes).
- **The TSL port is a prerequisite:** `WebGPURenderer` ignores the cell planet's GLSL
  `onBeforeCompile` patches. [Plan 050](/docs/plans/050_tsl_planet_surface_material.md) does the port
  and its Phase 0 checks `BatchedMesh` and log depth under `WebGPURenderer`.

## Technique options

| | A. Bruneton precomputed | **B. Hillaire-style LUTs** | C. O'Neil / Preetham | D. Pure stylized |
|---|---|---|---|---|
| Quality | Best, multi-scatter exact | Near-Bruneton, multi-scatter approximated | Dated, weak dusk | Whatever the art is |
| Per-pixel cost | O(1) everywhere | O(1) inside. From space, a short march on shell pixels only (or a limb LUT) | Very low | Very low |
| Re-bake on profile change | Heavy 4D precompute | Small 2D LUTs, ≪ 1 ms → can animate | n/a | n/a |
| Flat map / morph | Poor: assumes one sun angle along a straight spherical ray | Yes: each sample of the per-frame march takes its own local frame | Hacky | Yes |

**Decided: B as the core, D as a second producer behind the same LUT interface.**

## Architecture

```
AtmosphereProfile (data: reference radius, Rayleigh/Mie/absorption layers, phase g, sun; or stylized ramps)
        │  + size scaling (§Planet sizes)
        ▼
AtmosphereModel ── PhysicalModel (Hillaire integration)   ──┐  same outputs
                └─ StylizedModel (artist ramps → textures)  ──┘
        │
        ▼
AtmosphereLuts  (per profile)  transmittance 256×64, multi-scatter 32×32, irradiance 64×16
                (per frame*)   sky-view 192×108, aerial-perspective froxels 32×32×32 (2D atlas)
        │                      (*skipped while camera/sun move less than a tolerance)
        ▼
Consumers (all read LUTs, never integrate), all TSL nodes:
  • atmospherePerspective()  aerial perspective, last stage of the planet material, wrappable onto any NodeMaterial
  • atmosphereLighting()     sun × transmittance + sky irradiance, per fragment
  • screen pass              automatic haze for everything else (§Applying the atmosphere)
  • sky mesh                 full-screen at far depth (inside + from space)
  • atmosphereSky(dir)       for stars, moon, sun disc, other planets, ocean reflection
  • light sync               DirectionalLight / ambient colour from the LUTs at the focus point
```

New secondary entry point `triangular-engine/atmosphere`, three-only TSL core plus thin Angular
components, following Runbook 024's sublibrary boundaries.

### Sky and sky objects

- One full-screen sky mesh at far depth. Inside the atmosphere: one sky-view LUT fetch. From
  space: shell-intersection test, then a 16–32-step march on the pixels that hit the shell only
  (limb, and the far side of the terminator). Optional later: a camera-independent "limb LUT"
  (closest-approach altitude × `μs` × `ν`) makes the space view O(1) too.
- Every sky object's material calls `atmosphereSky(dir) → {inscatter, transmittance}`:
  - stars: additive, `star × T`, drawn after the sky. Daytime washout comes from exposure (physical)
    or an explicit luminance fade (stylized).
  - moon / planets / sun disc: opaque, `colour × T + inscatter`, so they replace the sky exactly.
- Limb glow (G6) needs nothing extra: Mie forward scattering (g ≈ 0.76–0.8) along the long limb
  paths, evaluated from space, plus the planet's own shadow from the transmittance LUT returning 0
  below the horizon. The thing to get right is HDR headroom plus bloom.
- Eclipses: the atmosphere takes a global `sunVisibility` scalar, so the sky darkens during an
  eclipse as well as the ground (see the sun-occlusion stage below).

### Lighting coupling (needed for G5)

Without this, dusk looks wrong: an orange sky over white-lit terrain.

- Planet shading: `albedo × (sunIrradiance × T(h, μs) × sunVisibility × N·L + skyIrradiance(h, μs))`,
  in the planet material's lighting stage. On the flat map `μs` varies per point, so a single
  `DirectionalLight` can't express it.
- `<atmosphere>` keeps scene lights in sync (sun colour, ambient) from the LUTs at the focus point,
  for everything that doesn't use `atmosphereLighting()`.
- Exposure: a physical sky needs an exposure curve (altitude/sun-elevation driven, or eye
  adaptation) on top of ACES. Stylized mode sidesteps this.

### Morph

Per surface fragment, blend the inputs, not the colours:

```
up   = normalize(mix(sphereNormal, +Z, morph))       // matches the morphed sea-level normal
h    = terrain height                                  // intrinsic, morph-invariant
μs   = dot(sphereNormal, sunBody)                      // intrinsic
path = actual world camera→fragment distance           // what the viewer actually looks through
```

- **Globe (m = 0):** standard spherical shell.
- **Flat map (m = 1):** a slab of thickness `topAltitude` over the map. Sky-view and froxel marches
  use the camera's local frame. Each froxel sample works out its own `μs` from the inverse projection
  of its map x/y, so haze far across the map can be at dusk while the camera is at noon. The
  sky-view LUT keeps the true R, so the horizon looks right near the ground.
- **Mid-morph:** evaluate the camera's sky for its sphere pose and its flat pose (the morph camera
  already interpolates the two) and crossfade by `morph`. That's two sky-view evaluations, only
  while morphing. Surfaces use the input blend above. The check is no pops and nothing going black.

#### Flat map seen from far above (the edge question)

On the globe, seen from space, the air shows as a glowing rim around the planet. On the flat map
the air is a thin layer lying on top of the map. Looking straight down you see a light blue haze
over the map, and the question is what happens at the **map's edge**:

- *Realistic slab:* the air stops dead at the edge, like a glass sheet cut with scissors. At a low
  angle you'd see a thin blue band along the cut edge. It's correct but looks odd.
- *Stylized edge glow:* the haze fades out softly before the edge, and a soft glowing outline
  is drawn around the map, echoing the globe's limb glow so the morph feels continuous.

**Default: soft fade at the edge** (no hard cut). The glowing outline is an optional profile
setting (`flatMapEdge: 'fade' | 'glow'`), on by default for stylized profiles. Wrap-around
maps skip the fade on the wrapping edges.

## Planet sizes

Sizes to support, from `WORLD_SIZE_TIER_RADIUS_M`:

| Tier | Radius | Notes |
|---|---|---|
| mini | ~6.4 km | Stretch goal (not selectable in-game yet) |
| extra-small | ~64 km | |
| *(100 km)* | 100 km | Explicit test case |
| small | ~191 km | |
| medium | 600 km | Kerbin-sized, today's `HOME_PLANET` |
| large | ~1,900 km | |
| extra-large | 6,371 km | Earth |

**Why real physics fails on small planets:**

- Optical depth = σ × path length. Shrink the planet and keep Earth's σ, and the air becomes
  almost transparent: no blue distance, weak sunsets. Sunset colour needs a long sun path, which
  grows like √(R·H).
- Thickness ratio: Earth's air is ~1.6% of its radius, a hair-thin line from space. Kerbin's is
  ~12%, a visible halo. An Earth-height atmosphere on a 100 km planet would be mostly atmosphere.
- Close horizons: on a 100 km planet a 2 m-tall viewer's horizon is ~630 m away.

**Approach: author once, scale by similarity, then tune.**

1. A profile is authored at a reference radius (e.g. Earth). For a planet of radius R, every length
   (radii, scale heights, top altitude) scales by `k = R / Rref`, and every scattering/absorption
   coefficient scales by `1/k`. All optical depths, dusk colours, horizon haze and limb glow then
   come out the same: a 100 km planet looks like a shrunken Earth from every equivalent viewpoint.
   The LUTs are parameterized relative to the shell, so they work unchanged at any size.
2. Art knobs on top, each scale-free:
   - `thickness`: atmosphere height / R. Thin Earth-like line vs fat Kerbin halo. Keeps the
     zenith optical depth fixed while changing it.
   - `hazeAtHorizon`: target transmittance to the horizon from the surface. Solves for σ.
   - `nearHazeFadeM`: no haze within this distance of the camera. With similarity scaling a 100 km
     planet's σ is ~64× Earth's, so a creature 50 m away would get as much haze as something 3 km
     away on Earth. This keeps nearby props and creatures crisp.
   - `reliefFit`: optionally raise `thickness` so the highest terrain sits inside the air (the
     demo's relief is ~10% of R).
3. A `physical` mode with absolute units stays available for games that want real values.

**Precision.** At Earth scale, float32 `length(worldPos) - R` has ~0.5 m steps and bands near the
ground. Use the intrinsic terrain height for surface altitude, compute camera altitude on the CPU in
doubles, and keep shader positions camera-relative. Keep rendered ground just above
`bottomRadius`: ground exactly at `r == bottomRadius` hits a degenerate edge of the transmittance
parameterization and bands.

**Gate (Phase 2 and 3):** the same Earth profile at 64 km, 100 km, 600 km and 6,371 km, screenshotted
from the ground (noon, dusk), low orbit, and far space with the sun behind the planet. Each must
read as the same atmosphere. 100 km must not look washed out or foggy at the creature's feet, and
Earth must not band.

## WebGL and WebGPU (decided: TSL only)

Three's TSL (node materials) compiles to WGSL on WebGPU and to GLSL on `WebGPURenderer`'s built-in
WebGL2 fallback, so one implementation runs on both GPU APIs. Atmosphere scenes use
`preferredRenderer: 'webgpu'`. The engine default stays `'webgl'` for existing scenes.

Output pipeline (three 0.186.1, measured in [Runbook 050](/docs/runbook/050_tsl_planet_surface_material.md)):

- Use an HDR `RenderPipeline` (half-float scene target). Exposure, bloom and tone mapping run in its output
  pass. Don't use three's `DirectRenderPipeline`: it tone-maps inside each material, so it has no HDR
  buffer to bloom from, and it blends the sky after tone mapping.
- MSAA off. MSAA on the half-float target costs about 1-2 ms at 720p on WebGPU (more on the WebGL2
  fallback). Use a post-process AA pass (FXAA or SMAA) at the end of the pipeline instead; pick one in Phase 2.

Rules that keep it working on the WebGL2 fallback:

- Per-frame LUT passes are fragment (render-to-texture) passes, not compute. The WebGL2 fallback
  has only buffer compute (no storage textures).
- Froxels live in a 2D atlas (32 slices tiled), not a 3D render target.
- Per-profile LUTs are baked on the CPU in a worker and uploaded as textures. That's renderer-agnostic
  and doubles as the reference integrator for unit tests.
- CI renders each LUT pass on both backends (`forceWebGL: true` and WebGPU where available) and
  compares the readback to the CPU reference.

## Planet material stages

The surface material, its stage order and its extension API (surface layers, sun occlusion,
emissive, building blocks) are defined in [Plan 050](/docs/plans/050_tsl_planet_surface_material.md).
This plan fills in two of its stages and uses a third:

- **Stage 3, sun occlusion:** its product feeds `sunVisibility`, so an eclipse darkens the sky and
  the ground together.
- **Stage 4, lighting:** `atmosphereLighting()` replaces Plan 050's `simpleDayNightLighting` stand-in.
- **Stage 6, atmosphere:** `atmospherePerspective()` replaces the identity stage. It stays last, so
  game layers are hazed too.

Ocean and clouds use the same two stages.

## Applying the atmosphere to everything

Haze has to reach every object, or a game's large structure "sticks out like a sore thumb". Plan:

| What | Path | Game effort |
|---|---|---|
| Planet surface, ocean, clouds (stock) | Material stage 6, exact, including mid-morph | None |
| Any other opaque object | **Automatic screen pass**: depth + the same froxel volume. Planet materials write an "already hazed" MRT mask so nothing is hazed twice | None |
| Transparent objects, or custom materials that want the exact path | `withAtmosphere(material)`: one line, wraps the material's `outputNode` | One line |
| Large objects that should get dusk-coloured light | Automatic scene light sync, or `atmosphereLighting()` for per-fragment accuracy (e.g. something spanning the terminator on the flat map) | None, or one line |
| UI, HUD, gizmos, sky objects | Opt out: `userData.atmosphere = 'none'` (sky objects use `atmosphereSky()` instead) | One flag |

The screen pass makes forgetting harmless: default is hazed. Its cost is one full-screen pass with
two fetches (~0.05–0.1 ms at 1080p). Since the froxels already carry per-sample sun angles, the
flat map is handled too. Only mid-morph is approximate, and only for non-planet objects.

**Making it hard to forget:**

- **Debug overlay** ("atmosphere coverage"): colours each pixel by path (material / screen / sky /
  none), so anything missing stands out.
- **Docs:** a new `projects/triangular-engine/docs/atmosphere.md` with a short "adding objects to an
  atmosphere scene" checklist and the extension API.
- **Agent skill:** an atmosphere section in `.agents/skills/triangular-engine/SKILL.md`, the skill
  game repos load, carrying the same checklist.

## Profiles (G3)

| Preset | Key traits | Notes |
|---|---|---|
| Earth | Rayleigh-dominant, light Mie, ozone layer (gives the deep blue zenith at dusk) | Reference values from Bruneton/Hillaire |
| Mars | Thin, dust Mie-dominant with rgb-varying coefficients, ochre day sky, **blue sunset** from forward-peaked dust | Fits the model |
| Venus | Very thick, yellow-white, dim orange surface | Thick-haze stylized profile + opaque cloud deck. Physics only approximate |
| Titan | Thick orange haze | Stretch preset |
| Gas giant | No surface: the "ground" is a cloud-deck sphere with a banded material, large scale height | Mostly a profile plus a surface layer |
| None | Moon, protoplanet | Stars stay visible in daylight. Zero-cost path |

Default presets per `WorldProfileKind` live in a new table inside the atmosphere entry point.
`world-profile.ts` is not edited. Because re-baking is cheap, a profile can be **animated** (e.g. an
atmosphere evolving over geological time) without hitches.

### Realistic vs stylized (G7)

1. **Physical**, with art overrides: tint in-scatter and transmittance separately, `hazeAtHorizon`,
   sunset hue shift, and a "pick zenith colour" helper that solves Rayleigh coefficients from a
   target sky colour.
2. **Stylized**: artist ramps (zenith/horizon/sunset gradients indexed by `μs`, haze colour, rim
   colour, optional toon banding) baked into the **same** LUT textures. Every consumer works
   unchanged, and switching costs nothing at runtime.

## Performance budget (G4)

Target: **≤ 0.5 ms at 1080p on a mid-range GPU from any camera position**, with cost flat across
altitudes. To be measured; the Hillaire paper reports sub-millisecond totals on console-class GPUs.

| Pass | When | Expected cost |
|---|---|---|
| Transmittance + multi-scatter + irradiance LUTs | Profile change only, CPU worker | 0 GPU ms; one upload |
| Sky-view LUT 192×108, ~30 samples | Per frame, skipped under a camera/sun tolerance | ~0.05 ms |
| Froxels 32×32×32 atlas | Per frame, same tolerance | ~0.05–0.1 ms |
| Sky mesh | Per pixel, 1–2 fetches | tiny |
| Planet material stage 6 | Per fragment, 1 fetch + ALU | tiny |
| Screen pass (non-planet objects) | Per pixel, 2 fetches | ~0.05–0.1 ms |
| Space limb march | Shell pixels only, half-res option | Scales with how much of the screen the planet covers. Bounded by the limb LUT if needed |

Quality tiers change LUT sizes, march steps and sky resolution only. No tier ever ray-marches per
pixel inside the atmosphere. Add an `atmosphere` telemetry section (Plan 048). Also measure the
`WebGPURenderer` WebGL2 fallback separately. Runbook 050 has it anywhere from classic speed to 2-5x slower,
depending on the three version and machine load; Plan 050 Phase 1 re-measures it. If it stays several times
slower, G8 needs a decision (for example a lower quality tier on the fallback).

## Phases

Each phase ends with a visible check in a demo plus a timing number.

Phases 0–1 don't need a GPU and can run while Plan 050 is in progress. Phase 2 onwards needs
Plan 050 through its Phase 4.

0. **Foundations.** CPU reference integrator + profile format + similarity scaling, with unit tests.
1. **Presets.** Earth, Mars and none presets.
2. **Atmosphere on the globe.**
   - `atmosphere-lab` demo: LUT pipeline, sky mesh, ground-to-space camera, limb glow, planet
     shadow, eclipse `sunVisibility`.
   - Lighting stage + light sync + exposure.
   - **Gate:** budget, sun-behind-planet shot, the 4-size screenshot set at `m = 0`.
3. **Flat map + morph.** Slab, per-sample `μs` froxels, edge fade/glow, mid-morph blend.
   **Gate:** scrub the morph at dusk with no pops, fps steady, 4-size set at `m = 1`.
4. **Coverage.** Screen pass + MRT mask, `withAtmosphere()`, opt-out, coverage debug overlay.
5. **Sky objects.** Starfield, moon, sun disc and other bodies through `atmosphereSky(dir)`.
6. **Extensions demo with atmosphere.** Plan 050's `planet-material-extensions` demo (roads +
   eclipse) with the atmosphere on. Check that the eclipse darkens the sky and that roads are hazed.
7. **Stylized model + art controls.** Ramp producer, overrides, zenith-colour solver, `flatMapEdge: 'glow'`.
8. **More profiles.** Venus, gas giant, Titan, per-`WorldProfileKind` defaults, animated-profile demo,
   mini-tier stretch test.
9. **Polish + docs.** Ocean sky reflection, clouds take aerial perspective and transmitted sun,
   quality tiers, visual-regression shots (Plans 037/038), `docs/atmosphere.md`, skill section.

## Easy to miss

- **Lighting has to come from the atmosphere** (sun colour, sky ambient, per-point terminator),
  or dusk never looks right however good the sky is.
- **HDR + exposure + bloom:** limb glow, sun disc and starlight at night all depend on these.
- **Ocean reflection** of the sky is most of what makes water look right at dusk.
- **Clouds** must take aerial perspective and transmitted (orange) sunlight, or they glow white
  at sunset.
- **Night side:** moonlight, star visibility, emissive lights. Decide whether the moon lights the air.
- **Several bodies:** only one "inside" atmosphere at a time. Other planets and moons use the space path.

## Decisions

| Decision | Status |
|---|---|
| Technique: Hillaire LUTs (physical) + stylized ramps | **Decided** 2026-10-16 |
| TSL only, one version, on `WebGPURenderer`; planet materials ported to an extensible TSL material ([Plan 050](/docs/plans/050_tsl_planet_surface_material.md)) | **Decided** 2026-10-16 |
| Support 100 km to Earth, small planets must look good; similarity scaling + art knobs | **Decided** 2026-10-16 (approach proposed) |
| Exact material path for planet surfaces + automatic screen pass for everything else + docs/skill/debug overlay | Proposed |
| Flat map from space: soft edge fade by default, optional glowing outline | Proposed |
| Output: HDR `RenderPipeline` with MSAA off plus a post AA pass. Not `DirectRenderPipeline` | Proposed 2026-10-16 (Runbook 050 numbers) |

## Out of scope for now

Volumetric light shafts / mountain shadows in haze, airglow and aurora, a planet lighting its own
moon (earthshine), several atmospheres overlapping on screen.
