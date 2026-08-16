import type { IProceduralSocket } from '../core/procedural-socket';
import {
  validateProcedural01,
  validateProceduralFiniteRange,
  validateProceduralId,
  validateProceduralSchemaVersion,
} from '../core/procedural-validation';

export type FloraArchetypeKind = 'tree' | 'flower' | 'bush';
export type FloraBranchingDistribution = 'apical' | 'tiered-whorls';
export type FloraFoliageStyle =
  | 'cluster-sphere'
  | 'cluster-cone'
  | 'radial-fronds'
  | 'conifer-tiered'
  | 'none';
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

export interface IFloraTieredWhorlsBranchingConfig {
  /** [min, max] count of horizontal branch tiers along the trunk. */
  readonly tierCount: readonly [number, number];
  /** Fraction from trunk base (0..1) where lowest tier starts, e.g. 0.2 leaving clear lower trunk. */
  readonly startHeightFraction01: number;
  /** [min, max] branches radiating per tier, e.g. [4, 6]. */
  readonly branchesPerTier: readonly [number, number];
  /** Downward droop angle range in radians for tier branches, e.g. [0.08, 0.25]. */
  readonly droopRad: readonly [number, number];
  /** Base branch length as a fraction of total trunk height for the bottom tier, e.g. [0.35, 0.5]. */
  readonly baseBranchLengthFraction: readonly [number, number];
}

export interface IFloraConiferTieredFoliageConfig {
  /** Height range of the apex spire cone atop the trunk tip, e.g. [1.0, 1.6]. */
  readonly spireHeightM: readonly [number, number];
  /** Radius range of the apex spire cone, e.g. [0.35, 0.6]. */
  readonly spireRadiusM: readonly [number, number];
  /** Lateral width/expansion of bough needle clusters across branch length, e.g. [0.4, 0.8]. */
  readonly boughWidthM?: readonly [number, number];
}

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
    /** Distribution pattern: 'apical' forks at trunk top (oak/deciduous); 'tiered-whorls' distributes tiers along trunk height (pine/conifer). Defaults to 'apical'. */
    readonly distribution?: FloraBranchingDistribution;
    /** 2-3 keeps it abstract, per the "not a botany simulator" scope note. */
    readonly maxDepth: number;
    readonly childrenPerNode: readonly [number, number];
    readonly spreadAngleRad: readonly [number, number];
    readonly lengthFalloff01: number;
    /** Required when distribution === 'tiered-whorls'. */
    readonly tieredWhorls?: IFloraTieredWhorlsBranchingConfig;
  };
  readonly foliage: {
    readonly style: FloraFoliageStyle;
    /** For 'radial-fronds' and 'conifer-tiered', this sizes the foliage element bounds. */
    readonly sizeM: readonly [number, number];
    /** Required (and only meaningful) when style === 'radial-fronds'. */
    readonly radialFronds?: {
      readonly frondCount: number;
      readonly frondLengthM: readonly [number, number];
      readonly frondDroopRad: number;
    };
    /** Optional tuning when style === 'conifer-tiered'. */
    readonly coniferTiered?: IFloraConiferTieredFoliageConfig;
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

  if (archetype.branching.distribution === 'tiered-whorls') {
    const tieredWhorls = archetype.branching.tieredWhorls;
    if (!tieredWhorls) {
      throw new RangeError(
        "Flora archetype branching.tieredWhorls is required when distribution is 'tiered-whorls'.",
      );
    }
    validateProceduralFiniteRange(tieredWhorls.tierCount, 'Flora archetype branching tieredWhorls.tierCount');
    if (
      !Number.isInteger(tieredWhorls.tierCount[0]) ||
      !Number.isInteger(tieredWhorls.tierCount[1]) ||
      tieredWhorls.tierCount[0] < 1
    ) {
      throw new RangeError('Flora archetype branching tieredWhorls.tierCount must be positive integers.');
    }
    validateProcedural01(
      tieredWhorls.startHeightFraction01,
      'Flora archetype branching tieredWhorls.startHeightFraction01',
    );
    validateProceduralFiniteRange(
      tieredWhorls.branchesPerTier,
      'Flora archetype branching tieredWhorls.branchesPerTier',
    );
    if (
      !Number.isInteger(tieredWhorls.branchesPerTier[0]) ||
      !Number.isInteger(tieredWhorls.branchesPerTier[1]) ||
      tieredWhorls.branchesPerTier[0] < 1
    ) {
      throw new RangeError('Flora archetype branching tieredWhorls.branchesPerTier must be positive integers.');
    }
    validateProceduralFiniteRange(tieredWhorls.droopRad, 'Flora archetype branching tieredWhorls.droopRad');
    if (
      tieredWhorls.droopRad[0] < 0 ||
      tieredWhorls.droopRad[1] > Math.PI / 2
    ) {
      throw new RangeError('Flora archetype branching tieredWhorls.droopRad must be within [0, PI/2].');
    }
    validateProceduralFiniteRange(
      tieredWhorls.baseBranchLengthFraction,
      'Flora archetype branching tieredWhorls.baseBranchLengthFraction',
    );
    if (tieredWhorls.baseBranchLengthFraction[0] <= 0) {
      throw new RangeError('Flora archetype branching tieredWhorls.baseBranchLengthFraction must be positive.');
    }
  }

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

  if (archetype.foliage.style === 'conifer-tiered' && archetype.foliage.coniferTiered) {
    const coniferTiered = archetype.foliage.coniferTiered;
    validateProceduralFiniteRange(
      coniferTiered.spireHeightM,
      'Flora archetype foliage coniferTiered.spireHeightM',
    );
    validateProceduralFiniteRange(
      coniferTiered.spireRadiusM,
      'Flora archetype foliage coniferTiered.spireRadiusM',
    );
    if (coniferTiered.spireHeightM[0] <= 0 || coniferTiered.spireRadiusM[0] <= 0) {
      throw new RangeError('Flora archetype foliage coniferTiered spire dimensions must be positive.');
    }
    if (coniferTiered.boughWidthM) {
      validateProceduralFiniteRange(
        coniferTiered.boughWidthM,
        'Flora archetype foliage coniferTiered.boughWidthM',
      );
      if (coniferTiered.boughWidthM[0] <= 0) {
        throw new RangeError('Flora archetype foliage coniferTiered.boughWidthM must be positive.');
      }
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
