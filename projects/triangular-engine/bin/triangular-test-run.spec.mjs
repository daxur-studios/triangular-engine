import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { awayVerdict, buildRunUrl, chromeArgs, createRunQueue, findChrome, findResult, getJson, parseArgs, quietVerdict } from './triangular-test-run.mjs';

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

test('getJson sends a *.localhost request to 127.0.0.1 with the name in the Host header', async () => {
  const server = createServer((req, res) => { res.end(JSON.stringify({ host: req.headers.host, path: req.url })); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  try {
    assert.deepEqual(await getJson(`http://my-app.localhost:${port}/__triangular-test-sink?x=1`), { host: `my-app.localhost:${port}`, path: '/__triangular-test-sink?x=1' });
  } finally { server.close(); }
});
