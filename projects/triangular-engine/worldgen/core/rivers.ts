import { buildCornerGraph } from './corner-graph';
import { IPlanetGraphCore } from './planet-graph';
import { add, IVec3, normalize, scale, sub } from './vec3';
import { WaterBodyKind } from './water-bodies';

export interface IRiverParams {
  /** Maximum number of headwaters to trace. Candidates are ranked by elevation (highest first,
   * not randomly sampled — see the doc comment below for why), so raising this mainly adds
   * shorter/lower rivers rather than changing the tallest ones already included. */
  sourceCount?: number;
  minSourceMoisture?: number;
  /** Fraction of land relief (seaLevel..maxLandElevation) a source corner must sit above. */
  minSourceElevationFraction?: number;
  /** How much a river's reported flow grows from its own source (1x) to its own mouth
   * (`1 + lengthGrowthFactor`x), as a fraction of *that river's own length* — not an absolute
   * distance, so a short spring and a long trunk both read as "widening as they flow" at a
   * comparable rate. See `IPlanetRivers.riverFlow`'s doc comment for why length carries this
   * weight instead of confluence flux alone. */
  lengthGrowthFactor?: number;
  /** Fraction of the largest flow among a planet's actual river points at/above which a river
   * point counts as boat-navigable rather than a spring/creek — see
   * `IPlanetRivers.minNavigableFlow`. Mirrors Fantasy Map Generator's `MIN_NAVIGABLE_FLUX`/
   * `isNavigable()` (see runbook 022's "River hydrology rework" entry), generalized to a fraction
   * and to per-point rather than per-cell since a single river can cross the line partway down
   * its own length. */
  minNavigableFlowFraction?: number;
  /** Corner-blended temperature at/below which land or water counts as frozen: rivers never
   * originate there and stop rather than route across it. Matches `biomes.ts`'s
   * `coldTemperatureThreshold` default so a river's ice line lines up with the rendered
   * ice_cap/glacier/tundra biomes out of the box; pass a different value to decouple them. */
  frozenTemperatureThreshold?: number;
}

export interface IPlanetRivers {
  /** Ordered corner-point chains. Each one is either a full river from its own headwater to its
   * terminus, or a tributary from its headwater down to the corner where it joins a larger
   * stream (see `riverParent`) — the shared trunk below a confluence is never repeated across
   * multiple entries. */
  riverPaths: IVec3[][];
  /** Index into the planet's corner graph (`buildCornerGraph()`) of each entry's own headwater —
   * same shape/order as `riverPaths`. A corner index is stable across recomputes on the *same*
   * graph (climate/season/water-level all restyle without rebuilding the corner graph), so this
   * is the identity to diff two `IPlanetRivers` snapshots by — `riverPaths` array position is
   * NOT stable, since a headwater that freezes out or thaws in shifts every later entry's index. */
  riverHeadwaterCornerId: number[];
  /** Corner positions that are land-locked local elevation minima the trace passed through —
   * either as a final dead end (no reachable outlet was found) or a small basin the walk spilled
   * over on its way further downhill (see the "priority flood" step in `traceRivers()`). A
   * natural spot to render a small lake/pond, since the walk treats each as a real depression. */
  lakeCorners: IVec3[];
  /**
   * Flow at each point of the matching `riverPaths` entry (same shape/length), meant for
   * width-by-`sqrt(flow)` rendering (the Red Blob Games technique) and for comparing against
   * `minNavigableFlow` below. Two contributions, multiplied together:
   *
   * - **Confluence count** — 1 for a river's own single thread, plus the combined subtree size of
   *   every tributary that has merged in by this point (integer, >=1, grows only where a real
   *   confluence occurs — see `riverParent` — but then *stays* elevated for the rest of the
   *   river's length rather than spiking only at the exact merge corner).
   * - **Length progression** — see `lengthGrowthFactor`'s doc comment. Real confluence turned out
   *   to be rare on this generator's terrain (empirically verified while building this: even
   *   heavily smoothing elevation before routing barely changed how often two downhill paths
   *   converge, since the tectonics elevation model shapes broad domes/ridges rather than carved
   *   valley networks — there's no dendritic structure for flow to converge into). A river
   *   widening only at its rare confluences would mostly just look like a uniform-width line with
   *   an occasional jump; real rivers also widen continuously along their length from countless
   *   small, unmodeled tributaries and groundwater inflow, which the length term stands in for.
   *
   * Monotonic non-decreasing going downstream along any one path (both factors only grow with
   * distance from the source).
   */
  riverFlow: number[][];
  /** Index into `riverPaths` of the river each entry merges into at its last point, or `null` if
   * the entry already reaches an actual terminus (coast, lake, or ice line) itself — i.e. it *is*
   * a trunk, not a tributary. Mirrors Fantasy Map Generator's parent/basin bookkeeping: a
   * confluence is recorded explicitly instead of two independently-traced paths silently sharing
   * a downstream tail. */
  riverParent: (number | null)[];
  /** Index into `riverPaths` of the ultimate trunk each entry eventually drains into — itself for
   * a trunk (`riverBasin[i] === i` iff `riverParent[i] === null`), or the root of the parent
   * chain for a tributary (however many confluences away). */
  riverBasin: number[];
  /** The resolved (non-fractional) flow threshold `riverFlow` values are compared against for
   * navigability — same units as `riverFlow`, already scaled from `minNavigableFlowFraction`
   * against this planet's actual river-point flow range. Consumers render
   * `riverFlow[i][j] >= minNavigableFlow` as a boat-navigable channel and everything below it as
   * a spring/creek; kept as one resolved number here (rather than a per-point boolean array) so
   * both the 2D map and 3D lab read the exact same comparison against the exact same `riverFlow`
   * field, including after either resamples `riverFlow` for fractal detail (see `ecology.ts`) —
   * a boolean array would have to be threaded through that resampling in lockstep to stay
   * correct; a threshold number never can drift out of sync with the field it's compared
   * against. */
  minNavigableFlow: number;
}

