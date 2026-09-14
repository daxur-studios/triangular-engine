import { Color } from 'three';
import { EngineService } from 'triangular-engine';
import {
  createClipmapTerrainScene,
  type IClipmapTerrainDiagnostics,
  type IClipmapTerrainSceneHandle,
} from 'triangular-engine/terrain';

/**
 * Far-coverage configuration: same near-field tile size/radius/grid detail as
 * the passed gpu-morph-lod-spike (BASE_TILE_SIZE_M=16, BLOCK_RADIUS_TILES=4,
 * GRID_RESOLUTION=32 — so levels 0-5 are pixel-for-pixel identical to that
 * spike's own tiles), extended with many more outward LOD rings. Levels past
 * 5 (stride would exceed GRID_RESOLUTION) automatically clamp to a single
 * quad per tile in clipmap-grid-geometry.ts — appropriate since those tiles
 * are already tens of kilometres across by the time a level gets there.
 */
const FAR_COVERAGE_LEVEL_COUNT = 12;
const FAR_COVERAGE_BASE_TILE_SIZE_M = 16;
const FAR_COVERAGE_BLOCK_RADIUS_TILES = 4;
const FAR_COVERAGE_GRID_RESOLUTION = 32;
const FAR_COVERAGE_FINEST_SWITCH_DISTANCE_M =
  FAR_COVERAGE_BASE_TILE_SIZE_M * FAR_COVERAGE_BLOCK_RADIUS_TILES;

/** Outer edge of the coarsest (outermost) LOD ring, in metres from camera. */
export const FAR_COVERAGE_OUTER_RADIUS_M =
  FAR_COVERAGE_BASE_TILE_SIZE_M *
  2 ** (FAR_COVERAGE_LEVEL_COUNT - 1) *
  FAR_COVERAGE_BLOCK_RADIUS_TILES;

export {
  FAR_COVERAGE_LEVEL_COUNT,
  FAR_COVERAGE_BASE_TILE_SIZE_M,
  FAR_COVERAGE_BLOCK_RADIUS_TILES,
  FAR_COVERAGE_GRID_RESOLUTION,
  FAR_COVERAGE_FINEST_SWITCH_DISTANCE_M,
};

export type IClipmapFarCoverageSpikeDiagnostics = IClipmapTerrainDiagnostics;
export type IClipmapFarCoverageSpikeSceneHandle = IClipmapTerrainSceneHandle;

/**
 * Extends the passed near-boundary clipmap spike outward: same shared
 * mechanism (`triangular-engine/terrain`'s `createClipmapTerrainScene`), just
 * configured with many more LOD levels so the outermost ring reaches
 * `FAR_COVERAGE_OUTER_RADIUS_M` (~131km) from the camera instead of stopping
 * at the near-boundary spike's 512m. Kill condition: draw calls must stay
 * bounded at exactly `FAR_COVERAGE_LEVEL_COUNT` (one InstancedMesh per level)
 * regardless of how far out the rings reach, and outer-ring detail must not
 * be so coarse it visibly pops — judge the latter with the wireframe/level
 * tint toggles and the camera-distance readout in the component.
 */
export function createClipmapFarCoverageSpikeScene(
  engine: EngineService,
  onDiagnostics: (diagnostics: IClipmapFarCoverageSpikeDiagnostics) => void,
): IClipmapFarCoverageSpikeSceneHandle {
  engine.scene.background = new Color('#12181f');
  return createClipmapTerrainScene(engine, onDiagnostics, {
    levelCount: FAR_COVERAGE_LEVEL_COUNT,
    baseTileSizeM: FAR_COVERAGE_BASE_TILE_SIZE_M,
    blockRadiusTiles: FAR_COVERAGE_BLOCK_RADIUS_TILES,
    gridResolution: FAR_COVERAGE_GRID_RESOLUTION,
  });
}
