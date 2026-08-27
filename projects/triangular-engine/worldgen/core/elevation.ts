import { IPlanetGraphCore } from './planet-graph';
import { IPlateBoundaryEdge } from './plate-boundaries';
import { IPlate } from './plate-tectonics';
import { createSeededRandom } from './seeded-random';

export interface IElevationParams {
  seed?: number;
  /** Fraction of cells that end up below `seaLevelElevation`. */
  targetLandFraction?: number;
  continentalBase?: number;
  oceanicBase?: number;
  /** Continent-continent convergence (mountain ranges). */
  ridgeBoost?: number;
  /** Ocean-ocean convergence (island arcs). */
  islandArcBoost?: number;
  /** Subduction uplift on the continental side of an ocean-continent convergent boundary. */
  subductionUplift?: number;
  /** Subduction trench on the oceanic side of an ocean-continent convergent boundary (negative). */
  subductionTrench?: number;
  /** Continent-continent divergence (rift valleys, negative). */
  riftDepth?: number;
  /** Ocean-ocean divergence (mid-ocean ridges). */
  midOceanRidgeBoost?: number;
  /** How many graph hops a boundary's elevation influence reaches. */
  boundaryFalloffRadius?: number;
  /**
   * How many graph hops a continent-continent convergent (ridge/mountain-range) boundary's
   * uplift reaches — separate from `boundaryFalloffRadius` and much smaller by default, so
   * mountain ranges form as a narrow line tracing the boundary (see `ridgeCellIds`) instead of
   * compounding into a blob covering a whole continent's interior. See runbook 022.
   */
  ridgeFalloffRadius?: number;
  /** Per-hop decay multiplier for boundary influence (0..1). */
  boundaryDecayPerHop?: number;
  /** Per-cell elevation jitter amplitude for texture. */
  noiseAmplitude?: number;
}

export interface IElevationResult {
  /** Raw elevation per cell id, arbitrary unitless scale. */
  elevation: number[];
  isLand: boolean[];
  seaLevelElevation: number;
  /** Cell ids touching a continent-continent convergent boundary — used for ridge-chain checks. */
  ridgeCellIds: number[];
}

const DEFAULTS = {
  targetLandFraction: 0.3,
  continentalBase: 0.35,
  oceanicBase: -0.5,
  ridgeBoost: 0.6,
  islandArcBoost: 0.25,
  subductionUplift: 0.4,
  subductionTrench: -0.5,
  riftDepth: -0.25,
  midOceanRidgeBoost: 0.15,
  boundaryFalloffRadius: 3,
  ridgeFalloffRadius: 0,
  boundaryDecayPerHop: 0.55,
  noiseAmplitude: 0.08,
};

/** Per-side elevation deltas a single boundary edge contributes to its `cellA`/`cellB` endpoints. */
function boundaryContribution(
  edge: IPlateBoundaryEdge,
  plates: IPlate[],
  p: typeof DEFAULTS,
): { deltaA: number; deltaB: number } {
  const typeA = plates[edge.plateA].type;
  const typeB = plates[edge.plateB].type;
  const bothContinental = typeA === 'continental' && typeB === 'continental';
  const bothOceanic = typeA === 'oceanic' && typeB === 'oceanic';

  if (edge.type === 'convergent') {
    if (bothContinental) return { deltaA: p.ridgeBoost, deltaB: p.ridgeBoost };
    if (bothOceanic) return { deltaA: p.islandArcBoost, deltaB: p.islandArcBoost };
    // Ocean-continent: subduction — continental side uplifts, oceanic side trenches.
    const aIsContinental = typeA === 'continental';
    return {
      deltaA: aIsContinental ? p.subductionUplift : p.subductionTrench,
      deltaB: aIsContinental ? p.subductionTrench : p.subductionUplift,
    };
  }

  if (edge.type === 'divergent') {
    if (bothContinental) return { deltaA: p.riftDepth, deltaB: p.riftDepth };
    if (bothOceanic) return { deltaA: p.midOceanRidgeBoost, deltaB: p.midOceanRidgeBoost };
    return { deltaA: 0, deltaB: 0 }; // mixed passive margin — no strong feature
  }

  return { deltaA: 0, deltaB: 0 }; // transform — sliding, no significant relief
}

