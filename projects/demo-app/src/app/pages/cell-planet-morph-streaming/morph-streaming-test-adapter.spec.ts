import { TestSession, buildTestLaunchUrl, parseTestLaunch, validateTestHistory, type TestSuite } from 'triangular-engine/testing';
import {
  createMorphTestAdapter, expectedMorphPose, streamingSettled, sweepMorphAt, sweepTraceProblems,
  type MorphFrameSummary, type MorphPageSnapshot, type MorphStreamingStatus, type MorphTestHost,
} from './morph-streaming-test-adapter';
import { MORPH_TEST_HISTORY, MORPH_TEST_WORLD, type MorphTestSettings } from './morph-streaming-tests';

/** Frames come from a 16 ms timer; streaming settles a few frames after anything is applied. */
class FakeHost implements MorphTestHost {
  state: MorphPageSnapshot = {
    world: { ...MORPH_TEST_WORLD, quality: 'ultra', seed: 9, heightScale: 7 },
    streamedTextureLodByMode: { natural: true, elevation: false, plates: false, material: true },
    morph: 0.3, lodMorph: 0.3, uniformMorph: 0.3, bookmark: 'canyon',
    position: [10, 20, 30], target: [1, 2, 3], orbitUp: [0, 1, 0], controls: { enabled: true, damping: true }, factionOverlay: false,
  };
  frames = 0;
  sampling = false;
  samplerStopped = 0;
  error = '';
  settleAtFrame = 0;
  /** Faults a test can inject. */
  ignoreWorld = false;
  emptyTerrainOnFrame: number | undefined;
  environmentValues: Record<string, string | number | boolean | null> = { softwareRenderer: false };
  readonly before = new Set<() => void>();
  readonly render = new Set<(at: number) => void>();
  private readonly timer = setInterval(() => {
    for (const callback of [...this.before]) callback();
    this.frames++;
    for (const callback of [...this.render]) callback(performance.now());
  }, 16);

  dispose(): void { clearInterval(this.timer); }
  read(): MorphPageSnapshot { return this.state; }
  applyWorld(settings: MorphTestSettings): void {
    const { quality, seed, heightScale, controls } = settings;
    if (!this.ignoreWorld) this.state = { ...this.state, world: { ...settings }, controls: { ...controls } };
    else this.state = { ...this.state, world: { ...this.state.world, quality, seed, heightScale: 99 }, controls: { ...controls } };
    this.settleAtFrame = this.frames + 4;
  }
  setMorphFrame(morph: number, position: readonly [number, number, number], target: readonly [number, number, number]): void {
    this.state = { ...this.state, morph, uniformMorph: morph, position, target };
  }
  commitMorph(morph: number): void { this.state = { ...this.state, lodMorph: morph }; this.settleAtFrame = Math.max(this.settleAtFrame, this.frames + 2); }
  restore(snapshot: MorphPageSnapshot): void { this.state = snapshot; }
  renderedFrames(): number { return this.frames; }
  streaming(): MorphStreamingStatus {
    const settled = this.frames >= this.settleAtFrame;
    const empty = this.emptyTerrainOnFrame !== undefined && this.frames >= this.emptyTerrainOnFrame;
    return {
      patchesDesired: 40, patchesResident: empty ? 0 : 40, patchesQueued: settled ? 0 : 5, triangles: 1000, drawCalls: 3,
      tilesEnabled: true, tilesResident: 8, tilesQueued: settled ? 0 : 2, tilesInFlight: 0, tilesCompleted: this.frames,
    };
  }
  errors(): string { return this.error; }
  resetErrors(): void { this.error = ''; }
  onBeforeRender(callback: () => void): () => void { this.before.add(callback); return () => this.before.delete(callback); }
  onRenderComplete(callback: (at: number) => void): () => void { this.render.add(callback); return () => this.render.delete(callback); }
  isSampling(): boolean { return this.sampling; }
  startSampling(): void { this.sampling = true; }
  stopSampling(): MorphFrameSummary {
    this.sampling = false;
    this.samplerStopped++;
    return { frames: 90, cpuMedianMs: 2, cpuP95Ms: 3, wallMedianMs: 16, wallP95Ms: 18, invalidReasons: [], verdict: 'ok' };
  }
  environment(): Record<string, string | number | boolean | null> { return this.environmentValues; }
}

const quick = (suite: TestSuite<MorphTestSettings>, ...ids: string[]): TestSuite<MorphTestSettings> => ({
  ...suite,
  scenarios: suite.scenarios.filter((scenario) => ids.includes(scenario.id))
    .map((scenario) => ({ ...scenario, durationMs: 250, warmupMs: 0 })),
});

