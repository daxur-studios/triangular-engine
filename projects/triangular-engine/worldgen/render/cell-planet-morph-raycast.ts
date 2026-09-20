import type { RaycastFocusContext, RaycastFocusResolver } from 'triangular-engine';
import {
  BatchedMesh,
  Box3,
  BufferAttribute,
  InterleavedBufferAttribute,
  Matrix4,
  Object3D,
  Vector3,
} from 'three';
import { getTerrainBatchInstanceIds } from 'triangular-engine/terrain';
import { CELL_PLANET_MORPH_ATTRIBUTES } from './cell-planet-morph-attributes';

type MorphRaycastAttribute = BufferAttribute | InterleavedBufferAttribute;

interface MorphRaycastBounds {
  readonly bounds: Box3;
}

export interface ICellPlanetMorphRaycastOptions {
  /** Read live each raycast - the same 0 (sphere) .. 1 (flat map) value driving the material. */
  readonly morph: () => number;
  /**
   * Bumped whenever resident geometry changes (wire to `TerrainSurfaceComponent`'s
   * `(lodChange)`), so cached bounds from a previous patch set are never reused after a resize.
   */
  readonly surfaceRevision: () => number;
  readonly spherePositionAttribute?: string;
  readonly flatPositionAttribute?: string;
}

/**
 * Creates a `RaycastFocusResolver` (for `<raycastOrbitControls [raycastFocusResolver]>`) that is
 * correct mid-morph. The generic Three.js raycaster reads the geometry's `position` attribute,
 * which the morph material deliberately leaves as the sphere position and never touches - at any
 * non-zero morph that is not the surface actually drawn, so a plain raycast would hit the
 * invisible sphere. This walks resident `BatchedMesh` geometry directly, blending
 * `aSpherePos`/`aFlatPos` per vertex by the same `morph` value the shader uses, and returns
 * `null` (never falling back to the sphere hit) when nothing morphed is hit - re-hitting the
 * stale sphere is worse than no focus point. Extracted from the proven `cell-planet-morph-
 * streaming` demo page (runbook 039's "morph-aware raycasting" gap).
 */
