import { TestSession, buildTestLaunchUrl, parseTestLaunch, validateTestHistory, type TestSuite } from 'triangular-engine/testing';
import {
  createAtmosphereLabTestAdapter, stateMismatches, sweepMorphAt, sweepTraceProblems,
  type AtmosphereFrameSummary, type AtmosphereLabSnapshot, type AtmosphereLabTestHost,
} from './atmosphere-lab-test-adapter';
import { ATMOSPHERE_LAB_TEST_HISTORY, type AtmosphereLabTestSettings } from './atmosphere-lab-tests';

/** Frames come from a 16 ms timer. A morph handed over by a run takes effect on the following frame, like the page's tick. */
class FakeHost implements AtmosphereLabTestHost {
  state: AtmosphereLabSnapshot = {
    state: {
      bentOn: false, planetRadiusM: 600_000, preset: 'mars', projection: 'equirect', skyPath: 'table', maskEnabled: false,
      dayNight: 'alwaysDay', morph: 0.3, anchor: [0.1, 0.2], altitudeM: 1234, yawDeg: 12, pitchDeg: 5,
      sunElevationDeg: 10, sunAzimuthDeg: 20, exposure: 3,
    },
    sweep: true, animateSun: true,
  };
  frames = 0;
  sampling = false;
  error = '';
  baking = 0;
  masked = true;
  gpuSupported = true;
  environmentValues: Record<string, string | number | boolean | null> = { softwareRenderer: false };
  readonly before = new Set<() => void>();
  readonly render = new Set<(at: number) => void>();
  private pendingMorph: number | undefined;
  private readonly timer = setInterval(() => {
    for (const callback of [...this.before]) callback();
    if (this.pendingMorph !== undefined) this.state = { ...this.state, state: { ...this.state.state, morph: this.pendingMorph } };
    if (this.baking > 0) this.baking--;
    this.frames++;
    for (const callback of [...this.render]) callback(performance.now());
  }, 16);

  dispose(): void { clearInterval(this.timer); }
  read(): AtmosphereLabSnapshot { return this.state; }
  apply(settings: AtmosphereLabTestSettings): void {
    const { kind: _kind, morphKeys, expectMaskedPass: _expect, ...rest } = settings;
    this.state = {
      state: { ...rest, bentOn: true, morph: morphKeys[0], projection: settings.projection },
      sweep: false, animateSun: false,
    };
    this.pendingMorph = morphKeys[0];
    this.baking = 3;
  }
  setMorphFrame(morph: number): void { this.pendingMorph = morph; }
  restore(snapshot: AtmosphereLabSnapshot): void { this.pendingMorph = undefined; this.state = snapshot; }
  renderedFrames(): number { return this.frames; }
  isBaking(): boolean { return this.baking > 0; }
  maskedPassActive(): boolean { return this.masked; }
  errors(): string { return this.error; }
  resetErrors(): void { this.error = ''; }
  onBeforeRender(callback: () => void): () => void { this.before.add(callback); return () => this.before.delete(callback); }
  onRenderComplete(callback: (at: number) => void): () => void { this.render.add(callback); return () => this.render.delete(callback); }
  gpuTimestampsSupported(): boolean { return this.gpuSupported; }
  isSampling(): boolean { return this.sampling; }
  startSampling(): void { this.sampling = true; }
  stopSampling(): AtmosphereFrameSummary {
    this.sampling = false;
    return { frames: 90, cpuMedianMs: 2, cpuP95Ms: 3, wallMedianMs: 16, wallP95Ms: 18, invalidReasons: [], verdict: 'ok' };
  }
  environment(): Record<string, string | number | boolean | null> { return this.environmentValues; }
}

const quick = (suite: TestSuite<AtmosphereLabTestSettings>, ...ids: string[]): TestSuite<AtmosphereLabTestSettings> => ({
  ...suite,
  scenarios: suite.scenarios.filter((scenario) => ids.includes(scenario.id))
    .map((scenario) => ({ ...scenario, durationMs: 400, warmupMs: 0 })),
});

const [LOOK, , COST] = ATMOSPHERE_LAB_TEST_HISTORY;

