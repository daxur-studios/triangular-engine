#!/usr/bin/env node
// Dependency-free receiver for triangular-engine/testing results. Dev only; binds to loopback.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachMachine, createMachineMonitor, systemSampler } from './triangular-test-machine.mjs';

export const SINK_PATH = '/__triangular-test-sink';
/** Timing messages from the page: `POST {SINK_PATH}/machine/{prepare,start,stop}`. */
export const MACHINE_PATH = `${SINK_PATH}/machine`;
export const CONFIG_FILE = 'triangular-test.config.json';
const DEFAULTS = { port: 4223, outputDir: 'artifacts/test-runs', fingerprintPaths: ['projects'], maxBytes: 20 * 1024 * 1024, machineSampling: true, gpuIndex: 0 };

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

/**
 * Writes the run and one index line; returns the stored relative file name. `machine` (from the monitor) adds a
 * `machine` block per case and the preflight to the file, and a tiny summary to the index line.
 */
export function saveRun(root, config, result, machine) {
  if (!result || typeof result !== 'object' || result.schemaVersion !== 1 || !result.suite?.id || !result.runId) throw new Error('Not a triangular test result');
  const fp = computeFingerprint(root, config.fingerprintPaths);
  const dir = join(root, config.outputDir, `${safe(result.suite.id)}@v${safe(result.suite.version)}`);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(result.startedAt ?? Date.now()).toISOString().replace(/[:.]/g, '-');
  const mode = result.mode && result.mode !== 'standard' ? `_${safe(result.mode)}` : '';
  const name = `${stamp}_${safe(result.profile)}${mode}_${fp.hash}.json`;
  const attached = attachMachine(result, machine);
  const stored = { ...attached.result, fingerprint: fp, savedAt: new Date().toISOString() };
  writeFileSync(join(dir, name), storedJson(stored));
  const file = `${safe(result.suite.id)}@v${safe(result.suite.version)}/${name}`;
  appendFileSync(join(root, config.outputDir, 'index.jsonl'), JSON.stringify({
    savedAt: stored.savedAt, startedAt: result.startedAt, suite: result.suite.id, version: result.suite.version, profile: result.profile,
    mode: result.mode ?? 'standard',
    runId: result.runId, fingerprint: fp.hash, head: fp.headShort, automatedVerdict: result.automatedVerdict,
    performanceVerdict: result.performanceVerdict, visualReview: result.visualReview, status: result.status, file,
    errors: result.errors ?? [], cases: caseSummaries(result), ...(result.ablations ? { ablations: ablationSummaries(result) } : {}),
    gpu: result.environment?.['gpu.vendor'], gpuBackend: result.environment?.['gpu.backend'], machine: attached.index,
  }) + '\n');
  return file;
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
    if (path !== SINK_PATH && path !== `${SINK_PATH}/`) return send(404, { error: 'not found' });
    if (req.method === 'GET') return send(200, { ok: true });
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    const text = await readBody(req, send, config.maxBytes);
    if (text === undefined) return;
    try {
      const result = JSON.parse(text);
      const machine = monitor && typeof result?.runId === 'string' ? await monitor.finish(result.runId) : undefined;
      send(200, { ok: true, file: saveRun(root, config, result, machine) });
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
