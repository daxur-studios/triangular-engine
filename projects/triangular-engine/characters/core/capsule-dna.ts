/**
 * Framework-free DNA contract, preset catalog, validator, and deterministic
 * seed generator for Capsule Doodle / rubber-hose space characters.
 */

export const CAPSULE_HAIR_STYLE_IDS = [
  'bald',
  'sprout',
  'ponytail',
  'pigtails',
  'buns',
  'space_buns',
  'top_bun',
  'spiky',
  'wacky',
  'mullet',
  'swept',
  'receding',
  'mohawk',
  'bob_cut',
  'afro',
  'curly',
] as const;

export type CapsuleHairStyleId = (typeof CAPSULE_HAIR_STYLE_IDS)[number];

export const CAPSULE_FACIAL_HAIR_IDS = [
  'none',
  'mustache_handlebar',
  'full_beard',
] as const;

export type CapsuleFacialHairId = (typeof CAPSULE_FACIAL_HAIR_IDS)[number];

export const CAPSULE_HAND_POSE_IDS = [
  'open',
  'fist',
  'point',
  'grip',
  'wave',
] as const;

export type CapsuleHandPoseId = (typeof CAPSULE_HAND_POSE_IDS)[number];

export const CAPSULE_ACCESSORY_IDS = [
  'none',
  'headset',
  'walkie_talkie',
  'flag',
  'space_cap',
  'goggles',
  'beanie',
  'glasses',
  'coffee_mug',
  'tablet',
] as const;

export type CapsuleAccessoryId = (typeof CAPSULE_ACCESSORY_IDS)[number];

export const CAPSULE_CHEST_PATCH_IDS = [
  'none',
  'circle_badge',
  'square_pack',
] as const;

export type CapsuleChestPatchId = (typeof CAPSULE_CHEST_PATCH_IDS)[number];

/**
 * Lightweight, serializable parametric seed defining a Capsule Doodle character.
 */
export interface CapsuleCharacterDNA {
  readonly schemaVersion?: 1;
  readonly id?: string;
  readonly label?: string;
  /** Capsule torso/head radius in meters (clamped to [0.25, 0.55], default 0.36). */
  readonly bodyRadius: number;
  /** Capsule cylinder section length in meters (clamped to [0.55, 1.40], default 0.86). */
  readonly bodyHeight: number;
  /** Local Y split offset where upper skin meets lower suit (clamped to [-0.25, 0.25], default 0.0). */
  readonly suitSplitY: number;
  /** Hex color for upper skin tone. */
  readonly skinTone: string;
  /** Hex color for lower spacesuit torso (default warm white '#f4f1ea'). */
  readonly suitColor: string;
  /** Hex color for suit badge/chest pack and trim accents. */
  readonly suitTrimColor: string;
  /** Hex color for space boots ('#8c857b' grey, '#f4f1ea' white, '#e86a17' orange). */
  readonly bootColor: string;
  /** Hex color for rubber-hose arms, legs, and gloves (default '#36393f'). */
  readonly limbColor: string;
  /** Horizontal angular spacing between googly eyes (radians, [0.22, 0.55], default 0.34). */
  readonly eyeSpacing: number;
  /** Uniform scale multiplier for the bulging googly eyes ([0.7, 1.35], default 1.0). */
  readonly eyeScale: number;
  /** Baseline pupil radius relative to eye radius ([0.16, 0.55], default 0.28). */
  readonly pupilScale: number;
  /**
   * Wonky eye-size asymmetry in [-0.35, 0.35] (default 0).
   * Positive values enlarge the right eye and shrink the left eye; negative values do the reverse.
   */
  readonly eyeSizeAsymmetry: number;
  /**
   * Wonky vertical eye-height offset in [-0.08, 0.08] relative to `bodyRadius` (default 0).
   * Shifts one eye and brow slightly higher and the other slightly lower.
   */
  readonly eyeHeightAsymmetry: number;
  /**
   * Horizontal pupil gaze divergence/convergence in radians ([-0.45, 0.45], default 0).
   * Positive values push pupils slightly outward (wall-eyed); negative values pull them inward (cross-eyed).
   */
  readonly gazeAsymmetryYaw: number;
  /**
   * Vertical pupil gaze offset between left and right eyes in radians ([-0.35, 0.35], default 0).
   */
  readonly gazeAsymmetryPitch: number;
  /**
   * Rounded 3D button nose scale in [0, 1.4] (default 0 = no nose bump as in original baseline; 1.0 = standard button nose).
   */
  readonly noseScale: number;
  /** Whether to attach outer eyelash ticks on the upper eyelids (female variant). */
  readonly eyelashes: boolean;
  /** Whether the upper teeth render as prominent split buck teeth instead of a continuous bar. */
  readonly buckTeeth: boolean;
  /** Modular hair attachment identifier. */
  readonly hairStyleId: CapsuleHairStyleId;
  /** Primary hair & eyebrow hex color. */
  readonly hairColor: string;
  /** Optional secondary hair highlight hex color (used by two-tone mohawk, hairbands, etc.). */
  readonly hairHighlightColor: string;
  /** Facial hair attachment identifier. */
  readonly facialHairId: CapsuleFacialHairId;
  /** Whether the transparent bubble helmet + dark collar ring is equipped. */
  readonly helmet: boolean;
  /** Whether the twin-tank orange jetpack backpack is equipped. */
  readonly jetpack: boolean;
  /** Front suit chest detail. */
  readonly chestPatch: CapsuleChestPatchId;
  /** Head/handheld space accessory. */
  readonly accessory: CapsuleAccessoryId;
}

