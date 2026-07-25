import { BufferGeometry, Float32BufferAttribute } from 'three';

export interface IScatterBillboardGeometryOptions {
  readonly widthM: number;
  readonly heightM: number;
}

/**
 * Upright quad centered on x, base at local y=0, top at local y=heightM —
 * meant to be paired with `enableScatterCylindricalBillboard`, which
 * re-orients each instance to face the camera at render time. The base
 * sitting at y=0 (rather than a geometry centered on its own origin) keeps
 * the quad rooted at the instance's surface position instead of floating
 * half-buried/half-airborne.
 */
export function buildScatterBillboardGeometry(
  options: IScatterBillboardGeometryOptions,
): BufferGeometry {
  const halfWidthM = options.widthM / 2;
  const geometry = new BufferGeometry();
  const positions = new Float32Array([
    -halfWidthM, 0, 0,
    halfWidthM, 0, 0,
    halfWidthM, options.heightM, 0,
    -halfWidthM, options.heightM, 0,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}
