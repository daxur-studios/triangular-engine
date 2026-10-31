import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import type {
  CapsuleCatGaitMode,
  CapsuleCatMouthPose,
  CapsuleHandActionMode,
  CapsuleLocomotionMode,
  ExtendedEmotionName,
} from 'triangular-engine/characters';
import type { VisualFocusTargetId } from './character-studio-focus';

export type CameraFramingPreset = 'front' | 'face-close-up' | 'head-close-up' | 'three-quarter' | 'profile' | 'full-shot';
export type CapsuleLayoutMode = 'hero' | 'lineup';
export type CharacterStudioPerformanceMotion = 'idle' | 'walk' | 'walk-path';

/**
 * Settings configuration for a capsule character verification scenario.
 * Encapsulates character selection, facial emotion, locomotion gait, camera framing, and speech.
 */
export interface CharacterStudioTestSettings {
  readonly characterType: 'cat' | 'human';
  readonly presetId: string;
  readonly emotion: ExtendedEmotionName;
  readonly gait: CapsuleCatGaitMode | CapsuleLocomotionMode;
  readonly cameraFraming: CameraFramingPreset;
  readonly focusTarget?: VisualFocusTargetId;
  readonly layout: CapsuleLayoutMode;
  readonly speak?: boolean;
  readonly speechText?: string;
  readonly panicked?: boolean;
  readonly tuft?: boolean;
  readonly restMouthPose?: CapsuleCatMouthPose;
  readonly rightHandAction?: CapsuleHandActionMode;
  readonly leftHandAction?: CapsuleHandActionMode;
  readonly motion?: 'turntable' | 'camera-orbit' | 'still';
  /** Number of capsule humans to create for an opt-in Character Studio performance case. */
  readonly performancePopulation?: number;
  /** Idle pose, walk cycle in place, or walk cycle while moving through a deterministic grid path. */
  readonly performanceMotion?: CharacterStudioPerformanceMotion;
}

export const DEFAULT_CAT_TEST_SETTINGS: CharacterStudioTestSettings = {
  characterType: 'cat',
  presetId: 'space-cat-goofy',
  emotion: 'happy',
  gait: 'goofy_walk',
  cameraFraming: 'front',
  layout: 'hero',
  panicked: false,
  tuft: false,
  restMouthPose: 'cat_smile',
  motion: 'still',
};

export const DEFAULT_HUMAN_TEST_SETTINGS: CharacterStudioTestSettings = {
  characterType: 'human',
  presetId: 'wacky-helmet-waver',
  emotion: 'happy',
  gait: 'idle',
  cameraFraming: 'front',
  layout: 'hero',
  rightHandAction: 'wave',
  leftHandAction: 'none',
  motion: 'still',
};

function scenario(
  id: string,
  label: string,
  change: Partial<CharacterStudioTestSettings>,
  base: CharacterStudioTestSettings = DEFAULT_CAT_TEST_SETTINGS,
  durationMs = 3500,
  quickMs = 1500,
): TestScenario<CharacterStudioTestSettings> {
  return {
    id,
    label,
    settings: { ...base, ...change },
    warmupMs: 400,
    durationMs,
    quickMs,
  };
}

/**
 * Suite 1: Cat Emotional Expressions (8 Semantic Emotions)
 * Exercises airplane ears, feline vampire fangs, pupil scaling, drooping sadness,
 * and asymmetric skepticism quirks.
 */
