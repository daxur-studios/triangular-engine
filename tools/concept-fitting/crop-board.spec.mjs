import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { findSourceByHash, run, sha256, validateManifest } from './crop-board.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const committed = JSON.parse(fs.readFileSync(path.join(here, 'manifests', 'headshots-and-angles.json'), 'utf8'));

test('the committed manifest is valid and lists three heads in five views', () => {
  validateManifest(committed);
  const included = committed.crops.filter((crop) => crop.include);
  assert.equal(included.length, 15);
  assert.deepEqual([...new Set(included.map((crop) => crop.subject))].sort(), ['goofy', 'orange-pigtails', 'variant-c']);
  for (const subject of ['goofy', 'orange-pigtails', 'variant-c']) {
    assert.deepEqual(included.filter((crop) => crop.subject === subject).map((crop) => crop.view), committed.views);
  }
});

test('the manifest never records a path to the concept art', () => {
  assert.doesNotMatch(JSON.stringify(committed), /[\\/]/);
});

test('validation rejects a crop outside the sheet and a duplicate id', () => {
  const outside = structuredClone(committed);
  outside.crops[0].rect.x = outside.sheet.width;
  assert.throws(() => validateManifest(outside), /outside/);
  const duplicate = structuredClone(committed);
  duplicate.crops[1].id = duplicate.crops[0].id;
  assert.throws(() => validateManifest(duplicate), /Duplicate/);
});

test('crops are cut from a sheet found by hash, and a rerun is byte identical', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concept-fitting-'));
  try {
    const sourceDir = path.join(root, 'source');
    fs.mkdirSync(sourceDir);
    const sheet = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#e8c9a0' } })
      .composite([{ input: await sharp({ create: { width: 10, height: 10, channels: 3, background: '#203040' } }).png().toBuffer(), left: 5, top: 5 }])
      .png().toBuffer();
    fs.writeFileSync(path.join(sourceDir, 'other.png'), await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer());
    fs.writeFileSync(path.join(sourceDir, 'sheet.png'), sheet);
    const manifest = {
      schema: 1,
      sheet: { name: 'synthetic', sha256: sha256(sheet), width: 40, height: 30 },
      subjects: [{ id: 'a', label: 'A', include: true }],
      views: ['front'],
      crops: [{ id: 'a-front', subject: 'a', view: 'front', include: true, rect: { x: 5, y: 5, w: 10, h: 10 } }],
    };
    const manifestPath = path.join(root, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.deepEqual(findSourceByHash(sourceDir, manifest.sheet.sha256), sheet);
    assert.throws(() => findSourceByHash(sourceDir, 'f'.repeat(64)), /No image/);
    const first = await run({ sourceDir, manifestPath, outDir: path.join(root, 'one') });
    const second = await run({ sourceDir, manifestPath, outDir: path.join(root, 'two') });
    assert.deepEqual(first, second);
    const crop = await sharp(path.join(root, 'one', 'crops', 'a-front.png')).raw().toBuffer({ resolveWithObject: true });
    assert.equal(crop.info.width, 10);
    assert.deepEqual([...crop.data.subarray(0, 3)], [0x20, 0x30, 0x40]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
