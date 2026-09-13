import { IPlanetGraphCore } from './planet-graph';
import type { IPlanetTectonics } from './tectonics';
import { IVec3, normalize } from './vec3';

export interface IRidgeParams {
  /** Land relief fraction above which cells can participate in a terrain ridge. */
  mountainElevationFraction?: number;
  /** Land relief fraction above which a local high point can become a summit marker. */
  peakElevationFraction?: number;
  /** Maximum graph hops between independently selected summit markers. */
  minPeakSeparationHops?: number;
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

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function edgeKey(a: number, b: number): string {
  return pairKey(a, b);
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

function buildTectonicPaths(
  graph: IPlanetGraphCore,
  tectonics: IPlanetTectonics,
): { paths: IVec3[][]; strengths: number[]; coveredCells: Set<number> } {
  const adjacency = new Map<number, Set<number>>();
  const strengthByEdge = new Map<string, number>();
  const coveredCells = new Set<number>();
  const candidateEdges = tectonics.boundaries.filter((boundary) => {
    const plateA = tectonics.plates[boundary.plateA];
    const plateB = tectonics.plates[boundary.plateB];
    return (
      boundary.type === 'convergent' &&
      plateA.type === 'continental' &&
      plateB.type === 'continental' &&
      tectonics.isLand[boundary.cellA] &&
      tectonics.isLand[boundary.cellB]
    );
  });
  const maxConvergence = Math.max(1e-6, ...candidateEdges.map((edge) => Math.max(0, edge.convergence)));

  for (const boundary of candidateEdges) {
    addEdge(adjacency, boundary.cellA, boundary.cellB);
    strengthByEdge.set(
      edgeKey(boundary.cellA, boundary.cellB),
      Math.max(0, boundary.convergence) / maxConvergence,
    );
    coveredCells.add(boundary.cellA);
    coveredCells.add(boundary.cellB);
  }

  const nodePaths = walkNetwork(adjacency);
  const paths = nodePaths.map((path) => path.map((id) => graph.cells[id].center));
  const strengths = nodePaths.map((path) => {
    let total = 0;
    let count = 0;
    for (let i = 0; i < path.length - 1; i++) {
      total += strengthByEdge.get(edgeKey(path[i], path[i + 1])) ?? 0.75;
      count++;
    }
    return count > 0 ? total / count : 0.75;
  });

  return { paths, strengths, coveredCells };
}

function buildTerrainSkeleton(
  graph: IPlanetGraphCore,
  tectonics: IPlanetTectonics,
  threshold: number,
  coveredCells: Set<number>,
): { paths: IVec3[][]; strengths: number[]; pathCells: Set<number> } {
  const high = new Set<number>();
  for (const cell of graph.cells) {
    if (tectonics.isLand[cell.id] && tectonics.elevation[cell.id] >= threshold) high.add(cell.id);
  }

  // A maximum spanning forest gives a narrow, deterministic skeleton through each connected
  // mountain patch. It preserves chains and branches while avoiding a line on every triangle of
  // a broad alpine area. Tectonic-covered cells are left to the boundary paths above.
  const edges: { a: number; b: number; score: number }[] = [];
  for (const id of high) {
    for (const neighbor of graph.cells[id].neighbors) {
      if (neighbor <= id || !high.has(neighbor)) continue;
      if (coveredCells.has(id) && coveredCells.has(neighbor)) continue;
      edges.push({
        a: id,
        b: neighbor,
        score: Math.min(tectonics.elevation[id], tectonics.elevation[neighbor]),
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
  const pathCells = new Set<number>();
  const maxScore = Math.max(1e-6, ...edges.map((edge) => edge.score));
  for (const edge of edges) {
    const aRoot = find(edge.a);
    const bRoot = find(edge.b);
    if (aRoot === bRoot) continue;
    parent.set(aRoot, bRoot);
    addEdge(adjacency, edge.a, edge.b);
    selectedScores.set(edgeKey(edge.a, edge.b), edge.score / maxScore);
    pathCells.add(edge.a);
    pathCells.add(edge.b);
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

  return { paths, strengths, pathCells };
}

export function buildPlanetRidges(
  graph: IPlanetGraphCore,
  tectonics: IPlanetTectonics,
  params: IRidgeParams = {},
): IPlanetRidges {
  const p = { ...DEFAULTS, ...params };
  const landElevations = tectonics.elevation.filter((_, id) => tectonics.isLand[id]);
  const maxLandElevation = landElevations.length > 0 ? Math.max(...landElevations) : tectonics.seaLevelElevation;
  const relief = Math.max(1e-6, maxLandElevation - tectonics.seaLevelElevation);
  const mountainThreshold = tectonics.seaLevelElevation + p.mountainElevationFraction * relief;
  const peakThreshold = tectonics.seaLevelElevation + p.peakElevationFraction * relief;

  const tectonic = buildTectonicPaths(graph, tectonics);
  const terrain = buildTerrainSkeleton(graph, tectonics, mountainThreshold, tectonic.coveredCells);
  const ridgePaths = [...tectonic.paths, ...terrain.paths];
  const ridgePathStrength = [...tectonic.strengths, ...terrain.strengths];

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
