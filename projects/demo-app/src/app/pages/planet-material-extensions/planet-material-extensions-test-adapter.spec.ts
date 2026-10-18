import { TestSession, buildTestLaunchUrl, parseTestLaunch, validateTestHistory, type TestSetting, type TestSuite } from 'triangular-engine/testing';
import {
  createExtensionsTestAdapter, orbitPose, orbitTraceProblems, sceneMismatches, stackMismatches,
  type ExtensionsFrameSummary, type ExtensionsPageSnapshot, type ExtensionsTestHost,
} from './planet-material-extensions-test-adapter';
import { EXTENSIONS_HOME_CAMERA, EXTENSIONS_HOME_TARGET, EXTENSIONS_TEST_HISTORY, type ExtensionsTestSettings, type ExtensionsVec3 } from './planet-material-extensions-tests';

/** Frames come from a 16 ms timer; compile resolves a few frames after anything is applied. */
class FakeHost implements ExtensionsTestHost {
  state: ExtensionsPageSnapshot = {
    road: false, eclipse: true, lights: false, sunDegrees: 77, moonDegrees: -12, moonVisible: true,
    position: [1, 2, 3], target: [0.5, 0, 0], up: [0, 1, 0], controls: { enabled: true, damping: true },
  };
  frames = 0;
  sampling = false;
  error = '';
  triangles = 17_000;
  ignoreRoad = false;
  rendererUp = true;
  compileFails = false;
  compileCalls = 0;
  environmentValues: Record<string, TestSetting> = {
    backend: 'WebGL2', requestedBackend: 'WebGL2', softwareRenderer: false, gpuRenderer: 'Test GPU',
  };
  readonly before = new Set<() => void>();
  readonly render = new Set<(at: number) => void>();
  readonly invalidations: string[] = [];
  private readonly timer = setInterval(() => {
    for (const callback of [...this.before]) callback();
    this.frames++;
    for (const callback of [...this.render]) callback(performance.now());
  }, 16);

