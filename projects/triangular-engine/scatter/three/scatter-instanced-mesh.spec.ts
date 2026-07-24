import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';

import {
  buildScatterInstancedMesh,
  SCATTER_DITHER_ALPHA_ATTRIBUTE,
} from './scatter-instanced-mesh';
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

describe('buildScatterInstancedMesh', () => {
  it('builds an InstancedMesh with one matrix per accepted instance', () => {
    const instances = [instance('a', 0), instance('b', 5), instance('c', 10)];
    const mesh = buildScatterInstancedMesh({
      instances,
      geometry: new BoxGeometry(1, 1, 1),
      material: new MeshBasicMaterial(),
      rules: { alignment: 'align-to-normal' },
      scale: { min: 1, max: 1 },
      anchorWorldM: [0, 0, 0],
    });

    expect(mesh).toBeInstanceOf(InstancedMesh);
    expect(mesh.count).toBe(3);

    const matrix = new Matrix4();
    const position = new Vector3();
    mesh.getMatrixAt(1, matrix);
    matrix.decompose(position, new Quaternion(), new Vector3());
    expect(position.x).toBeCloseTo(5, 6);
  });

  it('offsets every instance by the supplied anchor', () => {
    const mesh = buildScatterInstancedMesh({
      instances: [instance('a', 10)],
      geometry: new BoxGeometry(1, 1, 1),
      material: new MeshBasicMaterial(),
      rules: { alignment: 'align-to-normal' },
      scale: { min: 1, max: 1 },
      anchorWorldM: [10, 0, 0],
    });
    const matrix = new Matrix4();
    const position = new Vector3();
    mesh.getMatrixAt(0, matrix);
    matrix.decompose(position, new Quaternion(), new Vector3());
    expect(position.x).toBeCloseTo(0, 6);
  });

  it('skips the dither attribute entirely when alpha01ByInstanceId is omitted', () => {
    const mesh = buildScatterInstancedMesh({
      instances: [instance('a', 0)],
      geometry: new BoxGeometry(1, 1, 1),
      material: new MeshBasicMaterial(),
      rules: { alignment: 'align-to-normal' },
      scale: { min: 1, max: 1 },
      anchorWorldM: [0, 0, 0],
    });
    expect(mesh.geometry.getAttribute(SCATTER_DITHER_ALPHA_ATTRIBUTE)).toBeUndefined();
  });

  it('writes per-instance dither alpha, defaulting absent instances to 1', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const mesh = buildScatterInstancedMesh({
      instances: [instance('a', 0), instance('b', 5)],
      geometry,
      material: new MeshBasicMaterial(),
      rules: { alignment: 'align-to-normal' },
      scale: { min: 1, max: 1 },
      anchorWorldM: [0, 0, 0],
      alpha01ByInstanceId: new Map([['a', 0.3]]),
    });
    const attribute = mesh.geometry.getAttribute(SCATTER_DITHER_ALPHA_ATTRIBUTE);
    expect(attribute).toBeDefined();
    expect(attribute.getX(0)).toBeCloseTo(0.3, 6);
    expect(attribute.getX(1)).toBeCloseTo(1, 6);
  });
});