export const DEFAULT_CAPSULE_SKIN_TONES: readonly string[] = [
  '#f5c396',
  '#f0b684',
  '#e3a26f',
  '#c98252',
  '#9e5f36',
  '#6e3d21',
];

export const DEFAULT_CAPSULE_HAIR_COLORS: readonly string[] = [
  '#5c3824', // Chestnut brown
  '#e06829', // Ginger / bright orange
  '#26282e', // Charcoal black
  '#784b2a', // Warm medium brown
  '#d9822b', // Amber / honey blonde
  '#3f271b', // Dark espresso
  '#d88ca0', // Pastel space-bun pink
  '#3b8ea5', // Zero-G cosmic teal
  '#e8c374', // Sandy blonde
];

export const DEFAULT_CAPSULE_BOOT_COLORS: readonly string[] = [
  '#8c857b', // Warm putty grey
  '#f4f1ea', // Spacesuit cream white
  '#e86a17', // Astro safety orange
];

export const DEFAULT_CAPSULE_DNA: CapsuleCharacterDNA = {
  schemaVersion: 1,
  id: 'default-capsule-astronaut',
  label: 'Standard Capsule Astronaut',
  bodyRadius: 0.36,
  bodyHeight: 0.86,
  suitSplitY: -0.02,
  skinTone: '#f2be91',
  suitColor: '#f4f1ea',
  suitTrimColor: '#e86a17',
  bootColor: '#f4f1ea',
  limbColor: '#36393f',
  eyeSpacing: 0.34,
  eyeScale: 1.0,
  pupilScale: 0.28,
  eyeSizeAsymmetry: 0,
  eyeHeightAsymmetry: 0,
  gazeAsymmetryYaw: 0,
  gazeAsymmetryPitch: 0,
  noseScale: 0,
  eyelashes: false,
  buckTeeth: false,
  hairStyleId: 'wacky',
  hairColor: '#5c3824',
  hairHighlightColor: '#e06829',
  facialHairId: 'none',
  helmet: true,
  jetpack: true,
  chestPatch: 'circle_badge',
  accessory: 'none',
};

/**
 * Curated preset catalog matching the Capsule Doodle / Space Variants concept sheet.
 */
