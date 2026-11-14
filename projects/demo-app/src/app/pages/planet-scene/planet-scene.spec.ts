import { buildTestBatchLaunchUrl, buildTestLaunchUrl, parseTestLaunch, validateTestHistory, type TestContext, type TestScenario } from 'triangular-engine/testing';
import {
  COAST_ALTITUDE_M, EYE_ALTITUDE_M, GROUND_PITCH_RAD, MID_ALTITUDE_M, ORBIT_ALTITUDE_M, ORBIT_PITCH_RAD, PLANET_RADIUS_M,
  descentView, morphSweepValue, motionMorph, motionView, morphSweepView, nearPlaneFor, planetPoseView, resolvePlanetCamera,
  sceneSunDirection, yawView,
} from './planet-camera';
import { createPlanetSceneTestAdapter, settingsMismatches, type PlanetSceneTestHost } from './planet-scene-test-adapter';
import { DEFAULT_PLANET_SCENE_SETTINGS, PLANET_SCENE_TEST_HISTORY, type PlanetSceneTestSettings } from './planet-scene-tests';

/** The final entry of the history: the version the runner selects. */
/** v3, the suite most of these specs describe; v4 has its own specs below. */
const SUITE = PLANET_SCENE_TEST_HISTORY[2];
const V4 = PLANET_SCENE_TEST_HISTORY[3];
const V5 = PLANET_SCENE_TEST_HISTORY[4];
const V1_IDS = ['orbit', 'mid-20km', 'ground', 'descent', 'yaw-360', 'orbit-atmosphere-off', 'ground-atmosphere-off'];
const BASE = 'http://triangular-demo.localhost:4200/planet-scene';

function scenarioOf(id: string): TestScenario<PlanetSceneTestSettings> {
  return SUITE.scenarios.find((item) => item.id === id) as TestScenario<PlanetSceneTestSettings>;
}

const GOOD_SUMMARY = { frames: 100, cpuMedianMs: 1, cpuP95Ms: 1, wallMedianMs: 6, wallP95Ms: 6, gpuMedianMs: null, gpuSamples: 0, invalidReasons: [], verdict: 'ok' as const };
const GOOD_FRAME = {
  leaves: 40, drawnLeaves: 30, surfaceTriangles: 30_000, deepestLevel: 12, capHit: false, unmet: 0, leafCap: 4096,
  drawCalls: 2, rendererTriangles: 30_100, drawingBuffer: [1, 1] as const,
};

/** A host whose scene is always ready; `override` replaces any member. A fake clock drives `context.wait`. */
function makeHost(override: Partial<PlanetSceneTestHost> = {}, state: { read?: () => PlanetSceneTestSettings } = {}) {
  let now = 0;
  const applied: PlanetSceneTestSettings[] = [];
  const renderCallbacks = new Set<(renderedAt: number) => void>();
  const host = {
    read: state.read ?? (() => DEFAULT_PLANET_SCENE_SETTINGS),
    apply: (settings: PlanetSceneTestSettings) => { applied.push(settings); },
    renderedFrames: () => Math.floor(now / 16),
    errors: () => '', resetErrors: () => undefined, backendIsWebGpu: () => true, pending: () => '',
    frame: () => GOOD_FRAME,
    onRenderComplete: (callback: (renderedAt: number) => void) => { renderCallbacks.add(callback); return () => renderCallbacks.delete(callback); },
    selectionSamples: () => [0.1, 0.2], leafSamples: () => [40, 41], resetSamples: () => undefined,
    setMotionProgress: () => undefined,
    isSampling: () => false, startSampling: () => undefined, gpuSamplesSoFar: () => [],
    stopSampling: () => GOOD_SUMMARY,
    environment: () => ({ 'gpu.description': 'test adapter', 'gpu.vendor': 'test', 'planet.radiusM': 600_000 }),
    ...override,
  } as unknown as PlanetSceneTestHost;
  spyOn(performance, 'now').and.callFake(() => now);
  const context = {
    mode: 'quick', repetition: 1, signal: new AbortController().signal,
    wait: (ms: number) => {
      now += ms;
      // A scripted move renders while it waits.
      for (const callback of renderCallbacks) callback(now);
      return Promise.resolve();
    },
    measureWindow: () => {
      for (let k = 0; k < 4; k++) for (const callback of renderCallbacks) callback(now += 16);
      return Promise.resolve();
    },
  } as unknown as TestContext;
  return { host, context, applied, now: () => now };
}