describe('atmosphere lab tests', () => {
  let host: FakeHost;
  beforeEach(() => { host = new FakeHost(); });
  afterEach(() => host.dispose());

  describe('history', () => {
    it('is a valid append-only history ending with the cost suite', () => {
      expect(() => validateTestHistory(ATMOSPHERE_LAB_TEST_HISTORY)).not.toThrow();
      expect(ATMOSPHERE_LAB_TEST_HISTORY.map((suite) => `${suite.id}@${suite.version}:${suite.purpose}`)).toEqual([
        'bent-atmosphere-look@1:functional', 'bent-atmosphere-cost@1:performance', 'bent-atmosphere-cost@2:performance']);
      expect(LOOK.requiresVisualReview).toBeTrue();
    });

    it('covers the three open Plan 049 look checks with resolved numbers', () => {
      const byId = new Map(LOOK.scenarios.map((scenario) => [scenario.id, scenario.settings]));
      expect(byId.get('scrub-equirect')?.morphKeys).toEqual([0, 1, 0]);
      expect(byId.get('equal-earth-low-morph')?.morphKeys).toEqual([0.05, 0.3, 0.05]);
      expect(byId.get('equal-earth-low-morph')?.projection).toBe('equalEarth');
      expect(byId.get('rim-glow-equal-earth')?.anchor).toEqual([0.9, 0]);
      for (const suite of ATMOSPHERE_LAB_TEST_HISTORY) for (const scenario of suite.scenarios) {
        const s = scenario.settings;
        for (const value of [s.altitudeM, s.yawDeg, s.pitchDeg, s.sunElevationDeg, s.sunAzimuthDeg, s.exposure, ...s.anchor, ...s.morphKeys]) {
          expect(Number.isFinite(value)).withContext(scenario.id).toBeTrue();
        }
        expect(s.morphKeys.length).withContext(scenario.id).toBe(s.kind === 'sweep' ? 3 : 1);
      }
    });

    it('builds and parses exact-version and latest launch links', () => {
      const base = 'http://triangular-demo.localhost:4200/atmosphere-lab';
      const url = buildTestLaunchUrl(base, LOOK, 'human-observed', 1);
      expect(url).toBe(`${base}?testSuite=bent-atmosphere-look&testVersion=1&testProfile=human-observed&testMode=standard&testRepetitions=1&testAutoStart=1`);
      expect(parseTestLaunch(new URL(url), ATMOSPHERE_LAB_TEST_HISTORY)?.key).toBe('bent-atmosphere-look@1');
      expect(parseTestLaunch(new URL(`${base}?testSuite=latest&testAutoStart=1`), ATMOSPHERE_LAB_TEST_HISTORY)?.key).toBe('bent-atmosphere-cost@2');
    });
  });

  describe('sweep and state helpers', () => {
    const keys = [0.05, 0.3, 0.05];
    it('hits the keyframes exactly and turns once', () => {
      expect(sweepMorphAt(keys, 0).morph).toBe(0.05);
      expect(sweepMorphAt(keys, 0.5).morph).toBeCloseTo(0.3, 12);
      expect(sweepMorphAt(keys, 1).morph).toBeCloseTo(0.05, 12);
      const trace = Array.from({ length: 101 }, (_, i) => sweepMorphAt(keys, i / 100).morph);
      expect(sweepTraceProblems(keys, trace)).toEqual([]);
    });
    it('flags a sweep that never arrives or is empty', () => {
      expect(sweepTraceProblems(keys, [0.05, 0.1, 0.2])).toContain('final 0.2 is not 0.05');
      expect(sweepTraceProblems(keys, [])).toEqual(['no sweep frames recorded']);
    });
    it('names every field the page did not honour', () => {
      const settings = LOOK.scenarios[1].settings;
      const applied = { ...host.state.state, ...settings, bentOn: true, morph: 0 };
      expect(stateMismatches(applied, settings)).toEqual([]);
      expect(stateMismatches({ ...applied, projection: 'equirect', altitudeM: 5 }, settings)).toEqual([
        `altitudeM: expected ${settings.altitudeM}, found 5`, 'projection: expected equalEarth, found equirect']);
      expect(stateMismatches({ ...applied, bentOn: false }, settings)).toContain('bent planet is off, expected on');
      expect(stateMismatches({ ...applied, bentOn: false }, { ...settings, bentOn: false })).toEqual([]);
      expect(stateMismatches(applied, { ...settings, bentOn: false })).toContain('bent planet is on, expected off');
    });
  });

  describe('adapter run', () => {
    it('applies each scenario, checks the real state and restores every captured field', async () => {
      const before = host.state;
      const suite = quick(LOOK, 'rim-glow-equal-earth', 'equal-earth-low-morph');
      const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
        suite, createAtmosphereLabTestAdapter(host), { repetitions: 1, profile: 'headless-hardware' });
      expect(result.errors).toEqual([]);
      expect(result.status).toBe('completed');
      expect(result.automatedVerdict).toBe('pass');
      expect(result.visualReview).toBe('pending');
      expect(result.cases.map((item) => item.checks.every((check) => check.passed))).toEqual([true, true]);
      expect(result.cases[1].checks.map((check) => check.name)).toContain('Masked pass active as expected');
      expect(result.cases[0].checks.find((check) => check.name === 'Morph reached its final state')?.detail).toMatch(/animation steps/);
      expect(result.cases[0].metrics.map((metric) => metric.name)).toEqual([
        'frameInterval', 'gpuScenePass', 'gpuFullscreenPasses', 'gpuOutputPass', 'gpuPassTotal']);
      expect(host.state).toEqual(before);
      expect(host.before.size).toBe(0);
      expect(host.render.size).toBe(0);
      expect(host.sampling).toBeFalse();
    }, 20_000);

    it('fails when the masked pass is off where the camera is above the air', async () => {
      host.masked = false;
      const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
        quick(LOOK, 'rim-glow-equirect'), createAtmosphereLabTestAdapter(host), { repetitions: 1, profile: 'headless-hardware' });
      const check = result.cases[0].checks.find((item) => item.name === 'Masked pass active as expected');
      expect(check?.passed).toBeFalse();
      expect(result.status).toBe('failed');
    }, 20_000);

    it('lists GPU time as an unavailable optional metric when the backend has no timestamp query', async () => {
      host.gpuSupported = false;
      const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
        quick(COST, 'auto-m0-space'), createAtmosphereLabTestAdapter(host), { repetitions: 1, profile: 'visible-browser' });
      const gpu = result.cases[0].metrics.find((metric) => metric.name === 'gpuPassTotal');
      expect(gpu?.optional).toBeTrue();
      expect(gpu?.unavailableReason).toBe('This backend has no GPU timestamp query');
    }, 20_000);

    it('surfaces an error during readiness as a failed case and still restores', async () => {
      const before = host.state;
      const adapter = createAtmosphereLabTestAdapter(host);
      const apply = adapter.apply.bind(adapter);
      adapter.apply = (scenario, context) => { apply(scenario, context); host.error = 'Pipeline: boom'; };
      const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
        quick(LOOK, 'rim-glow-equirect'), adapter, { repetitions: 1, profile: 'headless-hardware' });
      expect(result.status).toBe('failed');
      expect(result.cases[0].error).toContain('Pipeline: boom');
      expect(host.state).toEqual(before);
    }, 20_000);

    it('cancels in the middle of a sweep, stops listening and restores the captured state', async () => {
      const before = host.state;
      const cancel = new AbortController();
      const adapter = createAtmosphereLabTestAdapter(host);
      const measure = adapter.measure.bind(adapter);
      adapter.measure = (scenario, context) => { setTimeout(() => cancel.abort(), 100); return measure(scenario, context); };
      const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
        quick(LOOK, 'scrub-equirect'), adapter, { repetitions: 1, profile: 'headless-hardware' }, () => {}, cancel.signal);
      expect(result.status).toBe('cancelled');
      expect(host.state).toEqual(before);
      expect(host.before.size).toBe(0);
      expect(host.render.size).toBe(0);
      expect(host.sampling).toBeFalse();
    }, 20_000);

    it('labels a software renderer as invalid performance evidence and never as a pass', async () => {
      host.environmentValues = { softwareRenderer: true, gpuRenderer: 'SwiftShader' };
      const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
        quick(COST, 'auto-m0-low-orbit'), createAtmosphereLabTestAdapter(host), { repetitions: 1, profile: 'visible-browser' });
      expect(result.cases[0].validityIssues).toContain('Software renderer: functional evidence only, not hardware performance');
      expect(result.performanceVerdict).toBe('inconclusive');
    }, 20_000);
  });
});
