import {
  calculateNavigationAvoidanceVelocity,
  calculateNavigationVelocityObstacleVelocity,
  classifyNavigationAvoidanceState,
  createNavigationSpatialIndex,
  NavigationAvoidanceAgent,
} from './navigation-avoidance';
import {
  createNavigationAvoidanceBenchmarkScenario,
  runNavigationAvoidanceBenchmark,
} from './navigation-avoidance-benchmarks';

const agent = (id: string, x: number, z: number): NavigationAvoidanceAgent => ({
  id,
  position: { x, y: 0, z },
  preferredVelocity: { x: 1, y: 0, z: 0 },
  radius: 1,
  maxSpeed: 3,
});

describe('navigation avoidance', () => {
  it('queries only nearby agents in deterministic ID order', () => {
    const index = createNavigationSpatialIndex({
      cellSize: 2,
      agents: [agent('far', 10, 0), agent('z-agent', 1, 0), agent('a-agent', 0, 1)],
    });

    expect(index.queryAgents({ x: 0, y: 0, z: 0 }, 2).map(item => item.id))
      .toEqual(['a-agent', 'z-agent']);
  });

  it('steers away from an overlapping agent while respecting max speed', () => {
    const subject = agent('subject', 0, 0);
    const result = calculateNavigationAvoidanceVelocity({
      agent: subject,
      nearbyAgents: [subject, agent('other', 0.5, 0)],
      separationWeight: 2,
    });

    expect(result.x).toBeLessThan(0);
    expect(Math.hypot(result.x, result.z)).toBeLessThanOrEqual(3);
  });

  it('steers away from an overlapping obstacle', () => {
    const result = calculateNavigationAvoidanceVelocity({
      agent: agent('subject', 0, 0),
      nearbyObstacles: [{ id: 'wall', position: { x: 0.5, y: 0, z: 0 }, radius: 1 }],
    });

    expect(result.x).toBeLessThan(0);
  });

  it('chooses a non-colliding candidate for a head-on agent', () => {
    const subject = { ...agent('subject', 0, 0), preferredVelocity: { x: 1, y: 0, z: 0 } };
    const other = { ...agent('other', 1.5, 0), velocity: { x: -1, y: 0, z: 0 } };
    const result = calculateNavigationVelocityObstacleVelocity({
      agent: subject,
      nearbyAgents: [other],
      horizonSeconds: 1,
      directionSamples: 8,
    });

    expect(result.z).not.toBe(0);
  });

  it('escalates avoidance symptoms through yielding, local, and global actions', () => {
    expect(classifyNavigationAvoidanceState({ preferredSpeed: 1, actualSpeed: 0, progressDistance: 0, noProgressSeconds: 0.1, blockedSeconds: 0 }))
      .toBe('yielding');
    expect(classifyNavigationAvoidanceState({ preferredSpeed: 1, actualSpeed: 0, progressDistance: 0, noProgressSeconds: 0.5, blockedSeconds: 0 }))
      .toBe('stuck');
    expect(classifyNavigationAvoidanceState({ preferredSpeed: 1, actualSpeed: 0, progressDistance: 0, noProgressSeconds: 1, blockedSeconds: 1 }))
      .toBe('replan-local');
    expect(classifyNavigationAvoidanceState({ preferredSpeed: 1, actualSpeed: 0, progressDistance: 0, noProgressSeconds: 3, blockedSeconds: 3 }))
      .toBe('replan-global');
  });

  it('measures deterministic avoidance work for a crowd fixture', () => {
    const scenario = createNavigationAvoidanceBenchmarkScenario({ agentCount: 100, seed: 7 });
    const result = runNavigationAvoidanceBenchmark({ scenario, steps: 2 });

    expect(result.processedAgentSteps).toBe(200);
    expect(result.totalNearbyAgents).toBeGreaterThanOrEqual(200);
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });
});
