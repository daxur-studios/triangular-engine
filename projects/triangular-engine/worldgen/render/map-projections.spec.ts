import { EQUAL_EARTH_PROJECTION, EQUIRECTANGULAR_PROJECTION, MAP_PROJECTIONS } from './map-projections';

const WIDTH = 3000;
const HEIGHT = 1500;

describe('equirectangular projection', () => {
  it('round-trips project()/unproject() across a grid of lon/lat values', () => {
    for (const lon of [-Math.PI, -1.2, 0, 0.7, Math.PI * 0.999]) {
      for (const lat of [-Math.PI / 2, -0.5, 0, 0.9, Math.PI / 2]) {
        const p = EQUIRECTANGULAR_PROJECTION.project(lon, lat, WIDTH, HEIGHT);
        const back = EQUIRECTANGULAR_PROJECTION.unproject(p.x, p.y, WIDTH, HEIGHT);
        expect(back).not.toBeNull();
        expect(back!.lon).toBeCloseTo(lon, 9);
        expect(back!.lat).toBeCloseTo(lat, 9);
      }
    }
  });

  it('maps the center of the canvas to (0, 0)', () => {
    expect(EQUIRECTANGULAR_PROJECTION.project(0, 0, WIDTH, HEIGHT)).toEqual({ x: WIDTH / 2, y: HEIGHT / 2 });
  });
});

describe('Equal Earth projection', () => {
  it('round-trips project()/unproject() across a grid of lon/lat values', () => {
    for (const lon of [-Math.PI * 0.95, -1.2, 0, 0.7, Math.PI * 0.95]) {
      for (const lat of [-Math.PI / 2 + 0.02, -0.5, 0, 0.9, Math.PI / 2 - 0.02]) {
        const p = EQUAL_EARTH_PROJECTION.project(lon, lat, WIDTH, HEIGHT);
        const back = EQUAL_EARTH_PROJECTION.unproject(p.x, p.y, WIDTH, HEIGHT);
        expect(back).not.toBeNull();
        expect(back!.lon).toBeCloseTo(lon, 6);
        expect(back!.lat).toBeCloseTo(lat, 6);
      }
    }
  });

  it('maps the center of the canvas to (0, 0)', () => {
    const p = EQUAL_EARTH_PROJECTION.project(0, 0, WIDTH, HEIGHT);
    expect(p.x).toBeCloseTo(WIDTH / 2, 9);
    expect(p.y).toBeCloseTo(HEIGHT / 2, 9);
  });

  it('fills the canvas width exactly at the equator', () => {
    const equator = EQUAL_EARTH_PROJECTION.project(Math.PI, 0, WIDTH, HEIGHT);
    expect(equator.x).toBeCloseTo(WIDTH, 6);
  });

  it('narrows well short of the canvas width near the poles - the lens shape that makes it', () => {
    const nearPole = EQUAL_EARTH_PROJECTION.project(Math.PI, Math.PI / 2 - 0.001, WIDTH, HEIGHT);
    expect(nearPole.x).toBeLessThan(WIDTH * 0.85);
  });

  it('rejects a rectangular-canvas point outside its lens-shaped boundary', () => {
    // Top-left corner of the canvas: valid for every projection's bounding box, but well outside
    // Equal Earth's actual (narrower-than-the-box) polar boundary.
    expect(EQUAL_EARTH_PROJECTION.unproject(5, 5, WIDTH, HEIGHT)).toBeNull();
  });
});

describe('MAP_PROJECTIONS registry', () => {
  it('exposes both projections by kind', () => {
    expect(MAP_PROJECTIONS.equirectangular).toBe(EQUIRECTANGULAR_PROJECTION);
    expect(MAP_PROJECTIONS.equalEarth).toBe(EQUAL_EARTH_PROJECTION);
  });
});
