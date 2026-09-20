/**
 * Dual-space vertex attribute contract shared by cell-planet morph streaming: a mesh generator
 * (CPU or worker) emits both a sphere and a flat-map position/normal per vertex, and the GPU
 * material mixes between them by `uMorph`. Everything downstream (the material patch, the
 * morph-aware raycaster) must agree on these attribute names, so they are declared once here
 * instead of duplicated as string literals per consumer - see runbook 039's "dual-space
 * attribute contract" gap.
 */
export const CELL_PLANET_MORPH_ATTRIBUTES = {
  spherePosition: 'aSpherePos',
  flatPosition: 'aFlatPos',
  sphereNormal: 'aSphereNorm',
  flatNormal: 'aFlatNorm',
} as const;
