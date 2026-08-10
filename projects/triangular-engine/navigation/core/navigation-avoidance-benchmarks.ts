import {
  calculateNavigationAvoidanceVelocity,
  createNavigationSpatialIndex,
  NavigationAvoidanceAgent,
  NavigationAvoidanceObstacle,
} from './navigation-avoidance';

export interface NavigationAvoidanceBenchmarkScenario {
  readonly agentCount: number;
  readonly agents: readonly NavigationAvoidanceAgent[];
  readonly obstacles: readonly NavigationAvoidanceObstacle[];
}

export interface NavigationAvoidanceBenchmarkResult {
  readonly agentCount: number;
  readonly steps: number;
  readonly processedAgentSteps: number;
  readonly totalNearbyAgents: number;
  readonly elapsedMilliseconds: number;
}

/** Creates deterministic crowd fixtures for the 1/100/1,000-agent comparison. */
export function createNavigationAvoidanceBenchmarkScenario(options: {
  readonly agentCount: number;
  readonly seed?: number;
  readonly areaSize?: number;
}): NavigationAvoidanceBenchmarkScenario {
  if (!Number.isSafeInteger(options.agentCount) || options.agentCount <= 0) {
    throw new Error('Avoidance benchmark agent count must be positive.');
  }
  const areaSize = options.areaSize ?? 100;
  if (!Number.isFinite(areaSize) || areaSize <= 0) throw new Error('Avoidance benchmark area size must be positive.');
  const random = seededRandom(options.seed ?? 1);
  const agents: NavigationAvoidanceAgent[] = [];
  for (let index = 0; index < options.agentCount; index += 1) {
    const angle = random() * Math.PI * 2;
    agents.push({
      id: `benchmark-agent:${index}`,
      position: { x: (random() - 0.5) * areaSize, y: 0, z: (random() - 0.5) * areaSize },
      preferredVelocity: { x: Math.cos(angle) * 3, y: 0, z: Math.sin(angle) * 3 },
      radius: 0.5,
      maxSpeed: 3,
    });
  }
  return { agentCount: options.agentCount, agents, obstacles: [] };
}

/** Measures bounded spatial queries and steering work for a fixed number of steps. */
export function runNavigationAvoidanceBenchmark(options: {
  readonly scenario: NavigationAvoidanceBenchmarkScenario;
  readonly steps?: number;
  readonly queryRange?: number;
}): NavigationAvoidanceBenchmarkResult {
  const steps = options.steps ?? 1;
  const queryRange = options.queryRange ?? 6;
  if (!Number.isSafeInteger(steps) || steps <= 0) throw new Error('Avoidance benchmark steps must be positive.');
  if (!Number.isFinite(queryRange) || queryRange < 0) throw new Error('Avoidance benchmark query range must be non-negative.');
  const start = performance.now();
  let totalNearbyAgents = 0;
  for (let step = 0; step < steps; step += 1) {
    const index = createNavigationSpatialIndex({ cellSize: queryRange, agents: options.scenario.agents, obstacles: options.scenario.obstacles });
    for (const agent of options.scenario.agents) {
      const nearbyAgents = index.queryAgents(agent.position, queryRange);
      totalNearbyAgents += nearbyAgents.length;
      calculateNavigationAvoidanceVelocity({ agent, nearbyAgents });
    }
  }
  return {
    agentCount: options.scenario.agentCount,
    steps,
    processedAgentSteps: options.scenario.agentCount * steps,
    totalNearbyAgents,
    elapsedMilliseconds: performance.now() - start,
  };
}

function seededRandom(seed: number): () => number {
  if (!Number.isSafeInteger(seed)) throw new Error('Avoidance benchmark seed must be an integer.');
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
