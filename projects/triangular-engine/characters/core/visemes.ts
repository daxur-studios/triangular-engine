/**
 * Speech visemes: a small articulatory mouth-shape set with a deterministic
 * text → timed-track estimator.
 *
 * This is intentionally approximate: it derives visemes from graphemes and a
 * speaking rate, so it works with any text-to-speech source (including the
 * browser's `speechSynthesis`, which does not expose viseme timestamps). Real
 * TTS services that emit per-viseme timing can drive `visemeToBlendShapes`
 * directly instead.
 */

import type { BlendShapeWeights, BlendshapeName } from './blend-shapes';

export const VISEME_NAMES = [
  'sil',
  'A',
  'E',
  'I',
  'O',
  'U',
  'C',
  'F',
  'M',
  'L',
  'S',
  'T',
  'R',
  'W',
  'TH',
] as const;

export type Viseme = (typeof VISEME_NAMES)[number];

export interface VisemeKeyframe {
  /** Start time in seconds. */
  readonly time: number;
  readonly viseme: Viseme;
  /** Hold duration in seconds. */
  readonly duration: number;
}

export interface VisemeTrackOptions {
  /** Speaking rate in words per minute. */
  readonly wordsPerMinute?: number;
  /** Silence held between words, in seconds. */
  readonly wordGapSeconds?: number;
}

const DEFAULT_WORDS_PER_MINUTE = 180;
const DEFAULT_WORD_GAP_SECONDS = 0.08;

/** Mouth-shape targets for each viseme (ARKit names). */
const VISEME_BLENDSHAPES: Readonly<Record<Viseme, BlendShapeWeights>> = {
  sil: {},
  A: { jawOpen: 0.75 },
  E: { jawOpen: 0.4, mouthStretchLeft: 0.25, mouthStretchRight: 0.25 },
  I: { mouthStretchLeft: 0.55, mouthStretchRight: 0.55, jawOpen: 0.15 },
  O: { mouthFunnel: 0.6, jawOpen: 0.4 },
  U: { mouthPucker: 0.7, jawOpen: 0.15 },
  C: { jawOpen: 0.35, mouthClose: 0.25 },
  F: { mouthPressLeft: 0.5, mouthPressRight: 0.5, jawOpen: 0.15 },
  M: { mouthPressLeft: 0.7, mouthPressRight: 0.7 },
  L: { jawOpen: 0.5, tongueOut: 0.5 },
  S: { mouthStretchLeft: 0.35, mouthStretchRight: 0.35, jawOpen: 0.15 },
  T: { jawOpen: 0.2, mouthStretchLeft: 0.15, mouthStretchRight: 0.15 },
  R: { mouthFunnel: 0.55, jawOpen: 0.25 },
  W: { mouthPucker: 0.6 },
  TH: { jawOpen: 0.3, tongueOut: 0.6 },
};

const GRAPHEME_VISEME: Readonly<Record<string, Viseme>> = {
  a: 'A', e: 'E', i: 'I', o: 'O', u: 'U',
  b: 'M', p: 'M', m: 'M',
  f: 'F', v: 'F',
  l: 'L',
  r: 'R',
  w: 'W', q: 'W',
  s: 'S', z: 'S',
  t: 'T', d: 'T', n: 'T',
  c: 'C', g: 'C', k: 'C', h: 'C', j: 'C', x: 'C', y: 'C',
};

/** Tokenize text into lowercase word strings, dropping punctuation. */
export function preProcessText(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/'/g, ''))
    .filter((word) => word.length > 0);
}

function graphemesToVisemes(word: string): readonly Viseme[] {
  const visemes: Viseme[] = [];
  for (let i = 0; i < word.length; i++) {
    const digraph = word.slice(i, i + 2);
    if (digraph === 'th') {
      visemes.push('TH');
      i++;
      continue;
    }
    visemes.push(GRAPHEME_VISEME[word[i]] ?? 'C');
  }
  // Collapse consecutive repeats so a single mouth shape is held, not re-hit.
  return visemes.filter((viseme, index) => index === 0 || viseme !== visemes[index - 1]);
}

/**
 * Produce a timed viseme track for a string, distributing word durations by
 * grapheme count at `wordsPerMinute` with a silence gap between words.
 */
export function wordsToVisemes(
  words: readonly string[],
  options: VisemeTrackOptions = {},
): readonly VisemeKeyframe[] {
  const wpm = options.wordsPerMinute ?? DEFAULT_WORDS_PER_MINUTE;
  const gap = options.wordGapSeconds ?? DEFAULT_WORD_GAP_SECONDS;
  if (!Number.isFinite(wpm) || wpm <= 0) {
    throw new RangeError(`wordsToVisemes wordsPerMinute must be positive, got ${wpm}.`);
  }
  if (!Number.isFinite(gap) || gap < 0) {
    throw new RangeError(`wordsToVisemes wordGapSeconds must be non-negative, got ${gap}.`);
  }

  const secondsPerGrapheme = 60 / wpm / 5;

  const keyframes: VisemeKeyframe[] = [];
  let cursor = 0;

  for (const word of words) {
    const visemes = graphemesToVisemes(word);
    const wordDuration = word.length * secondsPerGrapheme;
    const perViseme = wordDuration / visemes.length;

    for (let i = 0; i < visemes.length; i++) {
      keyframes.push({ time: cursor, viseme: visemes[i], duration: perViseme });
      cursor += perViseme;
    }

    keyframes.push({ time: cursor, viseme: 'sil', duration: gap });
    cursor += gap;
  }

  return keyframes;
}

/** Active viseme at a point in time; `sil` when outside any keyframe. */
export function sampleVisemeTrack(
  track: readonly VisemeKeyframe[],
  time: number,
): Viseme {
  for (const keyframe of track) {
    if (time >= keyframe.time && time < keyframe.time + keyframe.duration) {
      return keyframe.viseme;
    }
  }
  return 'sil';
}

/** Blendshape weights for a single viseme. */
export function visemeToBlendShapes(viseme: Viseme): BlendShapeWeights {
  return VISEME_BLENDSHAPES[viseme];
}

/** Blendshape weights for a text at a point in time (speech-driven). */
export function textToBlendShapesAt(
  words: readonly string[],
  time: number,
  options: VisemeTrackOptions = {},
): BlendShapeWeights {
  return visemeToBlendShapes(sampleVisemeTrack(wordsToVisemes(words, options), time));
}

/** The ARKit names a viseme track can touch; useful for pre-allocating morph targets. */
export const VISEME_BLENDSHAPE_KEYS: readonly BlendshapeName[] = (() => {
  const keys = new Set<BlendshapeName>();
  for (const weights of Object.values(VISEME_BLENDSHAPES)) {
    for (const key of Object.keys(weights) as BlendshapeName[]) keys.add(key);
  }
  return [...keys];
})();
