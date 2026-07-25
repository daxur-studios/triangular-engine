import {
  canReconcileMutableCompoundBody,
  findDuplicateCompoundShapeKey,
  ICompoundShapeEntry,
  planCompoundShapeReconciliation,
  shouldUseMutableCompoundShape,
} from './compound-shape-reconciliation';

type TestShape = { readonly name: string };

describe('compound shape reconciliation', () => {
  const shapeA: TestShape = { name: 'a' };
  const shapeB: TestShape = { name: 'b' };
  const shapeC: TestShape = { name: 'c' };

  function entry(
    key: string,
    shape: TestShape,
    position: readonly [number, number, number] = [0, 0, 0],
    rotation: readonly [number, number, number] = [0, 0, 0],
  ): ICompoundShapeEntry<TestShape> {
    return { key, shape, position, rotation };
  }

  it('does nothing when keyed shapes are unchanged', () => {
    const current = [entry('a', shapeA), entry('b', shapeB)];

    const plan = planCompoundShapeReconciliation(current, current);

    expect(plan.removedIndices).toEqual([]);
    expect([...plan.modifiedKeys]).toEqual([]);
    expect(plan.addedShapes).toEqual([]);
  });

  it('ignores presentation-only reordering', () => {
    const a = entry('a', shapeA);
    const b = entry('b', shapeB);

    const plan = planCompoundShapeReconciliation([a, b], [b, a]);

    expect(plan.removedIndices).toEqual([]);
    expect([...plan.modifiedKeys]).toEqual([]);
    expect(plan.addedShapes).toEqual([]);
  });

  it('adds a new keyed shape', () => {
    const a = entry('a', shapeA);
    const b = entry('b', shapeB);

    const plan = planCompoundShapeReconciliation([a], [a, b]);

    expect(plan.addedShapes).toEqual([b]);
  });

  it('removes missing shapes from highest index to lowest', () => {
    const a = entry('a', shapeA);
    const b = entry('b', shapeB);
    const c = entry('c', shapeC);

    const plan = planCompoundShapeReconciliation([a, b, c], [b]);

    expect(plan.removedIndices).toEqual([2, 0]);
  });

  it('modifies a shape when its object, position, or rotation changes', () => {
    const current = [
      entry('shape', shapeA),
      entry('position', shapeA),
      entry('rotation', shapeA),
    ];
    const next = [
      entry('shape', shapeB),
      entry('position', shapeA, [1, 0, 0]),
      entry('rotation', shapeA, [0, 1, 0]),
    ];

    const plan = planCompoundShapeReconciliation(current, next);

    expect([...plan.modifiedKeys]).toEqual(['shape', 'position', 'rotation']);
  });

  it('reports duplicate shape keys', () => {
    expect(
      findDuplicateCompoundShapeKey([
        entry('duplicate', shapeA),
        entry('duplicate', shapeB),
      ]),
    ).toBe('duplicate');
  });

  it('preserves the existing body only for a live compound with unchanged motion type', () => {
    const body = {};
    expect(canReconcileMutableCompoundBody(body, true, 2, 2)).toBeTrue();
    expect(canReconcileMutableCompoundBody(undefined, true, 2, 2)).toBeFalse();
    expect(canReconcileMutableCompoundBody(body, false, 2, 2)).toBeFalse();
    expect(canReconcileMutableCompoundBody(body, true, 2, 0)).toBeFalse();
  });

  it('uses a mutable compound for multiple shapes or one explicitly keyed shape', () => {
    expect(shouldUseMutableCompoundShape(2, false)).toBeTrue();
    expect(shouldUseMutableCompoundShape(1, true)).toBeTrue();
    expect(shouldUseMutableCompoundShape(1, false)).toBeFalse();
  });
});
