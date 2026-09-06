import { BufferAttribute, BufferGeometry, Sphere } from 'three';

/**
 * One shared vertex buffer for every LOD level — reused as-is, only the index
 * buffer changes per level. Positions are in local unit space [-0.5, 0.5] on
 * X/Z; Y is overwritten in the vertex shader.
 */
export interface ISharedGridBuffers {
  readonly positionAttribute: BufferAttribute;
  /** One index BufferGeometry per LOD level (0 = finest), sharing `positionAttribute`. */
  readonly levelGeometries: readonly BufferGeometry[];
}

/**
 * Builds the shared position buffer plus one index-only geometry per LOD
 * level, each level striding by 2^level over the same high-res vertex grid.
 */
export function buildSharedGridBuffers(
  resolution: number,
  levelCount: number,
): ISharedGridBuffers {
  const vertsPerEdge = resolution + 1;
  const positions = new Float32Array(vertsPerEdge * vertsPerEdge * 3);
  for (let row = 0; row < vertsPerEdge; row++) {
    for (let col = 0; col < vertsPerEdge; col++) {
      const i = (row * vertsPerEdge + col) * 3;
      positions[i] = col / resolution - 0.5;
      positions[i + 1] = 0;
      positions[i + 2] = row / resolution - 0.5;
    }
  }
  const positionAttribute = new BufferAttribute(positions, 3);

  const levelGeometries: BufferGeometry[] = [];
  for (let level = 0; level < levelCount; level++) {
    const stride = 2 ** level;
    if (resolution % stride !== 0) {
      throw new Error(
        `GRID_RESOLUTION (${resolution}) must be divisible by 2^level (level ${level} => stride ${stride}).`,
      );
    }
    const quadsPerEdge = resolution / stride;
    const cellsPerEdge = quadsPerEdge;
    const indices = new Uint32Array(cellsPerEdge * cellsPerEdge * 6);
    let o = 0;
    for (let cellRow = 0; cellRow < cellsPerEdge; cellRow++) {
      for (let cellCol = 0; cellCol < cellsPerEdge; cellCol++) {
        const row0 = cellRow * stride;
        const col0 = cellCol * stride;
        const row1 = row0 + stride;
        const col1 = col0 + stride;
        const a = row0 * vertsPerEdge + col0;
        const b = row0 * vertsPerEdge + col1;
        const c = row1 * vertsPerEdge + col0;
        const d = row1 * vertsPerEdge + col1;
        indices[o++] = a;
        indices[o++] = c;
        indices[o++] = b;
        indices[o++] = b;
        indices[o++] = c;
        indices[o++] = d;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', positionAttribute);
    geometry.setIndex(new BufferAttribute(indices, 1));
    // Instances place this shared unit grid anywhere in a huge world-space
    // clipmap; three's auto-computed bounding sphere (from local unit-space
    // positions only) would cull the whole thing at a glance. CS-015 traced
    // exactly this mistake in the BatchedMesh attempt. Disabling frustum
    // culling is the deliberate spike-scope stand-in for real per-instance
    // culling (out of scope here — see constants.ts doc comment).
    geometry.boundingSphere = new Sphere(undefined, Infinity);
    levelGeometries.push(geometry);
  }

  return { positionAttribute, levelGeometries };
}
