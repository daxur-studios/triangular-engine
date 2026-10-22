import { TestSession, buildTestLaunchUrl, parseTestLaunch, validateTestHistory, type TestSuite } from 'triangular-engine/testing';
import {
  createAtmosphereLabTestAdapter, stateMismatches, sweepMorphAt, sweepTraceProblems,
  type AtmosphereFrameSummary, type AtmosphereLabSnapshot, type AtmosphereLabTestHost,
} from './atmosphere-lab-test-adapter';
import type { CheckFrames } from './atmosphere-lab-image-checks';
import { syntheticFrames } from './atmosphere-lab-image-checks.testing';
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
  /** What `readCheckFrames` returns; a test swaps it to show a defect the checks must catch. */
  checkFrames: () => CheckFrames = () => syntheticFrames(this.state.state);
  checkFrameReads = 0;
  thumbnails = 0;
  environmentValues: Record<string, string | number | boolean | null> = { softwareRenderer: false };
  readonly before = new Set<() => void>();
  readonly render = new Set<(at: number) => void>();
  private pendingMorph: number | undefined;
  private readonly timer = setInterval(() => {
    for (const callback of [...this.before]) callback();
    if (this.pendingMorph !== undefined) this.state = { ...this.state, state: { ...this.state.state, morph: this.pendingMorph } };
    if (this.baking > 0) this.baking--;
    this.frames++;
    if (this.sampling) this.gpuSamples.push(0.5);
    for (const callback of [...this.render]) callback(performance.now());
  }, 16);
  /** One steady GPU sample per frame while sampling. */
  gpuSamples: number[] = [];

  dispose(): void { clearInterval(this.timer); }
  read(): AtmosphereLabSnapshot { return this.state; }
  apply(settings: AtmosphereLabTestSettings): void {
    const { kind: _kind, morphKeys, expectMaskedPass: _expect, imageChecks: _image, reportOnly: _report, ...rest } = settings;
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
  async readCheckFrames(): Promise<CheckFrames> { this.checkFrameReads++; return this.checkFrames(); }
  async captureThumbnail(): Promise<Blob> { this.thumbnails++; return new Blob(['x'], { type: 'image/webp' }); }
  gpuTimestampsSupported(): boolean { return this.gpuSupported; }
  isSampling(): boolean { return this.sampling; }
  startSampling(): void { this.sampling = true; this.gpuSamples = []; }
  gpuSamplesSoFar(): readonly number[] { return this.gpuSamples; }
  stopSampling(): AtmosphereFrameSummary {
    this.sampling = false;
    return { frames: 90, cpuMedianMs: 2, cpuP95Ms: 3, wallMedianMs: 16, wallP95Ms: 18, invalidReasons: [], verdict: 'ok' };
  }
  environment(): Record<string, string | number | boolean | null> { return this.environmentValues; }
}

const quick = (suite: TestSuite<AtmosphereLabTestSettings>, ...ids: string[]): TestSuite<AtmosphereLabTestSettings> => ({
  ...suite,
  scenarios: suite.scenarios.filter((scenario) => ids.includes(scenario.id))
    .map((scenario) => ({ ...scenario, durationMs: 400, warmupMs: 0, quickMs: undefined })),
});

const COVERAGE_CHECK = "Ground mesh covers the atmosphere's ground";
const [LOOK, , COST, LOOK2, LOOK3] = ATMOSPHERE_LAB_TEST_HISTORY;

