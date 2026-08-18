import { createSurfaceSampler } from '../surfaces/surface-query';
import {
  FAR_MOON,
  HOME_MOON,
  HOME_PLANET,
  STATIONARY_TEST_MOON,
  STOCK_BODIES,
  SUN,
} from './stock-bodies';
import {
  WORLD_SIZE_TIER_RADIUS_M,
  WORLD_SIZE_TIERS,
  createStockBodiesForTier,
} from './world-size-presets';

describe('WORLD_SIZE_TIERS', () => {
  it('is ordered smallest to largest and pins medium to HOME_PLANET', () => {
    const radii = WORLD_SIZE_TIERS.map((tier) => tier.radiusM);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(WORLD_SIZE_TIER_RADIUS_M.medium).toBe(HOME_PLANET.radiusM);
  });

  it('excludes only mini from the selectable picker options', () => {
    const unselectable = WORLD_SIZE_TIERS.filter((tier) => !tier.selectable);
    expect(unselectable.map((tier) => tier.id)).toEqual(['mini']);
  });

  it('places extra-small between mini and small', () => {
    const ids = WORLD_SIZE_TIERS.map((tier) => tier.id);
    expect(ids).toEqual([
      'mini',
      'extra-small',
      'small',
      'medium',
      'large',
      'extra-large',
    ]);
    expect(WORLD_SIZE_TIER_RADIUS_M['extra-small']).toBeCloseTo(63_710, 6);
  });
});

