import type { IFloraArchetype } from './flora-archetype';

/** Caller-side color hints (hex strings, not `Color` instances — construction stays with the caller, see flora-archetype.ts's "no color fields" note). */
export interface IFloraSpeciesColorHints {
  readonly trunkHex: string;
  readonly leafHex: string;
}

/** Broad crown, wide near-horizontal limbs (good perch candidates), round cluster canopy. */
export const FLORA_OAK_ARCHETYPE: IFloraArchetype = {
  schemaVersion: 1,
  id: 'flora-oak',
  name: 'Oak',
  kind: 'tree',
  trunk: { heightM: [3.5, 5], radiusM: [0.28, 0.4], taper01: 0.45 },
  branching: {
    maxDepth: 3,
    childrenPerNode: [2, 3],
    // Wide — lower/thicker limbs sticking out closer to horizontal give
    // deriveFloraSockets' perch filter (near-horizontal, thick enough) real
    // candidates to find.
    spreadAngleRad: [0.6, 1.3],
    lengthFalloff01: 0.68,
  },
  foliage: { style: 'cluster-sphere', sizeM: [0.9, 1.5] },
  sockets: { perchesPerBranchDepth: { 1: 3, 2: 2 }, nestCavityChance01: 0.5, fruitSlotsMax: 4, flowerHeads: false },
  collider: { trunk: 'capsule' },
};

export const FLORA_OAK_COLORS: IFloraSpeciesColorHints = {
  trunkHex: '#6b4a2f',
  leafHex: '#4f8a3d',
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

/** Zero branching — a single slender low-taper trunk topped with a radiating, drooping frond crown. */
export const FLORA_PALM_ARCHETYPE: IFloraArchetype = {
  schemaVersion: 1,
  id: 'flora-palm',
  name: 'Palm',
  kind: 'tree',
  trunk: { heightM: [5, 8], radiusM: [0.18, 0.26], taper01: 0.15 },
  branching: {
    // No limbs — the trunk tip is the sole frond anchor.
    maxDepth: 0,
    childrenPerNode: [0, 0],
    spreadAngleRad: [0, 0],
    lengthFalloff01: 0,
  },
  foliage: {
    style: 'radial-fronds',
    sizeM: [0.3, 0.4],
    radialFronds: { frondCount: 7, frondLengthM: [1.8, 2.4], frondDroopRad: 0.45 },
  },
  // No limb-based perches (no limbs) or trunk cavities; frondPerches puts birds
  // on the drooping fronds themselves instead, and fruit slots stand in for
  // coconuts hanging under the crown.
  sockets: {
    perchesPerBranchDepth: {},
    nestCavityChance01: 0,
    fruitSlotsMax: 3,
    flowerHeads: false,
    frondPerches: 3,
  },
  collider: { trunk: 'capsule' },
};

export const FLORA_PALM_COLORS: IFloraSpeciesColorHints = {
  trunkHex: '#8a6d4a',
  leafHex: '#5aa85a',
};
