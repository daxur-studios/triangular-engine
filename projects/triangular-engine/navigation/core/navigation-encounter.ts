/** Local movement intents exchanged by agents during a congestion encounter. */
export type NavigationEncounterIntent = 'advance' | 'wait' | 'retreat' | 'blocked';

/**
 * Transferable urgency from an agent that is blocked farther along a chain.
 * Lower numeric priorities have right of way. Signals are bounded by both a
 * hop count and an absolute expiry so stale encounters cannot live forever.
 */
export interface NavigationEncounterPrioritySignal {
  readonly originAgentId: string;
  readonly sourceAgentId: string;
  readonly priority: number;
  readonly hopCount: number;
  readonly expiresAtSeconds: number;
}

/** A retreat request passed to an agent obstructing the sender's escape. */
export interface NavigationEncounterRetreatSignal {
  readonly encounterId: string;
  readonly winnerAgentId: string;
  readonly sourceAgentId: string;
  readonly priority: number;
  readonly hopCount: number;
  readonly expiresAtSeconds: number;
}

export interface NavigationEncounterOpponent {
  readonly agentId: string;
  readonly priority: number;
  /** Priority already inherited by the opponent from its local blocker chain. */
  readonly effectivePriority?: number;
  /** A consumer-supplied stable conflict key; the agent pair is used by default. */
  readonly encounterId?: string;
}

/** Bounded local observation. Geometry remains owned by the consumer. */
export interface NavigationEncounterObservation {
  readonly nowSeconds: number;
  readonly agentId: string;
  readonly priority: number;
  readonly canRetreat: boolean;
  readonly blockedSeconds: number;
  /** Agents currently in direct, opposing conflict with this agent. */
  readonly opponents?: readonly NavigationEncounterOpponent[];
  /** Urgency received from agents for whom this agent is a blocker. */
  readonly prioritySignals?: readonly NavigationEncounterPrioritySignal[];
  /** Requests received from retreating agents whose escape this agent blocks. */
  readonly retreatSignals?: readonly NavigationEncounterRetreatSignal[];
}

export interface NavigationEncounterDecision {
  readonly intent: NavigationEncounterIntent;
  readonly effectivePriority: number;
  readonly yieldToAgentId?: string;
  /** Advertise this toward the agent currently blocking forward progress. */
  readonly prioritySignal: NavigationEncounterPrioritySignal;
  /** Advertise this to agents currently obstructing the retreat path. */
  readonly retreatSignal?: NavigationEncounterRetreatSignal;
}

export interface NavigationEncounterProtocolOptions {
  readonly signalTtlSeconds?: number;
  readonly maxPropagationHops?: number;
  /** No-progress budget after which the result becomes explicitly blocked. */
  readonly blockedAfterSeconds?: number;
}

/**
 * Resolves one agent's local encounter without maintaining global state.
 * Consumers provide only relevant neighbours from their spatial query and
 * relay the returned signals along the corresponding blocker relationships.
 */
export function resolveNavigationEncounter(
  observation: NavigationEncounterObservation,
  options: NavigationEncounterProtocolOptions = {},
): NavigationEncounterDecision {
  const signalTtlSeconds = options.signalTtlSeconds ?? 2;
  const maxPropagationHops = options.maxPropagationHops ?? 64;
  const blockedAfterSeconds = options.blockedAfterSeconds ?? 5;
  validateOptions(signalTtlSeconds, maxPropagationHops, blockedAfterSeconds);
  validateObservation(observation);

  const activePrioritySignals = (observation.prioritySignals ?? [])
    .filter(signal => isActive(signal, observation.nowSeconds, maxPropagationHops));
  const inherited = [...activePrioritySignals].sort(comparePrioritySignals)[0];
  const effectivePriority = inherited && inherited.priority < observation.priority
    ? inherited.priority
    : observation.priority;
  const priorityOrigin = inherited && inherited.priority < observation.priority
    ? inherited.originAgentId
    : observation.agentId;
  const priorityHop = inherited && inherited.priority < observation.priority
    ? inherited.hopCount + 1
    : 0;
  const priorityExpiry = inherited && inherited.priority < observation.priority
    ? inherited.expiresAtSeconds
    : observation.nowSeconds + signalTtlSeconds;
  const prioritySignal: NavigationEncounterPrioritySignal = {
    originAgentId: priorityOrigin,
    sourceAgentId: observation.agentId,
    priority: effectivePriority,
    hopCount: priorityHop,
    expiresAtSeconds: priorityExpiry,
  };

  const retreatRequest = [...(observation.retreatSignals ?? [])]
    .filter(signal => isActive(signal, observation.nowSeconds, maxPropagationHops))
    .sort(compareRetreatSignals)[0];
  if (retreatRequest) {
    if (observation.blockedSeconds >= blockedAfterSeconds || retreatRequest.hopCount >= maxPropagationHops) {
      return { intent: 'blocked', effectivePriority, yieldToAgentId: retreatRequest.winnerAgentId, prioritySignal };
    }
    if (!observation.canRetreat) {
      return { intent: 'wait', effectivePriority, yieldToAgentId: retreatRequest.winnerAgentId, prioritySignal };
    }
    return {
      intent: 'retreat',
      effectivePriority,
      yieldToAgentId: retreatRequest.winnerAgentId,
      prioritySignal,
      retreatSignal: {
        ...retreatRequest,
        sourceAgentId: observation.agentId,
        hopCount: retreatRequest.hopCount + 1,
      },
    };
  }

  const opponent = [...(observation.opponents ?? [])]
    .filter(candidate => candidate.agentId !== observation.agentId)
    .sort(compareOpponents)[0];
  if (!opponent) return { intent: 'advance', effectivePriority, prioritySignal };

  const opponentPriority = Math.min(opponent.priority, opponent.effectivePriority ?? opponent.priority);
  const selfWins = compareClaims(
    { agentId: observation.agentId, priority: effectivePriority },
    { agentId: opponent.agentId, priority: opponentPriority },
  ) <= 0;
  if (selfWins) return { intent: 'advance', effectivePriority, prioritySignal };
  if (observation.blockedSeconds >= blockedAfterSeconds) {
    return { intent: 'blocked', effectivePriority, yieldToAgentId: opponent.agentId, prioritySignal };
  }
  if (!observation.canRetreat) {
    return { intent: 'wait', effectivePriority, yieldToAgentId: opponent.agentId, prioritySignal };
  }

  const encounterId = opponent.encounterId ?? stableEncounterId(observation.agentId, opponent.agentId);
  return {
    intent: 'retreat',
    effectivePriority,
    yieldToAgentId: opponent.agentId,
    prioritySignal,
    retreatSignal: {
      encounterId,
      winnerAgentId: opponent.agentId,
      sourceAgentId: observation.agentId,
      priority: opponentPriority,
      hopCount: 0,
      expiresAtSeconds: observation.nowSeconds + signalTtlSeconds,
    },
  };
}

