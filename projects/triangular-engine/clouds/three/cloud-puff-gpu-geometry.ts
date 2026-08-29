import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Creates a GPU buffer geometry for clumped wind-advected cloud puffs.
 * Each particle has `clumpSize` vertices (members) that share the same leader trajectory
 * with procedural time lag and spatial jitter.
 */
export function createCloudPuffClumpGeometry(
  particleCount: number,
  clumpSize: number = 4,
): BufferGeometry {
  const totalVertices = particleCount * clumpSize;
  const particleIds = new Float32Array(totalVertices);
  const clumpIndices = new Float32Array(totalVertices);
  const positions = new Float32Array(totalVertices * 3); // Initial dummy positions

  let idx = 0;
  for (let p = 0; p < particleCount; p++) {
    for (let c = 0; c < clumpSize; c++) {
      particleIds[idx] = p;
      clumpIndices[idx] = c;
      idx++;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aParticleId', new BufferAttribute(particleIds, 1));
  geometry.setAttribute('aClumpIndex', new BufferAttribute(clumpIndices, 1));

  return geometry;
}
