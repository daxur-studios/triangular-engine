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
    const radialFronds = archetype.foliage.radialFronds;
    if (radialFronds) {
      const frondLengthM = (radialFronds.frondLengthM[0] + radialFronds.frondLengthM[1]) / 2;
      for (const node of tipNodes) {
        appendFloraFrondFan(
          positions,
          normals,
          windWeights,
          indices,
          node,
          radialFronds.frondCount,
          frondLengthM,
          radialFronds.frondDroopRad,
          radialFronds.tierCount ?? (radialFronds.frondCount >= 10 ? 3 : 1),
          radialFronds.archRad ?? 0.45,
          radialFronds.frondWidthFraction ?? 0.14,
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
    const baseSizeM = (archetype.foliage.sizeM[0] + archetype.foliage.sizeM[1]) / 2;
    if (archetype.foliage.style === 'cluster-sphere') {
      // Broadleaf leafy sprays fanning along branches and terminal bouquets at branch tips
      for (const node of skeleton) {
        if (node.depth >= 1) {
          appendFloraBroadleafBough(positions, normals, windWeights, indices, node, baseSizeM);
        }
      }
      for (const node of tipNodes) {
        appendFloraBroadleafTip(positions, normals, windWeights, indices, node, baseSizeM);
      }
    } else {
      for (const node of tipNodes) {
        appendFloraFoliageCluster(positions, normals, windWeights, indices, node, archetype.foliage.style, baseSizeM);
      }
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
 * Builds a multi-tiered fan of curving, arching fronds radiating from a crown node —
 * the 'radial-fronds' foliage style (palms). Fronds form a wide, majestic tropical fountain:
 * - Upper tier: fronds rise up and arch outward into the sky
 * - Middle tier: mature fronds spread wide horizontally and arch gracefully
 * - Lower tier: older fronds flare outward and droop into a skirt
 */
function appendFloraFrondFan(
  positions: number[],
  normals: number[],
  windWeights: number[],
  indices: number[],
  node: IFloraSkeletonNode,
  frondCount: number,
  frondLengthM: number,
  _baseDroopRad: number,
  tierCount: number = 3,
  _archRad: number = 0.45,
  widthFraction: number = 0.14,
): void {
  scratchFrondBase.set(node.endM[0], node.endM[1], node.endM[2]);

  const numTiers = Math.max(1, tierCount);
  const widthFactors = [0.06, 0.82, 1.0, 0.05] as const;

  for (let i = 0; i < frondCount; i++) {
    const tier = numTiers > 1 ? i % numTiers : 0;
    const tierIndex = Math.floor(i / numTiers);
    const frondsInTier = Math.ceil(frondCount / numTiers);

    const azimuthRad =
      (tierIndex / frondsInTier) * Math.PI * 2 +
      (tier * (Math.PI / Math.max(1, frondsInTier) + 0.35));
    scratchFrondOutward.set(Math.cos(azimuthRad), 0, Math.sin(azimuthRad));

    const u = numTiers > 1 ? tier / (numTiers - 1) : 0.5;
    const L = frondLengthM;
    const maxHalfWidth = L * widthFraction;

    scratchFrondPerp.crossVectors(scratchFrondOutward, WORLD_UP);
    if (scratchFrondPerp.lengthSq() === 0) {
      scratchFrondPerp.set(1, 0, 0);
    } else {
      scratchFrondPerp.normalize();
    }

    const rStations = [
      0,
      (0.28 + 0.10 * u) * L,
      (0.64 + 0.16 * u - 0.08 * u * u) * L,
      (0.92 + 0.12 * u - 0.20 * u * u) * L,
    ];
    const yStations = [
      -0.08 * u * L,
      (0.26 - 0.28 * u) * L,
      (0.44 - 0.70 * u) * L,
      (0.36 - 1.02 * u) * L,
    ];

    const spinePts: Vector3[] = [];
    const leftPts: Vector3[] = [];
    const rightPts: Vector3[] = [];

    for (let k = 0; k < 4; k++) {
      const r = rStations[k];
      const y = yStations[k];

      const center = new Vector3()
        .copy(scratchFrondBase)
        .addScaledVector(scratchFrondOutward, r)
        .add(new Vector3(0, y, 0));

      const w = maxHalfWidth * widthFactors[k];
      const ridgeH = maxHalfWidth * 0.22 * (1 - (k / 3) * 0.5);
      const droopY = -maxHalfWidth * 0.20;

      const spine = new Vector3().copy(center).add(new Vector3(0, ridgeH, 0));
      const left = new Vector3()
        .copy(center)
        .addScaledVector(scratchFrondPerp, w)
        .add(new Vector3(0, droopY, 0));
      const right = new Vector3()
        .copy(center)
        .addScaledVector(scratchFrondPerp, -w)
        .add(new Vector3(0, droopY, 0));

      spinePts.push(spine);
      leftPts.push(left);
      rightPts.push(right);
    }

    for (let k = 0; k < 3; k++) {
      const sA = k / 3;
      const sB = (k + 1) / 3;
      const wA = Math.min(1, 0.35 + sA * 0.65);
      const wB = Math.min(1, 0.35 + sB * 0.65);

      const L0 = leftPts[k];
      const L1 = leftPts[k + 1];
      const S0 = spinePts[k];
      const S1 = spinePts[k + 1];
      const R0 = rightPts[k];
      const R1 = rightPts[k + 1];

      // Left wing (Top & Bottom for double-sided visibility)
      pushFloraTriangle(positions, normals, windWeights, indices, L0, S0, S1, wA, wA, wB);
      pushFloraTriangle(positions, normals, windWeights, indices, L0, S1, L1, wA, wB, wB);
      pushFloraTriangle(positions, normals, windWeights, indices, S1, S0, L0, wB, wA, wA);
      pushFloraTriangle(positions, normals, windWeights, indices, L1, S1, L0, wB, wB, wA);

      // Right wing (Top & Bottom for double-sided visibility)
      pushFloraTriangle(positions, normals, windWeights, indices, S0, R0, R1, wA, wA, wB);
      pushFloraTriangle(positions, normals, windWeights, indices, S0, R1, S1, wA, wB, wB);
      pushFloraTriangle(positions, normals, windWeights, indices, R1, R0, S0, wB, wA, wA);
      pushFloraTriangle(positions, normals, windWeights, indices, S1, R1, S0, wB, wB, wA);
    }
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

/** Builds double-sided faceted broadleaf leaf clusters fanning along a skeleton branch. */
function appendFloraBroadleafBough(
  positions: number[],
  normals: number[],
  windWeights: number[],
  indices: number[],
  node: IFloraSkeletonNode,
  foliageSizeM: number,
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

  const stations = [0.45, 0.85] as const;

  for (let sIdx = 0; sIdx < stations.length; sIdx++) {
    const t = stations[sIdx];
    const stationCenter = new Vector3().copy(start).addScaledVector(scratchBoughDir, length * t);
    const cardSize = foliageSizeM * (0.7 + t * 0.35);
    const halfWidth = cardSize * 0.48;
    const cardLen = cardSize * 0.88;

    const cardDirs = [
      new Vector3().copy(scratchBoughDir).multiplyScalar(0.6).addScaledVector(scratchBoughUp, 0.7).normalize(),
      new Vector3()
        .copy(scratchBoughDir)
        .multiplyScalar(0.4)
        .addScaledVector(scratchBoughPerp, 0.75)
        .addScaledVector(scratchBoughUp, 0.35)
        .normalize(),
      new Vector3()
        .copy(scratchBoughDir)
        .multiplyScalar(0.4)
        .addScaledVector(scratchBoughPerp, -0.75)
        .addScaledVector(scratchBoughUp, 0.35)
        .normalize(),
    ];

    const cardPerps = [
      new Vector3().copy(scratchBoughPerp),
      new Vector3().crossVectors(cardDirs[1], scratchBoughUp).normalize(),
      new Vector3().crossVectors(cardDirs[2], scratchBoughUp).normalize(),
    ];

    const wWeight = Math.min(1, 0.5 + t * 0.5);

    for (let cIdx = 0; cIdx < 3; cIdx++) {
      const cDir = cardDirs[cIdx];
      const cPerp = cardPerps[cIdx];

      const cBase = new Vector3().copy(stationCenter);
      const cMid = new Vector3().copy(cBase).addScaledVector(cDir, cardLen * 0.5);
      const cTip = new Vector3().copy(cBase).addScaledVector(cDir, cardLen);
      const cLeft = new Vector3().copy(cMid).addScaledVector(cPerp, halfWidth);
      const cRight = new Vector3().copy(cMid).addScaledVector(cPerp, -halfWidth);

      // Front:
      pushFloraTriangle(positions, normals, windWeights, indices, cBase, cLeft, cTip, wWeight, wWeight, wWeight);
      pushFloraTriangle(positions, normals, windWeights, indices, cBase, cTip, cRight, wWeight, wWeight, wWeight);
      // Back (inverted winding for double-sided):
      pushFloraTriangle(positions, normals, windWeights, indices, cBase, cTip, cLeft, wWeight, wWeight, wWeight);
      pushFloraTriangle(positions, normals, windWeights, indices, cBase, cRight, cTip, wWeight, wWeight, wWeight);
    }
  }
}

/** Builds double-sided terminal crown leaf sprays at the tip of branches. */
function appendFloraBroadleafTip(
  positions: number[],
  normals: number[],
  windWeights: number[],
  indices: number[],
  tipNode: IFloraSkeletonNode,
  foliageSizeM: number,
): void {
  const [cx, cy, cz] = tipNode.endM;
  const tipBase = new Vector3(cx, cy, cz);
  const cardCount = 4;
  const cardLen = foliageSizeM * 1.15;
  const halfWidth = foliageSizeM * 0.55;

  for (let i = 0; i < cardCount; i++) {
    const angle = (i / cardCount) * Math.PI * 2;
    const outward = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const cardDir = new Vector3().copy(outward).multiplyScalar(0.7).addScaledVector(WORLD_UP, 0.7).normalize();
    const cardPerp = new Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();

    const cBase = new Vector3().copy(tipBase);
    const cMid = new Vector3().copy(cBase).addScaledVector(cardDir, cardLen * 0.55);
    const cTip = new Vector3().copy(cBase).addScaledVector(cardDir, cardLen);
    const cLeft = new Vector3().copy(cMid).addScaledVector(cardPerp, halfWidth);
    const cRight = new Vector3().copy(cMid).addScaledVector(cardPerp, -halfWidth);

    // Front:
    pushFloraTriangle(positions, normals, windWeights, indices, cBase, cLeft, cTip, 0.85, 0.95, 1.0);
    pushFloraTriangle(positions, normals, windWeights, indices, cBase, cTip, cRight, 0.85, 1.0, 0.95);
    // Back (inverted winding):
    pushFloraTriangle(positions, normals, windWeights, indices, cBase, cTip, cLeft, 0.85, 1.0, 0.95);
    pushFloraTriangle(positions, normals, windWeights, indices, cBase, cRight, cTip, 0.85, 0.95, 1.0);
  }
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
