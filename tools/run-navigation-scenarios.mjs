import('../dist/triangular-engine/fesm2022/triangular-engine-navigation.mjs').then(({ runNavigationAvoidanceScenarioSweep }) => {
  const mode = process.argv[2] === 'priority-yield' ? 'priority-yield' : 'baseline';
  const agentCount = Number.parseInt(process.argv[3] ?? '2', 10);
  const runCount = Number.parseInt(process.argv[4] ?? '100', 10);
  if (!Number.isSafeInteger(agentCount) || agentCount <= 0 || !Number.isSafeInteger(runCount) || runCount <= 0) {
    throw new Error('Usage: node tools/run-navigation-scenarios.mjs [baseline|priority-yield] [agents] [runs]');
  }
  const seeds = Array.from({ length: runCount }, (_, index) => index + 1);
  console.log(runNavigationAvoidanceScenarioSweep({ mode, agentCount, seeds }).compactReport);
});
