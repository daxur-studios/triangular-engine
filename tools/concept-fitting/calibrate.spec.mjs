import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCore } from './load-core.mjs';
import { dnaFrom, seededNoise, solveSubject, startShared, synthesizeCrop } from './fit.mjs';
import { gateFailures, gateResidual, variantsOf } from './calibrate.mjs';

const D = Math.PI / 180;
const SIZE = { width: 340, height: 440 };
const TRUTH = { ...startShared(), eyeSpacing: 0.36, eyeScale: 1.1, bodyHeight: 1.1, mouthWidth: 0.7, gazeYawLeft: 0.2, gazeYawRight: -0.15 };
const VIEWS = [
  ['front', { yaw: 2 * D, pitch: 8 * D, fov: 25, logPpm: 5.45, ox: 0, oy: 100 }],
  ['three-quarter', { yaw: -35 * D, pitch: 10 * D, fov: 25, logPpm: 5.45, ox: 5, oy: 100 }],
  ['profile', { yaw: 75 * D, pitch: 5 * D, fov: 25, logPpm: 5.45, ox: -8, oy: 100 }],
  ['up', { yaw: -10 * D, pitch: -35 * D, fov: 25, logPpm: 5.45, ox: 10, oy: 110 }],
  ['down', { yaw: 5 * D, pitch: 30 * D, fov: 25, logPpm: 5.45, ox: 0, oy: 90 }],
];
const core = await loadCore();
const gauss = seededNoise(11);
const crops = VIEWS.map(([id, camera]) => synthesizeCrop(core, { id, label: id, shared: TRUTH, view: camera, size: SIZE, noisePx: 0.6, gauss }));
const fitted = solveSubject(core, crops);
const good = gateResidual(core, fitted.shared, crops, fitted.state.views);

test('the fitted model passes its own gate', () => {
  assert.deepEqual(gateFailures(good, good), []);
});

test('every deliberately wrong variant fails the gate on a synthetic head', () => {
  const variants = variantsOf(core, fitted.shared, dnaFrom);
  assert.equal(variants.length, 8);
  for (const v of variants) {
    const failed = gateFailures(good, gateResidual(core, v.shared, crops, fitted.state.views));
    assert.ok(failed.length > 0, `${v.id} should fail`);
  }
});
