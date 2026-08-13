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
  const trunkTopM: readonly [number, number, number] = [0, trunkHeightM, 0];

  nodes.push({
    id: 0,
    parentId: -1,
    depth: 0,
    startM: [0, 0, 0],
    endM: trunkTopM,
    radiusStartM: trunkRadiusM,
    radiusEndM: trunkTipRadiusM,
  });

  growFloraBranch(
    nodes,
    archetype,
    random01,
    /* parentId */ 0,
    /* parentDepth */ 0,
    trunkTopM,
    UP,
    trunkTipRadiusM,
    trunkHeightM,
  );

  return nodes;
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

  for (let i = 0; i < childCount; i++) {
    const spreadRad = sampleProceduralRange(archetype.branching.spreadAngleRad, random01());
    const azimuthRad = random01() * Math.PI * 2;
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
