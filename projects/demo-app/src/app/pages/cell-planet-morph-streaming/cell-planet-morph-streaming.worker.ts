/// <reference lib="webworker" />

import { BufferAttribute, BufferGeometry } from 'three';
import { simplifyIndexedGeometry } from 'triangular-engine/meshoptimizer';
import {
  conformPatchEdges,
  createIndices,
  bakeTerrainMaterialTile,
  LatLonTerrainDomain,
  evaluateTerrainMaterial,
  terrainMaterialColorRgb,
  type ILatLonTerrainPatchAddress,
  type ITerrainMaterialTilePayload,
  type ITerrainPatchGeometry,
  type ITerrainPatchMesh,
  type ITerrainSurfaceGenerationRequest,
} from 'triangular-engine/terrain/core';
import {
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  computeFeatures,
  createPlanetSurfaceSampler,
  deriveIsLand,
  dot,
  findCellAt,
  WORLD_PROFILES,
  type IPlanetGraphCell,
  type IPlanetGraphCore,
  type IPlanetTectonics,
  type IPlanetEcology,
  type IPlanetFeatures,
  type IPlanetSurfaceSampler,
  type IVec3,
  type WorldProfileKind,
} from 'triangular-engine/worldgen';
import {
  biomeColor,
  elevationColor,
  plateColor,
  lavaOceanColor,
  EQUAL_EARTH_PROJECTION,
  EQUIRECTANGULAR_PROJECTION,
  type ICellPerPixelLookupPayload,
  type MapProjectionKind,
} from 'triangular-engine/worldgen/render/core';
import { CELL_PLANET_GENERATION_DEFAULTS } from '../cell-planet-generation-config';
import { CELL_PLANET_U0_FIXTURE } from '../cell-planet-u0-fixture';

const OCEAN_COLOR = 'hsl(210, 55%, 22%)';

export interface CellPlanetMorphWorkerRequest {
  readonly id: number;
  readonly address: ILatLonTerrainPatchAddress;
  readonly radius: number;
  readonly baseResolution: number;
  readonly resolution: number;
  readonly edgeRefinementMask: number;
  readonly edgeRefinementLevel: number;
  readonly edgeRefinementLevels: readonly [number, number, number, number];
  readonly edgeRefinementSegments: ITerrainSurfaceGenerationRequest<ILatLonTerrainPatchAddress>['edgeRefinementSegments'];
  readonly reduction: number;
  readonly targetError: number;
  readonly projectionKind: MapProjectionKind;
  readonly colorMode: 'natural' | 'elevation' | 'lod' | 'plates' | 'material';
  readonly heightScale?: number;
  readonly worldProfile?: WorldProfileKind;
  readonly seed?: number;
}

export interface CellPlanetMorphWorkerTimings {
  readonly generationMs: number;
  readonly simplificationMs: number;
}

const LOD_COLORS: readonly [number, number, number][] = [
  [0.25, 0.45, 0.95], // L0 Blue
  [0.20, 0.75, 0.65], // L1 Cyan
  [0.35, 0.80, 0.30], // L2 Green
  [0.90, 0.85, 0.20], // L3 Yellow
  [0.95, 0.55, 0.15], // L4 Orange
  [0.90, 0.25, 0.20], // L5 Red
  [0.75, 0.20, 0.85], // L6 Magenta
  [0.95, 0.40, 0.80], // L7 Pink
  [1.00, 1.00, 1.00], // L8 White
];

// World state cache
let cachedWorldKey = '';
let cachedGraph: IPlanetGraphCore;
let cachedTectonics: IPlanetTectonics;
let cachedEcology: IPlanetEcology;
let cachedFeatures: IPlanetFeatures;
let cachedSampler: IPlanetSurfaceSampler;
let cachedEMin = -0.4;
let cachedEMax = 0.8;
let cachedProfile = WORLD_PROFILES.volcanic;
let cachedMaxSlope = 0;
let cachedRiverMask: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
let cachedRidgeCellSet = new Set<number>();
let cachedLookupKey = '';
let cachedMaterialTileKey = '';

