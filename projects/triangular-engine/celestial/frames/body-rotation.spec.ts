import { ICelestialBody } from '../bodies/celestial-body';
import {
  bodyAngularVelocityAt,
  bodyFixedToInertial,
  bodyOrientationAt,
  inertialToBodyFixed,
  surfaceVelocityAtPoint,
} from './body-rotation';

describe('body-rotation', () => {
  const staticBody: ICelestialBody = {
    id: 'static-test',
    kind: 'moon',
    radiusM: 100_000,
    muM3PerS2: 1e12,
  };

  const rotatingBody: ICelestialBody = {
    id: 'rotating-test',
    kind: 'moon',
    radiusM: 100_000,
    muM3PerS2: 1e12,
    rotationPeriodS: 86_400,
  };

  describe('bodyOrientationAt', () => {
    it('returns identity quaternion when rotationPeriodS is absent or zero', () => {
      expect(bodyOrientationAt(staticBody, 0)).toEqual([0, 0, 0, 1]);
      expect(bodyOrientationAt(staticBody, 100_000)).toEqual([0, 0, 0, 1]);
    });

    it('calculates expected Y-axis rotation quaternion over time', () => {
      const q0 = bodyOrientationAt(rotatingBody, 0);
      expect(q0[0]).toBeCloseTo(0, 6);
      expect(q0[1]).toBeCloseTo(0, 6);
      expect(q0[2]).toBeCloseTo(0, 6);
      expect(q0[3]).toBeCloseTo(1, 6);

      // Quarter period (21,600s = 90 deg rotation around Y axis)
      const qQuarter = bodyOrientationAt(rotatingBody, 21_600);
      expect(qQuarter[0]).toBeCloseTo(0, 6);
      expect(qQuarter[1]).toBeCloseTo(Math.sin(Math.PI / 4), 6);
      expect(qQuarter[2]).toBeCloseTo(0, 6);
      expect(qQuarter[3]).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    });

    it('freezes rotation when disableCelestialRotation option is set', () => {
      const qFrozen = bodyOrientationAt(rotatingBody, 21_600, {
        disableCelestialRotation: true,
      });
      expect(qFrozen).toEqual([0, 0, 0, 1]);
    });
  });

  describe('bodyAngularVelocityAt', () => {
    it('returns zero vector when rotationPeriodS is absent', () => {
      expect(bodyAngularVelocityAt(staticBody)).toEqual([0, 0, 0]);
    });

    it('returns expected angular velocity around Y axis', () => {
      const omega = bodyAngularVelocityAt(rotatingBody);
      expect(omega[0]).toBeCloseTo(0, 6);
      expect(omega[1]).toBeCloseTo((2 * Math.PI) / 86_400, 8);
      expect(omega[2]).toBeCloseTo(0, 6);
    });

    it('returns zero vector when disableCelestialRotation option is set', () => {
      const omega = bodyAngularVelocityAt(rotatingBody, {
        disableCelestialRotation: true,
      });
      expect(omega).toEqual([0, 0, 0]);
    });
  });

  describe('axialTiltRad', () => {
    const tiltedBody: ICelestialBody = {
      id: 'tilted-test',
      kind: 'planet',
      radiusM: 100_000,
      muM3PerS2: 1e12,
      rotationPeriodS: 86_400,
      axialTiltRad: (23.4 * Math.PI) / 180,
    };

    it('leaves zero-tilt bodies exactly matching the untilted formula', () => {
      // Regression guard for the "unaffected on a zero-tilt body" exit
      // criterion (weather-seasons-climate.md W0).
      const untilted = bodyOrientationAt(rotatingBody, 21_600);
      const explicitZeroTilt = bodyOrientationAt(
        { ...rotatingBody, axialTiltRad: 0 },
        21_600,
      );
      expect(explicitZeroTilt).toEqual(untilted);
    });

    it('tilts the pole away from +Y by axialTiltRad', () => {
      // At t=0 there's no spin phase yet, so the body-fixed pole [0,1,0]
      // rotated into PCI space directly reveals the tilt magnitude.
      const R = bodyOrientationAt(tiltedBody, 0);
      const poleInertial = bodyFixedToInertial([0, 1, 0], R);
      const angleFromYRad = Math.acos(poleInertial[1]);
      expect(angleFromYRad).toBeCloseTo(tiltedBody.axialTiltRad!, 6);
    });

    it('keeps the spin phase composing correctly under tilt (roundtrip)', () => {
      const R = bodyOrientationAt(tiltedBody, 12_345);
      const pBody: [number, number, number] = [100, 200, 300];
      const pInertial = bodyFixedToInertial(pBody, R);
      const pBack = inertialToBodyFixed(pInertial, R);
      expect(pBack[0]).toBeCloseTo(pBody[0], 5);
      expect(pBack[1]).toBeCloseTo(pBody[1], 5);
      expect(pBack[2]).toBeCloseTo(pBody[2], 5);
    });
  });

  describe('bodyAngularVelocityAt with axialTiltRad', () => {
    it('matches the untilted formula when tilt is 0', () => {
      const omega = bodyAngularVelocityAt({ ...rotatingBody, axialTiltRad: 0 });
      expect(omega).toEqual(bodyAngularVelocityAt(rotatingBody));
    });

    it('tilts the angular velocity axis away from +Y by axialTiltRad', () => {
      const tiltRad = (23.4 * Math.PI) / 180;
      const omega = bodyAngularVelocityAt({
        ...rotatingBody,
        axialTiltRad: tiltRad,
      });
      const omegaMagnitude = Math.sqrt(
        omega[0] * omega[0] + omega[1] * omega[1] + omega[2] * omega[2],
      );
      expect(omegaMagnitude).toBeCloseTo((2 * Math.PI) / 86_400, 8);
      const angleFromYRad = Math.acos(omega[1] / omegaMagnitude);
      expect(angleFromYRad).toBeCloseTo(tiltRad, 6);
    });
  });

  describe('coordinate conversions', () => {
    it('roundtrips bodyFixedToInertial and inertialToBodyFixed', () => {
      const R = bodyOrientationAt(rotatingBody, 12_345);
      const pBody: [number, number, number] = [100, 200, 300];

      const pInertial = bodyFixedToInertial(pBody, R);
      const pBack = inertialToBodyFixed(pInertial, R);

      expect(pBack[0]).toBeCloseTo(pBody[0], 5);
      expect(pBack[1]).toBeCloseTo(pBody[1], 5);
      expect(pBack[2]).toBeCloseTo(pBody[2], 5);
    });
  });

  describe('surfaceVelocityAtPoint', () => {
    it('adds body velocity and omega cross Rp', () => {
      const vBody: [number, number, number] = [10, 0, 0];
      const omega: [number, number, number] = [0, 2, 0];
      const Rp: [number, number, number] = [1, 0, 0];

      // omega cross Rp = [0, 2, 0] x [1, 0, 0] = [0, 0, -2]
      const vSurf = surfaceVelocityAtPoint(vBody, omega, Rp);
      expect(vSurf).toEqual([10, 0, -2]);
    });
  });
});
