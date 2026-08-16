import { Vector3 } from 'three';

import { createProceduralRandom01, hashProceduralKey, sampleProceduralRange } from '../core/procedural-hash';
import type { IFloraArchetype } from './flora-archetype';

export interface IFloraSkeletonNode {
  readonly id: number;
  /** -1 for the root (trunk base) node. */
  readonly parentId: number;
  readonly depth: number;
  readonly startM: readonly [number, number, number];
  readonly endM: readonly [number, number, number];
  readonly radiusStartM: number;
  readonly radiusEndM: number;
}

const UP: readonly [number, number, number] = [0, 1, 0];

/**
 * Hard stop on node count, independent of the mesh triangle budget in
 * flora-mesh.ts — branching factor grows exponentially with maxDepth, so a
 * misconfigured archetype (e.g. maxDepth 8 with childrenPerNode [6, 8]) can
 * generate millions of nodes and hang before the mesh builder ever gets a
 * chance to reject it. Fail fast instead.
 */
const FLORA_MAX_SKELETON_NODES = 5_000;

const scratchDir = new Vector3();
const scratchArbitrary = new Vector3();
const scratchPerp = new Vector3();
const scratchTilted = new Vector3();

/**
 * Recursive branch-skeleton generation from archetype params + seed.
 * Deterministic: root, then children depth-first in a fixed order, drawing
 * from one seeded stream — identical inputs always produce an identical
 * node list in identical order.
 */
export function generateFloraSkeleton(
  archetype: IFloraArchetype,
  seed: number,
): IFloraSkeletonNode[] {
  const random01 = createProceduralRandom01(hashProceduralKey(`${archetype.id}|${seed}`));
  const nodes: IFloraSkeletonNode[] = [];

  const trunkHeightM = sampleProceduralRange(archetype.trunk.heightM, random01());
  const trunkRadiusM = sampleProceduralRange(archetype.trunk.radiusM, random01());
  const trunkTipRadiusM = trunkRadiusM * (1 - archetype.trunk.taper01);

  const curveRad = archetype.trunk.curveRad
    ? sampleProceduralRange(archetype.trunk.curveRad, random01())
    : 0;
  const curveAzimuth = random01() * Math.PI * 2;
  const curveSegments = Math.max(1, archetype.trunk.curveSegments ?? 1);
  const baseFlareMult = 1 + (archetype.trunk.baseFlare01 ?? 0);

  const getTrunkPoint = (s01: number): [number, number, number] => {
    if (s01 === 0) return [0, 0, 0];
    const y = s01 * trunkHeightM;
    const horizDist = Math.sin(curveRad) * trunkHeightM * Math.pow(s01, 1.35);
    const x = Math.cos(curveAzimuth) * horizDist || 0;
    const z = Math.sin(curveAzimuth) * horizDist || 0;
    return [x, y, z];
  };

  for (let i = 0; i < curveSegments; i++) {
    const s0 = i / curveSegments;
    const s1 = (i + 1) / curveSegments;
    const startM = getTrunkPoint(s0);
    const endM = getTrunkPoint(s1);
    const radiusStartM =
      trunkRadiusM * (1 - archetype.trunk.taper01 * s0) * (i === 0 ? baseFlareMult : 1);
    const radiusEndM = trunkRadiusM * (1 - archetype.trunk.taper01 * s1);

    nodes.push({
      id: i,
      parentId: i === 0 ? -1 : i - 1,
      depth: 0,
      startM,
      endM,
      radiusStartM,
      radiusEndM,
    });
  }

  const lastTrunkNode = nodes[curveSegments - 1];
  const trunkTopM = lastTrunkNode.endM;
  const tipDirUnit = scratchDir
    .set(
      lastTrunkNode.endM[0] - lastTrunkNode.startM[0],
      lastTrunkNode.endM[1] - lastTrunkNode.startM[1],
      lastTrunkNode.endM[2] - lastTrunkNode.startM[2],
    )
    .normalize();
  const trunkTipDir: readonly [number, number, number] = [tipDirUnit.x, tipDirUnit.y, tipDirUnit.z];

  if (archetype.branching.distribution === 'tiered-whorls') {
    growTieredWhorlsBranches(
      nodes,
      archetype,
      random01,
      trunkHeightM,
      trunkRadiusM,
    );
  } else if (archetype.branching.maxDepth > 0) {
    growFloraBranch(
      nodes,
      archetype,
      random01,
      /* parentId */ lastTrunkNode.id,
      /* parentDepth */ 0,
      trunkTopM,
      trunkTipDir,
      trunkTipRadiusM,
      trunkHeightM,
    );
  }

  return nodes;
}

