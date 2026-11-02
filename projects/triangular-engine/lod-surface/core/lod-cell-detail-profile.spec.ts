import { buildCellPlanetWorld } from 'triangular-engine/worldgen';
import { cellDetailProfile } from './lod-cell-detail-profile';

describe('cell detail profile', () => {
  const world = buildCellPlanetWorld({ cellCount: 120, seed: 4 });

  it('returns the weight of the cell that contains the point', () => {
    const profile = cellDetailProfile(world, { id: 'by-id', weightOfCell: (id) => (id % 2 === 0 ? 0 : 3) });
    expect(profile.maxWeight).toBe(3);
    for (const cell of world.graph.cells.slice(0, 40)) {
      const s = 5000;
      expect(profile.weightAt(cell.center.x * s, cell.center.y * s, cell.center.z * s)).toBe(cell.id % 2 === 0 ? 0 : 3);
    }
  });

  it('clamps negative weights to zero and ignores the point radius', () => {
    const profile = cellDetailProfile(world, { id: 'neg', weightOfCell: () => -1 });
    expect(profile.maxWeight).toBe(0);
    expect(profile.weightAt(1, 2, 3)).toBe(0);
  });
});
