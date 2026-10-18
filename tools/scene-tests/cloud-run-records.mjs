import fs from 'node:fs';
import path from 'node:path';

// Each writer owns one directory: no shared latest.json/index to race across agents.
export function writeRunRecord(runDir, record) {
  const destination = path.join(runDir, 'run.json');
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2));
  fs.renameSync(temporary, destination);
}

export function readRunRecords(archive) {
  if (!fs.existsSync(archive)) return [];
  return fs.readdirSync(archive, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(archive, entry.name, 'run.json'), 'utf8'));
      return record.schemaVersion === 1 ? [{ ...record, runDir: path.join(archive, entry.name) }] : [];
    } catch { return []; } // Legacy runs and interrupted writes remain in the archive.
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function estimateDuration(records, profile) {
  const comparable = records.filter((record) => record.status === 'passed'
    && record.profile?.frames === profile.frames && record.profile?.build === profile.build
    && JSON.stringify(record.profile?.arguments) === JSON.stringify(profile.arguments)
    && Number.isFinite(record.durationMs) && record.durationMs > 0).slice(0, 20);
  if (!comparable.length) return null;
  const sorted = comparable.map((record) => record.durationMs).sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    sampleCount: sorted.length, medianMs: percentile(.5), p90Ms: percentile(.9),
    suggestedWaitMs: Math.ceil(percentile(.9) * 1.25),
    basis: 'Recent successful commands with matching frames/build mode/arguments; includes build and cleanup; estimate only',
  };
}

export function runStatus(archive, now = Date.now()) {
  const records = readRunRecords(archive);
  const summary = (record) => ({
    runId: record.runId, status: record.status, startedAt: record.startedAt,
    finishedAt: record.finishedAt, durationMs: record.durationMs, profile: record.profile,
    runDir: record.runDir,
  });
  return {
    archive, recordedRuns: records.length,
    active: records.filter((record) => record.status === 'running').map((record) => {
      let ownerProcessAlive = true;
      try { process.kill(record.pid, 0); } catch (error) { ownerProcessAlive = error.code !== 'ESRCH'; }
      const elapsedMs = Math.max(0, now - Date.parse(record.startedAt));
      const estimate = estimateDuration(records, record.profile);
      return { ...summary(record), ownerProcessAlive, elapsedMs, estimate,
        suggestedCheckAfterMs: ownerProcessAlive && estimate ? Math.max(1000, estimate.suggestedWaitMs - elapsedMs) : null,
        note: ownerProcessAlive ? 'Wait for process completion when supported; elapsed time is not a progress percentage.' : 'Owner exited without finalizing; completion unknown. Inspect retained evidence.',
      };
    }),
    recent: records.filter((record) => record.status !== 'running').slice(0, 10).map(summary),
  };
}
