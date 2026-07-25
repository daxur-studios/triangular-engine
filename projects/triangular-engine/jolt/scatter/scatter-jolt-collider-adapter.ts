import type {
  IScatterCellColliderDescriptors,
  IScatterColliderDescriptor,
  ScatterInstanceId,
} from 'triangular-engine/scatter';

import { LAYER_NON_MOVING } from '../example';
import { type IJoltMetadata, Jolt } from '../jolt-physics/jolt-physics.service';

interface IScatterPhysicsCell {
  readonly body: Jolt.Body;
  readonly shape: Jolt.MutableCompoundShape;
  readonly bodyIndexAndSequence: number;
  readonly anchorWorldM: readonly [number, number, number];
  /** Index-aligned with the compound's children — RemoveShape shifts, so this splices. */
  readonly instanceIds: ScatterInstanceId[];
  readonly instanceIdByUserData: Map<number, ScatterInstanceId>;
}

/**
 * Leaf-shape user data key. Starts at 1 so the Jolt default of 0 stays a
 * "not one of ours" sentinel: a contact against a shape we never tagged
 * resolves to undefined instead of aliasing a real instance.
 */
let nextSubShapeUserData = 1;

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
 * cells — one MutableCompoundShape body per cell, one sub-shape per
 * collidable instance. Stable sub-shape user data maps contacts back to the
 * instance's ScatterInstanceId.
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
  /** Per-instance felling threshold, set at cell creation — read back at contact time via resolveImpactThresholdNs. */
  readonly #impactThresholdByInstanceId = new Map<ScatterInstanceId, number | undefined>();
  /** Cell inputs the caller last supplied, updated as individual instances are removed. */
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

  /** Removes only the matching child shape while preserving the cell body and its other contacts. */
  removeInstance(instanceId: ScatterInstanceId): void {
    const cellKey = this.#cellKeyByInstanceId.get(instanceId);
    if (!cellKey) return;

    const cell = this.#cellsByKey.get(cellKey);
    const previousInput = this.#lastCellInput.get(cellKey);
    if (!cell || !previousInput) return;

    const remaining: IScatterCellColliderDescriptors = {
      ...previousInput,
      descriptors: previousInput.descriptors.filter((d) => d.instanceId !== instanceId),
    };
    this.#lastCellInput.set(cellKey, remaining);
    this.#cellKeyByInstanceId.delete(instanceId);
    this.#impactThresholdByInstanceId.delete(instanceId);

    const subShapeIndex = cell.instanceIds.indexOf(instanceId);
    if (subShapeIndex < 0) return;
    if (cell.instanceIds.length === 1) {
      this.#removeCellBody(cellKey);
      return;
    }

    const previousCenterOfMass = cell.shape.GetCenterOfMass();
    cell.shape.RemoveShape(subShapeIndex);
    // MutableCompoundShape::RemoveShape erases the child, shifting every
    // later child down one — it does not swap the last child into the hole.
    // splice mirrors that, keeping instanceIds index-aligned with the
    // compound so the next RemoveShape targets the right child.
    cell.instanceIds.splice(subShapeIndex, 1);
    // Drop the tag too, so a contact queued against the removed child before
    // the shape changed cannot resolve to an already-removed instance.
    for (const [userData, id] of cell.instanceIdByUserData) {
      if (id === instanceId) cell.instanceIdByUserData.delete(userData);
    }
    this.metadata.bodyInterface.NotifyShapeChanged(
      cell.body.GetID(),
      previousCenterOfMass,
      false,
      Jolt.EActivation_DontActivate,
    );
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

    const userData = cell.shape.GetSubShapeUserData(subShapeId);
    if (userData === 0) return undefined;
    return cell.instanceIdByUserData.get(userData);
  }

  /** This instance's own felling threshold (e.g. scaled by tree size), if the species defines one. */
  resolveImpactThresholdNs(instanceId: ScatterInstanceId): number | undefined {
    return this.#impactThresholdByInstanceId.get(instanceId);
  }

  dispose(): void {
    for (const cellKey of [...this.#cellsByKey.keys()]) this.#removeCellBody(cellKey);
    this.#lastCellInput.clear();
  }

  #createCell(cell: IScatterCellColliderDescriptors): void {
    const compoundSettings = new Jolt.MutableCompoundShapeSettings();
    const instanceIds: ScatterInstanceId[] = [];
    const instanceIdByUserData = new Map<number, ScatterInstanceId>();

    for (let index = 0; index < cell.descriptors.length; index++) {
      const descriptor = cell.descriptors[index];
      const subShapeSettings = createSubShapeSettings(descriptor);
      // Identity is carried on the LEAF shape, not on the compound child.
      // CompoundShape::GetSubShapeUserData() returns Shape::GetUserData() of
      // the leaf it resolves to — it does NOT return the compound child's
      // SubShape::mUserData (see Jolt's CompoundShape.h note on that field;
      // reading it back needs GetSubShapeIndexFromID, which JoltPhysics.js
      // does not bind). Shape's settings constructor copies mUserData onto
      // the created shape, so tagging the settings is what makes the
      // contact-time lookup work. Leaf-carried data also survives child
      // reordering, unlike an index.
      const userData = nextSubShapeUserData++;
      subShapeSettings.mUserData = userData;
      const [relX, relY, relZ] = descriptor.anchorRelativePositionM;
      const [rotX, rotY, rotZ, rotW] = descriptor.rotation;
      const position = new Jolt.Vec3(relX, relY, relZ);
      const rotation = new Jolt.Quat(rotX, rotY, rotZ, rotW);
      // The compound takes a reference to the shape settings and releases it
      // when compoundSettings is destroyed. Destroying it here (or separately
      // after Create) leaves a dangling reference or causes a double release.
      compoundSettings.AddShapeShapeSettings(position, rotation, subShapeSettings, userData);
      instanceIds.push(descriptor.instanceId);
      instanceIdByUserData.set(userData, descriptor.instanceId);
      this.#impactThresholdByInstanceId.set(descriptor.instanceId, descriptor.impactThresholdNs);
      Jolt.destroy(position);
      Jolt.destroy(rotation);
    }

    const shapeResult = compoundSettings.Create();
    const shape = Jolt.castObject(shapeResult.Get(), Jolt.MutableCompoundShape);
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
      shape,
      bodyIndexAndSequence,
      anchorWorldM: cell.anchorWorldM,
      instanceIds,
      instanceIdByUserData,
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
    for (const instanceId of cell.instanceIds) {
      this.#cellKeyByInstanceId.delete(instanceId);
      this.#impactThresholdByInstanceId.delete(instanceId);
    }
  }
}
