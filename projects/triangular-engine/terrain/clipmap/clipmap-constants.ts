/**
 * Shared-vertex-buffer + GPU vertex-shader height/morph clipmap terrain —
 * a per-vertex distance-based blend between a vertex's own LOD and LOD+1
 * sampled height, in the spirit of CDLOD-style continuous LOD morphing.
 *
 * Scope: this module proves out the *rendering* mechanism only (shared
 * geometry, index-buffer LOD, per-vertex world-space morph, bounded draw
 * calls, crack-free boundaries, no CPU remesh on LOD change). Deliberately
 * NOT in scope here: heightmap texture streaming/atlasing, physics
 * colliders, or a real planet projection — height comes from an analytic
 * GLSL function standing in for `sampleElevation()`/`height(dir)`. Consumers
 * needing real heightmap sampling should treat `clipmap-terrain-material.ts`
 * as the seam to extend.
 *
 * Promoted from demo-app's gpu-morph-lod-spike (passed — see
 * docs/runbook/028_planet_terrain_attempt_history.md) so both that spike and
 * production/POC code share one implementation instead of diverging copies.
 */

/** World-space size of one level-0 (finest) tile, in metres. */
export const BASE_TILE_SIZE_M = 16;

/** Discrete LOD levels: 0 = finest tiles nearest the camera. */
export const LEVEL_COUNT = 4;

/** Tiles are laid out in a (2*radius)^2 block per level, centred on the camera. */
export const BLOCK_RADIUS_TILES = 4;

/**
 * Quads per shared tile edge, for the finest (level 0) LOD. Must be a power
 * of two — levels whose stride (2^level) would exceed this clamp to a single
 * quad per tile instead of requiring this to grow with LEVEL_COUNT (see
 * clipmap-grid-geometry.ts).
 */
export const GRID_RESOLUTION = 32;

/**
 * Distance at which the continuous LOD formula reaches level 0→1.
 * Chosen so each level's clipmap ring radius (BASE_TILE_SIZE_M * 2^L *
 * BLOCK_RADIUS_TILES) lines up with where the shader would morph to the next
 * level anyway — keeps the discrete instancing bucket and the continuous
 * per-vertex morph visually consistent (not required for crack-freeness,
 * which holds regardless — see clipmap-terrain-scene.ts).
 */
export const FINEST_SWITCH_DISTANCE_M = BASE_TILE_SIZE_M * BLOCK_RADIUS_TILES;

export const MAX_INSTANCES_PER_LEVEL = (2 * BLOCK_RADIUS_TILES) ** 2;

export const TERRAIN_HEIGHT_SCALE_M = 1;
