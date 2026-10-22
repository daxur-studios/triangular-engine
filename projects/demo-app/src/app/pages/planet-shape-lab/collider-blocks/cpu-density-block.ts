import { BLOCK_CORNERS, BLOCK_SAMPLES, type DensityBlockSpec } from './block-grid';
import type { TerrainFieldCpu } from '../planet-shape-field-cpu';

/**
 * The reference sampler: one block from the CPU twin, one `density` call per corner, in doubles. `field` carries the
 * body (radius, noise bytes); the spec's edits and overrides are applied to it here and restored afterwards.
 */
export function fillDensityBlockCpu(field: TerrainFieldCpu, spec: DensityBlockSpec, out: Float32Array): Float32Array {
  if (out.length < BLOCK_SAMPLES) throw new RangeError(`output has ${out.length} samples, ${BLOCK_SAMPLES} needed`);
  const edits = field.edits;
  const grounded = field.groundedOverride;
  const biome = field.biomeOverride;
  field.setEdits(spec.edits ?? []);
  field.groundedOverride = spec.groundedOverride;
  field.biomeOverride = spec.biomeOverride;
  try {
    const [ox, oy, oz] = spec.origin;
    const v = spec.voxelM;
    let at = 0;
    for (let k = 0; k < BLOCK_CORNERS; k++) {
      for (let j = 0; j < BLOCK_CORNERS; j++) {
        for (let i = 0; i < BLOCK_CORNERS; i++) out[at++] = field.density([ox + i * v, oy + j * v, oz + k * v]);
      }
    }
  } finally {
    field.setEdits(edits);
    field.groundedOverride = grounded;
    field.biomeOverride = biome;
  }
  return out;
}
