import {
  calculateNavigationAvoidanceVelocity,
  createNavigationSpatialIndex,
  NavigationAvoidanceAgent,
} from './navigation-avoidance';

export type NavigationAvoidanceScenarioMode = 'baseline' | 'priority-yield';

export interface NavigationAvoidanceScenarioOptions {
  readonly mode: NavigationAvoidanceScenarioMode;
  readonly agentCount: number;
  readonly seed?: number;
  readonly maximumSteps?: number;
  readonly timeStepSeconds?: number;
  readonly blockedAfterSteps?: number;
}

export interface NavigationAvoidanceScenarioResult {
  readonly mode: NavigationAvoidanceScenarioMode;
  readonly agentCount: number;
  readonly seed: number;
  readonly steps: number;
  readonly completed: number;
  readonly blocked: number;
  readonly stationary: number;
  readonly moving: number;
  readonly maxOverlap: number;
  readonly velocityReversals: number;
  readonly allStationary: boolean;
  readonly oscillating: boolean;
  readonly failureReasons: readonly string[];
  readonly compactReport: string;
}

export interface NavigationAvoidanceScenarioSweepOptions
  extends Omit<NavigationAvoidanceScenarioOptions, 'seed'> {
  readonly seeds: readonly number[];
}

export interface NavigationAvoidanceScenarioSweepResult {
  readonly mode: NavigationAvoidanceScenarioMode;
  readonly agentCount: number;
  readonly totalRuns: number;
  readonly failedRuns: number;
  readonly failedSeeds: readonly number[];
  readonly compactReport: string;
}

interface ScenarioAgent extends NavigationAvoidanceAgent {
  position: NavigationAvoidanceAgent['position'];
  readonly journeyDirection: 1 | -1;
  readonly goalX: number;
  noProgressSteps: number;
  velocityReversals: number;
  previousVelocityX: number;
  completed: boolean;
}

/**
 * Runs a small deterministic single-lane crossing without Angular or a
 * renderer. It is a diagnostic fixture, not a production crowd simulator.
 * Results are intentionally compact so many seeds can be compared cheaply.
 */
export function runNavigationAvoidanceScenario(
  options: NavigationAvoidanceScenarioOptions,
): NavigationAvoidanceScenarioResult {
  const maximumSteps = options.maximumSteps ?? 600;
  const timeStepSeconds = options.timeStepSeconds ?? 0.05;
  const blockedAfterSteps = options.blockedAfterSteps ?? 120;
  validateOptions(options, maximumSteps, timeStepSeconds, blockedAfterSteps);
  const seed = options.seed ?? 1;
  const random = seededRandom(seed);
  const agents = createAgents(options.agentCount, random);
  let allStationarySteps = 0;
  let maxOverlap = 0;
  let steps = 0;

  for (; steps < maximumSteps; steps += 1) {
    const index = createNavigationSpatialIndex({ cellSize: 2, agents });
    const nextPositions = new Map<string, { x: number; z: number }>();
    let stationaryThisStep = 0;
    let activeThisStep = 0;
    for (const agent of agents) {
      if (agent.completed) continue;
      activeThisStep += 1;
      const nearbyAgents = index.queryAgents(agent.position, 4);
      const opposing = nearbyAgents
        .map(other => agents.find(candidate => candidate.id === other.id))
        .filter((candidate): candidate is ScenarioAgent => candidate !== undefined)
        .filter(candidate => candidate.id !== agent.id && candidate.journeyDirection !== agent.journeyDirection)
        .sort((left, right) => Math.abs(left.position.x - agent.position.x) - Math.abs(right.position.x - agent.position.x))[0];
      const preferredX = agent.journeyDirection * 3;
      let preferredVelocity = { x: preferredX, y: 0, z: 0 };
      if (options.mode === 'priority-yield' && opposing && Math.abs(opposing.position.x - agent.position.x) < 3) {
        if (agent.id > opposing.id) preferredVelocity = { x: -agent.journeyDirection * 2.4, y: 0, z: 0 };
      }
      const velocity = calculateNavigationAvoidanceVelocity({
        agent: { ...agent, preferredVelocity },
        nearbyAgents,
        separationWeight: options.mode === 'baseline' ? 1 : 0.35,
      });
      const velocityX = Math.max(-3, Math.min(3, velocity.x));
      const nextX = Math.max(-12, Math.min(12, agent.position.x + velocityX * timeStepSeconds));
      nextPositions.set(agent.id, { x: nextX, z: 0 });
      if (Math.abs(velocityX) < 0.05) stationaryThisStep += 1;
      if (Math.abs(velocityX) > 0.05 && Math.sign(velocityX) !== Math.sign(agent.previousVelocityX)
        && Math.abs(agent.previousVelocityX) > 0.05) agent.velocityReversals += 1;
      agent.previousVelocityX = velocityX;
      const previousDistance = Math.abs(agent.goalX - agent.position.x);
      const nextDistance = Math.abs(agent.goalX - nextX);
      if (previousDistance - nextDistance > 0.001) agent.noProgressSteps = 0;
      else agent.noProgressSteps += 1;
      if (nextDistance < 0.45) agent.completed = true;
    }
    for (const agent of agents) {
      const next = nextPositions.get(agent.id);
      if (next) agent.position = { x: next.x, y: 0, z: next.z };
    }
    maxOverlap = Math.max(maxOverlap, measureOverlap(agents));
    if (activeThisStep > 0 && stationaryThisStep === activeThisStep) allStationarySteps += 1;
    else allStationarySteps = 0;
    if (agents.every(agent => agent.completed || agent.noProgressSteps >= blockedAfterSteps)) break;
  }

  const completed = agents.filter(agent => agent.completed).length;
  const blocked = agents.filter(agent => !agent.completed && agent.noProgressSteps >= blockedAfterSteps).length;
  const stationary = agents.filter(agent => !agent.completed && Math.abs(agent.previousVelocityX) < 0.05).length;
  const moving = agents.length - completed - stationary;
  const velocityReversals = agents.reduce((total, agent) => total + agent.velocityReversals, 0);
  const oscillating = agents.some(agent => !agent.completed && agent.velocityReversals >= 4);
  const failureReasons = [
    ...(allStationarySteps >= 20 ? ['all-stationary'] : []),
    ...(oscillating ? ['oscillation'] : []),
    ...(blocked > 0 ? ['blocked'] : []),
    ...(maxOverlap > 0.01 ? ['overlap'] : []),
  ];
  const compactReport = `mode=${options.mode} seed=${seed} agents=${agents.length} steps=${steps + 1} completed=${completed} blocked=${blocked} stationary=${stationary} moving=${moving} overlap=${maxOverlap.toFixed(2)} reversals=${velocityReversals} failures=${failureReasons.join(',') || 'none'}`;
  return {
    mode: options.mode,
    agentCount: agents.length,
    seed,
    steps: steps + 1,
    completed,
    blocked,
    stationary,
    moving,
    maxOverlap,
    velocityReversals,
    allStationary: allStationarySteps >= 20,
    oscillating,
    failureReasons,
    compactReport,
  };
}

