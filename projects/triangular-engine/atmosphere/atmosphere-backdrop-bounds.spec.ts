import {
  angularRadiusFade,
  apparentAngularRadius,
  DEFAULT_MIN_ANGULAR_RADIUS,
  screenRectCoverage,
  screenRectToPixels,
  shellScreenBounds,
} from './atmosphere-backdrop-bounds';

const FOV_DEG = 50;
const PROJ = 1 / Math.tan((FOV_DEG * Math.PI) / 360);

describe('apparentAngularRadius', () => {
  it('is asin(radius / distance) outside the sphere', () => {
    expect(apparentAngularRadius(2, 1)).toBeCloseTo(Math.PI / 6, 12);
    expect(apparentAngularRadius(100, 1)).toBeCloseTo(Math.asin(0.01), 12);
  });

  it('is a quarter turn on or inside the sphere, and 0 for an empty one', () => {
    expect(apparentAngularRadius(1, 1)).toBe(Math.PI / 2);
    expect(apparentAngularRadius(0.2, 1)).toBe(Math.PI / 2);
    expect(apparentAngularRadius(5, 0)).toBe(0);
  });

  it('shrinks with distance', () => {
    expect(apparentAngularRadius(20, 1)).toBeLessThan(apparentAngularRadius(10, 1));
  });
});

describe('angularRadiusFade', () => {
  const min = DEFAULT_MIN_ANGULAR_RADIUS;

  it('is 0 at the minimum, 1 from twice the minimum, and monotonic between', () => {
    expect(angularRadiusFade(min, min)).toBe(0);
    expect(angularRadiusFade(min / 2, min)).toBe(0);
    expect(angularRadiusFade(min * 2, min)).toBe(1);
    expect(angularRadiusFade(min * 10, min)).toBe(1);
    expect(angularRadiusFade(min * 1.5, min)).toBeCloseTo(0.5, 12);
    expect(angularRadiusFade(min * 1.25, min)).toBeLessThan(angularRadiusFade(min * 1.75, min));
  });

  it('is always 1 without a minimum', () => {
    expect(angularRadiusFade(0, 0)).toBe(1);
    expect(angularRadiusFade(0.001, -1)).toBe(1);
  });
});

describe('DEFAULT_MIN_ANGULAR_RADIUS', () => {
  it('is a fraction of a degree', () => {
    const degrees = (DEFAULT_MIN_ANGULAR_RADIUS * 180) / Math.PI;
    expect(degrees).toBeGreaterThan(0);
    expect(degrees).toBeLessThan(1);
  });
});

