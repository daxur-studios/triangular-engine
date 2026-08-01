import { Vector3 } from 'three';
import { atlasCellForDirection, atlasDirection, atlasNeighborsForOctahedralDirection, octahedralDecode, octahedralEncode } from './impostor-atlas.models';

describe('impostor atlas direction mapping', () => {
  it('round-trips representative directions', () => {
    for (const direction of [
      new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1),
      new Vector3(0, 0, -1), new Vector3(1, 0.4, -0.7),
    ]) {
      const encoded = octahedralEncode(direction);
      expect(octahedralDecode(encoded.x, encoded.y).dot(direction.clone().normalize())).toBeGreaterThan(0.999);
    }
  });

  it('keeps the top-to-bottom pole path monotonic in atlas rows', () => {
    const rows = Array.from({ length: 41 }, (_, index) => {
      const y = 1 - (index / 40) * 2;
      return atlasCellForDirection(new Vector3(0, y, 1), 8, 8).row;
    });
    for (let index = 1; index < rows.length; index++) {
      expect(rows[index]).toBeLessThanOrEqual(rows[index - 1]);
    }
  });

  it('keeps a fixed azimuth in one column from pole to pole', () => {
    const azimuth = 0.37;
    const columns = Array.from({ length: 79 }, (_, index) => {
      const elevation = Math.PI / 2 - 0.01 - (index / 78) * (Math.PI - 0.02);
      return atlasCellForDirection(new Vector3(
        Math.sin(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
        Math.cos(azimuth) * Math.cos(elevation),
      ), 12, 12).column;
    });
    expect(new Set(columns).size).toBe(1);
  });

  it('maps every atlas cell back inside its own cell', () => {
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const direction = atlasDirection(column, row, 8, 8);
        expect(atlasCellForDirection(direction, 8, 8)).toEqual({ column, row });
      }
    }
  });

  it('produces three bounded neighbors whose weights sum to one', () => {
    const neighbors = atlasNeighborsForOctahedralDirection(new Vector3(0.42, 0.31, 0.85), 8, 8);
    expect(neighbors).toHaveSize(3);
    expect(neighbors.every((neighbor) => neighbor.column >= 0 && neighbor.column < 8 && neighbor.row >= 0 && neighbor.row < 8)).toBeTrue();
    expect(neighbors.reduce((sum, neighbor) => sum + neighbor.weight, 0)).toBeCloseTo(1);
  });
});
