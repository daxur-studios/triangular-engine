import { Biome } from './biomes';
import { IPlanetEcology } from './ecology';
import { IPlanetFeatures } from './features';
import {
  defaultGeologicalTerrainSettings,
  sampleCrater,
  sampleMesa,
  sampleVolcano,
  VolcanoSettings,
} from './geological-shapes';
import { IPlanetGraphCore } from './planet-graph';
import { findCellAt, findCellNear, sampleElevationSurfaceAtCell } from './sample-elevation';
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
   * 'shaped' blends base elevation across neighbouring cells (barycentric-interpolated, so a
   * mountain's peak sits between cell centres rather than snapping to one). 'cell' anchors base
   * elevation to the containing Voronoi cell's own tectonic value — mostly un-blended toward
   * neighbours (see `cellBlendFraction`), so each cell still reads as its own discrete tile —
   * then shapes it per the cell's landform (from `ecology.biome`): 'alpine' cells get an
   * exaggerated peak centred on the site with a footprint-relative falloff so a whole cell reads
   * as one mountain cresting near its middle, not a flat-topped plateau; 'hills' get a gentler,
   * still-walkable bump; everything else stays close to flat. Each tier also gets its own local
   * detail-noise texture so cells read as natural ground rather than a dead-flat plateau. Ridge/
   * summit/river shaping still spans cells in both modes: only the base elevation (and any
   * feature instance stamped on a cell) is cell-local.
   */
  featureComposition?: 'shaped' | 'cell';
  /** 'cell' mode only: how much of the barycentric-blended neighbour elevation (0 = none, 1 =
   * the full 'shaped' blend) mixes into each cell's own tectonic value before landform shaping.
   * A small amount keeps adjacent tiles from meeting at a stark cliff while each cell still reads
   * as its own tile. */
  cellBlendFraction?: number;
  /** 'cell' mode only: overrides the landform's default local-detail-noise amplitude (unitless
   * elevation, same scale as tectonics) for every cell regardless of tier. Leave unset to use
   * each cell's landform-appropriate default (mountains rockier than meadows). */
  cellDetailAmplitude?: number;
  /** 'cell' mode only: overrides the landform's default local-detail-noise spatial frequency (in
   * bumps per unit chord length on the unit sphere) for every cell regardless of tier. Leave
   * unset to use each cell's landform-appropriate default. */
  cellDetailFrequency?: number;
  /** Freeboard thickness of floating sea ice / ice caps above sea level. Defaults to 0.02. Set to 0 to disable. */
  iceShelfFreeboard?: number;
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
  /** Discrete ownership of the sampled point's Voronoi cell, independent of its relief. */
  isLand: boolean;
  /** True if the sampled point sits on a floating sea ice / polar ice cap shelf. */
  isIce?: boolean;
}

export interface IPlanetSurfaceSampler {
  sample(direction: IVec3): IPlanetSurfaceSample;
  /**
   * Coherent-grid variant for tile/mesh bakers that already resolved the
   * previous sample's cell. It returns the same surface rule as `sample`, but
   * avoids a full graph scan for every texel.
   */
  sampleNear?(direction: IVec3, hintCellId: number): IPlanetSurfaceSample;
}

const DEFAULTS: Omit<
  Required<IPlanetSurfaceParams>,
  'features' | 'cellDetailAmplitude' | 'cellDetailFrequency'
> = {
  ridgeWidthRadians: 0.045,
  ridgeRelief: 0.18,
  summitWidthRadians: 0.028,
  summitRelief: 0.16,
  riverWidthRadians: 0.018,
  riverDepth: 0.08,
  featureRadiusFraction: 0.72,
  featureComposition: 'shaped',
  cellBlendFraction: 0.25,
  iceShelfFreeboard: 0.02,
};

/** Per-cell landform tier a discrete cell is shaped as, derived from its `ecology.biome`. */
type CellLandform = 'mountain' | 'hill' | 'flat';

const LANDFORM_BY_BIOME: Partial<Record<Biome, CellLandform>> = {
  alpine: 'mountain',
  hills: 'hill',
  canyon: 'hill',
};

