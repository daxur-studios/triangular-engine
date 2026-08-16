import { AnimalVector3 } from './animal-types';

/** A consumer-provided place on which an animal may land. */
export interface AnimalPerchAffordance {
  id: string;
  position: AnimalVector3;
  /** Occupied or otherwise unavailable perches are ignored. Defaults to true. */
  available?: boolean;
}

/**
 * Chooses the nearest available perch without depending on input order.
 * The world adapter authors or discovers the sockets; animals chooses among
 * them. Equal-distance ties use the stable socket ID.
 */
export function selectAnimalPerch(
  position: AnimalVector3,
  perches: readonly AnimalPerchAffordance[],
): AnimalPerchAffordance | undefined {
  let selected: AnimalPerchAffordance | undefined;
  let selectedDistanceSquared = Number.POSITIVE_INFINITY;

  for (const perch of perches) {
    validatePerch(perch);
    if (perch.available === false) continue;
    const dx = perch.position.x - position.x;
    const dy = perch.position.y - position.y;
    const dz = perch.position.z - position.z;
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    if (
      distanceSquared < selectedDistanceSquared ||
      (distanceSquared === selectedDistanceSquared &&
        selected !== undefined &&
        perch.id.localeCompare(selected.id) < 0)
    ) {
      selected = perch;
      selectedDistanceSquared = distanceSquared;
    }
  }
  return selected === undefined
    ? undefined
    : { ...selected, position: { ...selected.position } };
}

function validatePerch(perch: AnimalPerchAffordance): void {
  if (perch.id.length === 0) throw new Error('Animal perch ID cannot be empty.');
  if (
    !Number.isFinite(perch.position.x) ||
    !Number.isFinite(perch.position.y) ||
    !Number.isFinite(perch.position.z)
  ) {
    throw new Error(`Animal perch position must be finite: ${perch.id}`);
  }
}
