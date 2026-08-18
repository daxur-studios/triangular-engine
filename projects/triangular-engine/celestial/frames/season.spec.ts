import { ICelestialBody } from '../bodies/celestial-body';
import { Vec3d } from '../math/vec3';
import { bodyOrientationAt, inertialToBodyFixed } from './body-rotation';
import { insolation01, seasonAt } from './season';

describe('season', () => {
  const AXIAL_TILT_RAD = (23.4 * Math.PI) / 180;
  const tiltedBody: ICelestialBody = {
    id: 'earth-tilt-test',
    kind: 'planet',
    radiusM: 6_000_000,
    muM3PerS2: 1e14,
    rotationPeriodS: 86_400,
    axialTiltRad: AXIAL_TILT_RAD,
  };
  const untiltedBody: ICelestialBody = { ...tiltedBody, axialTiltRad: 0 };

  // AXIAL_TILT_AXIS is +Z (body-rotation.ts), so the pole tilts within the
  // XZ orbital plane toward -X. That makes the sun directions on the X axis
  // the solstices and the Z axis the equinoxes — verified by the exact
  // ±AXIAL_TILT_RAD readings below, not assumed.
  const SOLSTICE_SUN_DIR_A: Vec3d = [1, 0, 0];
  const SOLSTICE_SUN_DIR_B: Vec3d = [-1, 0, 0];
  const EQUINOX_SUN_DIR: Vec3d = [0, 0, 1];

  describe('seasonAt', () => {
    it('reaches -axialTiltRad declination at one solstice', () => {
      const { declinationRad } = seasonAt(tiltedBody, 0, SOLSTICE_SUN_DIR_A);
      expect(declinationRad).toBeCloseTo(-AXIAL_TILT_RAD, 6);
    });

    it('reaches +axialTiltRad declination at the opposite solstice', () => {
      const { declinationRad } = seasonAt(tiltedBody, 0, SOLSTICE_SUN_DIR_B);
      expect(declinationRad).toBeCloseTo(AXIAL_TILT_RAD, 6);
    });

    it('reads 0 declination at equinox', () => {
      const { declinationRad } = seasonAt(tiltedBody, 0, EQUINOX_SUN_DIR);
      expect(declinationRad).toBeCloseTo(0, 6);
    });

    it('is unaffected by spin phase (ut) for a fixed sun direction', () => {
      const atT0 = seasonAt(tiltedBody, 0, SOLSTICE_SUN_DIR_B);
      const atT1 = seasonAt(tiltedBody, 21_600, SOLSTICE_SUN_DIR_B);
      expect(atT1.declinationRad).toBeCloseTo(atT0.declinationRad, 9);
    });

    it('stays at 0 declination for an untilted body regardless of sun direction', () => {
      expect(
        seasonAt(untiltedBody, 0, SOLSTICE_SUN_DIR_A).declinationRad,
      ).toBeCloseTo(0, 9);
      expect(
        seasonAt(untiltedBody, 0, EQUINOX_SUN_DIR).declinationRad,
      ).toBeCloseTo(0, 9);
    });

    it('maps seasonPhase01 to 0/1 at the solstice extremes and 0.5 at equinox', () => {
      expect(
        seasonAt(tiltedBody, 0, SOLSTICE_SUN_DIR_A).seasonPhase01,
      ).toBeCloseTo(0, 6);
      expect(
        seasonAt(tiltedBody, 0, SOLSTICE_SUN_DIR_B).seasonPhase01,
      ).toBeCloseTo(1, 6);
      expect(
        seasonAt(tiltedBody, 0, EQUINOX_SUN_DIR).seasonPhase01,
      ).toBeCloseTo(0.5, 6);
    });

    it('returns seasonPhase01 = 0.5 for an untilted body (no cycle to phase)', () => {
      expect(seasonAt(untiltedBody, 0, SOLSTICE_SUN_DIR_A).seasonPhase01).toBe(
        0.5,
      );
    });
  });

  describe('insolation01', () => {
    it('is 1 at the subsolar point', () => {
      const ut = 0;
      const season = seasonAt(tiltedBody, ut, SOLSTICE_SUN_DIR_B);
      const orientation = bodyOrientationAt(tiltedBody, ut);
      const subsolarDirBodyFixed = inertialToBodyFixed(
        SOLSTICE_SUN_DIR_B,
        orientation,
      );
      expect(insolation01(subsolarDirBodyFixed, season)).toBeCloseTo(1, 6);
    });

    it('is 0 exactly 90 degrees of latitude away from the declination band', () => {
      // insolation01 is deliberately latitude/declination-only (§3: "a
      // function of climate latitude and season declination"), not
      // longitude-aware — it models noon/peak-of-day insolation at a
      // latitude, not a live instantaneous point. So the honest zero case is
      // a 90-degree latitude offset from the declination, not a longitude
      // flip (an antipodal point sits at *negated* latitude, which is not
      // generally 90 degrees away).
      const season = seasonAt(tiltedBody, 0, SOLSTICE_SUN_DIR_B);
      const y = -Math.cos(season.declinationRad);
      const dir: Vec3d = [0, y, Math.sqrt(Math.max(0, 1 - y * y))];
      expect(insolation01(dir, season)).toBeCloseTo(0, 6);
    });

    it('goes to 0 in polar night on the winter pole', () => {
      const winterSeason = seasonAt(tiltedBody, 0, SOLSTICE_SUN_DIR_A); // declinationRad < 0
      expect(insolation01([0, 1, 0], winterSeason)).toBe(0);
    });

    it('stays positive at the summer pole (grazing continuous daylight)', () => {
      const summerSeason = seasonAt(tiltedBody, 0, SOLSTICE_SUN_DIR_B); // declinationRad > 0
      expect(insolation01([0, 1, 0], summerSeason)).toBeGreaterThan(0);
    });
  });
});
