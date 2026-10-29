import { CapsuleGeometry } from 'three';

// Broaden the front dome and blend it into the torso, preserving one surface.
const HEAD_SCALE = 1.17;

export function catHeadScale(z: number, radius: number, length: number): number {
  const t = Math.max(0, Math.min(1, (z - (length * 0.5 - radius * 0.75)) / (radius * 0.75)));
  return 1 + (HEAD_SCALE - 1) * t * t * (3 - 2 * t);
}

export function createCatBodyGeometry(radius: number, length: number): CapsuleGeometry {
  const geometry = new CapsuleGeometry(radius, length, 32, 48);
  geometry.rotateX(Math.PI * 0.5);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const scale = catHeadScale(positions.getZ(i), radius, length);
    positions.setXY(i, positions.getX(i) * scale, positions.getY(i) * scale);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
