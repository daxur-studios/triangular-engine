/**
 * Framework-free DNA contract, preset catalog, validator, and deterministic seed
 * generator for the four-legged Capsule Doodle Space Cats.
 *
 * A cat is a single horizontal capsule whose front cap is the head and the rest is
 * the torso. The DNA stays deliberately structural (proportions, suit pattern, gear
 * and gait) so the same seed renders identically in the browser and in tests.
 */

export const CAPSULE_CAT_BODY_PATTERN_IDS = [
  'front_suit',
  'full_suit',
  'natural_two_tone',
] as const;

export type CapsuleCatBodyPatternId = (typeof CAPSULE_CAT_BODY_PATTERN_IDS)[number];

export const CAPSULE_CAT_PACK_IDS = [
  'none',
  'jetpack',
  'mini_pack_brown',
  'mini_pack_blue',
] as const;

export type CapsuleCatPackId = (typeof CAPSULE_CAT_PACK_IDS)[number];

export const CAPSULE_CAT_GAIT_IDS = [
  'idle',
  'goofy_walk',
  'bound_run',
  'float',
] as const;

export type CapsuleCatGaitMode = (typeof CAPSULE_CAT_GAIT_IDS)[number];

export const CAPSULE_CAT_MOUTH_POSE_IDS = ['cat_smile', 'meow', 'open_happy'] as const;

export type CapsuleCatMouthPose = (typeof CAPSULE_CAT_MOUTH_POSE_IDS)[number];

/**
 * Lightweight, serializable parametric seed defining a Capsule Doodle Space Cat.
 */
export interface CapsuleCatCharacterDNA {
  readonly schemaVersion?: 1;
  readonly id?: string;
  readonly label?: string;
  /** Capsule torso/head radius in meters (clamped to [0.16, 0.40], default 0.28). */
  readonly bodyRadius: number;
  /** Capsule cylinder length along the forward Z axis in meters (clamped to [0.24, 0.90], default 0.50). */
  readonly bodyLength: number;
  /** Parametric suit/fur pattern painted by the body shader. */
  readonly bodyPattern: CapsuleCatBodyPatternId;
  /** Primary fur color. */
  readonly furColor: string;
  /** Secondary warm two-tone / rump accent color. */
  readonly furAccentColor: string;
  /** Spacesuit body color (default warm white '#f4f1ea'). */
  readonly suitColor: string;
  /** Orange suit trim / harness / jetpack accent color. */
  readonly suitTrimColor: string;
  /** Pink/peach inner-ear color. */
  readonly innerEarColor: string;
  /** Hex color for bootie ankle cuff rings (default warm grey '#9ca3af'). */
  readonly cuffColor: string;
  /** Horizontal angular spacing between the wide-set googly eyes (radians, [0.24, 0.62], default 0.42). */
  readonly eyeSpacing: number;
  /** Uniform scale multiplier for the bulging googly eyes ([0.75, 1.35], default 1.0). */
  readonly eyeScale: number;
  /** Baseline pupil radius relative to eye radius ([0.14, 0.50], default 0.30). */
  readonly pupilScale: number;
  /** Ear scale multiplier ([0.70, 1.30], default 1.0). */
  readonly earScale: number;
  /** Number of cheek whisker ticks per side (0-3, default 3). */
  readonly whiskerCount: number;
  /** Whether the scruffy 3-spike crown tuft renders between the ears. */
  readonly tuft: boolean;
  /** Whether the transparent bubble helmet + collar ring is equipped. */
  readonly helmet: boolean;
  /** Dorsal pack identifier. `jetpack` uses the harness; mini packs do not. */
  readonly pack: CapsuleCatPackId;
  /** Whether the orange chest/belly harness straps render with the jetpack. */
  readonly harness: boolean;
  /** Whether paws render as white space booties with grey ankle cuff rings. */
  readonly suitBooties: boolean;
  /** Default procedural gait when the actor starts. */
  readonly gait: CapsuleCatGaitMode;
  /** Bias for the 2D SDF cat mouth when no expression is driving it. */
  readonly restMouthPose: CapsuleCatMouthPose;
  /** Wide panicked eyes, flattened ears and spread whiskers. */
  readonly panicked: boolean;
  /** Tail S-curve curl amount in [0, 1] (0 = swept back, 1 = curled over the back). */
  readonly tailCurl: number;
}

