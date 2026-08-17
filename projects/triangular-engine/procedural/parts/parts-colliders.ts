import type { IPartArchetype } from './parts-archetype';
import type { IPartSolid } from './parts-solid';

export type PartColliderShape = 'box' | 'sphere' | 'cylinder' | 'capsule';

/**
 * Scatter- and Jolt-compatible primitive collider descriptor.
 */
export interface IPartColliderDescriptor {
  readonly solidId: string;
  readonly linkId: number;
  readonly shape: PartColliderShape;
  /**
   * Params matching ScatterJoltColliderAdapter order:
   * - box: [width, height, depth]
   * - sphere: [radius]
   * - cylinder: [halfHeight, radius]
   * - capsule: [halfHeight, radius]
   */
  readonly params: readonly number[];
  readonly anchorRelativePositionM: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
}

/**
 * Converts collidable solids in a skeleton into scatter/Jolt-compatible
 * primitive collider descriptors.
 */
export function derivePartColliders(
  skeleton: readonly IPartSolid[],
  _archetype?: IPartArchetype,
): readonly IPartColliderDescriptor[] {
  const colliders: IPartColliderDescriptor[] = [];

  for (const solid of skeleton) {
    if (solid.collidable === false) {
      continue;
    }

    const [d0, d1, d2] = solid.dimensionsM;
    let shape: PartColliderShape;
    let params: number[];

    switch (solid.shape) {
      case 'box':
        shape = 'box';
        params = [d0, d1, d2];
        break;
      case 'cylinder':
        // dimensionsM: [radius, height] -> cylinder collider: [halfHeight, radius]
        shape = 'cylinder';
        params = [d1 * 0.5, d0];
        break;
      case 'cone':
        // Jolt has no cone primitive; approximate as cylinder using max bottom radius
        // dimensionsM: [radiusBottom, radiusTop, height] -> cylinder collider: [halfHeight, radiusBottom]
        shape = 'cylinder';
        params = [d2 * 0.5, d0];
        break;
      case 'capsule':
        // dimensionsM: [radius, totalHeight]
        // capsule cylinder halfHeight = max(0, totalHeight - 2 * radius) * 0.5
        shape = 'capsule';
        params = [Math.max(0, d1 - 2 * d0) * 0.5, d0];
        break;
      case 'sphere':
        // dimensionsM: [radius]
        shape = 'sphere';
        params = [d0];
        break;
      default:
        shape = 'box';
        params = [0.1, 0.1, 0.1];
    }

    colliders.push({
      solidId: solid.id,
      linkId: solid.linkId,
      shape,
      params,
      anchorRelativePositionM: solid.positionM,
      rotation: solid.orientation,
    });
  }

  return colliders;
}
