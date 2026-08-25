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

## Continents and coastal base placement

Use a `continental-3d` terrain generator as the signed, low-frequency first
layer in an ocean planet. It maps one coherent noise field to negative ocean
basins and positive continental shelves; higher-frequency biome generators can
then use a matching `noise-mask-3d` so mountains and surface detail only lift
land instead of creating scattered islands throughout the ocean.

`coastalSitesFor` performs a deterministic two-stage search. It first samples
only evenly distributed centre elevations, then checks pad slope and nearby
water rings for the much smaller above-sea shortlist. Each result includes a
buildable flatten definition plus directions toward the exact sea-level
crossing and navigable water:

```ts
import { HOME_PLANET, coastalSitesFor } from 'triangular-engine/celestial';

const [base] = coastalSitesFor(HOME_PLANET, {
  count: 1,
  radiusM: 300,
  maxSlopeRadians: (8 * Math.PI) / 180,
  minElevationAboveSeaM: 15,
  maxElevationAboveSeaM: 250,
  waterSearchRadiusM: 6_000,
  maxShoreDistanceM: 3_000,
  maxShallowWaterWidthM: 1_500,
  minWaterDepthM: 20,
});

// Build on base.def.directionBodyFixed, grade with base.def,
// and orient the port toward base.shoreDirectionBodyFixed /
// base.waterDirectionBodyFixed.
```

`maxShallowWaterWidthM` prevents the search from selecting a long, shallow
beach as a port approach. It measures from the refined shoreline to the first
sample that reaches `minWaterDepthM`, while `maxShoreDistanceM` keeps the base
itself close to that shore.

The stock `HOME_PLANET` uses this continental model and targets approximately
70% ocean coverage. `HOME_BASE_COASTAL_ACCESS` records its authored base,
shore, navigable-water directions, and shallow-water width so normal startup
does not repeat the search.
