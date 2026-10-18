#!/usr/bin/env node
// Dependency-free receiver for triangular-engine/testing results. Dev only; binds to loopback.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SINK_PATH = '/__triangular-test-sink';
export const CONFIG_FILE = 'triangular-test.config.json';
const DEFAULTS = { port: 4223, outputDir: 'artifacts/test-runs', fingerprintPaths: ['projects'], maxBytes: 20 * 1024 * 1024 };

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

/** Writes the run and one index line; returns the stored relative file name. */
export function saveRun(root, config, result) {
  if (!result || typeof result !== 'object' || result.schemaVersion !== 1 || !result.suite?.id || !result.runId) throw new Error('Not a triangular test result');
  const fp = computeFingerprint(root, config.fingerprintPaths);
  const dir = join(root, config.outputDir, `${safe(result.suite.id)}@v${safe(result.suite.version)}`);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(result.startedAt ?? Date.now()).toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}_${safe(result.profile)}_${fp.hash}.json`;
  const stored = { ...result, fingerprint: fp, savedAt: new Date().toISOString() };
  writeFileSync(join(dir, name), JSON.stringify(stored, null, 2));
  const file = `${safe(result.suite.id)}@v${safe(result.suite.version)}/${name}`;
  appendFileSync(join(root, config.outputDir, 'index.jsonl'), JSON.stringify({
    savedAt: stored.savedAt, startedAt: result.startedAt, suite: result.suite.id, version: result.suite.version, profile: result.profile,
    runId: result.runId, fingerprint: fp.hash, head: fp.headShort, automatedVerdict: result.automatedVerdict,
    performanceVerdict: result.performanceVerdict, visualReview: result.visualReview, status: result.status, file,
  }) + '\n');
  return file;
}

export function createReceiver(root, config = loadConfig(root)) {
  return createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!req.url?.startsWith(SINK_PATH)) return send(404, { error: 'not found' });
    if (req.method === 'GET') return send(200, { ok: true });
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    const chunks = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > config.maxBytes) { send(413, { error: 'too large' }); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => {
      if (res.writableEnded) return;
      try { send(200, { ok: true, file: saveRun(root, config, JSON.parse(Buffer.concat(chunks).toString('utf8'))) }); }
      catch (error) { send(400, { error: error instanceof Error ? error.message : String(error) }); }
    });
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
