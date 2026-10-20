import { GpuPassRecorder, summarizeGpuPasses, type IGpuPassSummary } from 'triangular-engine';
import { TestSession, buildTestLaunchUrl, parseTestLaunch, validateTestHistory, type TestSetting, type TestSuite } from 'triangular-engine/testing';
import { adapterLabel, describeGpuAdapter } from './gpu-adapter-info';
import {
  CAMERA_POSES, FREE_CAMERA_MAX_ALTITUDE_RADII, FREE_CAMERA_MIN_ALTITUDE_M, cameraViewFromPose, lookCameraView, panCameraView,
  resolveCameraPose, resolveCameraView, zoomCameraView,
} from './planet-shape-camera';
import { BODIES, SPIN_PERIOD_S, spinAngleAfter, sunDirectionBody } from './planet-shape-config';
import { FEATURES, defaultFeatureState, featureMismatches, shadowsActive, withFeature } from './planet-shape-features';
import { MORPH_CENTRE, createCameraRelativeSphereGeometry, createPlainSphereMaterial } from './planet-shape-sphere';
import {
  createPlanetShapeTestAdapter, settingsMismatches, type PlanetShapeFrameSummary, type PlanetShapeSceneInfo, type PlanetShapeTestHost,
} from './planet-shape-test-adapter';
import { PLANET_SHAPE_DEFAULTS, PLANET_SHAPE_TEST_HISTORY, type PlanetShapeTestSettings } from './planet-shape-tests';

/** Frames come from a 16 ms timer, so the real adapter and session run without a GPU. */
class FakeHost implements PlanetShapeTestHost {
  state: PlanetShapeTestSettings = { ...PLANET_SHAPE_DEFAULTS, spinAngleDeg: 12 };
  frames = 0;
  sampling = false;
  error = '';
  webgpu = true;
  software = false;
  gpuPasses: IGpuPassSummary | null = null;
  readonly before = new Set<() => void>();
  readonly render = new Set<(at: number) => void>();
  private readonly timer = setInterval(() => {
    for (const callback of [...this.before]) callback();
    this.frames++;
    for (const callback of [...this.render]) callback(performance.now());
  }, 16);

  dispose(): void { clearInterval(this.timer); }
  read(): PlanetShapeTestSettings { return this.state; }
  apply(settings: PlanetShapeTestSettings): void { this.state = settings; }
  renderedFrames(): number { return this.frames; }
  errors(): string { return this.error; }
  resetErrors(): void { this.error = ''; }
  backendIsWebGpu(): boolean { return this.webgpu; }
  scene(): PlanetShapeSceneInfo {
    const drawn = this.state.kind === 'sphere';
    return { bodyDrawn: drawn, drawCalls: drawn ? 1 : 0, triangles: drawn ? 261_120 : 0, drawingBuffer: [2560, 1440] };
  }
  onBeforeRender(callback: () => void): () => void { this.before.add(callback); return () => this.before.delete(callback); }
  onRenderComplete(callback: (at: number) => void): () => void { this.render.add(callback); return () => this.render.delete(callback); }
  isSampling(): boolean { return this.sampling; }
  startSampling(): void { this.sampling = true; }
  gpuSamplesSoFar(): readonly number[] { return []; }
  thumbnail?: () => Promise<Blob | undefined>;
  stopSampling(): PlanetShapeFrameSummary {
    this.sampling = false;
    return {
      frames: 90, cpuMedianMs: 2, cpuP95Ms: 3, wallMedianMs: 16, wallP95Ms: 18, gpuMedianMs: null, gpuSamples: 0, invalidReasons: [], verdict: 'ok',
      gpuPasses: this.gpuPasses,
    };
  }
  environment(): Record<string, TestSetting> {
    return { backend: this.webgpu ? 'webgpu' : 'webgl2', 'gpu.software': this.software, 'gpu.timestampQuery': this.gpuPasses !== null };
  }
}

