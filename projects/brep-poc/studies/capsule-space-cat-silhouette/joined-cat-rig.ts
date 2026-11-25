import {
  Bone, BufferGeometry, CubicBezierCurve3, Float32BufferAttribute, Group, MathUtils,
  Matrix4, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3,
} from 'three';
import { CapsuleCatLegMesh, capsuleCatLegSkinWeights } from 'triangular-engine/procedural';
import type { CapsuleCatTailPose } from 'triangular-engine/characters';
import type { SpaceCatLeg, SpaceCatTail } from '../../../demo-app/src/app/pages/character-studio/experimental-space-cat';
import { frontLegBlend } from './front-leg-weights';
import { createFusedEarRig, earRootBlend } from './fused-ear-rig';
import { conceptRearExtension, joinedCatRest, joinedTail, originalLegs } from './joined-cat-rest';
import { rearHipBlend } from './rear-hip';

const TAIL_SAMPLES = 72;

/** One body surface and skeleton with four leg chains and optional tail and ears. */
export function buildJoinedCatRig(
  geometry: BufferGeometry,
  variant: 'joined' | 'compact' | 'legs-only' | 'fused-tail' | 'fused-ears' = 'joined',
) {
  const compact = variant === 'compact';
  const legsOnly = variant === 'legs-only';
  const originalTail = variant === 'fused-tail' || variant === 'fused-ears';
  const useOriginalLegs = legsOnly || originalTail;
  const tailSegments = originalTail ? 8 : 5;
  const restPose = joinedCatRest(compact);
  const legRest = useOriginalLegs ? originalLegs : restPose.legs;
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
  const disposeRig = () => {
    mesh.skeleton.dispose();
    geometry.dispose();
    temporaryMaterial.dispose();
  };

  for (const rest of legRest) {
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
      // Without a fused tail, the first leg owns the shared rig's disposal.
      dispose: legsOnly && legs.size === 0 ? disposeRig : () => {},
    });
  }
  emptyGeometry.dispose();

  const tailRig = legsOnly ? undefined : buildTailRig(mesh, bones, compact, restPose.tail, tailSegments, disposeRig);
  const ears = variant === 'fused-ears' ? createFusedEarRig(mesh, bones) : undefined;
  const positions = geometry.getAttribute('position');
  const weightGeometry = new BufferGeometry().setAttribute('position', positions.clone());
  const rest = legRest[0];
  weightGeometry.translate(0, -rest.ankle[1], 0);
  const { weights: legWeights } = capsuleCatLegSkinWeights(weightGeometry, rest);
  weightGeometry.dispose();
  const indices = new Uint16BufferAttribute(positions.count * 4, 4);
  const weights = new Float32BufferAttribute(positions.count * 4, 4);
  const point = new Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    point.fromBufferAttribute(positions, i);
    const { x, y, z } = point;
    if (ears) {
      const blend = earRootBlend(x, y, z);
      if (blend > 0) {
        indices.setXYZW(i, ears.indices[x > 0 ? 1 : 0], 0, 0, 0);
        weights.setXYZW(i, blend, 1 - blend, 0, 0);
        continue;
      }
    }
    if (tailRig && z < (compact ? -.25 : -.37) && y > .07 && Math.abs(x) < .12) {
      let nearest = 0;
      let distance = Infinity;
      let weightedSample = 0;
      let totalWeight = 0;
      tailRig.samples.forEach((sample, j) => {
        const candidate = sample.distanceToSquared(point);
        if (candidate < distance) {
          nearest = j;
          distance = candidate;
        }
        if (originalTail) {
          // The inside of the curl can be close to two branches. Blend the
          // curve samples there so neighboring vertices don't switch abruptly.
          const weight = Math.exp(-candidate / (2 * .04 ** 2));
          weightedSample += j * weight;
          totalWeight += weight;
        }
      });
      const t = (originalTail && totalWeight > 0 ? weightedSample / totalWeight : nearest) / TAIL_SAMPLES;
      const segment = Math.min(tailSegments - 1, Math.floor(t * tailSegments));
      const next = t * tailSegments - segment;
      const radius = Math.sqrt(distance);
      // On the original rump the tail only emerges partway along the curve.
      // Let that part of the join ease out of the fixed torso.
      const blend = originalTail
        ? MathUtils.smoothstep(t, .23, .48) * (1 - MathUtils.smoothstep(radius, .072, .12))
        : MathUtils.smoothstep(t, .08, .36) * (1 - MathUtils.smoothstep(radius, .045, .10));
      indices.setXYZW(i, tailRig.firstBone + segment, tailRig.firstBone + segment + 1, 0, 0);
      weights.setXYZW(i, (1 - next) * blend, next * blend, 1 - blend, 0);
      continue;
    }
    const leg = (z > 0 ? 0 : 2) + (x > 0 ? 1 : 0);
    const [legX, , legZ] = legRest[leg].ankle;
    const distance = Math.hypot(x - legX, z - legZ);
    const blend = useOriginalLegs
      ? (leg < 2 ? frontLegBlend(y, distance) : rearHipBlend(y, distance))
      : (1 - MathUtils.smoothstep(y, -.32, -.135)) * (1 - MathUtils.smoothstep(distance, .075, .155));
    const first = 1 + leg * 3;
    indices.setXYZW(i, first, first + 1, first + 2, 0);
    weights.setXYZW(i, legWeights[i * 4] * blend, legWeights[i * 4 + 1] * blend, legWeights[i * 4 + 2] * blend, 1 - blend);
  }
  geometry.setAttribute('skinIndex', indices);
  geometry.setAttribute('skinWeight', weights);
  mesh.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones), new Matrix4());
  return { body, legs, tail: tailRig?.tail, ears };
}

