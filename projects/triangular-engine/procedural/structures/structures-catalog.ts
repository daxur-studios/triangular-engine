import type { IStructureArchetype } from './structures-archetype';

export const STRUCTURE_PALETTE_COLORS = {
  concreteHex: '#d8d9d2',
  asphaltHex: '#3a3a3d',
  stripeYellowHex: '#f4b942',
  stripeWhiteHex: '#f8fafc',
  steelDarkHex: '#1e293b',
  steelTrussHex: '#475569',
  accentOrangeHex: '#e0483c',
  machineryHex: '#334155',
  glassBlueHex: '#38bdf8',
};

/**
 * 1. Demo Modular Runway
 */
export const DEMO_RUNWAY_ARCHETYPE: IStructureArchetype = {
  schemaVersion: 1,
  id: 'demo-runway',
  name: 'Demo Modular Runway (400m)',
  footprint: {
    kind: 'rect',
    dimensionsM: [20, 200], // halfWidth: 20m (40m wide), halfLength: 200m (400m long)
    foundationDepthM: 0.4,
  },
  solids: [
    // Main asphalt runway slab (X: 40m, Y: 0.3m, Z: 400m)
    {
      id: 'runway-slab',
      shape: 'box',
      positionM: [0, 0.15, 0],
      dimensionsM: [40, 0.3, 400],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.asphaltHex,
      collidable: true,
    },
    // Centerline dashed stripes (repeated 16 times down runway)
    {
      id: 'centerline-stripe',
      shape: 'box',
      positionM: [0, 0.31, -170],
      dimensionsM: [1.2, 0.02, 12],
      repeatCount: 16,
      repeatOffsetM: [0, 0, 22],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.stripeYellowHex,
      collidable: false,
    },
    // Threshold landing markings (inboard white stripes)
    {
      id: 'threshold-stripe-left',
      shape: 'box',
      positionM: [-10, 0.31, -185],
      dimensionsM: [2.5, 0.02, 18],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.stripeWhiteHex,
      collidable: false,
    },
    {
      id: 'threshold-stripe-right',
      shape: 'box',
      positionM: [10, 0.31, -185],
      dimensionsM: [2.5, 0.02, 18],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.stripeWhiteHex,
      collidable: false,
    },
    // Left boundary approach pylons (10 light poles along side)
    {
      id: 'left-boundary-pylon',
      shape: 'cylinder',
      positionM: [-22, 1.0, -180],
      dimensionsM: [0.15, 2.0],
      repeatCount: 10,
      repeatOffsetM: [0, 0, 40],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
      collidable: true,
    },
  ],
  sockets: [
    {
      kind: 'spawn-point',
      role: 'launch',
      solidId: 'runway-slab',
      offsetM: [0, 0.3, -180],
      primaryDirection: [0, 0, 1], // Launch heading along runway +Z
      clearanceRadiusM: 20,
    },
    {
      kind: 'touchdown-zone',
      role: 'recovery',
      solidId: 'runway-slab',
      offsetM: [0, 0.3, -100],
      primaryDirection: [0, 1, 0],
      clearanceRadiusM: 25,
    },
  ],
};

/**
 * 2. Demo Rocket Launch Table & Landing Pad
 */
