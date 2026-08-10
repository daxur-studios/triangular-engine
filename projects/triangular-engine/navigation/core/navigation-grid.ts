import {
  assertNavigationVector3,
} from './navigation-coordinate';
import {
  NavigationDependency,
  NavigationLocation,
  NavigationVector3,
  TraversalProfile,
} from './navigation-types';

export interface NavigationGridCell {
  readonly version?: number;
  readonly walkable: boolean;
  readonly elevation: number;
  readonly clearance: number;
  readonly cost: number;
}

export interface NavigationHeightfieldGrid {
  readonly frameId: string;
  readonly version: number;
  readonly origin: NavigationVector3;
  readonly cellSize: number;
  readonly columns: number;
  readonly rows: number;
  /** Row-major cells: index = row * columns + column. */
  readonly cells: readonly NavigationGridCell[];
}

export interface NavigationGridCellChange {
  readonly address: NavigationGridCellAddress;
  readonly cell: NavigationGridCell;
}

export interface NavigationGridChangeSet {
  readonly baseVersion: number;
  readonly nextVersion: number;
  readonly cells: readonly NavigationGridCellChange[];
}

export interface NavigationGridCellAddress {
  readonly column: number;
  readonly row: number;
}

export interface NavigationGridRouteRequest {
  readonly grid: NavigationHeightfieldGrid;
  readonly start: NavigationGridCellAddress;
  readonly goal: NavigationGridCellAddress;
  readonly profile: TraversalProfile;
  readonly maximumExpandedNodes?: number;
  readonly allowPartial?: boolean;
}

export interface NavigationGridRouteResult {
  readonly status: 'complete' | 'partial' | 'unreachable' | 'budget-exceeded';
  readonly cells: readonly NavigationGridCellAddress[];
  readonly locations: readonly NavigationLocation[];
  readonly cost: number;
  readonly expandedNodes: number;
  readonly dependencies: readonly NavigationDependency[];
}

/** Removes redundant straight-line grid points while preserving the route. */
export function simplifyNavigationGridRoute(
  route: NavigationGridRouteResult,
): NavigationGridRouteResult {
  if (route.cells.length <= 2) return route;
  const cells: NavigationGridCellAddress[] = [route.cells[0]];
  for (let index = 1; index < route.cells.length - 1; index += 1) {
    const previous = cells[cells.length - 1];
    const current = route.cells[index];
    const next = route.cells[index + 1];
    const previousDirection = {
      column: Math.sign(current.column - previous.column),
      row: Math.sign(current.row - previous.row),
    };
    const nextDirection = {
      column: Math.sign(next.column - current.column),
      row: Math.sign(next.row - current.row),
    };
    if (previousDirection.column !== nextDirection.column
      || previousDirection.row !== nextDirection.row) {
      cells.push(current);
    }
  }
  cells.push(route.cells[route.cells.length - 1]);
  return { ...route, cells, locations: route.locations.filter((_, index) => {
    return index === 0 || index === route.locations.length - 1 || cells.some((cell) => {
      const original = route.cells[index];
      return original.column === cell.column && original.row === cell.row;
    });
  }), dependencies: route.dependencies.filter((_, index) => {
    return index === 0 || index === route.dependencies.length - 1 || cells.some((cell) => {
      const original = route.cells[index];
      return original.column === cell.column && original.row === cell.row;
    });
  }) };
}

export function createNavigationHeightfieldGrid(options: {
  readonly frameId: string;
  readonly version?: number;
  readonly origin: NavigationVector3;
  readonly cellSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly cells: readonly NavigationGridCell[];
}): NavigationHeightfieldGrid {
  if (!options.frameId.trim()) {
    throw new Error('Navigation grid frame ID must not be empty.');
  }
  if (!Number.isSafeInteger(options.version ?? 1) || (options.version ?? 1) < 1) {
    throw new Error('Navigation grid version must be a positive integer.');
  }
  assertNavigationVector3(options.origin, 'Navigation grid origin');
  if (!Number.isFinite(options.cellSize) || options.cellSize <= 0) {
    throw new Error('Navigation grid cell size must be positive.');
  }
  if (!Number.isSafeInteger(options.columns) || options.columns <= 0
    || !Number.isSafeInteger(options.rows) || options.rows <= 0) {
    throw new Error('Navigation grid dimensions must be positive integers.');
  }
  if (options.cells.length !== options.columns * options.rows) {
    throw new Error('Navigation grid cell count must match its dimensions.');
  }
  for (const cell of options.cells) {
    if (!Number.isFinite(cell.elevation) || !Number.isFinite(cell.clearance)
      || !Number.isFinite(cell.cost) || cell.clearance < 0 || cell.cost <= 0) {
      throw new Error('Navigation grid cells must have finite elevation, clearance, and positive cost.');
    }
  }

  const version = options.version ?? 1;
  return {
    ...options,
    version,
    cells: options.cells.map((cell) => ({ ...cell, version: cell.version ?? version })),
  };
}