function buildCellPerPixelLookup(
  world: ReturnType<typeof getOrCreateWorld>,
  colorMode: CellPlanetMorphWorkerRequest['colorMode'],
): ICellPerPixelLookupPayload | undefined {
  // Material mode is the visual prototype: it uses the continuous surface
  // sample and interpolated vertex colours. The atlas remains for explicit
  // cell-data views where sharp cell boundaries are useful.
  if (colorMode === 'lod' || colorMode === 'material') return undefined;

  const { graph, tectonics, ecology, sampler, eMin, eMax, profile, maxSlope, riverMask, ridgeCellSet } = world;
  const cellCount = graph.cells.length;
  const cellIdWidth = 1024;
  const cellIdHeight = 512;
  const cellData = new Float32Array(cellCount * 4);

  for (const cell of graph.cells) {
    let colour: [number, number, number];
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
    } else {
      const sample = sampler.sample(cell.center);
      colour = sample.isLand
        ? parseColorToLinearRgb(biomeColor(ecology.biome[cell.id]))
        : parseColorToLinearRgb(profile.oceanSubstance === 'lava' ? lavaOceanColor() : OCEAN_COLOR);
    }

    const colourOffset = cell.id * 4;
    cellData[colourOffset] = colour[0];
    cellData[colourOffset + 1] = colour[1];
    cellData[colourOffset + 2] = colour[2];
    cellData[colourOffset + 3] = 1;

  }

  const cellIdData = new Uint8Array(cellIdWidth * cellIdHeight * 4);
  for (let y = 0; y < cellIdHeight; y += 1) {
    const latitude = -Math.PI / 2 + ((y + 0.5) / cellIdHeight) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    let previousCell = findCellAt(graph, {
      x: cosLatitude * Math.sin(-Math.PI),
      y: Math.sin(latitude),
      z: cosLatitude * Math.cos(-Math.PI),
    });
    for (let x = 0; x < cellIdWidth; x += 1) {
      const longitude = -Math.PI + ((x + 0.5) / cellIdWidth) * Math.PI * 2;
      const direction: IVec3 = {
        x: cosLatitude * Math.sin(longitude),
        y: Math.sin(latitude),
        z: cosLatitude * Math.cos(longitude),
      };
      previousCell = findNearestCellFast(graph, direction, previousCell);
      // DataTexture keeps row zero at the bottom, matching latitude -PI/2 at
      // shader v=0. Reversing this row was the north/south alignment bug.
      const offset = (y * cellIdWidth + x) * 4;
      cellIdData[offset] = previousCell.id & 255;
      cellIdData[offset + 1] = (previousCell.id >> 8) & 255;
      cellIdData[offset + 3] = 255;
    }
  }

  return {
    cellData,
    cellTextureWidth: cellCount,
    cellIdData,
    cellIdWidth,
    cellIdHeight,
  };
}

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

