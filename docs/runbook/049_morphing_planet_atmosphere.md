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
