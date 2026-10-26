import { buildTestBatchLaunchUrl, buildTestLaunchUrl, MAX_TEST_CASES, parseTestLaunch, testSuiteKey, validateTestHistory } from './test-launch';
import type { TestSuite } from './test-contracts';

const first: TestSuite<{ enabled: boolean }> = {
  id: 'reference', version: 1, title: 'Original', purpose: 'functional',
  scenarios: [{ id: 'check', label: 'Check', settings: { enabled: false }, durationMs: 1 }],
};
const latest = { ...first, version: 2, title: 'Latest' };

describe('test launch selection', () => {
  it('pins exact history versions while latest follows append order', () => {
    const history = [first, latest];
    expect(parseTestLaunch(new URL('http://localhost/?testSuite=latest&testAutoStart=1'), history)?.key).toBe('reference@2');
    expect(parseTestLaunch(new URL('http://localhost/?testSuite=reference&testVersion=1'), history)?.key).toBe('reference@1');
    expect(testSuiteKey(first)).toBe('reference@1');
  });

  it('round-trips bounded options and preserves backend flags', () => {
    const url = new URL(buildTestLaunchUrl('http://localhost/lab?backend=webgl2', first, 'human-observed', 3));
    expect(url.searchParams.get('backend')).toBe('webgl2');
    expect(parseTestLaunch(url, [first])).toEqual({ key: 'reference@1', profile: 'human-observed', mode: 'standard', repetitions: 3, autoStart: true, thumbnails: true });
    const quick = new URL(buildTestLaunchUrl('http://localhost/lab', first, 'visible-browser', 1, 'quick'));
    expect(parseTestLaunch(quick, [first])?.mode).toBe('quick');
    // Thumbnails are on unless the link says otherwise, and an on link stays free of the parameter.
    expect(url.searchParams.has('testThumbnails')).toBeFalse();
    const off = new URL(buildTestLaunchUrl('http://localhost/lab?testThumbnails=1', first, 'visible-browser', 1, 'quick', false));
    expect(off.searchParams.get('testThumbnails')).toBe('0');
    expect(parseTestLaunch(off, [first])?.thumbnails).toBeFalse();
    // Links saved before modes existed run as standard.
    expect(parseTestLaunch(new URL('http://localhost/?testSuite=latest'), [first])?.mode).toBe('standard');
  });

  it('rejects stale identities, unsupported profiles, unbounded repeats and invalid autostart', () => {
    for (const query of [
      'testSuite=reference&testVersion=99', 'testSuite=latest&testVersion=1',
      'testSuite=latest&testProfile=unknown', 'testSuite=latest&testRepetitions=6',
      'testSuite=latest&testRepetitions=1.5', 'testSuite=latest&testAutoStart=yes', 'testAutoStart=1',
      'testSuite=latest&testSuite=reference', 'testSuite=latest&testScript=arbitrary', 'testSuite=latest&testMode=fast', 'testSuite=latest&testThumbnails=2',
    ]) expect(() => parseTestLaunch(new URL(`http://localhost/?${query}`), [first])).toThrow();
  });

  describe('testCases', () => {
    const multi: TestSuite<{ enabled: boolean }> = {
      ...first, scenarios: [first.scenarios[0], { ...first.scenarios[0], id: 'other' }, { ...first.scenarios[0], id: 'third' }],
    };
    const other: TestSuite<{ enabled: boolean }> = { ...first, id: 'second-suite', version: 3, scenarios: [{ ...first.scenarios[0], id: 'zoom' }] };
    const history = [multi, other];
    const parse = (query: string, suites = history) => parseTestLaunch(new URL(`http://localhost/?${query}`), suites);
    const test = (suiteId: string, suiteVersion: number, scenarioId: string) => ({ suiteId, suiteVersion, scenarioId });

    it('resolves bare, qualified and mixed entries in link order, and omits cases without the parameter', () => {
      expect(parse('testSuite=reference&testVersion=1&testCases=other,check')?.cases).toEqual([test('reference', 1, 'other'), test('reference', 1, 'check')]);
      expect(parse('testSuite=reference&testVersion=1&testCases=second-suite@3/zoom')?.cases).toEqual([test('second-suite', 3, 'zoom')]);
      expect(parse('testSuite=reference&testVersion=1&testCases=third,second-suite@3/zoom,reference@1/check')?.cases)
        .toEqual([test('reference', 1, 'third'), test('second-suite', 3, 'zoom'), test('reference', 1, 'check')]);
      expect(parse('testSuite=reference&testVersion=1')?.cases).toBeUndefined();
      expect('cases' in parse('testSuite=reference&testVersion=1')!).toBeFalse();
    });

    it('resolves bare ids against latest', () => {
      expect(parse('testSuite=latest&testCases=zoom')?.cases).toEqual([test('second-suite', 3, 'zoom')]);
    });

    it('rejects unknown, empty, repeated and too many entries', () => {
      const base = 'testSuite=reference&testVersion=1&testCases=';
      for (const cases of ['missing', 'check,missing', 'zoom', 'nope@1/check', 'second-suite@9/zoom', 'second-suite@3/check', '', 'check,', ',check', 'check,,other', 'check,check', 'check,reference@1/check']) {
        expect(() => parse(base + encodeURIComponent(cases))).toThrow();
      }
      expect(() => parse('testCases=check')).toThrow();
      expect(() => parse(`${base}check&testCases=other`)).toThrow();
      const many = Array.from({ length: MAX_TEST_CASES + 1 }, (_, index) => `s${index}`);
      const wide = { ...first, scenarios: many.map((id) => ({ ...first.scenarios[0], id })) };
      expect(parse(base + many.slice(0, MAX_TEST_CASES).join(','), [wide])?.cases?.length).toBe(MAX_TEST_CASES);
      expect(() => parse(base + many.join(','), [wide])).toThrowError(/more than/);
    });

    it('round-trips through the batch builder and keeps the suite link free of cases', () => {
      const tests = [test('reference', 1, 'third'), test('second-suite', 3, 'zoom'), test('reference', 1, 'check')];
      const link = buildTestBatchLaunchUrl('http://localhost/lab?backend=webgl2', tests, 'human-observed', 2, 'quick', false);
      const url = new URL(link);
      expect(url.searchParams.get('testSuite')).toBe('reference');
      expect(url.searchParams.get('testVersion')).toBe('1');
      expect(url.searchParams.get('testCases')).toBe('third,second-suite@3/zoom,check');
      expect(url.searchParams.get('backend')).toBe('webgl2');
      expect(parseTestLaunch(url, history)).toEqual({
        key: 'reference@1', profile: 'human-observed', mode: 'quick', repetitions: 2, autoStart: true, thumbnails: false, cases: tests,
      });
      expect(new URL(buildTestLaunchUrl(link, multi, 'visible-browser', 1)).searchParams.has('testCases')).toBeFalse();
      expect(() => buildTestBatchLaunchUrl('http://localhost/', [], 'visible-browser', 1)).toThrow();
      expect(() => buildTestBatchLaunchUrl('http://localhost/', [test('reference', 1, 'a,b')], 'visible-browser', 1)).toThrow();
    });
  });

  it('rejects ambiguous histories and invalid scenarios before starting', () => {
    expect(() => validateTestHistory([first, first])).toThrow();
    expect(() => validateTestHistory([{ ...first, scenarios: [] }])).toThrow();
    expect(() => validateTestHistory([{ ...first, scenarios: [{ ...first.scenarios[0], durationMs: NaN }] }])).toThrow();
    expect(() => validateTestHistory([{ ...first, scenarios: [{ ...first.scenarios[0], settings: { invalid: Infinity } }] }])).toThrow();
    const scenario = first.scenarios[0];
    expect(() => validateTestHistory([{ ...first, scenarios: [{ ...scenario, quickMs: scenario.durationMs + 1 }] }])).toThrow();
    expect(() => validateTestHistory([{ ...first, scenarios: [{ ...scenario, quickMs: 0 }] }])).toThrow();
    expect(() => validateTestHistory([{ ...first, scenarios: [{ ...scenario, quickMs: scenario.durationMs }] }])).not.toThrow();
    expect(parseTestLaunch(new URL('http://localhost/?backend=webgl2'), [first])).toBeNull();
    const round = { ...first.scenarios[0], ablation: { group: 'g', arm: 'A' as const } };
    expect(() => validateTestHistory([{ ...first, scenarios: [round] }])).toThrowError(/Ablation round/);
    expect(() => validateTestHistory([{ ...first, ablation: { feature: 'f', metrics: [] }, scenarios: [round] }])).toThrowError(/Ablation suite/);
    expect(() => validateTestHistory([{ ...first, ablation: { feature: 'f', metrics: ['m'] }, scenarios: [round] }])).not.toThrow();
  });
});
