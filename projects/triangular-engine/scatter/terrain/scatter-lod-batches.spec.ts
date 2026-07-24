import { bucketScatterInstancesByLod } from './scatter-lod-batches';
import type { ITerrainScatterInstance } from './scatter-terrain-instances';
import type { ScatterLodDefinition } from '../core/scatter-species-definition';

function instance(id: string, x: number): ITerrainScatterInstance {
  return {
    instanceId: id,
    worldPositionM: [x, 0, 0],
    normal: [0, 1, 0],
    surfaceUp: [0, 1, 0],
    rotationSeed01: 0,
    scaleSeed01: 0.5,
    embedSeed01: 0,
  };
}

const lods: ScatterLodDefinition[] = [
  { kind: 'mesh', maxDistanceM: 50, castShadow: true },
  { kind: 'billboard', maxDistanceM: 200, castShadow: false },
];

describe('bucketScatterInstancesByLod', () => {
  it('groups instances into one bucket per tier they fall in', () => {
    const instances = [instance('near', 10), instance('mid', 120), instance('far', 400)];
    const result = bucketScatterInstancesByLod({
      instances,
      lods,
      viewpointWorldM: [0, 0, 0],
    });

    expect(result.buckets.length).toBe(2);
    expect(result.buckets[0].tierIndex).toBe(0);
    expect(result.buckets[0].instances.map((i) => i.instanceId)).toEqual(['near']);
    expect(result.buckets[1].tierIndex).toBe(1);
    expect(result.buckets[1].instances.map((i) => i.instanceId)).toEqual(['mid']);
  });

  it('drops instances beyond every tier and omits them from tierByInstanceId', () => {
    const instances = [instance('near', 10), instance('far', 400)];
    const result = bucketScatterInstancesByLod({
      instances,
      lods,
      viewpointWorldM: [0, 0, 0],
    });

    expect(result.tierByInstanceId.has('far')).toBe(false);
    expect(result.tierByInstanceId.get('near')).toBe(0);
  });

  it('applies per-instance hysteresis from previousTierByInstanceId', () => {
    const instances = [instance('a', 52)];
    const previousTierByInstanceId = new Map([['a', 0]]);

    const resisted = bucketScatterInstancesByLod({
      instances,
      lods,
      viewpointWorldM: [0, 0, 0],
      previousTierByInstanceId,
      hysteresisM: 10,
    });
    expect(resisted.tierByInstanceId.get('a')).toBe(0);

    const noHysteresis = bucketScatterInstancesByLod({
      instances,
      lods,
      viewpointWorldM: [0, 0, 0],
    });
    expect(noHysteresis.tierByInstanceId.get('a')).toBe(1);
  });

  it('sorts buckets by tierIndex ascending regardless of instance order', () => {
    const instances = [instance('mid', 120), instance('near', 10)];
    const result = bucketScatterInstancesByLod({
      instances,
      lods,
      viewpointWorldM: [0, 0, 0],
    });
    expect(result.buckets.map((b) => b.tierIndex)).toEqual([0, 1]);
  });
});
