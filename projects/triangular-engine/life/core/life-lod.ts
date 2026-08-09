export type LifeLodTier = 'individual' | 'group' | 'ambient' | 'hidden';

export interface LifeLodProfile {
  /** Distance at which individual members become a group representation. */
  readonly individualDistance: number;
  /** Distance at which a group becomes a cheap ambient representation. */
  readonly groupDistance: number;
  /** Distance at which ambient life is culled. */
  readonly ambientDistance: number;
}

export interface LifeLodProfiles {
  readonly insect: LifeLodProfile;
  readonly bird: LifeLodProfile;
  readonly fish: LifeLodProfile;
  readonly landAnimal: LifeLodProfile;
  readonly default: LifeLodProfile;
}

export const DEFAULT_LIFE_LOD_PROFILES: LifeLodProfiles = {
  insect: { individualDistance: 18, groupDistance: 65, ambientDistance: 150 },
  bird: { individualDistance: 90, groupDistance: 350, ambientDistance: 1100 },
  fish: { individualDistance: 45, groupDistance: 220, ambientDistance: 700 },
  landAnimal: { individualDistance: 140, groupDistance: 500, ambientDistance: 1600 },
  default: { individualDistance: 80, groupDistance: 300, ambientDistance: 1000 },
};

/**
 * Selects the cheapest representation that can still be seen at a distance.
 * The caller can apply its own hysteresis when an object is near a boundary.
 */
export function selectLifeLod(distance: number, profile: LifeLodProfile): LifeLodTier {
  const safeDistance = Math.max(0, distance);
  if (safeDistance < Math.max(0, profile.individualDistance)) return 'individual';
  if (safeDistance < Math.max(profile.individualDistance, profile.groupDistance)) return 'group';
  if (safeDistance < Math.max(profile.groupDistance, profile.ambientDistance)) return 'ambient';
  return 'hidden';
}

export function normalizeLifeLodProfile(profile: LifeLodProfile): LifeLodProfile {
  const individualDistance = Math.max(0, profile.individualDistance);
  const groupDistance = Math.max(individualDistance, profile.groupDistance);
  const ambientDistance = Math.max(groupDistance, profile.ambientDistance);
  return { individualDistance, groupDistance, ambientDistance };
}
