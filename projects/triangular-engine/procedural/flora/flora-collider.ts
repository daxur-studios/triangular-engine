import type { IFloraArchetype } from './flora-archetype';
import type { IFloraSkeletonNode } from './flora-skeleton';

/**
 * Shape-compatible with scatter's `ScatterColliderDefinition`
 * (`triangular-engine/scatter`) — kept as a local structural type rather
 * than importing scatter's type directly, so procedural doesn't take a
 * hard dependency on a sibling library. Field names/shapes are identical on
 * purpose so M4 scatter integration is a straight assignment. `params` is
 * `[halfHeightM, radiusM]`, matching the jolt scatter collider adapter's
 * capsule/cylinder param order.
 */
export interface IFloraColliderDescriptor {
  readonly shape: 'capsule' | 'cylinder';
  readonly params: readonly [halfHeightM: number, radiusM: number];
}

/**
 * Derives the trunk-only primitive collider for a variant (decision 4 —
 * branches and canopy get no colliders in v1). Returns undefined when the
 * archetype opts out (`collider.trunk === 'none'`), meaning zero collider
 * descriptors for this variant.
 */
export function deriveFloraTrunkCollider(
  skeleton: readonly IFloraSkeletonNode[],
  archetype: IFloraArchetype,
): IFloraColliderDescriptor | undefined {
  if (archetype.collider.trunk === 'none' || skeleton.length === 0) return undefined;

  const root: IFloraSkeletonNode = skeleton[0];
  const depth0Nodes = skeleton.filter((n) => n.depth === 0);
  const lastTrunkNode = depth0Nodes[depth0Nodes.length - 1] ?? root;
  const heightM = lastTrunkNode.endM[1] - root.startM[1];
  return {
    shape: archetype.collider.trunk,
    params: [heightM / 2, root.radiusStartM],
  };
}
