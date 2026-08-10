import {
  buildNavigationGridGoalField,
  findNavigationGridRouteFromGoalField,
} from './navigation-goal-field';
import { createNavigationHeightfieldGrid, findNavigationGridRoute, NavigationGridCell } from './navigation-grid';

const profile = { id: 'villager', domains: ['ground'], radius: 0.5, height: 1 } as const;

function openGrid() {
  const cells: NavigationGridCell[] = Array.from({ length: 16 * 16 }, () => ({
    walkable: true,
    elevation: 0,
    clearance: 1,
    cost: 1,
  }));
  return createNavigationHeightfieldGrid({
    frameId: 'world',
    origin: { x: 0, y: 0, z: 0 },
    cellSize: 1,
    columns: 16,
    rows: 16,
    cells,
  });
}

describe('navigation goal fields', () => {
  it('builds one shared destination field and extracts many routes cheaply', () => {
    const grid = openGrid();
    const goal = { column: 8, row: 8 };
    const field = buildNavigationGridGoalField({ grid, goal, profile });
    let independentExpandedNodes = 0;
    let completed = 0;

    for (let agent = 0; agent < 100; agent += 1) {
      const start = { column: agent % 16, row: Math.floor(agent / 16) };
      const shared = findNavigationGridRouteFromGoalField({ grid, field, start, profile });
      const independent = findNavigationGridRoute({ grid, start, goal, profile });
      independentExpandedNodes += independent.expandedNodes;
      if (shared.status === 'complete') completed += 1;
      expect(shared.cells[0]).toEqual(start);
      expect(shared.cells[shared.cells.length - 1]).toEqual(goal);
      expect(shared.expandedNodes).toBe(0);
    }

    expect(completed).toBe(100);
    expect(field.complete).toBeTrue();
    expect(field.expandedNodes).toBeLessThan(independentExpandedNodes);
  });

  it('rejects a field from a different grid version', () => {
    const grid = openGrid();
    const field = buildNavigationGridGoalField({ grid, goal: { column: 8, row: 8 }, profile });
    const changedGrid = createNavigationHeightfieldGrid({ ...grid, version: 2 });

    expect(() => findNavigationGridRouteFromGoalField({
      grid: changedGrid,
      field,
      start: { column: 0, row: 0 },
      profile,
    })).toThrowError('Navigation goal field does not match the current grid.');
  });
});
