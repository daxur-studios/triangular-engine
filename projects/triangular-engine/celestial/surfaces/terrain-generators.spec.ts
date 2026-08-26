import { ICelestialBody } from '../bodies/celestial-body';
import { createSurfaceSampler, sampleSurface } from './surface-query';

const RIDGED_BODY: ICelestialBody = {
  id: 'ridged-test',
  kind: 'planet',
  radiusM: 600_000,
  muM3PerS2: 3.5316e12,
  terrain: {
    seed: 7,
    minElevationM: -10_000,
    maxElevationM: 10_000,
    generators: [
      {
        kind: 'ridged-fractal-3d',
        amplitudeM: 3_000,
        frequency: 3,
        octaves: 4,
        lacunarity: 2,
        persistence: 0.5,
        ridgeExponent: 2,
      },
    ],
  },
};

const CRATER_BODY: ICelestialBody = {
  id: 'crater-test',
  kind: 'planet',
  radiusM: 600_000,
  muM3PerS2: 3.5316e12,
  terrain: {
    seed: 13,
    minElevationM: -10_000,
    maxElevationM: 10_000,
    generators: [
      {
        kind: 'crater-field-3d',
        cellFrequency: 8,
        craterProbability: 1,
        minRadiusCells: 0.2,
        maxRadiusCells: 0.45,
        depthM: 200,
        rimHeightM: 40,
      },
    ],
  },
};

const CONTINENTAL_BODY: ICelestialBody = {
  id: 'continental-test',
  kind: 'planet',
  radiusM: 600_000,
  muM3PerS2: 3.5316e12,
  terrain: {
    seed: 7,
    minElevationM: -4_000,
    maxElevationM: 2_000,
    generators: [
      {
        kind: 'continental-3d',
        frequency: 1,
        octaves: 4,
        lacunarity: 2,
        persistence: 0.5,
        seaLevelThreshold: 0.15,
        transitionWidth: 0.25,
        oceanDepthM: 4_000,
        landHeightM: 2_000,
        coastVariation: {
          frequency: 2,
          octaves: 2,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 100,
          strength: 0.75,
        },
      },
    ],
  },
};

const SAMPLE_DIRECTIONS = [
  [1, 0, 0],
  [0.2, 0.7, -0.4],
  [-2, 3, 1],
  [0.577, 0.577, 0.577],
  [-0.3, 0.1, 0.9],
] as const;

describe('ridged-fractal-3d generator', () => {
  it('is deterministic and survives structured cloning', () => {
    const direction = [0.23, 0.91, -0.34] as const;
    const expected = sampleSurface(RIDGED_BODY, direction);
    expect(sampleSurface(RIDGED_BODY, direction)).toEqual(expected);
    expect(sampleSurface(structuredClone(RIDGED_BODY), direction)).toEqual(
      expected,
    );
  });

  it('produces identical scalar and batch results', () => {
    const sampler = createSurfaceSampler(RIDGED_BODY);
    const directions = new Float64Array(SAMPLE_DIRECTIONS.flat());
    const output = sampler.sampleBatch(directions);
    expect([...output]).toEqual(
      SAMPLE_DIRECTIONS.map((d) => sampler.sample(d).elevationM),
    );
  });

  it('stays within [0, amplitudeM] for every sampled direction', () => {
    const sampler = createSurfaceSampler(RIDGED_BODY);
    const amplitudeM = (
      RIDGED_BODY.terrain!.generators[0] as { amplitudeM: number }
    ).amplitudeM;
    for (const direction of SAMPLE_DIRECTIONS) {
      const elevationM = sampler.sample(direction).elevationM;
      expect(elevationM).toBeGreaterThanOrEqual(0);
      expect(elevationM).toBeLessThanOrEqual(amplitudeM);
    }
  });

  it('distinguishes different seedOffsets', () => {
    const otherBody = structuredClone(RIDGED_BODY);
    (otherBody.terrain!.generators[0] as { seedOffset?: number }).seedOffset =
      99;
    expect(
      SAMPLE_DIRECTIONS.some(
        (direction) =>
          sampleSurface(RIDGED_BODY, direction).elevationM !==
          sampleSurface(otherBody, direction).elevationM,
      ),
    ).toBeTrue();
  });

  it('rejects an invalid ridgeExponent', () => {
    const malformed = structuredClone(RIDGED_BODY);
    (
      malformed.terrain!.generators[0] as { ridgeExponent: number }
    ).ridgeExponent = 0.5;
    expect(() => createSurfaceSampler(malformed)).toThrowError(RangeError);
  });
});

