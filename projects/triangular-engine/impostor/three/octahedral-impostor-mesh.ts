import {
  Box3,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Sphere,
  Vector3,
  type Object3D,
} from 'three';

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
  const geometry = new PlaneGeometry();
  /**
   * The plane's own vertices stay unit-sized (the `impostorTransform`
   * uniform does the real scale/translate entirely in the vertex shader),
   * so the geometry's auto-computed bounds default to that tiny unit
   * size — wrong for anything that reads them directly (raycasting,
   * frustum culling), which know nothing about the shader-side transform.
   * Override to the real baked size so those checks aren't testing
   * against a ~1-unit box for what's actually a `diameter`-sized billboard.
   */
  geometry.boundingSphere = new Sphere(sphere.center.clone(), diameter * Math.SQRT1_2);
  geometry.boundingBox = new Box3().setFromCenterAndSize(
    sphere.center,
    new Vector3(diameter, diameter, diameter),
  );
  const mesh = new Mesh(geometry, materialHandle.material);

  return { mesh, materialHandle };
}

/**
 * Builds an InstancedMesh rendering multiple instances of an octahedral impostor in a single GPU draw call.
 */
export function buildOctahedralImpostorInstancedMesh<T extends Material>(
  options: IBuildOctahedralImpostorMeshOptions<T>,
  count: number,
): { instancedMesh: InstancedMesh<PlaneGeometry, T>; materialHandle: IOctahedralImpostorMaterialHandle<T> } {
  const single = buildOctahedralImpostorMesh(options);
  const instancedMesh = new InstancedMesh(single.mesh.geometry, single.mesh.material, count);
  return { instancedMesh, materialHandle: single.materialHandle };
}
