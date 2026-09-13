import { IPlanetGraphCore } from './planet-graph';
import { createSeededRandom } from './seeded-random';
import type { IPlanetTectonics } from './tectonics';
import { add, cross, dot, IVec3, length, normalize, projectOnTangentPlane, scale, sub } from './vec3';

export interface IRidgeDetailParams {
  /** Number of local stations, including the two cell-centre anchors. */
  stationCount?: number;
  /** Number of candidate local sites at each interior station. Odd values keep a centre lane. */
  laneCount?: number;
  /** Maximum sideways corridor width as a fraction of the cell-centre chord. */
  corridorWidth?: number;
  /** Jitter applied to local sites before the shortest corridor route is selected. */
  siteJitter?: number;
}

export interface IRidgeParams {
  /** Land relief fraction above which cells can participate in a terrain ridge. */
  mountainElevationFraction?: number;
  /** Land relief fraction above which a local high point can become a summit marker. */
  peakElevationFraction?: number;
  /** Maximum graph hops between independently selected summit markers. */
  minPeakSeparationHops?: number;
  /** Shared detail pass for both the 2D map and 3D globe ridge overlays. */
  ridgeDetail?: IRidgeDetailParams;
  /** Fraction of an adjacent-cell chord used to keep ridge links clear of river paths. */
  riverClearance?: number;
}

export interface IPlanetRidges {
  /** Ordered open polylines through mountain-cell centres. Each segment joins adjacent cells,
   * leaving Voronoi cell edges available for rivers and coastlines. Paths split at branches and
   * junctions. */
  ridgePaths: IVec3[][];
  /** Relative strength for each `ridgePaths` entry, normalized to roughly 0..1. */
  ridgePathStrength: number[];
  /** Isolated or locally dominant mountain points that do not need an invented connecting line. */
  ridgePeaks: IVec3[];
  /** Stable cell ids corresponding to `ridgePeaks`. */
  ridgePeakCellIds: number[];
}

const DEFAULTS = {
  mountainElevationFraction: 0.55,
  peakElevationFraction: 0.72,
  minPeakSeparationHops: 3,
};

const RIDGE_DETAIL_DEFAULTS: Required<IRidgeDetailParams> = {
  stationCount: 5,
  laneCount: 3,
  corridorWidth: 0.18,
  siteJitter: 0.72,
};

const RIDGE_DEFAULTS = {
  riverClearance: 0.16,
};

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function edgeKey(a: number, b: number): string {
  return pairKey(a, b);
}

