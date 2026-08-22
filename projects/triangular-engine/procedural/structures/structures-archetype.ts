import {
  validateProceduralFiniteRange,
  validateProceduralId,
  validateProceduralSchemaVersion,
  validateProceduralUniqueIds,
} from '../core/procedural-validation';
import type { IStructureEndpoints, StructureSolidShape } from './structures-solid';

export type StructureSocketKind =
  | 'spawn-point'
  | 'touchdown-zone'
  | 'catch-zone'
  | 'cable-anchor'
  | 'power-in'
  | 'corridor-node'
  | 'refuel-dock'
  | 'perch'
  | 'custom';

export type StructureSocketRole =
  | 'launch'
  | 'recovery'
  | 'utility'
  | 'docking'
  | 'snap'
  | 'custom';

export interface IStructureSocketConfig {
  readonly kind: StructureSocketKind;
  readonly role?: StructureSocketRole;
  readonly size?: number;
  /** Optional solid id to which this socket attaches or derives from. */
  readonly solidId?: string;
  /** Offset relative to the solid or structure origin (meters). */
  readonly offsetM?: readonly [number, number, number];
  /** Primary functional direction in structure frame (e.g. [0, 1, 0] for launch up, [0, 0, 1] for runway forward). */
  readonly primaryDirection?: readonly [number, number, number];
  /** Clearance radius (meters). */
  readonly clearanceRadiusM?: number;
}

export type StructureFootprintKind = 'rect' | 'circle';

export interface IStructureFootprintConfig {
  readonly kind: StructureFootprintKind;
  /** Dimensions: [halfWidthM, halfLengthM] for rect, or [radiusM] for circle. Supports [min, max] ranges. */
  readonly dimensionsM: readonly (number | readonly [number, number])[];
  /** Depth into ground for foundation grading. */
  readonly foundationDepthM?: number | readonly [number, number];
}

export interface IStructureSolidConfig {
  readonly id: string;
  readonly shape: StructureSolidShape;
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
  /** Optional endpoint definition for linear beams, trusses, or rails. */
  readonly endpoints?: IStructureEndpoints;
  /** Embed depth in meters into foundation or host parent. */
  readonly embedDepthM?: number;
  /** 0 = base foundation (default), 1+ = child of kinematic joint linkId. */
  readonly linkId?: number;
  /** Visual color hint (hex string). */
  readonly materialHex?: string;
  /** Whether to contribute a Jolt collider (default: true). */
  readonly collidable?: boolean;
  /** Optional count for repeating this element (e.g. runway slabs, tower truss bays, coil rings). */
  readonly repeatCount?: number | readonly [number, number];
  /** Offset step per repetition [dx, dy, dz] in meters. */
  readonly repeatOffsetM?: readonly [number, number, number];
  /** Scale factor per repetition (e.g. 0.95 for tapering pylons). */
  readonly repeatScale01?: number | readonly [number, number];
}

export type StructureJointType = 'hinge' | 'prismatic';

export interface IStructureJointConfig {
  readonly id: string;
  /** 1+ representing the link this joint moves. */
  readonly linkId: number;
  /** Parent link ID (0 = root base). Defaults to 0. */
  readonly parentLinkId?: number;
  /** Joint type: 'hinge' (revolute radians) or 'prismatic' (linear meters). Defaults to 'hinge'. */
  readonly type?: StructureJointType;
  /** Anchor point in structure frame (meters). */
  readonly anchorM: readonly [number, number, number];
  /** Motion unit axis (rotation axis for hinge, translation vector for prismatic). */
  readonly axis: readonly [number, number, number];
  /** Allowed travel range in radians or meters [min, max]. */
  readonly range: readonly [number, number];
  /** Rest / stowed position in radians or meters. */
  readonly rest: number;
}

export interface IStructureColliderConfig {
  readonly hull: false;
  readonly coneApproximation: 'cylinder';
}

export interface IStructureArchetype {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name?: string;
  readonly footprint: IStructureFootprintConfig;
  readonly solids: readonly IStructureSolidConfig[];
  readonly sockets?: readonly IStructureSocketConfig[];
  readonly collider?: IStructureColliderConfig;
  readonly joints?: readonly IStructureJointConfig[];
}

const VALID_SHAPES: ReadonlySet<string> = new Set<StructureSolidShape>([
  'box',
  'cylinder',
  'cone',
  'capsule',
  'sphere',
]);

const VALID_SOCKET_KINDS: ReadonlySet<string> = new Set<StructureSocketKind>([
  'spawn-point',
  'touchdown-zone',
  'catch-zone',
  'cable-anchor',
  'power-in',
  'corridor-node',
  'refuel-dock',
  'perch',
  'custom',
]);

const EXPECTED_DIMENSION_COUNTS: Record<StructureSolidShape, number> = {
  box: 3,
  cylinder: 2,
  cone: 3,
  capsule: 2,
  sphere: 1,
};

