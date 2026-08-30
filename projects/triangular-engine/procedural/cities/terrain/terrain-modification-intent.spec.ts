import {
  calculateCutFillVolume,
  evaluateCorridorGrading,
  ITerrainModificationIntent,
} from './terrain-modification-intent';

describe('TerrainModificationIntent', () => {
  it('flattens exactly within corridor half-width', () => {
    const intent: ITerrainModificationIntent = {
      id: 'road_grading_1',
      kind: 'cut-and-fill',
      corridorCenterline: [
        [0, 10, -50],
        [0, 10, 50],
      ],
      corridorWidthM: 10, // half-width = 5m
      blendDistanceM: 5,
    };

    const sampleElevation = (x: number, z: number) => 20; // 10m higher than road (cut)

    // Right on centerline (x=0) -> should be exactly road elevation 10
    expect(evaluateCorridorGrading(sampleElevation(0, 0), intent, 0, 0)).toBeCloseTo(10, 4);

    // At x=4 (inside half-width 5) -> should still be exactly 10
    expect(evaluateCorridorGrading(sampleElevation(4, 0), intent, 4, 0)).toBeCloseTo(10, 4);

    // At x=15 (outside 5+5=10m total radius) -> should return native elevation 20
    expect(evaluateCorridorGrading(sampleElevation(15, 0), intent, 15, 0)).toBeCloseTo(20, 4);

    // In blend transition at x=7.5 (midway in 5..10m blend) -> should be between 10 and 20
    const blendVal = evaluateCorridorGrading(sampleElevation(7.5, 0), intent, 7.5, 0);
    expect(blendVal).toBeGreaterThan(10);
    expect(blendVal).toBeLessThan(20);
    expect(blendVal).toBeCloseTo(15, 1); // smoothstep at 0.5 is 0.5 -> exactly 15
  });

  it('computes cut and fill volumes correctly', () => {
    const intent: ITerrainModificationIntent = {
      id: 'road_grading_test',
      kind: 'cut-and-fill',
      corridorCenterline: [
        [0, 10, -10],
        [0, 10, 10],
      ],
      corridorWidthM: 4,
      blendDistanceM: 2,
    };

    // Native hill of 15m (requires cut)
    const sampleHill = (x: number, z: number) => 15;

    const bounds = { minX: -5, maxX: 5, minZ: -10, maxZ: 10 };
    const volumes = calculateCutFillVolume(sampleHill, intent, bounds, 1.0);

    expect(volumes.fillM3).toBe(0);
    expect(volumes.cutM3).toBeGreaterThan(0);
  });
});
