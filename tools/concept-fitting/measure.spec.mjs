import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { sha256 } from './crop-board.mjs';
import { decode, fitCircle, fitParallelEdges, measureCrop, ratios, run } from './measure.mjs';

const BACKGROUND = [245, 235, 220];
const SKIN = [230, 170, 130];
const HAIR = [230, 120, 40];
const WHITE = [240, 240, 235];
const GREY = [200, 200, 200];
const DARK = [40, 30, 30];

/**
 * A synthetic clay head: a 200 px wide skin cylinder under a hair cap, two eye whites of radius 30
 * with pupils, a dark mouth line and a small grey disc with a dark centre (a headset stand-in that
 * must not count as an eye).
 */
function drawFace({ upsideDown = false } = {}) {
  const w = 400, h = 500;
  const rgb = Buffer.alloc(w * h * 3);
  const put = (x, y, c) => rgb.set(c, ((upsideDown ? h - 1 - y : y) * w + x) * 3);
  const disc = (cx, cy, r, c) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) put(x, y, c);
    }
  };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, c); };
  rect(0, 0, w, h, BACKGROUND);
  rect(100, 140, 300, 460, SKIN);
  rect(90, 60, 310, 150, HAIR);
  disc(160, 230, 30, WHITE);
  disc(240, 232, 30, WHITE);
  disc(165, 235, 7, DARK);
  disc(245, 236, 7, DARK);
  rect(175, 330, 225, 334, DARK);
  disc(130, 400, 10, GREY);
  disc(130, 400, 4, DARK);
  return { rgb, w, h };
}

const measureFace = (options) => {
  const { rgb, w, h } = drawFace(options);
  return measureCrop(decode(rgb, w, h, 3));
};

test('a circle is recovered from noisy rim points', () => {
  const points = [];
  for (let k = 0; k < 90; k++) {
    const a = (k / 90) * 2 * Math.PI, noise = 0.3 * Math.sin(k * 7.3);
    points.push([50 + (20 + noise) * Math.cos(a), 40 + (20 + noise) * Math.sin(a)]);
  }
  const c = fitCircle(points);
  assert.ok(Math.abs(c.cx - 50) < 0.1 && Math.abs(c.cy - 40) < 0.1 && Math.abs(c.r - 20) < 0.1, JSON.stringify(c));
});

test('parallel head edges ignore a chamfered base', () => {
  const rows = [];
  for (let y = 0; y < 60; y++) {
    const cut = Math.max(0, y - 50) * 2;
    rows.push({ y, left: 100 + cut, right: 300 - cut });
  }
  const fit = fitParallelEdges(rows);
  assert.ok(Math.abs(fit.b) < 0.01 && Math.abs(fit.aL - 100) < 0.5 && Math.abs(fit.aR - 300) < 0.5, JSON.stringify(fit));
});

test('a synthetic head is measured without flags and the decoy disc is dropped', () => {
  const { landmarks, flags, droppedCircles } = measureFace();
  assert.deepEqual(flags, []);
  assert.ok(droppedCircles >= 1);
  const [left, right] = landmarks.eyes;
  for (const [eye, cx, cy, px, py] of [[left, 160, 230, 165, 235], [right, 240, 232, 245, 236]]) {
    assert.ok(Math.hypot(eye.cx - cx, eye.cy - cy) < 1, `eye centre ${eye.cx},${eye.cy}`);
    assert.ok(Math.abs(eye.r - 30) < 1.5, `eye radius ${eye.r}`);
    assert.ok(Math.hypot(eye.pupil.cx - px, eye.pupil.cy - py) < 0.5, `pupil ${eye.pupil.cx},${eye.pupil.cy}`);
  }
  assert.ok(Math.abs(landmarks.head.widthPx - 200) <= 1 && Math.abs(landmarks.head.tilt) < 0.5, JSON.stringify(landmarks.head));
  assert.deepEqual(landmarks.mouth.left, { x: 175.5, y: 332 });
  assert.deepEqual(landmarks.mouth.right, { x: 224.5, y: 332 });
  const r = ratios(landmarks);
  assert.ok(Math.abs(r.eyeSpacing - 0.4) < 0.01 && Math.abs(r.mouthWidth - 0.245) < 0.01, JSON.stringify(r));
  assert.ok(r.mouthBelowEyes > 0.45);
});

test('the mouth is found on an upside-down head without assuming which side is down', () => {
  const { landmarks, flags } = measureFace({ upsideDown: true });
  assert.deepEqual(flags, []);
  assert.deepEqual(landmarks.mouth.left, { x: 175.5, y: 168 });
  assert.ok(ratios(landmarks).mouthBelowEyes < -0.45);
});

test('a rerun writes an identical spec, and an override replaces one landmark', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concept-measure-'));
  try {
    const { rgb, w, h } = drawFace();
    const sheet = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const sourceDir = path.join(root, 'source');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(path.join(sourceDir, 'sheet.png'), sheet);
    const manifest = {
      schema: 1,
      sheet: { name: 'synthetic', sha256: sha256(sheet), width: w, height: h },
      subjects: [{ id: 'a', label: 'A', include: true }],
      views: ['front'],
      crops: [{ id: 'a-front', subject: 'a', view: 'front', include: true, rect: { x: 0, y: 0, w, h } }],
    };
    const manifestPath = path.join(root, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const first = await run({ sourceDir, manifestPath, outDir: path.join(root, 'one') });
    const second = await run({ sourceDir, manifestPath, outDir: path.join(root, 'two') });
    assert.equal(first.specSha256, second.specSha256);
    assert.ok(fs.existsSync(path.join(root, 'one', 'measurement-board.png')));

    const mouth = { left: { x: 170, y: 332 }, right: { x: 230, y: 332 }, kind: 'override' };
    fs.writeFileSync(path.join(root, 'manifest.overrides.json'), JSON.stringify({ 'a-front': { mouth, note: 'wider smile' } }));
    const corrected = await run({ sourceDir, manifestPath, outDir: path.join(root, 'three') });
    const entry = corrected.spec.crops[0];
    assert.equal(corrected.spec.overrides, 1);
    assert.deepEqual(entry.overridden, ['mouth']);
    assert.deepEqual(entry.landmarks.mouth, mouth);
    assert.deepEqual(entry.landmarks.eyes, first.spec.crops[0].landmarks.eyes);
    assert.equal(entry.ratios.mouthWidth, 0.3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