export function validateStructureArchetype(archetype: IStructureArchetype): void {
  validateProceduralSchemaVersion(archetype.schemaVersion, 'Structure archetype');
  validateProceduralId(archetype.id, 'Structure archetype');

  if (!archetype.footprint || (archetype.footprint.kind !== 'rect' && archetype.footprint.kind !== 'circle')) {
    throw new RangeError(`Structure archetype "${archetype.id}" must declare a valid footprint ('rect' | 'circle').`);
  }

  const expectedFootprintDimCount = archetype.footprint.kind === 'rect' ? 2 : 1;
  if (
    !Array.isArray(archetype.footprint.dimensionsM) ||
    archetype.footprint.dimensionsM.length !== expectedFootprintDimCount
  ) {
    throw new RangeError(
      `Structure archetype footprint "${archetype.footprint.kind}" expects ${expectedFootprintDimCount} dimensions, got ${archetype.footprint.dimensionsM?.length}.`,
    );
  }

  if (!Array.isArray(archetype.solids) || archetype.solids.length === 0) {
    throw new RangeError('Structure archetype must declare at least one solid.');
  }

  const solidIds = archetype.solids.map((s) => s.id);
  validateProceduralUniqueIds(solidIds, 'Structure archetype solids');

  const declaredLinkIds = new Set<number>([0]);

  for (const solid of archetype.solids) {
    if (typeof solid.id !== 'string' || solid.id.length === 0) {
      throw new RangeError('Structure archetype solid id must be a non-empty string.');
    }
    if (!VALID_SHAPES.has(solid.shape)) {
      throw new RangeError(`Structure archetype solid "${solid.id}" has unknown shape "${solid.shape}".`);
    }

    const expectedCount = EXPECTED_DIMENSION_COUNTS[solid.shape as StructureSolidShape];
    if (!Array.isArray(solid.dimensionsM) || solid.dimensionsM.length !== expectedCount) {
      throw new RangeError(
        `Structure archetype solid "${solid.id}" shape "${solid.shape}" expects ${expectedCount} dimensions, got ${solid.dimensionsM?.length}.`,
      );
    }

    for (let i = 0; i < solid.dimensionsM.length; i++) {
      const dim = solid.dimensionsM[i];
      if (Array.isArray(dim)) {
        validateProceduralFiniteRange(
          dim,
          `Structure archetype solid "${solid.id}" dimension index ${i}`,
        );
        if (dim[0] <= 0) {
          throw new RangeError(
            `Structure archetype solid "${solid.id}" dimension index ${i} min value must be positive.`,
          );
        }
      } else if (typeof dim === 'number') {
        if (!Number.isFinite(dim) || dim <= 0) {
          throw new RangeError(
            `Structure archetype solid "${solid.id}" dimension index ${i} must be a positive finite number.`,
          );
        }
      } else {
        throw new RangeError(
          `Structure archetype solid "${solid.id}" dimension index ${i} must be a number or [min, max] range.`,
        );
      }
    }

    if (solid.linkId !== undefined) {
      if (!Number.isInteger(solid.linkId) || solid.linkId < 0) {
        throw new RangeError(`Structure archetype solid "${solid.id}" linkId must be a non-negative integer.`);
      }
      declaredLinkIds.add(solid.linkId);
    }
  }

  if (archetype.joints) {
    const jointIds = archetype.joints.map((j) => j.id);
    validateProceduralUniqueIds(jointIds, 'Structure archetype joints');

    for (const joint of archetype.joints) {
      if (!Number.isInteger(joint.linkId) || joint.linkId < 1) {
        throw new RangeError(`Structure archetype joint "${joint.id}" linkId must be an integer >= 1.`);
      }
      if (!declaredLinkIds.has(joint.linkId)) {
        throw new RangeError(
          `Structure archetype joint "${joint.id}" targets linkId ${joint.linkId} but no solids have this linkId.`,
        );
      }
      if (joint.parentLinkId !== undefined && (!Number.isInteger(joint.parentLinkId) || joint.parentLinkId < 0)) {
        throw new RangeError(`Structure archetype joint "${joint.id}" parentLinkId must be a non-negative integer.`);
      }
      if (!Array.isArray(joint.anchorM) || joint.anchorM.length !== 3 || joint.anchorM.some((n) => !Number.isFinite(n))) {
        throw new RangeError(`Structure archetype joint "${joint.id}" anchorM must be a 3-element finite vector.`);
      }
      if (!Array.isArray(joint.axis) || joint.axis.length !== 3 || joint.axis.some((n) => !Number.isFinite(n))) {
        throw new RangeError(`Structure archetype joint "${joint.id}" axis must be a 3-element finite vector.`);
      }
      const axisLen = Math.sqrt(joint.axis[0] * joint.axis[0] + joint.axis[1] * joint.axis[1] + joint.axis[2] * joint.axis[2]);
      if (axisLen < 1e-6) {
        throw new RangeError(`Structure archetype joint "${joint.id}" axis must have non-zero length.`);
      }
      validateProceduralFiniteRange(joint.range, `Structure archetype joint "${joint.id}" range`);
      if (!Number.isFinite(joint.rest)) {
        throw new RangeError(`Structure archetype joint "${joint.id}" rest must be a finite number.`);
      }
    }
  }

  if (Array.isArray(archetype.sockets)) {
    for (const socket of archetype.sockets) {
      if (!VALID_SOCKET_KINDS.has(socket.kind)) {
        throw new RangeError(`Structure archetype socket has unknown kind "${socket.kind}".`);
      }
      if (socket.solidId && !solidIds.includes(socket.solidId)) {
        throw new RangeError(
          `Structure archetype socket references non-existent solidId "${socket.solidId}".`,
        );
      }
    }
  }
}
