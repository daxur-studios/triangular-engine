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
