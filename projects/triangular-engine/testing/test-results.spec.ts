import {
  baselineCandidates, changeKind, compareToBaseline, defaultBaseline, filterRuns, formatChange, formatMetricValue, formatRunDate, imageUrl,
  indexUrl, metricKeys, pairCases, parseTestRunIndex, resultUrl, runCounts, runFilterOptions, splitMetricKey, thumbnailFrames, type TestRunIndexCase,
  type TestRunIndexEntry,
} from './test-results';

const metric = (med: number, p95 = med * 1.1) => ({ n: 100, min: med * 0.9, med, p95, max: p95 * 1.2 });
const scenario = (med: number, extra: Partial<TestRunIndexCase> = {}): TestRunIndexCase =>
  ({ metrics: { 'frameInterval (ms)': metric(med), 'drawCalls (count)': metric(4, 4) }, failed: [], invalid: [], ...extra });

function run(file: string, startedAt: string, extra: Partial<TestRunIndexEntry> = {}): TestRunIndexEntry {
  return {
    savedAt: startedAt, startedAt, suite: 'lab', version: 1, profile: 'visible-browser', runId: file, fingerprint: 'abc-123', head: 'abc',
    status: 'completed', automatedVerdict: 'pass', performanceVerdict: 'unassessed', visualReview: 'not-required', file, errors: [],
    cases: { orbit: scenario(6), ground: scenario(8) }, ...extra,
  };
}

