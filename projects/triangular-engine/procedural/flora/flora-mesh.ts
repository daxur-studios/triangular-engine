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
/** Where a frond blade is at its widest, as a fraction of its full length from the base. */
const FROND_WIDTH_MIDPOINT_FRACTION = 0.4;
/** Blade half-width at its widest point, as a fraction of the frond's full length. */
const FROND_HALF_WIDTH_FRACTION = 0.12;
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

  if (archetype.foliage.style === 'radial-fronds') {
    const hubSizeM = (archetype.foliage.sizeM[0] + archetype.foliage.sizeM[1]) / 2;
    const radialFronds = archetype.foliage.radialFronds;
    if (radialFronds) {
      const frondLengthM = (radialFronds.frondLengthM[0] + radialFronds.frondLengthM[1]) / 2;
      for (const node of tipNodes) {
        appendFloraFoliageCluster(positions, normals, windWeights, indices, node, 'cluster-sphere', hubSizeM);
        appendFloraFrondFan(
          positions,
          normals,
          windWeights,
          indices,
          node,
          radialFronds.frondCount,
          frondLengthM,
          radialFronds.frondDroopRad,
        );
      }
    }
  } else if (archetype.foliage.style === 'conifer-tiered') {
    const rootNode = skeleton[0];
    const coniferConfig = archetype.foliage.coniferTiered;
    const spireHeightM = coniferConfig
      ? (coniferConfig.spireHeightM[0] + coniferConfig.spireHeightM[1]) / 2
      : 1.4;
    const spireRadiusM = coniferConfig
      ? (coniferConfig.spireRadiusM[0] + coniferConfig.spireRadiusM[1]) / 2
      : 0.45;
    const boughWidthScale = coniferConfig?.boughWidthM
      ? (coniferConfig.boughWidthM[0] + coniferConfig.boughWidthM[1]) / 2
      : (archetype.foliage.sizeM[0] + archetype.foliage.sizeM[1]) / 2;

    appendFloraConiferApex(positions, normals, windWeights, indices, rootNode.endM, spireRadiusM, spireHeightM);

    for (const node of skeleton) {
      if (node.depth >= 1) {
        appendFloraConiferBough(positions, normals, windWeights, indices, node, boughWidthScale);
      }
    }
  } else if (archetype.foliage.style !== 'none') {
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

const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_DOWN = new Vector3(0, -1, 0);
const scratchFrondBase = new Vector3();
const scratchFrondOutward = new Vector3();
const scratchFrondTipDir = new Vector3();
const scratchFrondPerp = new Vector3();
const scratchFrondMid = new Vector3();
const scratchFrondTip = new Vector3();
const scratchFrondLeft = new Vector3();
const scratchFrondRight = new Vector3();
const scratchFrondEdgeA = new Vector3();
const scratchFrondEdgeB = new Vector3();
const scratchFrondNormal = new Vector3();

/**
 * Builds a fan of flat, drooping blades radiating from a tip node — the
 * 'radial-fronds' foliage style (palms), distinct from the round
 * cluster-sphere/cluster-cone blobs. Fronds are spaced evenly by azimuth
 * around world +Y with no jitter, so the fan stays deterministic from the
 * skeleton alone (mirrors appendFloraFoliageCluster having no extra
 * randomness of its own). Droop is measured against world down rather than
 * the node's own direction — archetypes using this style have zero/near-zero
 * branching, so the tip is always ~vertical and this stays simple.
 *
 * Each blade is a flat diamond (base → widest point → tip) pushed twice —
 * once with its natural normal, once mirrored with an inverted normal and
 * reversed winding — because the demo materials render with the default
 * FrontSide, and a single-sided blade would vanish from the back.
 */
function appendFloraFrondFan(
  positions: number[],
  normals: number[],
  windWeights: number[],
  indices: number[],
  node: IFloraSkeletonNode,
  frondCount: number,
  frondLengthM: number,
  frondDroopRad: number,
): void {
  scratchFrondBase.set(node.endM[0], node.endM[1], node.endM[2]);

  for (let i = 0; i < frondCount; i++) {
    const azimuthRad = (i / frondCount) * Math.PI * 2;
    scratchFrondOutward.set(Math.cos(azimuthRad), 0, Math.sin(azimuthRad));

    scratchFrondTipDir
      .copy(scratchFrondOutward)
      .multiplyScalar(Math.cos(frondDroopRad))
      .addScaledVector(WORLD_DOWN, Math.sin(frondDroopRad))
      .normalize();

    scratchFrondPerp.crossVectors(scratchFrondTipDir, WORLD_UP);
    if (scratchFrondPerp.lengthSq() === 0) continue;
    scratchFrondPerp.normalize();

    const halfWidthM = frondLengthM * FROND_HALF_WIDTH_FRACTION;
    scratchFrondMid
      .copy(scratchFrondBase)
      .addScaledVector(scratchFrondTipDir, frondLengthM * FROND_WIDTH_MIDPOINT_FRACTION);
    scratchFrondTip.copy(scratchFrondBase).addScaledVector(scratchFrondTipDir, frondLengthM);
    scratchFrondLeft.copy(scratchFrondMid).addScaledVector(scratchFrondPerp, halfWidthM);
    scratchFrondRight.copy(scratchFrondMid).addScaledVector(scratchFrondPerp, -halfWidthM);

    scratchFrondEdgeA.subVectors(scratchFrondLeft, scratchFrondBase);
    scratchFrondEdgeB.subVectors(scratchFrondTip, scratchFrondBase);
    scratchFrondNormal.crossVectors(scratchFrondEdgeA, scratchFrondEdgeB);
    if (scratchFrondNormal.lengthSq() === 0) continue;
    scratchFrondNormal.normalize();

    const blade = [scratchFrondBase, scratchFrondLeft, scratchFrondTip, scratchFrondRight] as const;

    const frontBase = positions.length / 3;
    for (const point of blade) {
      positions.push(point.x, point.y, point.z);
      normals.push(scratchFrondNormal.x, scratchFrondNormal.y, scratchFrondNormal.z);
      windWeights.push(1);
    }
    indices.push(frontBase, frontBase + 1, frontBase + 2, frontBase, frontBase + 2, frontBase + 3);

    const backBase = positions.length / 3;
    for (const point of blade) {
      positions.push(point.x, point.y, point.z);
      normals.push(-scratchFrondNormal.x, -scratchFrondNormal.y, -scratchFrondNormal.z);
      windWeights.push(1);
    }
    indices.push(backBase, backBase + 2, backBase + 1, backBase, backBase + 3, backBase + 2);
  }
}

const scratchEdgeA = new Vector3();
const scratchEdgeB = new Vector3();
const scratchBoughDir = new Vector3();
const scratchBoughPerp = new Vector3();
const scratchBoughUp = new Vector3();
const scratchStationCenter = new Vector3();

function pushFloraTriangle(
  positions: number[],
  normals: number[],
  windWeights: number[],
  indices: number[],
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  w1: number,
  w2: number,
  w3: number,
): void {
  scratchEdgeA.subVectors(p2, p1);
  scratchEdgeB.subVectors(p3, p1);
  scratchNormal.crossVectors(scratchEdgeA, scratchEdgeB);
  if (scratchNormal.lengthSq() > 0) scratchNormal.normalize();
  else scratchNormal.set(0, 1, 0);

  const base = positions.length / 3;
  positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
  normals.push(
    scratchNormal.x,
    scratchNormal.y,
    scratchNormal.z,
    scratchNormal.x,
    scratchNormal.y,
    scratchNormal.z,
    scratchNormal.x,
    scratchNormal.y,
    scratchNormal.z,
  );
  windWeights.push(w1, w2, w3);
  indices.push(base, base + 1, base + 2);
}

/** Builds the pointed conical apex / spire at the pinnacle of the conifer trunk. */
function appendFloraConiferApex(
  positions: number[],
  normals: number[],
  windWeights: number[],
  indices: number[],
  trunkTopM: readonly [number, number, number],
  radiusM: number,
  heightM: number,
): void {
  const [cx, cy, cz] = trunkTopM;
  const segments = 6;

  // Tier 1: Main top spire
  const spireTip = new Vector3(cx, cy + heightM, cz);
  const spireBaseY = cy - heightM * 0.15;
  const spireBasePts: Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    spireBasePts.push(new Vector3(cx + Math.cos(angle) * radiusM, spireBaseY, cz + Math.sin(angle) * radiusM));
  }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    pushFloraTriangle(
      positions,
      normals,
      windWeights,
      indices,
      spireBasePts[i],
      spireTip,
      spireBasePts[next],
      0.85,
      0.95,
      0.85,
    );
  }

  // Tier 2: Lower crown cone skirt
  const skirtTip = new Vector3(cx, cy + heightM * 0.2, cz);
  const skirtBaseY = cy - heightM * 0.65;
  const skirtRadius = radiusM * 1.5;
  const skirtBasePts: Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2 + Math.PI / segments;
    skirtBasePts.push(new Vector3(cx + Math.cos(angle) * skirtRadius, skirtBaseY, cz + Math.sin(angle) * skirtRadius));
  }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    pushFloraTriangle(
      positions,
      normals,
      windWeights,
      indices,
      skirtBasePts[i],
      skirtTip,
      skirtBasePts[next],
      0.75,
      0.85,
      0.75,
    );
  }
}

