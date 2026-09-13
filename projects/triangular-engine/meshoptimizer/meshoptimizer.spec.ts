import { BufferGeometry, Float32BufferAttribute } from 'three';
import { simplifyIndexedGeometry } from './public-api';

describe('simplifyIndexedGeometry', () => {
  it('preserves attributes and returns a triangle-aligned index buffer', async () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([
      -1, 0, -1, 0, 0, -1, 1, 0, -1,
      -1, 0, 0, 0, 0, 0, 1, 0, 0,
      -1, 0, 1, 0, 0, 1, 1, 0, 1,
    ], 3));
    geometry.setAttribute('uv', new Float32BufferAttribute([
      0, 0, 0.5, 0, 1, 0, 0, 0.5, 0.5, 0.5, 1, 0.5,
      0, 1, 0.5, 1, 1, 1,
    ], 2));
    geometry.setIndex([
      0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4,
      3, 4, 7, 3, 7, 6, 4, 5, 8, 4, 8, 7,
    ]);

    const result = await simplifyIndexedGeometry(geometry, { ratio: 0.5 });

    expect(result.indexCount % 3).toBe(0);
    expect(result.indexCount).toBeLessThanOrEqual(result.sourceIndexCount);
    expect(result.geometry.getAttribute('position').count).toBe(9);
    expect(result.geometry.getAttribute('uv').count).toBe(9);
    result.geometry.dispose();
    geometry.dispose();
  });

  it('rejects non-indexed geometry before loading the simplifier', async () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));

    await expectAsync(simplifyIndexedGeometry(geometry)).toBeRejectedWithError(/indexed geometry/);
    geometry.dispose();
  });
});
