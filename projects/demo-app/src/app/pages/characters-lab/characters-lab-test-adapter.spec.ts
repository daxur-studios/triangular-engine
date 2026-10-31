import {
  CAT_EMOTIONS_SUITE_V1,
  CAT_LINEUP_SUITE_V1,
  CAPSULE_VISUAL_VERIFICATION_SUITE_V1,
  CHARACTERS_LAB_TEST_HISTORY,
  DEFAULT_CAT_TEST_SETTINGS,
  type CharactersLabTestSettings,
} from './characters-lab-tests';
import {
  createCharactersLabTestAdapter,
  settingsMismatches,
  type CharactersLabTestHost,
} from './characters-lab-test-adapter';
import type { TestContext, TestObservation } from 'triangular-engine/testing';

describe('CharactersLabTestAdapter & Suites', () => {
  it('defines valid non-empty test history suites', () => {
    expect(CHARACTERS_LAB_TEST_HISTORY.length).toBeGreaterThan(0);

    const suiteIds = new Set<string>();
    for (const suite of CHARACTERS_LAB_TEST_HISTORY) {
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

  it('captures, applies, measures and restores settings via the test adapter', async () => {
    let currentSettings: CharactersLabTestSettings = { ...DEFAULT_CAT_TEST_SETTINGS };
    let renderListener: ((t: number) => void) | undefined;
    let frames = 0;
    let spokenText = '';
    const cameraPath: Array<readonly [number, number]> = [];

    const mockHost: CharactersLabTestHost = {
      snapshot: () => ({
        settings: { ...currentSettings },
        viewMode: 'capsule-cats',
        capsuleLayoutMode: 'hero',
        capsuleCatLayoutMode: 'hero',
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

    const adapter = createCharactersLabTestAdapter(mockHost);
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

  it('drives both camera axes through the visual orbit path and reports the completed coverage', async () => {
    let renderListener: ((t: number) => void) | undefined;
    const path: Array<readonly [number, number]> = [];
    const currentSettings = { ...DEFAULT_CAT_TEST_SETTINGS };
    const mockHost: CharactersLabTestHost = {
      snapshot: () => ({
        settings: currentSettings,
        viewMode: 'capsule-cats',
        capsuleLayoutMode: 'hero',
        capsuleCatLayoutMode: 'hero',
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
    const adapter = createCharactersLabTestAdapter(mockHost);
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
    const s1: CharactersLabTestSettings = { ...DEFAULT_CAT_TEST_SETTINGS, emotion: 'happy' };
    const s2: CharactersLabTestSettings = { ...DEFAULT_CAT_TEST_SETTINGS, emotion: 'angry' };
    const diffs = settingsMismatches(s1, s2);
    expect(diffs.length).toBe(1);
    expect(diffs[0]).toContain('emotion');
  });
});
