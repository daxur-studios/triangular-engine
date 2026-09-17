import {
  WORLD_PROFILES,
  IPlanetEcology,
  IPlanetGraphCore,
  IPlanetTectonics,
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  computeFeatures,
  deriveIsLand,
  IVec3,
} from 'triangular-engine/worldgen';
import { CELL_PLANET_GENERATION_DEFAULTS } from './cell-planet-generation-config';

/** Stable bookmark names used by the unified cell-terrain review tour. */
export type CellPlanetU0BookmarkId =
  | 'overview'
  | 'local-mountain'
  | 'volcano'
  | 'mesa'
  | 'canyon'
  | 'ridge-crossing'
  | 'river-bend'
  | 'river-junction'
  | 'river-mouth'
  | 'shore'
  | 'chunk-seam'
  | 'sphere-face-edge'
  | 'sphere-face-corner';

export interface ICellPlanetU0Bookmark {
  readonly id: CellPlanetU0BookmarkId;
  readonly label: string;
  /** Normalized map position. The map adapter scales this to its current footprint. */
  readonly mapPosition: readonly [xFraction: number, yFraction: number];
  /** Stable planet direction. Later feature instances should use these same anchors. */
  readonly direction: IVec3;
  /** Camera distance as a multiple of planet radius for the spherical inspection view. */
  readonly cameraRadiusFactor: number;
  /** Intended map zoom for the 2D identity/reference view. */
  readonly mapZoom: number;
}

