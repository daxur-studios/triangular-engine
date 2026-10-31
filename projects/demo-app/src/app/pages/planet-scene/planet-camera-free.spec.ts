import { groundFrame, type Vec3 } from 'triangular-engine/lod-surface/core';
import {
  FREE_MAX_ALTITUDE_M, FREE_MIN_ALTITUDE_M, ORBIT_ALTITUDE_M, PLANET_RADIUS_M, freeDrag, freeLook, freeZoom, planetPoseView, type PlanetView,
} from './planet-camera';

const DEG = Math.PI / 180;
const FOV_DEG = 60;
const HEIGHT_PX = 800;
const START: PlanetView = planetPoseView('ground');

const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => [v[0] / len(v), v[1] / len(v), v[2] / len(v)];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The angle between two ground directions, from the cross product (accurate for tiny angles). */
function angleBetween(a: Vec3, b: Vec3): number {
  return Math.asin(Math.min(1, len(cross(unit(a), unit(b)))));
}

describe('planet camera: mouse orbit', () => {
  it('exposes the altitude limits: the 2 m eye and twice the orbit altitude', () => {
    expect(FREE_MIN_ALTITUDE_M).toBe(2);
    expect(FREE_MAX_ALTITUDE_M).toBe(2 * ORBIT_ALTITUDE_M);
    expect(FREE_MAX_ALTITUDE_M).toBe(2 * 2 * PLANET_RADIUS_M);
  });

  describe('freeDrag', () => {
    it('returns an equal view for a zero drag', () => {
      expect(freeDrag(START, 0, 0, HEIGHT_PX, FOV_DEG)).toEqual(START);
    });

    it('keeps the ground a unit direction and leaves altitude, heading and pitch bit-equal', () => {
      const moved = freeDrag(START, 100, 40, HEIGHT_PX, FOV_DEG);
      expect(Math.abs(len(moved.ground) - 1)).toBeLessThan(1e-9);
      expect(moved.altitudeM).toBe(START.altitudeM);
      expect(moved.headingRad).toBe(START.headingRad);
      expect(moved.pitchRad).toBe(START.pitchRad);
    });

    it('moves the ground by an angle that grows with altitude (linear, so 10,000 times at 20 km than at 2 m)', () => {
      const low = angleBetween(START.ground, freeDrag({ ...START, altitudeM: 2 }, 100, 0, HEIGHT_PX, FOV_DEG).ground);
      const high = angleBetween(START.ground, freeDrag({ ...START, altitudeM: 20_000 }, 100, 0, HEIGHT_PX, FOV_DEG).ground);
      expect(high).toBeGreaterThan(low);
      expect(Math.abs(high / low - 10_000) / 10_000).toBeLessThan(1e-6);
    });

    it('caps a single huge drag at 0.5 rad of ground', () => {
      const eye = freeDrag(START, 1e6, 0, HEIGHT_PX, FOV_DEG);
      expect(angleBetween(START.ground, eye.ground)).toBeLessThanOrEqual(0.5 + 1e-12);
      // At 20 km one pixel is about 4e-5 rad, so 1e6 pixels reach the cap.
      const high: PlanetView = { ...START, altitudeM: 20_000 };
      expect(angleBetween(high.ground, freeDrag(high, 1e6, 0, HEIGHT_PX, FOV_DEG).ground)).toBeCloseTo(0.5, 9);
    });

    it('turns the camera west when dragged right', () => {
      const view: PlanetView = { ...START, altitudeM: 20_000 };
      const { east } = groundFrame('sphere', view.ground);
      const moved = freeDrag(view, 100, 0, HEIGHT_PX, FOV_DEG);
      expect(dot(sub(moved.ground, unit(view.ground)), east)).toBeLessThan(0);
    });

    it('turns the camera north when dragged down', () => {
      const view: PlanetView = { ...START, altitudeM: 20_000 };
      const { north } = groundFrame('sphere', view.ground);
      const moved = freeDrag(view, 0, 100, HEIGHT_PX, FOV_DEG);
      expect(dot(sub(moved.ground, unit(view.ground)), north)).toBeGreaterThan(0);
    });
  });

  describe('freeLook', () => {
    const perPx = FOV_DEG * DEG / HEIGHT_PX;

    it('moves the heading by the drag and wraps it into -PI..PI', () => {
      const moved = freeLook({ ...START, headingRad: 3.1 }, -100, 0, HEIGHT_PX, FOV_DEG);
      expect(moved.headingRad).toBeGreaterThanOrEqual(-Math.PI);
      expect(moved.headingRad).toBeLessThanOrEqual(Math.PI);
      expect(moved.headingRad).toBeCloseTo(3.1 + 100 * perPx - 2 * Math.PI, 9);
      const wrapped = freeLook({ ...START, headingRad: 0 }, -1e5, 0, HEIGHT_PX, FOV_DEG);
      expect(wrapped.headingRad).toBeGreaterThanOrEqual(-Math.PI);
      expect(wrapped.headingRad).toBeLessThanOrEqual(Math.PI);
    });

    it('clamps the pitch to straight down (-PI/2) and straight up (PI/2)', () => {
      expect(freeLook({ ...START, pitchRad: -80 * DEG }, 0, 1000, HEIGHT_PX, FOV_DEG).pitchRad).toBe(-Math.PI / 2);
      expect(freeLook({ ...START, pitchRad: 60 * DEG }, 0, -1000, HEIGHT_PX, FOV_DEG).pitchRad).toBe(Math.PI / 2);
    });

    it('leaves the ground and the altitude unchanged', () => {
      const moved = freeLook(START, 37, -12, HEIGHT_PX, FOV_DEG);
      expect(moved.ground).toEqual(START.ground);
      expect(moved.altitudeM).toBe(START.altitudeM);
    });
  });

  describe('freeZoom', () => {
    it('scales the altitude by exp(delta * 0.001), so a positive delta zooms out', () => {
      const view: PlanetView = { ...START, altitudeM: 1000 };
      expect(freeZoom(view, 1000).altitudeM / 1000).toBeCloseTo(Math.exp(1), 12);
      expect(freeZoom(view, -1000).altitudeM / 1000).toBeCloseTo(Math.exp(-1), 12);
    });

    it('clamps the altitude at both bounds', () => {
      expect(freeZoom({ ...START, altitudeM: 1000 }, 1e9).altitudeM).toBe(FREE_MAX_ALTITUDE_M);
      expect(freeZoom({ ...START, altitudeM: 1000 }, -1e9).altitudeM).toBe(FREE_MIN_ALTITUDE_M);
    });

    it('returns to the same altitude after a zoom out and the same zoom in', () => {
      const view: PlanetView = { ...START, altitudeM: 1000 };
      const back = freeZoom(freeZoom(view, 500), -500);
      expect(Math.abs(back.altitudeM - 1000) / 1000).toBeLessThan(1e-9);
      expect(back.ground).toEqual(view.ground);
      expect(back.headingRad).toBe(view.headingRad);
      expect(back.pitchRad).toBe(view.pitchRad);
    });
  });
});