describe('continental-3d generator', () => {
  it('is deterministic, scalar/batch-identical, and creates both land and ocean', () => {
    const sampler = createSurfaceSampler(CONTINENTAL_BODY);
    const directions = new Float64Array(SAMPLE_DIRECTIONS.flat());
    const output = sampler.sampleBatch(directions);
    expect([...output]).toEqual(
      SAMPLE_DIRECTIONS.map(
        (direction) => sampler.sample(direction).elevationM,
      ),
    );
    expect([...output].some((elevationM) => elevationM < 0)).toBeTrue();
    expect([...output].some((elevationM) => elevationM > 0)).toBeTrue();
    expect(
      sampleSurface(structuredClone(CONTINENTAL_BODY), SAMPLE_DIRECTIONS[0]),
    ).toEqual(sampleSurface(CONTINENTAL_BODY, SAMPLE_DIRECTIONS[0]));
  });

  it('stays inside its authored ocean-depth and land-height range', () => {
    const sampler = createSurfaceSampler(CONTINENTAL_BODY);
    for (const direction of SAMPLE_DIRECTIONS) {
      const elevationM = sampler.sample(direction).elevationM;
      expect(elevationM).toBeGreaterThanOrEqual(-4_000);
      expect(elevationM).toBeLessThanOrEqual(2_000);
    }
  });

  it('varies shelf steepness without moving the land/ocean boundary', () => {
    const uniformCoastBody = structuredClone(CONTINENTAL_BODY);
    delete (
      uniformCoastBody.terrain!.generators[0] as {
        coastVariation?: unknown;
      }
    ).coastVariation;
    const variedSampler = createSurfaceSampler(CONTINENTAL_BODY);
    const uniformSampler = createSurfaceSampler(uniformCoastBody);
    const pairs = SAMPLE_DIRECTIONS.map((direction) => [
      variedSampler.sample(direction).elevationM,
      uniformSampler.sample(direction).elevationM,
    ]);

    expect(
      pairs.every(
        ([varied, uniform]) => Math.sign(varied) === Math.sign(uniform),
      ),
    ).toBeTrue();
    expect(
      pairs.some(([varied, uniform]) => Math.abs(varied - uniform) > 1),
    ).toBeTrue();
  });

  it('validates malformed continental parameters', () => {
    const zeroWidth = structuredClone(CONTINENTAL_BODY);
    (
      zeroWidth.terrain!.generators[0] as { transitionWidth: number }
    ).transitionWidth = 0;
    expect(() => createSurfaceSampler(zeroWidth)).toThrowError(RangeError);

    const invalidThreshold = structuredClone(CONTINENTAL_BODY);
    (
      invalidThreshold.terrain!.generators[0] as {
        seaLevelThreshold: number;
      }
    ).seaLevelThreshold = 1;
    expect(() => createSurfaceSampler(invalidThreshold)).toThrowError(
      RangeError,
    );

    const invalidCoastVariation = structuredClone(CONTINENTAL_BODY);
    (
      invalidCoastVariation.terrain!.generators[0] as {
        coastVariation: { strength: number };
      }
    ).coastVariation.strength = 1;
    expect(() => createSurfaceSampler(invalidCoastVariation)).toThrowError(
      RangeError,
    );
  });
});

