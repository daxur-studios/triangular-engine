import { ConstantTerrainField } from 'triangular-engine/terrain';
import { RiverCarvedTerrainField, RiverPath } from './river-system';

describe('river system', () => {
  const river = new RiverPath([
    { x: 0, z: 0, surfaceY: 10, halfWidth: 4, flowMps: 2 },
    { x: 0, z: 100, surfaceY: 0, halfWidth: 8, flowMps: 4 },
  ]);

  it('interpolates elevation, width and downstream flow', () => {
    const sample = river.sample(2, 50);
    expect(sample.surfaceY).toBeCloseTo(5);
    expect(sample.halfWidth).toBeCloseTo(6);
    expect(river.getFlow(2, 50, 0).toArray()).toEqual([0, 0, 3]);
  });

  it('carves the bed without changing distant terrain', () => {
    const field = new RiverCarvedTerrainField(
      new ConstantTerrainField(20),
      river,
      3,
    );
    expect(field.sample([0, 0, 50]).elevationM).toBeCloseTo(2);
    expect(field.sample([100, 0, 50]).elevationM).toBe(20);
  });
});
