import { BoxGeometry, Mesh, MeshBasicMaterial, type Intersection, type Object3D } from 'three';

import {
  getScatterInstanceIdAt,
  pickScatterInstanceId,
} from './scatter-instance-picking';
import { buildScatterInstancedMesh } from './scatter-instanced-mesh';
import type { ITerrainScatterInstance } from '../terrain/scatter-terrain-instances';

function instance(id: string, x: number): ITerrainScatterInstance {
  return {
    instanceId: id,
    worldPositionM: [x, 0, 0],
    normal: [0, 1, 0],
    surfaceUp: [0, 1, 0],
    rotationSeed01: 0,
    scaleSeed01: 0.5,
    embedSeed01: 0,
  };
}

function intersectionAt(object: Object3D, instanceId?: number): Intersection<Object3D> {
  return {
    object,
    instanceId,
    distance: 1,
    point: object.position.clone(),
  } as Intersection<Object3D>;
}

describe('scatter instance picking', () => {
  const mesh = buildScatterInstancedMesh({
    instances: [instance('tree-a', 0), instance('tree-b', 5), instance('tree-c', 10)],
    geometry: new BoxGeometry(1, 1, 1),
    material: new MeshBasicMaterial(),
    rules: { alignment: 'align-to-normal' },
    scale: { min: 1, max: 1 },
    anchorWorldM: [0, 0, 0],
  });

  it('resolves a build-order index back to the stable instanceId', () => {
    expect(getScatterInstanceIdAt(mesh, 0)).toBe('tree-a');
    expect(getScatterInstanceIdAt(mesh, 1)).toBe('tree-b');
    expect(getScatterInstanceIdAt(mesh, 2)).toBe('tree-c');
  });

  it('returns undefined for an out-of-range index', () => {
    expect(getScatterInstanceIdAt(mesh, 99)).toBeUndefined();
  });

  it('resolves a raycaster intersection on a scatter InstancedMesh', () => {
    expect(pickScatterInstanceId(intersectionAt(mesh, 1))).toBe('tree-b');
  });

  it('returns undefined when the intersection has no instanceId', () => {
    expect(pickScatterInstanceId(intersectionAt(mesh, undefined))).toBeUndefined();
  });

  it('returns undefined when the intersection object is not an InstancedMesh', () => {
    const plainMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    expect(pickScatterInstanceId(intersectionAt(plainMesh, 0))).toBeUndefined();
  });
});
