import { Vector2, Vector3 } from 'three';
import {
  fullOctahedronGridToDirection,
  hemiOctahedronGridToDirection,
} from './octahedron-directions';

describe('octahedron-directions', () => {
  const target = new Vector3();

  describe('hemiOctahedronGridToDirection', () => {
    it('maps center (0.5, 0.5) to top pole (0, 1, 0)', () => {
      hemiOctahedronGridToDirection(new Vector2(0.5, 0.5), target);
      expect(target.x).toBeCloseTo(0, 5);
      expect(target.y).toBeCloseTo(1, 5);
      expect(target.z).toBeCloseTo(0, 5);
    });

    it('maps corners to equator directions', () => {
      hemiOctahedronGridToDirection(new Vector2(0, 0), target);
      expect(target.y).toBeCloseTo(0, 5);
      expect(target.z).toBeCloseTo(-1, 5);

      hemiOctahedronGridToDirection(new Vector2(1, 1), target);
      expect(target.y).toBeCloseTo(0, 5);
      expect(target.z).toBeCloseTo(1, 5);

      hemiOctahedronGridToDirection(new Vector2(1, 0), target);
      expect(target.y).toBeCloseTo(0, 5);
      expect(target.x).toBeCloseTo(1, 5);

      hemiOctahedronGridToDirection(new Vector2(0, 1), target);
      expect(target.y).toBeCloseTo(0, 5);
      expect(target.x).toBeCloseTo(-1, 5);
    });
  });

  describe('fullOctahedronGridToDirection', () => {
    it('maps center (0.5, 0.5) to top pole (0, 1, 0)', () => {
      fullOctahedronGridToDirection(new Vector2(0.5, 0.5), target);
      expect(target.x).toBeCloseTo(0, 5);
      expect(target.y).toBeCloseTo(1, 5);
      expect(target.z).toBeCloseTo(0, 5);
    });

    it('maps all 4 outer corners to bottom pole (0, -1, 0)', () => {
      fullOctahedronGridToDirection(new Vector2(0, 0), target);
      expect(target.x).toBeCloseTo(0, 5);
      expect(target.y).toBeCloseTo(-1, 5);
      expect(target.z).toBeCloseTo(0, 5);

      fullOctahedronGridToDirection(new Vector2(1, 1), target);
      expect(target.x).toBeCloseTo(0, 5);
      expect(target.y).toBeCloseTo(-1, 5);
      expect(target.z).toBeCloseTo(0, 5);

      fullOctahedronGridToDirection(new Vector2(1, 0), target);
      expect(target.x).toBeCloseTo(0, 5);
      expect(target.y).toBeCloseTo(-1, 5);
      expect(target.z).toBeCloseTo(0, 5);

      fullOctahedronGridToDirection(new Vector2(0, 1), target);
      expect(target.x).toBeCloseTo(0, 5);
      expect(target.y).toBeCloseTo(-1, 5);
      expect(target.z).toBeCloseTo(0, 5);
    });

    it('maps diamond midpoints to equator directions', () => {
      fullOctahedronGridToDirection(new Vector2(0.5, 1.0), target);
      expect(target.x).toBeCloseTo(0, 5);
      expect(target.y).toBeCloseTo(0, 5);
      expect(target.z).toBeCloseTo(1, 5);

      fullOctahedronGridToDirection(new Vector2(0.5, 0.0), target);
      expect(target.x).toBeCloseTo(0, 5);
      expect(target.y).toBeCloseTo(0, 5);
      expect(target.z).toBeCloseTo(-1, 5);

      fullOctahedronGridToDirection(new Vector2(1.0, 0.5), target);
      expect(target.x).toBeCloseTo(1, 5);
      expect(target.y).toBeCloseTo(0, 5);
      expect(target.z).toBeCloseTo(0, 5);

      fullOctahedronGridToDirection(new Vector2(0.0, 0.5), target);
      expect(target.x).toBeCloseTo(-1, 5);
      expect(target.y).toBeCloseTo(0, 5);
      expect(target.z).toBeCloseTo(0, 5);
    });

    it('produces unit vectors for all samples', () => {
      for (let x = 0; x <= 1; x += 0.25) {
        for (let y = 0; y <= 1; y += 0.25) {
          fullOctahedronGridToDirection(new Vector2(x, y), target);
          expect(target.length()).toBeCloseTo(1, 5);
        }
      }
    });
  });
});