const DEFAULTS = {
  sourceCount: 40,
  minSourceMoisture: 0.4,
  minSourceElevationFraction: 0.25,
  lengthGrowthFactor: 4,
  minNavigableFlowFraction: 0.35,
  frozenTemperatureThreshold: -0.35,
};

type DownhillStep =
  | { type: 'stop' }
  | { type: 'end' }
  | { type: 'coast'; from: number; to: number; t: number }
  | { type: 'corner'; target: number };

/**
 * M2 river pass, reworked 2026-08-31 (see runbook 022's "River hydrology rework" entry) after
 * comparing against Fantasy Map Generator's flow-accumulation approach. The first version of
 * this rework tried real D8-style accumulation (every land corner contributes moisture, flux
 * sums downhill, a corner becomes a river once accumulated catchment/flux crosses a threshold) —
 * built, measured, and abandoned: this generator's tectonics elevation shapes broad domes and
 * ridge lines, not carved valley networks, so a strictly-lowest-neighbor walk essentially never
 * converges (empirically confirmed — even 8 passes of neighbor-averaging smoothing before
 * routing left the largest observed catchment under 3% of a planet's land corners). Real-world
 * D8 accumulation relies on dendritic valley structure that simply isn't present in this
 * elevation model, so no amount of graph/algorithm tuning on top of it was going to produce
 * meaningfully-sized drainage basins. See that runbook entry for the full comparison and the
 * measurements that led here.
 *
 * What actually ships: headwaters are still selected deterministically rather than randomly
 * (candidates ranked by elevation, tallest first — a real, controllable fix for "rivers were too
 * short," unlike the old random `sourceCount`-sized shuffle sample which could just as easily
 * grab a barely-qualifying low source as a tall one) and each is walked downhill exactly as
 * before via `computeDownhillStep()` (unchanged: water-cell awareness, frozen-ground termination,
 * pit spill-over — see the three-refinements note below). What's new is **explicit confluence
 * handling**: if a headwater's walk reaches a corner an earlier (taller-sourced, so processed
 * first) headwater's path already claimed, it stops there and records that river as its parent
 * (`riverParent`) instead of re-tracing the shared trunk — real tributary/basin bookkeeping where
 * a confluence does occur, rather than two paths silently overlapping. And since real confluence
 * is rare on this terrain (see above), `riverFlow` also grows with distance traveled along a
 * river's own length (`lengthGrowthFactor`) so every river visibly widens downstream even without
 * one, standing in for the countless small unmodeled tributaries a real river also widens from.
 *
 * Elevation strictly decreases every ordinary step; the one exception is a "spill" over a local
 * pit's rim (see `findSpillExit()`), which can briefly rise before resuming its descent.
 *
 * A corner counts as land here when its own blended elevation is >= `seaLevelElevation` — the
 * same per-vertex rule the 3D preview's terrain color/height and its coastline overlay use
 * (`resolveVertexColor()` / `computeMeshWaterlineDirections()` in
 * cell-planet-lab-page.component.ts), not the coarser per-cell `isLand[]` flag. The final
 * downhill step that crosses from land to water is clipped to the exact sea-level point on that
 * edge (instead of ending on the underwater corner), so a river mouth lands exactly on the same
 * boundary the coastline overlay draws.
 *
 * Three refinements, unchanged from the pre-rework walk (see runbook 022 for the "rivers cross
 * lake edges / ice caps / dead-end in nowhere" bug reports these fixed):
 *
 * - **Water-cell awareness.** `cornerIsLand` above is a *blended* per-corner estimate (the 3
 *   surrounding cells' elevation averaged), so a corner can still read as "land" while one of its
 *   3 cells is an actual lake/ocean cell (`waterBodyKind`, from `classifyWaterBodies()`).
 *   `cornerWaterKind` catches this: a corner touching an actual water cell ends its own step
 *   immediately regardless of blended elevation.
 * - **Frozen ground/water is a terminus, not a surface.** A corner whose blended temperature is
 *   at/below `frozenTemperatureThreshold` never gets picked as a source and is never stepped
 *   onto: the walk ends at the ice line instead of drawing a flowing river across what renders as
 *   ice.
 * - **Local pits spill instead of dead-ending.** `findSpillExit()` floods outward from a pit
 *   (a small priority-flood/watershed-fill) until it finds a rim corner with an unflooded
 *   neighbor lower than itself — the basin's natural outlet — and the walk continues from there.
 *   The pit is still recorded in `lakeCorners`.
 */