describe('Plan 059 G5 planet-scene suite', () => {
  it('is a valid history: v1, v2 then v3, unique case ids, plain JSON settings, the planned cases', () => {
    expect(() => validateTestHistory(PLANET_SCENE_TEST_HISTORY)).not.toThrow();
    expect(PLANET_SCENE_TEST_HISTORY.map((suite) => [suite.id, suite.version])).toEqual([['planet-scene', 1], ['planet-scene', 2], ['planet-scene', 3], ['planet-scene', 4], ['planet-scene', 5]]);
    expect(SUITE.version).toBe(3);
    const ids = SUITE.scenarios.map((scenario) => scenario.id);
    expect(ids).toEqual([...V1_IDS, 'orbit-morph-0.5', 'orbit-morph-1', 'ground-morph-0.5', 'ground-morph-1', 'morph-sweep', 'orbit-morph-1-atmosphere-off', 'ground-morph-1-atmosphere-off']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of SUITE.scenarios) {
      expect(JSON.parse(JSON.stringify(scenario.settings))).toEqual(scenario.settings);
      expect(scenario.settings.terrain).withContext(scenario.id).toBeTrue();
      expect(scenario.settings.atmosphere).withContext(scenario.id).toBe(!scenario.id.endsWith('atmosphere-off'));
    }
    expect(SUITE.purpose).toBe('performance');
    expect(SUITE.requiresVisualReview).toBeTrue();
  });

  it('keeps v1 as it was shared: the same seven cases with the same settings, all at morph 0', () => {
    const v1 = PLANET_SCENE_TEST_HISTORY[0];
    expect(v1.title).toContain('G5');
    expect(v1.scenarios.map((scenario) => scenario.id)).toEqual(V1_IDS);
    for (const scenario of v1.scenarios) {
      expect(scenario.settings.morph).withContext(scenario.id).toBe(0);
      expect(SUITE.scenarios.find((item) => item.id === scenario.id)?.settings).withContext(scenario.id).toEqual(scenario.settings);
    }
  });

  it('gives the v2 morph cases the morph they name, at orbit and at the 2 m eye, with still timing', () => {
    const morphs: [string, string, number][] = [
      ['orbit-morph-0.5', 'orbit', 0.5], ['orbit-morph-1', 'orbit', 1],
      ['ground-morph-0.5', 'ground', 0.5], ['ground-morph-1', 'ground', 1],
    ];
    for (const [id, pose, morph] of morphs) {
      const scenario = scenarioOf(id);
      expect(scenario.settings).withContext(id).toEqual({ ...DEFAULT_PLANET_SCENE_SETTINGS, pose: pose as PlanetSceneTestSettings['pose'], morph });
      expect(scenario.settings.motion).withContext(id).toBeUndefined();
      expect(scenario.label).withContext(id).toMatch(/morph/);
      expect(scenario.durationMs).toBe(scenarioOf('orbit').durationMs);
    }
    expect(scenarioOf('orbit-morph-0.5').label).toBe('orbit · morph 0.5');
  });

  it('defines the morph sweep at orbit with the same timing as the other scripted cases', () => {
    const sweep = scenarioOf('morph-sweep');
    expect(sweep.settings).toEqual({ ...DEFAULT_PLANET_SCENE_SETTINGS, pose: 'orbit', morph: 0, motion: 'morphSweep' });
    expect(sweep.warmupMs).toBe(500);
    expect(sweep.durationMs).toBe(12_000);
    expect(sweep.quickMs).toBe(6000);
    expect(sweep.quickMs).toBeLessThan(sweep.durationMs);
  });

  it('makes each atmosphere-off case differ from its partner only in the atmosphere', () => {
    for (const [partner, base] of [['orbit-atmosphere-off', 'orbit'], ['ground-atmosphere-off', 'ground'], ['orbit-morph-1-atmosphere-off', 'orbit-morph-1'], ['ground-morph-1-atmosphere-off', 'ground-morph-1']] as const) {
      expect(scenarioOf(partner).settings).toEqual({ ...scenarioOf(base).settings, atmosphere: false });
      expect(scenarioOf(partner).warmupMs).toBe(scenarioOf(base).warmupMs);
      expect(scenarioOf(partner).durationMs).toBe(scenarioOf(base).durationMs);
    }
  });

  it('keeps v4 as v3 plus the plain-material A/B: each plain case differs from its partner only in the material', () => {
    expect(V4.version).toBe(4);
    const ids = V4.scenarios.map((scenario) => scenario.id);
    expect(ids.slice(0, SUITE.scenarios.length)).toEqual(SUITE.scenarios.map((scenario) => scenario.id));
    expect(ids.slice(SUITE.scenarios.length)).toEqual(['orbit-morph-0.5-atmosphere-off', 'orbit-plain', 'orbit-morph-0.5-plain', 'orbit-morph-1-plain', 'ground-morph-1-plain']);
    expect(new Set(ids).size).toBe(ids.length);
    const of = (id: string) => V4.scenarios.find((scenario) => scenario.id === id) as TestScenario<PlanetSceneTestSettings>;
    for (const [plain, partner] of [
      ['orbit-plain', 'orbit-atmosphere-off'], ['orbit-morph-0.5-plain', 'orbit-morph-0.5-atmosphere-off'],
      ['orbit-morph-1-plain', 'orbit-morph-1-atmosphere-off'], ['ground-morph-1-plain', 'ground-morph-1-atmosphere-off'],
    ] as const) {
      expect(of(plain).settings).withContext(plain).toEqual({ ...of(partner).settings, plainMaterial: true });
      expect(of(partner).settings.plainMaterial).withContext(partner).toBeUndefined();
      expect(of(plain).durationMs).toBe(of(partner).durationMs);
    }
    // The older suites are unchanged: none of their cases names the plain material.
    for (const scenario of SUITE.scenarios) expect(scenario.settings.plainMaterial).withContext(scenario.id).toBeUndefined();
  });

  it('keeps v5 as v4 unchanged plus the layer ladder, the air pairs and two full-stack motion cases', () => {
    expect(V5.version).toBe(5);
    expect(() => validateTestHistory(PLANET_SCENE_TEST_HISTORY)).not.toThrow();
    const ids = V5.scenarios.map((scenario) => scenario.id);
    expect(ids.slice(0, V4.scenarios.length)).toEqual(V4.scenarios.map((scenario) => scenario.id));
    for (const old of V4.scenarios) expect(V5.scenarios.find((item) => item.id === old.id)).withContext(old.id).toEqual(old);
    expect(new Set(ids).size).toBe(ids.length);
    expect(V5.purpose).toBe('performance');
    expect(V5.requiresVisualReview).toBeTrue();
    expect(V5.ablation?.metrics).toEqual(['gpuPassTotal']);
    expect(ids.slice(-2)).toEqual(['descent-full-stack', 'morph-sweep-full-stack']);
  });

  it('builds the ladder: four views, three cumulative steps, A B A B, B adding one layer to A', () => {
    const added = { air: 'atmosphere', clouds: 'clouds', water: 'water' } as const;
    for (const view of ['orbit', '20km', 'coast', 'eye']) {
      for (const step of ['air', 'clouds', 'water'] as const) {
        const group = `ladder-${view}-${step}`;
        const cases = V5.scenarios.filter((item) => item.ablation?.group === group);
        expect(cases.map((item) => item.ablation?.arm)).withContext(group).toEqual(['A', 'B', 'A', 'B']);
        const [a, b] = cases;
        expect(a.settings.morph).toBe(0);
        expect(a.settings.pose).toBe(b.settings.pose);
        const key = added[step];
        expect(a.settings[key] ?? (key === 'clouds')).withContext(group).toBeFalse();
        expect(b.settings[key] ?? (key === 'clouds')).withContext(group).toBeTrue();
      }
    }
    expect(V5.scenarios.find((item) => item.id === 'ladder-coast-air-A1')?.settings.pose).toBe('coast');
    expect(V5.scenarios.find((item) => item.id === 'ladder-eye-air-A1')?.settings.pose).toBe('ground');
  });

  it('keeps the air pairs at the planned morphs, air off against air on, clouds on and water out', () => {
    const groups = [...new Set(V5.scenarios.map((item) => item.ablation?.group).filter((group): group is string => !!group && group.startsWith('air-')))];
    expect(groups).toEqual(['air-orbit-morph-0', 'air-orbit-morph-0.25', 'air-orbit-morph-0.5', 'air-orbit-morph-1', 'air-20km-morph-0', 'air-20km-morph-0.5']);
    for (const group of groups) {
      const [a, b] = V5.scenarios.filter((item) => item.ablation?.group === group);
      expect(a.settings.atmosphere).toBeFalse();
      expect(b.settings.atmosphere).toBeTrue();
      expect(a.settings.clouds).toBeTrue();
      expect(b.settings.water ?? false).toBeFalse();
      expect(a.settings.morph).toBe(b.settings.morph);
    }
  });

  it('carries the planet-stack budgets the runner can express', () => {
    const median = (id: string) => V5.scenarios.find((item) => item.id === id)?.budgets?.['gpuPassTotal']?.median;
    expect([median('ladder-orbit-water-B1'), median('ladder-20km-water-B1'), median('ladder-coast-water-B1'), median('ladder-eye-water-B2')]).toEqual([2.6, 4.5, 5.5, 5.5]);
    expect(median('air-orbit-morph-1-B1')).toBe(4.6);
    expect(median('ladder-orbit-water-A1')).toBeUndefined();
    for (const id of ['descent-full-stack', 'morph-sweep-full-stack']) {
      const scenario = V5.scenarios.find((item) => item.id === id);
      expect(scenario?.budgets).withContext(id).toEqual({ gpuPassTotal: { p95: 7 }, selectionCpu: { p95: 4 } });
    }
    expect(V5.scenarios.find((item) => item.id === 'descent-full-stack')?.settings.water).toBeTrue();
    expect(V5.scenarios.find((item) => item.id === 'morph-sweep-full-stack')?.settings.water).toBeFalse();
  });

  it('treats omitted clouds as on and omitted water as off, and names a mismatch', () => {
    expect(settingsMismatches(DEFAULT_PLANET_SCENE_SETTINGS, { ...DEFAULT_PLANET_SCENE_SETTINGS, clouds: true, water: false })).toEqual([]);
    expect(settingsMismatches(DEFAULT_PLANET_SCENE_SETTINGS, { ...DEFAULT_PLANET_SCENE_SETTINGS, clouds: false })).toEqual(['clouds: expected false, found true']);
    expect(settingsMismatches(DEFAULT_PLANET_SCENE_SETTINGS, { ...DEFAULT_PLANET_SCENE_SETTINGS, water: true })).toEqual(['water: expected true, found false']);
    for (const scenario of SUITE.scenarios) expect(scenario.settings.clouds ?? scenario.settings.water).withContext(scenario.id).toBeUndefined();
  });

  it('launches v5 by its exact version', () => {
    const url = buildTestLaunchUrl(BASE, V5, 'visible-browser', 1, 'quick');
    expect(url).toContain('testSuite=planet-scene');
    expect(url).toContain('testVersion=5');
    expect(parseTestLaunch(new URL(url), PLANET_SCENE_TEST_HISTORY)?.key).toBe('planet-scene@5');
  });

  it('treats an omitted plainMaterial as the planet material and names a mismatch', () => {
    expect(settingsMismatches(DEFAULT_PLANET_SCENE_SETTINGS, { ...DEFAULT_PLANET_SCENE_SETTINGS, plainMaterial: false })).toEqual([]);
    expect(settingsMismatches(DEFAULT_PLANET_SCENE_SETTINGS, { ...DEFAULT_PLANET_SCENE_SETTINGS, plainMaterial: true })).toEqual(['plainMaterial: expected true, found false']);
  });

  it('runs the scripted cases on a motion and the still cases on none', () => {
    expect(scenarioOf('descent').settings.motion).toBe('descent');
    expect(scenarioOf('yaw-360').settings.motion).toBe('yaw360');
    expect(scenarioOf('morph-sweep').settings.motion).toBe('morphSweep');
    const still = ['orbit', 'mid-20km', 'ground', 'orbit-atmosphere-off', 'ground-atmosphere-off', 'orbit-morph-0.5', 'orbit-morph-1', 'ground-morph-0.5', 'ground-morph-1'];
    for (const id of still) expect(scenarioOf(id).settings.motion).withContext(id).toBeUndefined();
    expect(scenarioOf('descent').quickMs).toBeLessThan(scenarioOf('descent').durationMs);
  });

  it('names every setting the page did not honour', () => {
    expect(settingsMismatches(DEFAULT_PLANET_SCENE_SETTINGS, DEFAULT_PLANET_SCENE_SETTINGS)).toEqual([]);
    expect(settingsMismatches({ ...DEFAULT_PLANET_SCENE_SETTINGS, atmosphere: false }, DEFAULT_PLANET_SCENE_SETTINGS)).toEqual(['atmosphere: expected true, found false']);
    expect(settingsMismatches(DEFAULT_PLANET_SCENE_SETTINGS, { ...DEFAULT_PLANET_SCENE_SETTINGS, motion: 'descent' }).length).toBe(1);
  });

  it('builds and parses launch links for the suite and for one case', () => {
    const url = buildTestLaunchUrl(BASE, SUITE, 'visible-browser', 1, 'quick');
    expect(url).toBe(`${BASE}?testSuite=planet-scene&testVersion=3&testProfile=visible-browser&testMode=quick&testRepetitions=1&testAutoStart=1`);
    expect(parseTestLaunch(new URL(url), PLANET_SCENE_TEST_HISTORY)?.key).toBe('planet-scene@3');
    const batch = buildTestBatchLaunchUrl(BASE, [{ suiteId: 'planet-scene', suiteVersion: 3, scenarioId: 'orbit' }], 'visible-browser', 1, 'quick');
    expect(batch).toContain('testCases=orbit');
    expect(parseTestLaunch(new URL(batch), PLANET_SCENE_TEST_HISTORY)?.cases).toEqual([{ suiteId: 'planet-scene', suiteVersion: 3, scenarioId: 'orbit' }]);
    for (const scenario of SUITE.scenarios) {
      const link = buildTestBatchLaunchUrl(BASE, [{ suiteId: 'planet-scene', suiteVersion: 3, scenarioId: scenario.id }], 'visible-browser', 1, 'quick');
      expect(parseTestLaunch(new URL(link), PLANET_SCENE_TEST_HISTORY)?.cases?.length).withContext(scenario.id).toBe(1);
    }
  });

  it('still launches the v1 suite by its exact version', () => {
    const url = buildTestLaunchUrl(BASE, PLANET_SCENE_TEST_HISTORY[0], 'visible-browser', 1, 'quick');
    expect(parseTestLaunch(new URL(url), PLANET_SCENE_TEST_HISTORY)?.key).toBe('planet-scene@1');
  });
});