/** The engine's per-pass summary for `frames` frames of a scene and an output pass, with the given timestamp step. */
function gpuPassesOf(frames: number, stepNs: number): IGpuPassSummary {
  const recorder = new GpuPassRecorder();
  const records = [];
  for (let frame = 1; frame <= frames; frame++) {
    recorder.record(`r:1:2:f${frame}`, { name: 'Lab' }, null);
    recorder.record(`r:2:5:f${frame}`, { name: 'Output Color Transform', isQuadMesh: true }, null);
    const ms = (steps: number) => (steps * stepNs) / 1e6;
    records.push({ batch: recorder.attribute(new Map([[`r:1:2:f${frame}`, ms(80 + frame)], [`r:2:5:f${frame}`, ms(5)]])), totalMatches: true });
  }
  return summarizeGpuPasses(records)!;
}

const [BASELINE, MORPH, SHADOWS_AB] = PLANET_SHAPE_TEST_HISTORY;
const quick = (...ids: string[]): TestSuite<PlanetShapeTestSettings> => ({
  ...BASELINE,
  scenarios: BASELINE.scenarios.filter((scenario) => ids.includes(scenario.id)).map((scenario) => ({ ...scenario, durationMs: 300, warmupMs: 0 })),
});
const run = (host: FakeHost, suite: TestSuite<PlanetShapeTestSettings>, profile: 'headless-hardware' | 'visible-browser' = 'visible-browser',
  mode: 'quick' | 'standard' = 'standard') =>
  new TestSession<PlanetShapeTestSettings, PlanetShapeTestSettings>().run(suite, createPlanetShapeTestAdapter(host), { repetitions: 1, profile, mode });

