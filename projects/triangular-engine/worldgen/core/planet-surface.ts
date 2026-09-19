import { IPlanetEcology } from './ecology';
import { IPlanetFeatures } from './features';
import { defaultGeologicalTerrainSettings, sampleVolcano, VolcanoSettings } from './geological-shapes';
import { IPlanetGraphCore } from './planet-graph';
import { findCellAt, sampleElevation } from './sample-elevation';
import { IPlanetTectonics } from './tectonics';
import { cross, dot, IVec3, normalize } from './vec3';

/**
 * Camera-independent shaping controls for the detailed planet surface. Widths are angular
 * distances on the unit sphere; heights use the same unitless elevation scale as tectonics.
 * A renderer converts those heights into metres or radial displacement.
 */
export interface IPlanetSurfaceParams {
  ridgeWidthRadians?: number;
  ridgeRelief?: number;
  summitWidthRadians?: number;
  summitRelief?: number;
  riverWidthRadians?: number;
  riverDepth?: number;
  /** Optional generated per-cell geology applied as local sampled terrain relief. */
  features?: IPlanetFeatures;
  /** Fraction of the containing cell's centre-to-corner radius used by volcanoes. */
  featureRadiusFraction?: number;
  /**
   * 'shaped' blends elevation across neighbouring cells (barycentric-interpolated base
   * elevation, plus ridge/river corridors that shape relief across many cells together — e.g.
   * one mountain range spanning several cells). 'cell' makes each Voronoi cell its own flat,
   * self-contained terrain unit: no blending with neighbours and no cross-cell ridge/river
   * shaping, so a cell's terrain (and any feature instance stamped on it) never depends on or
   * affects an adjacent cell — the Civ-like "one discrete tile" read.
   */
  featureComposition?: 'shaped' | 'cell';
}

export interface IPlanetSurfaceSample {
  /** Base graph elevation before detailed ridge/river shaping. */
  baseElevation: number;
  /** Positive relief contributed by ridge corridors and summit markers. */
  ridgeRelief: number;
  /** Downward channel contribution. This is zero over ocean cells. */
  riverCarve: number;
  /** Final canonical terrain elevation, including below-sea bathymetry. */
  elevation: number;
  seaLevel: number;
  isLand: boolean;
}

export interface IPlanetSurfaceSampler {
  sample(direction: IVec3): IPlanetSurfaceSample;
}

const DEFAULTS: Omit<Required<IPlanetSurfaceParams>, 'features'> = {
  ridgeWidthRadians: 0.045,
  ridgeRelief: 0.18,
  summitWidthRadians: 0.028,
  summitRelief: 0.16,
  riverWidthRadians: 0.018,
  riverDepth: 0.08,
  featureRadiusFraction: 0.72,
  featureComposition: 'shaped',
};

function angularDistance(a: IVec3, b: IVec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

function smoothFalloff(distance: number, width: number): number {
  if (width <= 0 || distance >= width) return 0;
  const t = distance / width;
  const smooth = 1 - t * t * (3 - 2 * t);
  return smooth * smooth;
}

function nearestPathDistance(direction: IVec3, paths: readonly IVec3[][]): number {
  let nearest = Infinity;
  for (const path of paths) {
    for (const point of path) nearest = Math.min(nearest, angularDistance(direction, point));
  }
  return nearest;
}

function nearestPathInfluence(
  direction: IVec3,
  paths: readonly IVec3[][],
  strengths: readonly number[],
  width: number,
): number {
  let influence = 0;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (!path || path.length === 0) continue;
    const distance = nearestPathDistance(direction, [path]);
    influence = Math.max(influence, smoothFalloff(distance, width) * (strengths[i] ?? 1));
  }
  return influence;
}

function nearestRiverInfluence(direction: IVec3, paths: readonly IVec3[][], width: number): number {
  return smoothFalloff(nearestPathDistance(direction, paths), width);
}

interface IVolcanoStamp {
  readonly cell: IPlanetGraphCore['cells'][number];
  readonly elevationDelta: number;
  readonly tangentX: IVec3;
  readonly tangentZ: IVec3;
  readonly settings: VolcanoSettings;
}

function volcanoRelief(direction: IVec3, stamp: IVolcanoStamp, radiusFraction: number): number {
  const { cell, elevationDelta, tangentX, tangentZ, settings } = stamp;
  if (cell.corners.length === 0 || elevationDelta === 0) return 0;

  // Keep the analytic shape inside the site cell. The centre-to-nearest-corner distance is a
  // conservative local footprint for an irregular Voronoi polygon; fading to zero before that
  // boundary keeps the feature owned by one cell and leaves neighbouring cell terrain intact.
  const nearestCornerRadius = Math.min(...cell.corners.map((corner) => angularDistance(cell.center, corner)));
  const radius = Math.max(1e-4, nearestCornerRadius * radiusFraction);
  const angularDistanceFromCentre = angularDistance(direction, cell.center);
  const normalized = angularDistanceFromCentre / radius;
  if (normalized >= 1) return 0;

  // Reuse the geological-features lab's authored volcano in a local tangent frame. The POC's
  // metre-sized radius is remapped to this cell's angular footprint; its seeded asymmetry,
  // crater rim and erosion gullies therefore remain the source of truth for both views.
  const centreAlignment = Math.max(1e-4, dot(direction, cell.center));
  const tangentScale = settings.radius / Math.max(1e-4, Math.tan(radius));
  const localX = (dot(direction, tangentX) / centreAlignment) * tangentScale;
  const localZ = (dot(direction, tangentZ) / centreAlignment) * tangentScale;
  const authoredElevation = sampleVolcano(localX, localZ, settings);
  const authoredHeightScale = elevationDelta / Math.max(1, settings.height);
  const edgeEnvelope = smoothFalloff(angularDistanceFromCentre, radius);
  return authoredElevation * authoredHeightScale * edgeEnvelope;
}