function growTieredWhorlsBranches(
  nodes: IFloraSkeletonNode[],
  archetype: IFloraArchetype,
  random01: () => number,
  trunkHeightM: number,
  trunkRadiusM: number,
): void {
  const config = archetype.branching.tieredWhorls;
  if (!config || archetype.branching.maxDepth < 1) return;

  const rawTierCount = Math.round(sampleProceduralRange(config.tierCount, random01()));
  const tierCount = Math.max(1, rawTierCount);
  const startY = trunkHeightM * config.startHeightFraction01;
  const availableSpanY = Math.max(0.1, trunkHeightM * 0.94 - startY);
  const baseBranchLength = trunkHeightM * sampleProceduralRange(config.baseBranchLengthFraction, random01());

  for (let t = 0; t < tierCount; t++) {
    const tProg = tierCount === 1 ? 0.5 : t / (tierCount - 1);
    const tierY = startY + tProg * availableSpanY;
    const normH = Math.min(1, tierY / trunkHeightM);
    const tierTrunkRadius = trunkRadiusM * (1 - archetype.trunk.taper01 * normH);

    // Conical taper from bottom to top: lower tiers long, top tiers short
    const conicalScale = Math.pow(1 - tProg, 0.8) * 0.85 + 0.15;
    const tierBranchLength = baseBranchLength * conicalScale * (0.85 + random01() * 0.3);

    const branchCount = Math.round(sampleProceduralRange(config.branchesPerTier, random01()));
    const tierAzimuthBase = (t * 0.61803398875 * Math.PI * 2) + (random01() - 0.5) * 0.3;

    for (let b = 0; b < branchCount; b++) {
      const az = tierAzimuthBase + (b / branchCount) * Math.PI * 2 + (random01() - 0.5) * 0.15;
      const droop = sampleProceduralRange(config.droopRad, random01());

      const cosDroop = Math.cos(droop);
      const sinDroop = Math.sin(droop);
      const dirX = Math.cos(az) * cosDroop;
      const dirY = -sinDroop;
      const dirZ = Math.sin(az) * cosDroop;

      const originM: readonly [number, number, number] = [0, tierY, 0];
      const endM: readonly [number, number, number] = [
        dirX * tierBranchLength,
        tierY + dirY * tierBranchLength,
        dirZ * tierBranchLength,
      ];

      if (nodes.length >= FLORA_MAX_SKELETON_NODES) {
        throw new RangeError(
          `Flora skeleton exceeds ${FLORA_MAX_SKELETON_NODES} nodes. ` +
            'Reduce branching.maxDepth or childrenPerNode.',
        );
      }

      const branchRadiusStart = tierTrunkRadius * 0.48;
      const branchRadiusEnd = tierTrunkRadius * 0.2;
      const branchId = nodes.length;

      nodes.push({
        id: branchId,
        parentId: 0,
        depth: 1,
        startM: originM,
        endM,
        radiusStartM: branchRadiusStart,
        radiusEndM: branchRadiusEnd,
      });

      if (archetype.branching.maxDepth >= 2) {
        const subCount = Math.round(sampleProceduralRange(archetype.branching.childrenPerNode, random01()));
        const perpX = -Math.sin(az);
        const perpZ = Math.cos(az);

        for (let s = 0; s < subCount; s++) {
          if (nodes.length >= FLORA_MAX_SKELETON_NODES) {
            throw new RangeError(
              `Flora skeleton exceeds ${FLORA_MAX_SKELETON_NODES} nodes. ` +
                'Reduce branching.maxDepth or childrenPerNode.',
            );
          }

          const attachFrac = 0.35 + ((s + 0.5) / Math.max(1, subCount)) * 0.5;
          const subOriginM: readonly [number, number, number] = [
            originM[0] + (endM[0] - originM[0]) * attachFrac,
            originM[1] + (endM[1] - originM[1]) * attachFrac,
            originM[2] + (endM[2] - originM[2]) * attachFrac,
          ];

          const side = s % 2 === 0 ? 1 : -1;
          const fanAngleRad = sampleProceduralRange(archetype.branching.spreadAngleRad, random01());
          const subLen = tierBranchLength * archetype.branching.lengthFalloff01 * (0.6 + random01() * 0.4);

          const sDirX = dirX * Math.cos(fanAngleRad) + perpX * side * Math.sin(fanAngleRad);
          const sDirZ = dirZ * Math.cos(fanAngleRad) + perpZ * side * Math.sin(fanAngleRad);
          const sDirY = dirY * 0.5 + 0.05;
          const sDirLen = Math.hypot(sDirX, sDirY, sDirZ) || 1;

          const subEndM: readonly [number, number, number] = [
            subOriginM[0] + (sDirX / sDirLen) * subLen,
            subOriginM[1] + (sDirY / sDirLen) * subLen,
            subOriginM[2] + (sDirZ / sDirLen) * subLen,
          ];

          const subRadiusStart = branchRadiusEnd * 0.8;
          const subRadiusEnd = branchRadiusEnd * 0.4;
          const subId = nodes.length;

          nodes.push({
            id: subId,
            parentId: branchId,
            depth: 2,
            startM: subOriginM,
            endM: subEndM,
            radiusStartM: subRadiusStart,
            radiusEndM: subRadiusEnd,
          });
        }
      }
    }
  }
}