describe('planet shape lab', () => {
  describe('camera poses', () => {
    it('resolves every pose on every body to a finite orthonormal view above the surface', () => {
      for (const body of BODIES) for (const pose of CAMERA_POSES) {
        const view = resolveCameraPose(pose.id, body.id);
        const length = (v: readonly number[]) => Math.hypot(...v);
        const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        expect(length(view.forward)).withContext(`${pose.id} ${body.id}`).toBeCloseTo(1, 12);
        expect(length(view.up)).toBeCloseTo(1, 12);
        expect(dot(view.forward, view.up)).toBeCloseTo(0, 12);
        expect(length(view.position)).toBeCloseTo(body.radiusM + view.altitudeM, 4);
        expect(view.altitudeM).toBeGreaterThan(0);
        expect(view.near).toBeLessThan(view.far);
      }
    });

    it('places the ground pose 2 m up and the orbit pose looking at the centre', () => {
      expect(resolveCameraPose('ground', '6371km').altitudeM).toBe(2);
      const orbit = resolveCameraPose('orbit', '600km');
      const toCentre = orbit.position.map((c) => -c / Math.hypot(...orbit.position));
      for (let i = 0; i < 3; i++) expect(orbit.forward[i]).toBeCloseTo(toCentre[i], 12);
    });

    it('points the horizon pose exactly along the horizon', () => {
      const view = resolveCameraPose('horizon-grazing', '600km');
      const radial = view.position.map((c) => c / Math.hypot(...view.position));
      const along = view.forward[0] * radial[0] + view.forward[1] * radial[1] + view.forward[2] * radial[2];
      // The line of sight to the horizon is tangent to the sphere: its distance to the centre is the radius.
      const distanceToCentre = Math.hypot(...view.position) * Math.sqrt(1 - along * along);
      expect(distanceToCentre).toBeCloseTo(600_000, 3);
    });

    it('free camera starts at the named pose and stays inside its altitude and pitch limits', () => {
      const start = cameraViewFromPose('orbit', '600km');
      const named = resolveCameraPose('orbit', '600km');
      const free = resolveCameraView(start, '600km', 'free');
      for (let i = 0; i < 3; i++) expect(free.position[i]).toBeCloseTo(named.position[i], 6);

      let view = zoomCameraView(start, -1000, '600km');
      expect(resolveCameraView(view, '600km', 'free').altitudeM).toBe(FREE_CAMERA_MIN_ALTITUDE_M);
      view = zoomCameraView(start, 1000, '600km');
      expect(view.altitudeM).toBe(FREE_CAMERA_MAX_ALTITUDE_RADII * 600_000);
      view = lookCameraView(start, 0, -10);
      expect(view.pitchDeg).toBe(30);
      view = panCameraView(start, 0, 100, '600km');
      expect(Math.abs(view.latDeg)).toBeLessThanOrEqual(89.9);
      expect(Number.isFinite(resolveCameraView(view, '600km', 'free').forward[0])).toBeTrue();
    });

    it('free camera pans so the ground follows the pointer: dragging down looking north moves the camera north', () => {
      const start = { ...cameraViewFromPose('orbit', '600km'), headingDeg: 0 };
      expect(panCameraView(start, 0, 0.1, '600km').latDeg).toBeGreaterThan(start.latDeg);
      expect(panCameraView(start, 0.1, 0, '600km').lonDeg).toBeLessThan(start.lonDeg);
    });
  });

  describe('camera-relative sphere', () => {
    it('keeps high plus low equal to the exact position, so a 6,371 km body is placed to well under a millimetre', () => {
      const radius = 6_371_000;
      const geometry = createCameraRelativeSphereGeometry(radius, 16, 8);
      const high = geometry.getAttribute('position');
      const low = geometry.getAttribute('aPositionLow');
      const normal = geometry.getAttribute('normal');
      let worstHigh = 0;
      for (let i = 0; i < high.count; i++) {
        const length = Math.hypot(
          high.getX(i) + low.getX(i), high.getY(i) + low.getY(i), high.getZ(i) + low.getZ(i));
        expect(Math.abs(length - radius)).toBeLessThan(1e-3);
        worstHigh = Math.max(worstHigh, Math.abs(Math.hypot(high.getX(i), high.getY(i), high.getZ(i)) - radius));
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
      }
      // The float32 position alone is off by whole decimetres: that is what the low part exists to remove.
      expect(worstHigh).toBeGreaterThan(0.01);
    });
  });

  describe('morph', () => {
    it('drives the engine morph uniforms from the sphere material, clamped to 0..1, in dynamic projection centred on +X', () => {
      const sphere = createPlainSphereMaterial();
      expect(sphere.morph.uMorph.value).toBe(0);
      sphere.setMorph(0.4);
      expect(sphere.morph.uMorph.value).toBe(0.4);
      sphere.setMorph(7);
      expect(sphere.morph.uMorph.value).toBe(1);
      sphere.setMorph(-1);
      expect(sphere.morph.uMorph.value).toBe(0);
      expect(sphere.morph.uProjMode.value).toBe(1);
      expect(MORPH_CENTRE.lonDeg).toBe(0);
      expect(sphere.morph.uProjForward.value.toArray().map((c) => Math.round(c * 1e6) / 1e6)).toEqual([0, 0, 1]);
      sphere.setBodyRadius(600_000);
      expect(sphere.morph.uRadius.value).toBe(600_000);
      expect(sphere.morph.uMapWidth.value).toBeCloseTo(2 * Math.PI * 600_000, 3);
      expect(sphere.material.positionNode).toBeTruthy();
      expect(sphere.material.normalNode).toBeTruthy();
      sphere.material.dispose();
    });

    it('gives the geometry the flat-map attributes the morph graph declares, without touching the body-fixed position', () => {
      const geometry = createCameraRelativeSphereGeometry(600_000, 16, 8);
      expect(geometry.getAttribute('aFlatPos').count).toBe(geometry.getAttribute('position').count);
      expect(geometry.getAttribute('aFlatNorm').count).toBe(geometry.getAttribute('position').count);
      expect(geometry.getAttribute('aPositionLow')).toBeDefined();
    });

    it('turns shadows off while morphed, and only then', () => {
      const on = withFeature(defaultFeatureState(), 'shadows', true);
      expect(shadowsActive(on, 0)).toBeTrue();
      expect(shadowsActive(on, 0.01)).toBeFalse();
      expect(shadowsActive(on, 1)).toBeFalse();
      expect(shadowsActive(defaultFeatureState(), 0)).toBeFalse();
    });

    it('defaults to 0 and is compared like any other setting', () => {
      expect(PLANET_SHAPE_DEFAULTS.morph).toBe(0);
      expect(settingsMismatches({ ...PLANET_SHAPE_DEFAULTS, morph: 0.5 }, PLANET_SHAPE_DEFAULTS)).toEqual(['morph: expected 0, found 0.5']);
    });
  });

  describe('spin and sun', () => {
    it('turns once per day at 1x and keeps the sun direction unit length', () => {
      expect(spinAngleAfter(0, SPIN_PERIOD_S / 4, 1)).toBeCloseTo(Math.PI / 2, 12);
      expect(spinAngleAfter(0, 1, 1_000_000)).toBeCloseTo((1e6 * 2 * Math.PI) / SPIN_PERIOD_S % (2 * Math.PI), 9);
      for (const angle of [0, 1, 4]) expect(Math.hypot(...sunDirectionBody(angle))).toBeCloseTo(1, 12);
      sunDirectionBody(2 * Math.PI).forEach((component, i) => expect(component).toBeCloseTo(sunDirectionBody(0)[i], 12));
    });
  });

  describe('feature registry', () => {
    it('starts honest: only real features, defaults readable and comparable', () => {
      expect(FEATURES.map((feature) => feature.id)).toEqual(['shadows']);
      expect(defaultFeatureState()).toEqual({ shadows: false });
      expect(featureMismatches(withFeature(defaultFeatureState(), 'shadows', true), defaultFeatureState())).toEqual([
        'feature shadows: expected false, found true']);
    });
  });

  describe('gpu adapter description', () => {
    it('flattens the adapter the renderer actually uses and the drawing buffer', () => {
      const info = describeGpuAdapter({
        backend: {
          isWebGPUBackend: true,
          device: {
            adapterInfo: { vendor: 'nvidia', architecture: 'ada-lovelace', device: '0x2684', description: 'NVIDIA GeForce RTX 4090' },
            features: { has: (name: string) => name === 'timestamp-query' },
          },
        },
        domElement: { width: 2560, height: 1440 },
        getPixelRatio: () => 1.5,
      }, 1.5);
      expect(info).toEqual(jasmine.objectContaining({
        backend: 'webgpu', 'gpu.source': 'renderer.backend.device.adapterInfo', 'gpu.vendor': 'nvidia', 'gpu.architecture': 'ada-lovelace',
        'gpu.device': '0x2684', 'gpu.description': 'NVIDIA GeForce RTX 4090', 'gpu.software': false, 'gpu.timestampQuery': true,
        'canvas.drawingBufferWidth': 2560, 'canvas.drawingBufferHeight': 1440, devicePixelRatio: 1.5, rendererPixelRatio: 1.5,
      }));
      expect(adapterLabel(info)).toBe('nvidia / ada-lovelace / 0x2684 / NVIDIA GeForce RTX 4090');
    });

    it('labels software adapters and reports a missing adapter instead of inventing one', () => {
      const software = describeGpuAdapter({ backend: { isWebGPUBackend: true, device: { adapterInfo: { vendor: 'google', description: 'SwiftShader Device' } } } }, 1);
      expect(software['gpu.software']).toBeTrue();
      const none = describeGpuAdapter({ backend: { isWebGPUBackend: true, device: {} } }, 1);
      expect(none['gpu.source']).toBe('unavailable');
      expect(none['gpu.software']).toBeNull();
      expect(adapterLabel(none)).toBe('adapter unavailable');
      expect(describeGpuAdapter(undefined, 1)['backend']).toBe('none');
    });
  });

  describe('history', () => {
    it('is a valid performance suite with the noise floor, orbit and ground at three sizes', () => {
      expect(() => validateTestHistory(PLANET_SHAPE_TEST_HISTORY)).not.toThrow();
      expect(`${BASELINE.id}@${BASELINE.version}:${BASELINE.purpose}`).toBe('planet-shape-baseline@1:performance');
      expect(BASELINE.scenarios.map((scenario) => scenario.id)).toEqual([
        'empty-frame',
        'plain-sphere-orbit-64km', 'plain-sphere-ground-64km',
        'plain-sphere-orbit-600km', 'plain-sphere-ground-600km',
        'plain-sphere-orbit-6371km', 'plain-sphere-ground-6371km',
        'empty-frame-after',
      ]);
      expect(BASELINE.scenarios[0].settings.kind).toBe('empty');
    });

    it('judges the baseline suite: a committed baseline for every scenario and a GPU budget', () => {
      const ids = BASELINE.scenarios.map((scenario) => scenario.id);
      expect(Object.keys(BASELINE.baseline?.cases ?? {})).toEqual(ids);
      expect(BASELINE.baseline?.mode).toBe('standard');
      for (const scenario of BASELINE.scenarios) {
        expect(scenario.budgets?.['gpuPassTotal']?.p95).withContext(scenario.id).toBeGreaterThan(0);
        expect(Object.keys(BASELINE.baseline?.cases[scenario.id] ?? {})).withContext(scenario.id).toContain('gpuOutputPass');
      }
      expect(SHADOWS_AB.baseline).toBeUndefined();
      expect(SHADOWS_AB.scenarios.some((scenario) => scenario.budgets)).toBeFalse();
    });

    it('has the morph suite: 600 km, morph 0 / 0.5 / 1 at orbit and ground, budgeted, no baseline yet', () => {
      expect(() => validateTestHistory(PLANET_SHAPE_TEST_HISTORY)).not.toThrow();
      expect(`${MORPH.id}@${MORPH.version}:${MORPH.purpose}:${MORPH.expectedGpuVendor}`).toBe('planet-shape-morph@1:performance:nvidia');
      expect(MORPH.scenarios.map((scenario) => scenario.id)).toEqual([
        'morph-000-orbit-600km', 'morph-000-ground-600km', 'morph-050-orbit-600km', 'morph-050-ground-600km',
        'morph-100-orbit-600km', 'morph-100-ground-600km']);
      expect(MORPH.scenarios.map((scenario) => scenario.settings.morph)).toEqual([0, 0, 0.5, 0.5, 1, 1]);
      expect(MORPH.scenarios.map((scenario) => scenario.settings.poseId)).toEqual(['orbit', 'ground', 'orbit', 'ground', 'orbit', 'ground']);
      expect(MORPH.scenarios.every((scenario) => scenario.settings.bodyId === '600km' && scenario.settings.kind === 'sphere')).toBeTrue();
      expect(MORPH.baseline).toBeUndefined();
      const sphereBudget = BASELINE.scenarios[1].budgets?.['gpuPassTotal']?.p95;
      for (const scenario of MORPH.scenarios) expect(scenario.budgets?.['gpuPassTotal']?.p95).withContext(scenario.id).toBe(sphereBudget);
      // The existing suites keep their experiment: morph 0 everywhere.
      for (const scenario of [...BASELINE.scenarios, ...SHADOWS_AB.scenarios]) expect(scenario.settings.morph).withContext(scenario.id).toBe(0);
    });

    it('alternates shadows off (A) and on (B) per pose in the A/B suite', () => {
      expect(`${SHADOWS_AB.id}@${SHADOWS_AB.version}`).toBe('planet-shape-shadows-ab@1');
      expect(SHADOWS_AB.ablation?.metrics).toEqual(['gpuPassTotal', 'gpuScenePass']);
      for (const group of ['orbit-600km', 'ground-600km']) {
        const rounds = SHADOWS_AB.scenarios.filter((scenario) => scenario.ablation?.group === group);
        expect(rounds.map((scenario) => scenario.ablation?.arm)).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
        expect(rounds.map((scenario) => scenario.settings.features.shadows)).toEqual([false, true, false, true, false, true]);
        expect(new Set(rounds.map((scenario) => `${scenario.settings.bodyId}/${scenario.settings.poseId}`)).size).toBe(1);
      }
    });

    it('builds and parses an exact-version launch link', () => {
      const base = 'http://triangular-demo.localhost:4200/planet-shape-lab';
      const url = buildTestLaunchUrl(base, BASELINE, 'visible-browser', 1);
      expect(parseTestLaunch(new URL(url), PLANET_SHAPE_TEST_HISTORY)?.key).toBe('planet-shape-baseline@1');
    });
  });

  describe('adapter run', () => {
    it('applies scenarios, checks the real state, reports metrics and restores the captured state', async () => {
      const host = new FakeHost();
      const before = host.state;
      try {
        const result = await run(host, quick('empty-frame', 'plain-sphere-ground-6371km'));
        expect(result.errors).toEqual([]);
        // A visible-browser profile in a headless run also records "Page was not focused", so the status stays inconclusive.
        expect(result.cases.map((item) => item.status)).toEqual(['completed', 'completed']);
        expect(result.automatedVerdict).toBe('pass');
        expect(result.cases.map((item) => item.checks.every((check) => check.passed))).toEqual([true, true]);
        expect(result.cases[0].checks.map((check) => check.name)).toContain('Planet not drawn');
        expect(result.cases[1].checks.map((check) => check.name)).toContain('Planet drawn');
        expect(result.cases[0].metrics.map((metric) => metric.name)).toEqual([
          'frameInterval', 'renderSubmitCpu', 'gpuScenePass', 'gpuShadowPasses', 'gpuOutputPass', 'gpuPassTotal']);
        expect(result.cases[0].metrics.slice(2).every((metric) => metric.optional)).toBeTrue();
        expect(result.cases[0].metrics[2].unavailableReason).toBe('No GPU timestamp query on this renderer');
        expect(host.state).toEqual(before);
        expect(host.before.size).toBe(0);
        expect(host.render.size).toBe(0);
        expect(host.sampling).toBeFalse();
      } finally { host.dispose(); }
    }, 20_000);

    it('applies the morph setting through the host, checks it and restores the captured value', async () => {
      const host = new FakeHost();
      const before = host.state;
      const seen: number[] = [];
      const applied = host.apply.bind(host);
      host.apply = (settings) => { seen.push(settings.morph); applied(settings); };
      const suite = { ...MORPH, scenarios: MORPH.scenarios.filter((scenario) => scenario.id === 'morph-050-ground-600km')
        .map((scenario) => ({ ...scenario, durationMs: 300, warmupMs: 0 })) };
      try {
        const result = await run(host, suite);
        expect(result.errors).toEqual([]);
        expect(result.cases[0].checks.find((check) => check.name === 'Scenario state applied as specified')?.passed).toBeTrue();
        expect(seen).toEqual([0.5, 0]);
        expect(host.state.morph).toBe(before.morph);
      } finally { host.dispose(); }
    }, 20_000);

    it('takes one still per scenario after the measurement, from the first repetition only', async () => {
      const host = new FakeHost();
      const seenWhileSampling: boolean[] = [];
      host.thumbnail = async () => { seenWhileSampling.push(host.sampling); return new Blob([new Uint8Array(8)], { type: 'image/webp' }); };
      const pictures: { scenarioId: string; repetition: number; images: number }[] = [];
      try {
        const result = await new TestSession<PlanetShapeTestSettings, PlanetShapeTestSettings>().run(
          quick('empty-frame', 'plain-sphere-ground-6371km'), createPlanetShapeTestAdapter(host),
          { repetitions: 2, profile: 'headless-hardware', mode: 'standard', onThumbnails: (entry) => { pictures.push({ scenarioId: entry.scenarioId, repetition: entry.repetition, images: entry.images.length }); } });
        expect(result.errors).toEqual([]);
        expect(pictures).toEqual([
          { scenarioId: 'empty-frame', repetition: 1, images: 1 },
          { scenarioId: 'plain-sphere-ground-6371km', repetition: 1, images: 1 },
        ]);
        // The sampling window is closed before the picture is taken.
        expect(seenWhileSampling).toEqual([false, false]);
      } finally { host.dispose(); }
    }, 20_000);

    it('offers no thumbnail hook when the page cannot take one', () => {
      const host = new FakeHost();
      try {
        expect(createPlanetShapeTestAdapter(host).thumbnail).toBeUndefined();
        host.thumbnail = async () => undefined;
        expect(createPlanetShapeTestAdapter(host).thumbnail).toBeDefined();
      } finally { host.dispose(); }
    });

    it('fails the backend check off WebGPU', async () => {
      const host = new FakeHost();
      host.webgpu = false;
      try {
        const result = await run(host, quick('plain-sphere-orbit-600km'));
        expect(result.cases[0].checks.find((check) => check.name === 'WebGPU backend in use')?.passed).toBeFalse();
        expect(result.status).toBe('failed');
      } finally { host.dispose(); }
    }, 20_000);

    it('marks a software renderer as invalid performance evidence', async () => {
      const host = new FakeHost();
      host.software = true;
      try {
        const result = await run(host, quick('empty-frame'), 'visible-browser');
        expect(result.cases[0].validityIssues).toContain('Software renderer: functional evidence only, not hardware performance');
        expect(result.performanceVerdict).toBe('inconclusive');
      } finally { host.dispose(); }
    }, 20_000);

    it('reports per-pass GPU metrics and passes the timer self-test on unrounded timestamps', async () => {
      const host = new FakeHost();
      host.gpuPasses = gpuPassesOf(20, 1024);
      try {
        const result = await run(host, quick('plain-sphere-orbit-600km'));
        const [item] = result.cases;
        const metric = (name: string) => item.metrics.find((entry) => entry.name === name)!;
        expect(metric('gpuScenePass').samples.length).toBe(20);
        expect(metric('gpuOutputPass').samples.length).toBe(20);
        expect(metric('gpuShadowPasses').unavailableReason).toBe('No shadow pass rendered (shadows feature off)');
        expect(item.checks.find((check) => check.name === 'GPU timer self-test')?.passed).toBeTrue();
        expect(item.details?.['gpuTimestampStepNs']).toBe(1024);
        expect(String(item.details?.['gpuPassLabels'])).toContain('Lab:');
      } finally { host.dispose(); }
    }, 20_000);

    it('runs the shadows A/B suite into one outcome per pose and metric', async () => {
      const host = new FakeHost();
      host.gpuPasses = gpuPassesOf(20, 1024);
      const short = { ...SHADOWS_AB, scenarios: SHADOWS_AB.scenarios.map((scenario) => ({ ...scenario, durationMs: 200, warmupMs: 0 })) };
      try {
        const result = await run(host, short);
        expect(result.ablations?.map((outcome) => `${outcome.group}/${outcome.metric}`)).toEqual([
          'orbit-600km/gpuPassTotal', 'orbit-600km/gpuScenePass', 'ground-600km/gpuPassTotal', 'ground-600km/gpuScenePass']);
        // The fake host times every round alike, so B cannot differ from A.
        expect(result.ablations?.every((outcome) => outcome.result.verdict === 'no-difference')).toBeTrue();
      } finally { host.dispose(); }
    }, 30_000);

    it('ends a quick-mode window early once frame pacing settles', async () => {
      const host = new FakeHost();
      const long = { ...quick('plain-sphere-orbit-600km'), scenarios: [{ ...quick('plain-sphere-orbit-600km').scenarios[0], durationMs: 4000 }] };
      try {
        const result = await run(host, long, 'visible-browser', 'quick');
        expect(result.mode).toBe('quick');
        expect(result.cases[0].window?.mode).toBe('quick');
        expect(result.cases[0].window?.elapsedMs).toBeLessThanOrEqual(4100);
        expect(Object.keys(result.cases[0].window?.samples ?? {})).toEqual(['frameInterval', 'renderSubmitCpu']);
      } finally { host.dispose(); }
    }, 20_000);

    it('fails the timer self-test when timestamps are rounded', async () => {
      const host = new FakeHost();
      host.gpuPasses = gpuPassesOf(20, 65_536);
      try {
        const result = await run(host, quick('plain-sphere-orbit-600km'));
        const check = result.cases[0].checks.find((entry) => entry.name === 'GPU timer self-test');
        expect(check?.passed).toBeFalse();
        expect(check?.detail).toContain('rounded to 65536 ns');
      } finally { host.dispose(); }
    }, 20_000);

    it('names every field the page did not honour', () => {
      expect(settingsMismatches({ ...PLANET_SHAPE_DEFAULTS, bodyId: '64km', poseId: 'ground' }, PLANET_SHAPE_DEFAULTS)).toEqual([
        'bodyId: expected 600km, found 64km', 'poseId: expected orbit, found ground']);
    });
  });
});
