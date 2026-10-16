---
type: Plan
title: Morphing Planet Atmosphere
description: A new, fast, LUT-driven atmosphere (scattering, sky, aerial perspective, sky objects, limb glow) for the cell planet in globe, flat-map and mid-morph states, with physical and stylized models, per-planet profiles, and a WebGL/WebGPU strategy.
timestamp: 2026-10-16T00:00:00Z
tags: [atmosphere, scattering, sky, cell-planet, morph, rendering, performance, webgpu, tsl]
---

# Plan 049: Morphing Planet Atmosphere

Status: **planned, owner: unclaimed.** Written in a cloud session from code reading only;
nothing here has been built or measured yet. Evidence: [Runbook 049](/docs/runbook/049_morphing_planet_atmosphere.md).

Target: the cell planet as shown in `/cell-planet-morph-streaming`.

## Clean start

This is a **new implementation**. The earlier atmosphere work is treated as unwanted and is
neither modified, extended nor depended on:

- `takram/atmosphere/*` (Takram/Bruneton adapter, aerial perspective, sun/sky lights)
- `takram/atmosphere/takram-cylinder-atmosphere.component.ts`
- `ICelestialBody.atmosphere.visual` and the commented-out `sky-sphere.component.ts`

New code goes in new files only. Changes to existing files are limited to additive exports
(`public-api.ts`), new demo routes, and the plan/runbook indexes. The current morph-streaming demo
stays as it is; the atmosphere gets its own demo pages (Phases).

The new atmosphere **reads** these planet hooks without changing them: the morph material's
attributes and uniforms (`aSphereNorm`, `aSpherePos`, `aFlatPos`, `uMorph`, `uProjectionType`,
`uRadius`, `uMapWidth/Height`) and the body-frame sun convention from `computeSunDirectionFromTime`.

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
| G8 | Runs on WebGL and WebGPU | See §WebGL and WebGPU |

## Feasibility

**Feasible.** G1–G6 are what Hillaire's 2020 LUT sky (the model behind Unreal's SkyAtmosphere)
and Bruneton's precomputed scattering already do in shipped engines, and both cost well under a
millisecond per frame. G7 falls out if the rest of the renderer only ever reads LUTs.

The morph is the only part without a published recipe, and it is easier than it looks:

> Every scattering lookup depends only on **local** quantities: altitude `h`, view-zenith cosine
> `μ`, sun-zenith cosine `μs` and view-sun cosine `ν`. None of them needs the planet to be a
> sphere. They only need a local "up", an altitude and a sun direction at each point.

The morph material already carries all three per vertex: `aSphereNorm` (the point's up on the
globe), terrain height, and the body-frame sun angle. So on the flat map a point at local dusk gets
dusk-coloured air, and the terminator crosses the map where it should. The globe can't show that
whole picture at once, so it's something extra the flat view gives you.

Risk areas (each is a phase gate below):

- **Mid-morph sky** (no surface under the pixel): the morphed sea level has no closed-form inverse.
  It's a transition state, so a continuous, plausible blend is enough (§Morph).
- **Venus-thick atmospheres:** the multiple-scattering approximation gets worse as optical depth
  grows. Plan on an art-directed thick-haze profile plus an opaque cloud deck, not exact physics.
- **Small, exaggerated planets:** R = 600 km with ~59 km terrain relief (Runbook 047). A real-scale
  atmosphere would barely reach the mountain tops, and the horizon is close, so haze is thin.
  Profiles must scale to the game's visual scale (§Scale).
- **WebGPU parity:** depends on how the cell planet's own materials are written (§WebGL and WebGPU).

## Technique options

| | A. Bruneton precomputed (fresh implementation) | **B. Hillaire-style LUTs** | C. O'Neil per-vertex / Preetham analytic | D. Pure stylized (ramps + rim + height fog) |
|---|---|---|---|---|
| Quality | Best, multi-scatter exact, space + ground | Near-Bruneton, multi-scatter approximated | Dated. Weak dusk, no proper multi-scatter | Whatever the art is |
| Per-pixel cost | O(1) lookups everywhere | O(1) inside. From space, a short march on shell pixels only (or a limb LUT) | Very low | Very low |
| Re-bake on profile change | Heavy 4D precompute (frames to seconds) | Small 2D LUTs, ≪ 1 ms → can animate (terraforming, evolution) | n/a | n/a |
| Flat map / morph | Poor: its aerial perspective assumes one sun angle along a straight spherical ray | Yes: we own the per-frame march, so each sample takes its own local frame | Possible but hacky | Yes |
| Spatially varying sun on flat map | No | Yes (froxel samples compute their own `μs`) | Per vertex only | Yes, if ramps are indexed by `μs` |
| Effort | High | Medium–high | Low | Low |

