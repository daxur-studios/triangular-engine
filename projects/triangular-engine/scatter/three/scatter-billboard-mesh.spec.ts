import { InstancedMesh, MeshBasicMaterial, PlaneGeometry } from 'three';

import {
  buildScatterBillboardInstancedMesh,
  SCATTER_BILLBOARD_ORIGIN_ATTRIBUTE,
  SCATTER_BILLBOARD_SCALE_ATTRIBUTE,
  SCATTER_BILLBOARD_SURFACE_UP_ATTRIBUTE,
} from './scatter-billboard-mesh';
import { SCATTER_DITHER_ALPHA_ATTRIBUTE } from './scatter-instanced-mesh';
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

describe('buildScatterBillboardInstancedMesh', () => {
  it('builds an InstancedMesh with identity instanceMatrix and per-instance origin/scale/up attributes', () => {
    const instances = [instance('a', 0), instance('b', 5)];
    const mesh = buildScatterBillboardInstancedMesh({
      instances,
      geometry: new PlaneGeometry(1, 1),
      material: new MeshBasicMaterial(),
      scale: { min: 2, max: 2 },
      anchorWorldM: [0, 0, 0],
    });

    expect(mesh).toBeInstanceOf(InstancedMesh);
    expect(mesh.count).toBe(2);

    const origin = mesh.geometry.getAttribute(SCATTER_BILLBOARD_ORIGIN_ATTRIBUTE);
    expect(origin.getX(1)).toBeCloseTo(5, 6);

    const scale = mesh.geometry.getAttribute(SCATTER_BILLBOARD_SCALE_ATTRIBUTE);
    expect(scale.getX(0)).toBeCloseTo(2, 6);

    const up = mesh.geometry.getAttribute(SCATTER_BILLBOARD_SURFACE_UP_ATTRIBUTE);
    expect(up.getY(0)).toBeCloseTo(1, 6);
  });

  it('offsets instanceOriginM by the supplied anchor', () => {
    const mesh = buildScatterBillboardInstancedMesh({
      instances: [instance('a', 10)],
      geometry: new PlaneGeometry(1, 1),
      material: new MeshBasicMaterial(),
      scale: { min: 1, max: 1 },
      anchorWorldM: [10, 0, 0],
    });
    const origin = mesh.geometry.getAttribute(SCATTER_BILLBOARD_ORIGIN_ATTRIBUTE);
    expect(origin.getX(0)).toBeCloseTo(0, 6);
  });

  it('skips the dither attribute entirely when alpha01ByInstanceId is omitted', () => {
    const mesh = buildScatterBillboardInstancedMesh({
      instances: [instance('a', 0)],
      geometry: new PlaneGeometry(1, 1),
      material: new MeshBasicMaterial(),
      scale: { min: 1, max: 1 },
      anchorWorldM: [0, 0, 0],
    });
    expect(mesh.geometry.getAttribute(SCATTER_DITHER_ALPHA_ATTRIBUTE)).toBeUndefined();
  });

  it('writes per-instance dither alpha, defaulting absent instances to 1', () => {
    const mesh = buildScatterBillboardInstancedMesh({
      instances: [instance('a', 0), instance('b', 5)],
      geometry: new PlaneGeometry(1, 1),
      material: new MeshBasicMaterial(),
      scale: { min: 1, max: 1 },
      anchorWorldM: [0, 0, 0],
      alpha01ByInstanceId: new Map([['a', 0.4]]),
    });
    const attribute = mesh.geometry.getAttribute(SCATTER_DITHER_ALPHA_ATTRIBUTE);
    expect(attribute.getX(0)).toBeCloseTo(0.4, 6);
    expect(attribute.getX(1)).toBeCloseTo(1, 6);
  });
});
