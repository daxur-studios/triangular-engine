---
type: Plan
title: Morphing Planet Atmosphere
description: A new, fast, LUT-driven atmosphere (scattering, sky, aerial perspective, sky objects, limb glow) for the cell planet in globe, flat-map and mid-morph states, from 100 km to Earth-sized planets, written once in TSL on an extensible TSL planet material.
timestamp: 2026-10-16T00:00:00Z
tags: [atmosphere, scattering, sky, cell-planet, morph, rendering, performance, webgpu, tsl]
runbook: /docs/runbook/049_morphing_planet_atmosphere.md
---

# Plan 049: Morphing Planet Atmosphere

Status: **in progress, owner: local Sonnet session.** Phases 0–1 (CPU foundations and presets) are built
and re-verified locally (2026-10-16). **Phase 2a (atmosphere on a plain sphere, `/atmosphere-lab`) is built
and waiting for a visual check**; it does not depend on Plan 050. Phase 2b onwards waits for Plan 050 Phase 4.
Evidence: [Runbook 049](/docs/runbook/049_morphing_planet_atmosphere.md).

**2026-10-18:** the morph is redesigned. The planet now bends instead of blending in a straight line, so
every in-between shape is a piece of a sphere (§Morph). Phase 3 restarts from a lab spike (3a). There is also a
day/night toggle (§Day and night).

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

### Day and night

`dayNight: 'real' | 'alwaysDay'` on the atmosphere binding, default `'real'` (decided 2026-10-18).

- **`'real'`:** each point takes its sun angle from its globe direction, `μs = dot(globe direction, sunBody)`,
  in every pose. The flat map shows the curved dawn/dusk line and a night side.
- **`'alwaysDay'`:** for games without a day/night cycle. Every point gets the same sun in its own local frame:
  elevation `alwaysDaySunElevationDeg` (default 50) from a fixed bearing relative to local north
  (`alwaysDaySunAzimuthDeg`, default 135). The lighting stage, the haze, the sky, the space view's per-sample
  sun angle and the sun disc all read it. From space the whole globe is lit, with an even rim glow.
- Prefer a uniform switch over a shader rebuild. A rebuild on toggle is acceptable if the uniform version
  costs more per pixel.

### Morph

**Decided 2026-10-18: the planet morphs by bending, not by a straight-line blend.** The reasons are in
Runbook 049, 2026-10-18 entry.

The first version moved each point in a straight line, `mix(spherePos, flatPos, morph)`. Mid-morph that
shape is not a sphere of any radius, and the map's corners swing up through the planet. Every part of the
atmosphere assumes a sphere, so each needed a stand-in (the flat-air slab, the flat-pose sky, the sky fade,
the elevation floor), and the bugs were in those stand-ins. The sky was also drawn as if the map went on
forever, so from outside the map the whole screen turned blue.

The bend keeps every in-between shape a piece of a sphere whose radius grows from R to infinity. The globe's
atmosphere maths stays exact through the whole morph; only the radius, the centre and the map's outline change.

**Shape.** Curvature `k = curve(morph) / R`, with `curve(0) = 1` and `curve(1) = 0` (start with
`1 - morph`, tune by eye). In the **map frame** (x = the projection's right, y = its up, z = its forward,
origin at the map centre) a vertex with map coordinates `(x, y)` and terrain height `height` sits at:

```
bend(x, y, k) = ( cos(k·y)·sin(k·x) / k,
                  sin(k·y) / k,
                  -(1 - cos(k·x)·cos(k·y)) / k )       // (0, 0, 0) at the map centre
normal        = ( cos(k·y)·sin(k·x), sin(k·y), cos(k·x)·cos(k·y) )
position      = T(morph) · (bend(x, y, k) + height · normal)
```

- **Precision.** Write it in forms that are exact at `k = 0` and never form `1/k`: `sin(k·x)/k = x·sinc(k·x)`,
  `1 - cos(a) = 2·sin²(a/2)`. At `k = 0` it is `(x, y, 0)`, the flat map.
- **Map coordinates** blend from the globe's to the map's: `(x, y) = mix(R·(projLon, projLat), flatXY, p(morph))`.
  At morph 0 they are `R·(lon, lat)`, so `bend` gives the exact globe (radius R, centre `(0, 0, -R)` in the map
  frame). At morph 1, `k = 0` and the vertex is today's flat map point. `p(morph)` can lead or lag `curve`
  (tune by eye); with `p = morph` the Equal Earth outline forms as the planet flattens.
- **Frame.** `T(morph)` takes the map frame to the body frame at morph 0 (rotation with columns right, up,
  forward; map centre at `R·forward`) and is the identity at morph 1. Slerp the rotation and move the offset
  smoothly; the ground-anchored camera rig keeps the view. Check this against the dynamic projection's
  tracked frame (`forward`, `right`, `up`) so morph 0 lands exactly on today's globe.
