import {
  NavigationGridCellAddress,
  NavigationHeightfieldGrid,
  NavigationGridRouteResult,
} from './navigation-grid';
import { NavigationDependency, TraversalProfile } from './navigation-types';

export interface NavigationGridGoalField {
  readonly frameId: string;
  readonly gridVersion: number;
  readonly goal: NavigationGridCellAddress;
  readonly profileKey: string;
  readonly distances: readonly number[];
  /** For each cell, the next cell to visit on the route to the goal. */
  readonly nextSteps: readonly number[];
  readonly expandedNodes: number;
  readonly complete: boolean;
}

export function buildNavigationGridGoalField(options: {
  readonly grid: NavigationHeightfieldGrid;
  readonly goal: NavigationGridCellAddress;
  readonly profile: TraversalProfile;
  readonly maximumExpandedNodes?: number;
}): NavigationGridGoalField {
  const { grid, goal, profile } = options;
  assertAddress(grid, goal);
  const maximumExpandedNodes = options.maximumExpandedNodes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maximumExpandedNodes) || maximumExpandedNodes <= 0) {
    throw new Error('Maximum expanded nodes must be a positive integer.');
  }

  const goalIndex = indexOf(grid, goal);
  const distances = new Float64Array(grid.cells.length);
  distances.fill(Number.POSITIVE_INFINITY);
  const nextSteps = new Int32Array(grid.cells.length);
  nextSteps.fill(-1);
  const closed = new Uint8Array(grid.cells.length);
  const open = new MinHeap();

  if (isTraversable(grid, goalIndex, goalIndex, profile)) {
    distances[goalIndex] = 0;
    open.push({ index: goalIndex, priority: 0 });
  }

  let expandedNodes = 0;
  while (open.size > 0 && expandedNodes < maximumExpandedNodes) {
    const current = open.pop()!;
    if (closed[current.index]) continue;
    closed[current.index] = 1;
    expandedNodes += 1;

    for (const neighbor of neighbors(grid, current.index)) {
      if (closed[neighbor] || !isTraversable(grid, neighbor, current.index, profile)) continue;
      const nextCost = distances[current.index] + movementCost(grid, neighbor, current.index);
      if (nextCost < distances[neighbor]) {
        distances[neighbor] = nextCost;
        nextSteps[neighbor] = current.index;
        open.push({ index: neighbor, priority: nextCost });
      }
    }
  }

  return {
    frameId: grid.frameId,
    gridVersion: grid.version,
    goal: { ...goal },
    profileKey: navigationProfileKey(profile),
    distances: Array.from(distances),
    nextSteps: Array.from(nextSteps),
    expandedNodes,
    complete: open.size === 0,
  };
}

export function findNavigationGridRouteFromGoalField(options: {
  readonly grid: NavigationHeightfieldGrid;
  readonly field: NavigationGridGoalField;
  readonly start: NavigationGridCellAddress;
  readonly profile: TraversalProfile;
}): NavigationGridRouteResult {
  const { grid, field, start, profile } = options;
  assertAddress(grid, start);
  if (field.frameId !== grid.frameId || field.gridVersion !== grid.version) {
    throw new Error('Navigation goal field does not match the current grid.');
  }
  if (field.profileKey !== navigationProfileKey(profile)) {
    throw new Error('Navigation goal field does not match the traversal profile.');
  }

  const startIndex = indexOf(grid, start);
  const goalIndex = indexOf(grid, field.goal);
  if (!Number.isFinite(field.distances[startIndex])) {
    return routeResult('budget-exceeded', [], 0, grid);
  }

  const cells: NavigationGridCellAddress[] = [];
  const seen = new Set<number>();
  let current = startIndex;
  while (true) {
    if (seen.has(current)) throw new Error('Navigation goal field contains a cycle.');
    seen.add(current);
    cells.push(addressOf(grid, current));
    if (current === goalIndex) break;
    const next = field.nextSteps[current];
    if (next < 0) return routeResult(field.complete ? 'unreachable' : 'budget-exceeded', [], 0, grid);
    current = next;
  }
  return routeResult('complete', cells, field.distances[startIndex], grid);
}

