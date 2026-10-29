/**
 * Framework-free core of the LOD surface (Plan 059): the domains (a bounded plane and a cube-sphere), the CPU quadtree
 * selector, the one-draw-call instanced surface mesh, and the height sources (analytic, baked textures, detail noise).
 * It has no Angular code, so an app's worker bundle can import it (the bake worker does); the components are in
 * `triangular-engine/lod-surface`. WebGPU only: the mesh is built from TSL nodes.
 */
export * from './lod-domain';
export * from './lod-view';
export * from './lod-lattice';
export * from './lod-selector';
export * from './lod-leaf-pack';
export * from './lod-height';
export * from './lod-canyon';
export * from './lod-height-bake';
export * from './lod-height-noise';
export * from './lod-height-terrain';
export * from './lod-height-bake-client';
export * from './lod-height-texture';
export * from './lod-cell-planet-heights';
export * from './lod-detail-noise';
export * from './lod-surface-mesh';
export * from './lod-terrain-body';
