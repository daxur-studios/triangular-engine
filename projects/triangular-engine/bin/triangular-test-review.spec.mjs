import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import {
  addReviewOverlay, addVisualReview, createReviewViewer, listVisualReviews, parseArgs,
} from './triangular-test-review.mjs';

function fixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'tri-review-'));
  const artifactDir = join(projectRoot, 'artifacts', 'test-runs');
  const suiteDir = join(artifactDir, 'capsule@v1');
  const runName = '2026-10-31T10-00-00-000Z_visible-browser_quick_hash';
  const run = join(suiteDir, `${runName}.json`);
  const sidecar = join(suiteDir, runName);
  mkdirSync(sidecar, { recursive: true });
  writeFileSync(run, JSON.stringify({ suite: 'capsule', version: 1, visual: 'pending' }));
  const artifact = join(sidecar, 'walk.contact.svg');
  writeFileSync(artifact, '<svg/>');
  return {
    projectRoot,
    artifactDir,
    suiteDir,
    run,
    sidecar,
    artifact,
    reviewFile: join(suiteDir, `${runName}.reviews.json`),
    config: { outputDir: 'artifacts/test-runs' },
  };
}

test('review options require explicit reviewer provenance, verdict and claim', () => {
  const options = parseArgs([
    'add', '--run', 'run.json', '--artifact', 'frame.webp', '--reviewer-kind', 'agent', '--reviewer', 'codex',
    '--model', 'model-id', '--verdict', 'needs-work', '--claim', 'The cat keeps its paws under the body.', '--notes', 'Tail clips once.',
  ]);
  assert.equal(options.reviewerKind, 'agent');
  assert.equal(options.verdict, 'needs-work');
  assert.equal(options.model, 'model-id');
  assert.throws(() => parseArgs(['add', '--run', 'run.json']), /--artifact is required/);
  assert.throws(() => parseArgs([
    'add', '--run', 'run.json', '--artifact', 'frame.webp', '--reviewer-kind', 'robot', '--reviewer', 'x',
    '--verdict', 'pass', '--claim', 'claim',
  ]), /human or agent/);
  assert.throws(() => parseArgs([
    'add', '--run', 'run.json', '--artifact', 'frame.webp', '--reviewer-kind', 'human', '--reviewer', 'owner',
    '--model', 'model-id', '--verdict', 'pass', '--claim', 'claim',
  ]), /only valid for agent reviews/);
});

