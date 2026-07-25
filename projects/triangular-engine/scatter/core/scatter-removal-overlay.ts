import type { ScatterInstanceId } from './scatter-instance-id';

/**
 * The only persisted state scatter instances ever have: which deterministic
 * instance IDs are currently removed (cut, mined, destroyed). Everything
 * else about an instance is re-derived from its candidate data every time.
 * Games own storage; this is just the shape + pure update functions.
 *
 * The same overlay must be applied to both render-batch generation and
 * collider-cell generation — an instance that's visually gone but still
 * collidable is the canonical bug this type exists to prevent.
 */
export interface IScatterRemovalOverlay {
  readonly removedIds: ReadonlySet<ScatterInstanceId>;
}

export function createScatterRemovalOverlay(
  removedIds?: Iterable<ScatterInstanceId>,
): IScatterRemovalOverlay {
  return { removedIds: new Set(removedIds ?? []) };
}

export function withScatterInstanceRemoved(
  overlay: IScatterRemovalOverlay,
  instanceId: ScatterInstanceId,
): IScatterRemovalOverlay {
  if (overlay.removedIds.has(instanceId)) return overlay;
  const removedIds = new Set(overlay.removedIds);
  removedIds.add(instanceId);
  return { removedIds };
}

export function withScatterInstanceRestored(
  overlay: IScatterRemovalOverlay,
  instanceId: ScatterInstanceId,
): IScatterRemovalOverlay {
  if (!overlay.removedIds.has(instanceId)) return overlay;
  const removedIds = new Set(overlay.removedIds);
  removedIds.delete(instanceId);
  return { removedIds };
}

export function isScatterInstanceRemoved(
  overlay: IScatterRemovalOverlay,
  instanceId: ScatterInstanceId,
): boolean {
  return overlay.removedIds.has(instanceId);
}

/** Games persist this array; the library never touches storage itself. */
export function serializeScatterRemovalOverlay(
  overlay: IScatterRemovalOverlay,
): readonly ScatterInstanceId[] {
  return [...overlay.removedIds];
}

export function filterRemovedScatterInstances<
  T extends { readonly instanceId: ScatterInstanceId },
>(instances: readonly T[], overlay: IScatterRemovalOverlay): readonly T[] {
  if (overlay.removedIds.size === 0) return instances;
  return instances.filter((instance) => !overlay.removedIds.has(instance.instanceId));
}
