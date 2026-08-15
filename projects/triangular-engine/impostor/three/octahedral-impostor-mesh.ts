import { Material, Matrix4, Mesh, PlaneGeometry, Sphere, type Object3D } from 'three';

import { computeObjectBoundingSphere } from '../core/compute-object-bounding-sphere';
import {
  createOctahedralImpostorMaterial,
  type ICreateOctahedralImpostorMaterialOptions,
  type IOctahedralImpostorMaterialHandle,
} from './octahedral-impostor-material';

export interface IBuildOctahedralImpostorMeshOptions<T extends Material>
  extends Omit<ICreateOctahedralImpostorMaterialOptions<T>, 'transform'> {
  /**
   * Sizes and centers the impostor plane via this object's bounding sphere
   * — pass the same target the atlas was (or will be) baked from, so the
   * billboard exactly covers what's baked into it.
   */
  readonly target: Object3D;
}

export interface IOctahedralImpostorMesh<T extends Material> {
  readonly mesh: Mesh<PlaneGeometry, T>;
  readonly materialHandle: IOctahedralImpostorMaterialHandle<T>;
}

const scratchSphere = new Sphere();

/**
 * Builds a camera-facing `Mesh<PlaneGeometry>` rendered as a hemispherical
 * octahedral impostor. Port of the reference octahedral-impostor library's
 * `OctahedralImpostor` (a `Mesh` subclass there); exposed here as a factory
 * function to match this codebase's function-first mesh-building convention
 * (`buildScatterBillboardInstancedMesh`, `buildScatterInstancedMesh`, ...).
 *
 * The unit plane is scaled/translated to the target's bounding-sphere
 * diameter via the `impostorTransform` uniform (baked into the material, not
 * this mesh's own `scale`/`position`) so a single shared material — and a
 * single baked atlas — can back every instance of an `InstancedMesh` built
 * from `mesh.geometry`/`mesh.material` without each instance needing its own
 * transform correction.
 */
export function buildOctahedralImpostorMesh<T extends Material>(
  options: IBuildOctahedralImpostorMeshOptions<T>,
): IOctahedralImpostorMesh<T> {
  const sphere = computeObjectBoundingSphere(options.target, scratchSphere, true);
  const diameter = sphere.radius * 2;
  const transform = new Matrix4().makeScale(diameter, diameter, diameter).setPosition(sphere.center);

  const materialHandle = createOctahedralImpostorMaterial<T>({ ...options, transform });
  const mesh = new Mesh(new PlaneGeometry(), materialHandle.material);

  return { mesh, materialHandle };
}
