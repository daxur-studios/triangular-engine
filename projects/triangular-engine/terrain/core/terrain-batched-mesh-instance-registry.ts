/**
 * User-data key used to expose the live instance IDs owned by TerrainSurface.
 *
 * Three.js keeps BatchedMesh instance IDs stable after deletion, while its
 * instanceCount reports only the number of live instances. Consumers must
 * therefore enumerate this registry instead of assuming IDs are contiguous.
 */
export const TERRAIN_BATCH_ACTIVE_INSTANCE_IDS =
  '__triangularTerrainActiveInstanceIds';

export interface TerrainBatchedMeshUserData {
  readonly userData: Record<string, unknown>;
  readonly instanceCount: number;
}

export function registerTerrainBatchInstance(
  mesh: TerrainBatchedMeshUserData,
  instanceId: number,
): void {
  const existing = mesh.userData[TERRAIN_BATCH_ACTIVE_INSTANCE_IDS];
  const activeIds = existing instanceof Set ? existing : new Set<number>();
  if (!(existing instanceof Set))
    mesh.userData[TERRAIN_BATCH_ACTIVE_INSTANCE_IDS] = activeIds;
  activeIds.add(instanceId);
}

export function unregisterTerrainBatchInstance(
  mesh: TerrainBatchedMeshUserData,
  instanceId: number,
): void {
  const activeIds = mesh.userData[TERRAIN_BATCH_ACTIVE_INSTANCE_IDS];
  if (activeIds instanceof Set) activeIds.delete(instanceId);
}

/** Returns live IDs for TerrainSurface batches, with a legacy contiguous fallback. */
export function getTerrainBatchInstanceIds(
  mesh: TerrainBatchedMeshUserData,
): Iterable<number> {
  const activeIds = mesh.userData[TERRAIN_BATCH_ACTIVE_INSTANCE_IDS];
  if (activeIds instanceof Set) return activeIds;

  return Array.from({ length: mesh.instanceCount }, (_, instanceId) => instanceId);
}
