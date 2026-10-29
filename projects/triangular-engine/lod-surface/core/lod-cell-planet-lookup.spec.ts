import { buildCellPlanetWorld, findCellAt, type ICellPlanetWorld } from 'triangular-engine/worldgen';
import {
  CELL_PLANET_LOOKUP_NEIGHBOURS, buildCellPlanetLookup, cellPlanetCellColours, resolveCellPlanetWorld, seaAlignedGlobeRadius,
} from './lod-cell-planet-lookup';

describe('cell planet lookup', () => {
  let world: ICellPlanetWorld;
  beforeAll(() => {
    world = buildCellPlanetWorld({ cellCount: 200, seed: 7 });
  });

  it('colours land and ice by biome and the sea by the ocean colour, one RGBA per cell', () => {
    const colours = cellPlanetCellColours(world);
    expect(colours.length).toBe(200 * 4);
    for (let c = 0; c < 200; c += 1) expect(colours[c * 4 + 3]).toBe(1);
    const distinct = new Set(Array.from({ length: 200 }, (_, c) => `${colours[c * 4]},${colours[c * 4 + 1]},${colours[c * 4 + 2]}`));
    // More than the ocean and one biome: the world has land.
    expect(distinct.size).toBeGreaterThan(2);
  });

  it('writes the atlas by the same longitude/latitude rule as the cell-per-pixel lookup, and ids that are the nearest cell', () => {
    const lookup = buildCellPlanetLookup(world, { atlasWidth: 64 });
    expect(lookup.cellIdWidth).toBe(64);
    expect(lookup.cellIdHeight).toBe(32);
    expect(lookup.cellTextureWidth).toBe(200);
    for (const [x, y] of [[0, 0], [10, 5], [33, 16], [63, 31], [20, 25]]) {
      const lon = -Math.PI + ((x + 0.5) / 64) * 2 * Math.PI;
      const lat = -Math.PI / 2 + ((y + 0.5) / 32) * Math.PI;
      const direction = { x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lon) };
      const o = (y * 64 + x) * 4;
      expect(lookup.cellIdData[o] | (lookup.cellIdData[o + 1] << 8)).withContext(`texel ${x},${y}`).toBe(findCellAt(world.graph, direction).id);
      expect(lookup.cellIdData[o + 3]).toBe(255);
    }
  });

  it('lists each cell\'s centre and its neighbours (at most eight, symmetric for the usual five to seven)', () => {
    const lookup = buildCellPlanetLookup(world, { atlasWidth: 64 });
    for (const cell of world.graph.cells) {
      expect(Array.from(lookup.cellCentres.slice(cell.id * 3, cell.id * 3 + 3))).toEqual([
        Math.fround(cell.center.x), Math.fround(cell.center.y), Math.fround(cell.center.z),
      ]);
      const listed = Array.from(lookup.cellNeighbours.slice(cell.id * CELL_PLANET_LOOKUP_NEIGHBOURS, (cell.id + 1) * CELL_PLANET_LOOKUP_NEIGHBOURS)).filter((n) => n >= 0);
      expect(listed.length).toBe(Math.min(cell.neighbors.length, CELL_PLANET_LOOKUP_NEIGHBOURS));
      for (const n of listed) expect(cell.neighbors).toContain(n);
    }
  });

  it('takes a colour override and checks its length', () => {
    const colours = new Float32Array(200 * 4).fill(0.5);
    expect(buildCellPlanetLookup(world, { atlasWidth: 16, colours }).cellData[5]).toBe(0.5);
    expect(() => buildCellPlanetLookup(world, { atlasWidth: 16, colours: new Float32Array(8) })).toThrowError(RangeError);
  });

  it('grows the default atlas with the cell count', () => {
    expect(buildCellPlanetLookup(world).cellIdWidth).toBe(1024);
  });

  it('resolves a description to the same cached world as the lab\'s, and passes a built world through', () => {
    expect(resolveCellPlanetWorld(world)).toBe(world);
    const a = resolveCellPlanetWorld({ seed: 3, cellCount: 60 });
    expect(resolveCellPlanetWorld({ seed: 3, cellCount: 60, relaxationIterations: 2 })).toBe(a);
    expect(() => resolveCellPlanetWorld({ seed: -1, cellCount: 60 })).toThrow();
  });

  it('lowers the globe by the sea level in metres so its sea meets the terrain\'s', () => {
    expect(seaAlignedGlobeRadius(10_000, 0.3232, 150)).toBeCloseTo(10_000 - 48.48, 6);
    expect(seaAlignedGlobeRadius(600_000, world, 1200)).toBeCloseTo(600_000 - world.tectonics.seaLevelElevation * 1200, 6);
    expect(seaAlignedGlobeRadius(10_000, 0, 150)).toBe(10_000);
  });
});
