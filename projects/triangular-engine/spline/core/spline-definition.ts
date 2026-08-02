import {
  distanceVec3,
  isFiniteVec3,
  SplineVector3,
} from './spline-math';
import {
  computeDefaultTolerances,
  DEFAULT_SPLINE_TOLERANCES,
  ISplineTolerances,
} from './spline-tolerances';

export type SplineInterpolation = 'linear' | 'catmullRom' | 'bezier';
export type SplineHandleMode = 'auto' | 'mirrored' | 'broken' | 'linear';
export type SplineChannelInterpolation = 'linear' | 'step' | 'angle';

/** Reserved channel names read by the built-in profiles. Use these, not string literals. */
export const SPLINE_CHANNELS = {
  widthM: 'widthM',
  falloffM: 'falloffM',
  elevationOffsetM: 'elevationOffsetM',
} as const;

export interface ISplineChannelDefinition {
  readonly defaultValue: number;
  readonly interpolation: SplineChannelInterpolation;
}

export interface ISplinePoint {
  /** Field space, f64. */
  readonly position: SplineVector3;
  /** Bezier handle, field space, relative to `position`. Ignored otherwise. */
  readonly handleIn?: SplineVector3;
  /** Bezier handle, field space, relative to `position`. Ignored otherwise. */
  readonly handleOut?: SplineVector3;
  readonly handleMode?: SplineHandleMode;
  /** Radians, added to the rotation-minimizing transported frame. */
  readonly roll?: number;
  readonly channels?: Readonly<Record<string, number>>;
}

export interface ISplineDefinition {
  /** Serialization format version. Never used for cache invalidation — see decision 7. */
  readonly schemaVersion: number;
  readonly id: string;
  readonly interpolation: SplineInterpolation;
  readonly closed: boolean;
  /** Catmull-Rom tension, per spline. Ignored otherwise. */
  readonly tension?: number;
  readonly points: readonly ISplinePoint[];
  readonly channelSchema?: Readonly<Record<string, ISplineChannelDefinition>>;
  /** Closed splines only. See decision 2 (smaller-region containment rule). */
  readonly invertInterior?: boolean;
}

const INTERPOLATIONS: readonly SplineInterpolation[] = [
  'linear',
  'catmullRom',
  'bezier',
];
const CHANNEL_INTERPOLATIONS: readonly SplineChannelInterpolation[] = [
  'linear',
  'step',
  'angle',
];

/** Bounding-box diagonal of the control points, used to scale default tolerances. */
export function computeSplineExtent(points: readonly ISplinePoint[]): number {
  if (points.length === 0) return 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    const [x, y, z] = point.position;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return distanceVec3([minX, minY, minZ], [maxX, maxY, maxZ]);
}

function resolveTolerances(
  points: readonly ISplinePoint[],
  tolerances?: ISplineTolerances,
): ISplineTolerances {
  if (tolerances) return tolerances;
  const extent = computeSplineExtent(points);
  return extent > 0 ? computeDefaultTolerances(extent) : DEFAULT_SPLINE_TOLERANCES;
}

/**
 * Throws a descriptive `RangeError` on the first violation found. Tolerances
 * default to ones derived from the definition's own bounding-box extent.
 */
export function validateSplineDefinition(
  definition: ISplineDefinition,
  tolerances?: ISplineTolerances,
): void {
  if (!Number.isInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
    throw new RangeError('Spline schemaVersion must be a positive integer.');
  }
  if (typeof definition.id !== 'string' || definition.id.trim().length === 0) {
    throw new RangeError('Spline id must be a non-empty string.');
  }
  if (!INTERPOLATIONS.includes(definition.interpolation)) {
    throw new RangeError(
      `Spline interpolation must be one of ${INTERPOLATIONS.join(', ')}.`,
    );
  }
  if (
    definition.tension !== undefined &&
    !Number.isFinite(definition.tension)
  ) {
    throw new RangeError('Spline tension must be finite when provided.');
  }

  const points = definition.points;
  if (!Array.isArray(points)) {
    throw new RangeError('Spline points must be an array.');
  }
  const minPoints = definition.closed ? 3 : 2;
  if (points.length < minPoints) {
    throw new RangeError(
      `A ${definition.closed ? 'closed' : 'open'} spline needs at least ${minPoints} points, got ${points.length}.`,
    );
  }

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!isFiniteVec3(point.position)) {
      throw new RangeError(`Spline point ${i} has a non-finite position.`);
    }
    if (point.handleIn !== undefined && !isFiniteVec3(point.handleIn)) {
      throw new RangeError(`Spline point ${i} has a non-finite handleIn.`);
    }
    if (point.handleOut !== undefined && !isFiniteVec3(point.handleOut)) {
      throw new RangeError(`Spline point ${i} has a non-finite handleOut.`);
    }
    if (point.roll !== undefined && !Number.isFinite(point.roll)) {
      throw new RangeError(`Spline point ${i} has a non-finite roll.`);
    }
    if (point.channels) {
      for (const [name, value] of Object.entries(point.channels)) {
        if (!Number.isFinite(value)) {
          throw new RangeError(
            `Spline point ${i} channel "${name}" has a non-finite value.`,
          );
        }
      }
    }
  }

  const resolvedTolerances = resolveTolerances(points, tolerances);
  for (let i = 0; i < points.length - 1; i++) {
    if (
      distanceVec3(points[i].position, points[i + 1].position) <=
      resolvedTolerances.duplicatePointTol
    ) {
      throw new RangeError(
        `Spline points ${i} and ${i + 1} are coincident (within duplicatePointTol).`,
      );
    }
  }
  if (definition.closed) {
    const last = points.length - 1;
    if (
      distanceVec3(points[last].position, points[0].position) <=
      resolvedTolerances.duplicatePointTol
    ) {
      throw new RangeError(
        `Spline points ${last} and 0 are coincident across the closing segment (within duplicatePointTol).`,
      );
    }
  }

  if (definition.channelSchema) {
    for (const [name, channel] of Object.entries(definition.channelSchema)) {
      if (!Number.isFinite(channel.defaultValue)) {
        throw new RangeError(
          `Channel schema "${name}" has a non-finite defaultValue.`,
        );
      }
      if (!CHANNEL_INTERPOLATIONS.includes(channel.interpolation)) {
        throw new RangeError(
          `Channel schema "${name}" interpolation must be one of ${CHANNEL_INTERPOLATIONS.join(', ')}.`,
        );
      }
    }
  }
}
