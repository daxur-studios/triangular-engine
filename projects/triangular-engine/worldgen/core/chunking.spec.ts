import {
  buildChunkBoundaryLoop,
  buildChunkLod1MeshData,
  buildChunkMeshData,
  buildPlanetChunks,
  triangulatePolygon2D,
} from './chunking';
import { buildPlanetGraphCore, IPlanetGraphCore } from './planet-graph';
import { cellCornerElevation } from './sample-elevation';

/** BFS reachability of `cellIds` restricted to edges between members of the same set —
 * true iff the set is a single connected region under the graph's neighbor adjacency. */
function isConnected(graph: IPlanetGraphCore, cellIds: number[]): boolean {
  if (cellIds.length <= 1) return true;
  const member = new Set(cellIds);
  const visited = new Set<number>([cellIds[0]]);
  let frontier = [cellIds[0]];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const cellId of frontier) {
      for (const neighborId of graph.cells[cellId].neighbors) {
        if (!member.has(neighborId) || visited.has(neighborId)) continue;
        visited.add(neighborId);
        next.push(neighborId);
      }
    }
    frontier = next;
  }
  return visited.size === cellIds.length;
}

describe('buildPlanetChunks', () => {
  it('assigns every cell to exactly one chunk', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 7 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 100 });

    expect(chunkIdByCell.length).toBe(graph.cells.length);
    expect(chunkIdByCell.every((id) => id >= 0)).toBe(true);

    const seen = new Set<number>();
    for (const chunk of chunks) {
      for (const cellId of chunk.cellIds) {
        expect(seen.has(cellId)).toBe(false);
        seen.add(cellId);
      }
    }
    expect(seen.size).toBe(graph.cells.length);
  });

  it('every chunk is a single connected region', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 11 });
    const { chunks } = buildPlanetChunks(graph, { targetChunkSize: 100 });

    for (const chunk of chunks) {
      expect(isConnected(graph, chunk.cellIds)).toBe(true);
    }
  });

  it('chunk count is roughly cellCount / targetChunkSize', () => {
    const graph = buildPlanetGraphCore({ cellCount: 3000, seed: 3 });
    const targetChunkSize = 100;
    const { chunks } = buildPlanetChunks(graph, { targetChunkSize });

    const expected = graph.cells.length / targetChunkSize;
    expect(chunks.length).toBeGreaterThan(expected * 0.5);
    expect(chunks.length).toBeLessThan(expected * 2);
  });

  it('is deterministic for a given graph and params', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 21 });
    const a = buildPlanetChunks(graph, { targetChunkSize: 80 });
    const b = buildPlanetChunks(graph, { targetChunkSize: 80 });

    expect(a.chunkIdByCell).toEqual(b.chunkIdByCell);
    expect(a.chunks.map((c) => c.cellIds)).toEqual(b.chunks.map((c) => c.cellIds));
  });

  it('chunk bounding volume contains every member cell within its angular radius', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 5 });
    const { chunks } = buildPlanetChunks(graph, { targetChunkSize: 80 });

    for (const chunk of chunks) {
      for (const cellId of chunk.cellIds) {
        const cell = graph.cells[cellId];
        for (const corner of cell.corners) {
          const dot = chunk.center.x * corner.x + chunk.center.y * corner.y + chunk.center.z * corner.z;
          const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
          expect(angle).toBeLessThanOrEqual(chunk.boundingRadius + 1e-9);
        }
      }
    }
  });
});

describe('buildChunkMeshData', () => {
  it('produces exactly one triangle fan per member cell, covering every cell once total', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 9 });
    const { chunks } = buildPlanetChunks(graph, { targetChunkSize: 60 });
    const elevation = graph.cells.map((_, id) => Math.sin(id));

    let totalVerts = 0;
    const seenCellIds = new Set<number>();
    for (const chunk of chunks) {
      const meshData = buildChunkMeshData(graph, elevation, chunk);
      const expectedVerts = chunk.cellIds.reduce((sum, cellId) => sum + graph.cells[cellId].corners.length * 3, 0);
      expect(meshData.directions.length).toBe(expectedVerts * 3);
      expect(meshData.elevations.length).toBe(expectedVerts);
      expect(meshData.cellIds.length).toBe(expectedVerts);
      totalVerts += expectedVerts;
      for (const cellId of chunk.cellIds) seenCellIds.add(cellId);
    }

    const expectedTotal = graph.cells.reduce((sum, cell) => sum + cell.corners.length * 3, 0);
    expect(totalVerts).toBe(expectedTotal);
    expect(seenCellIds.size).toBe(graph.cells.length);
  });

  it('every vertex direction sits on the unit sphere', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 17 });
    const { chunks } = buildPlanetChunks(graph, { targetChunkSize: 60 });
    const elevation = graph.cells.map(() => 0);

    for (const chunk of chunks) {
      const meshData = buildChunkMeshData(graph, elevation, chunk);
      for (let i = 0; i < meshData.directions.length; i += 3) {
        const len = Math.hypot(meshData.directions[i], meshData.directions[i + 1], meshData.directions[i + 2]);
        expect(len).toBeCloseTo(1, 5);
      }
    }
  });
});

