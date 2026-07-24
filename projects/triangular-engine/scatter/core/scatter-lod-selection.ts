import type { ScatterLodDefinition } from './scatter-species-definition';

export interface IScatterLodSelectionOptions {
  /** Tier chosen last frame, so a boundary crossing can be resisted instead of flickering. */
  readonly previousTierIndex?: number;
  /** Total width of the hysteresis band straddling a boundary; half applies on each side. */
  readonly hysteresisM?: number;
  /** Distance before a tier's maxDistanceM over which blend01 ramps 0 → 1, for a dithered cross-fade. */
  readonly ditherBandM?: number;
}

export interface IScatterLodSelectionResult {
  /** -1 means beyond every tier's maxDistanceM — cull the instance entirely. */
  readonly tierIndex: number;
  readonly lod: ScatterLodDefinition | undefined;
  /** 0 = fully this tier; ramps toward 1 as the instance nears the boundary into the next tier. */
  readonly blend01: number;
}

/**
 * Picks the active LOD tier for a distance, from `lods` sorted nearest-first by maxDistanceM.
 * Hysteresis resists flicker at a boundary; dither blend feeds a shader cross-fade instead of a hard cut.
 */
export function selectScatterLodTier(
  distanceM: number,
  lods: readonly ScatterLodDefinition[],
  options: IScatterLodSelectionOptions = {},
): IScatterLodSelectionResult {
  if (lods.length === 0) {
    return { tierIndex: -1, lod: undefined, blend01: 0 };
  }

  const hysteresisM = options.hysteresisM ?? 0;
  const ditherBandM = options.ditherBandM ?? 0;
  const previousTierIndex = options.previousTierIndex;

  let tierIndex = lods.findIndex((lod) => distanceM <= lod.maxDistanceM);

  if (
    hysteresisM > 0 &&
    previousTierIndex !== undefined &&
    previousTierIndex >= 0 &&
    previousTierIndex < lods.length &&
    Math.abs(tierIndex - previousTierIndex) === 1
  ) {
    const half = hysteresisM / 2;
    if (tierIndex > previousTierIndex) {
      const boundary = lods[previousTierIndex].maxDistanceM;
      if (distanceM < boundary + half) tierIndex = previousTierIndex;
    } else {
      const boundary = lods[tierIndex].maxDistanceM;
      if (distanceM > boundary - half) tierIndex = previousTierIndex;
    }
  }

  const lod = tierIndex >= 0 ? lods[tierIndex] : undefined;

  let blend01 = 0;
  if (ditherBandM > 0 && lod) {
    const distanceToBoundaryM = lod.maxDistanceM - distanceM;
    if (distanceToBoundaryM >= 0 && distanceToBoundaryM < ditherBandM) {
      blend01 = 1 - distanceToBoundaryM / ditherBandM;
    }
  }

  return { tierIndex, lod, blend01 };
}
