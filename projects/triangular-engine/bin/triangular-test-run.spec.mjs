import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { awayVerdict, buildRunUrl, chromeArgs, classifyPrograms, cpuPercent, createRunQueue, findChrome, findResult, getJson, HEADLESS_WINDOW, HEAVY_PROGRAMS, listHeavyPrograms, loadSidecarName, needsAwaySwitch, noResultMessage, parseArgs, parseProcessNames, percentStats, quietVerdict, startLoadSampler, summarizeLoad } from './triangular-test-run.mjs';
import { loadText } from './triangular-test-summary.mjs';

test('awayVerdict: no switch runs; otherwise only while away and unexpired, and a broken file holds back', () => {
  const now = Date.parse('2026-10-21T15:00:00Z');
  assert.equal(awayVerdict(undefined, now).ok, true);
  assert.equal(awayVerdict(JSON.stringify({ away: true, expiresAt: now + 60_000 }), now).ok, true);
  assert.equal(awayVerdict(JSON.stringify({ away: true }), now).ok, true);
  assert.equal(awayVerdict(JSON.stringify({ away: false, expiresAt: now + 60_000 }), now).ok, false);
  assert.match(awayVerdict(JSON.stringify({ away: true, expiresAt: now - 1 }), now).reason, /expired/);
  assert.equal(awayVerdict('{"away":tr', now).ok, false);
  assert.equal(parseArgs(['--url', 'http://x/', '--suite', 's', '--version', '1', '--away-wait-min', '0']).awayWaitMin, 0);
});

test('parseArgs needs url, suite and version, and checks the rest', () => {
  const ok = parseArgs(['--url', 'http://app.localhost:4200/lab', '--suite', 's', '--version', '2', '--no-thumbnails', '--timeout-min', '5']);
  assert.equal(ok.version, 2);
  assert.equal(ok.thumbnails, false);
  assert.equal(ok.timeoutMin, 5);
  assert.equal(ok.mode, 'standard');
  assert.throws(() => parseArgs(['--url', 'http://x/', '--suite', 's']), /required/);
  assert.throws(() => parseArgs(['--url', 'http://x/', '--suite', 's', '--version', '1', '--mode', 'fast']), /--mode/);
  assert.throws(() => parseArgs(['--url', 'http://x/', '--suite', 's', '--version', '1', '--repetitions', '9']), /1-5/);
  assert.throws(() => parseArgs(['--bogus', '1']), /Unknown/);
});

test('buildRunUrl selects the suite and autostarts, keeping the page\'s own query', () => {
  const url = new URL(buildRunUrl('http://app.localhost:4200/lab?backend=webgpu', { suite: 's', version: 3, profile: 'visible-browser', mode: 'standard', repetitions: 2, thumbnails: false }));
  assert.equal(url.searchParams.get('backend'), 'webgpu');
  assert.equal(url.searchParams.get('testSuite'), 's');
  assert.equal(url.searchParams.get('testVersion'), '3');
  assert.equal(url.searchParams.get('testRepetitions'), '2');
  assert.equal(url.searchParams.get('testThumbnails'), '0');
  assert.equal(url.searchParams.get('testAutoStart'), '1');
});

test('the run queue is first come, first served across launchers, and drops dead tickets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-queue-'));
  const alive = new Set([11, 22]);
  let clock = 1000;
  const make = (pid) => createRunQueue({ dir, pid, now: () => clock++, alive: (p) => alive.has(p) });
  writeFileSync(join(dir, '5-99.json'), '{}');
  const a = make(11);
  const b = make(22);
  a.enter({ suite: 'one', version: 1 });
  b.enter({ suite: 'two', version: 1 });
  assert.deepEqual(a.ahead(), []);
  assert.deepEqual(b.ahead().map((t) => t.suite), ['one']);
  assert.equal(readdirSync(dir).includes('5-99.json'), false, 'dead pid 99 removed');
  a.leave();
  assert.deepEqual(b.ahead(), []);
  b.enter({ suite: 'two', version: 1 });
  alive.delete(22);
  const c = make(33);
  alive.add(33);
  c.enter({ suite: 'three', version: 1 });
  assert.deepEqual(c.ahead(), [], 'a crashed launcher does not block the queue');
});

