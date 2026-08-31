import { IPlanetGraphCore } from './planet-graph';

export interface IClimateParams {
  /** Elevation-per-unit temperature drop on land (mountains are colder). */
  lapseRate?: number;
  /** How many graph hops moisture spreads inland from the ocean before hitting zero. */
  moistureFalloffRadius?: number;
  /** |y| latitude (sin(latitude), 0=equator..1=pole) where the subtropical arid belt is centered. */
  aridBeltCenter?: number;
  /** Half-width, in the same latitude units, of the arid belt's influence. */
  aridBeltWidth?: number;
  /** How much the arid belt multiplies down moisture at its center (0 = no effect, 1 = fully dry). */
  aridBeltStrength?: number;
  /** Flat shift applied to every cell's temperature after the latitude/lapse calc — a world-type
   * knob (e.g. a Moon profile setting this strongly negative for an airless, cold body) rather
   * than a climate mechanism of its own. Defaults to 0, reproducing prior behavior exactly. */
  baseTemperatureOffset?: number;
}

export interface IPlanetClimate {
  /** Per-cell temperature: ~1 (hot equator) down to ~-1 (frozen poles), before elevation chill. */
  temperature: number[];
  /** Per-cell moisture: 1 (ocean) decaying to 0 inland. */
  moisture: number[];
}

const DEFAULTS = {
  lapseRate: 0.6,
  moistureFalloffRadius: 4,
  // Recalibrated 2026-08-31: was 0.22/0.28, which put the belt's dry influence over almost the
  // entire hot/tropical band (isHot ~|y|<=0.325 in biomes.ts) with zero latitude left wet enough
  // for rainforest — every generation's tropics read as uniformly desert/savanna regardless of
  // seed, since neither the belt's position nor the tropical band's position varies by seed. Real
  // subtropical deserts sit poleward of the tropics, not on top of them. 0.32/0.22 pushes the
  // belt's zero-influence edge out to |y|=0.10 (leaving a genuinely wet equatorial ring where
  // rainforest can form) and centers peak dryness at |y|=0.32 (~19°, right at the hot/not-hot
  // boundary), so the progression reads equator(wet) -> tropical desert -> subtropical steppe
  // instead of one uniform arid band. See runbook 022.
  aridBeltCenter: 0.32,
  aridBeltWidth: 0.22,
  aridBeltStrength: 0.65,
  baseTemperatureOffset: 0,
};

/**
 * M2 climate pass: temperature from latitude (guaranteeing cold poles/hot
 * equator by construction) minus an elevation lapse, and moisture as a
 * multi-source BFS distance-from-ocean field, then a latitude-based arid
 * belt multiplied on top. See runbook 022.
 *
 * Tectonics elevation is an arbitrary unitless scale (boundary contributions
 * stack near dense plate boundaries, so its range varies a lot by params) —
 * the lapse term normalizes elevation against the actual land relief
 * (`seaLevelElevation` .. max land elevation) rather than assuming a fixed
 * absolute range.
 *
 * The BFS moisture field alone makes coastal land cells always wet (1 hop
 * from the ocean source is always well above the desert threshold), so
 * deserts were structurally confined to continental interiors — real deserts
 * are frequently coastal (Atacama, Namib, Baja California, Australia's west
 * coast), driven by subtropical high-pressure belts (~20-30° latitude, both
 * hemispheres) where descending air suppresses rainfall independent of
 * distance from the ocean. `aridBeltCenter`/`aridBeltWidth` model that as a
 * triangular dryness multiplier over `|y|` (sin(latitude)), applied to land
 * cells after the distance field (ocean stays at moisture 1 regardless of
 * latitude — water biomes don't consult moisture), so a land cell can be arid
 * at any distance from the coast if its latitude falls in the belt. See
 * runbook 022.
 */
export function computeClimate(
  graph: IPlanetGraphCore,
  elevation: number[],
  isLand: boolean[],
  seaLevelElevation: number,
  params: IClimateParams = {},
): IPlanetClimate {
  const p = { ...DEFAULTS, ...params };
  const cellCount = graph.cells.length;

  const landElevations = elevation.filter((_, id) => isLand[id]);
  const maxLandElevation = landElevations.length > 0 ? Math.max(...landElevations) : seaLevelElevation;
  const landRelief = Math.max(1e-6, maxLandElevation - seaLevelElevation);

  const temperature = graph.cells.map((cell, id) => {
    // |y| is sin(latitude): 0 at the equator, 1 at the poles (see planet-graph's axis convention).
    const latitude = Math.abs(cell.center.y);
    const base = 1 - latitude * 2;
    const normalizedElevation = isLand[id] ? Math.max(0, elevation[id] - seaLevelElevation) / landRelief : 0;
    return base - normalizedElevation * p.lapseRate + p.baseTemperatureOffset;
  });

  const moisture = new Array<number>(cellCount).fill(0);
  const visited = new Array<boolean>(cellCount).fill(false);
  let frontier: number[] = [];
  for (let id = 0; id < cellCount; id++) {
    if (!isLand[id]) {
      moisture[id] = 1;
      visited[id] = true;
      frontier.push(id);
    }
  }

  for (let hop = 1; hop <= p.moistureFalloffRadius && frontier.length > 0; hop++) {
    const value = Math.max(0, 1 - hop / p.moistureFalloffRadius);
    const next: number[] = [];
    for (const cellId of frontier) {
      for (const neighborId of graph.cells[cellId].neighbors) {
        if (visited[neighborId]) continue;
        visited[neighborId] = true;
        moisture[neighborId] = value;
        next.push(neighborId);
      }
    }
    frontier = next;
  }

  for (let id = 0; id < cellCount; id++) {
    if (!isLand[id]) continue;
    const latitude = Math.abs(graph.cells[id].center.y);
    const beltFactor = Math.max(0, 1 - Math.abs(latitude - p.aridBeltCenter) / p.aridBeltWidth);
    moisture[id] *= 1 - p.aridBeltStrength * beltFactor;
  }

  return { temperature, moisture };
}
