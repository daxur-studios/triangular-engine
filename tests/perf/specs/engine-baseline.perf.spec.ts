import { expect, test } from '../lib/perf-fixture';

test.describe('engine baseline', () => {
  test('empty scene establishes the per-frame overhead floor', async ({ perf }) => {
    const run = await perf.run({ scenario: 'empty' });
    expect(run.facts.frame.drawCalls).toBe(0);
    expect(run.entry.metrics['frames']).toBeGreaterThan(10);
  });

  test('2,000 individual meshes (draw-call bound)', async ({ perf }) => {
    const run = await perf.run({ scenario: 'meshes-individual', params: { count: 2_000 } });
    expect(run.facts.frame.drawCalls).toBe(2_000);
  });
});
