import { ICelestialBody } from '../bodies/celestial-body';
import { Vec3d } from '../math/vec3';
import {
  ILocalFlattenCircleModifierDef,
  ILocalFlattenRectModifierDef,
  TerrainGeneratorDef,
  TerrainMaskDef,
} from './terrain-def';
import {
  altitudeAboveTerrainM,
  createSurfaceSampler,
  sampleSurface,
  surfaceRadiusM,
} from './surface-query';

const TEST_BODY: ICelestialBody = {
  id: 'surface-test',
  kind: 'planet',
  radiusM: 600_000,
  muM3PerS2: 3.5316e12,
  terrain: {
    seed: 42,
    minElevationM: -2_000,
    maxElevationM: 4_000,
    generators: [
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 2_500,
        frequency: 2,
        octaves: 4,
        lacunarity: 2,
        persistence: 0.5,
      },
    ],
  },
};

describe('surface queries', () => {
  it('returns the datum sphere for bodies without terrain', () => {
    const body = { ...TEST_BODY, terrain: undefined };
    expect(sampleSurface(body, [1, 0, 0]).elevationM).toBe(0);
    expect(surfaceRadiusM(body, [1, 0, 0])).toBe(body.radiusM);
  });

  it('is deterministic and survives structured cloning', () => {
    const direction = [0.23, 0.91, -0.34] as const;
    const expected = sampleSurface(TEST_BODY, direction);
    expect(sampleSurface(TEST_BODY, direction)).toEqual(expected);
    expect(sampleSurface(structuredClone(TEST_BODY), direction)).toEqual(
      expected,
    );
  });

  it('normalizes finite non-zero directions', () => {
    expect(sampleSurface(TEST_BODY, [2, -4, 6])).toEqual(
      sampleSurface(TEST_BODY, [1, -2, 3]),
    );
  });

  it('rejects zero and non-finite directions', () => {
    expect(() => sampleSurface(TEST_BODY, [0, 0, 0])).toThrowError(RangeError);
    expect(() => sampleSurface(TEST_BODY, [1, Number.NaN, 0])).toThrowError(
      RangeError,
    );
  });

  it('ignores visual/ocean data when sampling elevation (additive, not read here)', () => {
    const directions: Vec3d[] = [
      [1, 0.2, 0.4],
      [-0.3, 0.8, 0.5],
      [0.1, -0.7, 0.9],
    ];
    const withVisuals: ICelestialBody = {
      ...TEST_BODY,
      terrain: {
        ...TEST_BODY.terrain!,
        visual: { colorRgb: [0.2, 0.4, 0.2], highColorRgb: [0.9, 0.9, 0.9] },
        ocean: {
          seaLevelM: 0,
          shallowColorRgb: [0.1, 0.3, 0.5],
          deepColorRgb: [0.02, 0.08, 0.25],
        },
      },
    };
    for (const direction of directions) {
      expect(sampleSurface(withVisuals, direction)).toEqual(
        sampleSurface(TEST_BODY, direction),
      );
    }
  });

  it('distinguishes different seeds', () => {
    const otherBody = structuredClone(TEST_BODY);
    otherBody.terrain!.seed += 1;
    const directions = [
      [1, 0.2, 0.4],
      [-0.3, 0.8, 0.5],
      [0.1, -0.7, 0.9],
    ] as const;
    expect(
      directions.some(
        (direction) =>
          sampleSurface(TEST_BODY, direction).elevationM !==
          sampleSurface(otherBody, direction).elevationM,
      ),
    ).toBeTrue();
  });

  it('stays finite, bounded, and continuous across a cube-face boundary', () => {
    const epsilon = 1e-10;
    const first = sampleSurface(TEST_BODY, [1 + epsilon, 1, 0]).elevationM;
    const second = sampleSurface(TEST_BODY, [1, 1 + epsilon, 0]).elevationM;
    expect(Number.isFinite(first)).toBeTrue();
    expect(first).toBeGreaterThanOrEqual(TEST_BODY.terrain!.minElevationM);
    expect(first).toBeLessThanOrEqual(TEST_BODY.terrain!.maxElevationM);
    expect(Math.abs(first - second)).toBeLessThan(1e-4);
  });

  it('produces identical scalar and batch results and reuses output storage', () => {
    const sampler = createSurfaceSampler(TEST_BODY);
    const directions = new Float64Array([1, 0, 0, 0.2, 0.7, -0.4, -2, 3, 1]);
    const output = new Float64Array(3);
    expect(sampler.sampleBatch(directions, output)).toBe(output);
    expect([...output]).toEqual([
      sampler.sample([1, 0, 0]).elevationM,
      sampler.sample([0.2, 0.7, -0.4]).elevationM,
      sampler.sample([-2, 3, 1]).elevationM,
    ]);
  });

  it('supports a serialized region mask without changing the sampler contract', () => {
    const maskedBody = structuredClone(TEST_BODY);
    maskedBody.terrain!.generators[0]!.mask = {
      kind: 'noise-mask-3d',
      frequency: 0.75,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      lowerThreshold: -0.25,
      upperThreshold: 0.25,
    };
    expect(
      Number.isFinite(sampleSurface(maskedBody, [0.2, 0.7, -0.4]).elevationM),
    ).toBeTrue();
  });

  it('computes radius and altitude from the same shared sample', () => {
    const elevationM = sampleSurface(TEST_BODY, [1, 0, 0]).elevationM;
    const positionRadiusM = TEST_BODY.radiusM + elevationM + 25;
    expect(surfaceRadiusM(TEST_BODY, [1, 0, 0])).toBe(
      TEST_BODY.radiusM + elevationM,
    );
    expect(
      altitudeAboveTerrainM(TEST_BODY, [positionRadiusM, 0, 0]),
    ).toBeCloseTo(25, 9);
  });

  it('validates malformed definitions and batch buffers', () => {
    const malformedBody = structuredClone(TEST_BODY);
    (malformedBody.terrain!.generators[0] as { octaves: number }).octaves = 0;
    expect(() => createSurfaceSampler(malformedBody)).toThrowError(RangeError);

    const sampler = createSurfaceSampler(TEST_BODY);
    expect(() => sampler.sampleBatch(new Float64Array(2))).toThrowError(
      RangeError,
    );
    expect(() =>
      sampler.sampleBatch(new Float64Array(3), new Float64Array(2)),
    ).toThrowError(RangeError);
  });

  it('returns the empty biome result for a body with no biomes', () => {
    const sampler = createSurfaceSampler(TEST_BODY);
    expect(sampler.sampleBiome([1, 0, 0])).toEqual({
      dominantBiomeIndex: -1,
      weights: [],
    });
    const directions = new Float64Array([1, 0, 0, 0.2, 0.7, -0.4]);
    const output = sampler.sampleDominantBiomeBatch(directions);
    // -1 has no Uint16 representation; 0xffff is the documented sentinel.
    expect([...output]).toEqual([0xffff, 0xffff]);
  });
});

