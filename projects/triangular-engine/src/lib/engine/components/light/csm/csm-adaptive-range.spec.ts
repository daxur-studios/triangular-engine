import { PerspectiveCamera, Vector3 } from 'three';
import { calculateCsmAdaptiveRange } from './csm-adaptive-range';
import { CsmAdaptiveRange } from './csm.model';

describe('calculateCsmAdaptiveRange', () => {
  let camera: PerspectiveCamera;
  const config: CsmAdaptiveRange = {
    center: [0, 0, 0],
    surfaceRadius: 6000,
    minDistance: 200,
    maxDistance: 3000,
    altitudeScale: 1.5,
    fadeOutAltitude: 2500,
    maxFadeAltitude: 5000,
  };

  beforeEach(() => {
    camera = new PerspectiveCamera(60, 1, 0.1, 10000);
  });

  it('calculates ground level distance with full shadow factor when camera is on planet surface', () => {
    camera.position.set(0, 6000, 0); // On surface
    const result = calculateCsmAdaptiveRange(camera, config);

    expect(result.altitude).toBe(0);
    expect(result.maxDistance).toBe(200);
    expect(result.shadowFactor).toBe(1.0);
  });

  it('scales shadow distance outward as camera ascends to low altitude', () => {
    camera.position.set(0, 6500, 0); // 500m altitude
    const result = calculateCsmAdaptiveRange(camera, config);

    expect(result.altitude).toBe(500);
    // minDistance(200) + 500 * 1.5 = 950
    expect(result.maxDistance).toBe(950);
    expect(result.shadowFactor).toBe(1.0);
  });

  it('clamps shadow distance to maxDistance when climbing higher', () => {
    camera.position.set(0, 8100, 0); // 2100m altitude: 200 + 2100 * 1.5 = 3350 > 3000
    const result = calculateCsmAdaptiveRange(camera, config);

    expect(result.altitude).toBe(2100);
    expect(result.maxDistance).toBe(3000);
    expect(result.shadowFactor).toBe(1.0);
  });

  it('attenuates shadowFactor smoothly between fadeOutAltitude and maxFadeAltitude', () => {
    // Middle of fade range (2500 -> 5000: midpoint is 3750)
    camera.position.set(0, 6000 + 3750, 0);
    const result = calculateCsmAdaptiveRange(camera, config);

    expect(result.altitude).toBe(3750);
    expect(result.shadowFactor).toBeCloseTo(0.5, 2);
  });

  it('fades shadowFactor completely to 0.0 when camera enters deep orbit above maxFadeAltitude', () => {
    camera.position.set(0, 6000 + 6000, 0); // 6000m altitude > 5000m
    const result = calculateCsmAdaptiveRange(camera, config);

    expect(result.altitude).toBe(6000);
    expect(result.shadowFactor).toBe(0.0);
  });
});
