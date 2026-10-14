---
type: Plan
title: Shared Cell-Planet Worker Pipeline and Worldgen Extraction
description: Extract canonical worldgen building and worker message handlers into triangular-engine so demo app and external games (BSP) share identical cratering, seamless normals, and material baking without duplicate worker code.
timestamp: 2026-10-14T00:15:00Z
tags: [worldgen, terrain, worker, pipeline, cell-planet, cdlod]
---

# Plan 046: Shared Cell-Planet Worker Pipeline and Worldgen Extraction

## Context and Goal

Currently, the logic for generating continuous Voronoi cell planet terrain patches (dual-space sphere/flat meshes, seamless 1-ring normals, multi-scale impact craters, edge conforming, and Meshoptimizer simplification) and baking material tiles is duplicated across demo pages and consuming games like `brunos-space-program` (BSP). This causes drift where improvements (such as multi-scale crater generation and seamless boundary normal calculations) work in the demo app but fail to appear in BSP.

Following the established CDLOD pattern (`handleCdlodWorkerMessage`), we extract the core world building and worker message handlers into `triangular-engine` (specifically framework-free entries under `worldgen` and `worldgen/render/core`). Consuming applications retain thin ~15-line worker entrypoints while inheriting all features, optimizations, and bug fixes automatically.

## Proposed Changes

1. **Extract Canonical World Builder**:
   - Create `projects/triangular-engine/worldgen/core/cell-planet-world.ts` exporting `buildCellPlanetWorld()` and `ICellPlanetWorldParams`.
   - Incorporates tectonics, `generateImpactCraters` (when `profile.impactCraters` is defined), ecology with crater biomes, and `createPlanetSurfaceSampler`.
   - Export from `triangular-engine/worldgen`.

2. **Extract Worker Message Handlers**:
   - Create `projects/triangular-engine/worldgen/render/core/cell-planet-worker-pipeline.ts`.
   - Provides:
     - `CellPlanetWorldCache`: caches built worlds by profile and seed.
     - `handleCellPlanetMeshWorkerRequest()`: handles LOD patch requests with 1-ring seamless central-difference normals, dual-space coordinates, archetype coloring, and `conformPatchEdges`.
     - `handleCellPlanetMaterialTileRequest()`: handles material tile baking with archetype palettes and slope cache.
     - `handleCellPlanetWorkerMessage()`: unified message dispatcher matching the CDLOD worker pattern.
   - Export from `triangular-engine/worldgen/render/core`.

3. **Refactor Demo Worker**:
   - Refactor `projects/demo-app/src/app/pages/cell-planet-morph-streaming/cell-planet-morph-streaming.worker.ts` into a thin delegator using `handleCellPlanetWorkerMessage()`.

4. **Verification**:
   - Unit tests covering `handleCellPlanetWorkerMessage` in headless Jasmine tests.
   - Verify `cell-planet-morph-streaming` demo page runs with identical visual fidelity and performance.
   - Run all engine and demo test suites.