/** Spreads `value` outward from `sourceCellId` across up to `radius` hops, decaying by `decayPerHop` each step, adding into `out`. */
function spreadInfluence(
  graph: IPlanetGraphCore,
  sourceCellId: number,
  value: number,
  radius: number,
  decayPerHop: number,
  out: number[],
): void {
  out[sourceCellId] += value;
  if (value === 0 || radius <= 0) return;

  const visited = new Set<number>([sourceCellId]);
  let frontier = [sourceCellId];
  for (let hop = 1; hop <= radius; hop++) {
    const next: number[] = [];
    const decayed = value * decayPerHop ** hop;
    for (const cellId of frontier) {
      for (const neighborId of graph.cells[cellId].neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        out[neighborId] += decayed;
        next.push(neighborId);
      }
    }
    frontier = next;
  }
}

/**
 * Builds per-cell elevation from plate type (continental vs. oceanic base
 * height) plus boundary shaping (ridges, trenches, rifts) that decays outward
 * from each boundary edge, then picks a sea-level threshold by percentile so
 * `targetLandFraction` of cells end up as land.
 *
 * Continent-continent convergent (ridge) *and* ocean-ocean convergent
 * (island-arc) edges use `ridgeFalloffRadius` instead of the general
 * `boundaryFalloffRadius`, and default to 0 hops (no spread beyond the
 * boundary's own two cells) — both are the same real-world phenomenon,
 * collision uplift along a line (a continental mountain range or a chain of
 * volcanic islands), not a broad regional swell. A whole mountain range or
 * island chain is many adjacent convergent edges in a row, each spreading
 * independently — with the general (larger) falloff radius, their
 * overlapping spread used to compound into a blob covering most of a
 * continent's interior (or, for island arcs, inflating a whole small oceanic
 * plate well past continental elevations), worse at low cell counts where a
 * few hops is a big fraction of the landmass. Keeping this uplift tied to
 * the boundary cells themselves instead produces a narrow line that traces
 * the actual boundary, independent of cell density or planet size — see
 * `computeBiomes()`, which now classifies `ridgeCellIds` as `'alpine'`
 * outright instead of via a global elevation percentile, for the other half
 * of this fix. Subduction (ocean-continent convergent) and rift/mid-ocean-
 * ridge (divergent) contributions are unaffected — those realistically are
 * broader regional features (e.g. the Andes' uplift belt), not a single
 * line. See runbook 022.
 */
export function computeElevation(
  graph: IPlanetGraphCore,
  plates: IPlate[],
  plateIdByCell: number[],
  boundaries: IPlateBoundaryEdge[],
  params: IElevationParams = {},
): IElevationResult {
  const p = { ...DEFAULTS, ...params };
  const cellCount = graph.cells.length;

  const elevation = plateIdByCell.map((plateId) =>
    plates[plateId].type === 'continental' ? p.continentalBase : p.oceanicBase,
  );

  const noiseRng = createSeededRandom(((params.seed ?? graph.seed) + 1) >>> 0);
  for (let i = 0; i < cellCount; i++) {
    elevation[i] += (noiseRng() * 2 - 1) * p.noiseAmplitude;
  }

  const ridgeCellIds: number[] = [];
  for (const edge of boundaries) {
    const { deltaA, deltaB } = boundaryContribution(edge, plates, p);
    const typeA = plates[edge.plateA].type;
    const typeB = plates[edge.plateB].type;
    const isRidge = edge.type === 'convergent' && typeA === 'continental' && typeB === 'continental';
    const isIslandArc = edge.type === 'convergent' && typeA === 'oceanic' && typeB === 'oceanic';
    const falloffRadius = isRidge || isIslandArc ? p.ridgeFalloffRadius : p.boundaryFalloffRadius;
    spreadInfluence(graph, edge.cellA, deltaA, falloffRadius, p.boundaryDecayPerHop, elevation);
    spreadInfluence(graph, edge.cellB, deltaB, falloffRadius, p.boundaryDecayPerHop, elevation);

    if (isRidge) {
      ridgeCellIds.push(edge.cellA, edge.cellB);
    }
  }

  const sorted = [...elevation].sort((a, b) => a - b);
  const seaLevelIndex = Math.min(
    cellCount - 1,
    Math.max(0, Math.floor((1 - p.targetLandFraction) * cellCount)),
  );
  const seaLevelElevation = sorted[seaLevelIndex];
  const isLand = elevation.map((e) => e >= seaLevelElevation);

  return { elevation, isLand, seaLevelElevation, ridgeCellIds: [...new Set(ridgeCellIds)] };
}
