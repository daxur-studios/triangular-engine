import {
  calculateNavigationAvoidanceVelocity,
  createNavigationSpatialIndex,
  NavigationAvoidanceAgent,
} from './navigation-avoidance';

export type NavigationAvoidanceScenarioMode = 'baseline' | 'priority-yield';
export type NavigationAvoidanceTraffic = 'same-direction' | 'opposing' | 'opposing-with-staging';

export interface NavigationAvoidanceScenarioOptions {
  readonly mode: NavigationAvoidanceScenarioMode;
  readonly traffic?: NavigationAvoidanceTraffic;
  readonly agentCount: number;
  readonly seed?: number;
  readonly maximumSteps?: number;
  readonly timeStepSeconds?: number;
  readonly blockedAfterSteps?: number;
}

export interface NavigationAvoidanceScenarioResult {
  readonly mode: NavigationAvoidanceScenarioMode;
  readonly traffic: NavigationAvoidanceTraffic;
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

export interface NavigationAvoidanceScenarioAgentSnapshot {
  readonly id: string;
  readonly position: NavigationAvoidanceAgent['position'];
  readonly radius: number;
  readonly journeyDirection: 1 | -1;
  readonly goalX: number;
  readonly completed: boolean;
  readonly holding: boolean;
}

export interface NavigationAvoidanceScenarioSnapshot {
  readonly steps: number;
  readonly finished: boolean;
  readonly agents: readonly NavigationAvoidanceScenarioAgentSnapshot[];
  readonly result?: NavigationAvoidanceScenarioResult;
}

/** A deterministic, fixed-timestep scenario shared by tests, scripts, and visualizers. */
export interface NavigationAvoidanceScenarioSimulation {
  snapshot(): NavigationAvoidanceScenarioSnapshot;
  step(): NavigationAvoidanceScenarioSnapshot;
  runToCompletion(): NavigationAvoidanceScenarioResult;
}

export interface NavigationAvoidanceScenarioSweepOptions
  extends Omit<NavigationAvoidanceScenarioOptions, 'seed'> {
  readonly seeds: readonly number[];
}

export interface NavigationAvoidanceScenarioSweepResult {
  readonly mode: NavigationAvoidanceScenarioMode;
  readonly traffic: NavigationAvoidanceTraffic;
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
  holding: boolean;
}

const stagingPoint = { x: 9, y: 0, z: 1.5 } as const;

/**
 * Runs a small deterministic single-lane crossing without Angular or a
 * renderer. It is a diagnostic fixture, not a production crowd simulator.
 * Results are intentionally compact so many seeds can be compared cheaply.
 */
export function createNavigationAvoidanceScenarioSimulation(
  options: NavigationAvoidanceScenarioOptions,
): NavigationAvoidanceScenarioSimulation {
  const maximumSteps = options.maximumSteps ?? 600;
  const timeStepSeconds = options.timeStepSeconds ?? 0.05;
  const blockedAfterSteps = options.blockedAfterSteps ?? 120;
  validateOptions(options, maximumSteps, timeStepSeconds, blockedAfterSteps);
  return new NavigationAvoidanceScenarioSimulationImpl(
    options, maximumSteps, timeStepSeconds, blockedAfterSteps,
  );
}

class NavigationAvoidanceScenarioSimulationImpl implements NavigationAvoidanceScenarioSimulation {
  private readonly seed: number;
  private readonly traffic: NavigationAvoidanceTraffic;
  private readonly agents: ScenarioAgent[];
  private allStationarySteps = 0;
  private maxOverlap = 0;
  private steps = 0;
  private finished = false;
  private result?: NavigationAvoidanceScenarioResult;

  constructor(
    private readonly options: NavigationAvoidanceScenarioOptions,
    private readonly maximumSteps: number,
    private readonly timeStepSeconds: number,
    private readonly blockedAfterSteps: number,
  ) {
    this.seed = options.seed ?? 1;
    this.traffic = options.traffic ?? 'opposing';
    this.agents = createAgents(options.agentCount, this.traffic, seededRandom(this.seed));
  }

  snapshot(): NavigationAvoidanceScenarioSnapshot {
    return {
      steps: this.steps,
      finished: this.finished,
      agents: this.agents.map(agent => ({
        id: agent.id,
        position: { ...agent.position },
        radius: agent.radius,
        journeyDirection: agent.journeyDirection,
        goalX: agent.goalX,
        completed: agent.completed,
        holding: agent.holding,
      })),
      result: this.result,
    };
  }

