import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildContactFrameArgs, buildGifArgs, createContactSheet, createGifPreview, createImageContactSheet, listMedia, parseArgs,
} from './triangular-test-media.mjs';

function fixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'tri-media-'));
  const artifactDir = join(projectRoot, 'artifacts', 'test-runs');
  const runDir = join(artifactDir, 'suite@v1', 'run-1');
  mkdirSync(runDir, { recursive: true });
  const source = join(runDir, 'walk.webm');
  writeFileSync(source, 'webm source bytes');
  return { projectRoot, artifactDir, runDir, source, config: { outputDir: 'artifacts/test-runs' } };
}

test('GIF media options validate dimensions and use a silent palette-based encode', () => {
  assert.deepEqual(parseArgs(['gif', '--source', 'clip.webm']), {
    action: 'gif', source: 'clip.webm', fps: 8, width: 480, colors: 96, force: false, json: false, last: 20,
    captures: [], images: [], columns: 3, cellWidth: 320,
  });
  assert.equal(parseArgs(['list', '--suite', 'capsules', '--last', '3']).suite, 'capsules');
  assert.throws(() => parseArgs(['gif', '--source', 'clip.webm', '--fps', '30']), /1 to 20/);
  const args = buildGifArgs('clip.webm', 'clip.gif');
  assert.ok(args.includes('-an'));
  assert.ok(args.includes('-loop') && args.includes('0'));
  assert.match(args[args.indexOf('-filter_complex') + 1], /palettegen=max_colors=96/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /scale=480:-1/);
});

test('contact-sheet options require bounded, explicitly labeled captures and sample one JPEG frame', () => {
  const options = parseArgs([
    'contact-sheet', '--source', 'clip.webm', '--title', 'Capsule walk', '--columns', '2',
    '--capture', '0.5=Front & walk', '--capture', '2=Rear view',
  ]);
  assert.deepEqual(options.captures, [
    { timeSeconds: 0.5, label: 'Front & walk' },
    { timeSeconds: 2, label: 'Rear view' },
  ]);
  assert.equal(options.title, 'Capsule walk');
  assert.equal(options.columns, 2);
  assert.throws(() => parseArgs(['contact-sheet', '--source', 'clip.webm', '--capture', '0=Front']), /between 2 and 16/);
  assert.throws(() => parseArgs(['contact-sheet', '--source', 'clip.webm', '--capture', 'nope=Front', '--capture', '2=Rear']), /nonnegative time/);
  assert.throws(() => parseArgs(['contact-sheet', '--source', 'clip.webm', '--capture', '0=Front', '--capture', '2=Rear', '--cell-width', '80']), /128 to 640/);
  const stillOptions = parseArgs([
    'contact-sheet', '--title', 'Facial expressions', '--image', 'artifacts/run/happy.webp=Human happy',
    '--image', 'artifacts/run/sad.webp=Human sad', '--cell-width', '640',
  ]);
  assert.equal(stillOptions.images.length, 2);
  assert.equal(stillOptions.images[0].path, 'artifacts/run/happy.webp');
  assert.equal(stillOptions.images[0].label, 'Human happy');
  assert.equal(stillOptions.columns, 2);
  assert.equal(stillOptions.cellWidth, 640);
  const defaultStillOptions = parseArgs([
    'contact-sheet', '--image', 'artifacts/run/happy.webp=Human happy', '--image', 'artifacts/run/sad.webp=Human sad',
  ]);
  assert.equal(defaultStillOptions.cellWidth, 480);
  assert.equal(defaultStillOptions.columns, 2);
  assert.throws(() => parseArgs(['contact-sheet', '--image', 'only.webp=One']), /between 2 and 16/);
  assert.throws(() => parseArgs(['contact-sheet', '--source', 'clip.webm', '--capture', '0=Front', '--capture', '2=Rear', '--image', 'still.webp=Still']), /either --image values or --source/);
  const args = buildContactFrameArgs('clip.webm', 1.25, { width: 320, height: 180 });
  assert.ok(args.includes('-frames:v') && args.includes('1'));
  assert.equal(args[args.indexOf('-ss') + 1], '1.250');
  assert.match(args[args.indexOf('-vf') + 1], /scale=320:180:force_original_aspect_ratio=decrease/);
  assert.equal(args.at(-1), 'pipe:1');
});