function getOrCreateWorld(profileKind: WorldProfileKind = 'volcanic', seed: number = 1) {
  const key = `${profileKind}:${seed}`;
  if (cachedWorldKey === key && cachedSampler) {
    return {
      graph: cachedGraph,
      tectonics: cachedTectonics,
      ecology: cachedEcology,
      features: cachedFeatures,
      sampler: cachedSampler,
      eMin: cachedEMin,
      eMax: cachedEMax,
      profile: cachedProfile,
      maxSlope: cachedMaxSlope,
      riverMask: cachedRiverMask,
      ridgeCellSet: cachedRidgeCellSet,
    };
  }

  const profile = WORLD_PROFILES[profileKind] ?? WORLD_PROFILES.volcanic;
  const graph = buildPlanetGraphCore({
    cellCount: CELL_PLANET_U0_FIXTURE.cellCount,
    seed,
    relaxationIterations: CELL_PLANET_U0_FIXTURE.relaxationIterations,
    jitter: CELL_PLANET_GENERATION_DEFAULTS.jitter,
  });
  const tectonics = buildPlanetTectonics(graph, {
    plateCount: CELL_PLANET_GENERATION_DEFAULTS.plateCount,
    seed,
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
  cachedMaxSlope = ecology.slope.reduce((max, slope) => Math.max(max, slope), 0);
  cachedRiverMask = buildRiverMaterialMask(graph, ecology);
  cachedRidgeCellSet = new Set(tectonics.ridgeCellIds);

  cachedWorldKey = key;
  cachedGraph = graph;
  cachedTectonics = tectonics;
  cachedEcology = ecology;
  cachedFeatures = features;
  cachedSampler = sampler;
  cachedEMin = eMin;
  cachedEMax = eMax;
  cachedProfile = profile;

  return {
    graph,
    tectonics,
    ecology,
    features,
    sampler,
    eMin,
    eMax,
    profile,
    maxSlope: cachedMaxSlope,
    riverMask: cachedRiverMask,
    ridgeCellSet: cachedRidgeCellSet,
  };
}

// Ultra-fast convex hill-climbing nearest-cell search on spherical Voronoi graph
function findNearestCellFast(
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

function srgbChannelToLinear(channel: number): number {
  const c = Math.max(0, Math.min(1, channel));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function srgbRgbToLinear(rgb: readonly [number, number, number]): [number, number, number] {
  return [
    srgbChannelToLinear(rgb[0]),
    srgbChannelToLinear(rgb[1]),
    srgbChannelToLinear(rgb[2]),
  ];
}

function evaluateWorldMaterial(
  world: ReturnType<typeof getOrCreateWorld>,
  sample: ReturnType<IPlanetSurfaceSampler['sample']>,
  cell: IPlanetGraphCell,
) {
  const { ecology, eMin, eMax, tectonics, maxSlope, riverMask, ridgeCellSet } = world;
  return evaluateTerrainMaterial({
    elevationM: sample.elevation,
    seaLevelM: sample.seaLevel,
    minElevationM: eMin,
    maxElevationM: eMax,
    slope01: maxSlope > 0 ? (ecology.slope[cell.id] ?? 0) / maxSlope : 0,
    moisture01: ecology.moisture[cell.id],
    temperature01: ((ecology.temperature[cell.id] ?? 0) + 1) * 0.5,
    snowIce01:
      ecology.biome[cell.id] === 'ice_cap' ? 1 :
      ecology.biome[cell.id] === 'glacier' ? 0.9 :
      ecology.biome[cell.id] === 'tundra' ? 0.35 : 0,
    arid01:
      ecology.biome[cell.id] === 'desert' ? 1 :
      ecology.biome[cell.id] === 'steppe' ? 0.45 :
      ecology.biome[cell.id] === 'savanna' ? 0.25 : 0,
    ridge01: ridgeCellSet.has(cell.id) ? 1 : 0,
    river01: riverMask[cell.id] ?? 0,
  }, {
    snowlineM: tectonics.seaLevelElevation + Math.max(1, eMax - tectonics.seaLevelElevation) * 0.68,
    snowlineBlendM: Math.max(0.05, (eMax - tectonics.seaLevelElevation) * 0.16),
  });
}

function buildMaterialTile(
  world: ReturnType<typeof getOrCreateWorld>,
  colorMode: CellPlanetMorphWorkerRequest['colorMode'],
): ITerrainMaterialTilePayload | undefined {
  if (colorMode !== 'material') return undefined;
  const key = `${cachedWorldKey}:${colorMode}`;
  if (cachedMaterialTileKey === key) return undefined;
  cachedMaterialTileKey = key;
  const domain = new LatLonTerrainDomain(1, 4, 2);
  let previousCell: IPlanetGraphCell | null = null;
  return bakeTerrainMaterialTile(
    {
      worldRevision: cachedWorldKey,
      address: { level: 0, x: 0, y: 0 },
      styleRevision: 'cell-planet-material-v1',
      samplingVersion: 1,
      format: 'rgba8-linear',
    },
    {
      sample: (localU, localV) => {
        const longitude = (localU - Math.floor(localU)) * Math.PI * 2 - Math.PI;
        const latitude = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, localV * Math.PI - Math.PI / 2));
        const direction = domain.getFieldPosition({ level: 0, x: 0, y: 0 }, longitude, latitude);
        const dir3: IVec3 = { x: direction[0], y: direction[1], z: direction[2] };
        const sample = world.sampler.sample(dir3);
        const cell = findNearestCellFast(world.graph, dir3, previousCell);
        previousCell = cell;
        const material = evaluateWorldMaterial(world, sample, cell);
        return srgbRgbToLinear(terrainMaterialColorRgb(material, {
          oceanSubstance: world.profile.oceanSubstance,
        }));
      },
    },
    { interiorSize: 256, gutterSize: 2, mipLevels: 7 },
  );
}

function parseColorToLinearRgb(color: string): [number, number, number] {

  if (color.startsWith('hsl')) {
    const match = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/.exec(color);
    if (match) {
      const h = parseFloat(match[1]) / 360;
      const s = parseFloat(match[2]) / 100;
      const l = parseFloat(match[3]) / 100;

      let r: number, g: number, b: number;
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

interface CompactedMeshAttributes {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly spherePositions: Float32Array;
  readonly flatPositions: Float32Array;
  readonly sphereNormals: Float32Array;
  readonly flatNormals: Float32Array;
  readonly colors: Float32Array;
  readonly macroLandFactors: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
}

function compactGeometryAttributes(geometry: BufferGeometry): CompactedMeshAttributes {
  const index = geometry.index;
  const posAttr = geometry.getAttribute('position');
  const normAttr = geometry.getAttribute('normal');
  const uvAttr = geometry.getAttribute('uv');
  const sPosAttr = geometry.getAttribute('aSpherePos');
  const fPosAttr = geometry.getAttribute('aFlatPos');
  const sNormAttr = geometry.getAttribute('aSphereNorm');
  const fNormAttr = geometry.getAttribute('aFlatNorm');
  const colAttr = geometry.getAttribute('color');
  const macroAttr = geometry.getAttribute('terrainMacroLandFactor');

  if (!index || !posAttr || !normAttr || !uvAttr || !sPosAttr || !fPosAttr || !sNormAttr || !fNormAttr || !colAttr || !macroAttr) {
    throw new Error('Morph patch simplification returned incomplete geometry attributes.');
  }

  const remap = new Map<number, number>();
  const indices = new Uint32Array(index.count);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const spherePositions: number[] = [];
  const flatPositions: number[] = [];
  const sphereNormals: number[] = [];
  const flatNormals: number[] = [];
  const colors: number[] = [];
  const macroLandFactors: number[] = [];

  for (let i = 0; i < index.count; i += 1) {
    const src = Number(index.array[i]);
    let dst = remap.get(src);
    if (dst === undefined) {
      dst = remap.size;
      remap.set(src, dst);

      for (let ax = 0; ax < 3; ax += 1) {
        positions.push(posAttr.getComponent(src, ax));
        normals.push(normAttr.getComponent(src, ax));
        spherePositions.push(sPosAttr.getComponent(src, ax));
        flatPositions.push(fPosAttr.getComponent(src, ax));
        sphereNormals.push(sNormAttr.getComponent(src, ax));
        flatNormals.push(fNormAttr.getComponent(src, ax));
        colors.push(colAttr.getComponent(src, ax));
      }
      macroLandFactors.push(macroAttr.getComponent(src, 0));
      for (let ax = 0; ax < 2; ax += 1) {
        uvs.push(uvAttr.getComponent(src, ax));
      }
    }
    indices[i] = dst;
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    spherePositions: Float32Array.from(spherePositions),
    flatPositions: Float32Array.from(flatPositions),
    sphereNormals: Float32Array.from(sphereNormals),
    flatNormals: Float32Array.from(flatNormals),
    colors: Float32Array.from(colors),
    macroLandFactors: Float32Array.from(macroLandFactors),
    indices: remap.size <= 65_535 ? new Uint16Array(indices) : indices,
  };
}

addEventListener('message', async ({ data }: MessageEvent<CellPlanetMorphWorkerRequest>) => {
  try {
    const {
      id,
      address,
      radius,
      baseResolution,
      resolution,
      edgeRefinementLevels,
      edgeRefinementSegments,
      reduction,
      targetError,
      projectionKind,
      colorMode,
      heightScale = 160,
      worldProfile = 'volcanic',
      seed = 1,
    } = data;

    const generationStartedAt = performance.now();
    const {
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
    } =
      getOrCreateWorld(worldProfile, seed);

    const lookupKey = `${worldProfile}:${seed}:${colorMode}`;
    const cellLookup =
      cachedLookupKey === lookupKey
        ? undefined
        : buildCellPerPixelLookup(
            {
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
            },
            colorMode,
          );
    cachedLookupKey = lookupKey;
    const materialTile = buildMaterialTile(
      {
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
      },
      colorMode,
    );

    const domain = new LatLonTerrainDomain(radius, 4, 2);
    const bounds = domain.getPatchBounds(address);
    const stepU = (bounds.maxU - bounds.minU) / resolution;
    const stepV = (bounds.maxV - bounds.minV) / resolution;

    const row = resolution + 1;
    const vertexCount = row * row;

    const spherePositions = new Float32Array(vertexCount * 3);
    const flatPositions = new Float32Array(vertexCount * 3);
    const sphereNormals = new Float32Array(vertexCount * 3);
    const flatNormals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 3);
    const macroLandFactors = new Float32Array(vertexCount);

    const mapWidth = 2 * Math.PI * radius;
    const mapHeight = Math.PI * radius;
    const projection =
      projectionKind === 'equirectangular'
        ? EQUIRECTANGULAR_PROJECTION
        : EQUAL_EARTH_PROJECTION;

    const lodColor = LOD_COLORS[Math.min(address.level, LOD_COLORS.length - 1)];

    // Seed hill-climbing search with patch center cell
    const centerU = (bounds.minU + bounds.maxU) * 0.5;
    const centerV = (bounds.minV + bounds.maxV) * 0.5;
    const centerDir = domain.getFieldPosition(address, centerU, centerV);
    let previousCell: IPlanetGraphCell = findCellAt(graph, {
      x: centerDir[0],
      y: centerDir[1],
      z: centerDir[2],
    });

    for (let vi = 0; vi <= resolution; vi += 1) {
      const v = bounds.minV + vi * stepV;
      const latFrac = (v + Math.PI / 2) / Math.PI;

      for (let ui = 0; ui <= resolution; ui += 1) {
        const u = bounds.minU + ui * stepU;
        const lonFrac = (u + Math.PI) / (2 * Math.PI);

        const dirVec = domain.getFieldPosition(address, u, v);
        const dir3: IVec3 = { x: dirVec[0], y: dirVec[1], z: dirVec[2] };

        // Continuous canonical cell planet surface sample
        const sample = sampler.sample(dir3);
        const cell = findNearestCellFast(graph, dir3, previousCell);
        previousCell = cell;

        // Elevation displacement in meters
        const h = (sample.elevation - sample.seaLevel) * heightScale;

        const idx = vi * row + ui;
        const o3 = idx * 3;
        const o2 = idx * 2;

        uvs[o2] = lonFrac;
        uvs[o2 + 1] = latFrac;

        // 3D Sphere geometry (centered at origin)
        const r = radius + h;
        spherePositions[o3] = dirVec[0] * r;
        spherePositions[o3 + 1] = dirVec[1] * r;
        spherePositions[o3 + 2] = dirVec[2] * r;

        sphereNormals[o3] = dirVec[0];
        sphereNormals[o3 + 1] = dirVec[1];
        sphereNormals[o3 + 2] = dirVec[2];

        // 2.5D Projected Map geometry
        const proj = projection.project(u, v, mapWidth, mapHeight);
        flatPositions[o3] = proj.x - mapWidth * 0.5;
        flatPositions[o3 + 1] = mapHeight * 0.5 - proj.y;
        flatPositions[o3 + 2] = h;

        flatNormals[o3] = 0;
        flatNormals[o3 + 1] = 0;
        flatNormals[o3 + 2] = 1;

        // Coloring from canonical cell planet worldgen
        if (colorMode === 'lod') {
          colors[o3] = lodColor[0];
          colors[o3 + 1] = lodColor[1];
          colors[o3 + 2] = lodColor[2];
        } else if (colorMode === 'elevation') {
          const hex = elevationColor(
            tectonics.elevation[cell.id] ?? sample.seaLevel,
            tectonics.seaLevelElevation,
            eMin,
            eMax,
          );
          const rgb = parseColorToLinearRgb(hex);
          colors[o3] = rgb[0];
          colors[o3 + 1] = rgb[1];
          colors[o3 + 2] = rgb[2];
        } else if (colorMode === 'plates') {
          const hex = plateColor(tectonics.plateIdByCell[cell.id] ?? 0);
          const rgb = parseColorToLinearRgb(hex);
          colors[o3] = rgb[0];
          colors[o3 + 1] = rgb[1];
          colors[o3 + 2] = rgb[2];
        } else if (colorMode === 'material') {
          const material = evaluateWorldMaterial(
            { graph, tectonics, ecology, features, sampler, eMin, eMax, profile, maxSlope, riverMask, ridgeCellSet },
            sample,
            cell,
          );
          // terrainMaterialColorRgb returns display/sRGB palette values. Vertex
          // colors on MeshStandardMaterial are linear working-space inputs, so
          // decode them here before the renderer applies lighting and sRGB output.
          const rgb = srgbRgbToLinear(terrainMaterialColorRgb(material, {
            oceanSubstance: profile.oceanSubstance,
          }));
          colors[o3] = rgb[0];
          colors[o3 + 1] = rgb[1];
          colors[o3 + 2] = rgb[2];
          macroLandFactors[idx] = 1 - Math.min(1, material.weights.water + material.snow01 * 0.75);
        } else {
          // Natural Biome mode
          if (!sample.isLand) {
            const hex = profile.oceanSubstance === 'lava' ? lavaOceanColor() : OCEAN_COLOR;
            const rgb = parseColorToLinearRgb(hex);
            colors[o3] = rgb[0];
            colors[o3 + 1] = rgb[1];
            colors[o3 + 2] = rgb[2];
          } else {
            const feature = features.featureByCellId.get(cell.id);
            if (feature?.kind === 'volcano') {
              // Highlight the volcano cell: caldera lava floor vs cone rim
              const volcanoThreshold = Math.max(3, heightScale * 0.28);
              if (h > volcanoThreshold) {
                colors[o3] = 0.46; // oxidized reddish basalt rim
                colors[o3 + 1] = 0.22;
                colors[o3 + 2] = 0.16;
              } else {
                colors[o3] = 0.12; // dark cooled basalt crater floor
                colors[o3 + 1] = 0.11;
                colors[o3 + 2] = 0.12;
              }
            } else {
              const hex = biomeColor(ecology.biome[cell.id]);
              const rgb = parseColorToLinearRgb(hex);
              colors[o3] = rgb[0];
              colors[o3 + 1] = rgb[1];
              colors[o3 + 2] = rgb[2];
            }
          }
        }
      }
    }

    // Conform mixed-LOD boundaries for BOTH sphere and flat geometries (0 cracks)
    conformPatchEdges(
      spherePositions,
      sphereNormals,
      resolution,
      baseResolution,
      edgeRefinementLevels,
      edgeRefinementSegments,
    );
    conformPatchEdges(
      flatPositions,
      flatNormals,
      resolution,
      baseResolution,
      edgeRefinementLevels,
      edgeRefinementSegments,
    );

    const generationMs = performance.now() - generationStartedAt;
    const simplificationStartedAt = performance.now();

    const indices = createIndices(resolution, vertexCount);

    let compacted: CompactedMeshAttributes;
    if (reduction > 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(spherePositions, 3));
      geometry.setAttribute('normal', new BufferAttribute(sphereNormals, 3));
      geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
      geometry.setAttribute('aSpherePos', new BufferAttribute(spherePositions, 3));
      geometry.setAttribute('aFlatPos', new BufferAttribute(flatPositions, 3));
      geometry.setAttribute('aSphereNorm', new BufferAttribute(sphereNormals, 3));
      geometry.setAttribute('aFlatNorm', new BufferAttribute(flatNormals, 3));
      geometry.setAttribute('color', new BufferAttribute(colors, 3));
      geometry.setAttribute('terrainMacroLandFactor', new BufferAttribute(macroLandFactors, 1));
      geometry.setIndex(new BufferAttribute(indices, 1));

      const simplified = await simplifyIndexedGeometry(geometry, {
        ratio: reduction,
        targetError,
        flags: ['LockBorder'],
      });

      compacted = compactGeometryAttributes(simplified.geometry);
      geometry.dispose();
      simplified.geometry.dispose();
    } else {
      compacted = {
        positions: spherePositions,
        normals: sphereNormals,
        uvs,
        spherePositions,
        flatPositions,
        sphereNormals,
        flatNormals,
        colors,
        macroLandFactors,
        indices,
      };
    }

    const simplificationMs = performance.now() - simplificationStartedAt;
    const otherDirs = new Float32Array(compacted.spherePositions.length);

    const surface: ITerrainPatchGeometry = {
      positions: compacted.positions,
      normals: compacted.normals,
      uvs: compacted.uvs,
      colors: compacted.colors,
      indices: compacted.indices,
      attributes: {
        aSpherePos: compacted.spherePositions,
        aFlatPos: compacted.flatPositions,
        aSphereNorm: compacted.sphereNormals,
        aFlatNorm: compacted.flatNormals,
        aOtherDir1: otherDirs,
        aOtherDir2: otherDirs,
        color: compacted.colors,
        terrainMacroLandFactor: {
          array: compacted.macroLandFactors,
          itemSize: 1,
        },
      },
    };

    const patch: ITerrainPatchMesh<ILatLonTerrainPatchAddress> = {
      address,
      resolution,
      centerWorldM: [0, 0, 0],
      surface,
      geometricErrorM: domain.getGeometricErrorM(address, resolution, -100, 300),
    };

    const asTransferable = (buffer: ArrayBufferLike): ArrayBuffer => buffer as ArrayBuffer;
    const transferables: ArrayBuffer[] = [
      asTransferable(compacted.positions.buffer),
      asTransferable(compacted.normals.buffer),
      asTransferable(compacted.uvs.buffer),
      asTransferable(compacted.indices.buffer),
      asTransferable(compacted.spherePositions.buffer),
      asTransferable(compacted.flatPositions.buffer),
      asTransferable(compacted.sphereNormals.buffer),
      asTransferable(compacted.flatNormals.buffer),
      asTransferable(compacted.colors.buffer),
      asTransferable(compacted.macroLandFactors.buffer),
      asTransferable(otherDirs.buffer),
    ];
    if (cellLookup) {
      transferables.push(
        asTransferable(cellLookup.cellData.buffer),
        asTransferable(cellLookup.cellIdData.buffer),
      );
    }
    if (materialTile) {
      for (const mip of materialTile.mipData) {
        transferables.push(asTransferable(mip.buffer));
      }
    }

    postMessage(
      {
        id,
        patch,
        cellLookup,
        materialTile,
        timings: { generationMs, simplificationMs } satisfies CellPlanetMorphWorkerTimings,
      },
      transferables,
    );
  } catch (error) {
    postMessage({
      id: (data as CellPlanetMorphWorkerRequest).id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