**Recommendation: B as the core, D as a second producer behind the same LUT interface.** Skip A
(too costly to re-bake, and it doesn't fit the flat map) and C (looks dated).

## Architecture

```
AtmosphereProfile (data: radii, Rayleigh/Mie/absorption layers, phase g, sun; or stylized ramps)
        │
        ▼
AtmosphereModel ── PhysicalModel (Hillaire integration)   ──┐  same outputs
                └─ StylizedModel (artist ramps → textures)  ──┘
        │
        ▼
AtmosphereLuts  (per profile)  transmittance 256×64, multi-scatter 32×32, irradiance 64×16
                (per frame*)   sky-view 192×108, aerial-perspective froxels 32×32×32 (2D atlas)
        │                      (*skipped while camera/sun move less than a tolerance)
        ▼
Consumers (all read LUTs, never integrate):
  • surface patch        aerial perspective + sun/sky lighting on any planet material
  • sky mesh             full-screen at far depth (inside + from space)
  • atmosphereSky(dir)   shared shader function for stars, moon, sun disc, other planets, ocean reflection
  • sun/sky light sync   DirectionalLight colour = sun × transmittance at the focus point
```

New secondary entry point `triangular-engine/atmosphere`, three-only core plus thin Angular
components, following Runbook 024's sublibrary boundaries. The morph-specific glue
(`enablePlanetMorphAtmosphere`) is a new file in `worldgen/render` that reads the morph attributes.

### Surface: forward material patch, not a post-process

Aerial perspective is applied in each surface material (one atlas/3D fetch plus a few ALU ops per
fragment), not as a screen-space effect, because:

1. It sees per-vertex `aSphereNorm`, which is the only exact source of local up and `μs` mid-morph
   and on the flat map. A post-process only has depth, and there's no inverse morph.
2. The demo uses a logarithmic depth buffer and no composer.
3. It works the same on terrain, ocean, grid, clouds and props, and it keeps MSAA.

### Sky and sky objects

- One full-screen sky mesh at far depth. Inside the atmosphere: one sky-view LUT fetch. From
  space: shell-intersection test, then a 16–32-step march on the pixels that hit the shell only
  (limb, and the far side of the terminator). Optional later: a camera-independent "limb LUT"
  (closest-approach altitude × `μs` × `ν`) makes the space view O(1) too.
- WebGL has no dual-source blending, so per-channel transmittance can't come from the blend
  state. Every sky object's shader calls `atmosphereSky(dir) → {inscatter, transmittance}`:
  - stars: additive, `star × T`, drawn after the sky. Daytime washout comes from exposure (physical)
    or an explicit luminance fade (stylized).
  - moon / planets / sun disc: opaque, `colour × T + inscatter`, so they replace the sky exactly.
- Limb glow (G6) needs nothing extra: Mie forward scattering (g ≈ 0.76–0.8) along the long limb
  paths, evaluated from space, plus the planet's own shadow from the transmittance LUT returning 0
  below the horizon. The thing to get right is HDR headroom plus bloom.

### Lighting coupling (needed for G5)

Without this, dusk looks wrong: an orange sky over white-lit terrain.

- Planet surface shading: `albedo × (sunIrradiance × T(h, μs) × N·L + skyIrradiance(h, μs))` in a
  **new** lighting patch, used instead of the existing day/night patch on atmosphere-enabled
  materials. On the flat map `μs` varies per point, so a single `DirectionalLight` can't express it.
- A sun/sky light sync tints scene lights for everything else (props, creatures) from the LUTs at
  the focus point. Atmosphere demos use this instead of fixed ambient + directional lights.
- Exposure: a physical sky needs an exposure curve (altitude/sun-elevation driven, or eye
  adaptation) on top of ACES. Stylized mode sidesteps this.

### Morph

Per surface fragment, blend the inputs, not the colours:

```
up   = normalize(mix(aSphereNorm, +Z, uMorph))       // matches the morphed sea-level normal
h    = terrain height                                  // intrinsic, morph-invariant
μs   = dot(aSphereNorm, sunBody)                       // intrinsic
path = actual world camera→fragment distance           // what the viewer actually looks through
```

- **Globe (m = 0):** standard spherical shell.
- **Flat map (m = 1):** a slab of thickness `topAltitude` over the map, clipped to the map outline
  (rectangle for equirect, the Equal Earth outline otherwise). Sky-view and froxel marches use the
  camera's local frame. Each froxel sample works out its own `μs` from the inverse projection of its
  map x/y, so haze far across the map can be at dusk while the camera is at noon. The sky-view LUT
  keeps the true R, so the horizon looks right near the ground.
- **Mid-morph:** evaluate the camera's sky for its sphere pose and its flat pose (the morph camera
  already interpolates the two) and crossfade by `uMorph`. That's two sky-view evaluations, only
  while morphing. Surfaces use the input blend above. The check is no pops and nothing going black.

