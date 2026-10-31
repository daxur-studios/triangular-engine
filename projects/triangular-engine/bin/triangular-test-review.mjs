#!/usr/bin/env node
// Append and list human/agent visual reviews for saved browser test evidence.
import { existsSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './triangular-test-receiver.mjs';
import { contactSheetLayout } from './triangular-test-media.mjs';

const REVIEW_SCHEMA_VERSION = 1;
const LOCK_TIMEOUT_MS = 15_000;
const LOCK_STALE_MS = 30_000;
const MAX_CLAIM_LENGTH = 1_000;
const MAX_NOTES_LENGTH = 4_000;
const VERDICTS = new Set(['pass', 'fail', 'needs-work', 'inconclusive']);
const ARTIFACT_TYPES = new Map([
  ['.webm', { kind: 'video-recording', mimeType: 'video/webm' }],
  ['.gif', { kind: 'gif-preview', mimeType: 'image/gif' }],
  ['.svg', { kind: 'contact-sheet', mimeType: 'image/svg+xml' }],
  ['.webp', { kind: 'still-image', mimeType: 'image/webp' }],
  ['.png', { kind: 'still-image', mimeType: 'image/png' }],
  ['.jpg', { kind: 'still-image', mimeType: 'image/jpeg' }],
  ['.jpeg', { kind: 'still-image', mimeType: 'image/jpeg' }],
]);

const help = `triangular testing review <add|list|overlay|view> [options]

Store visual reviewer decisions separately from the automated test result.
The command reads test JSON and file metadata only; it never opens media pixels.

Required for add:
  --run <path>            Saved test result JSON
  --artifact <path>       Evidence file inside that run's artifact folder
  --reviewer-kind <kind>  human or agent
  --reviewer <id>         Reviewer name or stable identifier
  --verdict <value>       pass, fail, needs-work or inconclusive
  --claim <text>          The visual claim being reviewed

Optional:
  --model <id>            Agent model identifier (agent reviews only)
  --notes <text>          Reviewer notes
  --review-id <id>        Existing visual review (overlay/view)
  --frame <number>        One-based contact-sheet frame index (overlay)
  --role <target|passed>  Amber inspection target or green reviewed pass (passed requires verdict pass)
  --shape <box|arrow>     Vector marker type (overlay)
  --coords <a,b,c,d>      Normalized box x,y,w,h or arrow x1,y1,x2,y2 (overlay)
  --label <text>          Short annotation label (overlay)
  --force                 Replace an existing viewer page
  --json                  Print machine-readable output`;

export function parseArgs(args) {
  const options = { json: false, force: false };
  let action;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--force') { options.force = true; continue; }
    if (['add', 'list', 'overlay', 'view'].includes(arg) && !action) { action = arg; continue; }
    if (['--run', '--artifact', '--reviewer-kind', '--reviewer', '--verdict', '--claim', '--notes', '--model', '--review-id', '--frame', '--role', '--shape', '--coords', '--label'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      const key = {
        '--run': 'run', '--artifact': 'artifact', '--reviewer-kind': 'reviewerKind', '--reviewer': 'reviewer',
        '--verdict': 'verdict', '--claim': 'claim', '--notes': 'notes', '--model': 'model',
        '--review-id': 'reviewId', '--frame': 'frame', '--role': 'role', '--shape': 'shape', '--coords': 'coordinates', '--label': 'label',
      }[arg];
      if (arg === '--frame') options[key] = Number(value);
      else if (arg === '--coords') options[key] = value.split(',').map(Number);
      else options[key] = value;
      continue;
    }
    throw new Error(`Unknown option or action: ${arg}`);
  }
  if (!action) throw new Error('Choose a review action: add, list, overlay or view');
  if (!options.run) throw new Error('--run is required');
  if (action === 'add') {
    for (const key of ['artifact', 'reviewerKind', 'reviewer', 'verdict', 'claim']) {
      if (!options[key]?.trim()) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
    }
    if (!['human', 'agent'].includes(options.reviewerKind)) throw new Error('--reviewer-kind must be human or agent');
    if (!VERDICTS.has(options.verdict)) throw new Error('--verdict must be pass, fail, needs-work or inconclusive');
    if (options.reviewerKind === 'human' && options.model) throw new Error('--model is only valid for agent reviews');
    if (options.claim.length > MAX_CLAIM_LENGTH) throw new Error(`--claim must be at most ${MAX_CLAIM_LENGTH} characters`);
    if ((options.notes?.length ?? 0) > MAX_NOTES_LENGTH) throw new Error(`--notes must be at most ${MAX_NOTES_LENGTH} characters`);
  }
  if (action === 'overlay') {
    for (const key of ['reviewId', 'role', 'shape', 'label']) {
      if (!options[key]?.trim()) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
    }
    if (options.frame === undefined) throw new Error('--frame is required');
    if (options.coordinates === undefined) throw new Error('--coords is required');
    if (!Number.isInteger(options.frame) || options.frame < 1 || options.frame > 16) throw new Error('--frame must be an integer from 1 to 16');
    if (!['target', 'passed'].includes(options.role)) throw new Error('--role must be target or passed');
    if (!['box', 'arrow'].includes(options.shape)) throw new Error('--shape must be box or arrow');
    if (options.coordinates.length !== 4 || options.coordinates.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error('--coords needs four normalized values from 0 to 1');
    }
    if (options.shape === 'box' && (options.coordinates[2] <= 0 || options.coordinates[3] <= 0 || options.coordinates[0] + options.coordinates[2] > 1 || options.coordinates[1] + options.coordinates[3] > 1)) {
      throw new Error('box coordinates must have positive size and stay within the frame');
    }
    if (options.shape === 'arrow' && options.coordinates[0] === options.coordinates[2] && options.coordinates[1] === options.coordinates[3]) {
      throw new Error('arrow start and end must be different points');
    }
    if (options.label.trim().length > 120) throw new Error('--label must be at most 120 characters');
  }
  if (action === 'view' && !options.reviewId?.trim()) throw new Error('--review-id is required for view');
  return { action, ...options };
}

function inside(root, target) {
  const path = relative(root, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function relativePosix(root, file) {
  return relative(root, file).split(sep).join('/');
}

function resolveRunTarget(projectRoot, config, runArgument, { requireSidecar = false } = {}) {
  const configuredRoot = resolve(projectRoot, config.outputDir);
  if (!existsSync(configuredRoot)) throw new Error(`Test artifact directory does not exist: ${configuredRoot}`);
  const artifactRoot = realpathSync(configuredRoot);
  const runPath = resolve(projectRoot, runArgument);
  if (!existsSync(runPath)) throw new Error(`Test result does not exist: ${runPath}`);
  const resolvedRun = realpathSync(runPath);
  if (!inside(artifactRoot, resolvedRun) || extname(resolvedRun).toLowerCase() !== '.json') {
    throw new Error(`Test result must be a JSON file inside the configured test artifact directory: ${artifactRoot}`);
  }
  const runStat = statSync(resolvedRun);
  if (!runStat.isFile()) throw new Error('Test result is not a regular file');

  const sidecarPath = join(dirname(resolvedRun), basename(resolvedRun, '.json'));
  let sidecarRoot;
  if (existsSync(sidecarPath)) {
    sidecarRoot = realpathSync(sidecarPath);
    if (!inside(artifactRoot, sidecarRoot)) throw new Error('Test run artifact folder resolves outside the configured test artifact directory');
  } else if (requireSidecar) {
    throw new Error(`Test run artifact folder does not exist: ${sidecarPath}`);
  }

  return {
    artifactRoot,
    runFile: relativePosix(artifactRoot, resolvedRun),
    runStat,
    resolvedRun,
    sidecarRoot,
    reviewFile: join(dirname(resolvedRun), `${basename(resolvedRun, '.json')}.reviews.json`),
  };
}

function resolveReviewTarget(projectRoot, config, runArgument, artifactArgument) {
  const runTarget = resolveRunTarget(projectRoot, config, runArgument, { requireSidecar: true });
  const artifactPath = resolve(projectRoot, artifactArgument);
  if (!existsSync(artifactPath)) throw new Error(`Review artifact does not exist: ${artifactPath}`);
  const resolvedArtifact = realpathSync(artifactPath);
  if (!inside(runTarget.sidecarRoot, resolvedArtifact)) throw new Error(`Review artifact must be inside this run's artifact folder: ${runTarget.sidecarRoot}`);
  const artifactStat = statSync(resolvedArtifact);
  if (!artifactStat.isFile() || artifactStat.size === 0) throw new Error('Review artifact is empty or is not a regular file');
  const media = ARTIFACT_TYPES.get(extname(resolvedArtifact).toLowerCase());
  if (!media) throw new Error('Review artifacts must be WebM, GIF, SVG, WebP, PNG or JPEG files');

  return {
    ...runTarget,
    artifact: {
      file: relativePosix(runTarget.artifactRoot, resolvedArtifact),
      kind: media.kind,
      mimeType: media.mimeType,
      bytes: artifactStat.size,
      modifiedAt: artifactStat.mtime.toISOString(),
    },
  };
}

function readReviews(file, runFile) {
  if (!existsSync(file)) return { schemaVersion: REVIEW_SCHEMA_VERSION, run: runFile, reviews: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed?.schemaVersion !== REVIEW_SCHEMA_VERSION || parsed.run !== runFile || !Array.isArray(parsed.reviews)) {
    throw new Error(`Unsupported or invalid visual review file: ${file}`);
  }
  return parsed;
}

function acquireLock(file) {
  const lockFile = `${file}.lock`;
  const started = Date.now();
  while (true) {
    try {
      writeFileSync(lockFile, `${process.pid}\n${new Date().toISOString()}\n`, { flag: 'wx' });
      return () => { try { unlinkSync(lockFile); } catch { /* lock may already be gone */ } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockFile).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockFile);
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error(`Timed out waiting for review record lock: ${lockFile}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function writeReviews(file, reviews) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(reviews, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, file);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* preserve the write error */ }
    throw error;
  }
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function validateOverlay({ frame, role, shape, coordinates, label }, captureCount) {
  if (!Number.isInteger(frame) || frame < 1 || frame > captureCount) throw new Error(`--frame must be from 1 to ${captureCount} for this contact sheet`);
  if (!['target', 'passed'].includes(role)) throw new Error('--role must be target or passed');
  if (!['box', 'arrow'].includes(shape)) throw new Error('--shape must be box or arrow');
  if (!Array.isArray(coordinates) || coordinates.length !== 4 || coordinates.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('--coords needs four normalized values from 0 to 1');
  }
  if (shape === 'box' && (coordinates[2] <= 0 || coordinates[3] <= 0 || coordinates[0] + coordinates[2] > 1 || coordinates[1] + coordinates[3] > 1)) {
    throw new Error('box coordinates must have positive size and stay within the frame');
  }
  if (shape === 'arrow' && coordinates[0] === coordinates[2] && coordinates[1] === coordinates[3]) throw new Error('arrow start and end must be different points');
  if (!String(label ?? '').trim() || String(label).length > 120) throw new Error('--label must contain 1 to 120 characters');
}

function locateReviewedContactSheet(projectRoot, config, run, reviewId, reviewsFile = undefined) {
  const target = resolveRunTarget(projectRoot, config, run, { requireSidecar: true });
  const stored = reviewsFile ?? readReviews(target.reviewFile, target.runFile);
  const review = stored.reviews.find((item) => item.id === reviewId);
  if (!review) throw new Error(`Visual review not found: ${reviewId}`);
  if (review.artifact?.kind !== 'contact-sheet' || review.artifact?.mimeType !== 'image/svg+xml') {
    throw new Error('Overlay viewer currently requires a reviewed SVG contact sheet');
  }
  const artifactPath = resolve(target.artifactRoot, review.artifact.file);
  if (!existsSync(artifactPath)) throw new Error(`Reviewed contact sheet is no longer available: ${review.artifact.file}`);
  const resolvedArtifact = realpathSync(artifactPath);
  if (!inside(target.sidecarRoot, resolvedArtifact)) throw new Error('Reviewed contact sheet resolves outside this run artifact folder');
  const artifactStat = statSync(resolvedArtifact);
  if (!artifactStat.isFile() || artifactStat.size !== review.artifact.bytes || artifactStat.mtime.toISOString() !== review.artifact.modifiedAt) {
    throw new Error('Reviewed contact sheet changed after the review was recorded; create a new review before adding overlays');
  }
  const manifestFile = join(target.sidecarRoot, 'media-manifest.json');
  if (!existsSync(manifestFile)) throw new Error('Contact-sheet metadata is missing from media-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.derivatives)) throw new Error(`Unsupported media manifest: ${manifestFile}`);
  const derivative = manifest.derivatives.find((item) => item.file === review.artifact.file && item.kind === 'contact-sheet');
  if (!derivative || !Array.isArray(derivative.settings?.captures)) throw new Error('Contact-sheet capture layout is missing from media metadata');
  const settings = derivative.settings;
  if (!Number.isInteger(settings.cellWidth) || settings.cellWidth < 128 || settings.cellWidth > 640 ||
      !Number.isInteger(settings.cellHeight) || settings.cellHeight < 72 || settings.cellHeight > 360 ||
      !Number.isInteger(settings.columns) || settings.columns < 1 || settings.columns > 4 ||
      settings.captures.length < 2 || settings.captures.length > 16) {
    throw new Error('Contact-sheet layout metadata is outside the supported bounds');
  }
  const layout = contactSheetLayout(derivative.settings);
  for (const annotation of review.overlays ?? []) {
    validateOverlay(annotation, derivative.settings.captures.length);
    if (annotation.role === 'passed' && review.verdict !== 'pass') throw new Error('A stored reviewed-pass overlay does not match the review verdict');
  }
  return { target, review, artifactPath: resolvedArtifact, manifestFile, manifest, derivative, layout };
}

export function addReviewOverlay({ projectRoot, config, run, reviewId, frame, role, shape, coordinates, label, now = () => new Date(), id = () => randomUUID() }) {
  const target = resolveRunTarget(projectRoot, config, run, { requireSidecar: true });
  const release = acquireLock(target.reviewFile);
  try {
    const stored = readReviews(target.reviewFile, target.runFile);
    const context = locateReviewedContactSheet(projectRoot, config, run, reviewId, stored);
    validateOverlay({ frame, role, shape, coordinates, label }, context.derivative.settings.captures.length);
    if (role === 'passed' && context.review.verdict !== 'pass') {
      throw new Error('A green passed overlay requires a visual review with verdict pass');
    }
    context.review.overlays ??= [];
    const overlay = {
      id: id(),
      createdAt: now().toISOString(),
      frame,
      role,
      shape,
      coordinates,
      label: label.trim(),
    };
    context.review.overlays.push(overlay);
    writeReviews(target.reviewFile, stored);
    return { reviewId, overlay, count: context.review.overlays.length, file: relativePosix(context.target.artifactRoot, context.target.reviewFile) };
  } finally {
    release();
  }
}

function overlayMarkup(annotations, layout) {
  const colors = { target: '#ffbf52', passed: '#4dd47b' };
  const marker = (annotation) => {
    const column = (annotation.frame - 1) % layout.columns;
    const row = Math.floor((annotation.frame - 1) / layout.columns);
    const frameX = layout.margin + column * (layout.cellWidth + layout.gap);
    const frameY = layout.headerHeight + layout.margin + row * (layout.cellHeightTotal + layout.gap);
    const color = colors[annotation.role];
    const [a, b, c, d] = annotation.coordinates;
    const label = annotation.role === 'target' ? `TARGET TO INSPECT · ${annotation.label}` : `REVIEWED PASS · ${annotation.label}`;
    const title = `${label} (frame ${annotation.frame})`;
    if (annotation.shape === 'box') {
      const x = frameX + a * layout.cellWidth;
      const y = frameY + b * layout.cellHeight;
      const width = c * layout.cellWidth;
      const height = d * layout.cellHeight;
      const tagY = y >= frameY + 22 ? y - 20 : y + 4;
      return `<g class="${annotation.role}-overlay"><title>${escapeXml(title)}</title><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="3" ${annotation.role === 'target' ? 'stroke-dasharray="9 6"' : ''}/><text x="${x + 5}" y="${tagY + 14}" fill="${color}" font-family="Arial, sans-serif" font-size="12" font-weight="700">${escapeXml(label)}</text></g>`;
    }
    const x1 = frameX + a * layout.cellWidth;
    const y1 = frameY + b * layout.cellHeight;
    const x2 = frameX + c * layout.cellWidth;
    const y2 = frameY + d * layout.cellHeight;
    return `<g class="${annotation.role}-overlay"><title>${escapeXml(title)}</title><path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="4" ${annotation.role === 'target' ? 'stroke-dasharray="9 6"' : ''} marker-end="url(#${annotation.role}-arrow)"/><text x="${Math.min(frameX + layout.cellWidth - 6, x2 + 7)}" y="${Math.max(frameY + 18, y2 - 7)}" fill="${color}" font-family="Arial, sans-serif" font-size="12" font-weight="700">${escapeXml(label)}</text></g>`;
  };
  const targets = annotations.filter((annotation) => annotation.role === 'target').map(marker).join('\n');
  const passed = annotations.filter((annotation) => annotation.role === 'passed').map(marker).join('\n');
  return `<svg class="overlay-layer" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="none" aria-label="Toggleable review annotations"><defs><marker id="target-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${colors.target}"/></marker><marker id="passed-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${colors.passed}"/></marker></defs><g id="target-layer">${targets}</g><g id="passed-layer">${passed}</g></svg>`;
}

function buildReviewViewerHtml({ review, artifactUrl, layout }) {
  const annotations = review.overlays ?? [];
  const markup = overlayMarkup(annotations, layout);
  const verdict = review.verdict.toUpperCase();
  const targets = annotations.some((item) => item.role === 'target');
  const passed = annotations.some((item) => item.role === 'passed');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Visual review — ${escapeXml(review.claim)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0a0c16;color:#edf1fa;font:16px/1.5 system-ui,sans-serif}main{max-width:1180px;margin:0 auto;padding:22px}h1{font-size:1.4rem;margin:0 0 8px}.claim{font-size:1.08rem}.meta,.legend{color:#b5bfd1}.verdict{display:inline-block;padding:3px 9px;border-radius:999px;background:#20283a;font-weight:700}.legend span{display:inline-block;margin-right:18px}.target-key{color:#ffbf52}.passed-key{color:#4dd47b}.toggle-target,.toggle-passed{margin:0 5px 0 0}.toggle-passed{margin-left:18px}.stage{position:relative;width:100%;margin-top:6px}.stage img,.overlay-layer{display:block;width:100%;height:auto}.overlay-layer{position:absolute;inset:0;height:100%}.stage svg text{paint-order:stroke;stroke:#0a0c16;stroke-width:3px;stroke-linejoin:round}.toggle-target:not(:checked)~.stage #target-layer{display:none}.toggle-passed:not(:checked)~.stage #passed-layer{display:none}
</style></head><body><main><header><h1>Visual review</h1><p class="claim">${escapeXml(review.claim)}</p><p class="meta"><span class="verdict">${verdict}</span> · ${escapeXml(review.reviewer.kind)} ${escapeXml(review.reviewer.id)}${review.reviewer.model ? ` · ${escapeXml(review.reviewer.model)}` : ''}</p></header>
<p class="legend"><span class="target-key">Amber dashed: target to inspect</span><span class="passed-key">Green: this review's claim has a pass verdict</span> Automated test status is separate.</p>
<input class="toggle-target" id="show-target" type="checkbox" ${targets ? 'checked' : ''}><label for="show-target">Inspection targets</label><input class="toggle-passed" id="show-passed" type="checkbox" ${passed ? 'checked' : ''}><label for="show-passed">Reviewed-pass markers</label>
<section class="stage"><img src="${escapeXml(artifactUrl)}" alt="${escapeXml(review.artifact.file)}">${markup}</section></main></body></html>\n`;
}

function recordViewerInManifest(manifestFile, entry) {
  const release = acquireLock(manifestFile);
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.derivatives)) throw new Error(`Unsupported media manifest: ${manifestFile}`);
    manifest.derivatives = manifest.derivatives.filter((item) => item.file !== entry.file);
    manifest.derivatives.push(entry);
    writeReviews(manifestFile, manifest);
  } finally {
    release();
  }
}

export function createReviewViewer({ projectRoot, config, run, reviewId, force = false, now = () => new Date() }) {
  const context = locateReviewedContactSheet(projectRoot, config, run, reviewId);
  const viewerPath = join(context.target.sidecarRoot, `${reviewId.replace(/[^a-zA-Z0-9_-]/g, '_')}.review.html`);
  if (existsSync(viewerPath) && !force) throw new Error(`Review viewer already exists; pass --force to replace it: ${viewerPath}`);
  const relativeImage = relative(dirname(viewerPath), context.artifactPath).split(sep).map(encodeURIComponent).join('/');
  const html = buildReviewViewerHtml({ review: context.review, artifactUrl: relativeImage, layout: context.layout });
  const temporary = `${viewerPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, html, { flag: 'wx' });
    renameSync(temporary, viewerPath);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* preserve the write error */ }
    throw error;
  }
  const outputStat = statSync(viewerPath);
  const entry = {
    kind: 'review-viewer',
    source: context.review.artifact.file,
    sourceBytes: context.review.artifact.bytes,
    file: relativePosix(context.target.artifactRoot, viewerPath),
    mimeType: 'text/html',
    bytes: outputStat.size,
    generatedAt: now().toISOString(),
    settings: { reviewId, annotationCount: context.review.overlays?.length ?? 0 },
  };
  recordViewerInManifest(context.manifestFile, entry);
  return { reviewId, file: entry.file, mimeType: entry.mimeType, bytes: entry.bytes, path: viewerPath };
}

export function addVisualReview({ projectRoot, config, run, artifact, reviewerKind, reviewer, model, verdict, claim, notes, now = () => new Date(), id = () => randomUUID() }) {
  const target = resolveReviewTarget(projectRoot, config, run, artifact);
  const release = acquireLock(target.reviewFile);
  try {
    const reviewFile = readReviews(target.reviewFile, target.runFile);
    const review = {
      id: id(),
      createdAt: now().toISOString(),
      reviewer: { kind: reviewerKind, id: reviewer, ...(model ? { model } : {}) },
      verdict,
      claim: claim.trim(),
      artifact: target.artifact,
      overlays: [],
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
    };
    reviewFile.reviews.push(review);
    writeReviews(target.reviewFile, reviewFile);
    return { review, file: relativePosix(target.artifactRoot, target.reviewFile), count: reviewFile.reviews.length };
  } finally {
    release();
  }
}

/** List review metadata without opening any referenced media files. */
export function listVisualReviews({ projectRoot, config, run }) {
  const target = resolveRunTarget(projectRoot, config, run);
  const reviewsFile = readReviews(target.reviewFile, target.runFile);
  return {
    run: target.runFile,
    file: relativePosix(target.artifactRoot, target.reviewFile),
    reviews: reviewsFile.reviews,
  };
}

export function main(args = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  try {
    const options = parseArgs(args);
    if (options.help) { console.log(help); return 0; }
    const config = loadConfig(cwd);
    if (options.action === 'add') {
      const result = addVisualReview({ projectRoot: cwd, config, ...options });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Visual review ${result.review.id} recorded (${result.count} reviews for ${result.review.artifact.file}).`);
      return 0;
    }
    if (options.action === 'overlay') {
      const result = addReviewOverlay({ projectRoot: cwd, config, ...options });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Overlay ${result.overlay.id} added to review ${result.reviewId} (${result.count} overlays).`);
      return 0;
    }
    if (options.action === 'view') {
      const result = createReviewViewer({ projectRoot: cwd, config, ...options });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Review viewer: ${result.path} (${result.bytes} bytes)`);
      return 0;
    }
    const result = listVisualReviews({ projectRoot: cwd, config, ...options });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (!result.reviews.length) console.log(`No visual reviews recorded for ${result.run}.`);
    else for (const review of result.reviews) {
      console.log(`${review.verdict}: ${review.claim} — ${review.reviewer.kind} ${review.reviewer.id} (${review.artifact.file})`);
    }
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exitCode = main();
