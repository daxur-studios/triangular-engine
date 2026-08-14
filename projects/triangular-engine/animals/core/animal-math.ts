import { AnimalVector3 } from './animal-types';

/** Shared deterministic steering math used by both flocking and single-agent arrival. */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function horizontalUnit(vector: AnimalVector3): { x: number; z: number } {
  const magnitude = Math.hypot(vector.x, vector.z) || 1;
  return { x: vector.x / magnitude, z: vector.z / magnitude };
}

/**
 * Rotates horizontal heading (vx,vz) towards (targetX,targetZ), limited to
 * maxAngle radians. A near-zero current heading (agent not yet moving
 * horizontally) has no existing direction to rotate away from, so it snaps
 * straight to the target heading rather than staying stuck at zero forever.
 */
export function rotateTowards(
  vx: number,
  vz: number,
  targetX: number,
  targetZ: number,
  maxAngle: number,
): { x: number; z: number } {
  const target = horizontalUnit({ x: targetX, y: 0, z: targetZ });
  const currentMagnitude = Math.hypot(vx, vz);
  if (currentMagnitude < 1e-6) return target;
  const current = { x: vx / currentMagnitude, z: vz / currentMagnitude };
  const angle = Math.atan2(
    target.x * current.z - target.z * current.x,
    current.x * target.x + current.z * target.z,
  );
  const turn = clamp(angle, -maxAngle, maxAngle);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { x: current.x * cos + current.z * sin, z: current.z * cos - current.x * sin };
}