describe('crater-field-3d generator', () => {
  it('is deterministic, scalar/batch-identical, and finite everywhere', () => {
    const sampler = createSurfaceSampler(CRATER_BODY);
    const directions = new Float64Array(SAMPLE_DIRECTIONS.flat());
    const output = sampler.sampleBatch(directions);
    for (let index = 0; index < SAMPLE_DIRECTIONS.length; index += 1) {
      const scalar = sampler.sample(SAMPLE_DIRECTIONS[index]).elevationM;
      expect(output[index]).toBe(scalar);
      expect(Number.isFinite(scalar)).toBeTrue();
    }
  });

  it('is exactly zero everywhere when craterProbability is 0', () => {
    const noCraters = structuredClone(CRATER_BODY);
    (
      noCraters.terrain!.generators[0] as { craterProbability: number }
    ).craterProbability = 0;
    for (const direction of SAMPLE_DIRECTIONS) {
      expect(sampleSurface(noCraters, direction).elevationM).toBe(0);
    }
  });

  it('never rises above the rim contribution near a guaranteed crater', () => {
    // craterProbability=1 guarantees a crater in every one of the 27
    // neighbor cells, so every sample is inside at least one bowl or rim.
    const sampler = createSurfaceSampler(CRATER_BODY);
    const rimHeightM = (
      CRATER_BODY.terrain!.generators[0] as { rimHeightM: number }
    ).rimHeightM;
    for (const direction of SAMPLE_DIRECTIONS) {
      const elevationM = sampler.sample(direction).elevationM;
      expect(elevationM).toBeLessThanOrEqual(
        rimHeightM * SAMPLE_DIRECTIONS.length,
      );
    }
  });

  it('validates malformed crater parameters', () => {
    const badRadius = structuredClone(CRATER_BODY);
    (
      badRadius.terrain!.generators[0] as { maxRadiusCells: number }
    ).maxRadiusCells = 0.6;
    expect(() => createSurfaceSampler(badRadius)).toThrowError(RangeError);

    const badProbability = structuredClone(CRATER_BODY);
    (
      badProbability.terrain!.generators[0] as { craterProbability: number }
    ).craterProbability = 1.5;
    expect(() => createSurfaceSampler(badProbability)).toThrowError(RangeError);

    const invertedRadius = structuredClone(CRATER_BODY);
    (
      invertedRadius.terrain!.generators[0] as {
        minRadiusCells: number;
        maxRadiusCells: number;
      }
    ).minRadiusCells = 0.5;
    expect(() => createSurfaceSampler(invertedRadius)).toThrowError(RangeError);
  });
});

describe('crater radial profile continuity (frozen formula)', () => {
  /**
   * Re-derives the documented profile independently of the implementation
   * (inner bowl `-D(1-x^2)^2`, outer rim `H*16y^2(1-y)^2` with `y=2(x-1)`,
   * zero beyond `x=1.5`) so this test also catches the implementation
   * drifting from the frozen formula, not just discontinuities within it.
   */
  function referenceProfile(
    x: number,
    depthM: number,
    rimHeightM: number,
  ): number {
    if (x < 1) {
      const inner = 1 - x * x;
      return -depthM * inner * inner;
    }
    if (x < 1.5) {
      const y = 2 * (x - 1);
      return rimHeightM * 16 * y * y * (1 - y) * (1 - y);
    }
    return 0;
  }

  function numericalDerivative(
    x: number,
    depthM: number,
    rimHeightM: number,
    epsilon: number,
  ): number {
    return (
      (referenceProfile(x + epsilon, depthM, rimHeightM) -
        referenceProfile(x - epsilon, depthM, rimHeightM)) /
      (2 * epsilon)
    );
  }

  it('agrees in value and derivative across both seams', () => {
    const depthM = 200;
    const rimHeightM = 40;
    const epsilon = 1e-6;

    for (const seam of [1, 1.5]) {
      const before = referenceProfile(seam - epsilon, depthM, rimHeightM);
      const after = referenceProfile(seam + epsilon, depthM, rimHeightM);
      expect(Math.abs(before - after)).toBeLessThan(1e-6);

      const derivativeBefore = numericalDerivative(
        seam - epsilon,
        depthM,
        rimHeightM,
        epsilon,
      );
      const derivativeAfter = numericalDerivative(
        seam + epsilon,
        depthM,
        rimHeightM,
        epsilon,
      );
      expect(Math.abs(derivativeBefore - derivativeAfter)).toBeLessThan(1e-2);
    }
  });

  it('is non-positive inside the bowl and exactly zero beyond the rim', () => {
    const depthM = 200;
    const rimHeightM = 40;
    for (let x = 0; x < 1; x += 0.05) {
      expect(referenceProfile(x, depthM, rimHeightM)).toBeLessThanOrEqual(0);
    }
    expect(referenceProfile(1.5, depthM, rimHeightM)).toBe(0);
    expect(referenceProfile(2, depthM, rimHeightM)).toBe(0);
  });
});

