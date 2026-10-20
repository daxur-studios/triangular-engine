import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { computeFingerprint, createReceiver, loadConfig, MACHINE_PATH, SINK_PATH } from './triangular-test-receiver.mjs';
import {
  createMachineMonitor, distribution, machineWarnings, parseGpuLine, summarizeCapture, systemProbe, systemSampler,
} from './triangular-test-machine.mjs';
import { machineText, summarize } from './triangular-test-summary.mjs';

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

test('index lines carry case summaries, so the summary opens no result file', async () => {
  const root = repo();
  const server = createReceiver(root, loadConfig(root));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}${SINK_PATH}`;
  const body = run('r1', '2026-10-18T10:00:00Z', true);
  body.cases.push({ ...body.cases[0], repetition: 2, checks: [], metrics: [
    { name: 'cpu', unit: 'ms', source: 't', samples: [5.800000011920929] },
    { name: 'draws', unit: 'count', source: 't', samples: [2, 2, 2] },
  ] });
  body.cases[0].checks[0].detail = 'range [ 1, 2 ]';
  body.cases[0].validityIssues = ['GPU vendor amd differs from expected nvidia'];
  body.cases[1].validityIssues = ['GPU vendor amd differs from expected nvidia', 'Page lost focus'];
  assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(body) })).status, 200);
  server.close();
  const [row] = readFileSync(join(root, 'artifacts/test-runs/index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(row.cases.s1.metrics['cpu (ms)'], { n: 6, min: 1, med: 3, p95: 10, max: 10 });
  assert.deepEqual(row.cases.s1.failed, ['bounded — range [ 1, 2 ]']);
  const text = summarize([row], () => assert.fail('result file opened'), row.fingerprint);
  assert.match(text, /cpu \(ms\) med 3\.00 p95 10\.00 max 10\.00 \| draws \(count\) = 2\.00/);
  assert.match(text, /FAIL bounded — range \[ 1, 2 \]/);
  assert.deepEqual(row.cases.s1.invalid, ['GPU vendor amd differs from expected nvidia', 'Page lost focus']);
  assert.match(text, /INVALID GPU vendor amd differs from expected nvidia\n    INVALID Page lost focus/);
  assert.doesNotMatch(summarize([row], () => null, row.fingerprint, { metric: 'cpu' }), /draws/);
  const stored = readFileSync(join(root, 'artifacts/test-runs', row.file), 'utf8');
  assert.match(stored, /"samples": \[5\.8\]/);
  assert.match(stored, /"samples": \[1,2,3,4,10\]/);
  assert.match(stored, /"detail": "range \[ 1, 2 \]"/);
});

test('index lines carry the mode, each case window and the A/B outcomes, and summary prints them', async () => {
  const root = repo();
  const server = createReceiver(root, loadConfig(root));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}${SINK_PATH}`;
  const body = { ...run('r2', '2026-10-20T10:00:00Z'), mode: 'quick' };
  body.cases[0].window = { mode: 'quick', elapsedMs: 1432.7, stoppedBy: 'settled' };
  body.cases[0].retries = 1;
  const arm = (value) => ({ value, rounds: [value], spread: 0, halfRange: 0.001 });
  body.ablations = [
    { group: 'orbit', feature: 'shadows', metric: 'gpuPassTotal', invalidRounds: 0,
      result: { statistic: 'median', verdict: 'slower', a: arm(0.045), b: arm(0.081), difference: 0.036, relative: 0.8, noiseBand: 0.0014, reasons: [] } },
    { group: 'ground', feature: 'shadows', metric: 'gpuPassTotal', invalidRounds: 1,
      result: { statistic: 'median', verdict: 'rejected', a: arm(0.09), b: arm(0.2), difference: 0.11, relative: 1.2, noiseBand: 0.01, reasons: ['Arm A spread 20.0 % exceeds 15.0 %'] } },
  ];
  assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(body) })).status, 200);
  server.close();
  const [row] = readFileSync(join(root, 'artifacts/test-runs/index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(row.mode, 'quick');
  assert.match(row.file, /_visible-browser_quick_/);
  const text = summarize([row], () => assert.fail('result file opened'), row.fingerprint);
  assert.match(text, /visible-browser quick/);
  assert.match(text, /s1 \[settled 1\.433s, redone 1x\]:/);
  assert.match(text, /A\/B shadows @ orbit gpuPassTotal median: B 0\.081 vs A 0\.045 \(\+80\.0%\) slower, noise 0\.001/);
  assert.match(text, /A\/B shadows @ ground gpuPassTotal median: REJECTED Arm A spread 20\.0 % exceeds 15\.0 % \| 1 invalid rounds/);
});

