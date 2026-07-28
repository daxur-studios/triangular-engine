import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { createStampDecalGeometry } from './stamp-decal-geometry';

function groundMesh(): Mesh {
  const geometry = new PlaneGeometry(50, 50, 4, 4);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('createStampDecalGeometry', () => {
  it('produces a non-empty geometry projected onto the target mesh', () => {
    const geometry = createStampDecalGeometry({
      targetMesh: groundMesh(),
      positionM: [0, 0, 0],
      normal: [0, 1, 0],
      sizeM: [1, 1, 0.5],
    });
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('centers roughly on the requested stamp position', () => {
    const geometry = createStampDecalGeometry({
      targetMesh: groundMesh(),
      positionM: [5, 0, -3],
      normal: [0, 1, 0],
      sizeM: [1, 1, 0.5],
    });
    geometry.computeBoundingBox();
    const center = geometry.boundingBox!.getCenter(new Vector3());
    expect(center.x).toBeCloseTo(5, 0);
    expect(center.z).toBeCloseTo(-3, 0);
  });

  it('does not throw when a headingRad is supplied', () => {
    expect(() =>
      createStampDecalGeometry({
        targetMesh: groundMesh(),
        positionM: [0, 0, 0],
        normal: [0, 1, 0],
        sizeM: [1, 1, 0.5],
        headingRad: Math.PI / 3,
      }),
    ).not.toThrow();
  });
});
