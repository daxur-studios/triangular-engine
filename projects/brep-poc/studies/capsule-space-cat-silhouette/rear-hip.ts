import { Bone, Group, MathUtils, Matrix4, Skeleton, Vector3, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { CapsuleCatLegMesh } from 'triangular-engine/procedural';

export interface RearHipRestPose {
  ankle: readonly [number, number, number];
  hipHeight: number;
}

/** Fade the original leg into the fixed torso across the rounded join. */
export function rearHipBlend(y: number, distance: number): number {
  const alongLeg = 1 - MathUtils.smoothstep(y, -.325, -.165);
  const nearLeg = 1 - MathUtils.smoothstep(distance, .095, .185);
  return alongLeg * nearLeg;
}

/** One fused body and rear leg, posed by the same three bones as a separate leg. */
export function buildRearHip(geometry: BufferGeometry, material: MeshStandardMaterial, rest: RearHipRestPose) {
  const [x, y, z] = rest.ankle;
  geometry.translate(-x, -y, -z);
  const leg = new CapsuleCatLegMesh({ geometry, material, rest, name: 'space-cat-fused-rear-hip' });
  geometry.translate(x, y, z);

  const body = new Group();
  const torsoBone = new Bone();
  torsoBone.name = 'torso';
  const { mesh } = leg;
  const originalSkeleton = mesh.skeleton;
  const [hip] = originalSkeleton.bones;
  hip.position.add(new Vector3(x, y, z));
  mesh.add(torsoBone);
  mesh.updateMatrixWorld(true);
  mesh.bind(new Skeleton([...originalSkeleton.bones, torsoBone]), new Matrix4());
  originalSkeleton.dispose();
  body.add(mesh);

  const position = geometry.getAttribute('position');
  const index = geometry.getAttribute('skinIndex');
  const weight = geometry.getAttribute('skinWeight');
  for (let i = 0; i < position.count; i += 1) {
    // Keep the far side and top of the rump still. Fade into the leg across
    // the fillet on the near side, with full leg motion below the body.
    const distance = Math.hypot(position.getX(i) - x, position.getZ(i) - z);
    const blend = rearHipBlend(position.getY(i), distance);
    index.setW(i, 3);
    weight.setXYZW(i, weight.getX(i) * blend, weight.getY(i) * blend, weight.getZ(i) * blend, 1 - blend);
  }
  index.needsUpdate = true;
  weight.needsUpdate = true;

  const actorToTorso = new Matrix4();
  const shoulder = new Vector3();
  const knee = new Vector3();
  const ankle = new Vector3();
  return {
    body,
    legs: new Map([['capsule-cat-back-right-leg', {
      // The studio attaches this socket to its limbs group. The visible mesh
      // is mounted separately with the torso so the fixed bone follows it.
      mesh: new Group(),
      ownsPaw: true,
      pose(shoulderPoint: Vector3, kneePoint: Vector3, anklePoint: Vector3, pawPitch: number): void {
        const torso = body.parent;
        if (!torso) return;
        torso.updateMatrix();
        actorToTorso.copy(torso.matrix).invert();
        leg.pose(
          shoulder.copy(shoulderPoint).applyMatrix4(actorToTorso),
          knee.copy(kneePoint).applyMatrix4(actorToTorso),
          ankle.copy(anklePoint).applyMatrix4(actorToTorso),
          pawPitch,
        );
      },
      dispose(): void {
        mesh.skeleton.dispose();
        leg.dispose();
      },
    }]]),
  };
}