test('GIF preview stays beside the source, leaves it unchanged, and records size/link metadata', () => {
  const f = fixture();
  try {
    const originalSource = readFileSync(f.source);
    const spawn = (command, args) => {
      assert.equal(command, 'ffmpeg');
      writeFileSync(args.at(-1), Buffer.from('gif derivative bytes'));
      return { status: 0, stdout: '', stderr: '' };
    };
    const result = createGifPreview({ ...f, source: f.source, spawn, now: () => new Date('2026-10-31T10:00:00.000Z') });
    assert.equal(result.file, 'suite@v1/run-1/walk.preview.gif');
    assert.equal(result.source, 'suite@v1/run-1/walk.webm');
    assert.equal(result.sourceBytes, originalSource.length);
    assert.equal(result.bytes, Buffer.byteLength('gif derivative bytes'));
    assert.deepEqual(readFileSync(f.source), originalSource);
    const manifest = JSON.parse(readFileSync(join(f.runDir, 'media-manifest.json'), 'utf8'));
    assert.equal(manifest.derivatives.length, 1);
    assert.equal(manifest.derivatives[0].kind, 'gif-preview');
    assert.equal(manifest.derivatives[0].file, result.file);
    assert.equal(manifest.derivatives[0].generatedAt, '2026-10-31T10:00:00.000Z');
    assert.equal(statSync(join(f.projectRoot, 'artifacts', 'test-runs', result.file)).size, result.bytes);
    writeFileSync(join(f.artifactDir, 'index.jsonl'), `${JSON.stringify({ suite: 'suite', file: 'suite@v1/run-1.json' })}\n`);
    writeFileSync(join(f.artifactDir, 'suite@v1', 'run-1.json'), '{}');
    const listed = listMedia({ projectRoot: f.projectRoot, config: f.config, suite: 'suite' });
    assert.equal(listed.derivatives.length, 1);
    assert.equal(listed.derivatives[0].file, result.file);
    assert.equal(listed.totalBytes, result.bytes);
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});

test('GIF preview refuses recordings outside the configured artifact directory', () => {
  const f = fixture();
  const outside = join(f.projectRoot, 'outside.webm');
  writeFileSync(outside, 'outside');
  try {
    assert.throws(() => createGifPreview({ ...f, source: outside, spawn: () => { throw new Error('must not run'); } }), /inside the configured test artifact directory/);
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});

test('contact sheet embeds labeled frames, preserves source, and records derivative metadata', () => {
  const f = fixture();
  try {
    const originalSource = readFileSync(f.source);
    let frameCalls = 0;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const spawn = (command, args) => {
      assert.equal(command, 'ffmpeg');
      assert.equal(args.at(-1), 'pipe:1');
      frameCalls++;
      return { status: 0, stdout: jpeg, stderr: '' };
    };
    const captures = [
      { timeSeconds: 0.25, label: 'Human & front walk' },
      { timeSeconds: 2, label: 'Rear view <stride>' },
    ];
    const result = createContactSheet({
      ...f,
      source: f.source,
      captures,
      title: 'Capsule human',
      columns: 2,
      spawn,
      now: () => new Date('2026-10-31T10:00:00.000Z'),
    });
    const svg = readFileSync(result.outputPath, 'utf8');
    assert.equal(frameCalls, 2);
    assert.equal(result.kind, 'contact-sheet');
    assert.equal(result.file, 'suite@v1/run-1/walk.contact.svg');
    assert.equal(result.sourceBytes, originalSource.length);
    assert.equal(result.bytes, Buffer.byteLength(svg));
    assert.match(svg, /Capsule human/);
    assert.match(svg, /Human &amp; front walk/);
    assert.match(svg, /Rear view &lt;stride&gt;/);
    assert.match(svg, /data:image\/jpeg;base64/);
    assert.deepEqual(readFileSync(f.source), originalSource);

    const manifest = JSON.parse(readFileSync(join(f.runDir, 'media-manifest.json'), 'utf8'));
    assert.equal(manifest.derivatives.length, 1);
    assert.equal(manifest.derivatives[0].kind, 'contact-sheet');
    assert.equal(manifest.derivatives[0].mimeType, 'image/svg+xml');
    assert.equal(manifest.derivatives[0].settings.captures[1].label, 'Rear view <stride>');
    assert.equal(manifest.derivatives[0].generatedAt, '2026-10-31T10:00:00.000Z');

    writeFileSync(join(f.artifactDir, 'index.jsonl'), `${JSON.stringify({ suite: 'suite', file: 'suite@v1/run-1.json' })}\n`);
    writeFileSync(join(f.artifactDir, 'suite@v1', 'run-1.json'), '{}');
    const listed = listMedia({ projectRoot: f.projectRoot, config: f.config, suite: 'suite' });
    assert.equal(listed.derivatives.length, 1);
    assert.equal(listed.derivatives[0].kind, 'contact-sheet');
    assert.equal(listed.totalBytes, result.bytes);

    assert.throws(() => createContactSheet({ ...f, source: f.source, captures, spawn }), /already exists/);
    const replaced = createContactSheet({ ...f, source: f.source, captures, spawn, force: true });
    assert.equal(replaced.file, result.file);
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});

test('contact sheet refuses empty sampled frames and recordings outside the artifact root', () => {
  const f = fixture();
  const outside = join(f.projectRoot, 'outside.webm');
  writeFileSync(outside, 'outside');
  const captures = [{ timeSeconds: 0, label: 'front' }, { timeSeconds: 1, label: 'side' }];
  try {
    assert.throws(() => createContactSheet({ ...f, source: outside, captures, spawn: () => { throw new Error('must not run'); } }), /inside the configured test artifact directory/);
    assert.throws(() => createContactSheet({ ...f, source: f.source, captures, spawn: () => ({ status: 0, stdout: Buffer.alloc(0) }) }), /did not produce a frame at 0s/);
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});

test('image contact sheet embeds saved stills, preserves them, and records each input and sheet size', () => {
  const f = fixture();
  const firstStill = join(f.runDir, 'human-happy-r1-0.webp');
  const secondStill = join(f.runDir, 'cat-skeptical-r1-0.webp');
  const firstBytes = Buffer.from('RIFF0000WEBP human happy image bytes');
  const secondBytes = Buffer.from('RIFF1111WEBP cat skeptical image bytes');
  writeFileSync(firstStill, firstBytes);
  writeFileSync(secondStill, secondBytes);
  try {
    const result = createImageContactSheet({
      ...f,
      images: [
        { path: firstStill, label: 'Human: happy eyes and smile' },
        { path: secondStill, label: 'Cat: asymmetric skeptical look' },
      ],
      title: 'Facial expressions',
      cellWidth: 640,
      now: () => new Date('2026-10-31T12:00:00.000Z'),
    });
    const svg = readFileSync(result.outputPath, 'utf8');
    assert.equal(result.file, 'suite@v1/run-1/facial-expressions.contact.svg');
    assert.equal(result.settings.cellWidth, 640);
    assert.equal(result.settings.columns, 2);
    assert.equal(result.sourceBytes, firstBytes.length + secondBytes.length);
    assert.deepEqual(result.sources.map(({ label }) => label), ['Human: happy eyes and smile', 'Cat: asymmetric skeptical look']);
    assert.match(svg, /data:image\/webp;base64/);
    assert.match(svg, /Human: happy eyes and smile/);
    assert.match(svg, /Cat: asymmetric skeptical look/);
    assert.deepEqual(readFileSync(firstStill), firstBytes);
    assert.deepEqual(readFileSync(secondStill), secondBytes);

    const manifest = JSON.parse(readFileSync(join(f.runDir, 'media-manifest.json'), 'utf8'));
    assert.equal(manifest.derivatives[0].kind, 'contact-sheet');
    assert.equal(manifest.derivatives[0].sources.length, 2);
    assert.equal(manifest.derivatives[0].settings.input, 'saved-test-stills');
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});

test('image contact sheets reject files outside the artifact root and mixed run sidecars', () => {
  const f = fixture();
  const outside = join(f.projectRoot, 'outside.webp');
  const first = join(f.runDir, 'first.webp');
  const second = join(f.runDir, 'nested', 'second.webp');
  mkdirSync(join(f.runDir, 'nested'));
  const webp = Buffer.from('RIFF0000WEBP sample still');
  writeFileSync(outside, webp);
  writeFileSync(first, webp);
  writeFileSync(second, webp);
  try {
    assert.throws(() => createImageContactSheet({ ...f, images: [{ path: outside, label: 'Outside' }, { path: first, label: 'Inside' }] }), /inside the configured artifact directory/);
    assert.throws(() => createImageContactSheet({ ...f, images: [{ path: first, label: 'One' }, { path: second, label: 'Two' }] }), /same run sidecar/);
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});
