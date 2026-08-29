import { BufferGeometry, IcosahedronGeometry, type BufferAttribute } from 'three';

import {
  sampleCloudPuffDisplacement,
  type ICloudPuffVariantParams,
} from '../core/cloud-puff-shape';

export type CloudPuffShading = 'flat' | 'smooth';

/**
 * Builds one "puff" geometry: a smooth icosphere displaced radially by cloud noise so its
 * low-poly facets read as a cloud silhouette instead of a sphere. `shading: 'flat'` converts to
 * non-indexed geometry before `computeVertexNormals()` — each triangle gets its own three
 * vertices and therefore its own face normal, which is the mechanism that keeps edges crisp
 * without alpha-testing or fragment-shader derivatives. `shading: 'smooth'` keeps shared
 * (indexed) vertices so normals blend across faces instead, for comparison.
 */
export function buildCloudPuffGeometry(
  params: ICloudPuffVariantParams,
  detail = 1,
  shading: CloudPuffShading = 'flat',
): BufferGeometry {
  const base = new IcosahedronGeometry(1, detail);
  const geometry = shading === 'flat' ? base.toNonIndexed() : base;
  const position = geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const length = Math.hypot(x, y, z) || 1;
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const radius = 1 + sampleCloudPuffDisplacement(nx, ny, nz, params);
    position.setXYZ(i, nx * radius, ny * radius, nz * radius);
  }
  position.needsUpdate = true;
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildCloudPuffGeometryVariants(
  variantParams: readonly ICloudPuffVariantParams[],
  detail = 1,
  shading: CloudPuffShading = 'flat',
): BufferGeometry[] {
  return variantParams.map((params) => buildCloudPuffGeometry(params, detail, shading));
}
