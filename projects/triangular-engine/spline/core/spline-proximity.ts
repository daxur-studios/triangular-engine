import { computeSplineExtent, ISplineDefinition } from './spline-definition';
import { evaluateAtRawParameter, getSplineSegmentCount } from './spline-evaluate';
import { distanceVec3, SplineVector3 } from './spline-math';
import { getSplineArcLengthTable } from './spline-arc-length';
import {
  computeDefaultTolerances,
  DEFAULT_SPLINE_TOLERANCES,
  ISplineTolerances,
} from './spline-tolerances';

/**
 * Nearest point on the spline to an arbitrary field-space position. Unsigned
 * — see decision 1 in `008_spline_sublibrary.md`. Signed lateral offset and
 * containment need a caller-supplied reference normal and live alongside the
 * surface adapter, not here.
 */
export interface ISplineProximity {
  readonly distance: number;
  readonly arcLength: number;
  /** Global arc-normalized parameter in [0,1]. */
  readonly t: number;
  readonly point: SplineVector3;
  readonly tangent: SplineVector3;
  readonly segmentIndex: number;
}

export interface IClosestPointOptions {
  readonly samplesPerSegment?: number;
  readonly tolerances?: ISplineTolerances;
}

const DEFAULT_SAMPLES_PER_SEGMENT = 64;
const REFINEMENT_ITERATIONS = 32;
/** Distance ties are broken by iteration order (lowest rawParameter first); this guards float noise. */
const TIE_EPSILON = 1e-12;

function resolveTolerances(
  definition: ISplineDefinition,
  tolerances?: ISplineTolerances,
): ISplineTolerances {
  if (tolerances) return tolerances;
  const extent = computeSplineExtent(definition.points);
  return extent > 0 ? computeDefaultTolerances(extent) : DEFAULT_SPLINE_TOLERANCES;
}

function distanceAtRawParameter(
  definition: ISplineDefinition,
  rawParameter: number,
  position: SplineVector3,
): number {
  return distanceVec3(position, evaluateAtRawParameter(definition, rawParameter).position);
}

/**
 * Ternary-search refinement of a unimodal distance-to-curve window. Fixed
 * iteration count rather than a tolerance-based stop: simple to verify by
 * inspection, which matters for a function whose whole purpose is being an
 * obviously-correct reference (Phase 0C's BVH-accelerated solver is checked
 * against this one, not the other way around).
 */
function refine(
  definition: ISplineDefinition,
  position: SplineVector3,
  lo: number,
  hi: number,
): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < REFINEMENT_ITERATIONS; i++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (distanceAtRawParameter(definition, m1, position) <= distanceAtRawParameter(definition, m2, position)) {
      b = m2;
    } else {
      a = m1;
    }
  }
  return (a + b) / 2;
}

/**
 * Deliberately naive dense-sampling nearest-point search, not the segment
 * BVH — see decision 4 and the Phase 0A/0C split. This is the correctness
 * oracle every later acceleration is validated against.
 */
export function closestPoint(
  definition: ISplineDefinition,
  position: SplineVector3,
  options?: IClosestPointOptions,
): ISplineProximity {
  const segmentCount = getSplineSegmentCount(definition);
  const samplesPerSegment = options?.samplesPerSegment ?? DEFAULT_SAMPLES_PER_SEGMENT;
  const totalSamples = segmentCount * samplesPerSegment;
  const step = segmentCount / totalSamples;

  let bestRawParameter = 0;
  let bestDistance = Infinity;
  for (let i = 0; i <= totalSamples; i++) {
    const rawParameter = Math.min(i * step, segmentCount);
    const distance = distanceAtRawParameter(definition, rawParameter, position);
    if (distance < bestDistance - TIE_EPSILON) {
      bestDistance = distance;
      bestRawParameter = rawParameter;
    }
  }

  const refinedRawParameter = refine(
    definition,
    position,
    Math.max(0, bestRawParameter - step),
    Math.min(segmentCount, bestRawParameter + step),
  );

  const sample = evaluateAtRawParameter(definition, refinedRawParameter);
  const tolerances = resolveTolerances(definition, options?.tolerances);
  const table = getSplineArcLengthTable(definition, tolerances);
  const arcLength = table.distanceAt(refinedRawParameter);
  const t = table.totalLength > 0 ? arcLength / table.totalLength : 0;
  const segmentIndex = Math.min(Math.floor(refinedRawParameter), segmentCount - 1);

  return {
    distance: distanceVec3(position, sample.position),
    arcLength,
    t,
    point: sample.position,
    tangent: sample.tangent,
    segmentIndex,
  };
}
