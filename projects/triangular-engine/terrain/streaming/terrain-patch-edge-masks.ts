import type { ITerrainSurfaceDomain } from '../domains/terrain-surface-domain';
import type {
  ITerrainPatchEdgeSegment,
  TerrainPatchEdgeSegments,
} from '../core/terrain-patch';

/** Bit flags describing an edge that needs the finer neighbour's sample spacing. */
export const TERRAIN_PATCH_EDGE_NORTH = 1;
export const TERRAIN_PATCH_EDGE_EAST = 2;
export const TERRAIN_PATCH_EDGE_SOUTH = 4;
export const TERRAIN_PATCH_EDGE_WEST = 8;

const EDGE_TOLERANCE = 1e-7;

export interface ITerrainPatchEdgeRefinement {
  readonly mask: number;
  /** Greatest selected-neighbour level difference across any marked edge. */
  readonly levelDelta: number;
  /** Per-edge level deltas in north, east, south, west order. */
  readonly edgeLevelDeltas: readonly [number, number, number, number];
  /** Normalized edge sections bordering finer selected patches. */
  readonly edgeSegments: TerrainPatchEdgeSegments;
}

/**
 * Finds coarse patches whose selected neighbours are one or more quadtree
 * levels finer. A coarse patch needs the finer spacing on that shared edge so
 * Meshoptimizer can preserve one matching vertex for every fine edge sample.
 *
 * The calculation is domain-independent for rectangular patch bounds. Sphere
 * domains with cross-face seams can provide an equivalent seam-aware pass when
 * they are introduced.
 */
export function calculateTerrainPatchEdgeRefinementMasks<TAddress>(
  domain: ITerrainSurfaceDomain<TAddress>,
  addresses: readonly TAddress[],
  getLevel: (address: TAddress) => number,
): readonly ITerrainPatchEdgeRefinement[] {
  const refinements = addresses.map(() => ({
    mask: 0,
    levelDelta: 0,
    edgeLevelDeltas: [0, 0, 0, 0] as [number, number, number, number],
    edgeSegments: [[], [], [], []] as [
      ITerrainPatchEdgeSegment[],
      ITerrainPatchEdgeSegment[],
      ITerrainPatchEdgeSegment[],
      ITerrainPatchEdgeSegment[],
    ],
  }));
  const bounds = addresses.map((address) => domain.getPatchBounds(address));

  for (let left = 0; left < addresses.length; left += 1) {
    for (let right = left + 1; right < addresses.length; right += 1) {
      const a = bounds[left];
      const b = bounds[right];
      const aWidth = a.maxU - a.minU;
      const aHeight = a.maxV - a.minV;
      const bWidth = b.maxU - b.minU;
      const bHeight = b.maxV - b.minV;
      const aLevel = getLevel(addresses[left]);
      const bLevel = getLevel(addresses[right]);

      if (same(a.maxU, b.minU) && overlaps(a.minV, a.maxV, b.minV, b.maxV)) {
        markCoarseEdge(
          refinements,
          left,
          right,
          TERRAIN_PATCH_EDGE_EAST,
          TERRAIN_PATCH_EDGE_WEST,
          aLevel,
          bLevel,
          bWidth < aWidth - tolerance(aWidth, bWidth),
          normalizedOverlap(a.minV, a.maxV, b.minV, b.maxV),
          normalizedOverlap(b.minV, b.maxV, a.minV, a.maxV),
        );
      } else if (
        same(a.minU, b.maxU) &&
        overlaps(a.minV, a.maxV, b.minV, b.maxV)
      ) {
        markCoarseEdge(
          refinements,
          left,
          right,
          TERRAIN_PATCH_EDGE_WEST,
          TERRAIN_PATCH_EDGE_EAST,
          aLevel,
          bLevel,
          bWidth < aWidth - tolerance(aWidth, bWidth),
          normalizedOverlap(a.minV, a.maxV, b.minV, b.maxV),
          normalizedOverlap(b.minV, b.maxV, a.minV, a.maxV),
        );
      } else if (
        same(a.maxV, b.minV) &&
        overlaps(a.minU, a.maxU, b.minU, b.maxU)
      ) {
        markCoarseEdge(
          refinements,
          left,
          right,
          TERRAIN_PATCH_EDGE_SOUTH,
          TERRAIN_PATCH_EDGE_NORTH,
          aLevel,
          bLevel,
          bHeight < aHeight - tolerance(aHeight, bHeight),
          normalizedOverlap(a.minU, a.maxU, b.minU, b.maxU),
          normalizedOverlap(b.minU, b.maxU, a.minU, a.maxU),
        );
      } else if (
        same(a.minV, b.maxV) &&
        overlaps(a.minU, a.maxU, b.minU, b.maxU)
      ) {
        markCoarseEdge(
          refinements,
          left,
          right,
          TERRAIN_PATCH_EDGE_NORTH,
          TERRAIN_PATCH_EDGE_SOUTH,
          aLevel,
          bLevel,
          bHeight < aHeight - tolerance(aHeight, bHeight),
          normalizedOverlap(a.minU, a.maxU, b.minU, b.maxU),
          normalizedOverlap(b.minU, b.maxU, a.minU, a.maxU),
        );
      }
    }
  }

  return refinements;
}

