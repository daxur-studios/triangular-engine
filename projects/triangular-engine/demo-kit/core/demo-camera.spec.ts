import { computeDemoCameraView, fovForFraming } from './demo-camera';
import { DemoTrail } from './demo-trail';

describe('demo kit', () => {
  it('static camera stays put and looks at the subject', () => {
    const view = computeDemoCameraView({ mode: 'static', subjectM: [0, 1000, 0], staticPositionM: [300, 0, 0] });
    expect(view?.positionM).toEqual([300, 0, 0]);
    expect(view?.targetM).toEqual([0, 1000, 0]);
  });

  it('chase camera sits behind the velocity', () => {
    const view = computeDemoCameraView({ mode: 'chase', subjectM: [0, 100, 0], velocityMps: [0, -10, 0], distanceM: 50 });
    expect(view?.positionM[1]).toBeCloseTo(150);
  });

  it('free mode leaves the camera alone', () => {
    expect(computeDemoCameraView({ mode: 'free', subjectM: [0, 0, 0] })).toBeUndefined();
  });

  it('framing sets a narrower field of view at long range', () => {
    expect(fovForFraming(600, 10000)).toBeLessThan(fovForFraming(600, 1000));
  });

  it('trail only stores points once the subject has moved', () => {
    const trail = new DemoTrail({ minStepM: 5 });
    expect(trail.record([0, 0, 0], 1, 0)).toBeTrue();
    expect(trail.record([1, 0, 0], 1, 1)).toBeFalse();
    expect(trail.record([6, 0, 0], 1, 2)).toBeTrue();
    expect(trail.tickPoints(1).length).toBe(2);
  });
});