describe('Plan 059 G5 planet-scene cameras', () => {
  it('stands the coast pose 50 m up', () => {
    const camera = resolvePlanetCamera(planetPoseView('coast'), PLANET_RADIUS_M, 0);
    expect(Math.hypot(...camera.position)).toBeCloseTo(PLANET_RADIUS_M + COAST_ALTITUDE_M, 6);
    expect(camera.clearanceM).toBe(COAST_ALTITUDE_M);
  });

  it('stands the three poses on the planet at their altitudes', () => {
    for (const [id, altitude] of [['orbit', ORBIT_ALTITUDE_M], ['mid-20km', MID_ALTITUDE_M], ['ground', EYE_ALTITUDE_M]] as const) {
      const camera = resolvePlanetCamera(planetPoseView(id), PLANET_RADIUS_M, 0);
      expect(Math.hypot(...camera.position)).withContext(id).toBeCloseTo(PLANET_RADIUS_M + altitude, 6);
      expect(camera.clearanceM).toBe(altitude);
    }
    expect(planetPoseView('orbit').pitchRad).toBe(ORBIT_PITCH_RAD);
    expect(planetPoseView('ground').pitchRad).toBe(GROUND_PITCH_RAD);
  });

  it('keeps the eye above the drawn ground', () => {
    const view = planetPoseView('ground');
    const flat = Math.hypot(...resolvePlanetCamera(view, PLANET_RADIUS_M, 0).position);
    const hill = Math.hypot(...resolvePlanetCamera(view, PLANET_RADIUS_M, 350).position);
    expect(hill - flat).toBeCloseTo(350, 6);
  });

  it('gives an orthonormal camera basis', () => {
    const camera = resolvePlanetCamera(planetPoseView('mid-20km'), PLANET_RADIUS_M, 0);
    const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(camera.right, camera.right)).toBeCloseTo(1, 12);
    expect(dot(camera.forward, camera.forward)).toBeCloseTo(1, 12);
    expect(dot(camera.up, camera.up)).toBeCloseTo(1, 12);
    expect(dot(camera.right, camera.forward)).toBeCloseTo(0, 12);
    expect(dot(camera.up, camera.forward)).toBeCloseTo(0, 12);
  });

  it('descends from the orbit pose to the eye pose over one ground point, falling monotonically', () => {
    const start = descentView(0);
    const end = descentView(1);
    expect(start).toEqual(planetPoseView('orbit'));
    expect(end.altitudeM).toBeCloseTo(EYE_ALTITUDE_M, 9);
    expect(end.pitchRad).toBeCloseTo(GROUND_PITCH_RAD, 12);
    expect(end.ground).toEqual(start.ground);
    let previous = Infinity;
    for (let k = 0; k <= 20; k++) {
      const altitude = descentView(k / 20).altitudeM;
      expect(altitude).toBeLessThan(previous);
      previous = altitude;
    }
    expect(descentView(-1).altitudeM).toBe(start.altitudeM);
    expect(descentView(2).altitudeM).toBeCloseTo(EYE_ALTITUDE_M, 9);
  });

  it('turns once round at the eye', () => {
    expect(yawView(0)).toEqual(planetPoseView('ground'));
    expect(yawView(1).headingRad - yawView(0).headingRad).toBeCloseTo(2 * Math.PI, 12);
    expect(yawView(0.5).altitudeM).toBe(EYE_ALTITUDE_M);
    expect(motionView('yaw360', 0.25)).toEqual(yawView(0.25));
    expect(motionView('descent', 0.25)).toEqual(descentView(0.25));
  });

  it('sweeps the morph 0 to 1 and back to 0, exactly at both ends, smoothly and without leaving 0..1', () => {
    expect(morphSweepValue(0)).toBe(0);
    expect(morphSweepValue(1)).toBe(0);
    expect(morphSweepValue(0.5)).toBe(1);
    expect(morphSweepValue(-1)).toBe(0);
    expect(morphSweepValue(2)).toBe(0);
    const steps = Array.from({ length: 201 }, (_, k) => morphSweepValue(k / 200));
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...steps)).toBeLessThanOrEqual(1);
    for (let k = 1; k < steps.length; k++) {
      expect(steps[k] - steps[k - 1]).toBeLessThan(0.03);
      expect(steps[k] - steps[k - 1]).toBeGreaterThan(-0.03);
      // Rises up to the peak, falls after it.
      if (k <= 100) expect(steps[k]).toBeGreaterThanOrEqual(steps[k - 1]);
      else expect(steps[k]).toBeLessThanOrEqual(steps[k - 1]);
    }
  });

  it('keeps the camera on the orbit pose for the whole morph sweep and sets the morph only for that move', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(motionView('morphSweep', t)).toEqual(planetPoseView('orbit'));
    }
    expect(morphSweepView()).toEqual(planetPoseView('orbit'));
    expect(motionMorph('morphSweep', 0.5)).toBe(1);
    expect(motionMorph('morphSweep', 0)).toBe(0);
    expect(motionMorph('descent', 0.5)).toBeUndefined();
    expect(motionMorph('yaw360', 0.5)).toBeUndefined();
  });

  it('keeps the near plane between 2 cm and 1 km and the sun a unit vector above the pose ground', () => {
    expect(nearPlaneFor(2)).toBe(0.5);
    expect(nearPlaneFor(0.01)).toBe(0.02);
    expect(nearPlaneFor(1_200_000)).toBe(1000);
    const sun = sceneSunDirection();
    expect(Math.hypot(...sun)).toBeCloseTo(1, 12);
    const up = resolvePlanetCamera(planetPoseView('ground'), PLANET_RADIUS_M, 0).position;
    const length = Math.hypot(...up);
    expect((sun[0] * up[0] + sun[1] * up[1] + sun[2] * up[2]) / length).toBeGreaterThan(0.5);
  });
});

