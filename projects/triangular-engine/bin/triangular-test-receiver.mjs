#!/usr/bin/env node
// Dependency-free receiver for triangular-engine/testing results. Dev only; binds to loopback.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachMachine, createMachineMonitor, systemSampler } from './triangular-test-machine.mjs';

export const SINK_PATH = '/__triangular-test-sink';
/** Timing messages from the page: `POST {SINK_PATH}/machine/{prepare,start,stop}`. */
export const MACHINE_PATH = `${SINK_PATH}/machine`;
export const CONFIG_FILE = 'triangular-test.config.json';
/** One thumbnail is a helper picture; a run's thumbnails together stay small too. Over either, the image is dropped and said so. */
export const MAX_IMAGE_BYTES = 64 * 1024;
export const MAX_RUN_IMAGE_BYTES = 2 * 1024 * 1024;
const DEFAULTS = {
  port: 4223, outputDir: 'artifacts/test-runs', fingerprintPaths: ['projects'], maxBytes: 20 * 1024 * 1024, machineSampling: true, gpuIndex: 0,
  maxImageBytes: MAX_IMAGE_BYTES, maxRunImageBytes: MAX_RUN_IMAGE_BYTES,
};

export function loadConfig(root) {
  const file = join(root, CONFIG_FILE);
  const user = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return { ...DEFAULTS, ...user };
}

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}

/** HEAD plus a hash of the working-tree diff (and untracked file contents) over the configured paths. Deliberately coarse. */
export function computeFingerprint(root, paths) {
  const head = git(root, ['rev-parse', 'HEAD'])?.trim() ?? 'no-git';
  const hash = createHash('sha256');
  hash.update(git(root, ['diff', 'HEAD', '--', ...paths]) ?? '');
  const untracked = (git(root, ['ls-files', '--others', '--exclude-standard', '--', ...paths]) ?? '').split('\n').filter(Boolean).sort();
  for (const name of untracked) {
    hash.update(name);
    try { hash.update(readFileSync(join(root, name))); } catch { /* unreadable file ignored */ }
  }
  const diffHash = hash.digest('hex').slice(0, 8);
  return { head, headShort: head.slice(0, 8), diffHash, hash: `${head.slice(0, 8)}-${diffHash}`, paths };
}

const safe = (text) => String(text).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

/** Stored samples keep 3 decimals (1 µs for ms metrics): browser timers are coarser, and full doubles double the file. */
export const round = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n);
const roundSamples = (key, value) =>
  key === 'samples' && Array.isArray(value) ? value.map(round)
    : key === 'summary' && value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)]))
      : value;
/**
 * Pretty JSON, but numeric arrays on one line instead of one sample per line. Matching requires literal newlines,
 * which JSON strings never contain, so string contents are never rewritten.
 */
export const storedJson = (value) => JSON.stringify(value, roundSamples, 2)
  .replace(/\[\n\s*((?:-?[\d.e+-]+|null)(?:,\n\s*(?:-?[\d.e+-]+|null))*)\n\s*\]/g, (_, list) => `[${list.split(/,\n\s*/).join(',')}]`);

/** Nearest-rank percentile on an ascending array, as `TestSession` and `FrameSampler` use. */
export const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];

/**
 * Per scenario, across repetitions: `{ metrics: { 'name (unit)': { n, min, med, p95, max } }, failed: [check names] }`.
 * Written to each index line so a summary never has to open the full result.
 */
export function caseSummaries(run) {
  const out = {};
  for (const c of run.cases ?? []) {
    const entry = out[c.scenario.id] ??= { metrics: {}, failed: [], invalid: [], samples: {} };
    for (const issue of c.validityIssues ?? []) if (!entry.invalid.includes(issue)) entry.invalid.push(issue);
    if (c.window) entry.window = { stoppedBy: c.window.stoppedBy, s: round(c.window.elapsedMs / 1000), ...(c.window.drift ? { drift: c.window.drift } : {}) };
    if (c.retries) entry.retries = (entry.retries ?? 0) + c.retries;
    if (c.thumbnails?.length) (entry.thumbnails ??= []).push(...c.thumbnails);
    for (const m of c.metrics ?? []) {
      if (!m.samples?.length) continue;
      (entry.samples[`${m.name} (${m.unit})`] ??= []).push(...m.samples.filter(Number.isFinite));
    }
    for (const k of c.checks ?? []) if (!k.passed) entry.failed.push(`${k.name}${k.detail ? ` — ${k.detail}` : ''}`);
    if (c.error) entry.failed.push(`error: ${c.error}`);
  }
  for (const entry of Object.values(out)) {
    for (const [name, list] of Object.entries(entry.samples)) {
      if (!list.length) continue;
      const x = list.sort((a, b) => a - b);
      entry.metrics[name] = { n: x.length, min: round(x[0]), med: round(percentile(x, 0.5)), p95: round(percentile(x, 0.95)), max: round(x.at(-1)) };
    }
    delete entry.samples;
  }
  return out;
}

