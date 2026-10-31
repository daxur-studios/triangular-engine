import {
  CAT_EMOTIONS_SUITE_V1,
  CAT_LINEUP_SUITE_V1,
  CAPSULE_FACIAL_EMOTIONS_SUITE_V1,
  CAPSULE_VISUAL_VERIFICATION_SUITE_V1,
  CHARACTER_STUDIO_HUMAN_PERFORMANCE_SUITE_V1,
  CHARACTER_STUDIO_TEST_HISTORY,
  DEFAULT_CAT_TEST_SETTINGS,
  type CharacterStudioTestSettings,
} from './character-studio-tests';
import {
  createCharacterStudioTestAdapter,
  settingsMismatches,
  type CharacterStudioTestHost,
} from './character-studio-test-adapter';
import type { TestContext, TestObservation } from 'triangular-engine/testing';

describe('CharacterStudioTestAdapter & Suites', () => {
  it('defines valid non-empty test history suites', () => {
    expect(CHARACTER_STUDIO_TEST_HISTORY.length).toBeGreaterThan(0);

    const suiteIds = new Set<string>();
    for (const suite of CHARACTER_STUDIO_TEST_HISTORY) {
      expect(suite.id).toBeTruthy();
      expect(suiteIds.has(suite.id)).toBeFalse();
      suiteIds.add(suite.id);

      expect(suite.version).toBeGreaterThan(0);
      expect(suite.scenarios.length).toBeGreaterThan(0);

      const scenarioIds = new Set<string>();
      for (const sc of suite.scenarios) {
        expect(sc.id).toBeTruthy();
        expect(scenarioIds.has(sc.id)).toBeFalse();
        scenarioIds.add(sc.id);
        expect(sc.durationMs).toBeGreaterThan(0);
        expect(sc.settings).toBeDefined();
      }
    }
  });

  it('covers all eight cat emotions in the cat-emotions suite', () => {
    const requiredEmotions = [
      'happy',
      'angry',
      'fearful',
      'sad',
      'surprised',
      'skeptical',
      'disgusted',
      'neutral',
    ] as const;

    const covered = new Set(CAT_EMOTIONS_SUITE_V1.scenarios.map((sc) => sc.settings.emotion));
    for (const em of requiredEmotions) {
      expect(covered.has(em)).withContext(`Missing emotion scenario for ${em}`).toBeTrue();
    }
  });

  it('covers all 7 concept sheet cats in the cat-lineup suite', () => {
    const requiredPresets = [
      'space-cat-goofy',
      'space-kity-jetpack',
      'variant-d-caramel',
      'cosmo-kitten-a',
      'cosmo-kitten-b',
      'orbit-puffer-cat',
      'scrufly-cat',
    ];

    const covered = new Set(CAT_LINEUP_SUITE_V1.scenarios.map((sc) => sc.settings.presetId));
    for (const preset of requiredPresets) {
      expect(covered.has(preset)).withContext(`Missing preset scenario for ${preset}`).toBeTrue();
    }
  });

  it('defines visual evidence cases for both capsule characters with moving gaits and camera orbits', () => {
    expect(CAPSULE_VISUAL_VERIFICATION_SUITE_V1.requiresVisualReview).toBeTrue();
    expect(CAPSULE_VISUAL_VERIFICATION_SUITE_V1.scenarios.map((scenario) => scenario.settings.characterType)).toEqual([
      'human',
      'cat',
    ]);
    for (const scenario of CAPSULE_VISUAL_VERIFICATION_SUITE_V1.scenarios) {
      expect(scenario.settings.motion).toBe('camera-orbit');
      expect(scenario.settings.layout).toBe('hero');
      expect(scenario.settings.gait).not.toBe('idle');
      expect(scenario.durationMs).toBeGreaterThanOrEqual(8_000);
    }
  });

  it('defines high-detail facial cases for both capsule families with still, close-up framing', () => {
    expect(CAPSULE_FACIAL_EMOTIONS_SUITE_V1.requiresVisualReview).toBeTrue();
    expect(CAPSULE_FACIAL_EMOTIONS_SUITE_V1.scenarios.length).toBe(8);
    expect(new Set(CAPSULE_FACIAL_EMOTIONS_SUITE_V1.scenarios.map((scenario) => scenario.settings.characterType))).toEqual(
      new Set(['human', 'cat']),
    );
    for (const scenario of CAPSULE_FACIAL_EMOTIONS_SUITE_V1.scenarios) {
      expect(scenario.settings.cameraFraming).toBe('face-close-up');
      expect(scenario.settings.gait).toBe('idle');
      expect(scenario.settings.motion).toBe('still');
    }
  });

  it('defines a measured human scaling matrix for idle, animation and scene movement', () => {
    expect(CHARACTER_STUDIO_HUMAN_PERFORMANCE_SUITE_V1.purpose).toBe('performance');
    expect(CHARACTER_STUDIO_HUMAN_PERFORMANCE_SUITE_V1.scenarios.map(({ settings }) => [
      settings.performancePopulation,
      settings.performanceMotion,
    ])).toEqual([
      [1, 'idle'], [1, 'walk'],
      [16, 'idle'], [48, 'idle'],
      [16, 'walk'], [48, 'walk'],
      [16, 'walk-path'], [48, 'walk-path'],
    ]);
    for (const scenario of CHARACTER_STUDIO_HUMAN_PERFORMANCE_SUITE_V1.scenarios) {
      expect(scenario.settings.characterType).toBe('human');
      expect(scenario.settings.layout).toBe('lineup');
      expect(scenario.budgets?.['frameInterval']?.p95).toBe(16.7);
    }
  });

  it('captures, applies, measures and restores settings via the test adapter', async () => {
    let currentSettings: CharacterStudioTestSettings = { ...DEFAULT_CAT_TEST_SETTINGS };
    let renderListener: ((t: number) => void) | undefined;
    let frames = 0;
    let spokenText = '';
    const cameraPath: Array<readonly [number, number]> = [];

    const mockHost: CharacterStudioTestHost = {
      snapshot: () => ({
        settings: { ...currentSettings },
        cameraPosition: [0, 0, 2],
        cameraTarget: [0, 0.4, 0],
        humanActorYaw: 0,
        catActorYaw: 0,
      }),
      restore: (snapshot) => {
        currentSettings = { ...snapshot.settings };
      },
      read: () => ({ ...currentSettings }),
      apply: (s) => {
        currentSettings = { ...s };
      },
      renderedFrames: () => frames,
      errors: () => '',
      resetErrors: () => {},
      beginPerformanceWindow: () => {},
      endPerformanceWindow: () => ({ actorUpdateCpuMs: [], scenarioSetupCpuMs: 0 }),
      onRenderComplete: (cb) => {
        renderListener = cb;
        return () => {
          renderListener = undefined;
        };
      },
      speak: (text) => {
        spokenText = text;
      },
      isSpeaking: () => spokenText.length > 0,
      setTurntableAngle: () => {},
      setCameraOrbit: (azimuth, elevation) => {
        cameraPath.push([azimuth, elevation]);
        frames++;
        renderListener?.(performance.now());
      },
      recording: () => ({ stop: async () => { throw new Error('recording is not used by this test'); }, dispose: () => {} }),
      environment: () => ({}),
    };

    const adapter = createCharacterStudioTestAdapter(mockHost);
    const mockContext: TestContext = {
      mode: 'quick',
      profile: 'headless-hardware',
      repetition: 1,
      signal: new AbortController().signal,
      wait: async () => {},
      measureWindow: async (_sc, _series) => {
        for (let i = 0; i < 5; i++) {
          frames++;
          renderListener?.(performance.now() + i * 16.6);
        }
        return {
          mode: 'quick',
          elapsedMs: 83,
          stoppedBy: 'settled',
        };
      },
    };

    const initial = await adapter.capture(mockContext);
    expect(initial.settings.presetId).toBe('space-cat-goofy');

    const testScenario = CAT_EMOTIONS_SUITE_V1.scenarios[1]; // cat-angry
    await adapter.apply(testScenario, mockContext);
    expect(currentSettings.emotion).toBe('angry');

    const observation: TestObservation = await adapter.measure(testScenario, mockContext);
    expect(observation.checks?.every((c) => c.passed)).toBeTrue();
    expect(observation.metrics.some((m) => m.name === 'frameInterval')).toBeTrue();

    await adapter.restore(initial, mockContext);
    expect(currentSettings.emotion).toBe('happy');
  });

  it('returns frame cadence, update CPU and renderer counters for performance scenarios', async () => {
    const scenario = CHARACTER_STUDIO_HUMAN_PERFORMANCE_SUITE_V1.scenarios[4];
    let renderListener: ((t: number, stats?: { renderSubmitCpuMs?: number; drawCalls?: number; triangles?: number }) => void) | undefined;
    let windowActive = false;
    const currentSettings = scenario.settings;
    const host: CharacterStudioTestHost = {
      snapshot: () => ({
        settings: currentSettings,
        cameraPosition: [0, 2, 4],
        cameraTarget: [0, 1, 0],
        humanActorYaw: 0,
        catActorYaw: 0,
      }),
      restore: () => {},
      read: () => currentSettings,
      apply: () => {},
      renderedFrames: () => 40,
      errors: () => '',
      resetErrors: () => {},
      beginPerformanceWindow: () => { windowActive = true; },
      endPerformanceWindow: () => {
        windowActive = false;
        return { actorUpdateCpuMs: [0.7, 0.8], scenarioSetupCpuMs: 14 };
      },
      onRenderComplete: (callback) => {
        renderListener = callback;
        return () => { renderListener = undefined; };
      },
      speak: () => {},
      isSpeaking: () => false,
      setTurntableAngle: () => {},
      setCameraOrbit: () => {},
      recording: () => ({ stop: async () => { throw new Error('recording is not used by performance tests'); }, dispose: () => {} }),
      environment: () => ({}),
    };
    const adapter = createCharacterStudioTestAdapter(host);
    const context: TestContext = {
      mode: 'standard',
      profile: 'visible-browser',
      repetition: 1,
      signal: new AbortController().signal,
      wait: async () => {},
      measureWindow: async () => {
        expect(windowActive).toBeTrue();
        for (let frame = 0; frame < 40; frame++) {
          renderListener?.(frame * 16.7, { renderSubmitCpuMs: 2.1, drawCalls: 123, triangles: 456 });
        }
        return { mode: 'standard', elapsedMs: 8_000, stoppedBy: 'fixed' };
      },
    };

    const observation = await adapter.measure(scenario, context);
    expect(windowActive).toBeFalse();
    expect(observation.checks?.find((check) => check.name === 'Enough rendered frames for a useful performance sample')?.passed).toBeTrue();
    expect(observation.metrics.find((metric) => metric.name === 'renderSubmitCpuMs')?.samples).toEqual([2.1, ...Array(39).fill(2.1)]);
    expect(observation.metrics.find((metric) => metric.name === 'actorUpdateCpuMs')?.samples).toEqual([0.7, 0.8]);
    expect(observation.metrics.find((metric) => metric.name === 'drawCalls')?.samples).toHaveSize(40);
    expect(observation.metrics.find((metric) => metric.name === 'triangles')?.samples).toHaveSize(40);
    expect(observation.metrics.find((metric) => metric.name === 'scenarioSetupCpuMs')?.samples).toEqual([14]);
  });

  it('drives both camera axes through the visual orbit path and reports the completed coverage', async () => {
    let renderListener: ((t: number) => void) | undefined;
    const path: Array<readonly [number, number]> = [];
    const currentSettings = { ...DEFAULT_CAT_TEST_SETTINGS };
    const mockHost: CharacterStudioTestHost = {
      snapshot: () => ({
        settings: currentSettings,
        cameraPosition: [0, 0, 2],
        cameraTarget: [0, 0.4, 0],
        humanActorYaw: 0,
        catActorYaw: 0,
      }),
      restore: () => {},
      read: () => currentSettings,
      apply: () => {},
      renderedFrames: () => path.length,
      errors: () => '',
      resetErrors: () => {},
      beginPerformanceWindow: () => {},
      endPerformanceWindow: () => ({ actorUpdateCpuMs: [], scenarioSetupCpuMs: 0 }),
      onRenderComplete: (callback) => {
        renderListener = callback;
        return () => { renderListener = undefined; };
      },
      speak: () => {},
      isSpeaking: () => false,
      setTurntableAngle: () => {},
      setCameraOrbit: (azimuth, elevation) => {
        path.push([azimuth, elevation]);
        renderListener?.(performance.now());
      },
      recording: () => ({ stop: async () => { throw new Error('recording is not used by this test'); }, dispose: () => {} }),
      environment: () => ({}),
    };
    const adapter = createCharacterStudioTestAdapter(mockHost);
    const scenario = {
      ...CAPSULE_VISUAL_VERIFICATION_SUITE_V1.scenarios[1],
      durationMs: 200,
      quickMs: 200,
    };
    const context: TestContext = {
      mode: 'quick',
      profile: 'headless-hardware',
      repetition: 1,
      signal: new AbortController().signal,
      wait: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      measureWindow: async () => ({ mode: 'quick', elapsedMs: 0, stoppedBy: 'fixed' }),
    };

    const observation = await adapter.measure(scenario, context);

    expect(path.length).toBeGreaterThan(2);
    expect(Math.max(...path.map(([azimuth]) => azimuth))).toBeGreaterThan(5.5);
    expect(Math.min(...path.map(([, elevation]) => elevation))).toBeLessThan(-0.1);
    expect(Math.max(...path.map(([, elevation]) => elevation))).toBeGreaterThan(0.85);
    expect(observation.checks?.find((check) => check.name === 'Horizontal and vertical camera path completed')?.passed).toBeTrue();
  });

  it('detects setting mismatches correctly', () => {
    const s1: CharacterStudioTestSettings = { ...DEFAULT_CAT_TEST_SETTINGS, emotion: 'happy' };
    const s2: CharacterStudioTestSettings = { ...DEFAULT_CAT_TEST_SETTINGS, emotion: 'angry' };
    const diffs = settingsMismatches(s1, s2);
    expect(diffs.length).toBe(1);
    expect(diffs[0]).toContain('emotion');
  });

  it('forwards one close-up still per first-repetition case and omits later repetitions', async () => {
    const still = new Blob(['saved still'], { type: 'image/webp' });
    const capturedSettings: CharacterStudioTestSettings[] = [];
    const host = {
      snapshot: () => ({
        settings: { ...DEFAULT_CAT_TEST_SETTINGS },
        cameraPosition: [0, 0, 2] as const,
        cameraTarget: [0, 0.4, 0] as const,
        humanActorYaw: 0,
        catActorYaw: 0,
      }),
      restore: () => {},
      read: () => ({ ...DEFAULT_CAT_TEST_SETTINGS }),
      apply: () => {},
      renderedFrames: () => 0,
      errors: () => '',
      resetErrors: () => {},
      beginPerformanceWindow: () => {},
      endPerformanceWindow: () => ({ actorUpdateCpuMs: [], scenarioSetupCpuMs: 0 }),
      onRenderComplete: () => () => {},
      speak: () => {},
      isSpeaking: () => false,
      setTurntableAngle: () => {},
      setCameraOrbit: () => {},
      recording: () => ({ stop: async () => { throw new Error('recording is not used by this test'); }, dispose: () => {} }),
      environment: () => ({}),
      thumbnail: async (settings: CharacterStudioTestSettings) => {
        capturedSettings.push(settings);
        return still;
      },
    } satisfies CharacterStudioTestHost;
    const adapter = createCharacterStudioTestAdapter(host);
    const scenario = CAPSULE_FACIAL_EMOTIONS_SUITE_V1.scenarios[0];
    const nonDetailScenario = CAT_EMOTIONS_SUITE_V1.scenarios[0];
    const context = (repetition: number): TestContext => ({
      mode: 'quick',
      profile: 'headless-hardware',
      repetition,
      signal: new AbortController().signal,
      wait: async () => {},
      measureWindow: async () => ({ mode: 'quick', elapsedMs: 0, stoppedBy: 'fixed' }),
    });

    const other = await adapter.thumbnail?.(nonDetailScenario, context(1));
    const first = await adapter.thumbnail?.(scenario, context(1));
    const later = await adapter.thumbnail?.(scenario, context(2));

    expect(other).toBeUndefined();
    expect(first).toEqual([still]);
    expect(later).toBeUndefined();
    expect(capturedSettings).toEqual([scenario.settings]);
  });

  it('records resolved focus-target framing check and details in observation', async () => {
    const scenario = CAPSULE_FACIAL_EMOTIONS_SUITE_V1.scenarios[0];
    let currentSettings = { ...scenario.settings };
    const host: CharacterStudioTestHost = {
      snapshot: () => ({
        settings: { ...currentSettings },
        cameraPosition: [0, 1.5, 0.9],
        cameraTarget: [0, 1.5, 0.2],
        humanActorYaw: 0,
        catActorYaw: -0.28,
      }),
      restore: () => {},
      read: () => ({ ...currentSettings }),
      apply: (s) => {
        currentSettings = { ...s };
      },
      renderedFrames: () => 5,
      errors: () => '',
      resetErrors: () => {},
      beginPerformanceWindow: () => {},
      endPerformanceWindow: () => ({ actorUpdateCpuMs: [], scenarioSetupCpuMs: 0 }),
      onRenderComplete: (cb) => {
        cb(16);
        return () => {};
      },
      speak: () => {},
      isSpeaking: () => false,
      setTurntableAngle: () => {},
      setCameraOrbit: () => {},
      recording: () => ({ stop: async () => { throw new Error('unused'); }, dispose: () => {} }),
      environment: () => ({}),
      resolveFocusFraming: () => ({
        targetId: 'human-face',
        label: 'Human Face',
        boundsKind: 'composite',
        cameraPosition: [0, 1.52, 0.98],
        cameraTarget: [0, 1.5, 0.25],
        cameraDistance: 0.73,
        worldMin: [-0.36, 1.32, 0.1],
        worldMax: [0.36, 1.72, 0.45],
        projectedRect: [0.22, 0.14, 0.56, 0.72],
        shaderMouthRect: [0.38, 0.62, 0.24, 0.18],
        inFrame: true,
        occupancy: 0.72,
        limitations: ['Synthetic shader mouth bounds combined with 3D eye/brow meshes.'],
      }),
    };

    const adapter = createCharacterStudioTestAdapter(host);
    const context: TestContext = {
      mode: 'quick',
      profile: 'headless-hardware',
      repetition: 1,
      signal: new AbortController().signal,
      wait: async () => {},
      measureWindow: async () => ({ mode: 'quick', elapsedMs: 50, stoppedBy: 'settled' }),
    };

    const obs = await adapter.measure(scenario, context);
    const focusCheck = obs.checks?.find((c) => c.name === 'Focus target framed within viewport');
    expect(focusCheck?.passed).toBeTrue();
    expect(obs.details?.['focusTarget']).toBe('human-face');
    expect(obs.details?.['focusBoundsKind']).toBe('composite');
    expect(obs.details?.['focusInFrame']).toBe(true);
    expect(obs.details?.['focusProjectedRect']).toBe('0.22,0.14,0.56,0.72');
    expect(obs.details?.['focusShaderMouthRect']).toBe('0.38,0.62,0.24,0.18');
  });
});
