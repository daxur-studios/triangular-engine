import { NavigationVector3 } from './navigation-types';

/** Ground-layer agent state consumed by local avoidance. Positions and velocities use X/Z. */
export interface NavigationAvoidanceAgent {
  readonly id: string;
  readonly position: NavigationVector3;
  readonly velocity?: NavigationVector3;
  readonly preferredVelocity: NavigationVector3;
  readonly radius: number;
  readonly maxSpeed: number;
}

/** A circular ground obstacle used by the first avoidance proof. */
export interface NavigationAvoidanceObstacle {
  readonly id: string;
  readonly position: NavigationVector3;
  readonly radius: number;
}

export interface NavigationSpatialIndex {
  readonly cellSize: number;
  readonly agents: readonly NavigationAvoidanceAgent[];
  readonly obstacles: readonly NavigationAvoidanceObstacle[];
  queryAgents(position: NavigationVector3, range: number): readonly NavigationAvoidanceAgent[];
  queryObstacles(position: NavigationVector3, range: number): readonly NavigationAvoidanceObstacle[];
}

/** Builds a deterministic uniform spatial index for nearby-agent and obstacle queries. */
export function createNavigationSpatialIndex(options: {
  readonly cellSize: number;
  readonly agents?: readonly NavigationAvoidanceAgent[];
  readonly obstacles?: readonly NavigationAvoidanceObstacle[];
}): NavigationSpatialIndex {
  if (!Number.isFinite(options.cellSize) || options.cellSize <= 0) {
    throw new Error('Navigation spatial-index cell size must be positive.');
  }
  const agents = [...(options.agents ?? [])];
  const obstacles = [...(options.obstacles ?? [])];
  const agentCells = bucketAgents(agents, options.cellSize);
  const obstacleCells = bucketObstacles(obstacles, options.cellSize);
  return {
    cellSize: options.cellSize,
    agents,
    obstacles,
    queryAgents: (position, range) => query(agentCells, position, range, options.cellSize, item => item.position),
    queryObstacles: (position, range) => query(obstacleCells, position, range, options.cellSize, item => item.position),
  };
}

export interface NavigationAvoidanceVelocityRequest {
  readonly agent: NavigationAvoidanceAgent;
  readonly nearbyAgents?: readonly NavigationAvoidanceAgent[];
  readonly nearbyObstacles?: readonly NavigationAvoidanceObstacle[];
  readonly separationWeight?: number;
  readonly obstacleWeight?: number;
}

/**
 * Deterministic separation steering. It is intentionally not a collision guarantee;
 * this is the baseline to compare with ORCA/velocity-obstacle steering later.
 */
export function calculateNavigationAvoidanceVelocity(
  request: NavigationAvoidanceVelocityRequest,
): NavigationVector3 {
  const { agent } = request;
  if (!Number.isFinite(agent.radius) || agent.radius < 0 || !Number.isFinite(agent.maxSpeed) || agent.maxSpeed < 0) {
    throw new Error('Navigation avoidance agent radius and max speed must be valid.');
  }
  const separationWeight = request.separationWeight ?? 1;
  const obstacleWeight = request.obstacleWeight ?? 1;
  let x = agent.preferredVelocity.x;
  let z = agent.preferredVelocity.z;
  for (const other of (request.nearbyAgents ?? []).slice().sort(byId)) {
    if (other.id === agent.id) continue;
    const push = repulsion(agent.position, agent.radius + other.radius, other.position);
    x += push.x * separationWeight;
    z += push.z * separationWeight;
  }
  for (const obstacle of (request.nearbyObstacles ?? []).slice().sort(byId)) {
    const push = repulsion(agent.position, agent.radius + obstacle.radius, obstacle.position);
    x += push.x * obstacleWeight;
    z += push.z * obstacleWeight;
  }
  const length = Math.hypot(x, z);
  if (length <= agent.maxSpeed || length === 0) return { x, y: agent.preferredVelocity.y, z };
  const scale = agent.maxSpeed / length;
  return { x: x * scale, y: agent.preferredVelocity.y, z: z * scale };
}

