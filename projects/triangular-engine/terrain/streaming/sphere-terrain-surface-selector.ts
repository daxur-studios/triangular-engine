import type { TerrainSurfacePatchSelector } from './terrain-surface-patch-selector';
import { selectSphereTerrainQuadtreePatches } from './sphere-terrain-quadtree-selection';
import type { ISphereTerrainPatchAddress } from '../domains/sphere-terrain-domain';

export interface ISphereTerrainSurfaceSelectorOptions {
  readonly radiusM: number;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly patchResolution: number;
  readonly splitErrorPx: number;
  readonly mergeErrorPx: number;
  readonly screenSpaceErrorFactorPx: number;
}

export interface ISphereTerrainSurfaceSelector {
  readonly select: TerrainSurfacePatchSelector<ISphereTerrainPatchAddress>;
  readonly reset: () => void;
}

/**
 * Creates a stateful BSP-compatible sphere selector for TerrainSurface.
 * Hysteresis state is kept here so Angular hosts do not need terrain policy
 * state of their own; call reset when the body or field changes.
 */
export function createSphereTerrainSurfaceSelector(
  options: ISphereTerrainSurfaceSelectorOptions,
): ISphereTerrainSurfaceSelector {
  let previousLeaves: readonly ISphereTerrainPatchAddress[] = [];

  return {
    select: (request) => {
      const leaves = selectSphereTerrainQuadtreePatches({
        radiusM: options.radiusM,
        minElevationM: options.minElevationM,
        maxElevationM: options.maxElevationM,
        cameraWorldM: request.cameraWorldM,
        options: {
          maxLevel: request.maxLevel,
          patchResolution: options.patchResolution,
          splitErrorPx: options.splitErrorPx,
          mergeErrorPx: options.mergeErrorPx,
          screenSpaceErrorFactorPx: options.screenSpaceErrorFactorPx,
        },
        previousLeaves,
      });
      previousLeaves = leaves;
      return leaves;
    },
    reset: () => {
      previousLeaves = [];
    },
  };
}
