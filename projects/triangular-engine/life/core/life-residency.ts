import type { LifeVector3 } from './life-vector';

export type LifeInterestKind = 'camera' | 'interaction' | 'tracked';
export type LifeCellResidency = 'active' | 'resident' | 'aggregate' | 'dormant';

export interface LifeInterestSource {
  readonly kind: LifeInterestKind;
  readonly position: LifeVector3;
  /** Optional override for this source's persistence radius. */
  readonly radius?: number;
}

export interface LifeResidencyPolicy {
  readonly cellSize: number;
  readonly cameraActiveDistance: number;
  readonly cameraAggregateDistance: number;
  readonly interactionDistance: number;
  readonly trackedDistance: number;
}

export interface LifeCellCoordinate {
  readonly x: number;
  readonly z: number;
}

/** Converts world coordinates into stable, streamable population-cell keys. */
export function lifeCellCoordinate(position: LifeVector3, cellSize: number): LifeCellCoordinate {
  const size = Math.max(1e-3, cellSize);
  return { x: Math.floor(position.x / size), z: Math.floor(position.z / size) };
}

export function lifeCellKey(cell: LifeCellCoordinate): string {
  return `${cell.x}:${cell.z}`;
}

export function lifeCellCenter(cell: LifeCellCoordinate, cellSize: number): LifeVector3 {
  const size = Math.max(1e-3, cellSize);
  return { x: (cell.x + 0.5) * size, y: 0, z: (cell.z + 0.5) * size };
}

/** Returns cells in stable order; consumers can sample/reconstruct each cell independently. */
export function enumerateLifeCellsInRadius(
  center: LifeVector3,
  radius: number,
  cellSize: number,
): LifeCellCoordinate[] {
  const size = Math.max(1e-3, cellSize);
  const origin = lifeCellCoordinate(center, size);
  const count = Math.ceil(Math.max(0, radius) / size) + 1;
  const cells: LifeCellCoordinate[] = [];
  for (let z = origin.z - count; z <= origin.z + count; z++) {
    for (let x = origin.x - count; x <= origin.x + count; x++) {
      const cell = { x, z };
      const cellCenter = lifeCellCenter(cell, size);
      if (Math.hypot(cellCenter.x - center.x, cellCenter.z - center.z) <= radius + size * 0.707) cells.push(cell);
    }
  }
  return cells.sort((a, b) => a.z - b.z || a.x - b.x);
}

/**
 * Combines independent interests. Camera distance controls rendering; tracked
 * and interaction sources keep cells resident even when the camera is elsewhere.
 */
export function classifyLifeCellResidency(
  cellCenter: LifeVector3,
  sources: readonly LifeInterestSource[],
  policy: LifeResidencyPolicy,
): LifeCellResidency {
  let aggregate = false;
  for (const source of sources) {
    const distance = Math.hypot(cellCenter.x - source.position.x, cellCenter.z - source.position.z);
    const radius = Math.max(0, source.radius ?? 0);
    if (source.kind === 'tracked' && distance <= Math.max(policy.trackedDistance, radius)) return 'resident';
    if (source.kind === 'interaction' && distance <= Math.max(policy.interactionDistance, radius)) return 'resident';
    if (source.kind === 'camera') {
      if (distance <= Math.max(policy.cameraActiveDistance, radius)) return 'active';
      if (distance <= Math.max(policy.cameraAggregateDistance, radius)) aggregate = true;
    }
  }
  return aggregate ? 'aggregate' : 'dormant';
}
