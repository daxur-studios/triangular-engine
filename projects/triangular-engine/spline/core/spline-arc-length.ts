import { computeSplineExtent, ISplineDefinition } from './spline-definition';
import { evaluateAtRawParameter, getSplineSegmentCount, ISplineSample } from './spline-evaluate';
import { distanceVec3, lerpVec3, SplineVector3 } from './spline-math';
import {
  computeDefaultTolerances,
  DEFAULT_SPLINE_TOLERANCES,
  ISplineTolerances,
} from './spline-tolerances';

interface IArcLengthEntry {
  readonly rawParameter: number;
  readonly distance: number;
  readonly position: SplineVector3;
}

/**
 * Monotonic lookup table between raw curve parameter and distance along the
 * spline, built once by adaptively flattening every segment to `chordTol`.
 * `entries` is exposed so `spline-proximity.ts` can reuse the flattened
 * polyline instead of re-sampling the curve.
 */
export interface ISplineArcLengthTable {
  readonly totalLength: number;
  readonly entries: readonly IArcLengthEntry[];
  rawParameterAt(distance: number): number;
  distanceAt(rawParameter: number): number;
}

const MAX_SUBDIVISION_DEPTH = 24;
const MIN_LOCAL_STEP = 1e-7;

function flattenSegment(
  definition: ISplineDefinition,
  segmentIndex: number,
  uStart: number,
  uEnd: number,
  posStart: SplineVector3,
  posEnd: SplineVector3,
  chordTol: number,
  depth: number,
  emit: (rawParameter: number, position: SplineVector3) => void,
): void {
  if (depth >= MAX_SUBDIVISION_DEPTH || uEnd - uStart < MIN_LOCAL_STEP) {
    emit(segmentIndex + uEnd, posEnd);
    return;
  }
  const uMid = (uStart + uEnd) / 2;
  const posMid = evaluateAtRawParameter(definition, segmentIndex + uMid).position;
  const chordMid = lerpVec3(posStart, posEnd, 0.5);
  const deviation = distanceVec3(posMid, chordMid);

  if (deviation <= chordTol) {
    emit(segmentIndex + uEnd, posEnd);
    return;
  }

  flattenSegment(definition, segmentIndex, uStart, uMid, posStart, posMid, chordTol, depth + 1, emit);
  flattenSegment(definition, segmentIndex, uMid, uEnd, posMid, posEnd, chordTol, depth + 1, emit);
}

function resolveTolerances(
  definition: ISplineDefinition,
  tolerances?: ISplineTolerances,
): ISplineTolerances {
  if (tolerances) return tolerances;
  const extent = computeSplineExtent(definition.points);
  return extent > 0 ? computeDefaultTolerances(extent) : DEFAULT_SPLINE_TOLERANCES;
}

