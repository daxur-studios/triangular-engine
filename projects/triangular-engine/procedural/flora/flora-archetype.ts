import type { IProceduralSocket } from '../core/procedural-socket';
import {
  validateProcedural01,
  validateProceduralFiniteRange,
  validateProceduralId,
  validateProceduralSchemaVersion,
} from '../core/procedural-validation';

export type FloraArchetypeKind = 'tree' | 'flower' | 'bush';
export type FloraFoliageStyle = 'cluster-sphere' | 'cluster-cone' | 'radial-fronds' | 'none';
export type FloraTrunkColliderShape = 'capsule' | 'cylinder' | 'none';

/** Flora-specific socket kinds — core's IProceduralSocket<TKind> knows nothing
 *  about perches or nest cavities; only flora/ does. */
export type FloraSocketKind =
  | 'perch'
  | 'nest-cavity'
  | 'fruit-slot'
  | 'flower-head'
  | 'climb-path'
  | 'root-base';

export interface IFloraSocket extends IProceduralSocket<FloraSocketKind> {}

export interface IFloraArchetype {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name?: string;
  readonly kind: FloraArchetypeKind;
  /** Ranges are [min, max]; each variant samples them with its seed. */
  readonly trunk: {
    readonly heightM: readonly [number, number];
    readonly radiusM: readonly [number, number];
    readonly taper01: number;
  };
  readonly branching: {
    /** 2-3 keeps it abstract, per the "not a botany simulator" scope note. */
    readonly maxDepth: number;
    readonly childrenPerNode: readonly [number, number];
    readonly spreadAngleRad: readonly [number, number];
    readonly lengthFalloff01: number;
  };
  readonly foliage: {
    readonly style: FloraFoliageStyle;
    /** For 'radial-fronds', this sizes the small hub bulge the fronds radiate from, not the fan itself. */
    readonly sizeM: readonly [number, number];
    /** Required (and only meaningful) when style === 'radial-fronds'. */
    readonly radialFronds?: {
      readonly frondCount: number;
      readonly frondLengthM: readonly [number, number];
      readonly frondDroopRad: number;
    };
  };
  readonly sockets: {
    readonly perchesPerBranchDepth: Readonly<Record<number, number>>;
    readonly nestCavityChance01: number;
    readonly fruitSlotsMax: number;
    readonly flowerHeads: boolean;
    /** Perches placed along frond bases instead of a branch segment — only meaningful (and only used) when foliage.style === 'radial-fronds', since that style has no perchable limbs. */
    readonly frondPerches?: number;
  };
  readonly collider: { readonly trunk: FloraTrunkColliderShape };
}

/** Throws a descriptive RangeError on the first invalid field found. */
export function validateFloraArchetype(archetype: IFloraArchetype): void {
  validateProceduralSchemaVersion(archetype.schemaVersion, 'Flora archetype');
  validateProceduralId(archetype.id, 'Flora archetype');

  validateProceduralFiniteRange(archetype.trunk.heightM, 'Flora archetype trunk heightM');
  validateProceduralFiniteRange(archetype.trunk.radiusM, 'Flora archetype trunk radiusM');
  validateProcedural01(archetype.trunk.taper01, 'Flora archetype trunk taper01');

  if (!Number.isInteger(archetype.branching.maxDepth) || archetype.branching.maxDepth < 0) {
    throw new RangeError('Flora archetype branching maxDepth must be a non-negative integer.');
  }
  validateProceduralFiniteRange(
    archetype.branching.childrenPerNode,
    'Flora archetype branching childrenPerNode',
  );
  validateProceduralFiniteRange(
    archetype.branching.spreadAngleRad,
    'Flora archetype branching spreadAngleRad',
  );
  validateProcedural01(
    archetype.branching.lengthFalloff01,
    'Flora archetype branching lengthFalloff01',
  );

  validateProceduralFiniteRange(archetype.foliage.sizeM, 'Flora archetype foliage sizeM');

  if (archetype.foliage.style === 'radial-fronds') {
    const radialFronds = archetype.foliage.radialFronds;
    if (!radialFronds) {
      throw new RangeError(
        "Flora archetype foliage.radialFronds is required when style is 'radial-fronds'.",
      );
    }
    if (!Number.isInteger(radialFronds.frondCount) || radialFronds.frondCount < 1) {
      throw new RangeError('Flora archetype foliage radialFronds.frondCount must be a positive integer.');
    }
    validateProceduralFiniteRange(
      radialFronds.frondLengthM,
      'Flora archetype foliage radialFronds.frondLengthM',
    );
    if (
      !Number.isFinite(radialFronds.frondDroopRad) ||
      radialFronds.frondDroopRad < 0 ||
      radialFronds.frondDroopRad > Math.PI / 2
    ) {
      throw new RangeError(
        'Flora archetype foliage radialFronds.frondDroopRad must be a finite number between 0 and PI/2.',
      );
    }
  }

  validateProcedural01(
    archetype.sockets.nestCavityChance01,
    'Flora archetype sockets nestCavityChance01',
  );
  if (!Number.isInteger(archetype.sockets.fruitSlotsMax) || archetype.sockets.fruitSlotsMax < 0) {
    throw new RangeError('Flora archetype sockets fruitSlotsMax must be a non-negative integer.');
  }
  if (
    archetype.sockets.frondPerches !== undefined &&
    (!Number.isInteger(archetype.sockets.frondPerches) || archetype.sockets.frondPerches < 0)
  ) {
    throw new RangeError('Flora archetype sockets frondPerches must be a non-negative integer.');
  }
}
