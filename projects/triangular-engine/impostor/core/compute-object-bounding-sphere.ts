import { Mesh, Object3D, Sphere } from 'three';

const scratchSphere = new Sphere();

/**
 * Unions the world-space bounding sphere of every mesh under `obj`, direct
 * port of the reference octahedral-impostor library's
 * `computeObjectBoundingSphere`. Used to size and center the impostor's
 * bake cameras and its final billboard quad around the whole target
 * hierarchy, not just its root mesh. Call `obj.updateMatrixWorld()` first if
 * the object's transform may be stale.
 */
export function computeObjectBoundingSphere(
  obj: Object3D,
  target = new Sphere(),
  forceRecompute = false,
): Sphere {
  target.makeEmpty();
  traverse(obj);
  return target;

  function traverse(node: Object3D): void {
    if ((node as Mesh).isMesh) {
      const geometry = (node as Mesh).geometry;
      if (forceRecompute || !geometry.boundingSphere) geometry.computeBoundingSphere();

      // geometry.boundingSphere is non-null immediately after computeBoundingSphere() above.
      scratchSphere.copy(geometry.boundingSphere as Sphere).applyMatrix4(node.matrixWorld);
      target.union(scratchSphere);
    }

    for (const child of node.children) {
      traverse(child);
    }
  }
}