export const CAT_EMOTIONS_SUITE_V1: TestSuite<CharacterStudioTestSettings> = {
  id: 'cat-emotions',
  version: 1,
  title: 'Capsule Cat Emotional Expressions (8 Emotions)',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    scenario('cat-happy', 'Space Cat: Happy (:3 Smile, Upright Tail)', {
      emotion: 'happy',
      gait: 'idle',
      cameraFraming: 'front',
    }),
    scenario('cat-angry', 'Space Cat: Angry (Airplane Ears, Vampire Fangs, Tail Lash)', {
      emotion: 'angry',
      gait: 'idle',
      cameraFraming: 'front',
    }),
    scenario('cat-fearful', 'Space Cat: Fearful (Pinned Ears, Panic Eyes, Puffed Tucked Tail)', {
      emotion: 'fearful',
      panicked: true,
      gait: 'idle',
      cameraFraming: 'front',
    }),
    scenario('cat-sad', 'Space Cat: Sad (Drooping Limp Ears, Downturned Frown, Drooping Tail)', {
      emotion: 'sad',
      gait: 'idle',
      cameraFraming: 'front',
    }),
    scenario('cat-surprised', 'Space Cat: Surprised (Tall Prick Ears, Wide Eyes, Tall Fluffed Tail)', {
      emotion: 'surprised',
      gait: 'idle',
      cameraFraming: 'front',
    }),
    scenario('cat-skeptical', 'Space Cat: Skeptical (Asymmetric One-Ear Twitch, One Squint, Corner Smirk)', {
      emotion: 'skeptical',
      gait: 'idle',
      cameraFraming: 'front',
    }),
    scenario('cat-disgusted', 'Space Cat: Disgusted (Downturned Mouth, Scrunched Glare)', {
      emotion: 'disgusted',
      gait: 'idle',
      cameraFraming: 'front',
    }),
    scenario('cat-neutral', 'Space Cat: Neutral Alert (Calm Eyes, Relaxed Upright Ears, Gentle Breathing)', {
      emotion: 'neutral',
      gait: 'idle',
      cameraFraming: 'front',
    }),
  ],
};

/**
 * Suite 2: Cat Concept Sheet Presets & Locomotion Gaits
 * Validates all 7 concept sheet cats with their spacesuits, dorsal packs, and gaits.
 */
export const CAT_LINEUP_SUITE_V1: TestSuite<CharacterStudioTestSettings> = {
  id: 'cat-lineup',
  version: 1,
  title: 'Capsule Cat Concept Sheet Presets & Gaits',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    scenario('space-cat-goofy', 'Space Cat (Goofy Walk) - Front Suit, Helmet, 4-Beat Trot', {
      presetId: 'space-cat-goofy',
      gait: 'goofy_walk',
      emotion: 'happy',
      cameraFraming: 'three-quarter',
    }),
    scenario('space-kity-jetpack', 'Space Kity - Full White Suit, Booties, Dorsal Orange Jetpack, Bound Run', {
      presetId: 'space-kity-jetpack',
      gait: 'bound_run',
      emotion: 'happy',
      cameraFraming: 'three-quarter',
    }),
    scenario('variant-d-caramel', 'Variant D - Caramel Fur, Front Suit, Helmet, Orange Jetpack', {
      presetId: 'variant-d-caramel',
      gait: 'bound_run',
      emotion: 'happy',
      cameraFraming: 'three-quarter',
    }),
    scenario('cosmo-kitten-a', 'Cosmo Kitten A - Peach Fur, Compact Kitten, Brown Mini Saddle Pack', {
      presetId: 'cosmo-kitten-a',
      gait: 'goofy_walk',
      emotion: 'happy',
      cameraFraming: 'three-quarter',
    }),
    scenario('cosmo-kitten-b', 'Cosmo Kitten B - Cream Fur, Full Suit, Slate Blue Mini Pack', {
      presetId: 'cosmo-kitten-b',
      gait: 'goofy_walk',
      emotion: 'happy',
      cameraFraming: 'three-quarter',
    }),
    scenario('orbit-puffer-cat', 'Orbit Puffer Cat - Wide Panicked Eyes, Front Suit, Jetpack', {
      presetId: 'orbit-puffer-cat',
      panicked: true,
      emotion: 'fearful',
      gait: 'goofy_walk',
      cameraFraming: 'front',
    }),
    scenario('scrufly-cat', 'Scrufly Cat - Scruffy Crown Tuft, Two-Tone Bare Fur, Wide MEOW Mouth', {
      presetId: 'scrufly-cat',
      tuft: true,
      restMouthPose: 'meow',
      emotion: 'neutral',
      gait: 'idle',
      cameraFraming: 'front',
    }),
    scenario('cat-zero-g-float', 'Space Cat - Zero-G Hovering with Paddling Paws & Drifting Tail', {
      presetId: 'space-cat-goofy',
      gait: 'float',
      emotion: 'happy',
      cameraFraming: 'profile',
    }),
  ],
};

/**
 * Suite 3: Capsule Cat Speech Articulation
 * Tests cat jaw movement, viseme blendshapes, and audio synthesis.
 */
