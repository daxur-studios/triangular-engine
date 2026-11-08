import type { NavAbstractPath, NavGrid, NavSectorGraph, NavUnitClass } from 'triangular-engine/crowd-navigation';

/** What to draw on top of the base overlay. */
export interface SectorOverlayOptions {
  readonly unitClass: NavUnitClass;
  /** Draw sector borders and the portals of `unitClass`. */
  readonly showSectors: boolean;
  /** The abstract path to highlight (corridor sectors, crossed portals, endpoints), if any. */
  readonly path?: NavAbstractPath;
  readonly start?: { readonly x: number; readonly y: number };
  readonly goal?: { readonly x: number; readonly y: number };
}

/** Marker colour of each unit class' portals. */
export const NAV_CLASS_COLORS: Readonly<Record<NavUnitClass, readonly [number, number, number]>> = {
  villager: [255, 90, 80],
  catapult: [255, 200, 40],
  creature: [60, 230, 120],
};

function blend(out: Uint8Array, x: number, y: number, width: number, height: number, c: readonly number[], a: number): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const o = (y * width + x) * 4;
  out[o] = out[o] * (1 - a) + c[0] * a;
  out[o + 1] = out[o + 1] * (1 - a) + c[1] * a;
  out[o + 2] = out[o + 2] * (1 - a) + c[2] * a;
}

function square(
  out: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number,
  c: readonly number[],
  a = 1,
): void {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) blend(out, x, y, width, height, c, a);
}

/**
 * Draws the sector overlay into an RGBA buffer (`grid.width * grid.height * 4`) that already holds
 * the base overlay: corridor sectors tinted, sector borders as 1-cell lines, a marker on every
 * portal of the class (the transition cell pair), larger white markers on the crossed portals, and
 * start / goal squares.
 */
export function drawSectorOverlay(
  graph: NavSectorGraph,
  grid: NavGrid,
  out: Uint8Array,
  options: SectorOverlayOptions,
): void {
  const { width, height } = grid;
  const S = graph.sectorSize;
  const path = options.path;
  if (path?.found) {
    for (const s of path.sectors) {
      const r = graph.sectorRect(s);
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) blend(out, x, y, width, height, [255, 150, 30], 0.5);
      }
    }
  }
  if (options.showSectors) {
    for (let x = S; x < width; x += S) for (let y = 0; y < height; y++) blend(out, x, y, width, height, [255, 255, 255], 0.75);
    for (let y = S; y < height; y += S) for (let x = 0; x < width; x++) blend(out, x, y, width, height, [255, 255, 255], 0.75);
    const color = NAV_CLASS_COLORS[options.unitClass];
    for (const p of graph.getPortals(options.unitClass)) {
      square(out, width, height, p.ax, p.ay, 1, color);
      square(out, width, height, p.bx, p.by, 1, color);
    }
  }
  if (path?.found) {
    for (const p of path.portals) {
      square(out, width, height, p.ax, p.ay, 3, [255, 255, 255]);
      square(out, width, height, p.ax, p.ay, 2, NAV_CLASS_COLORS[options.unitClass]);
      square(out, width, height, p.bx, p.by, 3, [255, 255, 255]);
      square(out, width, height, p.bx, p.by, 2, NAV_CLASS_COLORS[options.unitClass]);
    }
  }
  if (options.start) square(out, width, height, options.start.x, options.start.y, 4, [40, 120, 255]);
  if (options.goal) square(out, width, height, options.goal.x, options.goal.y, 4, [255, 60, 220]);
}