function compareClaims(left: { readonly agentId: string; readonly priority: number }, right: { readonly agentId: string; readonly priority: number }): number {
  return left.priority - right.priority || left.agentId.localeCompare(right.agentId);
}

function compareOpponents(left: NavigationEncounterOpponent, right: NavigationEncounterOpponent): number {
  return compareClaims(
    { agentId: left.agentId, priority: Math.min(left.priority, left.effectivePriority ?? left.priority) },
    { agentId: right.agentId, priority: Math.min(right.priority, right.effectivePriority ?? right.priority) },
  );
}

function comparePrioritySignals(left: NavigationEncounterPrioritySignal, right: NavigationEncounterPrioritySignal): number {
  return left.priority - right.priority
    || left.originAgentId.localeCompare(right.originAgentId)
    || left.hopCount - right.hopCount;
}

function compareRetreatSignals(left: NavigationEncounterRetreatSignal, right: NavigationEncounterRetreatSignal): number {
  return left.priority - right.priority
    || left.winnerAgentId.localeCompare(right.winnerAgentId)
    || left.encounterId.localeCompare(right.encounterId)
    || left.hopCount - right.hopCount;
}

function isActive(
  signal: NavigationEncounterPrioritySignal | NavigationEncounterRetreatSignal,
  nowSeconds: number,
  maxPropagationHops: number,
): boolean {
  return signal.expiresAtSeconds > nowSeconds && signal.hopCount <= maxPropagationHops;
}

function stableEncounterId(leftId: string, rightId: string): string {
  return leftId.localeCompare(rightId) <= 0
    ? `encounter:${leftId}:${rightId}`
    : `encounter:${rightId}:${leftId}`;
}

function validateOptions(ttl: number, maxHops: number, blockedAfter: number): void {
  if (!Number.isFinite(ttl) || ttl <= 0 || !Number.isInteger(maxHops) || maxHops < 1
    || !Number.isFinite(blockedAfter) || blockedAfter < 0) {
    throw new Error('Navigation encounter options must contain a positive TTL, positive integer hop limit, and non-negative blocked budget.');
  }
}

function validateObservation(observation: NavigationEncounterObservation): void {
  if (!observation.agentId || !Number.isFinite(observation.nowSeconds) || observation.nowSeconds < 0
    || !Number.isFinite(observation.priority) || !Number.isFinite(observation.blockedSeconds)
    || observation.blockedSeconds < 0) {
    throw new Error('Navigation encounter observation values must be valid.');
  }
  for (const opponent of observation.opponents ?? []) {
    if (!opponent.agentId || !Number.isFinite(opponent.priority)
      || (opponent.effectivePriority !== undefined && !Number.isFinite(opponent.effectivePriority))) {
      throw new Error('Navigation encounter opponent values must be valid.');
    }
  }
  for (const signal of [...(observation.prioritySignals ?? []), ...(observation.retreatSignals ?? [])]) {
    if (!signal.sourceAgentId || !Number.isFinite(signal.priority) || !Number.isInteger(signal.hopCount)
      || signal.hopCount < 0 || !Number.isFinite(signal.expiresAtSeconds)) {
      throw new Error('Navigation encounter signals must be valid.');
    }
  }
  for (const signal of observation.prioritySignals ?? []) {
    if (!signal.originAgentId) throw new Error('Navigation encounter priority signal origins must be valid.');
  }
  for (const signal of observation.retreatSignals ?? []) {
    if (!signal.encounterId || !signal.winnerAgentId) {
      throw new Error('Navigation encounter retreat signal identities must be valid.');
    }
  }
}
