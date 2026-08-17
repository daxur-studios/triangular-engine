import {
  validateProceduralFiniteRange,
  validateProceduralId,
  validateProceduralSchemaVersion,
  validateProceduralUniqueIds,
} from '../core/procedural-validation';
import type { IPartEndpoints, PartSolidShape } from './parts-solid';

export type PartSocketKind = 'attach' | 'thrust' | 'foot' | 'pivot' | 'lift';

export type PartSocketRole = 'stack-top' | 'stack-bottom' | 'radial' | 'custom';

export interface IPartSocketConfig {
  readonly kind: PartSocketKind;
  readonly role?: PartSocketRole;
  readonly size?: number;
  /** Optional solid id to which this socket attaches or derives from. */
  readonly solidId?: string;
  /** Offset relative to the solid or part origin (meters). */
  readonly offsetM?: readonly [number, number, number];
  /** Primary functional direction in part frame (e.g. [0,0,1] or outward normal). */
  readonly primaryDirection?: readonly [number, number, number];
}

export interface IPartSolidConfig {
  readonly id: string;
  readonly shape: PartSolidShape;
  /** Fixed position or [min, max] ranges for [x, y, z] in meters. */
  readonly positionM?:
    | readonly [number, number, number]
    | readonly [
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
      ];
  /** Orientation quaternion [x, y, z, w]. Defaults to identity [0,0,0,1]. */
  readonly orientation?: readonly [number, number, number, number];
  /**
   * Per shape dimension numbers or [min, max] ranges:
   * - box: [width, height, depth]
   * - cylinder: [radius, height]
   * - cone: [radiusBottom, radiusTop, height]
   * - capsule: [radius, totalHeight]
   * - sphere: [radius]
   */
  readonly dimensionsM: readonly (number | readonly [number, number])[];
  /** Optional endpoint definition for linear struts. */
  readonly endpoints?: IPartEndpoints;
  /** Embed depth in meters into host/parent. */
  readonly embedDepthM?: number;
  /** 0 = base (default), 1 = child of joint. */
  readonly linkId?: number;
  /** Visual color hint (hex string). */
  readonly materialHex?: string;
  /** Whether to contribute a Jolt collider (default: true). */
  readonly collidable?: boolean;
  /** Optional count for repeating this element (e.g. 3 nozzle clusters or multi-segment wings). */
  readonly repeatCount?: number | readonly [number, number];
  /** Offset step per repetition. */
  readonly repeatOffsetM?: readonly [number, number, number];
  /** Scale factor per repetition (e.g. 0.8 for tapering wing segments). */
  readonly repeatScale01?: number | readonly [number, number];
}

export interface IPartJointConfig {
  /** Hinge anchor point in part frame (meters). */
  readonly anchorM: readonly [number, number, number];
  /** Hinge unit axis in part frame. */
  readonly axis: readonly [number, number, number];
  /** Allowed travel range in radians [min, max]. */
  readonly rangeRad: readonly [number, number];
  /** Rest / stowed angle in radians. */
  readonly restRad: number;
  /** Optional telescoping extension stroke in meters for linkId: 2 elements. */
  readonly extensionM?: number | readonly [number, number];
  /** Optional unit axis for telescoping translation. */
  readonly extensionAxis?: readonly [number, number, number];
}

export interface IPartColliderConfig {
  readonly hull: false;
  readonly coneApproximation: 'cylinder';
}

export interface IPartArchetype {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name?: string;
  readonly solids: readonly IPartSolidConfig[];
  readonly sockets: readonly IPartSocketConfig[];
  readonly collider?: IPartColliderConfig;
  readonly joint?: IPartJointConfig;
}

const VALID_SHAPES: ReadonlySet<string> = new Set<PartSolidShape>([
  'box',
  'cylinder',
  'cone',
  'capsule',
  'sphere',
]);

const VALID_SOCKET_KINDS: ReadonlySet<string> = new Set<PartSocketKind>([
  'attach',
  'thrust',
  'foot',
  'pivot',
  'lift',
]);

const EXPECTED_DIMENSION_COUNTS: Record<PartSolidShape, number> = {
  box: 3,
  cylinder: 2,
  cone: 3,
  capsule: 2,
  sphere: 1,
};

