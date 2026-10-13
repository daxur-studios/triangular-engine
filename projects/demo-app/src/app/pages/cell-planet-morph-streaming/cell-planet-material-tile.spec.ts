import { buildPlanetGraphCore, findCellAt, type IPlanetGraphCore } from 'triangular-engine/worldgen';
import {
  buildCellColourData,
  buildCellIdRaster,
  buildMaterialTile,
  CELL_ID_RASTER_HEIGHT,
  CELL_ID_RASTER_WIDTH,
  createCellPlanetWorld,
  type ICellPlanetWorld,
} from './cell-planet-material-tile';

const INTERIOR = 16;
const GUTTER = 2;
const RADIUS_M = 600_000;
const HEIGHT_SCALE_M = 4000;

describe('cell planet material tiles', () => {
  let graph: IPlanetGraphCore;
  let world: ICellPlanetWorld;

  beforeAll(() => {
    graph = buildPlanetGraphCore({ cellCount: 1500, seed: 1, relaxationIterations: 2, jitter: 0.35 });
    world = createCellPlanetWorld('volcanic', 1, graph);
  });

  const bake = (mode: 'material' | 'natural' | 'elevation' | 'plates', x: number, y: number, cliff = 1) =>
    buildMaterialTile(world, mode, INTERIOR, x, y, [4, 4], RADIUS_M, HEIGHT_SCALE_M, cliff, false)!;

  it('bakes identical bytes when the same tile is baked twice', () => {
    for (const mode of ['material', 'natural', 'elevation', 'plates'] as const) {
      const first = bake(mode, 1, 2);
      const second = bake(mode, 1, 2);
      expect(first.mipData[0]).toEqual(second.mipData[0]);
      expect(first.centerElevation).toBe(second.centerElevation);
      expect(first.width).toBe(INTERIOR + GUTTER * 2);
    }
  });

  it('returns nothing for the lod diagnostic mode', () => {
    expect(buildMaterialTile(world, 'lod', INTERIOR, 0, 0, [4, 4], RADIUS_M, HEIGHT_SCALE_M)).toBeUndefined();
  });

  it('matches neighbouring tiles across the gutter so tiles join without a seam', () => {
    const size = INTERIOR + GUTTER * 2;
    let compared = 0;
    for (const mode of ['material', 'natural'] as const) {
      const left = bake(mode, 1, 1).mipData[0];
      const right = bake(mode, 2, 1).mipData[0];
      for (let y = GUTTER; y < size - GUTTER; y++) {
        for (let gutterColumn = 0; gutterColumn < GUTTER; gutterColumn++) {
          // `left`'s right gutter samples the same global texels as `right`'s first interior columns.
          const leftOffset = (y * size + INTERIOR + GUTTER + gutterColumn) * 4;
          const rightOffset = (y * size + GUTTER + gutterColumn) * 4;
          for (let channel = 0; channel < 3; channel++) {
            expect(Math.abs(left[leftOffset + channel] - right[rightOffset + channel])).toBeLessThanOrEqual(1);
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('only uses the per-texel slope term when cliff influence is enabled', () => {
    // A land-heavy tile must differ once the slope lattice shades cliffs.
    let anyDifference = false;
    for (let x = 0; x < 4 && !anyDifference; x++) {
      const flat = bake('material', x, 1, 0).mipData[0];
      const shaded = bake('material', x, 1, 1).mipData[0];
      anyDifference = flat.some((value, index) => value !== shaded[index]);
    }
    expect(anyDifference).toBeTrue();
  });

  it('bakes fully opaque texels for the flat per-cell colour modes', () => {
    const tile = bake('plates', 0, 1).mipData[0];
    // Plate colours come from the cached per-cell table; every texel is opaque.
    for (let index = 3; index < tile.length; index += 4) expect(tile[index]).toBe(255);
  });

  describe('cell-per-pixel lookup', () => {
    it('rasterizes the owning cell of every texel', () => {
      const raster = buildCellIdRaster(graph);
      expect(raster.length).toBe(CELL_ID_RASTER_WIDTH * CELL_ID_RASTER_HEIGHT * 4);
      for (const [x, y] of [[0, 0], [511, 255], [800, 100], [1023, 511], [300, 400]]) {
        const longitude = -Math.PI + ((x + 0.5) / CELL_ID_RASTER_WIDTH) * Math.PI * 2;
        const latitude = -Math.PI / 2 + ((y + 0.5) / CELL_ID_RASTER_HEIGHT) * Math.PI;
        const owner = findCellAt(graph, {
          x: Math.cos(latitude) * Math.sin(longitude),
          y: Math.sin(latitude),
          z: Math.cos(latitude) * Math.cos(longitude),
        });
        const offset = (y * CELL_ID_RASTER_WIDTH + x) * 4;
        expect(raster[offset] | (raster[offset + 1] << 8)).toBe(owner.id);
        expect(raster[offset + 3]).toBe(255);
      }
    });

    it('builds one opaque linear colour per cell for every mode', () => {
      for (const mode of ['natural', 'elevation', 'plates', 'material'] as const) {
        const data = buildCellColourData(world, mode);
        expect(data.length).toBe(graph.cells.length * 4);
        for (let cell = 0; cell < graph.cells.length; cell++) {
          expect(data[cell * 4 + 3]).toBe(1);
          for (let channel = 0; channel < 3; channel++) {
            const value = data[cell * 4 + channel];
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  });
});