export function createCellPlanetMorphRaycastFocus(
  options: ICellPlanetMorphRaycastOptions,
): RaycastFocusResolver {
  const spherePositionAttribute =
    options.spherePositionAttribute ?? CELL_PLANET_MORPH_ATTRIBUTES.spherePosition;
  const flatPositionAttribute =
    options.flatPositionAttribute ?? CELL_PLANET_MORPH_ATTRIBUTES.flatPosition;

  let cacheMorph = Number.NaN;
  let cacheRevision = -1;
  let boundsByMesh = new WeakMap<BatchedMesh, Map<number, MorphRaycastBounds>>();

  const instanceMatrix = new Matrix4();
  const worldMatrix = new Matrix4();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const hit = new Vector3();
  const closestHit = new Vector3();
  const worldBounds = new Box3();

  const readMorphedPosition = (
    sphere: MorphRaycastAttribute,
    flat: MorphRaycastAttribute,
    index: number,
    morph: number,
    target: Vector3,
  ): Vector3 => {
    const inverseMorph = 1 - morph;
    target.set(
      sphere.getX(index) * inverseMorph + flat.getX(index) * morph,
      sphere.getY(index) * inverseMorph + flat.getY(index) * morph,
      sphere.getZ(index) * inverseMorph + flat.getZ(index) * morph,
    );
    return target;
  };

  const getMorphedGeometryBounds = (
    mesh: BatchedMesh,
    sphere: MorphRaycastAttribute,
    flat: MorphRaycastAttribute,
    morph: number,
  ): Map<number, MorphRaycastBounds> => {
    let boundsByGeometry = boundsByMesh.get(mesh);
    if (!boundsByGeometry) {
      boundsByGeometry = new Map();
      boundsByMesh.set(mesh, boundsByGeometry);
    }

    const geometryIds = new Set<number>();
    for (const instanceId of getTerrainBatchInstanceIds(mesh)) {
      if (mesh.getVisibleAt(instanceId)) {
        geometryIds.add(mesh.getGeometryIdAt(instanceId));
      }
    }

    for (const geometryId of geometryIds) {
      if (boundsByGeometry.has(geometryId)) continue;
      const range = mesh.getGeometryRangeAt(geometryId);
      if (!range) continue;

      const bounds = new Box3().makeEmpty();
      const end = range.vertexStart + range.vertexCount;
      for (let vertex = range.vertexStart; vertex < end; vertex += 1) {
        readMorphedPosition(sphere, flat, vertex, morph, a);
        bounds.expandByPoint(a);
      }
      boundsByGeometry.set(geometryId, { bounds });
    }

    return boundsByGeometry;
  };

  const raycastMorphedTerrain = (
    context: RaycastFocusContext,
    morph: number,
  ): Vector3 | null => {
    if (morph !== cacheMorph || cacheRevision !== options.surfaceRevision()) {
      cacheMorph = morph;
      cacheRevision = options.surfaceRevision();
      boundsByMesh = new WeakMap();
    }

    let closestDistanceSq = Number.POSITIVE_INFINITY;
    let hasHit = false;
    const ray = context.raycaster.ray;

    const visit = (object: Object3D): void => {
      if (!object.visible) return;
      if ((object as { isBatchedMesh?: boolean }).isBatchedMesh) {
        const mesh = object as BatchedMesh;
        const sphere = mesh.geometry.getAttribute(spherePositionAttribute) as
          | MorphRaycastAttribute
          | undefined;
        const flat = mesh.geometry.getAttribute(flatPositionAttribute) as
          | MorphRaycastAttribute
          | undefined;
        const index = mesh.geometry.index;
        if (!sphere || !flat || !index) return;

        mesh.updateMatrixWorld(true);
        const boundsByGeometry = getMorphedGeometryBounds(mesh, sphere, flat, morph);

        for (const instanceId of getTerrainBatchInstanceIds(mesh)) {
          if (!mesh.getVisibleAt(instanceId)) continue;
          const geometryId = mesh.getGeometryIdAt(instanceId);
          const bounds = boundsByGeometry.get(geometryId);
          const range = mesh.getGeometryRangeAt(geometryId);
          if (!bounds || !range) continue;

          mesh.getMatrixAt(instanceId, instanceMatrix);
          worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
          worldBounds.copy(bounds.bounds).applyMatrix4(worldMatrix);
          if (!ray.intersectsBox(worldBounds)) continue;

          const indexEnd = range.indexStart + range.indexCount;
          for (let i = range.indexStart; i < indexEnd; i += 3) {
            const ia = index.getX(i);
            const ib = index.getX(i + 1);
            const ic = index.getX(i + 2);
            readMorphedPosition(sphere, flat, ia, morph, a).applyMatrix4(worldMatrix);
            readMorphedPosition(sphere, flat, ib, morph, b).applyMatrix4(worldMatrix);
            readMorphedPosition(sphere, flat, ic, morph, c).applyMatrix4(worldMatrix);

            const triangleHit = ray.intersectTriangle(a, b, c, false, hit);
            if (!triangleHit) continue;
            const distanceSq = ray.origin.distanceToSquared(hit);
            if (distanceSq < closestDistanceSq) {
              closestDistanceSq = distanceSq;
              closestHit.copy(hit);
              hasHit = true;
            }
          }
        }
        return;
      }

      for (const child of object.children) visit(child);
    };

    for (const child of context.sceneChildren) visit(child);

    return hasHit ? closestHit.clone() : null;
  };

  return (context: RaycastFocusContext): Vector3 | null => {
    const morph = options.morph();
    if (morph <= 1e-6) {
      const genericHit = context.raycaster.intersectObjects(
        context.sceneChildren as Object3D[],
        true,
      )[0];
      return genericHit?.point ?? null;
    }

    return raycastMorphedTerrain(context, morph);
  };
}