export const DEMO_LAUNCHPAD_ARCHETYPE: IStructureArchetype = {
  schemaVersion: 1,
  id: 'demo-launchpad',
  name: 'Demo Rocket Launch & Landing Pad',
  footprint: {
    kind: 'circle',
    dimensionsM: [32], // 32m radius (64m diameter)
    foundationDepthM: 0.8,
  },
  solids: [
    // Heavy concrete circular base slab (radius: 30m, thickness: 0.8m)
    {
      id: 'concrete-pad-slab',
      shape: 'cylinder',
      positionM: [0, 0.4, 0],
      dimensionsM: [30, 0.8],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.concreteHex,
      collidable: true,
    },
    // Center flame trench blast ring collar
    {
      id: 'flame-trench-collar',
      shape: 'cylinder',
      positionM: [0, 0.9, 0],
      dimensionsM: [8, 0.4],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.steelDarkHex,
      collidable: true,
    },
    // Outer perimeter blast protection berm wall (4 corner quadrants)
    {
      id: 'perimeter-berm-segment',
      shape: 'box',
      positionM: [0, 1.2, 28],
      dimensionsM: [20, 1.6, 2],
      repeatCount: 4,
      repeatOffsetM: [0, 0, -18],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
      collidable: true,
    },
    // Water deluge tower (4 surrounding deluge pylons)
    {
      id: 'deluge-pylon-1',
      shape: 'cylinder',
      positionM: [18, 6.0, 18],
      dimensionsM: [0.9, 12],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
      collidable: true,
    },
    {
      id: 'deluge-pylon-2',
      shape: 'cylinder',
      positionM: [-18, 6.0, 18],
      dimensionsM: [0.9, 12],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
      collidable: true,
    },
    // Umbilical service tower mast
    {
      id: 'service-tower-column',
      shape: 'box',
      positionM: [-16, 15, 0],
      dimensionsM: [3, 30, 3],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
      collidable: true,
    },
    // Umbilical swing arm
    {
      id: 'umbilical-swing-arm',
      shape: 'box',
      positionM: [-8, 26, 0],
      dimensionsM: [14, 1.2, 1.2],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.machineryHex,
      collidable: true,
    },
  ],
  sockets: [
    {
      kind: 'spawn-point',
      role: 'launch',
      offsetM: [0, 1.1, 0],
      primaryDirection: [0, 1, 0], // Vertical launch +Y
      clearanceRadiusM: 15,
    },
    {
      kind: 'touchdown-zone',
      role: 'recovery',
      offsetM: [0, 0.8, 0],
      primaryDirection: [0, 1, 0],
      clearanceRadiusM: 18,
    },
    {
      kind: 'refuel-dock',
      role: 'docking',
      solidId: 'umbilical-swing-arm',
      offsetM: [6, 0, 0],
      primaryDirection: [1, 0, 0],
    },
  ],
};

/**
 * 3. Demo Mechazilla-Style Launch & Catch Tower
 */
export const DEMO_CHOPSTICK_TOWER_ARCHETYPE: IStructureArchetype = {
  schemaVersion: 1,
  id: 'demo-chopstick-tower',
  name: 'Mechazilla Launch & Catch Tower (80m)',
  footprint: {
    kind: 'rect',
    dimensionsM: [15, 15],
    foundationDepthM: 1.0,
  },
  solids: [
    // Heavy concrete foundation pad
    {
      id: 'tower-foundation',
      shape: 'box',
      positionM: [0, 0.5, 0],
      dimensionsM: [26, 1.0, 26],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.concreteHex,
      collidable: true,
    },
    // Main vertical tower core column (80m tall)
    {
      id: 'tower-core-column',
      shape: 'box',
      positionM: [-6, 40, 0],
      dimensionsM: [6, 80, 8],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.steelDarkHex,
      collidable: true,
    },
    // Guide rails along tower face
    {
      id: 'tower-guide-rail-left',
      shape: 'box',
      positionM: [-2.8, 40, -3.2],
      dimensionsM: [0.4, 78, 0.4],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
      collidable: false,
    },
    {
      id: 'tower-guide-rail-right',
      shape: 'box',
      positionM: [-2.8, 40, 3.2],
      dimensionsM: [0.4, 78, 0.4],
      linkId: 0,
      materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
      collidable: false,
    },
    // linkId: 1 — Elevator Lift Carriage (moves vertically on Y axis)
    {
      id: 'elevator-carriage-housing',
      shape: 'box',
      positionM: [-2, 0, 0],
      dimensionsM: [4, 6, 8],
      linkId: 1,
      materialHex: STRUCTURE_PALETTE_COLORS.machineryHex,
      collidable: true,
    },
    // linkId: 2 — Left Chopstick Boom Arm (hinges around Y axis)
    {
      id: 'chopstick-arm-left-boom',
      shape: 'box',
      positionM: [8, 0, -3.6],
      dimensionsM: [18, 1.5, 1.2],
      linkId: 2,
      materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
      collidable: true,
    },
    {
      id: 'chopstick-rail-left-pad',
      shape: 'box',
      positionM: [10, 0.6, -3.0],
      dimensionsM: [14, 0.3, 0.6],
      linkId: 2,
      materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
      collidable: true,
    },
    // linkId: 3 — Right Chopstick Boom Arm (hinges around Y axis)
    {
      id: 'chopstick-arm-right-boom',
      shape: 'box',
      positionM: [8, 0, 3.6],
      dimensionsM: [18, 1.5, 1.2],
      linkId: 3,
      materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
      collidable: true,
    },
    {
      id: 'chopstick-rail-right-pad',
      shape: 'box',
      positionM: [10, 0.6, 3.0],
      dimensionsM: [14, 0.3, 0.6],
      linkId: 3,
      materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
      collidable: true,
    },
  ],
  joints: [
    {
      id: 'carriage-lift',
      linkId: 1,
      parentLinkId: 0,
      type: 'prismatic',
      anchorM: [-2, 0, 0],
      axis: [0, 1, 0], // Vertical elevation stroke
      range: [0, 60], // 0m to 60m stroke
      rest: 35,
    },
    {
      id: 'chopstick-left-hinge',
      linkId: 2,
      parentLinkId: 1,
      type: 'hinge',
      anchorM: [-0.5, 0, -3.6],
      axis: [0, 1, 0], // Horizontal swing rotation
      range: [-0.15, 0.55], // -8.6 deg (fully closed/touching) to +31.5 deg (wide open)
      rest: 0,
    },
    {
      id: 'chopstick-right-hinge',
      linkId: 3,
      parentLinkId: 1,
      type: 'hinge',
      anchorM: [-0.5, 0, 3.6],
      axis: [0, 1, 0],
      range: [-0.55, 0.15],
      rest: 0,
    },
  ],
  sockets: [
    {
      kind: 'catch-zone',
      role: 'recovery',
      solidId: 'elevator-carriage-housing',
      offsetM: [11, 0, 0],
      primaryDirection: [0, 1, 0],
      clearanceRadiusM: 12,
    },
    {
      kind: 'spawn-point',
      role: 'launch',
      offsetM: [9, 1.2, 0],
      primaryDirection: [0, 1, 0],
      clearanceRadiusM: 15,
    },
  ],
};

