import {
  createNavigationGridBenchmarkScenario,
  runNavigationGridBenchmark,
} from './navigation-benchmarks';
import { createNavigationHeightfieldGrid, NavigationGridCell } from './navigation-grid';

const profile = { id: 'rover', domains: ['ground'], radius: 0.5, height: 1 } as const;

function openGrid() {
  const cell: NavigationGridCell = { walkable: true, elevation: 0, clearance: 1, cost: 1 };
  return createNavigationHeightfieldGrid({
    frameId: 'world', origin: { x: 0, y: 0, z: 0 }, cellSize: 1,
    columns: 16, rows: 16, cells: Array.from({ length: 256 }, () => cell),
  });
}

describe('navigation grid benchmark harness', () => {
  it('creates reproducible agent scenarios at the target scale points', () => {
    const grid = openGrid();
    const first = createNavigationGridBenchmarkScenario({ grid, agentCount: 100, seed: 42 });
    const second = createNavigationGridBenchmarkScenario({ grid, agentCount: 100, seed: 42 });

    expect(first).toEqual(second);
    expect(first.requests.length).toBe(100);
  });

  it('runs 1, 100, and 1,000 agents with bounded deterministic work', () => {
    const grid = openGrid();
    for (const agentCount of [1, 100, 1000]) {
      const result = runNavigationGridBenchmark({
        grid,
        scenario: createNavigationGridBenchmarkScenario({ grid, agentCount, seed: agentCount }),
        profile,
        maximumExpandedNodes: 512,
      });
      expect(result.agentCount).toBe(agentCount);
      expect(result.completed + result.partial + result.unreachable + result.budgetExceeded).toBe(agentCount);
      expect(result.totalExpandedNodes).toBeLessThanOrEqual(agentCount * 512);
      expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
    }
  });
});
