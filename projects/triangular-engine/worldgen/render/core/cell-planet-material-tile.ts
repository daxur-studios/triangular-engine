/**
 * Framework-free world construction and material tile baking for the cell
 * planet streaming renderer. It lives in worldgen/render/core so Web Workers
 * in consuming games can bundle it without Angular framework dependencies.
 */
import {
  bakeTerrainMaterialTile,
  bilinearInterpolateScalar,
  evaluateTerrainMaterial,
  terrainMaterialColorRgb,
  type ITerrainMaterialColorOptions,
  type ITerrainMaterialOptions,
  type ITerrainMaterialPalette,
  type ITerrainMaterialTilePayload,
} from 'triangular-engine/terrain/core';
import {
  buildPlanetEcology,
  buildPlanetTectonics,
  computeFeatures,
  createPlanetSurfaceSampler,
  deriveIsLand,
  dot,
  findCellAt,
  generateImpactCraters,
  normalize,
  WORLD_PROFILES,
  type IImpactCraterResult,
  type IPlanetEcology,
  type IPlanetFeatures,
  type IPlanetGraphCell,
  type IPlanetGraphCore,
  type IPlanetSurfaceSampler,
  type IPlanetTectonics,
  type IVec3,
  type WorldProfileKind,
} from 'triangular-engine/worldgen';
import {
  biomeColor,
  elevationColor,
  lavaOceanColor,
  moistureColor,
  plateColor,
  temperatureColor,
} from './color-ramps';

export const OCEAN_COLOR = 'hsl(210, 55%, 22%)';

export type CellPlanetColorMode = 'natural' | 'elevation' | 'lod' | 'plates' | 'material' | 'heat' | 'moisture';

/** Material-only work is deliberately separate from mesh generation. */
export interface ICellPlanetMaterialTilePayload extends ITerrainMaterialTilePayload {
  /** Canonical unitless surface elevation relative to sea level at tile centre. */
  readonly centerElevation: number;
}

export interface IRiverMaterialPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly widthRadians: number;
}

/**
 * Per-cell material inputs, resolved once per world. The material rules read
 * the same discrete ecology signals for every texel inside a cell, so decoding
 * biome names and normalizing slope per texel was pure repeated work.
 */
export interface ICellMaterialInputs {
  /** `ecology.slope / maxSlope`. */
  readonly slope01: Float64Array;
  readonly moisture01: Float64Array;
  /** Temperature remapped from -1..1 to 0..1. */
  readonly temperature01: Float64Array;
  readonly snowIce01: Float64Array;
  readonly arid01: Float64Array;
  readonly ridge01: Float64Array;
  readonly river01: Float64Array;
}

export interface ICellPlanetWorld {
  /** `${profile}:${seed}`; also the material tiles' world revision. */
  readonly key: string;
  readonly graph: IPlanetGraphCore;
  readonly tectonics: IPlanetTectonics;
  readonly ecology: IPlanetEcology;
  readonly features: IPlanetFeatures;
  readonly sampler: IPlanetSurfaceSampler;
  readonly eMin: number;
  readonly eMax: number;
  readonly profile: (typeof WORLD_PROFILES)[WorldProfileKind];
  readonly maxSlope: number;
  readonly riverMask: Uint8Array;
  readonly ridgeCellSet: ReadonlySet<number>;
  readonly riverMaterialPoints: readonly IRiverMaterialPoint[];
  readonly riverMaterialBins: readonly (readonly number[])[];
  readonly cellInputs: ICellMaterialInputs;
  /** Constant material rule options, hoisted out of the per-texel closure. */
  readonly materialOptions: ITerrainMaterialOptions;
  readonly materialColorOptions: ITerrainMaterialColorOptions;
  /** Lazily built linear colour per cell for the flat colour modes (`natural`, `elevation`, `plates`). */
  readonly flatCellColours: Map<string, Float64Array>;
}

const RIVER_BIN_WIDTH = 64;
const RIVER_BIN_HEIGHT = 32;
const TILE_GUTTER_SIZE = 2;
/** Cell-id raster used by the cell-per-pixel material lookup. */
export const CELL_ID_RASTER_WIDTH = 1024;
export const CELL_ID_RASTER_HEIGHT = 512;

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