/** Runs many deterministic seeds and returns only aggregate failure data. */
export function runNavigationAvoidanceScenarioSweep(
  options: NavigationAvoidanceScenarioSweepOptions,
): NavigationAvoidanceScenarioSweepResult {
  if (!options.seeds.length) throw new Error('Avoidance scenario sweep requires at least one seed.');
  const results = options.seeds.map(seed => runNavigationAvoidanceScenario({ ...options, seed }));
  const failedSeeds = results.filter(result => result.failureReasons.length > 0).map(result => result.seed);
  const shownSeeds = failedSeeds.slice(0, 12).join(',') || 'none';
  const suffix = failedSeeds.length > 12 ? `,+${failedSeeds.length - 12}-more` : '';
  const compactReport = `mode=${options.mode} agents=${options.agentCount} runs=${results.length} failures=${failedSeeds.length} failedSeeds=${shownSeeds}${suffix}`;
  return {
    mode: options.mode,
    agentCount: options.agentCount,
    totalRuns: results.length,
    failedRuns: failedSeeds.length,
    failedSeeds,
    compactReport,
  };
}

function createAgents(agentCount: number, random: () => number): ScenarioAgent[] {
  const perDirection = Math.ceil(agentCount / 2);
  return Array.from({ length: agentCount }, (_, index) => {
    const forward = index < perDirection;
    const offset = forward ? index : index - perDirection;
    const x = forward ? -10 - offset * 1.2 : 10 + offset * 1.2;
    return {
      id: `scenario-agent-${index}`,
      position: { x: x + (random() - 0.5) * 0.05, y: 0, z: 0 },
      preferredVelocity: { x: forward ? 3 : -3, y: 0, z: 0 },
      radius: 0.55,
      maxSpeed: 3,
      journeyDirection: forward ? 1 : -1,
      goalX: forward ? 12 : -12,
      noProgressSteps: 0,
      velocityReversals: 0,
      previousVelocityX: 0,
      completed: false,
    };
  });
}

function measureOverlap(agents: readonly ScenarioAgent[]): number {
  let maximum = 0;
  for (let left = 0; left < agents.length; left += 1) for (let right = left + 1; right < agents.length; right += 1) {
    const distance = Math.abs(agents[left].position.x - agents[right].position.x);
    maximum = Math.max(maximum, agents[left].radius + agents[right].radius - distance);
  }
  return maximum;
}

function validateOptions(options: NavigationAvoidanceScenarioOptions, steps: number, timeStep: number, blockedAfter: number): void {
  if (!['baseline', 'priority-yield'].includes(options.mode)) throw new Error('Unknown avoidance scenario mode.');
  if (!Number.isSafeInteger(options.agentCount) || options.agentCount <= 0) throw new Error('Avoidance scenario agent count must be positive.');
  if (!Number.isSafeInteger(options.seed ?? 1)) throw new Error('Avoidance scenario seed must be an integer.');
  if (!Number.isSafeInteger(steps) || steps <= 0 || !Number.isFinite(timeStep) || timeStep <= 0
    || !Number.isSafeInteger(blockedAfter) || blockedAfter <= 0) throw new Error('Avoidance scenario limits must be positive.');
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
