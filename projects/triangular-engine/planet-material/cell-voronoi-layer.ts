import { DataTexture, FloatType, NearestFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import { float, floor, mix, select, texture, uniform, vec2 } from 'three/tsl';
import { cellAtlasUv, type ICellLookupLayer, type ICellLookupPayload } from './cell-lookup-layer';
import type { IPlanetContext } from './planet-context';
import type { ISurfaceSample, SurfaceLayer } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Neighbour slots per cell the exact lookup checks: two RGBA texels. A cell with more neighbours keeps its eight nearest. */
export const CELL_VORONOI_NEIGHBOURS = 8;

/**
 * What {@link cellVoronoiLayer} needs on top of the plain cell lookup: where each cell's centre is and which cells touch it.
 * Build it with `buildCellPlanetLookup` from `triangular-engine/lod-surface/core`.
 */
export interface ICellVoronoiPayload extends ICellLookupPayload {
  /** The unit centre of each cell, `x, y, z` per cell (3 floats). The atlas's cell is the one whose centre has the largest dot product with the direction. */
  readonly cellCentres: Float32Array;
  /** Neighbour cell ids, {@link CELL_VORONOI_NEIGHBOURS} per cell; `-1` marks an unused slot. */
  readonly cellNeighbours: Int32Array;
}

function dataTexture(
  data: Float32Array | Uint8Array,
  width: number,
  height: number,
  type: typeof FloatType | typeof UnsignedByteType,
): DataTexture {
  const t = new DataTexture(data, width, height, RGBAFormat, type);
  // Nearest only, as in `cellLookupLayer`: float textures are not filterable everywhere on WebGPU, and ids must not blend.
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** One RGBA float texel per cell holding `xyz` and a zero. */
function centreTexels(centres: Float32Array, cellCount: number): Float32Array {
  const out = new Float32Array(cellCount * 4);
  for (let c = 0; c < cellCount; c += 1) out.set([centres[c * 3], centres[c * 3 + 1], centres[c * 3 + 2], 0], c * 4);
  return out;
}

/**
 * Neighbour ids as floats (exact below 2^24), two texel rows of `cellCount` texels: row 0 holds slots 0-3, row 1 slots 4-7.
 * An unused slot holds the cell's own id, which can never beat the cell itself.
 */
function neighbourTexels(neighbours: Int32Array, cellCount: number): Float32Array {
  const out = new Float32Array(cellCount * 8);
  for (let c = 0; c < cellCount; c += 1) {
    for (let k = 0; k < CELL_VORONOI_NEIGHBOURS; k += 1) {
      const id = neighbours[c * CELL_VORONOI_NEIGHBOURS + k];
      out[(k < 4 ? 0 : cellCount * 4) + c * 4 + (k % 4)] = id >= 0 ? id : c;
    }
  }
  return out;
}

/** The layer {@link cellVoronoiLayer} returns: the plain lookup layer's controls, but its lookup also needs the cell geometry. */
export interface ICellVoronoiLayer extends Omit<ICellLookupLayer, 'setLookup'> {
  /** Uploads a lookup and enables the layer. Replaces (and disposes) the previous textures. Throws when the geometry arrays do not match the cell count. */
  setLookup(payload: ICellVoronoiPayload): void;
}

/**
 * Surface layer: the cell lookup with exact cell edges at any zoom. {@link cellLookupLayer} reads a nearest-filtered
 * cell-id atlas, so up close an edge is a staircase of atlas texels. This layer uses the atlas only to find a nearby cell,
 * then picks the true one: the cell whose centre has the largest dot product with the direction, among that cell and its
 * neighbours (what `findCellAt` does for the whole planet). The edge is then a straight Voronoi edge however close the camera.
 * That is right whenever an atlas texel is smaller than a cell, so a coarse atlas (1,024 x 512 for thousands of cells) is enough.
 *
 * Per fragment: one atlas fetch, two neighbour fetches, nine centre fetches and one colour fetch, against two fetches for
 * {@link cellLookupLayer}. Memory per cell: 16 B colour, 16 B centre, 32 B neighbours, plus the atlas (4 B per texel).
 * Disabled until `setLookup` runs. Textures live in texture nodes created once, so `setLookup` never recompiles.
 *
 * Like {@link cellLookupLayer} it reads `context.radialDirection` only, so it works on the terrain mesh.
 */
export function cellVoronoiLayer(): ICellVoronoiLayer {
  let cellData = dataTexture(new Float32Array([0, 0, 0, 1]), 1, 1, FloatType);
  let cellIds = dataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, UnsignedByteType);
  let centres = dataTexture(new Float32Array(4), 1, 1, FloatType);
  let neighbours = dataTexture(new Float32Array(8), 1, 2, FloatType);
  const enabled = uniform(0);
  const opacity = uniform(1);
  const cellCount = uniform(1);
  const dataNode: any = texture(cellData);
  const idsNode: any = texture(cellIds);
  const centresNode: any = texture(centres);
  const neighboursNode: any = texture(neighbours);

  const layer: SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => {
    const direction = context.radialDirection.normalize();
    const encoded = idsNode.sample(cellAtlasUv(direction)).level(float(0));
    const atlasCell = floor(encoded.r.mul(255).add(0.5)).add(floor(encoded.g.mul(255).add(0.5)).mul(256));
    const column = (id: any) => id.add(0.5).div(cellCount);
    const dotWith = (id: any) => centresNode.sample(vec2(column(id), float(0.5))).level(float(0)).xyz.dot(direction);

    const low = neighboursNode.sample(vec2(column(atlasCell), float(0.25))).level(float(0));
    const high = neighboursNode.sample(vec2(column(atlasCell), float(0.75))).level(float(0));
    let best: any = atlasCell;
    let bestDot: any = dotWith(atlasCell);
    for (const candidate of [low.x, low.y, low.z, low.w, high.x, high.y, high.z, high.w]) {
      const candidateDot = dotWith(candidate);
      const better = candidateDot.greaterThan(bestDot);
      best = select(better, candidate, best);
      bestDot = select(better, candidateDot, bestDot);
    }

    const colour = dataNode.sample(vec2(column(best), float(0.5))).level(float(0));
    const blended = mix(below.albedo, colour.rgb, colour.a.mul(opacity));
    return { ...below, albedo: select(enabled.greaterThan(0.5), blended, below.albedo) };
  };

  const disposeAll = (): void => {
    cellData.dispose();
    cellIds.dispose();
    centres.dispose();
    neighbours.dispose();
  };

  return {
    layer,
    enabled,
    opacity,
    setLookup(payload) {
      const count = payload.cellTextureWidth;
      if (payload.cellCentres.length !== count * 3 || payload.cellNeighbours.length !== count * CELL_VORONOI_NEIGHBOURS) {
        throw new RangeError('Cell centres and neighbours do not match the cell count.');
      }
      const previous = [cellData, cellIds, centres, neighbours];
      cellData = dataTexture(payload.cellData, count, 1, FloatType);
      cellIds = dataTexture(payload.cellIdData, payload.cellIdWidth, payload.cellIdHeight, UnsignedByteType);
      centres = dataTexture(centreTexels(payload.cellCentres, count), count, 1, FloatType);
      neighbours = dataTexture(neighbourTexels(payload.cellNeighbours, count), count, 2, FloatType);
      dataNode.value = cellData;
      idsNode.value = cellIds;
      centresNode.value = centres;
      neighboursNode.value = neighbours;
      cellCount.value = count;
      enabled.value = 1;
      for (const old of previous) old.dispose();
    },
    updatePalette(next) {
      const data = cellData.image.data as Float32Array;
      if (data.length !== next.length) {
        throw new RangeError('Cell palette length does not match the resident cell lookup.');
      }
      data.set(next);
      cellData.needsUpdate = true;
    },
    dispose: disposeAll,
  };
}
