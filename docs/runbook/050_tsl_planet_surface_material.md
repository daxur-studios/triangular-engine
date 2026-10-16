---
type: Runbook
title: TSL Planet Surface Material
description: Findings and decisions for porting the cell-planet surface to an extensible TSL material.
timestamp: 2026-10-16T00:00:00Z
tags: [tsl, webgpu, node-material, cell-planet, morph, terrain, materials, extensibility]
plans: [/docs/plans/050_tsl_planet_surface_material.md]
---

# Runbook 050: TSL Planet Surface Material

Plan: [Plan 050](/docs/plans/050_tsl_planet_surface_material.md). Split out of
[Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) so it can be picked up first.

## 2026-10-16 — Split from Plan 049, inventory (cloud session, code reading only)

Nothing was built, run or measured. `node_modules` was not installed, so three's TSL API was not
checked against the pinned version (`three` 0.183.2).

- **Owner decision:** do the port as its own plan, first. The material design (stages, slots,
  building blocks) moved here from Plan 049 so it lives in one place. 049 keeps only what goes into
  the lighting and atmosphere stages.
- **Patch count corrected.** The cell-planet path is 7 `onBeforeCompile` patches and 3 hand-written
  `ShaderMaterial`s, not "about 20".
  - Repo-wide there are 15 `onBeforeCompile` assignments. The other 8 are scatter, impostors, trail
    and CSM, which are not on the cell-planet path.
- **The streaming demo uses:**
  - terrain: `enableTerrainMacroVariation` (`positionSpace: 'viewM'`), `enablePlanetMorphProjection`,
    `enableCellPerPixelLookup` and `enableStreamedTerrainMaterial`, on a `MeshStandardMaterial`
    with `vertexColors`;
  - ocean: `enablePlanetMorphProjection` only;
  - plus `createPlanetBorderMorphMaterial` (cell grid) and `createPlanetMapBorderMaterial` (map frame).
- **Drop-in point exists.** `TerrainSurfaceComponent.createMaterial` and
  `CellPlanetMorphStreamingView.createMaterial` are factory inputs, so the TSL material plugs in
  without editing them. The terrain draws through one shared `BatchedMesh` material.
- **`EngineService`** already supports `preferredRenderer: 'webgpu'`. It creates a `WebGPURenderer`
  and awaits `init()` before the loop starts. Shadows are enabled there too.
- **Traps found while reading:**
  - WGSL derivative uniformity: the seam discard uses `fwidth`.
  - The macro layer's `'viewM'` mode actually samples the morphed local position.
  - Float textures need nearest filtering on WebGPU.
  - The three `ShaderMaterial`s include log-depth chunks by hand.
  - Details in the plan's §Port notes.
- **Model choice for the implementer** (owner asked): Sonnet 5.5 is recommended. Haiku 5.5 is fine
  for well-specified sub-tasks under review (a single layer port with its spec, demo boilerplate)
  but not for the slot API or the parity debugging.