export const CAT_SPEECH_SUITE_V1: TestSuite<CharacterStudioTestSettings> = {
  id: 'cat-speech',
  version: 1,
  title: 'Capsule Cat Speech & Articulation',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    scenario(
      'cat-speak-happy',
      'Space Cat: Happy Speech ("Meow meow, space mission ready!")',
      {
        emotion: 'happy',
        speak: true,
        speechText: 'Meow meow, space mission ready!',
        cameraFraming: 'front',
      },
      DEFAULT_CAT_TEST_SETTINGS,
      4500,
      2500,
    ),
    scenario(
      'cat-speak-meow',
      'Scrufly Cat: Deep Meow Articulation',
      {
        presetId: 'scrufly-cat',
        tuft: true,
        restMouthPose: 'meow',
        emotion: 'surprised',
        speak: true,
        speechText: 'Meow, approaching planetary orbit!',
        cameraFraming: 'front',
      },
      DEFAULT_CAT_TEST_SETTINGS,
      4500,
      2500,
    ),
  ],
};

/**
 * Suite 4: Humanoid Reference Baselines
 * Side-by-side comparison with the humanoid Capsule Doodle characters.
 */
export const HUMANOID_BASELINES_SUITE_V1: TestSuite<CharacterStudioTestSettings> = {
  id: 'human-baselines',
  version: 1,
  title: 'Humanoid Capsule Doodle Baselines',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    scenario(
      'human-happy',
      'Humanoid Hero: Happy (:D Mouth, High Cheeks, Waving Hand)',
      { emotion: 'happy', gait: 'idle', rightHandAction: 'wave', cameraFraming: 'front' },
      DEFAULT_HUMAN_TEST_SETTINGS,
    ),
    scenario(
      'human-angry',
      'Humanoid Hero: Angry (Angled Floating Brows, Glaring Squint)',
      { emotion: 'angry', gait: 'idle', rightHandAction: 'none', cameraFraming: 'front' },
      DEFAULT_HUMAN_TEST_SETTINGS,
    ),
    scenario(
      'human-skeptical',
      'Humanoid Hero: Skeptical (Arching Brow, Quizzical Smirk)',
      { emotion: 'skeptical', gait: 'idle', cameraFraming: 'front' },
      DEFAULT_HUMAN_TEST_SETTINGS,
    ),
    scenario(
      'human-walk',
      'Humanoid Hero: Walk Locomotion Stride',
      { emotion: 'happy', gait: 'walk', cameraFraming: 'three-quarter' },
      DEFAULT_HUMAN_TEST_SETTINGS,
    ),
  ],
};

/**
 * Suite 5: visual evidence for both procedural capsule character families.
 * Each case pairs a moving gait with a camera path that covers a horizontal orbit and a vertical sweep.
 */
export const CAPSULE_VISUAL_VERIFICATION_SUITE_V1: TestSuite<CharacterStudioTestSettings> = {
  id: 'capsule-visual-verification',
  version: 1,
  title: 'Capsule Human and Cat Visual Verification',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    scenario(
      'human-walk-orbit',
      'Capsule Human: Walk Cycle with Horizontal and Vertical Camera Sweep',
      {
        characterType: 'human',
        presetId: 'wacky-helmet-waver',
        emotion: 'happy',
        gait: 'walk',
        cameraFraming: 'full-shot',
        layout: 'hero',
        motion: 'camera-orbit',
      },
      DEFAULT_HUMAN_TEST_SETTINGS,
      8_000,
      8_000,
    ),
    scenario(
      'cat-goofy-walk-orbit',
      'Capsule Cat: Goofy Walk with Horizontal and Vertical Camera Sweep',
      {
        characterType: 'cat',
        presetId: 'space-cat-goofy',
        emotion: 'happy',
        gait: 'goofy_walk',
        cameraFraming: 'full-shot',
        layout: 'hero',
        motion: 'camera-orbit',
      },
      DEFAULT_CAT_TEST_SETTINGS,
      8_000,
      8_000,
    ),
  ],
};

/**
 * High-detail still evidence for facial expressions on both procedural capsule families.
 * The close camera and supersampled case thumbnails make small expression features readable in review sheets.
 */
