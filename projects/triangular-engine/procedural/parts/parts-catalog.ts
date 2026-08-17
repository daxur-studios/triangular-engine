import type { IPartArchetype } from './parts-archetype';

export const PART_AIRCRAFT_WING_COLORS = {
  skinHex: '#e2e8f0', // smooth aeronautical light grey
  leadingEdgeHex: '#64748b', // titanium leading edge
  flapHex: '#2563eb', // vivid cobalt blue control surface
  mountHex: '#1e293b', // dark carbon root collar
  hardpointHex: '#334155', // pylon mount
  wingletHex: '#0284c7', // sky blue winglet
};

export const PART_ROCKET_LEG_COLORS = {
  mountHex: '#1e293b', // heavy structural dark steel
  strutHex: '#475569', // titanium arm housing
  pistonHex: '#cbd5e1', // bright chrome hydraulic piston
  footHex: '#0f172a', // composite landing foot
  accentHex: '#f59e0b', // amber hinge pin
};

export const PART_ROCKET_ENGINE_COLORS = {
  mountHex: '#334155', // structural mount dome
  machineryHex: '#475569', // turbopump machinery
  pipeHex: '#94a3b8', // propellant feed lines
  chamberHex: '#78350f', // heat-resistant combustion chamber
  nozzleHex: '#0f172a', // carbon-carbon bell nozzle
  lipHex: '#f59e0b', // gold/amber exit lip ring
};

export const PART_ROCKET_FUEL_TANK_COLORS = {
  tankSkinHex: '#f8fafc', // clean white cryogenic insulation
  collarHex: '#334155', // dark slate structural stage collars
  conduitHex: '#64748b', // grey raceway conduit
  domeHex: '#cbd5e1', // titanium dome bulkheads
  stripeHex: '#ef4444', // red roll-control marking stripe
};

/**
 * 1. Clean Modular Aircraft Wing with Flush Trailing-Edge Control Flap
 *
 * Coordinate convention:
 * - Span: X from 0 (fuselage root) to 2.36m (wingtip)
 * - Chord: Z from -0.6m (trailing edge) to +0.72m (leading edge slat)
 * - Thickness: Y from -0.04m to +0.04m (0.08m profile)
 */
export const PART_AIRCRAFT_WING_ARCHETYPE: IPartArchetype = {
  schemaVersion: 1,
  id: 'part-aircraft-wing',
  name: 'Modular Swept Wing (Flap Articulated)',
  solids: [
    // Fuselage Mount Collar (X: 0 -> 0.1, Z: -0.6 -> +0.6)
    {
      id: 'root-collar',
      shape: 'box',
      positionM: [0.05, 0, 0],
      dimensionsM: [0.1, 0.12, 1.2],
      linkId: 0,
      materialHex: PART_AIRCRAFT_WING_COLORS.mountHex,
      collidable: true,
    },
    // Inboard Forward Wing Panel (X: 0.1 -> 1.3, Z: -0.15 -> +0.6)
    {
      id: 'inboard-wing-panel',
      shape: 'box',
      positionM: [0.7, 0, 0.225],
      dimensionsM: [1.2, 0.08, 0.75],
      linkId: 0,
      materialHex: PART_AIRCRAFT_WING_COLORS.skinHex,
      collidable: true,
    },
    // Inboard Trailing Flap (X: 0.15 -> 1.25, Z: -0.6 -> -0.15)
    // Nests flush into the inboard wing cutout!
    {
      id: 'trailing-edge-flap',
      shape: 'box',
      positionM: [0.7, 0, -0.375],
      dimensionsM: [1.1, 0.07, 0.45],
      linkId: 1,
      materialHex: PART_AIRCRAFT_WING_COLORS.flapHex,
      collidable: true,
    },
    // Outboard Wing Panel (X: 1.3 -> 2.3, Z: -0.4 -> +0.6)
    {
      id: 'outboard-wing-panel',
      shape: 'box',
      positionM: [1.8, 0.01, 0.1],
      dimensionsM: [1.0, 0.06, 1.0],
      linkId: 0,
      materialHex: PART_AIRCRAFT_WING_COLORS.skinHex,
      collidable: true,
    },
    // Aerodynamic Leading Edge Slat (X: 0.1 -> 2.3, Z: +0.6 -> +0.72)
    {
      id: 'leading-edge-slat',
      shape: 'box',
      positionM: [1.2, 0, 0.66],
      dimensionsM: [2.2, 0.06, 0.12],
      linkId: 0,
      materialHex: PART_AIRCRAFT_WING_COLORS.leadingEdgeHex,
      collidable: true,
    },
    // Wingtip Winglet (X: 2.3 -> 2.36, Z: -0.42 -> +0.68, Y: -0.05 -> +0.35)
    {
      id: 'wingtip-winglet',
      shape: 'box',
      positionM: [2.33, 0.15, 0.13],
      dimensionsM: [0.06, 0.4, 1.1],
      linkId: 0,
      materialHex: PART_AIRCRAFT_WING_COLORS.wingletHex,
      collidable: true,
    },
    // Underwing Hardpoint Pylon (X: 1.25 -> 1.35, Y: -0.16 -> -0.04)
    {
      id: 'underwing-pylon',
      shape: 'box',
      positionM: [1.3, -0.1, 0.1],
      dimensionsM: [0.1, 0.12, 0.4],
      linkId: 0,
      materialHex: PART_AIRCRAFT_WING_COLORS.hardpointHex,
      collidable: true,
    },
  ],
  sockets: [
    {
      kind: 'attach',
      role: 'radial',
      solidId: 'root-collar',
      offsetM: [-0.05, 0, 0],
      primaryDirection: [-1, 0, 0],
    },
    {
      kind: 'lift',
      role: 'custom',
      solidId: 'inboard-wing-panel',
      offsetM: [0.3, 0.04, 0.1],
      primaryDirection: [0, 1, 0],
    },
    {
      kind: 'attach',
      role: 'radial',
      solidId: 'underwing-pylon',
      offsetM: [0, -0.06, 0],
      primaryDirection: [0, -1, 0],
    },
  ],
  joint: {
    anchorM: [0.7, 0, -0.15], // exact flush seam along trailing edge
    axis: [1, 0, 0], // pitch hinge axis
    rangeRad: [-0.44, 0.44], // -25 deg to +25 deg
    restRad: 0,
  },
};