  step(): NavigationAvoidanceScenarioSnapshot {
    if (this.finished) return this.snapshot();
    const activeAgents = this.agents.filter(agent => !agent.completed);
    const index = createNavigationSpatialIndex({ cellSize: 2, agents: activeAgents });
    const nextPositions = new Map<string, { x: number; z: number }>();
    let stationaryThisStep = 0;
    let activeThisStep = 0;
    for (const agent of this.agents) {
      if (agent.completed) continue;
      activeThisStep += 1;
      const nearbyAgents = index.queryAgents(agent.position, 4);
      const opposing = nearbyAgents
        .map(other => this.agents.find(candidate => candidate.id === other.id))
        .filter((candidate): candidate is ScenarioAgent => candidate !== undefined)
        .filter(candidate => candidate.id !== agent.id && candidate.journeyDirection !== agent.journeyDirection)
        .sort((left, right) => Math.abs(left.position.x - agent.position.x) - Math.abs(right.position.x - agent.position.x))[0];
      const rightOfWayAgent = this.traffic === 'opposing-with-staging'
        ? this.agents.find(candidate => !candidate.completed && candidate.journeyDirection !== agent.journeyDirection
          && candidate.id < agent.id)
        : undefined;
      agent.holding = rightOfWayAgent !== undefined;
      let preferredVelocity = velocityTowards(agent.position, { x: agent.goalX, y: 0, z: 0 }, 3);
      if (rightOfWayAgent) {
        preferredVelocity = velocityTowards(agent.position, stagingPoint, 2.4);
      } else if (this.options.mode === 'priority-yield' && opposing && Math.abs(opposing.position.x - agent.position.x) < 3) {
        if (agent.id > opposing.id) preferredVelocity = { x: -agent.journeyDirection * 2.4, y: 0, z: 0 };
      }
      const velocity = calculateNavigationAvoidanceVelocity({
        agent: { ...agent, preferredVelocity },
        nearbyAgents,
        separationWeight: this.options.mode === 'baseline' ? 1 : 0.35,
      });
      const velocityX = Math.max(-3, Math.min(3, velocity.x));
      const velocityZ = Math.max(-3, Math.min(3, velocity.z));
      const nextX = Math.max(-12, Math.min(12, agent.position.x + velocityX * this.timeStepSeconds));
      const nextZ = agent.position.z + velocityZ * this.timeStepSeconds;
      nextPositions.set(agent.id, { x: nextX, z: nextZ });
      if (Math.hypot(velocityX, velocityZ) < 0.05) stationaryThisStep += 1;
      if (Math.abs(velocityX) > 0.05 && Math.sign(velocityX) !== Math.sign(agent.previousVelocityX)
        && Math.abs(agent.previousVelocityX) > 0.05) agent.velocityReversals += 1;
      agent.previousVelocityX = velocityX;
      const previousDistance = Math.hypot(agent.goalX - agent.position.x, agent.position.z);
      const nextDistance = Math.hypot(agent.goalX - nextX, nextZ);
      if (rightOfWayAgent || previousDistance - nextDistance > 0.001) agent.noProgressSteps = 0;
      else agent.noProgressSteps += 1;
      if (nextDistance < 0.45) agent.completed = true;
    }
    for (const agent of this.agents) {
      const next = nextPositions.get(agent.id);
      if (next) agent.position = { x: next.x, y: 0, z: next.z };
    }
    this.maxOverlap = Math.max(this.maxOverlap, measureOverlap(activeAgents));
    if (activeThisStep > 0 && stationaryThisStep === activeThisStep) this.allStationarySteps += 1;
    else this.allStationarySteps = 0;
    this.steps += 1;
    this.finished = this.steps >= this.maximumSteps
      || this.agents.every(agent => agent.completed || agent.noProgressSteps >= this.blockedAfterSteps);
    if (this.finished) this.result = this.buildResult();
    return this.snapshot();
  }

  runToCompletion(): NavigationAvoidanceScenarioResult {
    while (!this.finished) this.step();
    return this.result!;
  }

