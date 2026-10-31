#!/usr/bin/env node
// On-demand, metadata-linked derivatives of saved test recordings and stills.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './triangular-test-receiver.mjs';

const MANIFEST_FILE = 'media-manifest.json';
const DEFAULT_FPS = 8;
const DEFAULT_WIDTH = 480;
const DEFAULT_COLORS = 96;
const MANIFEST_LOCK_TIMEOUT_MS = 15_000;
const MANIFEST_LOCK_STALE_MS = 30_000;

const help = `triangular testing media <gif|contact-sheet|list> [options]

Create or list derivatives of saved test recordings and test stills. Source files remain unchanged.

Options:
  --source <path>   Saved recording, relative to the project root or an absolute path
  --capture <sec=label>  Contact-sheet frame time and label; repeat at least twice
  --image <path=label>   Saved test still and label; repeat 2 to 16 times for a high-detail sheet
  --title <text>    Contact-sheet heading (defaults to the recording name)
  --columns <count> Contact-sheet columns (default 3)
  --cell-width <px> Contact-sheet frame width (default 320)
  --suite <id>      Filter listed run metadata by suite id (list)
  --last <count>    Limit list to the newest runs (default 20)
  --fps <number>    Preview frame rate (default ${DEFAULT_FPS})
  --width <pixels>  GIF width; aspect ratio is preserved (default ${DEFAULT_WIDTH})
  --colors <count>  Palette colors, from 16 to 256 (default ${DEFAULT_COLORS})
  --force           Replace an existing derivative
  --json            Print the result and paths as JSON`;

export function buildGifArgs(source, output, { fps = DEFAULT_FPS, width = DEFAULT_WIDTH, colors = DEFAULT_COLORS } = {}) {
  const graph = `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[frames][palette-source];[palette-source]palettegen=max_colors=${colors}:stats_mode=diff[palette];[frames][palette]paletteuse=dither=bayer`;
  return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', source,
    '-filter_complex', graph, '-an', '-loop', '0', output];
}

export function buildContactFrameArgs(source, timeSeconds, { width = 320, height = 180 } = {}) {
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0a0c16`;
  return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', source, '-ss', timeSeconds.toFixed(3),
    '-frames:v', '1', '-vf', filter, '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'];
}

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function wrapLabel(label, limit = 38, maxLines = 2) {
  const words = String(label).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= limit || !line) line = next;
    else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]+$/, '').slice(0, Math.max(1, limit - 1))}…`;
  }
  return lines;
}

export function contactSheetLayout({ captures, columns = 3, cellWidth = 320, cellHeight = 180 }) {
  const gap = 16;
  const margin = 20;
  const headerHeight = 60;
  const labelHeight = 58;
  const rows = Math.ceil(captures.length / columns);
  const cellHeightTotal = cellHeight + labelHeight;
  const width = margin * 2 + columns * cellWidth + (columns - 1) * gap;
  const height = headerHeight + margin + rows * cellHeightTotal + (rows - 1) * gap + margin;
  return { gap, margin, headerHeight, labelHeight, rows, cellHeightTotal, width, height, columns, cellWidth, cellHeight };
}

