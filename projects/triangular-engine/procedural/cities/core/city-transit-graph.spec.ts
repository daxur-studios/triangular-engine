import {
  computeEdgeGradePercent,
  computeEdgeLengthM,
  evaluateEdgePoints,
  validateTransitGraph,
  CityTransitGraphBuilder,
} from './city-transit-graph';
import {
  CITY_CROSS_SECTION_PRESETS,
  computeCrossSectionTotalWidth,
  ICityTransitEdge,
  ICityTransitGraph,
  ICityTransitNode,
} from './city-transit-types';

describe('CityTransitGraph', () => {
  it('computes total cross-section width correctly', () => {
    const avenue = CITY_CROSS_SECTION_PRESETS.avenue;
    // roadway (10) + 2*sidewalk (2*2.5) + 2*verge (2*1.5) + median (1.5) = 10 + 5 + 3 + 1.5 = 19.5
    expect(computeCrossSectionTotalWidth(avenue)).toBeCloseTo(19.5, 3);

    const rail = CITY_CROSS_SECTION_PRESETS.railway;
    // roadway (4.5) + 2*0 + 2*0.8 + 0 = 6.1
    expect(computeCrossSectionTotalWidth(rail)).toBeCloseTo(6.1, 3);
  });

  it('validates graph referential integrity', () => {
    const invalidGraph: ICityTransitGraph = {
      nodes: [
        { id: 'n1', position: [0, 0, 0], layer: 0, junctionType: 'endpoint' },
      ],
      edges: [
        {
          id: 'e1',
          fromNodeId: 'n1',
          toNodeId: 'n2', // missing node
          layer: 0,
          allowedTransitTypes: ['car'],
          speedLimitKmh: 50,
          crossSection: CITY_CROSS_SECTION_PRESETS.localStreet,
        },
      ],
    };

    const result = validateTransitGraph(invalidGraph);
    expect(result.valid).toBeFalse();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('references missing toNodeId');
  });

  it('detects duplicate nodes and self-loops', () => {
    const invalidGraph: ICityTransitGraph = {
      nodes: [
        { id: 'n1', position: [0, 0, 0], layer: 0, junctionType: 'endpoint' },
        { id: 'n1', position: [10, 0, 0], layer: 0, junctionType: 'endpoint' },
      ],
      edges: [
        {
          id: 'e1',
          fromNodeId: 'n1',
          toNodeId: 'n1',
          layer: 0,
          allowedTransitTypes: ['car'],
          speedLimitKmh: 50,
          crossSection: CITY_CROSS_SECTION_PRESETS.localStreet,
        },
      ],
    };

    const result = validateTransitGraph(invalidGraph);
    expect(result.valid).toBeFalse();
    expect(result.errors.some((e) => e.includes('Duplicate node'))).toBeTrue();
    expect(result.errors.some((e) => e.includes('self-loop'))).toBeTrue();
  });

  it('builds a valid graph with CityTransitGraphBuilder and detects junctions', () => {
    const builder = new CityTransitGraphBuilder();

    builder
      .addNode({ id: 'center', position: [0, 0, 0], layer: 0, junctionType: 'endpoint' })
      .addNode({ id: 'north', position: [0, 0, 50], layer: 0, junctionType: 'endpoint' })
      .addNode({ id: 'east', position: [50, 0, 0], layer: 0, junctionType: 'endpoint' })
      .addNode({ id: 'south', position: [0, 0, -50], layer: 0, junctionType: 'endpoint' })
      .addEdge({
        id: 'e_north',
        fromNodeId: 'center',
        toNodeId: 'north',
        layer: 0,
        allowedTransitTypes: ['car', 'pedestrian'],
        speedLimitKmh: 50,
        crossSection: CITY_CROSS_SECTION_PRESETS.avenue,
      })
      .addEdge({
        id: 'e_east',
        fromNodeId: 'center',
        toNodeId: 'east',
        layer: 0,
        allowedTransitTypes: ['car', 'pedestrian'],
        speedLimitKmh: 50,
        crossSection: CITY_CROSS_SECTION_PRESETS.avenue,
      })
      .addEdge({
        id: 'e_south',
        fromNodeId: 'center',
        toNodeId: 'south',
        layer: 0,
        allowedTransitTypes: ['car', 'pedestrian'],
        speedLimitKmh: 50,
        crossSection: CITY_CROSS_SECTION_PRESETS.avenue,
      });

    builder.autoDetectJunctionTypes();
    const graph = builder.build();

    expect(graph.nodes.length).toBe(4);
    expect(graph.edges.length).toBe(3);

    const center = graph.nodes.find((n) => n.id === 'center');
    expect(center?.junctionType).toBe('intersection');

    const north = graph.nodes.find((n) => n.id === 'north');
    expect(north?.junctionType).toBe('dead-end');
  });

  it('evaluates spline points, arc length, and grade slope percent', () => {
    const builder = new CityTransitGraphBuilder();
    builder
      .addNode({ id: 'n1', position: [0, 0, 0], layer: 0, junctionType: 'endpoint' })
      .addNode({ id: 'n2', position: [100, 10, 0], layer: 0, junctionType: 'endpoint' })
      .addEdge({
        id: 'e1',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        layer: 0,
        allowedTransitTypes: ['car'],
        speedLimitKmh: 60,
        crossSection: CITY_CROSS_SECTION_PRESETS.localStreet,
      });

    const graph = builder.build();
    const edge = graph.edges[0];

    const points = evaluateEdgePoints(edge, graph, 5);
    expect(points.length).toBe(5);
    expect(points[0]).toEqual([0, 0, 0]);
    expect(points[4]).toEqual([100, 10, 0]);

    const length = computeEdgeLengthM(edge, graph);
    // sqrt(100^2 + 10^2) = sqrt(10100) ≈ 100.4987
    expect(length).toBeCloseTo(100.4987, 2);

    const grade = computeEdgeGradePercent(edge, graph);
    // (10 / 100) * 100 = 10%
    expect(grade).toBeCloseTo(10.0, 3);
  });
});
