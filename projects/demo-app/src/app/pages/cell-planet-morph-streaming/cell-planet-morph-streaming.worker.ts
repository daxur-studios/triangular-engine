/// <reference lib="webworker" />

import { BufferAttribute, BufferGeometry } from 'three';
import { simplifyIndexedGeometry } from 'triangular-engine/meshoptimizer';
import {
  conformPatchEdges,
  createIndices,
  LatLonTerrainDomain,
  type ILatLonTerrainPatchAddress,
  type ITerrainPatchGeometry,
  type ITerrainPatchMesh,
  type ITerrainSurfaceGenerationRequest,
} from 'triangular-engine/terrain';
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
  type MapProjectionKind,
} from 'triangular-engine/worldgen/render';
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
  readonly colorMode: 'natural' | 'elevation' | 'lod' | 'plates';
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

function parseColorToLinearRgb(color: string): [number, number, number] {
  const toLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

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
      return [toLinear(r), toLinear(g), toLinear(b)];
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
  return [toLinear(sR), toLinear(sG), toLinear(sB)];
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

  if (!index || !posAttr || !normAttr || !uvAttr || !sPosAttr || !fPosAttr || !sNormAttr || !fNormAttr || !colAttr) {
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
    const { graph, tectonics, ecology, features, sampler, eMin, eMax, profile } =
      getOrCreateWorld(worldProfile, seed);

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
      },
    };

    const patch: ITerrainPatchMesh<ILatLonTerrainPatchAddress> = {
      address,
      resolution,
      centerWorldM: [0, 0, 0],
      surface,
      geometricErrorM: domain.getGeometricErrorM(address, resolution, -100, 300),
    };

    postMessage(
      {
        id,
        patch,
        timings: { generationMs, simplificationMs } satisfies CellPlanetMorphWorkerTimings,
      },
      [
        compacted.positions.buffer,
        compacted.normals.buffer,
        compacted.uvs.buffer,
        compacted.indices.buffer,
        compacted.spherePositions.buffer,
        compacted.flatPositions.buffer,
        compacted.sphereNormals.buffer,
        compacted.flatNormals.buffer,
        compacted.colors.buffer,
        otherDirs.buffer,
      ],
    );
  } catch (error) {
    postMessage({
      id: (data as CellPlanetMorphWorkerRequest).id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
