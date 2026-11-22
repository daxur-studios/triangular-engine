import { Group, MathUtils, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { EngineService } from 'triangular-engine';
import { buildExperimentalScalpGeometry } from '../../pages/character-studio/experimental-pigtail-head';
import { createBobLockMaterial } from './bob-lock-material';

/** Mounts one GPU-deformed lock on the workshop scalp for silhouette review. */
export function createBobHairLockSpikeScene(engine: Pick<EngineService, 'scene'>) {
  const turntable = new Group();
  const scalp = new Mesh(
    buildExperimentalScalpGeometry(),
    new MeshStandardMaterial({ color: '#b6a69b', roughness: .88 }),
  );
  const { material, hemDrop, hemFlare } = createBobLockMaterial();
  // The grid's UVs are the angular and axial parameters of the generated sweep.
  const lock = new Mesh(new PlaneGeometry(1, 1, 24, 40), material);
  lock.name = 'bob-lock';
  lock.frustumCulled = false; // The GPU sweep extends outside the parameter grid's CPU bounds.
  turntable.add(scalp, lock);
  engine.scene.add(turntable);

  return {
    setLength(percent: number) {
      hemDrop.value = (percent - 100) * .018;
    },
    setFlare(percent: number) {
      hemFlare.value = percent * .0065;
    },
    setAngle(degrees: number) {
      turntable.rotation.y = -MathUtils.degToRad(degrees);
    },
    dispose() {
      turntable.removeFromParent();
      scalp.geometry.dispose();
      scalp.material.dispose();
      lock.geometry.dispose();
      material.dispose();
    },
  };
}
