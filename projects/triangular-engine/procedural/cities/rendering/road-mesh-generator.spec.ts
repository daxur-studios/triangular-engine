import { CITY_CROSS_SECTION_PRESETS } from '../core/city-transit-types';
import { IClassifiedRoadSpan } from '../terrain/road-terrain-adapter';
import { buildRoadSpanMesh } from './road-mesh-generator';

describe('RoadMeshGenerator', () => {
  it('generates valid BufferGeometry for surface road span', () => {
    const span: IClassifiedRoadSpan = {
      spanId: 'span_test_1',
      edgeId: 'edge_1',
      type: 'surface',
      startT: 0,
      endT: 1,
      roadPoints: [
        [0, 0, 0],
        [0, 0, 20],
        [0, 0, 40],
      ],
      groundPoints: [
        [0, 0, 0],
        [0, 0, 20],
        [0, 0, 40],
      ],
    };

    const crossSection = CITY_CROSS_SECTION_PRESETS.avenue;
    const result = buildRoadSpanMesh(span, crossSection);

    expect(result.roadGeometry).toBeDefined();
    const posAttr = result.roadGeometry.getAttribute('position');
    expect(posAttr).toBeDefined();
    expect(posAttr.count).toBeGreaterThan(0);

    const normalAttr = result.roadGeometry.getAttribute('normal');
    expect(normalAttr).toBeDefined();

    const uvAttr = result.roadGeometry.getAttribute('uv');
    expect(uvAttr).toBeDefined();

    const indexAttr = result.roadGeometry.getIndex();
    expect(indexAttr).toBeDefined();
    expect(indexAttr!.count).toBeGreaterThan(0);
  });

  it('generates bridge deck and piers for bridge span', () => {
    const span: IClassifiedRoadSpan = {
      spanId: 'bridge_span_1',
      edgeId: 'edge_bridge',
      type: 'bridge',
      startT: 0,
      endT: 1,
      roadPoints: [
        [-20, 15, 0],
        [0, 15, 0],
        [20, 15, 0],
      ],
      groundPoints: [
        [-20, 0, 0],
        [0, 0, 0],
        [20, 0, 0],
      ],
      pierPositions: [
        {
          deckPosition: [0, 15, 0],
          groundPosition: [0, 0, 0],
          heightM: 15,
        },
      ],
    };

    const crossSection = CITY_CROSS_SECTION_PRESETS.highway;
    const result = buildRoadSpanMesh(span, crossSection);

    expect(result.roadGeometry).toBeDefined();
    expect(result.bridgePiersGeometry).toBeDefined();
    const pierPositions = result.bridgePiersGeometry!.getAttribute('position');
    expect(pierPositions.count).toBeGreaterThan(0);
  });
});
