import type { IFloraArchetype } from './flora-archetype';

/** Caller-side color hints (hex strings, not `Color` instances — construction stays with the caller, see flora-archetype.ts's "no color fields" note). */
export interface IFloraSpeciesColorHints {
  readonly trunkHex: string;
  readonly leafHex: string;
}

/** Broad crown, wide near-horizontal scaffold limbs (ideal perch candidates), and billowing low-poly cloud canopy pads. */
export const FLORA_OAK_ARCHETYPE: IFloraArchetype = {
  schemaVersion: 1,
  id: 'flora-oak',
  name: 'Oak',
  kind: 'tree',
  trunk: { heightM: [3.8, 5.2], radiusM: [0.32, 0.45], taper01: 0.38 },
  branching: {
    maxDepth: 3,
    childrenPerNode: [2, 3],
    spreadAngleRad: [0.65, 1.1],
    lengthFalloff01: 0.68,
  },
  foliage: { style: 'cluster-sphere', sizeM: [1.2, 1.8] },
  sockets: { perchesPerBranchDepth: { 1: 3, 2: 2 }, nestCavityChance01: 0.6, fruitSlotsMax: 4, flowerHeads: false },
  collider: { trunk: 'capsule' },
};

export const FLORA_OAK_COLORS: IFloraSpeciesColorHints = {
  trunkHex: '#5c3e24',
  leafHex: '#3c7e30',
};

/** Tall conifer — full central trunk with tiered horizontal whorls that taper toward a spire crown, matching classic conifer/spruce morphology. */
export const FLORA_PINE_ARCHETYPE: IFloraArchetype = {
  schemaVersion: 1,
  id: 'flora-pine',
  name: 'Pine',
  kind: 'tree',
  trunk: { heightM: [6.5, 9.5], radiusM: [0.24, 0.34], taper01: 0.65 },
  branching: {
    distribution: 'tiered-whorls',
    maxDepth: 2,
    childrenPerNode: [2, 3],
    spreadAngleRad: [0.4, 0.7],
    lengthFalloff01: 0.5,
    tieredWhorls: {
      tierCount: [5, 7],
      startHeightFraction01: 0.22,
      branchesPerTier: [4, 6],
      droopRad: [0.1, 0.22],
      baseBranchLengthFraction: [0.38, 0.48],
    },
  },
  foliage: {
    style: 'conifer-tiered',
    sizeM: [0.6, 0.95],
    coniferTiered: {
      spireHeightM: [1.3, 1.8],
      spireRadiusM: [0.42, 0.62],
      boughWidthM: [0.65, 0.95],
    },
  },
  sockets: { perchesPerBranchDepth: { 1: 4, 2: 3 }, nestCavityChance01: 0.3, fruitSlotsMax: 6, flowerHeads: false },
  collider: { trunk: 'capsule' },
};

export const FLORA_PINE_COLORS: IFloraSpeciesColorHints = {
  trunkHex: '#422c1d',
  leafHex: '#235235',
};

/** Tropical coconut palm — organic curving trunk with flared root base, topped with a lush multi-tiered arching frond crown and under-crown coconuts. */
export const FLORA_PALM_ARCHETYPE: IFloraArchetype = {
  schemaVersion: 1,
  id: 'flora-palm',
  name: 'Palm',
  kind: 'tree',
  trunk: {
    heightM: [6.5, 9.5],
    radiusM: [0.18, 0.26],
    taper01: 0.25,
    curveRad: [0.12, 0.28],
    curveSegments: 5,
    baseFlare01: 0.35,
  },
  branching: {
    // No limbs — the curving trunk tip is the sole frond anchor.
    maxDepth: 0,
    childrenPerNode: [0, 0],
    spreadAngleRad: [0, 0],
    lengthFalloff01: 0,
  },
  foliage: {
    style: 'radial-fronds',
    sizeM: [0.35, 0.5],
    radialFronds: {
      frondCount: 18,
      frondLengthM: [3.2, 4.4],
      frondDroopRad: 0.65,
      tierCount: 3,
      archRad: 0.45,
      frondWidthFraction: 0.13,
    },
  },
  // FrondPerches puts birds on the arching fronds, and fruit slots cluster as coconuts under the crown.
  sockets: {
    perchesPerBranchDepth: {},
    nestCavityChance01: 0,
    fruitSlotsMax: 4,
    flowerHeads: false,
    frondPerches: 4,
  },
  collider: { trunk: 'capsule' },
};

export const FLORA_PALM_COLORS: IFloraSpeciesColorHints = {
  trunkHex: '#735738',
  leafHex: '#3b9131',
};
