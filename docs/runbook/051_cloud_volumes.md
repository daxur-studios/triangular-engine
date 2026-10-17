---
type: Runbook
title: Cloud Volumes
description: Findings, decisions and timings for fast flyable 3D clouds on WebGPURenderer.
timestamp: 2026-10-17T00:00:00Z
tags: [clouds, volumetric, raymarching, atmosphere, tsl, webgpu, performance, stylized]
plans: [/docs/plans/051_cloud_volumes.md]
---

# Runbook 051: Cloud Volumes

Plan: [Plan 051](/docs/plans/051_cloud_volumes.md).

## 2026-10-17 — Plan written (cloud session, code reading only)

Nothing was built, run or measured.

- **Owner's ask:** performant clouds in the same spirit as the atmosphere. Stylized and 3D, so you can fly into
  them and they take the atmosphere's light. Nice to have: any 3D shape ("a ship made of cloud") and dynamic shapes
  (noise, a particle simulation). Target: stay around 160 fps.
- **Frame-rate caution:** the atmosphere pages read 160-165 fps, and so does `?atmosphere=0`. That is most likely
  the monitor's refresh cap, so the real headroom is unknown. The plan's gates use GPU timestamps
  (`/atmosphere-lab` already reads them inline).
- **Options compared** (2D shell, instanced puffs, bounded volumes, whole-planet raymarch, Gaussian splats);
  table and estimated costs in the plan. **Owner chose** bounded volumes plus a 2D shell for the far view,
  with puffs as the fallback.
- **Why bounded volumes can be fast:** the lighting inside a volume and its distance field are baked into 3D
  textures and rebuilt only on change, the same idea as the atmosphere's tables.
  - A march step is two texture reads.
  - Empty space is skipped.
  - Only pixels covered by a box pay anything.
  - A dense cloud ends the march early.
- **Atmosphere hooks found** in `atmosphere/`:
  - `AtmosphereGpuModel.sunTransmittance(s, r, muSun)` and `skyIrradiance(alt, muSun)`;
  - `AtmosphereAerialPerspectiveLut.lookup(ndc, distance, dirView)`;
  - `PlanetSurfaceMaterial.addSunOcclusion` in `planet-material/` for ground shadows.
- **Risk to settle first (Phase 1):** compute shaders and storage textures do not exist on the WebGL2 fallback.
  The atmosphere writes its tables with fragment passes into render targets. The plan defaults to the same for the
  cloud bakes.
- `triangular-engine/clouds` already exists (the mesh puffs, Runbook 023), so the new entry point is
  `triangular-engine/cloud-volumes`. Earlier cloud work (Runbooks 001, 023, 025) stays as history and is not edited.
