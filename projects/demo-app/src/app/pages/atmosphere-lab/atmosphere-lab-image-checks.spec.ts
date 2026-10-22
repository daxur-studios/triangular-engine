import {
  CHECK_FRAME_WIDTH, LIT_SKY_MIN_LUMA, UNCOVERED_TOLERANCE_PX, horizonBand, isSentinelPixel, predictView, reduceFrame, runImageChecks,
  sunLocalDirection, type Surface,
} from './atmosphere-lab-image-checks';
import { syntheticFrames } from './atmosphere-lab-image-checks.testing';
import type { AtmosphereLabState } from './atmosphere-lab-tests';

const EARTH = 6_371_000;
const STATE: AtmosphereLabState = {
  bentOn: true, planetRadiusM: EARTH, preset: 'earth', projection: 'equirect', skyPath: 'auto', maskEnabled: true,
  dayNight: 'real', morph: 0, anchor: [0, 0], altitudeM: 2, yawDeg: 0, pitchDeg: 12, sunElevationDeg: 60, sunAzimuthDeg: 90, exposure: 8,
};
const WIDTH = 64;
const HEIGHT = 48;

const rows = (state: AtmosphereLabState, column = WIDTH / 2): Surface[] => {
  const prediction = predictView(state, 285_000, WIDTH, HEIGHT);
  return Array.from({ length: HEIGHT }, (_, y) => prediction.surface[y * WIDTH + column]);
};
const count = (surfaces: readonly Surface[], kind: Surface) => surfaces.filter((item) => item === kind).length;

