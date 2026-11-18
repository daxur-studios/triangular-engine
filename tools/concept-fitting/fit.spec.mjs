import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCore } from './load-core.mjs';
import { SHARED_PARAMETERS, WEAK_FREEDOM, flagViews, seededNoise, solveSubject, startShared, synthesizeCrop } from './fit.mjs';

const SIZE = { width: 340, height: 440 };
const NOISE_PX = 0.6;

/** Known truth: a head whose face differs clearly from the starting guess. */
const TRUTH = {
  ...startShared(),
  eyeSpacing: 0.36,
  eyeScale: 1.1,
  eyeSizeAsymmetry: 0.05,
  eyeHeightAsymmetry: -0.02,
  bodyHeight: 1.1,
  mouthWidth: 0.7,
  gazeYawLeft: 0.2,
  gazePitchLeft: -0.1,
  gazeYawRight: -0.15,
  gazePitchRight: -0.05,
};

const D = Math.PI / 180;
const VIEWS = [
  { id: 'front', label: 'front', camera: { yaw: 2 * D, pitch: 8 * D, fov: 25, logPpm: 5.45, ox: 0, oy: 100 } },
  { id: 'three-quarter', label: 'three-quarter', camera: { yaw: -35 * D, pitch: 10 * D, fov: 25, logPpm: 5.45, ox: 5, oy: 100 } },
  { id: 'profile', label: 'profile', camera: { yaw: 75 * D, pitch: 5 * D, fov: 25, logPpm: 5.45, ox: -8, oy: 100 } },
  { id: 'up', label: 'up', camera: { yaw: -10 * D, pitch: -35 * D, fov: 25, logPpm: 5.45, ox: 10, oy: 110 } },
  { id: 'down', label: 'down', camera: { yaw: 5 * D, pitch: 30 * D, fov: 25, logPpm: 5.45, ox: 0, oy: 90 } },
];

function crops(core, { seed = 7, noisePx = NOISE_PX, corrupt = null } = {}) {
  const gauss = seededNoise(seed);
  return VIEWS.map((v) => {
    const crop = synthesizeCrop(core, { id: v.id, label: v.label, shared: TRUTH, view: v.camera, size: SIZE, noisePx, gauss });
    if (corrupt && corrupt.id === v.id) corrupt.apply(crop);
    return crop;
  });
}

const core = await loadCore();

test('recovers shared face parameters from noisy synthetic measurements', () => {
  const result = solveSubject(core, crops(core));
  assert.deepEqual(result.flagged, [], 'consistent synthetic views are not flagged');
  const tolerance = { eyeSpacing: 0.015, eyeScale: 0.04, bodyHeight: 0.06, mouthWidth: 0.08 };
  for (const [key, tol] of Object.entries(tolerance)) {
    assert.ok(Math.abs(result.shared[key] - TRUTH[key]) <= tol, `${key}: fitted ${result.shared[key]} vs ${TRUTH[key]} (±${tol})`);
  }
});

// Pitch is the loosest camera angle: it trades against the vertical image offset (worst error 7 degrees over six seeds).
test('recovers each view camera angle and the residual stays at the noise level', () => {
  const result = solveSubject(core, crops(core));
  for (const v of VIEWS) {
    const fitted = result.views[v.id];
    assert.ok(Math.abs(fitted.camera.yaw - v.camera.yaw) <= 3 * D, `${v.id} yaw ${fitted.camera.yaw} vs ${v.camera.yaw}`);
    assert.ok(Math.abs(fitted.camera.pitch - v.camera.pitch) <= 10 * D, `${v.id} pitch ${fitted.camera.pitch} vs ${v.camera.pitch}`);
    assert.ok(Math.abs(fitted.camera.logPpm - v.camera.logPpm) <= 0.03, `${v.id} scale ${fitted.camera.logPpm} vs ${v.camera.logPpm}`);
    assert.ok(fitted.residual.rms <= 0.01, `${v.id} rms ${fitted.residual.rms}`);
  }
});

test('flags a view whose measurements disagree with the others without ruining the shared fit', () => {
  const corrupt = {
    id: 'three-quarter',
    apply: (crop) => {
      for (const e of crop.landmarks.eyes) { e.cx += 40; e.cy -= 25; e.pupil.cx += 40; e.pupil.cy -= 25; }
      if (crop.landmarks.mouth) for (const p of [crop.landmarks.mouth.left, crop.landmarks.mouth.right]) { p.x -= 30; p.y += 30; }
    },
  };
  const result = solveSubject(core, crops(core, { corrupt }));
  assert.ok(result.flagged.includes('three-quarter'), `flagged: ${result.flagged}`);
  assert.ok(result.flagged.length <= 1, `only the corrupted view: ${result.flagged}`);
  assert.ok(Math.abs(result.shared.eyeSpacing - TRUTH.eyeSpacing) <= 0.04);
  assert.ok(Math.abs(result.shared.mouthWidth - TRUTH.mouthWidth) <= 0.25);
});

test('is deterministic and reports freedom per view', () => {
  const a = solveSubject(core, crops(core));
  const b = solveSubject(core, crops(core));
  const strip = (r) => JSON.stringify({ shared: r.shared, views: r.views, flagged: r.flagged });
  assert.equal(strip(a), strip(b));
  for (const v of Object.values(a.views)) {
    assert.equal(v.residual.weak, v.residual.freedom < WEAK_FREEDOM);
    assert.ok(Number.isFinite(v.heldOutRms));
  }
});

test('flagViews flags by absolute limit and against the other views', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  assert.deepEqual(flagViews(list, { a: 0.01, b: 0.012, c: 0.011, d: 0.013, e: 0.01 }), []);
  assert.deepEqual(flagViews(list, { a: 0.01, b: 0.012, c: 0.011, d: 0.013, e: 0.1 }), ['e']);
  assert.deepEqual(flagViews(list, { a: 0.01, b: 0.012, c: 0.011, d: 0.013, e: 0.05 }), ['e']);
  // Below the absolute limit but more than three times the others' median.
  assert.deepEqual(flagViews(list, { a: 0.012, b: 0.012, c: 0.011, d: 0.013, e: 0.04 }), ['e']);
  assert.deepEqual(flagViews(list, { a: 0.02, b: 0.022, c: 0.021, d: 0.023, e: 0.04 }), []);
});

test('shared parameters keep their documented ranges', () => {
  for (const p of SHARED_PARAMETERS) assert.ok(p.lo < p.start && p.start < p.hi, p.key);
});
