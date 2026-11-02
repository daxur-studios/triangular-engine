import { detailBoundM, withDetailNoise } from './lod-detail-noise';
import { bakeDetailProfile, uniformDetailProfile, type DetailProfile } from './lod-detail-profile';
import type { LodDomain, Vec3 } from './lod-domain';
import { createHeightSource } from './lod-height';
import { LodTerrainBody } from './lod-terrain-body';

const sphere: LodDomain = { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' };
const flat = createHeightSource('flat', 'sphere');

const DIRECTIONS: Vec3[] = [[1, 0.2, 0.1], [-0.3, 1, 0.4], [0.2, -0.5, 1], [-1, 0.7, -0.2], [0.4, -1, -0.6], [0.1, 0.3, -1], [0.7, 0.7, 0.1], [-0.6, -0.4, 0.5]];
const onSurface = (d: Vec3): Vec3 => {
  const n = Math.hypot(d[0], d[1], d[2]);
  return [(d[0] / n) * sphere.sizeM, (d[1] / n) * sphere.sizeM, (d[2] / n) * sphere.sizeM];
};

/** Strong on the +x half, none on the other. */
const halfProfile: DetailProfile = { id: 'half', maxWeight: 2, k: 4, weightAt: (x) => (x > 0 ? 2 : 0) };

describe('detail profile', () => {
  it('a uniform weight of 1 leaves the noise as it is', () => {
    const plain = withDetailNoise(flat, { domain: sphere, cells: 1024, share: 0.1 });
    const field = bakeDetailProfile(sphere, uniformDetailProfile(1));
    const weighted = withDetailNoise(flat, { domain: sphere, cells: 1024, share: 0.1, weights: field.weights });
    for (const d of DIRECTIONS) {
      const p = onSurface(d);
      expect(weighted.heightAt(...p)).toBeCloseTo(plain.heightAt(...p), 9);
    }
    field.source.dispose();
  });

  it('scales the amplitude by the weight, and weight 0 is flat', () => {
    const field = bakeDetailProfile(sphere, halfProfile);
    const plain = withDetailNoise(flat, { domain: sphere, cells: 1024, share: 0.1 });
    const weighted = withDetailNoise(flat, { domain: sphere, cells: 1024, share: 0.1, weights: field.weights });
    let strong = 0;
    for (const d of DIRECTIONS) {
      const p = onSurface(d);
      // Stay clear of the border, where the bilinear ramp is between the two weights.
      if (Math.abs(p[0]) < 3000) continue;
      const h = weighted.heightAt(...p);
      if (p[0] > 0) {
        expect(h).toBeCloseTo(2 * plain.heightAt(...p), 9);
        strong++;
      } else {
        expect(h).toBe(0);
      }
    }
    expect(strong).toBeGreaterThan(0);
    field.source.dispose();
  });

  it('bounds the offset by the largest weight', () => {
    const field = bakeDetailProfile(sphere, halfProfile);
    const options = { domain: sphere, cells: 1024, share: 0.1 };
    expect(detailBoundM({ ...options, weights: field.weights })).toBeCloseTo(2 * detailBoundM(options), 9);
    const weighted = withDetailNoise(flat, { ...options, weights: field.weights });
    expect(weighted.boundM).toBeCloseTo(detailBoundM({ ...options, weights: field.weights }), 9);
    field.source.dispose();
  });

  it('clamps weights above the declared maximum', () => {
    const field = bakeDetailProfile(sphere, { id: 'over', maxWeight: 1, k: 4, weightAt: () => 5 });
    expect(field.weights.weightAt(...onSurface([1, 0.2, 0.1]))).toBe(1);
    field.source.dispose();
  });

  it('the terrain body uses it for ground queries and rebakes only for a new profile', () => {
    const settings = (detailProfile?: DetailProfile) => ({
      domain: sphere, heights: flat, detailNoise: 0.1, leafCap: 256, cellPixels: 4, patchCells: 16 as const, hysteresis: 0.15, cull: true,
      ...(detailProfile ? { detailProfile } : {}),
    });
    const body = new LodTerrainBody(settings(halfProfile));
    const west = onSurface([-1, 0.7, -0.2]);
    expect(body.groundAt(west).heightM).toBe(0);
    const east = onSurface([1, 0.2, 0.1]);
    expect(body.groundAt(east).heightM).not.toBe(0);
    const mesh = body.surface;
    body.configure(settings(halfProfile));
    expect(body.surface).toBe(mesh);
    body.configure(settings({ ...halfProfile, id: 'half-2' }));
    expect(body.surface).not.toBe(mesh);
    body.dispose();
  });
});
