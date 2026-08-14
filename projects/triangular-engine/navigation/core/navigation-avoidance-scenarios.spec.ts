import {
  createNavigationAvoidanceScenarioSimulation,
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

  it('lets one opposing pair use an off-corridor staging point', () => {
    const result = runNavigationAvoidanceScenario({
      mode: 'priority-yield',
      traffic: 'opposing-with-staging',
      agentCount: 2,
      seed: 42,
    });

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
