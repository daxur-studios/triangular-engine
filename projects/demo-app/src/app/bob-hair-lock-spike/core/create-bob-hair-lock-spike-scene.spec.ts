import { MathUtils, Mesh, Scene } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { createBobHairLockSpikeScene } from './create-bob-hair-lock-spike-scene';

describe('WebGPU bob lock prototype', () => {
  it('keeps the lock and scalp together on a fixed parameter grid through edits', () => {
    const scene = new Scene();
    const handle = createBobHairLockSpikeScene({ scene });
    try {
      const lock = scene.getObjectByName('bob-lock') as Mesh;
      const turntable = lock.parent!;
      const geometry = lock.geometry;
      const positions = geometry.getAttribute('position');
      const points = Array.from(positions.array);
      const material = lock.material as MeshStandardNodeMaterial;
      expect(material.positionNode).toBeTruthy();

      for (const [length, flare] of [[70, 0], [130, 100]]) {
        handle.setLength(length);
        handle.setFlare(flare);
        expect(lock.parent).toBe(turntable);
        expect(lock.geometry).toBe(geometry);
        expect(lock.geometry.getAttribute('position')).toBe(positions);
        expect(Array.from(positions.array)).toEqual(points);
        expect(lock.position.toArray()).toEqual([0, 0, 0]);
        expect(lock.scale.toArray()).toEqual([1, 1, 1]);
        expect(lock.material).toBe(material);
      }

      handle.setAngle(90);
      expect(turntable.rotation.y).toBeCloseTo(MathUtils.degToRad(-90));
      expect(turntable.children.length).toBe(2);
    } finally {
      handle.dispose();
    }
    expect(scene.children).toEqual([]);
  });
});
