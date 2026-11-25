import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bone, Group, Vector3 } from 'three';
import { createFusedEarRig, earRestFrame, earRootBlend } from './fused-ear-rig.ts';

test('the ear tips follow their bones and the blend stays off the forehead', () => {
  for (const side of [-1, 1] as const) {
    const { origin, rotation } = earRestFrame(side);
    const tip = new Vector3(0, .095, -.015).applyQuaternion(rotation).add(origin);
    assert.equal(earRootBlend(tip.x, tip.y, tip.z), 1);
    const rootBlend = earRootBlend(side * .190, .417, .489);
    assert.ok(rootBlend > 0 && rootBlend < 1);
    assert.equal(earRootBlend(side * .190, .37, .550), 0);
  }
  assert.equal(earRootBlend(0, .46, .436), 0);
});

test('each bone follows its own source pose relative to neutral', () => {
  const left = new Group();
  const right = new Group();
  left.rotation.set(.08, -.22, .32);
  right.rotation.set(.08, .22, -.32);
  const bones = [new Bone()];
  const rig = createFusedEarRig(new Group(), bones);
  const pose = rig.follow(left, right);
  const [leftBone, rightBone] = rig.indices.map(index => bones[index]);
  pose();
  assert.ok(leftBone.quaternion.angleTo(rightBone.quaternion) < 1e-6);
  left.rotation.z += .5;
  pose();
  assert.ok(leftBone.quaternion.angleTo(rightBone.quaternion) > .49);
  assert.equal(left.visible, false);
  assert.equal(right.visible, false);
});