function hashPair(a: number, b: number): number {
  let value = (a < b ? a * 0x45d9f3b + b : b * 0x45d9f3b + a) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function sphericalDistance(a: IVec3, b: IVec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

function localCorridorPoint(
  a: IVec3,
  b: IVec3,
  forward: IVec3,
  side: IVec3,
  t: number,
  lateral: number,
  longitudinal: number,
): IVec3 {
  const base = normalize(add(scale(a, 1 - t), scale(b, t)));
  return normalize(add(base, add(scale(side, lateral), scale(forward, longitudinal))));
}

/**
 * Adds a small Voronoi-style route inside each cell-to-cell link. The local sites are arranged
 * in jittered stations across a narrow corridor, then the lowest-cost route through those sites
 * is selected. It is deliberately a local construction: the cell centres and network junctions
 * remain exact shared anchors, while the inserted unit-sphere points give both renderers the same
 * irregular crest line.
 */
function detailRidgeSegment(a: IVec3, b: IVec3, seed: number, params: IRidgeDetailParams): IVec3[] {
  const p = { ...RIDGE_DETAIL_DEFAULTS, ...params };
  const stationCount = Math.max(2, Math.round(p.stationCount));
  const laneCount = Math.max(1, Math.round(p.laneCount) | 1);
  if (stationCount < 3 || laneCount < 2) return [a, b];

  const chord = length(sub(b, a));
  if (chord < 1e-8) return [a];

  const midpoint = normalize(add(a, b));
  const forward = normalize(projectOnTangentPlane(sub(b, a), midpoint));
  const side = normalize(cross(midpoint, forward));
  if (length(forward) < 1e-8 || length(side) < 1e-8) return [a, b];

  const rng = createSeededRandom(seed >>> 0);
  const sites: IVec3[][] = [[a]];
  const halfLane = (laneCount - 1) / 2;
  for (let station = 1; station < stationCount - 1; station++) {
    const t = station / (stationCount - 1);
    const envelope = Math.sin(Math.PI * t);
    const stationSites: IVec3[] = [];
    for (let lane = 0; lane < laneCount; lane++) {
      const laneOffset = (lane - halfLane) / Math.max(1, halfLane);
      const lateralJitter = (rng() * 2 - 1) * p.siteJitter * 0.42;
      const longitudinalJitter = (rng() * 2 - 1) * p.siteJitter * 0.12;
      const lateral = (laneOffset + lateralJitter) * chord * p.corridorWidth * envelope;
      const longitudinal = longitudinalJitter * chord * 0.12 * envelope;
      stationSites.push(localCorridorPoint(a, b, forward, side, t, lateral, longitudinal));
    }
    sites.push(stationSites);
  }
  sites.push([b]);

  // A dynamic-programming shortest path through adjacent local Voronoi stations. The small
  // centre-line bias prevents a route from hugging the corridor wall unless the jitter makes it
  // materially shorter, which keeps the result inside its mountain cells in normal cases.
  const costs: number[][] = sites.map((station) => station.map(() => Number.POSITIVE_INFINITY));
  const previous: number[][] = sites.map((station) => station.map(() => -1));
  costs[0][0] = 0;
  for (let station = 1; station < sites.length; station++) {
    for (let current = 0; current < sites[station].length; current++) {
      const currentPoint = sites[station][current];
      const currentLane = sites[station].length === 1 ? 0 : (current - halfLane) / Math.max(1, halfLane);
      for (let prior = 0; prior < sites[station - 1].length; prior++) {
        const priorPoint = sites[station - 1][prior];
        const cost = costs[station - 1][prior] + sphericalDistance(priorPoint, currentPoint) + Math.abs(currentLane) * chord * 0.035;
        if (cost < costs[station][current]) {
          costs[station][current] = cost;
          previous[station][current] = prior;
        }
      }
    }
  }

  const result: IVec3[] = [];
  let station = sites.length - 1;
  let index = 0;
  while (station >= 0) {
    result.push(sites[station][index]);
    index = previous[station][index];
    station--;
    if (station >= 0 && index < 0) return [a, b];
  }
  result.reverse();
  return result;
}

function detailRidgePaths(paths: IVec3[][], graphSeed: number, params: IRidgeDetailParams = {}): IVec3[][] {
  return paths.map((path, pathIndex) => {
    if (path.length < 2) return path;
    const detailed: IVec3[] = [path[0]];
    for (let i = 0; i < path.length - 1; i++) {
      const segment = detailRidgeSegment(path[i], path[i + 1], (graphSeed ^ hashPair(pathIndex, i)) >>> 0, params);
      detailed.push(...segment.slice(1));
    }
    return detailed;
  });
}

interface IPlanarPoint {
  x: number;
  y: number;
}

function projectToLocalPlane(point: IVec3, origin: IVec3, axisX: IVec3, axisY: IVec3): IPlanarPoint {
  const tangent = projectOnTangentPlane(point, origin);
  return { x: dot(tangent, axisX), y: dot(tangent, axisY) };
}

function planarCross(a: IPlanarPoint, b: IPlanarPoint, c: IPlanarPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function planarDistance(a: IPlanarPoint, b: IPlanarPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointToPlanarSegmentDistance(point: IPlanarPoint, a: IPlanarPoint, b: IPlanarPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  if (denominator < 1e-12) return planarDistance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function planarSegmentsNear(
  a: IPlanarPoint,
  b: IPlanarPoint,
  c: IPlanarPoint,
  d: IPlanarPoint,
  clearance: number,
): boolean {
  const abC = planarCross(a, b, c);
  const abD = planarCross(a, b, d);
  const cdA = planarCross(c, d, a);
  const cdB = planarCross(c, d, b);
  const intersects =
    (abC === 0 || abD === 0 || Math.sign(abC) !== Math.sign(abD)) &&
    (cdA === 0 || cdB === 0 || Math.sign(cdA) !== Math.sign(cdB));
  if (intersects) return true;
  return Math.min(
    pointToPlanarSegmentDistance(a, c, d),
    pointToPlanarSegmentDistance(b, c, d),
    pointToPlanarSegmentDistance(c, a, b),
    pointToPlanarSegmentDistance(d, a, b),
  ) <= clearance;
}

/** Returns true when a cell-centre chord touches a river corridor in its local tangent plane. */
function ridgeEdgeTouchesRiver(a: IVec3, b: IVec3, riverPaths: IVec3[][], clearanceFraction: number): boolean {
  if (riverPaths.length === 0) return false;
  const midpoint = normalize(add(a, b));
  const axisX = normalize(projectOnTangentPlane(sub(b, a), midpoint));
  if (length(axisX) < 1e-8) return false;
  const axisY = normalize(cross(midpoint, axisX));
  const ridgeA = projectToLocalPlane(a, midpoint, axisX, axisY);
  const ridgeB = projectToLocalPlane(b, midpoint, axisX, axisY);
  const clearance = length(sub(a, b)) * Math.max(0, clearanceFraction);

  for (const riverPath of riverPaths) {
    for (let i = 0; i < riverPath.length - 1; i++) {
      // The tangent plane is only a useful local approximation. Ignore river segments on the
      // far side of the globe instead of allowing their projection to create false crossings.
      if (dot(riverPath[i], midpoint) < 0.92 && dot(riverPath[i + 1], midpoint) < 0.92) continue;
      const riverA = projectToLocalPlane(riverPath[i], midpoint, axisX, axisY);
      const riverB = projectToLocalPlane(riverPath[i + 1], midpoint, axisX, axisY);
      if (planarSegmentsNear(ridgeA, ridgeB, riverA, riverB, clearance)) return true;
    }
  }
  return false;
}

function normalizedRelief(elevation: number, seaLevel: number, relief: number): number {
  return Math.max(0, Math.min(1, (elevation - seaLevel) / Math.max(1e-6, relief)));
}

/**
 * Measures whether a candidate link follows a crest: the two cells should be high relative to
 * their neighbours on either side of the link. This prevents a maximum spanning tree from
 * treating every high-cell connection as equally ridge-like, which was the source of many sharp
 * zigzags across broad mountain patches.
 */
function crestScore(
  graph: IPlanetGraphCore,
  elevation: number[],
  cellId: number,
  alongCellId: number,
  seaLevel: number,
  relief: number,
): number {
  const sideNeighbors = graph.cells[cellId].neighbors.filter((id) => id !== alongCellId);
  if (sideNeighbors.length === 0) return normalizedRelief(elevation[cellId], seaLevel, relief);
  const sideMaximum = Math.max(...sideNeighbors.map((id) => elevation[id]));
  const sideAverage = sideNeighbors.reduce((sum, id) => sum + elevation[id], 0) / sideNeighbors.length;
  const reliefAboveMaximum = normalizedRelief(elevation[cellId] - sideMaximum + seaLevel, seaLevel, relief);
  const reliefAboveAverage = normalizedRelief(elevation[cellId] - sideAverage + seaLevel, seaLevel, relief);
  return reliefAboveMaximum * 0.7 + reliefAboveAverage * 0.3;
}

function addEdge(adjacency: Map<number, Set<number>>, a: number, b: number): void {
  let aNeighbors = adjacency.get(a);
  if (!aNeighbors) {
    aNeighbors = new Set<number>();
    adjacency.set(a, aNeighbors);
  }
  aNeighbors.add(b);

  let bNeighbors = adjacency.get(b);
  if (!bNeighbors) {
    bNeighbors = new Set<number>();
    adjacency.set(b, bNeighbors);
  }
  bNeighbors.add(a);
}

function walkNetwork(
  adjacency: Map<number, Set<number>>,
): number[][] {
  const visitedEdges = new Set<string>();
  const paths: number[][] = [];
  const nodes = [...adjacency.keys()];

  const walkFrom = (start: number, first: number): void => {
    const path = [start];
    let previous = start;
    let current = first;
    visitedEdges.add(edgeKey(previous, current));
    path.push(current);

    while ((adjacency.get(current)?.size ?? 0) === 2) {
      const next = [...(adjacency.get(current) ?? [])].find((id) => id !== previous);
      if (next === undefined || visitedEdges.has(edgeKey(current, next))) break;
      visitedEdges.add(edgeKey(current, next));
      path.push(next);
      previous = current;
      current = next;
    }

    if (path.length >= 2) paths.push(path);
  };

  // Start at endpoints and junctions, which splits a branched network into readable paths.
  for (const start of nodes) {
    if ((adjacency.get(start)?.size ?? 0) === 2) continue;
    for (const neighbor of adjacency.get(start) ?? []) {
      if (!visitedEdges.has(edgeKey(start, neighbor))) walkFrom(start, neighbor);
    }
  }

  // A closed loop has no endpoint or junction. It is unusual for a plate boundary, but handling
  // it keeps the extractor complete for synthetic fixtures and future terrain ridge graphs.
  for (const start of nodes) {
    for (const neighbor of adjacency.get(start) ?? []) {
      if (!visitedEdges.has(edgeKey(start, neighbor))) walkFrom(start, neighbor);
    }
  }

  return paths;
}

function hopsWithin(graph: IPlanetGraphCore, start: number, target: number, maxHops: number): boolean {
  if (start === target) return true;
  const visited = new Set<number>([start]);
  let frontier = [start];
  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const neighbor of graph.cells[id].neighbors) {
        if (neighbor === target) return true;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return false;
}

function buildRidgeSkeleton(
  graph: IPlanetGraphCore,
  tectonics: IPlanetTectonics,
  threshold: number,
  riverPaths: IVec3[][],
  riverClearance: number,
): { paths: IVec3[][]; strengths: number[] } {
  const high = new Set<number>();
  const landElevations = tectonics.elevation.filter((_, id) => tectonics.isLand[id]);
  const maxLandElevation = landElevations.length > 0 ? Math.max(...landElevations) : tectonics.seaLevelElevation;
  const relief = Math.max(1e-6, maxLandElevation - tectonics.seaLevelElevation);
  for (const cell of graph.cells) {
    if (tectonics.isLand[cell.id] && tectonics.elevation[cell.id] >= threshold) high.add(cell.id);
  }

  const convergenceByEdge = new Map<string, number>();
  const convergentEdges = tectonics.boundaries.filter((boundary) => {
    const plateA = tectonics.plates[boundary.plateA];
    const plateB = tectonics.plates[boundary.plateB];
    return (
      boundary.type === 'convergent' &&
      plateA.type === 'continental' &&
      plateB.type === 'continental'
    );
  });
  const maxConvergence = Math.max(1e-6, ...convergentEdges.map((edge) => Math.max(0, edge.convergence)));
  for (const edge of convergentEdges) {
    convergenceByEdge.set(edgeKey(edge.cellA, edge.cellB), Math.max(0, edge.convergence) / maxConvergence);
  }

  // A maximum spanning forest gives a narrow skeleton through each connected mountain patch.
  // Its edge score now combines absolute height, lateral crest relief, and tectonic convergence.
  // The river check happens before the forest is built, so a river can split a mountain range
  // cleanly instead of being crossed by an overlay line.
  const edges: { a: number; b: number; score: number; tectonic: number }[] = [];
  for (const id of high) {
    for (const neighbor of graph.cells[id].neighbors) {
      if (neighbor <= id || !high.has(neighbor)) continue;
      if (ridgeEdgeTouchesRiver(graph.cells[id].center, graph.cells[neighbor].center, riverPaths, riverClearance)) {
        continue;
      }
      const tectonic = convergenceByEdge.get(edgeKey(id, neighbor)) ?? 0;
      const height = normalizedRelief(
        Math.min(tectonics.elevation[id], tectonics.elevation[neighbor]),
        threshold,
        Math.max(1e-6, maxLandElevation - threshold),
      );
      const crest = (crestScore(graph, tectonics.elevation, id, neighbor, tectonics.seaLevelElevation, relief) +
        crestScore(graph, tectonics.elevation, neighbor, id, tectonics.seaLevelElevation, relief)) / 2;
      edges.push({
        a: id,
        b: neighbor,
        score: height * 0.35 + crest * 0.45 + tectonic * 0.2,
        tectonic,
      });
    }
  }
  edges.sort((a, b) => b.score - a.score || a.a - b.a || a.b - b.b);

  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = parent.get(id) ?? id;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    let current = id;
    while (parent.has(current) && parent.get(current) !== current) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    parent.set(id, root);
    return root;
  };
  for (const id of high) parent.set(id, id);

  const adjacency = new Map<number, Set<number>>();
  const selectedScores = new Map<string, number>();
  const maxScore = Math.max(1e-6, ...edges.map((edge) => edge.score));
  for (const edge of edges) {
    const aRoot = find(edge.a);
    const bRoot = find(edge.b);
    if (aRoot === bRoot) continue;
    parent.set(aRoot, bRoot);
    addEdge(adjacency, edge.a, edge.b);
    selectedScores.set(edgeKey(edge.a, edge.b), (edge.score / maxScore) * 0.8 + edge.tectonic * 0.2);
  }

  const nodePaths = walkNetwork(adjacency);
  const paths = nodePaths.map((path) => path.map((id) => graph.cells[id].center));
  const strengths = nodePaths.map((path) => {
    let total = 0;
    let count = 0;
    for (let i = 0; i < path.length - 1; i++) {
      total += selectedScores.get(edgeKey(path[i], path[i + 1])) ?? 0.6;
      count++;
    }
    return count > 0 ? total / count : 0.6;
  });

  return { paths, strengths };
}

export function buildPlanetRidges(
  graph: IPlanetGraphCore,
  tectonics: IPlanetTectonics,
  params: IRidgeParams = {},
  riverPaths: IVec3[][] = [],
): IPlanetRidges {
  const p = { ...DEFAULTS, ...RIDGE_DEFAULTS, ...params };
  const landElevations = tectonics.elevation.filter((_, id) => tectonics.isLand[id]);
  const maxLandElevation = landElevations.length > 0 ? Math.max(...landElevations) : tectonics.seaLevelElevation;
  const relief = Math.max(1e-6, maxLandElevation - tectonics.seaLevelElevation);
  const mountainThreshold = tectonics.seaLevelElevation + p.mountainElevationFraction * relief;
  const peakThreshold = tectonics.seaLevelElevation + p.peakElevationFraction * relief;

  const terrain = buildRidgeSkeleton(
    graph,
    tectonics,
    mountainThreshold,
    riverPaths,
    p.riverClearance,
  );
  const ridgePaths = detailRidgePaths(
    terrain.paths,
    graph.seed,
    p.ridgeDetail,
  );
  const ridgePathStrength = terrain.strengths;

  const candidatePeaks = graph.cells
    .filter((cell) => {
      if (!tectonics.isLand[cell.id] || tectonics.elevation[cell.id] < peakThreshold) return false;
      return cell.neighbors.every((neighbor) => tectonics.elevation[cell.id] >= tectonics.elevation[neighbor]);
    })
    .sort((a, b) => tectonics.elevation[b.id] - tectonics.elevation[a.id] || a.id - b.id);

  const ridgePeakCellIds: number[] = [];
  for (const cell of candidatePeaks) {
    if (ridgePeakCellIds.some((selected) => hopsWithin(graph, selected, cell.id, p.minPeakSeparationHops))) {
      continue;
    }
    ridgePeakCellIds.push(cell.id);
  }

  return {
    ridgePaths,
    ridgePathStrength,
    ridgePeaks: ridgePeakCellIds.map((id) => normalize(graph.cells[id].center)),
    ridgePeakCellIds,
  };
}
