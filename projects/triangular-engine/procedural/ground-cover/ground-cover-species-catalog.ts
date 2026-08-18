import type { IGroundCoverArchetype } from './ground-cover-archetype';

/** Caller-side color hints (hex strings) — construction stays with the caller, same convention as flora-species-catalog. */
export interface IGroundCoverColorHints {
  readonly baseHex: string;
  readonly tipHex: string;
}

/** Short, dense meadow grass — small clumps meant to be scattered at high density. */
export const GROUND_COVER_MEADOW_GRASS_ARCHETYPE: IGroundCoverArchetype = {
  schemaVersion: 1,
  id: 'ground-cover-meadow-grass',
  name: 'Meadow grass',
  blade: { heightM: [0.22, 0.42], widthM: [0.018, 0.032], curveRad: [0.15, 0.5] },
  clump: { bladeCount: [5, 9], radiusM: [0.05, 0.11] },
};

export const GROUND_COVER_MEADOW_GRASS_COLORS: IGroundCoverColorHints = {
  baseHex: '#2f4a1e',
  tipHex: '#93bd54',
};

/**
 * Sparse wildflower stems — a second ground-cover species meant to be
 * scattered thinly through a grass field, not as its own dense layer. Fewer,
 * taller, straighter stems than the grass archetype (small bladeCount, tall
 * heightM, low curveRad) read as individual stems rather than a tuft. There's
 * no separate bloom/head geometry in `buildGroundCoverClumpMesh` — the
 * "flower" is the same tapered blade card as grass, just with a saturated
 * tip color standing in for a bloom via the existing base/tip gradient.
 */
export const GROUND_COVER_WILDFLOWER_ARCHETYPE: IGroundCoverArchetype = {
  schemaVersion: 1,
  id: 'ground-cover-wildflower',
  name: 'Wildflower',
  blade: { heightM: [0.28, 0.48], widthM: [0.012, 0.02], curveRad: [0.05, 0.2] },
  clump: { bladeCount: [2, 3], radiusM: [0.02, 0.05] },
};

export const GROUND_COVER_WILDFLOWER_COLORS: IGroundCoverColorHints = {
  baseHex: '#3c5a24',
  tipHex: '#e0a63e',
};
