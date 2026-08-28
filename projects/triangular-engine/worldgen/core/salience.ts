import { IPlanetChunk } from './chunking';
import { extractCoastlines } from './coastlines';
import { IPlanetGraphCore } from './planet-graph';
import { IVec3, normalize } from './vec3';

export interface ISalienceParams {
  /** Max local-elevation-maxima cells pinned to full detail per chunk. Ranked by prominence
   * (how far a cell's elevation sits above its own neighbors' average, not raw elevation), not
   * by count — a chunk that's uniformly mountainous has low-prominence cells throughout and a
   * budget this small still bites, which is the point (see `computeCellPins()`'s doc comment). */
  maxPeaksPerChunk?: number;
  /** Max shoreline-curvature cells (capes, peninsula tips, bay mouths) pinned to full detail
   * per chunk. Ranked by how far a coastline vertex sits from a smoothed chord through its
   * neighbors along the shore, same "budget, not threshold" reasoning as peaks. */
  maxCoastalFeaturesPerChunk?: number;
  /** Max cells' worth of small islands pinned to full detail per chunk. Islands are pinned
   * whole or not at all (see `computeCellPins()`), largest first, so this is a budget on total
   * cells, not a count of islands. */
  maxIslandCellsPerChunk?: number;
  /** A land component at or below this cell count is a candidate "island" for pinning; larger
   * land components (including whatever the single largest one is, treated as the planet's
   * mainland regardless of size) are ordinary terrain and merge normally. */
  islandMaxCellCount?: number;
}

const DEFAULTS = {
  maxPeaksPerChunk: 2,
  maxCoastalFeaturesPerChunk: 2,
  maxIslandCellsPerChunk: 12,
  islandMaxCellCount: 20,
};

export interface ICellPins {
  /** 1 = this cell must always render as its own single-cell polygon at LOD1, never absorbed
   * into a merge group, regardless of the sag budget. Indexed by cell id, length =
   * `graph.cells.length`. Feed straight into `buildChunkLod1MeshData()`'s `pinned` param. */
  pinned: Uint8Array;
}

/**
 * A cheap, one-time-per-graph pass (O(cells), run once alongside chunking/tectonics — never
 * per frame) that decides which cells LOD1 is never allowed to simplify away, so the mountain
 * peak / island / coastline cape a player is looking at doesn't flatten, vanish, or shift as
 * the camera crosses the LOD distance threshold. See `buildChunkLod1MeshData()`'s `pinned`
 * param for how this plugs into the merge.
 *
 * ## Why a budget instead of a threshold
 *
 * The first version of this idea was a hard elevation/curvature threshold: pin anything
 * "prominent enough". That regresses exactly where LOD1 matters most — a genuinely mountainous
 * chunk has *most* of its cells clear a fixed prominence bar, so LOD1 does nothing right where
 * the triangle count is highest. Ranking candidates and taking only the top `maxXPerChunk` per
 * chunk bounds the extra cost to `chunks × budget` regardless of how jagged the terrain gets:
 * the single most prominent summit in a chunk stays crisp, the runner-up bumps still simplify
 * and may pop slightly, which is an acceptable trade for a bounded worst case. Same logic
 * applies to coastline capes and islands — a long jagged coastline pins only its sharpest
 * points per chunk, not the whole shore.
 *
 * ## Peaks
 *
 * Scored by prominence, not raw elevation: `elevation[cell] - average(neighbor elevations)`,
 * clamped to non-negative. A tall cell on a uniformly tall plateau has near-zero prominence (it
 * doesn't visually "stick out" from its surroundings) and is left to merge; a cell that's
 * genuinely higher than everything around it scores high regardless of the planet's overall
 * elevation range.
 *
 * ## Coastline features
 *
 * Same idea, applied to shoreline shape instead of elevation. `extractCoastlines()` already
 * walks the land/water boundary into closed loops of shared corner objects (see its doc
 * comment). For each loop vertex, this compares its position to the midpoint of two vertices a
 * few steps back and forward along the same loop — a straight run of coast sits right on that
 * chord (near-zero deviation), a headland or the tip of a bay sits far from it. The deviation
 * is attributed to whichever land cell(s) own that corner (a land cell can touch several
 * coastline vertices; it takes the max).
 *
 * ## Islands
 *
 * Land cells are flood-filled into connected components. The single largest is treated as the
 * planet's mainland and excluded — it's not at risk of "disappearing", and pinning any of it
 * wholesale would defeat LOD1 on the planet's biggest landmass. Every other component at or
 * below `islandMaxCellCount` is a candidate island, ranked by cell count (bigger first, per
 * the same reasoning as peaks — a big island is a more prominent feature, worth guaranteeing
 * first) and pinned *whole or not at all*: an island is only pinned if its full cell count
 * (within one chunk — the rare island straddling a chunk border budgets separately per chunk)
 * fits the remaining per-chunk budget. Partial pinning was deliberately avoided — pinning half
 * an island and merging the rest would still show the island deforming as its unpinned half
 * flattens, the exact popping this whole pass exists to prevent.
 */
