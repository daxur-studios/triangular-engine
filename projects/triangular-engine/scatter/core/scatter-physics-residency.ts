export type ScatterVector3Tuple = readonly [number, number, number];

export interface IScatterPhysicsAnchorOptions {
  readonly positionM: ScatterVector3Tuple;
  readonly velocityMps: ScatterVector3Tuple;
  /** Ring centre is pushed this far along velocity, so a fast vehicle never outruns its colliders. */
  readonly lookAheadSeconds: number;
  /** Clamps the look-ahead offset so a very fast vehicle doesn't drag the ring off its own position entirely. */
  readonly maxLookAheadM: number;
}

function magnitude(v: ScatterVector3Tuple): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/**
 * Physics residency follows the player/vehicle with velocity look-ahead —
 * never the camera, and never the same anchor as render batching. See
 * docs/runbook/005_scatter_sublibrary.md, "Three groupings that must never
 * be conflated."
 */
export function computeScatterPhysicsAnchor(
  options: IScatterPhysicsAnchorOptions,
): ScatterVector3Tuple {
  if (
    !options.positionM.every(Number.isFinite) ||
    !options.velocityMps.every(Number.isFinite) ||
    !Number.isFinite(options.lookAheadSeconds) ||
    options.lookAheadSeconds < 0 ||
    !Number.isFinite(options.maxLookAheadM) ||
    options.maxLookAheadM < 0
  ) {
    throw new RangeError('Scatter physics anchor options are invalid.');
  }

  const speed = magnitude(options.velocityMps);
  if (speed === 0) return options.positionM;

  const rawOffsetM = speed * options.lookAheadSeconds;
  const offsetM = Math.min(rawOffsetM, options.maxLookAheadM);
  const scale = offsetM / speed;

  return [
    options.positionM[0] + options.velocityMps[0] * scale,
    options.positionM[1] + options.velocityMps[1] * scale,
    options.positionM[2] + options.velocityMps[2] * scale,
  ];
}

export interface IScatterResidencyCandidate {
  readonly key: string;
  readonly centreWorldM: ScatterVector3Tuple;
}

export interface IScatterResidencyDiffOptions {
  readonly residentKeys: ReadonlySet<string>;
  readonly candidates: readonly IScatterResidencyCandidate[];
  readonly anchorWorldM: ScatterVector3Tuple;
  readonly addRadiusM: number;
  /** Must be > addRadiusM; the gap between the two is the ring's hysteresis band. */
  readonly removeRadiusM: number;
}

export interface IScatterResidencyDiff {
  readonly toAdd: readonly string[];
  readonly toRemove: readonly string[];
  readonly residentKeys: ReadonlySet<string>;
}

function distanceM(a: ScatterVector3Tuple, b: ScatterVector3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Diffs a candidate cell set against the currently resident set using
 * asymmetric add/remove radii. The gap between them is mandatory: without
 * it, a vehicle sitting exactly on a boundary would rebuild colliders every
 * frame. Cell selection itself still comes from the shared
 * selectFixedLevelScatterCells (terrain patch addressing) — this only
 * decides which of those candidates currently have physics.
 */
export function diffScatterPhysicsResidency(
  options: IScatterResidencyDiffOptions,
): IScatterResidencyDiff {
  if (
    !Number.isFinite(options.addRadiusM) ||
    options.addRadiusM < 0 ||
    !Number.isFinite(options.removeRadiusM) ||
    options.removeRadiusM <= options.addRadiusM
  ) {
    throw new RangeError(
      'Scatter physics residency radii are invalid: removeRadiusM must be greater than addRadiusM.',
    );
  }

  const candidatesByKey = new Map(
    options.candidates.map((candidate) => [candidate.key, candidate] as const),
  );

  const residentKeys = new Set(options.residentKeys);
  const toAdd: string[] = [];
  const toRemove: string[] = [];

  for (const candidate of options.candidates) {
    if (residentKeys.has(candidate.key)) continue;
    if (distanceM(candidate.centreWorldM, options.anchorWorldM) <= options.addRadiusM) {
      toAdd.push(candidate.key);
      residentKeys.add(candidate.key);
    }
  }

  for (const key of options.residentKeys) {
    const candidate = candidatesByKey.get(key);
    const outOfRange =
      !candidate ||
      distanceM(candidate.centreWorldM, options.anchorWorldM) > options.removeRadiusM;
    if (outOfRange) {
      toRemove.push(key);
      residentKeys.delete(key);
    }
  }

  return { toAdd, toRemove, residentKeys };
}
