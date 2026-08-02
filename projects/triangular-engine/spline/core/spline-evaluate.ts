import { ISplineDefinition, ISplinePoint } from './spline-definition';
import {
  addVec3,
  lengthVec3,
  lerpVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  SplineVector3,
} from './spline-math';

/** Position and tangent at one raw parameter value. */
export interface ISplineSample {
  readonly position: SplineVector3;
  readonly tangent: SplineVector3;
  /** Segment-count-scaled parameter: floor(rawParameter) is the segment index. */
  readonly rawParameter: number;
}

/** Number of curve segments: `points.length - 1` open, `points.length` closed (the wrap segment). */
export function getSplineSegmentCount(definition: ISplineDefinition): number {
  return definition.closed
    ? definition.points.length
    : definition.points.length - 1;
}

function pointAt(definition: ISplineDefinition, index: number): ISplinePoint {
  const n = definition.points.length;
  return definition.points[((index % n) + n) % n];
}

/** Absolute outgoing Bezier control point for the point at `index`, resolving the auto fallback. */
function resolveHandleOut(
  definition: ISplineDefinition,
  index: number,
): SplineVector3 {
  const point = pointAt(definition, index);
  if (point.handleOut) return addVec3(point.position, point.handleOut);
  const next = pointAt(definition, index + 1);
  return addVec3(point.position, scaleVec3(subVec3(next.position, point.position), 1 / 3));
}

/** Absolute incoming Bezier control point for the point at `index`, resolving the auto fallback. */
function resolveHandleIn(
  definition: ISplineDefinition,
  index: number,
): SplineVector3 {
  const point = pointAt(definition, index);
  if (point.handleIn) return addVec3(point.position, point.handleIn);
  const prev = pointAt(definition, index - 1);
  return addVec3(point.position, scaleVec3(subVec3(prev.position, point.position), 1 / 3));
}

function splitRawParameter(
  definition: ISplineDefinition,
  rawParameter: number,
): { segmentIndex: number; localU: number } {
  const segmentCount = getSplineSegmentCount(definition);
  const clamped = Math.min(Math.max(rawParameter, 0), segmentCount);
  const segmentIndex = Math.min(Math.floor(clamped), segmentCount - 1);
  return { segmentIndex, localU: clamped - segmentIndex };
}

function evaluateLinearSegment(
  definition: ISplineDefinition,
  segmentIndex: number,
  localU: number,
): { position: SplineVector3; tangent: SplineVector3 } {
  const p0 = pointAt(definition, segmentIndex).position;
  const p1 = pointAt(definition, segmentIndex + 1).position;
  return { position: lerpVec3(p0, p1, localU), tangent: normalizeVec3(subVec3(p1, p0)) };
}

function cubicBezierPosition(
  c0: SplineVector3,
  c1: SplineVector3,
  c2: SplineVector3,
  c3: SplineVector3,
  u: number,
): SplineVector3 {
  const oneMinusU = 1 - u;
  const a = oneMinusU * oneMinusU * oneMinusU;
  const b = 3 * oneMinusU * oneMinusU * u;
  const c = 3 * oneMinusU * u * u;
  const d = u * u * u;
  return [
    a * c0[0] + b * c1[0] + c * c2[0] + d * c3[0],
    a * c0[1] + b * c1[1] + c * c2[1] + d * c3[1],
    a * c0[2] + b * c1[2] + c * c2[2] + d * c3[2],
  ];
}

function cubicBezierDerivative(
  c0: SplineVector3,
  c1: SplineVector3,
  c2: SplineVector3,
  c3: SplineVector3,
  u: number,
): SplineVector3 {
  const oneMinusU = 1 - u;
  const a = 3 * oneMinusU * oneMinusU;
  const b = 6 * oneMinusU * u;
  const c = 3 * u * u;
  return [
    a * (c1[0] - c0[0]) + b * (c2[0] - c1[0]) + c * (c3[0] - c2[0]),
    a * (c1[1] - c0[1]) + b * (c2[1] - c1[1]) + c * (c3[1] - c2[1]),
    a * (c1[2] - c0[2]) + b * (c2[2] - c1[2]) + c * (c3[2] - c2[2]),
  ];
}

const TANGENT_DEGENERACY_EPSILON = 1e-12;
const CENTRAL_DIFFERENCE_DELTA = 1e-4;

function evaluateBezierSegment(
  definition: ISplineDefinition,
  segmentIndex: number,
  localU: number,
): { position: SplineVector3; tangent: SplineVector3 } {
  const c0 = pointAt(definition, segmentIndex).position;
  const c1 = resolveHandleOut(definition, segmentIndex);
  const c2 = resolveHandleIn(definition, segmentIndex + 1);
  const c3 = pointAt(definition, segmentIndex + 1).position;

  const position = cubicBezierPosition(c0, c1, c2, c3, localU);
  let derivative = cubicBezierDerivative(c0, c1, c2, c3, localU);

  if (!(lengthVec3(derivative) > TANGENT_DEGENERACY_EPSILON)) {
    const uBack = Math.max(0, localU - CENTRAL_DIFFERENCE_DELTA);
    const uFwd = Math.min(1, localU + CENTRAL_DIFFERENCE_DELTA);
    const posBack = cubicBezierPosition(c0, c1, c2, c3, uBack);
    const posFwd = cubicBezierPosition(c0, c1, c2, c3, uFwd);
    derivative = subVec3(posFwd, posBack);
  }

  return { position, tangent: normalizeVec3(derivative) };
}

function evaluateSegment(
  definition: ISplineDefinition,
  segmentIndex: number,
  localU: number,
): { position: SplineVector3; tangent: SplineVector3 } {
  switch (definition.interpolation) {
    case 'linear':
      return evaluateLinearSegment(definition, segmentIndex, localU);
    case 'bezier':
      return evaluateBezierSegment(definition, segmentIndex, localU);
    case 'catmullRom':
      throw new Error('Catmull-Rom evaluation lands in Phase 0B.');
  }
}

/**
 * Evaluates position and tangent at a raw parameter, where `floor(rawParameter)`
 * is the segment index and the fractional part is the local segment parameter.
 * This is the low-level curve basis; public arc-length-based sampling is built
 * on top of it in `spline-arc-length.ts`.
 */
export function evaluateAtRawParameter(
  definition: ISplineDefinition,
  rawParameter: number,
): ISplineSample {
  if (!Number.isFinite(rawParameter)) {
    throw new RangeError('Raw spline parameter must be finite.');
  }
  const { segmentIndex, localU } = splitRawParameter(definition, rawParameter);
  const { position, tangent } = evaluateSegment(definition, segmentIndex, localU);
  return { position, tangent, rawParameter: segmentIndex + localU };
}