describe('atmosphere lab tests', () => {
  let host: FakeHost;
  beforeEach(() => { host = new FakeHost(); });
  afterEach(() => host.dispose());

  describe('history', () => {
    it('is a valid append-only history ending with look v3', () => {
      expect(() => validateTestHistory(ATMOSPHERE_LAB_TEST_HISTORY)).not.toThrow();
      expect(ATMOSPHERE_LAB_TEST_HISTORY.map((suite) => `${suite.id}@${suite.version}:${suite.purpose}`)).toEqual([
        'bent-atmosphere-look@1:functional', 'bent-atmosphere-cost@1:performance', 'bent-atmosphere-cost@2:performance',
        'bent-atmosphere-look@2:functional', 'bent-atmosphere-look@3:functional']);
      expect(LOOK.requiresVisualReview).toBeTrue();
      expect(LOOK2.requiresVisualReview).toBeTrue();
      expect(LOOK3.requiresVisualReview).toBeTrue();
    });

    it('makes look v3 a survey of the v2 views plus three altitudes under a kilometre, and keeps v1 and v2 gating', () => {
      expect(LOOK3.scenarios.every((item) => item.settings.reportOnly === true)).toBeTrue();
      expect(LOOK.scenarios.concat(LOOK2.scenarios).some((item) => item.settings.reportOnly)).toBeFalse();
      const ids = LOOK3.scenarios.map((item) => item.id);
      expect(ids.slice(0, 5)).toEqual(['horizon-ground-noon-m0', 'horizon-ground-85m-m0', 'horizon-ground-381m-m0',
        'horizon-ground-1700m-m0', 'horizon-ground-noon-m0_5']);
      expect(LOOK3.scenarios.length).toBe(LOOK2.scenarios.length + 3);
      const v2 = new Map(LOOK2.scenarios.map((item) => [item.id, item.settings]));
      for (const item of LOOK3.scenarios.filter((entry) => v2.has(entry.id))) {
        const { reportOnly: _report, ...rest } = item.settings;
        expect(rest).withContext(item.id).toEqual(v2.get(item.id)!);
      }
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

    it('keeps look v1 free of image checks and gives every look v2 scenario expectations', () => {
      expect(LOOK.scenarios.some((item) => item.settings.imageChecks !== undefined)).toBeFalse();
      expect(LOOK2.scenarios.every((item) => item.settings.imageChecks !== undefined)).toBeTrue();
      const v1 = new Map(LOOK.scenarios.map((item) => [item.id, item.settings]));
      for (const item of LOOK2.scenarios.filter((entry) => v1.has(entry.id))) {
        const { imageChecks: _checks, ...rest } = item.settings;
        expect(rest).withContext(item.id).toEqual(v1.get(item.id)!);
      }
      expect(LOOK2.scenarios.filter((item) => item.settings.imageChecks?.horizon).length).toBeGreaterThanOrEqual(5);
    });

    it('builds and parses exact-version and latest launch links', () => {
      const base = 'http://triangular-demo.localhost:4200/atmosphere-lab';
      const url = buildTestLaunchUrl(base, LOOK, 'human-observed', 1);
      expect(url).toBe(`${base}?testSuite=bent-atmosphere-look&testVersion=1&testProfile=human-observed&testMode=standard&testRepetitions=1&testAutoStart=1`);
      expect(parseTestLaunch(new URL(url), ATMOSPHERE_LAB_TEST_HISTORY)?.key).toBe('bent-atmosphere-look@1');
      expect(parseTestLaunch(new URL(`${base}?testSuite=latest&testAutoStart=1`), ATMOSPHERE_LAB_TEST_HISTORY)?.key).toBe('bent-atmosphere-look@3');
      expect(buildTestLaunchUrl(base, LOOK2, 'visible-browser', 1)).toContain('testSuite=bent-atmosphere-look&testVersion=2');
      expect(buildTestLaunchUrl(base, LOOK3, 'visible-browser', 1)).toContain('testSuite=bent-atmosphere-look&testVersion=3');
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

    describe('quick mode', () => {
      it('gives every sweep a quick length and leaves standard windows as they were', () => {
        expect(createAtmosphereLabTestAdapter(host).windowModes).toBeTrue();
        for (const suite of ATMOSPHERE_LAB_TEST_HISTORY) for (const item of suite.scenarios) {
          if (item.settings.kind === 'sweep') expect(item.quickMs).withContext(item.id).toBeLessThan(item.durationMs);
          else expect(item.quickMs).withContext(item.id).toBeUndefined();
        }
        expect(LOOK.scenarios.find((item) => item.id === 'scrub-equirect')?.durationMs).toBe(8000);
      });

      it('runs a sweep for its quick length and still reaches every keyframe', async () => {
        const [sweep] = LOOK.scenarios.filter((item) => item.id === 'equal-earth-low-morph');
        const suite = { ...LOOK, scenarios: [{ ...sweep, durationMs: 4000, quickMs: 600, warmupMs: 0 }] };
        const began = performance.now();
        const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
          suite, createAtmosphereLabTestAdapter(host), { repetitions: 1, profile: 'headless-hardware', mode: 'quick' });
        expect(result.status).toBe('completed');
        expect(result.mode).toBe('quick');
        expect(result.cases[0].checks.find((check) => check.name === 'Morph reached its final state')?.passed).toBeTrue();
        expect(performance.now() - began).toBeLessThan(3000);
      }, 20_000);

      it('stops a still view once frame pacing and GPU time settle', async () => {
        const suite = { ...COST, scenarios: COST.scenarios.filter((item) => item.id === 'auto-m0-space')
          .map((item) => ({ ...item, durationMs: 6000, warmupMs: 0 })) };
        const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
          suite, createAtmosphereLabTestAdapter(host), { repetitions: 1, profile: 'headless-hardware', mode: 'quick' });
        const window = result.cases[0].window;
        expect(window?.stoppedBy).toBe('settled');
        expect(window?.elapsedMs).toBeLessThan(6000);
        expect(Object.keys(window?.samples ?? {})).toEqual(['frameInterval', 'gpuFrame']);
      }, 20_000);
    });

    describe('image checks (look v2)', () => {
      const run = (ids: string[], thumbnails?: { scenarioId: string; images: readonly Blob[] }[]) =>
        new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
          quick(LOOK2, ...ids), createAtmosphereLabTestAdapter(host), {
            repetitions: 1, profile: 'headless-hardware',
            ...(thumbnails ? { thumbnails: true, onThumbnails: (item) => thumbnails.push(item) } : {}),
          });
      const check = (result: Awaited<ReturnType<typeof run>>, name: string) =>
        result.cases[0].checks.find((item) => item.name === name);
      const metric = (result: Awaited<ReturnType<typeof run>>, name: string) =>
        result.cases[0].metrics.find((item) => item.name === name);

      it('reads the final frame once, after the window, and passes a healthy view', async () => {
        const result = await run(['horizon-air-high-m0']);
        expect(result.errors).toEqual([]);
        expect(result.status).toBe('completed');
        expect(host.checkFrameReads).toBe(1);
        expect(result.cases[0].checks.map((item) => item.name)).toEqual(jasmine.arrayContaining([
          COVERAGE_CHECK, 'Sky is lit', 'No dark band at the horizon']));
        expect(metric(result, 'uncoveredPixels')?.samples).toEqual([0]);
        expect(metric(result, 'skyMedianLuma')?.samples[0]).toBeCloseTo(0.6, 5);
        expect(metric(result, 'horizonBandPixels')?.samples).toEqual([0]);
        expect(host.sampling).toBeFalse();
      }, 20_000);

      it('fails a black sky, naming the median it measured', async () => {
        host.checkFrames = () => syntheticFrames(host.state.state, { sky: 0 });
        const result = await run(['horizon-air-high-m0']);
        expect(check(result, 'Sky is lit')?.passed).toBeFalse();
        expect(check(result, 'Sky is lit')?.detail).toContain('median luma 0.000');
        expect(result.status).toBe('failed');
      }, 20_000);

      it('fails a black band under the horizon and counts it', async () => {
        host.checkFrames = () => syntheticFrames(host.state.state, { bandRows: 2 });
        const result = await run(['horizon-air-high-m0']);
        expect(check(result, 'No dark band at the horizon')?.passed).toBeFalse();
        expect(metric(result, 'horizonBandPixels')?.samples[0]).toBeGreaterThan(0);
        expect(check(result, 'Sky is lit')?.passed).toBeTrue();
      }, 20_000);

      it('fails ground the atmosphere expects and the mesh does not cover', async () => {
        host.checkFrames = () => syntheticFrames(host.state.state, { uncoveredCells: 12 });
        const result = await run(['horizon-air-high-m0']);
        expect(check(result, COVERAGE_CHECK)?.passed).toBeFalse();
        expect(metric(result, 'uncoveredPixels')?.samples).toEqual([12]);
      }, 20_000);

      it('says why a check that a scenario expects could not apply', async () => {
        // Above the air with the sun up: no lit-sky check applies, but the scenario asked for one.
        host.checkFrames = () => syntheticFrames(host.state.state, {}, 64, 48);
        const suite = quick(LOOK2, 'horizon-air-high-m0');
        const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
          { ...suite, scenarios: suite.scenarios.map((item) => ({ ...item, settings: { ...item.settings, altitudeM: 3_000_000 } })) },
          createAtmosphereLabTestAdapter(host), { repetitions: 1, profile: 'headless-hardware' });
        expect(check(result, 'Sky is lit')?.passed).toBeFalse();
        expect(check(result, 'Sky is lit')?.detail).toContain('the camera is above the air');
        expect(metric(result, 'skyMedianLuma')?.unavailableReason).toContain('Not applicable');
      }, 20_000);

      it('does not insist on a lit sky or a horizon where the scenario expects none', async () => {
        const result = await run(['rim-glow-equirect']);
        expect(result.cases[0].checks.map((item) => item.name)).toContain(COVERAGE_CHECK);
        expect(check(result, 'Sky is lit')).toBeUndefined();
        expect(result.cases[0].checks.filter((item) => !item.passed)).toEqual([]);
        expect(result.status).toBe('completed');
      }, 20_000);

      it('keeps look v1 free of pixel reads, and still takes one thumbnail per kept case', async () => {
        const thumbnails: { scenarioId: string; images: readonly Blob[] }[] = [];
        const result = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
          quick(LOOK, 'rim-glow-equirect'), createAtmosphereLabTestAdapter(host), {
            repetitions: 1, profile: 'headless-hardware', thumbnails: true, onThumbnails: (item) => thumbnails.push(item),
          });
        expect(result.status).toBe('completed');
        expect(host.checkFrameReads).toBe(0);
        expect(host.thumbnails).toBe(1);
        expect(thumbnails.map((item) => item.scenarioId)).toEqual(['rim-glow-equirect']);
        expect(thumbnails[0].images.length).toBe(1);
      }, 20_000);

      it('takes the thumbnail of a failed case too, and none with thumbnails off', async () => {
        host.checkFrames = () => syntheticFrames(host.state.state, { sky: 0 });
        const thumbnails: { scenarioId: string; images: readonly Blob[] }[] = [];
        const result = await run(['horizon-air-high-m0'], thumbnails);
        expect(result.status).toBe('failed');
        expect(thumbnails.length).toBe(1);
        expect(host.thumbnails).toBe(1);
      }, 20_000);
    });

    describe('survey (look v3)', () => {
      const survey = (ids: string[]) =>
        new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
          quick(LOOK3, ...ids), createAtmosphereLabTestAdapter(host), { repetitions: 1, profile: 'headless-hardware' });

      it('records every failed check as a note and goes on to the next case', async () => {
        host.checkFrames = () => syntheticFrames(host.state.state, { sky: 0, uncoveredCells: 12 });
        const result = await survey(['horizon-ground-noon-m0', 'horizon-air-high-m0']);
        expect(result.errors).toEqual([]);
        expect(result.status).toBe('completed');
        expect(result.cases.map((item) => item.scenario.id)).toEqual(['horizon-ground-noon-m0', 'horizon-air-high-m0']);
        for (const item of result.cases) {
          expect(item.status).toBe('completed');
          expect(item.checks.every((entry) => entry.passed)).toBeTrue();
          const lit = item.checks.find((entry) => entry.name === 'Sky is lit');
          expect(lit?.detail).toContain('WOULD FAIL: median luma 0.000');
          expect(item.checks.find((entry) => entry.name === COVERAGE_CHECK)?.detail).toContain('WOULD FAIL');
          expect(item.metrics.find((entry) => entry.name === 'checksWouldFail')?.samples[0]).toBeGreaterThanOrEqual(2);
          expect(String(item.details?.['wouldFail'])).toContain('Sky is lit');
          expect(item.limitations.join(' ')).toContain('Survey suite');
        }
      }, 20_000);

      it('counts none and notes nothing on a healthy view, and the same defect still fails look v2', async () => {
        const healthy = await survey(['horizon-air-high-m0']);
        expect(healthy.cases[0].metrics.find((entry) => entry.name === 'checksWouldFail')?.samples).toEqual([0]);
        expect(healthy.cases[0].checks.some((entry) => entry.detail?.includes('WOULD FAIL'))).toBeFalse();
        host.checkFrames = () => syntheticFrames(host.state.state, { sky: 0 });
        const gate = await new TestSession<AtmosphereLabTestSettings, AtmosphereLabSnapshot>().run(
          quick(LOOK2, 'horizon-air-high-m0'), createAtmosphereLabTestAdapter(host), { repetitions: 1, profile: 'headless-hardware' });
        expect(gate.status).toBe('failed');
      }, 20_000);
    });
  });
});