export interface NavigationVelocityObstacleRequest {
  readonly agent: NavigationAvoidanceAgent;
  readonly nearbyAgents?: readonly NavigationAvoidanceAgent[];
  readonly nearbyObstacles?: readonly NavigationAvoidanceObstacle[];
  /** Prediction interval used to reject velocities that lead into a collision. */
  readonly horizonSeconds?: number;
  /** Number of evenly spaced directions sampled around the preferred velocity. */
  readonly directionSamples?: number;
}

/**
 * Small deterministic velocity-obstacle-style experiment. It samples candidate
 * velocities and chooses the safest candidate closest to the preferred one.
 * It is not a full ORCA solver and does not guarantee collision-free motion.
 */
export function calculateNavigationVelocityObstacleVelocity(
  request: NavigationVelocityObstacleRequest,
): NavigationVector3 {
  const { agent } = request;
  validateAgent(agent);
  const horizonSeconds = request.horizonSeconds ?? 1;
  const directionSamples = request.directionSamples ?? 16;
  if (!Number.isFinite(horizonSeconds) || horizonSeconds <= 0) {
    throw new Error('Velocity-obstacle horizon must be positive.');
  }
  if (!Number.isSafeInteger(directionSamples) || directionSamples < 4) {
    throw new Error('Velocity-obstacle direction samples must be at least four.');
  }
  const preferred = clampSpeed(agent.preferredVelocity, agent.maxSpeed);
  const preferredAngle = Math.atan2(preferred.z, preferred.x);
  const candidates: NavigationVector3[] = [preferred, { x: 0, y: preferred.y, z: 0 }];
  for (let speedLevel = 1; speedLevel <= 2; speedLevel += 1) {
    const speed = agent.maxSpeed * speedLevel / 2;
    for (let sample = 0; sample < directionSamples; sample += 1) {
      const angle = preferredAngle + (sample / directionSamples) * Math.PI * 2;
      candidates.push({ x: Math.cos(angle) * speed, y: preferred.y, z: Math.sin(angle) * speed });
    }
  }
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate, index) => {
    const safe = isPredictedSafe(agent, candidate, request.nearbyAgents ?? [], request.nearbyObstacles ?? [], horizonSeconds);
    const distanceFromPreferred = Math.hypot(candidate.x - preferred.x, candidate.z - preferred.z);
    const score = distanceFromPreferred + (safe ? 0 : 1_000_000) + index * 1e-9;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

export type NavigationAvoidanceState = 'moving' | 'yielding' | 'stuck' | 'replan-local' | 'replan-global';

export interface NavigationAvoidanceStateRequest {
  readonly preferredSpeed: number;
  readonly actualSpeed: number;
  readonly progressDistance: number;
  readonly noProgressSeconds: number;
  readonly blockedSeconds: number;
  readonly stuckAfterSeconds?: number;
  readonly localReplanAfterSeconds?: number;
  readonly globalReplanAfterSeconds?: number;
}

/** Applies explicit, tunable thresholds to turn crowd symptoms into actions. */
export function classifyNavigationAvoidanceState(
  request: NavigationAvoidanceStateRequest,
): NavigationAvoidanceState {
  const stuckAfter = request.stuckAfterSeconds ?? 0.25;
  const localReplanAfter = request.localReplanAfterSeconds ?? 1;
  const globalReplanAfter = request.globalReplanAfterSeconds ?? 3;
  if ([request.preferredSpeed, request.actualSpeed, request.progressDistance,
    request.noProgressSeconds, request.blockedSeconds, stuckAfter,
    localReplanAfter, globalReplanAfter].some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Navigation avoidance state thresholds must be finite and non-negative.');
  }
  if (request.blockedSeconds >= globalReplanAfter || request.noProgressSeconds >= globalReplanAfter) return 'replan-global';
  if (request.blockedSeconds >= localReplanAfter || request.noProgressSeconds >= localReplanAfter) return 'replan-local';
  if (request.noProgressSeconds >= stuckAfter && request.preferredSpeed > request.actualSpeed) return 'stuck';
  if (request.preferredSpeed > request.actualSpeed && request.actualSpeed < 0.1) return 'yielding';
  return 'moving';
}

interface Point { readonly x: number; readonly z: number; }
type Bucketed<T> = Map<string, readonly T[]>;

function bucketAgents(items: readonly NavigationAvoidanceAgent[], cellSize: number): Bucketed<NavigationAvoidanceAgent> {
  return bucket(items, cellSize, item => item.position);
}

function bucketObstacles(items: readonly NavigationAvoidanceObstacle[], cellSize: number): Bucketed<NavigationAvoidanceObstacle> {
  return bucket(items, cellSize, item => item.position);
}

function bucket<T>(items: readonly T[], cellSize: number, position: (item: T) => NavigationVector3): Bucketed<T> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = bucketKey(position(item), cellSize);
    const bucketItems = result.get(key) ?? [];
    bucketItems.push(item);
    result.set(key, bucketItems);
  }
  return result;
}

