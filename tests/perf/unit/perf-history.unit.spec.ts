import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PERF_HISTORY_SCHEMA,
  appendHistory,
  canonicalJson,
  compareToHistory,
  comparisonKey,
  paramsHash,
  readHistory,
  type PerfHistoryEntry,
} from '../lib/perf-history';
import { buildProfile, isSoftwareRenderer } from '../lib/perf-environment';

let sequence = 0;

function entry(overrides: { cpu?: number; render?: number; repeats?: number[]; runId?: string; profileId?: string; params?: Record<string, number>; valid?: boolean; passed?: boolean; protocol?: 'smoke' | 'reference'; version?: number } = {}): PerfHistoryEntry {
  const params = overrides.params ?? { count: 1000 };
  const cpu = overrides.cpu ?? 4;
  return {
    schema: PERF_HISTORY_SCHEMA,
    recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    runId: overrides.runId ?? `run-${sequence++}`,
    git: { commit: 'abc', branch: 'main', dirty: false },
    engineVersion: '1.0.0',
    profile: { id: overrides.profileId ?? 'profile-a', label: 'test profile', softwareRendering: true },
    scenario: { id: 'instanced-static', version: overrides.version ?? 1, params, paramsHash: paramsHash(params) },
    protocol: { name: overrides.protocol ?? 'smoke', warmupMs: 1000, durationMs: 2000, repeats: 2 },
    metrics: { 'cpuFrameMs.p50': cpu, 'cpuFrameMs.p95': cpu * 1.5, 'renderCpuMs.p50': overrides.render ?? cpu / 2, 'frameIntervalMs.p95': 16.7 },
    repeatP50: { cpuFrameMs: overrides.repeats ?? [cpu, cpu] },
    checks: { passed: overrides.passed ?? true, failed: [] },
    valid: overrides.valid ?? true,
    invalidReasons: [],
  };
}

