import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { computeFingerprint, createReceiver, loadConfig, SINK_PATH } from './triangular-test-receiver.mjs';
import { summarize } from './triangular-test-summary.mjs';

const run = (id, startedAt, fail = false) => ({
  schemaVersion: 1, runId: id, suite: { id: 'demo', version: 2 }, profile: 'visible-browser', startedAt, status: 'completed',
  automatedVerdict: fail ? 'fail' : 'pass', performanceVerdict: 'unassessed', visualReview: 'pending',
  cases: [{ scenario: { id: 's1', label: 'S1' }, repetition: 1, status: 'completed', checks: [{ name: 'bounded', passed: !fail, detail: 'x' }],
    metrics: [{ name: 'cpu', unit: 'ms', source: 't', samples: [1, 2, 3, 4, 10] }] }], errors: [],
});

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'tri-sink-'));
  const g = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  g('init'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 'n');
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/a.txt'), 'one');
  g('add', '.'); g('commit', '-m', 'init');
  writeFileSync(join(root, 'triangular-test.config.json'), JSON.stringify({ fingerprintPaths: ['src'] }));
  return root;
}

test('fingerprint changes with edits under configured paths only', () => {
  const root = repo();
  const a = computeFingerprint(root, ['src']).hash;
  writeFileSync(join(root, 'other.txt'), 'x');
  assert.equal(computeFingerprint(root, ['src']).hash, a);
  writeFileSync(join(root, 'src/a.txt'), 'two');
  assert.notEqual(computeFingerprint(root, ['src']).hash, a);
});

test('receiver stores runs, accumulates, and rejects junk; summary flags stale', async () => {
  const root = repo();
  const server = createReceiver(root, loadConfig(root));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}${SINK_PATH}`;
  const post = (body) => fetch(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
  assert.equal((await post(run('r1', '2026-10-18T10:00:00Z'))).status, 200);
  assert.equal((await post(run('r2', '2026-10-18T11:00:00Z', true))).status, 200);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post({ schemaVersion: 2 })).status, 400);
  server.close();
  const rows = readFileSync(join(root, 'artifacts/test-runs/index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.match(rows[0].file, /^demo@v2\/.+_visible-browser_[0-9a-f]{8}-[0-9a-f]{8}\.json$/);
  const read = (f) => JSON.parse(readFileSync(join(root, 'artifacts/test-runs', f), 'utf8'));
  assert.equal(read(rows[0].file).fingerprint.hash, rows[0].fingerprint);
  const text = summarize(rows, read, rows[0].fingerprint);
  assert.match(text, /current/);
  assert.match(text, /med 3\.00 p95 10\.00 max 10\.00/);
  assert.match(text, /FAIL bounded — x/);
  assert.match(summarize(rows, read, 'different-hash'), /STALE/);
});
