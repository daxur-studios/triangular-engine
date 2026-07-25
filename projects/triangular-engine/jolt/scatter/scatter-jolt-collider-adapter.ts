import type {
  IScatterCellColliderDescriptors,
  IScatterColliderDescriptor,
  ScatterInstanceId,
} from 'triangular-engine/scatter';

import { LAYER_NON_MOVING } from '../example';
import { type IJoltMetadata, Jolt } from '../jolt-physics/jolt-physics.service';

interface IScatterPhysicsCell {
  readonly body: Jolt.Body;
  readonly bodyIndexAndSequence: number;
  readonly anchorWorldM: readonly [number, number, number];
  readonly instanceIds: readonly ScatterInstanceId[];
  readonly descriptors: readonly IScatterColliderDescriptor[];
}

function createSubShapeSettings(
  descriptor: IScatterColliderDescriptor,
): Jolt.ShapeSettings {
  switch (descriptor.shape) {
    case 'box': {
      const [width, height, depth] = descriptor.params;
      const halfExtents = new Jolt.Vec3(width / 2, height / 2, depth / 2);
      const settings = new Jolt.BoxShapeSettings(halfExtents, 0.05, undefined);
      Jolt.destroy(halfExtents);
      return settings;
    }
    case 'sphere': {
      const [radius] = descriptor.params;
      return new Jolt.SphereShapeSettings(radius, undefined);
    }
    case 'capsule': {
      const [halfHeight, radius] = descriptor.params;
      return new Jolt.CapsuleShapeSettings(halfHeight, radius, undefined);
    }
    case 'cylinder': {
      const [halfHeight, radius] = descriptor.params;
      return new Jolt.CylinderShapeSettings(halfHeight, radius, 0.05, undefined);
    }
    case 'hull':
      throw new Error(
        `ScatterJoltColliderAdapter: hull colliders are not yet supported (instance ${descriptor.instanceId}).`,
      );
    default:
      throw new Error(
        `ScatterJoltColliderAdapter: unknown collider shape "${(descriptor as IScatterColliderDescriptor).shape}".`,
      );
  }
}

/**
 * Owns static Jolt compound bodies for a streamed set of scatter physics
 * cells — one StaticCompoundShape body per cell, one sub-shape per
 * collidable instance. Sub-shape index doubles as the lookup key back to the
 * instance's stable ScatterInstanceId at contact time.
 *
 * Mirrors TerrainJoltColliderAdapter's has/add/remove/reconcile/dispose
 * shape. Cells with zero descriptors (all removed, or a collider-less
 * species) never create a body — Jolt rejects a compound shape with zero
 * sub-shapes.
 */
export class ScatterJoltColliderAdapter {
  readonly #cellsByKey = new Map<string, IScatterPhysicsCell>();
  readonly #cellKeyByBodyIndex = new Map<number, string>();
  readonly #cellKeyByInstanceId = new Map<ScatterInstanceId, string>();
  /** Cell inputs the caller last supplied, kept only so removeInstance can rebuild after dropping one instance. */
  readonly #lastCellInput = new Map<string, IScatterCellColliderDescriptors>();

  constructor(private readonly metadata: IJoltMetadata) {}

  get residentCellCount(): number {
    return this.#cellsByKey.size;
  }