export function createRunwayArchetype(options?: {
  readonly lengthM?: number;
  readonly widthM?: number;
  readonly slabHeightM?: number;
}): IStructureArchetype {
  const length = Math.max(100, options?.lengthM ?? 400);
  const width = Math.max(15, options?.widthM ?? 40);
  const slabHeight = options?.slabHeightM ?? 0.3;
  const halfLength = length * 0.5;
  const halfWidth = width * 0.5;

  const stripeSpacing = 24;
  const usableLength = length - 60;
  const repeatCount = Math.max(2, Math.floor(usableLength / stripeSpacing));
  const startZ = -halfLength + 30;

  const pylonSpacing = 40;
  const pylonCount = Math.max(2, Math.floor((length - 40) / pylonSpacing));

  return {
    schemaVersion: 1,
    id: 'custom-runway',
    name: `Modular Runway (${length}m x ${width}m)`,
    footprint: {
      kind: 'rect',
      dimensionsM: [halfWidth, halfLength],
      foundationDepthM: 0.4,
    },
    solids: [
      {
        id: 'runway-slab',
        shape: 'box',
        positionM: [0, slabHeight * 0.5, 0],
        dimensionsM: [width, slabHeight, length],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.asphaltHex,
        collidable: true,
      },
      {
        id: 'centerline-stripe',
        shape: 'box',
        positionM: [0, slabHeight + 0.01, startZ],
        dimensionsM: [1.2, 0.02, 12],
        repeatCount,
        repeatOffsetM: [0, 0, stripeSpacing],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.stripeYellowHex,
        collidable: false,
      },
      {
        id: 'threshold-stripe-left',
        shape: 'box',
        positionM: [-halfWidth * 0.5, slabHeight + 0.01, -halfLength + 15],
        dimensionsM: [halfWidth * 0.4, 0.02, 18],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.stripeWhiteHex,
        collidable: false,
      },
      {
        id: 'threshold-stripe-right',
        shape: 'box',
        positionM: [halfWidth * 0.5, slabHeight + 0.01, -halfLength + 15],
        dimensionsM: [halfWidth * 0.4, 0.02, 18],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.stripeWhiteHex,
        collidable: false,
      },
      {
        id: 'left-boundary-pylon',
        shape: 'cylinder',
        positionM: [-(halfWidth + 2), 1.0, -halfLength + 20],
        dimensionsM: [0.15, 2.0],
        repeatCount: pylonCount,
        repeatOffsetM: [0, 0, pylonSpacing],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
        collidable: true,
      },
      {
        id: 'right-boundary-pylon',
        shape: 'cylinder',
        positionM: [halfWidth + 2, 1.0, -halfLength + 20],
        dimensionsM: [0.15, 2.0],
        repeatCount: pylonCount,
        repeatOffsetM: [0, 0, pylonSpacing],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
        collidable: true,
      },
    ],
    sockets: [
      {
        kind: 'spawn-point',
        role: 'launch',
        solidId: 'runway-slab',
        offsetM: [0, slabHeight, -halfLength + 20],
        primaryDirection: [0, 0, 1],
        clearanceRadiusM: halfWidth,
      },
      {
        kind: 'touchdown-zone',
        role: 'recovery',
        solidId: 'runway-slab',
        offsetM: [0, slabHeight, -halfLength * 0.5],
        primaryDirection: [0, 1, 0],
        clearanceRadiusM: halfWidth,
      },
    ],
  };
}