test('quietVerdict: browsers and the compositor are ignored, a game or a high load is not', () => {
  const browsers = [{ pid: 1, name: 'chrome.exe' }, { pid: 2, name: '[Insufficient Permissions]' }, { pid: 3, name: 'dwm.exe' }];
  assert.equal(quietVerdict([0, 1, 2, 0], browsers, { maxPct: 10 }).quiet, true);
  assert.equal(quietVerdict([40, 45, 50], browsers, { maxPct: 10 }).quiet, false);
  const game = quietVerdict([0, 0], [...browsers, { pid: 4, name: 'League of Legends.exe' }], { maxPct: 10 });
  assert.equal(game.quiet, false);
  assert.match(game.reason, /League of Legends/);
  assert.match(quietVerdict([], [], { maxPct: 10 }).reason, /not checked/);
});

test('findResult takes the first row of the suite/version saved after the launch', () => {
  const rows = [
    { suite: 's', version: 1, startedAt: '2026-10-21T10:00:00Z', file: 'old' },
    { suite: 'other', version: 1, startedAt: '2026-10-21T11:00:00Z', file: 'other' },
    { suite: 's', version: 2, startedAt: '2026-10-21T11:00:00Z', file: 'v2' },
    { suite: 's', version: 1, startedAt: '2026-10-21T11:00:01Z', file: 'new' },
  ].map((row) => JSON.stringify(row)).join('\n');
  const since = Date.parse('2026-10-21T10:59:59Z');
  assert.equal(findResult(rows + '\nnot json\n', { suite: 's', version: 1, since })?.file, 'new');
  assert.equal(findResult(rows, { suite: 's', version: 3, since }), undefined);
  // A quick run the owner starts by hand meanwhile is not this standard run.
  const handRun = JSON.stringify({ suite: 's', version: 1, profile: 'visible-browser', mode: 'quick', startedAt: '2026-10-21T11:00:02Z', file: 'hand' });
  const mine = JSON.stringify({ suite: 's', version: 1, profile: 'visible-browser', mode: 'standard', startedAt: '2026-10-21T11:00:03Z', file: 'mine' });
  assert.equal(findResult(`${handRun}\n${mine}`, { suite: 's', version: 1, since, profile: 'visible-browser', mode: 'standard' })?.file, 'mine');
});

test('chromeArgs use a throwaway profile, full screen and the precise GPU timer flag; findChrome checks the usual paths', () => {
  const args = chromeArgs('C:\\tmp\\p', 'http://x/');
  assert.ok(args.includes('--user-data-dir=C:\\tmp\\p'));
  assert.ok(args.includes('--start-fullscreen'));
  assert.ok(args.includes('--enable-webgpu-developer-features'));
  assert.equal(args.at(-1), 'http://x/');
  const path = findChrome('win32', (p) => p.startsWith('C:\\PF'), { PROGRAMFILES: 'C:\\PF' });
  assert.equal(path, join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  assert.equal(findChrome('linux', () => false, {}), undefined);
});

test('chromeArgs keep a covered window rendering, with one merged --disable-features', () => {
  const args = chromeArgs('C:\tmp\p', 'http://x/');
  for (const flag of ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']) {
    assert.ok(args.includes(flag), flag);
  }
  const features = args.filter((arg) => arg.startsWith('--disable-features'));
  assert.equal(features.length, 1, 'a second --disable-features would replace the first');
  assert.ok(features[0].slice('--disable-features='.length).split(',').includes('CalculateNativeWinOcclusion'));
});

test('headless-hardware starts hidden headless Chrome on the real GPU at a fixed window size', () => {
  const args = chromeArgs('C:\\tmp\\p', 'http://x/', { profile: 'headless-hardware' });
  assert.ok(args.includes('--headless=new'));
  assert.ok(!args.includes('--start-fullscreen'));
  for (const flag of ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-webgpu', '--enable-webgpu-developer-features',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']) assert.ok(args.includes(flag), flag);
  assert.ok(!args.includes('--disable-gpu'));
  assert.ok(!args.some((arg) => /swiftshader/i.test(arg)));
  assert.ok(args.includes(`--window-size=${HEADLESS_WINDOW.width},${HEADLESS_WINDOW.height}`));
  assert.ok(args.includes(`--force-device-scale-factor=${HEADLESS_WINDOW.scaleFactor}`));
  assert.equal(args.at(-1), 'http://x/');
  assert.ok(chromeArgs('p', 'http://x/', { profile: 'headless-hardware', windowSize: { width: 1280, height: 720 } }).includes('--window-size=1280,720'));
});

