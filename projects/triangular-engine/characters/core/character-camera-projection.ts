/**
 * Framework-free pinhole camera projection for character probes: points, ellipsoids and
 * capsules projected into image pixels with the same conventions as a Three.js
 * `PerspectiveCamera` aimed with `lookAt`. Probe geometry is built in a model frame and moved
 * into the world with a column-major 4x4 matrix such as `Object3D.matrixWorld.elements`.
 */

import type { CharacterVector3 } from './character-vector';

/** Column-major 4x4 affine matrix with 16 entries, the layout of Three.js `Matrix4.elements`. */
export type CharacterMatrix4 = readonly number[];

/**
 * A pinhole camera aimed at a target, matching a Three.js `PerspectiveCamera` that called
 * `lookAt(target)` with the given up vector. Pixel `(0, 0)` is the top-left corner of the image
 * and pixel column `i` covers `[i, i + 1)`.
 */
export interface CharacterPinholeCamera {
  readonly position: CharacterVector3;
  readonly target: CharacterVector3;
  /** World up used to aim the camera. Defaults to +Y. */
  readonly up?: CharacterVector3;
  /** Vertical field of view in degrees. */
  readonly fovYDegrees: number;
  /** Image width in pixels. */
  readonly width: number;
  /** Image height in pixels. */
  readonly height: number;
}

/** A projected point in image pixels; `depth` is the distance in front of the camera along its view axis. */
export interface CharacterImagePoint {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

/**
 * An ellipsoid given by its centre and three axis vectors. Surface points are
 * `center + axes[0]·u.x + axes[1]·u.y + axes[2]·u.z` for unit vectors `u`; the axis lengths are
 * the semi-axes. A sphere of radius `r` has axes `(r,0,0)`, `(0,r,0)`, `(0,0,r)`.
 */
export interface CharacterEllipsoid {
  readonly center: CharacterVector3;
  readonly axes: readonly [CharacterVector3, CharacterVector3, CharacterVector3];
}

/** A capsule: every point within `radius` of the segment from `start` to `end`. */
export interface CharacterCapsule {
  readonly start: CharacterVector3;
  readonly end: CharacterVector3;
  readonly radius: number;
}

/**
 * The exact image of an ellipsoid's outline under a pinhole camera, an ellipse in pixels.
 * `shape` holds the symmetric 2x2 matrix `[s11, s12, s22]` with
 * `(p − center)ᵀ · S · (p − center) = 1` on the outline.
 */
export interface CharacterProjectedEllipse {
  readonly center: { readonly x: number; readonly y: number };
  readonly semiMajor: number;
  readonly semiMinor: number;
  /** Angle of the major axis from the +x pixel axis, in radians, measured towards +y (down). */
  readonly angle: number;
  readonly shape: readonly [number, number, number];
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

interface CameraFrame {
  readonly origin: CharacterVector3;
  readonly right: CharacterVector3;
  readonly upAxis: CharacterVector3;
  readonly back: CharacterVector3;
  readonly focal: number;
  readonly cx: number;
  readonly cy: number;
}

const sub = (a: CharacterVector3, b: CharacterVector3): CharacterVector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: CharacterVector3, b: CharacterVector3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: CharacterVector3, b: CharacterVector3): CharacterVector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (a: CharacterVector3): CharacterVector3 => {
  const l = Math.hypot(a.x, a.y, a.z);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
};

function cameraFrame(camera: CharacterPinholeCamera): CameraFrame {
  const up = camera.up ?? { x: 0, y: 1, z: 0 };
  const back = unit(sub(camera.position, camera.target));
  let right = cross(up, back);
  if (Math.hypot(right.x, right.y, right.z) < 1e-9) {
    // Same fallback as Three.js when looking straight along the up vector.
    right = cross(up, { x: back.x + 1e-4, y: back.y, z: back.z });
  }
  right = unit(right);
  const upAxis = cross(back, right);
  const focal = camera.height / 2 / Math.tan(((camera.fovYDegrees * Math.PI) / 180) / 2);
  return { origin: camera.position, right, upAxis, back, focal, cx: camera.width / 2, cy: camera.height / 2 };
}

/** Applies a column-major 4x4 matrix to a point. */
export function transformCharacterPoint(m: CharacterMatrix4, p: CharacterVector3): CharacterVector3 {
  return {
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  };
}

/** Applies the linear part of a column-major 4x4 matrix to a direction (no translation). */
export function transformCharacterDirection(m: CharacterMatrix4, v: CharacterVector3): CharacterVector3 {
  return {
    x: m[0] * v.x + m[4] * v.y + m[8] * v.z,
    y: m[1] * v.x + m[5] * v.y + m[9] * v.z,
    z: m[2] * v.x + m[6] * v.y + m[10] * v.z,
  };
}

/** Moves an ellipsoid into another frame with a column-major 4x4 affine matrix. */
export function transformCharacterEllipsoid(m: CharacterMatrix4, e: CharacterEllipsoid): CharacterEllipsoid {
  return {
    center: transformCharacterPoint(m, e.center),
    axes: [
      transformCharacterDirection(m, e.axes[0]),
      transformCharacterDirection(m, e.axes[1]),
      transformCharacterDirection(m, e.axes[2]),
    ],
  };
}

/**
 * Moves a capsule into another frame. The radius is scaled by the length of the matrix's first
 * column, so the matrix must not scale unevenly.
 */
export function transformCharacterCapsule(m: CharacterMatrix4, c: CharacterCapsule): CharacterCapsule {
  return {
    start: transformCharacterPoint(m, c.start),
    end: transformCharacterPoint(m, c.end),
    radius: c.radius * Math.hypot(m[0], m[1], m[2]),
  };
}

/** Projects a world point into image pixels, or returns `null` when it is not in front of the camera. */
export function projectCharacterPoint(camera: CharacterPinholeCamera, p: CharacterVector3): CharacterImagePoint | null {
  const f = cameraFrame(camera);
  const d = sub(p, f.origin);
  const depth = -dot(d, f.back);
  if (depth <= 1e-9) return null;
  return {
    x: f.cx + (f.focal * dot(d, f.right)) / depth,
    y: f.cy - (f.focal * dot(d, f.upAxis)) / depth,
    depth,
  };
}

function axesMatrix(e: CharacterEllipsoid): Mat3 {
  const [a, b, c] = e.axes;
  return [a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z];
}

function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-30) return null;
  const s = 1 / det;
  return [
    A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
  ];
}

