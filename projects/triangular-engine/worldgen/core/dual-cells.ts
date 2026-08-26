import { IHullFace } from './convex-hull3';
import { IVec3 } from './vec3';

export interface IDualCells {
  /** neighborsByVertex[i] — ids of the sites adjacent to site i, in cyclic (fan) order. */
  neighborsByVertex: number[][];
  /** cornersByVertex[i] — Voronoi cell polygon corners for site i, same order/cardinality as neighborsByVertex[i]. */
  cornersByVertex: IVec3[][];
}

/**
 * Dual of a convex-hull triangulation: each hull vertex (input site) becomes
 * a Voronoi cell whose polygon corners are the incident triangles' outward
 * face normals (== spherical circumcenters, see runbook 022) walked in fan
 * order around the site.
 */
export function buildDualCells(pointCount: number, faces: IHullFace[]): IDualCells {
  const nextByVertex: Map<number, number>[] = Array.from({ length: pointCount }, () => new Map());
  const normalByVertexAndNeighbor: Map<number, IVec3>[] = Array.from(
    { length: pointCount },
    () => new Map(),
  );

  for (const face of faces) {
    const rotations: [number, number, number][] = [
      [face.a, face.b, face.c],
      [face.b, face.c, face.a],
      [face.c, face.a, face.b],
    ];
    for (const [i, x, y] of rotations) {
      nextByVertex[i].set(x, y);
      normalByVertexAndNeighbor[i].set(x, face.normal);
    }
  }

  const neighborsByVertex: number[][] = [];
  const cornersByVertex: IVec3[][] = [];

  for (let i = 0; i < pointCount; i++) {
    const next = nextByVertex[i];
    if (next.size === 0) {
      neighborsByVertex.push([]);
      cornersByVertex.push([]);
      continue;
    }

    const start = next.keys().next().value as number;
    const neighbors: number[] = [start];
    let cur = start;
    for (let steps = 0; steps < next.size; steps++) {
      const nxt = next.get(cur);
      if (nxt === undefined || nxt === start) break;
      neighbors.push(nxt);
      cur = nxt;
    }

    const corners = neighbors.map(
      (neighborId) => normalByVertexAndNeighbor[i].get(neighborId) as IVec3,
    );
    neighborsByVertex.push(neighbors);
    cornersByVertex.push(corners);
  }

  return { neighborsByVertex, cornersByVertex };
}
