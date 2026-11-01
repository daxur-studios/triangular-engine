import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { knownSuites, selectRuns, summaryJson, unknownSuiteMessage } from './triangular-test-summary.mjs';

const SUMMARY = resolve(fileURLToPath(new URL('./triangular-test-summary.mjs', import.meta.url)));

/** Index line as the receiver writes it, with case data so no result file is needed. */
const row = (suite, startedAt, fingerprint = 'aaaa') => ({
  savedAt: `${startedAt}Z`, startedAt: `${startedAt}Z`, suite, version: 1, profile: 'visible-browser', mode: 'standard',
  repetitions: 1, runId: `${suite}-${startedAt}`, fingerprint, head: 'abc', automatedVerdict: 'pass',
  performanceVerdict: 'unassessed', visualReview: 'pending', status: 'completed',
  file: `${suite}@v1/${startedAt}.json`, errors: [], performanceNotes: [],
  cases: { s1: { metrics: { 'cpu (ms)': { n: 2, min: 1, med: 2, p95: 3, max: 3 }, 'draws (count)': { n: 1, min: 4, med: 4, p95: 4, max: 4 } }, failed: [], invalid: [] } },
});

const rows = [
  row('alpha', '2026-10-18T10:00:00'),
  row('alpha', '2026-10-18T11:00:00'),
  row('alpha', '2026-10-18T12:00:00', 'bbbb'),
  row('beta', '2026-10-18T09:00:00'),
];

test('selectRuns keeps the last N runs per suite and returns all of them when fewer exist', () => {
  const two = selectRuns(rows, { suite: 'alpha', last: 2 });
  assert.deepEqual(two.map((g) => g.key), ['alpha@v1']);
  assert.deepEqual(two[0].rows.map((r) => r.startedAt), ['2026-10-18T11:00:00Z', '2026-10-18T12:00:00Z']);
  assert.equal(selectRuns(rows, { suite: 'beta', last: 9 })[0].rows.length, 1);
  assert.equal(selectRuns(rows).length, 2);
});

test('summaryJson returns one object per selected run with verdicts, cases, and staleness', () => {
  const runs = summaryJson(rows, () => assert.fail('result file opened'), 'aaaa', { suite: 'alpha', last: 2, metric: 'cpu' });
  assert.equal(runs.length, 2);
  const [first, last] = runs;
  assert.equal(first.suite, 'alpha');
  assert.equal(first.stale, false);
  assert.equal(last.stale, true, 'a fingerprint that differs from the current one is stale');
  assert.equal(last.automatedVerdict, 'pass');
  assert.deepEqual(Object.keys(first.cases.s1.metrics), ['cpu (ms)'], 'metric filter applies to JSON too');
  assert.equal(first.fileMissing, false);
  assert.deepEqual(first.claimReviews, []);
  assert.equal(first.load, null);
  assert.deepEqual(JSON.parse(JSON.stringify(runs)), runs, 'output survives a JSON round trip');
});

test('summaryJson marks a run whose case data is in neither the index nor the file', () => {
  const bare = { ...row('gamma', '2026-10-18T13:00:00') };
  delete bare.cases;
  const [run] = summaryJson([bare], () => null, 'aaaa');
  assert.equal(run.fileMissing, true);
  assert.deepEqual(run.cases, {});
});

test('an unknown suite id names the known suites; a known one or none gives no error', () => {
  assert.equal(unknownSuiteMessage(rows, 'alpha'), null);
  assert.equal(unknownSuiteMessage(rows, undefined), null);
  assert.equal(
    unknownSuiteMessage(rows, 'alfa'),
    'No runs for suite "alfa" in the index. Known suites: alpha, beta.',
  );
  assert.equal(unknownSuiteMessage([], 'alpha'), 'No runs for suite "alpha" in the index. The index has no runs yet.');
  assert.deepEqual(knownSuites(rows), ['alpha', 'beta']);
});

test('the command line prints JSON, and an unknown suite exits 1 with the message on stderr', () => {
  const root = mkdtempSync(join(tmpdir(), 'tri-summary-'));
  mkdirSync(join(root, 'artifacts/test-runs'), { recursive: true });
  writeFileSync(join(root, 'artifacts/test-runs/index.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const out = JSON.parse(execFileSync(process.execPath, [SUMMARY, '--json', '--suite', 'alpha', '--last', '1'], { cwd: root, encoding: 'utf8' }));
  assert.equal(out.runs.length, 1);
  assert.equal(out.runs[0].startedAt, '2026-10-18T12:00:00Z');
  assert.equal(typeof out.fingerprint, 'string');

  let failure;
  try {
    execFileSync(process.execPath, [SUMMARY, '--json', '--suite', 'alfa'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.status, 1);
  assert.equal(failure.stdout, '');
  assert.match(failure.stderr, /No runs for suite "alfa".*Known suites: alpha, beta\./);
});

test('--json with no index prints an empty run list', () => {
  const root = mkdtempSync(join(tmpdir(), 'tri-summary-empty-'));
  const out = JSON.parse(execFileSync(process.execPath, [SUMMARY, '--json'], { cwd: root, encoding: 'utf8' }));
  assert.deepEqual(out, { fingerprint: null, runs: [] });
});
