import { createSurfaceSampler } from '../surfaces/surface-query';
import { launchSitePose } from '../frames/launch-site';
import {
  FAR_MOON,
  HOME_BASE_STATIC_FLATTEN_DEFS,
  HOME_BASE_COASTAL_ACCESS,
  HOME_MOON,
  HOME_PAD,
  HOME_PLANET,
  HOME_RUNWAY,
  STATIONARY_TEST_MOON,
  STOCK_BODIES,
  SUN,
} from './stock-bodies';

describe('SUN', () => {
  it('is a central star root body with no parentBodyId', () => {
    expect(SUN.kind).toBe('star');
    expect(SUN.parentBodyId).toBeUndefined();
    expect(SUN.radiusM).toBe(261_600_000);
  });
});

describe('HOME_MOON', () => {
  it('orbits HOME_PLANET', () => {
    expect(HOME_MOON.parentBodyId).toBe(HOME_PLANET.id);
  });

  it('is airless and carries visual terrain for surface texture baking', () => {
    expect(HOME_MOON.atmosphere).toBeUndefined();
    expect(HOME_MOON.terrain).toBeDefined();
  });

  it('samples finite, bounded cratered terrain', () => {
    const sampler = createSurfaceSampler(HOME_MOON);
    const elevationM = sampler.sample([1, 0.3, -0.4]).elevationM;
    expect(Number.isFinite(elevationM)).toBeTrue();
    expect(elevationM).toBeGreaterThanOrEqual(sampler.minElevationM);
    expect(elevationM).toBeLessThanOrEqual(sampler.maxElevationM);
  });

  it('has a surface gravity around 1.63 m/s^2', () => {
    const surfaceGravity =
      HOME_MOON.muM3PerS2 / (HOME_MOON.radiusM * HOME_MOON.radiusM);
    expect(surfaceGravity).toBeCloseTo(1.63, 6);
  });

  it('is on a circular equatorial orbit', () => {
    expect(HOME_MOON.orbit?.eccentricity).toBe(0);
    expect(HOME_MOON.orbit?.inclinationRad).toBe(0);
  });
});

describe('HOME_PLANET rings', () => {
  it('keeps the complete ring system outside the surface', () => {
    expect(HOME_PLANET.ringSystems).toBeDefined();
    const rings = HOME_PLANET.ringSystems![0];
    expect(rings.innerRadiusM).toBeGreaterThan(HOME_PLANET.radiusM);
    expect(rings.outerRadiusM).toBeGreaterThan(rings.innerRadiusM);
  });

  it('uses two thin ring planes tilted in opposite 20 degree directions', () => {
    const rings = HOME_PLANET.ringSystems!;
    expect(rings.length).toBe(2);
    expect(rings[0].inclinationRad).toBeCloseTo((20 * Math.PI) / 180);
    expect(rings[1].inclinationRad).toBeCloseTo((-20 * Math.PI) / 180);
    expect(rings[0].outerRadiusM).toBeLessThan(rings[1].innerRadiusM);
  });
});

describe('FAR_MOON', () => {
  it('orbits HOME_PLANET further out than HOME_MOON', () => {
    expect(FAR_MOON.parentBodyId).toBe(HOME_PLANET.id);
    expect(FAR_MOON.orbit!.semiMajorAxisM).toBeGreaterThan(
      HOME_MOON.orbit!.semiMajorAxisM,
    );
  });

  it('is smaller than HOME_MOON', () => {
    expect(FAR_MOON.radiusM).toBeLessThan(HOME_MOON.radiusM);
  });

  it('has flat-ice and curl-mountains biomes', () => {
    const biomeIds = FAR_MOON.terrain?.biomes?.map((b) => b.id);
    expect(biomeIds).toEqual(['flat-ice', 'curl-mountains']);
  });

  it('samples finite, bounded terrain', () => {
    const sampler = createSurfaceSampler(FAR_MOON);
    const elevationM = sampler.sample([1, 0.3, -0.4]).elevationM;
    expect(Number.isFinite(elevationM)).toBeTrue();
    expect(elevationM).toBeGreaterThanOrEqual(sampler.minElevationM);
    expect(elevationM).toBeLessThanOrEqual(sampler.maxElevationM);
  });
});

describe('STOCK_BODIES', () => {
  it('contains the stock system bodies', () => {
    expect(STOCK_BODIES).toEqual([
      SUN,
      HOME_PLANET,
      HOME_MOON,
      FAR_MOON,
      STATIONARY_TEST_MOON,
    ]);
  });

  it('has exactly one root body (no parentBodyId)', () => {
    const roots = STOCK_BODIES.filter((body) => !body.parentBodyId);
    expect(roots).toEqual([SUN]);
  });
});

