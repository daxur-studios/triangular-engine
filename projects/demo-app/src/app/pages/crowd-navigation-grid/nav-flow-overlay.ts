import type { NavFlowField, NavGrid } from 'triangular-engine/crowd-navigation';

/** Cells between two flow arrows. */
export const FLOW_ARROW_SPACING = 5;

/**
 * Tints every sector that has a built field for `field` (so the lazily built area is visible) in an
 * RGBA buffer (`grid.width * grid.height * 4`) that already holds the base overlay.
 */
export function drawFlowSectors(field: NavFlowField, out: Uint8Array, width: number, height: number): void {
  const green = [60, 230, 140];
  for (const e of field.sectors) {
    if (!e) continue;
    const r = e.rect;
    for (let y = r.y; y < Math.min(height, r.y + r.height); y++) {
      for (let x = r.x; x < Math.min(width, r.x + r.width); x++) {
        const o = (y * width + x) * 4;
        out[o] = out[o] * 0.78 + green[0] * 0.22;
        out[o + 1] = out[o + 1] * 0.78 + green[1] * 0.22;
        out[o + 2] = out[o + 2] * 0.78 + green[2] * 0.22;
      }
    }
  }
}

/**
 * Line-segment vertices (x, y, z triples, three segments per arrow: shaft and two head strokes) for
 * a decimated set of flow arrows, one per `FLOW_ARROW_SPACING` cells, only in built sectors and only
 * on cells that have a direction. World X/Z follow the terrain mesh (`(cell - size / 2) * cellSize`);
 * Y is the cell height plus a lift so the lines sit above the terrain.
 */
export function buildFlowArrowVertices(field: NavFlowField, grid: NavGrid): Float32Array {
  const n = grid.width;
  const cs = grid.cellSize;
  const out: number[] = [];
  const dir = { x: 0, y: 0 };
  const half = (FLOW_ARROW_SPACING * 0.42) * cs;
  const head = half * 0.45;
  const offset = FLOW_ARROW_SPACING >> 1;
  for (const e of field.sectors) {
    if (!e) continue;
    const r = e.rect;
    for (let y = r.y + offset - (r.y % FLOW_ARROW_SPACING); y < r.y + r.height; y += FLOW_ARROW_SPACING) {
      for (let x = r.x + offset - (r.x % FLOW_ARROW_SPACING); x < r.x + r.width; x += FLOW_ARROW_SPACING) {
        if (x < r.x || y < r.y || !field.directionAtCell(x, y, dir)) continue;
        const wy = Math.max(grid.heights[y * n + x], 0) + 0.9;
        const cx = (x - n / 2) * cs;
        const cz = (y - n / 2) * cs;
        const tx = cx + dir.x * half;
        const tz = cz + dir.y * half;
        const bx = cx - dir.x * half;
        const bz = cz - dir.y * half;
        out.push(bx, wy, bz, tx, wy, tz);
        // Head strokes: the shaft direction rotated by +-150 degrees.
        const c = -0.866;
        const s = 0.5;
        out.push(tx, wy, tz, tx + (dir.x * c - dir.y * s) * head, wy, tz + (dir.x * s + dir.y * c) * head);
        out.push(tx, wy, tz, tx + (dir.x * c + dir.y * s) * head, wy, tz + (-dir.x * s + dir.y * c) * head);
      }
    }
  }
  return Float32Array.from(out);
}