export const DEFAULT_CAPSULE_CAT_FUR_COLORS: readonly string[] = [
  '#f2c7a0', // Warm cream
  '#e8b07a', // Ginger / tan
  '#d89a63', // Caramel
  '#b86e3a', // Cinnamon
  '#f3d9c3', // Peach
  '#cfc0ad', // Cool taupe
];

export const DEFAULT_CAPSULE_CAT_ACCENT_COLORS: readonly string[] = [
  '#e08a52', // Ginger
  '#c98a52', // Warm tan
  '#b86e3a', // Cinnamon
  '#8c5a34', // Dark cocoa
  '#f0dcc6', // Cream highlight
];

export const DEFAULT_CAPSULE_CAT_DNA: CapsuleCatCharacterDNA = {
  schemaVersion: 1,
  id: 'default-capsule-cat',
  label: 'Standard Capsule Space Cat',
  bodyRadius: 0.28,
  bodyLength: 0.5,
  bodyPattern: 'front_suit',
  furColor: '#f2c7a0',
  furAccentColor: '#e08a52',
  suitColor: '#f4f1ea',
  suitTrimColor: '#e86a17',
  innerEarColor: '#e9a3a0',
  cuffColor: '#9ca3af',
  eyeSpacing: 0.42,
  eyeScale: 1.0,
  pupilScale: 0.3,
  earScale: 1.0,
  whiskerCount: 3,
  tuft: false,
  helmet: true,
  pack: 'none',
  harness: false,
  suitBooties: false,
  gait: 'idle',
  restMouthPose: 'cat_smile',
  panicked: false,
  tailCurl: 0.35,
};

/**
 * Curated preset catalog matching the seven cats on the Capsule Doodle / Space Pets sheet.
 */
export const CAPSULE_CAT_PRESETS: readonly CapsuleCatCharacterDNA[] = [
  {
    ...DEFAULT_CAPSULE_CAT_DNA,
    id: 'space-cat-goofy',
    label: 'Space Cat (Goofy Walk)',
    bodyRadius: 0.28,
    bodyLength: 0.52,
    bodyPattern: 'front_suit',
    furColor: '#f2c7a0',
    furAccentColor: '#e08a52',
    innerEarColor: '#e9a3a0',
    eyeSpacing: 0.44,
    eyeScale: 1.04,
    pupilScale: 0.3,
    helmet: true,
    pack: 'none',
    harness: false,
    suitBooties: false,
    gait: 'goofy_walk',
    restMouthPose: 'cat_smile',
  },
  {
    ...DEFAULT_CAPSULE_CAT_DNA,
    id: 'space-kity-jetpack',
    label: 'Space Kity (Jetpack)',
    bodyRadius: 0.28,
    bodyLength: 0.5,
    bodyPattern: 'full_suit',
    furColor: '#f2c7a0',
    furAccentColor: '#d98a52',
    eyeSpacing: 0.42,
    eyeScale: 1.02,
    pupilScale: 0.29,
    helmet: true,
    pack: 'jetpack',
    harness: true,
    suitBooties: true,
    gait: 'bound_run',
    restMouthPose: 'cat_smile',
    tailCurl: 0.45,
  },
  {
    ...DEFAULT_CAPSULE_CAT_DNA,
    id: 'variant-d-caramel',
    label: 'Variant D (Caramel)',
    bodyRadius: 0.29,
    bodyLength: 0.52,
    bodyPattern: 'front_suit',
    furColor: '#d89a63',
    furAccentColor: '#b86e3a',
    innerEarColor: '#e7a08f',
    eyeSpacing: 0.43,
    eyeScale: 1.03,
    pupilScale: 0.29,
    helmet: true,
    pack: 'jetpack',
    harness: true,
    suitBooties: false,
    gait: 'bound_run',
    restMouthPose: 'cat_smile',
    tailCurl: 0.5,
  },
  {
    ...DEFAULT_CAPSULE_CAT_DNA,
    id: 'cosmo-kitten-a',
    label: 'Cosmo Kitten (A)',
    bodyRadius: 0.2,
    bodyLength: 0.3,
    bodyPattern: 'front_suit',
    furColor: '#f3d9c3',
    furAccentColor: '#e8b890',
    innerEarColor: '#eaa7a0',
    eyeSpacing: 0.4,
    eyeScale: 1.1,
    pupilScale: 0.32,
    earScale: 1.05,
    helmet: false,
    pack: 'mini_pack_brown',
    harness: false,
    suitBooties: false,
    gait: 'idle',
    restMouthPose: 'cat_smile',
    tailCurl: 0.6,
  },
  {
    ...DEFAULT_CAPSULE_CAT_DNA,
    id: 'cosmo-kitten-b',
    label: 'Cosmo Kitten (B)',
    bodyRadius: 0.2,
    bodyLength: 0.3,
    bodyPattern: 'full_suit',
    furColor: '#f2e4cf',
    furAccentColor: '#e6cba8',
    innerEarColor: '#eaa7a0',
    eyeSpacing: 0.4,
    eyeScale: 1.1,
    pupilScale: 0.32,
    earScale: 1.05,
    helmet: false,
    pack: 'mini_pack_blue',
    harness: false,
    suitBooties: true,
    gait: 'idle',
    restMouthPose: 'cat_smile',
    tailCurl: 0.6,
  },
  {
    ...DEFAULT_CAPSULE_CAT_DNA,
    id: 'orbit-puffer-cat',
    label: 'Orbit Puffer Cat',
    bodyRadius: 0.27,
    bodyLength: 0.48,
    bodyPattern: 'front_suit',
    furColor: '#d89a63',
    furAccentColor: '#b86e3a',
    innerEarColor: '#e7a08f',
    eyeSpacing: 0.46,
    eyeScale: 1.28,
    pupilScale: 0.18,
    helmet: false,
    pack: 'jetpack',
    harness: true,
    suitBooties: false,
    gait: 'idle',
    restMouthPose: 'cat_smile',
    panicked: true,
    tailCurl: 0.2,
  },
  {
    ...DEFAULT_CAPSULE_CAT_DNA,
    id: 'scrufly-cat',
    label: 'Scrufly Cat (Meow)',
    bodyRadius: 0.27,
    bodyLength: 0.5,
    bodyPattern: 'natural_two_tone',
    furColor: '#e8b07a',
    furAccentColor: '#c98a52',
    innerEarColor: '#e7a08f',
    eyeSpacing: 0.44,
    eyeScale: 1.05,
    pupilScale: 0.3,
    whiskerCount: 3,
    tuft: true,
    helmet: false,
    pack: 'none',
    harness: false,
    suitBooties: false,
    gait: 'idle',
    restMouthPose: 'meow',
    tailCurl: 0.55,
  },
];

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
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

