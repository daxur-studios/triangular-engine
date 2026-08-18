# triangular-engine/celestial

Pure TypeScript celestial mechanics, orbital dynamics, planetary systems, and coordinate reference frames for space simulations and planet rendering.

```ts
import {
  UniversalClock,
  SUN,
  EARTH,
  keplerianToState,
  stateToKeplerian,
  propagateKeplerOrbit,
  sphereOfInfluence,
} from 'triangular-engine/celestial';
```

Import celestial APIs directly from `triangular-engine/celestial`; do not reach into internal folders.

## Features

- **Dependency-Free**: Pure mathematical modeling and physics calculations with no direct coupling to Angular, Three.js, or physics engines.
- **Math (`math/`)**: 64-bit vector (`Vec3d`) and quaternion (`Quatd`) primitives optimized for celestial coordinates and high-precision calculations.
- **Celestial Bodies (`bodies/`)**: Data models (`ICelestialBody`), standard stock bodies (Sun, Home Planet, Moons, Gas Giants), planet presets, and world size presets.
- **Surface Modeling (`surfaces/`)**: Terrain definitions (`ITerrainDef`), biome layers, procedural surface samplers, noise generators, and landing site queries.
- **Reference Frames (`frames/`)**: Planetary rotation, prime meridian tracking, axial tilt, seasonal variations, and launch site topocentric transformations.
- **Planetary Dynamics (`dynamics/`)**: Newtonian gravity models (`sphericalGravityForce`), barometric atmospheric layers (`airDensity`, `dragForce`), dynamic wind fields, and procedural galaxy/dust generators.
- **Universal Time (`time/`)**: `UniversalClock` and `UniversalTime` epoch management, time warp rates, and calendar calculations.
- **Orbital Mechanics (`orbits/`)**:
  - Keplerian orbital elements (`IKeplerianElements`) and Cartesian state vectors (`IStateVector`).
  - Robust Kepler solver supporting elliptic, parabolic, and hyperbolic orbits.
  - Orbital propagation, trajectory sampling, ephemeris calculations, and apsides analysis.
  - Sphere of Influence (SoI) boundaries and patched conic approximations.
  - Maneuver delta-v budgeting, transfer trajectory prediction, and eclipse / shadow calculations.
  - Tidal forces, Roche limit calculations, and synchronous orbit parameters.
