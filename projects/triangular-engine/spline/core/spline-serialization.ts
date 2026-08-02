import { ISplineDefinition, validateSplineDefinition } from './spline-definition';
import { ISplineTolerances } from './spline-tolerances';

/**
 * `ISplineDefinition` is already JSON-safe data, so serialization is a plain
 * round trip plus validation on the way back in. `schemaVersion` is part of
 * the payload (it is the format version); the runtime `revision` used for
 * cache invalidation (decision 7) is never part of this payload.
 */
export function serializeSplineDefinition(definition: ISplineDefinition): string {
  validateSplineDefinition(definition);
  return JSON.stringify(definition);
}

export function deserializeSplineDefinition(
  json: string,
  tolerances?: ISplineTolerances,
): ISplineDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new RangeError(
      `Spline JSON could not be parsed: ${(error as Error).message}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new RangeError('Spline JSON must decode to an object.');
  }
  const definition = parsed as ISplineDefinition;
  validateSplineDefinition(definition, tolerances);
  return definition;
}
