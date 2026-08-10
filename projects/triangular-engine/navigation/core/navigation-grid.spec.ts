import {
  applyNavigationGridChangeSet,
  createNavigationHeightfieldGrid,
  findNavigationGridRoute,
  isNavigationGridRouteValid,
  NavigationGridCell,
  simplifyNavigationGridRoute,
} from './navigation-grid';

const profile = { id: 'rover', domains: ['ground'], radius: 0.5, height: 1 } as const;

function grid(cells: readonly NavigationGridCell[], columns = 5, rows = 3) {
  return createNavigationHeightfieldGrid({
    frameId: 'world',
    origin: { x: 100, y: 0, z: 200 },
    cellSize: 2,
    columns,
    rows,
    cells,
  });
}

function openCell(elevation = 0): NavigationGridCell {
  return { walkable: true, elevation, clearance: 1, cost: 1 };
}

describe('findNavigationGridRoute', () => {
  it('routes around a blocked cell and returns frame-relative 3D locations', () => {
    const cells = Array.from({ length: 15 }, () => openCell());
    cells[7] = { ...cells[7], walkable: false };
    const result = findNavigationGridRoute({
      grid: grid(cells),
      start: { column: 0, row: 1 },
      goal: { column: 4, row: 1 },
      profile,
    });

    expect(result.status).toBe('complete');
    expect(result.cells.some((cell) => cell.column === 2 && cell.row === 1)).toBeFalse();
    expect(result.locations[0]).toEqual({ frameId: 'world', position: { x: 101, y: 0, z: 203 } });
    expect(result.locations[result.locations.length - 1]).toEqual({
      frameId: 'world', position: { x: 109, y: 0, z: 203 },
    });
  });

  it('rejects routes that exceed the slope limit', () => {
    const cells = Array.from({ length: 3 }, () => openCell());
    cells[1] = openCell(10);
    const result = findNavigationGridRoute({
      grid: grid(cells, 3, 1),
      start: { column: 0, row: 0 },
      goal: { column: 2, row: 0 },
      profile: { ...profile, maxSlopeRadians: 0.1 },
    });

    expect(result.status).toBe('unreachable');
    expect(result.expandedNodes).toBe(1);
  });

  it('returns a bounded-work result instead of expanding indefinitely', () => {
    const result = findNavigationGridRoute({
      grid: grid(Array.from({ length: 15 }, () => openCell())),
      start: { column: 0, row: 0 },
      goal: { column: 4, row: 2 },
      profile,
      maximumExpandedNodes: 1,
    });

    expect(result.status).toBe('budget-exceeded');
    expect(result.expandedNodes).toBe(1);
    expect(result.cells).toEqual([]);
  });

  it('invalidates only routes that depend on changed cells', () => {
    const original = grid(Array.from({ length: 15 }, () => openCell()));
    const route = findNavigationGridRoute({
      grid: original,
      start: { column: 0, row: 1 },
      goal: { column: 4, row: 1 },
      profile,
    });
    const changedCell = route.cells[1];
    const updated = applyNavigationGridChangeSet(original, {
      baseVersion: 1,
      nextVersion: 2,
      cells: [{ address: changedCell, cell: { ...openCell(), walkable: false } }],
    });

    expect(isNavigationGridRouteValid(route, original)).toBeTrue();
    expect(isNavigationGridRouteValid(route, updated)).toBeFalse();
  });

  it('rejects stale change sets', () => {
    const original = grid(Array.from({ length: 15 }, () => openCell()));

    expect(() => applyNavigationGridChangeSet(original, {
      baseVersion: 0,
      nextVersion: 2,
      cells: [],
    })).toThrowError('Navigation grid change set expects version 0, current version is 1.');
  });

  it('simplifies redundant points without changing the endpoints', () => {
    const route = findNavigationGridRoute({
      grid: grid(Array.from({ length: 15 }, () => openCell())),
      start: { column: 0, row: 0 },
      goal: { column: 4, row: 0 },
      profile,
    });
    const simplified = simplifyNavigationGridRoute(route);
    expect(simplified.cells).toEqual([
      { column: 0, row: 0 },
      { column: 4, row: 0 },
    ]);
  });

  it('enforces the explicit minimum clearance profile constraint', () => {
    const result = findNavigationGridRoute({
      grid: grid(Array.from({ length: 15 }, () => openCell())),
      start: { column: 0, row: 0 },
      goal: { column: 4, row: 0 },
      profile: { ...profile, minimumClearance: 2 },
    });
    expect(result.status).toBe('unreachable');
  });
});
