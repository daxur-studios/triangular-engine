import { expect, test as base, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, buildProfile, engineVersion, gitIdentity, hostIdentity, isSoftwareRenderer, type PerfProfile } from './perf-environment';
import {
  PERF_HISTORY_SCHEMA,
  appendHistory,
  compareToHistory,
  paramsHash,
  profileSummary,
  readHistory,
  type PerfComparison,
  type PerfHistoryEntry,
  type PerfProtocol,
  type PerfScenarioParams,
  type PerfTolerance,
} from './perf-history';
import { countHitches, median, round, summarize, type PerfDistribution } from './perf-stats';
import type { PerfBridgeApi, PerfFactsPayload, PerfLoadPayload, PerfWindowPayload, PerfEnvironmentPayload } from './perf-types';

export const PERF_HISTORY_FILE = path.resolve(REPO_ROOT, process.env['PERF_HISTORY_FILE'] ?? 'tests/perf/history/perf-history.jsonl');
export const PERF_ARTIFACT_DIR = path.join(REPO_ROOT, 'artifacts/perf');

export const PROTOCOLS: Record<PerfProtocol['name'], PerfProtocol> = {
  // ~5 s per scenario: fast enough for an agent inner loop, two repeats to estimate noise.
  smoke: { name: 'smoke', warmupMs: 1000, durationMs: 2000, repeats: 2 },
  // Slower, steadier numbers for recording baselines on a known machine.
  reference: { name: 'reference', warmupMs: 5000, durationMs: 10000, repeats: 3 },
};

export function activeProtocol(): PerfProtocol {
  return PROTOCOLS[process.env['PERF_PROTOCOL'] === 'reference' ? 'reference' : 'smoke'];
}

export interface PerfRunRequest {
  scenario: string;
  params?: PerfScenarioParams;
  /** Override the default smoke/reference tolerance for this scenario. */
  tolerance?: PerfTolerance;
  /** Metrics to compare against history; defaults to CPU frame/render p50/p95 plus custom p50s. */
  gatedMetrics?: string[];
}

export interface PerfRunResult {
  entry: PerfHistoryEntry;
  comparison: PerfComparison;
  load: PerfLoadPayload;
  facts: PerfFactsPayload;
  distributions: Record<string, PerfDistribution | null>;
}

export interface PerfFixture {
  run(request: PerfRunRequest): Promise<PerfRunResult>;
}

const runId = process.env['PERF_RUN_ID'] ?? new Date().toISOString().replace(/[:.]/g, '-');

async function openBridge(page: Page): Promise<PerfBridgeApi> {
  await page.goto('/perf-lab?perfTest=1');
  await page.waitForFunction(() => Boolean((window as Window & { __perfTest?: unknown }).__perfTest), undefined, { timeout: 30_000 });
  type W = Window & { __perfTest: PerfBridgeApi };
  return {
    environment: () => page.evaluate(() => (window as unknown as W).__perfTest.environment()),
    load: (id, params) => page.evaluate(([scenario, values]) => (window as unknown as W).__perfTest.load(scenario, values), [id, params ?? {}] as const),
    measure: (request) => page.evaluate((value) => (window as unknown as W).__perfTest.measure(value), request),
    facts: () => page.evaluate(() => (window as unknown as W).__perfTest.facts()),
    unload: () => page.evaluate(() => (window as unknown as W).__perfTest.unload()),
    errors: () => page.evaluate(() => (window as unknown as W).__perfTest.errors()),
  };
}

