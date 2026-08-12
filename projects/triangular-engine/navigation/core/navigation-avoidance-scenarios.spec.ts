import {
  runNavigationAvoidanceScenario,
  runNavigationAvoidanceScenarioSweep,
} from './navigation-avoidance-scenarios';

describe('navigation avoidance scenario harness', () => {
  it('returns a compact deterministic report', () => {
    const first = runNavigationAvoidanceScenario({ mode: 'baseline', agentCount: 2, seed: 42 });
    const second = runNavigationAvoidanceScenario({ mode: 'baseline', agentCount: 2, seed: 42 });

    expect(first.compactReport).toBe(second.compactReport);
    expect(first.compactReport).toContain('mode=baseline seed=42 agents=2');
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
    expect(result.failedRuns).toBe(result.failedSeeds.length);
    expect(result.compactReport).toContain('failedSeeds=');
    expect(result.compactReport.length).toBeLessThan(180);
  });
});