test('human and agent reviews append separately from the result and survive media cleanup', () => {
  const f = fixture();
  try {
    const human = addVisualReview({
      projectRoot: f.projectRoot,
      config: f.config,
      run: f.run,
      artifact: f.artifact,
      reviewerKind: 'human',
      reviewer: 'studio-reviewer',
      verdict: 'pass',
      claim: 'The capsule human remains visible through the camera sweep.',
      notes: 'All five views are present.',
      id: () => 'review-human-1',
      now: () => new Date('2026-10-31T10:01:00.000Z'),
    });
    const agent = addVisualReview({
      projectRoot: f.projectRoot,
      config: f.config,
      run: f.run,
      artifact: f.artifact,
      reviewerKind: 'agent',
      reviewer: 'codex',
      model: 'gpt-model-id',
      verdict: 'needs-work',
      claim: 'The cat gait shows a complete stride in the side view.',
      id: () => 'review-agent-1',
    });

    assert.equal(human.file, 'capsule@v1/2026-10-31T10-00-00-000Z_visible-browser_quick_hash.reviews.json');
    assert.equal(human.count, 1);
    assert.equal(agent.count, 2);
    assert.equal(human.review.artifact.kind, 'contact-sheet');
    assert.equal(human.review.artifact.mimeType, 'image/svg+xml');
    assert.equal(human.review.artifact.bytes, Buffer.byteLength('<svg/>'));
    assert.equal(human.review.reviewer.kind, 'human');
    assert.equal(agent.review.reviewer.kind, 'agent');
    assert.equal(agent.review.reviewer.model, 'gpt-model-id');
    assert.equal(agent.review.verdict, 'needs-work');

    const stored = JSON.parse(readFileSync(f.reviewFile, 'utf8'));
    assert.equal(stored.reviews.length, 2);
    assert.equal(stored.run, 'capsule@v1/2026-10-31T10-00-00-000Z_visible-browser_quick_hash.json');
    assert.equal(JSON.parse(readFileSync(f.run, 'utf8')).visual, 'pending');

    rmSync(f.sidecar, { recursive: true, force: true });
    const listed = listVisualReviews({ projectRoot: f.projectRoot, config: f.config, run: f.run });
    assert.equal(listed.reviews.length, 2);
    assert.equal(listed.reviews[0].verdict, 'pass');
    assert.equal(listed.reviews[1].reviewer.kind, 'agent');
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});

test('review command rejects artifacts outside the matching run sidecar', () => {
  const f = fixture();
  const outside = join(f.artifactDir, 'outside.png');
  writeFileSync(outside, 'image');
  try {
    assert.throws(() => addVisualReview({
      projectRoot: f.projectRoot,
      config: f.config,
      run: f.run,
      artifact: outside,
      reviewerKind: 'human',
      reviewer: 'reviewer',
      verdict: 'pass',
      claim: 'A specific visual claim.',
    }), /inside this run's artifact folder/);

    assert.throws(() => listVisualReviews({
      projectRoot: f.projectRoot,
      config: { outputDir: 'missing' },
      run: f.run,
    }), /Test artifact directory does not exist/);
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});

test('overlay options validate frame selection, role, shape and normalized coordinates', () => {
  const options = parseArgs([
    'overlay', '--run', 'run.json', '--review-id', 'review-1', '--frame', '2', '--role', 'target',
    '--shape', 'box', '--coords', '0.1,0.2,0.5,0.6', '--label', 'Head silhouette',
  ]);
  assert.equal(options.action, 'overlay');
  assert.deepEqual(options.coordinates, [0.1, 0.2, 0.5, 0.6]);
  assert.throws(() => parseArgs([
    'overlay', '--run', 'run.json', '--review-id', 'review-1', '--frame', '0', '--role', 'target',
    '--shape', 'box', '--coords', '0.1,0.2,0.5,0.6', '--label', 'Head',
  ]), /frame must be an integer/);
  assert.throws(() => parseArgs([
    'overlay', '--run', 'run.json', '--review-id', 'review-1', '--frame', '1', '--role', 'passed',
    '--shape', 'box', '--coords', '0.8,0.2,0.5,0.6', '--label', 'Head',
  ]), /stay within the frame/);
});

test('overlay records stay separate from source media and render as independently toggleable layers', () => {
  const f = fixture();
  const manifestFile = join(f.sidecar, 'media-manifest.json');
  const artifactFile = relative(f.artifactDir, f.artifact).split(sep).join('/');
  const originalArtifact = readFileSync(f.artifact);
  try {
    const review = addVisualReview({
      projectRoot: f.projectRoot,
      config: f.config,
      run: f.run,
      artifact: f.artifact,
      reviewerKind: 'human',
      reviewer: 'owner',
      verdict: 'pass',
      claim: 'The head stays inside the selected frame.',
      id: () => 'review-overlay-1',
    });
    writeFileSync(manifestFile, JSON.stringify({
      schemaVersion: 1,
      derivatives: [{
        kind: 'contact-sheet',
        source: 'capsule@v1/run/walk.webm',
        sourceBytes: 10,
        file: artifactFile,
        mimeType: 'image/svg+xml',
        bytes: originalArtifact.length,
        generatedAt: '2026-10-31T10:00:00.000Z',
        settings: {
          cellWidth: 320,
          cellHeight: 180,
          columns: 2,
          captures: [{ timeSeconds: 0, label: 'Front' }, { timeSeconds: 1, label: 'Side' }],
        },
      }],
    }, null, 2));

    const target = addReviewOverlay({
      projectRoot: f.projectRoot,
      config: f.config,
      run: f.run,
      reviewId: review.review.id,
      frame: 1,
      role: 'target',
      shape: 'box',
      coordinates: [0.2, 0.1, 0.5, 0.7],
      label: 'Head silhouette',
      id: () => 'overlay-target-1',
    });
    const passed = addReviewOverlay({
      projectRoot: f.projectRoot,
      config: f.config,
      run: f.run,
      reviewId: review.review.id,
      frame: 2,
      role: 'passed',
      shape: 'arrow',
      coordinates: [0.1, 0.9, 0.7, 0.3],
      label: 'Head remains centered',
      id: () => 'overlay-passed-1',
    });
    assert.equal(target.count, 1);
    assert.equal(passed.count, 2);
    assert.equal(passed.overlay.role, 'passed');

    const viewer = createReviewViewer({ projectRoot: f.projectRoot, config: f.config, run: f.run, reviewId: review.review.id });
    const html = readFileSync(viewer.path, 'utf8');
    assert.match(html, /id="target-layer"/);
    assert.match(html, /id="passed-layer"/);
    assert.match(html, /TARGET TO INSPECT · Head silhouette/);
    assert.match(html, /REVIEWED PASS · Head remains centered/);
    assert.match(html, /show-target/);
    assert.match(html, /show-passed/);
    assert.match(html, /Automated test status is separate/);
    assert.match(html, /walk\.contact\.svg/);
    assert.deepEqual(readFileSync(f.artifact), originalArtifact);

    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const viewerEntry = manifest.derivatives.find((item) => item.kind === 'review-viewer');
    assert.ok(viewerEntry);
    assert.equal(viewerEntry.bytes, viewer.bytes);
    assert.equal(viewerEntry.settings.annotationCount, 2);
    const listed = listVisualReviews({ projectRoot: f.projectRoot, config: f.config, run: f.run });
    assert.equal(listed.reviews[0].overlays.length, 2);

    writeFileSync(f.artifact, '<svg changed="yes"/>');
    assert.throws(() => createReviewViewer({ projectRoot: f.projectRoot, config: f.config, run: f.run, reviewId: review.review.id, force: true }), /changed after the review/);
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});

test('passed overlay requires a passed review claim', () => {
  const f = fixture();
  const artifactFile = relative(f.artifactDir, f.artifact).split(sep).join('/');
  try {
    const review = addVisualReview({
      projectRoot: f.projectRoot,
      config: f.config,
      run: f.run,
      artifact: f.artifact,
      reviewerKind: 'agent',
      reviewer: 'agent-id',
      verdict: 'needs-work',
      claim: 'The cat gait is smooth.',
      id: () => 'review-needs-work',
    });
    writeFileSync(join(f.sidecar, 'media-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      derivatives: [{
        kind: 'contact-sheet', source: 'capsule@v1/run/walk.webm', sourceBytes: 10, file: artifactFile,
        mimeType: 'image/svg+xml', bytes: readFileSync(f.artifact).length, generatedAt: '2026-10-31T10:00:00.000Z',
        settings: { cellWidth: 320, cellHeight: 180, columns: 2, captures: [{}, {}] },
      }],
    }));
    assert.throws(() => addReviewOverlay({
      projectRoot: f.projectRoot, config: f.config, run: f.run, reviewId: review.review.id,
      frame: 1, role: 'passed', shape: 'box', coordinates: [0.1, 0.1, 0.5, 0.5], label: 'Foot placement',
    }), /requires a visual review with verdict pass/);
  } finally {
    rmSync(f.projectRoot, { recursive: true, force: true });
  }
});
