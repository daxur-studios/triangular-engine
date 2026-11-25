import { Bone, Euler, Group, MathUtils, Object3D, Quaternion, Vector3 } from 'three';

const ROOT_X = .190;
const ROOT_Y = .394;
const ROOT_Z = .502;

export function earRestFrame(side: -1 | 1) {
  const origin = new Vector3(side * .187, .386, .508);
  const rotation = new Quaternion().setFromEuler(new Euler(.08, side * .22, -side * .32));
  return { origin, rotation };
}

/** Keep the head still and transfer motion to the ear across its rounded root. */
export function earRootBlend(x: number, y: number, z: number): number {
  const distance = Math.hypot(Math.abs(x) - ROOT_X, z - ROOT_Z);
  if (distance >= .1 || y < .35) return 0;
  const headY = .16 + .30 * Math.sqrt(Math.max(0, 1 - (x / .318) ** 2 - ((z - .436) / .291) ** 2));
  return MathUtils.smoothstep(y - headY, .001, .050) * (1 - MathUtils.smoothstep(distance, .071, .1));
}

/** Two independently posed ears. Each tip marker is for the debug overlay. */
export function createFusedEarRig(parent: Object3D, bones: Bone[]) {
  const ears = ([-1, 1] as const).map(side => {
    const bone = new Bone();
    bone.name = side < 0 ? 'ear-left' : 'ear-right';
    bone.position.set(side * ROOT_X, ROOT_Y, ROOT_Z);
    const tip = new Bone();
    tip.name = `${bone.name}-tip`;
    const { origin, rotation } = earRestFrame(side);
    tip.position.set(0, .095, -.015).applyQuaternion(rotation).add(origin).sub(bone.position);
    bone.add(tip);
    parent.add(bone);
    const index = bones.push(bone) - 1;
    return { bone, index, neutralInverse: new Quaternion() };
  });

  return {
    indices: ears.map(ear => ear.index),
    follow(left: Group, right: Group) {
      for (const [i, source] of [left, right].entries()) {
        const { bone, neutralInverse } = ears[i];
        source.visible = false;
        neutralInverse.copy(source.quaternion).invert();
        bone.quaternion.identity();
      }
      return () => {
        ears[0].bone.quaternion.multiplyQuaternions(left.quaternion, ears[0].neutralInverse);
        ears[1].bone.quaternion.multiplyQuaternions(right.quaternion, ears[1].neutralInverse);
      };
    },
  };
}
