import { BLOCK_CELLS, BLOCK_SAMPLES, type DensityBlockSpec, type Vec3 } from './block-grid';
import { fillDensityBlockCpu } from './cpu-density-block';
import type { TerrainEdit } from '../planet-shape-field';
import { createTerrainFieldCpu } from '../planet-shape-field-cpu';
import { generateNoiseBytes } from '../planet-shape-noise';

/** Shared by the specs and the bench page: the check body and block size, and where blocks sit. */
export const RADIUS_M = 20_000;
export const VOXEL_M = 2;

/** A block spanning the ground in a direction of the wild canyon biome, so it has overhang-capable rock. */
export function surfaceBlock(direction: Vec3, edits: TerrainEdit[] = []): DensityBlockSpec {
  const field = createTerrainFieldCpu(RADIUS_M, undefined, []);
  field.biomeOverride = 0;
  field.groundedOverride = 0;
  const length = Math.hypot(...direction);
  const height = field.groundHeightAt(direction);
  const r = RADIUS_M + height;
  const centre: Vec3 = [(direction[0] / length) * r, (direction[1] / length) * r, (direction[2] / length) * r];
  const half = (BLOCK_CELLS * VOXEL_M) / 2;
  return {
    radiusM: RADIUS_M, voxelM: VOXEL_M, origin: [centre[0] - half, centre[1] - half, centre[2] - half], edits, biomeOverride: 0, groundedOverride: 0,
  };
}

export const DIRECTIONS: Vec3[] = [[0.3, 0.2, 0.93], [-0.5, 0.7, 0.51], [0.9, 0.1, 0.42], [0.1, -0.95, 0.29]];

export function cpuGrid(spec: DensityBlockSpec): Float32Array {
  return fillDensityBlockCpu(createTerrainFieldCpu(spec.radiusM, generateNoiseBytes(), []), spec, new Float32Array(BLOCK_SAMPLES));
}

export function crossesSurface(grid: Float32Array): boolean {
  return grid.some((d) => d < 0) && grid.some((d) => d >= 0);
}


/** Cost differs by rock mode: wild reads one density, grounded another, the mask blend can need both. */
export const MODES: { name: string; biomeOverride?: number; groundedOverride?: number }[] = [
  { name: 'wild canyons', biomeOverride: 0, groundedOverride: 0 },
  { name: 'grounded hills', biomeOverride: 1, groundedOverride: 1 },
  { name: 'biome mask blend', biomeOverride: undefined, groundedOverride: undefined },
];