export const CAPSULE_FACIAL_EMOTIONS_SUITE_V1: TestSuite<CharacterStudioTestSettings> = {
  id: 'capsule-facial-emotions',
  version: 1,
  title: 'Capsule Facial Expression Detail',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    scenario('human-happy-detail', 'Capsule Human: Happy eyes and smile', {
      characterType: 'human', presetId: 'wacky-helmet-waver', emotion: 'happy', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'human-face', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('human-angry-detail', 'Capsule Human: Angry brows and narrowed eyes', {
      characterType: 'human', presetId: 'wacky-helmet-waver', emotion: 'angry', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'human-face', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('human-sad-detail', 'Capsule Human: Sad brows and mouth', {
      characterType: 'human', presetId: 'wacky-helmet-waver', emotion: 'sad', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'human-face', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('human-skeptical-detail', 'Capsule Human: Skeptical brow and smirk', {
      characterType: 'human', presetId: 'wacky-helmet-waver', emotion: 'skeptical', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'human-face', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('cat-happy-detail', 'Capsule Cat: Happy eyes and muzzle', {
      characterType: 'cat', presetId: 'space-cat-goofy', emotion: 'happy', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'cat-face', restMouthPose: 'cat_smile',
    }, DEFAULT_CAT_TEST_SETTINGS),
    scenario('cat-angry-detail', 'Capsule Cat: Angry eyes, ears and fangs', {
      characterType: 'cat', presetId: 'space-cat-goofy', emotion: 'angry', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'cat-face',
    }, DEFAULT_CAT_TEST_SETTINGS),
    scenario('cat-fearful-detail', 'Capsule Cat: Fearful eyes and pinned ears', {
      characterType: 'cat', presetId: 'space-cat-goofy', emotion: 'fearful', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'cat-face', panicked: true,
    }, DEFAULT_CAT_TEST_SETTINGS),
    scenario('cat-skeptical-detail', 'Capsule Cat: Asymmetric skeptical expression', {
      characterType: 'cat', presetId: 'space-cat-goofy', emotion: 'skeptical', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'cat-face',
    }, DEFAULT_CAT_TEST_SETTINGS),
  ],
};

/**
 * Suite 7: Capsule Human A/B Variant Comparison (Baseline vs. Alt Space Variants & Wonky Eyes)
 * Evaluates new hairstyles, wonky eye/gaze asymmetry, button nose, headgear, and scene-owned focus framing.
 */
export const CAPSULE_HUMAN_AB_VARIANTS_SUITE_V1: TestSuite<CharacterStudioTestSettings> = {
  id: 'capsule-human-ab-variants',
  version: 1,
  title: 'Capsule Human A/B Comparison: Baseline vs. Alt Space Variants',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    scenario('baseline-helmet-waver-face', 'Baseline A: Wacky Helmet Waver (Symmetric Eyes, No Nose)', {
      characterType: 'human', presetId: 'wacky-helmet-waver', emotion: 'happy', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'human-face', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('variant-sprout-wonky-face', 'Variant A: Sprout Wonky Doodle (Asymmetric Eyes, Divergent Gaze, Button Nose)', {
      characterType: 'human', presetId: 'sprout-wonky-doodle', emotion: 'happy', gait: 'idle',
      cameraFraming: 'face-close-up', focusTarget: 'human-face', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('baseline-helmet-waver-head', 'Baseline B: Wacky Helmet Waver Head & Hair (Curly Puff + Helmet)', {
      characterType: 'human', presetId: 'wacky-helmet-waver', emotion: 'happy', gait: 'idle',
      cameraFraming: 'head-close-up', focusTarget: 'human-head-hair', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('variant-spiky-wonky-head', 'Variant B: Alt Spiky Wonky Waver (Spiky Hair + Wonky Eyes + Button Nose + Helmet)', {
      characterType: 'human', presetId: 'alt-spiky-wonky-waver', emotion: 'happy', gait: 'idle',
      cameraFraming: 'head-close-up', focusTarget: 'human-head-hair', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('baseline-buck-buns-head', 'Baseline C: Buck-Tooth Buns (Low Pigtail Buns, Symmetric Eyes)', {
      characterType: 'human', presetId: 'buck-tooth-buns', emotion: 'happy', gait: 'idle',
      cameraFraming: 'head-close-up', focusTarget: 'human-head-hair', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('variant-space-buns-pink-head', 'Variant C: Alt Space Buns Pink (High Twin Buns + Fringe + Button Nose)', {
      characterType: 'human', presetId: 'alt-space-buns-pink', emotion: 'happy', gait: 'idle',
      cameraFraming: 'head-close-up', focusTarget: 'human-head-hair', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('variant-bob-cut-head', 'Variant D: Alt Bob Cut (Rounded Bob + Fringe Bangs + Wonky Gaze)', {
      characterType: 'human', presetId: 'alt-bob-cut', emotion: 'happy', gait: 'idle',
      cameraFraming: 'head-close-up', focusTarget: 'human-head-hair', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('variant-goggles-mechanic-head', 'Variant E: Alt Goggles Mechanic (Forehead Goggles + Curly Hair + Wonky Eye)', {
      characterType: 'human', presetId: 'alt-goggles-mechanic', emotion: 'skeptical', gait: 'idle',
      cameraFraming: 'head-close-up', focusTarget: 'human-head-hair', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('variant-afro-groove-head', 'Variant F: Alt Afro Groove (Voluminous Curly Afro + Coral Suit + Button Nose)', {
      characterType: 'human', presetId: 'alt-afro-groove', emotion: 'happy', gait: 'idle',
      cameraFraming: 'head-close-up', focusTarget: 'human-head-hair', rightHandAction: 'none', leftHandAction: 'none',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
    scenario('variant-glasses-coffee-full', 'Variant G: Alt Glasses & Coffee (Round Glasses + Mustache + Held Coffee Mug)', {
      characterType: 'human', presetId: 'alt-glasses-coffee', emotion: 'happy', gait: 'idle',
      cameraFraming: 'front', focusTarget: 'human-full-body', rightHandAction: 'none', leftHandAction: 'hold_gadget',
    }, DEFAULT_HUMAN_TEST_SETTINGS),
  ],
};

const CHARACTER_PERFORMANCE_FRAME_BUDGET_MS = 16.7;

function performanceScenario(
  id: string,
  label: string,
  population: number,
  performanceMotion: CharacterStudioPerformanceMotion,
): TestScenario<CharacterStudioTestSettings> {
  return {
    id,
    label,
    settings: {
      ...DEFAULT_HUMAN_TEST_SETTINGS,
      characterType: 'human',
      presetId: 'wacky-helmet-waver',
      emotion: 'happy',
      gait: performanceMotion === 'idle' ? 'idle' : 'walk',
      cameraFraming: 'full-shot',
      layout: 'lineup',
      motion: 'still',
      rightHandAction: 'none',
      leftHandAction: 'none',
      performancePopulation: population,
      performanceMotion,
    },
    warmupMs: 800,
    durationMs: 8_000,
    quickMs: 3_000,
    budgets: { frameInterval: { p95: CHARACTER_PERFORMANCE_FRAME_BUDGET_MS } },
  };
}

/**
 * Diagnostic scaling matrix for the procedural capsule-human scene on the current device.
 * The 16.7 ms p95 frame-cadence budget is an initial 60 Hz target hypothesis, not a production baseline.
 */
export const CHARACTER_STUDIO_HUMAN_PERFORMANCE_SUITE_V1: TestSuite<CharacterStudioTestSettings> = {
  id: 'character-studio-human-performance',
  version: 1,
  title: 'Capsule Human Rendering and Animation Performance',
  purpose: 'performance',
  scenarios: [
    performanceScenario('human-idle-1', '1 human · idle baseline', 1, 'idle'),
    performanceScenario('human-walk-1', '1 human · walk cycle', 1, 'walk'),
    performanceScenario('human-idle-16', '16 humans · idle grid', 16, 'idle'),
    performanceScenario('human-idle-48', '48 humans · idle grid', 48, 'idle'),
    performanceScenario('human-walk-16', '16 humans · walk cycles', 16, 'walk'),
    performanceScenario('human-walk-48', '48 humans · walk cycles', 48, 'walk'),
    performanceScenario('human-walk-path-16', '16 humans · walk cycles and scene paths', 16, 'walk-path'),
    performanceScenario('human-walk-path-48', '48 humans · walk cycles and scene paths', 48, 'walk-path'),
  ],
};

/**
 * Full test history for Character Studio, oldest first.
 * The final entry is the default latest test suite.
 */
export const CHARACTER_STUDIO_TEST_HISTORY: readonly TestSuite<CharacterStudioTestSettings>[] = [
  CAT_LINEUP_SUITE_V1,
  CAT_SPEECH_SUITE_V1,
  HUMANOID_BASELINES_SUITE_V1,
  CAT_EMOTIONS_SUITE_V1,
  CAPSULE_VISUAL_VERIFICATION_SUITE_V1,
  CAPSULE_FACIAL_EMOTIONS_SUITE_V1,
  CAPSULE_HUMAN_AB_VARIANTS_SUITE_V1,
  CHARACTER_STUDIO_HUMAN_PERFORMANCE_SUITE_V1,
];
