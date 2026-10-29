import { findCellNear, type ICellPlanetWorld, type IVec3 } from 'triangular-engine/worldgen';
import { OCEAN_COLOR, biomeColor, lavaOceanColor, parseColorToLinearRgb } from 'triangular-engine/worldgen/render/core';
import { cellPlanetWorld, parseCellPlanet, type CellPlanetDescription } from './lod-height-terrain';

/**
 * A cell planet as plain data for the terrain's ground colours (Plan 059, G3): what the planet material's exact cell lookup
 * (`cellVoronoiLayer` in `triangular-engine/planet-material`) reads. Structurally the layer's `ICellVoronoiPayload`; it is
 * declared here so this framework-free entry does not import the material.
 */
export interface CellPlanetLookup {
  /** One linear RGBA float per cell: the display colour and a blend weight of 1. */
  readonly cellData: Float32Array;
  readonly cellTextureWidth: number;
  /** Cell id per atlas texel, low byte in R and high byte in G, row 0 at the south pole. */
  readonly cellIdData: Uint8Array;
  readonly cellIdWidth: number;
  readonly cellIdHeight: number;
  /** Unit centre of each cell, `x, y, z` per cell. */
  readonly cellCentres: Float32Array;
  /** Neighbour ids, 8 per cell (`-1` for unused slots). */
  readonly cellNeighbours: Int32Array;
}

/** Options of {@link buildCellPlanetLookup}. */
export interface CellPlanetLookupOptions {
  /**
   * Atlas width in texels (its height is half). The exact lookup only needs a texel smaller than a cell, so the default
   * grows with the cell count: 1,024 up to about 20,000 cells, never above 8,192.
   */
  readonly atlasWidth?: number;
  /** One linear RGBA float per cell, replacing the biome colours of {@link cellPlanetCellColours}. */
  readonly colours?: Float32Array;
}

/** Neighbour slots per cell in {@link CellPlanetLookup.cellNeighbours}. */
export const CELL_PLANET_LOOKUP_NEIGHBOURS = 8;

/**
 * Biome colours per cell, linear RGBA: land and ice take their biome's colour, the sea the ocean colour (lava for a lava
 * world). These are the colours the globe paints in its `natural` mode for the same world, so the ground and the globe agree.
 */
export function cellPlanetCellColours(world: ICellPlanetWorld): Float32Array {
  const out = new Float32Array(world.graph.cells.length * 4);
  const sea = parseColorToLinearRgb(world.profile.oceanSubstance === 'lava' ? lavaOceanColor() : OCEAN_COLOR);
  for (const cell of world.graph.cells) {
    const sample = world.sampler.sample(cell.center);
    const [r, g, b] = sample.isLand || sample.isIce ? parseColorToLinearRgb(biomeColor(world.ecology.biome[cell.id])) : sea;
    out.set([r, g, b, 1], cell.id * 4);
  }
  return out;
}

/** Smallest power of two atlas width whose texel is a quarter of a cell or less, between 1,024 and 8,192. */
function atlasWidthFor(cellCount: number): number {
  const cellAngle = Math.sqrt((4 * Math.PI) / cellCount);
  const needed = (2 * Math.PI * 4) / cellAngle;
  return Math.min(8192, Math.max(1024, 2 ** Math.ceil(Math.log2(needed))));
}

/**
 * Builds the data the terrain's ground colours need from a built world, on the calling thread: the cell colours, a cell-id
 * atlas by longitude and latitude, and each cell's centre and neighbours for the exact edge lookup. Pass the same world the
 * heights come from (`buildCellPlanetWorld` with the parameters given to `cellPlanetHeights`).
 *
 * Cost grows with the atlas, not the cell count: every texel is one nearest-cell walk from its left neighbour. Memory is
 * `atlasWidth * atlasWidth / 2 * 4` bytes for the atlas (2 MB at 1,024) plus 64 B per cell.
 *
 * @throws RangeError for more than 65,535 cells (the atlas holds a two-byte id) or a colour array of the wrong length.
 */
