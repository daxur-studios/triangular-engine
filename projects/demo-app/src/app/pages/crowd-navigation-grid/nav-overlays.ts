import {
  NAV_CLEARANCE_THRESHOLDS,
  NavFlag,
  type NavGrid,
} from 'triangular-engine/crowd-navigation';

/** Overlay ids the demo can draw. */
export type NavOverlayId =
  | 'terrain'
  | 'slope'
  | 'structure'
  | 'road'
  | 'cost'
  | 'clearance'
  | 'flags';

/** One legend swatch. */
export interface NavLegendEntry {
  readonly label: string;
  readonly color: string;
}

/** An overlay: label, legend and the colour function for one cell. */
export interface NavOverlay {
  readonly id: NavOverlayId;
  readonly label: string;
  readonly legend: readonly NavLegendEntry[];
}

type Rgb = readonly [number, number, number];

const WATER: Rgb = [24, 62, 110];
const BLOCKED: Rgb = [20, 14, 18];

const hex = (c: Rgb) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

export const NAV_OVERLAYS: readonly NavOverlay[] = [
  {
    id: 'terrain',
    label: 'Terrain',
    legend: [
      { label: 'water', color: hex(WATER) },
      { label: 'low', color: hex([196, 186, 120]) },
      { label: 'high', color: hex([120, 130, 100]) },
    ],
  },
  {
    id: 'slope',
    label: 'Slope cost',
    legend: [
      { label: 'flat (16)', color: hex([60, 190, 90]) },
      { label: 'steep (254)', color: hex([220, 60, 50]) },
      { label: 'blocked (255)', color: hex(BLOCKED) },
      { label: 'water', color: hex(WATER) },
    ],
  },
  {
    id: 'structure',
    label: 'Structure',
    legend: [
      { label: 'solid', color: hex([220, 110, 40]) },
      { label: 'closed gate', color: hex([230, 60, 200]) },
      { label: 'open gate', color: hex([120, 230, 120]) },
      { label: 'free', color: hex([70, 80, 70]) },
    ],
  },
  {
    id: 'road',
    label: 'Road',
    legend: [
      { label: 'road (x0.4)', color: hex([240, 200, 90]) },
      { label: 'no road', color: hex([70, 80, 70]) },
    ],
  },
  {
    id: 'cost',
    label: 'Composed cost',
    legend: [
      { label: 'cheap', color: hex([40, 200, 220]) },
      { label: 'dear', color: hex([240, 200, 40]) },
      { label: 'impassable (255)', color: hex(BLOCKED) },
    ],
  },
  {
    id: 'clearance',
    label: 'Clearance',
    legend: [
      { label: 'blocked', color: hex(BLOCKED) },
      { label: `villager only (1-${NAV_CLEARANCE_THRESHOLDS.catapult - 1})`, color: hex([230, 80, 70]) },
      {
        label: `catapult (${NAV_CLEARANCE_THRESHOLDS.catapult}-${NAV_CLEARANCE_THRESHOLDS.creature - 1})`,
        color: hex([240, 190, 60]),
      },
      { label: `creature (${NAV_CLEARANCE_THRESHOLDS.creature}+)`, color: hex([70, 200, 110]) },
    ],
  },
  {
    id: 'flags',
    label: 'Flags',
    legend: [
      { label: 'WATER', color: hex(WATER) },
      { label: 'STEEP', color: hex([200, 50, 50]) },
      { label: 'STRUCTURE', color: hex([220, 110, 40]) },
      { label: 'GATE', color: hex([230, 60, 200]) },
      { label: 'ROAD', color: hex([240, 200, 90]) },
      { label: 'TERRITORY 1', color: hex([90, 140, 255]) },
      { label: 'TERRITORY 2', color: hex([255, 120, 120]) },
    ],
  },
];

function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function put(out: Uint8Array, i: number, c: Rgb): void {
  const o = i * 4;
  out[o] = c[0];
  out[o + 1] = c[1];
  out[o + 2] = c[2];
  out[o + 3] = 255;
}

/**
 * Fills an RGBA buffer (`width * height * 4`) with the colours of one overlay. Water is always
 * drawn as water except in the overlays where it is itself a layer.
 */
export function fillOverlay(grid: NavGrid, id: NavOverlayId, out: Uint8Array): void {
  const n = grid.width * grid.height;
  const land: Rgb = [70, 80, 70];
  let hMin = Infinity;
  let hMax = -Infinity;
  if (id === 'terrain') {
    for (let i = 0; i < n; i++) {
      if (grid.flags[i] & NavFlag.WATER) continue;
      hMin = Math.min(hMin, grid.heights[i]);
      hMax = Math.max(hMax, grid.heights[i]);
    }
  }
  for (let i = 0; i < n; i++) {
    const f = grid.flags[i];
    const water = (f & NavFlag.WATER) !== 0;
    switch (id) {
      case 'terrain': {
        if (water) put(out, i, WATER);
        else put(out, i, lerp([196, 186, 120], [120, 130, 100], (grid.heights[i] - hMin) / (hMax - hMin || 1)));
        break;
      }
      case 'slope': {
        const t = grid.terrain[i];
        if (water) put(out, i, WATER);
        else if (t === 255) put(out, i, BLOCKED);
        else put(out, i, lerp([60, 190, 90], [220, 60, 50], (t - 16) / 238));
        break;
      }
      case 'structure': {
        if (water) put(out, i, WATER);
        else if (f & NavFlag.GATE) put(out, i, grid.structure[i] ? [230, 60, 200] : [120, 230, 120]);
        else if (grid.structure[i]) put(out, i, [220, 110, 40]);
        else put(out, i, land);
        break;
      }
      case 'road': {
        if (water) put(out, i, WATER);
        else put(out, i, lerp(land, [240, 200, 90], grid.road[i] / 255));
        break;
      }
      case 'cost': {
        const c = grid.cost[i];
        if (c === 255) put(out, i, water ? WATER : BLOCKED);
        else put(out, i, lerp([40, 200, 220], [240, 200, 40], (c - 1) / 253));
        break;
      }
      case 'clearance': {
        const c = grid.clearance[i];
        if (water) put(out, i, WATER);
        else if (f & NavFlag.BLOCKED) put(out, i, BLOCKED);
        else if (c >= NAV_CLEARANCE_THRESHOLDS.creature) put(out, i, [70, 200, 110]);
        else if (c >= NAV_CLEARANCE_THRESHOLDS.catapult) put(out, i, [240, 190, 60]);
        else put(out, i, [230, 80, 70]);
        break;
      }
      case 'flags': {
        if (water) put(out, i, WATER);
        else if (f & NavFlag.GATE) put(out, i, [230, 60, 200]);
        else if (f & NavFlag.STRUCTURE) put(out, i, [220, 110, 40]);
        else if (f & NavFlag.STEEP) put(out, i, [200, 50, 50]);
        else if (f & NavFlag.ROAD) put(out, i, [240, 200, 90]);
        else if (f & NavFlag.TERRITORY) put(out, i, grid.territory[i] === 1 ? [90, 140, 255] : [255, 120, 120]);
        else put(out, i, land);
        break;
      }
    }
  }
}
