import { frustumNormals, type CameraAxes } from './lod-view';
import { domainPoint, type LodDomain, type Vec3 } from './lod-domain';
import { StretchMetric, stretchProjectionBasis } from './lod-morph-metric';
import { LodSelector } from './lod-selector';

/**
 * The demo's `planet-scene` orbit (600 km planet, camera 2 R above the ground looking straight down, 60 degree field of
 * view) while the globe unrolls: every point of the bent surface the real camera sees must lie inside a DRAWN leaf's bounds.
 * Headless, pure math: terrain disappearing partway through the morph shows as a leaf the camera sees that the selector culled.
 */

const R = 600_000;
const FOV = (60 * Math.PI) / 180;
const ASPECT = 16 / 9;
const PIXEL_ANGLE = (2 * Math.tan(FOV / 2)) / 1080;
const GROUND: Vec3 = [0.9, 0.85, 1];

function orbit(altitudeM: number): { position: Vec3; axes: CameraAxes } {
  const l = Math.hypot(...GROUND);
  const up: Vec3 = [GROUND[0] / l, GROUND[1] / l, GROUND[2] / l];
  const ref: Vec3 = [0, 1, 0];
  const d = ref[0] * up[0] + ref[1] * up[1] + ref[2] * up[2];
  const t: Vec3 = [ref[0] - d * up[0], ref[1] - d * up[1], ref[2] - d * up[2]];
  const tl = Math.hypot(...t);
  const forwardAxis: Vec3 = [t[0] / tl, t[1] / tl, t[2] / tl];
  const right: Vec3 = [forwardAxis[1] * up[2] - forwardAxis[2] * up[1], forwardAxis[2] * up[0] - forwardAxis[0] * up[2], forwardAxis[0] * up[1] - forwardAxis[1] * up[0]];
  const forward: Vec3 = [-up[0], -up[1], -up[2]];
  const cameraUp: Vec3 = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const lift = R + altitudeM;
  return { position: [up[0] * lift, up[1] * lift, up[2] * lift], axes: { right, up: cameraUp, forward } };
}

/** True when `p` is inside the four side planes (inward normals, through `camera`) and in front of it. */
function inView(p: Vec3, camera: Vec3, frustum: Float64Array, forward: readonly number[]): boolean {
  const x = p[0] - camera[0];
  const y = p[1] - camera[1];
  const z = p[2] - camera[2];
  if (x * forward[0] + y * forward[1] + z * forward[2] <= 0) return false;
  for (let k = 0; k < 4; k++) if (x * frustum[k * 3] + y * frustum[k * 3 + 1] + z * frustum[k * 3 + 2] < 0) return false;
  return true;
}

const basis = stretchProjectionBasis(0, 0);
const view = orbit(2 * R);
const frustum = new Float64Array(12);
frustumNormals(view.axes, FOV, ASPECT, frustum);

/**
 * Culled leaves (the selector lists them after the drawn ones) that have a sample on the bent surface, at the LIVE morph, that the
 * real camera sees: each is terrain that should be on screen and is not. Judged from the leaf's cell, not from the selector's
 * bounds, which are the very thing under test (a stale leaf's bounds describe an earlier morph).
 */
function countWrongCulls(selector: LodSelector, metric: StretchMetric): { culled: number; wrong: number } {
  const domain: LodDomain = { kind: 'sphere', sizeM: R, warp: 'equal-angle' };
  const p: Vec3 = [0, 0, 0];
  const n: Vec3 = [0, 0, 0];
  const out: Vec3 = [0, 0, 0];
  let wrong = 0;
  const GRID = 6;
  for (let k = selector.stats.drawn; k < selector.stats.leaves; k++) {
    const node = selector.leaves[k];
    const size = 1 / 2 ** selector.level[node];
    domainPoint(domain, selector.root[node], (selector.i[node] + 0.5) * size, (selector.j[node] + 0.5) * size, p, n);
    const refLon = Math.atan2(n[0] * basis.right[0] + n[1] * basis.right[1] + n[2] * basis.right[2], n[0] * basis.forward[0] + n[1] * basis.forward[1] + n[2] * basis.forward[2]);
    let seen = false;
    for (let a = 0; a <= GRID && !seen; a++) {
      for (let b = 0; b <= GRID && !seen; b++) {
        domainPoint(domain, selector.root[node], (selector.i[node] + a / GRID) * size, (selector.j[node] + b / GRID) * size, p, n);
        if (n[0] * basis.forward[0] + n[1] * basis.forward[1] + n[2] * basis.forward[2] < 1e-9 && Math.abs(n[0] * basis.right[0] + n[1] * basis.right[1] + n[2] * basis.right[2]) < 1e-9) continue;
        metric.bentPoint(n, 0, out, refLon);
        seen = inView(out, view.position, frustum, view.axes.forward);
      }
    }
    if (seen) wrong++;
  }
  return { culled: selector.stats.leaves - selector.stats.drawn, wrong };
}

