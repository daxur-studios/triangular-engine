import type { LifeVector3 } from './life-vector';

export interface LifePredatorTarget {
  readonly id: string;
  readonly position: LifeVector3;
  /** 0 means unavailable, 1 means fully viable prey. */
  readonly vulnerability01: number;
}

export interface LifePredatorSelectionOptions {
  readonly maxRange?: number;
  readonly minimumVulnerability01?: number;
}

export interface LifePredatorSelection {
  readonly targetId: string | null;
  readonly distance: number;
  readonly hunting: boolean;
}

/** Selects one nearby viable target from a deterministic world snapshot. */
export function selectLifePredatorTarget(
  predatorPosition: LifeVector3,
  targets: readonly LifePredatorTarget[],
  options: LifePredatorSelectionOptions = {},
): LifePredatorSelection {
  const maxRange = Math.max(0, options.maxRange ?? Number.POSITIVE_INFINITY);
  const minimumVulnerability = Math.max(0, Math.min(1, options.minimumVulnerability01 ?? 0));
  let selected: LifePredatorTarget | undefined;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    if (target.vulnerability01 < minimumVulnerability) continue;
    const distance = Math.hypot(
      target.position.x - predatorPosition.x,
      target.position.y - predatorPosition.y,
      target.position.z - predatorPosition.z,
    );
    if (distance > maxRange) continue;
    if (distance < selectedDistance || (distance === selectedDistance && target.id < (selected?.id ?? ''))) {
      selected = target;
      selectedDistance = distance;
    }
  }
  return {
    targetId: selected?.id ?? null,
    distance: selected ? selectedDistance : Number.POSITIVE_INFINITY,
    hunting: selected !== undefined,
  };
}
