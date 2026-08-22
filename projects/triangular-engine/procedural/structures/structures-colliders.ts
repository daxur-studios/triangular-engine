import type { IStructureArchetype } from './structures-archetype';
import type { IStructureSolid } from './structures-solid';

export type StructureColliderShape = 'box' | 'sphere' | 'cylinder' | 'capsule';

/**
 * Scatter- and Jolt-compatible primitive collider descriptor for structures.
 */
export interface IStructureColliderDescriptor {
  readonly solidId: string;
  readonly linkId: number;
  readonly shape: StructureColliderShape;
  /**
   * Params matching ScatterJoltColliderAdapter / Jolt order:
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
 * Converts collidable solids in a structural skeleton into scatter/Jolt-compatible
 * primitive compound collider descriptors.
 */
export function deriveStructureColliders(
  skeleton: readonly IStructureSolid[],
  _archetype?: IStructureArchetype,
): readonly IStructureColliderDescriptor[] {
  const colliders: IStructureColliderDescriptor[] = [];

  for (const solid of skeleton) {
    if (solid.collidable === false) {
      continue;
    }

    const [d0, d1, d2] = solid.dimensionsM;
    let shape: StructureColliderShape;
    let params: number[];

    switch (solid.shape) {
      case 'box':
        shape = 'box';
        params = [d0, d1, d2];
        break;
      case 'cylinder':
        shape = 'cylinder';
        params = [d1 * 0.5, d0];
        break;
      case 'cone':
        // Jolt has no cone primitive; approximate as cylinder using max bottom radius
        shape = 'cylinder';
        params = [d2 * 0.5, d0];
        break;
      case 'capsule':
        shape = 'capsule';
        params = [d1 * 0.5, d0];
        break;
      case 'sphere':
        shape = 'sphere';
        params = [d0];
        break;
    }

    colliders.push({
      solidId: solid.id,
      linkId: solid.linkId ?? 0,
      shape,
      params,
      anchorRelativePositionM: solid.positionM,
      rotation: solid.orientation,
    });
  }

  return colliders;
}
