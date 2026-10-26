import type { TestBatchTest, TestLoad, TestMode, TestProfile, TestSuite } from './test-contracts';

/** Keep repeated runs bounded even when selection originates from an external link. */
export const MAX_TEST_REPETITIONS = 5;
export const TEST_PROFILES: readonly TestProfile[] = ['visible-browser', 'human-observed', 'headless-hardware'];
export const TEST_MODES: readonly TestMode[] = ['quick', 'standard', 'soak'];
export const TEST_LOADS: readonly TestLoad[] = ['clean', 'noisy'];
/** Most cases one `testCases` link may name. */
export const MAX_TEST_CASES = 50;
const QUALIFIED_CASE = /^([a-z0-9][a-z0-9-]*)@([1-9][0-9]*)\/(.+)$/;

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
          !Number.isFinite(scenario.warmupMs ?? 0) || (scenario.warmupMs ?? 0) < 0 ||
          (scenario.quickMs !== undefined && !(scenario.quickMs > 0 && scenario.quickMs <= scenario.durationMs))) {
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
  /** `testLoad=noisy|clean`; absent when the link does not say. It is only recorded in the result. */
  readonly load?: TestLoad;
  readonly repetitions: number;
  readonly autoStart: boolean;
  /** `testThumbnails=0` turns the adapter's thumbnails off; they are on otherwise. */
  readonly thumbnails: boolean;
  /** The cases named by `testCases`, in link order. Absent when the link has no `testCases`. */
  readonly cases?: readonly TestBatchTest[];
}

/** Resolves the `testCases` list against the registered history; every entry must name a registered scenario. */
function parseTestCases<T extends object>(raw: string, suite: TestSuite<T>, suites: readonly TestSuite<T>[]): readonly TestBatchTest[] {
  const entries = raw.split(',');
  if (entries.length > MAX_TEST_CASES) throw new Error(`testCases names more than ${MAX_TEST_CASES} cases`);
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (!entry) throw new Error('testCases has an empty entry');
    const match = QUALIFIED_CASE.exec(entry);
    const owner = match ? suites.find((item) => item.id === match[1] && String(item.version) === match[2]) : suite;
    const scenarioId = match ? match[3] : entry;
    if (!owner) throw new Error(`testCases names an unknown suite: ${entry}`);
    if (!owner.scenarios.some((scenario) => scenario.id === scenarioId)) throw new Error(`testCases names an unknown case: ${entry}`);
    const key = `${testSuiteKey(owner)}/${scenarioId}`;
    if (seen.has(key)) throw new Error(`testCases repeats a case: ${entry}`);
    seen.add(key);
    return { suiteId: owner.id, suiteVersion: owner.version, scenarioId };
  });
}

/** A URL selects registered data only; it cannot provide executable commands or arbitrary settings. */
export function parseTestLaunch<T extends object>(url: URL, suites: readonly TestSuite<T>[]): TestLaunchSelection | null {
  validateTestHistory(suites);
  const query = url.searchParams;
  const allowed = new Set(['testSuite', 'testVersion', 'testProfile', 'testRepetitions', 'testAutoStart', 'testMode', 'testThumbnails', 'testCases', 'testLoad']);
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
  const load = query.get('testLoad');
  if (!TEST_MODES.includes(mode as TestMode)) throw new Error('Invalid test mode');
  if (load !== null && !TEST_LOADS.includes(load as TestLoad)) throw new Error('Invalid test load');
  if (!TEST_PROFILES.includes(profile as TestProfile) || !Number.isInteger(repetitions) ||
      repetitions < 1 || repetitions > MAX_TEST_REPETITIONS || !['0', '1'].includes(autoStart) || !['0', '1'].includes(thumbnails)) {
    throw new Error('Invalid test profile, repetitions, autostart or thumbnails');
  }
  const rawCases = query.get('testCases');
  const cases = rawCases === null ? undefined : parseTestCases(rawCases, suite, suites);
  return {
    key: testSuiteKey(suite), profile: profile as TestProfile, mode: mode as TestMode, repetitions, autoStart: autoStart === '1', thumbnails: thumbnails === '1',
    ...(load ? { load: load as TestLoad } : {}), ...(cases ? { cases } : {}),
  };
}

/** Exact-version evidence links retain the host's backend flags while replacing runner selection. */
export function buildTestLaunchUrl(
  base: string, suite: Pick<TestSuite<object>, 'id' | 'version'>, profile: TestProfile, repetitions: number, mode: TestMode = 'standard',
  thumbnails = true,
): string {
  const url = new URL(base);
  // A suite link never inherits a batch from the page it was made on.
  url.searchParams.delete('testCases');
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

/**
 * Builds a launch link that runs a chosen list of cases as one batch, in order. The first test's suite and exact
 * version become `testSuite`/`testVersion`; its cases are written as bare scenario ids and cases of other suites as
 * `<suiteId>@<version>/<scenarioId>`. Other query parameters of `base` are kept. `parseTestLaunch` reads it back into
 * `TestLaunchSelection.cases`. Throws for an empty list, more than `MAX_TEST_CASES` tests, or a scenario id containing a comma.
 */
export function buildTestBatchLaunchUrl(
  base: string, tests: readonly TestBatchTest[], profile: TestProfile, repetitions: number, mode: TestMode = 'standard',
  thumbnails = true,
): string {
  const first = tests[0];
  if (!first) throw new Error('A batch link needs at least one test');
  if (tests.length > MAX_TEST_CASES) throw new Error(`A batch link holds at most ${MAX_TEST_CASES} tests`);
  const entries = tests.map((test) => {
    if (test.scenarioId.includes(',')) throw new Error(`Scenario id cannot be used in a link: ${test.scenarioId}`);
    const same = test.suiteId === first.suiteId && test.suiteVersion === first.suiteVersion;
    // A bare id that looks qualified would be read as another suite, so it is written in full.
    return same && !QUALIFIED_CASE.test(test.scenarioId) ? test.scenarioId : `${test.suiteId}@${test.suiteVersion}/${test.scenarioId}`;
  });
  const url = new URL(buildTestLaunchUrl(base, { id: first.suiteId, version: first.suiteVersion }, profile, repetitions, mode, thumbnails));
  url.searchParams.set('testCases', entries.join(','));
  return url.toString();
}
