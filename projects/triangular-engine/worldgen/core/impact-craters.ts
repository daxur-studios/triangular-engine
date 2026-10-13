import { IPlanetGraphCore } from './planet-graph';
import { createSeededRandom } from './seeded-random';
import { dot, IVec3 } from './vec3';

export type ImpactCraterTier = 'basin' | 'complex' | 'simple';

export interface IImpactCrater {
  readonly id: number;
  readonly center: IVec3;
  readonly angularRadius: number;
  readonly depth: number;
  readonly rimHeight: number;
  readonly tier: ImpactCraterTier;
  readonly isBasaltFlooded: boolean;
  readonly hasCentralPeak: boolean;
  readonly age: number;
}

export interface IImpactCraterParams {
  readonly seed?: number;
  readonly basinCount?: number;
  readonly complexCraterCount?: number;
  readonly simpleCraterCount?: number;
  readonly depthScale?: number;
  readonly rimScale?: number;
  readonly mariaBasaltFlooding?: boolean;
}

export type CraterCellLandform =
  | 'none'
  | 'lunar_maria'
  | 'crater_rim'
  | 'crater_floor'
  | 'crater_peak'
  | 'ejecta';

export interface IImpactCraterResult {
  readonly craters: readonly IImpactCrater[];
  readonly elevation: number[];
  readonly craterLandform: CraterCellLandform[];
  readonly mariaCellIds: ReadonlySet<number>;
  readonly rimCellIds: ReadonlySet<number>;
}

const DEFAULTS = {
  basinCount: 3,
  complexCraterCount: 12,
  simpleCraterCount: 45,
  depthScale: 1.0,
  rimScale: 1.0,
  mariaBasaltFlooding: true,
  // Radians on the unit sphere
  minBasinRadius: 0.26, // ~15 degrees, spanning ~15-40 cells
  maxBasinRadius: 0.52, // ~30 degrees, large impact basin (Mare Imbrium size)
  minComplexRadius: 0.08, // ~4.5 degrees, spanning 3-8 cells
  maxComplexRadius: 0.18, // ~10 degrees
  minSimpleRadius: 0.025, // ~1.5 degrees, spanning 1-2 cells
  maxSimpleRadius: 0.06,  // ~3.5 degrees
};

/**
 * Computes angular distance between two unit-sphere vectors in radians.
 */
function angularDistance(a: IVec3, b: IVec3): number {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  return Math.acos(d);
}

/**
 * Generates and applies a multi-scale impact crater field to a planet's elevation field.
 *
 * Places craters from largest/oldest (impact basins / maria) down to medium complex
 * craters (with central peaks) and small simple bowl craters. Each crater displaces
 * cell elevations across its full multi-cell footprint:
 * - Depressed bowl interior
 * - Raised mountain rim lip
 * - Gentle ejecta blanket falloff
 * - Basalt lava pond infill for maria basins (flat dark floors)
 */