export function validatePartArchetype(archetype: IPartArchetype): void {
  validateProceduralSchemaVersion(archetype.schemaVersion, 'Part archetype');
  validateProceduralId(archetype.id, 'Part archetype');

  if (!Array.isArray(archetype.solids) || archetype.solids.length === 0) {
    throw new RangeError('Part archetype must declare at least one solid.');
  }

  const solidIds = archetype.solids.map((s) => s.id);
  validateProceduralUniqueIds(solidIds, 'Part archetype solids');

  let hasJointSolids = false;

  for (const solid of archetype.solids) {
    if (typeof solid.id !== 'string' || solid.id.length === 0) {
      throw new RangeError('Part archetype solid id must be a non-empty string.');
    }
    if (!VALID_SHAPES.has(solid.shape)) {
      throw new RangeError(`Part archetype solid "${solid.id}" has unknown shape "${solid.shape}".`);
    }

    const expectedCount = EXPECTED_DIMENSION_COUNTS[solid.shape as PartSolidShape];
    if (!Array.isArray(solid.dimensionsM) || solid.dimensionsM.length !== expectedCount) {
      throw new RangeError(
        `Part archetype solid "${solid.id}" shape "${solid.shape}" expects ${expectedCount} dimensions, got ${solid.dimensionsM?.length}.`,
      );
    }

    for (let i = 0; i < solid.dimensionsM.length; i++) {
      const dim = solid.dimensionsM[i];
      if (Array.isArray(dim)) {
        validateProceduralFiniteRange(
          dim,
          `Part archetype solid "${solid.id}" dimension index ${i}`,
        );
        if (dim[0] <= 0) {
          throw new RangeError(
            `Part archetype solid "${solid.id}" dimension index ${i} min value must be positive.`,
          );
        }
      } else if (typeof dim === 'number') {
        if (!Number.isFinite(dim) || dim <= 0) {
          throw new RangeError(
            `Part archetype solid "${solid.id}" dimension index ${i} must be a positive finite number.`,
          );
        }
      } else {
        throw new RangeError(
          `Part archetype solid "${solid.id}" dimension index ${i} must be a number or [min, max] range.`,
        );
      }
    }

    if (solid.linkId !== undefined) {
      if (!Number.isInteger(solid.linkId) || solid.linkId < 0) {
        throw new RangeError(`Part archetype solid "${solid.id}" linkId must be a non-negative integer.`);
      }
      if (solid.linkId >= 1) {
        hasJointSolids = true;
      }
    }
  }

  if (archetype.joint) {
    const { anchorM, axis, rangeRad, restRad, extensionM, extensionAxis } = archetype.joint;
    if (!Array.isArray(anchorM) || anchorM.length !== 3 || anchorM.some((n) => !Number.isFinite(n))) {
      throw new RangeError('Part archetype joint anchorM must be a 3-element finite vector.');
    }
    if (!Array.isArray(axis) || axis.length !== 3 || axis.some((n) => !Number.isFinite(n))) {
      throw new RangeError('Part archetype joint axis must be a 3-element finite vector.');
    }
    const axisLen = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
    if (axisLen < 1e-6) {
      throw new RangeError('Part archetype joint axis must have non-zero length.');
    }
    validateProceduralFiniteRange(rangeRad, 'Part archetype joint rangeRad');
    if (!Number.isFinite(restRad)) {
      throw new RangeError('Part archetype joint restRad must be a finite number.');
    }
    if (extensionM !== undefined) {
      if (Array.isArray(extensionM)) {
        validateProceduralFiniteRange(extensionM, 'Part archetype joint extensionM');
      } else if (typeof extensionM === 'number') {
        if (!Number.isFinite(extensionM) || extensionM < 0) {
          throw new RangeError('Part archetype joint extensionM must be non-negative.');
        }
      }
    }
    if (extensionAxis !== undefined) {
      if (!Array.isArray(extensionAxis) || extensionAxis.length !== 3 || extensionAxis.some((n) => !Number.isFinite(n))) {
        throw new RangeError('Part archetype joint extensionAxis must be a 3-element finite vector.');
      }
      const extLen = Math.sqrt(
        extensionAxis[0] * extensionAxis[0] +
        extensionAxis[1] * extensionAxis[1] +
        extensionAxis[2] * extensionAxis[2],
      );
      if (extLen < 1e-6) {
        throw new RangeError('Part archetype joint extensionAxis must have non-zero length.');
      }
    }
    if (!hasJointSolids) {
      throw new RangeError(
        `Part archetype "${archetype.id}" declares a joint but has no solids assigned to linkId >= 1.`,
      );
    }
  }


  if (Array.isArray(archetype.sockets)) {
    for (const socket of archetype.sockets) {
      if (!VALID_SOCKET_KINDS.has(socket.kind)) {
        throw new RangeError(`Part archetype socket has unknown kind "${socket.kind}".`);
      }
      if (socket.solidId && !solidIds.includes(socket.solidId)) {
        throw new RangeError(
          `Part archetype socket references non-existent solidId "${socket.solidId}".`,
        );
      }
    }
  }
}