describe('local terrain flatten modifiers', () => {
  const FLATTEN_BODY: ICelestialBody = {
    id: 'flatten-test',
    kind: 'planet',
    radiusM: 1_000,
    muM3PerS2: 1,
    terrain: {
      seed: 1,
      minElevationM: -200,
      maxElevationM: 200,
      generators: [],
      localFlatten: [
        {
          kind: 'circle',
          directionBodyFixed: [2, 0, 0],
          radiusM: 100,
          blendRadiusM: 40,
          elevationM: 80,
        },
      ],
    },
  };

  function directionAtDistance(distanceM: number): Vec3d {
    const angleRad = distanceM / FLATTEN_BODY.radiusM;
    return [Math.cos(angleRad), Math.sin(angleRad), 0];
  }

  it('is exact inside the plateau and preserves generated terrain outside it', () => {
    expect(
      sampleSurface(FLATTEN_BODY, directionAtDistance(99)).elevationM,
    ).toBe(80);
    expect(
      sampleSurface(FLATTEN_BODY, directionAtDistance(141)).elevationM,
    ).toBe(0);
  });

  it('smoothstep-blends across the authored blend radius', () => {
    expect(
      sampleSurface(FLATTEN_BODY, directionAtDistance(120)).elevationM,
    ).toBeCloseTo(40, 9);
  });

  it('is deterministic across structured cloning and agrees in scalar and batch paths', () => {
    const cloned = structuredClone(FLATTEN_BODY);
    const directions = new Float64Array([
      ...directionAtDistance(0),
      ...directionAtDistance(120),
      ...directionAtDistance(160),
    ]);
    const sampler = createSurfaceSampler(cloned);
    expect([...sampler.sampleBatch(directions)]).toEqual([
      sampler.sample(directionAtDistance(0)).elevationM,
      sampler.sample(directionAtDistance(120)).elevationM,
      sampler.sample(directionAtDistance(160)).elevationM,
    ]);
    expect(sampleSurface(cloned, [1, 0, 0])).toEqual(
      sampleSurface(FLATTEN_BODY, [1, 0, 0]),
    );
  });

  it('rejects malformed flatten definitions', () => {
    for (const mutate of [
      (body: ICelestialBody) =>
        ((
          body.terrain!.localFlatten![0]! as ILocalFlattenCircleModifierDef
        ).radiusM = 0),
      (body: ICelestialBody) =>
        (body.terrain!.localFlatten![0]!.blendRadiusM = 0),
      (body: ICelestialBody) =>
        (body.terrain!.localFlatten![0]!.elevationM = 201),
      (body: ICelestialBody) =>
        (body.terrain!.localFlatten![0]!.directionBodyFixed = [0, 0, 0]),
    ]) {
      const malformed = structuredClone(FLATTEN_BODY);
      mutate(malformed);
      expect(() => createSurfaceSampler(malformed)).toThrowError(RangeError);
    }
  });
});