function buildTailRig(
  mesh: SkinnedMesh, bones: Bone[], compact: boolean, rest: typeof joinedTail, segments: number, dispose: () => void,
) {
  const [base, lower, upper, tip] = rest.map(point => new Vector3(...point));
  const tailRest = new CubicBezierCurve3(base, lower, upper, tip);
  const tailSamples = Array.from({ length: TAIL_SAMPLES + 1 }, (_, i) => tailRest.getPoint(i / TAIL_SAMPLES));
  const tailStart = bones.length;
  const tailBones: Bone[] = [];
  const previousCenter = new Vector3();
  const center = new Vector3();
  for (let i = 0; i <= segments; i += 1) {
    const bone = new Bone();
    bone.name = `tail-${i}`;
    tailRest.getPoint(i / segments, center);
    bone.position.copy(center).sub(previousCenter);
    (tailBones[i - 1] ?? mesh).add(bone);
    bones.push(bone);
    tailBones.push(bone);
    previousCenter.copy(center);
  }
  const restTangents = tailBones.map((_, i) => tailRest.getTangent(i / segments));
  const curve = new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3());
  const controls = [curve.v0, curve.v1, curve.v2, curve.v3];
  const tangent = new Vector3();
  const rotation = new Quaternion();
  const inverseParentRotation = new Quaternion();
  const tail: SpaceCatTail = {
    root: new Group(),
    updateFromPose(pose: CapsuleCatTailPose) {
      const live = [pose.base, pose.control1, pose.control2, pose.tip];
      controls.forEach((control, i) => {
        control.copy(live[i]);
        if (compact) {
          const [x, y, z] = rest[i];
          const [, oldY, oldZ] = joinedTail[i];
          control.set(x + control.x * .65, y + (control.y - oldY) * .55,
            z + (control.z - oldZ + conceptRearExtension) * .55);
        }
      });
      previousCenter.set(0, 0, 0);
      inverseParentRotation.identity();
      tailBones.forEach((bone, i) => {
        const t = i / segments;
        curve.getPoint(t, center);
        curve.getTangent(t, tangent);
        rotation.setFromUnitVectors(restTangents[i], tangent);
        bone.position.copy(center).sub(previousCenter).applyQuaternion(inverseParentRotation);
        bone.quaternion.multiplyQuaternions(inverseParentRotation, rotation);
        previousCenter.copy(center);
        inverseParentRotation.copy(rotation).invert();
      });
    },
    // The fur shader is shared with the torso.
    setColor() {},
    dispose,
  };
  return { tail, samples: tailSamples, firstBone: tailStart };
}