export function createLaunchpadArchetype(options?: {
  readonly radiusM?: number;
  readonly slabHeightM?: number;
}): IStructureArchetype {
  const radius = Math.max(10, options?.radiusM ?? 30);
  const slabHeight = options?.slabHeightM ?? 0.8;
  const delugeDist = radius * 0.6;

  return {
    schemaVersion: 1,
    id: 'custom-launchpad',
    name: `Launch & Landing Pad (${radius * 2}m Dia)`,
    footprint: {
      kind: 'circle',
      dimensionsM: [radius + 2],
      foundationDepthM: slabHeight,
    },
    solids: [
      {
        id: 'concrete-pad-slab',
        shape: 'cylinder',
        positionM: [0, slabHeight * 0.5, 0],
        dimensionsM: [radius, slabHeight],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.concreteHex,
        collidable: true,
      },
      {
        id: 'flame-trench-collar',
        shape: 'cylinder',
        positionM: [0, slabHeight + 0.1, 0],
        dimensionsM: [radius * 0.25, 0.4],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.steelDarkHex,
        collidable: true,
      },
      {
        id: 'deluge-pylon-1',
        shape: 'cylinder',
        positionM: [delugeDist, 6.0, delugeDist],
        dimensionsM: [0.9, 12],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
        collidable: true,
      },
      {
        id: 'deluge-pylon-2',
        shape: 'cylinder',
        positionM: [-delugeDist, 6.0, delugeDist],
        dimensionsM: [0.9, 12],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
        collidable: true,
      },
      {
        id: 'service-tower-column',
        shape: 'box',
        positionM: [-radius * 0.55, 15, 0],
        dimensionsM: [3, 30, 3],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
        collidable: true,
      },
      {
        id: 'umbilical-swing-arm',
        shape: 'box',
        positionM: [-radius * 0.25, 26, 0],
        dimensionsM: [radius * 0.5, 1.2, 1.2],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.machineryHex,
        collidable: true,
      },
    ],
    sockets: [
      {
        kind: 'spawn-point',
        role: 'launch',
        offsetM: [0, slabHeight + 0.3, 0],
        primaryDirection: [0, 1, 0],
        clearanceRadiusM: radius * 0.5,
      },
      {
        kind: 'touchdown-zone',
        role: 'recovery',
        offsetM: [0, slabHeight, 0],
        primaryDirection: [0, 1, 0],
        clearanceRadiusM: radius * 0.6,
      },
      {
        kind: 'refuel-dock',
        role: 'docking',
        solidId: 'umbilical-swing-arm',
        offsetM: [radius * 0.2, 0, 0],
        primaryDirection: [1, 0, 0],
      },
    ],
  };
}

