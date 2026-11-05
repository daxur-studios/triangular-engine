import { shellIntervals } from './cloud-noise-shell-interval';

const PLANET = 2000;
const INNER = 2150;
const OUTER = 2470;

const interval = (altitude: number, pitchDegrees: number) => {
  // Camera on +Y at the given height above the planet centre; pitch 0 = horizon, positive = up.
  const p = (pitchDegrees * Math.PI) / 180;
  return shellIntervals([0, PLANET + altitude, 0], [Math.cos(p), Math.sin(p), 0], PLANET, INNER, OUTER);
};
const length = (i: { near: { start: number; end: number }; far: { start: number; end: number } }) =>
  i.near.end - i.near.start + (i.far.end - i.far.start);

describe('shellIntervals', () => {
  it('sees no shell when looking down at the ground from under the cloud floor', () => {
    expect(length(interval(50, -30))).toBe(0);
  });

  it('sees the shell beyond the horizon when a shallow downward ray clears the planet', () => {
    // From 50 m up the horizon dips about 12 degrees, so -2 degrees skims over the planet and climbs back into the shell.
    expect(length(interval(50, -2))).toBeGreaterThan(300);
  });

  it('starts at the cloud floor when looking up from under it', () => {
    const i = interval(50, 60);
    // The floor is 100 m above a 50 m camera, so the start is about 100/sin(60) away.
    expect(i.near.start).toBeGreaterThan(100);
    expect(i.near.start).toBeLessThan(130);
    expect(length(i)).toBeGreaterThan(300);
  });

  it('never extends a ray past the planet surface', () => {
    for (const altitude of [10, 100, 160, 300, 600, 1500]) {
      for (let pitch = -60; pitch <= 0; pitch += 5) {
        const i = interval(altitude, pitch);
        const p = (pitch * Math.PI) / 180;
        const y = PLANET + altitude;
        const b = y * Math.sin(p);
        const disc = b * b - (y * y - PLANET * PLANET);
        if (disc > 0) {
          // The ray hits the planet: nothing after the hit may be drawn.
          const hit = -b - Math.sqrt(disc);
          expect(i.near.end).toBeLessThanOrEqual(Math.max(hit, i.near.start) + 1e-6);
          expect(length({ near: i.far, far: i.far }) / 2).toBe(0);
        }
      }
    }
  });

  it('has no sudden change in visible shell length as the camera rises through the cloud floor', () => {
    // The reported bug: the interval logic flipped at the floor, so clouds popped in and out near the horizon.
    for (let pitch = -8; pitch <= 40; pitch += 1) {
      let previous = length(interval(100, pitch));
      for (let altitude = 101; altitude <= 200; altitude += 1) {
        const current = length(interval(altitude, pitch));
        // A metre of altitude may only change the visible length by a bounded amount (near-tangent rays are steep but smooth;
        // the original bug jumped by 1000+ m).
        expect(Math.abs(current - previous)).toBeLessThan(150, `pitch ${pitch} altitude ${altitude}`);
        previous = current;
      }
    }
  });

  it('shows the same shell just under and just over the cloud floor', () => {
    for (let pitch = -10; pitch <= 40; pitch += 2) {
      expect(Math.abs(length(interval(149.9, pitch)) - length(interval(150.1, pitch)))).toBeLessThan(60, `pitch ${pitch}`);
    }
  });

  it('covers the whole shell from orbit when looking at the planet centre', () => {
    const i = shellIntervals([0, 6000, 0], [0, -1, 0], PLANET, INNER, OUTER);
    expect(i.near.start).toBeCloseTo(6000 - OUTER, 3);
    expect(i.near.end).toBeCloseTo(6000 - INNER, 3);
    expect(length({ near: i.far, far: i.far }) / 2).toBe(0);
  });

  it('sees nothing for a ray that misses the outer sphere', () => {
    expect(length(shellIntervals([0, 6000, 0], [1, 0, 0], PLANET, INNER, OUTER))).toBe(0);
  });
});