test('visible profiles keep the full-screen args: no headless, window size or GPU overrides', () => {
  for (const profile of ['visible-browser', 'human-observed']) {
    const args = chromeArgs('p', 'http://x/', { profile });
    assert.ok(args.includes('--start-fullscreen'));
    assert.ok(!args.some((arg) => /^--(headless|window-size|force-device-scale-factor|use-angle|enable-gpu|ignore-gpu-blocklist|enable-unsafe-webgpu)/.test(arg)));
  }
  assert.deepEqual(chromeArgs('p', 'http://x/'), chromeArgs('p', 'http://x/', { profile: 'visible-browser' }));
});

test('--window-size is parsed as WxH and checked', () => {
  const base = ['--url', 'http://x/', '--suite', 's', '--version', '1'];
  assert.deepEqual(parseArgs([...base, '--window-size', '1280x720']).windowSize, { width: 1280, height: 720 });
  assert.equal(parseArgs(base).windowSize, undefined);
  assert.throws(() => parseArgs([...base, '--window-size', '1280']), /--window-size/);
  assert.throws(() => parseArgs([...base, '--window-size', 'axb']), /--window-size/);
});

test('only visible profiles wait for the away switch', () => {
  assert.equal(needsAwaySwitch('headless-hardware'), false);
  assert.equal(needsAwaySwitch('visible-browser'), true);
  assert.equal(needsAwaySwitch('human-observed'), true);
});

test('a headless-hardware row is matched by profile; a headed row of the same suite is not', () => {
  const since = Date.parse('2026-10-21T10:59:59Z');
  const rows = [
    { suite: 's', version: 1, profile: 'visible-browser', mode: 'standard', startedAt: '2026-10-21T11:00:00Z', file: 'headed' },
    { suite: 's', version: 1, profile: 'headless-hardware', mode: 'standard', startedAt: '2026-10-21T11:00:01Z', file: 'headless' },
  ].map((row) => JSON.stringify(row)).join('\n');
  assert.equal(findResult(rows, { suite: 's', version: 1, since, profile: 'headless-hardware', mode: 'standard' })?.file, 'headless');
});

test('noResultMessage reports a timeout as a timeout and a real early close as Chrome closed', () => {
  const timeout = noResultMessage({ chromeClosed: false, timeoutMin: 30 });
  assert.match(timeout, /timed out/);
  assert.match(timeout, /30 min/);
  assert.doesNotMatch(timeout, /Chrome closed/);
  assert.match(noResultMessage({ chromeClosed: true, timeoutMin: 30 }), /^Chrome closed/);
});

