import { OrderedSlots } from './ordered-slots';

describe('OrderedSlots', () => {
  it('runs entries in ascending order and keeps insertion order for ties', () => {
    const slots = new OrderedSlots<string>();
    slots.add({ id: 'macro', order: 300, value: 'm' });
    slots.add({ id: 'base', order: 0, value: 'b' });
    slots.add({ id: 'roadsA', order: 1000, value: 'a' });
    slots.add({ id: 'roadsB', order: 1000, value: 'b2' });
    slots.add({ id: 'lookup', order: 200, value: 'l' });

    expect(slots.entries.map((entry) => entry.id)).toEqual([
      'base',
      'lookup',
      'macro',
      'roadsA',
      'roadsB',
    ]);
  });

  it('builds the cache key from ids in run order, ignoring values', () => {
    const a = new OrderedSlots<number>();
    a.add({ id: 'x', order: 2, value: 1 });
    a.add({ id: 'y', order: 1, value: 2 });

    const b = new OrderedSlots<number>();
    b.add({ id: 'y', order: 1, value: 999 });
    b.add({ id: 'x', order: 2, value: -5 });

    expect(a.key()).toBe('y|x');
    expect(b.key()).toBe(a.key());
  });

  it('changes the key when an entry is added, removed or reordered', () => {
    const slots = new OrderedSlots<number>();
    slots.add({ id: 'a', order: 1, value: 0 });
    const before = slots.key();

    slots.add({ id: 'b', order: 2, value: 0 });
    const added = slots.key();
    expect(added).not.toBe(before);

    expect(slots.remove('b')).toBeTrue();
    expect(slots.key()).toBe(before);
    expect(slots.remove('b')).toBeFalse();

    const reordered = new OrderedSlots<number>();
    reordered.add({ id: 'b', order: 1, value: 0 });
    reordered.add({ id: 'a', order: 2, value: 0 });
    expect(reordered.key()).not.toBe(added);
  });

  it('rejects a duplicate id', () => {
    const slots = new OrderedSlots<number>();
    slots.add({ id: 'a', order: 0, value: 0 });
    expect(() => slots.add({ id: 'a', order: 5, value: 1 })).toThrowError(/already exists/);
  });
});
