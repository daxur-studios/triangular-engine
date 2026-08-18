import {
  validateProceduralFiniteRange,
  validateProceduralId,
  validateProceduralSchemaVersion,
} from '../core/procedural-validation';

/**
 * Ground cover (grass, wildflowers, low clutter) doesn't branch like flora —
 * one clump is just a handful of curved blade cards fanned around a center,
 * so unlike `IFloraArchetype` there's no skeleton, no sockets, and no
 * collider: nothing here needs a hierarchy or gameplay-relevant collision.
 */
export interface IGroundCoverArchetype {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name?: string;
  readonly blade: {
    readonly heightM: readonly [number, number];
    readonly widthM: readonly [number, number];
    /** How far the blade tip leans from vertical, in radians — 0 is straight up. */
    readonly curveRad: readonly [number, number];
  };
  readonly clump: {
    readonly bladeCount: readonly [number, number];
    /** Radius blades are scattered within around the clump's local origin. */
    readonly radiusM: readonly [number, number];
  };
  /**
   * Optional bloom at each blade's tip — two crossed quads (the standard
   * cheap foliage-puff impostor), geometrically distinct from the blade
   * itself. Shape only, like the rest of this archetype — its color is a
   * caller-side hint (`IGroundCoverColorHints.headHex`), not part of this
   * schema. Omit for plain grass.
   */
  readonly head?: {
    readonly radiusM: readonly [number, number];
  };
}

/** Throws a descriptive RangeError on the first invalid field found. */
export function validateGroundCoverArchetype(archetype: IGroundCoverArchetype): void {
  validateProceduralSchemaVersion(archetype.schemaVersion, 'Ground cover archetype');
  validateProceduralId(archetype.id, 'Ground cover archetype');

  validateProceduralFiniteRange(archetype.blade.heightM, 'Ground cover archetype blade heightM');
  if (archetype.blade.heightM[0] <= 0) {
    throw new RangeError('Ground cover archetype blade heightM must be positive.');
  }
  validateProceduralFiniteRange(archetype.blade.widthM, 'Ground cover archetype blade widthM');
  if (archetype.blade.widthM[0] <= 0) {
    throw new RangeError('Ground cover archetype blade widthM must be positive.');
  }
  validateProceduralFiniteRange(archetype.blade.curveRad, 'Ground cover archetype blade curveRad');
  if (archetype.blade.curveRad[0] < 0 || archetype.blade.curveRad[1] > Math.PI / 2) {
    throw new RangeError('Ground cover archetype blade curveRad must be within [0, PI/2].');
  }

  validateProceduralFiniteRange(archetype.clump.bladeCount, 'Ground cover archetype clump bladeCount');
  if (
    !Number.isInteger(archetype.clump.bladeCount[0]) ||
    !Number.isInteger(archetype.clump.bladeCount[1]) ||
    archetype.clump.bladeCount[0] < 1
  ) {
    throw new RangeError('Ground cover archetype clump bladeCount must be positive integers.');
  }
  validateProceduralFiniteRange(archetype.clump.radiusM, 'Ground cover archetype clump radiusM');
  if (archetype.clump.radiusM[0] < 0) {
    throw new RangeError('Ground cover archetype clump radiusM must be non-negative.');
  }

  if (archetype.head) {
    validateProceduralFiniteRange(archetype.head.radiusM, 'Ground cover archetype head radiusM');
    if (archetype.head.radiusM[0] <= 0) {
      throw new RangeError('Ground cover archetype head radiusM must be positive.');
    }
  }
}
