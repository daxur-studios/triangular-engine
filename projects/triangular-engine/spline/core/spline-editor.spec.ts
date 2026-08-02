import { constrainSplineDelta, moveSplinePoint, SplineEditorHistory } from './spline-editor';

describe('spline editor helpers', () => {
  it('constrains movement to the requested axes', () => {
    expect(constrainSplineDelta([1, 2, 3], 'xz')).toEqual([1, 0, 3]);
    expect(moveSplinePoint([10, 20, 30], [1, 2, 3], 'y')).toEqual([10, 22, 30]);
  });

  it('handles undo, redo, and keyboard shortcuts', () => {
    const history = new SplineEditorHistory<number>();
    history.push(1);
    expect(history.handleKeyDown({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, preventDefault() {} }, 2)).toBe(1);
    expect(history.handleKeyDown({ key: 'y', ctrlKey: true, metaKey: false, shiftKey: false, preventDefault() {} }, 1)).toBe(2);
  });
});
