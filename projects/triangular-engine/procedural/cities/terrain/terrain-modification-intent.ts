export type TerrainModificationKind =
  | 'cut-and-fill'
  | 'terrace'
  | 'tunnel-bore'
  | 'flatten-polygon';

/**
 * Geometric request from a road, parcel, or anchor structure to modify terrain elevation.
 */
export interface ITerrainModificationIntent {
  readonly id: string;
  readonly kind: TerrainModificationKind;
  /** Centerline vertices [x, y, z] for corridor operations. */
  readonly corridorCenterline?: readonly (readonly [number, number, number])[];
  /** Flat width of the road/rail corridor in meters. */
  readonly corridorWidthM?: number;
  /** Distance in meters over which the graded road elevation blends smoothly back to native terrain. */
  readonly blendDistanceM?: number;
  /** Uniform target elevation (for flatten-polygon or single-level terrace). */
  readonly targetElevation?: number;
  /** 2D footprint boundary [x, z] for polygon flattening or terrace slabs. */
  readonly polygon?: readonly (readonly [number, number])[];
  /** Maximum allowable bank slope in degrees (e.g. 45 deg). */
  readonly maxBankSlopeDegrees?: number;
}

/**
 * Distance from 2D point (px, pz) to 2D line segment (ax, az) -> (bx, bz).
 */
function pointToSegmentDistance2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { dist: number; t: number; projX: number; projZ: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;

  if (lenSq < 1e-8) {
    const d = Math.sqrt((px - ax) ** 2 + (pz - az) ** 2);
    return { dist: d, t: 0, projX: ax, projZ: az };
  }

  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * dx;
  const projZ = az + t * dz;
  const dist = Math.sqrt((px - projX) ** 2 + (pz - projZ) ** 2);

  return { dist, t, projX, projZ };
}

/**
 * Evaluates the graded height of a point (x, z) against a corridor cut-and-fill intent.
 * Smoothly blends between the road spline elevation and the original terrain elevation.
 */
export function evaluateCorridorGrading(
  nativeElevation: number,
  intent: ITerrainModificationIntent,
  x: number,
  z: number,
): number {
  if (
    intent.kind !== 'cut-and-fill' ||
    !intent.corridorCenterline ||
    intent.corridorCenterline.length < 2
  ) {
    return nativeElevation;
  }

  const halfWidth = (intent.corridorWidthM ?? 10) * 0.5;
  const blendDist = Math.max(0.1, intent.blendDistanceM ?? 5);
  const totalInfluenceRadius = halfWidth + blendDist;

  const points = intent.corridorCenterline;
  let minDistance = Infinity;
  let targetRoadY = nativeElevation;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];

    const { dist, t } = pointToSegmentDistance2D(
      x,
      z,
      p0[0],
      p0[2],
      p1[0],
      p1[2],
    );

    if (dist < minDistance) {
      minDistance = dist;
      // Interpolate 3D elevation along road segment
      targetRoadY = p0[1] + t * (p1[1] - p0[1]);
    }
  }

  if (minDistance > totalInfluenceRadius) {
    return nativeElevation;
  }

  if (minDistance <= halfWidth) {
    return targetRoadY;
  }

  // Smooth Hermite / cosine blend across transition zone
  const alpha = (minDistance - halfWidth) / blendDist; // 0 at road edge, 1 at natural terrain
  // Smoothstep s-curve: 3a^2 - 2a^3
  const smoothAlpha = alpha * alpha * (3 - 2 * alpha);

  return targetRoadY * (1 - smoothAlpha) + nativeElevation * smoothAlpha;
}

/**
 * Computes volumetric cut (earth removal) and fill (earth embankment) over a region.
 */
export function calculateCutFillVolume(
  sampleNativeElevationFn: (x: number, z: number) => number,
  intent: ITerrainModificationIntent,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  stepM = 1.0,
): { cutM3: number; fillM3: number } {
  let cutVolume = 0;
  let fillVolume = 0;
  const cellArea = stepM * stepM;

  for (let x = bounds.minX; x <= bounds.maxX; x += stepM) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += stepM) {
      const nativeY = sampleNativeElevationFn(x, z);
      const gradedY = evaluateCorridorGrading(nativeY, intent, x, z);
      const diffY = gradedY - nativeY;

      if (diffY > 0) {
        fillVolume += diffY * cellArea;
      } else if (diffY < 0) {
        cutVolume += Math.abs(diffY) * cellArea;
      }
    }
  }

  return {
    cutM3: cutVolume,
    fillM3: fillVolume,
  };
}