  private buildResult(): NavigationAvoidanceScenarioResult {
    const completed = this.agents.filter(agent => agent.completed).length;
    const blocked = this.agents.filter(agent => !agent.completed && agent.noProgressSteps >= this.blockedAfterSteps).length;
    const stationary = this.agents.filter(agent => !agent.completed && Math.abs(agent.previousVelocityX) < 0.05).length;
    const moving = this.agents.length - completed - stationary;
    const velocityReversals = this.agents.reduce((total, agent) => total + agent.velocityReversals, 0);
    const oscillating = this.agents.some(agent => !agent.completed && agent.velocityReversals >= 4);
  const failureReasons = [
      ...(this.allStationarySteps >= 20 ? ['all-stationary'] : []),
    ...(oscillating ? ['oscillation'] : []),
    ...(blocked > 0 ? ['blocked'] : []),
      ...(this.maxOverlap > 0.01 ? ['overlap'] : []),
  ];
    const compactReport = `mode=${this.options.mode} traffic=${this.traffic} seed=${this.seed} agents=${this.agents.length} steps=${this.steps} completed=${completed} blocked=${blocked} stationary=${stationary} moving=${moving} overlap=${this.maxOverlap.toFixed(2)} reversals=${velocityReversals} failures=${failureReasons.join(',') || 'none'}`;
    return {
    mode: this.options.mode,
    traffic: this.traffic,
    agentCount: this.agents.length,
    seed: this.seed,
    steps: this.steps,
    completed,
    blocked,
    stationary,
    moving,
    maxOverlap: this.maxOverlap,
    velocityReversals,
    allStationary: this.allStationarySteps >= 20,
    oscillating,
    failureReasons,
    compactReport,
    };
  }
}

/** Runs the same step-driven core to completion. */
export function runNavigationAvoidanceScenario(
  options: NavigationAvoidanceScenarioOptions,
): NavigationAvoidanceScenarioResult {
  return createNavigationAvoidanceScenarioSimulation(options).runToCompletion();
}

/** Runs many deterministic seeds and returns only aggregate failure data. */
export function runNavigationAvoidanceScenarioSweep(
  options: NavigationAvoidanceScenarioSweepOptions,
): NavigationAvoidanceScenarioSweepResult {
  if (!options.seeds.length) throw new Error('Avoidance scenario sweep requires at least one seed.');
  const results = options.seeds.map(seed => runNavigationAvoidanceScenario({ ...options, seed }));
  const traffic = options.traffic ?? 'opposing';
  const failedSeeds = results.filter(result => result.failureReasons.length > 0).map(result => result.seed);
  const shownSeeds = failedSeeds.slice(0, 12).join(',') || 'none';
  const suffix = failedSeeds.length > 12 ? `,+${failedSeeds.length - 12}-more` : '';
  const compactReport = `mode=${options.mode} traffic=${traffic} agents=${options.agentCount} runs=${results.length} failures=${failedSeeds.length} failedSeeds=${shownSeeds}${suffix}`;
  return {
    mode: options.mode,
    traffic,
    agentCount: options.agentCount,
    totalRuns: results.length,
    failedRuns: failedSeeds.length,
    failedSeeds,
    compactReport,
  };
}

function createAgents(
  agentCount: number,
  traffic: NavigationAvoidanceTraffic,
  random: () => number,
): ScenarioAgent[] {
  const perDirection = Math.ceil(agentCount / 2);
  return Array.from({ length: agentCount }, (_, index) => {
    const forward = traffic === 'same-direction' || index < perDirection;
    const offset = traffic === 'same-direction' || forward ? index : index - perDirection;
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
      holding: false,
    };
  });
}

function measureOverlap(agents: readonly ScenarioAgent[]): number {
  let maximum = 0;
  for (let left = 0; left < agents.length; left += 1) for (let right = left + 1; right < agents.length; right += 1) {
    const distance = Math.hypot(
      agents[left].position.x - agents[right].position.x,
      agents[left].position.z - agents[right].position.z,
    );
    maximum = Math.max(maximum, agents[left].radius + agents[right].radius - distance);
  }
  return maximum;
}

function validateOptions(options: NavigationAvoidanceScenarioOptions, steps: number, timeStep: number, blockedAfter: number): void {
  if (!['baseline', 'priority-yield'].includes(options.mode)) throw new Error('Unknown avoidance scenario mode.');
  if (options.traffic !== undefined && !['same-direction', 'opposing', 'opposing-with-staging'].includes(options.traffic)) {
    throw new Error('Unknown avoidance traffic fixture.');
  }
  if (!Number.isSafeInteger(options.agentCount) || options.agentCount <= 0) throw new Error('Avoidance scenario agent count must be positive.');
  if (!Number.isSafeInteger(options.seed ?? 1)) throw new Error('Avoidance scenario seed must be an integer.');
  if (!Number.isSafeInteger(steps) || steps <= 0 || !Number.isFinite(timeStep) || timeStep <= 0
    || !Number.isSafeInteger(blockedAfter) || blockedAfter <= 0) throw new Error('Avoidance scenario limits must be positive.');
}

function velocityTowards(from: NavigationAvoidanceAgent['position'], to: NavigationAvoidanceAgent['position'], speed: number) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.05) return { x: 0, y: 0, z: 0 };
  return { x: dx / distance * speed, y: 0, z: dz / distance * speed };
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