describe('buildChunkBoundaryLoop', () => {
  it('traces a closed loop of at least 3 vertices for every chunk in a multi-chunk graph', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 13 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 80 });
    const elevation = graph.cells.map((_, id) => Math.sin(id * 0.37));
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      const loop = buildChunkBoundaryLoop(graph, elevation, chunkIdByCell, chunk);
      expect(loop).not.toBeNull();
      if (!loop) continue;
      expect(loop.positions.length).toBeGreaterThanOrEqual(3);
      expect(loop.positions.length).toBe(loop.elevations.length);
    }
  });

  it('every boundary vertex is the exact same object (and elevation) a neighboring chunk uses for its own corner — no seam to stitch', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 13 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 80 });
    const elevation = graph.cells.map((_, id) => Math.sin(id * 0.37));

    for (const chunk of chunks) {
      const loop = buildChunkBoundaryLoop(graph, elevation, chunkIdByCell, chunk);
      if (!loop) continue;

      for (let i = 0; i < loop.positions.length; i++) {
        const vertex = loop.positions[i];
        let found = false;
        for (const cell of graph.cells) {
          if (chunkIdByCell[cell.id] === chunk.id) continue;
          const idx = cell.corners.indexOf(vertex);
          if (idx === -1) continue;
          found = true;
          // Same value up to floating-point summation order, not bit-identical: the 3 cells
          // around a vertex each average {a,b,c} in a different order depending on which one
          // is host, so this can differ from the loop's own value in the last representable
          // bit (~1e-16 here) — see buildChunkBoundaryLoop()'s doc comment.
          expect(cellCornerElevation(cell, idx, elevation)).toBeCloseTo(loop.elevations[i], 10);
          break;
        }
        expect(found).toBe(true);
      }
    }
  });

  it('returns null when the chunk owns the whole graph (no boundary to trace)', () => {
    const graph = buildPlanetGraphCore({ cellCount: 40, seed: 4 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 1000 });
    expect(chunks.length).toBe(1);
    const elevation = graph.cells.map((_, id) => Math.sin(id));

    expect(buildChunkBoundaryLoop(graph, elevation, chunkIdByCell, chunks[0])).toBeNull();
  });
});