export function srgbChannelToLinear(channel: number): number {
  const c = Math.max(0, Math.min(1, channel));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function srgbRgbToLinear(rgb: readonly [number, number, number]): [number, number, number] {
  return [
    srgbChannelToLinear(rgb[0]),
    srgbChannelToLinear(rgb[1]),
    srgbChannelToLinear(rgb[2]),
  ];
}

export function parseColorToLinearRgb(color: string): [number, number, number] {
  if (color.startsWith('hsl')) {
    const match = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/.exec(color);
    if (match) {
      const h = parseFloat(match[1]) / 360;
      const s = parseFloat(match[2]) / 100;
      const l = parseFloat(match[3]) / 100;

      let r: number;
      let g: number;
      let b: number;
      if (s === 0) {
        r = g = b = l;
      } else {
        const hue2rgb = (p: number, q: number, t: number) => {
          let tc = t;
          if (tc < 0) tc += 1;
          if (tc > 1) tc -= 1;
          if (tc < 1 / 6) return p + (q - p) * 6 * tc;
          if (tc < 1 / 2) return q;
          if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      return [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
    }
  }

  let h = color.startsWith('#') ? color.slice(1) : color;
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return [0.5, 0.5, 0.5];
  const sR = ((num >> 16) & 255) / 255;
  const sG = ((num >> 8) & 255) / 255;
  const sB = (num & 255) / 255;
  return [srgbChannelToLinear(sR), srgbChannelToLinear(sG), srgbChannelToLinear(sB)];
}

export const ARCHETYPE_PALETTES: Record<string, ITerrainMaterialPalette> = {
  cratered_moon: {
    water: [0.18, 0.18, 0.2],
    sand: [0.22, 0.22, 0.25],
    grass: [0.45, 0.45, 0.48],
    rock: [0.65, 0.65, 0.68],
    snow: [0.82, 0.82, 0.86],
    desertSand: [0.22, 0.22, 0.25],
    lavaWater: [0.2, 0.2, 0.2],
  },
  martian: {
    water: [0.42, 0.22, 0.15],
    sand: [0.78, 0.38, 0.2],
    grass: [0.55, 0.28, 0.16],
    rock: [0.35, 0.18, 0.12],
    snow: [0.94, 0.94, 0.96],
    desertSand: [0.78, 0.38, 0.2],
    lavaWater: [0.85, 0.25, 0.05],
  },
  venusian: {
    water: [0.45, 0.32, 0.18],
    sand: [0.62, 0.44, 0.24],
    grass: [0.52, 0.38, 0.2],
    rock: [0.72, 0.54, 0.28],
    snow: [0.65, 0.45, 0.22],
    desertSand: [0.62, 0.44, 0.24],
    lavaWater: [0.9, 0.35, 0.05],
  },
  protoplanet: {
    water: [0.95, 0.32, 0.05],
    sand: [0.18, 0.12, 0.1],
    grass: [0.85, 0.3, 0.08],
    rock: [0.22, 0.12, 0.08],
    snow: [0.95, 0.32, 0.05],
    desertSand: [0.18, 0.12, 0.1],
    lavaWater: [0.95, 0.32, 0.05],
  },
};

export function getArchetypePalette(archetype?: string): ITerrainMaterialPalette | undefined {
  return archetype ? ARCHETYPE_PALETTES[archetype] : undefined;
}

// ---------------------------------------------------------------------------
// World construction
// ---------------------------------------------------------------------------

function buildRiverMaterialMask(graph: IPlanetGraphCore, ecology: IPlanetEcology): Uint8Array {
  const mask = new Uint8Array(graph.cells.length);
  const thresholdCos = Math.cos(0.09);
  for (const cell of graph.cells) {
    for (const path of ecology.riverPaths) {
      if (path.some((point) => cell.center.x * point.x + cell.center.y * point.y + cell.center.z * point.z >= thresholdCos)) {
        mask[cell.id] = 1;
        break;
      }
    }
  }
  return mask;
}

function riverBinIndex(longitude: number, latitude: number): number {
  const wrappedU = ((longitude + Math.PI) / (Math.PI * 2)) % 1;
  const u = Math.min(RIVER_BIN_WIDTH - 1, Math.max(0, Math.floor((wrappedU < 0 ? wrappedU + 1 : wrappedU) * RIVER_BIN_WIDTH)));
  const v = Math.min(
    RIVER_BIN_HEIGHT - 1,
    Math.max(0, Math.floor(((latitude + Math.PI / 2) / Math.PI) * RIVER_BIN_HEIGHT)),
  );
  return v * RIVER_BIN_WIDTH + u;
}

function directionLongitude(direction: IVec3): number {
  return Math.atan2(direction.x, direction.z);
}

function directionLatitude(direction: IVec3): number {
  return Math.asin(Math.max(-1, Math.min(1, direction.y)));
}

function buildRiverMaterialIndex(ecology: IPlanetEcology): [IRiverMaterialPoint[], number[][]] {
  const points: IRiverMaterialPoint[] = [];
  const bins = Array.from({ length: RIVER_BIN_WIDTH * RIVER_BIN_HEIGHT }, () => [] as number[]);
  let maxFlow = 1;
  for (const flow of ecology.riverFlow) {
    for (const value of flow) maxFlow = Math.max(maxFlow, value);
  }

  const addPoint = (point: IVec3, flow: number) => {
    const widthRadians = 0.0035 + Math.sqrt(Math.max(0, flow) / maxFlow) * 0.012;
    const index = points.push({ x: point.x, y: point.y, z: point.z, widthRadians }) - 1;
    bins[riverBinIndex(directionLongitude(point), directionLatitude(point))].push(index);
  };

  for (let pathIndex = 0; pathIndex < ecology.riverPaths.length; pathIndex += 1) {
    const path = ecology.riverPaths[pathIndex];
    const flow = ecology.riverFlow[pathIndex] ?? [];
    for (let pointIndex = 0; pointIndex < path.length; pointIndex += 1) {
      const point = path[pointIndex];
      addPoint(point, flow[pointIndex] ?? 1);
      if (pointIndex + 1 < path.length) {
        const next = path[pointIndex + 1];
        addPoint(normalize({
          x: point.x + next.x,
          y: point.y + next.y,
          z: point.z + next.z,
        }), ((flow[pointIndex] ?? 1) + (flow[pointIndex + 1] ?? 1)) * 0.5);
      }
    }
  }
  return [points, bins];
}

function buildCellMaterialInputs(
  graph: IPlanetGraphCore,
  ecology: IPlanetEcology,
  maxSlope: number,
  riverMask: Uint8Array,
  ridgeCellSet: ReadonlySet<number>,
): ICellMaterialInputs {
  const count = graph.cells.length;
  const slope01 = new Float64Array(count);
  const moisture01 = new Float64Array(count);
  const temperature01 = new Float64Array(count);
  const snowIce01 = new Float64Array(count);
  const arid01 = new Float64Array(count);
  const ridge01 = new Float64Array(count);
  const river01 = new Float64Array(count);
  for (let id = 0; id < count; id += 1) {
    const biome = ecology.biome[id];
    slope01[id] = maxSlope > 0 ? (ecology.slope[id] ?? 0) / maxSlope : 0;
    moisture01[id] = ecology.moisture[id] ?? 0.5;
    temperature01[id] = ((ecology.temperature[id] ?? 0) + 1) * 0.5;
    snowIce01[id] = biome === 'ice_cap' ? 1 : biome === 'glacier' ? 0.9 : biome === 'tundra' ? 0.35 : 0;
    arid01[id] = biome === 'desert' ? 1 : biome === 'steppe' ? 0.45 : biome === 'savanna' ? 0.25 : 0;
    ridge01[id] = ridgeCellSet.has(id) ? 1 : 0;
    river01[id] = riverMask[id] ?? 0;
  }
  return { slope01, moisture01, temperature01, snowIce01, arid01, ridge01, river01 };
}

/**
 * Builds a world for `profileKind` on an already built (seed-shared) `graph`.
 * The graph depends only on the seed, so callers share it across archetypes.
 */
export function createCellPlanetWorld(
  profileKind: WorldProfileKind,
  seed: number,
  graph: IPlanetGraphCore,
  plateCount = 14,
): ICellPlanetWorld {
  const key = `${profileKind}:${seed}`;
  const profile = WORLD_PROFILES[profileKind] ?? WORLD_PROFILES.volcanic;
  const tectonics = buildPlanetTectonics(graph, {
    plateCount,
    seed,
    ...profile.tectonics,
  });

  let impactCraters: IImpactCraterResult | undefined;
  if (profile.impactCraters) {
    impactCraters = generateImpactCraters(graph, tectonics.elevation, {
      seed,
      ...profile.impactCraters,
    });
    tectonics.elevation = impactCraters.elevation;
  }

  tectonics.isLand = deriveIsLand(
    graph,
    tectonics.elevation,
    tectonics.seaLevelElevation,
    profile.tectonics?.minRegionCellFraction,
  );
  const ecology = buildPlanetEcology(graph, tectonics, {
    climate: profile.climate,
    biomes: {
      archetype: profile.archetype,
      ...profile.biomes,
      craterLandform: impactCraters?.craterLandform,
    },
  });
  const features = computeFeatures(graph, tectonics, ecology.waterBodyKind, profile.features);
  const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
    features,
    featureComposition: 'cell',
  });

  let eMin = Infinity;
  let eMax = -Infinity;
  for (const e of tectonics.elevation) {
    eMin = Math.min(eMin, e);
    eMax = Math.max(eMax, e);
  }
  const [riverMaterialPoints, riverMaterialBins] = buildRiverMaterialIndex(ecology);
  const maxSlope = ecology.slope.reduce((max, slope) => Math.max(max, slope), 0);
  const riverMask = buildRiverMaterialMask(graph, ecology);
  const ridgeCellSet = new Set(tectonics.ridgeCellIds);
  return {
    key,
    graph,
    tectonics,
    ecology,
    features,
    sampler,
    eMin,
    eMax,
    profile,
    maxSlope,
    riverMask,
    ridgeCellSet,
    riverMaterialPoints,
    riverMaterialBins,
    cellInputs: buildCellMaterialInputs(graph, ecology, maxSlope, riverMask, ridgeCellSet),
    materialOptions: {
      snowlineM: tectonics.seaLevelElevation + Math.max(1, eMax - tectonics.seaLevelElevation) * 0.68,
      snowlineBlendM: Math.max(0.05, (eMax - tectonics.seaLevelElevation) * 0.16),
    },
    materialColorOptions: {
      oceanSubstance: profile.oceanSubstance,
      palette: getArchetypePalette(profile.archetype),
    },
    flatCellColours: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Sampling helpers
// ---------------------------------------------------------------------------

/** Ultra-fast convex hill-climbing nearest-cell search on a spherical Voronoi graph. */
export function findNearestCellFast(
  graph: IPlanetGraphCore,
  direction: IVec3,
  startCell: IPlanetGraphCell | null,
): IPlanetGraphCell {
  let current = startCell ?? graph.cells[0];
  let currentDot = dot(current.center, direction);

  let improved = true;
  let iters = 0;
  while (improved && iters < 50) {
    improved = false;
    iters += 1;
    for (const neighborId of current.neighbors) {
      const neighbor = graph.cells[neighborId];
      const d = dot(neighbor.center, direction);
      if (d > currentDot) {
        currentDot = d;
        current = neighbor;
        improved = true;
      }
    }
  }
  return current;
}

export function sampleSurfaceNear(
  sampler: IPlanetSurfaceSampler,
  direction: IVec3,
  hintCellId: number,
): ReturnType<IPlanetSurfaceSampler['sample']> {
  return sampler.sampleNear?.(direction, hintCellId) ?? sampler.sample(direction);
}

function narrowRiverInfluence(world: ICellPlanetWorld, direction: IVec3): number {
  if (world.riverMaterialPoints.length === 0) return 0;
  const longitude = directionLongitude(direction);
  const latitude = directionLatitude(direction);
  const u = Math.floor((((longitude + Math.PI) / (Math.PI * 2)) % 1 + 1) % 1 * RIVER_BIN_WIDTH);
  const v = Math.min(
    RIVER_BIN_HEIGHT - 1,
    Math.max(0, Math.floor(((latitude + Math.PI / 2) / Math.PI) * RIVER_BIN_HEIGHT)),
  );
  let best = 0;
  for (let dv = -1; dv <= 1; dv += 1) {
    const candidateV = v + dv;
    if (candidateV < 0 || candidateV >= RIVER_BIN_HEIGHT) continue;
    for (let du = -1; du <= 1; du += 1) {
      const candidateU = (u + du + RIVER_BIN_WIDTH) % RIVER_BIN_WIDTH;
      for (const pointIndex of world.riverMaterialBins[candidateV * RIVER_BIN_WIDTH + candidateU]) {
        const point = world.riverMaterialPoints[pointIndex];
        const angularDistance = Math.sqrt(Math.max(0, 2 - 2 *
          (direction.x * point.x + direction.y * point.y + direction.z * point.z)));
        const width = point.widthRadians;
        const t = Math.max(0, Math.min(1, (width - angularDistance) / Math.max(width * 0.65, 1e-5)));
        best = Math.max(best, t * t * (3 - 2 * t));
      }
    }
  }
  return best;
}

export function evaluateWorldMaterial(
  world: ICellPlanetWorld,
  sample: ReturnType<IPlanetSurfaceSampler['sample']>,
  cellId: number,
  river01Override?: number,
  slope01Override?: number,
  slopeInfluence = 1,
) {
  const inputs = world.cellInputs;
  const cellSlope01 = inputs.slope01[cellId];
  const slope01 = slope01Override === undefined
    ? cellSlope01
    : cellSlope01 + (slope01Override - cellSlope01) * Math.max(0, Math.min(1, slopeInfluence));
  const isWaterCell = !sample.isLand && !sample.isIce;
  const waterSideElevation = Math.min(
    sample.elevation,
    sample.seaLevel - Math.max(1e-5, Math.abs(sample.seaLevel) * 1e-7),
  );
  return evaluateTerrainMaterial({
    elevationM: isWaterCell ? waterSideElevation : sample.elevation,
    seaLevelM: sample.seaLevel,
    minElevationM: world.eMin,
    maxElevationM: world.eMax,
    slope01,
    moisture01: inputs.moisture01[cellId],
    temperature01: inputs.temperature01[cellId],
    snowIce01: inputs.snowIce01[cellId],
    arid01: inputs.arid01[cellId],
    ridge01: inputs.ridge01[cellId],
    river01: river01Override ?? inputs.river01[cellId],
  }, world.materialOptions);
}

function sampleLocalSlope01(
  sampler: IPlanetSurfaceSampler,
  direction: IVec3,
  sample: ReturnType<IPlanetSurfaceSampler['sample']>,
  hintCellId: number,
  angularStep: number,
  radiusM: number,
  heightScaleM: number,
): number {
  if (!sample.isLand) return 0;
  const reference = Math.abs(direction.y) < 0.9
    ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 };
  const tangentX = normalize({
    x: reference.y * direction.z - reference.z * direction.y,
    y: reference.z * direction.x - reference.x * direction.z,
    z: reference.x * direction.y - reference.y * direction.x,
  });
  const tangentZ = normalize({
    x: direction.y * tangentX.z - direction.z * tangentX.y,
    y: direction.z * tangentX.x - direction.x * tangentX.z,
    z: direction.x * tangentX.y - direction.y * tangentX.x,
  });
  const sampleOffset = (tangent: IVec3) => sampleSurfaceNear(
    sampler,
    normalize({
      x: direction.x + tangent.x * angularStep,
      y: direction.y + tangent.y * angularStep,
      z: direction.z + tangent.z * angularStep,
    }),
    hintCellId,
  );
  const tangentSample = sampleOffset(tangentX);
  const bitangentSample = sampleOffset(tangentZ);
  const tangentDistanceM = Math.max(1, radiusM * angularStep);
  const dx = (tangentSample.elevation - sample.elevation) * heightScaleM / tangentDistanceM;
  const dz = (bitangentSample.elevation - sample.elevation) * heightScaleM / tangentDistanceM;
  return Math.min(1, Math.atan(Math.hypot(dx, dz)) / (Math.PI * 0.5));
}

// ---------------------------------------------------------------------------
// Flat per-cell colours (natural / elevation / plates)
// ---------------------------------------------------------------------------

function getFlatCellColours(world: ICellPlanetWorld, mode: 'elevation' | 'plates' | 'natural' | 'heat' | 'moisture'): Float64Array {
  const cached = world.flatCellColours.get(mode);
  if (cached) return cached;
  const { graph, tectonics, ecology, eMin, eMax } = world;
  const colours = new Float64Array(graph.cells.length * 3);
  for (const cell of graph.cells) {
    let linear: readonly [number, number, number];
    if (mode === 'elevation') {
      linear = parseColorToLinearRgb(elevationColor(
        tectonics.elevation[cell.id] ?? tectonics.seaLevelElevation,
        tectonics.seaLevelElevation,
        eMin,
        eMax,
      ));
    } else if (mode === 'plates') {
      linear = parseColorToLinearRgb(plateColor(tectonics.plateIdByCell[cell.id] ?? 0));
    } else if (mode === 'heat') {
      linear = parseColorToLinearRgb(temperatureColor(ecology.temperature[cell.id] ?? 0));
    } else if (mode === 'moisture') {
      linear = parseColorToLinearRgb(moistureColor(ecology.moisture[cell.id] ?? 0));
    } else {
      linear = parseColorToLinearRgb(biomeColor(ecology.biome[cell.id]));
    }
    colours[cell.id * 3] = linear[0];
    colours[cell.id * 3 + 1] = linear[1];
    colours[cell.id * 3 + 2] = linear[2];
  }
  world.flatCellColours.set(mode, colours);
  return colours;
}

function oceanLinearColour(world: ICellPlanetWorld): [number, number, number] {
  return parseColorToLinearRgb(world.profile.oceanSubstance === 'lava' ? lavaOceanColor() : OCEAN_COLOR);
}

// ---------------------------------------------------------------------------
// Material tile bake
// ---------------------------------------------------------------------------

const RIVER_COLOUR: readonly [number, number, number] = [0.06, 0.18, 0.32];
const LONGITUDE_RANGE = Math.PI * 2;

export function buildMaterialTile(
  world: ICellPlanetWorld,
  colorMode: CellPlanetColorMode,
  interiorSize: number,
  tileX: number,
  tileY: number,
  tileGrid: readonly [number, number],
  radiusM: number,
  heightScaleM: number,
  cliffStrength = 1,
  cliffDebug = false,
): ICellPlanetMaterialTilePayload | undefined {
  if (colorMode === 'lod') return undefined;
  const [gridX, gridY] = tileGrid;
  const { graph, sampler } = world;
  const slopeStep = 0.0025;
  const slopeCacheStep = 4;
  const cliffScale = Math.max(0, Math.min(1, cliffStrength));
  const sampleLocalSlope = cliffScale > 0 || cliffDebug;

  const latticeOriginX = Math.floor((tileX * interiorSize - TILE_GUTTER_SIZE) / slopeCacheStep) - 2;
  const latticeOriginY = Math.floor((tileY * interiorSize - TILE_GUTTER_SIZE) / slopeCacheStep) - 2;
  const latticeSpan = Math.ceil((interiorSize + TILE_GUTTER_SIZE * 2) / slopeCacheStep) + 6;
  const lattice = new Float64Array(latticeSpan * latticeSpan).fill(NaN);
  let latticeCell: IPlanetGraphCell | null = null;
  let texelCell: IPlanetGraphCell | null = null;

  const evaluateLattice = (gridPixelX: number, gridPixelY: number): number => {
    const gridU = (gridPixelX + 0.5) / (gridX * interiorSize);
    const gridV = (gridPixelY + 0.5) / (gridY * interiorSize);
    const gridLongitude = (gridU - Math.floor(gridU)) * LONGITUDE_RANGE - Math.PI;
    const gridLatitude = Math.max(-Math.PI / 2, Math.min(
      Math.PI / 2,
      gridV * Math.PI - Math.PI / 2,
    ));
    const cosLat = Math.cos(gridLatitude);
    const gridDir3: IVec3 = {
      x: cosLat * Math.sin(gridLongitude),
      y: Math.sin(gridLatitude),
      z: cosLat * Math.cos(gridLongitude),
    };
    const gridCell = findNearestCellFast(graph, gridDir3, latticeCell ?? texelCell);
    latticeCell = gridCell;
    const gridSample = sampleSurfaceNear(sampler, gridDir3, gridCell.id);
    return sampleLocalSlope01(sampler, gridDir3, gridSample, gridCell.id, slopeStep, radiusM, heightScaleM);
  };
  const readLattice = (latticeX: number, latticeY: number): number => {
    const ix = latticeX - latticeOriginX;
    const iy = latticeY - latticeOriginY;
    if (ix < 0 || iy < 0 || ix >= latticeSpan || iy >= latticeSpan) {
      return evaluateLattice(latticeX * slopeCacheStep, latticeY * slopeCacheStep);
    }
    const index = iy * latticeSpan + ix;
    let value = lattice[index];
    if (value !== value) {
      value = evaluateLattice(latticeX * slopeCacheStep, latticeY * slopeCacheStep);
      lattice[index] = value;
    }
    return value;
  };
  const sampleSlopeLattice = (x: number, y: number): number => {
    const gx = Math.floor(x / slopeCacheStep);
    const gy = Math.floor(y / slopeCacheStep);
    const x01 = x / slopeCacheStep - gx;
    const y01 = y / slopeCacheStep - gy;
    return bilinearInterpolateScalar(
      readLattice(gx, gy),
      readLattice(gx + 1, gy),
      readLattice(gx, gy + 1),
      readLattice(gx + 1, gy + 1),
      x01,
      y01,
    );
  };

  const lineCount = interiorSize + TILE_GUTTER_SIZE * 2;
  const columnLocalU = new Float64Array(lineCount).fill(NaN);
  const columnSin = new Float64Array(lineCount);
  const columnCos = new Float64Array(lineCount);
  let rowLocalV = NaN;
  let rowSin = 0;
  let rowCos = 0;
  const texelDirection: IVec3 = { x: 0, y: 0, z: 0 };
  const resolveTexelDirection = (localU: number, localV: number): IVec3 => {
    if (localV !== rowLocalV) {
      const globalV = (tileY + localV) / gridY;
      const latitude = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, globalV * Math.PI - Math.PI / 2));
      rowSin = Math.sin(latitude);
      rowCos = Math.cos(latitude);
      rowLocalV = localV;
    }
    const column = Math.round(localU * interiorSize + TILE_GUTTER_SIZE - 0.5);
    let sinLon: number;
    let cosLon: number;
    if (column >= 0 && column < lineCount && columnLocalU[column] === localU) {
      sinLon = columnSin[column];
      cosLon = columnCos[column];
    } else {
      const globalU = (tileX + localU) / gridX;
      const longitude = (globalU - Math.floor(globalU)) * LONGITUDE_RANGE - Math.PI;
      sinLon = Math.sin(longitude);
      cosLon = Math.cos(longitude);
      if (column >= 0 && column < lineCount) {
        columnLocalU[column] = localU;
        columnSin[column] = sinLon;
        columnCos[column] = cosLon;
      }
    }
    texelDirection.x = rowCos * sinLon;
    texelDirection.y = rowSin;
    texelDirection.z = rowCos * cosLon;
    return texelDirection;
  };

  const flatColours = colorMode === 'natural' || colorMode === 'elevation' || colorMode === 'plates' || colorMode === 'heat' || colorMode === 'moisture'
    ? getFlatCellColours(world, colorMode)
    : undefined;
  const oceanColour = colorMode === 'natural' ? oceanLinearColour(world) : undefined;
  const volcanoRimMinHeight = Math.max(3, heightScaleM * 0.28);
  const featureByCellId = world.features.featureByCellId;
  const materialColorOptions = world.materialColorOptions;
  const colour: [number, number, number] = [0, 0, 0];
  const riverTint = RIVER_COLOUR;

  const payload = bakeTerrainMaterialTile(
    {
      worldRevision: world.key,
      address: { level: Math.round(Math.log2(gridX)), x: tileX, y: tileY },
      styleRevision: `cell-planet-${colorMode}-v1`,
      samplingVersion: 1,
      format: 'rgba8-linear',
    },
    {
      sample: (localU, localV) => {
        const dir3 = resolveTexelDirection(localU, localV);
        const cell = findNearestCellFast(graph, dir3, texelCell);
        texelCell = cell;
        if (colorMode === 'elevation' || colorMode === 'plates' || colorMode === 'heat' || colorMode === 'moisture') {
          colour[0] = flatColours![cell.id * 3];
          colour[1] = flatColours![cell.id * 3 + 1];
          colour[2] = flatColours![cell.id * 3 + 2];
          return colour;
        }
        const sample = sampleSurfaceNear(sampler, dir3, cell.id);
        if (colorMode === 'natural') {
          if (!sample.isLand && !sample.isIce) {
            colour[0] = oceanColour![0];
            colour[1] = oceanColour![1];
            colour[2] = oceanColour![2];
            return colour;
          }
          const feature = featureByCellId.get(cell.id);
          if (feature?.kind === 'volcano') {
            const displayedHeight = (sample.elevation - sample.seaLevel) * heightScaleM;
            if (displayedHeight > volcanoRimMinHeight) {
              colour[0] = 0.46; colour[1] = 0.22; colour[2] = 0.16;
            } else {
              colour[0] = 0.12; colour[1] = 0.11; colour[2] = 0.12;
            }
            return colour;
          }
          colour[0] = flatColours![cell.id * 3];
          colour[1] = flatColours![cell.id * 3 + 1];
          colour[2] = flatColours![cell.id * 3 + 2];
          return colour;
        }
        const river01 = sample.isLand ? narrowRiverInfluence(world, dir3) : 0;
        const globalPixelX = (tileX + localU) * interiorSize - 0.5;
        const globalPixelY = (tileY + localV) * interiorSize - 0.5;
        const slope01 = sampleLocalSlope
          ? sampleSlopeLattice(globalPixelX, globalPixelY)
          : undefined;
        if (cliffDebug) {
          const debugSlope = slope01 ?? 0;
          colour[0] = srgbChannelToLinear(debugSlope);
          colour[1] = colour[0];
          colour[2] = colour[0];
          return colour;
        }
        const material = evaluateWorldMaterial(world, sample, cell.id, river01, slope01, cliffScale);
        const base = terrainMaterialColorRgb(material, materialColorOptions);
        const cliff = Math.max(0, Math.min(1, ((slope01 ?? 0) - 0.28) * 1.45)) * cliffScale;
        const river = river01 * river01;
        const cliffShade = 1 - cliff * 0.2;
        colour[0] = srgbChannelToLinear((base[0] * (1 - river) + riverTint[0] * river) * cliffShade);
        colour[1] = srgbChannelToLinear((base[1] * (1 - river) + riverTint[1] * river) * cliffShade);
        colour[2] = srgbChannelToLinear((base[2] * (1 - river) + riverTint[2] * river) * cliffShade);
        return colour;
      },
    },
    {
      interiorSize,
      gutterSize: TILE_GUTTER_SIZE,
      mipLevels: 0,
    },
  );
  const centerLongitude = ((tileX + 0.5) / gridX - 0.5) * Math.PI * 2;
  const centerLatitude = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, ((tileY + 0.5) / gridY - 0.5) * Math.PI));
  const centerCosLat = Math.cos(centerLatitude);
  const surface = sampler.sample({
    x: centerCosLat * Math.sin(centerLongitude),
    y: Math.sin(centerLatitude),
    z: centerCosLat * Math.cos(centerLongitude),
  });
  return { ...payload, centerElevation: surface.elevation - surface.seaLevel };
}

