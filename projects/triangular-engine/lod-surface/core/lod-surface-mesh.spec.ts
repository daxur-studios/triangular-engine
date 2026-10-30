import type { BufferAttribute } from 'three';
import type { LodDomain } from './lod-domain';
import { createHeightSource } from './lod-height';
import { LEAF_STRIDE } from './lod-leaf-pack';
import { latticeSteps } from './lod-lattice';
import { createMorphMap, unbendPosition, type MorphUniformsLike } from './lod-morph-frame';
import { instanceCapacity } from './lod-morph-leaves';
import { sceneCameraAt } from './lod-morph.testing';
import { CAP_SLACK, LodSelector, maxLevelFor } from './lod-selector';
import { createLodSurfaceMesh, type LodSurfaceMesh } from './lod-surface-mesh';

/** Plan 059, step G6b: the surface mesh's morph mode (instance capacity, the setMorph state, the pack above morph 0, the unbend). */

const SPHERE: LodDomain = { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' };
const PLANE: LodDomain = { kind: 'plane', sizeM: 10_000, warp: 'none' };
const CAPACITY = 256 + CAP_SLACK + 6;
const STEPS = latticeSteps(16, maxLevelFor(16));

function build(morph: boolean, domain: LodDomain = SPHERE): LodSurfaceMesh {
  return createLodSurfaceMesh({ domain, patchCells: 16, source: createHeightSource('flat', domain.kind), capacity: CAPACITY, ...(morph ? { morph } : {}) });
}

function selectorAt(camera: [number, number, number]): LodSelector {
  const selector = new LodSelector({
    domain: SPHERE, patchCells: 16, mode: 'distance', fixedLevel: 5, cellPixels: 4, leafCap: 256, heightBoundM: 0, cull: false, hysteresis: 0.15,
  });
  selector.select({ camera, pixelAngle: (2 * Math.tan(Math.PI / 6)) / 1000, frustum: new Float64Array(12) });
  return selector;
}

const instanceCount = (mesh: LodSurfaceMesh): number => (mesh.mesh.geometry as unknown as { instanceCount: number }).instanceCount;
const attribute = (mesh: LodSurfaceMesh, name: string): BufferAttribute => mesh.mesh.geometry.getAttribute(name) as BufferAttribute;

describe('createLodSurfaceMesh morph option', () => {
  it('doubles the instance capacity (a leaf at the cut is drawn twice) and adds a mask; without it nothing changes', () => {
    const plain = build(false);
    const morph = build(true);
    expect(attribute(plain, 'aLeaf').count).toBe(CAPACITY);
    expect(attribute(morph, 'aLeaf').count).toBe(instanceCapacity(CAPACITY));
    expect(attribute(morph, 'aInfo').count).toBe(instanceCapacity(CAPACITY));
    expect((plain.material as unknown as { maskNode: unknown }).maskNode ?? null).toBeNull();
    expect((morph.material as unknown as { maskNode: unknown }).maskNode ?? null).not.toBeNull();
    expect((morph.probeMaterial as unknown as { maskNode: unknown }).maskNode ?? null).not.toBeNull();
    expect(plain.nodes.bentUp).toBeUndefined();
    expect(morph.nodes.bentUp).toBeDefined();
    plain.dispose();
    morph.dispose();
  });

  it('refuses a plane, and setMorph without the option', () => {
    expect(() => build(true, PLANE)).toThrowError(/sphere/);
    const plain = build(false);
    expect(() => plain.setMorph({ morph: 0.5, projection: 'equal-earth' })).toThrowError(/morph option/);
    expect(plain.morphState.morph).toBe(0);
    plain.dispose();
  });

  it('keeps the globe state until a morph is set, and reads the settings or the planet uniforms', () => {
    const mesh = build(true);
    expect(mesh.morphState.morph).toBe(0);
    expect(mesh.morphState.map).toBeUndefined();
    mesh.setMorph({ morph: 0.5, projection: 'equal-earth', projectionCentre: { lonDeg: 20, latDeg: 35 } });
    expect(mesh.morphState.morph).toBe(0.5);
    expect(mesh.morphState.map?.projection).toBe('equal-earth');
    expect(mesh.morphState.map?.radius).toBe(10_000);

    // <planet>'s morphUniforms are read again on every use: animating uMorph is all it takes.
    const v = (x: number, y: number, z: number) => ({ value: { x, y, z } });
    const uniforms: MorphUniformsLike = {
      uMorph: { value: 0.25 }, uProjForward: v(0, 0, 1), uProjUp: v(0, 1, 0), uProjRight: v(1, 0, 0), uProjMode: { value: 1 }, uProjectionType: { value: 0 },
    };
    mesh.setMorph(uniforms);
    expect(mesh.morphState.morph).toBe(0.25);
    expect(mesh.morphState.map?.projection).toBe('equirectangular');
    (uniforms.uMorph as { value: number }).value = 0.75;
    mesh.unbend([0, 0, 10_100]);
    expect(mesh.morphState.morph).toBe(0.75);
    mesh.setMorph(undefined);
    expect(mesh.morphState.morph).toBe(0);
    mesh.dispose();
  });

  it('unbend is the camera at morph 0 and the point under the bent camera above it', () => {
    const mesh = build(true);
    expect(mesh.unbend([1, 2, 3])).toEqual([1, 2, 3]);
    const settings = { morph: 0.6, projection: 'equal-earth' as const, projectionCentre: { lonDeg: 20, latDeg: 35 } };
    mesh.setMorph(settings);
    const map = createMorphMap(settings, 10_000);
    const bent = sceneCameraAt(map, 0.3, 0.4, 50);
    const unbent = mesh.unbend(bent);
    const expected = unbendPosition(map, bent).position;
    for (let k = 0; k < 3; k++) expect(unbent[k]).toBeCloseTo(expected[k], 9);
    expect(Math.hypot(unbent[0], unbent[1], unbent[2])).toBeCloseTo(10_050, 3);
    mesh.dispose();
  });

  it('at morph 0 the pack is the same as without the option', () => {
    const camera: [number, number, number] = [0, 0, 10_020];
    const plain = build(false);
    const morph = build(true);
    morph.setMorph({ morph: 0, projection: 'equal-earth' });
    const selector = selectorAt(camera);
    expect(morph.upload(selector, camera)).toBe(plain.upload(selector, camera));
    expect(morph.morphFrame).toBeUndefined();
    expect(morph.morphPack).toBeUndefined();
    const n = instanceCount(plain) * LEAF_STRIDE;
    expect(Array.from(attribute(morph, 'aLeaf').array.slice(0, n))).toEqual(Array.from(attribute(plain, 'aLeaf').array.slice(0, n)));
    plain.dispose();
    morph.dispose();
  });

  it('above morph 0 it packs a second instance for each leaf at the cut and exposes the frame and the pack', () => {
    const mesh = build(true);
    const settings = { morph: 0.5, projection: 'equal-earth' as const, projectionCentre: { lonDeg: 0, latDeg: 0 } };
    mesh.setMorph(settings);
    const map = createMorphMap(settings, 10_000);
    const bent = sceneCameraAt(map, 3.1, 0.3, 20);
    const selector = selectorAt(mesh.unbend(bent));
    const count = mesh.upload(selector, bent);
    expect(mesh.morphFrame).toBeDefined();
    expect(mesh.morphFrame?.map.morph).toBe(0.5);
    expect(mesh.morphPack).toBeDefined();
    expect(count).toBe(mesh.morphPack!.instances);
    expect(mesh.morphPack?.duplicates).toBeGreaterThan(0);
    expect(count).toBe(selector.stats.drawn + mesh.morphPack!.duplicates);
    expect(mesh.morphPack?.dropped).toBe(0);
    expect(instanceCount(mesh)).toBe(count);
    // The anchor is the lattice point of the unbent camera.
    const unbent = mesh.unbend(bent);
    expect(mesh.morphFrame?.selectorCamera[0]).toBeCloseTo(unbent[0], 6);
    expect(mesh.morphFrame?.anchor.t.some((x) => Math.abs(x) === STEPS)).toBeTrue();

    // Leaving the pole fan leaves out drops the pole leaves only.
    mesh.setSkipPoleLeaves(true);
    mesh.upload(selector, bent);
    expect(mesh.morphPack?.skipped).toBeDefined();
    mesh.dispose();
  });

  it('returns to the globe pack when the morph goes back to 0', () => {
    const mesh = build(true);
    const settings = { morph: 0.5, projection: 'equal-earth' as const };
    mesh.setMorph(settings);
    const map = createMorphMap(settings, 10_000);
    const bent = sceneCameraAt(map, 0.3, 0.2, 20);
    const selector = selectorAt(mesh.unbend(bent));
    mesh.upload(selector, bent);
    expect(mesh.morphPack).toBeDefined();
    mesh.setMorph({ morph: 0, projection: 'equal-earth' });
    expect(mesh.upload(selector, [0, 0, 10_020])).toBe(selector.stats.drawn);
    expect(mesh.morphPack).toBeUndefined();
    expect(mesh.morphFrame).toBeUndefined();
    mesh.dispose();
  });
});
