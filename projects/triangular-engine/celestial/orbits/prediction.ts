import { ICelestialBody } from '../bodies/celestial-body';
import { vec3Add, vec3Length, vec3Sub } from '../math/vec3';
import { UniversalTime } from '../time/universal-clock';
import { orbitalPeriod } from './apsides';
import { UnsupportedConicError } from './errors';
import {
  BodyWorldStateOptions,
  bodyWorldStateAt,
  relativeStateTo,
} from './ephemeris';
import { IKeplerianElements, IStateVector } from './kepler-elements';
import { IOrbitPropagator } from './propagator';
import { soiRadiusM } from './soi';
import { stateVectorToKeplerianElements } from './state-elements';

export type ConicSegmentEndReason =
  | 'soiExit'
  | 'soiEntry'
  | 'limitReached'
  | 'periodic';

/** One leg of a predicted trajectory: a single conic, relative to `bodyId`, valid from `startUt` to `endUt` (patched-conics.md decision 8). */
export interface IConicSegment {
  bodyId: string;
  elements: IKeplerianElements;
  startUt: UniversalTime;
  /** Undefined only for a `periodic` segment: the orbit never leaves `bodyId`'s SOI within the search horizon. */
  endUt?: UniversalTime;
  endReason: ConicSegmentEndReason;
}

export interface PredictTrajectoryInput {
  bodies: readonly ICelestialBody[];
  bodyId: string;
  elements: IKeplerianElements;
  startUt: UniversalTime;
  propagator: IOrbitPropagator;
  options?: BodyWorldStateOptions;
  /** Default `DEFAULT_MAX_TRANSITIONS`. */
  maxTransitions?: number;
  /** Default unlimited (each segment still self-limits per `ELLIPTIC_SEARCH_PERIODS`/`DEFAULT_MAX_DURATION_S`). */
  maxDurationS?: number;
}

/** Default cap on SOI transitions `predictTrajectory` follows before stopping with `limitReached`. */
export const DEFAULT_MAX_TRANSITIONS = 3;

/** Search horizon for a hyperbolic/escape segment, which has no period to scale a horizon from. */
export const DEFAULT_MAX_DURATION_S = 2 * 24 * 60 * 60;

/** How many periods an elliptic segment searches before concluding no SOI crossing occurs (reported as `periodic`). */
const ELLIPTIC_SEARCH_PERIODS = 2;

/** Coarse time-march sample count per segment search — fine enough not to miss a fast SOI transit at high warp. */
const COARSE_SAMPLES_PER_SEGMENT = 200;

/** Fixed bisection iteration count refining a coarse-sample bracket down to a precise crossing `ut`. */
const CROSSING_BISECTION_ITERATIONS = 40;

function findBodyOrThrow(
  bodies: readonly ICelestialBody[],
  bodyId: string,
): ICelestialBody {
  const body = bodies.find((candidate) => candidate.id === bodyId);
  if (!body) {
    throw new Error(`predictTrajectory: no body with id '${bodyId}'`);
  }
  return body;
}

function addStates(a: IStateVector, b: IStateVector): IStateVector {
  return {
    positionM: vec3Add(a.positionM, b.positionM),
    velocityMPerS: vec3Add(a.velocityMPerS, b.velocityMPerS),
  };
}

type Candidate = { kind: 'entry'; child: ICelestialBody } | { kind: 'exit' };

/**
 * Predicts a vessel's trajectory forward as a sequence of conics, one per
 * body it is primary to (patched-conics.md decision 8) — the one function
 * the map calls for prediction; rails ticking uses its own incremental
 * bisection (decision 7) since actual state must never depend on a
 * display/planning path. Always terminates: each segment self-limits its
 * search horizon (a multiple of its own period, or a fixed duration for
 * hyperbolic legs with no period), and the overall walk stops after
 * `maxTransitions` crossings or `maxDurationS` of total predicted time,
 * whichever comes first.
 */