// ---------------------------------------------------------------------------
// Cell-per-pixel lookup
// ---------------------------------------------------------------------------

export function buildCellIdRaster(graph: IPlanetGraphCore): Uint8Array {
  const width = CELL_ID_RASTER_WIDTH;
  const height = CELL_ID_RASTER_HEIGHT;
  const cellIdData = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const latitude = -Math.PI / 2 + ((y + 0.5) / height) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    let previousCell = findCellAt(graph, {
      x: cosLatitude * Math.sin(-Math.PI),
      y: Math.sin(latitude),
      z: cosLatitude * Math.cos(-Math.PI),
    });
    for (let x = 0; x < width; x += 1) {
      const longitude = -Math.PI + ((x + 0.5) / width) * Math.PI * 2;
      const direction: IVec3 = {
        x: cosLatitude * Math.sin(longitude),
        y: Math.sin(latitude),
        z: cosLatitude * Math.cos(longitude),
      };
      previousCell = findNearestCellFast(graph, direction, previousCell);
      const offset = (y * width + x) * 4;
      cellIdData[offset] = previousCell.id & 255;
      cellIdData[offset + 1] = (previousCell.id >> 8) & 255;
      cellIdData[offset + 3] = 255;
    }
  }
  return cellIdData;
}

export function buildCellColourData(
  world: ICellPlanetWorld,
  colorMode: Exclude<CellPlanetColorMode, 'lod'>,
): Float32Array {
  const { graph, tectonics, ecology, sampler, eMin, eMax, profile } = world;
  const cellData = new Float32Array(graph.cells.length * 4);

  for (const cell of graph.cells) {
    let colour: readonly [number, number, number];
    if (colorMode === 'elevation') {
      colour = parseColorToLinearRgb(
        elevationColor(
          tectonics.elevation[cell.id] ?? sampler.sample(cell.center).seaLevel,
          tectonics.seaLevelElevation,
          eMin,
          eMax,
        ),
      );
    } else if (colorMode === 'plates') {
      colour = parseColorToLinearRgb(plateColor(tectonics.plateIdByCell[cell.id] ?? 0));
    } else if (colorMode === 'material') {
      const sample = sampleSurfaceNear(sampler, cell.center, cell.id);
      const material = evaluateWorldMaterial(world, sample, cell.id);
      colour = srgbRgbToLinear(terrainMaterialColorRgb(material, world.materialColorOptions));
    } else {
      const sample = sampleSurfaceNear(sampler, cell.center, cell.id);
      colour = sample.isLand || sample.isIce
        ? parseColorToLinearRgb(biomeColor(ecology.biome[cell.id]))
        : parseColorToLinearRgb(profile.oceanSubstance === 'lava' ? lavaOceanColor() : OCEAN_COLOR);
    }

    const colourOffset = cell.id * 4;
    cellData[colourOffset] = colour[0];
    cellData[colourOffset + 1] = colour[1];
    cellData[colourOffset + 2] = colour[2];
    cellData[colourOffset + 3] = 1;
  }
  return cellData;
}
