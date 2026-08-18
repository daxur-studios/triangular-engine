import type { IGroundCoverArchetype } from './ground-cover-archetype';
import { buildGroundCoverClumpMesh } from './ground-cover-clump-mesh';

function makeArchetype(overrides: Partial<IGroundCoverArchetype> = {}): IGroundCoverArchetype {
  return {
    schemaVersion: 1,
    id: 'grass-01',
    blade: { heightM: [0.2, 0.4], widthM: [0.02, 0.03], curveRad: [0.1, 0.4] },
    clump: { bladeCount: [5, 8], radiusM: [0.05, 0.1] },
    ...overrides,
  };
}

describe('buildGroundCoverClumpMesh', () => {
  it('is deterministic for an identical seed', () => {
    const archetype = makeArchetype();
    const a = buildGroundCoverClumpMesh(archetype, 11);
    const b = buildGroundCoverClumpMesh(archetype, 11);
    expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(
      Array.from(b.geometry.getAttribute('position').array),
    );
  });

  it('produces no NaN or infinite values in position/normal/height01', () => {
    const archetype = makeArchetype();
    const { geometry } = buildGroundCoverClumpMesh(archetype, 3);
    for (const attrName of ['position', 'normal', 'height01']) {
      const attr = geometry.getAttribute(attrName);
      for (let i = 0; i < attr.array.length; i++) {
        expect(Number.isFinite(attr.array[i])).toBe(true);
      }
    }
  });

  it('height01 is 0 at the base and 1 at the tip', () => {
    const archetype = makeArchetype();
    const { geometry } = buildGroundCoverClumpMesh(archetype, 3);
    const height01 = geometry.getAttribute('height01').array;
    expect(Math.min(...Array.from(height01))).toBe(0);
    expect(Math.max(...Array.from(height01))).toBe(1);
  });

  it('local Y stays within the blade height bounds', () => {
    const archetype = makeArchetype({ blade: { heightM: [0.2, 0.2], widthM: [0.02, 0.03], curveRad: [0, 0] } });
    const { geometry } = buildGroundCoverClumpMesh(archetype, 5);
    const positions = geometry.getAttribute('position').array;
    for (let i = 1; i < positions.length; i += 3) {
      expect(positions[i]).toBeGreaterThanOrEqual(-1e-6);
      expect(positions[i]).toBeLessThanOrEqual(0.2 + 1e-6);
    }
  });

  it('throws when the triangle budget is exceeded', () => {
    const archetype = makeArchetype({ clump: { bladeCount: [5000, 5000], radiusM: [0.05, 0.1] } });
    expect(() => buildGroundCoverClumpMesh(archetype, 1)).toThrow();
  });

  it('headMix01 is all zero when the archetype has no head', () => {
    const archetype = makeArchetype();
    const { geometry } = buildGroundCoverClumpMesh(archetype, 3);
    const headMix01 = Array.from(geometry.getAttribute('headMix01').array);
    expect(headMix01.every((v) => v === 0)).toBe(true);
  });

  it('adds head-bloom vertices (headMix01=1) beyond the blade tip when the archetype has a head', () => {
    const archetype = makeArchetype({ head: { radiusM: [0.05, 0.05] } });
    const { geometry } = buildGroundCoverClumpMesh(archetype, 3);
    const headMix01 = Array.from(geometry.getAttribute('headMix01').array);
    expect(headMix01.some((v) => v === 1)).toBe(true);
    expect(headMix01.some((v) => v === 0)).toBe(true);

    const positions = geometry.getAttribute('position').array;
    let maxHeadY = -Infinity;
    for (let i = 0; i < headMix01.length; i++) {
      if (headMix01[i] === 1) maxHeadY = Math.max(maxHeadY, positions[i * 3 + 1]);
    }
    // Head quads are centered a radius above the blade tip (0.4 max heightM here), so their top edge sits well past it.
    expect(maxHeadY).toBeGreaterThan(0.4);
  });
});