function growFloraBranch(
  nodes: IFloraSkeletonNode[],
  archetype: IFloraArchetype,
  random01: () => number,
  parentId: number,
  parentDepth: number,
  originM: readonly [number, number, number],
  directionUnit: readonly [number, number, number],
  radiusM: number,
  parentLengthM: number,
): void {
  const depth = parentDepth + 1;
  if (depth > archetype.branching.maxDepth) return;

  const childCount = Math.round(
    sampleProceduralRange(archetype.branching.childrenPerNode, random01()),
  );

  const baseAzimuth = random01() * Math.PI * 2;
  for (let i = 0; i < childCount; i++) {
    const spreadRad = sampleProceduralRange(archetype.branching.spreadAngleRad, random01());
    const azimuthRad =
      baseAzimuth +
      (i / Math.max(1, childCount)) * Math.PI * 2 +
      (random01() - 0.5) * 0.35;
    const childDirection = tiltFloraDirection(directionUnit, spreadRad, azimuthRad);

    const lengthM = parentLengthM * archetype.branching.lengthFalloff01 * (0.75 + random01() * 0.5);
    const childRadiusM = radiusM * archetype.branching.lengthFalloff01;

    const endM: [number, number, number] = [
      originM[0] + childDirection[0] * lengthM,
      originM[1] + childDirection[1] * lengthM,
      originM[2] + childDirection[2] * lengthM,
    ];

    if (nodes.length >= FLORA_MAX_SKELETON_NODES) {
      throw new RangeError(
        `Flora skeleton exceeds ${FLORA_MAX_SKELETON_NODES} nodes. ` +
          'Reduce branching.maxDepth or childrenPerNode.',
      );
    }

    const childId = nodes.length;
    nodes.push({
      id: childId,
      parentId,
      depth,
      startM: originM,
      endM,
      radiusStartM: radiusM,
      radiusEndM: childRadiusM,
    });

    growFloraBranch(
      nodes,
      archetype,
      random01,
      childId,
      depth,
      endM,
      childDirection,
      childRadiusM,
      lengthM,
    );
  }
}

/** Tilts a unit direction by `spreadRad` off-axis, then spins that tilt around the axis by `azimuthRad`. */
function tiltFloraDirection(
  directionUnit: readonly [number, number, number],
  spreadRad: number,
  azimuthRad: number,
): readonly [number, number, number] {
  scratchDir.set(directionUnit[0], directionUnit[1], directionUnit[2]);
  scratchArbitrary.set(0, 1, 0);
  if (Math.abs(scratchDir.dot(scratchArbitrary)) > 0.99) {
    scratchArbitrary.set(1, 0, 0);
  }
  scratchPerp.crossVectors(scratchDir, scratchArbitrary).normalize();
  scratchTilted.copy(scratchDir).applyAxisAngle(scratchPerp, spreadRad).applyAxisAngle(scratchDir, azimuthRad);
  return [scratchTilted.x, scratchTilted.y, scratchTilted.z];
}
