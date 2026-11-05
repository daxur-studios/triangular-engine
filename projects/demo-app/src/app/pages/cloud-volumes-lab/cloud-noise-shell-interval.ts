/**
 * The parts of a view ray that lie inside the cloud shell (between two concentric spheres) and are not hidden by the
 * planet. This is the plain-TypeScript twin of the interval logic in `CloudNoiseShell`'s shader; the spec checks it, and
 * the shader must keep the same rules.
 *
 * Distances are along the ray from the camera; `end <= start` means an empty interval.
 */
export interface ShellInterval {
  readonly start: number;
  readonly end: number;
}

/** A ray crosses the shell once, or twice when it dips under the cloud floor and climbs back into the shell. */
export interface ShellIntervals {
  readonly near: ShellInterval;
  readonly far: ShellInterval;
}

const EMPTY: ShellInterval = { start: 0, end: 0 };

/**
 * @param origin camera position relative to the planet centre
 * @param dir unit view direction
 */
export function shellIntervals(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  planetRadius: number,
  innerRadius: number,
  outerRadius: number,
): ShellIntervals {
  const b = origin[0] * dir[0] + origin[1] * dir[1] + origin[2] * dir[2];
  const oo = origin[0] * origin[0] + origin[1] * origin[1] + origin[2] * origin[2];
  const outerDisc = b * b - (oo - outerRadius * outerRadius);
  if (outerDisc <= 0) return { near: EMPTY, far: EMPTY };
  const outerRoot = Math.sqrt(outerDisc);
  const outerNear = -b - outerRoot;
  const outerFar = -b + outerRoot;
  if (outerFar <= 0) return { near: EMPTY, far: EMPTY };

  const innerDisc = b * b - (oo - innerRadius * innerRadius);
  const innerRoot = Math.sqrt(Math.max(innerDisc, 0));
  const innerNear = -b - innerRoot;
  const innerFar = -b + innerRoot;
  const belowFloor = oo <= innerRadius * innerRadius;

  // The planet hides anything beyond its surface.
  const planetDisc = b * b - (oo - planetRadius * planetRadius);
  const planetNear = planetDisc > 0 ? -b - Math.sqrt(planetDisc) : Infinity;
  const planetHit = planetDisc > 0 && planetNear > 0;
  const clip = (start: number, end: number): ShellInterval => {
    const e = planetHit ? Math.min(end, planetNear) : end;
    return e > start ? { start, end: e } : EMPTY;
  };

  if (belowFloor) {
    // Camera under the cloud floor: the shell begins where the ray climbs out of the inner sphere.
    return { near: clip(Math.max(innerFar, 0), outerFar), far: EMPTY };
  }
  const start = Math.max(outerNear, 0);
  const dips = innerDisc > 0 && innerNear > start;
  const near = clip(start, dips ? innerNear : outerFar);
  // Dipping under the floor and not hitting the planet: the ray climbs back into the shell further on.
  const far = dips && !planetHit ? clip(innerFar, outerFar) : EMPTY;
  return { near, far };
}