describe('rect local terrain flatten modifiers', () => {
  const RECT_FLATTEN_BODY: ICelestialBody = {
    id: 'rect-flatten-test',
    kind: 'planet',
    radiusM: 50_000,
    muM3PerS2: 1,
    terrain: {
      seed: 1,
      minElevationM: -200,
      maxElevationM: 200,
      generators: [],
      localFlatten: [
        {
          kind: 'rect',
          directionBodyFixed: [1, 0, 0],
          forwardBodyFixed: [0, 1, 0],
          halfLengthM: 100,
          halfWidthM: 40,
          blendRadiusM: 40,
          elevationM: 80,
        },
      ],
    },
  };

  // Local axes for directionBodyFixed [1,0,0] / forwardBodyFixed [0,1,0]: up=X, forward=Y, right=cross(up,forward)=Z.
  function directionAtOffset(forwardM: number, rightM: number): Vec3d {
    const point: Vec3d = [RECT_FLATTEN_BODY.radiusM, forwardM, rightM];
    const length = Math.hypot(point[0], point[1], point[2]);
    return [point[0] / length, point[1] / length, point[2] / length];
  }

  it('is exact inside the rectangle and preserves generated terrain past the blend', () => {
    expect(
      sampleSurface(RECT_FLATTEN_BODY, directionAtOffset(90, 30)).elevationM,
    ).toBe(80);
    expect(
      sampleSurface(RECT_FLATTEN_BODY, directionAtOffset(150, 0)).elevationM,
    ).toBe(0);
    expect(
      sampleSurface(RECT_FLATTEN_BODY, directionAtOffset(0, 90)).elevationM,
    ).toBe(0);
  });

  it('smoothstep-blends across the authored blend radius along each axis', () => {
    // Precision 2, not 9 like the circle test: the rect shape uses a
    // chord-for-arc tangent-plane approximation (see `localFlattenExcessM`),
    // accurate to a fraction of a meter at this body/footprint scale but not
    // bit-exact the way the circle's spherical `Math.acos` distance is.
    expect(
      sampleSurface(RECT_FLATTEN_BODY, directionAtOffset(120, 0)).elevationM,
    ).toBeCloseTo(40, 2);
    expect(
      sampleSurface(RECT_FLATTEN_BODY, directionAtOffset(0, 60)).elevationM,
    ).toBeCloseTo(40, 2);
  });

  it('rejects malformed rect flatten definitions', () => {
    for (const mutate of [
      (body: ICelestialBody) =>
        ((
          body.terrain!.localFlatten![0]! as ILocalFlattenRectModifierDef
        ).halfLengthM = 0),
      (body: ICelestialBody) =>
        ((
          body.terrain!.localFlatten![0]! as ILocalFlattenRectModifierDef
        ).halfWidthM = 0),
      (body: ICelestialBody) =>
        ((
          body.terrain!.localFlatten![0]! as ILocalFlattenRectModifierDef
        ).forwardBodyFixed = [1, 0, 0]),
    ]) {
      const malformed = structuredClone(RECT_FLATTEN_BODY);
      mutate(malformed);
      expect(() => createSurfaceSampler(malformed)).toThrowError(RangeError);
    }
  });
});

