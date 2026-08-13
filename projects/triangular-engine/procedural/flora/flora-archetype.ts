import type { IProceduralSocket } from '../core/procedural-socket';
import {
  validateProcedural01,
  validateProceduralFiniteRange,
  validateProceduralId,
  validateProceduralSchemaVersion,
} from '../core/procedural-validation';

export type FloraArchetypeKind = 'tree' | 'flower' | 'bush';
export type FloraFoliageStyle = 'cluster-sphere' | 'cluster-cone' | 'none';
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
    readonly sizeM: readonly [number, number];
  };
  readonly sockets: {
    readonly perchesPerBranchDepth: Readonly<Record<number, number>>;
    readonly nestCavityChance01: number;
    readonly fruitSlotsMax: number;
    readonly flowerHeads: boolean;
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

  validateProcedural01(
    archetype.sockets.nestCavityChance01,
    'Flora archetype sockets nestCavityChance01',
  );
  if (!Number.isInteger(archetype.sockets.fruitSlotsMax) || archetype.sockets.fruitSlotsMax < 0) {
    throw new RangeError('Flora archetype sockets fruitSlotsMax must be a non-negative integer.');
  }
}
