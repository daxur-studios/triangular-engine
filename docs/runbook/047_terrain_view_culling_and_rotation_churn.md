---
type: Runbook
title: Terrain View Culling and Rotation Churn
description: Evidence for the cell-planet terrain view-culling and rotation-churn changes.
timestamp: 2026-10-14T12:00:00Z
tags: [terrain, lod, culling, batching, cell-planet, performance]
---

# Runbook 047: Terrain View Culling and Rotation Churn

Plan: [Plan 047](/docs/plans/047_terrain_view_culling_and_rotation_churn.md).

## Measurements before the change

Offline Node harness over the real selector (demo setup: R = 600 km, `LatLonTerrainDomain(R, 4, 2)`,
H = 58.9 km, fov 50, aspect 1707/872, ultra preset). "Truly visible" = a dense surface sample inside
the exact frustum and not hidden by the sea-level sphere.

| View | Leaves | Truly visible | Triangles invisible |
|---|---|---|---|
| 0.3 R, looking at centre | 170 | 39 | 77% |
| 0.02 R, pitch 15° | 218 (cap) | 56 | 75% |
| Telemetry camera A (257 km), centre | 161 | 57 | 65% |
| Telemetry camera A, grazing | 104 | 53 | 49% |

The 2H relief pad dominated; the frustum safety factor barely mattered (1.35 → 1.0 changed 170 → 164
leaves). A selector using the exact test reached 94 truly visible leaves instead of 56 at 0.02 R.

Code review: `installCompletedPatches` and `pruneCoveredStaleResidents` called
`BatchedMesh.optimize()` after any batched removal. three's `addGeometry` always appends at the end
of the buffer, so compaction is only needed when space runs out, which `ensureBatchedGeometrySpace`
already handles.

## Verification

- `npm run build:triangular-engine` passes.
- `ng test triangular-engine` over `../worldgen/render/**` and `../terrain/**`: 288/288. New specs:
  exact/conservative plane distance against sampled terrain at morph 0, 0.3 and 1; selector draw
  visibility (ahead drawn, behind and far side hidden, everything drawn with culling off);
  `TerrainSurfaceComponent` applying `patchVisibility` to batched instances and re-evaluating on
  reselection without re-measuring. The existing cone test now looks down at the ground: looking
  level from 0.1 R, the frustum contains only sky, which the old loose boxes hid.
- Demo, high preset, telemetry camera A: 80 of 140 resident patches drawn (174k of 286k
  triangles), no holes, no console errors.