test('summary falls back to the result file for index lines written before case summaries', () => {
  const old = { savedAt: 'x', startedAt: '2026-10-18T10:00:00Z', suite: 'demo', version: 2, profile: 'visible-browser',
    fingerprint: 'h', automatedVerdict: 'pass', performanceVerdict: 'unassessed', visualReview: 'pending', file: 'f.json' };
  assert.match(summarize([old], () => run('r1', old.startedAt), 'h'), /cpu \(ms\) med 3\.00 p95 10\.00/);
  assert.match(summarize([old], () => null, 'h'), /full result file missing/);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fakeCapture = (util = 50, throttle = 0n) => ({
  ms: 1000, cpu: [10, 20, 30, 40, 50], ram: [8000, 7900], gpuReason: 'x',
  gpu: [{ util, vramUsedMiB: 250, vramTotalMiB: 16384, tempC: 46, powerW: 24.4, smClockMHz: 930, pstate: 3, throttle }],
});

test('nvidia-smi lines parse, unsupported columns become undefined, and blocks use nearest-rank statistics', () => {
  assert.deepEqual(parseGpuLine('27, 250, 16384, 46, 24.43, 930, P3, 0x0000000000000001'),
    { util: 27, vramUsedMiB: 250, vramTotalMiB: 16384, tempC: 46, powerW: 24.43, smClockMHz: 930, pstate: 3, throttle: 1n });
  const partial = parseGpuLine('[N/A], 250, 16384, 46, [N/A], 930, P0, [N/A]');
  assert.equal(partial.util, undefined);
  assert.equal(partial.throttle, undefined);
  assert.equal(parseGpuLine('not a gpu line'), null);
  assert.deepEqual(distribution([5, 1, 4, 2, 3, NaN]), { n: 5, min: 1, med: 3, p95: 5, max: 5 });
  assert.equal(distribution([]), undefined);
  const block = summarizeCapture({ ...fakeCapture(), gpu: [fakeCapture(10, 4n).gpu[0], fakeCapture(30, 0x20n).gpu[0]] });
  assert.equal(block.gpu.throttleReasons, '0x24');
  assert.deepEqual(block.gpu.util, { n: 2, min: 10, med: 10, p95: 30, max: 30 });
  assert.equal(block.cpuPct.med, 30);
  assert.deepEqual(summarizeCapture({ ...fakeCapture(), gpu: [] }), { ms: 1000, cpuPct: block.cpuPct, freeRamMiB: block.freeRamMiB, gpu: 'unavailable', gpuReason: 'x' });
});

test('system sampler reads CPU load, free RAM and a looping nvidia-smi, and tolerates its absence', async () => {
  let busy = 0;
  const cpus = () => { busy += 50; return [{ times: { user: busy, nice: 0, sys: 0, idle: 150 + busy, irq: 0 } }]; };
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), killed: false, kill() { this.killed = true; } });
  const sampler = systemSampler({ spawnImpl: () => child, cpus, freemem: () => 4 * 1024 * 1024 * 1024 });
  const handle = sampler.start(10);
  child.stdout.emit('data', '25, 250, 16384, 45, 23.6, 795, P3, 0x1\r\n29, 250, 16384, 4');
  child.stdout.emit('data', '5, 24.1, 915, P3, 0x1\r\n');
  await wait(60);
  const capture = await handle.stop();
  assert.equal(child.killed, true);
  assert.equal(capture.gpu.length, 2);
  assert.ok(capture.cpu.length >= 2 && capture.cpu.every((v) => v > 0 && v <= 100));
  assert.equal(capture.ram[0], 4096);

  const missing = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill() {} });
  const absent = systemSampler({ spawnImpl: () => missing, cpus, freemem: () => 1 }).start(10);
  missing.emit('error', Object.assign(new Error('spawn nvidia-smi ENOENT'), { code: 'ENOENT' }));
  const none = summarizeCapture(await absent.stop());
  assert.equal(none.gpu, 'unavailable');
  assert.match(none.gpuReason, /not found/);
  const throwing = systemSampler({ spawnImpl: () => { throw new Error('boom'); }, cpus, freemem: () => 1 }).start(10);
  assert.equal(summarizeCapture(await throwing.stop()).gpu, 'unavailable');
});

