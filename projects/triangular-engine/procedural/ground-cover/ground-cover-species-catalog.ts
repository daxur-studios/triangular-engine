import type { IGroundCoverArchetype } from './ground-cover-archetype';

/** Caller-side color hints (hex strings) — construction stays with the caller, same convention as flora-species-catalog. `headHex` only applies when the archetype defines `head`. */
export interface IGroundCoverColorHints {
  readonly baseHex: string;
  readonly tipHex: string;
  readonly headHex?: string;
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
 * heightM, low curveRad) read as individual stems rather than a tuft, each
 * topped with a real `head` bloom (two crossed quads, see
 * `buildGroundCoverClumpMesh`) rather than just a tinted blade tip.
 */
export const GROUND_COVER_WILDFLOWER_ARCHETYPE: IGroundCoverArchetype = {
  schemaVersion: 1,
  id: 'ground-cover-wildflower',
  name: 'Wildflower',
  blade: { heightM: [0.34, 0.52], widthM: [0.01, 0.016], curveRad: [0.03, 0.1] },
  clump: { bladeCount: [1, 2], radiusM: [0.01, 0.03] },
  head: { radiusM: [0.05, 0.08] },
};

export const GROUND_COVER_WILDFLOWER_COLORS: IGroundCoverColorHints = {
  baseHex: '#33501f',
  tipHex: '#4c7530',
  headHex: '#8a5cc7',
};
