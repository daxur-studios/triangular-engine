import {
  findNavigationGridRoute,
  NavigationGridCellAddress,
  NavigationGridRouteResult,
  NavigationHeightfieldGrid,
} from './navigation-grid';
import { TraversalProfile } from './navigation-types';

export interface NavigationBenchmarkAgentRequest {
  readonly id: string;
  readonly start: NavigationGridCellAddress;
  readonly goal: NavigationGridCellAddress;
}

export interface NavigationGridBenchmarkScenario {
  readonly agentCount: number;
  readonly requests: readonly NavigationBenchmarkAgentRequest[];
}

export interface NavigationGridBenchmarkResult {
  readonly agentCount: number;
  readonly completed: number;
  readonly partial: number;
  readonly unreachable: number;
  readonly budgetExceeded: number;
  readonly totalExpandedNodes: number;
  readonly totalCost: number;
  readonly elapsedMilliseconds: number;
  readonly routes: readonly NavigationGridRouteResult[];
}

export function createNavigationGridBenchmarkScenario(options: {
  readonly grid: NavigationHeightfieldGrid;
  readonly agentCount: number;
  readonly seed?: number;
  readonly sharedGoal?: NavigationGridCellAddress;
}): NavigationGridBenchmarkScenario {
  if (!Number.isSafeInteger(options.agentCount) || options.agentCount <= 0) {
    throw new Error('Navigation benchmark agent count must be a positive integer.');
  }
  const random = seededRandom(options.seed ?? 1);
  const goal = options.sharedGoal ?? {
    column: options.grid.columns - 1,
    row: options.grid.rows - 1,
  };
  assertAddress(options.grid, goal, 'Benchmark goal');
  const requests: NavigationBenchmarkAgentRequest[] = [];
  for (let index = 0; index < options.agentCount; index += 1) {
    requests.push({
      id: `agent:${index}`,
      start: {
        column: Math.floor(random() * options.grid.columns),
        row: Math.floor(random() * options.grid.rows),
      },
      goal,
    });
  }
  return { agentCount: options.agentCount, requests };
}

export function runNavigationGridBenchmark(options: {
  readonly grid: NavigationHeightfieldGrid;
  readonly scenario: NavigationGridBenchmarkScenario;
  readonly profile: TraversalProfile;
  readonly maximumExpandedNodes?: number;
}): NavigationGridBenchmarkResult {
  if (options.scenario.agentCount !== options.scenario.requests.length) {
    throw new Error('Navigation benchmark scenario agent count does not match its requests.');
  }
  const routes: NavigationGridRouteResult[] = [];
  const startTime = performance.now();
  for (const request of options.scenario.requests) {
    routes.push(findNavigationGridRoute({
      grid: options.grid,
      start: request.start,
      goal: request.goal,
      profile: options.profile,
      maximumExpandedNodes: options.maximumExpandedNodes,
    }));
  }
  const elapsedMilliseconds = performance.now() - startTime;
  return {
    agentCount: options.scenario.agentCount,
    completed: routes.filter((route) => route.status === 'complete').length,
    partial: routes.filter((route) => route.status === 'partial').length,
    unreachable: routes.filter((route) => route.status === 'unreachable').length,
    budgetExceeded: routes.filter((route) => route.status === 'budget-exceeded').length,
    totalExpandedNodes: routes.reduce((sum, route) => sum + route.expandedNodes, 0),
    totalCost: routes.reduce((sum, route) => sum + route.cost, 0),
    elapsedMilliseconds,
    routes,
  };
}

function seededRandom(seed: number): () => number {
  if (!Number.isSafeInteger(seed)) {
    throw new Error('Navigation benchmark seed must be an integer.');
  }
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function assertAddress(grid: NavigationHeightfieldGrid, address: NavigationGridCellAddress, label: string): void {
  if (!Number.isSafeInteger(address.column) || !Number.isSafeInteger(address.row)
    || address.column < 0 || address.column >= grid.columns
    || address.row < 0 || address.row >= grid.rows) {
    throw new Error(`${label} grid cell is outside the grid.`);
  }
}
