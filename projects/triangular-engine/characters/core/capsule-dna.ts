/**
 * Framework-free DNA contract, preset catalog, validator, and deterministic
 * seed generator for Capsule Doodle / rubber-hose space characters.
 */

export const CAPSULE_HAIR_STYLE_IDS = [
  'bald',
  'ponytail',
  'pigtails',
  'buns',
  'top_bun',
  'spiky',
  'wacky',
  'mullet',
  'swept',
  'receding',
  'mohawk',
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
  const femaleHairPool: readonly CapsuleHairStyleId[] = ['ponytail', 'pigtails', 'buns', 'top_bun', 'swept'];
  const generalHairPool: readonly CapsuleHairStyleId[] = [
    'spiky',
    'wacky',
    'mullet',
    'swept',
    'receding',
    'mohawk',
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
  const accessory: CapsuleAccessoryId = helmet
    ? rng() < 0.25
      ? 'walkie_talkie'
      : 'none'
    : pick(CAPSULE_ACCESSORY_IDS);

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
