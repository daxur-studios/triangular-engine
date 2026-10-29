import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import type {
  CapsuleCatGaitMode,
  CapsuleCatMouthPose,
  CapsuleHandActionMode,
  CapsuleLocomotionMode,
  ExtendedEmotionName,
} from 'triangular-engine/characters';
import type { CameraFramingPreset } from './characters-lab-page.component';

/**
 * Settings configuration for a Characters Lab scenario.
 * Encapsulates character selection, facial emotion, locomotion gait, camera framing, and speech.
 */
export interface CharactersLabTestSettings {
  readonly characterType: 'cat' | 'human';
  readonly presetId: string;
  readonly emotion: ExtendedEmotionName;
  readonly gait: CapsuleCatGaitMode | CapsuleLocomotionMode;
  readonly cameraFraming: CameraFramingPreset;
  readonly speak?: boolean;
  readonly speechText?: string;
  readonly panicked?: boolean;
  readonly tuft?: boolean;
  readonly restMouthPose?: CapsuleCatMouthPose;
  readonly rightHandAction?: CapsuleHandActionMode;
  readonly leftHandAction?: CapsuleHandActionMode;
  readonly motion?: 'turntable' | 'still';
}

export const DEFAULT_CAT_TEST_SETTINGS: CharactersLabTestSettings = {
  characterType: 'cat',
  presetId: 'space-cat-goofy',
  emotion: 'happy',
  gait: 'goofy_walk',
  cameraFraming: 'front',
  panicked: false,
  tuft: false,
  restMouthPose: 'cat_smile',
  motion: 'still',
};

export const DEFAULT_HUMAN_TEST_SETTINGS: CharactersLabTestSettings = {
  characterType: 'human',
  presetId: 'wacky-hair-cosmonaut',
  emotion: 'happy',
  gait: 'idle',
  cameraFraming: 'front',
  rightHandAction: 'wave',
  leftHandAction: 'none',
  motion: 'still',
};

function scenario(
  id: string,
  label: string,
  change: Partial<CharactersLabTestSettings>,
  base: CharactersLabTestSettings = DEFAULT_CAT_TEST_SETTINGS,
  durationMs = 3500,
  quickMs = 1500,
): TestScenario<CharactersLabTestSettings> {
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
export const CAT_EMOTIONS_SUITE_V1: TestSuite<CharactersLabTestSettings> = {
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
export const CAT_LINEUP_SUITE_V1: TestSuite<CharactersLabTestSettings> = {
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
export const CAT_SPEECH_SUITE_V1: TestSuite<CharactersLabTestSettings> = {
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
export const HUMANOID_BASELINES_SUITE_V1: TestSuite<CharactersLabTestSettings> = {
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
 * Full test history for Characters Lab, oldest first.
 * The final entry is the default latest test suite.
 */
export const CHARACTERS_LAB_TEST_HISTORY: readonly TestSuite<CharactersLabTestSettings>[] = [
  CAT_LINEUP_SUITE_V1,
  CAT_SPEECH_SUITE_V1,
  HUMANOID_BASELINES_SUITE_V1,
  CAT_EMOTIONS_SUITE_V1,
];
