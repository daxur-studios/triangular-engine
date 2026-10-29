/**
 * Level-of-detail terrain for games (Plan 059): `<planetTerrain>` for a sphere and `<flatTerrain>` for a bounded plane,
 * drawn in one instanced draw call from a CPU quadtree selected every frame from the active camera. WebGPU only.
 *
 * The framework-free pieces (domains, selector, mesh, height sources and baking) are in
 * `triangular-engine/lod-surface/core`, which a worker file must import instead of this entry.
 */
export * from './components/planet-terrain.component';
export * from './components/flat-terrain.component';
export * from './terrain-planet-material';
