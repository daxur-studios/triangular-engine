import { CityTransitGraphBuilder } from '../core/city-transit-graph';
import { CITY_CROSS_SECTION_PRESETS } from '../core/city-transit-types';
import {
  adaptTransitGraphToTerrain,
  classifyEdgeTerrainSpans,
} from './road-terrain-adapter';

describe('RoadTerrainAdapter', () => {
  it('classifies valley crossing as a bridge span with support piers', () => {
    const builder = new CityTransitGraphBuilder();
    // Flat road at y=20 from x=-50 to x=50
    builder
      .addNode({ id: 'west', position: [-50, 20, 0], layer: 0, junctionType: 'endpoint' })
      .addNode({ id: 'east', position: [50, 20, 0], layer: 0, junctionType: 'endpoint' })
      .addEdge({
        id: 'e_bridge',
        fromNodeId: 'west',
        toNodeId: 'east',
        layer: 0,
        allowedTransitTypes: ['car'],
        speedLimitKmh: 80,
        crossSection: CITY_CROSS_SECTION_PRESETS.highway,
      });

    const graph = builder.build();

    // Deep valley at center: ground is at y=0 near center, but y=20 at ends
    const sampleValleyElevation = (x: number, z: number) => {
      const distFromCenter = Math.abs(x);
      if (distFromCenter < 30) {
        return 0; // 20m drop -> bridge
      }
      return 20; // level ground
    };

    const edge = graph.edges[0];
    const spans = classifyEdgeTerrainSpans(edge, graph, sampleValleyElevation, {
      bridgeElevationThresholdM: 3.5,
      bridgePierSpacingM: 15,
      samples: 30,
    });

    expect(spans.length).toBeGreaterThan(1);
    const bridgeSpans = spans.filter((s) => s.type === 'bridge');
    expect(bridgeSpans.length).toBeGreaterThanOrEqual(1);

    const bridge = bridgeSpans[0];
    expect(bridge.pierPositions).toBeDefined();
    expect(bridge.pierPositions!.length).toBeGreaterThan(0);
    expect(bridge.pierPositions![0].heightM).toBeGreaterThan(3.5);
  });

  it('classifies hill piercing as a tunnel span', () => {
    const builder = new CityTransitGraphBuilder();
    // Flat road at y=0 from x=-50 to x=50
    builder
      .addNode({ id: 'west', position: [-50, 0, 0], layer: 0, junctionType: 'endpoint' })
      .addNode({ id: 'east', position: [50, 0, 0], layer: 0, junctionType: 'endpoint' })
      .addEdge({
        id: 'e_tunnel',
        fromNodeId: 'west',
        toNodeId: 'east',
        layer: 0,
        allowedTransitTypes: ['car'],
        speedLimitKmh: 60,
        crossSection: CITY_CROSS_SECTION_PRESETS.avenue,
      });

    const graph = builder.build();

    // Tall mountain at center: ground reaches y=30
    const sampleMountainElevation = (x: number, z: number) => {
      const distFromCenter = Math.abs(x);
      if (distFromCenter < 25) {
        return 25; // 25m overburden -> tunnel
      }
      return 0; // level ground
    };

    const edge = graph.edges[0];
    const spans = classifyEdgeTerrainSpans(edge, graph, sampleMountainElevation, {
      tunnelDepthThresholdM: 6.0,
      samples: 30,
    });

    const tunnelSpans = spans.filter((s) => s.type === 'tunnel');
    expect(tunnelSpans.length).toBeGreaterThanOrEqual(1);
  });

  it('adapts full graph and emits modification intents for surface spans', () => {
    const builder = new CityTransitGraphBuilder();
    builder
      .addNode({ id: 'n1', position: [0, 5, 0], layer: 0, junctionType: 'endpoint' })
      .addNode({ id: 'n2', position: [50, 5, 0], layer: 0, junctionType: 'endpoint' })
      .addEdge({
        id: 'e_surface',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        layer: 0,
        allowedTransitTypes: ['car'],
        speedLimitKmh: 50,
        crossSection: CITY_CROSS_SECTION_PRESETS.localStreet,
      });

    const graph = builder.build();
    const flatElevation = () => 5;

    const result = adaptTransitGraphToTerrain(graph, flatElevation);
    expect(result.spans.length).toBe(1);
    expect(result.spans[0].type).toBe('surface');
    expect(result.modificationIntents.length).toBe(1);
    expect(result.modificationIntents[0].kind).toBe('cut-and-fill');
  });
});