function mul3v(m: Mat3, v: CharacterVector3): CharacterVector3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

/**
 * Returns `|M⁻¹(p − center)|²`: below 1 inside the ellipsoid, 1 on its surface and above 1
 * outside. Returns `Infinity` for a degenerate ellipsoid.
 */
export function characterEllipsoidLevel(e: CharacterEllipsoid, p: CharacterVector3): number {
  const inv = invert3(axesMatrix(e));
  if (!inv) return Infinity;
  const u = mul3v(inv, sub(p, e.center));
  return dot(u, u);
}

/**
 * Samples the contour generator of an ellipsoid seen from `viewpoint`: the closed curve of
 * surface points whose tangent planes pass through the viewpoint, which projects onto the
 * ellipsoid's outline. Returns an empty list when the viewpoint is inside the ellipsoid.
 */
export function characterEllipsoidContour(
  e: CharacterEllipsoid,
  viewpoint: CharacterVector3,
  samples: number,
): CharacterVector3[] {
  const m = axesMatrix(e);
  const inv = invert3(m);
  if (!inv) return [];
  const v = mul3v(inv, sub(viewpoint, e.center));
  const vv = dot(v, v);
  if (vv <= 1) return [];
  const centre = { x: v.x / vv, y: v.y / vv, z: v.z / vv };
  const radius = Math.sqrt(1 - 1 / vv);
  const n = unit(v);
  const helper = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const a = unit(cross(n, helper));
  const b = cross(n, a);
  const out: CharacterVector3[] = [];
  for (let k = 0; k < samples; k++) {
    const t = (k / samples) * Math.PI * 2;
    const ct = Math.cos(t) * radius;
    const st = Math.sin(t) * radius;
    const u = { x: centre.x + a.x * ct + b.x * st, y: centre.y + a.y * ct + b.y * st, z: centre.z + a.z * ct + b.z * st };
    const w = mul3v(m, u);
    out.push({ x: e.center.x + w.x, y: e.center.y + w.y, z: e.center.z + w.z });
  }
  return out;
}

/**
 * Projects an ellipsoid's outline exactly, through its dual quadric. Returns `null` when the
 * camera is inside the ellipsoid or the outline is not a finite ellipse (part of the ellipsoid
 * is behind the camera).
 */