/**
 * Creates the canonical detailed surface query shared by the planar map, spherical views,
 * CPU picking and future terrain colliders. It deliberately accepts normalized planet
 * directions rather than projected map coordinates, so map seams and projection distortion
 * cannot change mountain or river placement.
 */
export function createPlanetSurfaceSampler(
  graph: IPlanetGraphCore,
  tectonics: IPlanetTectonics,
  ecology: Pick<IPlanetEcology, 'ridgePaths' | 'ridgePathStrength' | 'ridgePeaks' | 'riverPaths'>,
  params: IPlanetSurfaceParams = {},
): IPlanetSurfaceSampler {
  const p = { ...DEFAULTS, ...params };
  const isDiscreteCell = p.featureComposition === 'cell';
  const volcanoSettings = defaultGeologicalTerrainSettings().volcano;
  const volcanoStamps: IVolcanoStamp[] = isDiscreteCell
    ? []
    : (params.features?.instances ?? [])
        .filter((instance) => instance.kind === 'volcano')
        .map((instance) => {
          const cell = graph.cells[instance.siteCellId];
          if (!cell) return undefined;
          const reference = Math.abs(cell.center.y) < 0.92 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
          const tangentX = normalize(cross(reference, cell.center));
          return {
            cell,
            elevationDelta: instance.elevationDelta,
            tangentX,
            tangentZ: normalize(cross(cell.center, tangentX)),
            settings: { ...volcanoSettings, seed: volcanoSettings.seed + instance.siteCellId },
          };
        })
        .filter((stamp): stamp is IVolcanoStamp => stamp !== undefined);

  return {
    sample(direction: IVec3): IPlanetSurfaceSample {
      const unitDirection = normalize(direction);
      // A discrete cell is its own flat, self-contained terrain unit: its elevation comes
      // straight from the Voronoi site it belongs to, with no barycentric blend toward
      // neighbouring cells' corner-averaged elevation. That is what makes adjacent cells meet
      // at a hard edge instead of the smooth shared shoreline/ridge 'shaped' mode produces.
      const siteCell = isDiscreteCell ? findCellAt(graph, unitDirection) : undefined;
      const baseElevation = siteCell
        ? siteCell.id < tectonics.elevation.length
          ? tectonics.elevation[siteCell.id]!
          : tectonics.seaLevelElevation
        : sampleElevation(graph, tectonics.elevation, unitDirection);

      let featureRelief = 0;
      if (siteCell) {
        const instance = params.features?.featureByCellId.get(siteCell.id);
        if (instance) featureRelief = instance.elevationDelta;
      } else {
        for (const stamp of volcanoStamps) {
          featureRelief = Math.max(
            featureRelief,
            volcanoRelief(unitDirection, stamp, p.featureRadiusFraction),
          );
        }
      }
      const isLand = baseElevation >= tectonics.seaLevelElevation;

      // Ridge and river corridors are continuous shaping that stretches across many cells by
      // design (one mountain range or channel built from several cells acting together) — the
      // opposite of a discrete cell's self-contained terrain, so a discrete cell skips both.
      let ridgeRelief = 0;
      let riverCarve = 0;
      if (!isDiscreteCell) {
        const ridgeInfluence = nearestPathInfluence(
          unitDirection,
          ecology.ridgePaths,
          ecology.ridgePathStrength,
          p.ridgeWidthRadians,
        );
        ridgeRelief = ridgeInfluence * p.ridgeRelief;
        for (const peak of ecology.ridgePeaks) {
          ridgeRelief = Math.max(
            ridgeRelief,
            smoothFalloff(angularDistance(unitDirection, peak), p.summitWidthRadians) * p.summitRelief,
          );
        }

        // Rivers own their corridors. Keeping their carve below the sea datum would deepen
        // ocean cells and make river crossings ambiguous at the coast.
        riverCarve = isLand
          ? nearestRiverInfluence(unitDirection, ecology.riverPaths, p.riverWidthRadians) * p.riverDepth
          : 0;
      }

      const shapedElevation = baseElevation + ridgeRelief + featureRelief - riverCarve;
      // Keep land channels from falling through the shoreline, but preserve the
      // ocean floor below the sea datum so planar and spherical consumers can
      // visualize bathymetry instead of receiving a flat water plane.
      const elevation = isLand
        ? Math.max(tectonics.seaLevelElevation, shapedElevation)
        : Math.min(tectonics.seaLevelElevation, shapedElevation);

      return {
        baseElevation,
        ridgeRelief,
        riverCarve,
        elevation,
        seaLevel: tectonics.seaLevelElevation,
        isLand,
      };
    },
  };
}