test('probe reports battery power, scheme and heaviest processes from the Windows script, and skips other systems', async () => {
  const exec = async (file) => {
    if (file === 'powershell.exe') return { stdout: JSON.stringify({ batteryStatus: 1, top: [{ pid: 7, name: 'some-app', cpuS: 0.8 }] }) };
    if (file === 'powercfg') return { stdout: 'Power Scheme GUID: abc  (Balanced)\r\n' };
    return { stdout: '9, C:\\Apps\\game.exe, 512\n8, x.exe, [N/A]\n' };
  };
  const win = await systemProbe({ platform: 'win32', exec });
  assert.deepEqual(win.power, { source: 'battery', battery: true, scheme: 'Balanced' });
  assert.deepEqual(win.processes, [{ pid: 7, name: 'some-app', cpuCoreShare: 0.8 }]);
  assert.equal(win.gpuApps[0].name, 'game.exe');
  const other = await systemProbe({ platform: 'linux', exec: async () => { throw new Error('no nvidia-smi'); } });
  assert.deepEqual(other, { platform: 'linux', power: { source: 'unchecked' }, processes: [], gpuApps: [] });
});

test('receiver samples between start and stop, stores the machine block and a tiny index summary, and summary prints it', async () => {
  const root = repo();
  const starts = [];
  const sampler = { start: (interval) => { starts.push(interval); return { stop: async () => fakeCapture(50, 4n) }; } };
  const probe = async () => ({ platform: 'win32', power: { source: 'battery', scheme: 'Balanced' }, processes: [{ pid: 1, name: 'private-process', cpuCoreShare: 0.9 }], gpuApps: [] });
  const monitor = createMachineMonitor({ sampler, probe, preflightMs: 0 });
  const server = createReceiver(root, loadConfig(root), { monitor });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const msg = { runId: 'r1', suiteId: 'demo', suiteVersion: 2, scenarioId: 's1', repetition: 1 };
  assert.equal((await post(`${MACHINE_PATH}/prepare`, { runId: 'r1' })).status, 200);
  await wait(20);
  assert.equal((await post(`${MACHINE_PATH}/start`, msg)).status, 200);
  assert.equal((await post(`${MACHINE_PATH}/stop`, msg)).status, 200);
  assert.equal((await post(`${MACHINE_PATH}/start`, { runId: 'r1' })).status, 400);
  assert.equal((await post(`${MACHINE_PATH}/start`, 'junk')).status, 400);
  assert.equal((await post(`${MACHINE_PATH}/other`, msg)).status, 404);
  assert.equal((await post(`${MACHINE_PATH}/stop`, { ...msg, scenarioId: 'never-started' })).status, 200);
  // A start whose stop message was lost is still finished when the result arrives.
  assert.equal((await post(`${MACHINE_PATH}/start`, { ...msg, repetition: 2 })).status, 200);

  const body = run('r1', '2026-10-18T10:00:00Z');
  body.suite.purpose = 'performance';
  body.environment = { 'gpu.vendor': 'nvidia', 'gpu.backend': 'webgpu' };
  body.cases.push({ ...body.cases[0], repetition: 2 });
  assert.equal((await post(SINK_PATH, body)).status, 200);
  const bare = run('r2', '2026-10-18T11:00:00Z');
  assert.equal((await post(SINK_PATH, bare)).status, 200);
  server.close();

  const dir = join(root, 'artifacts/test-runs');
  const [row, plain] = readFileSync(join(dir, 'index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(row.machine, { warnings: ['on-battery', 'gpu-busy-before-start', 'gpu-throttled'], cases: 2, cpuMedPct: 30, gpuUtilMedPct: 50, gpuTempMaxC: 46, gpuSampling: 'ok' });
  assert.equal(row.gpu, 'nvidia');
  assert.equal(row.gpuBackend, 'webgpu');
  assert.doesNotMatch(JSON.stringify(row), /private-process/);
  assert.equal(plain.machine, undefined);
  const stored = JSON.parse(readFileSync(join(dir, row.file), 'utf8'));
  assert.equal(stored.cases[0].machine.cpuPct.med, 30);
  assert.equal(stored.cases[0].machine.gpu.util.max, 50);
  assert.equal(stored.cases[1].machine.freeRamMiB.min, 7900);
  assert.equal(stored.machine.preflight.processes[0].name, 'private-process');
  assert.equal(stored.machine.preflight.idle.gpu.util.med, 50);
  assert.equal(stored.machine.preflight.overlapped, undefined);
  assert.equal(starts[0], 250);

  const text = summarize([row, plain], () => assert.fail('result file opened'), row.fingerprint);
  assert.match(text, /machine: gpu nvidia\/webgpu \| load med gpu 50% cpu 30% 46C \| WARN on-battery, gpu-busy-before-start, gpu-throttled/);
  assert.equal(text.match(/machine:/g).length, 1);
});

test('gpu-busy-before-start keys on a non-browser GPU process, not on the page\'s own load', () => {
  const idle = { gpu: { util: { med: 45 }, tempC: { max: 51 } } };
  const busy = (gpuApps) => machineWarnings({ gpuApps, idle }, {}).includes('gpu-busy-before-start');
  assert.equal(busy([{ pid: 1, name: 'chrome.exe' }, { pid: 2, name: 'chrome.exe' }]), false);
  assert.equal(busy([{ pid: 1, name: 'chrome.exe' }, { pid: 3, name: 'game.exe' }]), true);
  assert.equal(busy([{ pid: 3, name: 'game.exe' }].map((app) => ({ ...app, name: undefined }))), true);
  // No process list: fall back to the idle load threshold.
  assert.equal(busy([]), true);
  assert.equal(machineWarnings({ gpuApps: [], idle: { gpu: { util: { med: 5 } } } }, {}).includes('gpu-busy-before-start'), false);
});

test('machine warnings: unavailable GPU sampling and a missing adapter are marked, not failed', async () => {
  const root = repo();
  const sampler = { start: () => ({ stop: async () => ({ ...fakeCapture(), gpu: [], gpuReason: 'nvidia-smi not found' }) }) };
  const monitor = createMachineMonitor({ sampler, probe: async () => ({ platform: 'win32', power: { source: 'ac' }, processes: [], gpuApps: [] }), preflightMs: 0 });
  const server = createReceiver(root, loadConfig(root), { monitor });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const msg = { runId: 'r1', suiteId: 'demo', suiteVersion: 2, scenarioId: 's1', repetition: 1 };
  for (const action of ['start', 'stop']) await fetch(`${base}${MACHINE_PATH}/${action}`, { method: 'POST', body: JSON.stringify(msg) });
  const body = run('r1', '2026-10-18T10:00:00Z');
  body.suite.purpose = 'performance';
  assert.equal((await fetch(`${base}${SINK_PATH}`, { method: 'POST', body: JSON.stringify(body) })).status, 200);
  server.close();
  const [row] = readFileSync(join(root, 'artifacts/test-runs/index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(row.machine.gpuSampling, 'unavailable');
  assert.ok(row.machine.warnings.includes('gpu-adapter-unrecorded'));
  assert.ok(!row.machine.warnings.includes('on-battery'));
  const stored = JSON.parse(readFileSync(join(root, 'artifacts/test-runs', row.file), 'utf8'));
  assert.equal(stored.cases[0].machine.gpu, 'unavailable');
  assert.equal(stored.cases[0].machine.gpuReason, 'nvidia-smi not found');
  assert.match(machineText({ ...row, machine: { ...row.machine, warnings: ['gpu-adapter-unrecorded'] } }), /gpu not recorded \| load med gpu n\/a cpu 30% \| WARN gpu-adapter-unrecorded/);
});

test('prepare answers after the preflight settles, so the first start is not overlapped', async () => {
  const root = repo();
  let probed = false;
  const sampler = { start: () => ({ stop: async () => fakeCapture() }) };
  const probe = async () => { await wait(150); probed = true; return { platform: 'win32', power: { source: 'ac' }, processes: [], gpuApps: [] }; };
  const monitor = createMachineMonitor({ sampler, probe, preflightMs: 0 });
  const server = createReceiver(root, loadConfig(root), { monitor });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const msg = { runId: 'r1', suiteId: 'demo', suiteVersion: 2, scenarioId: 's1', repetition: 1 };
  const prepared = await fetch(`${base}${MACHINE_PATH}/prepare`, { method: 'POST', body: JSON.stringify({ runId: 'r1' }) });
  assert.equal(probed, true);
  assert.deepEqual(await prepared.json(), { ok: true, sampling: true, preflight: 'done' });
  for (const action of ['start', 'stop']) await fetch(`${base}${MACHINE_PATH}/${action}`, { method: 'POST', body: JSON.stringify(msg) });
  const body = run('r1', '2026-10-18T10:00:00Z');
  body.suite.purpose = 'performance';
  assert.equal((await fetch(`${base}${SINK_PATH}`, { method: 'POST', body: JSON.stringify(body) })).status, 200);
  server.close();
  const [row] = readFileSync(join(root, 'artifacts/test-runs/index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(!row.machine.warnings.includes('preflight-overlapped-measurement'));
});

test('a hung preflight probe does not hold prepare past its bound, and a late start still reports the overlap', async () => {
  const root = repo();
  const sampler = { start: () => ({ stop: async () => fakeCapture() }) };
  const monitor = createMachineMonitor({ sampler, probe: () => new Promise(() => {}), preflightMs: 0 });
  const server = createReceiver(root, loadConfig(root), { monitor, prepareWaitMs: 100 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const msg = { runId: 'r1', suiteId: 'demo', suiteVersion: 2, scenarioId: 's1', repetition: 1 };
  const began = Date.now();
  const prepared = await fetch(`${base}${MACHINE_PATH}/prepare`, { method: 'POST', body: JSON.stringify({ runId: 'r1' }) });
  assert.ok(Date.now() - began < 2000);
  assert.deepEqual(await prepared.json(), { ok: true, sampling: true, preflight: 'pending' });
  assert.deepEqual(await (await fetch(`${base}${MACHINE_PATH}/start`, { method: 'POST', body: JSON.stringify(msg) })).json(), { ok: true, sampling: true });
  server.close();
  assert.equal(machineWarnings({ overlapped: true }, {}).includes('preflight-overlapped-measurement'), true);
});

test('a receiver without machine sampling still answers the timing messages', async () => {
  const root = repo();
  const server = createReceiver(root, { ...loadConfig(root), machineSampling: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${MACHINE_PATH}/start`, { method: 'POST', body: JSON.stringify({ runId: 'r', scenarioId: 's', repetition: 1 }) });
  assert.deepEqual(await response.json(), { ok: true, sampling: false });
  server.close();
});

const webp = (size) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(Math.max(0, size - 12), 7)]);
const upload = (caseId, index, bytes, type = 'image/webp') => ({ case: caseId, repetition: 1, index, type, data: bytes.toString('base64') });

async function listening(root, config = loadConfig(root)) {
  const server = createReceiver(root, { ...config, machineSampling: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}${SINK_PATH}` };
}

test('thumbnails are stored beside the result, only names reach the JSON and index, and limits drop with a reason', async () => {
  const root = repo();
  const { server, base } = await listening(root, { ...loadConfig(root), maxImageBytes: 2000, maxRunImageBytes: 3000 });
  const body = run('r1', '2026-10-18T10:00:00Z');
  body.cases.push({ ...body.cases[0], scenario: { id: 's2', label: 'S2' }, limitations: ['kept'] });
  body.cases.push({ ...body.cases[0], scenario: { id: 's3', label: 'S3' } });
  const good = webp(1200);
  body.thumbnailUploads = [
    upload('s1', 0, good), upload('s1', 1, webp(1500)),
    upload('s2', 0, webp(5000)), // over the per-image limit
    upload('s3', 0, webp(1900)), // the run budget (3000) is used up by now
    upload('s1', 2, Buffer.from('not an image at all, but long enough')),
    upload('ghost', 0, good), // no such case
  ];
  const response = await (await fetch(base, { method: 'POST', body: JSON.stringify(body) })).json();
  assert.equal(response.ok, true);
  assert.deepEqual(response.thumbnails.length, 2);
  assert.equal(response.dropped.length, 4);
  assert.match(response.dropped.join('\n'), /s2: thumbnail dropped, 5 KB is over 2 KB|s2: thumbnail dropped, over 2 KB/);
  assert.match(response.dropped.join('\n'), /s3: thumbnail dropped, the run's \d MB of thumbnails is used up/);
  assert.match(response.dropped.join('\n'), /s1: thumbnail dropped, not a valid image/);
  const [row] = readFileSync(join(root, 'artifacts/test-runs/index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const stem = row.file.replace(/\.json$/, '').split('/')[1];
  assert.deepEqual(row.cases.s1.thumbnails, [`demo@v2/${stem}/s1-r1-0.webp`, `demo@v2/${stem}/s1-r1-1.webp`]);
  assert.equal(row.cases.s2.thumbnails, undefined);
  const stored = JSON.parse(readFileSync(join(root, 'artifacts/test-runs', row.file), 'utf8'));
  assert.equal(stored.thumbnailUploads, undefined);
  assert.deepEqual(stored.cases[0].thumbnails, row.cases.s1.thumbnails);
  assert.deepEqual(stored.cases[1].limitations, ['kept', 's2: thumbnail dropped, over 2 KB']);
  assert.ok(readFileSync(join(root, 'artifacts/test-runs', row.cases.s1.thumbnails[0])).equals(good));
  // A result without images is stored exactly as before.
  const plain = await (await fetch(base, { method: 'POST', body: JSON.stringify(run('r2', '2026-10-18T11:00:00Z')) })).json();
  assert.deepEqual(plain.thumbnails, []);
  server.close();
});

test('read routes serve the index, one result and one image, and refuse anything outside the output folder', async () => {
  const root = repo();
  const { server, base } = await listening(root);
  const body = run('r1', '2026-10-18T10:00:00Z');
  body.thumbnailUploads = [upload('s1', 0, webp(300))];
  const saved = await (await fetch(base, { method: 'POST', body: JSON.stringify(body) })).json();
  await fetch(base, { method: 'POST', body: JSON.stringify(run('r2', '2026-10-18T11:00:00Z')) });
  writeFileSync(join(root, 'artifacts/secret.json'), '{"secret":true}');
  writeFileSync(join(root, 'artifacts/test-runs/demo@v2/notes.txt'), 'x');

  const runs = await (await fetch(`${base}/runs`)).json();
  assert.equal(runs.runs.length, 2);
  assert.equal(runs.total, 2);
  assert.equal((await (await fetch(`${base}/runs?limit=1`)).json()).runs[0].runId, 'r2');

  const stored = await fetch(`${base}/run?file=${encodeURIComponent(saved.file)}`);
  assert.equal(stored.status, 200);
  assert.match(stored.headers.get('content-type'), /application\/json/);
  assert.equal((await stored.json()).runId, 'r1');

  const image = await fetch(`${base}/image?file=${encodeURIComponent(saved.thumbnails[0])}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.ok(Buffer.from(await image.arrayBuffer()).equals(webp(300)));

  for (const file of [
    '../secret.json', 'demo@v2/../../secret.json', '..%2Fsecret.json', '/etc/passwd', 'C:/Windows/win.ini', 'C:\\x.json', 'demo@v2\\x.json',
    'demo@v2/.hidden.json', 'demo@v2/notes.txt', 'demo@v2/%00.json', 'index.jsonl', 'demo@v2', '', 'demo@v2/a/b/c.json',
  ]) {
    const response = await fetch(`${base}/run?file=${encodeURIComponent(file)}`);
    assert.equal(response.status, 400, `run ${file}`);
    assert.equal((await fetch(`${base}/image?file=${encodeURIComponent(file)}`)).status, 400, `image ${file}`);
  }
  assert.equal((await fetch(`${base}/run?file=demo@v2/missing.json`)).status, 404);
  // A result is not an image and an image is not a result.
  assert.equal((await fetch(`${base}/image?file=${encodeURIComponent(saved.file)}`)).status, 400);
  assert.equal((await fetch(`${base}/run?file=${encodeURIComponent(saved.thumbnails[0])}`)).status, 400);
  assert.equal((await fetch(`${base}/runs`, { method: 'POST', body: '{}' })).status, 405);

  const local = await fetch(`${base}/runs`, { headers: { origin: 'http://triangular-demo.localhost:4200' } });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://triangular-demo.localhost:4200');
  const foreign = await fetch(`${base}/runs`, { headers: { origin: 'https://example.com' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  server.close();
});
