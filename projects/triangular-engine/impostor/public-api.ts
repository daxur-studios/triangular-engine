/** GPU-billboarded octahedral impostors: bake a grid of camera views into an atlas, then blend the 3 nearest at render time. */
export * from './core/octahedron-directions';
export * from './core/compute-object-bounding-sphere';
export * from './three/create-octahedral-impostor-atlas';
export * from './three/export-octahedral-impostor-atlas';
export * from './three/compress-octahedral-impostor-atlas';
export * from './three/octahedral-impostor-material';
export * from './three/octahedral-impostor-mesh';