const BIOME_MASK_A: TerrainMaskDef = {
  kind: 'noise-mask-3d',
  frequency: 0.6,
  octaves: 2,
  lacunarity: 2,
  persistence: 0.5,
  lowerThreshold: -0.2,
  upperThreshold: 0.2,
};

const BIOME_MASK_B: TerrainMaskDef = {
  kind: 'noise-mask-3d',
  frequency: 0.6,
  octaves: 2,
  lacunarity: 2,
  persistence: 0.5,
  seedOffset: 500,
  lowerThreshold: -0.2,
  upperThreshold: 0.2,
};

function biomeGenerator(
  amplitudeM: number,
  seedOffset: number,
): TerrainGeneratorDef {
  return {
    kind: 'fractal-noise-3d',
    amplitudeM,
    frequency: 4,
    octaves: 3,
    lacunarity: 2,
    persistence: 0.5,
    seedOffset,
  };
}

const BIOME_BODY: ICelestialBody = {
  ...TEST_BODY,
  id: 'biome-test',
  terrain: {
    ...TEST_BODY.terrain!,
    biomes: [
      {
        id: 'lowlands',
        mask: BIOME_MASK_A,
        generators: [biomeGenerator(200, 10)],
      },
      {
        id: 'highlands',
        mask: BIOME_MASK_B,
        generators: [biomeGenerator(800, 20)],
      },
    ],
  },
};

const BIOME_SAMPLE_DIRECTIONS = [
  [1, 0, 0],
  [0.2, 0.7, -0.4],
  [-2, 3, 1],
  [0.577, 0.577, 0.577],
  [-0.3, 0.1, 0.9],
  [0, 1, 0],
] as const;

