import { expect, test } from '../lib/perf-fixture';

test.describe('scatter', () => {
  test('LOD re-bucketing and per-tier instanced rebuild every frame (20,000 instances)', async ({ perf }) => {
    const run = await perf.run({ scenario: 'scatter-lod-rebuild', params: { count: 20_000, rebuildEveryFrames: 1 } });
    expect(Number(run.facts.scenarioFacts['rebuilds'])).toBeGreaterThan(1);
    expect(Number(run.facts.scenarioFacts['tiers'])).toBeGreaterThan(0);
    expect(run.distributions['custom.scatterBucketMs']).not.toBeNull();
    expect(run.distributions['custom.scatterBuildMs']).not.toBeNull();
  });
});
