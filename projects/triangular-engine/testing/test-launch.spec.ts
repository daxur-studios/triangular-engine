import { buildTestLaunchUrl, parseTestLaunch, testSuiteKey, validateTestHistory } from './test-launch';
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
    expect(parseTestLaunch(url, [first])).toEqual({ key: 'reference@1', profile: 'human-observed', repetitions: 3, autoStart: true });
  });

  it('rejects stale identities, unsupported profiles, unbounded repeats and invalid autostart', () => {
    for (const query of [
      'testSuite=reference&testVersion=99', 'testSuite=latest&testVersion=1',
      'testSuite=latest&testProfile=unknown', 'testSuite=latest&testRepetitions=6',
      'testSuite=latest&testRepetitions=1.5', 'testSuite=latest&testAutoStart=yes', 'testAutoStart=1',
      'testSuite=latest&testSuite=reference', 'testSuite=latest&testScript=arbitrary',
    ]) expect(() => parseTestLaunch(new URL(`http://localhost/?${query}`), [first])).toThrow();
  });

  it('rejects ambiguous histories and invalid scenarios before starting', () => {
    expect(() => validateTestHistory([first, first])).toThrow();
    expect(() => validateTestHistory([{ ...first, scenarios: [] }])).toThrow();
    expect(() => validateTestHistory([{ ...first, scenarios: [{ ...first.scenarios[0], durationMs: NaN }] }])).toThrow();
    expect(() => validateTestHistory([{ ...first, scenarios: [{ ...first.scenarios[0], settings: { invalid: Infinity } }] }])).toThrow();
    expect(parseTestLaunch(new URL('http://localhost/?backend=webgl2'), [first])).toBeNull();
  });
});