- **What you see:** the globe opens along the meridian opposite the map centre, the poles open, and it
  unrolls into the map. The map's edges always lie on the current sphere, so no corner swings up. The opening
  is the seam the flat map already cuts; the seam cull has to run from the first bend (today it starts at
  morph 0.05).
- **Where it lives:** a stage-1 option of the TSL material, `morphShape: 'bend' | 'linear'`
  ([Plan 050](/docs/plans/050_tsl_planet_surface_material.md)), with a CPU twin of `bend()` for the camera rig,
  patch bounds and specs. The GLSL materials and their demo keep the straight-line morph.

**Atmosphere on the bent planet.** At curvature `k` the ground is a sphere of radius `1/k` around
`C = T(morph)·(0, 0, -1/k)`, and the air is the shell up to `1/k + topAltitude`. Everything the globe does
applies with that radius:

- **Curvature form.** Never form `1/k`, so nothing overflows as `k → 0`. With `x` a point relative to the map
  centre in the map frame and `q = k·|x|² + 2·x.z`:
  - altitude `h = q / (1 + sqrt(1 + k·q))`;
  - up `= (k·x + (0, 0, 1)) / sqrt(1 + k·q)`;
  - a ray `x = o + t·d` meets the air's top where
    `k·t² + 2·(k·(o·d) + d.z)·t + (k·|o|² + 2·o.z - 2·H - k·H²) = 0` (`H` = top altitude). Solve it in the
    stable form; at `k = 0` it is the plane `z = H`.
- **Space view** (the reduced-resolution march) marches the bent shell. The density is multiplied by a
  **map mask**: zero outside the map's outline, with a soft falloff over `edgeSoftnessM` (default about one
  scale height). A sample's map coordinates come from its angles on the sphere, `(lon', lat') / k` (in the
  curvature form), compared with the outline of the current blended projection. A small 1D table of the
  map's half-width per row, refreshed when the morph changes, is enough. Wrapping edges of wrap-around maps
  get no mask.
- **Sky from inside the air** (the sky-view table) is rendered for the camera's altitude over the bent sphere,
  radius `1/k`; re-render when `k` changes. Fade between the space view and the sky by whether the camera is
  inside the air (on the map: low over it and inside its outline), as the globe does now.
- **Haze on surfaces** (the froxel table and stage 6) takes the spherical path with radius `1/k`. The
  closed-form slab stays as the exact `k = 0` case (morph ≥ 0.999).
- **Baked tables** (transmittance, multi-scatter, irradiance) are made for one radius and read by altitude
  and angle. On a larger sphere they are slightly off near the horizon. Expected to be invisible; if the lab
  shows it, bake 3–4 radii and blend.
- **Sun angle per point:** see §Day and night.

Once the bend is checked on the cell planet, it replaces the flat-pose sky blend, the sky's fade by morph,
`voidFade`, and the slab as the mid-morph haze. The slab's elevation floor stays until low views of the bent
map are compared with and without it.

#### Flat map seen from far above (the edge)

The map mask is the edge. It is the air's own cut edge, softened by `edgeSoftnessM`. A grazing ray crosses a
lot of air there, so the map's edge glows the way the globe's rim does, with no extra effect. Seen straight
down, the map gets a light blue tint, and there is no air where there is no map. The stylized glowing outline
stays an option for Phase 7.

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
two fetches (~0.05–0.1 ms at 1080p). The froxels are built for the current bent sphere (§Morph), so the
flat map and mid-morph are covered too.

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