function profileFor(environment: PerfEnvironmentPayload, browserName: string, browserVersion: string): PerfProfile {
  const gpuRenderer = environment.webgl?.unmaskedRenderer ?? environment.webgl?.renderer ?? null;
  return buildProfile({
    host: hostIdentity(),
    browser: {
      name: browserName,
      version: browserVersion,
      headless: process.env['PERF_HEADED'] !== '1',
      frameRateCap: process.env['PERF_UNCAPPED'] === '0' ? 'vsync' : 'uncapped-flags',
    },
    gpu: { vendor: environment.webgl?.unmaskedVendor ?? environment.webgl?.vendor ?? null, renderer: gpuRenderer, softwareRendering: isSoftwareRenderer(gpuRenderer) },
    viewport: { width: environment.canvas.width, height: environment.canvas.height, dpr: environment.devicePixelRatio },
  });
}

function flattenMetrics(distributions: Record<string, PerfDistribution | null>, extra: Record<string, number>): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const [name, distribution] of Object.entries(distributions)) {
    if (!distribution) continue;
    for (const stat of ['p50', 'p95', 'p99', 'mean', 'max'] as const) metrics[`${name}.${stat}`] = round(distribution[stat]);
  }
  for (const [name, value] of Object.entries(extra)) metrics[name] = round(value);
  return metrics;
}

