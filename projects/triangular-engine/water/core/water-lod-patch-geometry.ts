import { BufferGeometry, PlaneGeometry } from 'three';

/** Shared unit-square patch geometry, reused across every WaterLodLevel via instancing. */
export function createWaterLodPatchGeometry(resolution: number): BufferGeometry {
  const geometry = new PlaneGeometry(1, 1, resolution, resolution);
  geometry.rotateX(-Math.PI * 0.5);
  return geometry;
}
