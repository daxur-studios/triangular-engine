import type { LifeVector3 } from './life-vector';

export interface LifeRouteSegment {
  readonly from: LifeVector3;
  readonly to: LifeVector3;
  /** Travel time in universal seconds. Must be greater than zero. */
  readonly durationSeconds: number;
}

export interface LifeDeterministicRoute {
  readonly segments: readonly LifeRouteSegment[];
  /** Closed routes continue from the final segment back to the first. */
  readonly closed?: boolean;
}

export interface LifeRouteSample {
  readonly position: LifeVector3;
  readonly heading: LifeVector3;
  readonly segmentIndex: number;
  readonly progress01: number;
  readonly complete: boolean;
}

/**
 * Evaluates a route directly from universal time. It never integrates from a
 * previous frame, so rewind, fast-forward, and time warp produce identical
 * results. Route construction/planning remains the responsibility of the
 * game's terrain and habitat adapter.
 */
export function sampleLifeRouteAtTime(
  route: LifeDeterministicRoute,
  universalTimeSeconds: number,
): LifeRouteSample {
  if (route.segments.length === 0) {
    return {
      position: { x: 0, y: 0, z: 0 },
      heading: { x: 0, y: 0, z: 0 },
      segmentIndex: -1,
      progress01: 0,
      complete: true,
    };
  }

  const totalDuration = route.segments.reduce(
    (total, segment) => total + Math.max(1e-6, segment.durationSeconds),
    0,
  );
  const isClosed = route.closed === true;
  const time = isClosed
    ? positiveModulo(universalTimeSeconds, totalDuration)
    : Math.max(0, Math.min(universalTimeSeconds, totalDuration));

  let elapsed = 0;
  for (let index = 0; index < route.segments.length; index++) {
    const segment = route.segments[index];
    const duration = Math.max(1e-6, segment.durationSeconds);
    const isLast = index === route.segments.length - 1;
    if (time <= elapsed + duration || isLast) {
      const progress01 = Math.max(0, Math.min(1, (time - elapsed) / duration));
      const eased = smoothstep(progress01);
      const position = interpolate(segment.from, segment.to, eased);
      return {
        position,
        heading: normalize({
          x: segment.to.x - segment.from.x,
          y: segment.to.y - segment.from.y,
          z: segment.to.z - segment.from.z,
        }),
        segmentIndex: index,
        progress01,
        complete: !isClosed && isLast && progress01 >= 1,
      };
    }
    elapsed += duration;
  }

  return sampleLifeRouteAtTime(route, totalDuration);
}

function interpolate(from: LifeVector3, to: LifeVector3, blend: number): LifeVector3 {
  return {
    x: from.x + (to.x - from.x) * blend,
    y: from.y + (to.y - from.y) * blend,
    z: from.z + (to.z - from.z) * blend,
  };
}

function normalize(vector: LifeVector3): LifeVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= 1e-8) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
