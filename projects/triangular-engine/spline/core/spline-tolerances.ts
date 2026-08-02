/**
 * Named numerical tolerances, per decision 8 of `008_spline_sublibrary.md`:
 * each concern gets its own knob rather than one shared epsilon, so a
 * consumer can loosen `chordTol` for a coastline without also loosening
 * `duplicatePointTol` and silently accepting near-coincident control points.
 */
export interface ISplineTolerances {
  /** Minimum allowed distance between consecutive control points. */
  readonly duplicatePointTol: number;
  /** Maximum chord deviation allowed before an arc-length segment subdivides further. */
  readonly chordTol: number;
  /** Convergence tolerance for the closest-point solver, in field-space units. */
  readonly closestPointTol: number;
  /** Maximum raw-parameter span held by one segment-BVH leaf (Phase 0C). */
  readonly bvhLeafSpan: number;
  /** Maximum residual twist tolerated when closing a rotation-minimizing frame loop (Phase 0B). */
  readonly frameClosureTol: number;
  /** Convergence tolerance for surface re-projection (Phase 1B). */
  readonly projectionTol: number;
}

/**
 * Tolerances scale with the spline's own extent so a 10 m garden path and a
 * 500 km coastline both behave without per-consumer tuning.
 */
export function computeDefaultTolerances(extent: number): ISplineTolerances {
  if (!Number.isFinite(extent) || extent <= 0) {
    throw new RangeError('Spline extent must be positive and finite.');
  }
  return {
    duplicatePointTol: extent * 1e-9,
    chordTol: extent * 1e-5,
    closestPointTol: extent * 1e-7,
    bvhLeafSpan: 8,
    frameClosureTol: 1e-6,
    projectionTol: extent * 1e-6,
  };
}

/** Fallback tolerances for callers that have no meaningful extent yet (e.g. a single point). */
export const DEFAULT_SPLINE_TOLERANCES: ISplineTolerances =
  computeDefaultTolerances(1);
