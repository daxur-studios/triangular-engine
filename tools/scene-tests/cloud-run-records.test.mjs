import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estimateDuration, readRunRecords, runStatus, writeRunRecord } from './cloud-run-records.mjs';

const profile = { frames: 1200, build: 'fresh', arguments: [] };
test('estimates exclude failures and different workloads; use only latest 20 matching successes', () => {
  const records = Array.from({ length: 25 }, (_, index) => ({ status: 'passed', profile, durationMs: 1000 + index * 100 }));
  records.unshift({ status: 'failed', profile, durationMs: 1 }, { status: 'passed', profile: { ...profile, frames: 120 }, durationMs: 1 }, { status: 'passed', profile: { ...profile, build: 'reused' }, durationMs: 1 }, { status: 'passed', profile: { ...profile, arguments: ['--list'] }, durationMs: 1 });
  const estimate = estimateDuration(records, profile);
  assert.equal(estimate.sampleCount, 20);
  assert.equal(estimate.medianMs, 1900);
  assert.equal(estimate.p90Ms, 2700);
  assert.equal(estimate.suggestedWaitMs, 3375);
  assert.equal(estimateDuration([], profile), null);
});

test('separate run directories preserve history and expose elapsed time without starting tests', () => {
  const archive = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-records-'));
  try {
    const write = (id, fields) => {
      const directory = path.join(archive, id); fs.mkdirSync(directory);
      writeRunRecord(directory, { schemaVersion: 1, runId: id, profile, ...fields });
    };
    write('old', { status: 'passed', startedAt: '2026-10-18T10:00:00.000Z', durationMs: 10000 });
    write('active', { status: 'running', pid: process.pid, startedAt: '2026-10-18T11:00:00.000Z' });
    fs.mkdirSync(path.join(archive, 'legacy'));
    assert.equal(readRunRecords(archive).length, 2);
    const status = runStatus(archive, Date.parse('2026-10-18T11:00:02.000Z'));
    assert.equal(status.active[0].elapsedMs, 2000);
    assert.equal(status.active[0].ownerProcessAlive, true);
    assert.equal(status.active[0].suggestedCheckAfterMs, 10500);
    assert.equal(status.recent[0].runId, 'old');
    writeRunRecord(path.join(archive, 'active'), { schemaVersion: 1, runId: 'active', profile, status: 'passed', startedAt: '2026-10-18T11:00:00.000Z', durationMs: 4000 });
    assert.equal(runStatus(archive).active.length, 0);
    assert.equal(runStatus(archive).recent.length, 2);
    assert.equal(fs.existsSync(path.join(archive, 'old', 'run.json')), true);
  } finally {
    assert.equal(path.dirname(path.resolve(archive)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(archive).startsWith('cloud-records-'));
    fs.rmSync(archive, { recursive: true, force: true });
  }
});