export const CAPSULE_CHARACTER_PRESETS: readonly CapsuleCharacterDNA[] = [
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'female-ponytail',
    label: 'Ponytail Explorer',
    bodyRadius: 0.34,
    bodyHeight: 0.88,
    skinTone: '#f4c299',
    bootColor: '#8c857b',
    eyelashes: true,
    buckTeeth: false,
    hairStyleId: 'ponytail',
    hairColor: '#5c3824',
    hairHighlightColor: '#d97706',
    helmet: false,
    jetpack: false,
    chestPatch: 'none',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'curly-pigtails',
    label: 'Curly Pigtails Cadet',
    bodyRadius: 0.35,
    bodyHeight: 0.82,
    skinTone: '#f5c59b',
    bootColor: '#f4f1ea',
    eyelashes: true,
    buckTeeth: false,
    hairStyleId: 'pigtails',
    hairColor: '#e06829',
    hairHighlightColor: '#38bdf8',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'buck-tooth-buns',
    label: 'Double Buns Rookie',
    bodyRadius: 0.34,
    bodyHeight: 0.90,
    skinTone: '#f2bc8d',
    bootColor: '#8c857b',
    eyelashes: false,
    buckTeeth: true,
    hairStyleId: 'buns',
    hairColor: '#e87825',
    hairHighlightColor: '#f59e0b',
    helmet: false,
    jetpack: false,
    chestPatch: 'none',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'top-bun-panicked',
    label: 'Top Bun Specialist',
    bodyRadius: 0.36,
    bodyHeight: 0.84,
    skinTone: '#f0b887',
    bootColor: '#f4f1ea',
    pupilScale: 0.21,
    eyelashes: false,
    buckTeeth: false,
    hairStyleId: 'top_bun',
    hairColor: '#26282e',
    hairHighlightColor: '#e86a17',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'gussy-mustache',
    label: 'Gussy Mustache Veteran',
    bodyRadius: 0.35,
    bodyHeight: 0.92,
    skinTone: '#eeb482',
    bootColor: '#8c857b',
    hairStyleId: 'spiky',
    hairColor: '#5c3824',
    facialHairId: 'mustache_handlebar',
    helmet: false,
    jetpack: false,
    chestPatch: 'none',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'wacky-helmet-waver',
    label: 'Wacky Hair Cosmonaut',
    bodyRadius: 0.36,
    bodyHeight: 0.85,
    skinTone: '#efb786',
    bootColor: '#f4f1ea',
    hairStyleId: 'wacky',
    hairColor: '#5a4336',
    facialHairId: 'none',
    helmet: true,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'variant-c-comms',
    label: 'Comms Officer (Variant C)',
    bodyRadius: 0.36,
    bodyHeight: 0.86,
    skinTone: '#f2be91',
    bootColor: '#f4f1ea',
    pupilScale: 0.22,
    hairStyleId: 'swept',
    hairColor: '#d96b27',
    facialHairId: 'none',
    helmet: false,
    jetpack: true,
    chestPatch: 'square_pack',
    accessory: 'walkie_talkie',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'headset-runner',
    label: 'Headset Flight Director',
    bodyRadius: 0.36,
    bodyHeight: 0.84,
    skinTone: '#eeb380',
    bootColor: '#e86a17',
    pupilScale: 0.20,
    hairStyleId: 'receding',
    hairColor: '#4b3b32',
    facialHairId: 'none',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'headset',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'bearded-commander',
    label: 'Bearded Mission Commander',
    bodyRadius: 0.38,
    bodyHeight: 0.84,
    skinTone: '#ebb17e',
    bootColor: '#e86a17',
    hairStyleId: 'spiky',
    hairColor: '#63432e',
    facialHairId: 'full_beard',
    helmet: true,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'mohawk-floater',
    label: 'Zero-G Mohawk Scout',
    bodyRadius: 0.35,
    bodyHeight: 0.83,
    skinTone: '#efb786',
    bootColor: '#f4f1ea',
    hairStyleId: 'mohawk',
    hairColor: '#362b26',
    hairHighlightColor: '#eab308',
    facialHairId: 'none',
    helmet: true,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
];

/**
 * Alt Space Variants & Wonky-Eye Presets derived from the second Capsule Doodle
 * reference sheets (Sprout Doodle & Alt Space Variants).
 * Preserves `CAPSULE_CHARACTER_PRESETS` unchanged as the baseline catalog.
 */