describe('morph streaming tests', () => {
  let host: FakeHost;
  beforeEach(() => { host = new FakeHost(); });
  afterEach(() => host.dispose());

  describe('history', () => {
    it('is a valid append-only history whose final entry is the diagnostic suite', () => {
      expect(() => validateTestHistory(MORPH_TEST_HISTORY)).not.toThrow();
      expect(MORPH_TEST_HISTORY.map((suite) => `${suite.id}@${suite.version}:${suite.purpose}`)).toEqual([
        'morph-streaming-smoke@1:functional', 'morph-streaming-morph-cost@1:performance']);
      const diagnostic = MORPH_TEST_HISTORY[1];
      expect(diagnostic.requiresVisualReview).toBeTrue();
      expect(diagnostic.scenarios.map((scenario) => scenario.settings.morphKeys)).toEqual([[0], [0.5], [1], [0, 1, 0]]);
    });

    it('resolves every world and camera input, with controls locked, in every scenario', () => {
      for (const suite of MORPH_TEST_HISTORY) for (const scenario of suite.scenarios) {
        for (const key of Object.keys(MORPH_TEST_WORLD)) expect(key in scenario.settings).withContext(`${scenario.id}.${key}`).toBeTrue();
        expect(scenario.settings.controls).toEqual({ enabled: false, damping: false });
        expect(expectedMorphPose(scenario.settings, 0)).toEqual([0, 0, 1_560_000]);
        expect(expectedMorphPose(scenario.settings, 1)).toEqual([0, 0, 2_160_000]);
      }
    });

    it('builds and parses exact-version and latest launch links', () => {
      const base = 'http://triangular-demo.localhost:4200/cell-planet-morph-streaming';
      const first = MORPH_TEST_HISTORY[0];
      const url = buildTestLaunchUrl(base, first, 'human-observed', 1);
      expect(url).toBe(`${base}?testSuite=morph-streaming-smoke&testVersion=1&testProfile=human-observed&testRepetitions=1&testAutoStart=1`);
      expect(parseTestLaunch(new URL(url), MORPH_TEST_HISTORY)?.key).toBe('morph-streaming-smoke@1');
      expect(parseTestLaunch(new URL(`${base}?testSuite=latest&testAutoStart=1`), MORPH_TEST_HISTORY)?.key).toBe('morph-streaming-morph-cost@1');
      expect(() => parseTestLaunch(new URL(`${base}?testSuite=morph-streaming-smoke&testVersion=2`), MORPH_TEST_HISTORY)).toThrow();
    });
  });

  describe('sweep path', () => {
    const keys = [0, 1, 0];
    it('hits the keyframes exactly and turns once', () => {
      expect(sweepMorphAt(keys, 0).morph).toBe(0);
      expect(sweepMorphAt(keys, 0.5).morph).toBeCloseTo(1, 12);
      expect(sweepMorphAt(keys, 1)).toEqual({ morph: 0, leg: 1 });
      const trace = Array.from({ length: 101 }, (_, i) => sweepMorphAt(keys, i / 100).morph);
      expect(sweepTraceProblems(keys, trace)).toEqual([]);
    });
    it('flags a sweep that never arrives, jumps back, or is empty', () => {
      expect(sweepTraceProblems(keys, [0, 0.2, 0.4])).toContain('final 0.4 is not 0');
      expect(sweepTraceProblems(keys, [0, 0.5, 0.2, 0.6, 0])).toEqual(jasmine.arrayContaining([jasmine.stringMatching(/direction changes/)]));
      expect(sweepTraceProblems(keys, [])).toEqual(['no sweep frames recorded']);
    });
    it('requires meshes and, when enabled, texture tiles to be resident and idle', () => {
      const ok: MorphStreamingStatus = { patchesDesired: 4, patchesResident: 4, patchesQueued: 0, triangles: 1, drawCalls: 1,
        tilesEnabled: true, tilesResident: 1, tilesQueued: 0, tilesInFlight: 0, tilesCompleted: 1 };
      expect(streamingSettled(ok)).toBeTrue();
      expect(streamingSettled({ ...ok, tilesInFlight: 1 })).toBeFalse();
      expect(streamingSettled({ ...ok, patchesQueued: 1 })).toBeFalse();
      expect(streamingSettled({ ...ok, patchesResident: 0 })).toBeFalse();
      expect(streamingSettled({ ...ok, tilesEnabled: false, tilesResident: 0, tilesInFlight: 3 })).toBeTrue();
    });
  });

  describe('adapter run', () => {
    it('applies each scenario, checks the real state and restores every captured field', async () => {
      const before = host.state;
      const suite = quick(MORPH_TEST_HISTORY[0], 'morph-1', 'sweep-quick');
      const result = await new TestSession<MorphTestSettings, MorphPageSnapshot>().run(
        suite, createMorphTestAdapter(host), { repetitions: 1, profile: 'headless-hardware' });
      expect(result.errors).toEqual([]);
      expect(result.status).toBe('completed');
      expect(result.automatedVerdict).toBe('pass');
      expect(result.cases.map((item) => item.checks.every((check) => check.passed))).toEqual([true, true]);
      expect(result.cases[1].checks.find((check) => check.name === 'Morph reached its final state')?.detail).toMatch(/animation steps/);
      expect(result.cases[0].metrics.map((metric) => metric.name)).toEqual(['frameInterval', 'streamingBacklog']);
      expect(result.cases[0].metrics[0].samples.length).toBeGreaterThan(1);
      expect(host.state).toEqual(before);
      expect(host.before.size).toBe(0);
      expect(host.render.size).toBe(0);
      expect(host.sampling).toBeFalse();
    }, 20_000);

    it('reports a setting the page did not honour, and keeps the other scenarios out of a false pass', async () => {
      host.ignoreWorld = true;
      const result = await new TestSession<MorphTestSettings, MorphPageSnapshot>().run(
        quick(MORPH_TEST_HISTORY[0], 'morph-0'), createMorphTestAdapter(host), { repetitions: 1, profile: 'headless-hardware' });
      expect(result.status).toBe('failed');
      expect(result.automatedVerdict).toBe('fail');
      const check = result.cases[0].checks.find((item) => item.name === 'World settings applied as specified');
      expect(check?.passed).toBeFalse();
      expect(check?.detail).toContain('heightScale: expected 4, found 99');
    }, 20_000);

    it('fails when terrain empties during the window instead of trusting that frames rendered', async () => {
      const adapter = createMorphTestAdapter(host);
      const original = adapter.measure.bind(adapter);
      adapter.measure = (scenario, context) => { host.emptyTerrainOnFrame = host.frames + 3; return original(scenario, context); };
      const result = await new TestSession<MorphTestSettings, MorphPageSnapshot>().run(
        quick(MORPH_TEST_HISTORY[0], 'morph-0'), adapter, { repetitions: 1, profile: 'headless-hardware' });
      expect(result.cases[0].checks.find((item) => item.name === 'Terrain stayed resident throughout')?.passed).toBeFalse();
      expect(result.status).toBe('failed');
    }, 20_000);

    it('surfaces an engine or worker error during readiness as a failed case and still restores', async () => {
      const before = host.state;
      const adapter = createMorphTestAdapter(host);
      const apply = adapter.apply.bind(adapter);
      adapter.apply = (scenario, context) => { apply(scenario, context); host.error = 'Mesh worker: boom'; };
      const result = await new TestSession<MorphTestSettings, MorphPageSnapshot>().run(
        quick(MORPH_TEST_HISTORY[0], 'morph-0'), adapter, { repetitions: 1, profile: 'headless-hardware' });
      expect(result.status).toBe('failed');
      expect(result.cases[0].error).toContain('Mesh worker: boom');
      expect(host.state).toEqual(before);
    }, 20_000);

    it('cancels in the middle of a sweep, stops listening and restores the captured state', async () => {
      const before = host.state;
      const cancel = new AbortController();
      const suite = quick(MORPH_TEST_HISTORY[0], 'sweep-quick');
      const adapter = createMorphTestAdapter(host);
      const measure = adapter.measure.bind(adapter);
      adapter.measure = (scenario, context) => { setTimeout(() => cancel.abort(), 100); return measure(scenario, context); };
      const result = await new TestSession<MorphTestSettings, MorphPageSnapshot>().run(
        suite, adapter, { repetitions: 1, profile: 'headless-hardware' }, () => {}, cancel.signal);
      expect(result.status).toBe('cancelled');
      expect(result.cases.at(-1)?.status).toBe('cancelled');
      expect(host.state).toEqual(before);
      expect(host.before.size).toBe(0);
      expect(host.render.size).toBe(0);
      expect(host.sampling).toBeFalse();
    }, 20_000);

    it('labels a software renderer as invalid performance evidence and never as a pass', async () => {
      host.environmentValues = { softwareRenderer: true, gpuRenderer: 'SwiftShader' };
      const suite = quick(MORPH_TEST_HISTORY[1], 'morph-0');
      const result = await new TestSession<MorphTestSettings, MorphPageSnapshot>().run(
        suite, createMorphTestAdapter(host), { repetitions: 1, profile: 'visible-browser' });
      expect(result.environment['gpuRenderer']).toBe('SwiftShader');
      expect(result.cases[0].validityIssues).toContain('Software renderer: functional evidence only, not hardware performance');
      expect(result.performanceVerdict).toBe('inconclusive');
      expect(result.visualReview).toBe('pending');
    }, 20_000);
  });
});