function resolveLandform(biome: Biome | undefined): CellLandform {
  return (biome && LANDFORM_BY_BIOME[biome]) || 'flat';
}

interface ILandformShape {
  /** Local relief added above the continuous cell ground, in sampler elevation units. */
  readonly relief: number;
  /** Exponent applied to the smooth centre-to-edge falloff. */
  readonly peakSharpness: number;
  readonly detailAmplitude: number;
  readonly detailFrequency: number;
}

const LANDFORM_SHAPE: Record<CellLandform, ILandformShape> = {
  // The ground remains continuous across the Voronoi edge. This is only local landform relief,
  // so it cannot turn a whole cell into a raised block.
  mountain: { relief: 0.2, peakSharpness: 1.15, detailAmplitude: 0.035, detailFrequency: 55 },
  hill: { relief: 0.07, peakSharpness: 0.9, detailAmplitude: 0.035, detailFrequency: 30 },
  // Meadow/plains/etc: buildable, close to flat, only fine ground texture.
  flat: { relief: 0, peakSharpness: 1, detailAmplitude: 0.015, detailFrequency: 45 },
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

function hash3(x: number, y: number, z: number, seed: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 269.5) * 43758.5453;
  return value - Math.floor(value);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Coherent value noise sampled directly in the unit sphere's Cartesian XYZ, not a lat/long
 * projection — so it has no pole seam or singularity and stays isotropic everywhere a discrete
 * cell can be. Used only to give a flat, unblended cell some natural small-scale roughness; not
 * meant to place or shape a named landform (that is `volcanoRelief`'s job).
 */
function cellDetailNoise(direction: IVec3, frequency: number, seed: number): number {
  const x = direction.x * frequency;
  const y = direction.y * frequency;
  const z = direction.z * frequency;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smoothstep01(x - x0);
  const ty = smoothstep01(y - y0);
  const tz = smoothstep01(z - z0);
  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x0 + 1, y0, z0, seed);
  const c010 = hash3(x0, y0 + 1, z0, seed);
  const c110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const c001 = hash3(x0, y0, z0 + 1, seed);
  const c101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const c011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const x00 = lerp(c000, c100, tx);
  const x10 = lerp(c010, c110, tx);
  const x01 = lerp(c001, c101, tx);
  const x11 = lerp(c011, c111, tx);
  const y0v = lerp(x00, x10, ty);
  const y1v = lerp(x01, x11, ty);
  return lerp(y0v, y1v, tz);
}

interface IVolcanoStamp {
  readonly cell: IPlanetGraphCore['cells'][number];
  readonly elevationDelta: number;
  readonly tangentX: IVec3;
  readonly tangentZ: IVec3;
  readonly settings: VolcanoSettings;
}

function sampleFeatureShape(
  kind: 'volcano' | 'mesa' | 'crater',
  x: number,
  z: number,
  settings: ReturnType<typeof defaultGeologicalTerrainSettings>,
): number {
  switch (kind) {
    case 'volcano':
      return sampleVolcano(x, z, settings.volcano);
    case 'mesa':
      return sampleMesa(x, z, settings.mesa);
    case 'crater':
      return sampleCrater(x, z, settings.crater);
  }
}

function cellFeatureRelief(
  direction: IVec3,
  cell: IPlanetGraphCore['cells'][number],
  instance: NonNullable<IPlanetFeatures['instances'][number]>,
  settings: ReturnType<typeof defaultGeologicalTerrainSettings>,
  radiusFraction: number,
): number {
  if (cell.corners.length === 0 || instance.elevationDelta === 0) return 0;

  const footprintRadius = Math.max(
    1e-4,
    Math.min(...cell.corners.map((corner) => angularDistance(cell.center, corner))) * radiusFraction,
  );
  const distanceFromCentre = angularDistance(direction, cell.center);
  if (distanceFromCentre >= footprintRadius) return 0;

  const reference = Math.abs(cell.center.y) < 0.92 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const tangentX = normalize(cross(reference, cell.center));
  const tangentZ = normalize(cross(cell.center, tangentX));
  const alignment = Math.max(1e-4, dot(direction, cell.center));
  const featureRadius =
    instance.kind === 'volcano'
      ? settings.volcano.radius
      : instance.kind === 'mesa'
        ? settings.mesa.radius
        : settings.crater.radius;
  const tangentScale = featureRadius / Math.max(1e-4, Math.tan(footprintRadius));
  const localX = (dot(direction, tangentX) / alignment) * tangentScale;
  const localZ = (dot(direction, tangentZ) / alignment) * tangentScale;
  const featureSettings = {
    ...settings,
    ...(instance.kind === 'volcano'
      ? { volcano: { ...settings.volcano, seed: settings.volcano.seed + instance.siteCellId } }
      : instance.kind === 'mesa'
        ? { mesa: { ...settings.mesa, seed: settings.mesa.seed + instance.siteCellId } }
        : { crater: { ...settings.crater, seed: settings.crater.seed + instance.siteCellId } }),
  };
  const peak = sampleFeatureShape(instance.kind, 0, 0, featureSettings);
  if (Math.abs(peak) < 1e-5) return 0;

  // The authored geological shape supplies the silhouette and local detail. The envelope is
  // cell-specific and makes the feature return to the cell's ground before the Voronoi edge.
  const edgeEnvelope = smoothFalloff(distanceFromCentre, footprintRadius);
  return (sampleFeatureShape(instance.kind, localX, localZ, featureSettings) / peak) *
    instance.elevationDelta * edgeEnvelope;
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
  ecology: Pick<IPlanetEcology, 'ridgePaths' | 'ridgePathStrength' | 'ridgePeaks' | 'riverPaths' | 'biome'>,
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

  const sampleAtCell = (unitDirection: IVec3, siteCell: IPlanetGraphCore['cells'][number]): IPlanetSurfaceSample => {
      const sharedSurface = sampleElevationSurfaceAtCell(
        siteCell,
        unitDirection,
        tectonics.elevation,
        tectonics.isLand,
        tectonics.seaLevelElevation,
      );
      const coastalReliefWeight = 1 - sharedSurface.coastlineWeight;
      // A discrete cell is its own self-contained terrain unit: its elevation is anchored to the
      // Voronoi site it belongs to (`cellBlendFraction` mixes in only a little of the
      // barycentric-blended neighbour value, so tiles don't meet at a stark cliff), then shaped
      // per its landform — a mountain cell crests near its own centre and falls off toward its
      // edge instead of sitting as a flat-topped plateau; a hill gets a gentler, still-walkable
      // bump; flatter biomes stay close to their anchor. A landform-appropriate noise layer keeps
      // every tier from reading as a dead-flat plateau.
      const cellFeature = isDiscreteCell && siteCell ? params.features?.featureByCellId.get(siteCell.id) : undefined;
      let baseElevation: number;
      if (isDiscreteCell) {
        const ownElevation =
          siteCell.id < tectonics.elevation.length ? tectonics.elevation[siteCell.id]! : tectonics.seaLevelElevation;
        const cellRadius =
          siteCell.corners.length > 0
            ? Math.max(
                1e-4,
                Math.min(...siteCell.corners.map((corner) => angularDistance(siteCell.center, corner))),
              )
            : 0;

        // Blend the cell's authored centre value into the same fan surface used by
        // neighboring cells. The fan centre weight is exactly zero on every polygon
        // edge, unlike a radial distance estimate, so cell ownership cannot create a
        // height step at a narrow or irregular part of the boundary.
        const groundBlend = p.cellBlendFraction + (1 - sharedSurface.centerWeight) * (1 - p.cellBlendFraction);
        const continuousCellGround = lerp(ownElevation, sharedSurface.elevation, groundBlend);

        // A named volcano/mesa/crater owns the cell's local landform. The biome tier remains the
        // fallback for ordinary cells, so a feature is not stacked on a second generic extrusion.
        const shape = LANDFORM_SHAPE[cellFeature ? 'flat' : resolveLandform(ecology.biome?.[siteCell.id])];
        const detailAmplitude = p.cellDetailAmplitude ?? shape.detailAmplitude;
        const detailFrequency = p.cellDetailFrequency ?? shape.detailFrequency;

        const dome = Math.pow(
          smoothFalloff(angularDistance(unitDirection, siteCell.center), cellRadius),
          shape.peakSharpness,
        );
        const peaked = continuousCellGround + shape.relief * dome * sharedSurface.centerWeight;
        const detail =
          (cellDetailNoise(unitDirection, detailFrequency, tectonics.seed) - 0.5) *
          2 *
          detailAmplitude *
          sharedSurface.centerWeight;
        baseElevation = peaked + detail;
      } else {
        baseElevation = sharedSurface.elevation;
      }

      let featureRelief = 0;
      if (isDiscreteCell) {
        if (cellFeature) {
          featureRelief = cellFeatureRelief(
            unitDirection,
            siteCell,
            cellFeature,
            defaultGeologicalTerrainSettings(),
            p.featureRadiusFraction,
          );
        }
      } else {
        for (const stamp of volcanoStamps) {
          featureRelief = Math.max(
            featureRelief,
            volcanoRelief(unitDirection, stamp, p.featureRadiusFraction),
          );
        }
      }

      const cellBiome = siteCell && ecology.biome ? ecology.biome[siteCell.id] : undefined;
      // Land/water ownership belongs to the generated cell mask. Blended or
      // locally shaped elevation can move a height contour, but it must not
      // move the shoreline into the middle of a cell polygon.
      const isTectonicLand = tectonics.isLand[siteCell.id] ?? baseElevation >= tectonics.seaLevelElevation;
      const isIce = !isTectonicLand && cellBiome === 'ice_cap';

      const freeboard = p.iceShelfFreeboard ?? 0.02;
      const iceMicroRelief = (cellDetailNoise(unitDirection, 40, tectonics.seed) - 0.5) * 2 * 0.003;
      const iceElevation = tectonics.seaLevelElevation + freeboard + iceMicroRelief;

      // Ridges and rivers stay shared, cross-cell corridors in both modes — a mountain crest or
      // a river still runs through several cells the same way it does in 'shaped'. Only the
      // base elevation (and any feature stamp) is cell-local.
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
      ridgeRelief *= coastalReliefWeight;

      // Rivers own their corridors. Keeping their carve below the sea datum would deepen
      // ocean cells and make river crossings ambiguous at the coast.
      const riverCarve = isTectonicLand
        ? nearestRiverInfluence(unitDirection, ecology.riverPaths, p.riverWidthRadians) * p.riverDepth * coastalReliefWeight
        : 0;

      const effectiveBaseElevation = isIce
        ? baseElevation + (iceElevation - baseElevation) * sharedSurface.centerWeight * coastalReliefWeight
        : baseElevation;
      // Feature stamps are cell-local even in shaped mode. Fade them with the
      // fan's site weight so adjacent cells meet on the same shared edge.
      featureRelief *= sharedSurface.centerWeight * coastalReliefWeight;
      const shapedElevation = effectiveBaseElevation + ridgeRelief + featureRelief - riverCarve;
      // Keep land channels from falling through the shoreline, but preserve the
      // ocean floor below the sea datum so planar and spherical consumers can
      // visualize bathymetry instead of receiving a flat water plane.
      const elevation = isTectonicLand || isIce
        ? Math.max(tectonics.seaLevelElevation, shapedElevation)
        : Math.min(tectonics.seaLevelElevation, shapedElevation);

      return {
        baseElevation: effectiveBaseElevation,
        ridgeRelief,
        riverCarve,
        elevation,
        seaLevel: tectonics.seaLevelElevation,
        isLand: isTectonicLand,
        isIce,
      };
  };

  return {
    sample(direction: IVec3): IPlanetSurfaceSample {
      const unitDirection = normalize(direction);
      return sampleAtCell(unitDirection, findCellAt(graph, unitDirection));
    },
    sampleNear(direction: IVec3, hintCellId: number): IPlanetSurfaceSample {
      const unitDirection = normalize(direction);
      return sampleAtCell(unitDirection, findCellNear(graph, unitDirection, hintCellId));
    },
  };
}