/** Builds a fresh adaptive arc-length table. Prefer `getSplineArcLengthTable` for repeated queries. */
export function buildSplineArcLengthTable(
  definition: ISplineDefinition,
  tolerances?: ISplineTolerances,
): ISplineArcLengthTable {
  const resolved = resolveTolerances(definition, tolerances);
  const segmentCount = getSplineSegmentCount(definition);

  const entries: IArcLengthEntry[] = [];
  const first = evaluateAtRawParameter(definition, 0);
  entries.push({ rawParameter: 0, distance: 0, position: first.position });

  const emit = (rawParameter: number, position: SplineVector3) => {
    const previous = entries[entries.length - 1];
    entries.push({
      rawParameter,
      distance: previous.distance + distanceVec3(previous.position, position),
      position,
    });
  };

  let segmentStartPos = first.position;
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const segmentEndPos = evaluateAtRawParameter(definition, segmentIndex + 1).position;
    flattenSegment(
      definition,
      segmentIndex,
      0,
      1,
      segmentStartPos,
      segmentEndPos,
      resolved.chordTol,
      0,
      emit,
    );
    segmentStartPos = segmentEndPos;
  }

  const totalLength = entries[entries.length - 1].distance;
  const distances = entries.map((e) => e.distance);
  const rawParameters = entries.map((e) => e.rawParameter);

  function findBracket(
    values: readonly number[],
    target: number,
  ): [number, number] {
    let lo = 0;
    let hi = values.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (values[mid] <= target) lo = mid;
      else hi = mid;
    }
    return [lo, hi];
  }

  function rawParameterAt(distance: number): number {
    const clamped = Math.min(Math.max(distance, 0), totalLength);
    const [lo, hi] = findBracket(distances, clamped);
    const a = entries[lo];
    const b = entries[hi];
    const span = b.distance - a.distance;
    const t = span > 0 ? (clamped - a.distance) / span : 0;
    return a.rawParameter + (b.rawParameter - a.rawParameter) * t;
  }

  function distanceAt(rawParameter: number): number {
    const clamped = Math.min(Math.max(rawParameter, 0), segmentCount);
    const [lo, hi] = findBracket(rawParameters, clamped);
    const a = entries[lo];
    const b = entries[hi];
    const span = b.rawParameter - a.rawParameter;
    const t = span > 0 ? (clamped - a.rawParameter) / span : 0;
    return a.distance + (b.distance - a.distance) * t;
  }

  return { totalLength, entries, rawParameterAt, distanceAt };
}

interface ICachedTable {
  readonly chordTol: number;
  readonly table: ISplineArcLengthTable;
}

const arcLengthCache = new WeakMap<ISplineDefinition, ICachedTable>();

/**
 * Identity-keyed cache per decision 7: the same `ISplineDefinition` object
 * always yields the same table for a given `chordTol`, and a new (immutable)
 * definition after an edit simply misses the cache rather than needing an
 * explicit invalidation call.
 */
export function getSplineArcLengthTable(
  definition: ISplineDefinition,
  tolerances?: ISplineTolerances,
): ISplineArcLengthTable {
  const resolved = resolveTolerances(definition, tolerances);
  const cached = arcLengthCache.get(definition);
  if (cached && cached.chordTol === resolved.chordTol) {
    return cached.table;
  }
  const table = buildSplineArcLengthTable(definition, resolved);
  arcLengthCache.set(definition, { chordTol: resolved.chordTol, table });
  return table;
}

export function getSplineLength(
  definition: ISplineDefinition,
  tolerances?: ISplineTolerances,
): number {
  return getSplineArcLengthTable(definition, tolerances).totalLength;
}

export function tToDistance(
  definition: ISplineDefinition,
  t: number,
  tolerances?: ISplineTolerances,
): number {
  if (!Number.isFinite(t)) throw new RangeError('Spline t must be finite.');
  const table = getSplineArcLengthTable(definition, tolerances);
  return Math.min(Math.max(t, 0), 1) * table.totalLength;
}

export function distanceToT(
  definition: ISplineDefinition,
  distance: number,
  tolerances?: ISplineTolerances,
): number {
  const table = getSplineArcLengthTable(definition, tolerances);
  if (table.totalLength === 0) return 0;
  const clamped = Math.min(Math.max(distance, 0), table.totalLength);
  return clamped / table.totalLength;
}

/** Primary public sampler: metres along the spline, not the raw curve parameter. */
export function evaluateAtDistance(
  definition: ISplineDefinition,
  distance: number,
  tolerances?: ISplineTolerances,
): ISplineSample {
  const table = getSplineArcLengthTable(definition, tolerances);
  const rawParameter = table.rawParameterAt(distance);
  return evaluateAtRawParameter(definition, rawParameter);
}

/** Global arc-normalized parameter in [0,1]. Not the sampling currency — prefer `evaluateAtDistance`. */
export function evaluateAtT(
  definition: ISplineDefinition,
  t: number,
  tolerances?: ISplineTolerances,
): ISplineSample {
  return evaluateAtDistance(definition, tToDistance(definition, t, tolerances), tolerances);
}