function isPatternId(value: unknown): value is CapsuleCatBodyPatternId {
  return CAPSULE_CAT_BODY_PATTERN_IDS.includes(value as CapsuleCatBodyPatternId);
}

function isPackId(value: unknown): value is CapsuleCatPackId {
  return CAPSULE_CAT_PACK_IDS.includes(value as CapsuleCatPackId);
}

function isGaitMode(value: unknown): value is CapsuleCatGaitMode {
  return CAPSULE_CAT_GAIT_IDS.includes(value as CapsuleCatGaitMode);
}

function isMouthPose(value: unknown): value is CapsuleCatMouthPose {
  return CAPSULE_CAT_MOUTH_POSE_IDS.includes(value as CapsuleCatMouthPose);
}

/**
 * Validates and clamps a partial or complete `CapsuleCatCharacterDNA` into a safe,
 * normalized DNA object.
 */
export function normalizeCapsuleCatCharacterDNA(
  partial: Partial<CapsuleCatCharacterDNA> = {},
): CapsuleCatCharacterDNA {
  const base = DEFAULT_CAPSULE_CAT_DNA;

  const bodyPattern = isPatternId(partial.bodyPattern) ? partial.bodyPattern : base.bodyPattern;
  const pack = isPackId(partial.pack) ? partial.pack : base.pack;
  const gait = isGaitMode(partial.gait) ? partial.gait : base.gait;
  const restMouthPose = isMouthPose(partial.restMouthPose)
    ? partial.restMouthPose
    : base.restMouthPose;

  const bodyPatternSuit = bodyPattern !== 'natural_two_tone';
  const suitBooties = bodyPatternSuit && Boolean(partial.suitBooties ?? base.suitBooties);
  const harness = pack === 'jetpack' && Boolean(partial.harness ?? base.harness);

  return {
    schemaVersion: 1,
    id: partial.id ?? base.id,
    label: partial.label ?? base.label,
    bodyRadius: clampNumber(partial.bodyRadius ?? base.bodyRadius, 0.16, 0.4, base.bodyRadius),
    bodyLength: clampNumber(partial.bodyLength ?? base.bodyLength, 0.24, 0.9, base.bodyLength),
    bodyPattern,
    furColor: partial.furColor ?? base.furColor,
    furAccentColor: partial.furAccentColor ?? base.furAccentColor,
    suitColor: partial.suitColor ?? base.suitColor,
    suitTrimColor: partial.suitTrimColor ?? base.suitTrimColor,
    innerEarColor: partial.innerEarColor ?? base.innerEarColor,
    cuffColor: partial.cuffColor ?? base.cuffColor,
    eyeSpacing: clampNumber(partial.eyeSpacing ?? base.eyeSpacing, 0.24, 0.62, base.eyeSpacing),
    eyeScale: clampNumber(partial.eyeScale ?? base.eyeScale, 0.75, 1.35, base.eyeScale),
    pupilScale: clampNumber(partial.pupilScale ?? base.pupilScale, 0.14, 0.5, base.pupilScale),
    earScale: clampNumber(partial.earScale ?? base.earScale, 0.7, 1.3, base.earScale),
    whiskerCount: clampInteger(partial.whiskerCount ?? base.whiskerCount, 0, 3, base.whiskerCount),
    tuft: Boolean(partial.tuft ?? base.tuft),
    helmet: Boolean(partial.helmet ?? base.helmet),
    pack,
    harness,
    suitBooties,
    gait,
    restMouthPose,
    panicked: Boolean(partial.panicked ?? base.panicked),
    tailCurl: clampNumber(partial.tailCurl ?? base.tailCurl, 0, 1, base.tailCurl),
  };
}