/**
 * 2. Deployable & Telescoping Rocket Landing Leg
 */
export const PART_ROCKET_LANDING_LEG_ARCHETYPE: IPartArchetype = {
  schemaVersion: 1,
  id: 'part-rocket-landing-leg',
  name: 'Deployable & Telescoping Landing Leg',
  solids: [
    // Rocket Hull Mount Plate
    {
      id: 'hull-mount-plate',
      shape: 'box',
      positionM: [0, 0, -0.06],
      dimensionsM: [0.34, 0.48, 0.12],
      linkId: 0,
      materialHex: PART_ROCKET_LEG_COLORS.mountHex,
      collidable: true,
    },
    // Top Hinge Pin
    {
      id: 'hinge-lug-pin',
      shape: 'cylinder',
      positionM: [0, 0.05, 0.05],
      dimensionsM: [0.055, 0.36],
      orientation: [0.7071, 0, 0, 0.7071], // X-axis aligned
      linkId: 0,
      materialHex: PART_ROCKET_LEG_COLORS.accentHex,
      collidable: true,
    },
    // Hydraulic Actuator Body
    {
      id: 'hydraulic-actuator-body',
      shape: 'cylinder',
      positionM: [0, 0.18, 0.08],
      dimensionsM: [0.045, 0.28],
      linkId: 0,
      materialHex: PART_ROCKET_LEG_COLORS.mountHex,
      collidable: true,
    },
    // Upper Swing Housing Strut (Y: 0 -> -1.3)
    {
      id: 'upper-swing-housing',
      shape: 'cylinder',
      positionM: [0, -0.65, 0.05],
      dimensionsM: [0.075, 1.3],
      linkId: 1,
      materialHex: PART_ROCKET_LEG_COLORS.strutHex,
      collidable: true,
    },
    // Lower Telescoping Hydraulic Piston (Y: -0.85 -> -1.65)
    {
      id: 'lower-telescoping-piston',
      shape: 'cylinder',
      positionM: [0, -1.25, 0.05],
      dimensionsM: [0.048, 0.8],
      linkId: 2,
      materialHex: PART_ROCKET_LEG_COLORS.pistonHex,
      collidable: true,
    },
    // Articulated Landing Foot Pad (Y: -1.61 -> -1.69)
    {
      id: 'foot-pad-assembly',
      shape: 'cylinder',
      positionM: [0, -1.65, 0.05],
      dimensionsM: [0.22, 0.08],
      linkId: 2,
      materialHex: PART_ROCKET_LEG_COLORS.footHex,
      collidable: true,
    },
  ],
  sockets: [
    {
      kind: 'attach',
      role: 'radial',
      solidId: 'hull-mount-plate',
      offsetM: [0, 0, -0.06],
      primaryDirection: [0, 0, -1],
    },
    {
      kind: 'pivot',
      role: 'custom',
      solidId: 'hinge-lug-pin',
      offsetM: [0, 0, 0],
      primaryDirection: [0, 1, 0],
    },
    {
      kind: 'foot',
      role: 'custom',
      solidId: 'foot-pad-assembly',
      offsetM: [0, -0.04, 0],
      primaryDirection: [0, -1, 0],
    },
  ],
  joint: {
    anchorM: [0, 0.05, 0.05],
    axis: [-1, 0, 0], // swings outward around -X
    rangeRad: [0, 1.15], // 0 to 66 deg
    restRad: 0,
    extensionM: 0.65, // 0.65m telescoping stroke
    extensionAxis: [0, -1, 0],
  },
};