describe('test results model', () => {
  const old = run('lab@v1/a.json', '2026-10-18T10:00:00Z', { mode: 'quick', gpu: 'nvidia', gpuBackend: 'webgpu' });
  const mid = run('lab@v1/b.json', '2026-10-19T10:00:00Z', { mode: 'quick', gpu: 'amd', gpuBackend: 'webgpu' });
  const standard = run('lab@v1/c.json', '2026-10-19T12:00:00Z');
  const newest = run('lab@v1/d.json', '2026-10-20T10:00:00Z', { mode: 'quick', gpu: 'nvidia', gpuBackend: 'webgpu', cases: { orbit: scenario(6.6), ground: scenario(7.6), extra: scenario(1) } });
  const otherVersion = run('lab@v2/e.json', '2026-10-17T10:00:00Z', { version: 2, mode: 'quick' });
  const all = [old, mid, standard, newest, otherVersion];

  it('reads the receiver index newest first and skips lines that are not runs', () => {
    const parsed = parseTestRunIndex({ runs: [old, { nonsense: true }, null, newest, mid] });
    expect(parsed.map((item) => item.file)).toEqual([newest.file, mid.file, old.file]);
    expect(() => parseTestRunIndex({ error: 'x' })).toThrowError(/index/);
    expect(parseTestRunIndex({ runs: [{ ...old, errors: undefined }] })[0].errors).toEqual([]);
    // An index line from an older receiver has no failed or invalid lists, nor metrics for a case without any.
    const legacy = parseTestRunIndex({ runs: [{ ...old, cases: { orbit: { metrics: { 'frameInterval (ms)': metric(6) } }, ground: {} } }] })[0];
    expect(legacy.cases['orbit'].failed).toEqual([]);
    expect(legacy.cases['ground'].metrics).toEqual({});
    expect(runCounts(legacy)).toEqual({ valid: 2, invalid: 0, failed: 0 });
  });

  it('counts scenarios as failed, invalid or valid', () => {
    const counted = run('x', '2026-10-20T10:00:00Z', {
      cases: { a: scenario(1), b: scenario(1, { failed: ['check'] }), c: scenario(1, { invalid: ['lost focus'] }), d: scenario(1, { failed: ['x'], invalid: ['y'] }) },
    });
    expect(runCounts(counted)).toEqual({ valid: 1, invalid: 1, failed: 2 });
  });

  it('filters by suite, mode and GPU, treating a missing mode as standard and a missing GPU as not recorded', () => {
    const options = runFilterOptions(all);
    expect(options.suites).toEqual(['lab']);
    expect(options.modes).toEqual(['quick', 'standard']);
    expect(options.gpus).toEqual(['amd webgpu', 'not recorded', 'nvidia webgpu']);
    expect(filterRuns(all, { suite: '', mode: 'standard', gpu: '' })).toEqual([standard]);
    expect(filterRuns(all, { suite: 'lab', mode: 'quick', gpu: 'nvidia webgpu' }).map((item) => item.file)).toEqual([old.file, newest.file]);
    expect(filterRuns(all, { suite: '', mode: '', gpu: 'not recorded' }).length).toBe(2);
    expect(filterRuns(all, { suite: '', mode: '', gpu: '' }).length).toBe(5);
  });

  it('offers the same suite version in the same mode as baselines and defaults to the previous one', () => {
    expect(baselineCandidates(all, newest).map((item) => item.file)).toEqual([mid.file, old.file]);
    expect(defaultBaseline(all, newest)).toBe(mid);
    expect(defaultBaseline(all, old)).toBeUndefined();
    // A newer run is a valid choice, but never the default.
    expect(baselineCandidates(all, old).map((item) => item.file)).toEqual([newest.file, mid.file]);
    expect(defaultBaseline(all, standard)).toBeUndefined();
  });

  it('compares medians by scenario id and metric, skipping what the baseline lacks', () => {
    const changes = compareToBaseline(newest, old);
    expect(Object.keys(changes)).toEqual(['orbit', 'ground']);
    expect(changes['orbit']['frameInterval (ms)'].change).toBeCloseTo(0.1, 6);
    expect(changes['ground']['frameInterval (ms)'].change).toBeCloseTo(-0.05, 6);
    expect(changes['orbit']['frameInterval (ms)']).toEqual(jasmine.objectContaining({ median: 6.6, baseMedian: 6 }));
    expect(changes['orbit']['drawCalls (count)'].change).toBe(0);
    const zero = compareToBaseline({ cases: { orbit: scenario(1) } }, { cases: { orbit: { metrics: { 'frameInterval (ms)': metric(0, 0) }, failed: [], invalid: [] } } });
    expect(zero['orbit']['frameInterval (ms)'].change).toBeUndefined();
  });

  it('calls a time that grew worse and one that shrank better, outside a 5% band only', () => {
    expect(changeKind(0.1, 'ms')).toBe('worse');
    expect(changeKind(-0.1, 'ms')).toBe('better');
    expect(changeKind(0.04, 'ms')).toBe('same');
    expect(changeKind(0.2, 'count')).toBe('changed');
    expect(changeKind(undefined, 'ms')).toBe('none');
    expect(formatChange(0.1234)).toBe('+12.3%');
    expect(formatChange(-0.05)).toBe('-5.0%');
    expect(formatChange(undefined)).toBe('n/a');
  });

  it('formats values, metric keys and dates', () => {
    expect([0.0451, 1.234, 12.34, 123.4].map(formatMetricValue)).toEqual(['0.045', '1.23', '12.3', '123']);
    expect(splitMetricKey('gpuPassTotal (ms)')).toEqual({ name: 'gpuPassTotal', unit: 'ms' });
    expect(splitMetricKey('odd')).toEqual({ name: 'odd', unit: '' });
    expect(formatRunDate('nonsense')).toBe('unknown date');
    expect(formatRunDate('2026-10-20T10:00:00')).toBe('2026-10-20 10:00');
  });

  it('pairs the scenarios of two runs and lists every metric once', () => {
    expect(pairCases(old, newest).map((row) => [row.id, !!row.a, !!row.b])).toEqual([['orbit', true, true], ['ground', true, true], ['extra', false, true]]);
    expect(metricKeys(old, newest)).toEqual(['frameInterval (ms)', 'drawCalls (count)']);
  });

  it('loops the first repetition of a case thumbnail', () => {
    expect(thumbnailFrames(['s/r/a-r1-0.webp', 's/r/a-r1-1.webp', 's/r/a-r2-0.webp'])).toEqual(['s/r/a-r1-0.webp', 's/r/a-r1-1.webp']);
    expect(thumbnailFrames(['s/r/a-r2-0.webp'])).toEqual(['s/r/a-r2-0.webp']);
    expect(thumbnailFrames(undefined)).toEqual([]);
  });

  it('builds receiver URLs from a path or a full URL', () => {
    expect(indexUrl('/__triangular-test-sink/', 50)).toBe('/__triangular-test-sink/runs?limit=50');
    expect(resultUrl('http://127.0.0.1:4723/__triangular-test-sink', 'lab@v1/a b.json')).toBe('http://127.0.0.1:4723/__triangular-test-sink/run?file=lab%40v1%2Fa%20b.json');
    expect(imageUrl('/sink', 'lab@v1/a/x-r1-0.webp')).toBe('/sink/image?file=lab%40v1%2Fa%2Fx-r1-0.webp');
  });
});
