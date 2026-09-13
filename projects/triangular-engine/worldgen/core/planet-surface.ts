import { IPlanetEcology } from './ecology';
import { IPlanetGraphCore } from './planet-graph';
import { sampleElevation } from './sample-elevation';
import { IPlanetTectonics } from './tectonics';
import { dot, IVec3, normalize } from './vec3';

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

const DEFAULTS: Required<IPlanetSurfaceParams> = {
  ridgeWidthRadians: 0.045,
  ridgeRelief: 0.18,
  summitWidthRadians: 0.028,
  summitRelief: 0.16,
  riverWidthRadians: 0.018,
  riverDepth: 0.08,
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

  return {
    sample(direction: IVec3): IPlanetSurfaceSample {
      const unitDirection = normalize(direction);
      const baseElevation = sampleElevation(graph, tectonics.elevation, unitDirection);
      const isLand = baseElevation >= tectonics.seaLevelElevation;
      const ridgeInfluence = nearestPathInfluence(
        unitDirection,
        ecology.ridgePaths,
        ecology.ridgePathStrength,
        p.ridgeWidthRadians,
      );
      let ridgeRelief = ridgeInfluence * p.ridgeRelief;
      for (const peak of ecology.ridgePeaks) {
        ridgeRelief = Math.max(
          ridgeRelief,
          smoothFalloff(angularDistance(unitDirection, peak), p.summitWidthRadians) * p.summitRelief,
        );
      }

      // Rivers own their corridors. Keeping their carve below the sea datum would deepen
      // ocean cells and make river crossings ambiguous at the coast.
      const riverCarve = isLand
        ? nearestRiverInfluence(unitDirection, ecology.riverPaths, p.riverWidthRadians) * p.riverDepth
        : 0;
      const shapedElevation = baseElevation + ridgeRelief - riverCarve;
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