export const test = base.extend<{ perf: PerfFixture }>({
  perf: async ({ page, browser, browserName }, use, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(`console.error: ${message.text()}`);
    });

    const bridge = await openBridge(page);
    const protocol = activeProtocol();

    await use({
      run: async (request) => {
        const environment = await bridge.environment();
        const profile = profileFor(environment, browserName, browser.version());
        const load = await bridge.load(request.scenario, request.params);

        const failedAtLoad = load.facts.checks.filter((check) => !check.pass);
        expect(failedAtLoad, `functional checks after loading ${request.scenario}`).toEqual([]);

        const windows: PerfWindowPayload[] = [];
        for (let repeat = 0; repeat < protocol.repeats; repeat++) {
          // Full warm-up once; later repeats only need to settle.
          windows.push(await bridge.measure({ warmupMs: repeat === 0 ? protocol.warmupMs : 250, durationMs: protocol.durationMs }));
        }
        const facts = await bridge.facts();
        await bridge.unload();

        const series = (pick: (window: PerfWindowPayload) => number[]) => windows.flatMap(pick);
        const customNames = [...new Set(windows.flatMap((window) => Object.keys(window.custom)))];
        const distributions: Record<string, PerfDistribution | null> = {
          frameIntervalMs: summarize(series((window) => window.frameIntervalMs)),
          cpuFrameMs: summarize(series((window) => window.cpuFrameMs)),
          renderCpuMs: summarize(series((window) => window.renderCpuMs)),
        };
        for (const name of customNames) distributions[`custom.${name}`] = summarize(series((window) => window.custom[name] ?? []));

        const totalFrames = windows.reduce((sum, window) => sum + window.frames, 0);
        const totalDurationMs = windows.reduce((sum, window) => sum + window.durationMs, 0);
        const hitches = countHitches(series((window) => window.frameIntervalMs));
        const heapGrowth = windows
          .map((window) => (window.heapUsedBytes.before !== null && window.heapUsedBytes.after !== null ? window.heapUsedBytes.after - window.heapUsedBytes.before : null))
          .filter((value): value is number => value !== null);

        const extra: Record<string, number> = {
          fps: totalDurationMs > 0 ? (totalFrames / totalDurationMs) * 1000 : 0,
          frames: totalFrames,
          setupMs: load.setupMs,
          firstFrameMs: load.firstFrameMs,
          drawCalls: facts.renderer.drawCalls,
          triangles: facts.renderer.triangles,
          programs: facts.renderer.programs,
          geometries: facts.renderer.geometries,
          textures: facts.renderer.textures,
          longTasks: windows.reduce((sum, window) => sum + window.longTasks.length, 0),
          ...Object.fromEntries(Object.entries(hitches).map(([name, count]) => [`hitches.${name}`, count])),
        };
        if (heapGrowth.length) extra['heapGrowthMb'] = median(heapGrowth) / 1024 ** 2;

        const failedChecks = facts.checks.filter((check) => !check.pass);
        const harnessErrors = windows.flatMap((window) => window.errors);
        const invalidReasons = [
          ...windows.filter((window) => window.hiddenFrames > 0).map(() => 'page was hidden during sampling'),
          ...(distributions['cpuFrameMs'] ? [] : ['no cpuFrameMs samples: engine tick instrumentation did not run']),
          ...(distributions['frameIntervalMs'] ? [] : ['no frame intervals: fewer than two frames rendered']),
          ...(harnessErrors.length ? [`${harnessErrors.length} runtime error(s) during sampling`] : []),
          ...(pageErrors.length ? [`${pageErrors.length} page error(s)`] : []),
        ];

        const entry: PerfHistoryEntry = {
          schema: PERF_HISTORY_SCHEMA,
          recordedAt: new Date().toISOString(),
          runId,
          git: gitIdentity(),
          engineVersion: engineVersion(),
          profile: profileSummary(profile),
          scenario: { id: load.scenario, version: load.version, params: load.params, paramsHash: paramsHash(load.params) },
          protocol,
          metrics: flattenMetrics(distributions, extra),
          repeatP50: {
            cpuFrameMs: windows.map((window) => round(summarize(window.cpuFrameMs)?.p50 ?? Number.NaN)),
            renderCpuMs: windows.map((window) => round(summarize(window.renderCpuMs)?.p50 ?? Number.NaN)),
          },
          checks: { passed: failedChecks.length === 0, failed: failedChecks.map((check) => `${check.name}: expected ${check.expected}, got ${check.actual}`) },
          valid: invalidReasons.length === 0,
          invalidReasons,
        };

        const { entries: history } = readHistory(PERF_HISTORY_FILE);
        const comparison = compareToHistory(entry, history, { metrics: request.gatedMetrics, tolerance: request.tolerance });

        // Raw evidence: every sample, the profile and the comparison. Ignored by git.
        const artifactDir = path.join(PERF_ARTIFACT_DIR, runId);
        fs.mkdirSync(artifactDir, { recursive: true });
        const raw = { entry, comparison, profile, environment, load, facts, windows, pageErrors };
        const rawName = `${load.scenario}-${entry.scenario.paramsHash}.json`;
        fs.writeFileSync(path.join(artifactDir, rawName), JSON.stringify(raw, null, 2));
        await testInfo.attach(`perf-${rawName}`, { body: JSON.stringify(raw, null, 2), contentType: 'application/json' });

        const cpu = distributions['cpuFrameMs'];
        const headline =
          `${load.scenario} ${JSON.stringify(load.params)} · cpu p50 ${cpu ? round(cpu.p50, 2) : 'n/a'} ms p95 ${cpu ? round(cpu.p95, 2) : 'n/a'} ms · ` +
          `${round(extra['fps'], 1)} fps · ${facts.renderer.drawCalls} calls · ${comparison.summary}`;
        testInfo.annotations.push({ type: 'perf', description: headline });
        testInfo.annotations.push({ type: 'perf-profile', description: `${profile.label} (${profile.id})` });
        console.log(`[perf] ${headline}`);

        if (process.env['PERF_RECORD'] === '1') {
          if (entry.valid && entry.checks.passed) appendHistory(PERF_HISTORY_FILE, entry);
          else testInfo.annotations.push({ type: 'perf-not-recorded', description: [...invalidReasons, ...entry.checks.failed].join('; ') });
        }

        expect(failedChecks, `functional checks after sampling ${request.scenario}`).toEqual([]);
        expect(harnessErrors, 'runtime errors during sampling').toEqual([]);
        expect(pageErrors, 'page errors').toEqual([]);
        expect(invalidReasons, 'measurement validity').toEqual([]);
        if (process.env['PERF_GATE'] === '1') {
          expect(comparison.verdict, comparison.summary).not.toBe('regressed');
        }

        return { entry, comparison, load, facts, distributions };
      },
    });
  },
});

export { expect };