export function renderContactSheetSvg({ title, captures, columns = 3, cellWidth = 320, cellHeight = 180 }) {
  const layout = contactSheetLayout({ captures, columns, cellWidth, cellHeight });
  const { gap, margin, headerHeight, labelHeight, cellHeightTotal, width, height } = layout;
  const cards = captures.map((capture, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + column * (cellWidth + gap);
    const y = headerHeight + margin + row * (cellHeightTotal + gap);
    const image = capture.jpeg
      ? `data:image/jpeg;base64,${capture.jpeg.toString('base64')}`
      : `data:${capture.mimeType};base64,${capture.bytes.toString('base64')}`;
    const lines = wrapLabel(capture.label);
    const labelText = lines.map((line, lineIndex) =>
      `<tspan x="${x + 12}" dy="${lineIndex === 0 ? 0 : 18}">${xml(line)}</tspan>`).join('');
    const timeBadge = Number.isFinite(capture.timeSeconds)
      ? `<rect x="${x + cellWidth - 60}" y="${y + 7}" width="52" height="20" rx="6" fill="#0a0c16" fill-opacity="0.85"/><text x="${x + cellWidth - 12}" y="${y + 21}" text-anchor="end" fill="#d9e1f2" font-family="Arial, sans-serif" font-size="12">${capture.timeSeconds.toFixed(2)}s</text>`
      : '';
    return `<g><rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeightTotal}" rx="9" fill="#151a27" stroke="#30394c"/><image x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" preserveAspectRatio="xMidYMid meet" href="${image}"/>${timeBadge}<text x="${x + 12}" y="${y + cellHeight + 22}" fill="#edf1fa" font-family="Arial, sans-serif" font-size="14" font-weight="600">${labelText}</text></g>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description"><title id="title">${xml(title)}</title><desc id="description">Contact sheet with ${captures.length} labeled test images.</desc><rect width="100%" height="100%" fill="#0a0c16"/><text x="${margin}" y="38" fill="#f3f5fa" font-family="Arial, sans-serif" font-size="20" font-weight="700">${xml(title)}</text>${cards}\n</svg>\n`;
}

export function parseArgs(args) {
  const options = { fps: DEFAULT_FPS, width: DEFAULT_WIDTH, colors: DEFAULT_COLORS, force: false, json: false, last: 20, captures: [], images: [], columns: 3, cellWidth: 320 };
  let action;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--force') { options.force = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (['gif', 'contact-sheet', 'list'].includes(arg) && !action) { action = arg; continue; }
    if (['--source', '--fps', '--width', '--colors', '--suite', '--last', '--capture', '--image', '--title', '--columns', '--cell-width'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--source') options.source = value;
      else if (arg === '--suite') options.suite = value;
      else if (arg === '--last') options.last = Number(value);
      else if (arg === '--fps') options.fps = Number(value);
      else if (arg === '--width') options.width = Number(value);
      else if (arg === '--colors') options.colors = Number(value);
      else if (arg === '--title') options.title = value;
      else if (arg === '--columns') options.columns = Number(value);
      else if (arg === '--cell-width') options.cellWidth = Number(value);
      else if (arg === '--image') {
        const equals = value.lastIndexOf('=');
        if (equals < 1 || equals === value.length - 1) throw new Error('--image must be <path>=<label>');
        const path = value.slice(0, equals).trim();
        const label = value.slice(equals + 1).trim();
        if (!path || !label) throw new Error('--image needs a path and a label');
        options.images.push({ path, label });
      } else {
        const equals = value.indexOf('=');
        if (equals < 1 || equals === value.length - 1) throw new Error('--capture must be <seconds>=<label>');
        const timeSeconds = Number(value.slice(0, equals));
        const label = value.slice(equals + 1).trim();
        if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || !label) throw new Error('--capture needs a nonnegative time and a label');
        options.captures.push({ timeSeconds, label });
      }
      continue;
    }
    throw new Error(`Unknown option or action: ${arg}`);
  }
  if (!action) throw new Error('Choose a media action: gif, contact-sheet or list');
  if (action === 'gif') {
    if (!options.source) throw new Error('--source is required for gif');
    if (!Number.isInteger(options.fps) || options.fps < 1 || options.fps > 20) throw new Error('--fps must be an integer from 1 to 20');
    if (!Number.isInteger(options.width) || options.width < 96 || options.width > 1920) throw new Error('--width must be an integer from 96 to 1920');
    if (!Number.isInteger(options.colors) || options.colors < 16 || options.colors > 256) throw new Error('--colors must be an integer from 16 to 256');
  } else if (action === 'contact-sheet') {
    if (options.images.length) {
      if (options.source || options.captures.length) throw new Error('Use either --image values or --source with --capture values');
      if (options.images.length < 2 || options.images.length > 16) throw new Error('contact-sheet needs between 2 and 16 --image values');
    } else {
      if (!options.source) throw new Error('--source is required for video contact-sheet');
      if (options.captures.length < 2 || options.captures.length > 16) throw new Error('contact-sheet needs between 2 and 16 --capture values');
    }
    if (!Number.isInteger(options.columns) || options.columns < 1 || options.columns > 4) throw new Error('--columns must be an integer from 1 to 4');
    if (!Number.isInteger(options.cellWidth) || options.cellWidth < 128 || options.cellWidth > 640) throw new Error('--cell-width must be an integer from 128 to 640');
  } else if (!Number.isInteger(options.last) || options.last < 1 || options.last > 1000) throw new Error('--last must be an integer from 1 to 1000');
  if (action === 'contact-sheet' && options.images.length) {
    if (!args.includes('--columns')) options.columns = 2;
    if (!args.includes('--cell-width')) options.cellWidth = 480;
  }
  return { action, ...options };
}

function inside(root, target) {
  const path = relative(root, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function readManifest(file) {
  if (!existsSync(file)) return { schemaVersion: 1, derivatives: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.derivatives)) {
    throw new Error(`Unsupported or invalid media manifest: ${file}`);
  }
  return parsed;
}

function writeManifest(file, manifest) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, file);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* leave the original error */ }
    throw error;
  }
}