export const CAPSULE_ALT_CHARACTER_PRESETS: readonly CapsuleCharacterDNA[] = [
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'sprout-wonky-doodle',
    label: 'Sprout Wonky Doodle (Alt)',
    bodyRadius: 0.36,
    bodyHeight: 0.85,
    skinTone: '#f5be8f',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.34,
    eyeScale: 1.05,
    pupilScale: 0.26,
    eyeSizeAsymmetry: 0.22,
    eyeHeightAsymmetry: 0.035,
    gazeAsymmetryYaw: 0.22,
    gazeAsymmetryPitch: 0.09,
    noseScale: 1.0,
    hairStyleId: 'sprout',
    hairColor: '#362b26',
    helmet: true,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'alt-spiky-wonky-waver',
    label: 'Wonky Spiky Cadet (Alt)',
    bodyRadius: 0.36,
    bodyHeight: 0.85,
    skinTone: '#efb786',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.34,
    eyeScale: 1.04,
    pupilScale: 0.27,
    eyeSizeAsymmetry: 0.18,
    eyeHeightAsymmetry: 0.025,
    gazeAsymmetryYaw: 0.16,
    gazeAsymmetryPitch: 0.06,
    noseScale: 1.0,
    hairStyleId: 'spiky',
    hairColor: '#2d2926',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'alt-space-buns-pink',
    label: 'Pink Space Buns (Alt)',
    bodyRadius: 0.35,
    bodyHeight: 0.85,
    skinTone: '#f4c299',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.34,
    eyeScale: 1.02,
    pupilScale: 0.27,
    eyeSizeAsymmetry: -0.10,
    eyeHeightAsymmetry: 0.015,
    gazeAsymmetryYaw: 0.08,
    noseScale: 0.95,
    eyelashes: true,
    hairStyleId: 'space_buns',
    hairColor: '#d88ca0',
    hairHighlightColor: '#f4f1ea',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'alt-space-cap-cadet',
    label: 'Space Cap Pilot (Alt)',
    bodyRadius: 0.36,
    bodyHeight: 0.86,
    skinTone: '#eeb482',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.33,
    eyeScale: 1.0,
    pupilScale: 0.26,
    noseScale: 1.0,
    hairStyleId: 'swept',
    hairColor: '#4b3628',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'space_cap',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'alt-afro-groove',
    label: 'Curly Afro Specialist (Alt)',
    bodyRadius: 0.36,
    bodyHeight: 0.85,
    skinTone: '#c98252',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.34,
    eyeScale: 1.02,
    pupilScale: 0.27,
    noseScale: 1.0,
    eyelashes: true,
    hairStyleId: 'afro',
    hairColor: '#3f271b',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'alt-goggles-mechanic',
    label: 'Forehead Goggles Tech (Alt)',
    bodyRadius: 0.36,
    bodyHeight: 0.86,
    skinTone: '#f2be91',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.34,
    eyeScale: 1.03,
    pupilScale: 0.26,
    eyeSizeAsymmetry: 0.14,
    eyeHeightAsymmetry: -0.02,
    gazeAsymmetryYaw: 0.14,
    noseScale: 1.0,
    hairStyleId: 'wacky',
    hairColor: '#e8c374',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'goggles',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'alt-bob-cut',
    label: 'Bob Cut Navigator (Alt)',
    bodyRadius: 0.35,
    bodyHeight: 0.84,
    skinTone: '#f4c299',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.34,
    eyeScale: 1.02,
    pupilScale: 0.27,
    noseScale: 0.95,
    eyelashes: true,
    hairStyleId: 'bob_cut',
    hairColor: '#26282e',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'alt-curly-helmet-walker',
    label: 'Curly Ginger Cosmonaut (Alt)',
    bodyRadius: 0.36,
    bodyHeight: 0.85,
    skinTone: '#f2be91',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.34,
    eyeScale: 1.05,
    pupilScale: 0.26,
    eyeSizeAsymmetry: 0.16,
    eyeHeightAsymmetry: 0.02,
    gazeAsymmetryYaw: 0.12,
    noseScale: 1.0,
    hairStyleId: 'curly',
    hairColor: '#e06829',
    helmet: true,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'none',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'alt-glasses-coffee',
    label: 'Caffeinated Scientist (Alt)',
    bodyRadius: 0.36,
    bodyHeight: 0.85,
    skinTone: '#f2be91',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.35,
    eyeScale: 1.02,
    pupilScale: 0.23,
    eyeSizeAsymmetry: -0.14,
    eyeHeightAsymmetry: 0.025,
    gazeAsymmetryYaw: -0.18,
    gazeAsymmetryPitch: 0.08,
    noseScale: 1.0,
    hairStyleId: 'wacky',
    hairColor: '#e8c374',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'glasses',
  },
  {
    ...DEFAULT_CAPSULE_DNA,
    id: 'alt-beanie-explorer',
    label: 'Knit Beanie Explorer (Alt)',
    bodyRadius: 0.35,
    bodyHeight: 0.85,
    skinTone: '#eeb482',
    bootColor: '#f4f1ea',
    eyeSpacing: 0.34,
    eyeScale: 1.02,
    pupilScale: 0.27,
    noseScale: 1.0,
    hairStyleId: 'mullet',
    hairColor: '#4b3628',
    helmet: false,
    jetpack: true,
    chestPatch: 'circle_badge',
    accessory: 'beanie',
  },
];