### Scale

Optical depth is σ × path length, and a 600 km planet has short horizons. A profile has **visual**
knobs that rescale the physics:

- `atmosphereHeight` relative to the terrain height scale (mountains should sit inside the air), and
- `hazeAtHorizon` (target transmittance at the horizon from the surface), which solves for σ.

Known LUT pitfall: rendered ground exactly at `r == bottomRadius` hits a degenerate edge of the
standard transmittance parameterization and bands. Keep a small ground offset, or clamp.

### Profiles (G3)

| Preset | Key traits | Notes |
|---|---|---|
| Earth | Rayleigh-dominant, light Mie, ozone layer (gives the deep blue zenith at dusk) | Reference values from Bruneton/Hillaire |
| Mars | Thin, dust Mie-dominant with rgb-varying coefficients, ochre day sky, **blue sunset** from forward-peaked dust | Fits the model |
| Venus | Very thick, yellow-white, dim orange surface | Thick-haze stylized profile + opaque cloud deck. Physics only approximate |
| Titan | Thick orange haze | Stretch preset |
| Gas giant | No surface: the "ground" is a cloud-deck sphere with a banded material, large scale height | Mostly a profile plus a surface material |
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

## WebGL and WebGPU

**Can one version work on both? Yes, but only through `WebGPURenderer`.** Three's TSL (node
materials) compiles to WGSL on WebGPU and to GLSL on `WebGPURenderer`'s built-in WebGL2 fallback.
So one TSL implementation runs on both GPU APIs.

The catch is the renderer, not the GPU API:

- The engine defaults to the classic `WebGLRenderer` (`preferredRenderer: 'webgl'`). WebGPU is opt-in.
- TSL node materials don't run on the classic `WebGLRenderer`. `WebGPURenderer` ignores
  `onBeforeCompile`, and the cell planet's materials (morph projection, macro variation, per-pixel
  cell lookup, streamed material tiles) are about 20 GLSL `onBeforeCompile` patches. No TSL exists
  in the repo yet.

So the atmosphere alone can't be both. It has to match whatever the planet surface is written in,
because the surface patch is injected into the planet's own material.

| | W1. TSL only, single source | W2. Shared core + two thin shader backends |
|---|---|---|
| Runs on | `WebGPURenderer` with WebGPU, falling back to WebGL2 | Classic `WebGLRenderer` (GLSL) and `WebGPURenderer` (TSL) |
| Code duplication | None | GPU passes written twice (~400–600 lines each). Profiles, scheduling, solving and CPU-baked LUTs shared |
| Prerequisite | Port the cell-planet materials to TSL `NodeMaterial`s (a separate plan) | None. GLSL backend works with today's planet |
| Risk | Bigger scope. WebGL2 fallback of `WebGPURenderer` has fewer features (buffer-only compute) and is somewhat slower than classic `WebGLRenderer` | Two backends drift unless tested against a shared reference |

Design choices that keep either path open:

- **Bake per-profile LUTs on the CPU in a worker** (transmittance, multi-scatter, irradiance, a few
  ms to tens of ms, only on profile change) and upload them as `DataTexture`s. That part is
  renderer-agnostic and doubles as the **reference integrator** for unit tests.
- **Per-frame passes are fragment (render-to-texture) passes, not compute.** They work on WebGL2,
  WebGPU and the WebGL2 fallback alike.
- **Froxels in a 2D atlas** (32 slices tiled), not a 3D render target, so they work everywhere.
- All shader math lives in one module per backend, mirroring the CPU reference function by function.
  Both backends are tested by rendering a LUT, reading it back, and comparing to the CPU reference.

**Recommendation:** decide based on where the cell planet is heading.
If it moves to WebGPU soon, go **W1** and do the planet TSL port first (or alongside). Otherwise
go **W2** with the GLSL backend first, then add the TSL backend when the planet port happens. The
CPU core, profiles and tests carry over unchanged either way.