export function applyNavigationGridChangeSet(
  grid: NavigationHeightfieldGrid,
  changeSet: NavigationGridChangeSet,
): NavigationHeightfieldGrid {
  if (changeSet.baseVersion !== grid.version) {
    throw new Error(`Navigation grid change set expects version ${changeSet.baseVersion}, current version is ${grid.version}.`);
  }
  if (!Number.isSafeInteger(changeSet.nextVersion) || changeSet.nextVersion <= grid.version) {
    throw new Error('Navigation grid change set must advance to a higher integer version.');
  }
  const cells = [...grid.cells];
  const changed = new Set<number>();
  for (const change of changeSet.cells) {
    assertAddress(grid, change.address, 'Changed');
    const index = indexOf(grid, change.address);
    if (changed.has(index)) {
      throw new Error(`Navigation grid cell ${index} is changed more than once.`);
    }
    if (!Number.isFinite(change.cell.elevation) || !Number.isFinite(change.cell.clearance)
      || !Number.isFinite(change.cell.cost) || change.cell.clearance < 0 || change.cell.cost <= 0) {
      throw new Error('Navigation grid changes must have finite elevation, clearance, and positive cost.');
    }
    changed.add(index);
    cells[index] = { ...change.cell, version: changeSet.nextVersion };
  }
  return { ...grid, version: changeSet.nextVersion, cells };
}

export function isNavigationGridRouteValid(
  route: NavigationGridRouteResult,
  grid: NavigationHeightfieldGrid,
): boolean {
  if (route.status !== 'complete' && route.status !== 'partial') {
    return false;
  }
  return route.dependencies.every((dependency) => {
    const match = /^grid-cell:(\d+)$/.exec(dependency.id);
    return match !== null && grid.cells[Number(match[1])]?.version === dependency.version;
  });
}

export function findNavigationGridRoute(request: NavigationGridRouteRequest): NavigationGridRouteResult {
  const { grid, start, goal, profile } = request;
  assertAddress(grid, start, 'Start');
  assertAddress(grid, goal, 'Goal');
  const maximumExpandedNodes = request.maximumExpandedNodes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maximumExpandedNodes) || maximumExpandedNodes <= 0) {
    throw new Error('Maximum expanded nodes must be a positive integer.');
  }
  if (!Number.isFinite(profile.radius) || profile.radius < 0
    || !Number.isFinite(profile.height) || profile.height <= 0) {
    throw new Error('Traversal profile radius and height must be valid.');
  }

  const startIndex = indexOf(grid, start);
  const goalIndex = indexOf(grid, goal);
  if (!isTraversable(grid, startIndex, startIndex, profile)
    || !isTraversable(grid, goalIndex, startIndex, profile)) {
    return result('unreachable', [], 0, 0, grid);
  }

  const scores = new Float64Array(grid.cells.length);
  scores.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(grid.cells.length);
  cameFrom.fill(-1);
  const closed = new Uint8Array(grid.cells.length);
  const open = new MinHeap();
  scores[startIndex] = 0;
  open.push({ index: startIndex, priority: heuristic(grid, startIndex, goalIndex) });
  let expandedNodes = 0;
  let closestIndex = startIndex;

  while (open.size > 0) {
    const current = open.pop()!;
    if (closed[current.index]) {
      continue;
    }
    closed[current.index] = 1;
    expandedNodes += 1;
    if (heuristic(grid, current.index, goalIndex) < heuristic(grid, closestIndex, goalIndex)) {
      closestIndex = current.index;
    }
    if (current.index === goalIndex) {
      return result('complete', reconstruct(cameFrom, goalIndex, grid), scores[goalIndex], expandedNodes, grid);
    }
    if (expandedNodes >= maximumExpandedNodes) {
      const path = request.allowPartial ? reconstruct(cameFrom, closestIndex, grid) : [];
      return result(request.allowPartial ? 'partial' : 'budget-exceeded', path, path.length ? scores[closestIndex] : 0, expandedNodes, grid);
    }

    for (const neighbor of neighbors(grid, current.index)) {
      if (closed[neighbor] || !isTraversable(grid, neighbor, current.index, profile)) {
        continue;
      }
      const nextCost = scores[current.index] + movementCost(grid, current.index, neighbor);
      if (nextCost < scores[neighbor]) {
        scores[neighbor] = nextCost;
        cameFrom[neighbor] = current.index;
        open.push({ index: neighbor, priority: nextCost + heuristic(grid, neighbor, goalIndex) });
      }
    }
  }

  return result('unreachable', [], 0, expandedNodes, grid);
}

