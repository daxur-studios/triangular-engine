---
type: Plan
title: Stylized Illustrative Planet & Scene Rendering
description: TSL lighting stages, crisp Voronoi cell borders/palettes, bathymetric water ramps, chiseled geological normals, stylized foliage, and illuminated plume volumes to achieve a digital-illustration aesthetic on WebGPURenderer.
timestamp: 2026-10-17T00:00:00Z
tags: [stylized, rendering, tsl, webgpu, cell-planet, water, geology, clouds, scatter, lighting]
runbook: /docs/runbook/054_stylized_illustrative_rendering.md
---

# Plan 054: Stylized Illustrative Planet & Scene Rendering

Status: **planned** (2026-10-17).
Evidence: [Runbook 054](/docs/runbook/054_stylized_illustrative_rendering.md).

**Goal:** Enable a cohesive **Stylized Illustrative PBR** aesthetic (comparable to *Civilization VI*, *Endless Legend*, *The Witness*, and *Astroneer*) across `triangular-engine`'s planet, terrain, water, geology, cloud, and scatter sublibraries using composable TSL nodes on `WebGPURenderer`.

**Builds on:**
- [Plan 050: TSL Planet Surface Material](/docs/plans/050_tsl_planet_surface_material.md) (`PlanetSurfaceMaterial` stage & layer extension API)
- [Plan 049: Morphing Planet Atmosphere](/docs/plans/049_morphing_planet_atmosphere.md) (LUT atmosphere, Goal G2 sky objects, Goal G7 artist ramps)
- [Plan 051: Cloud Volumes](/docs/plans/051_cloud_volumes.md) (Goal G5 stylized cloud ramps, Goal G8 internal point-light plumes)
- [Runbook 040: Streamed Terrain Material Tiles](/docs/runbook/040_streamed_terrain_material_tiles.md) & [Runbook 036: Voronoi Cell Borders](/docs/runbook/036_voronoi_cell_borders_and_tactical_overlays.md)
- [Runbook 010: Geological Terrain Features](/docs/runbook/010_geological_terrain_features.md)
- [Runbook 005: Scatter Sublibrary](/docs/runbook/005_scatter_sublibrary.md)

## Ground rules

- **Composable TSL stages and opt-in presets.** Realistic and default PBR paths remain untouched; the illustrative style is delivered as opt-in TSL lighting models, surface layers, and preset profiles.
- **Shader discipline over blurry post-filters.** The painted look comes from frequency separation ("quiet cell interiors, crisp borders"), chromatic sky-tinted shadows, Half-Lambert light wrapping, faceted rock normals, and artist colour ramps—not heavy screen-space oil-paint filters that degrade UI and mechanical readability.
- **Runs on WebGPU and `forceWebGL`.** Every node uses standard TSL constructs compatible with both backends.

## Core visual pillars

| # | Pillar | Technical mechanism in `triangular-engine` |
|---|---|---|
| P1 | **Painterly Lighting & Chromatic Shadows** | Custom TSL lighting stage (`stylizedIllustrativeLighting`) for `PlanetSurfaceMaterial` and scene meshes: Half-Lambert wrapped diffuse, explicit warm key light vs. saturated cerulean/slate-blue shadow fill (never multiplying albedo by scalar zero), plus grazing Fresnel rim highlight. |
| P2 | **Crisp Voronoi Cells ("Quiet Middles, Sharp Edges")** | Surface layer on `PlanetSurfaceMaterial`: per-cell deterministic palette tinting with low-frequency interior gradients, paired with `fwidth`-stabilized distance-to-border bevels and optional close-range polygonal micro-terracing on slopes. |
| P3 | **Bathymetric Coastal Water & Shoreline Foam** | TSL water surface layer / material evaluating `waterLevel - terrainHeight` into a multi-stop colour ramp (`wet sand → bright turquoise shallows → azure → deep cobalt`) with a crisp white shoreline foam band and stylized sun glint. |
| P4 | **Chiseled Geological Facets & Crisp Snowlines** | Ridge-emphasized mountain/volcano height profiles (`010`) paired with planar/chiseled normal quantization on steep rock slopes and sharp altitude/slope colour ramps (`foothill green → faceted slate rock → snow cap`). |
| P5 | **Stylized Clumped Foliage & Ground Scatter** | TSL foliage material helper with vertical dark-base-to-warm-tip colour gradient, hemisphere-smoothed canopy normals, and cell-aware scatter clumping (`005`). |
| P6 | **Painterly Cumulus Clouds & Illuminated Plumes** | Stylized artist ramp preset for [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md) (vibrant cyan horizon aerial perspective + daytime sky-object blending) and [Plan 051](/docs/plans/051_cloud_volumes.md) (warm cream cloud tops, cool lavender undersides, and internal point-light-driven subsurface scatter for billowing exhaust plumes). |

## Phases

### Phase 1 — Stylized Lighting Stage & Atmosphere Artist Ramps
- Add `stylizedIllustrativeLighting` TSL node for `PlanetSurfaceMaterial` (Stage 4) and general `MeshStandardNodeMaterial` props/vehicles.
- Add an illustrative atmosphere preset to Plan 049's LUT generator (rich cobalt zenith, cyan horizon haze, golden sun transmittance) and verify daytime moon/planet sky-object rendering behind aerial perspective.
- **Gate:** Side-by-side comparison in `/cell-planet-tsl` showing warm sunlight, cerulean shadows, and cohesive cyan distance haze.

### Phase 2 — Crisp Voronoi Cell Layer & Bathymetric Water
- Implement `crispCellPaletteLayer` in `PlanetSurfaceMaterial`:
  - Per-cell hash colour selection from biome palettes with zero high-frequency interior noise.
  - Analytical/SDF cell border bevels with `fwidth` anti-aliasing so cell seams remain 1–2 px crisp across zoom levels.
  - Optional close-range stepped hex/polygonal terrace normal + height offset for hillside tiles.
- Implement `stylizedBathymetricWaterMaterial` with depth ramp and shoreline foam line.
- **Gate:** Close-up and mid-altitude views show razor-sharp polygonal cell borders, distinct farmland/biome cell hues, and turquoise-to-cobalt coastlines.

### Phase 3 — Chiseled Mountains, Volcanoes & Stylized Scatter
- Extend `/geological-features-lab` and `triangular-engine/terrain` with angular ridge/facet mountain and volcano profiles.
- Add `chiseledRockAndSnowLayer` TSL surface layer: derivative/Voronoi planar normal faceting on steep slopes + crisp snowline threshold.
- Add stylized foliage TSL material helper (vertical gradient + canopy normal smoothing) for pine clusters, low-poly boulders, grass tufts, and flowers.
- **Gate:** Mountains and volcanoes read as chiseled gouache/illustrative planes catching distinct warm-sun and cool-blue shadow facets.

### Phase 4 — Stylized Cloud Volumes & Lit Plume Recipe
- Tune Plan 051's stylized cloud preset (G5) and internal point-light plume volume recipe (G8) for billowing launch/landing smoke with warm golden core transmission and cool outer billows.
- **Gate:** Interactive demo scene combining stylized terrain, water, faceted peaks, clouds, and a point-light-illuminated smoke plume within frame budget.
