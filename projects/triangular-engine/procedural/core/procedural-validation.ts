/** Reusable archetype-validation building blocks shared by every generator family. */

export function validateProceduralSchemaVersion(schemaVersion: unknown, label: string): void {
  if (!Number.isInteger(schemaVersion) || (schemaVersion as number) < 1) {
    throw new RangeError(`${label} schemaVersion must be a positive integer.`);
  }
}

export function validateProceduralId(id: unknown, label: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new RangeError(`${label} id must be a non-empty string.`);
  }
}

/** Validates a [min, max] range: both finite, min <= max. */
export function validateProceduralFiniteRange(
  range: unknown,
  label: string,
): asserts range is readonly [number, number] {
  if (!Array.isArray(range) || range.length !== 2) {
    throw new RangeError(`${label} must be a [min, max] tuple.`);
  }
  const [min, max] = range;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new RangeError(`${label} must contain finite min and max values.`);
  }
  if (min > max) {
    throw new RangeError(`${label} min (${min}) must not exceed max (${max}).`);
  }
}

/** Validates a plain 0..1 finite number, e.g. a probability or chance field. */
export function validateProcedural01(value: unknown, label: string): void {
  if (!Number.isFinite(value) || (value as number) < 0 || (value as number) > 1) {
    throw new RangeError(`${label} must be a finite number between 0 and 1.`);
  }
}

/** Ensures every id in a list is unique; throws with the first duplicate found. */
export function validateProceduralUniqueIds(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new RangeError(`${label} contains a duplicate id "${id}".`);
    }
    seen.add(id);
  }
}