function navigationProfileKey(profile: TraversalProfile): string {
  return JSON.stringify({
    id: profile.id,
    domains: profile.domains,
    radius: profile.radius,
    height: profile.height,
    maxSlopeRadians: profile.maxSlopeRadians,
    minimumClearance: profile.minimumClearance,
  });
}

function assertAddress(grid: NavigationHeightfieldGrid, address: NavigationGridCellAddress): void {
  if (!Number.isSafeInteger(address.column) || !Number.isSafeInteger(address.row)
    || address.column < 0 || address.column >= grid.columns
    || address.row < 0 || address.row >= grid.rows) {
    throw new Error('Navigation goal-field cell is outside the grid.');
  }
}

function indexOf(grid: NavigationHeightfieldGrid, address: NavigationGridCellAddress): number {
  return address.row * grid.columns + address.column;
}

function addressOf(grid: NavigationHeightfieldGrid, index: number): NavigationGridCellAddress {
  return { column: index % grid.columns, row: Math.floor(index / grid.columns) };
}

function isTraversable(grid: NavigationHeightfieldGrid, index: number, fromIndex: number, profile: TraversalProfile): boolean {
  const cell = grid.cells[index];
  if (!cell.walkable || cell.clearance < profile.radius * 2) return false;
  if (profile.maxSlopeRadians === undefined) return true;
  return Math.atan2(Math.abs(cell.elevation - grid.cells[fromIndex].elevation), grid.cellSize)
    <= profile.maxSlopeRadians;
}

function movementCost(grid: NavigationHeightfieldGrid, from: number, to: number): number {
  const a = addressOf(grid, from);
  const b = addressOf(grid, to);
  return grid.cells[to].cost * (a.column !== b.column && a.row !== b.row ? Math.SQRT2 : 1);
}

function neighbors(grid: NavigationHeightfieldGrid, index: number): number[] {
  const address = addressOf(grid, index);
  const result: number[] = [];
  for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const column = address.column + dc;
    const row = address.row + dr;
    if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) continue;
    if (dc !== 0 && dr !== 0) {
      if (!grid.cells[indexOf(grid, { column: address.column + dc, row: address.row })].walkable
        || !grid.cells[indexOf(grid, { column: address.column, row: address.row + dr })].walkable) continue;
    }
    result.push(indexOf(grid, { column, row }));
  }
  return result;
}

function routeResult(status: NavigationGridRouteResult['status'], cells: readonly NavigationGridCellAddress[], cost: number, grid: NavigationHeightfieldGrid): NavigationGridRouteResult {
  return {
    status,
    cells,
    locations: cells.map((cell) => {
      const index = indexOf(grid, cell);
      return {
        frameId: grid.frameId,
        position: {
          x: grid.origin.x + (cell.column + 0.5) * grid.cellSize,
          y: grid.cells[index].elevation,
          z: grid.origin.z + (cell.row + 0.5) * grid.cellSize,
        },
      };
    }),
    cost,
    expandedNodes: 0,
    dependencies: cells.map((cell): NavigationDependency => {
      const index = indexOf(grid, cell);
      return { id: `grid-cell:${index}`, version: grid.cells[index].version ?? grid.version };
    }),
  };
}

interface HeapEntry { readonly index: number; readonly priority: number; }

class MinHeap {
  private readonly entries: HeapEntry[] = [];
  get size(): number { return this.entries.length; }
  push(entry: HeapEntry): void {
    this.entries.push(entry);
    let child = this.entries.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.entries[parent].priority <= entry.priority) break;
      this.entries[child] = this.entries[parent];
      child = parent;
    }
    this.entries[child] = entry;
  }
  pop(): HeapEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (last !== undefined && this.entries.length > 0) {
      let parent = 0;
      while (true) {
        const left = parent * 2 + 1;
        if (left >= this.entries.length) break;
        const right = left + 1;
        const child = right < this.entries.length && this.entries[right].priority < this.entries[left].priority ? right : left;
        if (this.entries[child].priority >= last.priority) break;
        this.entries[parent] = this.entries[child];
        parent = child;
      }
      this.entries[parent] = last;
    }
    return first;
  }
}
