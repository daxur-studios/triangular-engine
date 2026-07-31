import { Vector3 } from 'three';

export interface ImpostorAtlasMetadata {
  version: 1;
  projection: 'octahedral';
  columns: number;
  rows: number;
  viewCount: number;
  frameSize: number;
  padding: number;
  rowOrigin: 'top';
  sourceBounds: { center: [number, number, number]; radius: number };
}

export function octahedralEncode(direction: Vector3): { x: number; y: number } {
  const d = direction.clone().normalize();
  const denominator = Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z);
  let x = d.x / denominator;
  let y = d.y / denominator;
  if (d.z < 0) {
    const oldX = x;
    x = (1 - Math.abs(y)) * Math.sign(oldX || 1);
    y = (1 - Math.abs(oldX)) * Math.sign(y || 1);
  }
  return { x: x * 0.5 + 0.5, y: y * 0.5 + 0.5 };
}

export function octahedralDecode(x: number, y: number): Vector3 {
  let nx = x * 2 - 1;
  let ny = y * 2 - 1;
  const nz = 1 - Math.abs(nx) - Math.abs(ny);
  if (nz < 0) {
    const oldX = nx;
    nx = (1 - Math.abs(ny)) * Math.sign(oldX || 1);
    ny = (1 - Math.abs(oldX)) * Math.sign(ny || 1);
  }
  return new Vector3(nx, ny, nz).normalize();
}

export function atlasDirection(column: number, row: number, columns: number, rows: number): Vector3 {
  return octahedralDecode((column + 0.5) / columns, 1 - (row + 0.5) / rows);
}
