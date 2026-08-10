import { NavigationDependency, NavigationDomain, NavigationEdgeSnapshot, TraversalProfile } from './navigation-types';

export interface NavigationRegionGraph {
  readonly version: number;
  readonly regionIds: readonly string[];
  readonly edges: readonly NavigationEdgeSnapshot[];
}

export interface NavigationRegionRouteResult {
  readonly status: 'complete' | 'unreachable' | 'budget-exceeded';
  readonly regionIds: readonly string[];
  readonly cost: number;
  readonly expandedNodes: number;
  readonly dependencies: readonly NavigationDependency[];
}

export function createNavigationRegionGraph(options: {
  readonly version?: number;
  readonly regionIds: readonly string[];
  readonly edges: readonly NavigationEdgeSnapshot[];
}): NavigationRegionGraph {
  const version = options.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Navigation region graph version must be positive.');
  const regions = new Set(options.regionIds);
  if (regions.size !== options.regionIds.length || [...regions].some((id) => !id.trim())) {
    throw new Error('Navigation region IDs must be unique and non-empty.');
  }
  for (const edge of options.edges) {
    if (!regions.has(edge.fromRegionId) || !regions.has(edge.toRegionId)) {
      throw new Error(`Navigation edge ${edge.id} references an unknown region.`);
    }
    if (!Number.isFinite(edge.cost) || edge.cost <= 0 || !Number.isSafeInteger(edge.version) || edge.version < 1) {
      throw new Error(`Navigation edge ${edge.id} must have a positive cost and version.`);
    }
  }
  return { version, regionIds: [...options.regionIds], edges: [...options.edges] };
}

export function findNavigationRegionRoute(options: {
  readonly graph: NavigationRegionGraph;
  readonly startRegionId: string;
  readonly goalRegionId: string;
  readonly profile: TraversalProfile;
  readonly maximumExpandedNodes?: number;
}): NavigationRegionRouteResult {
  const { graph, startRegionId, goalRegionId, profile } = options;
  if (!graph.regionIds.includes(startRegionId) || !graph.regionIds.includes(goalRegionId)) {
    throw new Error('Navigation region route endpoints must exist in the graph.');
  }
  const maximumExpandedNodes = options.maximumExpandedNodes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maximumExpandedNodes) || maximumExpandedNodes <= 0) {
    throw new Error('Maximum expanded nodes must be a positive integer.');
  }
  if (startRegionId === goalRegionId) return regionResult('complete', [startRegionId], 0, 0, []);

  const distances = new Map<string, number>([[startRegionId, 0]]);
  const cameFrom = new Map<string, { regionId: string; edge: NavigationEdgeSnapshot }>();
  const closed = new Set<string>();
  const open: Array<{ regionId: string; cost: number }> = [{ regionId: startRegionId, cost: 0 }];
  let expandedNodes = 0;

  while (open.length > 0 && expandedNodes < maximumExpandedNodes) {
    open.sort((a, b) => a.cost - b.cost || a.regionId.localeCompare(b.regionId));
    const current = open.shift()!;
    if (closed.has(current.regionId)) continue;
    closed.add(current.regionId);
    expandedNodes += 1;
    if (current.regionId === goalRegionId) {
      const regions: string[] = [];
      const edges: NavigationEdgeSnapshot[] = [];
      let cursor = goalRegionId;
      while (cursor !== startRegionId) {
        regions.push(cursor);
        const step = cameFrom.get(cursor)!;
        edges.push(step.edge);
        cursor = step.regionId;
      }
      regions.push(startRegionId);
      return regionResult('complete', regions.reverse(), distances.get(goalRegionId)!, expandedNodes, edges.reverse());
    }
    const outgoing = graph.edges
      .filter((edge) => edge.fromRegionId === current.regionId && supportsDomain(profile, edge.domain))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const edge of outgoing) {
      if (closed.has(edge.toRegionId)) continue;
      const nextCost = current.cost + edge.cost;
      if (nextCost < (distances.get(edge.toRegionId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.toRegionId, nextCost);
        cameFrom.set(edge.toRegionId, { regionId: current.regionId, edge });
        open.push({ regionId: edge.toRegionId, cost: nextCost });
      }
    }
  }
  return regionResult(open.length > 0 ? 'budget-exceeded' : 'unreachable', [], 0, expandedNodes, []);
}

export class NavigationRouteCache {
  private readonly entries = new Map<string, NavigationRegionRouteResult>();

  get(graph: NavigationRegionGraph, startRegionId: string, goalRegionId: string, profile: TraversalProfile): NavigationRegionRouteResult | undefined {
    const route = this.entries.get(cacheKey(graph, startRegionId, goalRegionId, profile));
    if (!route || !route.dependencies.every((dependency) => {
      const edge = graph.edges.find((candidate) => candidate.id === dependency.id);
      return edge?.version === dependency.version;
    })) {
      return undefined;
    }
    return route;
  }

  set(graph: NavigationRegionGraph, startRegionId: string, goalRegionId: string, profile: TraversalProfile, route: NavigationRegionRouteResult): void {
    if (route.status === 'complete') this.entries.set(cacheKey(graph, startRegionId, goalRegionId, profile), route);
  }

  clear(): void { this.entries.clear(); }
}

function supportsDomain(profile: TraversalProfile, domain: NavigationDomain): boolean {
  return profile.domains.includes(domain) || profile.domains.includes('*');
}

function cacheKey(graph: NavigationRegionGraph, start: string, goal: string, profile: TraversalProfile): string {
  return `${graph.version}|${start}|${goal}|${profile.id}|${profile.domains.join(',')}`;
}

function regionResult(status: NavigationRegionRouteResult['status'], regionIds: readonly string[], cost: number, expandedNodes: number, edges: readonly NavigationEdgeSnapshot[]): NavigationRegionRouteResult {
  return {
    status,
    regionIds,
    cost,
    expandedNodes,
    dependencies: edges.map((edge) => ({ id: edge.id, version: edge.version })),
  };
}
