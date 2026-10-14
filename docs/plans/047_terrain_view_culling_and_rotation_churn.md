---
type: Plan
title: Terrain View Culling and Rotation Churn
description: Cut the cell-planet terrain work spent on terrain the camera can't see, and the per-frame streaming churn that drops the frame rate during quick camera rotations.
timestamp: 2026-10-14T12:00:00Z
tags: [terrain, lod, culling, batching, cell-planet, performance]
---

# Plan 047: Terrain View Culling and Rotation Churn

Evidence: [Runbook 047](/docs/runbook/047_terrain_view_culling_and_rotation_churn.md).

## Problem

In `/cell-planet-morph-streaming`, a quick orbit drops the frame rate from ~150 to 26–40 fps at the
same triangle count, with 190 ms–1 s worst frames. A still camera is fast, so the cost is churn:

- Selection reran on every frame of camera motion (both view tolerances were 0).
- Every patch swap called `BatchedMesh.optimize()`, which compacts the batch with `copyWithin`
  over every attribute and re-uploads the moved ranges.
- The selector's frustum test bounded each patch with an AABB padded by 2× the terrain height
  scale (≈0.2 R on the demo planet). Offline measurement found 50–77% of emitted patches outside
  the view or behind the horizon at telemetry altitudes, and ~75% near the ground, where they
  also used up the `maxPatches` budget. Every one was meshed and drawn: rendering culled nothing.

## Changes

1. `TerrainSurfaceComponent` stops compacting the batch on every swap; freed space is reclaimed
   only when an install no longer fits. With `frustumCulled=false` the batch also skips per-object
   culling and depth sorting, which only looped over infinite bounding spheres.
2. New optional `patchVisibility` input (`ITerrainSurfacePatchVisibility`): resident patches the
   camera can't see stay resident but aren't drawn, re-evaluated whenever selection runs.
3. `createCellPlanetMorphSurfaceSelector`:
   - Exact patch-versus-frustum-plane test on the globe (closed-form maximum of n·p over a
     lon/lat rectangle and radius range), blended with the flat-map box during a morph.
   - Terrain height range from measured patches (padded by H/4) instead of ±2H, overridable with
     `reliefRangeM`; the horizon occluder is the lowest terrain, so it holds without an ocean.
   - New `patchVisibility` for draw-time culling from each patch's measured geometry, with a
     2° turn margin (`drawMarginRadians`).
4. Demo page wires `patchVisibility` and sets `lodViewToleranceRadians` 0.005 / `lodPositionToleranceM` 1.
   `CellPlanetMorphStreamingViewComponent` gets an opt-in `drawCulling` input.

5. Visible-first generation: `ITerrainSurfacePatchVisibility.estimate` (optional) is the draw test run
   from an address, before meshing. `TerrainSurfaceComponent` adds a large offset to the queue
   priority of any replacement group (every selected patch over one resident's footprint, the unit
   `installCompletedPatches` swaps in) where no member may be visible, so those
   patches sort after all visible work but are still generated, keeping distance order among
   themselves. The selector's estimate uses the relief range plus every measured height and a
   conservative distance bound, so it is never stricter than `isVisible`.
6. New `maxInstallsPerFrame` input (default 0, unlimited) caps patches installed per update. Whole
   replacement groups only, so at least one group installs per call; groups with the nearest
   possibly-visible patch go first, and leftovers install on later updates (every update, even
   with a still camera, calls `installCompletedPatches`). The demo page sets 8;
   `CellPlanetMorphStreamingViewComponent` forwards it.

Meshoptimizer simplification is unchanged.

## Not done

- Incremental compaction (compaction still runs when the batch fills).
- Leaving invisible quadtree siblings unmeshed, or meshing them at lower resolution (they are now
  only generated last).
- A measured Chrome trace of the rotation drop; the ranking came from code review, an offline
  selector harness and the user's telemetry.