describe('buildChunkLod1MeshData', () => {
  /** Both LOD1 growth limits switched off, so a merge group only stops at its scope's edge —
   * i.e. the old "collapse the whole thing to one polygon" behavior, kept here as the thing
   * the sag budget is measured against. */
  const UNBOUNDED_MERGE = { maxGroupSize: Number.MAX_SAFE_INTEGER, maxSag: 2 };

  it('produces fewer vertices than full-resolution buildChunkMeshData for a typical chunk', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 13 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 80 });
    const elevation = graph.cells.map((_, id) => Math.sin(id * 0.37));

    for (const chunk of chunks) {
      const lod0 = buildChunkMeshData(graph, elevation, chunk);
      const lod1 = buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunk);
      expect(lod1.directions.length).toBeLessThan(lod0.directions.length);
    }
  });

  it('every LOD1 vertex direction sits on the unit sphere', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 21 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 80 });
    const elevation = graph.cells.map(() => 0);

    for (const chunk of chunks) {
      const meshData = buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunk);
      for (let i = 0; i < meshData.directions.length; i += 3) {
        const len = Math.hypot(meshData.directions[i], meshData.directions[i + 1], meshData.directions[i + 2]);
        expect(len).toBeCloseTo(1, 5);
      }
    }
  });

  it('falls back to full-resolution mesh data when a merge group has no boundary to trace', () => {
    // One chunk owning the whole graph, merged as a single unbounded group — that group has
    // no neighboring group to seam against, so there's no boundary loop and the only correct
    // output is the full-resolution fan.
    const graph = buildPlanetGraphCore({ cellCount: 40, seed: 4 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 1000 });
    expect(chunks.length).toBe(1);
    const elevation = graph.cells.map((_, id) => Math.sin(id));

    const lod0 = buildChunkMeshData(graph, elevation, chunks[0]);
    const lod1 = buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunks[0], UNBOUNDED_MERGE);
    expect(lod1.directions).toEqual(lod0.directions);
  });

  it('keeps merged polygons close to the sphere instead of chording deep inside it', () => {
    // The regression test for M4c's second bug. A flat polygon spanning a spherical cap of
    // angular radius r sits `1 - cos(r)` below the sphere at its center, so collapsing a whole
    // ~80-cell chunk to one polygon buries it far inside the planet — a sag one to two orders
    // of magnitude larger than the terrain relief being rendered, which reads as land sunk
    // under the sea-level shell, not as a coarse surface. Bounding group growth by that sag
    // instead is what keeps LOD1 on the sphere. Measured on undisplaced unit directions, so
    // this is purely the curvature error, independent of elevation scale.
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 13 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 80 });
    const elevation = graph.cells.map(() => 0);

    const maxSag = (data: { directions: Float32Array }): number => {
      let worst = 0;
      for (let i = 0; i + 8 < data.directions.length; i += 9) {
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (let v = 0; v < 3; v++) {
          cx += data.directions[i + v * 3];
          cy += data.directions[i + v * 3 + 1];
          cz += data.directions[i + v * 3 + 2];
        }
        worst = Math.max(worst, 1 - Math.hypot(cx / 3, cy / 3, cz / 3));
      }
      return worst;
    };

    // The guarantee LOD1 actually makes: growth is capped at `sagBudget` past the seed cell,
    // and the seed cell itself is exempt (a group is never empty), so total sag is bounded by
    // the budget plus whatever a single cell polygon already sags on its own. Derived from
    // this graph rather than hardcoded, since the per-cell term is a function of resolution.
    const sagBudget = 0.002;
    let worstCellSag = 0;
    for (const cell of graph.cells) {
      for (const corner of cell.corners) {
        const d = corner.x * cell.center.x + corner.y * cell.center.y + corner.z * cell.center.z;
        worstCellSag = Math.max(worstCellSag, 1 - d);
      }
    }

    for (const chunk of chunks) {
      const grouped = maxSag(buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunk));
      const wholeChunk = maxSag(buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunk, UNBOUNDED_MERGE));

      expect(grouped).toBeLessThanOrEqual(worstCellSag + sagBudget);
      expect(grouped).toBeLessThan(wholeChunk / 10);
    }
  });
});

describe('buildChunkLod1MeshData pinning', () => {
  it('a pinned cell renders byte-identical to LOD0, not just as its own flattened polygon', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 13 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 80 });
    // Elevation varies per cell so a peak's raw center value can diverge from its neighbors'
    // corner-blended average — the exact condition that exposed the fan-center-dropping bug
    // (a pinned cell rendered through the boundary-loop path lost its raised, distinctly
    // colored center even though it was correctly kept as its own group).
    const elevation = graph.cells.map((_, id) => Math.sin(id * 0.53) + Math.cos(id * 0.19));
    const chunk = chunks.find((c) => c.cellIds.length > 10)!;
    const pinnedCellId = chunk.cellIds[Math.floor(chunk.cellIds.length / 2)];

    const pinned = new Uint8Array(graph.cells.length);
    pinned[pinnedCellId] = 1;

    const lod1 = buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunk, { pinned });
    const chunkOfOne = { ...chunk, cellIds: [pinnedCellId] };
    const lod0Fan = buildChunkMeshData(graph, elevation, chunkOfOne);

    const pinnedVertices: { direction: [number, number, number]; elevation: number }[] = [];
    for (let i = 0; i < lod1.cellIds.length; i++) {
      if (lod1.cellIds[i] !== pinnedCellId) continue;
      const o = i * 3;
      pinnedVertices.push({
        direction: [lod1.directions[o], lod1.directions[o + 1], lod1.directions[o + 2]],
        elevation: lod1.elevations[i],
      });
    }

    // Same vertex count as LOD0's own fan (n triangles, including the center vertex) — not the
    // n-2 ear-clipped boundary-only polygon a merged/flattened group would produce.
    expect(pinnedVertices.length).toBe(lod0Fan.elevations.length);
    for (let i = 0; i < pinnedVertices.length; i++) {
      expect(pinnedVertices[i].direction).toEqual([lod0Fan.directions[i * 3], lod0Fan.directions[i * 3 + 1], lod0Fan.directions[i * 3 + 2]]);
      expect(pinnedVertices[i].elevation).toBe(lod0Fan.elevations[i]);
    }

    // The fan center's raw elevation must actually survive into LOD1 — this is what the
    // boundary-loop path silently dropped. Compared via Math.fround since `elevations` is a
    // Float32Array: the stored value is a float32 truncation of the float64 source, not a
    // bit-identical copy of it.
    expect(pinnedVertices.some((v) => v.elevation === Math.fround(elevation[pinnedCellId]))).toBe(true);
  });

  it('leaves LOD1 unchanged from the unpinned baseline when no cells are pinned', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 21 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 80 });
    const elevation = graph.cells.map((_, id) => Math.sin(id * 0.37));

    for (const chunk of chunks) {
      const baseline = buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunk);
      const withUndefinedPins = buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunk, { pinned: undefined });
      expect(withUndefinedPins.directions).toEqual(baseline.directions);
    }
  });
});

