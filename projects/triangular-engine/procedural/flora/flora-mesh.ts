import { BufferGeometry, Float32BufferAttribute, OctahedronGeometry, Vector3 } from 'three';

import type { IFloraArchetype } from './flora-archetype';
import type { IFloraSkeletonNode } from './flora-skeleton';

export interface IFloraMeshResult {
  readonly geometry: BufferGeometry;
  readonly triangleCount: number;
  readonly vertexCount: number;
}

/** Sides per tube ring — low-poly on purpose, see doc "Core principle". */
const TUBE_RADIAL_SEGMENTS = 6;
/**
 * Guards against a misconfigured archetype (e.g. maxDepth + childrenPerNode
 * combined explosively) silently producing an unrenderable mesh.
 */
const FLORA_MAX_TRIANGLES_PER_MESH = 20_000;

/**
 * Builds a low-poly trunk/branch tube + foliage-cluster mesh from a
 * skeleton, with a per-vertex `windWeight` attribute (0 at the root,
 * increasing with branch depth) for a wind-displacement shader to consume.
 */
export function buildFloraMesh(
  skeleton: readonly IFloraSkeletonNode[],
  archetype: IFloraArchetype,
): IFloraMeshResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const windWeights: number[] = [];
  const indices: number[] = [];

  const maxDepth = Math.max(1, archetype.branching.maxDepth);
  const depthById = new Map<number, number>();
  for (const node of skeleton) depthById.set(node.id, node.depth);

  const hasChildren = new Set<number>();
  for (const node of skeleton) {
    if (node.parentId !== -1) hasChildren.add(node.parentId);
  }

  const tipNodes: IFloraSkeletonNode[] = [];

  for (const node of skeleton) {
    const parentDepth = node.parentId === -1 ? -1 : (depthById.get(node.parentId) ?? -1);
    const startWeight = parentDepth === -1 ? 0 : parentDepth / maxDepth;
    const endWeight = node.depth / maxDepth;
    const isTip = !hasChildren.has(node.id);

    appendFloraTubeSegment(positions, normals, windWeights, indices, node, startWeight, endWeight, isTip);

    if (isTip) tipNodes.push(node);
  }

  if (archetype.foliage.style !== 'none') {
    const sizeM = (archetype.foliage.sizeM[0] + archetype.foliage.sizeM[1]) / 2;
    for (const node of tipNodes) {
      appendFloraFoliageCluster(positions, normals, windWeights, indices, node, archetype.foliage.style, sizeM);
    }
  }

  const triangleCount = indices.length / 3;
  if (triangleCount > FLORA_MAX_TRIANGLES_PER_MESH) {
    throw new RangeError(
      `Flora mesh exceeds triangle budget: ${triangleCount} > ${FLORA_MAX_TRIANGLES_PER_MESH}. ` +
        'Reduce branching.maxDepth or childrenPerNode.',
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('windWeight', new Float32BufferAttribute(windWeights, 1));
  geometry.setIndex(indices);

  return { geometry, triangleCount, vertexCount: positions.length / 3 };
}

const scratchStart = new Vector3();
const scratchEnd = new Vector3();
const scratchDir = new Vector3();
const scratchArbitrary = new Vector3();
const scratchRight = new Vector3();
const scratchForward = new Vector3();
const scratchNormal = new Vector3();
const scratchPoint = new Vector3();

function appendFloraTubeSegment(
  positions: number[],
  normals: number[],
  windWeights: number[],
  indices: number[],
  node: IFloraSkeletonNode,
  startWeight: number,
  endWeight: number,
  isTip: boolean,
): void {
  scratchStart.set(node.startM[0], node.startM[1], node.startM[2]);
  scratchEnd.set(node.endM[0], node.endM[1], node.endM[2]);
  scratchDir.subVectors(scratchEnd, scratchStart);
  if (scratchDir.lengthSq() === 0) return;
  scratchDir.normalize();

  scratchArbitrary.set(0, 1, 0);
  if (Math.abs(scratchDir.dot(scratchArbitrary)) > 0.99) scratchArbitrary.set(1, 0, 0);
  scratchRight.crossVectors(scratchArbitrary, scratchDir).normalize();
  scratchForward.crossVectors(scratchDir, scratchRight).normalize();

  const baseIndex = positions.length / 3;
  const rings: readonly [Vector3, number, number][] = [
    [scratchStart, node.radiusStartM, startWeight],
    [scratchEnd, node.radiusEndM, endWeight],
  ];

  for (const [center, radius, weight] of rings) {
    for (let i = 0; i < TUBE_RADIAL_SEGMENTS; i++) {
      const angle = (i / TUBE_RADIAL_SEGMENTS) * Math.PI * 2;
      scratchNormal
        .copy(scratchRight)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(scratchForward, Math.sin(angle));
      scratchPoint.copy(center).addScaledVector(scratchNormal, radius);
      positions.push(scratchPoint.x, scratchPoint.y, scratchPoint.z);
      normals.push(scratchNormal.x, scratchNormal.y, scratchNormal.z);
      windWeights.push(weight);
    }
  }

  for (let i = 0; i < TUBE_RADIAL_SEGMENTS; i++) {
    const next = (i + 1) % TUBE_RADIAL_SEGMENTS;
    const a = baseIndex + i;
    const b = baseIndex + next;
    const c = baseIndex + TUBE_RADIAL_SEGMENTS + i;
    const d = baseIndex + TUBE_RADIAL_SEGMENTS + next;
    indices.push(a, b, c, b, d, c);
  }

  if (isTip) {
    const tipCenterIndex = positions.length / 3;
    positions.push(scratchEnd.x, scratchEnd.y, scratchEnd.z);
    normals.push(scratchDir.x, scratchDir.y, scratchDir.z);
    windWeights.push(endWeight);
    for (let i = 0; i < TUBE_RADIAL_SEGMENTS; i++) {
      const next = (i + 1) % TUBE_RADIAL_SEGMENTS;
      indices.push(baseIndex + TUBE_RADIAL_SEGMENTS + i, baseIndex + TUBE_RADIAL_SEGMENTS + next, tipCenterIndex);
    }
  }
}

function appendFloraFoliageCluster(
  positions: number[],
  normals: number[],
  windWeights: number[],
  indices: number[],
  node: IFloraSkeletonNode,
  style: 'cluster-sphere' | 'cluster-cone',
  sizeM: number,
): void {
  const template = new OctahedronGeometry(sizeM, style === 'cluster-sphere' ? 1 : 0);
  const templatePositions = template.getAttribute('position');
  const templateNormals = template.getAttribute('normal');
  // PolyhedronGeometry (base of OctahedronGeometry) always builds non-indexed
  // geometry — getIndex() is null — so the vertex list itself is already
  // triangle-ordered in consecutive triples; indices must be synthesized
  // rather than copied from a (nonexistent) template index.

  const baseIndex = positions.length / 3;
  const [cx, cy, cz] = node.endM;
  for (let i = 0; i < templatePositions.count; i++) {
    positions.push(
      templatePositions.getX(i) + cx,
      templatePositions.getY(i) + cy + sizeM * 0.5,
      templatePositions.getZ(i) + cz,
    );
    normals.push(templateNormals.getX(i), templateNormals.getY(i), templateNormals.getZ(i));
    windWeights.push(1);
  }
  for (let i = 0; i < templatePositions.count; i++) {
    indices.push(baseIndex + i);
  }
  template.dispose();
}