/**
 * 3. Gimbaling Liquid Rocket Engine
 */
export const PART_ROCKET_ENGINE_ARCHETYPE: IPartArchetype = {
  schemaVersion: 1,
  id: 'part-rocket-engine',
  name: 'Gimbaling Liquid Rocket Engine',
  solids: [
    // Top Gimbal Mount Dome
    {
      id: 'gimbal-mount-dome',
      shape: 'cylinder',
      positionM: [0, 0.7, 0],
      dimensionsM: [0.5, 0.16],
      linkId: 0,
      materialHex: PART_ROCKET_ENGINE_COLORS.mountHex,
      collidable: true,
    },
    // Turbopump Housing
    {
      id: 'turbopump-assembly',
      shape: 'cylinder',
      positionM: [0.25, 0.5, 0],
      dimensionsM: [0.16, 0.28],
      linkId: 0,
      materialHex: PART_ROCKET_ENGINE_COLORS.machineryHex,
      collidable: true,
    },
    // Exhaust Duct
    {
      id: 'exhaust-duct',
      shape: 'cylinder',
      positionM: [-0.26, 0.38, 0.12],
      dimensionsM: [0.065, 0.48],
      linkId: 0,
      materialHex: PART_ROCKET_ENGINE_COLORS.machineryHex,
      collidable: true,
    },
    // Fuel Manifold Pipe
    {
      id: 'fuel-manifold-pipe',
      shape: 'box',
      positionM: [0, 0.6, -0.12],
      dimensionsM: [0.6, 0.08, 0.1],
      linkId: 0,
      materialHex: PART_ROCKET_ENGINE_COLORS.pipeHex,
      collidable: true,
    },
    // Spherical Gimbal Bearing
    {
      id: 'gimbal-bearing-housing',
      shape: 'sphere',
      positionM: [0, 0.42, 0],
      dimensionsM: [0.12],
      linkId: 0,
      materialHex: PART_ROCKET_ENGINE_COLORS.lipHex,
      collidable: true,
    },
    // Combustion Chamber (Y: 0.06 -> 0.38)
    {
      id: 'combustion-chamber',
      shape: 'cylinder',
      positionM: [0, 0.22, 0],
      dimensionsM: [0.3, 0.32],
      linkId: 1,
      materialHex: PART_ROCKET_ENGINE_COLORS.chamberHex,
      collidable: true,
    },
    // Throat Constriction (Y: -0.06 -> 0.06)
    {
      id: 'throat-constriction',
      shape: 'cylinder',
      positionM: [0, 0, 0],
      dimensionsM: [0.15, 0.12],
      linkId: 1,
      materialHex: PART_ROCKET_ENGINE_COLORS.machineryHex,
      collidable: true,
    },
    // Bell Expansion Nozzle (Y: -0.78 -> -0.06)
    {
      id: 'bell-expansion-nozzle',
      shape: 'cone',
      positionM: [0, -0.42, 0],
      dimensionsM: [0.55, 0.15, 0.72],
      linkId: 1,
      materialHex: PART_ROCKET_ENGINE_COLORS.nozzleHex,
      collidable: true,
    },
    // Nozzle Exit Lip Ring (Y: -0.80 -> -0.76)
    {
      id: 'nozzle-exit-lip-ring',
      shape: 'cylinder',
      positionM: [0, -0.78, 0],
      dimensionsM: [0.57, 0.04],
      linkId: 1,
      materialHex: PART_ROCKET_ENGINE_COLORS.lipHex,
      collidable: true,
    },
  ],
  sockets: [
    {
      kind: 'attach',
      role: 'stack-top',
      solidId: 'gimbal-mount-dome',
      offsetM: [0, 0.08, 0],
      primaryDirection: [0, 1, 0],
    },
    {
      kind: 'thrust',
      role: 'custom',
      solidId: 'nozzle-exit-lip-ring',
      offsetM: [0, -0.02, 0],
      primaryDirection: [0, -1, 0],
    },
  ],
  joint: {
    anchorM: [0, 0.42, 0],
    axis: [1, 0, 0], // pitch gimbal axis
    rangeRad: [-0.175, 0.175], // -10 deg to +10 deg
    restRad: 0,
  },
};

/**
 * 4. Pressurized Liquid Fuel Tank
 *
 * Coordinate convention:
 * - Radius: 0.6m, Total height: ~2.4m
 * - Top attach: Y = +1.26m, Bottom attach: Y = -1.26m
 * - Radial attach: X = ±0.6m (wings/boosters), Z = ±0.6m (legs/accessories)
 */