  get residentInstanceCount(): number {
    let count = 0;
    for (const cell of this.#cellsByKey.values()) count += cell.instanceIds.length;
    return count;
  }

  has(cellKey: string): boolean {
    return this.#cellsByKey.has(cellKey);
  }

  add(cell: IScatterCellColliderDescriptors): void {
    if (this.#cellsByKey.has(cell.cellKey)) return;
    this.#lastCellInput.set(cell.cellKey, cell);
    if (cell.descriptors.length === 0) return;
    this.#createCell(cell);
  }

  /**
   * Rebuilds that cell's compound minus one instance; no-op if the instance
   * isn't currently resident. Anything resting on the destroyed geometry
   * keeps its last-known contact state until Jolt's normal sleep/wake cycle
   * revisits it — callers with a specific body that must react immediately
   * (e.g. the vehicle that just felled this instance) should call
   * `metadata.bodyInterface.ActivateBody(...)` on it themselves right after.
   */
  removeInstance(instanceId: ScatterInstanceId): void {
    const cellKey = this.#cellKeyByInstanceId.get(instanceId);
    if (!cellKey) return;

    const previousInput = this.#lastCellInput.get(cellKey);
    this.#removeCellBody(cellKey);
    if (!previousInput) return;

    const remaining: IScatterCellColliderDescriptors = {
      ...previousInput,
      descriptors: previousInput.descriptors.filter((d) => d.instanceId !== instanceId),
    };
    this.#lastCellInput.set(cellKey, remaining);
    if (remaining.descriptors.length > 0) this.#createCell(remaining);
  }

  remove(cellKey: string): void {
    this.#removeCellBody(cellKey);
    this.#lastCellInput.delete(cellKey);
  }

  reconcile(desiredCellKeys: ReadonlySet<string>): void {
    for (const cellKey of [...this.#lastCellInput.keys()]) {
      if (!desiredCellKeys.has(cellKey)) this.remove(cellKey);
    }
  }

  /** Contact-time lookup: resolves a body + sub-shape hit back to the scatter instance it came from. */
  resolveInstanceId(
    body: Jolt.Body,
    subShapeId: Jolt.SubShapeID,
  ): ScatterInstanceId | undefined {
    const cellKey = this.#cellKeyByBodyIndex.get(body.GetID().GetIndexAndSequenceNumber());
    if (!cellKey) return undefined;
    const cell = this.#cellsByKey.get(cellKey);
    if (!cell) return undefined;

    const shape = body.GetShape();
    const subShapeIndex = shape.GetSubShapeUserData(subShapeId);
    return cell.instanceIds[subShapeIndex];
  }

  dispose(): void {
    for (const cellKey of [...this.#cellsByKey.keys()]) this.#removeCellBody(cellKey);
    this.#lastCellInput.clear();
  }

  #createCell(cell: IScatterCellColliderDescriptors): void {
    const compoundSettings = new Jolt.StaticCompoundShapeSettings();
    const instanceIds: ScatterInstanceId[] = [];

    for (let index = 0; index < cell.descriptors.length; index++) {
      const descriptor = cell.descriptors[index];
      const subShapeSettings = createSubShapeSettings(descriptor);
      const [relX, relY, relZ] = descriptor.anchorRelativePositionM;
      const [rotX, rotY, rotZ, rotW] = descriptor.rotation;
      const position = new Jolt.Vec3(relX, relY, relZ);
      const rotation = new Jolt.Quat(rotX, rotY, rotZ, rotW);
      compoundSettings.AddShapeShapeSettings(position, rotation, subShapeSettings, index);
      instanceIds.push(descriptor.instanceId);
      Jolt.destroy(position);
      Jolt.destroy(rotation);
      Jolt.destroy(subShapeSettings);
    }

    const shapeResult = compoundSettings.Create();
    const shape = shapeResult.Get();
    const [anchorX, anchorY, anchorZ] = cell.anchorWorldM;
    const bodyPosition = new Jolt.RVec3(anchorX, anchorY, anchorZ);
    const bodyRotation = new Jolt.Quat(0, 0, 0, 1);
    const bodySettings = new Jolt.BodyCreationSettings(
      shape,
      bodyPosition,
      bodyRotation,
      Jolt.EMotionType_Static,
      LAYER_NON_MOVING,
    );
    const body = this.metadata.bodyInterface.CreateBody(bodySettings);
    this.metadata.bodyInterface.AddBody(body.GetID(), Jolt.EActivation_DontActivate);

    const bodyIndexAndSequence = body.GetID().GetIndexAndSequenceNumber();
    this.#cellsByKey.set(cell.cellKey, {
      body,
      bodyIndexAndSequence,
      anchorWorldM: cell.anchorWorldM,
      instanceIds,
      descriptors: cell.descriptors,
    });
    this.#cellKeyByBodyIndex.set(bodyIndexAndSequence, cell.cellKey);
    for (const instanceId of instanceIds) this.#cellKeyByInstanceId.set(instanceId, cell.cellKey);

    Jolt.destroy(bodySettings);
    Jolt.destroy(bodyPosition);
    Jolt.destroy(bodyRotation);
    Jolt.destroy(shapeResult);
    Jolt.destroy(compoundSettings);
  }

  #removeCellBody(cellKey: string): void {
    const cell = this.#cellsByKey.get(cellKey);
    if (!cell) return;

    this.metadata.bodyInterface.RemoveBody(cell.body.GetID());
    this.metadata.bodyInterface.DestroyBody(cell.body.GetID());

    this.#cellsByKey.delete(cellKey);
    this.#cellKeyByBodyIndex.delete(cell.bodyIndexAndSequence);
    for (const instanceId of cell.instanceIds) this.#cellKeyByInstanceId.delete(instanceId);
  }
}