  dispose(): void { clearInterval(this.timer); }
  read(): ExtensionsPageSnapshot { return this.state; }
  applyScene(settings: ExtensionsTestSettings): void {
    this.state = {
      ...this.state, road: this.ignoreRoad ? this.state.road : settings.road, eclipse: settings.eclipse, lights: settings.lights,
      sunDegrees: settings.sunDegrees, moonDegrees: settings.moonDegrees, moonVisible: settings.eclipse, controls: { ...settings.controls },
    };
  }
  setCameraPose(position: ExtensionsVec3, target: ExtensionsVec3): void { this.state = { ...this.state, position, target }; }
  restore(snapshot: ExtensionsPageSnapshot): void { this.state = snapshot; }
  stackKey(): string {
    const { road, eclipse, lights } = this.state;
    return `morph:x;layers:${road ? 'roads' : ''};occluders:${eclipse ? 'moon' : ''};emissives:${lights ? 'cityLights' : ''};lighting:dayNight`;
  }
  rendererReady(): boolean { return this.rendererUp; }
  async compile(signal: AbortSignal): Promise<void> {
    this.compileCalls++;
    if (this.compileFails) throw new Error('shader compile failed');
    const target = this.frames + 2;
    while (this.frames < target) {
      if (signal.aborted) throw signal.reason;
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }
  drawStats(): { triangles: number; drawCalls: number } { return { triangles: this.triangles, drawCalls: 2 }; }
  renderedFrames(): number { return this.frames; }
  errors(): string { return this.error; }
  resetErrors(): void { this.error = ''; }
  onBeforeRender(callback: () => void): () => void { this.before.add(callback); return () => this.before.delete(callback); }
  onRenderComplete(callback: (at: number) => void): () => void { this.render.add(callback); return () => this.render.delete(callback); }
  isSampling(): boolean { return this.sampling; }
  startSampling(): void { this.sampling = true; }
  stopSampling(): ExtensionsFrameSummary {
    this.sampling = false;
    return { frames: 90, cpuMedianMs: 2, cpuP95Ms: 3, wallMedianMs: 16, wallP95Ms: 18, invalidReasons: [], verdict: 'ok' };
  }
  invalidateSampling(reason: string): void { this.invalidations.push(reason); }
  environment(): Record<string, TestSetting> { return this.environmentValues; }
}

const quick = (suite: TestSuite<ExtensionsTestSettings>, ...ids: string[]): TestSuite<ExtensionsTestSettings> => ({
  ...suite,
  scenarios: suite.scenarios.filter((scenario) => ids.includes(scenario.id)).map((scenario) => ({ ...scenario, durationMs: 250, warmupMs: 0 })),
});
const run = (host: FakeHost, suite: TestSuite<ExtensionsTestSettings>, profile: 'headless-hardware' | 'visible-browser' = 'headless-hardware', signal?: AbortSignal) =>
  new TestSession<ExtensionsTestSettings, ExtensionsPageSnapshot>().run(suite, createExtensionsTestAdapter(host), { repetitions: 1, profile }, () => {}, signal);

describe('planet material extensions tests', () => {
  const [features, cost] = EXTENSIONS_TEST_HISTORY;
  let host: FakeHost;
  beforeEach(() => { host = new FakeHost(); });
  afterEach(() => host.dispose());

  describe('history', () => {
    it('is a valid append-only history whose final entry is the performance suite', () => {
      expect(() => validateTestHistory(EXTENSIONS_TEST_HISTORY)).not.toThrow();
      expect(EXTENSIONS_TEST_HISTORY.map((suite) => `${suite.id}@${suite.version}:${suite.purpose}`)).toEqual([
        'planet-material-extensions-features@1:functional', 'planet-material-extensions-cost@1:performance']);
      expect(features.requiresVisualReview).toBeTrue();
      expect(cost.requiresVisualReview).toBeTrue();
    });

    it('covers the baseline, each slot alone, the plain sphere, night and eclipse geometry, and an orbit', () => {
      const flags = (suite: TestSuite<ExtensionsTestSettings>) => suite.scenarios.map((item) =>
        `${item.id}:${item.settings.road ? 'R' : '-'}${item.settings.eclipse ? 'E' : '-'}${item.settings.lights ? 'L' : '-'}:${item.settings.kind}`);
      expect(flags(features)).toEqual([
        'baseline-day:REL:static', 'plain:---:static', 'road-only:R--:static', 'eclipse-total:-E-:static',
        'eclipse-offset:-E-:static', 'night-lights:--L:static', 'orbit-all:REL:orbit']);
      expect(flags(cost)).toEqual([
        'baseline-day:REL:static', 'baseline-night:REL:static', 'no-road:-EL:static', 'no-eclipse:R-L:static',
        'no-lights:RE-:static', 'plain:---:static', 'orbit-all:REL:orbit', 'orbit-plain:---:orbit']);
    });

    it('resolves every input, with the camera as numbers and the controls locked, in every scenario', () => {
      for (const suite of EXTENSIONS_TEST_HISTORY) for (const item of suite.scenarios) {
        expect(item.settings.cameraPosition).withContext(item.id).toEqual(EXTENSIONS_HOME_CAMERA);
        expect(item.settings.cameraTarget).toEqual(EXTENSIONS_HOME_TARGET);
        expect(item.settings.controls).toEqual({ enabled: false, damping: false });
        expect(item.settings.orbitSweepDegrees).toBe(item.settings.kind === 'orbit' ? 360 : 0);
        expect(JSON.parse(JSON.stringify(item.settings))).toEqual(item.settings);
      }
    });

    it('builds and parses exact-version and latest launch links', () => {
      const base = 'http://triangular-demo.localhost:4200/planet-material-extensions';
      const url = buildTestLaunchUrl(base, features, 'human-observed', 1);
      expect(url).toBe(`${base}?testSuite=planet-material-extensions-features&testVersion=1&testProfile=human-observed&testRepetitions=1&testAutoStart=1`);
      expect(parseTestLaunch(new URL(url), EXTENSIONS_TEST_HISTORY)?.key).toBe('planet-material-extensions-features@1');
      expect(parseTestLaunch(new URL(`${base}?backend=webgl2&testSuite=latest`), EXTENSIONS_TEST_HISTORY)?.key).toBe('planet-material-extensions-cost@1');
      expect(() => parseTestLaunch(new URL(`${base}?testSuite=planet-material-extensions-cost&testVersion=2`), EXTENSIONS_TEST_HISTORY)).toThrow();
    });
  });

  describe('pure helpers', () => {
    it('orbits round +Y keeping height and distance, and closes a full turn', () => {
      const target: ExtensionsVec3 = [0, 0, 0];
      const quarter = orbitPose([0, 0.6, 3.2], target, 360, 0.25);
      expect(quarter[0]).toBeCloseTo(3.2, 12);
      expect(quarter[1]).toBe(0.6);
      expect(quarter[2]).toBeCloseTo(0, 12);
      for (const fraction of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
        const pose = orbitPose([0, 0.6, 3.2], target, 360, fraction);
        expect(Math.hypot(pose[0], pose[2])).toBeCloseTo(3.2, 12);
      }
      const end = orbitPose([0, 0.6, 3.2], target, 360, 1);
      expect(end[0]).toBeCloseTo(0, 12);
      expect(end[2]).toBeCloseTo(3.2, 12);
      expect(orbitPose([0, 0.6, 3.2], target, 360, 7)).toEqual(end);
    });

    it('reads the compiled stack, not the page flags', () => {
      const all = features.scenarios[0].settings;
      const key = 'layers:roads;occluders:moon;emissives:cityLights;lighting:dayNight';
      expect(stackMismatches(key, all)).toEqual([]);
      expect(stackMismatches(key, { ...all, lights: false })).toEqual([jasmine.stringMatching(/^cityLights: expected absent/)]);
      expect(stackMismatches('layers:;occluders:;emissives:', all).length).toBe(3);
    });

    it('names the scene fields that differ', () => {
      const settings = features.scenarios[0].settings;
      const state: ExtensionsPageSnapshot = { ...new FakeHost().state, road: true, eclipse: true, lights: true, sunDegrees: 0, moonDegrees: 5, moonVisible: false };
      expect(sceneMismatches(state, settings)).toEqual(['moonDegrees: expected 0, found 5', 'moonVisible: expected true, found false']);
    });

    it('flags an orbit that goes back, never arrives, or is empty', () => {
      expect(orbitTraceProblems([0, 0.2, 0.7, 1])).toEqual([]);
      expect(orbitTraceProblems([0, 0.5, 0.4, 1])).toEqual(['orbit stepped back at frame 2']);
      expect(orbitTraceProblems([0, 0.4, 0.8])).toEqual(['final orbit fraction 0.8 is not 1']);
      expect(orbitTraceProblems([])).toEqual(['fewer than two orbit frames recorded']);
    });
  });

  describe('adapter run', () => {
    it('applies each scenario, checks the real state, waits for compilation and restores every captured field', async () => {
      const before = host.state;
      const result = await run(host, quick(features, 'plain', 'night-lights', 'orbit-all'));
      expect(result.errors).toEqual([]);
      expect(result.status).toBe('completed');
      expect(result.automatedVerdict).toBe('pass');
      expect(result.cases.map((item) => item.checks.every((check) => check.passed))).toEqual([true, true, true]);
      expect(result.cases[2].checks.find((check) => check.name === 'Camera orbit completed at its destination')?.detail).toMatch(/orbit steps/);
      expect(result.cases[0].metrics.map((metric) => metric.name)).toEqual(['frameInterval', 'gpuFrameTime']);
      expect(result.cases[0].metrics[0].samples.length).toBeGreaterThan(1);
      expect(result.cases[0].metrics[1].optional).toBeTrue();
      expect(result.cases[0].metrics[1].unavailableReason).toContain('gpuTiming');
      expect(host.compileCalls).toBe(3);
      expect(host.state).toEqual(before);
      expect(host.before.size).toBe(0);
      expect(host.render.size).toBe(0);
      expect(host.sampling).toBeFalse();
    }, 20_000);

    it('fails readiness, naming the field, when the page does not honour a setting', async () => {
      host.ignoreRoad = true;
      host.state = { ...host.state, road: false };
      const result = await new TestSession<ExtensionsTestSettings, ExtensionsPageSnapshot>().run(
        quick(features, 'road-only'), createExtensionsTestAdapter(host, 400), { repetitions: 1, profile: 'headless-hardware' });
      // The readiness wait cannot be satisfied by a page that ignores the setting: it fails the case instead of measuring.
      expect(result.status).toBe('failed');
      expect(result.cases[0].error).toContain('road: expected true, found false');
    }, 20_000);

    it('fails when the planet is not drawn, instead of trusting that frames rendered', async () => {
      host.triangles = 0;
      const result = await run(host, quick(features, 'baseline-day'));
      expect(result.cases[0].checks.find((item) => item.name === 'Planet drawn in the last frame')?.passed).toBeFalse();
      expect(result.status).toBe('failed');
    }, 20_000);

    it('fails a case on the wrong renderer backend', async () => {
      host.environmentValues = { ...host.environmentValues, backend: 'WebGL2', requestedBackend: 'WebGPU' };
      const result = await run(host, quick(features, 'baseline-day'));
      const check = result.cases[0].checks.find((item) => item.name === 'Requested renderer backend in use');
      expect(check?.passed).toBeFalse();
      expect(check?.detail).toBe('requested WebGPU, running WebGL2');
    }, 20_000);

    it('surfaces an engine error during readiness as a failed case and still restores', async () => {
      const before = host.state;
      const adapter = createExtensionsTestAdapter(host);
      const apply = adapter.apply.bind(adapter);
      adapter.apply = (item, context) => { apply(item, context); host.error = 'Engine render: boom'; };
      const result = await new TestSession<ExtensionsTestSettings, ExtensionsPageSnapshot>().run(
        quick(features, 'plain'), adapter, { repetitions: 1, profile: 'headless-hardware' });
      expect(result.status).toBe('failed');
      expect(result.cases[0].error).toContain('Engine render: boom');
      expect(host.state).toEqual(before);
    }, 20_000);

    it('surfaces a pipeline compile failure as a failed case and still restores', async () => {
      const before = host.state;
      host.compileFails = true;
      const result = await run(host, quick(features, 'plain'));
      expect(result.status).toBe('failed');
      expect(result.cases[0].error).toContain('shader compile failed');
      expect(host.state).toEqual(before);
    }, 20_000);

    it('cancels in the middle of an orbit, stops listening, restores the captured state and keeps the cancelled case', async () => {
      const before = host.state;
      const cancel = new AbortController();
      const adapter = createExtensionsTestAdapter(host);
      const measure = adapter.measure.bind(adapter);
      adapter.measure = (item, context) => { setTimeout(() => cancel.abort(), 100); return measure(item, context); };
      const result = await new TestSession<ExtensionsTestSettings, ExtensionsPageSnapshot>().run(
        quick(features, 'orbit-all'), adapter, { repetitions: 1, profile: 'headless-hardware' }, () => {}, cancel.signal);
      expect(result.status).toBe('cancelled');
      expect(result.cases.at(-1)?.status).toBe('cancelled');
      expect(host.state).toEqual(before);
      expect(host.before.size).toBe(0);
      expect(host.render.size).toBe(0);
      expect(host.sampling).toBeFalse();
    }, 20_000);

    it('labels a software renderer as invalid performance evidence and never as a pass', async () => {
      host.environmentValues = { ...host.environmentValues, softwareRenderer: true, gpuRenderer: 'SwiftShader' };
      const result = await run(host, quick(cost, 'baseline-day'), 'visible-browser');
      expect(result.environment['gpuRenderer']).toBe('SwiftShader');
      expect(result.cases[0].validityIssues).toContain('Software renderer: functional evidence only, not hardware performance');
      expect(result.performanceVerdict).toBe('inconclusive');
      expect(result.visualReview).toBe('pending');
    }, 20_000);

    it('treats an unknown GPU as unable to establish hardware performance', async () => {
      host.environmentValues = { ...host.environmentValues, softwareRenderer: null, gpuRenderer: 'unknown' };
      const result = await run(host, quick(cost, 'plain'), 'visible-browser');
      expect(result.cases[0].validityIssues).toContain('GPU device unknown: hardware performance cannot be established');
      expect(result.performanceVerdict).toBe('inconclusive');
    }, 20_000);
  });
});
