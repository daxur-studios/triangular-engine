import { NavigationRouteStatus, NavigationVector3 } from './navigation-types';

/** Actions a consumer may take when route following encounters congestion. */
export type NavigationRecoveryAction =
  | 'continue'
  | 'wait'
  | 'yield'
  | 'retreat'
  | 'local-replan'
  | 'alternative-route'
  | 'global-replan'
  | 'blocked';

export interface NavigationRecoveryCandidate {
  readonly kind: 'retreat' | 'alternative-route';
  readonly location?: NavigationVector3;
  readonly cost?: number;
}

/** Bounded, serializable observation supplied to a recovery strategy. */
export interface NavigationRecoveryObservation {
  readonly agentId: string;
  readonly priority: number;
  readonly routeStatus: NavigationRouteStatus;
  readonly progressDistance: number;
  readonly noProgressSeconds: number;
  readonly blockedSeconds: number;
  readonly retryCount: number;
  readonly hasBlockingAgent: boolean;
  readonly hasRightOfWay: boolean;
  readonly canWait: boolean;
  readonly canYield: boolean;
  readonly recoveryCandidates?: readonly NavigationRecoveryCandidate[];
}

export interface NavigationRecoveryDecision {
  readonly action: NavigationRecoveryAction;
  readonly retryAfterSeconds?: number;
  readonly target?: NavigationVector3;
}

export interface NavigationRecoveryStrategy {
  readonly id: string;
  decide(observation: NavigationRecoveryObservation): NavigationRecoveryDecision;
}

export interface NavigationQueueYieldStrategyOptions {
  readonly yieldAfterSeconds?: number;
  readonly maxWaitSeconds?: number;
  readonly retryBaseSeconds?: number;
}

/**
 * A small deterministic baseline for shared bottlenecks.
 * Lower-priority agents wait when another agent has right of way. It does not
 * squeeze, move through occupied space, or pretend a full corridor is clear.
 */
export function createNavigationQueueYieldStrategy(
  options: NavigationQueueYieldStrategyOptions = {},
): NavigationRecoveryStrategy {
  const yieldAfterSeconds = options.yieldAfterSeconds ?? 0.25;
  const maxWaitSeconds = options.maxWaitSeconds ?? 5;
  const retryBaseSeconds = options.retryBaseSeconds ?? 0.5;
  validateThresholds(yieldAfterSeconds, maxWaitSeconds, retryBaseSeconds);

  return {
    id: 'queue-yield',
    decide: observation => {
      validateObservation(observation);
      if (observation.routeStatus !== 'complete') return { action: 'global-replan' };
      if (!observation.hasBlockingAgent || observation.hasRightOfWay || observation.noProgressSeconds < yieldAfterSeconds) {
        return { action: 'continue' };
      }
      if (observation.canWait && observation.blockedSeconds < maxWaitSeconds) {
        return {
          action: observation.canYield ? 'yield' : 'wait',
          retryAfterSeconds: retryDelay(observation.agentId, observation.retryCount, retryBaseSeconds),
        };
      }
      const alternative = observation.recoveryCandidates?.find(candidate => candidate.kind === 'alternative-route');
      if (alternative) return { action: 'alternative-route', target: alternative.location };
      const retreat = observation.recoveryCandidates?.find(candidate => candidate.kind === 'retreat');
      if (retreat) return { action: 'retreat', target: retreat.location };
      return { action: 'blocked' };
    },
  };
}

function retryDelay(agentId: string, retryCount: number, base: number): number {
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) hash = (hash * 31 + agentId.charCodeAt(index)) >>> 0;
  const stagger = (hash % 5) * 0.1;
  return base + Math.min(retryCount, 4) * base + stagger;
}

function validateThresholds(yieldAfter: number, maxWait: number, retryBase: number): void {
  if ([yieldAfter, maxWait, retryBase].some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Navigation recovery strategy thresholds must be finite and non-negative.');
  }
  if (maxWait < yieldAfter) throw new Error('Navigation recovery strategy max wait must not precede yielding.');
}

function validateObservation(observation: NavigationRecoveryObservation): void {
  if (!observation.agentId || !Number.isFinite(observation.priority) ||
    [observation.progressDistance, observation.noProgressSeconds, observation.blockedSeconds, observation.retryCount]
      .some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Navigation recovery observation values must be valid.');
  }
}
