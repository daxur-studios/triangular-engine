import {
  createNavigationAvoidanceScenarioSimulation,
  isNavigationAvoidanceScenarioPositionWalkable,
  runNavigationAvoidanceScenario,
  runNavigationAvoidanceScenarioSweep,
} from './navigation-avoidance-scenarios';

describe('navigation avoidance scenario harness', () => {
  it('exposes the same deterministic core one fixed step at a time', () => {
    const options = {
      mode: 'priority-yield' as const,
      traffic: 'opposing-with-staging' as const,
      agentCount: 2,
      seed: 42,
    };
    const simulation = createNavigationAvoidanceScenarioSimulation(options);
    const initial = simulation.snapshot();
    const firstStep = simulation.step();

    expect(initial.steps).toBe(0);
    expect(initial.finished).toBeFalse();
    expect(firstStep.steps).toBe(1);
    expect(firstStep.agents[0].position.x).not.toBe(initial.agents[0].position.x);
    expect(simulation.runToCompletion().compactReport)
      .toBe(runNavigationAvoidanceScenario(options).compactReport);
  });

  it('returns a compact deterministic report', () => {
    const first = runNavigationAvoidanceScenario({ mode: 'baseline', agentCount: 2, seed: 42 });
    const second = runNavigationAvoidanceScenario({ mode: 'baseline', agentCount: 2, seed: 42 });

    expect(first.compactReport).toBe(second.compactReport);
    expect(first.compactReport).toContain('mode=baseline traffic=opposing seed=42 agents=2');
  });

  it('lets one unobstructed agent finish without reporting a failure', () => {
    const result = runNavigationAvoidanceScenario({ mode: 'baseline', agentCount: 1, seed: 42 });

    expect(result.completed).toBe(1);
    expect(result.failureReasons).toEqual([]);
  });

  it('lets two same-direction agents finish without treating arrivals as obstacles', () => {
    const result = runNavigationAvoidanceScenario({
      mode: 'baseline',
      traffic: 'same-direction',
      agentCount: 2,
      seed: 42,
    });

    expect(result.completed).toBe(2);
    expect(result.failureReasons).toEqual([]);
  });

  it('keeps one staged opposing pair inside the shared walkable geometry', () => {
    const simulation = createNavigationAvoidanceScenarioSimulation({
      mode: 'priority-yield',
      traffic: 'opposing-with-staging',
      agentCount: 2,
      seed: 42,
    });
    let snapshot = simulation.snapshot();
    let maximumStagedZ = 0;
    const previousPositions = new Map(snapshot.agents.map(agent => [agent.id, agent.position]));
    while (!snapshot.finished) {
      snapshot = simulation.step();
      for (const agent of snapshot.agents) {
        expect(isNavigationAvoidanceScenarioPositionWalkable(
          agent.position, agent.radius, snapshot.walkableAreas,
        )).withContext(`${agent.id} entered a wall at step ${snapshot.steps}`).toBeTrue();
        const previous = previousPositions.get(agent.id)!;
        const distanceMoved = Math.hypot(agent.position.x - previous.x, agent.position.z - previous.z);
        expect(distanceMoved >= 0.01 || agent.waiting || agent.completed)
          .withContext(`${agent.id} moved only ${distanceMoved} at step ${snapshot.steps}`
            + ` from (${previous.x},${previous.z}) to (${agent.position.x},${agent.position.z})`).toBeTrue();
        previousPositions.set(agent.id, agent.position);
        maximumStagedZ = Math.max(maximumStagedZ, agent.position.z);
      }
    }
    const result = snapshot.result!;

    expect(maximumStagedZ).toBeGreaterThan(1);
    expect(result.completed).toBe(2);
    expect(result.maxOverlap).toBe(0);
    expect(result.failureReasons).toEqual([]);
  });

  it('clears the staged opposing pair across a quick seed sweep', () => {
    const result = runNavigationAvoidanceScenarioSweep({
      mode: 'priority-yield',
      traffic: 'opposing-with-staging',
      agentCount: 2,
      seeds: Array.from({ length: 20 }, (_, seed) => seed + 1),
    });

    expect(result.failedRuns).toBe(0);
  });

  it('reports a baseline failure category instead of calling the run healthy', () => {
    const result = runNavigationAvoidanceScenario({ mode: 'baseline', agentCount: 2, seed: 42 });

    expect(result.failureReasons.length).toBeGreaterThan(0);
    expect(result.failureReasons).not.toContain('false-arrival');
  });

  it('runs the priority-yield comparison through the same fixture', () => {
    const result = runNavigationAvoidanceScenario({ mode: 'priority-yield', agentCount: 2, seed: 42 });

    expect(result.mode).toBe('priority-yield');
    expect(result.steps).toBeGreaterThan(0);
    expect(result.compactReport).toContain('failures=');
  });

  it('supports a quick multi-seed sweep without verbose traces', () => {
    const reports = Array.from({ length: 20 }, (_, seed) => runNavigationAvoidanceScenario({
      mode: 'baseline',
      agentCount: 2,
      seed,
      maximumSteps: 120,
    }));

    expect(reports).toHaveSize(20);
    expect(reports.every(result => result.compactReport.length < 240)).toBeTrue();
  });

  it('returns aggregate sweep results and only failed seeds', () => {
    const result = runNavigationAvoidanceScenarioSweep({
      mode: 'baseline',
      agentCount: 2,
      seeds: [1, 2, 3, 4, 5],
      maximumSteps: 120,
    });

    expect(result.totalRuns).toBe(5);
    expect(result.traffic).toBe('opposing');
    expect(result.failedRuns).toBe(result.failedSeeds.length);
    expect(result.compactReport).toContain('failedSeeds=');
    expect(result.compactReport.length).toBeLessThan(180);
  });
});
