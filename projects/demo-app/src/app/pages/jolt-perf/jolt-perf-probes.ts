import type { ITerrainPatchMesh } from 'triangular-engine/terrain';
import {
  Jolt, LAYER_MOVING, LAYER_NON_MOVING, wrapVec3, type IJoltMetadata,
} from 'triangular-engine/jolt';
import type { HeightGrid } from './jolt-perf-math';
import type { PrecisionProbe } from './jolt-perf-math';

/**
 * Wraps a height grid as the patch a terrain streams to the Jolt collider adapter. The patch sits at the origin, so the
 * grid's own coordinates are the collider's.
 */
export function heightGridPatch(grid: HeightGrid): ITerrainPatchMesh<string> {
  const vertexCount = grid.side * grid.side;
  return {
    address: `jolt-perf-grid-${grid.side}`,
    resolution: grid.side - 1,
    centerWorldM: [0, 0, 0],
    surface: {
      positions: grid.positions,
      normals: new Float32Array(vertexCount * 3),
      uvs: new Float32Array(vertexCount * 2),
      indices: grid.indices,
    },
    geometricErrorM: 0,
  };
}

/**
 * Places one body at `probe.x` the way the engine's rigid-body component does (RVec3 position, BodyCreationSettings, the
 * same layer), reads the position back through the engine's `wrapVec3`, then removes and destroys the body. The body is
 * added without activation and read in the same task, so no physics step moves it before the read.
 */
export function probePrecisionReadback(metadata: IJoltMetadata, probe: PrecisionProbe): number {
  const { bodyInterface } = metadata;
  const halfExtents = new Jolt.Vec3(0.5, 0.5, 0.5);
  const shape = new Jolt.BoxShape(halfExtents, 0.05, undefined);
  Jolt.destroy(halfExtents);
  shape.AddRef();
  const position = new Jolt.RVec3(probe.x, 0, 0);
  const rotation = new Jolt.Quat(0, 0, 0, 1);
  const settings = new Jolt.BodyCreationSettings(
    shape,
    position,
    rotation,
    probe.motion === 'static' ? Jolt.EMotionType_Static : Jolt.EMotionType_Dynamic,
    probe.motion === 'static' ? LAYER_NON_MOVING : LAYER_MOVING,
  );
  Jolt.destroy(position);
  Jolt.destroy(rotation);
  const body = bodyInterface.CreateBody(settings);
  Jolt.destroy(settings);
  try {
    bodyInterface.AddBody(body.GetID(), Jolt.EActivation_DontActivate);
    return wrapVec3(body.GetPosition()).x;
  } finally {
    bodyInterface.RemoveBody(body.GetID());
    bodyInterface.DestroyBody(body.GetID());
    shape.Release();
  }
}
