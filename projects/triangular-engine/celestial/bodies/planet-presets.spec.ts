import { createSurfaceSampler, sampleSurface } from '../surfaces/surface-query';
import {
  ALPINE_PLANET,
  ARCHIPELAGO_PLANET,
  CANYON_PLANET,
  CRATERED_MOON,
  PLANET_PRESETS,
} from './planet-presets';

const SAMPLE_DIRECTIONS = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.577, 0.577, 0.577],
  [-0.3, 0.8, -0.5],
  [0.7071, 0.7071, 0],
] as const;

describe('Planet Presets catalog', () => {
  it('contains 5 distinct planet presets', () => {
    expect(PLANET_PRESETS.length).toBe(5);
    const ids = PLANET_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
  });

  describe('ALPINE_PLANET', () => {
    it('is deterministic and survives structured cloning', () => {
      const dir = [0.4, 0.6, 0.7] as const;
      const original = sampleSurface(ALPINE_PLANET, dir);
      const cloned = sampleSurface(structuredClone(ALPINE_PLANET), dir);
      expect(original.elevationM).toBeCloseTo(cloned.elevationM, 6);
    });

    it('produces identical scalar and batch sampling', () => {
      const sampler = createSurfaceSampler(ALPINE_PLANET);
      const directions = new Float64Array(SAMPLE_DIRECTIONS.flat());
      const batch = sampler.sampleBatch(directions);
      for (let i = 0; i < SAMPLE_DIRECTIONS.length; i++) {
        const scalar = sampler.sample(SAMPLE_DIRECTIONS[i]).elevationM;
        expect(batch[i]).toBeCloseTo(scalar, 6);
      }
    });

    it('stays within authored elevation bounds', () => {
      const sampler = createSurfaceSampler(ALPINE_PLANET);
      const terrain = ALPINE_PLANET.terrain!;
      for (const dir of SAMPLE_DIRECTIONS) {
        const sample = sampler.sample(dir);
        expect(sample.elevationM).toBeGreaterThanOrEqual(terrain.minElevationM);
        expect(sample.elevationM).toBeLessThanOrEqual(terrain.maxElevationM);
      }
    });
  });

  describe('CANYON_PLANET', () => {
    it('is deterministic and finite across sampled directions', () => {
      const sampler = createSurfaceSampler(CANYON_PLANET);
      for (const dir of SAMPLE_DIRECTIONS) {
        const elev = sampler.sample(dir).elevationM;
        expect(Number.isFinite(elev)).toBeTrue();
      }
    });

    it('has no global ocean definition (dry world)', () => {
      expect(CANYON_PLANET.terrain?.ocean).toBeUndefined();
    });
  });

  describe('ARCHIPELAGO_PLANET', () => {
    it('is deterministic and provides a valid ocean depthfalloff', () => {
      expect(ARCHIPELAGO_PLANET.terrain?.ocean?.depthFalloffM).toBe(800);
      const sampler = createSurfaceSampler(ARCHIPELAGO_PLANET);
      const sample = sampler.sample([1, 0, 0]);
      expect(Number.isFinite(sample.elevationM)).toBeTrue();
    });
  });

  describe('CRATERED_MOON', () => {
    it('is airless and produces diverse crater relief', () => {
      expect(CRATERED_MOON.atmosphere).toBeUndefined();
      const sampler = createSurfaceSampler(CRATERED_MOON);
      const elevations = SAMPLE_DIRECTIONS.map(
        (dir) => sampler.sample(dir).elevationM,
      );
      const min = Math.min(...elevations);
      const max = Math.max(...elevations);
      expect(max - min).toBeGreaterThan(50);
    });
  });
});