function lockManifest(file) {
  const lockFile = `${file}.lock`;
  const started = Date.now();
  while (true) {
    try {
      writeFileSync(lockFile, `${process.pid}\n${new Date().toISOString()}\n`, { flag: 'wx' });
      return () => { try { unlinkSync(lockFile); } catch { /* the lock may already be gone */ } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockFile).mtimeMs > MANIFEST_LOCK_STALE_MS) {
          unlinkSync(lockFile);
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - started >= MANIFEST_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for media manifest lock: ${lockFile}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function recordDerivative(manifestFile, entry) {
  const unlock = lockManifest(manifestFile);
  try {
    const manifest = readManifest(manifestFile);
    manifest.derivatives = manifest.derivatives.filter((item) => item.file !== entry.file);
    manifest.derivatives.push(entry);
    writeManifest(manifestFile, manifest);
  } finally {
    unlock();
  }
}

function relativePosix(root, file) {
  return relative(root, file).split(sep).join('/');
}

export function createGifPreview({ projectRoot, config, source, fps = DEFAULT_FPS, width = DEFAULT_WIDTH, colors = DEFAULT_COLORS, force = false, spawn = spawnSync, now = () => new Date() }) {
  const artifactRootPath = resolve(projectRoot, config.outputDir);
  if (!existsSync(artifactRootPath)) throw new Error(`Test artifact directory does not exist: ${artifactRootPath}`);
  const artifactRoot = realpathSync(artifactRootPath);
  const sourcePath = resolve(projectRoot, source);
  if (!existsSync(sourcePath)) throw new Error(`Recording does not exist: ${sourcePath}`);
  const resolvedSource = realpathSync(sourcePath);
  if (!inside(artifactRoot, resolvedSource)) throw new Error(`Recording must be inside the configured test artifact directory: ${artifactRoot}`);
  if (extname(resolvedSource).toLowerCase() !== '.webm') throw new Error('GIF previews currently require a WebM test recording');

  const sourceStat = statSync(resolvedSource);
  if (!sourceStat.isFile() || sourceStat.size === 0) throw new Error('Recording is empty or is not a regular file');
  const outputPath = join(dirname(resolvedSource), `${basename(resolvedSource, extname(resolvedSource))}.preview.gif`);
  if (existsSync(outputPath) && !force) throw new Error(`GIF preview already exists; pass --force to replace it: ${outputPath}`);
  const manifestPath = join(dirname(resolvedSource), MANIFEST_FILE);
  const temporaryOutput = join(dirname(outputPath), `${basename(outputPath, '.gif')}.${process.pid}.tmp.gif`);

  try {
    const args = buildGifArgs(resolvedSource, temporaryOutput, { fps, width, colors });
    args.splice(args.indexOf('-n'), 1);
    args.splice(args.length - 1, 0, '-f', 'gif');
    const result = spawn('ffmpeg', [...(force ? ['-y'] : []), ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
    if (result.error) throw new Error(`Could not run ffmpeg: ${result.error.message}`);
    if (result.status !== 0) {
      const reason = (result.stderr || result.stdout || `exit code ${result.status}`).trim();
      throw new Error(`ffmpeg could not create the GIF preview: ${reason}`);
    }
    if (!existsSync(temporaryOutput)) throw new Error('ffmpeg reported success but did not create the GIF preview');
    renameSync(temporaryOutput, outputPath);
  } catch (error) {
    try { unlinkSync(temporaryOutput); } catch { /* no temporary output to remove */ }
    throw error;
  }

  const outputStat = statSync(outputPath);
  const entry = {
    kind: 'gif-preview',
    source: relativePosix(artifactRoot, resolvedSource),
    sourceBytes: sourceStat.size,
    file: relativePosix(artifactRoot, outputPath),
    mimeType: 'image/gif',
    bytes: outputStat.size,
    generatedAt: now().toISOString(),
    settings: { fps, width, colors },
  };
  recordDerivative(manifestPath, entry);
  return { ...entry, manifest: relativePosix(artifactRoot, manifestPath), outputPath, sourcePath };
}

/** Create a self-contained, labeled SVG contact sheet from selected source-video frames. */
export function createContactSheet({ projectRoot, config, source, captures, title, columns = 3, cellWidth = 320, force = false, spawn = spawnSync, now = () => new Date() }) {
  const artifactRootPath = resolve(projectRoot, config.outputDir);
  if (!existsSync(artifactRootPath)) throw new Error(`Test artifact directory does not exist: ${artifactRootPath}`);
  const artifactRoot = realpathSync(artifactRootPath);
  const sourcePath = resolve(projectRoot, source);
  if (!existsSync(sourcePath)) throw new Error(`Recording does not exist: ${sourcePath}`);
  const resolvedSource = realpathSync(sourcePath);
  if (!inside(artifactRoot, resolvedSource)) throw new Error(`Recording must be inside the configured test artifact directory: ${artifactRoot}`);
  if (extname(resolvedSource).toLowerCase() !== '.webm') throw new Error('Contact sheets currently require a WebM test recording');
  if (!Array.isArray(captures) || captures.length < 2 || captures.length > 16) throw new Error('Contact sheets need between 2 and 16 labeled captures');
  if (!Number.isInteger(columns) || columns < 1 || columns > 4) throw new Error('Contact-sheet columns must be from 1 to 4');
  if (!Number.isInteger(cellWidth) || cellWidth < 128 || cellWidth > 640) throw new Error('Contact-sheet cell width must be from 128 to 640');

  const sourceStat = statSync(resolvedSource);
  if (!sourceStat.isFile() || sourceStat.size === 0) throw new Error('Recording is empty or is not a regular file');
  const outputPath = join(dirname(resolvedSource), `${basename(resolvedSource, extname(resolvedSource))}.contact.svg`);
  if (existsSync(outputPath) && !force) throw new Error(`Contact sheet already exists; pass --force to replace it: ${outputPath}`);
  const manifestPath = join(dirname(resolvedSource), MANIFEST_FILE);
  const temporaryOutput = join(dirname(outputPath), `${basename(outputPath, '.svg')}.${process.pid}.tmp.svg`);
  const cellHeight = Math.round(cellWidth * 9 / 16 / 2) * 2;
  const titleText = title?.trim() || basename(resolvedSource, extname(resolvedSource));

  try {
    const sampled = captures.map((capture) => {
      if (!Number.isFinite(capture.timeSeconds) || capture.timeSeconds < 0 || !String(capture.label ?? '').trim()) {
        throw new Error('Each contact-sheet capture needs a nonnegative time and a label');
      }
      const result = spawn('ffmpeg', buildContactFrameArgs(resolvedSource, capture.timeSeconds, { width: cellWidth, height: cellHeight }), {
        windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error) throw new Error(`Could not run ffmpeg: ${result.error.message}`);
      if (result.status !== 0) {
        const reason = (result.stderr || result.stdout?.toString?.() || `exit code ${result.status}`).trim();
        throw new Error(`ffmpeg could not sample ${capture.timeSeconds}s: ${reason}`);
      }
      const jpeg = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
      if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
        throw new Error(`ffmpeg did not produce a frame at ${capture.timeSeconds}s`);
      }
      return { timeSeconds: capture.timeSeconds, label: String(capture.label).trim(), jpeg };
    });
    const svg = renderContactSheetSvg({ title: titleText, captures: sampled, columns, cellWidth, cellHeight });
    writeFileSync(temporaryOutput, svg, { flag: 'wx' });
    renameSync(temporaryOutput, outputPath);
  } catch (error) {
    try { unlinkSync(temporaryOutput); } catch { /* no temporary output to remove */ }
    throw error;
  }

  const outputStat = statSync(outputPath);
  const layout = contactSheetLayout({ captures, columns, cellWidth, cellHeight });
  const entry = {
    kind: 'contact-sheet',
    source: relativePosix(artifactRoot, resolvedSource),
    sourceBytes: sourceStat.size,
    file: relativePosix(artifactRoot, outputPath),
    mimeType: 'image/svg+xml',
    bytes: outputStat.size,
    generatedAt: now().toISOString(),
    settings: { cellWidth, cellHeight, columns, sheetWidth: layout.width, sheetHeight: layout.height, captures: captures.map(({ timeSeconds, label }) => ({ timeSeconds, label: String(label).trim() })) },
  };
  recordDerivative(manifestPath, entry);
  return { ...entry, manifest: relativePosix(artifactRoot, manifestPath), outputPath, sourcePath };
}

function detectImageMime(bytes, path) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error(`Unsupported or invalid test still: ${path} (expected JPEG, PNG or WebP)`);
}

/** Build a detailed SVG review sheet from saved case-thumbnail images in one run sidecar. */
export function createImageContactSheet({ projectRoot, config, images, title, columns = 2, cellWidth = 480, force = false, now = () => new Date() }) {
  const artifactRootPath = resolve(projectRoot, config.outputDir);
  if (!existsSync(artifactRootPath)) throw new Error(`Test artifact directory does not exist: ${artifactRootPath}`);
  const artifactRoot = realpathSync(artifactRootPath);
  if (!Array.isArray(images) || images.length < 2 || images.length > 16) throw new Error('Image contact sheets need between 2 and 16 labeled stills');
  if (!Number.isInteger(columns) || columns < 1 || columns > 4) throw new Error('Contact-sheet columns must be from 1 to 4');
  if (!Number.isInteger(cellWidth) || cellWidth < 128 || cellWidth > 640) throw new Error('Contact-sheet cell width must be from 128 to 640');

  const sources = images.map((image) => {
    if (!String(image.label ?? '').trim()) throw new Error('Every test still needs a label');
    const sourcePath = resolve(projectRoot, image.path);
    if (!existsSync(sourcePath)) throw new Error(`Test still does not exist: ${sourcePath}`);
    const resolvedSource = realpathSync(sourcePath);
    if (!inside(artifactRoot, resolvedSource)) throw new Error(`Test still must be inside the configured artifact directory: ${artifactRoot}`);
    const sourceStat = statSync(resolvedSource);
    if (!sourceStat.isFile() || sourceStat.size === 0) throw new Error(`Test still is empty or is not a regular file: ${resolvedSource}`);
    if (sourceStat.size > 8 * 1024 * 1024) throw new Error(`Test still exceeds the 8 MiB contact-sheet input limit: ${resolvedSource}`);
    const bytes = readFileSync(resolvedSource);
    return {
      path: resolvedSource,
      file: relativePosix(artifactRoot, resolvedSource),
      bytes,
      byteLength: sourceStat.size,
      mimeType: detectImageMime(bytes, resolvedSource),
      label: String(image.label).trim(),
    };
  });
  if (sources.reduce((total, source) => total + source.byteLength, 0) > 16 * 1024 * 1024) {
    throw new Error('Combined test stills exceed the 16 MiB contact-sheet input limit');
  }
  const outputDir = dirname(sources[0].path);
  if (sources.some((source) => dirname(source.path) !== outputDir)) {
    throw new Error('All test stills must be in the same run sidecar directory');
  }
  const titleText = title?.trim() || 'Visual evidence';
  const slug = titleText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'visual-evidence';
  const outputPath = join(outputDir, `${slug}.contact.svg`);
  if (existsSync(outputPath) && !force) throw new Error(`Contact sheet already exists; pass --force to replace it: ${outputPath}`);
  const manifestPath = join(outputDir, MANIFEST_FILE);
  const temporaryOutput = join(outputDir, `${slug}.${process.pid}.tmp.svg`);

  try {
    const captures = sources.map((source) => ({ ...source }));
    const cellHeight = Math.round(cellWidth * 9 / 16 / 2) * 2;
    const svg = renderContactSheetSvg({ title: titleText, captures, columns, cellWidth, cellHeight });
    writeFileSync(temporaryOutput, svg, { flag: 'wx' });
    renameSync(temporaryOutput, outputPath);
  } catch (error) {
    try { unlinkSync(temporaryOutput); } catch { /* no temporary output to remove */ }
    throw error;
  }

  const outputStat = statSync(outputPath);
  const captures = sources.map(({ file, byteLength, label }) => ({ file, bytes: byteLength, label }));
  const layout = contactSheetLayout({ captures, columns, cellWidth, cellHeight: Math.round(cellWidth * 9 / 16 / 2) * 2 });
  const entry = {
    kind: 'contact-sheet',
    source: sources[0].file,
    sources: captures,
    sourceBytes: sources.reduce((total, source) => total + source.byteLength, 0),
    file: relativePosix(artifactRoot, outputPath),
    mimeType: 'image/svg+xml',
    bytes: outputStat.size,
    generatedAt: now().toISOString(),
    settings: { input: 'saved-test-stills', cellWidth, cellHeight: Math.round(cellWidth * 9 / 16 / 2) * 2, columns, sheetWidth: layout.width, sheetHeight: layout.height, captures },
  };
  recordDerivative(manifestPath, entry);
  return { ...entry, manifest: relativePosix(artifactRoot, manifestPath), outputPath };
}

/** Read run and media metadata only. Recording and derivative bytes are never opened. */
export function listMedia({ projectRoot, config, suite, last = 20 }) {
  const artifactRootPath = resolve(projectRoot, config.outputDir);
  const indexPath = join(artifactRootPath, 'index.jsonl');
  if (!existsSync(indexPath)) return { runs: [], derivatives: [], totalBytes: 0 };
  const artifactRoot = realpathSync(artifactRootPath);
  const rows = readFileSync(indexPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .filter((row) => !suite || row.suite === suite).slice(-last);
  const runs = [];
  const derivatives = [];
  for (const row of rows) {
    const runPath = resolve(artifactRoot, row.file ?? '');
    if (!inside(artifactRoot, runPath) || !existsSync(runPath) || extname(runPath) !== '.json') continue;
    const resolvedRun = realpathSync(runPath);
    if (!inside(artifactRoot, resolvedRun)) continue;
    const sidecarDir = join(dirname(resolvedRun), basename(resolvedRun, '.json'));
    if (!inside(artifactRoot, sidecarDir)) continue;
    const manifestPath = join(sidecarDir, MANIFEST_FILE);
    if (!existsSync(manifestPath)) continue;
    const resolvedManifest = realpathSync(manifestPath);
    if (!inside(artifactRoot, resolvedManifest)) continue;
    const manifest = readManifest(resolvedManifest);
    runs.push(row.file);
    for (const derivative of manifest.derivatives) derivatives.push({ suite: row.suite, run: row.file, ...derivative });
  }
  return { runs, derivatives, totalBytes: derivatives.reduce((sum, item) => sum + item.bytes, 0) };
}

export function main(args = process.argv.slice(2), { cwd = process.cwd(), spawn = spawnSync } = {}) {
  try {
    const options = parseArgs(args);
    if (options.help) { console.log(help); return 0; }
    const config = loadConfig(cwd);
    if (options.action === 'list') {
      const result = listMedia({ projectRoot: cwd, config, ...options });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else if (!result.derivatives.length) console.log('No media derivatives found.');
      else {
        for (const derivative of result.derivatives) console.log(`${derivative.kind}: ${derivative.file} (${derivative.bytes} bytes) from ${derivative.source}`);
        console.log(`Total derivatives: ${result.derivatives.length}; ${result.totalBytes} bytes`);
      }
      return 0;
    }
    const result = options.action === 'gif'
      ? createGifPreview({ projectRoot: cwd, config, ...options, spawn })
      : options.images.length
        ? createImageContactSheet({ projectRoot: cwd, config, ...options })
        : createContactSheet({ projectRoot: cwd, config, ...options, spawn });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      if (result.kind === 'gif-preview') {
        const ratio = (result.bytes / result.sourceBytes * 100).toFixed(1);
        console.log(`GIF preview: ${result.outputPath}`);
        console.log(`${result.bytes} bytes (${ratio}% of the ${result.sourceBytes}-byte WebM); source unchanged`);
      } else {
        console.log(`Contact sheet: ${result.outputPath}`);
        console.log(`${result.bytes} bytes; ${result.settings.captures.length} labeled images; sources unchanged`);
      }
      console.log(`Metadata: ${join(dirname(result.outputPath), MANIFEST_FILE)}`);
    }
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exitCode = main();