/**
 * Generates a deterministic `CapsuleCatCharacterDNA` from any string or numeric seed.
 */
export function generateCapsuleCatCharacterDNA(seed: string | number): CapsuleCatCharacterDNA {
  const rng = createSeededRng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];

  const bodyPattern = pick(CAPSULE_CAT_BODY_PATTERN_IDS);
  const compact = rng() < 0.3;
  const pack: CapsuleCatPackId =
    rng() < 0.34 ? 'jetpack' : rng() < 0.5 ? 'mini_pack_brown' : rng() < 0.5 ? 'mini_pack_blue' : 'none';
  const helmet = pack === 'jetpack' ? rng() < 0.7 : rng() < 0.35;

  return normalizeCapsuleCatCharacterDNA({
    id: `capsule-cat-seed-${String(seed)}`,
    label: `Seeded Space Cat (${String(seed)})`,
    bodyRadius: Number((compact ? 0.19 + rng() * 0.03 : 0.25 + rng() * 0.05).toFixed(3)),
    bodyLength: Number((compact ? 0.28 + rng() * 0.06 : 0.44 + rng() * 0.14).toFixed(3)),
    bodyPattern,
    furColor: pick(DEFAULT_CAPSULE_CAT_FUR_COLORS),
    furAccentColor: pick(DEFAULT_CAPSULE_CAT_ACCENT_COLORS),
    suitColor: '#f4f1ea',
    suitTrimColor: rng() < 0.78 ? '#e86a17' : '#64748b',
    innerEarColor: '#e9a3a0',
    eyeSpacing: Number((0.38 + rng() * 0.08).toFixed(3)),
    eyeScale: Number((0.95 + rng() * 0.2).toFixed(3)),
    pupilScale: Number((0.24 + rng() * 0.1).toFixed(3)),
    earScale: Number((0.92 + rng() * 0.2).toFixed(3)),
    whiskerCount: rng() < 0.25 ? 2 : 3,
    tuft: rng() < 0.28,
    helmet,
    pack,
    harness: pack === 'jetpack',
    suitBooties: bodyPattern !== 'natural_two_tone' && rng() < 0.45,
    gait: pick(CAPSULE_CAT_GAIT_IDS),
    restMouthPose: rng() < 0.18 ? 'meow' : 'cat_smile',
    panicked: rng() < 0.18,
    tailCurl: Number((0.2 + rng() * 0.55).toFixed(3)),
  });
}
