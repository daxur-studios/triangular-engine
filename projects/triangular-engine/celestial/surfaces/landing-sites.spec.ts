import { ICelestialBody } from '../bodies/celestial-body';
import { Vec3d, vec3Cross, vec3Dot, vec3Normalize } from '../math/vec3';
import { createSurfaceSampler } from './surface-query';
import { coastalSitesFor, landingSitesFor } from './landing-sites';

const FLAT_BODY: ICelestialBody = {
  id: 'flat-test-body',
  kind: 'planet',
  radiusM: 600_000,
  muM3PerS2: 3.5316e12,
  terrain: {
    seed: 7,
    minElevationM: -1_000,
    maxElevationM: 1_000,
    generators: [],
  },
};

/**
 * A small, deliberately rugged body: noise `frequency` is chosen so its
 * lattice cell pitch (~1/frequency in normalized direction-space) lands
 * around the same angular scale as a landing pad footprint on this body
 * (`radiusM / body.radiusM`), so a 100 m pad genuinely straddles real local
 * slope — some patches steep, some locally flat — rather than sampling a
 * noise field whose wavelength is thousands of kilometres (as `TEST_BODY` in
 * `surface-query.spec.ts` is, deliberately, for its own unrelated purpose).
 */
const RUGGED_BODY: ICelestialBody = {
  id: 'rugged-test-moon',
  kind: 'moon',
  radiusM: 6_000,
  muM3PerS2: 4.9e10,
  terrain: {
    seed: 99,
    minElevationM: -500,
    maxElevationM: 500,
    generators: [
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 150,
        frequency: 20,
        octaves: 3,
        lacunarity: 2,
        persistence: 0.5,
      },
    ],
  },
};
const RUGGED_PAD_RADIUS_M = 100;

const COASTAL_BODY: ICelestialBody = {
  id: 'coastal-test-body',
  kind: 'planet',
  radiusM: 100_000,
  muM3PerS2: 9.81e10,
  terrain: {
    seed: 47,
    minElevationM: -2_000,
    maxElevationM: 1_000,
    generators: [
      {
        kind: 'continental-3d',
        frequency: 0.8,
        octaves: 4,
        lacunarity: 2,
        persistence: 0.5,
        seaLevelThreshold: 0.1,
        transitionWidth: 0.3,
        oceanDepthM: 2_000,
        landHeightM: 1_000,
      },
    ],
    ocean: {
      seaLevelM: 0,
      shallowColorRgb: [0.1, 0.4, 0.6],
      deepColorRgb: [0.02, 0.08, 0.2],
    },
  },
};

/** Independent re-derivation of worst edge-to-centre slope, using only the public sampler API — verifies the output *contract*, not `landingSitesFor`'s internals. */
function worstSlopeAt(
  body: ICelestialBody,
  direction: Vec3d,
  radiusM: number,
  ringSampleCount = 8,
): number {
  const sampler = createSurfaceSampler(body);
  const centerElevationM = sampler.sample(direction).elevationM;
  const reference: Vec3d = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tangent1 = vec3Normalize(vec3Cross(reference, direction));
  const tangent2 = vec3Cross(direction, tangent1);
  const angularRadiusRad = radiusM / body.radiusM;
  let worst = 0;
  for (let r = 0; r < ringSampleCount; r += 1) {
    const rimAngleRad = (2 * Math.PI * r) / ringSampleCount;
    const cosA = Math.cos(angularRadiusRad);
    const sinA = Math.sin(angularRadiusRad);
    const rimDir: Vec3d = vec3Normalize([
      direction[0] * cosA +
        (tangent1[0] * Math.cos(rimAngleRad) +
          tangent2[0] * Math.sin(rimAngleRad)) *
          sinA,
      direction[1] * cosA +
        (tangent1[1] * Math.cos(rimAngleRad) +
          tangent2[1] * Math.sin(rimAngleRad)) *
          sinA,
      direction[2] * cosA +
        (tangent1[2] * Math.cos(rimAngleRad) +
          tangent2[2] * Math.sin(rimAngleRad)) *
          sinA,
    ]);
    const ringElevationM = sampler.sample(rimDir).elevationM;
    const slope = Math.atan2(
      Math.abs(ringElevationM - centerElevationM),
      radiusM,
    );
    if (slope > worst) worst = slope;
  }
  return worst;
}

