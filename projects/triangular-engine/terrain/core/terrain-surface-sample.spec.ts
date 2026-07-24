import { ConstantTerrainField, ITerrainField, ITerrainFieldSample } from './terrain-field';
import { TerrainVector3 } from './terrain-math';
import { sampleTerrainSurface } from './terrain-surface-sample';
import { PlaneTerrainDomain } from '../domains/plane-terrain-domain';
import { SphereTerrainDomain } from '../domains/sphere-terrain-domain';
import { CylinderTerrainDomain } from '../domains/cylinder-terrain-domain';

/** Linear ramp along one field-space axis, used to produce a known slope. */
class RampTerrainField implements ITerrainField {
  readonly minElevationM = -1_000;
  readonly maxElevationM = 1_000;

  constructor(
    private readonly slope: number,
    private readonly axis: 0 | 1 | 2 = 0,
  ) {}

  sample(fieldPosition: TerrainVector3): ITerrainFieldSample {
    return { elevationM: this.slope * fieldPosition[this.axis] };
  }

  sampleBatch(
    fieldPositions: Float64Array,
    elevationsM?: Float64Array,
  ): Float64Array {
    const output = elevationsM ?? new Float64Array(fieldPositions.length / 3);
    for (let i = 0; i < output.length; i++) {
      output[i] = this.slope * fieldPositions[i * 3 + this.axis];
    }
    return output;
  }
}

describe('sampleTerrainSurface', () => {
  describe('plane domain', () => {
    const domain = new PlaneTerrainDomain(1_024);
    const address = { level: 0, x: 0, z: 0 };

    it('reports zero slope and an up normal on flat ground', () => {
      const sample = sampleTerrainSurface(
        new ConstantTerrainField(5),
        domain,
        address,
        0,
        0,
      );
      expect(sample.elevationM).toBe(5);
      expect(sample.normal[0]).toBeCloseTo(0, 5);
      expect(sample.normal[1]).toBeCloseTo(1, 5);
      expect(sample.normal[2]).toBeCloseTo(0, 5);
      expect(sample.surfaceUp[0]).toBeCloseTo(0, 5);
      expect(sample.surfaceUp[1]).toBeCloseTo(1, 5);
      expect(sample.surfaceUp[2]).toBeCloseTo(0, 5);
      expect(sample.slope01).toBeCloseTo(0, 5);
      expect(sample.worldPositionM).toEqual(
        domain.getSurfacePosition(address, 0, 0, 5),
      );
    });

    it('reports a 45-degree slope as slope01 = 0.5 on a unit ramp', () => {
      const sample = sampleTerrainSurface(
        new RampTerrainField(1),
        domain,
        address,
        0,
        0,
      );
      expect(sample.slope01).toBeCloseTo(0.5, 3);
      const expectedNormal = [-1 / Math.sqrt(2), 1 / Math.sqrt(2), 0];
      expect(sample.normal[0]).toBeCloseTo(expectedNormal[0], 3);
      expect(sample.normal[1]).toBeCloseTo(expectedNormal[1], 3);
      expect(sample.normal[2]).toBeCloseTo(expectedNormal[2], 3);
    });

    it('grows slope01 towards 1 as the ramp steepens', () => {
      const gentle = sampleTerrainSurface(
        new RampTerrainField(0.2),
        domain,
        address,
        0,
        0,
      );
      const steep = sampleTerrainSurface(
        new RampTerrainField(5),
        domain,
        address,
        0,
        0,
      );
      expect(gentle.slope01).toBeGreaterThan(0);
      expect(steep.slope01).toBeGreaterThan(gentle.slope01);
      expect(steep.slope01).toBeLessThanOrEqual(1);
    });

    it('computes anchorRelativeM relative to the supplied anchor', () => {
      const field = new ConstantTerrainField(5);
      const zeroRelative = sampleTerrainSurface(field, domain, address, 10, 10);
      expect(zeroRelative.anchorRelativeM).toEqual([0, 0, 0]);

      const anchorWorldM: TerrainVector3 = [
        zeroRelative.worldPositionM[0] - 3,
        zeroRelative.worldPositionM[1],
        zeroRelative.worldPositionM[2] + 2,
      ];
      const relative = sampleTerrainSurface(field, domain, address, 10, 10, {
        anchorWorldM,
      });
      expect(relative.anchorRelativeM[0]).toBeCloseTo(3, 6);
      expect(relative.anchorRelativeM[1]).toBeCloseTo(0, 6);
      expect(relative.anchorRelativeM[2]).toBeCloseTo(-2, 6);
    });

    it('rejects a non-finite epsilon', () => {
      expect(() =>
        sampleTerrainSurface(new ConstantTerrainField(), domain, address, 0, 0, {
          epsilon: 0,
        }),
      ).toThrowError(RangeError);
    });
  });

  describe('sphere domain', () => {
    const domain = new SphereTerrainDomain(1_000);
    const address = { face: 'positive-x' as const, level: 0, x: 0, y: 0 };

    it('reports near-zero slope and an outward normal on an unshaped sphere', () => {
      const sample = sampleTerrainSurface(
        new ConstantTerrainField(50),
        domain,
        address,
        0,
        0,
      );
      expect(sample.slope01).toBeLessThan(0.01);
      const dot =
        sample.normal[0] * sample.fieldPosition[0] +
        sample.normal[1] * sample.fieldPosition[1] +
        sample.normal[2] * sample.fieldPosition[2];
      expect(dot).toBeGreaterThan(0.99);
      const surfaceUpDot =
        sample.surfaceUp[0] * sample.fieldPosition[0] +
        sample.surfaceUp[1] * sample.fieldPosition[1] +
        sample.surfaceUp[2] * sample.fieldPosition[2];
      expect(surfaceUpDot).toBeGreaterThan(0.99);
    });

    it('reports non-zero slope where the field actually tilts', () => {
      const sample = sampleTerrainSurface(
        new RampTerrainField(400, 1),
        domain,
        address,
        0,
        0,
      );
      expect(sample.slope01).toBeGreaterThan(0.1);
    });
  });

  describe('cylinder domain', () => {
    const domain = new CylinderTerrainDomain({ radiusM: 500, lengthM: 2_000 });
    const address = { level: 0, angularIndex: 0, axialIndex: 0 };

    it('reports zero slope on an unshaped wall', () => {
      const sample = sampleTerrainSurface(
        new ConstantTerrainField(10),
        domain,
        address,
        0,
        Math.PI / 8,
      );
      expect(sample.slope01).toBeCloseTo(0, 5);
    });

    it('reports non-zero slope where the field actually tilts', () => {
      const sample = sampleTerrainSurface(
        new RampTerrainField(300, 0),
        domain,
        address,
        0,
        Math.PI / 8,
      );
      expect(sample.slope01).toBeGreaterThan(0.05);
    });
  });
});