export function traceRivers(
  graph: IPlanetGraphCore,
  elevation: number[],
  isLand: boolean[],
  seaLevelElevation: number,
  moisture: number[],
  temperature: number[],
  waterBodyKind: (WaterBodyKind | null)[],
  params: IRiverParams = {},
): IPlanetRivers {
  const p = { ...DEFAULTS, ...params };

  const landElevations = elevation.filter((_, id) => isLand[id]);
  const maxLandElevation = landElevations.length > 0 ? Math.max(...landElevations) : seaLevelElevation;
  const landRelief = Math.max(1e-6, maxLandElevation - seaLevelElevation);
  const minSourceElevation = seaLevelElevation + p.minSourceElevationFraction * landRelief;

  const corners = buildCornerGraph(graph);
  const cornerElevation = corners.cellIds.map(([a, b, c]) => (elevation[a] + elevation[b] + elevation[c]) / 3);
  const cornerMoisture = corners.cellIds.map(([a, b, c]) => (moisture[a] + moisture[b] + moisture[c]) / 3);
  const cornerTemperature = corners.cellIds.map(([a, b, c]) => (temperature[a] + temperature[b] + temperature[c]) / 3);
  const cornerIsLand = cornerElevation.map((e) => e >= seaLevelElevation);
  const cornerIsFrozen = cornerTemperature.map((t) => t <= p.frozenTemperatureThreshold);
  // The first water cell (by insertion order among the corner's 3) touching this corner, if any —
  // used only to detect "already at the shore" independent of the blended elevation above.
  const cornerWaterKind: (WaterBodyKind | null)[] = corners.cellIds.map(([a, b, c]) => {
    for (const cellId of [a, b, c]) {
      if (!isLand[cellId]) return waterBodyKind[cellId];
    }
    return null;
  });

  const lakeCorners: IVec3[] = [];
  const spillExitCache = new Map<number, number | null>();

  /**
   * A land corner with no strictly-lower neighbor is a local pit. Instead of just stopping there
   * (which reads as a river vanishing into nothing whenever the pit isn't part of an actual
   * rendered lake), flood outward from it — always expanding into the lowest unflooded corner on
   * the current boundary, the standard priority-flood/watershed-fill approach — until a boundary
   * corner is found with an unflooded neighbor lower than itself: that's the basin's natural
   * spill point, returned directly (the flooded interior isn't part of the returned path, the same
   * way the coast crossing above skips the underwater corner in favor of a single boundary point —
   * the pit is still recorded in `lakeCorners` as the basin marker). Returns `null` if the flood
   * exhausts the whole graph without finding one (only possible on a fully enclosed/disconnected
   * graph — falls back to the old dead-end behavior at the call site). Cached per pit corner:
   * multiple headwaters' walks can pass through the same pit, and the flood result never changes.
   */
  function findSpillExit(pit: number): number | null {
    const cached = spillExitCache.get(pit);
    if (cached !== undefined) return cached;

    const filled = new Set<number>([pit]);
    const frontier = new Set<number>(corners.neighbors[pit]);

    let result: number | null = null;
    let iterations = 0;
    while (frontier.size > 0 && iterations++ < corners.count) {
      let bestId = -1;
      let bestElevation = Infinity;
      for (const id of frontier) {
        if (cornerElevation[id] < bestElevation) {
          bestElevation = cornerElevation[id];
          bestId = id;
        }
      }
      frontier.delete(bestId);

      let found = false;
      for (const n of corners.neighbors[bestId]) {
        if (!filled.has(n) && cornerElevation[n] < cornerElevation[bestId]) {
          result = n;
          found = true;
          break;
        }
      }
      if (found) break;

      filled.add(bestId);
      for (const n of corners.neighbors[bestId]) {
        if (!filled.has(n) && !frontier.has(n)) {
          frontier.add(n);
        }
      }
    }

    spillExitCache.set(pit, result);
    return result;
  }

  function computeDownhillStep(current: number): DownhillStep {
    if (cornerWaterKind[current]) {
      let lowestWater = -1;
      let lowestWaterElevation = seaLevelElevation;
      for (const n of corners.neighbors[current]) {
        if (cornerElevation[n] < lowestWaterElevation) {
          lowestWaterElevation = cornerElevation[n];
          lowestWater = n;
        }
      }
      if (lowestWater !== -1) {
        const eFrom = cornerElevation[current];
        const eTo = cornerElevation[lowestWater];
        const t = eFrom === eTo ? 0 : (seaLevelElevation - eFrom) / (eTo - eFrom);
        return { type: 'coast', from: current, to: lowestWater, t };
      }
      return { type: 'stop' };
    }

    let lowest = -1;
    let lowestElevation = cornerElevation[current];
    for (const neighborIndex of corners.neighbors[current]) {
      if (cornerElevation[neighborIndex] < lowestElevation) {
        lowestElevation = cornerElevation[neighborIndex];
        lowest = neighborIndex;
      }
    }

    if (lowest === -1) {
      lakeCorners.push(corners.position[current]);
      const spillExit = findSpillExit(current);
      return spillExit !== null ? { type: 'corner', target: spillExit } : { type: 'end' };
    }

    if (cornerIsFrozen[lowest]) {
      // Don't route onto frozen ground or frozen water — end at the ice line.
      return { type: 'stop' };
    }

    if (!cornerIsLand[lowest]) {
      const eFrom = cornerElevation[current];
      const eTo = cornerElevation[lowest];
      const t = eFrom === eTo ? 0 : (seaLevelElevation - eFrom) / (eTo - eFrom);
      return { type: 'coast', from: current, to: lowest, t };
    }

    return { type: 'corner', target: lowest };
  }

  const candidates: number[] = [];
  for (let i = 0; i < corners.count; i++) {
    if (
      cornerIsLand[i] &&
      !cornerIsFrozen[i] &&
      cornerMoisture[i] >= p.minSourceMoisture &&
      cornerElevation[i] >= minSourceElevation
    ) {
      candidates.push(i);
    }
  }
  // Tallest first: deterministic, and systematically produces longer rivers than a random
  // sample of qualifying corners could (a random pick is just as likely to land barely above the
  // elevation gate as near the top of it — see the doc comment above).
  candidates.sort((a, b) => cornerElevation[b] - cornerElevation[a]);
  const headwaters = candidates.slice(0, p.sourceCount);

  const claimedBy = new Array<number>(corners.count).fill(-1);
  // Which hop index a corner occupies within *its own claiming river's* `cornerIndices` — lets a
  // later-processed tributary that merges into it find exactly where along the trunk's path to
  // apply its contribution below, without re-searching the trunk's array.
  const hopIndexInOwnerPath = new Array<number>(corners.count).fill(-1);
  const riverPaths: IVec3[][] = [];
  const riverHeadwaterCornerId: number[] = [];
  const riverParent: (number | null)[] = [];
  const pathCornerIndices: number[][] = [];
  const pathCoastCrossing: ({ from: number; to: number; t: number } | undefined)[] = [];

  for (const headwater of headwaters) {
    if (claimedBy[headwater] !== -1) continue; // already absorbed as an intermediate point of a taller river's path

    const riverIndex = riverPaths.length;
    claimedBy[headwater] = riverIndex;
    hopIndexInOwnerPath[headwater] = 0;
    const cornerIndices = [headwater];
    let coastCrossing: { from: number; to: number; t: number } | undefined;
    let mergedInto: number | null = null;
    let current = headwater;
    let steps = 0;

    while (cornerIsLand[current] && !cornerIsFrozen[current] && steps++ < corners.count * 2) {
      const step = computeDownhillStep(current);
      if (step.type === 'stop' || step.type === 'end') break;
      if (step.type === 'coast') {
        coastCrossing = step;
        break;
      }

      const next = step.target;
      if (claimedBy[next] === riverIndex) break; // cycled back into our own path (a pathological
      // chained spill) — a dead end, not a real merge into anything.
      if (claimedBy[next] !== -1) {
        cornerIndices.push(next);
        mergedInto = claimedBy[next];
        break;
      }
      claimedBy[next] = riverIndex;
      hopIndexInOwnerPath[next] = cornerIndices.length;
      cornerIndices.push(next);
      current = next;
    }

    riverPaths.push(cornerIndices.map((index) => corners.position[index]));
    riverHeadwaterCornerId.push(headwater);
    pathCornerIndices.push(cornerIndices);
    pathCoastCrossing.push(coastCrossing);
    riverParent.push(mergedInto);
  }

  const riverBasin = riverParent.map((_, i) => {
    let cur = i;
    let hops = 0;
    while (riverParent[cur] !== null && hops++ < riverParent.length) cur = riverParent[cur]!;
    return cur;
  });

  // How much a river is worth to whatever it eventually merges into: itself (1) plus every
  // tributary that merges into *it*, transitively. A child river always has a strictly higher
  // index than its parent (it can only merge into a river that was already fully traced), so a
  // single descending pass correctly finishes every subtree before it's folded into its parent.
  const subtreeContribution = new Array<number>(riverPaths.length).fill(1);
  for (let i = riverPaths.length - 1; i >= 0; i--) {
    const parent = riverParent[i];
    if (parent !== null) subtreeContribution[parent] += subtreeContribution[i];
  }

  // Confluence count at each hop of each river's own path: 1 (its own single thread) plus the
  // subtree contribution of every tributary that joined at or before that hop, so a trunk stays
  // "wider" for the rest of its length after a confluence instead of spiking only at the exact
  // merge point. Multiplied by a smooth length-progression term (1x at each river's own source,
  // `1 + lengthGrowthFactor`x at its own mouth) — see `IPlanetRivers.riverFlow`'s doc comment for
  // why both factors are needed on this terrain.
  const extraAtHop: number[][] = pathCornerIndices.map((cornerIndices) => new Array(cornerIndices.length).fill(0));
  for (let i = 0; i < riverPaths.length; i++) {
    const parent = riverParent[i];
    if (parent === null) continue;
    const mergeCorner = pathCornerIndices[i][pathCornerIndices[i].length - 1];
    const mergeHop = hopIndexInOwnerPath[mergeCorner];
    extraAtHop[parent][mergeHop] += subtreeContribution[i];
  }
  for (const extra of extraAtHop) {
    for (let hop = 1; hop < extra.length; hop++) extra[hop] += extra[hop - 1];
  }

  const riverFlow: number[][] = pathCornerIndices.map((cornerIndices, pathIndex) => {
    const lastHop = Math.max(1, cornerIndices.length - 1);
    const confluence = extraAtHop[pathIndex].map((extra) => 1 + extra);
    const flow = confluence.map((c, hop) => c * (1 + p.lengthGrowthFactor * (hop / lastHop)));
    const coastCrossing = pathCoastCrossing[pathIndex];
    if (coastCrossing) flow.push(confluence[confluence.length - 1] * (1 + p.lengthGrowthFactor));
    return flow;
  });

  for (let pathIndex = 0; pathIndex < riverPaths.length; pathIndex++) {
    const coastCrossing = pathCoastCrossing[pathIndex];
    if (coastCrossing) {
      const { from, to, t } = coastCrossing;
      const fromPos = corners.position[from];
      const toPos = corners.position[to];
      riverPaths[pathIndex].push(normalize(add(fromPos, scale(sub(toPos, fromPos), t))));
    }
  }

  // Scaled against the flow range actually present among river points, not every land corner —
  // see `minNavigableFlowFraction`'s doc comment.
  const maxRiverFlow = riverFlow.reduce((m, flows) => flows.reduce((m2, f) => Math.max(m2, f), m), 0);
  const minNavigableFlow = p.minNavigableFlowFraction * maxRiverFlow;

  return {
    riverPaths,
    riverHeadwaterCornerId,
    lakeCorners,
    riverFlow,
    riverParent,
    riverBasin,
    minNavigableFlow,
  };
}
