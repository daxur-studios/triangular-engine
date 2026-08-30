import { Matrix4, Quaternion, Vector3 } from 'three';
import { computeCrossSectionTotalWidth, ICityCrossSection } from '../core/city-transit-types';
import { IClassifiedRoadSpan } from '../terrain/road-terrain-adapter';

export type RoadColliderShape = 'box' | 'cylinder';

/**
 * Jolt- and Scatter-compatible primitive collider descriptor for road/bridge spans.
 */
export interface IRoadColliderDescriptor {
  readonly id: string;
  readonly spanId: string;
  readonly shape: RoadColliderShape;
  /**
   * Params matching Jolt / Scatter adapters:
   * - box: [width (lateral), height (vertical slab), depth (along road)]
   * - cylinder: [halfHeight, radius]
   */
  readonly params: readonly number[];
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number]; // [x, y, z, w]
}

export interface IRoadColliderOptions {
  readonly thicknessM?: number;
  readonly bridgeDeckThicknessM?: number;
  readonly pierRadiusM?: number;
}

/**
 * Synthesizes Jolt primitive collider descriptors along a classified road or bridge span.
 *
 * Dimension convention:
 *   - `params[0]` = total cross-section width (lateral, across the road)
 *   - `params[1]` = slab thickness (vertical)
 *   - `params[2]` = segment length (along road direction)
 *
 * Uses a right-handed basis [left, trueUp, forward] with det = +1 so that:
 *   - Local +X (width) maps to the lateral left/right direction across the road
 *   - Local +Y (thickness) maps to trueUp
 *   - Local +Z (length) maps to the forward road segment direction
 */
export function deriveRoadSpanColliders(
  span: IClassifiedRoadSpan,
  crossSection: ICityCrossSection,
  options: IRoadColliderOptions = {},
): readonly IRoadColliderDescriptor[] {
  const colliders: IRoadColliderDescriptor[] = [];
  const points = span.roadPoints;
  if (points.length < 2) return colliders;

  const totalWidthM = computeCrossSectionTotalWidth(crossSection);
  const deckThickness = options.bridgeDeckThicknessM ?? 1.4;

  // Surface roads: 1.2m slab gives sensible physics footprint and debug visibility.
  // Bridge deck: use bridgeDeckThicknessM.
  // Tunnel: 0.5m thin.
  const thicknessM =
    options.thicknessM ??
    (span.type === 'bridge' ? deckThickness : span.type === 'tunnel' ? 0.5 : 1.2);

  const pierRadiusM = options.pierRadiusM ?? 1.0;

  // 1. Box colliders for each linear segment along road corridor
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = new Vector3(points[i][0], points[i][1], points[i][2]);
    const p1 = new Vector3(points[i + 1][0], points[i + 1][1], points[i + 1][2]);

    const segVector = new Vector3().subVectors(p1, p0);
    const segLength = segVector.length();
    if (segLength < 1e-3) continue;

    const midPoint = new Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    // Shift down so the TOP face of the slab is flush with the road surface centerline
    midPoint.y -= thicknessM * 0.5;

    // Right-handed basis (det = +1):
    //   Basis X = left = worldUp x forward
    //   Basis Y = trueUp = forward x left
    //   Basis Z = forward
    const forward = segVector.clone().normalize();
    const worldUp = new Vector3(0, 1, 0);
    const left = new Vector3().crossVectors(worldUp, forward);

    if (left.lengthSq() < 1e-6) {
      left.set(0, 0, 1); // vertical road: fallback
    } else {
      left.normalize();
    }

    const trueUp = new Vector3().crossVectors(forward, left).normalize();

    const quat = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(left, trueUp, forward),
    );

    colliders.push({
      id: `${span.spanId}_deck_seg_${i}`,
      spanId: span.spanId,
      shape: 'box',
      params: [totalWidthM, thicknessM, segLength],
      position: [midPoint.x, midPoint.y, midPoint.z],
      rotation: [quat.x, quat.y, quat.z, quat.w],
    });
  }

  // 2. Pier colliders for bridges
  if (span.type === 'bridge' && span.pierPositions) {
    for (let i = 0; i < span.pierPositions.length; i++) {
      const pier = span.pierPositions[i];
      const pierMidY = (pier.deckPosition[1] + pier.groundPosition[1]) * 0.5;
      const pierHeight = Math.max(0.5, pier.heightM);

      colliders.push({
        id: `${span.spanId}_pier_${i}`,
        spanId: span.spanId,
        shape: 'cylinder',
        params: [pierHeight * 0.5, pierRadiusM], // [halfHeight, radius]
        position: [pier.deckPosition[0], pierMidY, pier.deckPosition[2]],
        rotation: [0, 0, 0, 1],
      });
    }
  }

  return colliders;
}