function angularSeparationRad(a: Vec3d, b: Vec3d): number {
  return Math.acos(Math.max(-1, Math.min(1, vec3Dot(a, b))));
}

describe('landingSitesFor', () => {
  it('returns nothing for a body with no terrain', () => {
    expect(landingSitesFor({ ...FLAT_BODY, terrain: undefined })).toEqual([]);
  });

  it('is deterministic: repeated calls and a structurally cloned body produce identical sites', () => {
    const first = landingSitesFor(FLAT_BODY);
    const second = landingSitesFor(FLAT_BODY);
    const cloned = landingSitesFor(structuredClone(FLAT_BODY));
    expect(second).toEqual(first);
    expect(cloned).toEqual(first);
  });

  it('reaches the requested count on a generously flat body', () => {
    const sites = landingSitesFor(FLAT_BODY, { count: 6 });
    expect(sites.length).toBe(6);
  });

  it('names sites in order and positions them on the generated surface', () => {
    const sites = landingSitesFor(FLAT_BODY, { count: 3 });
    expect(sites.map((s) => s.name)).toEqual(['Site 1', 'Site 2', 'Site 3']);
    for (const site of sites) {
      expect(site.def.kind).toBe('circle');
      const distanceFromCenterM = Math.hypot(...site.positionBodyFrameM);
      // On the flat body every plateau elevation is ~0, so the site should sit almost exactly on the datum sphere.
      expect(Math.abs(distanceFromCenterM - FLAT_BODY.radiusM)).toBeLessThan(1);
    }
  });

  it('enforces minimum angular separation between every pair of selected sites', () => {
    const minSeparationRadians = (20 * Math.PI) / 180;
    const sites = landingSitesFor(FLAT_BODY, {
      count: 6,
      minSeparationRadians,
    });
    for (let i = 0; i < sites.length; i += 1) {
      for (let j = i + 1; j < sites.length; j += 1) {
        const a = sites[i].def as { directionBodyFixed: Vec3d };
        const b = sites[j].def as { directionBodyFixed: Vec3d };
        expect(
          angularSeparationRad(a.directionBodyFixed, b.directionBodyFixed),
        ).toBeGreaterThanOrEqual(minSeparationRadians - 1e-9);
      }
    }
  });

  it('never selects a site whose footprint exceeds the slope threshold, even on rugged terrain', () => {
    const maxSlopeRadians = (15 * Math.PI) / 180;
    const sites = landingSitesFor(RUGGED_BODY, {
      count: 6,
      radiusM: RUGGED_PAD_RADIUS_M,
      maxSlopeRadians,
      minSeparationRadians: (5 * Math.PI) / 180,
    });
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      const direction = (site.def as { directionBodyFixed: Vec3d })
        .directionBodyFixed;
      const slope = worstSlopeAt(RUGGED_BODY, direction, RUGGED_PAD_RADIUS_M);
      expect(slope).toBeLessThanOrEqual(maxSlopeRadians + 1e-6);
    }
  });

  it('picks sites flatter than typical ground on rugged terrain (the whole point of the search)', () => {
    const sites = landingSitesFor(RUGGED_BODY, {
      count: 6,
      radiusM: RUGGED_PAD_RADIUS_M,
      minSeparationRadians: (5 * Math.PI) / 180,
    });
    const selectedAvgSlope =
      sites.reduce((sum, site) => {
        const direction = (site.def as { directionBodyFixed: Vec3d })
          .directionBodyFixed;
        return sum + worstSlopeAt(RUGGED_BODY, direction, RUGGED_PAD_RADIUS_M);
      }, 0) / sites.length;

    // An arbitrary, evenly-spread comparison set unrelated to the generator's own candidate sweep.
    const comparisonDirections: Vec3d[] = [];
    for (let i = 0; i < 24; i += 1) {
      const inclination = Math.acos(1 - (2 * (i + 0.5)) / 24);
      const azimuth = i * 2.399963; // independent irrational-ish spread, not the generator's golden angle
      comparisonDirections.push([
        Math.sin(inclination) * Math.cos(azimuth),
        Math.sin(inclination) * Math.sin(azimuth),
        Math.cos(inclination),
      ]);
    }
    const comparisonAvgSlope =
      comparisonDirections.reduce(
        (sum, dir) => sum + worstSlopeAt(RUGGED_BODY, dir, RUGGED_PAD_RADIUS_M),
        0,
      ) / comparisonDirections.length;

    expect(selectedAvgSlope).toBeLessThan(comparisonAvgSlope);
  });

  it('relaxes the threshold rather than returning fewer than requested when too little ground qualifies', () => {
    const sites = landingSitesFor(RUGGED_BODY, {
      count: 6,
      radiusM: RUGGED_PAD_RADIUS_M,
      maxSlopeRadians: 1e-6, // unreasonably strict — almost nothing should "qualify" outright
      minSeparationRadians: (5 * Math.PI) / 180,
    });
    expect(sites.length).toBe(6);
  });
});

