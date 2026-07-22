import { Vector3 } from 'three';
import {
  GerstnerSurface,
  resolveGerstnerWaves,
  type GerstnerWaveDefinition,
} from './water-surface';
import { CALM_LAKE_PRESET, OCEAN_SWELL_PRESET } from './wave-presets';

/**
 * Plain-number port of GERSTNER_DISPLACE_GLSL / GERSTNER_NORMAL_GLSL, used
 * only to prove the TS and GLSL formulas agree without spinning up WebGL.
 * Any change to the GLSL in gerstner-glsl.ts must be mirrored here.
 */
function glslDisplace(
  waves: ReturnType<typeof resolveGerstnerWaves>,
  x0: number,
  z0: number,
  t: number,
): Vector3 {
  let x = x0;
  let y = 0;
  let z = z0;
  for (const w of waves) {
    const phase = w.k * (w.dirX * x0 + w.dirZ * z0) - w.omega * t;
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    x += w.steepness * w.amplitude * w.dirX * c;
    z += w.steepness * w.amplitude * w.dirZ * c;
    y += w.amplitude * s;
  }
  return new Vector3(x, y, z);
}

describe('GerstnerSurface', () => {
  const oneWave: GerstnerWaveDefinition[] = [
    { direction: [1, 0], wavelength: 10, amplitude: 1, steepness: 0.5 },
  ];

  it('is flat (height 0) at the undisplaced base origin at t=0', () => {
    const surface = new GerstnerSurface(oneWave);
    // sin(0) = 0 for a single wave whose phase is k*x0 - omega*t, at x0=0,t=0.
    // Note this is forward evaluation at a *base* coordinate, not
    // getHeight(0,0,0): steepness also shifts the crest horizontally, so the
    // world position where x0=0 lands is not world x=0 (see the next test).
    expect(surface.displace(0, 0, 0).y).toBeCloseTo(0, 10);
  });

  it('matches a plain-number port of the GLSL displacement for random samples', () => {
    const defs = OCEAN_SWELL_PRESET.waves;
    const resolved = resolveGerstnerWaves(defs);
    const surface = new GerstnerSurface(defs);
    const samples: Array<[number, number, number]> = [
      [0, 0, 0],
      [12.5, -7, 1.3],
      [-40, 22, 4.2],
      [100, 100, 8.75],
    ];
    for (const [x0, z0, t] of samples) {
      const expected = glslDisplace(resolved, x0, z0, t);
      const actual = surface.displace(x0, z0, t);
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
      expect(actual.z).toBeCloseTo(expected.z, 9);
    }
  });

  it('getHeight inverts the horizontal displacement back to the requested world XZ', () => {
    // Uses a preset with summed steepness well under 1 so the fixed-point
    // inversion in solveBase() converges tightly within its iteration budget.
    const surface = new GerstnerSurface(CALM_LAKE_PRESET.waves);
    const t = 3.1;
    for (const [x0, z0] of [
      [0, 0],
      [15, -8],
      [-30, 40],
    ] as const) {
      const displaced = surface.displace(x0, z0, t);
      // Sampling at the displaced world position should recover the same
      // height the forward displacement produced at (x0, z0).
      const height = surface.getHeight(displaced.x, displaced.z, t);
      expect(height).toBeCloseTo(displaced.y, 3);
    }
  });

  it('returns a unit-length normal that is (0,1,0) for a flat (zero-amplitude) surface', () => {
    const flatWave: GerstnerWaveDefinition[] = [
      { direction: [1, 0], wavelength: 10, amplitude: 0, steepness: 0 },
    ];
    const surface = new GerstnerSurface(flatWave);
    const normal = surface.getNormal(5, -3, 1.5);
    expect(normal.length()).toBeCloseTo(1, 10);
    expect(normal.toArray()).toEqual([0, 1, 0]);
  });

  it('produces a normal tilted away from vertical under a real wave', () => {
    const surface = new GerstnerSurface(oneWave);
    const normal = surface.getNormal(1, 0, 0);
    expect(normal.length()).toBeCloseTo(1, 6);
    expect(normal.y).toBeLessThan(1);
  });

  it('is periodic in wavelength (still water repeats every wavelength)', () => {
    const surface = new GerstnerSurface(oneWave);
    const a = surface.getHeight(3, 0, 0.4);
    const b = surface.getHeight(3 + 10, 0, 0.4); // + wavelength
    expect(b).toBeCloseTo(a, 6);
  });

  it('reports zero flow (still water) for oceans/lakes', () => {
    const surface = new GerstnerSurface(CALM_LAKE_PRESET.waves);
    const flow = surface.getFlow(10, 20, 5);
    expect(flow.toArray()).toEqual([0, 0, 0]);
  });

  it('rejects an empty wave list', () => {
    expect(() => new GerstnerSurface([])).toThrowError();
  });

  it('rejects a non-positive wavelength', () => {
    expect(
      () =>
        new GerstnerSurface([
          { direction: [1, 0], wavelength: 0, amplitude: 1, steepness: 0.5 },
        ]),
    ).toThrowError();
  });

  it('rejects a zero direction vector', () => {
    expect(
      () =>
        new GerstnerSurface([
          { direction: [0, 0], wavelength: 10, amplitude: 1, steepness: 0.5 },
        ]),
    ).toThrowError();
  });
});