## Performance budget (G4)

Target: **≤ 0.5 ms at 1080p on a mid-range GPU from any camera position**, with cost flat across
altitudes. To be measured; the Hillaire paper reports sub-millisecond totals on console-class GPUs.

| Pass | When | Expected cost |
|---|---|---|
| Transmittance + multi-scatter + irradiance LUTs | Profile change only, CPU worker | 0 GPU ms; one upload |
| Sky-view LUT 192×108, ~30 samples | Per frame, skipped under a camera/sun tolerance | ~0.05 ms |
| Froxels 32×32×32 atlas | Per frame, same tolerance | ~0.05–0.1 ms |
| Sky mesh | Per pixel, 1–2 fetches | tiny |
| Surface patch | Per fragment, 1 fetch + ALU | tiny |
| Space limb march | Shell pixels only, half-res option | Scales with how much of the screen the planet covers. Bounded by the limb LUT if needed |

Quality tiers change LUT sizes, march steps and sky resolution only. No tier ever ray-marches per
pixel inside the atmosphere. Add an `atmosphere` telemetry section (Plan 048).

## Phases

Each phase ends with a visible check in a demo plus a timing number.

0. **Decide W1 vs W2** (§WebGL and WebGPU). **CPU reference integrator + profiles** (Earth, Mars,
   none), with unit tests against published reference values.
1. **`atmosphere-lab` demo, globe only.** LUT pipeline, sky mesh, camera from ground to space,
   limb glow, planet shadow. Measure per-pass GPU time. **Gate:** fits the budget, sun-behind-planet
   shot looks right.
2. **Surface + lighting on the globe.** Surface patch, new lighting patch, sun/sky light sync,
   exposure curve. New demo page `cell-planet-atmosphere` using the shared cell-planet pipeline, at
   `m = 0`. Dusk shots from the ground and from orbit.
3. **Flat map + morph.** Slab geometry, per-sample `μs` froxels, map-outline clip, mid-morph blend,
   `enablePlanetMorphAtmosphere`. **Gate:** scrub the morph at dusk with no pops; check fps during the morph.
4. **Sky objects.** Starfield, moon, sun disc and other bodies through `atmosphereSky(dir)`. Stars
   wash out by day and show at night. Moon tinted near the horizon.
5. **Stylized model + art controls.** Ramp producer, overrides, zenith-colour solver.
6. **More profiles + scale controls.** Venus, gas giant, Titan, `hazeAtHorizon` / relative height,
   per-`WorldProfileKind` defaults, animated-profile demo.
7. **Integration polish.** Ocean sky reflection (`atmosphereSky(reflect(...))`), clouds take aerial
   perspective and transmitted sun, quality tiers, visual-regression shots (Plans 037/038).
8. **Second backend** (W2 only), tested against the same CPU reference.

## Easy to miss

- **Lighting has to come from the atmosphere** (sun colour, sky ambient, per-point terminator),
  or dusk never looks right however good the sky is.
- **Visual scale vs real scale:** the 600 km planet with ~59 km relief needs profiles tuned in
  game units (§Scale).
- **HDR + exposure + bloom:** limb glow, sun disc and starlight at night all depend on these.
- **Ocean reflection** of the sky is most of what makes water look right at dusk.
- **Clouds** must take aerial perspective and transmitted (orange) sunlight, or they glow white
  at sunset.
- **Night side:** moonlight, star visibility, maybe emissive city/biolume lights. Decide whether the
  moon lights the atmosphere.
- **Flat-map edges:** the air needs a defined end at the map outline, and wrap-around if the map scrolls horizontally.
- **Precision:** compute camera-relative in shaders; planet-scale absolute positions lose float precision.
- **Several bodies:** only one "inside" atmosphere at a time. Other planets and moons use the space path.

## Open decisions (owner to confirm before Phase 1)

1. **W1 (TSL only, needs planet TSL port) vs W2 (GLSL first, TSL later).**
2. **Technique B (Hillaire) + D (stylized).** Recommended.
3. **Forward material patch for aerial perspective.** Recommended.
4. **Flat-map look from space:** physically correct slab haze, or a stylized edge glow.
   Recommended: slab, with optional edge rim in stylized mode.

## Out of scope for now

Volumetric light shafts / mountain shadows in haze, airglow and aurora, a planet lighting its own
moon (earthshine), several atmospheres overlapping on screen.
