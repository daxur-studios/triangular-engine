import {
  classifyLifeCellResidency,
  enumerateLifeCellsInRadius,
  lifeCellCoordinate,
} from './life-residency';

describe('life residency', () => {
  const policy = {
    cellSize: 100,
    cameraActiveDistance: 150,
    cameraAggregateDistance: 500,
    interactionDistance: 80,
    trackedDistance: 20,
  };

  it('keeps camera visibility separate from tracked persistence', () => {
    const cell = { x: 1000, y: 0, z: 0 };
    expect(classifyLifeCellResidency(cell, [{ kind: 'camera', position: { x: 0, y: 0, z: 0 } }], policy)).toBe('dormant');
    expect(classifyLifeCellResidency(cell, [
      { kind: 'camera', position: { x: 0, y: 0, z: 0 } },
      { kind: 'tracked', position: cell },
    ], policy)).toBe('resident');
  });

  it('uses stable grid coordinates and ordering for streaming', () => {
    expect(lifeCellCoordinate({ x: -0.1, y: 0, z: 199.9 }, 100)).toEqual({ x: -1, z: 1 });
    const cells = enumerateLifeCellsInRadius({ x: 0, y: 0, z: 0 }, 100, 100);
    expect(cells).toEqual([...cells].sort((a, b) => a.z - b.z || a.x - b.x));
    expect(cells.length).toBeGreaterThan(1);
  });
});