test.describe('perf-history', () => {
  test('canonicalJson and paramsHash ignore key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
    expect(paramsHash({ count: 5, spacing: 1 })).toBe(paramsHash({ spacing: 1, count: 5 }));
    expect(paramsHash({ count: 5 })).not.toBe(paramsHash({ count: 6 }));
  });

  test('comparisonKey separates profile, scenario version, params and protocol', () => {
    const base = comparisonKey(entry());
    expect(comparisonKey(entry())).toBe(base);
    expect(comparisonKey(entry({ profileId: 'profile-b' }))).not.toBe(base);
    expect(comparisonKey(entry({ version: 2 }))).not.toBe(base);
    expect(comparisonKey(entry({ params: { count: 2000 } }))).not.toBe(base);
    expect(comparisonKey(entry({ protocol: 'reference' }))).not.toBe(base);
  });

  test('no comparable history yields no-baseline', () => {
    const result = compareToHistory(entry(), [entry({ profileId: 'other' }), entry({ params: { count: 5 } })]);
    expect(result.verdict).toBe('no-baseline');
    expect(result.baselineEntries).toBe(0);
  });

  test('a slowdown beyond both tolerances regresses against the median baseline', () => {
    const history = [entry({ cpu: 4 }), entry({ cpu: 4.2 }), entry({ cpu: 10 /* outlier ignored by median */ })];
    const result = compareToHistory(entry({ cpu: 6, repeats: [6, 6.1] }), history);
    expect(result.verdict).toBe('regressed');
    const cpu = result.metrics.find((metric) => metric.metric === 'cpuFrameMs.p50')!;
    expect(cpu.baseline).toBe(4.2);
    expect(cpu.verdict).toBe('regressed');
    expect(result.summary).toContain('REGRESSED');
  });

  test('changes inside tolerance are unchanged; the absolute floor protects tiny baselines', () => {
    expect(compareToHistory(entry({ cpu: 4.4 }), [entry({ cpu: 4 })]).verdict).toBe('unchanged');
    // +100% but only +0.2 ms, below the 0.5 ms smoke floor.
    expect(compareToHistory(entry({ cpu: 0.4, render: 0.2 }), [entry({ cpu: 0.2, render: 0.1 })]).verdict).toBe('unchanged');
  });

  test('a speed-up is reported as improved', () => {
    expect(compareToHistory(entry({ cpu: 2 }), [entry({ cpu: 4 }), entry({ cpu: 4 })]).verdict).toBe('improved');
  });

  test('noisy repeats downgrade a regression to inconclusive', () => {
    const result = compareToHistory(entry({ cpu: 6, repeats: [3, 9] }), [entry({ cpu: 4 })]);
    expect(result.verdict).toBe('inconclusive');
    expect(result.noise!.cv).toBeGreaterThan(0.15);
  });

  test('invalid, failing and same-run entries never serve as baseline', () => {
    const candidate = entry({ cpu: 6, runId: 'same' });
    const history = [entry({ cpu: 1, valid: false }), entry({ cpu: 1, passed: false }), entry({ cpu: 1, runId: 'same' })];
    expect(compareToHistory(candidate, history).verdict).toBe('no-baseline');
  });

  test('only the most recent window of entries forms the baseline', () => {
    const history = [...Array.from({ length: 5 }, () => entry({ cpu: 10 })), ...Array.from({ length: 5 }, () => entry({ cpu: 4 }))];
    const result = compareToHistory(entry({ cpu: 4 }), history, { window: 5 });
    expect(result.verdict).toBe('unchanged');
    expect(result.baselineEntries).toBe(5);
  });

  test('custom scenario p50 metrics are compared automatically', () => {
    const withCustom = (value: number) => {
      const item = entry();
      item.metrics['custom.scenarioUpdateMs.p50'] = value;
      return item;
    };
    const result = compareToHistory(withCustom(8), [withCustom(4)]);
    expect(result.metrics.map((metric) => metric.metric)).toContain('custom.scenarioUpdateMs.p50');
    expect(result.verdict).toBe('regressed');
  });

  test('append and read round-trip JSON lines and skip malformed lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-history-'));
    const file = path.join(dir, 'nested', 'history.jsonl');
    appendHistory(file, entry({ cpu: 1 }));
    fs.appendFileSync(file, 'not json');
    appendHistory(file, entry({ cpu: 2 }));
    const { entries, skippedLines } = readHistory(file);
    expect(entries.map((item) => item.metrics['cpuFrameMs.p50'])).toEqual([1, 2]);
    expect(skippedLines).toBe(1);
    expect(fs.readFileSync(file, 'utf8').endsWith('\n')).toBe(true);
    expect(readHistory(path.join(dir, 'missing.jsonl'))).toEqual({ entries: [], skippedLines: 0 });
  });

  test('profiles hash stable identity and ignore browser patch versions', () => {
    const input = {
      host: { os: 'linux', osRelease: '6', arch: 'x64', cpuModel: 'cpu', cpuCount: 8, totalMemoryGb: 16, node: 'v22', ci: false },
      browser: { name: 'chromium', version: '140.0.1', headless: true, frameRateCap: 'uncapped-flags' as const },
      gpu: { vendor: 'Google', renderer: 'ANGLE (SwiftShader)', softwareRendering: true },
      viewport: { width: 1280, height: 720, dpr: 1 },
    };
    const a = buildProfile(input);
    expect(buildProfile({ ...input, browser: { ...input.browser, version: '140.9.9' } }).id).toBe(a.id);
    expect(buildProfile({ ...input, browser: { ...input.browser, version: '141.0.0' } }).id).not.toBe(a.id);
    expect(buildProfile({ ...input, host: { ...input.host, osRelease: '7', node: 'v24' } }).id).toBe(a.id);
    expect(a.label).toContain('software-gl');
  });

  test('software renderers are detected', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
  });
});