export function buildCellPlanetLookup(world: ICellPlanetWorld, options: CellPlanetLookupOptions = {}): CellPlanetLookup {
  const { cells } = world.graph;
  const count = cells.length;
  if (count > 65_535) throw new RangeError(`A cell planet lookup holds at most 65,535 cells, got ${count}`);
  const cellData = options.colours ?? cellPlanetCellColours(world);
  if (cellData.length !== count * 4) throw new RangeError('Cell colours must be four floats per cell.');

  const cellIdWidth = Math.max(2, Math.floor(options.atlasWidth ?? atlasWidthFor(count)));
  const cellIdHeight = Math.max(2, cellIdWidth >> 1);
  const cellIdData = new Uint8Array(cellIdWidth * cellIdHeight * 4);
  const direction: IVec3 = { x: 0, y: 0, z: 0 };
  let hint = 0;
  for (let y = 0; y < cellIdHeight; y += 1) {
    const latitude = -Math.PI / 2 + ((y + 0.5) / cellIdHeight) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    direction.y = Math.sin(latitude);
    for (let x = 0; x < cellIdWidth; x += 1) {
      const longitude = -Math.PI + ((x + 0.5) / cellIdWidth) * Math.PI * 2;
      direction.x = cosLatitude * Math.sin(longitude);
      direction.z = cosLatitude * Math.cos(longitude);
      hint = findCellNear(world.graph, direction, hint).id;
      const offset = (y * cellIdWidth + x) * 4;
      cellIdData[offset] = hint & 255;
      cellIdData[offset + 1] = (hint >> 8) & 255;
      cellIdData[offset + 3] = 255;
    }
  }

  const cellCentres = new Float32Array(count * 3);
  const cellNeighbours = new Int32Array(count * CELL_PLANET_LOOKUP_NEIGHBOURS).fill(-1);
  for (const cell of cells) {
    cellCentres.set([cell.center.x, cell.center.y, cell.center.z], cell.id * 3);
    // More than eight neighbours is rare; keep the eight nearest, which are the ones that can own a nearby edge.
    const nearest = [...cell.neighbors].sort((a, b) => dotCentres(world, cell.id, b) - dotCentres(world, cell.id, a));
    nearest.slice(0, CELL_PLANET_LOOKUP_NEIGHBOURS).forEach((id, k) => {
      cellNeighbours[cell.id * CELL_PLANET_LOOKUP_NEIGHBOURS + k] = id;
    });
  }
  return { cellData: new Float32Array(cellData), cellTextureWidth: count, cellIdData, cellIdWidth, cellIdHeight, cellCentres, cellNeighbours };
}

function dotCentres(world: ICellPlanetWorld, a: number, b: number): number {
  const p = world.graph.cells[a].center;
  const q = world.graph.cells[b].center;
  return p.x * q.x + p.y * q.y + p.z * q.z;
}

/**
 * What identifies a cell planet for the terrain's colours: a built world, or the description used for `cellPlanetHeights`
 * (`seed`, `cellCount`, optional `relaxationIterations`), from which the world is built on the calling thread.
 */
export type CellPlanetSource = ICellPlanetWorld | Pick<CellPlanetDescription, 'seed' | 'cellCount'> & Partial<Pick<CellPlanetDescription, 'relaxationIterations'>>;

/** The world of a {@link CellPlanetSource}: itself when already built, else built by `cellPlanetWorld` (once per description, then kept). */
export function resolveCellPlanetWorld(source: CellPlanetSource): ICellPlanetWorld {
  if ('graph' in source) return source;
  const description = parseCellPlanet({ relaxationIterations: 2, ...source, heightScaleM: 1 });
  return cellPlanetWorld(description).world;
}

/**
 * The radius to give the morph globe so its sea meets the terrain's. The terrain puts the sea at its `radius` (heights are
 * `(elevation - seaLevel) * heightScaleM`); the globe puts raw elevation at `radius + elevation * heightScale`, so its sea
 * sits `seaLevelElevation * heightScale` higher. Drawing the globe at the returned radius moves its sea down onto the
 * terrain's. Use the same `heightScaleM` for both, and leave the terrain's `radius` alone.
 *
 * @param radius The radius both bodies were meant to have, metres.
 * @param sea The built world, or its `tectonics.seaLevelElevation` (the lab's seed has 0.3232).
 * @param heightScaleM Metres per elevation unit, the globe's `heightScale`.
 */
export function seaAlignedGlobeRadius(radius: number, sea: ICellPlanetWorld | number, heightScaleM: number): number {
  const seaLevelElevation = typeof sea === 'number' ? sea : sea.tectonics.seaLevelElevation;
  return radius - seaLevelElevation * heightScaleM;
}
