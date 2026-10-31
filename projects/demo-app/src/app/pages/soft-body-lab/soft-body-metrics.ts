import { Quaternion, Vector3 } from 'three';
import { Jolt } from 'triangular-engine/jolt';
import { meshVolume, type MeshRestShape, type SoftMeshFace } from './soft-body-example-meshes';

export interface SoftBodySample {
  readonly vertexCount: number;
  /** RMS edge-length strain against the rest mesh, 0..1 (0 = the exact rest shape). */
  readonly shapeErrorRms: number;
  readonly shapeErrorP95: number;
  /** Absolute mesh volume / rest volume. `1` is the rest shape. */
  readonly volumeRatio: number;
  /** Deepest vertex in world space, metres; negative means through the floor at y = 0. */
  readonly minWorldY: number;
  readonly nonFiniteVertices: number;
  /** The pressure Jolt reports for this body. */
  readonly pressure: number;
}

/** Reads the live particle positions of a Jolt soft body (body-local space). */
export function readSoftBodyVertices(body: Jolt.Body): number[][] {
  const motion = Jolt.castObject(body.GetMotionProperties(), Jolt.SoftBodyMotionProperties);
  const vertices = motion.GetVertices();
  const offset = Jolt.SoftBodyVertexTraits.prototype.mPositionOffset;
  const result: number[][] = [];
  for (let i = 0; i < vertices.size(); i++) {
    const view = new Float32Array(Jolt.HEAP32.buffer, Jolt.getPointer(vertices.at(i)) + offset, 3);
    result.push([view[0], view[1], view[2]]);
  }
  return result;
}

/** Measures one soft body against its rest shape. */
export function sampleSoftBody(body: Jolt.Body, rest: MeshRestShape, faces: ReadonlyArray<SoftMeshFace>): SoftBodySample {
  const motion = Jolt.castObject(body.GetMotionProperties(), Jolt.SoftBodyMotionProperties);
  const local = readSoftBodyVertices(body);
  let nonFiniteVertices = 0;
  for (const [x, y, z] of local) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nonFiniteVertices++;
  }
  const strains: number[] = [];
  for (const { a, b, length } of rest.edges) {
    if (length <= 0 || a >= local.length || b >= local.length) continue;
    const [ax, ay, az] = local[a];
    const [bx, by, bz] = local[b];
    strains.push(Math.abs(Math.hypot(bx - ax, by - ay, bz - az) / length - 1));
  }
  strains.sort((l, r) => l - r);
  const shapeErrorRms = strains.length
    ? Math.sqrt(strains.reduce((sum, value) => sum + value * value, 0) / strains.length)
    : 0;
  const shapeErrorP95 = strains.length ? strains[Math.min(strains.length - 1, Math.floor(strains.length * 0.95))] : 0;

  const position = body.GetPosition();
  const rotation = body.GetRotation();
  const quaternion = new Quaternion(rotation.GetX(), rotation.GetY(), rotation.GetZ(), rotation.GetW());
  const origin = new Vector3(position.GetX(), position.GetY(), position.GetZ());
  const world = new Vector3();
  let minWorldY = Number.POSITIVE_INFINITY;
  for (const [x, y, z] of local) {
    world.set(x, y, z).applyQuaternion(quaternion).add(origin);
    if (world.y < minWorldY) minWorldY = world.y;
  }

  const volume = Math.abs(meshVolume(local, faces));
  return {
    vertexCount: local.length,
    shapeErrorRms,
    shapeErrorP95,
    volumeRatio: rest.volume > 0 ? volume / rest.volume : 0,
    minWorldY: Number.isFinite(minWorldY) ? minWorldY : Number.NaN,
    nonFiniteVertices,
    pressure: motion.GetPressure(),
  };
}