export function createChopstickTowerArchetype(options?: {
  readonly heightM?: number;
}): IStructureArchetype {
  const height = Math.max(30, options?.heightM ?? 80);
  const railHeight = height - 2;
  const maxElevStroke = height - 20;
  const restElev = height * 0.45;

  return {
    schemaVersion: 1,
    id: 'custom-chopstick-tower',
    name: `Mechazilla Launch & Catch Tower (${height}m)`,
    footprint: {
      kind: 'rect',
      dimensionsM: [15, 15],
      foundationDepthM: 1.0,
    },
    solids: [
      {
        id: 'tower-foundation',
        shape: 'box',
        positionM: [0, 0.5, 0],
        dimensionsM: [26, 1.0, 26],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.concreteHex,
        collidable: true,
      },
      {
        id: 'tower-core-column',
        shape: 'box',
        positionM: [-6, height * 0.5, 0],
        dimensionsM: [6, height, 8],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.steelDarkHex,
        collidable: true,
      },
      {
        id: 'tower-guide-rail-left',
        shape: 'box',
        positionM: [-2.8, height * 0.5, -3.2],
        dimensionsM: [0.4, railHeight, 0.4],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
        collidable: false,
      },
      {
        id: 'tower-guide-rail-right',
        shape: 'box',
        positionM: [-2.8, height * 0.5, 3.2],
        dimensionsM: [0.4, railHeight, 0.4],
        linkId: 0,
        materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
        collidable: false,
      },
      {
        id: 'elevator-carriage-housing',
        shape: 'box',
        positionM: [-2, 0, 0],
        dimensionsM: [4, 6, 8],
        linkId: 1,
        materialHex: STRUCTURE_PALETTE_COLORS.machineryHex,
        collidable: true,
      },
      {
        id: 'chopstick-arm-left-boom',
        shape: 'box',
        positionM: [8, 0, -3.6],
        dimensionsM: [18, 1.5, 1.2],
        linkId: 2,
        materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
        collidable: true,
      },
      {
        id: 'chopstick-rail-left-pad',
        shape: 'box',
        positionM: [10, 0.6, -3.0],
        dimensionsM: [14, 0.3, 0.6],
        linkId: 2,
        materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
        collidable: true,
      },
      {
        id: 'chopstick-arm-right-boom',
        shape: 'box',
        positionM: [8, 0, 3.6],
        dimensionsM: [18, 1.5, 1.2],
        linkId: 3,
        materialHex: STRUCTURE_PALETTE_COLORS.steelTrussHex,
        collidable: true,
      },
      {
        id: 'chopstick-rail-right-pad',
        shape: 'box',
        positionM: [10, 0.6, 3.0],
        dimensionsM: [14, 0.3, 0.6],
        linkId: 3,
        materialHex: STRUCTURE_PALETTE_COLORS.accentOrangeHex,
        collidable: true,
      },
    ],
    joints: [
      {
        id: 'carriage-lift',
        linkId: 1,
        parentLinkId: 0,
        type: 'prismatic',
        anchorM: [-2, 0, 0],
        axis: [0, 1, 0],
        range: [0, maxElevStroke],
        rest: restElev,
      },
      {
        id: 'chopstick-left-hinge',
        linkId: 2,
        parentLinkId: 1,
        type: 'hinge',
        anchorM: [-0.5, 0, -3.6],
        axis: [0, 1, 0],
        range: [-0.15, 0.55],
        rest: 0,
      },
      {
        id: 'chopstick-right-hinge',
        linkId: 3,
        parentLinkId: 1,
        type: 'hinge',
        anchorM: [-0.5, 0, 3.6],
        axis: [0, 1, 0],
        range: [-0.55, 0.15],
        rest: 0,
      },
    ],
    sockets: [
      {
        kind: 'catch-zone',
        role: 'recovery',
        solidId: 'elevator-carriage-housing',
        offsetM: [11, 0, 0],
        primaryDirection: [0, 1, 0],
        clearanceRadiusM: 12,
      },
      {
        kind: 'spawn-point',
        role: 'launch',
        offsetM: [9, 1.2, 0],
        primaryDirection: [0, 1, 0],
        clearanceRadiusM: 15,
      },
    ],
  };
}

export const DEMO_STRUCTURE_CATALOG: readonly IStructureArchetype[] = [
  DEMO_RUNWAY_ARCHETYPE,
  DEMO_LAUNCHPAD_ARCHETYPE,
  DEMO_CHOPSTICK_TOWER_ARCHETYPE,
];