describe('coastalSitesFor', () => {
  const options = {
    count: 3,
    candidateCount: 8_000,
    radiusM: 80,
    blendRadiusM: 120,
    maxSlopeRadians: (10 * Math.PI) / 180,
    minSeparationRadians: (8 * Math.PI) / 180,
    minElevationAboveSeaM: 5,
    maxElevationAboveSeaM: 250,
    waterSearchRadiusM: 2_500,
    maxShoreDistanceM: 1_600,
    maxShallowWaterWidthM: 1_500,
    waterBearingCount: 16,
    waterRingCount: 4,
    minWaterDepthM: 10,
  } as const;

  it('returns nothing for a dry body', () => {
    const dryBody = structuredClone(COASTAL_BODY);
    dryBody.terrain!.ocean = undefined;
    expect(coastalSitesFor(dryBody, options)).toEqual([]);
  });

  it('deterministically pairs buildable land with a refined shore and navigable water', () => {
    const first = coastalSitesFor(COASTAL_BODY, options);
    const second = coastalSitesFor(structuredClone(COASTAL_BODY), options);
    expect(second).toEqual(first);
    expect(first).toHaveSize(options.count);

    const sampler = createSurfaceSampler(COASTAL_BODY);
    for (const site of first) {
      expect(site.elevationAboveSeaM).toBeGreaterThanOrEqual(
        options.minElevationAboveSeaM,
      );
      expect(site.elevationAboveSeaM).toBeLessThanOrEqual(
        options.maxElevationAboveSeaM,
      );
      expect(
        sampler.sample(site.waterDirectionBodyFixed).elevationM,
      ).toBeLessThanOrEqual(-options.minWaterDepthM);
      expect(
        Math.abs(sampler.sample(site.shoreDirectionBodyFixed).elevationM),
      ).toBeLessThan(0.01);
      expect(site.shoreDistanceM).toBeGreaterThan(0);
      expect(site.shoreDistanceM).toBeLessThan(site.waterDistanceM);
      expect(site.shoreDistanceM).toBeLessThanOrEqual(
        options.maxShoreDistanceM,
      );
      expect(site.shallowWaterWidthM).toBeCloseTo(
        site.waterDistanceM - site.shoreDistanceM,
        6,
      );
      expect(site.shallowWaterWidthM).toBeLessThanOrEqual(
        options.maxShallowWaterWidthM,
      );
    }
  });

  it('rejects a water search radius that overlaps the graded footprint', () => {
    expect(() =>
      coastalSitesFor(COASTAL_BODY, {
        ...options,
        waterSearchRadiusM: options.radiusM + options.blendRadiusM,
      }),
    ).toThrowError(RangeError);
  });

  it('rejects a maximum shore distance beyond the water search radius', () => {
    expect(() =>
      coastalSitesFor(COASTAL_BODY, {
        ...options,
        maxShoreDistanceM: options.waterSearchRadiusM + 1,
      }),
    ).toThrowError(RangeError);
  });
});
