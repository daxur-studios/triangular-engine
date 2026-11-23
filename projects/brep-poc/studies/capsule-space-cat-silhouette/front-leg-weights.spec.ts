import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontLegBlend } from './front-leg-weights.ts';

test('the front knee and lower leg follow the leg chain', () => {
  assert.equal(frontLegBlend(-.268, .072), 1);
  assert.equal(frontLegBlend(-.395, .112), 1);
});

test('the front shoulder blends into the torso and leaves the adjacent body still', () => {
  const shoulderWeight = frontLegBlend(-.212, .064);
  assert.ok(shoulderWeight > 0 && shoulderWeight < 1);
  assert.equal(frontLegBlend(-.175, .064), 0);
  assert.equal(frontLegBlend(-.280, .153), 0);
});
