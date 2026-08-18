# 019 — CDLOD Planetary Terrain & Celestial Library Migration

## Status

- State: Migrated and integrated into `triangular-engine`
- Target entry points: `triangular-engine/terrain` (CDLOD system) & `triangular-engine/celestial` (Astrodynamics & planet definitions)
- Date: 2026-08-18

## Objective

Establish `triangular-engine` as the single source of truth for high-performance 3D planetary rendering and astrodynamics by migrating:
1. The **CDLOD (Continuous Distance-Dependent Level of Detail)** terrain rendering pipeline from Bruno's Space Program into `triangular-engine/terrain`.
2. The complete **`celestial` library** (Keplerian orbits, gravitational/atmospheric dynamics, planetary body presets, and procedural noise samplers) into `triangular-engine/celestial`.

## Architecture & Subsystems

### 1. `triangular-engine/celestial` (Dependency-Free Astrodynamics)
- **Math (`math/`)**: 64-bit vector (`Vec3d`) and quaternion (`Quatd`) primitives.
- **Bodies (`bodies/`)**: `ICelestialBody` data model, stock celestial bodies (`SUN`, `HOME_PLANET`, `EARTH`, `MARS`, `MOON`), planet presets, and world size presets.
- **Dynamics (`dynamics/`)**: Newtonian gravity (`sphericalGravityForce`), barometric atmospheric drag/density (`airDensity`, `dragForce`), and wind fields.
- **Orbits (`orbits/`)**: Kepler solver, state elements conversion, ephemeris propagation, sphere of influence (SoI), and maneuver calculations.
- **Surfaces (`surfaces/`)**: Procedural surface definitions (`ITerrainDef`), noise generators, and landing site queries.
- **Time (`time/`)**: `UniversalClock` epoch and time warp manager.

### 2. CDLOD Planetary Pipeline (`triangular-engine/terrain/cdlod/`)
- **`cdlod-quadtree.ts`**: Screen-space error selection with 2:1 neighbor level balancing, feature-adaptive relief weighting, and horizon/frustum culling.
- **`cdlod-patch-mesher.ts`**: Grid-patch synthesis producing `position`, `coarsePosition`, `normal`, and `elevation` attributes for zero-crack geomorphing.
- **`cdlod-materials.ts`**: Custom GPU shaders (`CDLOD_VERTEX_SHADER`, `CDLOD_FRAGMENT_SHADER`, `OCEAN_VERTEX_SHADER`, `OCEAN_FRAGMENT_SHADER`) executing smooth vertex geomorphing, slope-dependent cliff texturing, and ocean Fresnel reflections.
- **`cdlod-motion-prediction.ts`**: Trajectory look-ahead forecasting for supersonic aircraft and curved Keplerian orbits.
- **`cdlod-worker-pool.ts` / `cdlod-patch.worker.ts`**: Multithreaded 0-copy transferable typed array buffer generation.
- **`cdlod-planet.component.ts`**: Declarative `<cdlodPlanet>` Angular component managing Three.js scene graph residency and telemetry.

## Verification

- `triangular-engine/celestial`: 52/52 tests passing.
- `triangular-engine/terrain/cdlod`: 7/7 tests passing (selection, 2:1 balance, geometry synthesis, shaders, linear/curved motion prediction).
- Total engine test suite: 560/560 specs passing.
- Interactive demo: Added `/cdlod-planet-lab` to `demo-app`.