function markCoarseEdge(
  refinements: {
    mask: number;
    levelDelta: number;
    edgeLevelDeltas: [number, number, number, number];
    edgeSegments: [
      ITerrainPatchEdgeSegment[],
      ITerrainPatchEdgeSegment[],
      ITerrainPatchEdgeSegment[],
      ITerrainPatchEdgeSegment[],
    ];
  }[],
  left: number,
  right: number,
  leftEdge: number,
  rightEdge: number,
  leftLevel: number,
  rightLevel: number,
  rightIsPhysicallySmaller: boolean,
  leftSpan: readonly [number, number],
  rightSpan: readonly [number, number],
): void {
  if (rightLevel > leftLevel || rightIsPhysicallySmaller) {
    const delta = Math.max(1, rightLevel - leftLevel);
    refinements[left].mask |= leftEdge;
    refinements[left].levelDelta = Math.max(
      refinements[left].levelDelta,
      delta,
    );
    setEdgeDelta(refinements[left].edgeLevelDeltas, leftEdge, delta);
    addEdgeSegment(refinements[left].edgeSegments, leftEdge, leftSpan, delta);
  } else if (leftLevel > rightLevel) {
    const delta = Math.max(1, leftLevel - rightLevel);
    refinements[right].mask |= rightEdge;
    refinements[right].levelDelta = Math.max(
      refinements[right].levelDelta,
      delta,
    );
    setEdgeDelta(refinements[right].edgeLevelDeltas, rightEdge, delta);
    addEdgeSegment(refinements[right].edgeSegments, rightEdge, rightSpan, delta);
  }
}

function addEdgeSegment(
  segments: [
    ITerrainPatchEdgeSegment[],
    ITerrainPatchEdgeSegment[],
    ITerrainPatchEdgeSegment[],
    ITerrainPatchEdgeSegment[],
  ],
  edge: number,
  span: readonly [number, number],
  levelDelta: number,
): void {
  const index = Math.log2(edge);
  if (!Number.isInteger(index) || index < 0 || index >= segments.length) return;
  segments[index].push({ start: span[0], end: span[1], levelDelta });
}

function normalizedOverlap(
  ownerMin: number,
  ownerMax: number,
  neighbourMin: number,
  neighbourMax: number,
): readonly [number, number] {
  const size = ownerMax - ownerMin;
  return [
    Math.max(0, (Math.max(ownerMin, neighbourMin) - ownerMin) / size),
    Math.min(1, (Math.min(ownerMax, neighbourMax) - ownerMin) / size),
  ];
}

function setEdgeDelta(
  deltas: [number, number, number, number],
  edge: number,
  delta: number,
): void {
  const index = Math.log2(edge);
  if (!Number.isInteger(index) || index < 0 || index >= deltas.length) return;
  deltas[index] = Math.max(deltas[index], delta);
}

function tolerance(a: number, b: number): number {
  return EDGE_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= tolerance(a, b);
}

function overlaps(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): boolean {
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  return overlap > tolerance(aMax - aMin, bMax - bMin);
}