describe('createStockBodiesForTier', () => {
  it('returns the exact stock bodies for medium', () => {
    expect(createStockBodiesForTier('medium')).toEqual([
      SUN,
      HOME_PLANET,
      HOME_MOON,
      FAR_MOON,
      STATIONARY_TEST_MOON,
    ]);
  });

  it('holds every body surface gravity constant across every tier', () => {
    const sunGravity = SUN.muM3PerS2 / (SUN.radiusM * SUN.radiusM);
    const planetGravity =
      HOME_PLANET.muM3PerS2 / (HOME_PLANET.radiusM * HOME_PLANET.radiusM);
    const moonGravity =
      HOME_MOON.muM3PerS2 / (HOME_MOON.radiusM * HOME_MOON.radiusM);
    const farMoonGravity =
      FAR_MOON.muM3PerS2 / (FAR_MOON.radiusM * FAR_MOON.radiusM);
    const stationaryMoonGravity =
      STATIONARY_TEST_MOON.muM3PerS2 /
      (STATIONARY_TEST_MOON.radiusM * STATIONARY_TEST_MOON.radiusM);

    for (const tier of WORLD_SIZE_TIERS) {
      const [sun, planet, moon, farMoon, stationaryMoon] =
        createStockBodiesForTier(tier.id);
      expect(sun.muM3PerS2 / (sun.radiusM * sun.radiusM)).toBeCloseTo(
        sunGravity,
        6,
      );
      expect(planet.muM3PerS2 / (planet.radiusM * planet.radiusM)).toBeCloseTo(
        planetGravity,
        6,
      );
      expect(moon.muM3PerS2 / (moon.radiusM * moon.radiusM)).toBeCloseTo(
        moonGravity,
        6,
      );
      expect(
        farMoon.muM3PerS2 / (farMoon.radiusM * farMoon.radiusM),
      ).toBeCloseTo(farMoonGravity, 6);
      expect(
        stationaryMoon.muM3PerS2 /
          (stationaryMoon.radiusM * stationaryMoon.radiusM),
      ).toBeCloseTo(stationaryMoonGravity, 6);
    }
  });

  it('scales the planet radius to the tier anchor', () => {
    const [, mini] = createStockBodiesForTier('mini');
    expect(mini.radiusM).toBeCloseTo(WORLD_SIZE_TIER_RADIUS_M.mini, 6);

    const [, extraLarge] = createStockBodiesForTier('extra-large');
    expect(extraLarge.radiusM).toBeCloseTo(
      WORLD_SIZE_TIER_RADIUS_M['extra-large'],
      6,
    );
  });

  it('scales the moon orbit distance by the same factor as the planet radius', () => {
    const scale = WORLD_SIZE_TIER_RADIUS_M.large / HOME_PLANET.radiusM;
    const [, , moon] = createStockBodiesForTier('large');
    expect(moon.orbit?.semiMajorAxisM).toBeCloseTo(
      HOME_MOON.orbit!.semiMajorAxisM * scale,
      3,
    );
  });

  it('scales ring radii by the same factor as the planet radius', () => {
    const scale = WORLD_SIZE_TIER_RADIUS_M.large / HOME_PLANET.radiusM;
    const [, planet] = createStockBodiesForTier('large');
    expect(planet.ringSystems![0].innerRadiusM).toBeCloseTo(
      HOME_PLANET.ringSystems![0].innerRadiusM * scale,
      3,
    );
    expect(planet.ringSystems![0].outerRadiusM).toBeCloseTo(
      HOME_PLANET.ringSystems![0].outerRadiusM * scale,
      3,
    );
  });

  it('keeps terrain relief absolute while preserving physical feature wavelengths', () => {
    for (const tier of WORLD_SIZE_TIERS) {
      const [, planet] = createStockBodiesForTier(tier.id);
      expect(planet.terrain!.maxElevationM).toBe(
        HOME_PLANET.terrain!.maxElevationM,
      );
      expect(planet.terrain!.minElevationM).toBe(
        HOME_PLANET.terrain!.minElevationM,
      );
      const sourceGenerator = HOME_PLANET.terrain!.generators[0];
      const generatedGenerator = planet.terrain!.generators[0];
      if (
        sourceGenerator.kind === 'fractal-noise-3d' &&
        generatedGenerator.kind === 'fractal-noise-3d'
      ) {
        expect(generatedGenerator.frequency).toBeCloseTo(
          sourceGenerator.frequency * (HOME_PLANET.radiusM / planet.radiusM),
          8,
        );
      }
    }
  });

  it('still samples a finite, bounded surface on every tier', () => {
    for (const tier of WORLD_SIZE_TIERS) {
      const [, planet, moon, farMoon] = createStockBodiesForTier(tier.id);

      const planetSampler = createSurfaceSampler(planet);
      const planetElevationM = planetSampler.sample([1, 0.3, -0.4]).elevationM;
      expect(Number.isFinite(planetElevationM)).toBeTrue();
      expect(planetElevationM).toBeGreaterThanOrEqual(
        planetSampler.minElevationM,
      );
      expect(planetElevationM).toBeLessThanOrEqual(planetSampler.maxElevationM);

      const moonSampler = createSurfaceSampler(moon);
      const moonElevationM = moonSampler.sample([1, 0.3, -0.4]).elevationM;
      expect(Number.isFinite(moonElevationM)).toBeTrue();
      expect(moonElevationM).toBeGreaterThanOrEqual(moonSampler.minElevationM);
      expect(moonElevationM).toBeLessThanOrEqual(moonSampler.maxElevationM);

      const farMoonSampler = createSurfaceSampler(farMoon);
      const farMoonElevationM = farMoonSampler.sample([
        1, 0.3, -0.4,
      ]).elevationM;
      expect(Number.isFinite(farMoonElevationM)).toBeTrue();
      expect(farMoonElevationM).toBeGreaterThanOrEqual(
        farMoonSampler.minElevationM,
      );
      expect(farMoonElevationM).toBeLessThanOrEqual(
        farMoonSampler.maxElevationM,
      );
    }
  });

  it('scales atmosphere height but not sea-level density', () => {
    const scale = WORLD_SIZE_TIER_RADIUS_M.small / HOME_PLANET.radiusM;
    const [, planet] = createStockBodiesForTier('small');
    expect(planet.atmosphere!.scaleHeightM).toBeCloseTo(
      HOME_PLANET.atmosphere!.scaleHeightM * scale,
      3,
    );
    expect(planet.atmosphere!.seaLevelDensityKgM3).toBe(
      HOME_PLANET.atmosphere!.seaLevelDensityKgM3,
    );
  });
});
