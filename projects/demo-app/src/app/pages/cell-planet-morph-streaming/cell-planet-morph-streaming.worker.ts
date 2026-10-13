/// <reference lib="webworker" />

import { BufferAttribute, BufferGeometry } from 'three';
import { simplifyIndexedGeometry } from 'triangular-engine/meshoptimizer';
import {
  conformPatchEdges,
  createIndices,
  LatLonTerrainDomain,
  terrainMaterialColorRgb,
  type ILatLonTerrainPatchAddress,
  type ITerrainPatchGeometry,
  type ITerrainPatchMesh,
  type ITerrainSurfaceGenerationRequest,
} from 'triangular-engine/terrain/core';
import {
  buildPlanetGraphCore,
  findCellAt,
  findCellNear,
  type IPlanetGraphCell,
  type IPlanetGraphCore,
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
import {
  buildCellBorderLineGeometry,
  type MapProjectionKind as BorderProjectionKind,
} from 'triangular-engine/worldgen/render';
import { CELL_PLANET_GENERATION_DEFAULTS } from '../cell-planet-generation-config';
import { CELL_PLANET_U0_FIXTURE } from '../cell-planet-u0-fixture';
import {
  buildCellColourData,
  buildCellIdRaster,
  buildMaterialTile,
  CELL_ID_RASTER_HEIGHT,
  CELL_ID_RASTER_WIDTH,
  createCellPlanetWorld,
  evaluateWorldMaterial,
  OCEAN_COLOR,
  parseColorToLinearRgb,
  sampleSurfaceNear,
  srgbRgbToLinear,
  type ICellPlanetMaterialTilePayload,
  type ICellPlanetWorld,
} from './cell-planet-material-tile';

// A tiny mesh-space freeboard for ice owned by frozen-water cells. The shared
// sampler intentionally eases ice toward the sea datum at cell edges; this
// floor prevents the rendered ice surface and translucent ocean shell from
// occupying the same depth there without changing the shoreline ownership.
const MIN_ICE_SURFACE_CLEARANCE_ELEVATION = 0.00025;

export interface CellPlanetMorphWorkerRequest {
  readonly kind?: 'terrain';
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
  /** Base colour tile interior resolution; independent from mesh resolution. */
  readonly materialTileResolution?: number;
  readonly heightScale?: number;
  readonly worldProfile?: WorldProfileKind;
  readonly seed?: number;
}

/** Material-only work is deliberately separate from mesh generation. */
export type CellPlanetMorphMaterialTilePayload = ICellPlanetMaterialTilePayload;

export interface CellPlanetMorphMaterialTileRequest {
  readonly kind: 'materialTile';
  readonly id: number;
  readonly radius: number;
  readonly colorMode: 'natural' | 'elevation' | 'plates' | 'material';
  readonly materialTileResolution: number;
  readonly materialTileX: number;
  readonly materialTileY: number;
  readonly materialTileGrid: readonly [number, number];
  /** Physical height multiplier used by the displayed terrain mesh. */
  readonly heightScaleM?: number;
  /** Strength of the local slope contribution to the baked cliff material. */
  readonly cliffStrength?: number;
  /** Render the local slope as a grayscale diagnostic instead of terrain colour. */
  readonly cliffDebug?: boolean;
  readonly worldProfile?: WorldProfileKind;
  readonly seed?: number;
}

export interface CellPlanetMorphCellLookupRequest {
  readonly kind: 'cellLookup';
  readonly id: number;
  readonly colorMode: 'material';
  readonly worldProfile?: WorldProfileKind;
  readonly seed?: number;
}

/** Build the POC's morphing Voronoi grid on demand, away from the UI thread. */
export interface CellPlanetMorphCellGridRequest {
  readonly kind: 'cellGrid';
  readonly id: number;
  readonly radius: number;
  readonly heightScale: number;
  readonly projectionKind: BorderProjectionKind;
  readonly colorMode: 'natural';
  readonly worldProfile?: WorldProfileKind;
  readonly seed?: number;
}

export type CellPlanetMorphWorkerMessage =
  | CellPlanetMorphWorkerRequest
  | CellPlanetMorphMaterialTileRequest
  | CellPlanetMorphCellLookupRequest
  | CellPlanetMorphCellGridRequest;

export interface CellPlanetMorphCellGridPayload {
  readonly attributes: Readonly<Record<string, { readonly array: Float32Array; readonly itemSize: number }>>;
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

// Recently used worlds stay resident so switching archetypes back and forth
// reuses them instead of regenerating tectonics, ecology and craters.
const MAX_CACHED_WORLDS = 4;
const worldCache = new Map<string, ICellPlanetWorld>();
// The Voronoi graph depends only on the seed (not the archetype) and no later
// stage mutates it, so every archetype of one seed shares a single graph.
let cachedGraphSeed: number | undefined;
let cachedGraph: IPlanetGraphCore | undefined;
// The cell-id raster depends only on the graph, i.e. on the seed.
let cachedCellIdRaster: { readonly graph: IPlanetGraphCore; readonly data: Uint8Array } | undefined;
let cachedLookupKey = '';

function buildCellPerPixelLookup(
  world: ICellPlanetWorld,
  colorMode: CellPlanetMorphWorkerRequest['colorMode'],
  includeMaterialCellLookup = false,
): ICellPerPixelLookupPayload | undefined {
  if (colorMode === 'lod' || (colorMode === 'material' && !includeMaterialCellLookup)) return undefined;

  if (cachedCellIdRaster?.graph !== world.graph) {
    cachedCellIdRaster = { graph: world.graph, data: buildCellIdRaster(world.graph) };
  }
  return {
    cellData: buildCellColourData(world, colorMode),
    cellTextureWidth: world.graph.cells.length,
    // Posted buffers are transferred (detached), so hand out a copy of the cached raster.
    cellIdData: cachedCellIdRaster.data.slice(),
    cellIdWidth: CELL_ID_RASTER_WIDTH,
    cellIdHeight: CELL_ID_RASTER_HEIGHT,
  };
}

function getOrCreateWorld(profileKind: WorldProfileKind = 'volcanic', seed: number = 1): ICellPlanetWorld {
  const key = `${profileKind}:${seed}`;
  const cached = worldCache.get(key);
  if (cached) {
    // Refresh recency: Map iteration order is insertion order.
    worldCache.delete(key);
    worldCache.set(key, cached);
    return cached;
  }

  if (!cachedGraph || cachedGraphSeed !== seed) {
    cachedGraph = buildPlanetGraphCore({
      cellCount: CELL_PLANET_U0_FIXTURE.cellCount,
      seed,
      relaxationIterations: CELL_PLANET_U0_FIXTURE.relaxationIterations,
      jitter: CELL_PLANET_GENERATION_DEFAULTS.jitter,
    });
    cachedGraphSeed = seed;
  }
  const world = createCellPlanetWorld(profileKind, seed, cachedGraph);

  worldCache.set(key, world);
  while (worldCache.size > MAX_CACHED_WORLDS) {
    worldCache.delete(worldCache.keys().next().value!);
  }
  return world;
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

addEventListener('message', async ({ data }: MessageEvent<CellPlanetMorphWorkerMessage>) => {
  try {
    const { id, colorMode, worldProfile = 'volcanic', seed = 1 } = data;

    const generationStartedAt = performance.now();
    const world = getOrCreateWorld(worldProfile, seed);
    const { graph, tectonics, ecology, features, sampler, eMin, eMax, profile } = world;

    if (data.kind === 'materialTile') {
      const materialTile = buildMaterialTile(
        world,
        colorMode,
        data.materialTileResolution,
        data.materialTileX,
        data.materialTileY,
        data.materialTileGrid,
        data.radius,
        data.heightScaleM ?? 1,
        data.cliffStrength,
        data.cliffDebug,
      );
      const transferables: ArrayBuffer[] = [];
      if (materialTile) {
        for (const mip of materialTile.mipData) {
          transferables.push(mip.buffer as ArrayBuffer);
        }
      }
      postMessage(
        {
          id,
          materialTile,
          timings: {
            generationMs: performance.now() - generationStartedAt,
            simplificationMs: 0,
          } satisfies CellPlanetMorphWorkerTimings,
        },
        transferables,
      );
      return;
    }

    if (data.kind === 'cellLookup') {
      const cellLookup = buildCellPerPixelLookup(world, colorMode, true);
      const transferables: ArrayBuffer[] = [];
      if (cellLookup) {
        transferables.push(
          cellLookup.cellData.buffer as ArrayBuffer,
          cellLookup.cellIdData.buffer as ArrayBuffer,
        );
      }
      postMessage(
        {
          id,
          cellLookup,
          timings: {
            generationMs: performance.now() - generationStartedAt,
            simplificationMs: 0,
          } satisfies CellPlanetMorphWorkerTimings,
        },
        transferables,
      );
      return;
    }

    if (data.kind === 'cellGrid') {
      const geometry = buildCellBorderLineGeometry({
        graph,
        sampler,
        radius: data.radius,
        heightScale: data.heightScale,
        projectionKind: data.projectionKind,
        seaLevelElevation: tectonics.seaLevelElevation,
        seabedRelief: true,
        clampToSeaLevel: true,
      });
      const attributes: Record<string, { array: Float32Array; itemSize: number }> = {};
      const transferables: ArrayBuffer[] = [];
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const array = attribute.array;
        if (!(array instanceof Float32Array)) continue;
        attributes[name] = { array, itemSize: attribute.itemSize };
        transferables.push(array.buffer as ArrayBuffer);
      }
      geometry.dispose();
      postMessage({ id, cellGrid: { attributes } satisfies CellPlanetMorphCellGridPayload }, transferables);
      return;
    }

    const {
      address,
      radius,
      baseResolution,
      resolution,
      edgeRefinementLevels,
      edgeRefinementSegments,
      reduction,
      targetError,
      projectionKind,
      materialTileResolution: _materialTileResolution = 256,
      heightScale = 160,
    } = data;

    const lookupKey = `${worldProfile}:${seed}:${colorMode}`;
    const cellLookup =
      cachedLookupKey === lookupKey
        ? undefined
        : buildCellPerPixelLookup(
          world,
            colorMode,
          );
    if (cellLookup) cachedLookupKey = lookupKey;
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
    let rowStartCell: IPlanetGraphCell = findCellAt(graph, {
      x: centerDir[0],
      y: centerDir[1],
      z: centerDir[2],
    });

    // Sample an extended (resolution + 3) x (resolution + 3) grid that extends 1 sample
    // outside the patch boundaries in every direction. This provides consistent, continuous
    // central-difference normals along edges and at corners matching across adjacent patches.
    const extRow = resolution + 3;
    const extVertexCount = extRow * extRow;
    const extSpherePositions = new Float32Array(extVertexCount * 3);
    const extSphereDirections = new Float32Array(extVertexCount * 3);
    const extFlatPositions = new Float32Array(extVertexCount * 3);
    // Interior vertices reuse these instead of sampling the surface a second time.
    const extSamples = new Array<ReturnType<IPlanetSurfaceSampler['sample']>>(extVertexCount);
    const extCellIds = new Int32Array(extVertexCount);

    for (let evi = 0; evi < extRow; evi += 1) {
      const v = bounds.minV + (evi - 1) * stepV;
      // Walk from the previous row's first cell: a short, exact Delaunay walk
      // instead of a brute-force scan of every cell per lattice point.
      let hintCell = rowStartCell;

      for (let eui = 0; eui < extRow; eui += 1) {
        const u = bounds.minU + (eui - 1) * stepU;
        const dirVec = domain.getFieldPosition(address, u, v);
        const dir3: IVec3 = { x: dirVec[0], y: dirVec[1], z: dirVec[2] };

        hintCell = findCellNear(graph, dir3, hintCell.id);
        if (eui === 0) rowStartCell = hintCell;
        const sample = sampleSurfaceNear(sampler, dir3, hintCell.id);
        extSamples[evi * extRow + eui] = sample;
        extCellIds[evi * extRow + eui] = hintCell.id;
        const surfaceElevation = sample.elevation - sample.seaLevel;
        const h = (sample.isIce
          ? Math.max(surfaceElevation, MIN_ICE_SURFACE_CLEARANCE_ELEVATION)
          : surfaceElevation) * heightScale;

        const eIdx = (evi * extRow + eui) * 3;
        const r = radius + h;
        extSpherePositions[eIdx] = dirVec[0] * r;
        extSpherePositions[eIdx + 1] = dirVec[1] * r;
        extSpherePositions[eIdx + 2] = dirVec[2] * r;

        extSphereDirections[eIdx] = dirVec[0];
        extSphereDirections[eIdx + 1] = dirVec[1];
        extSphereDirections[eIdx + 2] = dirVec[2];

        const proj = projection.project(u, v, mapWidth, mapHeight);
        extFlatPositions[eIdx] = proj.x - mapWidth * 0.5;
        extFlatPositions[eIdx + 1] = mapHeight * 0.5 - proj.y;
        extFlatPositions[eIdx + 2] = h;
      }
    }

    for (let vi = 0; vi <= resolution; vi += 1) {
      const v = bounds.minV + vi * stepV;
      const latFrac = (v + Math.PI / 2) / Math.PI;

      for (let ui = 0; ui <= resolution; ui += 1) {
        const u = bounds.minU + ui * stepU;
        const lonFrac = (u + Math.PI) / (2 * Math.PI);

        const idx = vi * row + ui;
        const o3 = idx * 3;
        const o2 = idx * 2;

        uvs[o2] = lonFrac;
        uvs[o2 + 1] = latFrac;

        const extCenter = ((vi + 1) * extRow + (ui + 1)) * 3;
        const extLeft = ((vi + 1) * extRow + ui) * 3;
        const extRight = ((vi + 1) * extRow + ui + 2) * 3;
        const extDown = (vi * extRow + (ui + 1)) * 3;
        const extUp = ((vi + 2) * extRow + (ui + 1)) * 3;

        spherePositions[o3] = extSpherePositions[extCenter];
        spherePositions[o3 + 1] = extSpherePositions[extCenter + 1];
        spherePositions[o3 + 2] = extSpherePositions[extCenter + 2];

        flatPositions[o3] = extFlatPositions[extCenter];
        flatPositions[o3 + 1] = extFlatPositions[extCenter + 1];
        flatPositions[o3 + 2] = extFlatPositions[extCenter + 2];

        // Central-difference normal for 3D sphere:
        const sDx0 = extSpherePositions[extRight] - extSpherePositions[extLeft];
        const sDx1 = extSpherePositions[extRight + 1] - extSpherePositions[extLeft + 1];
        const sDx2 = extSpherePositions[extRight + 2] - extSpherePositions[extLeft + 2];

        const sDy0 = extSpherePositions[extUp] - extSpherePositions[extDown];
        const sDy1 = extSpherePositions[extUp + 1] - extSpherePositions[extDown + 1];
        const sDy2 = extSpherePositions[extUp + 2] - extSpherePositions[extDown + 2];

        let snx = sDx1 * sDy2 - sDx2 * sDy1;
        let sny = sDx2 * sDy0 - sDx0 * sDy2;
        let snz = sDx0 * sDy1 - sDx1 * sDy0;
        const snLen = Math.hypot(snx, sny, snz);

        const dirX = extSphereDirections[extCenter];
        const dirY = extSphereDirections[extCenter + 1];
        const dirZ = extSphereDirections[extCenter + 2];

        if (snLen > 1e-6) {
          snx /= snLen;
          sny /= snLen;
          snz /= snLen;
          if (snx * dirX + sny * dirY + snz * dirZ < 0) {
            snx = -snx;
            sny = -sny;
            snz = -snz;
          }
        } else {
          snx = dirX;
          sny = dirY;
          snz = dirZ;
        }

        sphereNormals[o3] = snx;
        sphereNormals[o3 + 1] = sny;
        sphereNormals[o3 + 2] = snz;

        // Central-difference normal for 2.5D flat map:
        const fDx0 = extFlatPositions[extRight] - extFlatPositions[extLeft];
        const fDx1 = extFlatPositions[extRight + 1] - extFlatPositions[extLeft + 1];
        const fDx2 = extFlatPositions[extRight + 2] - extFlatPositions[extLeft + 2];

        const fDy0 = extFlatPositions[extUp] - extFlatPositions[extDown];
        const fDy1 = extFlatPositions[extUp + 1] - extFlatPositions[extDown + 1];
        const fDy2 = extFlatPositions[extUp + 2] - extFlatPositions[extDown + 2];

        let fnx = fDx1 * fDy2 - fDx2 * fDy1;
        let fny = fDx2 * fDy0 - fDx0 * fDy2;
        let fnz = fDx0 * fDy1 - fDx1 * fDy0;
        const fnLen = Math.hypot(fnx, fny, fnz);

        if (fnLen > 1e-6) {
          fnx /= fnLen;
          fny /= fnLen;
          fnz /= fnLen;
          if (fnz < 0) {
            fnx = -fnx;
            fny = -fny;
            fnz = -fnz;
          }
        } else {
          fnx = 0;
          fny = 0;
          fnz = 1;
        }

        flatNormals[o3] = fnx;
        flatNormals[o3 + 1] = fny;
        flatNormals[o3 + 2] = fnz;

        // Coloring from canonical cell planet worldgen
        const sample = extSamples[extCenter / 3];
        const cell = graph.cells[extCellIds[extCenter / 3]];

        const surfaceElevation = sample.elevation - sample.seaLevel;
        const h = (sample.isIce
          ? Math.max(surfaceElevation, MIN_ICE_SURFACE_CLEARANCE_ELEVATION)
          : surfaceElevation) * heightScale;

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
          const material = evaluateWorldMaterial(world, sample, cell.id);
          // terrainMaterialColorRgb returns display/sRGB palette values. Vertex
          // colors on MeshStandardMaterial are linear working-space inputs, so
          // decode them here before the renderer applies lighting and sRGB output.
          const rgb = srgbRgbToLinear(terrainMaterialColorRgb(material, world.materialColorOptions));
          colors[o3] = rgb[0];
          colors[o3 + 1] = rgb[1];
          colors[o3 + 2] = rgb[2];
          macroLandFactors[idx] = 1 - Math.min(1, material.weights.water + material.snow01 * 0.75);
        } else {
          // Natural Biome mode
          if (!sample.isLand && !sample.isIce) {
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
    postMessage(
      {
        id,
        patch,
        cellLookup,
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