const newSelector = (): LodSelector =>
  new LodSelector({ domain: { kind: 'sphere', sizeM: R, warp: 'equal-angle' }, patchCells: 16, mode: 'distance', fixedLevel: 3, cellPixels: 4, leafCap: 4096, heightBoundM: 0, cull: true, hysteresis: 0.15 });

describe('orbit view while the slider jumps the morph: terrain the camera sees stays drawn', () => {
  for (const [from, to] of [[0.8, 0.85], [0.85, 0.9], [0.5, 0.55], [0.9, 0.85]]) {
    it(`morph ${from} -> ${to} in one step: no leaf the camera sees is culled in any pass of the refresh`, () => {
      const selector = newSelector();
      const metric = new StretchMetric(selector, { radiusM: R, morph: 0 });
      for (let m = 0; m <= from + 1e-9; m += 0.01) metric.update({ morph: Math.min(m, from), basis });
      metric.update({ morph: from, basis });
      for (let pass = 0; pass < 40; pass++) {
        selector.select({ camera: metric.placeCamera(view.position), pixelAngle: PIXEL_ANGLE, frustum });
        if (selector.stats.geometryStale === 0) break;
      }
      metric.update({ morph: to, basis });
      let worst = 0;
      for (let pass = 0; pass < 40; pass++) {
        selector.select({ camera: metric.placeCamera(view.position), pixelAngle: PIXEL_ANGLE, frustum });
        const { wrong: missing } = countWrongCulls(selector, metric);
        worst = Math.max(worst, missing);
        if (selector.stats.geometryStale === 0) break;
      }
      expect(worst).toBe(0);
    });
  }
});

describe('orbit view during a scripted sweep: terrain the camera sees stays drawn', () => {
  it('morph 0.6 -> 1 at the demo sweep speed, one selection per frame (refresh spread over passes): never a seen leaf culled', () => {
    const selector = newSelector();
    const metric = new StretchMetric(selector, { radiusM: R, morph: 0 });
    let worst = 0;
    for (let frame = 0; frame <= 160; frame++) {
      const morph = Math.min(1, 0.6 + frame * 0.0025);
      metric.update({ morph, basis });
      selector.select({ camera: metric.placeCamera(view.position), pixelAngle: PIXEL_ANGLE, frustum });
      if (frame >= 1) worst = Math.max(worst, countWrongCulls(selector, metric).wrong);
    }
    expect(worst).toBe(0);
  });
});

