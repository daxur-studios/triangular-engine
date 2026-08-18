import {
  Vec3d,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Sub,
} from '../math/vec3';

/** A spherical luminous body represented in a shared inertial frame. */
export interface ILuminousDisc {
  readonly bodyId: string;
  readonly centerM: Vec3d;
  readonly radiusM: number;
}

/** A spherical body that may occlude a luminous disc. */
export interface IOccludingDisc {
  readonly bodyId: string;
  readonly centerM: Vec3d;
  readonly radiusM: number;
}

/** Coverage of one apparent occluder on the luminous body's apparent disc. */
export interface IOccluderCoverage {
  readonly bodyId: string;
  readonly angularRadiusRad: number;
  readonly centerSeparationRad: number;
  readonly coveredFraction01: number;
}

/** Apparent-disc visibility for one luminous source and its candidate occluders. */
export interface ICelestialOcclusionState {
  readonly sourceBodyId: string;
  readonly visibleFraction01: number;
  readonly angularRadiusRad: number;
  readonly occluders: readonly IOccluderCoverage[];
}

const EPSILON = 1e-12;

/**
 * Computes how much of a luminous sphere is visible from an observer.
 *
 * The calculation is angular, so it remains valid from a planet surface,
 * orbit, or interplanetary space without a planetary shadow map. Multiple
 * occluders use a bounded coverage sum; the result is always clamped.
 */
export function celestialOcclusion(
  observerPositionM: Vec3d,
  source: ILuminousDisc,
  occluders: readonly IOccludingDisc[],
): ICelestialOcclusionState {
  const sourceToObserver = vec3Sub(source.centerM, observerPositionM);
  const sourceDistanceM = vec3Length(sourceToObserver);
  const sourceAngularRadiusRad = apparentAngularRadius(
    source.radiusM,
    sourceDistanceM,
  );
  if (sourceDistanceM <= EPSILON || sourceAngularRadiusRad <= EPSILON) {
    return {
      sourceBodyId: source.bodyId,
      visibleFraction01: 1,
      angularRadiusRad: 0,
      occluders: [],
    };
  }

  const sourceDirection = vec3Normalize(sourceToObserver);
  const sourceDiscArea = Math.PI * sourceAngularRadiusRad ** 2;
  let coveredFraction01 = 0;
  const coverage: IOccluderCoverage[] = [];

  for (const occluder of occluders) {
    if (occluder.bodyId === source.bodyId || occluder.radiusM <= 0) continue;
    const occluderToObserver = vec3Sub(occluder.centerM, observerPositionM);
    const occluderDistanceM = vec3Length(occluderToObserver);
    if (occluderDistanceM <= EPSILON || occluderDistanceM >= sourceDistanceM)
      continue;

    const occluderAngularRadiusRad = apparentAngularRadius(
      occluder.radiusM,
      occluderDistanceM,
    );
    const direction = vec3Normalize(occluderToObserver);
    const centerSeparationRad = Math.acos(
      clamp(vec3Dot(sourceDirection, direction), -1, 1),
    );
    const covered = circleOverlapFraction(
      sourceAngularRadiusRad,
      occluderAngularRadiusRad,
      centerSeparationRad,
      sourceDiscArea,
    );
    if (covered <= 0) continue;
    coverage.push({
      bodyId: occluder.bodyId,
      angularRadiusRad: occluderAngularRadiusRad,
      centerSeparationRad,
      coveredFraction01: covered,
    });
    coveredFraction01 = Math.min(1, coveredFraction01 + covered);
  }

  return {
    sourceBodyId: source.bodyId,
    visibleFraction01: 1 - coveredFraction01,
    angularRadiusRad: sourceAngularRadiusRad,
    occluders: coverage,
  };
}

function apparentAngularRadius(radiusM: number, distanceM: number): number {
  return Math.asin(clamp(radiusM / Math.max(distanceM, EPSILON), 0, 1));
}

function circleOverlapFraction(
  sourceRadius: number,
  occluderRadius: number,
  separation: number,
  sourceArea: number,
): number {
  if (separation >= sourceRadius + occluderRadius) return 0;
  if (separation + occluderRadius <= sourceRadius)
    return (Math.PI * occluderRadius ** 2) / sourceArea;
  if (separation + sourceRadius <= occluderRadius) return 1;
  if (separation <= EPSILON)
    return Math.min(
      1,
      (Math.PI * Math.min(sourceRadius, occluderRadius) ** 2) / sourceArea,
    );

  const sourceAngle = Math.acos(
    clamp(
      (separation ** 2 + sourceRadius ** 2 - occluderRadius ** 2) /
        (2 * separation * sourceRadius),
      -1,
      1,
    ),
  );
  const occluderAngle = Math.acos(
    clamp(
      (separation ** 2 + occluderRadius ** 2 - sourceRadius ** 2) /
        (2 * separation * occluderRadius),
      -1,
      1,
    ),
  );
  const triangle =
    0.5 *
    Math.sqrt(
      Math.max(
        0,
        (-separation + sourceRadius + occluderRadius) *
          (separation + sourceRadius - occluderRadius) *
          (separation - sourceRadius + occluderRadius) *
          (separation + sourceRadius + occluderRadius),
      ),
    );
  return clamp(
    (sourceRadius ** 2 * sourceAngle +
      occluderRadius ** 2 * occluderAngle -
      triangle) /
      sourceArea,
    0,
    1,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