export const PART_ROCKET_FUEL_TANK_ARCHETYPE: IPartArchetype = {
  schemaVersion: 1,
  id: 'part-rocket-fuel-tank',
  name: 'Pressurized Liquid Fuel Tank',
  solids: [
    // Main Pressure Barrel (radius 0.6m, height 2.2m)
    {
      id: 'main-tank-barrel',
      shape: 'cylinder',
      positionM: [0, 0, 0],
      dimensionsM: [0.6, 2.2],
      linkId: 0,
      materialHex: PART_ROCKET_FUEL_TANK_COLORS.tankSkinHex,
      collidable: true,
    },
    // Top Dome Bulkhead
    {
      id: 'top-dome-bulkhead',
      shape: 'sphere',
      positionM: [0, 1.05, 0],
      dimensionsM: [0.58],
      linkId: 0,
      materialHex: PART_ROCKET_FUEL_TANK_COLORS.domeHex,
      collidable: true,
    },
    // Bottom Dome Bulkhead
    {
      id: 'bottom-dome-bulkhead',
      shape: 'sphere',
      positionM: [0, -1.05, 0],
      dimensionsM: [0.58],
      linkId: 0,
      materialHex: PART_ROCKET_FUEL_TANK_COLORS.domeHex,
      collidable: true,
    },
    // Top Interstage Staging Collar (Y: 1.1 -> 1.24)
    {
      id: 'top-interstage-ring',
      shape: 'cylinder',
      positionM: [0, 1.18, 0],
      dimensionsM: [0.62, 0.14],
      linkId: 0,
      materialHex: PART_ROCKET_FUEL_TANK_COLORS.collarHex,
      collidable: true,
    },
    // Bottom Interstage Ring (Y: -1.24 -> -1.1)
    {
      id: 'bottom-interstage-ring',
      shape: 'cylinder',
      positionM: [0, -1.18, 0],
      dimensionsM: [0.62, 0.14],
      linkId: 0,
      materialHex: PART_ROCKET_FUEL_TANK_COLORS.collarHex,
      collidable: true,
    },
    // Center Weld Hoop Ring
    {
      id: 'center-weld-ring',
      shape: 'cylinder',
      positionM: [0, 0, 0],
      dimensionsM: [0.61, 0.05],
      linkId: 0,
      materialHex: PART_ROCKET_FUEL_TANK_COLORS.collarHex,
      collidable: true,
    },
    // External Raceway Conduit Pipe
    {
      id: 'raceway-conduit',
      shape: 'box',
      positionM: [0, 0, 0.62],
      dimensionsM: [0.08, 2.1, 0.08],
      linkId: 0,
      materialHex: PART_ROCKET_FUEL_TANK_COLORS.conduitHex,
      collidable: true,
    },
    // Visual Roll Stripe
    {
      id: 'roll-stripe',
      shape: 'box',
      positionM: [0.605, 0.4, 0],
      dimensionsM: [0.02, 0.6, 0.2],
      linkId: 0,
      materialHex: PART_ROCKET_FUEL_TANK_COLORS.stripeHex,
      collidable: false,
    },
  ],
  sockets: [
    {
      kind: 'attach',
      role: 'stack-top',
      solidId: 'top-interstage-ring',
      offsetM: [0, 0.08, 0],
      primaryDirection: [0, 1, 0],
    },
    {
      kind: 'attach',
      role: 'stack-bottom',
      solidId: 'bottom-interstage-ring',
      offsetM: [0, -0.08, 0],
      primaryDirection: [0, -1, 0],
    },
    {
      kind: 'attach',
      role: 'radial',
      solidId: 'main-tank-barrel',
      offsetM: [0.6, 0, 0],
      primaryDirection: [1, 0, 0],
    },
    {
      kind: 'attach',
      role: 'radial',
      solidId: 'main-tank-barrel',
      offsetM: [-0.6, 0, 0],
      primaryDirection: [-1, 0, 0],
    },
    {
      kind: 'attach',
      role: 'radial',
      solidId: 'main-tank-barrel',
      offsetM: [0, -0.7, 0.6],
      primaryDirection: [0, 0, 1],
    },
    {
      kind: 'attach',
      role: 'radial',
      solidId: 'main-tank-barrel',
      offsetM: [0, -0.7, -0.6],
      primaryDirection: [0, 0, -1],
    },
  ],
};

export const STARTER_PART_CATALOG: readonly IPartArchetype[] = [
  PART_AIRCRAFT_WING_ARCHETYPE,
  PART_ROCKET_LANDING_LEG_ARCHETYPE,
  PART_ROCKET_ENGINE_ARCHETYPE,
  PART_ROCKET_FUEL_TANK_ARCHETYPE,
];