/** Share of a 48x27 screen grid that at least one DRAWN leaf's bent surface lands on (what the viewer sees as terrain). */
function screenCoverage(selector: LodSelector, metric: StretchMetric): number {
  const domain: LodDomain = { kind: 'sphere', sizeM: R, warp: 'equal-angle' };
  const W = 48;
  const H = 27;
  const hit = new Uint8Array(W * H);
  const p: Vec3 = [0, 0, 0];
  const n: Vec3 = [0, 0, 0];
  const out: Vec3 = [0, 0, 0];
  const t = Math.tan(FOV / 2);
  const { right, up, forward } = view.axes;
  const S = 24;
  // The page draws the terrain camera-relative: bent point minus the BENT camera, seen through the real (unbent) camera axes.
  const eye = metric.placeCamera(view.position);
  for (let k = 0; k < selector.stats.drawn; k++) {
    const node = selector.leaves[k];
    const size = 1 / 2 ** selector.level[node];
    let refLon: number | undefined;
    for (let a = 0; a <= S; a++) {
      for (let b = 0; b <= S; b++) {
        domainPoint(domain, selector.root[node], (selector.i[node] + a / S) * size, (selector.j[node] + b / S) * size, p, n);
        if (refLon === undefined) refLon = Math.atan2(n[0] * basis.right[0] + n[1] * basis.right[1] + n[2] * basis.right[2], n[0] * basis.forward[0] + n[1] * basis.forward[1] + n[2] * basis.forward[2]);
        metric.bentPoint(n, 0, out, refLon);
        const x = out[0] - eye[0];
        const y = out[1] - eye[1];
        const z = out[2] - eye[2];
        const d = x * forward[0] + y * forward[1] + z * forward[2];
        if (d <= 0) continue;
        const sx = (x * right[0] + y * right[1] + z * right[2]) / (d * t * ASPECT);
        const sy = (x * up[0] + y * up[1] + z * up[2]) / (d * t);
        if (sx < -1 || sx > 1 || sy < -1 || sy > 1) continue;
        hit[Math.min(H - 1, Math.floor(((1 - sy) / 2) * H)) * W + Math.min(W - 1, Math.floor(((sx + 1) / 2) * W))] = 1;
      }
    }
  }
  let n1 = 0;
  for (let c = 0; c < hit.length; c++) n1 += hit[c];
  return n1 / hit.length;
}

describe('orbit view while morphing: drawn leaves cover the screen', () => {
  for (const morph of [0, 0.5, 0.85, 0.9, 0.95, 0.98, 1]) {
    it(`morph ${morph}: coverage`, () => {
      const selector = newSelector();
      const metric = new StretchMetric(selector, { radiusM: R, morph: 0 });
      for (let m = 0; m <= morph + 1e-9; m += 0.01) metric.update({ morph: Math.min(m, morph), basis });
      metric.update({ morph, basis });
      for (let pass = 0; pass < 40; pass++) {
        selector.select({ camera: metric.placeCamera(view.position), pixelAngle: PIXEL_ANGLE, frustum });
        if (selector.stats.geometryStale === 0) break;
      }
      // Measured 0.19 (globe), 0.43 (0.5), 0.60 (0.85), 0.64 (1): the screen only ever fills up as the globe unrolls.
      const coverage = screenCoverage(selector, metric);
      expect(selector.stats.drawn).toBeGreaterThan(0);
      expect(coverage).toBeGreaterThan(morph === 0 ? 0.15 : 0.4);
    });
  }
});

describe('orbit view while morphing: terrain the camera sees is drawn', () => {

  for (const morph of [0.5, 0.7, 0.85, 0.9, 0.95, 0.99, 1]) {
    it(`morph ${morph}: no leaf the camera sees is culled, and the bent camera is the render camera`, () => {
      const selector = new LodSelector({ domain: { kind: 'sphere', sizeM: R, warp: 'equal-angle' }, patchCells: 16, mode: 'distance', fixedLevel: 3, cellPixels: 4, leafCap: 4096, heightBoundM: 0, cull: true, hysteresis: 0.15 });
      const metric = new StretchMetric(selector, { radiusM: R, morph: 0 });
      // Sweep up to the morph in frame-sized steps, as the page does.
      for (let m = 0; m <= morph + 1e-9; m += 0.01) metric.update({ morph: Math.min(m, morph), basis });
      metric.update({ morph, basis });
      const camera = metric.placeCamera(view.position);
      const err = Math.hypot(camera[0] - view.position[0], camera[1] - view.position[1], camera[2] - view.position[2]);
      selector.select({ camera, pixelAngle: PIXEL_ANGLE, frustum });
      const { culled, wrong } = countWrongCulls(selector, metric);
      console.log(`orbit morph ${morph}: camera error ${err.toFixed(0)} m, culled ${culled}, wrongly ${wrong}, drawn ${selector.stats.drawn}/${selector.stats.leaves}`);
      expect(err).toBeLessThan(0.05 * 2 * R);
      expect(selector.stats.drawn).toBeGreaterThan(0);
      expect(wrong).toBe(0);
    });
  }
});