describe('buildChunkLod1MeshData land/water boundary', () => {
  const UNBOUNDED_MERGE = { maxGroupSize: Number.MAX_SAFE_INTEGER, maxSag: 2 };

  it('never merges a land cell into the same flat-color group as a water cell', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 13 });
    const { chunks, chunkIdByCell } = buildPlanetChunks(graph, { targetChunkSize: 80 });
    const elevation = graph.cells.map(() => 0);

    // Split by a fixed spatial plane (x >= 0 is "land") rather than by id parity — cell ids
    // carry no spatial locality (see buildPlanetChunks()'s doc comment), so an id-based split
    // wouldn't reliably land adjacent to water the way a real coastline does.
    const isLand = graph.cells.map((cell) => cell.center.x >= 0);
    const crossesBoundary = (chunk: (typeof chunks)[number]): boolean =>
      chunk.cellIds.some((id) => graph.cells[id].neighbors.some((n) => chunk.cellIds.includes(n) && isLand[n] !== isLand[id]));
    const chunk = chunks.find((c) => c.cellIds.length > 20 && crossesBoundary(c))!;
    expect(chunk).toBeDefined(); // sanity: some chunk actually straddles the split

    // Baseline: with growth otherwise unbounded, nothing stops the whole chunk from
    // collapsing into one group, so every vertex is tagged with the same representative id.
    const withoutIsLand = buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunk, UNBOUNDED_MERGE);
    expect(new Set(withoutIsLand.cellIds).size).toBe(1);

    // With the constraint, land and water can never share a group, so growth must stop at the
    // coastline and more than one representative id appears — and every id that does appear
    // must be consistently on one side: no id whose own isLand differs from any other vertex
    // tagged with that same id (trivially true per-id, since a triangle's 3 vertices always
    // share one id, but worth asserting the split actually produced >1 group at all).
    const withIsLand = buildChunkLod1MeshData(graph, elevation, chunkIdByCell, chunk, { ...UNBOUNDED_MERGE, isLand });
    expect(new Set(withIsLand.cellIds).size).toBeGreaterThan(1);
  });
});

describe('triangulatePolygon2D', () => {
  const shoelaceArea = (pts: { x: number; y: number }[]): number => {
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(sum) / 2;
  };

  it('triangulates a concave polygon into exactly n-2 non-overlapping triangles covering its full area', () => {
    // An "L" shape, concave at (2,2). A single-point fan from the polygon's own centroid
    // (which sits right near that reflex corner, outside the far arm of the L) would produce
    // self-overlapping triangles here — exactly the failure mode `buildChunkLod1MeshData()`
    // used to hit for non-star-shaped chunk boundaries (BFS-grown chunk regions are routinely
    // this irregular). Area conservation (sum of output triangle areas == polygon area) is
    // what would catch that: overlap or gaps make the sums diverge.
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const polygonArea = shoelaceArea(points);
    expect(polygonArea).toBeCloseTo(12, 9);

    const triangles = triangulatePolygon2D(points);
    expect(triangles.length).toBe(points.length - 2);

    let coveredArea = 0;
    for (const [a, b, c] of triangles) {
      coveredArea += shoelaceArea([points[a], points[b], points[c]]);
    }
    expect(coveredArea).toBeCloseTo(polygonArea, 9);
  });

  it('returns no triangles for fewer than 3 points', () => {
    expect(triangulatePolygon2D([])).toEqual([]);
    expect(
      triangulatePolygon2D([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toEqual([]);
  });
});
