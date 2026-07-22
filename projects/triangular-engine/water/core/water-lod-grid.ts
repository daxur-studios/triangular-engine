export interface WaterLodGridOptions {
  /** World size of one level-0 patch instance. Must be positive. */
  readonly baseCellSize: number;
  /** Quads per patch edge; the same patch geometry is reused at every level. */
  readonly patchResolution: number;
  /** Patches per edge of the level-0 core block. Must be a positive multiple of 4. */
  readonly coreSizePatches: number;
  /** Ring levels beyond the core (level 0 = core, 1..ringCount are rings). */
  readonly ringCount: number;
}

export interface WaterLodInstance {
  readonly x: number;
  readonly z: number;
}

export interface WaterLodLevel {
  readonly level: number;
  /** World size of one patch instance at this level (also its morph-end cell size). */
  readonly patchWorldSize: number;
  /** World size of one grid cell within a patch at this level. */
  readonly cellSize: number;
  readonly instances: readonly WaterLodInstance[];
}

/**
 * Computes concentric-ring patch placements for a CDLOD-style water grid:
 * level 0 is a solid core block snapped to the camera; each level L>0 is a
 * hollow frame of patches twice the world size of level L-1, surrounding it.
 *
 * Each level snaps its own centre independently (round(camera / patchWorldSize)),
 * which is what lets a coarse outer level stay put while the camera wanders
 * inside one of its cells. That independence means two adjacent levels' snapped
 * centres can disagree by up to 0.75 * the coarser level's cell size (half the
 * fine level's snap step plus half the coarse level's snap step). The ring hole
 * is shrunk by one whole patch relative to the exact-nesting size so that bound
 * can never open a gap — worst case the levels overlap by about one patch width,
 * which is harmless here because both levels sample the same continuous
 * analytic surface (no baked heightfield to disagree with itself). See the
 * 2026-07-22 entry in docs/runbook/002_water_sublibrary.md for the derivation.
 */
export function computeWaterLodLevels(
  cameraX: number,
  cameraZ: number,
  options: WaterLodGridOptions,
): WaterLodLevel[] {
  const { baseCellSize, patchResolution, coreSizePatches, ringCount } =
    options;
  if (!(baseCellSize > 0)) {
    throw new Error('computeWaterLodLevels: baseCellSize must be positive.');
  }
  if (!(patchResolution >= 1)) {
    throw new Error('computeWaterLodLevels: patchResolution must be >= 1.');
  }
  if (coreSizePatches < 4 || coreSizePatches % 4 !== 0) {
    throw new Error(
      'computeWaterLodLevels: coreSizePatches must be a positive multiple of 4.',
    );
  }
  if (!Number.isInteger(ringCount) || ringCount < 0) {
    throw new Error(
      'computeWaterLodLevels: ringCount must be a non-negative integer.',
    );
  }

  const halfCountPatches = coreSizePatches / 2;
  const innerHalf = halfCountPatches / 2 - 1;
  const levels: WaterLodLevel[] = [];

  for (let level = 0; level <= ringCount; level++) {
    const patchWorldSize = baseCellSize * 2 ** level;
    const cellSize = patchWorldSize / patchResolution;
    const centerIndexX = Math.round(cameraX / patchWorldSize);
    const centerIndexZ = Math.round(cameraZ / patchWorldSize);
    const instances: WaterLodInstance[] = [];

    for (let ix = -halfCountPatches; ix < halfCountPatches; ix++) {
      const inXHole = level > 0 && ix >= -innerHalf && ix < innerHalf;
      for (let iz = -halfCountPatches; iz < halfCountPatches; iz++) {
        if (inXHole && iz >= -innerHalf && iz < innerHalf) {
          continue;
        }
        instances.push({
          x: (centerIndexX + ix + 0.5) * patchWorldSize,
          z: (centerIndexZ + iz + 0.5) * patchWorldSize,
        });
      }
    }

    levels.push({ level, patchWorldSize, cellSize, instances });
  }

  return levels;
}
