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

/** Tall, narrow, upward-swept branches with fast length falloff — a conical silhouette from dense small tip clusters. */
export const FLORA_PINE_ARCHETYPE: IFloraArchetype = {
  schemaVersion: 1,
  id: 'flora-pine',
  name: 'Pine',
  kind: 'tree',
  trunk: { heightM: [6, 9], radiusM: [0.22, 0.32], taper01: 0.6 },
  branching: {
    maxDepth: 2,
    // Denser branching than oak — many small tip clusters fill out the cone.
    childrenPerNode: [3, 4],
    // Narrow and upward-swept, not oak's wide horizontal spread.
    spreadAngleRad: [0.25, 0.55],
    lengthFalloff01: 0.55,
  },
  foliage: { style: 'cluster-cone', sizeM: [0.5, 0.8] },
  sockets: { perchesPerBranchDepth: { 1: 2 }, nestCavityChance01: 0.2, fruitSlotsMax: 2, flowerHeads: false },
  collider: { trunk: 'capsule' },
};

export const FLORA_PINE_COLORS: IFloraSpeciesColorHints = {
  trunkHex: '#4a3a2c',
  leafHex: '#2f5233',
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
  // No perches (no limbs) and no trunk cavities; fruit slots stand in for coconuts hanging under the crown.
  sockets: { perchesPerBranchDepth: {}, nestCavityChance01: 0, fruitSlotsMax: 3, flowerHeads: false },
  collider: { trunk: 'capsule' },
};

export const FLORA_PALM_COLORS: IFloraSpeciesColorHints = {
  trunkHex: '#8a6d4a',
  leafHex: '#5aa85a',
};