/** Builds a 3D faceted conifer bough mantle along a skeleton branch. */
function appendFloraConiferBough(
  positions: number[],
  normals: number[],
  windWeights: number[],
  indices: number[],
  node: IFloraSkeletonNode,
  boughWidthScale: number,
): void {
  const start = new Vector3(node.startM[0], node.startM[1], node.startM[2]);
  const end = new Vector3(node.endM[0], node.endM[1], node.endM[2]);
  scratchBoughDir.subVectors(end, start);
  const length = scratchBoughDir.length();
  if (length < 0.001) return;
  scratchBoughDir.normalize();

  scratchArbitrary.set(0, 1, 0);
  if (Math.abs(scratchBoughDir.dot(scratchArbitrary)) > 0.92) {
    scratchArbitrary.set(1, 0, 0);
  }
  scratchBoughPerp.crossVectors(scratchBoughDir, scratchArbitrary).normalize();
  scratchBoughUp.crossVectors(scratchBoughPerp, scratchBoughDir).normalize();

  const wM = boughWidthScale * Math.min(1.3, Math.max(0.45, length * 0.55));
  const hM = wM * 0.28;

  const stationFracs = [0.15, 0.48, 0.82, 1.05] as const;
  const widthFactors = [0.35, 1.0, 0.78, 0.08] as const;
  const heightFactors = [0.4, 1.0, 0.85, 0.12] as const;
  const droopFactors = [0.2, 0.65, 0.9, 1.0] as const;

  const rings: [Vector3, Vector3, Vector3, Vector3][] = [];
  const weights: number[] = [];

  for (let k = 0; k < 4; k++) {
    const frac = stationFracs[k];
    scratchStationCenter.copy(start).addScaledVector(scratchBoughDir, length * frac);

    const w = wM * widthFactors[k];
    const rh = hM * heightFactors[k];
    const droop = -wM * 0.35 * droopFactors[k];

    const ridge = new Vector3().copy(scratchStationCenter).addScaledVector(scratchBoughUp, rh);
    const right = new Vector3()
      .copy(scratchStationCenter)
      .addScaledVector(scratchBoughPerp, w)
      .add(new Vector3(0, droop, 0));
    const keel = new Vector3().copy(scratchStationCenter).addScaledVector(scratchBoughUp, -rh * 0.4);
    const left = new Vector3()
      .copy(scratchStationCenter)
      .addScaledVector(scratchBoughPerp, -w)
      .add(new Vector3(0, droop, 0));

    rings.push([ridge, right, keel, left]);
    weights.push(Math.min(1, 0.4 + frac * 0.6));
  }

  for (let k = 0; k < 3; k++) {
    const [A0, A1, A2, A3] = rings[k];
    const [B0, B1, B2, B3] = rings[k + 1];
    const wA = weights[k];
    const wB = weights[k + 1];

    // Top-Right facet
    pushFloraTriangle(positions, normals, windWeights, indices, A0, B0, B1, wA, wB, wB);
    pushFloraTriangle(positions, normals, windWeights, indices, A0, B1, A1, wA, wB, wA);

    // Bottom-Right facet
    pushFloraTriangle(positions, normals, windWeights, indices, A1, B1, B2, wA, wB, wB);
    pushFloraTriangle(positions, normals, windWeights, indices, A1, B2, A2, wA, wB, wA);

    // Bottom-Left facet
    pushFloraTriangle(positions, normals, windWeights, indices, A2, B2, B3, wA, wB, wB);
    pushFloraTriangle(positions, normals, windWeights, indices, A2, B3, A3, wA, wB, wA);

    // Top-Left facet
    pushFloraTriangle(positions, normals, windWeights, indices, A3, B3, B0, wA, wB, wB);
    pushFloraTriangle(positions, normals, windWeights, indices, A3, B0, A0, wA, wB, wA);
  }
}
