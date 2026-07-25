import {
  createScatterRemovalOverlay,
  filterRemovedScatterInstances,
  isScatterInstanceRemoved,
  serializeScatterRemovalOverlay,
  withScatterInstanceRemoved,
  withScatterInstanceRestored,
} from './scatter-removal-overlay';

describe('scatter removal overlay', () => {
  it('starts empty when created with no argument', () => {
    const overlay = createScatterRemovalOverlay();
    expect(overlay.removedIds.size).toBe(0);
  });

  it('seeds from an iterable of instance ids', () => {
    const overlay = createScatterRemovalOverlay(['a', 'b']);
    expect(isScatterInstanceRemoved(overlay, 'a')).toBe(true);
    expect(isScatterInstanceRemoved(overlay, 'c')).toBe(false);
  });

  it('withScatterInstanceRemoved returns a new overlay and leaves the original untouched', () => {
    const original = createScatterRemovalOverlay();
    const updated = withScatterInstanceRemoved(original, 'tree-1');
    expect(original.removedIds.size).toBe(0);
    expect(updated.removedIds.size).toBe(1);
    expect(isScatterInstanceRemoved(updated, 'tree-1')).toBe(true);
  });

  it('withScatterInstanceRemoved is idempotent (returns same reference if already removed)', () => {
    const overlay = createScatterRemovalOverlay(['tree-1']);
    const updated = withScatterInstanceRemoved(overlay, 'tree-1');
    expect(updated).toBe(overlay);
  });

  it('withScatterInstanceRestored removes an id and leaves the original untouched', () => {
    const original = createScatterRemovalOverlay(['tree-1', 'tree-2']);
    const updated = withScatterInstanceRestored(original, 'tree-1');
    expect(original.removedIds.has('tree-1')).toBe(true);
    expect(updated.removedIds.has('tree-1')).toBe(false);
    expect(updated.removedIds.has('tree-2')).toBe(true);
  });

  it('withScatterInstanceRestored is idempotent (returns same reference if not present)', () => {
    const overlay = createScatterRemovalOverlay();
    const updated = withScatterInstanceRestored(overlay, 'tree-1');
    expect(updated).toBe(overlay);
  });

  it('serializeScatterRemovalOverlay round-trips through createScatterRemovalOverlay', () => {
    const overlay = createScatterRemovalOverlay(['a', 'b', 'c']);
    const serialized = serializeScatterRemovalOverlay(overlay);
    const restored = createScatterRemovalOverlay(serialized);
    expect(restored.removedIds).toEqual(overlay.removedIds);
  });

  it('filterRemovedScatterInstances drops exactly the removed ids', () => {
    const overlay = createScatterRemovalOverlay(['b']);
    const instances = [{ instanceId: 'a' }, { instanceId: 'b' }, { instanceId: 'c' }];
    const filtered = filterRemovedScatterInstances(instances, overlay);
    expect(filtered.map((i) => i.instanceId)).toEqual(['a', 'c']);
  });

  it('filterRemovedScatterInstances returns the same array reference when overlay is empty', () => {
    const overlay = createScatterRemovalOverlay();
    const instances = [{ instanceId: 'a' }];
    expect(filterRemovedScatterInstances(instances, overlay)).toBe(instances);
  });
});