describe('biome regions and queries', () => {
  it('normalizes weights to sum to 1 wherever the raw mask total is non-negligible', () => {
    const sampler = createSurfaceSampler(BIOME_BODY);
    for (const direction of BIOME_SAMPLE_DIRECTIONS) {
      const { weights } = sampler.sampleBiome(direction);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      expect(total).toBeCloseTo(1, 9);
    }
  });

  it('falls back to the first biome when the raw mask total is negligible', () => {
    const impossibleMask: TerrainMaskDef = {
      kind: 'noise-mask-3d',
      frequency: 0.6,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      lowerThreshold: 2,
      upperThreshold: 3,
    };
    const fallbackBody: ICelestialBody = {
      ...BIOME_BODY,
      terrain: {
        ...BIOME_BODY.terrain!,
        biomes: [
          {
            id: 'first',
            mask: impossibleMask,
            generators: [biomeGenerator(200, 10)],
          },
          {
            id: 'second',
            mask: impossibleMask,
            generators: [biomeGenerator(800, 20)],
          },
        ],
      },
    };
    const sampler = createSurfaceSampler(fallbackBody);
    for (const direction of BIOME_SAMPLE_DIRECTIONS) {
      expect(sampler.sampleBiome(direction)).toEqual({
        dominantBiomeIndex: 0,
        weights: [1, 0],
      });
    }
  });

  it('breaks ties by choosing the lowest index', () => {
    const tiedBody: ICelestialBody = {
      ...BIOME_BODY,
      terrain: {
        ...BIOME_BODY.terrain!,
        biomes: [
          {
            id: 'first',
            mask: BIOME_MASK_A,
            generators: [biomeGenerator(200, 10)],
          },
          {
            id: 'second',
            mask: BIOME_MASK_A,
            generators: [biomeGenerator(800, 20)],
          },
        ],
      },
    };
    const sampler = createSurfaceSampler(tiedBody);
    for (const direction of BIOME_SAMPLE_DIRECTIONS) {
      const { dominantBiomeIndex, weights } = sampler.sampleBiome(direction);
      if (weights[0] === 0 && weights[1] === 0) continue;
      expect(dominantBiomeIndex).toBe(0);
    }
  });

  it('agrees between sampleBiome and sampleDominantBiomeBatch', () => {
    const sampler = createSurfaceSampler(BIOME_BODY);
    const directions = new Float64Array(BIOME_SAMPLE_DIRECTIONS.flat());
    const output = sampler.sampleDominantBiomeBatch(directions);
    for (let index = 0; index < BIOME_SAMPLE_DIRECTIONS.length; index += 1) {
      expect(output[index]).toBe(
        sampler.sampleBiome(BIOME_SAMPLE_DIRECTIONS[index]).dominantBiomeIndex,
      );
    }
  });

  it('blends smoothly across a mask border with no hard seam', () => {
    const sampler = createSurfaceSampler(BIOME_BODY);
    const steps = 64;
    let previousWeights: readonly number[] | undefined;
    let maxStepChange = 0;
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI;
      const direction: Vec3d = [Math.cos(angle), Math.sin(angle), 0];
      const { weights } = sampler.sampleBiome(direction);
      if (previousWeights) {
        for (let b = 0; b < weights.length; b += 1) {
          maxStepChange = Math.max(
            maxStepChange,
            Math.abs(weights[b] - previousWeights[b]),
          );
        }
      }
      previousWeights = weights;
    }
    expect(maxStepChange).toBeLessThan(0.2);
  });

  it('is byte-identical to the no-biomes path when biomes is omitted', () => {
    const noBiomesBody: ICelestialBody = {
      ...BIOME_BODY,
      terrain: { ...BIOME_BODY.terrain!, biomes: undefined },
    };
    for (const direction of BIOME_SAMPLE_DIRECTIONS) {
      expect(sampleSurface(noBiomesBody, direction).elevationM).toBe(
        sampleSurface(TEST_BODY, direction).elevationM,
      );
    }
  });

  it('rejects duplicate and empty biome ids', () => {
    const duplicateBody: ICelestialBody = {
      ...BIOME_BODY,
      terrain: {
        ...BIOME_BODY.terrain!,
        biomes: [
          { id: 'same', mask: BIOME_MASK_A, generators: [] },
          { id: 'same', mask: BIOME_MASK_B, generators: [] },
        ],
      },
    };
    expect(() => createSurfaceSampler(duplicateBody)).toThrowError(RangeError);

    const emptyIdBody: ICelestialBody = {
      ...BIOME_BODY,
      terrain: {
        ...BIOME_BODY.terrain!,
        biomes: [{ id: '', mask: BIOME_MASK_A, generators: [] }],
      },
    };
    expect(() => createSurfaceSampler(emptyIdBody)).toThrowError(RangeError);
  });
});