export function generateImpactCraters(
  graph: IPlanetGraphCore,
  baseElevation: number[],
  params: IImpactCraterParams = {},
): IImpactCraterResult {
  const p = { ...DEFAULTS, ...params };
  const rng = createSeededRandom((p.seed ?? 1001) + 4099);
  const cellCount = graph.cells.length;

  const elevation = baseElevation.slice();
  const craterLandform: CraterCellLandform[] = new Array(cellCount).fill('none');
  const mariaCellIds = new Set<number>();
  const rimCellIds = new Set<number>();

  const craters: IImpactCrater[] = [];
  let nextCraterId = 0;

  // Helper to pick random unit-sphere direction with uniform distribution
  const randomSpherePoint = (): IVec3 => {
    const z = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return {
      x: r * Math.cos(phi),
      y: z,
      z: r * Math.sin(phi),
    };
  };

  // 1. Build Crater Definitions: Tier 1 Basins -> Tier 2 Complex -> Tier 3 Simple
  // Tier 1: Giant Basins (oldest, can be basalt flooded into Maria)
  for (let i = 0; i < p.basinCount; i++) {
    const center = randomSpherePoint();
    const angularRadius = p.minBasinRadius + rng() * (p.maxBasinRadius - p.minBasinRadius);
    const depth = (0.35 + rng() * 0.25) * p.depthScale;
    const rimHeight = (0.18 + rng() * 0.12) * p.rimScale;
    craters.push({
      id: nextCraterId++,
      center,
      angularRadius,
      depth,
      rimHeight,
      tier: 'basin',
      isBasaltFlooded: p.mariaBasaltFlooding && rng() > 0.15,
      hasCentralPeak: false,
      age: 0.8 + rng() * 0.2,
    });
  }

  // Tier 2: Complex Craters (terraced walls, central peak uplift)
  for (let i = 0; i < p.complexCraterCount; i++) {
    const center = randomSpherePoint();
    const angularRadius = p.minComplexRadius + rng() * (p.maxComplexRadius - p.minComplexRadius);
    const depth = (0.18 + rng() * 0.14) * p.depthScale;
    const rimHeight = (0.08 + rng() * 0.07) * p.rimScale;
    craters.push({
      id: nextCraterId++,
      center,
      angularRadius,
      depth,
      rimHeight,
      tier: 'complex',
      isBasaltFlooded: false,
      hasCentralPeak: rng() > 0.35,
      age: 0.3 + rng() * 0.5,
    });
  }

  // Tier 3: Simple Craters (sharp bowl depressions with raised lip)
  for (let i = 0; i < p.simpleCraterCount; i++) {
    const center = randomSpherePoint();
    const angularRadius = p.minSimpleRadius + rng() * (p.maxSimpleRadius - p.minSimpleRadius);
    const depth = (0.08 + rng() * 0.08) * p.depthScale;
    const rimHeight = (0.04 + rng() * 0.04) * p.rimScale;
    craters.push({
      id: nextCraterId++,
      center,
      angularRadius,
      depth,
      rimHeight,
      tier: 'simple',
      isBasaltFlooded: false,
      hasCentralPeak: false,
      age: 0.05 + rng() * 0.4,
    });
  }

  // 2. Apply Craters Chronologically (Older basins first, then complex, then fresh simple)
  // For each crater, identify all cells within footprint (angular distance <= 1.8 * radius)
  for (const crater of craters) {
    const maxRadius = crater.angularRadius * 1.8;
    const basaltFloorLevel = -crater.depth * 0.35;

    for (let cellId = 0; cellId < cellCount; cellId++) {
      const cellCenter = graph.cells[cellId]!.center;
      const dist = angularDistance(cellCenter, crater.center);
      if (dist > maxRadius) continue;

      const u = dist / crater.angularRadius;

      // Calculate elevation delta from bowl excavation and rim uplift
      let deltaH = 0;
      let landformTag: CraterCellLandform | null = null;

      if (u < 0.85) {
        // Deep interior bowl
        const bowlFactor = Math.pow(1 - Math.pow(u / 0.85, 2), 1.1);
        deltaH = -crater.depth * bowlFactor;

        // Central peak for complex craters
        if (crater.hasCentralPeak && u < 0.28) {
          const peakFactor = Math.pow(Math.cos((u / 0.28) * (Math.PI / 2)), 2);
          deltaH += crater.depth * 0.52 * peakFactor;
          if (u < 0.14) {
            landformTag = 'crater_peak';
          }
        }

        if (!landformTag) {
          landformTag = crater.isBasaltFlooded ? 'lunar_maria' : 'crater_floor';
        }
      } else if (u >= 0.85 && u <= 1.18) {
        // Raised crater rim ring
        const rimDist = (u - 1.0) / 0.14;
        const rimFactor = Math.exp(-rimDist * rimDist);
        deltaH = crater.rimHeight * rimFactor;
        landformTag = 'crater_rim';
        rimCellIds.add(cellId);
      } else {
        // Outer ejecta blanket falloff
        const ejectaT = (u - 1.18) / 0.62;
        deltaH = crater.rimHeight * 0.3 * Math.exp(-ejectaT * 2.5);
        if (craterLandform[cellId] === 'none') {
          landformTag = 'ejecta';
        }
      }

      // Apply elevation modification
      elevation[cellId] += deltaH;

      // Basalt flooding: if it's a mare basin, molten lava leveled the bowl floor
      if (crater.isBasaltFlooded && u < 0.8) {
        if (elevation[cellId] < basaltFloorLevel) {
          elevation[cellId] = basaltFloorLevel;
        }
        mariaCellIds.add(cellId);
        craterLandform[cellId] = 'lunar_maria';
      } else if (landformTag) {
        craterLandform[cellId] = landformTag;
      }
    }
  }

  return {
    craters,
    elevation,
    craterLandform,
    mariaCellIds,
    rimCellIds,
  };
}
