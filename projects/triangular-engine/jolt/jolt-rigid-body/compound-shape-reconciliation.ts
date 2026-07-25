export interface ICompoundShapeEntry<TShape> {
  readonly key: string;
  readonly shape: TShape;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
}

export interface ICompoundShapeReconciliation<
  TEntry extends ICompoundShapeEntry<unknown>,
> {
  /** Indices in descending order so callers can safely remove them in place. */
  readonly removedIndices: readonly number[];
  readonly modifiedKeys: ReadonlySet<string>;
  readonly addedShapes: readonly TEntry[];
}

/**
 * Whether an existing body can be updated without changing its Jolt body ID.
 */
export function canReconcileMutableCompoundBody<TBody, TMotionType>(
  existingBody: TBody | undefined,
  hasLiveCompoundShapes: boolean,
  liveMotionType: TMotionType | undefined,
  nextMotionType: TMotionType,
): existingBody is TBody {
  return (
    existingBody !== undefined &&
    hasLiveCompoundShapes &&
    liveMotionType === nextMotionType
  );
}

/**
 * Explicit identity opts a single child into the mutable-compound path so it
 * can gain more children later without replacing the body.
 */
export function shouldUseMutableCompoundShape(
  shapeCount: number,
  hasExplicitShapeId: boolean,
): boolean {
  return shapeCount > 1 || hasExplicitShapeId;
}

/**
 * Returns the first duplicate key, or `undefined` when every child is unique.
 */
export function findDuplicateCompoundShapeKey<TShape>(
  shapes: readonly ICompoundShapeEntry<TShape>[],
): string | undefined {
  const keys = new Set<string>();
  for (const { key } of shapes) {
    if (keys.has(key)) return key;
    keys.add(key);
  }
  return undefined;
}

/**
 * Plans the minimal keyed update for a mutable compound shape.
 *
 * Reordering existing children is intentionally ignored: keys represent
 * identity, while Jolt's internal sub-shape order is an implementation detail.
 */
export function planCompoundShapeReconciliation<
  TEntry extends ICompoundShapeEntry<unknown>,
>(
  currentShapes: readonly TEntry[],
  nextShapes: readonly TEntry[],
): ICompoundShapeReconciliation<TEntry> {
  const nextByKey = new Map(nextShapes.map((entry) => [entry.key, entry]));
  const removedIndices: number[] = [];
  for (let index = 0; index < currentShapes.length; index++) {
    if (!nextByKey.has(currentShapes[index].key)) {
      removedIndices.push(index);
    }
  }

  const modifiedKeys = new Set<string>();
  for (const current of currentShapes) {
    const next = nextByKey.get(current.key);
    if (next && !sameCompoundShape(current, next)) {
      modifiedKeys.add(current.key);
    }
  }

  const currentKeys = new Set(currentShapes.map(({ key }) => key));
  const addedShapes = nextShapes.filter(({ key }) => !currentKeys.has(key));

  return {
    removedIndices: removedIndices.sort((a, b) => b - a),
    modifiedKeys,
    addedShapes,
  };
}

function sameCompoundShape<TEntry extends ICompoundShapeEntry<unknown>>(
  current: TEntry,
  next: TEntry,
): boolean {
  return (
    current.shape === next.shape &&
    current.position.every((value, index) => value === next.position[index]) &&
    current.rotation.every((value, index) => value === next.rotation[index])
  );
}
