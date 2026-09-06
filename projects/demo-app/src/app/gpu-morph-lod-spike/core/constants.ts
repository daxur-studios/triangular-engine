/**
 * Attempt #5 spike: shared-vertex-buffer + GPU vertex-shader height/morph LOD —
 * a per-vertex distance-based blend between a vertex's own LOD and LOD+1
 * sampled height, in the spirit of CDLOD-style continuous LOD morphing.
 *
 * Scope: proves the *rendering* mechanism only (shared geometry, index-buffer
 * LOD, per-vertex world-space morph, bounded draw calls, crack-free
 * boundaries, no CPU remesh on LOD change). Deliberately NOT in scope:
 * heightmap texture streaming/atlasing, physics colliders, a real planet
 * projection, or a full quadtree — height comes from an analytic GLSL
 * function standing in for `sampleElevation()`/`height(dir)`.
 */

/** World-space size of one level-0 (finest) tile, in metres. */
export const BASE_TILE_SIZE_M = 16;

/** Discrete LOD levels: 0 = finest tiles nearest the camera. */
export const LEVEL_COUNT = 4;

/** Tiles are laid out in a (2*radius)^2 block per level, centred on the camera. */
export const BLOCK_RADIUS_TILES = 4;

/** Quads per shared tile edge. Must be divisible by 2^(LEVEL_COUNT - 1). */
export const GRID_RESOLUTION = 32;

/**
 * Distance at which the continuous LOD formula reaches level 0→1.
 * Chosen so each level's clipmap ring radius (BASE_TILE_SIZE_M * 2^L *
 * BLOCK_RADIUS_TILES) lines up with where the shader would morph to the next
 * level anyway — keeps the discrete instancing bucket and the continuous
 * per-vertex morph visually consistent (not required for crack-freeness,
 * which holds regardless — see gpu-morph-lod-scene.ts).
 */
export const FINEST_SWITCH_DISTANCE_M = BASE_TILE_SIZE_M * BLOCK_RADIUS_TILES;

export const MAX_INSTANCES_PER_LEVEL = (2 * BLOCK_RADIUS_TILES) ** 2;

export const TERRAIN_HEIGHT_SCALE_M = 1;