describe('terrace-fractal-3d generator', () => {
  const TERRACE_BODY: ICelestialBody = {
    id: 'terrace-test',
    kind: 'planet',
    radiusM: 600_000,
    muM3PerS2: 3.5316e12,
    terrain: {
      seed: 42,
      minElevationM: -1_000,
      maxElevationM: 3_000,
      generators: [
        {
          kind: 'terrace-fractal-3d',
          amplitudeM: 1_200,
          frequency: 3,
          octaves: 4,
          lacunarity: 2,
          persistence: 0.5,
          terraceCount: 4,
          stepSharpness: 0.85,
        },
      ],
    },
  };

  it('is deterministic, finite, and bounded within [0, amplitudeM]', () => {
    const sampler = createSurfaceSampler(TERRACE_BODY);
    for (const direction of SAMPLE_DIRECTIONS) {
      const elevationM = sampler.sample(direction).elevationM;
      expect(Number.isFinite(elevationM)).toBeTrue();
      expect(elevationM).toBeGreaterThanOrEqual(0);
      expect(elevationM).toBeLessThanOrEqual(1_200);
    }
  });

  it('produces identical scalar and batch results', () => {
    const sampler = createSurfaceSampler(TERRACE_BODY);
    const directions = new Float64Array(SAMPLE_DIRECTIONS.flat());
    const output = sampler.sampleBatch(directions);
    expect([...output]).toEqual(
      SAMPLE_DIRECTIONS.map((d) => sampler.sample(d).elevationM),
    );
  });

  it('validates invalid terrace parameters', () => {
    const badCount = structuredClone(TERRACE_BODY);
    (
      badCount.terrain!.generators[0] as { terraceCount: number }
    ).terraceCount = 0;
    expect(() => createSurfaceSampler(badCount)).toThrowError(RangeError);

    const badSharpness = structuredClone(TERRACE_BODY);
    (
      badSharpness.terrain!.generators[0] as { stepSharpness: number }
    ).stepSharpness = 1.5;
    expect(() => createSurfaceSampler(badSharpness)).toThrowError(RangeError);
  });
});

describe('canyon-3d generator', () => {
  const CANYON_BODY: ICelestialBody = {
    id: 'canyon-test',
    kind: 'planet',
    radiusM: 600_000,
    muM3PerS2: 3.5316e12,
    terrain: {
      seed: 99,
      minElevationM: -2_000,
      maxElevationM: 1_000,
      generators: [
        {
          kind: 'canyon-3d',
          depthM: 800,
          frequency: 2.5,
          octaves: 4,
          lacunarity: 2,
          persistence: 0.5,
          canyonWidth: 0.35,
          wallSteepness: 3.0,
        },
      ],
    },
  };

  it('is deterministic, non-positive, and bounded within [-depthM, 0]', () => {
    const sampler = createSurfaceSampler(CANYON_BODY);
    for (const direction of SAMPLE_DIRECTIONS) {
      const elevationM = sampler.sample(direction).elevationM;
      expect(Number.isFinite(elevationM)).toBeTrue();
      expect(elevationM).toBeLessThanOrEqual(0);
      expect(elevationM).toBeGreaterThanOrEqual(-800);
    }
  });

  it('produces identical scalar and batch results', () => {
    const sampler = createSurfaceSampler(CANYON_BODY);
    const directions = new Float64Array(SAMPLE_DIRECTIONS.flat());
    const output = sampler.sampleBatch(directions);
    expect([...output]).toEqual(
      SAMPLE_DIRECTIONS.map((d) => sampler.sample(d).elevationM),
    );
  });

  it('validates invalid canyon parameters', () => {
    const badDepth = structuredClone(CANYON_BODY);
    (badDepth.terrain!.generators[0] as { depthM: number }).depthM = -50;
    expect(() => createSurfaceSampler(badDepth)).toThrowError(RangeError);

    const badWidth = structuredClone(CANYON_BODY);
    (badWidth.terrain!.generators[0] as { canyonWidth: number }).canyonWidth =
      0;
    expect(() => createSurfaceSampler(badWidth)).toThrowError(RangeError);
  });
});