export function projectCharacterEllipsoid(
  camera: CharacterPinholeCamera,
  e: CharacterEllipsoid,
): CharacterProjectedEllipse | null {
  if (characterEllipsoidLevel(e, camera.position) <= 1) return null;
  const f = cameraFrame(camera);
  // P = K [R | −R·origin], with pixel·w = (cx·depth + f·xc, cy·depth − f·yc, depth).
  const R = [f.right, f.upAxis, f.back];
  const t = R.map((row) => -dot(row, f.origin));
  const K = [
    [f.focal, 0, -f.cx],
    [0, -f.focal, -f.cy],
    [0, 0, -1],
  ];
  const P: number[][] = K.map((k) => [
    k[0] * R[0].x + k[1] * R[1].x + k[2] * R[2].x,
    k[0] * R[0].y + k[1] * R[1].y + k[2] * R[2].y,
    k[0] * R[0].z + k[1] * R[1].z + k[2] * R[2].z,
    k[0] * t[0] + k[1] * t[1] + k[2] * t[2],
  ]);
  // Dual quadric Q* = H·diag(1,1,1,−1)·Hᵀ with H = [[M, c], [0, 1]].
  const m = axesMatrix(e);
  const c = [e.center.x, e.center.y, e.center.z];
  const Q: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, -1]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      Q[i][j] = m[i * 3] * m[j * 3] + m[i * 3 + 1] * m[j * 3 + 1] + m[i * 3 + 2] * m[j * 3 + 2] - c[i] * c[j];
    }
    Q[i][3] = -c[i];
    Q[3][i] = -c[i];
  }
  const C: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) for (let l = 0; l < 4; l++) s += P[i][k] * Q[k][l] * P[j][l];
      C[i][j] = s;
    }
  }
  if (Math.abs(C[2][2]) < 1e-30) return null;
  const n = -1 / C[2][2];
  const x0 = -C[0][2] * n;
  const y0 = -C[1][2] * n;
  // B⁻¹ = N[0:2, 0:2] + x0·x0ᵀ.
  const i11 = C[0][0] * n + x0 * x0;
  const i12 = C[0][1] * n + x0 * y0;
  const i22 = C[1][1] * n + y0 * y0;
  const tr = i11 + i22;
  const disc = Math.sqrt(Math.max(0, ((i11 - i22) / 2) ** 2 + i12 * i12));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  if (!(l2 > 0)) return null;
  const det = i11 * i22 - i12 * i12;
  // Major axis is the eigenvector (i12, l1 − i11) of B⁻¹.
  const angle = Math.abs(i12) < 1e-15 ? (i11 >= i22 ? 0 : Math.PI / 2) : Math.atan2(l1 - i11, i12);
  return {
    center: { x: x0, y: y0 },
    semiMajor: Math.sqrt(l1),
    semiMinor: Math.sqrt(l2),
    angle,
    shape: [i22 / det, -i12 / det, i11 / det],
  };
}

/**
 * Signed distance in pixels from an image point to a projected ellipse's outline, to first
 * order (negative inside), with the outward unit normal there.
 */
export function characterProjectedEllipseDistance(
  ellipse: CharacterProjectedEllipse,
  point: { readonly x: number; readonly y: number },
): { readonly distance: number; readonly normal: { readonly x: number; readonly y: number } } {
  const [s11, s12, s22] = ellipse.shape;
  const dx = point.x - ellipse.center.x;
  const dy = point.y - ellipse.center.y;
  const gx = s11 * dx + s12 * dy;
  const gy = s12 * dx + s22 * dy;
  const value = dx * gx + dy * gy;
  const g = Math.hypot(gx, gy);
  if (g < 1e-12) return { distance: -Math.min(ellipse.semiMajor, ellipse.semiMinor), normal: { x: 1, y: 0 } };
  // value − 1 ≈ 2·|∇|·distance near the outline, with ∇ = 2·S·d.
  const scale = Math.sqrt(value);
  return { distance: ((scale - 1) * value) / (2 * g * scale), normal: { x: gx / g, y: gy / g } };
}

/**
 * Distance along the segment `from → to`, as a fraction of its length, at which it first
 * enters the ellipsoid, or `null` when it does not enter it within the segment. A segment that
 * starts inside returns 0.
 */