describe('HOME_PAD', () => {
  it('still references HOME_PLANET (unaffected by adding the moon)', () => {
    expect(HOME_PAD.bodyId).toBe(HOME_PLANET.id);
  });

  it('has no static flatten baked in — the app seeds HOME_BASE_STATIC_FLATTEN_DEFS as ordinary base-builder grading instead', () => {
    expect(HOME_PLANET.terrain?.localFlatten).toBeUndefined();
  });

  it('HOME_BASE_STATIC_FLATTEN_DEFS sits on an exact plateau at the rounded pre-flatten terrain elevation', () => {
    const flatten = HOME_BASE_STATIC_FLATTEN_DEFS[0];
    expect(flatten).toBeDefined();

    const generatedElevationM = createSurfaceSampler(HOME_PLANET).sample(
      flatten.directionBodyFixed,
    ).elevationM;
    expect(flatten.elevationM).toBe(Math.round(generatedElevationM));

    const flattened = structuredClone(HOME_PLANET);
    flattened.terrain!.localFlatten = HOME_BASE_STATIC_FLATTEN_DEFS;
    expect(
      createSurfaceSampler(flattened).sample(flatten.directionBodyFixed)
        .elevationM,
    ).toBe(flatten.elevationM);

    const pose = launchSitePose(HOME_PAD, flattened);
    expect(Math.hypot(...pose.positionM)).toBeCloseTo(
      HOME_PLANET.radiusM + flatten.elevationM,
      9,
    );
  });
});

describe('HOME_RUNWAY', () => {
  it('is a distinct runway on the home planet with a matching flatten def', () => {
    expect(HOME_RUNWAY.bodyId).toBe(HOME_PLANET.id);
    expect(HOME_RUNWAY.type).toBe('runway');
    expect(HOME_RUNWAY.longitude).not.toBe(HOME_PAD.longitude);
    expect(HOME_BASE_STATIC_FLATTEN_DEFS).toHaveSize(2);
  });
});

describe('HOME_PLANET terrain visual data', () => {
  it('has biome and ocean albedo for the baked map-view globe', () => {
    expect(HOME_PLANET.terrain?.ocean?.seaLevelM).toBe(0);
    expect(HOME_PLANET.terrain?.visual?.colorRgb).toBeDefined();
    for (const biome of HOME_PLANET.terrain?.biomes ?? []) {
      expect(biome.visual?.colorRgb).toBeDefined();
    }
  });

  it('still samples a finite, bounded surface', () => {
    const sampler = createSurfaceSampler(HOME_PLANET);
    const elevationM = sampler.sample([1, 0.3, -0.4]).elevationM;
    expect(Number.isFinite(elevationM)).toBeTrue();
    expect(elevationM).toBeGreaterThanOrEqual(sampler.minElevationM);
    expect(elevationM).toBeLessThanOrEqual(sampler.maxElevationM);
  });

  it('forms an Earth-like majority-ocean world with broad continents', () => {
    const sampler = createSurfaceSampler(HOME_PLANET);
    const sampleCount = 8_192;
    const directions = new Float64Array(sampleCount * 3);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let index = 0; index < sampleCount; index += 1) {
      const y = 1 - (2 * (index + 0.5)) / sampleCount;
      const radial = Math.sqrt(1 - y * y);
      const azimuth = goldenAngle * index;
      directions[index * 3] = Math.cos(azimuth) * radial;
      directions[index * 3 + 1] = y;
      directions[index * 3 + 2] = Math.sin(azimuth) * radial;
    }
    const elevations = sampler.sampleBatch(directions);
    const seaLevelM = HOME_PLANET.terrain!.ocean!.seaLevelM;
    const waterFraction =
      [...elevations].filter((elevationM) => elevationM < seaLevelM).length /
      sampleCount;
    expect(waterFraction).toBeGreaterThan(0.65);
    expect(waterFraction).toBeLessThan(0.75);
  });

  it('places the stock base on land beside a known shore and navigable water', () => {
    const sampler = createSurfaceSampler(HOME_PLANET);
    const seaLevelM = HOME_PLANET.terrain!.ocean!.seaLevelM;
    const centerElevationM = sampler.sample(
      HOME_BASE_COASTAL_ACCESS.centerDirectionBodyFixed,
    ).elevationM;
    const shoreElevationM = sampler.sample(
      HOME_BASE_COASTAL_ACCESS.shoreDirectionBodyFixed,
    ).elevationM;
    const waterElevationM = sampler.sample(
      HOME_BASE_COASTAL_ACCESS.waterDirectionBodyFixed,
    ).elevationM;

    expect(centerElevationM).toBeGreaterThan(seaLevelM + 20);
    expect(Math.abs(shoreElevationM - seaLevelM)).toBeLessThan(0.01);
    expect(waterElevationM).toBeLessThan(seaLevelM - 20);
    expect(HOME_BASE_COASTAL_ACCESS.shoreDistanceM).toBeGreaterThan(1_000);
    expect(HOME_BASE_COASTAL_ACCESS.shoreDistanceM).toBeLessThan(1_500);
    expect(HOME_BASE_COASTAL_ACCESS.shallowWaterWidthM).toBeLessThan(800);
    expect(Math.abs(HOME_PAD.latitude)).toBeLessThan(15);
  });
});