function normalize(x: number, y: number, z: number): IVec3 {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function mapPosition(direction: IVec3): readonly [number, number] {
  const longitude = Math.atan2(direction.z, direction.x);
  const latitude = Math.asin(Math.max(-1, Math.min(1, direction.y)));
  // The planar adapter uses a y-down equirectangular map, while its 3D target uses z-up
  // from the map centre. Keep the sign conversion here so both consumers aim at the same point.
  return [longitude / Math.PI, -latitude / (Math.PI * 0.5)];
}

function middlePoint(path: readonly IVec3[]): IVec3 | null {
  if (path.length === 0) return null;
  return path[Math.floor(path.length * 0.5)] ?? null;
}

function buildFixtureWorld(): {
  readonly graph: IPlanetGraphCore;
  readonly tectonics: IPlanetTectonics;
  readonly ecology: IPlanetEcology;
  readonly featureCells: ReadonlyMap<'volcano' | 'mesa', number>;
} {
  const profile = WORLD_PROFILES.volcanic;
  const graph = buildPlanetGraphCore({
    cellCount: CELL_PLANET_GENERATION_DEFAULTS.cellCount,
    seed: CELL_PLANET_GENERATION_DEFAULTS.seed,
    relaxationIterations: CELL_PLANET_GENERATION_DEFAULTS.relaxationIterations,
    jitter: CELL_PLANET_GENERATION_DEFAULTS.jitter,
  });
  const tectonics = buildPlanetTectonics(graph, {
    plateCount: CELL_PLANET_GENERATION_DEFAULTS.plateCount,
    seed: CELL_PLANET_GENERATION_DEFAULTS.seed,
    ...profile.tectonics,
  });
  tectonics.isLand = deriveIsLand(
    graph,
    tectonics.elevation,
    tectonics.seaLevelElevation,
    profile.tectonics?.minRegionCellFraction,
  );
  const ecology = buildPlanetEcology(graph, tectonics, {
    climate: profile.climate,
    biomes: profile.biomes,
  });
  const features = computeFeatures(graph, tectonics, ecology.waterBodyKind, profile.features);
  const featureCells = new Map<'volcano' | 'mesa', number>();
  for (const instance of features.instances) {
    if ((instance.kind === 'volcano' || instance.kind === 'mesa') && !featureCells.has(instance.kind)) {
      featureCells.set(instance.kind, instance.siteCellId);
    }
  }
  return { graph, tectonics, ecology, featureCells };
}

function resolveFixtureBookmarks(): readonly ICellPlanetU0Bookmark[] {
  const { graph, tectonics, ecology, featureCells } = buildFixtureWorld();
  const landCells = graph.cells
    .filter((cell) => tectonics.isLand[cell.id])
    .sort((a, b) => tectonics.elevation[b.id] - tectonics.elevation[a.id]);
  const highestLand = landCells[0]?.center ?? normalize(1, 0, 0);
  const volcano = graph.cells[featureCells.get('volcano') ?? landCells[1]?.id ?? landCells[0]?.id ?? 0]?.center ?? highestLand;
  const mesa = graph.cells[featureCells.get('mesa') ?? landCells[2]?.id ?? landCells[0]?.id ?? 0]?.center ?? highestLand;
  const ridge = middlePoint(ecology.ridgePaths.find((path) => path.length > 2) ?? []) ?? highestLand;
  const riverPaths = ecology.riverPaths.slice().sort((a, b) => b.length - a.length);
  const river = riverPaths[0] ?? [];
  const tributary = riverPaths.find((path, index) => ecology.riverParent[index] !== null) ?? river;
  const riverBend = middlePoint(river) ?? highestLand;
  const riverJunction = middlePoint(tributary) ?? riverBend;
  const riverMouth = river[river.length - 2] ?? river[river.length - 1] ?? riverBend;
  const shore = middlePoint(ecology.coastlines[0] ?? []) ?? highestLand;
  const direction = (value: IVec3): IVec3 => normalize(value.x, value.y, value.z);
  const make = (
    id: CellPlanetU0BookmarkId,
    label: string,
    point: IVec3,
    cameraRadiusFactor: number,
    mapZoom: number,
  ): ICellPlanetU0Bookmark => {
    const stableDirection = direction(point);
    return { id, label, mapPosition: mapPosition(stableDirection), direction: stableDirection, cameraRadiusFactor, mapZoom };
  };

  return [
    make('overview', 'Overview', normalize(1, 0, 0), 4.8, 1),
    make('local-mountain', 'Local mountain', highestLand, 0.42, 3),
    make('volcano', 'Volcano cell', volcano, 0.28, 5),
    make('mesa', 'Mesa cell', mesa, 0.28, 5),
    make('canyon', 'Canyon cell (U2 placeholder)', normalize(0.82, 0.12, 0.56), 0.24, 5),
    make('ridge-crossing', 'Ridge crossing', ridge, 0.34, 3.5),
    make('river-bend', 'River bend', riverBend, 0.24, 5),
    make('river-junction', 'River junction', riverJunction, 0.22, 5),
    make('river-mouth', 'River mouth', riverMouth, 0.24, 5),
    make('shore', 'Shoreline', shore, 0.3, 4),
    make('chunk-seam', 'Chunk seam', normalize(0.9, 0.38, 0.2), 0.38, 3),
    make('sphere-face-edge', 'Sphere face edge', normalize(0.58, -0.46, -0.67), 0.34, 3),
    make('sphere-face-corner', 'Sphere face corner', normalize(0.58, -0.46, 0.67), 0.34, 3),
  ];
}

/**
 * Small fixed fixture for U0 repeatability. The anchors are resolved once from the exact shared
 * generator inputs, then frozen as review coordinates. Existing generator outputs are used for
 * volcano/mesa cells, ridges, rivers and coastlines; the canyon anchor remains reserved for U2.
 */
export const CELL_PLANET_U0_FIXTURE = {
  id: 'cell-planet-u0-acceptance',
  version: 2,
  cellCount: 1500,
  seed: 1,
  relaxationIterations: 2,
  worldProfile: 'volcanic' as const,
  worldSize: 'medium' as const,
  displayScale: 'planet' as const,
  projection: 'equirectangular' as const,
  terrainQuality: 'standard' as const,
  terrainHeightScale: 4,
  waterLevel: 0,
  showOcean: true,
  bookmarks: resolveFixtureBookmarks(),
} as const;

export const CELL_PLANET_U0_BOOKMARK_IDS = CELL_PLANET_U0_FIXTURE.bookmarks.map(
  (bookmark) => bookmark.id,
) as readonly CellPlanetU0BookmarkId[];

export function getCellPlanetU0Bookmark(id: CellPlanetU0BookmarkId): ICellPlanetU0Bookmark {
  return CELL_PLANET_U0_FIXTURE.bookmarks.find((bookmark) => bookmark.id === id) ?? CELL_PLANET_U0_FIXTURE.bookmarks[0];
}