function query<T extends { readonly id: string }>(buckets: Bucketed<T>, position: NavigationVector3, range: number, cellSize: number, itemPosition: (item: T) => NavigationVector3): readonly T[] {
  if (!Number.isFinite(range) || range < 0) throw new Error('Navigation avoidance query range must be non-negative.');
  const center = { x: position.x, z: position.z };
  const radius = Math.ceil(range / cellSize);
  const candidates: T[] = [];
  const seen = new Set<T>();
  for (let x = -radius; x <= radius; x += 1) for (let z = -radius; z <= radius; z += 1) {
    const key = `${Math.floor(position.x / cellSize) + x},${Math.floor(position.z / cellSize) + z}`;
    for (const item of buckets.get(key) ?? []) if (!seen.has(item)) {
      seen.add(item);
      candidates.push(item);
    }
  }
  return candidates.filter(item => {
    const point = itemPosition(item);
    return Math.hypot(point.x - center.x, point.z - center.z) <= range;
  }).sort(byId);
}

function repulsion(from: NavigationVector3, combinedRadius: number, obstacle: NavigationVector3): Point {
  const dx = from.x - obstacle.x;
  const dz = from.z - obstacle.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= combinedRadius || combinedRadius === 0) return { x: 0, z: 0 };
  if (distance === 0) return { x: combinedRadius, z: 0 };
  const strength = (combinedRadius - distance) / distance;
  return { x: dx * strength, z: dz * strength };
}

function validateAgent(agent: NavigationAvoidanceAgent): void {
  if (!Number.isFinite(agent.radius) || agent.radius < 0 || !Number.isFinite(agent.maxSpeed) || agent.maxSpeed < 0) {
    throw new Error('Navigation avoidance agent radius and max speed must be valid.');
  }
}

function clampSpeed(velocity: NavigationVector3, maxSpeed: number): NavigationVector3 {
  const length = Math.hypot(velocity.x, velocity.z);
  if (length === 0 || length <= maxSpeed) return { x: velocity.x, y: velocity.y, z: velocity.z };
  const scale = maxSpeed / length;
  return { x: velocity.x * scale, y: velocity.y, z: velocity.z * scale };
}

function isPredictedSafe(
  agent: NavigationAvoidanceAgent,
  velocity: NavigationVector3,
  nearbyAgents: readonly NavigationAvoidanceAgent[],
  nearbyObstacles: readonly NavigationAvoidanceObstacle[],
  horizonSeconds: number,
): boolean {
  for (const other of nearbyAgents.slice().sort(byId)) {
    if (other.id === agent.id) continue;
    const otherVelocity = other.velocity ?? { x: 0, y: 0, z: 0 };
    for (let sample = 0.25; sample <= 1; sample += 0.25) {
      const time = horizonSeconds * sample;
      const distance = Math.hypot(
        agent.position.x + velocity.x * time - other.position.x - otherVelocity.x * time,
        agent.position.z + velocity.z * time - other.position.z - otherVelocity.z * time,
      );
      if (distance < agent.radius + other.radius) return false;
    }
  }
  for (const obstacle of nearbyObstacles.slice().sort(byId)) {
    for (let sample = 0.25; sample <= 1; sample += 0.25) {
      const time = horizonSeconds * sample;
      const distance = Math.hypot(
        agent.position.x + velocity.x * time - obstacle.position.x,
        agent.position.z + velocity.z * time - obstacle.position.z,
      );
      if (distance < agent.radius + obstacle.radius) return false;
    }
  }
  return true;
}

function bucketKey(position: NavigationVector3, cellSize: number): string {
  return `${Math.floor(position.x / cellSize)},${Math.floor(position.z / cellSize)}`;
}

function byId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id);
}
