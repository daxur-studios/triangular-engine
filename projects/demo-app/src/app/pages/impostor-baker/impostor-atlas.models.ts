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
  // The reference implementation samples directions on an octahedral grid.
  // Use cell centers for baking, while runtime lookup uses the exact encoded
  // direction so interpolation remains continuous at cell boundaries.
  return octahedralDecode((column + 0.5) / columns, (row + 0.5) / rows);
}

export function atlasCellForDirection(
  direction: Vector3,
  columns: number,
  rows: number,
): { column: number; row: number } {
  const encoded = octahedralEncode(direction);
  return {
    column: Math.min(columns - 1, Math.max(0, Math.floor(encoded.x * columns))),
    row: Math.min(rows - 1, Math.max(0, Math.floor(encoded.y * rows))),
  };
}

export interface AtlasNeighbor {
  column: number;
  row: number;
  weight: number;
}

/** Returns the three octahedral-grid neighbors used for barycentric blending. */
export function atlasNeighborsForOctahedralDirection(
  direction: Vector3,
  columns: number,
  rows: number,
): AtlasNeighbor[] {
  const encoded = octahedralEncode(direction);
  const x = encoded.x * (columns - 1);
  const y = encoded.y * (rows - 1);
  const baseColumn = Math.min(columns - 1, Math.max(0, Math.floor(x)));
  const baseRow = Math.min(rows - 1, Math.max(0, Math.floor(y)));
  const fx = x - baseColumn;
  const fy = y - baseRow;
  const diagonal = fx >= fy;
  const neighbors = diagonal
    ? [[baseColumn, baseRow, 1 - fx], [baseColumn + 1, baseRow, fx - fy], [baseColumn + 1, baseRow + 1, fy]]
    : [[baseColumn, baseRow, 1 - fy], [baseColumn, baseRow + 1, fy - fx], [baseColumn + 1, baseRow + 1, fx]];
  return neighbors.map(([column, row, weight]) => ({
    column: Math.min(columns - 1, Math.max(0, column)),
    row: Math.min(rows - 1, Math.max(0, row)),
    weight: Math.max(0, weight),
  }));
}