test('getJson sends a *.localhost request to 127.0.0.1 with the name in the Host header', async () => {
  const server = createServer((req, res) => { res.end(JSON.stringify({ host: req.headers.host, path: req.url })); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  try {
    assert.deepEqual(await getJson(`http://my-app.localhost:${port}/__triangular-test-sink?x=1`), { host: `my-app.localhost:${port}`, path: '/__triangular-test-sink?x=1' });
  } finally { server.close(); }
});

const base = ['--url', 'http://x/', '--suite', 's', '--version', '1'];

test('--noisy is a flag, off by default, and does not change the away rule', () => {
  assert.equal(parseArgs(base).noisy, false);
  const noisy = parseArgs([...base, '--noisy', '--profile', 'headless-hardware']);
  assert.equal(noisy.noisy, true);
  assert.equal(needsAwaySwitch(noisy.profile), false);
  assert.equal(needsAwaySwitch(parseArgs([...base, '--noisy']).profile), true, 'visible profiles still wait for the away switch');
});

test('buildRunUrl tags the load condition: noisy with --noisy, clean otherwise', () => {
  const opts = { suite: 's', version: 1, profile: 'headless-hardware', mode: 'standard', repetitions: 1, thumbnails: true };
  assert.equal(new URL(buildRunUrl('http://x/lab', opts)).searchParams.get('testLoad'), 'clean');
  assert.equal(new URL(buildRunUrl('http://x/lab', { ...opts, noisy: true })).searchParams.get('testLoad'), 'noisy');
});

test('parseProcessNames reads tasklist CSV and plain name lines', () => {
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"League of Legends.exe","4242","Console","1","900,000 K"\r\n"Code.exe","10","Console","1","1 K"\r\n';
  assert.deepEqual(parseProcessNames(csv), ['System Idle Process', 'League of Legends.exe', 'Code.exe']);
  assert.deepEqual(parseProcessNames('/usr/bin/claude\nbash\n\n'), ['claude', 'bash']);
  assert.deepEqual(parseProcessNames(undefined), []);
});

test('classifyPrograms groups known heavy programs by category, case-insensitively', () => {
  assert.deepEqual(classifyPrograms(['chrome.exe', 'leagueclientux.exe', 'RiotClientServices.exe', 'CODE.EXE', 'claude.exe']),
    { programs: ['Code.exe', 'LeagueClientUx.exe', 'RiotClientServices.exe', 'claude.exe'], categories: ['game-client', 'ide', 'agent'] });
  assert.deepEqual(classifyPrograms(['League of Legends.exe']), { programs: ['League of Legends.exe'], categories: ['game'] });
  assert.deepEqual(classifyPrograms(['explorer.exe']), { programs: [], categories: [] });
  assert.deepEqual(Object.keys(HEAVY_PROGRAMS), ['game', 'game-client', 'ide', 'agent']);
});

test('listHeavyPrograms makes one call through the injected runner and never throws', async () => {
  const calls = [];
  const run = async (file, args) => { calls.push([file, ...args]); return '"devenv.exe","1","Console","1","1 K"\r\n'; };
  assert.deepEqual(await listHeavyPrograms(run, 'win32'), { programs: ['devenv.exe'], categories: ['ide'] });
  assert.deepEqual(calls, [['tasklist', '/FO', 'CSV', '/NH']]);
  assert.deepEqual(await listHeavyPrograms(async () => 'claude\n', 'linux'), { programs: [], categories: [] });
  assert.deepEqual(await listHeavyPrograms(async () => { throw new Error('no tasklist'); }, 'win32'), { programs: [], categories: [] });
});

test('cpuPercent compares two os.cpus snapshots', () => {
  const snap = (idle, busy) => [{ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } }];
  assert.equal(cpuPercent(snap(0, 0), snap(75, 25)), 25);
  assert.equal(cpuPercent(snap(10, 10), snap(10, 10)), undefined);
  assert.equal(cpuPercent(snap(0, 0), snap(0, 50)), 100);
});

test('percentStats uses nearest rank and skips non-numbers', () => {
  assert.equal(percentStats([]), undefined);
  assert.equal(percentStats([NaN, undefined]), undefined);
  assert.deepEqual(percentStats([10, 20, 30, 40, 100]), { med: 30, p95: 100, n: 5 });
  assert.deepEqual(percentStats([44.6]), { med: 45, p95: 45, n: 1 });
});

test('summarizeLoad merges both program listings and tags the condition', () => {
  const load = summarizeLoad({ noisy: true, gpu: [40, 50, 60, 70, 80], cpu: [20, 30, 40], start: { programs: ['Code.exe'], categories: ['ide'] },
    end: { programs: ['LeagueClient.exe', 'Code.exe'], categories: ['game-client', 'ide'] } });
  assert.equal(load.condition, 'noisy');
  assert.deepEqual([load.gpuMedPct, load.gpuP95Pct, load.cpuMedPct, load.cpuP95Pct], [60, 80, 30, 40]);
  assert.deepEqual(load.programs, ['Code.exe', 'LeagueClient.exe']);
  assert.deepEqual(load.categories, ['game-client', 'ide']);
  const clean = summarizeLoad({ noisy: false });
  assert.equal(clean.condition, 'clean');
  assert.equal(clean.gpuMedPct, undefined);
  assert.equal(loadSidecarName('suite@v1/run_abc.json'), 'suite@v1/run_abc.load.json');
});

test('startLoadSampler collects injected readings until stopped', async () => {
  let g = 0;
  const stop = startLoadSampler({ intervalMs: 5, gpu: async () => ++g * 10, cpu: async () => 5 });
  await new Promise((done) => setTimeout(done, 40));
  const readings = await stop();
  assert.ok(readings.gpu.length >= 2 && readings.cpu.length === readings.gpu.length);
  assert.equal(readings.gpu[0], 10);
  const missing = await startLoadSampler({ intervalMs: 5, gpu: async () => undefined, cpu: async () => 7 })();
  assert.deepEqual(missing.gpu, []);
});

test('loadText shows condition, gpu and cpu median/p95 and the categories', () => {
  const load = { condition: 'noisy', gpuMedPct: 45, gpuP95Pct: 80, cpuMedPct: 30, cpuP95Pct: 60, categories: ['game-client', 'ide'] };
  assert.equal(loadText({}, load), '  load: noisy gpu 45/80% cpu 30/60% [game-client, ide]');
  assert.equal(loadText({}, { condition: 'clean', cpuMedPct: 5, cpuP95Pct: 9, categories: [] }), '  load: clean gpu n/a cpu 5/9%');
  assert.equal(loadText({ load: 'noisy' }, null), '  load: noisy');
  assert.equal(loadText({}, null), '');
});