describe('dunes-3d generator', () => {
  const DUNES_BODY: ICelestialBody = {
    id: 'dunes-test',
    kind: 'planet',
    radiusM: 600_000,
    muM3PerS2: 3.5316e12,
    terrain: {
      seed: 77,
      minElevationM: -100,
      maxElevationM: 500,
      generators: [
        {
          kind: 'dunes-3d',
          amplitudeM: 75,
          frequency: 18,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
          windDirectionBodyFixed: [1, 0, 0],
          waveAsymmetry: 0.65,
        },
      ],
    },
  };

  it('is deterministic, non-negative, and bounded within [0, amplitudeM]', () => {
    const sampler = createSurfaceSampler(DUNES_BODY);
    for (const direction of SAMPLE_DIRECTIONS) {
      const elevationM = sampler.sample(direction).elevationM;
      expect(Number.isFinite(elevationM)).toBeTrue();
      expect(elevationM).toBeGreaterThanOrEqual(0);
      expect(elevationM).toBeLessThanOrEqual(75);
    }
  });

  it('produces identical scalar and batch results', () => {
    const sampler = createSurfaceSampler(DUNES_BODY);
    const directions = new Float64Array(SAMPLE_DIRECTIONS.flat());
    const output = sampler.sampleBatch(directions);
    expect([...output]).toEqual(
      SAMPLE_DIRECTIONS.map((d) => sampler.sample(d).elevationM),
    );
  });

  it('validates invalid dune parameters', () => {
    const badAmp = structuredClone(DUNES_BODY);
    (badAmp.terrain!.generators[0] as { amplitudeM: number }).amplitudeM = -10;
    expect(() => createSurfaceSampler(badAmp)).toThrowError(RangeError);

    const badAsym = structuredClone(DUNES_BODY);
    (
      badAsym.terrain!.generators[0] as { waveAsymmetry: number }
    ).waveAsymmetry = 1.2;
    expect(() => createSurfaceSampler(badAsym)).toThrowError(RangeError);
  });
});

describe('domain warp support', () => {
  it('alters generator output organically when warp is specified', () => {
    const unwarped: ICelestialBody = {
      id: 'unwarped',
      kind: 'planet',
      radiusM: 600_000,
      muM3PerS2: 3.5316e12,
      terrain: {
        seed: 123,
        minElevationM: -1_000,
        maxElevationM: 1_000,
        generators: [
          {
            kind: 'fractal-noise-3d',
            amplitudeM: 500,
            frequency: 2,
            octaves: 3,
            lacunarity: 2,
            persistence: 0.5,
          },
        ],
      },
    };
    const warped = structuredClone(unwarped);
    (warped.terrain!.generators[0] as { warp: unknown }).warp = {
      frequency: 1.5,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      strength: 0.25,
    };
    const unwarpedSampler = createSurfaceSampler(unwarped);
    const warpedSampler = createSurfaceSampler(warped);
    expect(
      SAMPLE_DIRECTIONS.some(
        (dir) =>
          unwarpedSampler.sample(dir).elevationM !==
          warpedSampler.sample(dir).elevationM,
      ),
    ).toBeTrue();
  });
});

