---
type: Runbook
title: Morphing Planet Atmosphere
description: Findings and decisions for the new cell-planet atmosphere that follows the globe ↔ flat-map morph.
timestamp: 2026-10-16T00:00:00Z
tags: [atmosphere, scattering, sky, cell-planet, morph, rendering, performance, webgpu, tsl]
plans: [/docs/plans/049_morphing_planet_atmosphere.md]
---

# Runbook 049: Morphing Planet Atmosphere

Plan: [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md).

## 2026-10-16 — Initial investigation (cloud session, code reading only)

Nothing was built, run or measured. Findings from reading the code:

- **Morph shape.** `enablePlanetMorphProjection` (`worldgen/render/planet-morph-material.ts`) places
  each vertex at `mix(aSpherePos, flatPos, uMorph)` and its normal at `mix(aSphereNorm, +Z, uMorph)`.
  Flat positions come from equirectangular or Equal Earth, computed in the shader. Mid-morph, the
  surface is neither sphere nor plane, and there's no closed-form inverse from a world point back to
  a sphere direction. The demo's raycast handles this by marching the CPU copy of the morphed triangles.
- **Per-point sun angle is available.** `enablePlanetMorphLighting` lights the flat map with each
  point's sphere normal. `computeSunDirectionFromTime` gives a body-frame sun. So `μs` per fragment
  is intrinsic and survives the morph. The new atmosphere relies on this.
- **Earlier atmosphere work is out of scope (owner decision).** `takram/atmosphere/*` (Bruneton via
  Takram, ECEF + `postprocessing`), the finite-cylinder ray-march effect, `ICelestialBody.atmosphere.visual`
  and the commented-out sky sphere are not reused or modified. One lesson is kept as a generic
  pitfall: ground exactly at `r == bottomRadius` bands in the standard transmittance parameterization.
- **Demo render setup** (`cell-planet-morph-streaming-page.component.html`): `logarithmicDepthBuffer`,
  fixed `ambientLight` 1.2 + two `directionalLight`s, no composer. R = 600 km (`medium` tier) with
  terrain height scale ~59 km (Runbook 047), so relief is ~10% of radius.
- **Renderer.** `EngineService.initRenderer` defaults to classic `WebGLRenderer`. `WebGPURenderer` is
  opt-in via `preferredRenderer: 'webgpu'`, falling back to classic WebGL. No TSL / `NodeMaterial` is
  used anywhere. About 20 `onBeforeCompile` patches in `worldgen/` and `terrain/` make up the
  cell-planet surface, and `WebGPURenderer` ignores all of them. So a single-source TSL atmosphere
  would need the planet materials ported to TSL first.

### Decisions (proposed, waiting on owner)

- New `triangular-engine/atmosphere` entry point. New files only, additive exports.
- Technique: Hillaire-style LUTs (physical) + artist ramps (stylized) writing the same LUTs.
- Surface aerial perspective as a forward material patch, so it can read `aSphereNorm`.
- Sky objects composite through a shared `atmosphereSky(dir)` function (WebGL has no dual-source blending).
- Per-profile LUTs baked on CPU in a worker (renderer-agnostic, doubles as test reference). Per-frame
  passes as fragment passes. Froxels in a 2D atlas. This keeps both W1 (TSL only) and W2 (GLSL + TSL) open.

## 2026-10-16 — Owner decisions and follow-up findings

Decisions from the owner:

- Technique: Hillaire LUTs + stylized ramps.
- **TSL only, one version.** The cell-planet materials get an extensible TSL port first or alongside.
  The TSL material must stay as extendable as the GLSL patches were, e.g. games adding their own
  solar-eclipse shading or road layers.
- **Planet sizes:** support Kerbin-sized (600 km), ~100 km and Earth-scale planets, and small
  planets must look good.

Findings:

- `WORLD_SIZE_TIER_RADIUS_M`: mini ≈ 6.4 km, extra-small ≈ 64 km, small ≈ 191 km, medium = 600 km
  (`HOME_PLANET`), large ≈ 1,911 km, extra-large = Earth. Mini isn't selectable in-game yet.
- The agent skill game repos load is `.agent/skills/triangular-engine/SKILL.md`. User docs live in
  `projects/triangular-engine/docs/`. Both get an atmosphere section (Phase 9).
- The plan now covers: similarity scaling plus scale-free art knobs (`thickness`, `hazeAtHorizon`,
  `nearHazeFadeM`, `reliefFit`), a staged `PlanetSurfaceMaterial` with slot and building-block
  extension, automatic atmosphere coverage (screen pass + MRT mask + coverage debug overlay), and
  the flat-map edge default (soft fade, optional glow).

## 2026-10-16 — TSL material split into Plan 050

- Owner decision: the TSL planet-material port becomes its own plan,
  [Plan 050](/docs/plans/050_tsl_planet_surface_material.md), and is picked up first.
- The material design (stage table, slot API, building blocks, porting scope) moved to Plan 050
  so it lives in one place. Plan 049 now only describes what it puts into stages 3, 4 and 6.
- The old Phase 0 `WebGPURenderer` check and Phases 1 and 6 (material parts 1 and 2) moved to Plan 050.
  Plan 049's phases were renumbered: 0 = CPU foundations, 1 = presets. From Phase 2 on, it needs
  Plan 050 through its Phase 4.
- Correction to the first entry: the cell-planet path is 7 `onBeforeCompile` patches plus 3
  `ShaderMaterial`s, not "about 20" (inventory in [Runbook 050](/docs/runbook/050_tsl_planet_surface_material.md)).
- Plan 049's frontmatter gained the missing `runbook:` back-link.

## 2026-10-16 — three 0.186.1 upgrade: what it changes for this plan

- The workspace is on three 0.186.1 (`docs/upgrades/01_threejs_0.183_to_0.186.md`). The technique, the
  phases and the TSL-only decision don't change.
- r186 adds `DirectRenderPipeline`, which skips the half-float target and the output pass. Runbook 050
  measured it: it removes the MSAA surcharge but not the gap to classic. It can't bloom, so this plan stays
  on an HDR `RenderPipeline` with MSAA off plus a post AA pass. Recorded in the plan's WebGL/WebGPU
  section and as a Proposed decision.
- The WebGL2 fallback's cost is now uncertain: about classic speed on 0.183, 2-5x slower on 0.186.1 (busy
  machine). Plan 050 Phase 1 re-measures it. The plan's performance section now says G8 needs a decision if
  the slowdown holds.
- Phases 0-1 (CPU integrator, profiles, presets) don't depend on the renderer and can start now.