/** One compact entry per A/B outcome for the index line. */
export function ablationSummaries(run) {
  return (run.ablations ?? []).map((o) => ({
    group: o.group, feature: o.feature, metric: o.metric, statistic: o.result.statistic, verdict: o.result.verdict,
    a: round(o.result.a.value), b: round(o.result.b.value), relative: round(o.result.relative), noise: round(o.result.noiseBand),
    reasons: o.result.reasons, invalidRounds: o.invalidRounds,
  }));
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** What a stored thumbnail may be: its extension and a check of the file's own signature (the browser's claim is not trusted). */
const IMAGE_TYPES = {
  'image/webp': { ext: 'webp', is: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  'image/png': { ext: 'png', is: (b) => b.length > 8 && b.subarray(0, 8).equals(PNG_SIGNATURE) },
  'image/jpeg': { ext: 'jpg', is: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};
const CONTENT_TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', json: 'application/json' };

/**
 * Decodes the `thumbnailUploads` of a result and writes them to `<dir>/<stem>/<case>-r<rep>-<i>.<ext>`. Returns the
 * stored names (relative to the output folder, `prefix` being the run's folder name) by case, and one message per
 * dropped image (too big, past the run's budget, not an image, or not matching a case).
 */
export function storeThumbnails(config, dir, prefix, stem, result, uploads) {
  const byCase = new Map();
  const dropped = [];
  if (!Array.isArray(uploads)) return { byCase, dropped };
  let total = 0;
  for (const upload of uploads) {
    const label = `${upload?.case}${Number.isInteger(upload?.repetition) && result.repetitions > 1 ? ` #${upload.repetition}` : ''}`;
    const drop = (reason) => { dropped.push({ key: `${upload?.case}#${upload?.repetition}`, text: `${label}: thumbnail dropped, ${reason}` }); };
    const type = IMAGE_TYPES[upload?.type];
    const owner = (result.cases ?? []).some((c) => c.scenario?.id === upload?.case && c.repetition === upload?.repetition);
    if (!type || typeof upload?.data !== 'string' || !owner || !Number.isInteger(upload.index) || upload.index < 0 || upload.index > 9) { drop('not a thumbnail of this run'); continue; }
    if (upload.data.length * 0.75 > config.maxImageBytes + 4) { drop(`over ${Math.round(config.maxImageBytes / 1024)} KB`); continue; }
    const bytes = Buffer.from(upload.data, 'base64');
    if (!type.is(bytes)) drop('not a valid image');
    else if (bytes.length > config.maxImageBytes) drop(`${Math.round(bytes.length / 1024)} KB is over ${Math.round(config.maxImageBytes / 1024)} KB`);
    else if (total + bytes.length > config.maxRunImageBytes) drop(`the run's ${(config.maxRunImageBytes / 1024 / 1024).toFixed(0)} MB of thumbnails is used up`);
    else {
      const name = `${safe(upload.case)}-r${upload.repetition}-${upload.index}.${type.ext}`;
      mkdirSync(join(dir, stem), { recursive: true });
      writeFileSync(join(dir, stem, name), bytes);
      total += bytes.length;
      const key = `${upload.case}#${upload.repetition}`;
      byCase.set(key, [...(byCase.get(key) ?? []), `${prefix}/${stem}/${name}`]);
    }
  }
  return { byCase, dropped };
}

/**
 * Writes the run, its thumbnails and one index line. `machine` (from the monitor) adds a `machine` block per case and
 * the preflight to the file, and a tiny summary to the index line. `thumbnailUploads` (base64 images) never reach the
 * stored JSON: each case keeps `thumbnails`, names relative to the output folder.
 * Returns `{ file, thumbnails, dropped }`; `dropped` says why an image was not kept.
 */
export function saveRunWithImages(root, config, input, machine) {
  if (!input || typeof input !== 'object' || input.schemaVersion !== 1 || !input.suite?.id || !input.runId) throw new Error('Not a triangular test result');
  const { thumbnailUploads, ...result } = input;
  const fp = computeFingerprint(root, config.fingerprintPaths);
  const prefix = `${safe(result.suite.id)}@v${safe(result.suite.version)}`;
  const dir = join(root, config.outputDir, prefix);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(result.startedAt ?? Date.now()).toISOString().replace(/[:.]/g, '-');
  const mode = result.mode && result.mode !== 'standard' ? `_${safe(result.mode)}` : '';
  const stem = `${stamp}_${safe(result.profile)}${mode}_${fp.hash}`;
  const name = `${stem}.json`;
  const images = storeThumbnails(config, dir, prefix, stem, result, thumbnailUploads);
  const withImages = images.byCase.size || images.dropped.length ? {
    ...result,
    cases: (result.cases ?? []).map((c) => {
      const key = `${c.scenario?.id}#${c.repetition}`;
      const files = images.byCase.get(key);
      const notes = images.dropped.filter((d) => d.key === key).map((d) => d.text);
      return files || notes.length ? { ...c, ...(files ? { thumbnails: files } : {}), ...(notes.length ? { limitations: [...(c.limitations ?? []), ...notes] } : {}) } : c;
    }),
  } : result;
  const attached = attachMachine(withImages, machine);
  const stored = { ...attached.result, fingerprint: fp, savedAt: new Date().toISOString() };
  writeFileSync(join(dir, name), storedJson(stored));
  const file = `${prefix}/${name}`;
  appendFileSync(join(root, config.outputDir, 'index.jsonl'), JSON.stringify({
    savedAt: stored.savedAt, startedAt: result.startedAt, suite: result.suite.id, version: result.suite.version, profile: result.profile,
    mode: result.mode ?? 'standard', repetitions: result.repetitions,
    runId: result.runId, fingerprint: fp.hash, head: fp.headShort, automatedVerdict: result.automatedVerdict,
    performanceVerdict: result.performanceVerdict, visualReview: result.visualReview, status: result.status, file,
    errors: result.errors ?? [], cases: caseSummaries(withImages), ...(result.ablations ? { ablations: ablationSummaries(result) } : {}),
    gpu: result.environment?.['gpu.vendor'], gpuBackend: result.environment?.['gpu.backend'], machine: attached.index,
  }) + '\n');
  return { file, thumbnails: [...images.byCase.values()].flat(), dropped: images.dropped.map((d) => d.text) };
}

/** Writes the run and one index line; returns the stored relative file name. See {@link saveRunWithImages}. */
export const saveRun = (root, config, result, machine) => saveRunWithImages(root, config, result, machine).file;

const SEGMENT = /^[A-Za-z0-9@][A-Za-z0-9@._-]{0,120}$/;

/**
 * Maps a client-supplied name (`suite@v1/run.json`, `suite@v1/run/case-r1-0.webp`) to a file under the output folder,
 * or `undefined`. Every segment must match the alphabet the receiver itself writes (no dot first, no separators, no
 * drive letters), the extension must be one of `extensions`, and the real path must stay inside the folder.
 */
export function resolveStored(root, config, file, extensions) {
  if (typeof file !== 'string' || file.length > 400) return undefined;
  const parts = file.split('/');
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => SEGMENT.test(part))) return undefined;
  const ext = parts.at(-1).split('.').at(-1).toLowerCase();
  if (!extensions.includes(ext)) return undefined;
  const base = resolve(root, config.outputDir);
  const full = resolve(base, ...parts);
  if (!full.startsWith(base + sep)) return undefined;
  try {
    const real = realpathSync(full);
    return real.startsWith(realpathSync(base) + sep) ? real : undefined;
  } catch { return undefined; }
}

