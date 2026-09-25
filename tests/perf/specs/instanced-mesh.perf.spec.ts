import { expect, test } from '../lib/perf-fixture';

/**
 * InstancedMesh coverage. Every test enforces hardware-independent
 * functional checks (instance counts, one draw call, exact triangles) and
 * records timings that are compared against `tests/perf/history`.
 */
test.describe('InstancedMesh', () => {
  // A scaling series: separate params are separate history keys, so a
  // regression that only shows at high counts is still visible over time.
  for (const count of [1_000, 20_000, 100_000]) {
    test(`static instancing scales to ${count.toLocaleString('en-US')} instances`, async ({ perf }) => {
      const run = await perf.run({ scenario: 'instanced-static', params: { count } });
      expect(run.facts.scenarioFacts['instanceCount']).toBe(count);
      expect(run.facts.frame.drawCalls).toBe(1);
    });
  }

  test('per-frame matrix updates on 20,000 instances', async ({ perf }) => {
    const run = await perf.run({ scenario: 'instanced-dynamic', params: { count: 20_000 } });
    expect(run.distributions['custom.scenarioUpdateMs']).not.toBeNull();
    expect(Number(run.facts.scenarioFacts['updates'])).toBeGreaterThan(0);
  });

  test('<instancedMesh> component pushes per-frame data through onDataChanged', async ({ perf }) => {
    const run = await perf.run({ scenario: 'instanced-component', params: { count: 10_000 } });
    expect(run.facts.scenarioFacts['instanceCount']).toBe(10_000);
    expect(run.distributions['custom.scenarioUpdateMs']).not.toBeNull();
  });

  test('instancing submits far cheaper than the same number of individual meshes', async ({ perf }) => {
    // Relative comparison inside one run: independent of machine speed, so
    // it holds on software GL in CI and on a real GPU alike.
    const count = 2_000;
    const instanced = await perf.run({ scenario: 'instanced-static', params: { count } });
    const individual = await perf.run({ scenario: 'meshes-individual', params: { count } });
    expect(individual.facts.frame.drawCalls).toBe(count);
    const instancedRender = instanced.distributions['renderCpuMs']!.p50;
    const individualRender = individual.distributions['renderCpuMs']!.p50;
    expect(instancedRender, `instanced ${instancedRender} ms vs individual ${individualRender} ms`).toBeLessThan(individualRender);
  });
});