export function computeCellPins(
  graph: IPlanetGraphCore,
  elevation: number[],
  isLand: boolean[],
  chunks: IPlanetChunk[],
  params: ISalienceParams = {},
): ICellPins {
  const p = { ...DEFAULTS, ...params };
  const cellCount = graph.cells.length;
  const pinned = new Uint8Array(cellCount);

  const peakScore = computePeakProminence(graph, elevation);
  const coastalScore = computeCoastalProminence(graph, isLand);
  const { componentIdByCell, componentSizes, mainlandComponentId } = computeLandComponents(graph, isLand);

  for (const chunk of chunks) {
    pinTopK(chunk.cellIds, peakScore, p.maxPeaksPerChunk, pinned);
    pinTopK(chunk.cellIds, coastalScore, p.maxCoastalFeaturesPerChunk, pinned);
    pinIslandsForChunk(
      chunk.cellIds,
      componentIdByCell,
      componentSizes,
      mainlandComponentId,
      p.islandMaxCellCount,
      p.maxIslandCellsPerChunk,
      pinned,
    );
  }

  return { pinned };
}

function computePeakProminence(graph: IPlanetGraphCore, elevation: number[]): Float64Array {
  const score = new Float64Array(graph.cells.length);
  for (const cell of graph.cells) {
    if (cell.neighbors.length === 0) continue;
    let neighborSum = 0;
    for (const neighborId of cell.neighbors) neighborSum += elevation[neighborId];
    const neighborAvg = neighborSum / cell.neighbors.length;
    score[cell.id] = Math.max(0, elevation[cell.id] - neighborAvg);
  }
  return score;
}

function computeCoastalProminence(graph: IPlanetGraphCore, isLand: boolean[]): Float64Array {
  const score = new Float64Array(graph.cells.length);
  const loops = extractCoastlines(graph, isLand);
  const deviationByVertex = new Map<IVec3, number>();

  for (const loop of loops) {
    const n = loop.length;
    if (n < 3) continue;
    const window = Math.max(1, Math.min(2, Math.floor(n / 3)));
    for (let i = 0; i < n; i++) {
      const prev = loop[(i - window + n) % n];
      const next = loop[(i + window) % n];
      const mid = normalize({ x: prev.x + next.x, y: prev.y + next.y, z: prev.z + next.z });
      const cur = loop[i];
      const cosAngle = Math.max(-1, Math.min(1, mid.x * cur.x + mid.y * cur.y + mid.z * cur.z));
      const deviation = Math.acos(cosAngle);
      const existing = deviationByVertex.get(cur) ?? 0;
      if (deviation > existing) deviationByVertex.set(cur, deviation);
    }
  }

  for (const cell of graph.cells) {
    if (!isLand[cell.id]) continue;
    let best = 0;
    for (const corner of cell.corners) {
      const d = deviationByVertex.get(corner);
      if (d !== undefined && d > best) best = d;
    }
    score[cell.id] = best;
  }
  return score;
}

function computeLandComponents(
  graph: IPlanetGraphCore,
  isLand: boolean[],
): { componentIdByCell: Int32Array; componentSizes: number[]; mainlandComponentId: number } {
  const cellCount = graph.cells.length;
  const componentIdByCell = new Int32Array(cellCount).fill(-1);
  const componentSizes: number[] = [];

  for (let start = 0; start < cellCount; start++) {
    if (!isLand[start] || componentIdByCell[start] !== -1) continue;
    const componentId = componentSizes.length;
    let size = 0;
    componentIdByCell[start] = componentId;
    let frontier = [start];
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const id of frontier) {
        size++;
        for (const neighborId of graph.cells[id].neighbors) {
          if (!isLand[neighborId] || componentIdByCell[neighborId] !== -1) continue;
          componentIdByCell[neighborId] = componentId;
          next.push(neighborId);
        }
      }
      frontier = next;
    }
    componentSizes.push(size);
  }

  let mainlandComponentId = -1;
  let mainlandSize = -1;
  componentSizes.forEach((size, id) => {
    if (size > mainlandSize) {
      mainlandSize = size;
      mainlandComponentId = id;
    }
  });

  return { componentIdByCell, componentSizes, mainlandComponentId };
}

function pinTopK(cellIds: number[], score: Float64Array, k: number, pinned: Uint8Array): void {
  if (k <= 0) return;
  const candidates = cellIds.filter((id) => score[id] > 0);
  candidates.sort((a, b) => score[b] - score[a]);
  for (let i = 0; i < Math.min(k, candidates.length); i++) pinned[candidates[i]] = 1;
}

function pinIslandsForChunk(
  cellIds: number[],
  componentIdByCell: Int32Array,
  componentSizes: number[],
  mainlandComponentId: number,
  islandMaxCellCount: number,
  budget: number,
  pinned: Uint8Array,
): void {
  if (budget <= 0) return;

  const cellsByComponent = new Map<number, number[]>();
  for (const cellId of cellIds) {
    const componentId = componentIdByCell[cellId];
    if (componentId === -1 || componentId === mainlandComponentId) continue;
    if (componentSizes[componentId] > islandMaxCellCount) continue;
    let list = cellsByComponent.get(componentId);
    if (!list) {
      list = [];
      cellsByComponent.set(componentId, list);
    }
    list.push(cellId);
  }

  const components = Array.from(cellsByComponent.entries()).sort((a, b) => componentSizes[b[0]] - componentSizes[a[0]]);

  let remaining = budget;
  for (const [, cells] of components) {
    if (cells.length > remaining) continue; // doesn't fit — skip whole island rather than pin it partially
    for (const cellId of cells) pinned[cellId] = 1;
    remaining -= cells.length;
  }
}