function assertAddress(grid: NavigationHeightfieldGrid, address: NavigationGridCellAddress, label: string): void {
  if (!Number.isSafeInteger(address.column) || !Number.isSafeInteger(address.row)
    || address.column < 0 || address.column >= grid.columns
    || address.row < 0 || address.row >= grid.rows) {
    throw new Error(`${label} grid cell is outside the grid.`);
  }
}

function indexOf(grid: NavigationHeightfieldGrid, address: NavigationGridCellAddress): number {
  return address.row * grid.columns + address.column;
}

function addressOf(grid: NavigationHeightfieldGrid, index: number): NavigationGridCellAddress {
  return { column: index % grid.columns, row: Math.floor(index / grid.columns) };
}

function locationOf(grid: NavigationHeightfieldGrid, index: number): NavigationLocation {
  const address = addressOf(grid, index);
  const cell = grid.cells[index];
  return {
    frameId: grid.frameId,
    position: {
      x: grid.origin.x + (address.column + 0.5) * grid.cellSize,
      y: cell.elevation,
      z: grid.origin.z + (address.row + 0.5) * grid.cellSize,
    },
  };
}

function isTraversable(
  grid: NavigationHeightfieldGrid,
  index: number,
  fromIndex: number,
  profile: TraversalProfile,
): boolean {
  const cell = grid.cells[index];
  const requiredClearance = Math.max(profile.radius * 2, profile.minimumClearance ?? 0);
  if (!cell.walkable || cell.clearance < requiredClearance) {
    return false;
  }
  if (profile.maxSlopeRadians === undefined) {
    return true;
  }
  const horizontal = grid.cellSize;
  const slope = Math.atan2(Math.abs(cell.elevation - grid.cells[fromIndex].elevation), horizontal);
  return slope <= profile.maxSlopeRadians;
}

function movementCost(grid: NavigationHeightfieldGrid, from: number, to: number): number {
  const fromAddress = addressOf(grid, from);
  const toAddress = addressOf(grid, to);
  const diagonal = fromAddress.column !== toAddress.column && fromAddress.row !== toAddress.row;
  return grid.cells[to].cost * (diagonal ? Math.SQRT2 : 1);
}

function heuristic(grid: NavigationHeightfieldGrid, from: number, goal: number): number {
  const fromAddress = addressOf(grid, from);
  const goalAddress = addressOf(grid, goal);
  const dx = Math.abs(fromAddress.column - goalAddress.column);
  const dz = Math.abs(fromAddress.row - goalAddress.row);
  let minimumCost = Number.POSITIVE_INFINITY;
  for (const cell of grid.cells) minimumCost = Math.min(minimumCost, cell.cost);
  return Math.max(dx, dz) * minimumCost;
}

function neighbors(grid: NavigationHeightfieldGrid, index: number): number[] {
  const address = addressOf(grid, index);
  const result: number[] = [];
  for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const column = address.column + dc;
    const row = address.row + dr;
    if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) {
      continue;
    }
    if (dc !== 0 && dr !== 0) {
      const sideA = indexOf(grid, { column: address.column + dc, row: address.row });
      const sideB = indexOf(grid, { column: address.column, row: address.row + dr });
      if (!grid.cells[sideA].walkable || !grid.cells[sideB].walkable) {
        continue;
      }
    }
    result.push(indexOf(grid, { column, row }));
  }
  return result;
}

function reconstruct(cameFrom: Int32Array, current: number, grid: NavigationHeightfieldGrid): NavigationGridCellAddress[] {
  const path: NavigationGridCellAddress[] = [];
  for (let index = current; index >= 0; index = cameFrom[index]) {
    path.push(addressOf(grid, index));
  }
  return path.reverse();
}

function result(
  status: NavigationGridRouteResult['status'],
  cells: readonly NavigationGridCellAddress[],
  cost: number,
  expandedNodes: number,
  grid: NavigationHeightfieldGrid,
): NavigationGridRouteResult {
  return {
    status,
    cells,
    locations: cells.map((cell) => locationOf(grid, indexOf(grid, cell))),
    cost,
    expandedNodes,
    dependencies: cells.map((cell) => {
      const index = indexOf(grid, cell);
      return { id: `grid-cell:${index}`, version: grid.cells[index].version ?? grid.version };
    }),
  };
}

interface HeapEntry {
  readonly index: number;
  readonly priority: number;
}

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
