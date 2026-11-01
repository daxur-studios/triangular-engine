import { JOLT_PERF_IDLE_SETTINGS, JOLT_PERF_TEST_HISTORY, MESH_PATCH_REPETITIONS } from './jolt-perf-cases';

describe('jolt-perf cases', () => {
  const suite = JOLT_PERF_TEST_HISTORY[JOLT_PERF_TEST_HISTORY.length - 1];

  it('is the jolt-perf suite, version 1, as a performance suite', () => {
    expect(suite.id).toBe('jolt-perf');
    expect(suite.version).toBe(1);
    expect(suite.purpose).toBe('performance');
  });

  it('has the six cases of the brief with unique ids', () => {
    const ids = suite.scenarios.map((scenario) => scenario.id);
    expect(ids).toEqual([
      'step-bodies-1',
      'step-bodies-10',
      'step-bodies-100',
      'step-compound-10',
      'static-mesh-patch',
      'precision-far',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives each step case the body count in its id and its scene', () => {
    const steps = suite.scenarios.filter((scenario) => scenario.settings.probe === 'steps');
    expect(steps.map((scenario) => [scenario.settings.scene, scenario.settings.count])).toEqual([
      ['boxes', 1],
      ['boxes', 10],
      ['boxes', 100],
      ['compound', 10],
    ]);
  });

  it('gives the step cases a warm-up and a fixed window, and the probe cases no bodies', () => {
    for (const scenario of suite.scenarios) {
      if (scenario.settings.probe === 'steps') {
        expect(scenario.warmupMs).toBeGreaterThan(0);
        expect(scenario.durationMs).toBeGreaterThan(0);
      } else {
        expect(scenario.settings.scene).toBe('empty');
        expect(scenario.settings.count).toBe(0);
      }
    }
  });

  it('sets no budgets and no baseline: the numbers are recorded only', () => {
    expect(suite.baseline).toBeUndefined();
    for (const scenario of suite.scenarios) {
      expect(scenario.budgets).toBeUndefined();
    }
  });

  it('repeats the static mesh patch cycle 20 times', () => {
    expect(MESH_PATCH_REPETITIONS).toBe(20);
  });

  it('starts from an empty world', () => {
    expect(JOLT_PERF_IDLE_SETTINGS).toEqual({ scene: 'empty', count: 0, probe: 'steps' });
  });
});