/** Loopback origins (the dev page on another port) may read results; any other website may not. */
function loopbackOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    return (protocol === 'http:' || protocol === 'https:') && (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]');
  } catch { return false; }
}

/** Reads a small JSON body; resolves `undefined` after answering 413/400 itself. */
function readBody(req, send, limit) {
  return new Promise((resolve) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > limit) { send(413, { error: 'too large' }); req.destroy(); resolve(undefined); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(undefined));
  });
}

/** Longest `/machine/prepare` waits for the preflight; a hung probe must not block the page. Keep below the page's own wait. */
export const PREPARE_WAIT_MS = 8000;

/**
 * `monitor` is injectable (specs pass a fake sampler). `start`/`stop` answer at once and sample in the background; they
 * never block a run, and a message for an unknown case is ignored. `prepare` answers once the preflight has settled (or
 * after `prepareWaitMs`), so the page can hold its first case until the machine is measured idle.
 */
export function createReceiver(root, config = loadConfig(root), {
  monitor = config.machineSampling ? createMachineMonitor({ sampler: systemSampler({ gpuIndex: config.gpuIndex }) }) : undefined,
  prepareWaitMs = PREPARE_WAIT_MS,
} = {}) {
  /** GET `runs` (the index, newest `limit`), `run?file=` (one result) and `image?file=` (one thumbnail). Read only. */
  const readRoute = (req, res, route) => {
    const origin = req.headers.origin;
    const cors = origin && loopbackOrigin(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : { vary: 'Origin' };
    const reply = (code, type, body, extra = {}) => { if (!res.writableEnded) { res.writeHead(code, { 'content-type': type, ...cors, ...extra }); res.end(body); } };
    const fail = (code, error) => reply(code, 'application/json', JSON.stringify({ error }));
    if (req.method !== 'GET') return fail(405, 'GET only');
    if (origin && !loopbackOrigin(origin)) return fail(403, 'loopback origins only');
    const query = new URL(req.url ?? '', 'http://127.0.0.1').searchParams;
    try {
      if (route === 'runs') {
        const indexFile = join(root, config.outputDir, 'index.jsonl');
        const limit = Math.max(1, Math.min(5000, Number(query.get('limit')) || 300));
        const runs = (existsSync(indexFile) ? readFileSync(indexFile, 'utf8').split('\n') : []).filter(Boolean).flatMap((line) => {
          try { return [JSON.parse(line)]; } catch { return []; }
        });
        return reply(200, 'application/json', JSON.stringify({ runs: runs.slice(-limit), total: runs.length }));
      }
      const file = resolveStored(root, config, query.get('file'), route === 'run' ? ['json'] : Object.values(IMAGE_TYPES).map((type) => type.ext));
      if (!file) return fail(400, 'not a stored result');
      const ext = file.split('.').at(-1).toLowerCase();
      // Stored names carry the run's timestamp and fingerprint, so a name never changes meaning.
      return reply(200, CONTENT_TYPES[ext], readFileSync(file), { 'cache-control': 'private, max-age=3600' });
    } catch { return fail(404, 'not found'); }
  };
  return createServer(async (req, res) => {
    const send = (code, body) => { if (!res.writableEnded) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); } };
    const path = req.url?.split('?')[0] ?? '';
    if (path.startsWith(`${MACHINE_PATH}/`)) {
      if (req.method !== 'POST') return send(405, { error: 'POST only' });
      const action = path.slice(MACHINE_PATH.length + 1);
      if (!['prepare', 'start', 'stop'].includes(action)) return send(404, { error: 'not found' });
      const text = await readBody(req, send, 64 * 1024);
      if (text === undefined) return;
      try {
        const m = JSON.parse(text);
        if (typeof m?.runId !== 'string' || (action !== 'prepare' && (typeof m.scenarioId !== 'string' || !Number.isInteger(m.repetition)))) throw new Error('runId, scenarioId and repetition required');
        if (monitor && action === 'prepare') {
          let timer;
          const timedOut = new Promise((resolveWait) => { timer = setTimeout(resolveWait, prepareWaitMs, 'pending'); });
          const outcome = await Promise.race([Promise.resolve(monitor.prepare(m.runId)).then(() => 'done', () => 'done'), timedOut]);
          clearTimeout(timer);
          return send(200, outcome === 'pending' ? { ok: true, sampling: true, preflight: 'pending' } : { ok: true, sampling: true, preflight: 'done' });
        }
        if (monitor) void monitor[action](m);
        return send(200, { ok: true, sampling: Boolean(monitor) });
      } catch (error) { return send(400, { error: error instanceof Error ? error.message : String(error) }); }
    }
    if (path.startsWith(`${SINK_PATH}/`) && ['runs', 'run', 'image'].includes(path.slice(SINK_PATH.length + 1))) return readRoute(req, res, path.slice(SINK_PATH.length + 1));
    if (path !== SINK_PATH && path !== `${SINK_PATH}/`) return send(404, { error: 'not found' });
    if (req.method === 'GET') return send(200, { ok: true });
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    const text = await readBody(req, send, config.maxBytes);
    if (text === undefined) return;
    try {
      const result = JSON.parse(text);
      const machine = monitor && typeof result?.runId === 'string' ? await monitor.finish(result.runId) : undefined;
      send(200, { ok: true, ...saveRunWithImages(root, config, result, machine) });
    } catch (error) { send(400, { error: error instanceof Error ? error.message : String(error) }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const root = process.cwd();
  const config = loadConfig(root);
  const port = Number(process.env.TRIANGULAR_TEST_PORT ?? config.port);
  const server = createReceiver(root, config);
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') { console.log(`[triangular-test] port ${port} already served; reusing the running receiver`); process.exit(0); }
    throw error;
  });
  server.listen(port, '127.0.0.1', () => console.log(`[triangular-test] receiver on 127.0.0.1:${port} -> ${join(root, config.outputDir)}`));
}
