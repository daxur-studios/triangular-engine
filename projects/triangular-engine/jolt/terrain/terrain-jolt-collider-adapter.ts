import type {
  ITerrainPatchMesh,
  TerrainVector3,
} from 'triangular-engine/terrain';

import { LAYER_NON_MOVING } from '../example';
import { type IJoltMetadata, Jolt } from '../jolt-physics/jolt-physics.service';

export interface ITerrainJoltColliderPatch {
  readonly key: string;
  readonly mesh: ITerrainPatchMesh<unknown>;
  /** Patch centre expressed in the active physics/render frame. */
  readonly positionM?: TerrainVector3;
}

/**
 * Owns static Jolt triangle-mesh bodies for a streamed set of terrain patches.
 * Only `patch.surface` is consumed; visual seam skirts can never become colliders.
 */
export class TerrainJoltColliderAdapter {
  readonly #bodies = new Map<string, Jolt.Body>();

  constructor(private readonly metadata: IJoltMetadata) {}

  get residentCount(): number {
    return this.#bodies.size;
  }

  has(key: string): boolean {
    return this.#bodies.has(key);
  }

  add(patch: ITerrainJoltColliderPatch): void {
    if (this.#bodies.has(patch.key)) return;
    const { positions, indices } = patch.mesh.surface;
    const triangles = new Jolt.TriangleList();
    const materials = new Jolt.PhysicsMaterialList();
    triangles.resize(indices.length / 3);
    for (
      let triangleIndex = 0;
      triangleIndex < indices.length / 3;
      triangleIndex++
    ) {
      const triangle = triangles.at(triangleIndex);
      for (let corner = 0; corner < 3; corner++) {
        const source = indices[triangleIndex * 3 + corner] * 3;
        const target = triangle.get_mV(corner);
        target.x = positions[source];
        target.y = positions[source + 1];
        target.z = positions[source + 2];
      }
    }

    const shapeSettings = new Jolt.MeshShapeSettings(triangles, materials);
    const shapeResult = shapeSettings.Create();
    const shape = shapeResult.Get() as Jolt.MeshShape;
    const centre = patch.positionM ?? patch.mesh.centerWorldM;
    const position = new Jolt.RVec3(centre[0], centre[1], centre[2]);
    const rotation = new Jolt.Quat(0, 0, 0, 1);
    const bodySettings = new Jolt.BodyCreationSettings(
      shape,
      position,
      rotation,
      Jolt.EMotionType_Static,
      LAYER_NON_MOVING,
    );
    const body = this.metadata.bodyInterface.CreateBody(bodySettings);
    this.metadata.bodyInterface.AddBody(
      body.GetID(),
      Jolt.EActivation_DontActivate,
    );
    this.#bodies.set(patch.key, body);

    Jolt.destroy(bodySettings);
    Jolt.destroy(position);
    Jolt.destroy(rotation);
    Jolt.destroy(shapeResult);
    Jolt.destroy(shapeSettings);
    Jolt.destroy(triangles);
    Jolt.destroy(materials);
  }

  remove(key: string): void {
    const body = this.#bodies.get(key);
    if (!body) return;
    this.metadata.bodyInterface.RemoveBody(body.GetID());
    this.metadata.bodyInterface.DestroyBody(body.GetID());
    this.#bodies.delete(key);
  }

  reconcile(desiredKeys: ReadonlySet<string>): void {
    for (const key of this.#bodies.keys()) {
      if (!desiredKeys.has(key)) this.remove(key);
    }
  }

  dispose(): void {
    for (const key of [...this.#bodies.keys()]) this.remove(key);
  }
}
