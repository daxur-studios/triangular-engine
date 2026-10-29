import {
  CAT_EMOTIONS_SUITE_V1,
  CAT_LINEUP_SUITE_V1,
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

  it('captures, applies, measures and restores settings via the test adapter', async () => {
    let currentSettings: CharactersLabTestSettings = { ...DEFAULT_CAT_TEST_SETTINGS };
    let renderListener: ((t: number) => void) | undefined;
    let frames = 0;
    let spokenText = '';

    const mockHost: CharactersLabTestHost = {
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
    expect(initial.presetId).toBe('space-cat-goofy');

    const testScenario = CAT_EMOTIONS_SUITE_V1.scenarios[1]; // cat-angry
    await adapter.apply(testScenario, mockContext);
    expect(currentSettings.emotion).toBe('angry');

    const observation: TestObservation = await adapter.measure(testScenario, mockContext);
    expect(observation.checks?.every((c) => c.passed)).toBeTrue();
    expect(observation.metrics.some((m) => m.name === 'frameInterval')).toBeTrue();

    await adapter.restore(initial, mockContext);
    expect(currentSettings.emotion).toBe('happy');
  });

  it('detects setting mismatches correctly', () => {
    const s1: CharactersLabTestSettings = { ...DEFAULT_CAT_TEST_SETTINGS, emotion: 'happy' };
    const s2: CharactersLabTestSettings = { ...DEFAULT_CAT_TEST_SETTINGS, emotion: 'angry' };
    const diffs = settingsMismatches(s1, s2);
    expect(diffs.length).toBe(1);
    expect(diffs[0]).toContain('emotion');
  });
});
