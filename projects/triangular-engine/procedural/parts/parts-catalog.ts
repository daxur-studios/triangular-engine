import type { IPartArchetype } from './parts-archetype';

export const PART_AIRCRAFT_WING_COLORS = {
  mainHex: '#cfd8dc',
  leadingEdgeHex: '#37474f',
  flapHex: '#b0bec5',
} as const;

export const PART_ROCKET_LEG_COLORS = {
  mountHex: '#37474f',
  strutHex: '#eceff1',
  pistonHex: '#78909c',
  footHex: '#263238',
} as const;

export const PART_ROCKET_ENGINE_COLORS = {
  topFlangeHex: '#455a64',
  chamberHex: '#546e7a',
  manifoldHex: '#ff7043',
  nozzleHex: '#263238',
} as const;

export const PART_AIRCRAFT_WING_ARCHETYPE: IPartArchetype = {
  schemaVersion: 1,
  id: 'part-aircraft-wing',
  name: 'Modular Aircraft Wing',
  solids: [
    {
      id: 'wing-root',
      shape: 'box',
      positionM: [0.6, 0, 0],
      dimensionsM: [[1.0, 1.4], [0.08, 0.12], [1.0, 1.4]],
      linkId: 0,
      materialHex: PART_AIRCRAFT_WING_COLORS.mainHex,
      collidable: true,
    },
    {
      id: 'wing-tip',
      shape: 'box',
      positionM: [1.8, 0.05, 0.1],
      dimensionsM: [[1.2, 1.6], [0.05, 0.08], [0.6, 0.9]],
      linkId: 0,
      materialHex: PART_AIRCRAFT_WING_COLORS.flapHex,
      collidable: true,
    },
    {
      id: 'leading-edge-strip',
      shape: 'cylinder',
      positionM: [1.2, 0, 0.55],
      orientation: [0, 0, 0.7071, 0.7071], // rotated along span (X axis)
      dimensionsM: [0.04, [2.2, 2.8]],
      linkId: 0,
      materialHex: PART_AIRCRAFT_WING_COLORS.leadingEdgeHex,
      collidable: false, // cosmetic
    },
  ],
  sockets: [
    {
      kind: 'attach',
      role: 'radial',
      solidId: 'wing-root',
      offsetM: [-0.6, 0, 0],
      primaryDirection: [-1, 0, 0], // outward normal facing host fuselage
    },
    {
      kind: 'lift',
      solidId: 'wing-root',
      offsetM: [0.6, 0, 0.2],
      primaryDirection: [0, 0, 1], // forward flight axis
    },
  ],
  collider: {
    hull: false,
    coneApproximation: 'cylinder',
  },
};

export const PART_ROCKET_LANDING_LEG_ARCHETYPE: IPartArchetype = {
  schemaVersion: 1,
  id: 'part-rocket-landing-leg',
  name: 'Deployable Rocket Landing Leg',
  solids: [
    {
      id: 'base-mount',
      shape: 'box',
      positionM: [0, 0, 0],
      dimensionsM: [0.35, 0.3, 0.25],
      linkId: 0,
      materialHex: PART_ROCKET_LEG_COLORS.mountHex,
      collidable: true,
    },
    {
      id: 'upper-strut',
      shape: 'cylinder',
      positionM: [0, -0.65, 0.3],
      dimensionsM: [[0.05, 0.07], [1.1, 1.4]],
      linkId: 1,
      materialHex: PART_ROCKET_LEG_COLORS.strutHex,
      collidable: true,
    },
    {
      id: 'hydraulic-piston',
      shape: 'cylinder',
      positionM: [0, -0.4, 0.15],
      dimensionsM: [0.035, [0.6, 0.8]],
      linkId: 1,
      materialHex: PART_ROCKET_LEG_COLORS.pistonHex,
      collidable: false,
    },
    {
      id: 'foot-pad',
      shape: 'cylinder',
      positionM: [0, -1.25, 0.45],
      dimensionsM: [[0.18, 0.25], 0.08],
      linkId: 1,
      materialHex: PART_ROCKET_LEG_COLORS.footHex,
      collidable: true,
    },
  ],
  sockets: [
    {
      kind: 'attach',
      role: 'radial',
      solidId: 'base-mount',
      offsetM: [0, 0, -0.125],
      primaryDirection: [0, 0, -1],
    },
    {
      kind: 'pivot',
      solidId: 'base-mount',
      offsetM: [0, 0, 0.1],
      primaryDirection: [1, 0, 0],
    },
    {
      kind: 'foot',
      solidId: 'foot-pad',
      offsetM: [0, -0.04, 0],
      primaryDirection: [0, -1, 0],
    },
  ],
  collider: {
    hull: false,
    coneApproximation: 'cylinder',
  },
  joint: {
    anchorM: [0, 0, 0.1],
    axis: [-1, 0, 0], // rotates outward around -X
    rangeRad: [0, 1.15],
    restRad: 0,
  },

};

export const PART_ROCKET_ENGINE_ARCHETYPE: IPartArchetype = {
  schemaVersion: 1,
  id: 'part-rocket-engine',
  name: 'Liquid Fueled Rocket Engine',
  solids: [
    {
      id: 'mount-flange',
      shape: 'cylinder',
      positionM: [0, 0.7, 0],
      dimensionsM: [[0.55, 0.7], 0.15],
      linkId: 0,
      materialHex: PART_ROCKET_ENGINE_COLORS.topFlangeHex,
      collidable: true,
    },
    {
      id: 'combustion-chamber',
      shape: 'cylinder',
      positionM: [0, 0.35, 0],
      dimensionsM: [[0.4, 0.55], [0.5, 0.7]],
      linkId: 0,
      materialHex: PART_ROCKET_ENGINE_COLORS.chamberHex,
      collidable: true,
    },
    {
      id: 'fuel-manifold',
      shape: 'cylinder',
      positionM: [0, 0.05, 0],
      dimensionsM: [[0.48, 0.62], 0.1],
      linkId: 0,
      materialHex: PART_ROCKET_ENGINE_COLORS.manifoldHex,
      collidable: false,
    },
    {
      id: 'nozzle-bell',
      shape: 'cone',
      positionM: [0, -0.55, 0],
      dimensionsM: [[0.65, 0.95], [0.25, 0.35], [0.9, 1.3]], // radiusBottom, radiusTop, height
      linkId: 0,
      materialHex: PART_ROCKET_ENGINE_COLORS.nozzleHex,
      collidable: true,
    },
  ],
  sockets: [
    {
      kind: 'attach',
      role: 'stack-top',
      solidId: 'mount-flange',
      primaryDirection: [0, 1, 0],
    },
    {
      kind: 'attach',
      role: 'stack-bottom',
      solidId: 'mount-flange',
      primaryDirection: [0, -1, 0],
    },
    {
      kind: 'thrust',
      solidId: 'nozzle-bell',
      primaryDirection: [0, -1, 0],
    },
  ],
  collider: {
    hull: false,
    coneApproximation: 'cylinder',
  },
};

export const PART_STARTER_CATALOG: readonly IPartArchetype[] = [
  PART_AIRCRAFT_WING_ARCHETYPE,
  PART_ROCKET_LANDING_LEG_ARCHETYPE,
  PART_ROCKET_ENGINE_ARCHETYPE,
];

export function getPartArchetypeById(id: string): IPartArchetype | undefined {
  return PART_STARTER_CATALOG.find((a) => a.id === id);
}
