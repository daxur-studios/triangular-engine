import type { HumanoidProportions } from 'triangular-engine/characters';
import {
  validateProceduralId,
  validateProceduralSchemaVersion,
} from '../core/procedural-validation';

export interface IProceduralCharacterPalette {
  readonly skin?: string;
  readonly torso?: string;
  readonly legs?: string;
  readonly feet?: string;
  readonly eyes?: string;
  readonly jaw?: string;
  readonly hair?: string;
}

export type CharacterBodyStyle =
  | 'villager'
  | 'faceted-vector'
  | 'extruded-silhouette'
  | 'mannequin';

export const CHARACTER_BODY_STYLES: readonly CharacterBodyStyle[] = [
  'villager',
  'faceted-vector',
  'extruded-silhouette',
  'mannequin',
];

export interface IProceduralCharacterOptions {
  readonly schemaVersion?: 1;
  readonly id?: string;
  readonly style?: CharacterBodyStyle;
  readonly seed?: string | number;
  readonly radialSegments?: number;
  readonly fingerCount?: number;
  readonly proportions?: Partial<HumanoidProportions>;
  readonly palette?: IProceduralCharacterPalette;
  readonly includeFaceMorphs?: boolean;
  readonly maxTriangles?: number;
  readonly roughness?: number;
  readonly metalness?: number;
}

export interface ICharacterBodyArchetype {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly options?: IProceduralCharacterOptions;
}

export const CHARACTER_MAX_TRIANGLES_PER_MESH = 25_000;
export const DEFAULT_CHARACTER_MAX_TRIANGLES = 10_000;
export const DEFAULT_CHARACTER_RADIAL_SEGMENTS = 8;
export const DEFAULT_CHARACTER_FINGER_COUNT = 5;

const PROPORTION_KEYS: readonly (keyof HumanoidProportions)[] = [
  'upperLegLength',
  'lowerLegLength',
  'torsoLength',
  'chestToNeck',
  'neckLength',
  'headRadius',
  'shoulderWidth',
  'upperArmLength',
  'lowerArmLength',
  'handLength',
  'armSpread',
  'footLength',
  'hipWidth',
];

export function validateProceduralCharacterOptions(
  options?: IProceduralCharacterOptions,
): void {
  if (!options) return;

  if (options.schemaVersion !== undefined) {
    validateProceduralSchemaVersion(options.schemaVersion, 'Character options');
  }

  if (options.id !== undefined) {
    validateProceduralId(options.id, 'Character options');
  }

  if (options.style !== undefined) {
    if (!CHARACTER_BODY_STYLES.includes(options.style)) {
      throw new RangeError(
        `Character style must be one of: ${CHARACTER_BODY_STYLES.join(', ')}. Got "${options.style}".`,
      );
    }
  }

  if (options.radialSegments !== undefined) {
    if (
      !Number.isInteger(options.radialSegments) ||
      options.radialSegments < 3 ||
      options.radialSegments > 64
    ) {
      throw new RangeError(
        'Character radialSegments must be an integer between 3 and 64.',
      );
    }
  }

  if (options.fingerCount !== undefined) {
    if (
      !Number.isInteger(options.fingerCount) ||
      options.fingerCount < 0 ||
      options.fingerCount > 5
    ) {
      throw new RangeError(
        'Character fingerCount must be an integer between 0 and 5.',
      );
    }
  }

  if (options.maxTriangles !== undefined) {
    if (
      !Number.isInteger(options.maxTriangles) ||
      options.maxTriangles <= 0 ||
      options.maxTriangles > CHARACTER_MAX_TRIANGLES_PER_MESH
    ) {
      throw new RangeError(
        `Character maxTriangles must be a positive integer <= ${CHARACTER_MAX_TRIANGLES_PER_MESH}.`,
      );
    }
  }

  if (options.roughness !== undefined) {
    if (
      !Number.isFinite(options.roughness) ||
      options.roughness < 0 ||
      options.roughness > 1
    ) {
      throw new RangeError('Character roughness must be a finite number between 0 and 1.');
    }
  }

  if (options.metalness !== undefined) {
    if (
      !Number.isFinite(options.metalness) ||
      options.metalness < 0 ||
      options.metalness > 1
    ) {
      throw new RangeError('Character metalness must be a finite number between 0 and 1.');
    }
  }

  if (options.proportions !== undefined) {
    for (const key of PROPORTION_KEYS) {
      const val = options.proportions[key];
      if (val !== undefined) {
        if (!Number.isFinite(val) || val <= 0) {
          throw new RangeError(
            `Character proportion "${key}" must be a positive finite number.`,
          );
        }
      }
    }
  }
}

export function validateCharacterBodyArchetype(
  archetype: ICharacterBodyArchetype,
): void {
  validateProceduralSchemaVersion(archetype.schemaVersion, 'Character body archetype');
  validateProceduralId(archetype.id, 'Character body archetype');
  if (archetype.options) {
    validateProceduralCharacterOptions(archetype.options);
  }
}
