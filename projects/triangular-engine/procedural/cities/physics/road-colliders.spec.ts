import { CITY_CROSS_SECTION_PRESETS } from '../core/city-transit-types';
import { IClassifiedRoadSpan } from '../terrain/road-terrain-adapter';
import { deriveRoadSpanColliders } from './road-colliders';

describe('RoadColliders', () => {
  it('synthesizes box collider descriptors for road segments', () => {
    const span: IClassifiedRoadSpan = {
      spanId: 'span_col_test',
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

    const colliders = deriveRoadSpanColliders(
      span,
      CITY_CROSS_SECTION_PRESETS.localStreet,
    );

    // 3 points -> 2 segment box colliders
    expect(colliders.length).toBe(2);
    expect(colliders[0].shape).toBe('box');
    expect(colliders[0].params[0]).toBeGreaterThan(6.0); // total width > roadway width 6.0
    expect(colliders[0].params[2]).toBeCloseTo(20, 1); // 20m segment length
  });

  it('synthesizes cylinder colliders for bridge piers', () => {
    const span: IClassifiedRoadSpan = {
      spanId: 'bridge_col_test',
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

    const colliders = deriveRoadSpanColliders(
      span,
      CITY_CROSS_SECTION_PRESETS.highway,
    );

    // 2 deck boxes + 1 pier cylinder = 3 colliders
    expect(colliders.length).toBe(3);
    const pierCol = colliders.find((c) => c.shape === 'cylinder');
    expect(pierCol).toBeDefined();
    expect(pierCol!.params[0]).toBeCloseTo(7.5, 1); // half-height of 15m is 7.5m
  });
});