Phases 0–1 don't need a GPU and can run while Plan 050 is in progress. **Phase 2a needs only
`WebGPURenderer` + TSL** (cleared by Plan 050's Phase 0 spike), not the cell-planet material: the sky, limb
glow, planet shadow and the size comparison are drawn on a plain sphere, so the atmosphere can be judged
before the material port lands. Phase 2b onwards needs Plan 050 through its Phase 4.

0. **Foundations.** CPU reference integrator + profile format + similarity scaling, with unit tests.
   *Built 2026-10-16, in `projects/triangular-engine/atmosphere/`, awaiting review.*
1. **Presets.** Earth, Mars and none presets. *Built 2026-10-16, awaiting review.*
2a. **Atmosphere on a plain sphere** (no Plan 050 dependency). *Built 2026-10-16, awaiting a visual check.*
   - `atmosphere-lab` demo (`/atmosphere-lab`): one full-screen pass draws the sky and an analytic ground
     sphere from CPU-baked tables (transmittance, multi-scatter, irradiance) read by a TSL march that mirrors
     the CPU integrator. Ground-to-space camera, dusk, sun disc, limb glow, planet shadow, aerial
     perspective on a distance-faded checker, planet sizes 64 km to Earth, Earth and Mars.
   - The per-pixel march is the *reference path*, fixed step count. The cached sky-view table is 2c.
   - **Gate (visual, by eye):** the 4-size screenshot set from the ground (noon, dusk), low orbit and space
     with the sun behind the planet; each size reads as the same atmosphere.
2b. **Atmosphere on the cell planet globe** (needs Plan 050 Phase 4). *First slice built 2026-10-16 on a `PlanetSurfaceMaterial` globe at `/atmosphere-planet` (stages, binding, sky behind the globe), awaiting a visual check; the cell-planet streaming demo and the eclipse hookup are open.*
   - Lighting stage (`atmosphereLighting()`) + stage 6 (`atmospherePerspective()`) + light sync + exposure.
   - Eclipse `sunVisibility`.
   - **Gate:** the same shots on the cell planet at `m = 0`.
2c. **Cached sky-view table + budget.** *Sky-view table built 2026-10-16; the timing gate is open.* A
   per-frame fragment pass renders the sky-view table (192x108, radiance + transmittance, re-rendered only when
   the altitude or the sun's elevation moves past a tolerance); the sky is then one fetch per pixel. The table
   matches 2a's reference march within 6% in specs. Still open: froxels (planet-scale aerial perspective for
   other objects, Phase 4's concern), and the **timing gate**: WebGPU / `forceWebGL` numbers on a real GPU
   against the ≤ 0.5 ms budget. `/atmosphere-lab` has a "sky from table / per-pixel march" toggle and a GPU
   timestamp readout for that comparison.
3. **Flat map + morph (redesigned 2026-10-18: bend morph, §Morph).** Built under the old design and kept
   until 3c replaces it: the slab haze, the flat-pose sky, the sky fade and the morph camera rig.
   - **3a. Lab spike** (*built and gate-checked 2026-10-18; findings in Runbook 049*) in `/atmosphere-lab`, no planet material:
     - a CPU `bend()` in a new pure-maths file with specs (globe at morph 0, flat map at morph 1, precision at
       tiny `k`, curvature-form altitude, up and ray hit against brute force);
     - a longitude/latitude grid mesh bent on the CPU when the morph changes;
     - the atmosphere given radius `1/k`, the centre and the map mask;
     - the `dayNight` toggle.

     **Gate (by eye, plus timing):** scrub morph 0 → 1 → 0 from space, from low orbit, and low and side-on
     over the map (the view that used to show a full-screen sky). Expect a rim glow throughout, glowing map
     edges at the end, no sky filling the screen from outside the map, no pops and nothing black. Frame time
     no worse than the globe.
   - **3b. Bend in the material and the rig:** Plan 050's stage-1 option `morphShape`, its patch bounds and
     seam cull, and `CellPlanetMorphCameraRig` on the bent ground.
   - **3c. Wire it on `/cell-planet-tsl`** and retire what §Morph lists as replaced.
   - **3d. Day/night toggle** on the page.

   **Gate:** scrub the morph at dusk with no pops, fps steady, 4-size set at `m = 1`, in both `dayNight` modes.
4. **Coverage.** Screen pass + MRT mask, `withAtmosphere()`, opt-out, coverage debug overlay.
5. **Sky objects.** Starfield, moon, sun disc and other bodies through `atmosphereSky(dir)`.
6. **Extensions demo with atmosphere.** Plan 050's `planet-material-extensions` demo (roads +
   eclipse) with the atmosphere on. Check that the eclipse darkens the sky and that roads are hazed.
7. **Stylized model + art controls.** Ramp producer, overrides, zenith-colour solver, optional stylized glowing outline around the map.
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
| Morph by bending: every in-between shape is a piece of a sphere, radius R → ∞ (§Morph). TSL material only; the GLSL materials keep the straight-line morph | **Decided** 2026-10-18 |
| Atmosphere through the whole morph, exact for the bent sphere; only the baked tables are approximate | **Decided** 2026-10-18 |
| Map edge: the air's own cut edge (soft map mask); stylized outline optional (Phase 7). Replaces "soft edge fade by default, optional glowing outline" | **Decided** 2026-10-18 |
| Day/night: real by default, `alwaysDay` toggle (§Day and night) | **Decided** 2026-10-18 |
| Output: HDR `RenderPipeline` with MSAA off plus a post AA pass. Not `DirectRenderPipeline` | Proposed 2026-10-16 (Runbook 050 numbers) |

## Out of scope for now

Volumetric light shafts / mountain shadows in haze, airglow and aurora, a planet lighting its own
moon (earthshine), several atmospheres overlapping on screen.
