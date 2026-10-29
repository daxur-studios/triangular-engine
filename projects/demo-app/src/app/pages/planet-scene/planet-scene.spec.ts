import { buildTestBatchLaunchUrl, buildTestLaunchUrl, parseTestLaunch, validateTestHistory, type TestContext, type TestScenario } from 'triangular-engine/testing';
import {
  EYE_ALTITUDE_M, GROUND_PITCH_RAD, MID_ALTITUDE_M, ORBIT_ALTITUDE_M, ORBIT_PITCH_RAD, PLANET_RADIUS_M,
  descentView, motionView, nearPlaneFor, planetPoseView, resolvePlanetCamera, sceneSunDirection, yawView,
} from './planet-camera';
import { createPlanetSceneTestAdapter, settingsMismatches, type PlanetSceneTestHost } from './planet-scene-test-adapter';
import { DEFAULT_PLANET_SCENE_SETTINGS, PLANET_SCENE_TEST_HISTORY, type PlanetSceneTestSettings } from './planet-scene-tests';

const SUITE = PLANET_SCENE_TEST_HISTORY[0];
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
  it('is a valid history: v1 only, unique case ids, plain JSON settings, the planned cases and no morph case', () => {
    expect(() => validateTestHistory(PLANET_SCENE_TEST_HISTORY)).not.toThrow();
    expect(PLANET_SCENE_TEST_HISTORY.map((suite) => [suite.id, suite.version])).toEqual([['planet-scene', 1]]);
    const ids = SUITE.scenarios.map((scenario) => scenario.id);
    expect(ids).toEqual(['orbit', 'mid-20km', 'ground', 'descent', 'yaw-360', 'orbit-atmosphere-off', 'ground-atmosphere-off']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of SUITE.scenarios) {
      expect(JSON.parse(JSON.stringify(scenario.settings))).toEqual(scenario.settings);
      expect(scenario.settings.morph).withContext(scenario.id).toBe(0);
      expect(scenario.settings.terrain).withContext(scenario.id).toBeTrue();
    }
    expect(SUITE.purpose).toBe('performance');
  });

  it('makes each atmosphere-off case differ from its partner only in the atmosphere', () => {
    for (const [partner, base] of [['orbit-atmosphere-off', 'orbit'], ['ground-atmosphere-off', 'ground']] as const) {
      expect(scenarioOf(partner).settings).toEqual({ ...scenarioOf(base).settings, atmosphere: false });
      expect(scenarioOf(partner).warmupMs).toBe(scenarioOf(base).warmupMs);
      expect(scenarioOf(partner).durationMs).toBe(scenarioOf(base).durationMs);
    }
  });

  it('runs the scripted cases on a motion and the still cases on none', () => {
    expect(scenarioOf('descent').settings.motion).toBe('descent');
    expect(scenarioOf('yaw-360').settings.motion).toBe('yaw360');
    for (const id of ['orbit', 'mid-20km', 'ground', 'orbit-atmosphere-off', 'ground-atmosphere-off']) expect(scenarioOf(id).settings.motion).toBeUndefined();
    expect(scenarioOf('descent').quickMs).toBeLessThan(scenarioOf('descent').durationMs);
  });

  it('names every setting the page did not honour', () => {
    expect(settingsMismatches(DEFAULT_PLANET_SCENE_SETTINGS, DEFAULT_PLANET_SCENE_SETTINGS)).toEqual([]);
    expect(settingsMismatches({ ...DEFAULT_PLANET_SCENE_SETTINGS, atmosphere: false }, DEFAULT_PLANET_SCENE_SETTINGS)).toEqual(['atmosphere: expected true, found false']);
    expect(settingsMismatches(DEFAULT_PLANET_SCENE_SETTINGS, { ...DEFAULT_PLANET_SCENE_SETTINGS, motion: 'descent' }).length).toBe(1);
  });

  it('builds and parses launch links for the suite and for one case', () => {
    const url = buildTestLaunchUrl(BASE, SUITE, 'visible-browser', 1, 'quick');
    expect(url).toBe(`${BASE}?testSuite=planet-scene&testVersion=1&testProfile=visible-browser&testMode=quick&testRepetitions=1&testAutoStart=1`);
    expect(parseTestLaunch(new URL(url), PLANET_SCENE_TEST_HISTORY)?.key).toBe('planet-scene@1');
    const batch = buildTestBatchLaunchUrl(BASE, [{ suiteId: 'planet-scene', suiteVersion: 1, scenarioId: 'orbit' }], 'visible-browser', 1, 'quick');
    expect(batch).toContain('testCases=orbit');
    expect(parseTestLaunch(new URL(batch), PLANET_SCENE_TEST_HISTORY)?.cases).toEqual([{ suiteId: 'planet-scene', suiteVersion: 1, scenarioId: 'orbit' }]);
    for (const scenario of SUITE.scenarios) {
      const link = buildTestBatchLaunchUrl(BASE, [{ suiteId: 'planet-scene', suiteVersion: 1, scenarioId: scenario.id }], 'visible-browser', 1, 'quick');
      expect(parseTestLaunch(new URL(link), PLANET_SCENE_TEST_HISTORY)?.cases?.length).withContext(scenario.id).toBe(1);
    }
  });
});

describe('Plan 059 G5 planet-scene cameras', () => {
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
    it('reports the metrics, the clouds placeholder and the GPU adapter for a still case', async () => {
      const made = makeHost();
      const observation = await createPlanetSceneTestAdapter(made.host).measure(orbit, made.context);
      const names = observation.metrics?.map((metric) => metric.name);
      expect(names).toEqual(jasmine.arrayContaining([
        'selectionCpu', 'leaves', 'drawnLeaves', 'surfaceTriangles', 'rendererTriangles', 'drawCalls', 'frameInterval',
        'gpuScenePass', 'gpuOutputPass', 'gpuFullscreenPasses', 'gpuPassTotal',
      ]));
      expect(observation.metrics?.find((metric) => metric.name === 'drawCalls')?.samples).toEqual([2]);
      expect(observation.details?.['clouds']).toBe('placeholder');
      expect(observation.details?.['gpuAdapter']).toBe('test adapter');
      expect(observation.checks?.every((check) => check.passed)).toBeTrue();
      expect(observation.limitations?.some((line) => /placeholder/.test(line))).toBeTrue();
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
