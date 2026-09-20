import type { RaycastFocusContext } from 'triangular-engine';
import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import {
  registerTerrainBatchInstance,
  unregisterTerrainBatchInstance,
} from 'triangular-engine/terrain';
import { createCellPlanetMorphRaycastFocus } from './cell-planet-morph-raycast';

/** A single quad whose sphere position sits centred at x=0 and flat position at x=10, so
 * blending by `morph` moves the hittable surface a known, checkable distance along X. */
function createMorphQuad(): BatchedMesh {
  const geometry = new BufferGeometry();
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const spherePositions = positions.slice();
  const flatPositions = new Float32Array([9, -1, 0, 11, -1, 0, 11, 1, 0, 9, 1, 0]);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSpherePos', new BufferAttribute(spherePositions, 3));
  geometry.setAttribute('aFlatPos', new BufferAttribute(flatPositions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const mesh = new BatchedMesh(1, 4, 6, new MeshBasicMaterial());
  const geometryId = mesh.addGeometry(geometry);
  const instanceId = mesh.addInstance(geometryId);
  mesh.setVisibleAt(instanceId, true);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function createContext(origin: Vector3, direction: Vector3, sceneChildren: readonly import('three').Object3D[]): RaycastFocusContext {
  const raycaster = new Raycaster(origin, direction.normalize());
  return {
    raycaster,
    camera: new Camera(),
    ndc: new Vector2(0, 0),
    sceneChildren,
  };
}

describe('createCellPlanetMorphRaycastFocus', () => {
  it('falls back to the generic raycaster when morph is ~0', () => {
    const plainMesh = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
    plainMesh.updateMatrixWorld(true);

    const resolve = createCellPlanetMorphRaycastFocus({
      morph: () => 0,
      surfaceRevision: () => 0,
    });

    const context = createContext(
      new Vector3(0, 0, 5),
      new Vector3(0, 0, -1),
      [plainMesh],
    );
    const hit = resolve(context);
    expect(hit).not.toBeNull();
    expect((hit as Vector3).z).toBeCloseTo(0, 5);
  });

  it('hits the quad at its sphere position when morph is 0', () => {
    const mesh = createMorphQuad();
    const resolve = createCellPlanetMorphRaycastFocus({
      morph: () => 0,
      surfaceRevision: () => 0,
    });

    const hitAtOrigin = resolve(createContext(new Vector3(0, 0, 5), new Vector3(0, 0, -1), [mesh]));
    expect(hitAtOrigin).not.toBeNull();
    expect((hitAtOrigin as Vector3).x).toBeCloseTo(0, 3);

    const missAtFlatPosition = resolve(
      createContext(new Vector3(10, 0, 5), new Vector3(0, 0, -1), [mesh]),
    );
    expect(missAtFlatPosition).toBeNull();
  });

  it('hits the quad at its flat position when morph is 1', () => {
    const mesh = createMorphQuad();
    const resolve = createCellPlanetMorphRaycastFocus({
      morph: () => 1,
      surfaceRevision: () => 0,
    });

    const hitAtFlatPosition = resolve(
      createContext(new Vector3(10, 0, 5), new Vector3(0, 0, -1), [mesh]),
    );
    expect(hitAtFlatPosition).not.toBeNull();
    expect((hitAtFlatPosition as Vector3).x).toBeCloseTo(10, 3);

    const missAtOrigin = resolve(createContext(new Vector3(0, 0, 5), new Vector3(0, 0, -1), [mesh]));
    expect(missAtOrigin).toBeNull();
  });

  it('hits the quad at its blended position mid-morph', () => {
    const mesh = createMorphQuad();
    const resolve = createCellPlanetMorphRaycastFocus({
      morph: () => 0.5,
      surfaceRevision: () => 0,
    });

    const hit = resolve(createContext(new Vector3(5, 0, 5), new Vector3(0, 0, -1), [mesh]));
    expect(hit).not.toBeNull();
    expect((hit as Vector3).x).toBeCloseTo(5, 3);
  });

  it('never falls back to a stale hit when nothing morphed is hit', () => {
    const mesh = createMorphQuad();
    const resolve = createCellPlanetMorphRaycastFocus({
      morph: () => 0.5,
      surfaceRevision: () => 0,
    });

    const miss = resolve(
      createContext(new Vector3(50, 50, 5), new Vector3(0, 0, -1), [mesh]),
    );
    expect(miss).toBeNull();
  });

  it('skips deleted batch IDs when the live IDs are no longer contiguous', () => {
    const geometry = new BufferGeometry();
    const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSpherePos', new BufferAttribute(positions.slice(), 3));
    geometry.setAttribute('aFlatPos', new BufferAttribute(positions.slice(), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const mesh = new BatchedMesh(3, 12, 18, new MeshBasicMaterial());
    const geometryId = mesh.addGeometry(geometry);
    const instanceIds = [0, 1, 2].map(() => mesh.addInstance(geometryId));
    for (const instanceId of instanceIds) {
      registerTerrainBatchInstance(mesh, instanceId);
      mesh.setVisibleAt(instanceId, true);
    }
    unregisterTerrainBatchInstance(mesh, instanceIds[1]);
    mesh.deleteInstance(instanceIds[1]);

    const resolve = createCellPlanetMorphRaycastFocus({
      morph: () => 0.5,
      surfaceRevision: () => 0,
    });
    expect(() =>
      resolve(createContext(new Vector3(0, 0, 5), new Vector3(0, 0, -1), [mesh])),
    ).not.toThrow();
  });
});
