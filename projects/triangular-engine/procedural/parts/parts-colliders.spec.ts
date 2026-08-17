import { derivePartColliders } from './parts-colliders';
import type { IPartSolid } from './parts-solid';

describe('parts-colliders', () => {
  it('converts box, cylinder, capsule, sphere, and cone to correct Jolt parameter orders', () => {
    const solids: readonly IPartSolid[] = [
      {
        id: 'box-1',
        shape: 'box',
        positionM: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        dimensionsM: [2, 4, 6],
        linkId: 0,
        collidable: true,
      },
      {
        id: 'cyl-1',
        shape: 'cylinder',
        positionM: [0, 5, 0],
        orientation: [0, 0, 0, 1],
        dimensionsM: [0.5, 3.0], // radius = 0.5, height = 3.0
        linkId: 0,
      },
      {
        id: 'cone-1',
        shape: 'cone',
        positionM: [0, 10, 0],
        orientation: [0, 0, 0, 1],
        dimensionsM: [0.8, 0.2, 4.0], // radiusBottom = 0.8, radiusTop = 0.2, height = 4.0
        linkId: 0,
      },
      {
        id: 'cap-1',
        shape: 'capsule',
        positionM: [0, 15, 0],
        orientation: [0, 0, 0, 1],
        dimensionsM: [0.3, 2.0], // radius = 0.3, totalHeight = 2.0
        linkId: 1,
      },
      {
        id: 'sph-1',
        shape: 'sphere',
        positionM: [0, 20, 0],
        orientation: [0, 0, 0, 1],
        dimensionsM: [1.2], // radius = 1.2
        linkId: 0,
      },
      {
        id: 'cosmetic-bolt',
        shape: 'box',
        positionM: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        dimensionsM: [0.01, 0.01, 0.01],
        linkId: 0,
        collidable: false, // cosmetic
      },
    ];

    const colliders = derivePartColliders(solids);

    // Filtered out cosmetic-bolt
    expect(colliders.length).toBe(5);

    // Box: [w, h, d]
    expect(colliders[0].shape).toBe('box');
    expect(colliders[0].params).toEqual([2, 4, 6]);

    // Cylinder: [halfHeight, radius]
    expect(colliders[1].shape).toBe('cylinder');
    expect(colliders[1].params).toEqual([1.5, 0.5]);

    // Cone -> Cylinder approximation: [halfHeight, radiusBottom]
    expect(colliders[2].shape).toBe('cylinder');
    expect(colliders[2].params).toEqual([2.0, 0.8]);

    // Capsule: [halfHeight, radius] -> (2.0 - 2*0.3)/2 = 0.7
    expect(colliders[3].shape).toBe('capsule');
    expect(colliders[3].params).toEqual([0.7, 0.3]);
    expect(colliders[3].linkId).toBe(1);

    // Sphere: [radius]
    expect(colliders[4].shape).toBe('sphere');
    expect(colliders[4].params).toEqual([1.2]);
  });
});
