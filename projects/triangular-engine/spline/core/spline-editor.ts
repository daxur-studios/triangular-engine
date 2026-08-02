import type { SplineVector3 } from './spline-math';

/** Axes permitted when moving a control point. `free` preserves all three axes. */
export type SplineMoveConstraint = 'free' | 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz';

/** Applies an editor movement constraint without mutating the source vectors. */
export function constrainSplineDelta(
  delta: SplineVector3,
  constraint: SplineMoveConstraint,
): SplineVector3 {
  const [x, y, z] = delta;
  return [
    constraint === 'free' || constraint.includes('x') ? x : 0,
    constraint === 'free' || constraint.includes('y') ? y : 0,
    constraint === 'free' || constraint.includes('z') ? z : 0,
  ];
}

/** Returns a translated control-point position using the requested axes. */
export function moveSplinePoint(
  position: SplineVector3,
  delta: SplineVector3,
  constraint: SplineMoveConstraint = 'free',
): SplineVector3 {
  const [dx, dy, dz] = constrainSplineDelta(delta, constraint);
  return [position[0] + dx, position[1] + dy, position[2] + dz];
}

/**
 * Framework-free undo/redo history for spline editors and composite tools.
 * Call `push` with the state before a mutation, then use `undo`/`redo` with
 * the current state. Keyboard handling is deliberately included so hosts get
 * Ctrl/Cmd+Z and Ctrl/Cmd+Y consistently out of the box.
 */
export class SplineEditorHistory<T> {
  private readonly undoStack: T[] = [];
  private readonly redoStack: T[] = [];

  constructor(private readonly clone: (value: T) => T = (value) => value) {}

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  push(state: T): void {
    this.undoStack.push(this.clone(state));
    this.redoStack.length = 0;
  }

  undo(current: T): T | undefined {
    const previous = this.undoStack.pop();
    if (previous === undefined) return undefined;
    this.redoStack.push(this.clone(current));
    return this.clone(previous);
  }

  redo(current: T): T | undefined {
    const next = this.redoStack.pop();
    if (next === undefined) return undefined;
    this.undoStack.push(this.clone(current));
    return this.clone(next);
  }

  /** Returns the restored state when the event was handled. */
  handleKeyDown(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'preventDefault'>, current: T): T | undefined {
    if (!(event.ctrlKey || event.metaKey)) return undefined;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      const restored = this.undo(current);
      if (restored !== undefined) event.preventDefault();
      return restored;
    }
    if (key === 'y' || (key === 'z' && event.shiftKey)) {
      const restored = this.redo(current);
      if (restored !== undefined) event.preventDefault();
      return restored;
    }
    return undefined;
  }
}
