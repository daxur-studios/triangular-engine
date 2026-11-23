import {
  Bone, BufferGeometry, CubicBezierCurve3, Float32BufferAttribute, Group, MathUtils,
  Matrix4, MeshStandardMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3,
} from 'three';
import { CapsuleCatLegMesh, capsuleCatLegSkinWeights } from 'triangular-engine/procedural';
import type { CapsuleCatTailPose } from 'triangular-engine/characters';
import type { SpaceCatLeg, SpaceCatTail } from '../../../demo-app/src/app/pages/character-studio/experimental-space-cat';
import { conceptRearExtension, joinedCatRest, joinedTail } from './joined-cat-rest';

const TAIL_SEGMENTS = 5;
const TAIL_SAMPLES = 72;

/** One body surface and skeleton, with four leg chains and a flexible tail. */
export function buildJoinedCatRig(geometry: BufferGeometry, compact = false) {
  const restPose = joinedCatRest(compact);
  const body = new Group();
  const temporaryMaterial = new MeshStandardMaterial();
  const mesh = new SkinnedMesh(geometry, temporaryMaterial);
  mesh.name = 'space-cat-joined-body';
  mesh.frustumCulled = false;
  body.add(mesh);
  const torso = new Bone();
  torso.name = 'torso';
  mesh.add(torso);
  const bones = [torso];
  const legs = new Map<string, SpaceCatLeg>();
  const legMatrix = new Matrix4();
  const shoulder = new Vector3();
  const knee = new Vector3();
  const ankle = new Vector3();
  const emptyGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([], 3));

  for (const rest of restPose.legs) {
    // The existing leg object solves the chain. Its bones drive the joined mesh.
    const chain = new CapsuleCatLegMesh({ geometry: emptyGeometry, material: temporaryMaterial, rest });
    const skeleton = chain.mesh.skeleton;
    const [hip] = skeleton.bones;
    hip.position.add(new Vector3(...rest.ankle));
    mesh.add(hip);
    bones.push(...skeleton.bones);
    skeleton.dispose();
    legs.set(rest.name, {
      mesh: new Group(),
      ownsPaw: true,
      pose(hipPoint, kneePoint, anklePoint, pawPitch) {
        const parent = body.parent;
        if (!parent) return;
        parent.updateMatrix();
        legMatrix.copy(parent.matrix).invert();
        shoulder.copy(hipPoint).applyMatrix4(legMatrix);
        knee.copy(kneePoint).applyMatrix4(legMatrix);
        ankle.copy(anklePoint).applyMatrix4(legMatrix);
        if (compact) {
          // Short, rounded feet still move through the same gait cycle.
          ankle.y += .085;
          ankle.z = MathUtils.lerp(rest.ankle[2], ankle.z, .70);
          knee.y += .043;
          knee.z = MathUtils.lerp(rest.ankle[2], knee.z, .78);
        }
        chain.pose(shoulder, knee, ankle, compact ? pawPitch * .65 : pawPitch);
      },
      dispose() {},
    });
  }
  emptyGeometry.dispose();

  const [base, lower, upper, tip] = restPose.tail.map(point => new Vector3(...point));
  const tailRest = new CubicBezierCurve3(base, lower, upper, tip);
  const tailSamples = Array.from({ length: TAIL_SAMPLES + 1 }, (_, i) => tailRest.getPoint(i / TAIL_SAMPLES));
  const tailStart = bones.length;
  const tailBones = Array.from({ length: TAIL_SEGMENTS + 1 }, (_, i) => {
    const bone = new Bone();
    bone.name = `tail-${i}`;
    tailRest.getPoint(i / TAIL_SEGMENTS, bone.position);
    mesh.add(bone);
    bones.push(bone);
    return bone;
  });
  const restTangents = tailBones.map((_, i) => tailRest.getTangent(i / TAIL_SEGMENTS));
  const curve = new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3());
  const controls = [curve.v0, curve.v1, curve.v2, curve.v3];
  const tangent = new Vector3();
  const tail: SpaceCatTail = {
    root: new Group(),
    updateFromPose(pose: CapsuleCatTailPose) {
      const live = [pose.base, pose.control1, pose.control2, pose.tip];
      controls.forEach((control, i) => {
        control.copy(live[i]);
        if (compact) {
          const [x, y, z] = restPose.tail[i];
          const [, oldY, oldZ] = joinedTail[i];
          control.set(x + control.x * .65, y + (control.y - oldY) * .55,
            z + (control.z - oldZ + conceptRearExtension) * .55);
        }
      });
      tailBones.forEach((bone, i) => {
        const t = i / TAIL_SEGMENTS;
        curve.getPoint(t, bone.position);
        curve.getTangent(t, tangent);
        bone.quaternion.setFromUnitVectors(restTangents[i], tangent);
      });
    },
    // The fur shader is shared with the torso.
    setColor() {},
    dispose() {
      mesh.skeleton.dispose();
      geometry.dispose();
      temporaryMaterial.dispose();
    },
  };

  const positions = geometry.getAttribute('position');
  const weightGeometry = new BufferGeometry().setAttribute('position', positions.clone());
  const rest = restPose.legs[0];
  weightGeometry.translate(0, -rest.ankle[1], 0);
  const { weights: legWeights } = capsuleCatLegSkinWeights(weightGeometry, rest);
  weightGeometry.dispose();
  const indices = new Uint16BufferAttribute(positions.count * 4, 4);
  const weights = new Float32BufferAttribute(positions.count * 4, 4);
  const point = new Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    point.fromBufferAttribute(positions, i);
    const { x, y, z } = point;
    if (z < (compact ? -.25 : -.37) && y > .07 && Math.abs(x) < .12) {
      let nearest = 0;
      let distance = Infinity;
      tailSamples.forEach((sample, j) => {
        const candidate = sample.distanceToSquared(point);
        if (candidate < distance) {
          nearest = j;
          distance = candidate;
        }
      });
      const t = nearest / TAIL_SAMPLES;
      const segment = Math.min(TAIL_SEGMENTS - 1, Math.floor(t * TAIL_SEGMENTS));
      const next = t * TAIL_SEGMENTS - segment;
      const blend = MathUtils.smoothstep(t, .08, .36) * (1 - MathUtils.smoothstep(Math.sqrt(distance), .045, .10));
      indices.setXYZW(i, tailStart + segment, tailStart + segment + 1, 0, 0);
      weights.setXYZW(i, (1 - next) * blend, next * blend, 1 - blend, 0);
      continue;
    }
    const leg = (z > 0 ? 0 : 2) + (x > 0 ? 1 : 0);
    const [legX, , legZ] = restPose.legs[leg].ankle;
    const distance = Math.hypot(x - legX, z - legZ);
    const blend = (1 - MathUtils.smoothstep(y, -.32, -.135)) * (1 - MathUtils.smoothstep(distance, .075, .155));
    const first = 1 + leg * 3;
    indices.setXYZW(i, first, first + 1, first + 2, 0);
    weights.setXYZW(i, legWeights[i * 4] * blend, legWeights[i * 4 + 1] * blend, legWeights[i * 4 + 2] * blend, 1 - blend);
  }
  geometry.setAttribute('skinIndex', indices);
  geometry.setAttribute('skinWeight', weights);
  mesh.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones), new Matrix4());
  return { body, legs, tail };
}