export function characterSegmentEllipsoidEntry(
  from: CharacterVector3,
  to: CharacterVector3,
  e: CharacterEllipsoid,
): number | null {
  const inv = invert3(axesMatrix(e));
  if (!inv) return null;
  const o = mul3v(inv, sub(from, e.center));
  const d = mul3v(inv, sub(to, from));
  const a = dot(d, d);
  const b = dot(o, d);
  const c = dot(o, o) - 1;
  if (c <= 0) return 0;
  const h = b * b - a * c;
  if (h < 0 || a < 1e-30) return null;
  const t = (-b - Math.sqrt(h)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * Distance along the segment `from → to`, as a fraction of its length, at which it first
 * enters the capsule, or `null` when it does not enter it within the segment. A segment that
 * starts inside returns 0.
 */
export function characterSegmentCapsuleEntry(
  from: CharacterVector3,
  to: CharacterVector3,
  capsule: CharacterCapsule,
): number | null {
  const seg = sub(to, from);
  const len = Math.hypot(seg.x, seg.y, seg.z);
  if (len < 1e-12) return null;
  const rd = { x: seg.x / len, y: seg.y / len, z: seg.z / len };
  const ra = capsule.radius;
  const ba = sub(capsule.end, capsule.start);
  const oa = sub(from, capsule.start);
  const baba = dot(ba, ba);
  const baoa = dot(ba, oa);
  // Inside test: distance from the start point to the axis segment.
  const s = baba > 0 ? Math.max(0, Math.min(1, baoa / baba)) : 0;
  const nearest = sub(oa, { x: ba.x * s, y: ba.y * s, z: ba.z * s });
  if (dot(nearest, nearest) <= ra * ra) return 0;

  let best = Infinity;
  const bard = dot(ba, rd);
  const a = baba - bard * bard;
  if (a > 1e-12) {
    const b = baba * dot(rd, oa) - baoa * bard;
    const c = baba * dot(oa, oa) - baoa * baoa - ra * ra * baba;
    const h = b * b - a * c;
    if (h >= 0) {
      const t = (-b - Math.sqrt(h)) / a;
      const y = baoa + t * bard;
      if (t >= 0 && y > 0 && y < baba) best = t;
    }
  }
  for (const centre of [capsule.start, capsule.end]) {
    const oc = sub(from, centre);
    const b = dot(rd, oc);
    const c = dot(oc, oc) - ra * ra;
    const h = b * b - c;
    if (h > 0) {
      const t = -b - Math.sqrt(h);
      if (t >= 0 && t < best) best = t;
    }
  }
  return best <= len ? best / len : null;
}

/**
 * Samples the two straight contour lines of a capsule's cylindrical part seen from `viewpoint`,
 * from the start cap to the end cap. Each line has `samples` points, evenly spaced and excluding
 * the two ends. The first line lies on the side `axis × (towards viewpoint)`, which is the image
 * right when the axis points up the image. Returns two empty lines when the viewpoint is within
 * the cylinder radius of the axis.
 */
export function characterCapsuleSideContour(
  capsule: CharacterCapsule,
  viewpoint: CharacterVector3,
  samples: number,
): readonly [CharacterVector3[], CharacterVector3[]] {
  const axisVector = sub(capsule.end, capsule.start);
  const length = Math.hypot(axisVector.x, axisVector.y, axisVector.z);
  const axis = unit(axisVector);
  const rel = sub(viewpoint, capsule.start);
  const along = dot(rel, axis);
  const w = sub(rel, { x: axis.x * along, y: axis.y * along, z: axis.z * along });
  const D = Math.hypot(w.x, w.y, w.z);
  const r = capsule.radius;
  if (D <= r || length < 1e-12) return [[], []];
  const toward = unit(w);
  const side = cross(axis, toward);
  const cosA = r / D;
  const sinA = Math.sqrt(1 - cosA * cosA);
  const line = (sign: number): CharacterVector3[] => {
    const n = {
      x: toward.x * cosA + side.x * sinA * sign,
      y: toward.y * cosA + side.y * sinA * sign,
      z: toward.z * cosA + side.z * sinA * sign,
    };
    const out: CharacterVector3[] = [];
    for (let k = 1; k <= samples; k++) {
      const s = (k / (samples + 1)) * length;
      out.push({
        x: capsule.start.x + axis.x * s + n.x * r,
        y: capsule.start.y + axis.y * s + n.y * r,
        z: capsule.start.z + axis.z * s + n.z * r,
      });
    }
    return out;
  };
  return [line(1), line(-1)];
}
