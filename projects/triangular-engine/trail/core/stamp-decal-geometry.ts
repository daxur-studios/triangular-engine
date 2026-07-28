import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { Euler, Mesh, Object3D, Vector3, type Vector3Tuple } from 'three';

export interface IStampDecalOptions {
  /** Mesh the decal is projected onto — typically the ground/terrain patch mesh under the stamp. */
  readonly targetMesh: Mesh;
  readonly positionM: Vector3Tuple;
  readonly normal: Vector3Tuple;
  /** Decal extents: width, height, and projection depth into the surface. */
  readonly sizeM: Vector3Tuple;
  /** Rotation around `normal`, for oriented stamps (footprints, tire treads). */
  readonly headingRad?: number;
}

/** Reused across calls purely to derive an orientation Euler — never added to a scene. */
const orienter = new Object3D();
const lookTarget = new Vector3();

/**
 * Thin wrapper around `THREE.DecalGeometry` for point stamps — engine
 * scorch, landing-leg pads, footprints. Orients the decal's projection axis
 * along `normal` and applies `headingRad` as rotation around it, following
 * the same `lookAt`-based orientation three.js's own decal example uses.
 */
export function createStampDecalGeometry(
  options: IStampDecalOptions,
): DecalGeometry {
  const { targetMesh, positionM, normal, sizeM, headingRad = 0 } = options;
  const position = new Vector3(positionM[0], positionM[1], positionM[2]);
  const normalVector = new Vector3(normal[0], normal[1], normal[2]).normalize();

  orienter.position.copy(position);
  lookTarget.copy(position).add(normalVector);
  orienter.lookAt(lookTarget);
  orienter.rotation.z += headingRad;

  const orientation = new Euler().copy(orienter.rotation);
  const size = new Vector3(sizeM[0], sizeM[1], sizeM[2]);
  return new DecalGeometry(targetMesh, position, orientation, size);
}
