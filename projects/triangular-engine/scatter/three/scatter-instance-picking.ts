import { InstancedMesh, type Intersection, type Object3D } from 'three';

import type { ScatterInstanceId } from '../core/scatter-instance-id';

/**
 * `InstancedMesh` raycast intersections carry a numeric `instanceId` — the
 * index into that mesh's buffers as of its last build, not a stable
 * identity. Every scatter/three builder (`buildScatterInstancedMesh`,
 * `buildScatterBillboardInstancedMesh`) stashes the build-order
 * `ScatterInstanceId` array here so a pick can be resolved back to a
 * stable ID that survives the next rebuild reordering things.
 */
export const SCATTER_INSTANCE_IDS_USERDATA_KEY = 'scatterInstanceIds';

/** Looks up the stable ID a mesh's raw instance index was built from, or undefined if the mesh wasn't built by a scatter/three builder. */
export function getScatterInstanceIdAt(
  mesh: InstancedMesh,
  instanceIndex: number,
): ScatterInstanceId | undefined {
  const ids = mesh.userData[SCATTER_INSTANCE_IDS_USERDATA_KEY] as
    | readonly ScatterInstanceId[]
    | undefined;
  return ids?.[instanceIndex];
}

/**
 * Resolves a raycaster intersection into a stable `ScatterInstanceId`, or
 * undefined when the intersection isn't a scatter-built `InstancedMesh`
 * instance (e.g. it hit the terrain mesh, or `instanceId` is unset).
 */
export function pickScatterInstanceId(
  intersection: Intersection<Object3D>,
): ScatterInstanceId | undefined {
  if (!(intersection.object instanceof InstancedMesh)) return undefined;
  if (intersection.instanceId === undefined) return undefined;
  return getScatterInstanceIdAt(intersection.object, intersection.instanceId);
}