describe('shellScreenBounds', () => {
  it('is centred and symmetric for a sphere on the view axis', () => {
    const rect = shellScreenBounds([0, 0, -10], 1, PROJ, PROJ, 0);
    expect(rect).not.toBeNull();
    const r = rect!;
    expect(r.minX).toBeCloseTo(-r.maxX, 12);
    expect(r.minY).toBeCloseTo(-r.maxY, 12);
    // Half-width is tan(asin(r/d)) times the projection scale.
    const half = Math.tan(Math.asin(1 / 10)) * PROJ;
    expect(r.maxX).toBeCloseTo(half, 12);
    expect(r.maxY).toBeCloseTo(half, 12);
  });

  it('grows as the sphere comes closer and shrinks as it recedes', () => {
    const near = screenRectCoverage(shellScreenBounds([0, 0, -4], 1, PROJ, PROJ, 0)!);
    const far = screenRectCoverage(shellScreenBounds([0, 0, -40], 1, PROJ, PROJ, 0)!);
    expect(far).toBeLessThan(near);
    expect(far).toBeLessThan(0.01);
  });

  it('adds the margin on every side and clamps to the screen', () => {
    const bare = shellScreenBounds([0, 0, -10], 1, PROJ, PROJ, 0)!;
    const padded = shellScreenBounds([0, 0, -10], 1, PROJ, PROJ, 0.05)!;
    expect(padded.maxX - bare.maxX).toBeCloseTo(0.05, 12);
    expect(bare.minY - padded.minY).toBeCloseTo(0.05, 12);
    const huge = shellScreenBounds([0, 0, -1.5], 1, PROJ, PROJ, 0.5)!;
    expect(huge.minX).toBe(-1);
    expect(huge.maxX).toBe(1);
  });

  it('moves with the centre: right of the axis lies right of the screen centre', () => {
    const right = shellScreenBounds([3, 0, -10], 1, PROJ, PROJ, 0)!;
    expect(right.minX).toBeGreaterThan(0);
    expect(right.maxX).toBeGreaterThan(right.minX);
    const up = shellScreenBounds([0, -3, -10], 1, PROJ, PROJ, 0)!;
    expect(up.maxY).toBeLessThan(0);
  });

  it('contains every projected point of the sphere', () => {
    const centre: [number, number, number] = [2.5, -1.5, -9];
    const radius = 1.2;
    const rect = shellScreenBounds(centre, radius, PROJ, PROJ, 0)!;
    for (let i = 0; i < 400; i++) {
      // A deterministic spread of points on the sphere's surface.
      const u = (i + 0.5) / 400;
      const phi = Math.acos(1 - 2 * u);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const x = centre[0] + radius * Math.sin(phi) * Math.cos(theta);
      const y = centre[1] + radius * Math.sin(phi) * Math.sin(theta);
      const z = centre[2] + radius * Math.cos(phi);
      const nx = (x / -z) * PROJ;
      const ny = (y / -z) * PROJ;
      expect(nx).toBeGreaterThanOrEqual(rect.minX - 1e-9);
      expect(nx).toBeLessThanOrEqual(rect.maxX + 1e-9);
      expect(ny).toBeGreaterThanOrEqual(rect.minY - 1e-9);
      expect(ny).toBeLessThanOrEqual(rect.maxY + 1e-9);
    }
  });

  it('is null when the sphere is wholly off screen or behind the camera', () => {
    expect(shellScreenBounds([100, 0, -10], 1, PROJ, PROJ)).toBeNull();
    expect(shellScreenBounds([0, -100, -10], 1, PROJ, PROJ)).toBeNull();
    expect(shellScreenBounds([0, 0, 10], 1, PROJ, PROJ)).toBeNull();
    expect(shellScreenBounds([5, 5, 10], 1, PROJ, PROJ)).toBeNull();
  });

  it('is the whole screen when the camera is inside the sphere', () => {
    expect(shellScreenBounds([0, 0, -0.5], 1, PROJ, PROJ)).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    expect(shellScreenBounds([0.3, 0.2, 0.1], 1, PROJ, PROJ)).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
  });

  it('runs off the near screen edge when the sphere straddles it', () => {
    // Centre far to the right, but the sphere is big enough to reach into view.
    const rect = shellScreenBounds([6, 0, -10], 4, PROJ, PROJ, 0)!;
    expect(rect.minX).toBeGreaterThan(-1);
    expect(rect.minX).toBeLessThan(0.6);
    expect(rect.maxX).toBe(1);
  });

  it('keeps part of a sphere that is partly behind the camera in view', () => {
    // Close and off to the side: it extends behind the image plane but covers the right of the screen.
    const rect = shellScreenBounds([1.5, 0, -1], 1.2, PROJ, PROJ, 0)!;
    expect(rect).not.toBeNull();
    expect(rect.maxX).toBe(1);
    expect(rect.minX).toBeGreaterThan(0);
    expect(rect.minX).toBeLessThan(1);
  });
});

describe('screenRectToPixels', () => {
  it('maps NDC to pixels with the origin at the bottom left', () => {
    expect(screenRectToPixels({ minX: -1, minY: -1, maxX: 1, maxY: 1 }, 200, 100)).toEqual([0, 0, 200, 100]);
    expect(screenRectToPixels({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 200, 100)).toEqual([100, 50, 100, 50]);
  });

  it('pads on every side and clamps to the target', () => {
    expect(screenRectToPixels({ minX: 0, minY: 0, maxX: 0.5, maxY: 0.5 }, 200, 100, 2)).toEqual([98, 48, 54, 29]);
    expect(screenRectToPixels({ minX: -1, minY: -1, maxX: 1, maxY: 1 }, 200, 100, 5)).toEqual([0, 0, 200, 100]);
  });
});

describe('screenRectCoverage', () => {
  it('is the covered fraction of the screen', () => {
    expect(screenRectCoverage({ minX: -1, minY: -1, maxX: 1, maxY: 1 })).toBe(1);
    expect(screenRectCoverage({ minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBe(0.25);
    expect(screenRectCoverage({ minX: 0.5, minY: 0, maxX: 0.2, maxY: 1 })).toBe(0);
  });
});