describe('Plan 059 G5 planet-scene adapter', () => {
  const TIMEOUT = 'gpuTiming: GpuReadbackTimeoutError: GPU timestamp readback timed out after 500 ms';
  const orbit = scenarioOf('orbit');

  it('applies the scenario settings and clears the errors first', () => {
    let cleared = 0;
    const made = makeHost({ resetErrors: () => { cleared++; } });
    createPlanetSceneTestAdapter(made.host).apply(scenarioOf('ground-atmosphere-off'), made.context);
    expect(cleared).toBe(1);
    expect(made.applied).toEqual([scenarioOf('ground-atmosphere-off').settings]);
  });

  describe('settling', () => {
    it('waits for what the scene reports it is still waiting for, then settles', async () => {
      let now = () => 0;
      const made = makeHost({ pending: () => (now() < 1_000 ? 'the height bake' : '') });
      now = made.now;
      await createPlanetSceneTestAdapter(made.host).ready!(made.context, orbit);
      expect(made.now()).toBeGreaterThanOrEqual(1_000);
    });

    it('waits until the page shows the settings of the case', async () => {
      let now = () => 0;
      const made = makeHost({}, { read: () => (now() < 500 ? { ...DEFAULT_PLANET_SCENE_SETTINGS, atmosphere: false } : DEFAULT_PLANET_SCENE_SETTINGS) });
      now = made.now;
      await createPlanetSceneTestAdapter(made.host).ready!(made.context, orbit);
      expect(made.now()).toBeGreaterThanOrEqual(500);
    });

    it('tolerates up to three GPU timestamp readback timeouts, clears them and settles afterwards', async () => {
      let error = '';
      let resets = 0;
      const queue = [20, 60, 100];
      let now = () => 0;
      const made = makeHost({ errors: () => error, resetErrors: () => { error = ''; resets++; } });
      now = made.now;
      const wait = made.context.wait;
      (made.context as { wait: (ms: number) => Promise<void> }).wait = (ms) => {
        const result = wait(ms);
        if (queue.length && now() >= queue[0]) { queue.shift(); error = TIMEOUT; }
        return result;
      };
      await createPlanetSceneTestAdapter(made.host).ready!(made.context, orbit);
      expect(resets).toBe(3);
      expect(made.now()).toBeGreaterThan(100);
    });

    it('throws when a settle sees a fourth readback timeout', async () => {
      let error = '';
      const queue = [20, 60, 100, 140];
      let now = () => 0;
      const made = makeHost({ errors: () => error, resetErrors: () => { error = ''; } });
      now = made.now;
      const wait = made.context.wait;
      (made.context as { wait: (ms: number) => Promise<void> }).wait = (ms) => {
        const result = wait(ms);
        if (queue.length && now() >= queue[0]) { queue.shift(); error = TIMEOUT; }
        return result;
      };
      await expectAsync(createPlanetSceneTestAdapter(made.host).ready!(made.context, orbit)).toBeRejectedWithError(/at most 3 tolerated/);
    });

    it('still throws on any other engine error', async () => {
      const made = makeHost({ errors: () => 'render: boom' });
      await expectAsync(createPlanetSceneTestAdapter(made.host).ready!(made.context, orbit)).toBeRejectedWithError('render: boom');
    });
  });

  describe('measuring', () => {
    it('reports the metrics, the clouds shell and the GPU adapter for a still case', async () => {
      const made = makeHost();
      const observation = await createPlanetSceneTestAdapter(made.host).measure(orbit, made.context);
      const names = observation.metrics?.map((metric) => metric.name);
      expect(names).toEqual(jasmine.arrayContaining([
        'selectionCpu', 'leaves', 'drawnLeaves', 'surfaceTriangles', 'rendererTriangles', 'drawCalls', 'frameInterval',
        'gpuScenePass', 'gpuOutputPass', 'gpuFullscreenPasses', 'gpuPassTotal',
      ]));
      expect(observation.metrics?.find((metric) => metric.name === 'drawCalls')?.samples).toEqual([2]);
      expect(observation.details?.['clouds']).toBe('shell');
      expect(observation.details?.['gpuAdapter']).toBe('test adapter');
      expect(observation.checks?.every((check) => check.passed)).toBeTrue();
      expect(observation.limitations?.some((line) => /far shell/.test(line))).toBeTrue();
      expect(observation.limitations?.some((line) => /bends the terrain into the map/.test(line))).toBeTrue();
      expect(observation.limitations?.some((line) => /sky is the globe/.test(line))).toBeTrue();
      expect(observation.limitations?.some((line) => /morph is 0/.test(line))).toBeFalse();
    });

    it('checks the morph of a morph case: a page that keeps the globe fails the state check', async () => {
      const morph1 = scenarioOf('orbit-morph-1');
      const made = makeHost({}, { read: () => ({ ...DEFAULT_PLANET_SCENE_SETTINGS, morph: 0 }) });
      const observation = await createPlanetSceneTestAdapter(made.host).measure(morph1, made.context);
      const check = observation.checks?.find((item) => item.name === 'Scenario state applied as specified');
      expect(check?.passed).toBeFalse();
      expect(check?.detail).toBe('morph: expected 1, found 0');
    });

    it('measures a morph still case at its morph with no motion', async () => {
      const morph05 = scenarioOf('ground-morph-0.5');
      const made = makeHost({}, { read: () => morph05.settings });
      const observation = await createPlanetSceneTestAdapter(made.host).measure(morph05, made.context);
      expect(observation.checks?.every((check) => check.passed)).toBeTrue();
      expect(observation.details?.['motionSeconds']).toBeUndefined();
    });

    it('runs the morph sweep with the morph following its progress, ends at morph 0 and passes the state check', async () => {
      let progress: number | undefined;
      let morph = 0;
      const seen: number[] = [];
      const made = makeHost({
        setMotionProgress: (t) => {
          progress = t;
          if (t !== undefined) {
            morph = motionMorph('morphSweep', t) ?? 0;
            seen.push(morph);
          }
        },
      }, { read: () => ({ ...DEFAULT_PLANET_SCENE_SETTINGS, morph, ...(progress !== undefined ? { motion: 'morphSweep' as const } : {}) }) });
      const scenario = scenarioOf('morph-sweep');
      const observation = await createPlanetSceneTestAdapter(made.host).measure(scenario, made.context);
      expect(observation.checks?.find((check) => check.name === 'Scenario state applied as specified')?.passed).toBeTrue();
      expect(observation.checks?.find((check) => check.name.startsWith('No rebuild storm'))?.passed).toBeTrue();
      expect(seen[0]).toBe(0);
      expect(seen[seen.length - 1]).toBe(0);
      expect(Math.max(...seen)).toBeGreaterThan(0.99);
      expect(Math.max(...seen)).toBeLessThanOrEqual(1);
      expect(morph).toBe(0);
      expect(progress).toBeUndefined();
      expect(made.now()).toBeGreaterThanOrEqual(scenario.quickMs!);
      expect(observation.details?.['motionSeconds']).toBeCloseTo(scenario.quickMs! / 1000, 1);
    });

    it('captures the morph the page shows, and restores a snapshot that holds a morph', async () => {
      const shown = { ...DEFAULT_PLANET_SCENE_SETTINGS, morph: 0.5 };
      const made = makeHost({}, { read: () => shown });
      const adapter = createPlanetSceneTestAdapter(made.host);
      expect(adapter.capture!(made.context)).toEqual(shown);
      await adapter.restore!(shown, made.context);
      expect(made.applied).toEqual([shown]);
      expect(made.applied[0].morph).toBe(0.5);
    });

    it('fails the state check when the page shows other settings', async () => {
      const made = makeHost({}, { read: () => ({ ...DEFAULT_PLANET_SCENE_SETTINGS, atmosphere: false }) });
      const observation = await createPlanetSceneTestAdapter(made.host).measure(orbit, made.context);
      expect(observation.checks?.find((check) => check.name === 'Scenario state applied as specified')?.passed).toBeFalse();
    });

    it('fails a readback timeout inside the measured window', async () => {
      const made = makeHost({ errors: () => TIMEOUT });
      const observation = await createPlanetSceneTestAdapter(made.host).measure(orbit, made.context);
      expect(observation.checks?.find((check) => check.name === 'No engine or console error')?.passed).toBeFalse();
    });

    it('flags a software renderer as functional evidence only', async () => {
      const made = makeHost({ environment: () => ({ 'gpu.software': true }) });
      const observation = await createPlanetSceneTestAdapter(made.host).measure(orbit, made.context);
      expect(observation.validityIssues?.some((line) => /Software renderer/.test(line))).toBeTrue();
    });

    it('does not ask for terrain figures when the terrain is off', async () => {
      const off: TestScenario<PlanetSceneTestSettings> = { ...orbit, settings: { ...orbit.settings, terrain: false } };
      const made = makeHost({ frame: () => ({ ...GOOD_FRAME, drawnLeaves: 0, leaves: 0 }), selectionSamples: () => [], leafSamples: () => [] }, { read: () => off.settings });
      const observation = await createPlanetSceneTestAdapter(made.host).measure(off, made.context);
      expect(observation.checks?.find((check) => check.name === 'Terrain drawn in one draw call')?.passed).toBeTrue();
      expect(observation.metrics?.find((metric) => metric.name === 'selectionCpu')?.optional).toBeTrue();
    });

    it('checks the state of a scripted case while the move runs, steps the progress and ends on the named pose', async () => {
      let progress: number | undefined = 0;
      const steps: number[] = [];
      const made = makeHost({
        setMotionProgress: (t) => { progress = t; if (t !== undefined) steps.push(t); },
      }, { read: () => ({ ...DEFAULT_PLANET_SCENE_SETTINGS, ...(progress !== undefined ? { motion: 'descent' as const } : {}) }) });
      const scenario = scenarioOf('descent');
      const observation = await createPlanetSceneTestAdapter(made.host).measure(scenario, made.context);
      expect(observation.checks?.find((check) => check.name === 'Scenario state applied as specified')?.passed).toBeTrue();
      expect(progress).toBeUndefined();
      // Quick mode runs quickMs of the move, in 16 ms steps from 0, the last clamped to the end.
      expect(steps[0]).toBe(0);
      expect(steps[steps.length - 1]).toBe(1);
      expect(steps.every((t, k) => k === 0 || t >= steps[k - 1])).toBeTrue();
      expect(made.now()).toBeGreaterThanOrEqual(scenario.quickMs!);
      expect(observation.details?.['motionSeconds']).toBeCloseTo(scenario.quickMs! / 1000, 1);
    });

    it('fails a scripted case whose terrain selection rebuilds in one slow frame', async () => {
      let progress: number | undefined = 0;
      const made = makeHost({
        setMotionProgress: (t) => { progress = t; },
        selectionSamples: () => [0.2, 12],
      }, { read: () => ({ ...DEFAULT_PLANET_SCENE_SETTINGS, ...(progress !== undefined ? { motion: 'yaw360' as const } : {}) }) });
      const observation = await createPlanetSceneTestAdapter(made.host).measure(scenarioOf('yaw-360'), made.context);
      expect(observation.checks?.find((check) => check.name.startsWith('No rebuild storm'))?.passed).toBeFalse();
    });

    it('refuses to measure while another sampling window is open', async () => {
      const made = makeHost({ isSampling: () => true });
      await expectAsync(createPlanetSceneTestAdapter(made.host).measure(orbit, made.context)).toBeRejectedWithError(/already active/);
    });
  });

  it('restores the snapshot and clears any scripted move', async () => {
    const cleared: (number | undefined)[] = [];
    const made = makeHost({ setMotionProgress: (t) => { cleared.push(t); } });
    const snapshot = { ...DEFAULT_PLANET_SCENE_SETTINGS, pose: 'mid-20km' as const };
    await createPlanetSceneTestAdapter(made.host).restore!(snapshot, made.context);
    expect(cleared).toEqual([undefined]);
    expect(made.applied).toEqual([snapshot]);
  });
});