describe('atmosphere lab image checks', () => {
  describe('reduceFrame', () => {
    /** 12 x 6 source reduced to 4 cells across (2 rows): each cell is 3 x 3 source pixels. */
    const source = (paint: (x: number, y: number) => [number, number, number]) => {
      const data = new Uint8ClampedArray(12 * 6 * 4);
      for (let y = 0; y < 6; y++) for (let x = 0; x < 12; x++) data.set([...paint(x, y), 255], (y * 12 + x) * 4);
      return data;
    };

    it('keeps one dark row that a plain average would hide, and the sentinel share', () => {
      const data = source((x, y) => (y === 1 ? [0, 0, 0] : x < 3 && y >= 3 ? [255, 0, 255] : [200, 200, 200]));
      const frame = reduceFrame(data, 12, 6, 4);
      expect([frame.width, frame.height]).toEqual([4, 2]);
      // Top-left cell: 3 x 3 pixels, one of three rows black.
      expect(frame.lumaMin[0]).toBe(0);
      expect(frame.lumaMean[0]).toBeCloseTo((200 / 255) * (2 / 3), 3);
      // Bottom-left cell is all sentinel; its neighbour has none.
      expect(frame.sentinel[4]).toBe(1);
      expect(frame.sentinel[5]).toBe(0);
      expect(frame.sentinel[0]).toBe(0);
      expect(Array.from(frame.rgba.slice(4 * 4, 4 * 4 + 4))).toEqual([255, 0, 255, 255]);
    });

    it('never makes more cells than pixels and defaults to the check width', () => {
      expect(reduceFrame(new Uint8ClampedArray(5 * 3 * 4), 5, 3).width).toBe(5);
      const wide = reduceFrame(new Uint8ClampedArray(512 * 2 * 4), 512, 2);
      expect([wide.width, wide.height]).toEqual([CHECK_FRAME_WIDTH, 1]);
    });
  });

  describe('isSentinelPixel', () => {
    it('knows magenta, also after tone mapping, and nothing the scene draws', () => {
      expect(isSentinelPixel(255, 0, 255)).toBeTrue();
      expect(isSentinelPixel(231, 3, 229)).toBeTrue();
      // Grid tints, sky, black, white, grey.
      for (const [r, g, b] of [[255, 190, 140], [140, 180, 255], [0, 0, 0], [255, 255, 255], [128, 128, 128], [200, 40, 30], [10, 0, 10]]) {
        expect(isSentinelPixel(r, g, b)).withContext(`${r},${g},${b}`).toBeFalse();
      }
    });
  });

  describe('predictView', () => {
    it('puts the sky over the ground with one boundary per column, for a view from 2 m', () => {
      const column = rows(STATE);
      expect(column[0]).toBe('sky');
      expect(column[HEIGHT - 1]).toBe('ground');
      const changes = column.filter((item, i) => i > 0 && item !== column[i - 1]).length;
      expect(changes).toBe(1);
      // Pitch 12 puts the horizon below the middle of a 75 degree view: more sky than ground.
      expect(count(column, 'sky')).toBeGreaterThan(count(column, 'ground'));
    });

    it('moves the horizon with the pitch', () => {
      const up = count(rows({ ...STATE, pitchDeg: 30 }), 'sky');
      const level = count(rows({ ...STATE, pitchDeg: 0 }), 'sky');
      const down = count(rows({ ...STATE, pitchDeg: -20 }), 'sky');
      expect(up).toBeGreaterThan(level);
      expect(level).toBeGreaterThan(down);
      // Level, the horizon is the middle of the view (a 2 m camera dips it by about 0.05 degrees).
      expect(Math.abs(level - HEIGHT / 2)).toBeLessThanOrEqual(1);
    });

    it('sees the ground from straight above, and a horizon from 25 km at morph 0.5 and 0', () => {
      const down = predictView({ ...STATE, altitudeM: 3 * EARTH, pitchDeg: -90 }, 285_000, WIDTH, HEIGHT);
      expect(down.insideAir).toBeFalse();
      expect(down.surface[(HEIGHT / 2) * WIDTH + WIDTH / 2]).toBe('ground');
      for (const morph of [0, 0.5]) {
        const column = rows({ ...STATE, altitudeM: 25_000, pitchDeg: -16, morph });
        expect(column[0]).withContext(`morph ${morph}`).toBe('sky');
        expect(column[HEIGHT - 1]).withContext(`morph ${morph}`).toBe('ground');
      }
    });

    it('finds a sky and ground boundary on the flat map too, and none looking straight down', () => {
      const flat = { ...STATE, altitudeM: 25_000, pitchDeg: -16, morph: 1 };
      expect(horizonBand(syntheticFrames(flat).normal, predictView(flat, 285_000, WIDTH, HEIGHT)).boundaries).toBe(WIDTH);
      const down = { ...flat, pitchDeg: -80 };
      expect(horizonBand(syntheticFrames(down).normal, predictView(down, 285_000, WIDTH, HEIGHT)).boundaries).toBe(0);
    });

    it('marks ground past the map\'s edge as beyond, and nothing as beyond with the mask off', () => {
      const edge = { ...STATE, altitudeM: 25_000, morph: 1, anchor: [0.99, 0] as const, yawDeg: 90, pitchDeg: -10 };
      expect(predictView(edge, 285_000, WIDTH, HEIGHT).surface).toContain('beyond');
      expect(predictView({ ...edge, maskEnabled: false }, 285_000, WIDTH, HEIGHT).surface).not.toContain('beyond');
    });

    it('reports the sun over the horizon at noon and under it at night, in real and always-day modes', () => {
      expect(predictView(STATE, 285_000, WIDTH, HEIGHT).sunUp).toBeCloseTo(Math.sin((60 * Math.PI) / 180), 6);
      expect(predictView({ ...STATE, sunElevationDeg: -10 }, 285_000, WIDTH, HEIGHT).sunUp).toBeLessThan(0);
      expect(predictView({ ...STATE, dayNight: 'alwaysDay', sunElevationDeg: -10 }, 285_000, WIDTH, HEIGHT).sunUp)
        .toBeCloseTo(Math.sin((50 * Math.PI) / 180), 6);
    });

    it('carries the real sun with the body frame when the camera is moved over the map', () => {
      const k = 1 / EARTH;
      const centre = sunLocalDirection(STATE, k, 0, 0);
      const east = sunLocalDirection(STATE, k, 0.5 * Math.PI * EARTH, 0);
      expect(Math.hypot(...centre)).toBeCloseTo(1, 9);
      // A quarter turn east: the sun that stood 60 degrees up at the centre is now lower in the sky.
      expect(east[1]).toBeLessThan(centre[1]);
    });
  });

  describe('runImageChecks', () => {
    const expectAll = { litSky: true, horizon: true };
    const run = (state: AtmosphereLabState, defects = {}, expectations = expectAll) =>
      runImageChecks(state, syntheticFrames(state, defects), expectations);
    const failed = (outcome: ReturnType<typeof run>) => outcome.checks.filter((item) => !item.passed).map((item) => item.name);

    it('passes the frames a correct renderer gives, with every metric', () => {
      const outcome = run(STATE);
      expect(failed(outcome)).toEqual([]);
      expect(outcome.checks.length).toBe(3);
      expect(outcome.uncoveredPixels).toBe(0);
      expect(outcome.skyMedianLuma).toBeCloseTo(0.6, 5);
      expect(outcome.horizonBandPixels).toBe(0);
      expect(outcome.horizonColumns).toBe(WIDTH);
    });

    it('fails a black sky, and says the band could not be judged instead of passing it', () => {
      const outcome = run(STATE, { sky: 0 });
      expect(failed(outcome)).toContain('Sky is lit');
      expect(outcome.skyMedianLuma).toBe(0);
      expect(failed(outcome)).toContain('No dark band at the horizon');
      expect(outcome.checks.find((item) => item.name === 'No dark band at the horizon')?.detail).toContain('none could be judged');
    });

    it('tells a dark sky from a black one', () => {
      expect(failed(run(STATE, { sky: LIT_SKY_MIN_LUMA * 3 }))).toEqual([]);
      expect(failed(run(STATE, { sky: LIT_SKY_MIN_LUMA / 2 }))).toContain('Sky is lit');
    });

    it('fails a one-row black band under the predicted horizon and counts its cells', () => {
      const outcome = run(STATE, { bandRows: 1 });
      expect(failed(outcome)).toEqual(['No dark band at the horizon']);
      expect(outcome.horizonBandPixels).toBe(WIDTH);
      expect(outcome.details['horizonDarkColumns']).toBe(WIDTH);
    });

    it('lets a few dark columns through, but not many', () => {
      const frames = syntheticFrames(STATE);
      const prediction = predictView(STATE, frames.airTopM, WIDTH, HEIGHT);
      const darken = (columns: number) => {
        const normal = syntheticFrames(STATE).normal;
        for (let x = 0; x < columns; x++) {
          for (let y = 0; y < HEIGHT - 1; y++) {
            if (prediction.surface[y * WIDTH + x] === 'sky' && prediction.surface[(y + 1) * WIDTH + x] === 'ground') {
              normal.lumaMin[(y + 1) * WIDTH + x] = 0;
            }
          }
        }
        return runImageChecks(STATE, { ...frames, normal }, expectAll);
      };
      expect(failed(darken(1))).toEqual([]);
      expect(failed(darken(4))).toEqual(['No dark band at the horizon']);
    });

    it('fails any sentinel the mesh leaves beyond a tolerance of a cell', () => {
      expect(failed(run(STATE, { uncoveredCells: UNCOVERED_TOLERANCE_PX }))).toEqual([]);
      const outcome = run(STATE, { uncoveredCells: UNCOVERED_TOLERANCE_PX + 5 });
      expect(failed(outcome)).toEqual(['Ground mesh covers the atmosphere\'s ground']);
      expect(outcome.uncoveredPixels).toBe(UNCOVERED_TOLERANCE_PX + 5);
    });

    it('counts a partly sentinel cell by its area', () => {
      const frames = syntheticFrames(STATE);
      frames.coverage.sentinel[0] = 0.25;
      frames.coverage.sentinel[1] = 0.5;
      expect(runImageChecks(STATE, frames, expectAll).uncoveredPixels).toBeCloseTo(0.75, 6);
    });

    it('skips the lit-sky check above the air, in the dark, or with no sky, unless the scenario insists', () => {
      const space = { ...STATE, altitudeM: 3 * EARTH, pitchDeg: -16 };
      const dark = { ...STATE, sunElevationDeg: -20 };
      const downward = { ...STATE, altitudeM: 25_000, pitchDeg: -80 };
      const none = { litSky: false, horizon: false };
      for (const state of [space, dark, downward]) {
        const quiet = run(state, {}, none);
        expect(quiet.checks.map((item) => item.name)).not.toContain('Sky is lit');
        expect(quiet.skyMedianLuma).toBeNull();
        const insists = run(state, {}, { litSky: true, horizon: false });
        expect(failed(insists)).toEqual(['Sky is lit']);
        expect(insists.checks.find((item) => item.name === 'Sky is lit')?.detail).toContain('scenario expects a lit sky');
      }
    });

    it('fails a horizon the scenario expects where the view has none', () => {
      const down = { ...STATE, altitudeM: 25_000, pitchDeg: -80 };
      expect(failed(run(down, {}, { litSky: false, horizon: true }))).toEqual(['No dark band at the horizon']);
      expect(run(down, {}, { litSky: false, horizon: false }).horizonBandPixels).toBeNull();
    });
  });
});
