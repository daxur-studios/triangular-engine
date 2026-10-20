import type { TestMode, TestProfile, TestSuite } from './test-contracts';

/** Keep repeated runs bounded even when selection originates from an external link. */
export const MAX_TEST_REPETITIONS = 5;
export const TEST_PROFILES: readonly TestProfile[] = ['visible-browser', 'human-observed', 'headless-hardware'];
export const TEST_MODES: readonly TestMode[] = ['quick', 'standard', 'soak'];

/** Reject values that JSON would drop or alter before retaining immutable launch evidence. */
function validateSettings(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Test settings must be finite, acyclic JSON data');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Test settings must be plain JSON data');
  ancestors.add(value);
  for (const item of Object.values(value)) validateSettings(item, ancestors);
  ancestors.delete(value);
}

export function testSuiteKey(suite: Pick<TestSuite<object>, 'id' | 'version'>): string {
  return `${suite.id}@${suite.version}`;
}

/** Reject ambiguous identities before selecting latest or starting any application work. */
export function validateTestHistory<T extends object>(suites: readonly TestSuite<T>[]): void {
  const keys = new Set<string>();
  for (const suite of suites) {
    const key = testSuiteKey(suite);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(suite.id) || !Number.isSafeInteger(suite.version) || suite.version < 1 || keys.has(key)) {
      throw new Error(`Invalid or duplicate test suite: ${key}`);
    }
    keys.add(key);
    if (!suite.scenarios.length) throw new Error(`Empty test suite: ${key}`);
    const ids = new Set<string>();
    for (const scenario of suite.scenarios) {
      if (!scenario.id || ids.has(scenario.id) || !Number.isFinite(scenario.durationMs) || scenario.durationMs <= 0 ||
          !Number.isFinite(scenario.warmupMs ?? 0) || (scenario.warmupMs ?? 0) < 0) {
        throw new Error(`Invalid or duplicate scenario in ${key}: ${scenario.id}`);
      }
      ids.add(scenario.id);
      validateSettings(scenario.settings);
      if (scenario.ablation && (!suite.ablation || !scenario.ablation.group || !['A', 'B'].includes(scenario.ablation.arm))) {
        throw new Error(`Ablation round without a suite ablation, group or arm in ${key}: ${scenario.id}`);
      }
    }
    if (suite.ablation && (!suite.ablation.metrics.length || !suite.scenarios.some((scenario) => scenario.ablation))) {
      throw new Error(`Ablation suite without metrics or rounds: ${key}`);
    }
  }
}

export interface TestLaunchSelection {
  readonly key: string;
  readonly profile: TestProfile;
  readonly mode: TestMode;
  readonly repetitions: number;
  readonly autoStart: boolean;
  /** `testThumbnails=0` turns the adapter's thumbnails off; they are on otherwise. */
  readonly thumbnails: boolean;
}

/** A URL selects registered data only; it cannot provide executable commands or arbitrary settings. */
export function parseTestLaunch<T extends object>(url: URL, suites: readonly TestSuite<T>[]): TestLaunchSelection | null {
  validateTestHistory(suites);
  const query = url.searchParams;
  const allowed = new Set(['testSuite', 'testVersion', 'testProfile', 'testRepetitions', 'testAutoStart', 'testMode', 'testThumbnails']);
  const seen = new Set<string>();
  query.forEach((_, key) => {
    if (key.startsWith('test') && (!allowed.has(key) || seen.has(key))) throw new Error(`Unknown or duplicate test parameter: ${key}`);
    seen.add(key);
  });
  const id = query.get('testSuite');
  if (id === null) {
    let hasTestParameter = false;
    query.forEach((_, key) => { if (key.startsWith('test')) hasTestParameter = true; });
    if (hasTestParameter) throw new Error('testSuite is required');
    return null;
  }
  const version = query.get('testVersion');
  const suite = id === 'latest' ? suites.at(-1) : suites.find((item) => item.id === id && String(item.version) === version);
  if (!suite || (id === 'latest' && version !== null)) throw new Error('Unknown test suite/version');
  const profile = query.get('testProfile') ?? 'visible-browser';
  const repetitions = Number(query.get('testRepetitions') ?? '1');
  const autoStart = query.get('testAutoStart') ?? '0';
  const mode = query.get('testMode') ?? 'standard';
  const thumbnails = query.get('testThumbnails') ?? '1';
  if (!TEST_MODES.includes(mode as TestMode)) throw new Error('Invalid test mode');
  if (!TEST_PROFILES.includes(profile as TestProfile) || !Number.isInteger(repetitions) ||
      repetitions < 1 || repetitions > MAX_TEST_REPETITIONS || !['0', '1'].includes(autoStart) || !['0', '1'].includes(thumbnails)) {
    throw new Error('Invalid test profile, repetitions, autostart or thumbnails');
  }
  return { key: testSuiteKey(suite), profile: profile as TestProfile, mode: mode as TestMode, repetitions, autoStart: autoStart === '1', thumbnails: thumbnails === '1' };
}

/** Exact-version evidence links retain the host's backend flags while replacing runner selection. */
export function buildTestLaunchUrl(
  base: string, suite: Pick<TestSuite<object>, 'id' | 'version'>, profile: TestProfile, repetitions: number, mode: TestMode = 'standard',
  thumbnails = true,
): string {
  const url = new URL(base);
  url.searchParams.set('testSuite', suite.id);
  url.searchParams.set('testVersion', String(suite.version));
  url.searchParams.set('testProfile', profile);
  url.searchParams.set('testMode', mode);
  url.searchParams.set('testRepetitions', String(repetitions));
  if (!thumbnails) url.searchParams.set('testThumbnails', '0');
  else url.searchParams.delete('testThumbnails');
  url.searchParams.set('testAutoStart', '1');
  return url.toString();
}
