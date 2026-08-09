import { selectLifePredatorTarget } from './life-predator';

describe('selectLifePredatorTarget', () => {
  it('selects the nearest viable prey deterministically', () => {
    const targets = [
      { id: 'deer-b', position: { x: 8, y: 0, z: 0 }, vulnerability01: 1 },
      { id: 'deer-a', position: { x: 4, y: 0, z: 0 }, vulnerability01: 1 },
      { id: 'protected', position: { x: 1, y: 0, z: 0 }, vulnerability01: 0.1 },
    ];
    expect(selectLifePredatorTarget({ x: 0, y: 0, z: 0 }, targets, {
      minimumVulnerability01: 0.5,
    })).toEqual({ targetId: 'deer-a', distance: 4, hunting: true });
  });

  it('returns a non-hunting state when no target is in range', () => {
    expect(selectLifePredatorTarget({ x: 0, y: 0, z: 0 }, [{
      id: 'far', position: { x: 20, y: 0, z: 0 }, vulnerability01: 1,
    }], { maxRange: 5 })).toEqual({
      targetId: null,
      distance: Number.POSITIVE_INFINITY,
      hunting: false,
    });
  });
});
