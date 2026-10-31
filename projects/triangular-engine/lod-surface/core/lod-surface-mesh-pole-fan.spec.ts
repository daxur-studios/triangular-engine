import type { BufferAttribute } from 'three';
import { createHeightSource } from './lod-height';
import { LEAF_STRIDE } from './lod-leaf-pack';
import { FAN_DOMAIN, cornerLeavesOf, fakeSelector } from './lod-morph-fan.testing';
import { CAP_SLACK } from './lod-selector';
import { createLodSurfaceMesh, type LodSurfaceMesh } from './lod-surface-mesh';

/** Plan 059, step G6d: the surface mesh's `poleFan` option (the pole leaves leave the instances above morph 0 and are drawn as a fan; nothing is rebuilt with the camera or the morph). */

const CAPACITY = 256 + CAP_SLACK + 6;
const CAMERA_A: [number, number, number] = [0, 0, 6_371_020];
const CAMERA_B: [number, number, number] = [0, 0, 6_371_500];

/** Morph settings at a projection centre (degrees). */
const at = (morph: number, lonDeg = 0, latDeg = 0) => ({ morph, projection: 'equal-earth' as const, projectionCentre: { lonDeg, latDeg } });

function build(poleFan: boolean): LodSurfaceMesh {
  return createLodSurfaceMesh({
    domain: FAN_DOMAIN, patchCells: 16, source: createHeightSource('flat', 'sphere'), capacity: CAPACITY, morph: true, ...(poleFan ? { poleFan } : {}),
  });
}

const instanceCount = (mesh: LodSurfaceMesh): number => (mesh.mesh.geometry as unknown as { instanceCount: number }).instanceCount;
const leafData = (mesh: LodSurfaceMesh): Float32Array => (mesh.mesh.geometry.getAttribute('aLeaf') as BufferAttribute).array as Float32Array;

describe('createLodSurfaceMesh poleFan option (Plan 059 G6d)', () => {
  it('needs the morph option', () => {
    expect(() => createLodSurfaceMesh({
      domain: FAN_DOMAIN, patchCells: 16, source: createHeightSource('flat', 'sphere'), capacity: CAPACITY, poleFan: true,
    })).toThrowError(/poleFan/);
  });

  it('at morph 0 the pack is the same as without the option, and no fan is built', () => {
    const plain = build(false);
    const fan = build(true);
    plain.setMorph(at(0));
    fan.setMorph(at(0));
    const selector = fakeSelector(cornerLeavesOf(3));
    expect(fan.upload(selector, CAMERA_A)).toBe(plain.upload(selector, CAMERA_A));
    const n = instanceCount(plain) * LEAF_STRIDE;
    expect(Array.from(leafData(fan).slice(0, n))).toEqual(Array.from(leafData(plain).slice(0, n)));
    expect(fan.poleFanStats).toBeUndefined();
    expect(fan.morphFrame).toBeUndefined();
    plain.dispose();
    fan.dispose();
  });

  it('above morph 0 the pole leaves leave the instances and the fan draws them', () => {
    const plain = build(false);
    const fan = build(true);
    plain.setMorph(at(0.5));
    fan.setMorph(at(0.5));
    const selector = fakeSelector(cornerLeavesOf(3));
    plain.upload(selector, CAMERA_A);
    fan.upload(selector, CAMERA_A);
    expect(instanceCount(fan)).toBeLessThan(instanceCount(plain));
    const stats = fan.poleFanStats;
    expect(stats).toBeDefined();
    expect(stats!.leaves).toBe(4);
    expect(stats!.corner).toBe(4);
    expect(stats!.triangles).toBeGreaterThan(0);
    expect(stats!.rebuilds).toBe(1);
    expect(fan.poleFanMesh).toBeDefined();
    plain.dispose();
    fan.dispose();
  });

  it('rebuilds the fan with the projection centre and the ray count, and never with the camera or the morph', () => {
    const fan = build(true);
    const selector = fakeSelector(cornerLeavesOf(3));
    fan.setMorph(at(0.5));
    fan.upload(selector, CAMERA_A);
    expect(fan.poleFanStats!.rebuilds).toBe(1);
    fan.upload(selector, CAMERA_B);
    fan.setMorph(at(0.8));
    fan.upload(selector, CAMERA_B);
    fan.upload(selector, CAMERA_A);
    expect(fan.poleFanStats!.rebuilds).toBe(1);
    fan.setPoleFanRays(512);
    fan.upload(selector, CAMERA_A);
    expect(fan.poleFanStats!.rebuilds).toBe(2);
    expect(fan.poleFanStats!.rays).toBe(512);
    fan.setMorph(at(0.8, 20, 35));
    fan.upload(selector, CAMERA_A);
    expect(fan.poleFanStats!.rebuilds).toBe(3);
    fan.dispose();
  });

  it('refuses fewer than three rays', () => {
    const fan = build(true);
    expect(() => fan.setPoleFanRays(2)).toThrowError(/at least 3 rays/);
    fan.dispose();
  });
});