export function predictTrajectory(
  input: PredictTrajectoryInput,
): IConicSegment[] {
  const { bodies, options, propagator } = input;
  const maxTransitions = input.maxTransitions ?? DEFAULT_MAX_TRANSITIONS;

  const segments: IConicSegment[] = [];
  let bodyId = input.bodyId;
  let elements = input.elements;
  let startUt = input.startUt;
  let remainingDurationS = input.maxDurationS ?? Infinity;

  for (
    let transitionsUsed = 0;
    transitionsUsed <= maxTransitions;
    transitionsUsed++
  ) {
    const body = findBodyOrThrow(bodies, bodyId);
    const mu = body.muM3PerS2;
    const period =
      elements.eccentricity < 1 ? orbitalPeriod(elements, mu) : Infinity;
    const segmentHorizonS = Number.isFinite(period)
      ? ELLIPTIC_SEARCH_PERIODS * period
      : DEFAULT_MAX_DURATION_S;
    const horizonS = Math.min(segmentHorizonS, remainingDurationS);

    if (!(horizonS > 0)) {
      segments.push({
        bodyId,
        elements,
        startUt,
        endUt: startUt,
        endReason: 'limitReached',
      });
      return segments;
    }

    const parent = body.parentBodyId
      ? bodies.find((candidate) => candidate.id === body.parentBodyId)
      : undefined;
    const children = bodies.filter(
      (candidate) => candidate.parentBodyId === bodyId,
    );
    const candidates: Candidate[] = [
      ...children.map((child): Candidate => ({ kind: 'entry', child })),
      ...(parent ? [{ kind: 'exit' as const }] : []),
    ];

    // margin(t) > 0 means "not yet crossed" for that candidate; a transition
    // to <= 0 between two coarse samples brackets the crossing.
    function margin(candidate: Candidate, t: UniversalTime): number {
      const vesselState = propagator.stateAt(elements, mu, t);
      if (candidate.kind === 'exit') {
        return soiRadiusM(body, parent!) - vec3Length(vesselState.positionM);
      }
      const bodyWorldState = bodyWorldStateAt(
        bodies,
        bodyId,
        t,
        propagator,
        options,
      );
      const childWorldState = bodyWorldStateAt(
        bodies,
        candidate.child.id,
        t,
        propagator,
        options,
      );
      const childRelativeToBody = vec3Sub(
        childWorldState.positionM,
        bodyWorldState.positionM,
      );
      const distanceToChild = vec3Length(
        vec3Sub(vesselState.positionM, childRelativeToBody),
      );
      return distanceToChild - soiRadiusM(candidate.child, body);
    }

    let bestCrossingUt: UniversalTime | undefined;
    let bestCandidate: Candidate | undefined;

    for (const candidate of candidates) {
      let previousT = startUt;
      let previousMargin = margin(candidate, previousT);
      if (!Number.isFinite(previousMargin)) continue;
      for (let sample = 1; sample <= COARSE_SAMPLES_PER_SEGMENT; sample++) {
        const t = startUt + (sample / COARSE_SAMPLES_PER_SEGMENT) * horizonS;
        const currentMargin = margin(candidate, t);
        if (!Number.isFinite(currentMargin)) break;
        if (previousMargin > 0 && currentMargin <= 0) {
          let lo = previousT;
          let hi = t;
          for (
            let iteration = 0;
            iteration < CROSSING_BISECTION_ITERATIONS;
            iteration++
          ) {
            const mid = (lo + hi) / 2;
            const midMargin = margin(candidate, mid);
            if (!Number.isFinite(midMargin)) break;
            if (midMargin > 0) {
              lo = mid;
            } else {
              hi = mid;
            }
          }
          const crossingUt = (lo + hi) / 2;
          if (bestCrossingUt === undefined || crossingUt < bestCrossingUt) {
            bestCrossingUt = crossingUt;
            bestCandidate = candidate;
          }
          break;
        }
        previousT = t;
        previousMargin = currentMargin;
      }
    }

    if (bestCrossingUt === undefined || !bestCandidate) {
      const endReason: ConicSegmentEndReason = Number.isFinite(period)
        ? 'periodic'
        : 'limitReached';
      segments.push({ bodyId, elements, startUt, endReason });
      return segments;
    }

    if (transitionsUsed >= maxTransitions) {
      segments.push({
        bodyId,
        elements,
        startUt,
        endUt: bestCrossingUt,
        endReason: 'limitReached',
      });
      return segments;
    }

    const newBodyId =
      bestCandidate.kind === 'exit' ? parent!.id : bestCandidate.child.id;
    let newElements: IKeplerianElements;
    try {
      const vesselWorldState = addStates(
        bodyWorldStateAt(bodies, bodyId, bestCrossingUt, propagator),
        propagator.stateAt(elements, mu, bestCrossingUt),
      );
      const newBody = findBodyOrThrow(bodies, newBodyId);
      const newBodyWorldState = bodyWorldStateAt(
        bodies,
        newBodyId,
        bestCrossingUt,
        propagator,
      );
      const newRelativeState = relativeStateTo(
        vesselWorldState,
        newBodyWorldState,
      );
      newElements = stateVectorToKeplerianElements(
        newRelativeState,
        newBody.muM3PerS2,
        bestCrossingUt,
      );
    } catch (error) {
      if (error instanceof UnsupportedConicError) {
        segments.push({
          bodyId,
          elements,
          startUt,
          endUt: bestCrossingUt,
          endReason: 'limitReached',
        });
        return segments;
      }
      throw error;
    }

    segments.push({
      bodyId,
      elements,
      startUt,
      endUt: bestCrossingUt,
      endReason: bestCandidate.kind === 'exit' ? 'soiExit' : 'soiEntry',
    });

    remainingDurationS -= bestCrossingUt - startUt;
    bodyId = newBodyId;
    elements = newElements;
    startUt = bestCrossingUt;
  }

  return segments;
}