export const ALL_CAPSULE_CHARACTER_PRESETS: readonly CapsuleCharacterDNA[] = [
  ...CAPSULE_CHARACTER_PRESETS,
  ...CAPSULE_ALT_CHARACTER_PRESETS,
];

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function hashSeedString(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function createSeededRng(seed: string | number): () => number {
  let state = (typeof seed === 'number' ? Math.floor(seed) : hashSeedString(String(seed))) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Validates and clamps a partial or complete `CapsuleCharacterDNA` into a safe, normalized DNA object.
 */
export function normalizeCapsuleCharacterDNA(
  partial: Partial<CapsuleCharacterDNA> = {},
): CapsuleCharacterDNA {
  const base = DEFAULT_CAPSULE_DNA;
  const hairStyleId =
    partial.hairStyleId && CAPSULE_HAIR_STYLE_IDS.includes(partial.hairStyleId)
      ? partial.hairStyleId
      : base.hairStyleId;
  const facialHairId =
    partial.facialHairId && CAPSULE_FACIAL_HAIR_IDS.includes(partial.facialHairId)
      ? partial.facialHairId
      : base.facialHairId;
  const accessory =
    partial.accessory && CAPSULE_ACCESSORY_IDS.includes(partial.accessory)
      ? partial.accessory
      : base.accessory;
  const chestPatch =
    partial.chestPatch && CAPSULE_CHEST_PATCH_IDS.includes(partial.chestPatch)
      ? partial.chestPatch
      : base.chestPatch;

  return {
    schemaVersion: 1,
    id: partial.id ?? base.id,
    label: partial.label ?? base.label,
    bodyRadius: clampNumber(partial.bodyRadius ?? base.bodyRadius, 0.25, 0.55, base.bodyRadius),
    bodyHeight: clampNumber(partial.bodyHeight ?? base.bodyHeight, 0.55, 1.40, base.bodyHeight),
    suitSplitY: clampNumber(partial.suitSplitY ?? base.suitSplitY, -0.25, 0.25, base.suitSplitY),
    skinTone: partial.skinTone ?? base.skinTone,
    suitColor: partial.suitColor ?? base.suitColor,
    suitTrimColor: partial.suitTrimColor ?? base.suitTrimColor,
    bootColor: partial.bootColor ?? base.bootColor,
    limbColor: partial.limbColor ?? base.limbColor,
    eyeSpacing: clampNumber(partial.eyeSpacing ?? base.eyeSpacing, 0.22, 0.55, base.eyeSpacing),
    eyeScale: clampNumber(partial.eyeScale ?? base.eyeScale, 0.7, 1.35, base.eyeScale),
    pupilScale: clampNumber(partial.pupilScale ?? base.pupilScale, 0.16, 0.55, base.pupilScale),
    eyeSizeAsymmetry: clampNumber(
      partial.eyeSizeAsymmetry ?? base.eyeSizeAsymmetry,
      -0.35,
      0.35,
      base.eyeSizeAsymmetry,
    ),
    eyeHeightAsymmetry: clampNumber(
      partial.eyeHeightAsymmetry ?? base.eyeHeightAsymmetry,
      -0.08,
      0.08,
      base.eyeHeightAsymmetry,
    ),
    gazeAsymmetryYaw: clampNumber(
      partial.gazeAsymmetryYaw ?? base.gazeAsymmetryYaw,
      -0.45,
      0.45,
      base.gazeAsymmetryYaw,
    ),
    gazeAsymmetryPitch: clampNumber(
      partial.gazeAsymmetryPitch ?? base.gazeAsymmetryPitch,
      -0.35,
      0.35,
      base.gazeAsymmetryPitch,
    ),
    noseScale: clampNumber(partial.noseScale ?? base.noseScale, 0, 1.4, base.noseScale),
    eyelashes: Boolean(partial.eyelashes ?? base.eyelashes),
    buckTeeth: Boolean(partial.buckTeeth ?? base.buckTeeth),
    hairStyleId,
    hairColor: partial.hairColor ?? base.hairColor,
    hairHighlightColor: partial.hairHighlightColor ?? base.hairHighlightColor,
    facialHairId,
    helmet: Boolean(partial.helmet ?? base.helmet),
    jetpack: Boolean(partial.jetpack ?? base.jetpack),
    chestPatch,
    accessory,
  };
}

/**
 * Generates a deterministic `CapsuleCharacterDNA` from any string or numeric seed.
 */
export function generateCapsuleCharacterDNA(seed: string | number): CapsuleCharacterDNA {
  const rng = createSeededRng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];

  const eyelashes = rng() < 0.35;
  const femaleHairPool: readonly CapsuleHairStyleId[] = [
    'ponytail',
    'pigtails',
    'buns',
    'space_buns',
    'top_bun',
    'bob_cut',
    'afro',
    'curly',
    'swept',
  ];
  const generalHairPool: readonly CapsuleHairStyleId[] = [
    'sprout',
    'spiky',
    'wacky',
    'mullet',
    'swept',
    'receding',
    'mohawk',
    'curly',
    'afro',
    'bald',
  ];
  const hairStyleId = eyelashes ? pick(femaleHairPool) : pick(generalHairPool);
  const facialHairId: CapsuleFacialHairId =
    eyelashes || rng() < 0.68
      ? 'none'
      : rng() < 0.55
        ? 'mustache_handlebar'
        : 'full_beard';

  const helmet = rng() < 0.45;
  const helmetCompatibleAccessories: readonly CapsuleAccessoryId[] = [
    'none',
    'walkie_talkie',
    'tablet',
    'coffee_mug',
    'glasses',
  ];
  const accessory: CapsuleAccessoryId = helmet
    ? rng() < 0.35
      ? pick(helmetCompatibleAccessories)
      : 'none'
    : pick(CAPSULE_ACCESSORY_IDS);

  const hasWonkyEyes = rng() < 0.45;
  const eyeSizeAsymmetry = hasWonkyEyes ? Number(((rng() - 0.5) * 0.44).toFixed(3)) : 0;
  const eyeHeightAsymmetry = hasWonkyEyes ? Number(((rng() - 0.5) * 0.06).toFixed(3)) : 0;
  const gazeAsymmetryYaw = hasWonkyEyes ? Number(((rng() - 0.5) * 0.38).toFixed(3)) : 0;
  const gazeAsymmetryPitch = hasWonkyEyes ? Number(((rng() - 0.5) * 0.18).toFixed(3)) : 0;
  const noseScale = rng() < 0.65 ? Number((0.75 + rng() * 0.4).toFixed(3)) : 0;

  return normalizeCapsuleCharacterDNA({
    id: `capsule-seed-${String(seed)}`,
    label: `Seeded Capsule (${String(seed)})`,
    bodyRadius: Number((0.32 + rng() * 0.08).toFixed(3)),
    bodyHeight: Number((0.76 + rng() * 0.24).toFixed(3)),
    suitSplitY: Number((-0.05 + rng() * 0.08).toFixed(3)),
    skinTone: pick(DEFAULT_CAPSULE_SKIN_TONES),
    suitColor: '#f4f1ea',
    suitTrimColor: rng() < 0.75 ? '#e86a17' : '#64748b',
    bootColor: pick(DEFAULT_CAPSULE_BOOT_COLORS),
    limbColor: '#36393f',
    eyeSpacing: Number((0.30 + rng() * 0.09).toFixed(3)),
    eyeScale: Number((0.92 + rng() * 0.18).toFixed(3)),
    pupilScale: Number((0.22 + rng() * 0.12).toFixed(3)),
    eyeSizeAsymmetry,
    eyeHeightAsymmetry,
    gazeAsymmetryYaw,
    gazeAsymmetryPitch,
    noseScale,
    eyelashes,
    buckTeeth: rng() < 0.22,
    hairStyleId,
    hairColor: pick(DEFAULT_CAPSULE_HAIR_COLORS),
    hairHighlightColor: pick(DEFAULT_CAPSULE_HAIR_COLORS),
    facialHairId,
    helmet,
    jetpack: rng() < 0.72,
    chestPatch: pick(CAPSULE_CHEST_PATCH_IDS),
    accessory,
  });
}
