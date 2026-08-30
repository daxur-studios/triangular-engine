import {
  CityJunctionType,
  CityTransitLayer,
  CityTransitType,
  computeCrossSectionTotalWidth,
  ICityCrossSection,
  ICityTransitEdge,
  ICityTransitGraph,
  ICityTransitNode,
} from './city-transit-types';

export { computeCrossSectionTotalWidth };

/**
 * Validates a City Transit Graph for referential integrity, duplicate IDs, and geometry sanity.
 */
export function validateTransitGraph(graph: ICityTransitGraph): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  const nodeMap = new Map<string, ICityTransitNode>();

  for (const node of graph.nodes) {
    if (nodeMap.has(node.id)) {
      errors.push(`Duplicate node id: "${node.id}"`);
    }
    nodeMap.set(node.id, node);
    if (
      !Number.isFinite(node.position[0]) ||
      !Number.isFinite(node.position[1]) ||
      !Number.isFinite(node.position[2])
    ) {
      errors.push(`Node "${node.id}" has invalid NaN/infinite position`);
    }
  }

  const edgeSet = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeSet.has(edge.id)) {
      errors.push(`Duplicate edge id: "${edge.id}"`);
    }
    edgeSet.add(edge.id);

    if (!nodeMap.has(edge.fromNodeId)) {
      errors.push(
        `Edge "${edge.id}" references missing fromNodeId "${edge.fromNodeId}"`,
      );
    }
    if (!nodeMap.has(edge.toNodeId)) {
      errors.push(
        `Edge "${edge.id}" references missing toNodeId "${edge.toNodeId}"`,
      );
    }
    if (edge.fromNodeId === edge.toNodeId) {
      errors.push(`Edge "${edge.id}" forms a self-loop on node "${edge.fromNodeId}"`);
    }
    if (edge.speedLimitKmh <= 0) {
      errors.push(`Edge "${edge.id}" has non-positive speed limit: ${edge.speedLimitKmh}`);
    }
    if (edge.crossSection.roadwayWidthM < 0 || edge.crossSection.sidewalkWidthM < 0) {
      errors.push(`Edge "${edge.id}" has invalid negative cross section dimension`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Evaluates points along an edge using linear interpolation or Catmull-Rom spline control points.
 */
export function evaluateEdgePoints(
  edge: ICityTransitEdge,
  graph: ICityTransitGraph,
  samples = 10,
): readonly (readonly [number, number, number])[] {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const fromNode = nodeMap.get(edge.fromNodeId);
  const toNode = nodeMap.get(edge.toNodeId);

  if (!fromNode || !toNode) {
    return [];
  }

  const controlPoints: readonly (readonly [number, number, number])[] = [
    fromNode.position,
    ...(edge.controlPoints ?? []),
    toNode.position,
  ];

  if (controlPoints.length === 2) {
    // Pure linear segment
    const [p0, p1] = controlPoints;
    const points: (readonly [number, number, number])[] = [];
    const count = Math.max(2, samples);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      points.push([
        p0[0] + (p1[0] - p0[0]) * t,
        p0[1] + (p1[1] - p0[1]) * t,
        p0[2] + (p1[2] - p0[2]) * t,
      ]);
    }
    return points;
  }

  // Multi-point piecewise linear / parametric evaluation
  const points: (readonly [number, number, number])[] = [];
  const segments = controlPoints.length - 1;
  const samplesPerSeg = Math.max(1, Math.floor(samples / segments));

  for (let s = 0; s < segments; s++) {
    const p0 = controlPoints[s];
    const p1 = controlPoints[s + 1];
    const isLastSeg = s === segments - 1;
    const count = isLastSeg ? samplesPerSeg + 1 : samplesPerSeg;

    for (let i = 0; i < count; i++) {
      const t = i / samplesPerSeg;
      points.push([
        p0[0] + (p1[0] - p0[0]) * t,
        p0[1] + (p1[1] - p0[1]) * t,
        p0[2] + (p1[2] - p0[2]) * t,
      ]);
    }
  }

  return points;
}

/**
 * Computes 3D arc-length of a transit edge.
 */
export function computeEdgeLengthM(
  edge: ICityTransitEdge,
  graph: ICityTransitGraph,
): number {
  const points = evaluateEdgePoints(edge, graph, 20);
  if (points.length < 2) return 0;

  let totalDist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    totalDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return totalDist;
}

/**
 * Computes the vertical grade slope percentage of an edge: (rise / horizontal_run) * 100.
 */
export function computeEdgeGradePercent(
  edge: ICityTransitEdge,
  graph: ICityTransitGraph,
): number {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const fromNode = nodeMap.get(edge.fromNodeId);
  const toNode = nodeMap.get(edge.toNodeId);

  if (!fromNode || !toNode) return 0;

  const dx = toNode.position[0] - fromNode.position[0];
  const dy = toNode.position[1] - fromNode.position[1];
  const dz = toNode.position[2] - fromNode.position[2];

  const horizontalDist = Math.sqrt(dx * dx + dz * dz);
  if (horizontalDist < 1e-4) {
    return dy !== 0 ? Infinity : 0;
  }

  return (Math.abs(dy) / horizontalDist) * 100;
}

/**
 * Fluent builder for constructing city transit graphs.
 */
export class CityTransitGraphBuilder {
  private readonly nodes = new Map<string, ICityTransitNode>();
  private readonly edges = new Map<string, ICityTransitEdge>();

  public addNode(node: ICityTransitNode): this {
    this.nodes.set(node.id, node);
    return this;
  }

  public addEdge(edge: ICityTransitEdge): this {
    this.edges.set(edge.id, edge);
    return this;
  }

  public getNode(id: string): ICityTransitNode | undefined {
    return this.nodes.get(id);
  }

  public getEdge(id: string): ICityTransitEdge | undefined {
    return this.edges.get(id);
  }

  public getConnectedEdges(nodeId: string): readonly ICityTransitEdge[] {
    const result: ICityTransitEdge[] = [];
    for (const edge of this.edges.values()) {
      if (edge.fromNodeId === nodeId || edge.toNodeId === nodeId) {
        result.push(edge);
      }
    }
    return result;
  }

  public getNeighbors(nodeId: string): readonly ICityTransitNode[] {
    const neighborIds = new Set<string>();
    for (const edge of this.edges.values()) {
      if (edge.fromNodeId === nodeId) {
        neighborIds.add(edge.toNodeId);
      } else if (edge.toNodeId === nodeId && !edge.isOneWay) {
        neighborIds.add(edge.fromNodeId);
      }
    }
    const result: ICityTransitNode[] = [];
    for (const id of neighborIds) {
      const node = this.nodes.get(id);
      if (node) result.push(node);
    }
    return result;
  }

  /**
   * Infers and updates junction types for all nodes based on degree of connected edges.
   */
  public autoDetectJunctionTypes(): this {
    for (const [id, node] of this.nodes.entries()) {
      const edges = this.getConnectedEdges(id);
      let junctionType: CityJunctionType = node.junctionType;

      if (edges.length === 0) {
        junctionType = 'dead-end';
      } else if (edges.length === 1) {
        junctionType = 'dead-end';
      } else if (edges.length >= 3) {
        junctionType = 'intersection';
      } else if (edges.length === 2) {
        // Continuous waypoint or abutment/portal check
        const layers = new Set(edges.map((e) => e.layer));
        if (layers.has(1) && layers.has(0)) {
          junctionType = 'bridge-abutment';
        } else if (layers.has(-1) && layers.has(0)) {
          junctionType = 'tunnel-portal';
        } else {
          junctionType = 'endpoint';
        }
      }

      this.nodes.set(id, {
        ...node,
        junctionType,
      });
    }
    return this;
  }

  public build(): ICityTransitGraph {
    const graph: ICityTransitGraph = {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
    };

    const validation = validateTransitGraph(graph);
    if (!validation.valid) {
      throw new Error(
        `Failed to build CityTransitGraph:\n${validation.errors.join('\n')}`,
      );
    }

    return graph;
  }
}
